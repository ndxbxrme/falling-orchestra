import type { SongConfig } from "../game/songConfig";
import type { SpawnPattern } from "../game/types";
import type { BackdropParamValue } from "./backdrops/schema";

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

export interface ArtistManifest {
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

export interface AlbumThemeManifest {
  accent: string;
  accentSoft: string;
  text: string;
  background: string;
  panel: string;
  backdropPreset: string;
  backdropParams?: Record<string, BackdropParamValue>;
}

export interface AlbumManifest {
  id: string;
  slug: string;
  title: string;
  artistId: string;
  year?: number;
  description?: string;
  coverArt?: string;
  theme: AlbumThemeManifest;
  tags: string[];
  songIds: string[];
  recommendedSongId?: string;
  sortOrder: number;
  availability: ContentAvailability;
}

export interface SongManifest {
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
  loadConfig: () => Promise<SongConfig>;
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
  previewAutoplay: boolean;
}

export interface RecommendedSection {
  featuredSongId: string | null;
  supportingSongIds: string[];
}

export interface MusicLibrary {
  artists: ArtistManifest[];
  albums: AlbumManifest[];
  songs: SongManifest[];
  playlists: Playlist[];
}

export interface SpawnPresetPreview {
  spawnInterval?: number;
  spawnPattern?: SpawnPattern;
  spawnCenter?: number;
}

export type Artist = ArtistManifest;
export type AlbumTheme = AlbumThemeManifest;
export type Album = AlbumManifest;
export type SongEntry = SongManifest;
