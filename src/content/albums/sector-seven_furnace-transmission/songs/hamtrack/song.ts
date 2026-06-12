import type { SongManifest } from "../../../../schema";

export const HAMTRACK_SONG: SongManifest = {
  id: "sector-seven_hamtrack",
  slug: "sector-seven_hamtrack",
  title: "Hamtrack",
  artistId: "sector-seven",
  albumId: "sector-seven_furnace-transmission",
  trackNumber: 8,
  difficulty: 4,
  energy: 5,
  moodTags: ["heavy", "dark", "driving"],
  recommendedWeight: 0.8,
  availability: "included",
  backdropParams: {
    variant: 'cold-steel'
  },
  loadConfig: async () => (await import("./config")).SONG8_CONFIG,
};
