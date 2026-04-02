import type { RootNoteName, ScaleModeName } from "./types";

export class InputController {
  private leftPressed = false;
  private rightPressed = false;

  constructor(
    private onInteract: () => void,
    private onCommand: (
      command:
        | "pause"
        | "reset"
        | "mute"
        | "toggleLiveMode"
        | "toggleHud"
        | "spawnRateUp"
        | "spawnRateDown",
    ) => void,
    private onRootHotkey: (note: RootNoteName) => void,
    private onModeHotkey: (mode: ScaleModeName) => void,
    private isLiveMode: () => boolean,
  ) {
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
  }

  get horizontalAxis(): number {
    return Number(this.rightPressed) - Number(this.leftPressed);
  }

  dispose(): void {
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
  }

  private handleKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat) {
      return;
    }

    const liveMode = this.isLiveMode();

    if (event.code === "ArrowLeft" || (!liveMode && event.code === "KeyA")) {
      this.leftPressed = true;
      this.onInteract();
      return;
    }

    if (event.code === "ArrowRight" || (!liveMode && event.code === "KeyD")) {
      this.rightPressed = true;
      this.onInteract();
      return;
    }

    if (event.code === "ArrowUp") {
      event.preventDefault();
      this.onCommand("spawnRateUp");
      this.onInteract();
      return;
    }

    if (event.code === "ArrowDown") {
      event.preventDefault();
      this.onCommand("spawnRateDown");
      this.onInteract();
      return;
    }

    if (event.code === "KeyL") {
      this.onCommand("toggleLiveMode");
      return;
    }

    if (event.code === "Escape") {
      this.onCommand("toggleHud");
      return;
    }

    if (liveMode) {
      const rootHotkey = LIVE_ROOT_HOTKEYS[event.code];
      if (rootHotkey) {
        this.onRootHotkey(rootHotkey);
        this.onInteract();
        return;
      }

      const modeHotkey = LIVE_MODE_HOTKEYS[event.code];
      if (modeHotkey) {
        this.onModeHotkey(modeHotkey);
        this.onInteract();
        return;
      }
    }

    if (event.code === "KeyP") {
      this.onCommand("pause");
      return;
    }

    if ((liveMode && event.code === "KeyR" && event.shiftKey) || (!liveMode && event.code === "KeyR")) {
      this.onCommand("reset");
      return;
    }

    if (event.code === "KeyM") {
      this.onCommand("mute");
      return;
    }

    this.onInteract();
  };

  private handleKeyUp = (event: KeyboardEvent): void => {
    const liveMode = this.isLiveMode();

    if (event.code === "ArrowLeft" || (!liveMode && event.code === "KeyA")) {
      this.leftPressed = false;
      return;
    }

    if (event.code === "ArrowRight" || (!liveMode && event.code === "KeyD")) {
      this.rightPressed = false;
    }
  };
}

const LIVE_ROOT_HOTKEYS: Partial<Record<string, RootNoteName>> = {
  KeyQ: "C",
  Digit2: "C#",
  KeyW: "D",
  Digit3: "D#",
  KeyE: "E",
  KeyR: "F",
  Digit5: "F#",
  KeyT: "G",
  Digit6: "G#",
  KeyY: "A",
  Digit7: "A#",
  KeyU: "B",
  KeyI: "C",
};

const LIVE_MODE_HOTKEYS: Partial<Record<string, ScaleModeName>> = {
  KeyA: "ionian",
  KeyS: "aeolian",
  KeyD: "dorian",
  KeyF: "mixolydian",
  KeyG: "pentatonicMajor",
  KeyH: "pentatonicMinor",
};
