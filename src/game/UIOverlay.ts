import { MODE_LABELS, SPAWN_PATTERN_LABELS } from "./config";
import type { OverlayState, RootNoteName, ScaleModeName, SpawnPattern } from "./types";

interface OverlayCallbacks {
  onStart: () => void;
  onReplaySong: () => void;
  onRootChange: (value: RootNoteName) => void;
  onModeChange: (value: ScaleModeName) => void;
  onSpawnIntervalChange: (value: number) => void;
  onPatternChange: (value: SpawnPattern) => void;
  onHudToggle: () => void;
  onPauseToggle: () => void;
  onReset: () => void;
  onMuteToggle: () => void;
  onLiveToggle: (value: boolean) => void;
  onFreezeToggle: (value: boolean) => void;
  onDebugToggle: (value: boolean) => void;
  onVolumeChange: (value: number) => void;
}

const ROOT_OPTIONS: RootNoteName[] = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

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
  private objectCountValue!: HTMLElement;
  private perfValue!: HTMLElement;
  private modeValue!: HTMLElement;
  private densityValue!: HTMLElement;
  private grooveValue!: HTMLElement;
  private layerValue!: HTMLElement;
  private formationSection!: HTMLDivElement;
  private formationValue!: HTMLElement;
  private formationFill!: HTMLDivElement;
  private rootSelect!: HTMLSelectElement;
  private modeSelect!: HTMLSelectElement;
  private spawnSlider!: HTMLInputElement;
  private spawnValue!: HTMLElement;
  private patternSelect!: HTMLSelectElement;
  private volumeSlider!: HTMLInputElement;
  private volumeValue!: HTMLElement;
  private hudButton!: HTMLButtonElement;
  private pauseButton!: HTMLButtonElement;
  private quickPauseButton!: HTMLButtonElement;
  private muteButton!: HTMLButtonElement;
  private quickMuteButton!: HTMLButtonElement;
  private liveToggle!: HTMLInputElement;
  private freezeToggle!: HTMLInputElement;
  private debugToggle!: HTMLInputElement;
  private bannerQueue: Array<{ text: string; color: string }> = [];
  private activeBanner = false;
  private bannerTimeoutId?: number;
  private grooveLandingFlashTimeoutId?: number;

  constructor(private root: HTMLDivElement, private callbacks: OverlayCallbacks) {
    this.render();
  }

  update(state: OverlayState): void {
    const transition = state.transitionState;
    this.objectCountValue.textContent = String(state.activeObjects);
    this.perfValue.textContent = `${state.fps.toFixed(0)} FPS / ${state.frameTimeMs.toFixed(1)}ms`;
    this.modeValue.textContent = `${state.rootNote} ${MODE_LABELS[state.mode]}`;
    this.densityValue.textContent = `${state.spawnPattern} / ${state.spawnLiveInterval.toFixed(2)}s`;
    this.grooveValue.textContent = `${state.grooveCharge} / ${state.grooveTarget}`;
    this.layerValue.textContent = state.grooveLayerLabel;
    this.grooveBoostAlert.classList.toggle("incoming", transition.kind !== "none");
    if (transition.kind === "songEnding") {
      this.grooveBoostText.textContent = this.glitchText("LAST TRANSISSION", transition.intensity * 0.72);
      this.grooveBoostAlert.style.setProperty("--groove-boost-intensity", transition.intensity.toFixed(3));
    } else if (transition.kind === "grooveLanding") {
      this.grooveBoostText.textContent = this.glitchText(`GROOVE ${String(transition.level).padStart(2, "0")} LIVE`, transition.intensity * 0.26);
      this.grooveBoostAlert.style.setProperty("--groove-boost-intensity", transition.intensity.toFixed(3));
    } else if (transition.kind === "grooveBuild") {
      this.grooveBoostText.textContent = this.glitchText(`GROOVE ${transition.targetLevel} INCOMING`, transition.intensity);
      this.grooveBoostAlert.style.setProperty("--groove-boost-intensity", transition.intensity.toFixed(3));
    } else {
      this.grooveBoostText.textContent = String(state.grooveLevel).padStart(2, "0");
      this.grooveBoostAlert.style.setProperty("--groove-boost-intensity", "0");
    }
    this.formationValue.textContent = `${state.activeFormationCaught} / ${state.activeFormationRequired}`;
    this.formationSection.classList.toggle("hidden", !state.activeFormationVisible);
    this.formationFill.style.width = state.activeFormationVisible
      ? `${(state.activeFormationCaught / Math.max(1, state.activeFormationRequired)) * 100}%`
      : "0%";

    if (this.rootSelect.value !== state.rootNote) {
      this.rootSelect.value = state.rootNote;
    }

    if (this.modeSelect.value !== state.mode) {
      this.modeSelect.value = state.mode;
    }

    const sliderValue = Math.round(state.spawnInterval * 100);
    if (Number(this.spawnSlider.value) !== sliderValue) {
      this.spawnSlider.value = String(sliderValue);
    }

    this.spawnValue.textContent = `${state.spawnInterval.toFixed(2)}s`;

    if (this.patternSelect.value !== state.spawnPattern) {
      this.patternSelect.value = state.spawnPattern;
    }

    const volumeSliderValue = Math.round(state.masterVolume * 100);
    if (Number(this.volumeSlider.value) !== volumeSliderValue) {
      this.volumeSlider.value = String(volumeSliderValue);
    }

    this.volumeValue.textContent = `${Math.round(state.masterVolume * 100)}%`;
    this.pauseButton.textContent = state.paused ? "Resume" : "Pause";
    this.quickPauseButton.textContent = state.paused ? "Resume" : "Pause";
    this.muteButton.textContent = state.muted ? "Unmute" : "Mute";
    this.quickMuteButton.textContent = state.muted ? "Unmute" : "Mute";
    this.hudButton.textContent = state.hudVisible ? "Hide UI" : "Show UI";
    this.liveToggle.checked = state.liveMode;
    this.freezeToggle.checked = state.freezeSpawning;
    this.debugToggle.checked = state.debugLabels;
    this.hudTop.classList.toggle("hidden", !state.hudVisible);
    const sessionStarted = state.sessionPhase !== "idle";
    this.quickDock.classList.toggle("hidden", !sessionStarted);
    this.startCard.classList.toggle("hidden", sessionStarted);
  }

  showNoteLabel(
    text: string,
    x: number,
    y: number,
    color: string,
    variant: "note" | "banner" = "note",
  ): void {
    if (variant === "banner") {
      this.enqueueBanner(text, color);
      return;
    }

    const label = document.createElement("div");
    label.className = "note-label";
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
    const rootOptions = ROOT_OPTIONS.map(
      (note) => `<option value="${note}">${note}</option>`,
    ).join("");

    const modeOptions = Object.entries(MODE_LABELS)
      .map(([value, label]) => `<option value="${value}">${label}</option>`)
      .join("");

    const patternOptions = Object.entries(SPAWN_PATTERN_LABELS)
      .map(([value, label]) => `<option value="${value}">${label}</option>`)
      .join("");

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

        <div class="hud-top hidden">
          <section class="panel">
            <span class="eyebrow">Prototype Jam</span>
            <h1>Falling Orchestra</h1>
            <p>Conduct the storm. Move the paddle and keep the collisions singing inside the selected scale.</p>

            <div class="status-grid">
              <div class="status-card">
                <strong data-object-count>0</strong>
                <span>Active objects</span>
              </div>
              <div class="status-card">
                <strong data-perf-value>60 FPS / 16.7ms</strong>
                <span>Frame pacing</span>
              </div>
              <div class="status-card">
                <strong data-mode-value>C Major / Ionian</strong>
                <span>Current harmony</span>
              </div>
              <div class="status-card">
                <strong data-density-value>rain / 0.82s</strong>
                <span>Spawner</span>
              </div>
              <div class="status-card">
                <strong data-groove-value>0 / 9</strong>
                <span>Formation clears</span>
              </div>
              <div class="status-card">
                <strong data-layer-value>Groove 1</strong>
                <span>Loop state</span>
              </div>
            </div>

            <div class="control-grid">
              <div class="control">
                <label for="root-select">Root</label>
                <select id="root-select" data-root-select>${rootOptions}</select>
              </div>
              <div class="control">
                <label for="mode-select">Mode</label>
                <select id="mode-select" data-mode-select>${modeOptions}</select>
              </div>
              <div class="control wide">
                <label for="spawn-slider">Spawn center</label>
                <input id="spawn-slider" data-spawn-slider type="range" min="0" max="300" step="1" value="74" />
                <span class="range-value" data-spawn-value>0.82s</span>
              </div>
              <div class="control">
                <label for="pattern-select">Pattern</label>
                <select id="pattern-select" data-pattern-select>${patternOptions}</select>
              </div>
              <div class="control">
                <label for="volume-slider">Master</label>
                <input id="volume-slider" data-volume-slider type="range" min="0" max="100" step="1" value="72" />
                <span class="range-value" data-volume-value>72%</span>
              </div>
            </div>

            <div class="toggle-row">
              <label class="toggle">
                <input data-live-toggle type="checkbox" />
                <span>Live keys</span>
              </label>
              <label class="toggle">
                <input data-freeze-toggle type="checkbox" />
                <span>Freeze spawns</span>
              </label>
              <label class="toggle">
                <input data-debug-toggle type="checkbox" />
                <span>Note labels</span>
              </label>
            </div>

            <div class="button-row">
              <button type="button" data-pause-button>Pause</button>
              <button type="button" data-mute-button>Mute</button>
              <button type="button" data-reset-button>Reset</button>
            </div>
          </section>

          <section class="panel secondary">
            <span class="eyebrow">Playbook</span>
            <h2>Controls</h2>
            <ul class="help-list">
              <li><strong>A / D</strong> or <strong>Left / Right</strong> to move the paddle. <strong>Up / Down</strong> changes the spawn center. In live mode, movement is arrow keys only.</li>
              <li><strong>Touch</strong>: drag anywhere on the playfield to steer the paddle directly.</li>
              <li><strong>Click</strong> or tap the arena to wake audio if it has not started yet.</li>
              <li><strong>L</strong> toggles live mode. Roots map to <strong>Q 2 W 3 E R 5 T 6 Y 7 U I</strong> and modes map to <strong>A S D F G H J K ; Z X C V</strong>.</li>
              <li><strong>Esc</strong> hides or shows these panels. <strong>P</strong> pauses, <strong>M</strong> mutes, and <strong>Shift+R</strong> resets while live mode is on.</li>
              <li>Catch most of a special formation with your paddle to charge the groove meter and push the song into higher groove levels.</li>
            </ul>

            <h2>Families</h2>
            <ul class="legend-list">
              <li class="legend-item"><span class="swatch bell"></span> Bell Drop: bright, mid-air shimmer, upper register.</li>
              <li class="legend-item"><span class="swatch bass"></span> Bass Blob: heavier, weighty impacts, low register.</li>
              <li class="legend-item"><span class="swatch snare"></span> Snare Pop: crisp percussion hits that cut through the groove.</li>
              <li class="legend-item"><span class="swatch spark"></span> Spark Orb: small, lively, fast plucks and ricochets.</li>
            </ul>
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
    this.objectCountValue = this.query("[data-object-count]");
    this.perfValue = this.query("[data-perf-value]");
    this.modeValue = this.query("[data-mode-value]");
    this.densityValue = this.query("[data-density-value]");
    this.grooveValue = this.query("[data-groove-value]");
    this.layerValue = this.query("[data-layer-value]");
    this.formationSection = this.query<HTMLDivElement>("[data-formation-section]");
    this.formationValue = this.query("[data-formation-value]");
    this.formationFill = this.query<HTMLDivElement>("[data-formation-fill]");
    this.rootSelect = this.query<HTMLSelectElement>("[data-root-select]");
    this.modeSelect = this.query<HTMLSelectElement>("[data-mode-select]");
    this.spawnSlider = this.query<HTMLInputElement>("[data-spawn-slider]");
    this.spawnValue = this.query("[data-spawn-value]");
    this.patternSelect = this.query<HTMLSelectElement>("[data-pattern-select]");
    this.volumeSlider = this.query<HTMLInputElement>("[data-volume-slider]");
    this.volumeValue = this.query("[data-volume-value]");
    this.hudButton = this.query<HTMLButtonElement>("[data-hud-button]");
    this.pauseButton = this.query<HTMLButtonElement>("[data-pause-button]");
    this.quickPauseButton = this.query<HTMLButtonElement>("[data-quick-pause]");
    this.muteButton = this.query<HTMLButtonElement>("[data-mute-button]");
    this.quickMuteButton = this.query<HTMLButtonElement>("[data-quick-mute]");
    this.liveToggle = this.query<HTMLInputElement>("[data-live-toggle]");
    this.freezeToggle = this.query<HTMLInputElement>("[data-freeze-toggle]");
    this.debugToggle = this.query<HTMLInputElement>("[data-debug-toggle]");

    this.query<HTMLButtonElement>("[data-start-button]").addEventListener("click", () => {
      this.callbacks.onStart();
    });

    this.rootSelect.addEventListener("change", () => {
      this.callbacks.onRootChange(this.rootSelect.value as RootNoteName);
    });

    this.modeSelect.addEventListener("change", () => {
      this.callbacks.onModeChange(this.modeSelect.value as ScaleModeName);
    });

    this.spawnSlider.addEventListener("input", () => {
      this.callbacks.onSpawnIntervalChange(Number(this.spawnSlider.value) / 100);
    });

    this.patternSelect.addEventListener("change", () => {
      this.callbacks.onPatternChange(this.patternSelect.value as SpawnPattern);
    });

    this.volumeSlider.addEventListener("input", () => {
      this.callbacks.onVolumeChange(Number(this.volumeSlider.value) / 100);
    });

    this.pauseButton.addEventListener("click", () => {
      this.callbacks.onPauseToggle();
    });

    this.hudButton.addEventListener("click", () => {
      this.callbacks.onHudToggle();
    });

    this.quickPauseButton.addEventListener("click", () => {
      this.callbacks.onPauseToggle();
    });

    this.query<HTMLButtonElement>("[data-reset-button]").addEventListener("click", () => {
      this.callbacks.onReset();
    });

    this.muteButton.addEventListener("click", () => {
      this.callbacks.onMuteToggle();
    });

    this.quickMuteButton.addEventListener("click", () => {
      this.callbacks.onMuteToggle();
    });

    this.liveToggle.addEventListener("change", () => {
      this.callbacks.onLiveToggle(this.liveToggle.checked);
    });

    this.freezeToggle.addEventListener("change", () => {
      this.callbacks.onFreezeToggle(this.freezeToggle.checked);
    });

    this.debugToggle.addEventListener("change", () => {
      this.callbacks.onDebugToggle(this.debugToggle.checked);
    });
  }

  private query<T extends Element>(selector: string): T {
    const element = this.root.querySelector<T>(selector);

    if (!element) {
      throw new Error(`Overlay element not found: ${selector}`);
    }

    return element;
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
