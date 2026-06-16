import {
  getAvailableGenres,
  getAlbumById,
  getAlbumSongs,
  getArtistAlbums,
  getArtistById,
  getArtistSongs,
  getFavoriteSongs,
  getGenreAlbums,
  getGenreSongs,
  getRecentSongs,
  getRecommendedSection,
  getSongById,
  getVisibleAlbums,
  getVisibleSongs,
} from "./content/library";
import {
  createDefaultLibraryState,
  loadLibraryState,
  registerRecentPlayback,
  saveLibraryState,
  toggleFavoriteSong,
  togglePreviewAutoplay,
} from "./content/libraryState";
import type { SongConfig } from "./game/songConfig";
import type { GameApp as GameAppType } from "./game/GameApp";
import type { GameCompletionStats } from "./game/types";
import { SongPreviewPlayer } from "./SongPreviewPlayer";
import type { Album, LibraryRoute, LibraryState, SongEntry, SongMoodTag } from "./content/types";

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

interface PlayingSession {
  songId: string;
  playQueueSongIds: string[];
  queueIndex: number;
  queueMode: "single" | "queue";
  phase: "cueing" | "playing" | "completed";
  completionStats: GameCompletionStats | null;
  runStats: GameCompletionStats;
}

interface EndScreenDisplay {
  kicker: string;
  title: string;
  subtitle: string;
  praise: string;
  accent: string;
  stats: Array<{ label: string; value: string }>;
}

const DEV_BOOT_TO_END_SCREEN =
  import.meta.env.DEV && new URLSearchParams(window.location.search).get("debugEndScreen") === "1";

interface PreviewSession {
  songId: string;
  playQueueSongIds: string[];
  queueIndex: number;
  state: "loading" | "playing";
}

interface PlaybackHistoryState {
  songId: string;
  playQueueSongIds?: string[];
  queueIndex?: number;
}

interface AppHistoryState {
  route: LibraryRoute;
  playback?: PlaybackHistoryState | null;
}

const APP_HISTORY_STATE_KEY = "falling-orchestra";
type PlaybackLaunchMode = "single" | "queue";

export class AppShell {
  private appShell: HTMLDivElement;
  private gameShell: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private gameUiRoot: HTMLDivElement;
  private sessionUiRoot: HTMLDivElement;
  private libraryRoot: HTMLDivElement;
  private game?: GameAppType;
  private route: LibraryRoute = { view: "home" };
  private libraryState: LibraryState = createDefaultLibraryState();
  private session: PlayingSession | null = null;
  private gameAppModulePromise?: Promise<typeof import("./game/GameApp")>;
  private songConfigPromises = new Map<string, Promise<SongConfig>>();
  private previewPlayer = new SongPreviewPlayer();
  private previewSession: PreviewSession | null = null;
  private playbackLaunchToken = 0;
  private readonly appBasePath = this.getNormalizedBasePath();

  constructor(private root: HTMLDivElement) {
    this.root.innerHTML = `
      <div class="app-shell">
        <div class="game-shell hidden">
          <canvas class="game-canvas" aria-label="Falling Orchestra playfield"></canvas>
          <div class="game-ui-root"></div>
          <div class="session-ui-root"></div>
        </div>
        <div class="library-root"></div>
      </div>
    `;

    const appShell = this.root.querySelector<HTMLDivElement>(".app-shell");
    const gameShell = this.root.querySelector<HTMLDivElement>(".game-shell");
    const canvas = this.root.querySelector<HTMLCanvasElement>(".game-canvas");
    const gameUiRoot = this.root.querySelector<HTMLDivElement>(".game-ui-root");
    const sessionUiRoot = this.root.querySelector<HTMLDivElement>(".session-ui-root");
    const libraryRoot = this.root.querySelector<HTMLDivElement>(".library-root");

    if (!appShell || !gameShell || !canvas || !gameUiRoot || !sessionUiRoot || !libraryRoot) {
      throw new Error("App shell elements were not created");
    }

    this.appShell = appShell;
    this.gameShell = gameShell;
    this.canvas = canvas;
    this.gameUiRoot = gameUiRoot;
    this.sessionUiRoot = sessionUiRoot;
    this.libraryRoot = libraryRoot;
    this.libraryState = loadLibraryState();
    this.route = this.parseRouteFromLocation();

    this.libraryRoot.addEventListener("click", this.handleLibraryClick);
    this.sessionUiRoot.addEventListener("click", this.handleLibraryClick);
    window.addEventListener("popstate", this.handlePopState);
    if (!this.isPlaybackLocation()) {
      this.commitHistoryState(true);
    }
    this.render();
    void this.restorePlaybackFromLocation();
  }

  dispose(): void {
    this.libraryRoot.removeEventListener("click", this.handleLibraryClick);
    this.sessionUiRoot.removeEventListener("click", this.handleLibraryClick);
    window.removeEventListener("popstate", this.handlePopState);
    this.disposeGame();
    this.previewPlayer.dispose();
  }

  private handleLibraryClick = async (event: Event): Promise<void> => {
    const target = event.target as HTMLElement | null;
    const actionElement = target?.closest<HTMLElement>("[data-action]");
    if (!actionElement) {
      return;
    }

    const action = actionElement.dataset.action;
    if (!action) {
      return;
    }

    if (action === "open-home") {
      this.navigateToRoute({ view: "home" });
      return;
    }

    if (action === "open-favorites") {
      this.navigateToRoute({ view: "favorites" });
      return;
    }

    if (action === "open-album") {
      const albumId = actionElement.dataset.albumId;
      if (!albumId) {
        return;
      }
      this.navigateToRoute({ view: "album", albumId });
      return;
    }

    if (action === "open-artist") {
      const artistId = actionElement.dataset.artistId;
      if (!artistId) {
        return;
      }
      this.navigateToRoute({ view: "artist", artistId });
      return;
    }

    if (action === "open-genre") {
      const genre = actionElement.dataset.genre as SongMoodTag | undefined;
      if (!genre) {
        return;
      }
      this.navigateToRoute({ view: "genre", genre });
      return;
    }

    if (action === "play-song") {
      const songId = actionElement.dataset.songId;
      if (!songId) {
        return;
      }
      await this.startSong(songId);
      return;
    }

    if (action === "play-album") {
      const albumId = actionElement.dataset.albumId;
      if (!albumId) {
        return;
      }
      await this.startAlbum(albumId);
      return;
    }

    if (action === "toggle-favorite") {
      const songId = actionElement.dataset.songId;
      if (!songId) {
        return;
      }
      this.libraryState = toggleFavoriteSong(this.libraryState, songId);
      saveLibraryState(this.libraryState);
      this.render();
      return;
    }

    if (action === "back-to-library") {
      this.stopPlayback();
      return;
    }

    if (action === "toggle-preview-autoplay") {
      this.libraryState = togglePreviewAutoplay(this.libraryState);
      saveLibraryState(this.libraryState);
      this.render();
      return;
    }

    if (action === "stop-preview") {
      this.stopPreview();
      return;
    }

    if (action === "preview-song") {
      const songId = actionElement.dataset.songId;
      if (!songId) {
        return;
      }
      await this.startSongPreview(songId);
      return;
    }

    if (action === "replay-song") {
      if (!this.session) {
        return;
      }
      if (this.session.queueMode === "queue") {
        const firstSongId = this.session.playQueueSongIds[0];
        if (!firstSongId) {
          return;
        }
        await this.startSong(firstSongId, this.session.playQueueSongIds, 0);
        return;
      }
      await this.startSong(this.session.songId, this.getExplicitQueueSongIds(this.session), this.session.queueIndex);
      return;
    }

    if (action === "play-next-queued-song") {
      const nextSongId = this.getNextTrackSongId(this.session);
      if (!nextSongId) {
        return;
      }
      const nextSession = this.getNextTrackSession(this.session, nextSongId);
      await this.startSong(nextSongId, this.getExplicitQueueSongIds(nextSession), nextSession.queueIndex);
      return;
    }

    if (action === "play-random-song") {
      const randomSongId = this.getRandomSongId(this.session?.songId);
      if (!randomSongId) {
        return;
      }
      await this.startSong(randomSongId);
    }
  };

  private handlePopState = (event: PopStateEvent): void => {
    void this.restoreFromHistoryState(event.state as AppHistoryState | null);
  };

  private getNormalizedBasePath(): string {
    const base = import.meta.env.BASE_URL ?? "/";
    return base.endsWith("/") ? base.slice(0, -1) : base;
  }

  private parseRouteFromLocation(): LibraryRoute {
    const currentPath = window.location.pathname;
    const relativePath =
      this.appBasePath && currentPath.startsWith(this.appBasePath)
        ? currentPath.slice(this.appBasePath.length) || "/"
        : currentPath;
    const parts = relativePath.split("/").filter(Boolean).map(decodeURIComponent);

    if (parts[0] === "favorites") {
      return { view: "favorites" };
    }
    if (parts[0] === "albums" && parts[1]) {
      return { view: "album", albumId: parts[1] };
    }
    if (parts[0] === "artists" && parts[1]) {
      return { view: "artist", artistId: parts[1] };
    }
    if (parts[0] === "genres" && parts[1]) {
      return { view: "genre", genre: parts[1] as SongMoodTag };
    }

    return { view: "home" };
  }

  private isPlaybackLocation(): boolean {
    const currentPath = window.location.pathname;
    const relativePath =
      this.appBasePath && currentPath.startsWith(this.appBasePath)
        ? currentPath.slice(this.appBasePath.length) || "/"
        : currentPath;
    const parts = relativePath.split("/").filter(Boolean).map(decodeURIComponent);
    return parts[0] === "play" && Boolean(parts[1]);
  }

  private buildUrlForRoute(route: LibraryRoute): string {
    const base = this.appBasePath || "";
    switch (route.view) {
      case "favorites":
        return `${base}/favorites`;
      case "album":
        return `${base}/albums/${encodeURIComponent(route.albumId)}`;
      case "artist":
        return `${base}/artists/${encodeURIComponent(route.artistId)}`;
      case "genre":
        return `${base}/genres/${encodeURIComponent(route.genre)}`;
      case "home":
      default:
        return `${base || ""}/`;
    }
  }

  private buildUrlForPlayback(songId: string): string {
    const base = this.appBasePath || "";
    return `${base}/play/${encodeURIComponent(songId)}`;
  }

  private getHistoryState(playback?: PlaybackHistoryState | null): AppHistoryState {
    return {
      [APP_HISTORY_STATE_KEY]: true,
      route: this.route,
      playback: playback ?? null,
    } as AppHistoryState & Record<string, unknown>;
  }

  private navigateToRoute(route: LibraryRoute, replace = false): void {
    this.route = route;
    this.commitHistoryState(replace);
    this.scrollLibraryToTop();
    this.render();
  }

  private commitHistoryState(replace = false, playback?: PlaybackHistoryState | null): void {
    const state = this.getHistoryState(playback);
    const url = playback ? this.buildUrlForPlayback(playback.songId) : this.buildUrlForRoute(this.route);
    if (replace) {
      window.history.replaceState(state, "", url);
      this.trackPageView(url);
      return;
    }
    window.history.pushState(state, "", url);
    this.trackPageView(url);
  }

  private async restorePlaybackFromLocation(): Promise<void> {
    const parts = window.location.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    const playIndex = parts.indexOf("play");
    if (playIndex < 0 || !parts[playIndex + 1]) {
      return;
    }

    const songId = parts[playIndex + 1];
    const song = getSongById(songId);
    if (!song) {
      this.navigateToRoute({ view: "home" }, true);
      return;
    }

    await this.startSong(songId, undefined, undefined, false);
    this.commitHistoryState(true, { songId, queueIndex: 0 });
  }

  private async restoreFromHistoryState(historyState: AppHistoryState | null): Promise<void> {
    const nextRoute = historyState?.route ?? this.parseRouteFromLocation();
    this.route = nextRoute;

    if (historyState?.playback?.songId) {
      await this.startSong(
        historyState.playback.songId,
        historyState.playback.playQueueSongIds,
        historyState.playback.queueIndex,
        false,
      );
      this.trackPageView(this.buildUrlForPlayback(historyState.playback.songId));
      return;
    }

    this.playbackLaunchToken += 1;
    this.stopPreview();
    this.disposeGame();
    this.session = null;
    this.scrollLibraryToTop();
    this.render();
    this.trackPageView(this.buildUrlForRoute(this.route));
  }

  private trackPageView(url: string): void {
    if (typeof window.gtag !== "function") {
      return;
    }
    const pageLocation = new URL(url, window.location.origin).toString();
    const pagePath = new URL(pageLocation).pathname;
    window.gtag("event", "page_view", {
      page_title: document.title,
      page_location: pageLocation,
      page_path: pagePath,
    });
  }

  private scrollLibraryToTop(): void {
    this.libraryRoot.scrollTo({ top: 0, behavior: "auto" });
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  private scrollPreviewSongIntoView(songId: string): void {
    requestAnimationFrame(() => {
      const target = this.libraryRoot.querySelector<HTMLElement>(`[data-song-row-id="${songId}"]`);
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  private render(): void {
    this.appShell.classList.toggle("playing", Boolean(this.session));
    if (this.session) {
      this.libraryRoot.classList.add("hidden");
      this.renderSessionChrome();
      return;
    }

    this.gameShell.classList.add("hidden");
    this.sessionUiRoot.innerHTML = "";
    this.libraryRoot.classList.remove("hidden");
    this.renderLibraryView();
  }

  private renderLibraryView(): void {
    if (this.route.view === "album") {
      const album = getAlbumById(this.route.albumId);
      if (!album) {
        this.route = { view: "home" };
        this.renderLibraryView();
        return;
      }
      this.libraryRoot.innerHTML = this.renderAlbumView(album);
      return;
    }

    if (this.route.view === "favorites") {
      this.libraryRoot.innerHTML = this.renderFavoritesView();
      return;
    }

    if (this.route.view === "artist") {
      const artist = getArtistById(this.route.artistId);
      if (!artist) {
        this.route = { view: "home" };
        this.renderLibraryView();
        return;
      }
      this.libraryRoot.innerHTML = this.renderArtistView(artist.id);
      return;
    }

    if (this.route.view === "genre") {
      this.libraryRoot.innerHTML = this.renderGenreView(this.route.genre);
      return;
    }

    this.libraryRoot.innerHTML = this.renderHomeView();
  }

  private renderHomeView(): string {
    const recommended = getRecommendedSection(this.libraryState);
    const featuredSong = recommended.featuredSongId ? getSongById(recommended.featuredSongId) : undefined;
    const featuredAlbum = featuredSong ? getAlbumById(featuredSong.albumId) : undefined;
    const featuredArtist = featuredSong ? getArtistById(featuredSong.artistId) : undefined;
    const supportingSongs = recommended.supportingSongIds
      .map((songId) => getSongById(songId))
      .filter((song): song is SongEntry => Boolean(song));
    const albums = getVisibleAlbums();
    const favorites = getFavoriteSongs(this.libraryState);
    const recent = getRecentSongs(this.libraryState);

    return `
      <div class="library-view">
        <header class="library-header">
          <div>
            <p class="library-kicker">Falling Orchestra</p>
            <h1>Get The Balls Falling. Choose a Song.</h1>
          </div>
          ${this.renderLibraryActions()}
        </header>

        ${
          featuredSong && featuredAlbum
            ? `
              <section class="recommended-hero" style="--hero-accent:${featuredAlbum.theme.accent};--hero-panel:${featuredAlbum.theme.panel};">
                <div class="recommended-copy">
                  <span class="section-label">Recommended</span>
                  <h2>${escapeHtml(featuredSong.title)}</h2>
                  <p>
                    <button type="button" class="inline-library-link" data-action="open-album" data-album-id="${featuredAlbum.id}">${escapeHtml(featuredAlbum.title)}</button>
                    ·
                    <button type="button" class="inline-library-link" data-action="open-artist" data-artist-id="${featuredSong.artistId}">${escapeHtml(featuredArtist?.name ?? "Unknown Artist")}</button>
                  </p>
                  <div class="hero-meta">
                    <span>Energy ${featuredSong.energy ?? 3}</span>
                    <span>Difficulty ${featuredSong.difficulty ?? 3}</span>
                  </div>
                  <div class="genre-chip-row">
                    ${featuredSong.moodTags
                      .map(
                        (tag) => `<button type="button" class="library-chip genre-chip" data-action="open-genre" data-genre="${tag}">${escapeHtml(tag)}</button>`,
                      )
                      .join("")}
                  </div>
                  <div class="hero-actions">
                    <button type="button" class="play-button" data-action="play-song" data-song-id="${featuredSong.id}">Play Now</button>
                    <button type="button" class="preview-icon-button hero-preview-button${this.previewSession?.songId === featuredSong.id ? " active" : ""}" data-action="preview-song" data-song-id="${featuredSong.id}" aria-label="Preview ${escapeHtml(featuredSong.title)}">♪</button>
                    <button type="button" class="library-chip" data-action="play-album" data-album-id="${featuredAlbum.id}">Play Album</button>
                    <button type="button" class="library-chip" data-action="open-album" data-album-id="${featuredAlbum.id}">Open Album</button>
                  </div>
                  <div class="recommended-cover recommended-cover-inline">
                    ${
                      featuredAlbum.coverArt
                        ? `<img src="${featuredAlbum.coverArt}" alt="${escapeHtml(featuredAlbum.title)} cover art" />`
                        : `<span>${escapeHtml(featuredAlbum.title.slice(0, 2).toUpperCase())}</span>`
                    }
                  </div>
                </div>
                <div class="recommended-side">
                  <div class="recommended-support">
                    ${supportingSongs
                      .map((song) => this.renderCompactSongCard(song))
                      .join("")}
                  </div>
                </div>
              </section>
            `
            : ""
        }

        ${favorites.length > 0 ? this.renderSongRail("Favorites", favorites, true) : ""}
        ${recent.length > 0 ? this.renderSongRail("Recently Played", recent, false) : ""}

        <section class="album-section">
          <div class="section-head">
            <span class="section-label">Albums</span>
            <h2>Full Releases</h2>
          </div>
          <div class="album-grid">
            ${albums.map((album) => this.renderAlbumCard(album)).join("")}
          </div>
        </section>
      </div>
    `;
  }

  private renderAlbumView(album: Album): string {
    const songs = getAlbumSongs(album.id);
    const artist = getArtistById(album.artistId);

    return `
      <div class="library-view">
        <header class="library-header">
          <div>
            <p class="library-kicker">Album View</p>
            <h1>${escapeHtml(album.title)}</h1>
            <p class="library-subtitle">${escapeHtml(artist?.name ?? "Unknown Artist")}</p>
          </div>
          ${this.renderLibraryActions()}
        </header>

        <section class="album-hero" style="--hero-accent:${album.theme.accent};--hero-panel:${album.theme.panel};">
          <div class="album-cover">
            ${
              album.coverArt
                ? `<img src="${album.coverArt}" alt="${escapeHtml(album.title)} cover art" />`
                : `<span>${escapeHtml(album.title.slice(0, 2).toUpperCase())}</span>`
            }
          </div>
          <div class="album-copy">
            <span class="section-label">Album</span>
            <h2>${escapeHtml(album.title)}</h2>
            <p>${escapeHtml(album.description ?? "")}</p>
            <div class="genre-chip-row">
              <button type="button" class="library-chip" data-action="open-artist" data-artist-id="${album.artistId}">${escapeHtml(artist?.name ?? "Unknown Artist")}</button>
            </div>
            <div class="hero-actions">
              <button type="button" class="play-button" data-action="play-album" data-album-id="${album.id}">Play Album</button>
            </div>
          </div>
        </section>

        <section class="track-section">
          <div class="section-head">
            <span class="section-label">Tracklist</span>
            <h2>${songs.length} Songs</h2>
          </div>
          <div class="track-list">
            ${songs.map((song) => this.renderSongRow(song)).join("")}
          </div>
        </section>
      </div>
    `;
  }

  private renderFavoritesView(): string {
    const favorites = getFavoriteSongs(this.libraryState);

    return `
      <div class="library-view">
        <header class="library-header">
          <div>
            <p class="library-kicker">Collection</p>
            <h1>Favorites</h1>
          </div>
          ${this.renderLibraryActions({ includeFavorites: false })}
        </header>
        <section class="track-section">
          <div class="section-head">
            <span class="section-label">Saved Songs</span>
            <h2>${favorites.length}</h2>
          </div>
          ${
            favorites.length > 0
              ? `<div class="track-list">${favorites.map((song) => this.renderSongRow(song)).join("")}</div>`
              : `<div class="empty-state"><h2>No favorites yet.</h2><p>Mark songs from the home screen or album view and they will show up here.</p></div>`
          }
        </section>
      </div>
    `;
  }

  private renderArtistView(artistId: string): string {
    const artist = getArtistById(artistId);
    if (!artist) {
      return this.renderHomeView();
    }

    const albums = getArtistAlbums(artistId);
    const songs = getArtistSongs(artistId);

    return `
      <div class="library-view">
        <header class="library-header">
          <div>
            <p class="library-kicker">Artist View</p>
            <h1>${escapeHtml(artist.name)}</h1>
            <p class="library-subtitle">${escapeHtml(artist.bio ?? `${albums.length} albums · ${songs.length} songs`)}</p>
          </div>
          ${this.renderLibraryActions()}
        </header>

        <section class="track-section">
          <div class="section-head">
            <span class="section-label">Albums</span>
            <h2>${albums.length}</h2>
          </div>
          <div class="album-grid">
            ${albums.map((album) => this.renderAlbumCard(album)).join("")}
          </div>
        </section>

        <section class="track-section">
          <div class="section-head">
            <span class="section-label">Songs</span>
            <h2>${songs.length}</h2>
          </div>
          <div class="track-list">
            ${songs.map((song) => this.renderSongRow(song)).join("")}
          </div>
        </section>
      </div>
    `;
  }

  private renderGenreView(genre: SongMoodTag): string {
    const songs = getGenreSongs(genre);
    const albums = getGenreAlbums(genre);
    const relatedGenres = getAvailableGenres()
      .filter((entry) => entry !== genre)
      .slice(0, 8);

    return `
      <div class="library-view">
        <header class="library-header">
          <div>
            <p class="library-kicker">Genre View</p>
            <h1>${escapeHtml(genre)}</h1>
            <p class="library-subtitle">${albums.length} albums · ${songs.length} songs</p>
          </div>
          ${this.renderLibraryActions()}
        </header>

        <section class="track-section">
          <div class="section-head">
            <span class="section-label">Explore</span>
            <h2>Related Tags</h2>
          </div>
          <div class="genre-chip-row">
            <button type="button" class="library-chip genre-chip active" data-action="open-genre" data-genre="${genre}">${escapeHtml(genre)}</button>
            ${relatedGenres
              .map(
                (related) => `<button type="button" class="library-chip genre-chip" data-action="open-genre" data-genre="${related}">${escapeHtml(related)}</button>`,
              )
              .join("")}
          </div>
        </section>

        <section class="track-section">
          <div class="section-head">
            <span class="section-label">Albums</span>
            <h2>${albums.length}</h2>
          </div>
          <div class="album-grid">
            ${albums.map((album) => this.renderAlbumCard(album)).join("")}
          </div>
        </section>

        <section class="track-section">
          <div class="section-head">
            <span class="section-label">Songs</span>
            <h2>${songs.length}</h2>
          </div>
          <div class="track-list">
            ${songs.map((song) => this.renderSongRow(song)).join("")}
          </div>
        </section>
      </div>
    `;
  }

  private renderSongRail(title: string, songs: SongEntry[], emphasizeFavorites: boolean): string {
    return `
      <section class="song-rail-section">
        <div class="section-head">
          <span class="section-label">${escapeHtml(title)}</span>
          <h2>${songs.length} Picks</h2>
        </div>
        <div class="song-rail">
          ${songs
            .map((song) => this.renderCompactSongCard(song, emphasizeFavorites))
            .join("")}
        </div>
      </section>
    `;
  }

  private renderAlbumArtistLinks(albumId: string | undefined, artistId: string | undefined): string {
    const album = albumId ? getAlbumById(albumId) : undefined;
    const artist = artistId ? getArtistById(artistId) : undefined;
    if (!album && !artist) {
      return "";
    }

    return `
      <span class="album-artist-links">
        ${album
          ? `<button type="button" class="inline-library-link" data-action="open-album" data-album-id="${album.id}">${escapeHtml(album.title)}</button>`
          : ""}
        ${album && artist ? `<span class="album-artist-separator">·</span>` : ""}
        ${artist
          ? `<button type="button" class="inline-library-link" data-action="open-artist" data-artist-id="${artist.id}">${escapeHtml(artist.name)}</button>`
          : ""}
      </span>
    `;
  }

  private renderCompactSongCard(song: SongEntry, emphasizeFavorite = false): string {
    const album = getAlbumById(song.albumId);
    const artist = getArtistById(song.artistId);
    const favorite = this.libraryState.favoritesSongIds.includes(song.id);
    const previewing = this.previewSession?.songId === song.id;

    return `
      <article class="compact-song-card${previewing ? " previewing" : ""}">
        <div class="compact-song-top">
          ${album ? this.renderSongArt(album, "compact-song-art") : ""}
          <div class="compact-song-controls">
            <button type="button" class="preview-icon-button${previewing ? " active" : ""}" data-action="preview-song" data-song-id="${song.id}" aria-label="Preview ${escapeHtml(song.title)}">♪</button>
            <button type="button" class="card-favorite${favorite ? " active" : ""}" data-action="toggle-favorite" data-song-id="${song.id}">
              ${favorite ? "★" : "☆"}
            </button>
          </div>
        </div>
        <div class="compact-song-copy">
          <span class="compact-track-no">${String(song.trackNumber).padStart(2, "0")}</span>
          <h3>${escapeHtml(song.title)}</h3>
          <div class="compact-song-library-lines">
            ${
              album
                ? `<button type="button" class="compact-library-link" data-action="open-album" data-album-id="${album.id}">${escapeHtml(album.title)}</button>`
                : ""
            }
            ${
              artist
                ? `<button type="button" class="compact-library-link" data-action="open-artist" data-artist-id="${artist.id}">${escapeHtml(artist.name)}</button>`
                : ""
            }
          </div>
          <div class="compact-meta">
            <span>${song.energy ?? 3}/5 energy</span>
            ${emphasizeFavorite ? "<span>saved</span>" : ""}
          </div>
        </div>
        <button type="button" class="play-link" data-action="play-song" data-song-id="${song.id}">Play</button>
      </article>
    `;
  }

  private renderAlbumCard(album: Album): string {
    const songs = getAlbumSongs(album.id);
    const artist = getArtistById(album.artistId);

    return `
      <article class="album-card" style="--card-accent:${album.theme.accent};--card-panel:${album.theme.panel};">
        <button type="button" class="album-card-cover-hit" data-action="open-album" data-album-id="${album.id}">
          <div class="album-card-cover">
            ${
              album.coverArt
                ? `<img src="${album.coverArt}" alt="${escapeHtml(album.title)} cover art" />`
                : `<span>${escapeHtml(album.title.slice(0, 2).toUpperCase())}</span>`
            }
          </div>
        </button>
        <div class="album-card-copy">
          <p class="album-card-kicker">${songs.length} tracks</p>
          <h3>
            <button type="button" class="inline-library-link album-title-link" data-action="open-album" data-album-id="${album.id}">
              ${escapeHtml(album.title)}
            </button>
          </h3>
          <p>${this.renderAlbumArtistLinks(album.id, artist?.id)}</p>
          <p>${escapeHtml(album.description ?? "")}</p>
          <div class="hero-actions">
            <button type="button" class="library-chip" data-action="open-album" data-album-id="${album.id}">Open Album</button>
            <button type="button" class="library-chip" data-action="play-album" data-album-id="${album.id}">Play Album</button>
          </div>
        </div>
      </article>
    `;
  }

  private renderSongRow(song: SongEntry): string {
    const album = getAlbumById(song.albumId);
    const favorite = this.libraryState.favoritesSongIds.includes(song.id);
    const previewing = this.previewSession?.songId === song.id;

    return `
      <article class="song-row${previewing ? " previewing" : ""}" data-song-row-id="${song.id}">
        <div class="song-row-meta">
          ${album ? this.renderSongArt(album, "song-row-art") : ""}
          <span class="song-row-index">${String(song.trackNumber).padStart(2, "0")}</span>
          <div>
            <h3>${escapeHtml(song.title)}</h3>
            <p>${this.renderAlbumArtistLinks(song.albumId, song.artistId)}</p>
            <div class="genre-chip-row">
              ${song.moodTags
                .map(
                  (tag) => `<button type="button" class="library-chip genre-chip" data-action="open-genre" data-genre="${tag}">${escapeHtml(tag)}</button>`,
                )
                .join("")}
            </div>
          </div>
        </div>
        <div class="song-row-actions">
          <button type="button" class="preview-icon-button${previewing ? " active" : ""}" data-action="preview-song" data-song-id="${song.id}" aria-label="Preview ${escapeHtml(song.title)}">♪</button>
          <button type="button" class="card-favorite${favorite ? " active" : ""}" data-action="toggle-favorite" data-song-id="${song.id}">
            ${favorite ? "★" : "☆"}
          </button>
          <button type="button" class="play-link" data-action="play-song" data-song-id="${song.id}">Play</button>
        </div>
      </article>
    `;
  }

  private renderSessionChrome(): void {
    const song = this.session ? getSongById(this.session.songId) : undefined;
    const album = song ? getAlbumById(song.albumId) : undefined;
    const favorite = song ? this.libraryState.favoritesSongIds.includes(song.id) : false;
    const queueLabel = this.session ? this.getQueueLabel(this.session) : null;
    const cueingOverlay = this.session && song ? this.getCueingOverlay(this.session, song) : null;
    const endScreenOverlay = this.session && song ? this.getEndScreenDisplay(this.session, song) : null;
    const sessionChromeClass = `session-chrome${cueingOverlay ? " cueing" : ""}${endScreenOverlay ? " completed" : ""}`;

    this.libraryRoot.classList.add("hidden");
    this.gameShell.classList.remove("hidden");
    this.sessionUiRoot.innerHTML = `
      <div class="${sessionChromeClass}">
        ${
          cueingOverlay
            ? `
              <div class="session-blackout" aria-hidden="true"></div>
            `
            : ""
        }
        <div class="session-chip-group">
          <button type="button" class="library-chip" data-action="back-to-library">Library</button>
          ${
            song
              ? `<button type="button" class="library-chip${favorite ? " active" : ""}" data-action="toggle-favorite" data-song-id="${song.id}">
                  ${favorite ? "Favorited" : "Favorite"}
                </button>`
              : ""
          }
        </div>
        ${
          song && album
            ? `
              <div class="session-now-playing">
                ${this.renderSongArt(album, "session-song-art")}
                <div class="session-now-playing-copy">
                  <span class="section-label">Now Playing</span>
                  <h2>${escapeHtml(song.title)}</h2>
                  <p>${escapeHtml(album.title)}${queueLabel ? ` · ${queueLabel}` : ""}</p>
                </div>
              </div>
            `
            : ""
        }
        ${
          cueingOverlay
            ? `
              <div class="track-transition-overlay" style="--transition-accent:${cueingOverlay.accent};">
                <span class="section-label">${escapeHtml(cueingOverlay.kicker)}</span>
                <h2>${escapeHtml(cueingOverlay.title)}</h2>
                <p>${escapeHtml(cueingOverlay.subtitle)}</p>
              </div>
            `
            : ""
        }
        ${endScreenOverlay ? this.renderEndScreenOverlay(endScreenOverlay, song) : ""}
      </div>
    `;
  }

  private async startAlbum(albumId: string): Promise<void> {
    const songs = getAlbumSongs(albumId);
    if (songs.length === 0) {
      return;
    }

    await this.startSong(songs[0].id, songs.map((song) => song.id), 0, true, null, "queue");
  }

  private async startSong(
    songId: string,
    playQueueSongIds?: string[],
    queueIndex?: number,
    updateHistory = true,
    existingSession?: PlayingSession | null,
    launchMode?: PlaybackLaunchMode,
  ): Promise<void> {
    const song = getSongById(songId);
    if (!song) {
      return;
    }

    const launchToken = ++this.playbackLaunchToken;
    this.disposeGame();
    this.stopPreview();
    this.libraryState = registerRecentPlayback(this.libraryState, song.id, song.albumId);
    saveLibraryState(this.libraryState);
    const album = getAlbumById(song.albumId);
    const normalizedLaunchMode = launchMode ?? (playQueueSongIds && playQueueSongIds.length > 0 ? "queue" : "single");
    const normalizedQueueSongIds = this.resolveQueueSongIds(
      songId,
      normalizedLaunchMode,
      playQueueSongIds,
      existingSession,
    );
    this.session = this.createPlaybackSession(
      songId,
      normalizedQueueSongIds,
      queueIndex,
      existingSession,
      normalizedLaunchMode,
    );
    if (updateHistory) {
      this.commitHistoryState(false, {
        songId,
        playQueueSongIds: this.getExplicitQueueSongIds(this.session),
        queueIndex: this.session.queueIndex,
      });
    }
    this.renderSessionChrome();

    const [songConfig, gameAppModule] = await Promise.all([
      this.getOrLoadSongConfig(song.id),
      this.getGameAppModule(),
    ]);
    if (launchToken !== this.playbackLaunchToken || this.session?.songId !== songId) {
      return;
    }
    const { GameApp } = gameAppModule;

    this.game = new GameApp(this.canvas, this.gameUiRoot, {
      songConfig,
      backdropPresetId: song.backdropPreset ?? album?.theme.backdropPreset,
      backdropParams: {
        ...(album?.theme.backdropParams ?? {}),
        ...(song.backdropParams ?? {}),
      },
      onSongCompleted: (stats) => {
        this.handleSongCompleted(stats);
      },
    });
    await this.game.beginFromSelection();
    if (launchToken !== this.playbackLaunchToken || this.session?.songId !== songId) {
      this.game?.dispose();
      this.game = undefined;
      return;
    }
    this.game.start();
    this.setSessionPhase("playing");
    this.preloadNextQueuedSongConfig(this.session);
    if (DEV_BOOT_TO_END_SCREEN) {
      this.handleSongCompleted({ specialCatches: 0, longestSolo: 0 });
    }
    this.renderSessionChrome();
  }

  private handleSongCompleted(stats: GameCompletionStats): void {
    if (!this.session) {
      return;
    }

    const runStats = this.mergeRunStats(this.session.runStats, stats);
    const nextQueuedSongId = this.getNextQueuedSongId(this.session);
    if (this.isQueuedSession(this.session) && nextQueuedSongId) {
      const nextSession = this.getNextTrackSession(this.session, nextQueuedSongId, runStats);
      void this.startSong(
        nextQueuedSongId,
        this.getExplicitQueueSongIds(nextSession),
        nextSession.queueIndex,
        true,
        nextSession,
        "queue",
      );
      return;
    }

    this.setSessionPhase("completed", runStats);
    this.game?.setPaused(true);
    this.renderSessionChrome();
  }

  private stopPlayback(): void {
    this.playbackLaunchToken += 1;
    this.disposeGame();
    this.session = null;
    this.commitHistoryState();
    this.render();
  }

  private async startSongPreview(songId: string): Promise<void> {
    const song = getSongById(songId);
    if (!song) {
      return;
    }

    const albumSongs = getAlbumSongs(song.albumId);
    const queueIndex = albumSongs.findIndex((entry) => entry.id === songId);
    if (queueIndex < 0) {
      return;
    }

    if (this.previewSession?.songId === songId && this.previewPlayer.isActive()) {
      this.stopPreview();
      return;
    }

    this.previewPlayer.stop();
    this.disposeGame();
    this.session = null;
    this.route = { view: "album", albumId: song.albumId };
    this.commitHistoryState();
    this.previewSession = {
      songId,
      playQueueSongIds: albumSongs.map((entry) => entry.id),
      queueIndex,
      state: "loading",
    };
    this.render();
    this.scrollPreviewSongIntoView(songId);

    const songConfig = await this.getOrLoadSongConfig(songId);
    if (this.previewSession?.songId !== songId) {
      return;
    }

    this.previewSession = {
      songId,
      playQueueSongIds: this.previewSession.playQueueSongIds,
      queueIndex,
      state: "playing",
    };
    this.render();

    await this.previewPlayer.playSong(songConfig, {
      onEnded: () => {
        void this.handlePreviewEnded(songId);
      },
    });
  }

  private async handlePreviewEnded(songId: string): Promise<void> {
    if (!this.previewSession || this.previewSession.songId !== songId) {
      return;
    }

    if (!this.libraryState.previewAutoplay) {
      this.stopPreview();
      return;
    }

    const nextSongId = this.previewSession.playQueueSongIds[this.previewSession.queueIndex + 1];
    if (!nextSongId) {
      this.stopPreview();
      return;
    }

    await this.startSongPreview(nextSongId);
  }

  private stopPreview(): void {
    this.previewPlayer.stop();
    this.previewSession = null;
    if (!this.session) {
      this.render();
    }
  }

  private disposeGame(): void {
    this.game?.dispose();
    this.game = undefined;
    this.gameShell.classList.add("hidden");
    this.gameUiRoot.innerHTML = "";
    this.sessionUiRoot.innerHTML = "";
  }

  private getGameAppModule(): Promise<typeof import("./game/GameApp")> {
    if (!this.gameAppModulePromise) {
      this.gameAppModulePromise = import("./game/GameApp");
    }
    return this.gameAppModulePromise;
  }

  private getOrLoadSongConfig(songId: string): Promise<SongConfig> {
    const existing = this.songConfigPromises.get(songId);
    if (existing) {
      return existing;
    }

    const song = getSongById(songId);
    if (!song) {
      return Promise.reject(new Error(`Song not found: ${songId}`));
    }

    const loadPromise = song.loadConfig();
    this.songConfigPromises.set(songId, loadPromise);
    return loadPromise;
  }

  private async preloadSongById(songId: string): Promise<void> {
    try {
      await this.getOrLoadSongConfig(songId);
    } catch (error) {
      console.warn("Failed to preload song config", songId, error);
    }
  }

  private preloadNextQueuedSongConfig(session: PlayingSession | null): void {
    if (!this.isQueuedSession(session)) {
      return;
    }

    const nextSongId = session.playQueueSongIds[session.queueIndex + 1];
    if (!nextSongId) {
      return;
    }

    void this.preloadSongById(nextSongId);
  }

  private renderLibraryActions(options: { includeFavorites?: boolean } = {}): string {
    const includeFavorites = options.includeFavorites ?? true;
    const previewAutoplayLabel = this.libraryState.previewAutoplay ? "Preview Auto On" : "Preview Auto Off";
    const previewStatusLabel =
      this.previewSession?.state === "loading"
        ? "Cueing Preview"
        : this.previewSession?.state === "playing"
          ? "Preview Playing"
          : null;

    return `
      <div class="library-actions">
        <button type="button" class="library-chip" data-action="open-home">Home</button>
        ${includeFavorites ? `<button type="button" class="library-chip" data-action="open-favorites">Favorites</button>` : ""}
        <button type="button" class="library-chip${this.libraryState.previewAutoplay ? " active" : ""}" data-action="toggle-preview-autoplay">${previewAutoplayLabel}</button>
        ${previewStatusLabel ? `<span class="library-chip status">${previewStatusLabel}</span>` : ""}
        ${
          this.previewSession
            ? `<button type="button" class="library-chip active" data-action="stop-preview">Stop Preview</button>`
            : ""
        }
      </div>
    `;
  }

  private renderEndScreenOverlay(overlay: EndScreenDisplay, song: SongEntry | undefined): string {
    const album = song ? getAlbumById(song.albumId) : undefined;
    const nextSongId = this.getNextTrackSongId(this.session);
    const coverStyle = album?.coverArt
      ? `--end-cover-image:url('${album.coverArt.replace(/'/g, "\\'")}');`
      : "";

    return `
      <div class="end-screen-overlay" style="--end-accent:${overlay.accent};${coverStyle}">
        <div class="end-screen-backdrop"></div>
        <div class="end-screen-panel">
          <span class="section-label">${escapeHtml(overlay.kicker)}</span>
          <div class="end-screen-topline">
            <div class="end-screen-copy">
              <h2>${escapeHtml(overlay.title)}</h2>
              <p>${escapeHtml(overlay.subtitle)}</p>
              <p class="end-screen-praise">${escapeHtml(overlay.praise)}</p>
            </div>
          </div>
          <div class="end-screen-stats">
            ${overlay.stats
              .map(
                (stat) => `
                  <div class="end-screen-stat">
                    <span>${escapeHtml(stat.label)}</span>
                    <strong>${escapeHtml(stat.value)}</strong>
                  </div>
                `,
              )
              .join("")}
          </div>
          <div class="end-screen-actions">
            <button type="button" class="end-screen-action" data-action="replay-song">Replay</button>
            ${nextSongId ? `<button type="button" class="end-screen-action" data-action="play-next-queued-song">Next Track</button>` : ""}
            <button type="button" class="end-screen-action" data-action="play-random-song">Random</button>
            <button type="button" class="end-screen-action" data-action="back-to-library">Back To Library</button>
          </div>
        </div>
      </div>
    `;
  }

  private getNextQueuedSongId(session: PlayingSession | null): string | null {
    if (!this.isQueuedSession(session)) {
      return null;
    }

    return session.playQueueSongIds[session.queueIndex + 1] ?? null;
  }

  private getNextTrackSongId(session: PlayingSession | null): string | null {
    if (!session) {
      return null;
    }
    const activeSession = session;

    const queuedSongId = this.getNextQueuedSongId(activeSession);
    if (queuedSongId) {
      return queuedSongId;
    }

    if (activeSession.queueMode === "queue" || activeSession.playQueueSongIds.length > 1) {
      return null;
    }

    const currentSong = getSongById(activeSession.songId);
    if (!currentSong) {
      return null;
    }

    const albumSongs = getAlbumSongs(currentSong.albumId);
    if (albumSongs.length === 0) {
      return null;
    }

    const currentIndex = albumSongs.findIndex((song) => song.id === currentSong.id);
    if (currentIndex < 0) {
      return albumSongs[0]?.id ?? null;
    }

    return albumSongs[(currentIndex + 1) % albumSongs.length]?.id ?? null;
  }

  private getNextTrackSession(
    session: PlayingSession | null,
    nextSongId: string,
    runStats?: GameCompletionStats,
  ): PlayingSession {
    if (this.isQueuedSession(session)) {
      const nextQueueIndex = session.playQueueSongIds.indexOf(nextSongId);
      return {
        songId: nextSongId,
        playQueueSongIds: session.playQueueSongIds,
        queueMode: "queue",
        queueIndex: nextQueueIndex >= 0 ? nextQueueIndex : session.queueIndex + 1,
        phase: "cueing",
        completionStats: null,
        runStats: runStats ?? session.runStats,
      };
    }

    const nextSong = getSongById(nextSongId);
    const albumSongs = nextSong ? getAlbumSongs(nextSong.albumId) : [];
    const nextQueueIndex = albumSongs.findIndex((song) => song.id === nextSongId);
    return {
      songId: nextSongId,
      playQueueSongIds: albumSongs.map((song) => song.id),
      queueMode: "queue",
      queueIndex: nextQueueIndex >= 0 ? nextQueueIndex : 0,
      phase: "cueing",
      completionStats: null,
      runStats: runStats ?? { specialCatches: 0, longestSolo: 0 },
    };
  }

  private getRandomSongId(excludeSongId?: string): string | null {
    const candidates = getVisibleSongs().filter((song) => song.availability === "included" && song.id !== excludeSongId);
    if (candidates.length === 0) {
      return null;
    }

    return candidates[Math.floor(Math.random() * candidates.length)]?.id ?? null;
  }

  private renderSongArt(album: Album, className: string): string {
    const initials = escapeHtml(album.title.slice(0, 2).toUpperCase());
    return `
      <div class="${className}" style="--art-accent:${album.theme.accent};">
        ${
          album.coverArt
            ? `<img src="${album.coverArt}" alt="${escapeHtml(album.title)} cover art" />`
            : `<span>${initials}</span>`
        }
      </div>
    `;
  }

  private createPlaybackSession(
    songId: string,
    playQueueSongIds?: string[],
    queueIndex?: number,
    existingSession?: PlayingSession | null,
    launchMode: PlaybackLaunchMode = playQueueSongIds && playQueueSongIds.length > 0 ? "queue" : "single",
  ): PlayingSession {
    if (launchMode === "queue") {
      const resolvedQueueSongIds = this.resolveQueueSongIds(songId, "queue", playQueueSongIds, existingSession) ?? [songId];
      const normalizedQueueIndex = clamp(queueIndex ?? resolvedQueueSongIds.indexOf(songId), 0, resolvedQueueSongIds.length - 1);
      return {
        songId,
        playQueueSongIds: resolvedQueueSongIds,
        queueIndex: normalizedQueueIndex,
        queueMode: "queue",
        phase: "cueing",
        completionStats: null,
        runStats: existingSession?.runStats ?? { specialCatches: 0, longestSolo: 0 },
      };
    }

    if (playQueueSongIds && playQueueSongIds.length > 0) {
      const normalizedQueueIndex = clamp(queueIndex ?? playQueueSongIds.indexOf(songId), 0, playQueueSongIds.length - 1);
      return {
        songId,
        playQueueSongIds,
        queueIndex: normalizedQueueIndex,
        queueMode: "queue",
        phase: "cueing",
        completionStats: null,
        runStats: existingSession?.runStats ?? { specialCatches: 0, longestSolo: 0 },
      };
    }

    return {
      songId,
      playQueueSongIds: [songId],
      queueIndex: 0,
      queueMode: "single",
      phase: "cueing",
      completionStats: null,
      runStats: existingSession?.runStats ?? { specialCatches: 0, longestSolo: 0 },
    };
  }

  private resolveQueueSongIds(
    songId: string,
    launchMode: PlaybackLaunchMode,
    playQueueSongIds?: string[],
    existingSession?: PlayingSession | null,
  ): string[] | undefined {
    if (launchMode !== "queue") {
      return playQueueSongIds && playQueueSongIds.length > 0 ? playQueueSongIds : undefined;
    }

    if (playQueueSongIds && playQueueSongIds.length > 0) {
      return playQueueSongIds;
    }

    const queuedExistingSession = existingSession ?? null;
    if (this.isQueuedSession(queuedExistingSession) && queuedExistingSession.playQueueSongIds.length > 0) {
      return queuedExistingSession.playQueueSongIds;
    }

    const song = getSongById(songId);
    if (!song) {
      return [songId];
    }

    const albumQueue = getAlbumSongs(song.albumId).map((entry) => entry.id);
    return albumQueue.length > 0 ? albumQueue : [songId];
  }

  private setSessionPhase(phase: PlayingSession["phase"], completionStats: GameCompletionStats | null = null): void {
    if (!this.session) {
      return;
    }

    this.session = {
      ...this.session,
      phase,
      completionStats,
      runStats: completionStats ?? this.session.runStats,
    };
  }

  private mergeRunStats(existing: GameCompletionStats, songStats: GameCompletionStats): GameCompletionStats {
    return {
      specialCatches: existing.specialCatches + songStats.specialCatches,
      longestSolo: Math.max(existing.longestSolo, songStats.longestSolo),
    };
  }

  private getQueueLabel(session: PlayingSession): string | null {
    if (!this.isQueuedSession(session)) {
      return null;
    }

    return `${session.queueIndex + 1} / ${session.playQueueSongIds.length}`;
  }

  private getExplicitQueueSongIds(session: PlayingSession): string[] | undefined {
    return this.isQueuedSession(session) ? session.playQueueSongIds : undefined;
  }

  private getCueingOverlay(
    session: PlayingSession,
    song: SongEntry,
  ): { kicker: string; title: string; subtitle: string; accent: string } | null {
    if (session.phase !== "cueing") {
      return null;
    }

    const album = getAlbumById(song.albumId);
    return {
      kicker: "Cueing Track",
      title: song.title,
      subtitle: album?.title ?? "",
      accent: album?.theme.accent ?? "#7ee9ef",
    };
  }

  private getEndScreenDisplay(session: PlayingSession, song: SongEntry): EndScreenDisplay | null {
    if (session.phase !== "completed") {
      return null;
    }

    const album = getAlbumById(song.albumId);
    const artist = album ? getArtistById(album.artistId) : undefined;
    const nextSongId = this.getNextTrackSongId(session);
    const queuedSession = this.isQueuedSession(session);
    const queueValue = queuedSession ? `${session.queueIndex + 1}/${session.playQueueSongIds.length}` : "Single";
    const runCompleted = queuedSession;
    return {
      kicker: runCompleted ? "Run Complete" : nextSongId ? "Transmission Complete" : "Set Complete",
      title: song.title,
      subtitle: [album?.title, artist?.name].filter(Boolean).join(" · "),
      praise: runCompleted
        ? "Locked in. Full run complete."
        : nextSongId
          ? "Locked in. Ready for the next one."
          : "Locked in. Step back or run it again.",
      accent: album?.theme.accent ?? "#7ee9ef",
      stats: [
        { label: "Special Catches", value: `${session.completionStats?.specialCatches ?? 0}` },
        { label: "Longest Solo", value: `${session.completionStats?.longestSolo ?? 0} catches` },
        { label: "Queue Position", value: queueValue },
      ],
    };
  }

  private isQueuedSession(session: PlayingSession | null): session is PlayingSession {
    return Boolean(session && (session.queueMode === "queue" || session.playQueueSongIds.length > 1));
  }
}
