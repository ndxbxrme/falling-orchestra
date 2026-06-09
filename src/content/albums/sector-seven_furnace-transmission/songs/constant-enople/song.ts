import type { SongManifest } from "../../../../schema";

export const CONSTANT_ENOPLE_SONG: SongManifest = {
  id: "sector-seven_constant-enople",
  slug: "sector-seven_constant-enople",
  title: "Constant Enople",
  artistId: "sector-seven",
  albumId: "sector-seven_furnace-transmission",
  trackNumber: 5,
  difficulty: 3,
  energy: 4,
  moodTags: ["heavy", "driving"],
  recommendedWeight: 0.76,
  availability: "included",
  loadConfig: async () => (await import("./config")).SONG5_CONFIG,
};
