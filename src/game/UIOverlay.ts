import { GAME_CONFIG } from "./config";
import type { OverlayState, RootNoteName, ScaleModeName, SpawnPattern } from "./types";

interface OverlayCallbacks {
  onStart: () => void;
  onReplaySong?: () => void;
  onRootChange?: (value: RootNoteName) => void;
  onModeChange?: (value: ScaleModeName) => void;
  onSpawnIntervalChange?: (value: number) => void;
  onPatternChange?: (value: SpawnPattern) => void;
  onHudToggle: () => void;
  onPauseToggle: () => void;
  onReset?: () => void;
  onMuteToggle: () => void;
  onLiveToggle?: (value: boolean) => void;
  onFreezeToggle?: (value: boolean) => void;
  onDebugToggle?: (value: boolean) => void;
  onVolumeChange?: (value: number) => void;
}

export class UIOverlay {
  private startCard!: HTMLDivElement;
  private hudTop!: HTMLDivElement;
  private quickDock!: HTMLDivElement;
  private grooveBoostAlert!: HTMLDivElement;
  private grooveBoostText!: HTMLElement;
  private flashLayer!: HTMLDivElement;
  private grooveLandingFlash!: HTMLDivElement;
  private hypeLayer!: HTMLDivElement;
  private persistentBanner!: HTMLDivElement;
  private noteLayer!: HTMLDivElement;
  private formationSection!: HTMLDivElement;
  private formationValue!: HTMLElement;
  private formationFill!: HTMLDivElement;
  private soloSection!: HTMLDivElement;
  private soloValue!: HTMLElement;
  private soloFill!: HTMLDivElement;
  private hudButton!: HTMLButtonElement;
  private quickPauseButton!: HTMLButtonElement;
  private quickMuteButton!: HTMLButtonElement;
  private bannerQueue: Array<{ text: string; color: string }> = [];
  private activeBanner = false;
  private bannerTimeoutId?: number;
  private grooveLandingFlashTimeoutId?: number;
  constructor(private root: HTMLDivElement, private callbacks: OverlayCallbacks) {
    this.render();
  }

  update(state: OverlayState): void {
    const transition = state.transitionState;
    this.setClass(this.grooveBoostAlert, "incoming", transition.kind !== "none");
    if (transition.kind === "songEnding") {
      this.setText(this.grooveBoostText, this.glitchText("LAST TRANSISSION", transition.intensity * 0.72));
      this.setStyleValue(this.grooveBoostAlert, "--groove-boost-intensity", transition.intensity.toFixed(3));
    } else if (transition.kind === "grooveLanding") {
      this.setText(
        this.grooveBoostText,
        this.glitchText(`GROOVE ${String(transition.level).padStart(2, "0")} LIVE`, transition.intensity * 0.26),
      );
      this.setStyleValue(this.grooveBoostAlert, "--groove-boost-intensity", transition.intensity.toFixed(3));
    } else if (transition.kind === "grooveBuild") {
      this.setText(
        this.grooveBoostText,
        this.glitchText(`GROOVE ${transition.targetLevel} INCOMING`, transition.intensity),
      );
      this.setStyleValue(this.grooveBoostAlert, "--groove-boost-intensity", transition.intensity.toFixed(3));
    } else {
      this.setText(this.grooveBoostText, String(state.grooveLevel).padStart(2, "0"));
      this.setStyleValue(this.grooveBoostAlert, "--groove-boost-intensity", "0");
    }
    this.setText(this.formationValue, `${state.activeFormationCaught} / ${state.activeFormationRequired}`);
    this.setClass(this.formationSection, "hidden", !state.activeFormationVisible);
    this.setStyleValue(
      this.formationFill,
      "width",
      state.activeFormationVisible
        ? `${(state.activeFormationCaught / Math.max(1, state.activeFormationRequired)) * 100}%`
        : "0%",
    );
    this.setClass(this.soloSection, "hidden", !state.soloModeActive);
    this.setText(this.soloValue, `${state.soloMissesRemaining} misses left`);
    this.setStyleValue(
      this.soloFill,
      "width",
      `${(state.soloMissesRemaining / GAME_CONFIG.soloMaxConsecutiveMisses) * 100}%`,
    );
    this.setText(this.quickPauseButton, state.paused ? "Resume" : "Pause");
    this.setText(this.quickMuteButton, state.muted ? "Unmute" : "Mute");
    this.setText(this.hudButton, state.hudVisible ? "Hide UI" : "Show UI");
    this.setClass(this.hudTop, "hidden", !state.hudVisible);
    const sessionStarted = state.sessionPhase !== "idle";
    this.setClass(this.quickDock, "hidden", !sessionStarted);
    this.setClass(this.startCard, "hidden", sessionStarted);
  }

  showNoteLabel(
    text: string,
    x: number,
    y: number,
    color: string,
    variant: "note" | "banner" | "callout" | "callout-right" = "note",
  ): void {
    if (variant === "banner") {
      this.enqueueBanner(text, color);
      return;
    }

    const label = document.createElement("div");
    label.className =
      variant === "callout"
        ? "note-label callout"
        : variant === "callout-right"
          ? "note-label callout callout-right"
          : "note-label";
    label.textContent = text;
    label.style.color = color;
    label.style.left = `${x}px`;
    label.style.top = `${y}px`;
    this.noteLayer.append(label);

    window.setTimeout(() => {
      label.remove();
    }, 920);
  }

  private render(): void {
    this.root.innerHTML = `
      <div class="hud-shell">
        <div class="quick-dock hidden">
          <button type="button" data-hud-button>Hide UI</button>
          <button type="button" data-quick-pause>Pause</button>
          <button type="button" data-quick-mute>Mute</button>
        </div>

        <div class="groove-boost-alert" data-groove-boost-alert>
          <span data-groove-boost-text>01</span>
        </div>

        <div class="flash-layer" data-flash-layer></div>

        <div class="formation-strip floating hidden" data-formation-section>
          <div class="formation-copy">
            <strong>Special Catch</strong>
            <span class="visually-hidden" aria-hidden="true" data-formation-value>0 / 0</span>
          </div>
          <div class="formation-bar">
            <div class="formation-fill" data-formation-fill></div>
          </div>
        </div>

        <div class="formation-strip floating solo-strip hidden" data-solo-section>
          <div class="formation-copy">
            <strong>Solo Line</strong>
            <span data-solo-value>2 misses left</span>
          </div>
          <div class="formation-bar">
            <div class="formation-fill solo-fill" data-solo-fill></div>
          </div>
        </div>

        <div class="hud-top hidden">
          <section class="panel">
            <span class="eyebrow">Paused</span>
            <h2>Session Hold</h2>
            <p>The old prototype controls are gone. Use the quick dock to resume, mute, or hide the UI.</p>
          </section>
        </div>

        <div class="label-layer">
          <div class="hype-layer" data-hype-layer></div>
          <div class="note-layer" data-note-layer></div>
        </div>

        <div class="start-wrap">
          <div class="start-card hidden" data-start-card>
            <span class="eyebrow">Audio Unlock</span>
            <h1>Start the Prototype</h1>
            <p>Web Audio needs a gesture before it can play. Press the button below, then use <strong>A / D</strong> or drag across the playfield to shape the falling lines.</p>
            <p>On phones: touch almost anywhere in the lower screen and drag to move the paddle.</p>
            <p>Best first move: switch the mode if you want a different mood, then let the rain build until the arena starts to answer back.</p>
            <div class="button-row">
              <button type="button" data-start-button>Wake Audio and Play</button>
            </div>
          </div>
        </div>
      </div>
    `;

    this.quickDock = this.query<HTMLDivElement>(".quick-dock");
    this.hudTop = this.query<HTMLDivElement>(".hud-top");
    this.grooveBoostAlert = this.query<HTMLDivElement>("[data-groove-boost-alert]");
    this.grooveBoostText = this.query("[data-groove-boost-text]");
    this.flashLayer = this.query<HTMLDivElement>("[data-flash-layer]");
    this.startCard = this.query<HTMLDivElement>("[data-start-card]");
    this.hypeLayer = this.query<HTMLDivElement>("[data-hype-layer]");
    this.noteLayer = this.query<HTMLDivElement>("[data-note-layer]");
    this.grooveLandingFlash = document.createElement("div");
    this.grooveLandingFlash.className = "groove-landing-flash";
    this.flashLayer.append(this.grooveLandingFlash);
    this.persistentBanner = document.createElement("div");
    this.persistentBanner.className = "note-label banner";
    this.hypeLayer.append(this.persistentBanner);
    this.formationSection = this.query<HTMLDivElement>("[data-formation-section]");
    this.formationValue = this.query("[data-formation-value]");
    this.formationFill = this.query<HTMLDivElement>("[data-formation-fill]");
    this.soloSection = this.query<HTMLDivElement>("[data-solo-section]");
    this.soloValue = this.query("[data-solo-value]");
    this.soloFill = this.query<HTMLDivElement>("[data-solo-fill]");
    this.hudButton = this.query<HTMLButtonElement>("[data-hud-button]");
    this.quickPauseButton = this.query<HTMLButtonElement>("[data-quick-pause]");
    this.quickMuteButton = this.query<HTMLButtonElement>("[data-quick-mute]");

    this.query<HTMLButtonElement>("[data-start-button]").addEventListener("click", () => {
      this.callbacks.onStart();
    });

    this.hudButton.addEventListener("click", () => {
      this.callbacks.onHudToggle();
    });

    this.quickPauseButton.addEventListener("click", () => {
      this.callbacks.onPauseToggle();
    });

    this.quickMuteButton.addEventListener("click", () => {
      this.callbacks.onMuteToggle();
    });
  }

  private query<T extends Element>(selector: string): T {
    const element = this.root.querySelector<T>(selector);

    if (!element) {
      throw new Error(`Overlay element not found: ${selector}`);
    }

    return element;
  }

  private setText(element: Element, value: string): void {
    if (element.textContent !== value) {
      element.textContent = value;
    }
  }

  private setStyleValue(element: HTMLElement, property: string, value: string): void {
    if (element.style.getPropertyValue(property) !== value) {
      element.style.setProperty(property, value);
    }
  }

  private setClass(element: HTMLElement, className: string, enabled: boolean): void {
    if (element.classList.contains(className) !== enabled) {
      element.classList.toggle(className, enabled);
    }
  }

  private enqueueBanner(text: string, color: string): void {
    this.bannerQueue.push({ text: text.toUpperCase(), color });
    this.maybeShowNextBanner();
  }

  private maybeShowNextBanner(): void {
    if (this.activeBanner || this.bannerQueue.length === 0) {
      return;
    }

    const next = this.bannerQueue.shift();

    if (!next) {
      return;
    }

    this.activeBanner = true;
    this.persistentBanner.textContent = next.text;
    this.persistentBanner.style.left = "50%";
    this.persistentBanner.style.top = "50%";
    this.persistentBanner.style.color = next.color;
    this.persistentBanner.classList.remove("active");
    void this.persistentBanner.offsetWidth;
    this.persistentBanner.classList.add("active");

    window.clearTimeout(this.bannerTimeoutId);
    this.bannerTimeoutId = window.setTimeout(() => {
      this.persistentBanner.classList.remove("active");
      this.activeBanner = false;
      this.maybeShowNextBanner();
    }, 720);
  }

  triggerGrooveLandingFlash(): void {
    this.grooveLandingFlash.classList.remove("active");
    void this.grooveLandingFlash.offsetWidth;
    this.grooveLandingFlash.classList.add("active");

    window.clearTimeout(this.grooveLandingFlashTimeoutId);
    this.grooveLandingFlashTimeoutId = window.setTimeout(() => {
      this.grooveLandingFlash.classList.remove("active");
    }, 320);
  }

  playLaunchCountdown(): void {
    this.bannerQueue = [];
    this.activeBanner = false;
    window.clearTimeout(this.bannerTimeoutId);
    this.persistentBanner.classList.remove("active");
    const steps = ["4", "3", "2", "1"];
    steps.forEach((step, index) => {
      window.setTimeout(() => {
        this.enqueueBanner(step, "#eaf7ff");
      }, index * 620);
    });
  }

  private glitchText(text: string, intensity: number): string {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    const timeBucket = Math.floor(performance.now() / Math.max(32, 96 - intensity * 56));
    const chance = 0.01 + intensity * 0.08;

    return [...text].map((char, index) => {
      if (char === " " || char === "-") {
        return char;
      }

      const seed = Math.abs(Math.sin((index + 1) * 12.9898 + timeBucket * 78.233));
      if (seed >= chance) {
        return char;
      }

      const swapIndex = Math.floor((seed * 1000 + timeBucket * 17 + index * 13) % alphabet.length);
      return alphabet[swapIndex];
    }).join("");
  }
}
