import { ALBUMS } from "../albums";
import { ARTISTS } from "../artists";
import { PLAYLISTS } from "../playlists";
import { SONGS } from "../songs";
import type { MusicLibrary } from "../schema";

export const MUSIC_LIBRARY: MusicLibrary = {
  artists: ARTISTS,
  albums: ALBUMS,
  songs: SONGS,
  playlists: PLAYLISTS,
};
