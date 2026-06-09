import type { SongManifest } from "../../../../schema";

export const JELLING_BAD_WORDS_SONG: SongManifest = {
  id: "sector-seven_jelling-bad-words",
  slug: "sector-seven_jelling-bad-words",
  title: "Jelling Bad Words",
  artistId: "sector-seven",
  albumId: "sector-seven_furnace-transmission",
  trackNumber: 7,
  difficulty: 3,
  energy: 3,
  moodTags: ["hypnotic", "melodic"],
  recommendedWeight: 0.72,
  availability: "included",
  loadConfig: async () => (await import("./config")).SONG7_CONFIG,
};
