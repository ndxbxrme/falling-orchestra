import type { SongConfig } from "../game/songConfig";
import type { SpawnPattern } from "../game/types";

export type ContentAvailability = "included" | "locked" | "hidden";
export type PlaylistKind = "system" | "user";
export type SongMoodTag =
  | "dark"
  | "driving"
  | "hypnotic"
  | "uplifting"
  | "broken"
  | "heavy"
  | "ambient"
  | "melodic";

export type LibraryRoute =
  | { view: "home" }
  | { view: "album"; albumId: string }
  | { view: "favorites" };

export interface Artist {
  id: string;
  slug: string;
  name: string;
  bio?: string;
  links?: {
    website?: string;
    bandcamp?: string;
    spotify?: string;
    instagram?: string;
  };
}

export interface AlbumTheme {
  accent: string;
  accentSoft: string;
  text: string;
  background: string;
  panel: string;
}

export interface Album {
  id: string;
  slug: string;
  title: string;
  artistId: string;
  year?: number;
  description?: string;
  coverArt?: string;
  theme: AlbumTheme;
  tags: string[];
  songIds: string[];
  recommendedSongId?: string;
  sortOrder: number;
  availability: ContentAvailability;
}

export interface SongEntry {
  id: string;
  slug: string;
  title: string;
  artistId: string;
  albumId: string;
  trackNumber: number;
  durationLabel?: string;
  difficulty?: 1 | 2 | 3 | 4 | 5;
  energy?: 1 | 2 | 3 | 4 | 5;
  moodTags: SongMoodTag[];
  coverArt?: string;
  recommendedWeight: number;
  availability: ContentAvailability;
  config: SongConfig;
}

export interface Playlist {
  id: string;
  title: string;
  kind: PlaylistKind;
  description?: string;
  songIds: string[];
  artwork?: string;
}

export interface LibraryState {
  favoritesSongIds: string[];
  recentSongIds: string[];
  recentAlbumIds: string[];
  ownedAlbumIds: string[];
  lastPlayedSongId: string | null;
}

export interface RecommendedSection {
  featuredSongId: string | null;
  supportingSongIds: string[];
}

export interface MusicLibrary {
  artists: Artist[];
  albums: Album[];
  songs: SongEntry[];
  playlists: Playlist[];
}

export interface SpawnPresetPreview {
  spawnInterval?: number;
  spawnPattern?: SpawnPattern;
  spawnCenter?: number;
}
