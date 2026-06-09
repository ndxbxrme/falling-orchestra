import type { SongManifest } from "../../../../schema";

export const RUNNING_ITS_COURSE_SONG: SongManifest = {
  id: "sector-seven_running-its-course",
  slug: "sector-seven_running-its-course",
  title: "Running Its Course",
  artistId: "sector-seven",
  albumId: "sector-seven_furnace-transmission",
  trackNumber: 10,
  difficulty: 3,
  energy: 5,
  moodTags: ["driving", "uplifting", "melodic"],
  recommendedWeight: 1,
  availability: "included",
  loadConfig: async () => (await import("./config")).SONG10_CONFIG,
};
