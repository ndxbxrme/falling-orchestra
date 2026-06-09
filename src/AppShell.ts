import {
  getAlbumById,
  getAlbumSongs,
  getArtistById,
  getFavoriteSongs,
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
import type { Album, LibraryRoute, LibraryState, SongEntry } from "./content/types";

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

interface PlayingSession {
  songId: string;
  playQueueSongIds?: string[];
  queueIndex?: number;
}

interface TrackTransitionOverlay {
  kicker: string;
  title: string;
  subtitle: string;
  accent: string;
}

interface EndScreenOverlay {
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
  private pendingAdvanceTimeout?: number;
  private trackTransitionOverlay: TrackTransitionOverlay | null = null;
  private endScreenOverlay: EndScreenOverlay | null = null;
  private lastCompletionStats: GameCompletionStats | null = null;
  private gameAppModulePromise?: Promise<typeof import("./game/GameApp")>;
  private songConfigPromises = new Map<string, Promise<SongConfig>>();
  private previewPlayer = new SongPreviewPlayer();
  private previewSession: PreviewSession | null = null;

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

    this.libraryRoot.addEventListener("click", this.handleLibraryClick);
    this.sessionUiRoot.addEventListener("click", this.handleLibraryClick);
    this.render();
  }

  dispose(): void {
    this.clearPendingAdvance();
    this.libraryRoot.removeEventListener("click", this.handleLibraryClick);
    this.sessionUiRoot.removeEventListener("click", this.handleLibraryClick);
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
      this.route = { view: "home" };
      this.render();
      return;
    }

    if (action === "open-favorites") {
      this.route = { view: "favorites" };
      this.render();
      return;
    }

    if (action === "open-album") {
      const albumId = actionElement.dataset.albumId;
      if (!albumId) {
        return;
      }
      this.route = { view: "album", albumId };
      this.render();
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
      await this.startSong(this.session.songId, this.session.playQueueSongIds, this.session.queueIndex);
      return;
    }

    if (action === "play-next-queued-song") {
      const nextSongId = this.getNextTrackSongId(this.session);
      if (!nextSongId) {
        return;
      }
      const nextSession = this.getNextTrackSession(this.session, nextSongId);
      await this.startSong(nextSongId, nextSession.playQueueSongIds, nextSession.queueIndex);
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
                  <p>${escapeHtml(featuredAlbum.title)} · ${escapeHtml(featuredArtist?.name ?? "Unknown Artist")}</p>
                  <div class="hero-meta">
                    <span>Energy ${featuredSong.energy ?? 3}</span>
                    <span>Difficulty ${featuredSong.difficulty ?? 3}</span>
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

  private renderCompactSongCard(song: SongEntry, emphasizeFavorite = false): string {
    const album = getAlbumById(song.albumId);
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
          <p>${escapeHtml(album?.title ?? "")}</p>
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

    return `
      <article class="album-card" style="--card-accent:${album.theme.accent};--card-panel:${album.theme.panel};">
        <button type="button" class="album-card-hit" data-action="open-album" data-album-id="${album.id}">
          <div class="album-card-cover">
            ${
              album.coverArt
                ? `<img src="${album.coverArt}" alt="${escapeHtml(album.title)} cover art" />`
                : `<span>${escapeHtml(album.title.slice(0, 2).toUpperCase())}</span>`
            }
          </div>
          <div class="album-card-copy">
            <p class="album-card-kicker">${songs.length} tracks</p>
            <h3>${escapeHtml(album.title)}</h3>
            <p>${escapeHtml(album.description ?? "")}</p>
          </div>
        </button>
      </article>
    `;
  }

  private renderSongRow(song: SongEntry): string {
    const album = getAlbumById(song.albumId);
    const favorite = this.libraryState.favoritesSongIds.includes(song.id);
    const previewing = this.previewSession?.songId === song.id;

    return `
      <article class="song-row${previewing ? " previewing" : ""}">
        <div class="song-row-meta">
          ${album ? this.renderSongArt(album, "song-row-art") : ""}
          <span class="song-row-index">${String(song.trackNumber).padStart(2, "0")}</span>
          <div>
            <h3>${escapeHtml(song.title)}</h3>
            <p>${song.moodTags.map((tag) => escapeHtml(tag)).join(" · ")}</p>
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
    const queueLabel =
      this.session?.playQueueSongIds && this.session.queueIndex !== undefined
        ? `${this.session.queueIndex + 1} / ${this.session.playQueueSongIds.length}`
        : null;

    this.libraryRoot.classList.add("hidden");
    this.gameShell.classList.remove("hidden");
    this.sessionUiRoot.innerHTML = `
      <div class="session-chrome">
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
          this.trackTransitionOverlay
            ? `
              <div class="track-transition-overlay" style="--transition-accent:${this.trackTransitionOverlay.accent};">
                <span class="section-label">${escapeHtml(this.trackTransitionOverlay.kicker)}</span>
                <h2>${escapeHtml(this.trackTransitionOverlay.title)}</h2>
                <p>${escapeHtml(this.trackTransitionOverlay.subtitle)}</p>
              </div>
            `
            : ""
        }
        ${this.endScreenOverlay ? this.renderEndScreenOverlay(song) : ""}
      </div>
    `;
  }

  private async startAlbum(albumId: string): Promise<void> {
    const songs = getAlbumSongs(albumId);
    if (songs.length === 0) {
      return;
    }

    await this.startSong(songs[0].id, songs.map((song) => song.id), 0);
  }

  private async startSong(songId: string, playQueueSongIds?: string[], queueIndex?: number): Promise<void> {
    const song = getSongById(songId);
    if (!song) {
      return;
    }

    this.clearPendingAdvance();
    this.disposeGame();
    this.stopPreview();
    this.libraryState = registerRecentPlayback(this.libraryState, song.id, song.albumId);
    saveLibraryState(this.libraryState);
    this.endScreenOverlay = null;
    this.lastCompletionStats = null;
    this.trackTransitionOverlay = {
      kicker: "Cueing Track",
      title: song.title,
      subtitle: getAlbumById(song.albumId)?.title ?? "",
      accent: getAlbumById(song.albumId)?.theme.accent ?? "#7ee9ef",
    };
    const album = getAlbumById(song.albumId);
    this.session = { songId, playQueueSongIds, queueIndex };
    this.renderSessionChrome();

    const [songConfig, gameAppModule] = await Promise.all([
      this.getOrLoadSongConfig(song.id),
      this.getGameAppModule(),
    ]);
    const { GameApp } = gameAppModule;

    this.game = new GameApp(this.canvas, this.gameUiRoot, {
      songConfig,
      backdropPresetId: album?.theme.backdropPreset,
      backdropParams: album?.theme.backdropParams,
      onSongCompleted: (stats) => {
        this.handleSongCompleted(stats);
      },
    });
    await this.game.beginFromSelection();
    this.game.start();
    this.trackTransitionOverlay = null;
    this.preloadNextQueuedSongConfig(this.session);
    if (DEV_BOOT_TO_END_SCREEN) {
      this.showEndScreenOverlay();
    }
    this.renderSessionChrome();
  }

  private handleSongCompleted(stats: GameCompletionStats): void {
    this.lastCompletionStats = stats;
    this.showEndScreenOverlay();
  }

  private stopPlayback(): void {
    this.clearPendingAdvance();
    this.disposeGame();
    this.trackTransitionOverlay = null;
    this.endScreenOverlay = null;
    this.session = null;
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
    this.trackTransitionOverlay = null;
    this.endScreenOverlay = null;
    this.route = { view: "album", albumId: song.albumId };
    this.previewSession = {
      songId,
      playQueueSongIds: albumSongs.map((entry) => entry.id),
      queueIndex,
      state: "loading",
    };
    this.render();

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

  private clearPendingAdvance(): void {
    if (this.pendingAdvanceTimeout !== undefined) {
      window.clearTimeout(this.pendingAdvanceTimeout);
      this.pendingAdvanceTimeout = undefined;
    }
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
    if (!session?.playQueueSongIds || session.queueIndex === undefined) {
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

  private showEndScreenOverlay(): void {
    const session = this.session;
    if (!session) {
      return;
    }

    const song = getSongById(session.songId);
    const album = song ? getAlbumById(song.albumId) : undefined;
    const artist = album ? getArtistById(album.artistId) : undefined;
    const nextSongId = this.getNextTrackSongId(session);
    const queueLabel =
      session.playQueueSongIds && session.queueIndex !== undefined
        ? `${session.queueIndex + 1}/${session.playQueueSongIds.length}`
        : "Single";

    this.game?.setPaused(true);
    this.trackTransitionOverlay = null;
    this.endScreenOverlay = {
      kicker: nextSongId ? "Transmission Complete" : "Set Complete",
      title: song?.title ?? "Track Complete",
      subtitle: [album?.title, artist?.name].filter(Boolean).join(" · "),
      praise: nextSongId ? "Locked in. Ready for the next one." : "Locked in. Step back or run it again.",
      accent: album?.theme.accent ?? "#7ee9ef",
      stats: [
        { label: "Special Catches", value: `${this.lastCompletionStats?.specialCatches ?? 0}` },
        { label: "Longest Solo", value: `${this.lastCompletionStats?.longestSolo ?? 0} catches` },
        { label: "Queue Position", value: queueLabel },
      ],
    };
    this.renderSessionChrome();
  }

  private renderEndScreenOverlay(song: SongEntry | undefined): string {
    const album = song ? getAlbumById(song.albumId) : undefined;
    const nextSongId = this.getNextTrackSongId(this.session);
    const overlay = this.endScreenOverlay;
    if (!overlay) {
      return "";
    }
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
    if (!session?.playQueueSongIds || session.queueIndex === undefined) {
      return null;
    }

    return session.playQueueSongIds[session.queueIndex + 1] ?? null;
  }

  private getNextTrackSongId(session: PlayingSession | null): string | null {
    if (!session) {
      return null;
    }

    const queuedSongId = this.getNextQueuedSongId(session);
    if (queuedSongId) {
      return queuedSongId;
    }

    const currentSong = getSongById(session.songId);
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

  private getNextTrackSession(session: PlayingSession | null, nextSongId: string): PlayingSession {
    if (session?.playQueueSongIds && session.queueIndex !== undefined) {
      const nextQueueIndex = session.playQueueSongIds.indexOf(nextSongId);
      return {
        songId: nextSongId,
        playQueueSongIds: session.playQueueSongIds,
        queueIndex: nextQueueIndex >= 0 ? nextQueueIndex : session.queueIndex + 1,
      };
    }

    const nextSong = getSongById(nextSongId);
    const albumSongs = nextSong ? getAlbumSongs(nextSong.albumId) : [];
    const nextQueueIndex = albumSongs.findIndex((song) => song.id === nextSongId);
    return {
      songId: nextSongId,
      playQueueSongIds: albumSongs.map((song) => song.id),
      queueIndex: nextQueueIndex >= 0 ? nextQueueIndex : 0,
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
}
