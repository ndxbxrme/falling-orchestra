import type { Playlist } from "./types";

export const PLAYLISTS: Playlist[] = [
  {
    id: "recommended",
    title: "Recommended",
    kind: "system",
    description: "Fast entry points into the library.",
    songIds: ["song10", "song2", "song6", "song1"],
  },
];
