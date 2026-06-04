import type {
  Album,
  Artist,
  LibraryState,
  RecommendedSection,
  SongEntry,
} from "../schema";
import { MUSIC_LIBRARY } from "./registry";

export { MUSIC_LIBRARY } from "./registry";

export const getArtistById = (artistId: string): Artist | undefined =>
  MUSIC_LIBRARY.artists.find((artist) => artist.id === artistId);

export const getAlbumById = (albumId: string): Album | undefined =>
  MUSIC_LIBRARY.albums.find((album) => album.id === albumId);

export const getSongById = (songId: string): SongEntry | undefined =>
  MUSIC_LIBRARY.songs.find((song) => song.id === songId);

export const getVisibleAlbums = (): Album[] =>
  MUSIC_LIBRARY.albums
    .filter((album) => album.availability !== "hidden")
    .sort((a, b) => a.sortOrder - b.sortOrder);

export const getVisibleSongs = (): SongEntry[] =>
  MUSIC_LIBRARY.songs.filter((song) => song.availability !== "hidden");

export const getAlbumSongs = (albumId: string): SongEntry[] =>
  getVisibleSongs()
    .filter((song) => song.albumId === albumId)
    .sort((a, b) => a.trackNumber - b.trackNumber);

export const getFavoriteSongs = (state: LibraryState): SongEntry[] =>
  state.favoritesSongIds
    .map((songId) => getSongById(songId))
    .filter((song): song is SongEntry => Boolean(song));

export const getRecentSongs = (state: LibraryState): SongEntry[] =>
  state.recentSongIds
    .map((songId) => getSongById(songId))
    .filter((song): song is SongEntry => Boolean(song));

export const getRecommendedSection = (state: LibraryState): RecommendedSection => {
  const visibleSongs = getVisibleSongs().filter((song) => song.availability === "included");
  const ranked = [...visibleSongs].sort((a, b) => {
    const recencyPenaltyA = state.recentSongIds.indexOf(a.id);
    const recencyPenaltyB = state.recentSongIds.indexOf(b.id);
    const scoreA = a.recommendedWeight - (recencyPenaltyA >= 0 ? (12 - recencyPenaltyA) * 0.01 : 0);
    const scoreB = b.recommendedWeight - (recencyPenaltyB >= 0 ? (12 - recencyPenaltyB) * 0.01 : 0);
    return scoreB - scoreA;
  });

  return {
    featuredSongId: ranked[0]?.id ?? null,
    supportingSongIds: ranked.slice(1, 5).map((song) => song.id),
  };
};
