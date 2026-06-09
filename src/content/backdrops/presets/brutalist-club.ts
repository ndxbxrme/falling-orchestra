import type { BackdropModule } from "../schema";

export const BRUTALIST_CLUB_BACKDROP_MODULE: BackdropModule = {
  id: "brutalist-club",
  label: "Brutalist Club",
  description:
    "Legacy built-in corridor, rails, rings, and haze scene. Registered through the module contract so albums select it by id like any future scripted backdrop.",
  performanceTier: "medium",
  create(context) {
    context.activateLegacyBuiltIn("brutalist-club");

    return {
      update() {
        void context;
      },
      resize() {
        void context;
      },
      dispose() {
        void context;
      },
    };
  },
};
