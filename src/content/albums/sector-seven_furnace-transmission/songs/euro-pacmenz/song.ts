import type { SongManifest } from "../../../../schema";

export const EURO_PACMENZ_SONG: SongManifest = {
  id: "sector-seven_euro-pacmenz",
  slug: "sector-seven_euro-pacmenz",
  title: "Euro Pacmenz",
  artistId: "sector-seven",
  albumId: "sector-seven_furnace-transmission",
  trackNumber: 4,
  difficulty: 2,
  energy: 3,
  moodTags: ["driving", "melodic"],
  recommendedWeight: 0.7,
  availability: "included",
  loadConfig: async () => (await import("./config")).SONG4_CONFIG,
};
