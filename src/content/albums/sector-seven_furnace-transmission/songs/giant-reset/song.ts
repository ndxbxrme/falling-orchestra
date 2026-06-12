import type { SongManifest } from "../../../../schema";

export const GIANT_RESET_SONG: SongManifest = {
  id: "sector-seven_giant-reset",
  slug: "sector-seven_giant-reset",
  title: "Giant Reset",
  artistId: "sector-seven",
  albumId: "sector-seven_furnace-transmission",
  trackNumber: 1,
  difficulty: 2,
  energy: 2,
  moodTags: ["dark", "driving"],
  recommendedWeight: 0.66,
  availability: "included",
  backdropParams: {
    variant: 'signal-amber'
  },
  loadConfig: async () => (await import("./config")).SONG1_CONFIG,
};
