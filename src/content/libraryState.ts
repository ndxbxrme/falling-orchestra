import type { LibraryState } from "./types";

const STORAGE_KEY = "falling-orchestra.library-state";
const MAX_RECENTS = 12;

export const createDefaultLibraryState = (): LibraryState => ({
  favoritesSongIds: [],
  recentSongIds: [],
  recentAlbumIds: [],
  ownedAlbumIds: [],
  lastPlayedSongId: null,
});

export const loadLibraryState = (): LibraryState => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return createDefaultLibraryState();
    }

    return {
      ...createDefaultLibraryState(),
      ...JSON.parse(raw),
    } as LibraryState;
  } catch {
    return createDefaultLibraryState();
  }
};

export const saveLibraryState = (state: LibraryState): void => {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
};

export const toggleFavoriteSong = (state: LibraryState, songId: string): LibraryState => {
  const favoritesSongIds = state.favoritesSongIds.includes(songId)
    ? state.favoritesSongIds.filter((id) => id !== songId)
    : [songId, ...state.favoritesSongIds];

  return {
    ...state,
    favoritesSongIds,
  };
};

export const registerRecentPlayback = (
  state: LibraryState,
  songId: string,
  albumId: string,
): LibraryState => ({
  ...state,
  recentSongIds: [songId, ...state.recentSongIds.filter((id) => id !== songId)].slice(0, MAX_RECENTS),
  recentAlbumIds: [albumId, ...state.recentAlbumIds.filter((id) => id !== albumId)].slice(0, MAX_RECENTS),
  lastPlayedSongId: songId,
});
