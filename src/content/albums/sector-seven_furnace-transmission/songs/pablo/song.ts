import { SONG6_CONFIG } from "./config";
import type { SongManifest } from "../../../../schema";

export const PABLO_SONG: SongManifest = {
  id: "sector-seven_pablo",
  slug: "sector-seven_pablo",
  title: "Pablo",
  artistId: "sector-seven",
  albumId: "sector-seven_furnace-transmission",
  trackNumber: 6,
  difficulty: 4,
  energy: 4,
  moodTags: ["dark", "broken", "heavy"],
  recommendedWeight: 0.82,
  availability: "included",
  config: SONG6_CONFIG,
};
