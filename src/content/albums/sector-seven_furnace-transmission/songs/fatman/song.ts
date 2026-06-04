import { SONG2_CONFIG } from "./config";
import type { SongManifest } from "../../../../schema";

export const FATMAN_SONG: SongManifest = {
  id: "sector-seven_fatman",
  slug: "sector-seven_fatman",
  title: "Fatman",
  artistId: "sector-seven",
  albumId: "sector-seven_furnace-transmission",
  trackNumber: 2,
  difficulty: 3,
  energy: 4,
  moodTags: ["dark", "hypnotic", "heavy"],
  recommendedWeight: 0.98,
  availability: "included",
  config: SONG2_CONFIG,
};
