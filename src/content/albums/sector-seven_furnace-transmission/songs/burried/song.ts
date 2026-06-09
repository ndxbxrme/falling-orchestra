import type { SongManifest } from "../../../../schema";

export const BURRIED_SONG: SongManifest = {
  id: "sector-seven_burried",
  slug: "sector-seven_burried",
  title: "Burried",
  artistId: "sector-seven",
  albumId: "sector-seven_furnace-transmission",
  trackNumber: 9,
  difficulty: 4,
  energy: 4,
  moodTags: ["ambient", "broken", "dark"],
  recommendedWeight: 0.78,
  availability: "included",
  loadConfig: async () => (await import("./config")).SONG9_CONFIG,
};
