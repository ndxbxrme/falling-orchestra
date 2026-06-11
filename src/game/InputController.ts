import type { RootNoteName, ScaleModeName } from "./types";

export class InputController {
  private leftPressed = false;
  private rightPressed = false;
  private gamepadHorizontalAxis = 0;
  private gamepadInteractionActive = false;
  private readonly gamepadButtonPressed = new Set<number>();

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
        | "spawnRateDown"
        | "forceGrooveUp",
    ) => void,
    private onRootHotkey: (note: RootNoteName) => void,
    private onModeHotkey: (mode: ScaleModeName) => void,
    private isLiveMode: () => boolean,
  ) {
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
  }

  get horizontalAxis(): number {
    const keyboardAxis = Number(this.rightPressed) - Number(this.leftPressed);
    if (Math.abs(this.gamepadHorizontalAxis) <= 0.001) {
      return keyboardAxis;
    }

    if (keyboardAxis === 0) {
      return this.gamepadHorizontalAxis;
    }

    return Math.abs(this.gamepadHorizontalAxis) > Math.abs(keyboardAxis) ? this.gamepadHorizontalAxis : keyboardAxis;
  }

  update(): void {
    const getGamepads = navigator.getGamepads?.bind(navigator);
    if (!getGamepads) {
      this.gamepadHorizontalAxis = 0;
      this.gamepadInteractionActive = false;
      this.gamepadButtonPressed.clear();
      return;
    }

    const pads = getGamepads();
    let horizontalAxis = 0;
    let interactionActive = false;
    const pressedButtons = new Set<number>();

    for (const gamepad of pads) {
      if (!gamepad?.connected) {
        continue;
      }

      const leftStickX = clampGamepadAxis(gamepad.axes[0] ?? 0);
      const dpadAxis = Number(readGamepadButton(gamepad.buttons[15])) - Number(readGamepadButton(gamepad.buttons[14]));
      const padAxis = Math.abs(leftStickX) >= Math.abs(dpadAxis) ? leftStickX : dpadAxis;
      if (Math.abs(padAxis) > Math.abs(horizontalAxis)) {
        horizontalAxis = padAxis;
      }

      const moving = Math.abs(padAxis) >= GAMEPAD_INTERACT_AXIS_THRESHOLD;
      const activeButtons = GAMEPAD_INTERACT_BUTTONS.some((index) => readGamepadButton(gamepad.buttons[index]));
      interactionActive ||= moving || activeButtons;

      for (const index of GAMEPAD_BUTTON_COMMANDS.keys()) {
        if (readGamepadButton(gamepad.buttons[index])) {
          pressedButtons.add(index);
        }
      }
    }

    this.gamepadHorizontalAxis = horizontalAxis;
    if (interactionActive && !this.gamepadInteractionActive) {
      this.onInteract();
    }
    this.gamepadInteractionActive = interactionActive;

    for (const index of pressedButtons) {
      if (this.gamepadButtonPressed.has(index)) {
        continue;
      }

      const command = GAMEPAD_BUTTON_COMMANDS.get(index);
      if (command) {
        this.onCommand(command);
      } else {
        this.onInteract();
      }
    }

    this.gamepadButtonPressed.clear();
    for (const index of pressedButtons) {
      this.gamepadButtonPressed.add(index);
    }
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

    if (event.code === "NumpadAdd") {
      event.preventDefault();
      this.onCommand("forceGrooveUp");
      this.onInteract();
      return;
    }

    if (event.code === "KeyL") {
      this.onCommand("toggleLiveMode");
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

    if (event.code === "Escape") {
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
  KeyJ: "phrygian",
  KeyK: "lydian",
  Semicolon: "locrian",
  KeyZ: "harmonicMinor",
  KeyX: "melodicMinor",
  KeyC: "bluesMajor",
  KeyV: "bluesMinor",
};

const GAMEPAD_AXIS_DEADZONE = 0.18;
const GAMEPAD_INTERACT_AXIS_THRESHOLD = 0.36;
const GAMEPAD_INTERACT_BUTTONS = [0, 1, 2, 3, 4, 5, 9, 12, 13, 14, 15] as const;
const GAMEPAD_BUTTON_COMMANDS = new Map<
  number,
  | "pause"
  | "reset"
  | "mute"
  | "toggleLiveMode"
  | "toggleHud"
  | "spawnRateUp"
  | "spawnRateDown"
  | "forceGrooveUp"
>([
  [9, "pause"],
  [5, "forceGrooveUp"],
  [12, "spawnRateUp"],
  [13, "spawnRateDown"],
  [2, "mute"],
]);

function readGamepadButton(button: GamepadButton | undefined): boolean {
  return Boolean(button?.pressed);
}

function clampGamepadAxis(value: number): number {
  if (Math.abs(value) < GAMEPAD_AXIS_DEADZONE) {
    return 0;
  }

  return Math.max(-1, Math.min(1, value));
}
