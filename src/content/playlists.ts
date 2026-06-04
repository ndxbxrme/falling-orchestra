import type { Playlist } from "./types";

export const PLAYLISTS: Playlist[] = [
  {
    id: "recommended",
    title: "Recommended",
    kind: "system",
    description: "Fast entry points into the library.",
    songIds: [
      "sector-seven_running-its-course",
      "sector-seven_fatman",
      "sector-seven_pablo",
      "sector-seven_giant-reset",
    ],
  },
];
