import { GameApp } from "./game/GameApp";
import {
  getAlbumById,
  getAlbumSongs,
  getArtistById,
  getFavoriteSongs,
  getRecentSongs,
  getRecommendedSection,
  getSongById,
  getVisibleAlbums,
} from "./content/library";
import {
  createDefaultLibraryState,
  loadLibraryState,
  registerRecentPlayback,
  saveLibraryState,
  toggleFavoriteSong,
} from "./content/libraryState";
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
  albumQueue?: string[];
  queueIndex?: number;
}

export class AppShell {
  private gameShell: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private gameUiRoot: HTMLDivElement;
  private libraryRoot: HTMLDivElement;
  private game?: GameApp;
  private route: LibraryRoute = { view: "home" };
  private libraryState: LibraryState = createDefaultLibraryState();
  private session: PlayingSession | null = null;
  private pendingAdvanceTimeout?: number;

  constructor(private root: HTMLDivElement) {
    this.root.innerHTML = `
      <div class="app-shell">
        <div class="game-shell hidden">
          <canvas class="game-canvas" aria-label="Falling Orchestra playfield"></canvas>
          <div class="game-ui-root"></div>
        </div>
        <div class="library-root"></div>
      </div>
    `;

    const gameShell = this.root.querySelector<HTMLDivElement>(".game-shell");
    const canvas = this.root.querySelector<HTMLCanvasElement>(".game-canvas");
    const gameUiRoot = this.root.querySelector<HTMLDivElement>(".game-ui-root");
    const libraryRoot = this.root.querySelector<HTMLDivElement>(".library-root");

    if (!gameShell || !canvas || !gameUiRoot || !libraryRoot) {
      throw new Error("App shell elements were not created");
    }

    this.gameShell = gameShell;
    this.canvas = canvas;
    this.gameUiRoot = gameUiRoot;
    this.libraryRoot = libraryRoot;
    this.libraryState = loadLibraryState();

    this.libraryRoot.addEventListener("click", this.handleLibraryClick);
    this.render();
  }

  dispose(): void {
    this.clearPendingAdvance();
    this.libraryRoot.removeEventListener("click", this.handleLibraryClick);
    this.disposeGame();
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
    }
  };

  private render(): void {
    if (this.session) {
      this.renderSessionChrome();
      return;
    }

    this.gameShell.classList.add("hidden");
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
            <h1>Recommended First. Albums Ready.</h1>
          </div>
          <div class="library-actions">
            <button type="button" class="library-chip" data-action="open-home">Home</button>
            <button type="button" class="library-chip" data-action="open-favorites">Favorites</button>
          </div>
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
                    <button type="button" class="library-chip" data-action="play-album" data-album-id="${featuredAlbum.id}">Play Album</button>
                    <button type="button" class="library-chip" data-action="open-album" data-album-id="${featuredAlbum.id}">Open Album</button>
                  </div>
                </div>
                <div class="recommended-support">
                  ${supportingSongs
                    .map((song) => this.renderCompactSongCard(song))
                    .join("")}
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
          <div class="library-actions">
            <button type="button" class="library-chip" data-action="open-home">Home</button>
            <button type="button" class="library-chip" data-action="open-favorites">Favorites</button>
          </div>
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
          <div class="library-actions">
            <button type="button" class="library-chip" data-action="open-home">Home</button>
          </div>
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

    return `
      <article class="compact-song-card">
        <button type="button" class="card-favorite${favorite ? " active" : ""}" data-action="toggle-favorite" data-song-id="${song.id}">
          ${favorite ? "★" : "☆"}
        </button>
        <span class="compact-track-no">${String(song.trackNumber).padStart(2, "0")}</span>
        <h3>${escapeHtml(song.title)}</h3>
        <p>${escapeHtml(album?.title ?? "")}</p>
        <div class="compact-meta">
          <span>${song.energy ?? 3}/5 energy</span>
          ${emphasizeFavorite ? "<span>saved</span>" : ""}
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
    const favorite = this.libraryState.favoritesSongIds.includes(song.id);

    return `
      <article class="song-row">
        <div class="song-row-meta">
          <span class="song-row-index">${String(song.trackNumber).padStart(2, "0")}</span>
          <div>
            <h3>${escapeHtml(song.title)}</h3>
            <p>${song.moodTags.map((tag) => escapeHtml(tag)).join(" · ")}</p>
          </div>
        </div>
        <div class="song-row-actions">
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
      this.session?.albumQueue && this.session.queueIndex !== undefined
        ? `${this.session.queueIndex + 1} / ${this.session.albumQueue.length}`
        : null;

    this.gameShell.classList.remove("hidden");
    this.libraryRoot.innerHTML = `
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
                <span class="section-label">Now Playing</span>
                <h2>${escapeHtml(song.title)}</h2>
                <p>${escapeHtml(album.title)}${queueLabel ? ` · ${queueLabel}` : ""}</p>
              </div>
            `
            : ""
        }
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

  private async startSong(songId: string, albumQueue?: string[], queueIndex?: number): Promise<void> {
    const song = getSongById(songId);
    if (!song) {
      return;
    }

    this.clearPendingAdvance();
    this.disposeGame();
    this.libraryState = registerRecentPlayback(this.libraryState, song.id, song.albumId);
    saveLibraryState(this.libraryState);
    this.session = { songId, albumQueue, queueIndex };
    this.renderSessionChrome();

    this.game = new GameApp(this.canvas, this.gameUiRoot, {
      songConfig: song.config,
      onSongCompleted: () => {
        this.handleSongCompleted();
      },
    });
    await this.game.beginFromSelection();
    this.game.start();
  }

  private handleSongCompleted(): void {
    if (!this.session?.albumQueue || this.session.queueIndex === undefined) {
      this.clearPendingAdvance();
      this.pendingAdvanceTimeout = window.setTimeout(() => {
        this.stopPlayback();
      }, 1100);
      return;
    }

    const nextIndex = this.session.queueIndex + 1;
    if (nextIndex >= this.session.albumQueue.length) {
      this.clearPendingAdvance();
      this.pendingAdvanceTimeout = window.setTimeout(() => {
        this.stopPlayback();
      }, 1400);
      return;
    }

    this.clearPendingAdvance();
      this.pendingAdvanceTimeout = window.setTimeout(() => {
      void this.startSong(this.session!.albumQueue![nextIndex], this.session!.albumQueue, nextIndex);
    }, 1400);
  }

  private stopPlayback(): void {
    this.clearPendingAdvance();
    this.disposeGame();
    this.session = null;
    this.render();
  }

  private disposeGame(): void {
    this.game?.dispose();
    this.game = undefined;
    this.gameShell.classList.add("hidden");
    this.gameUiRoot.innerHTML = "";
  }

  private clearPendingAdvance(): void {
    if (this.pendingAdvanceTimeout !== undefined) {
      window.clearTimeout(this.pendingAdvanceTimeout);
      this.pendingAdvanceTimeout = undefined;
    }
  }
}
