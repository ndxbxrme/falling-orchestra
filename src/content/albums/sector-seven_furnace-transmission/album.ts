import type { AlbumManifest } from "../../schema";
import sectorSevenFurnaceTransmissionCover from "./cover.webp";

export const SECTOR_SEVEN_FURNACE_TRANSMISSION_ALBUM: AlbumManifest = {
  id: "sector-seven_furnace-transmission",
  slug: "sector-seven_furnace-transmission",
  title: "Furnace Transmission",
  artistId: "sector-seven",
  coverArt: sectorSevenFurnaceTransmissionCover,
  year: 2026,
  description:
    "Ten playable techno tracks built for collisions, groove ramps, and late-night brutalist pressure.",
  theme: {
    accent: "#7ee9ef",
    accentSoft: "#213645",
    text: "#eaf7ff",
    background: "#081522",
    panel: "#101b29",
    backdropPreset: "brutalist-club",
  },
  tags: ["dark", "techno", "sheffield", "interactive"],
  songIds: [
    "sector-seven_giant-reset",
    "sector-seven_fatman",
    "sector-seven_sunup",
    "sector-seven_euro-pacmenz",
    "sector-seven_constant-enople",
    "sector-seven_pablo",
    "sector-seven_jelling-bad-words",
    "sector-seven_hamtrack",
    "sector-seven_burried",
    "sector-seven_running-its-course",
  ],
  recommendedSongId: "sector-seven_running-its-course",
  sortOrder: 1,
  availability: "included",
};
