import { Vector2 } from "@babylonjs/core/Maths/math.vector";
import type { BackdropParamValue } from "../content/backdrops";
import { GAME_CONFIG } from "./config";
import { InputController } from "./InputController";
import { MusicSystem } from "./MusicSystem";
import type { SongConfig } from "./songConfig";
import { Spawner } from "./Spawner";
import { UIOverlay } from "./UIOverlay";
import { World } from "./World";
import type {
  GameCompletionStats,
  GameSessionPhase,
  MusicalObject,
  OverlayState,
  RootNoteName,
  ScaleModeName,
  SpawnPattern,
  Surface,
  TransitionState,
} from "./types";

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const GROOVE_TARGET = 9;
const MEGA_COMBO_THRESHOLD = 6.4;
const MEGA_COMBO_COOLDOWN = 1.1;
const MEGA_COMBO_REWARD = 2;
const LAUNCH_COUNTDOWN_STEP_MS = 620;
const LAUNCH_COUNTDOWN_STEPS = 4;
const GROOVE_LANDING_AFTERGLOW_MS = 520;
const FIXED_SIMULATION_STEP = 1 / 60;
const MAX_SIMULATION_STEPS_PER_FRAME = 4;

interface FormationProgress {
  total: number;
  touched: Set<number>;
  resolved: Set<number>;
  awarded: boolean;
}

interface SoloModeState {
  active: boolean;
  consecutiveMisses: number;
  maxConsecutiveMisses: number;
}

interface GameAppOptions {
  songConfig: SongConfig;
  backdropPresetId?: string;
  backdropParams?: Record<string, BackdropParamValue>;
  onSongCompleted?: (stats: GameCompletionStats) => void;
}

export class GameApp {
  private songConfig: SongConfig;
  private world: World;
  private music = new MusicSystem();
  private spawner = new Spawner();
  private input: InputController;
  private overlay: UIOverlay;
  private interactionRoot: HTMLDivElement;
  private playerX = 0;
  private sessionPhase: GameSessionPhase = "idle";
  private paused = false;
  private muted = false;
  private liveMode = false;
  private hudVisible = false;
  private freezeSpawning = false;
  private debugLabels = false;
  private grooveCharge = 0;
  private grooveLevels: number[] = [];
  private specialFormations = new Map<string, FormationProgress>();
  private lastBackdropBarIndex = -1;
  private lastFrameTime = performance.now();
  private megaComboCooldown = 0;
  private activeTouchPointerId: number | null = null;
  private touchPlayerTargetX: number | null = null;
  private onSongCompleted?: (stats: GameCompletionStats) => void;
  private launchCountdownEndsAt = 0;
  private smoothedFrameTimeMs = 16.7;
  private smoothedFps = 60;
  private simulationAccumulator = 0;
  private transitionState: TransitionState = { kind: "none" };
  private grooveLandingEndsAt = 0;
  private grooveLandingLevel: number | null = null;
  private activeFormationSummary = { caught: 0, required: 0, visible: false };
  private overlayState: OverlayState = {
    sessionPhase: "idle",
    transitionState: { kind: "none" },
    activeObjects: 0,
    fps: 60,
    frameTimeMs: 16.7,
    rootNote: "C",
    mode: "ionian",
    liveMode: false,
    hudVisible: false,
    spawnInterval: GAME_CONFIG.spawnIntervalDefault,
    spawnLiveInterval: GAME_CONFIG.spawnIntervalDefault,
    spawnPattern: "rain",
    grooveCharge: 0,
    grooveTarget: GROOVE_TARGET,
    grooveLevel: 1,
    grooveLayerLabel: "Groove 1",
    activeFormationCaught: 0,
    activeFormationRequired: 0,
    activeFormationVisible: false,
    soloModeActive: false,
    soloMissesRemaining: GAME_CONFIG.soloMaxConsecutiveMisses,
    paused: false,
    muted: false,
    freezeSpawning: false,
    debugLabels: false,
    masterVolume: 0.72,
  };
  private soloMode: SoloModeState = {
    active: false,
    consecutiveMisses: 0,
    maxConsecutiveMisses: GAME_CONFIG.soloMaxConsecutiveMisses,
  };
  private activeSoloBallIds = new Set<number>();
  private specialCatchCount = 0;
  private currentSoloCatchCount = 0;
  private longestSoloCatchCount = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    overlayRoot: HTMLDivElement,
    options: GameAppOptions,
  ) {
    this.songConfig = options.songConfig;
    this.onSongCompleted = options.onSongCompleted;
    this.interactionRoot = overlayRoot;
    this.grooveLevels = [...new Set(
      this.songConfig.grooveLevels
        .map((grooveLevel) => grooveLevel.level)
        .filter((level): level is number => Number.isFinite(level)),
    )].sort((a, b) => a - b);
    this.world = new World(canvas, {
      backdropPresetId: options.backdropPresetId,
      backdropParams: options.backdropParams,
    });
    this.music.loadSong(this.songConfig);
    this.applySpawnProfileForLevel(this.music.currentGrooveLevel);

    this.input = new InputController(
      () => {
        void this.unlockAudio();
      },
      (command) => {
        if (command === "pause") {
          this.togglePause();
          return;
        }

        if (command === "reset") {
          this.reset();
          return;
        }

        if (command === "toggleLiveMode") {
          this.toggleLiveMode();
          return;
        }

        if (command === "toggleHud") {
          this.toggleHud();
          return;
        }

        if (command === "spawnRateUp") {
          this.adjustSpawnInterval(-GAME_CONFIG.spawnIntervalKeyStep);
          return;
        }

        if (command === "spawnRateDown") {
          this.adjustSpawnInterval(GAME_CONFIG.spawnIntervalKeyStep);
          return;
        }

        if (command === "forceGrooveUp") {
          this.forceGrooveLevelIncrease();
          return;
        }

        this.toggleMute();
      },
      (note) => {
        if (!this.liveMode) {
          return;
        }

        this.music.setRootNote(note);
      },
      (mode) => {
        if (!this.liveMode) {
          return;
        }

        this.music.setMode(mode);
      },
      () => this.liveMode,
    );

    this.overlay = new UIOverlay(overlayRoot, {
      onStart: () => {
        void this.unlockAudio();
      },
      onReplaySong: () => {
        this.reset();
      },
      onRootChange: (value: RootNoteName) => {
        this.liveMode = true;
        this.music.setHarmonyControlMode("manual");
        this.music.setRootNote(value);
      },
      onModeChange: (value: ScaleModeName) => {
        this.liveMode = true;
        this.music.setHarmonyControlMode("manual");
        this.music.setMode(value);
      },
      onSpawnIntervalChange: (value: number) => {
        this.setSpawnInterval(value);
      },
      onPatternChange: (value: SpawnPattern) => {
        this.spawner.spawnPattern = value;
      },
      onHudToggle: () => {
        this.toggleHud();
      },
      onPauseToggle: () => {
        this.togglePause();
      },
      onReset: () => {
        this.reset();
      },
      onMuteToggle: () => {
        this.toggleMute();
      },
      onLiveToggle: (value: boolean) => {
        this.setLiveMode(value);
      },
      onFreezeToggle: (value: boolean) => {
        this.freezeSpawning = value;
        this.spawner.frozen = value;
      },
      onDebugToggle: (value: boolean) => {
        this.debugLabels = value;
      },
      onVolumeChange: (value: number) => {
        this.music.setVolume(value);
      },
    });

    this.canvas.addEventListener("pointerdown", this.handleGameplayPointerDown);
    this.interactionRoot.addEventListener("pointerdown", this.handleGameplayPointerDown);
    window.addEventListener("pointermove", this.handleGameplayPointerMove, { passive: false });
    window.addEventListener("pointerup", this.handleGameplayPointerUp);
    window.addEventListener("pointercancel", this.handleGameplayPointerUp);
    window.addEventListener("resize", this.handleResize);
  }

  start(): void {
    this.world.engine.runRenderLoop(() => {
      const now = performance.now();
      const rawFrameTimeMs = Math.max(0.1, now - this.lastFrameTime);
      const deltaTime = Math.min(rawFrameTimeMs / 1000, GAME_CONFIG.maxDeltaTime);
      this.lastFrameTime = now;
      const perfFollow = 0.12;
      this.smoothedFrameTimeMs += (rawFrameTimeMs - this.smoothedFrameTimeMs) * perfFollow;
      this.smoothedFps += ((1000 / rawFrameTimeMs) - this.smoothedFps) * perfFollow;

      if (!this.paused) {
        this.simulationAccumulator = Math.min(
          this.simulationAccumulator + deltaTime,
          FIXED_SIMULATION_STEP * MAX_SIMULATION_STEPS_PER_FRAME,
        );
        let simulationSteps = 0;
        while (
          this.simulationAccumulator >= FIXED_SIMULATION_STEP &&
          simulationSteps < MAX_SIMULATION_STEPS_PER_FRAME
        ) {
          this.tick(FIXED_SIMULATION_STEP);
          this.simulationAccumulator -= FIXED_SIMULATION_STEP;
          simulationSteps += 1;
        }
      } else {
        this.simulationAccumulator = 0;
      }

      this.overlay.update(this.getOverlayState());
      this.world.render(this.paused ? 1 : this.simulationAccumulator / FIXED_SIMULATION_STEP);
    });
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.simulationAccumulator = 0;
    this.music.setPaused(paused);
  }

  dispose(): void {
    this.canvas.removeEventListener("pointerdown", this.handleGameplayPointerDown);
    this.interactionRoot.removeEventListener("pointerdown", this.handleGameplayPointerDown);
    window.removeEventListener("pointermove", this.handleGameplayPointerMove);
    window.removeEventListener("pointerup", this.handleGameplayPointerUp);
    window.removeEventListener("pointercancel", this.handleGameplayPointerUp);
    window.removeEventListener("resize", this.handleResize);
    this.input.dispose();
    this.music.dispose();
    this.world.dispose();
  }

  async beginFromSelection(): Promise<void> {
    this.setSessionPhase("countdown");
    this.launchCountdownEndsAt = performance.now() + LAUNCH_COUNTDOWN_STEP_MS * LAUNCH_COUNTDOWN_STEPS;
    await this.music.unlock();
    this.overlay.playLaunchCountdown();
  }

  private tick(deltaTime: number): void {
    this.megaComboCooldown = Math.max(0, this.megaComboCooldown - deltaTime);
    this.music.update();
    const endingState = this.music.getEndingState();
    const pendingGrooveBoost = this.music.getPendingGrooveBoost();
    const grooveLandingEvent = this.music.consumeGrooveLandingEvent();
    if (grooveLandingEvent) {
      this.applySpawnProfileForLevel(grooveLandingEvent.level);
      this.grooveLandingLevel = grooveLandingEvent.level;
      this.grooveLandingEndsAt = performance.now() + GROOVE_LANDING_AFTERGLOW_MS;
      this.overlay.triggerGrooveLandingFlash();
      this.overlay.showNoteLabel(`Groove ${grooveLandingEvent.level} Live`, this.canvas.clientWidth * 0.5, 84, "#c8f6ff", "banner");
    }
    this.syncTransitionState(pendingGrooveBoost, endingState);
    this.syncSongCompletionState();
    const quarterIndex = this.music.getTransportQuarterIndex();
    if (quarterIndex !== null) {
      this.spawner.syncTransportQuarter(quarterIndex, this.world.getObjectCount());
      const barIndex = Math.floor(quarterIndex / 4);
      if (barIndex !== this.lastBackdropBarIndex) {
        this.lastBackdropBarIndex = barIndex;
        this.world.setBackdropScrollDirection(this.pickBackdropDirection());
      }
    }
    this.world.setCameraBeatPulse(this.music.getBeatPulse(), this.getGrooveIntensity());
    this.world.setBackdropGrooveState(this.music.currentGrooveLevel, this.songConfig.grooveLevels.length);
    this.world.setEndingState(endingState?.progress ?? 0, endingState?.intensity ?? 0);
    this.world.setTransitionState(this.transitionState);
    if (endingState && this.soloMode.active) {
      this.endSoloMode(true);
    }

    if (this.sessionPhase === "countdown" && performance.now() >= this.launchCountdownEndsAt) {
      this.setSessionPhase("playing");
    }

    if (this.sessionPhase === "playing" && endingState !== null) {
      this.setSessionPhase("ending");
    }

    if (this.sessionPhase === "countdown" && performance.now() < this.launchCountdownEndsAt) {
      return;
    }

    if (this.sessionPhase === "completed") {
      return;
    }

    const bounds = this.world.getBounds();
    if (this.touchPlayerTargetX !== null) {
      const follow = Math.min(1, deltaTime * 20);
      this.playerX += (this.touchPlayerTargetX - this.playerX) * follow;
    } else {
      this.playerX += this.input.horizontalAxis * GAME_CONFIG.playerSpeed * deltaTime;
    }
    this.playerX = this.world.clampPlayerX(this.playerX);
    this.world.setPlayerX(this.playerX);

    this.spawner.setEndingTaper(endingState?.progress ?? null);
    this.spawner.frozen = this.freezeSpawning || (endingState?.progress ?? 0) >= 0.72;
    const requests = this.spawner.update(
      deltaTime,
      bounds,
      this.world.getObjectCount(),
      this.activeSoloBallIds.size,
      this.hasActiveSpecialFormation(),
    );
    for (const request of requests) {
      const object = this.world.spawnObject(
        request.type,
        request.x,
        request.velocityX,
        request.velocityY,
        request.specialFormationId,
        request.formationColor,
      );

      if (object?.type === "solo") {
        this.activeSoloBallIds.add(object.id);
      }

      if (object && request.specialFormationId && request.formationTotal) {
        this.registerSpecialObject(request.specialFormationId, request.formationTotal, object.id);
      }
    }

    this.world.update(
      deltaTime,
      (object, surface, x, y, impact) => {
        this.handleMusicalImpact(object, surface, x, y, impact);
      },
      (object, other, x, y, impact) => {
        this.handlePairImpact(object, other, x, y, impact);
      },
      (object) => {
        this.handleObjectRemoved(object);
      },
    );
  }

  private async unlockAudio(): Promise<void> {
    await this.music.unlock();
    if (this.sessionPhase === "idle") {
      this.setSessionPhase("playing");
    }
  }

  private handleGameplayPointerDown = (event: PointerEvent): void => {
    void this.unlockAudio();

    if (!this.isDirectTouchPointer(event) || !this.canStartTouchDrag(event)) {
      return;
    }

    this.activeTouchPointerId = event.pointerId;
    this.touchPlayerTargetX = this.pointerEventToWorldX(event);
    this.playerX = this.world.clampPlayerX(this.touchPlayerTargetX);
    this.world.setPlayerX(this.playerX);
    const captureTarget = event.currentTarget instanceof HTMLElement ? event.currentTarget : this.canvas;
    if (captureTarget.hasPointerCapture?.(event.pointerId) === false) {
      captureTarget.setPointerCapture?.(event.pointerId);
    }
    event.preventDefault();
  };

  private handleGameplayPointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.activeTouchPointerId || !this.isDirectTouchPointer(event)) {
      return;
    }

    this.touchPlayerTargetX = this.pointerEventToWorldX(event);
    event.preventDefault();
  };

  private handleGameplayPointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.activeTouchPointerId) {
      return;
    }

    this.touchPlayerTargetX = null;
    this.activeTouchPointerId = null;
  };

  private handleResize = (): void => {
    this.world.resize();
  };

  private isDirectTouchPointer(event: PointerEvent): boolean {
    return event.pointerType === "touch" || event.pointerType === "pen";
  }

  private canStartTouchDrag(event: PointerEvent): boolean {
    const target = event.target as HTMLElement | null;
    if (target?.closest("button, input, select, textarea, a, [data-no-touch-drag]")) {
      return false;
    }

    const rect = this.interactionRoot.getBoundingClientRect();
    if (event.clientY < rect.top || event.clientY > rect.bottom) {
      return false;
    }

    const dragStartThreshold = rect.top + rect.height * 0.35;
    return event.clientY >= dragStartThreshold;
  }

  private pointerEventToWorldX(event: PointerEvent): number {
    const rect = this.canvas.getBoundingClientRect();
    const bounds = this.world.getBounds();
    const normalizedX = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    return bounds.left + normalizedX * (bounds.right - bounds.left);
  }

  private handleMusicalImpact(
    object: MusicalObject,
    surface: Surface,
    x: number,
    y: number,
    impact: number,
  ): void {
    const bounds = this.world.getBounds();
    const normalizedX = clamp((x - bounds.left) / (bounds.right - bounds.left), 0, 1);

    if (object.type === "solo") {
      if (surface.kind === "player" && this.activeSoloBallIds.has(object.id)) {
        const wasCaught = object.soloCaught === true;
        if (!wasCaught) {
          this.world.markSoloCaught(object.id);
        }
        this.handleSoloCatch(object, normalizedX, impact, x, y);
      }
      return;
    }

    const pan = normalizedX * 2 - 1;
    const played = this.music.triggerImpact({
      family: object.noteFamily,
      noteRange: object.noteRange,
      impact,
      normalizedX,
      pan,
      transpose: surface.transpose,
      color: object.color,
    });

    if (object.specialFormationId && surface.kind === "player") {
      this.markSpecialObjectCaught(object.specialFormationId, object.id);
    }

    if (!this.debugLabels) {
      return;
    }

    const screen = this.world.worldToScreen(x, y);
    this.overlay.showNoteLabel(played.label, screen.x, screen.y, played.color);
  }

  private handlePairImpact(
    object: MusicalObject,
    other: MusicalObject,
    x: number,
    y: number,
    impact: number,
  ): void {
    if (object.type === "solo" || other.type === "solo") {
      return;
    }

    const bounds = this.world.getBounds();
    const normalizedX = clamp((x - bounds.left) / (bounds.right - bounds.left), 0, 1);
    const pan = normalizedX * 2 - 1;

    if (
      object.type === "mega" &&
      other.type === "mega" &&
      impact >= MEGA_COMBO_THRESHOLD &&
      this.megaComboCooldown <= 0
    ) {
      this.megaComboCooldown = MEGA_COMBO_COOLDOWN;
      this.music.triggerMegaCombo({ impact, pan });
      this.awardGroove(MEGA_COMBO_REWARD, "Mega Combo +2", "#fff178", 84);

      const screen = this.world.worldToScreen(x, y);
      this.overlay.showNoteLabel("DOUBLE MEGA", screen.x, screen.y - 36, "#fff9c4", "banner");
      return;
    }

    const played = this.music.triggerImpact({
      family: object.noteFamily,
      noteRange: object.noteRange,
      impact,
      normalizedX,
      pan,
      color: object.color,
    });

    if (!this.debugLabels) {
      return;
    }

    const screen = this.world.worldToScreen(x, y);
    this.overlay.showNoteLabel(played.label, screen.x, screen.y, played.color);
  }

  private togglePause(): void {
    this.setPaused(!this.paused);
  }

  private toggleMute(): void {
    this.muted = !this.muted;
    this.music.setMuted(this.muted);
  }

  private toggleHud(): void {
    this.hudVisible = !this.hudVisible;
  }

  private toggleLiveMode(): void {
    this.setLiveMode(!this.liveMode);
  }

  private setLiveMode(value: boolean): void {
    this.liveMode = value;
    this.music.setHarmonyControlMode(value ? "manual" : "cycle");
  }

  private setSpawnInterval(value: number): void {
    const nextInterval = clamp(value, GAME_CONFIG.spawnIntervalMin, GAME_CONFIG.spawnIntervalMax);
    this.spawner.spawnInterval = nextInterval;
    this.spawner.currentInterval = Math.max(nextInterval, GAME_CONFIG.spawnIntervalSafeMin);
  }

  private adjustSpawnInterval(delta: number): void {
    this.setSpawnInterval(this.spawner.spawnInterval + delta);
  }

  private reset(): void {
    this.simulationAccumulator = 0;
    this.endSoloMode(true);
    this.spawner.reset();
    this.world.reset();
    this.world.setPlayerX(this.playerX = 0);
    this.specialFormations.clear();
    this.megaComboCooldown = 0;
    this.grooveCharge = 0;
    this.setSessionPhase("playing");
    this.launchCountdownEndsAt = 0;
    this.lastBackdropBarIndex = -1;
    this.transitionState = { kind: "none" };
    this.grooveLandingEndsAt = 0;
    this.grooveLandingLevel = null;
    this.activeSoloBallIds.clear();
    this.specialCatchCount = 0;
    this.currentSoloCatchCount = 0;
    this.longestSoloCatchCount = 0;
    this.music.resetGroovePlayback();
    this.applySpawnProfileForLevel(this.music.currentGrooveLevel);
  }

  private registerSpecialObject(formationId: string, total: number, objectId: number): void {
    const progress = this.specialFormations.get(formationId) ?? {
      total,
      touched: new Set<number>(),
      resolved: new Set<number>(),
      awarded: false,
    };
    progress.total = total;
    this.specialFormations.set(formationId, progress);
    void objectId;
  }

  private markSpecialObjectCaught(formationId: string, objectId: number): void {
    const progress = this.specialFormations.get(formationId);

    if (!progress) {
      return;
    }

    progress.touched.add(objectId);
    progress.resolved.add(objectId);
    this.world.markSpecialCaught(objectId);
    this.maybeResolveFormation(formationId, progress);
  }

  private handleObjectRemoved(object: MusicalObject): void {
    if (this.activeSoloBallIds.delete(object.id) && !object.soloCaught) {
      this.handleSoloMiss();
    }

    if (!object.specialFormationId) {
      return;
    }

    const progress = this.specialFormations.get(object.specialFormationId);

    if (!progress) {
      return;
    }

    progress.resolved.add(object.id);
    this.maybeResolveFormation(object.specialFormationId, progress);
  }

  private maybeResolveFormation(formationId: string, progress: FormationProgress): void {
    if (progress.awarded || progress.resolved.size < progress.total) {
      return;
    }

    progress.awarded = true;
    const requiredCaught = this.getRequiredFormationCatches(progress.total);

    if (progress.touched.size >= requiredCaught) {
      this.specialCatchCount += 1;
      this.awardGroove(1, "Groove +1", "#69f5d8", 118);
      this.spawner.queueMegaSpawn();
      this.overlay.showNoteLabel(
        "Mega Ball",
        this.canvas.clientWidth * 0.5,
        152,
        "#fff178",
        "banner",
      );
    }

    this.specialFormations.delete(formationId);
  }

  private awardGroove(amount: number, label: string, color: string, y: number): void {
    const previousCharge = Number.isFinite(this.grooveCharge) ? this.grooveCharge : 0;
    this.grooveCharge = clamp(previousCharge + amount, 0, GROOVE_TARGET);
    this.overlay.showNoteLabel(label, this.canvas.clientWidth * 0.5, y, color, "banner");
    this.syncGrooveUnlocks();
  }

  private syncGrooveUnlocks(): void {
    const previousLevel = this.music.currentGrooveLevel;
    const nextLevel = this.getGrooveLevelForCharge(this.grooveCharge);
    this.music.setGrooveLevel(nextLevel);

    if (nextLevel !== previousLevel) {
      this.overlay.showNoteLabel(
        `Groove ${nextLevel}`,
        this.canvas.clientWidth * 0.5,
        84,
        "#9fedff",
        "banner",
      );
    }
  }

  private forceGrooveLevelIncrease(): void {
    const currentIndex = this.grooveLevels.indexOf(this.music.currentGrooveLevel);
    if (currentIndex < 0 || currentIndex >= this.grooveLevels.length - 1) {
      return;
    }

    const nextLevel = this.grooveLevels[currentIndex + 1];
    this.grooveCharge = Math.max(this.grooveCharge, ((currentIndex + 1) / Math.max(1, this.grooveLevels.length - 1)) * GROOVE_TARGET);
    this.music.setGrooveLevel(nextLevel);
    this.overlay.showNoteLabel(`Groove ${nextLevel}`, this.canvas.clientWidth * 0.5, 84, "#9fedff", "banner");
  }

  private getRequiredFormationCatches(total: number): number {
    const allowedMisses = total >= 18 ? 8 : total >= 10 ? 5 : 2;
    return Math.max(1, total - allowedMisses);
  }

  private applySpawnProfileForLevel(level: number): void {
    const grooveLevel = this.songConfig.grooveLevels.find((entry) => entry.level === level);
    this.spawner.setSpawnProfile(grooveLevel?.spawnProfile);
  }

  private handleSoloCatch(
    object: MusicalObject,
    normalizedX: number,
    impact: number,
    x: number,
    y: number,
  ): void {
    if (!this.soloMode.active) {
      this.startSoloMode();
    } else {
      this.soloMode.consecutiveMisses = 0;
    }

    this.currentSoloCatchCount += 1;
    this.longestSoloCatchCount = Math.max(this.longestSoloCatchCount, this.currentSoloCatchCount);

    const played = this.music.triggerSoloNote({
      noteRange: object.noteRange,
      normalizedX,
      impact,
    });

    if (!this.debugLabels) {
      return;
    }

    const screen = this.world.worldToScreen(x, y);
    this.overlay.showNoteLabel(played.label, screen.x, screen.y, played.color);
  }

  private handleSoloMiss(): void {
    if (!this.soloMode.active) {
      return;
    }

    this.soloMode.consecutiveMisses += 1;
    if (this.soloMode.consecutiveMisses >= this.soloMode.maxConsecutiveMisses) {
      this.endSoloMode(false);
    }
  }

  private startSoloMode(): void {
    this.soloMode.active = true;
    this.soloMode.consecutiveMisses = 0;
    this.currentSoloCatchCount = 0;
    this.spawner.setSoloModeActive(true);
    this.overlay.showNoteLabel(
      "Solo Mode",
      this.canvas.clientWidth - 34,
      this.canvas.clientHeight - 210,
      "#ffcf97",
      "callout-right",
    );
  }

  private endSoloMode(silent: boolean): void {
    if (!this.soloMode.active) {
      return;
    }

    this.longestSoloCatchCount = Math.max(this.longestSoloCatchCount, this.currentSoloCatchCount);
    this.soloMode.active = false;
    this.soloMode.consecutiveMisses = 0;
    this.currentSoloCatchCount = 0;
    this.activeSoloBallIds.clear();
    this.spawner.setSoloModeActive(false);
    this.music.stopSoloVoice();
    if (!silent) {
      this.overlay.showNoteLabel(
        "Solo Complete",
        this.canvas.clientWidth * 0.5,
        118,
        "#ffd7b2",
        "banner",
      );
    }
  }

  private getOverlayState(): OverlayState {
    const formationSummary = this.getActiveFormationSummary();
    this.overlayState.sessionPhase = this.sessionPhase;
    this.overlayState.transitionState = this.transitionState;
    this.overlayState.activeObjects = this.world.getObjectCount();
    this.overlayState.fps = this.smoothedFps;
    this.overlayState.frameTimeMs = this.smoothedFrameTimeMs;
    this.overlayState.rootNote = this.music.rootNote;
    this.overlayState.mode = this.music.mode;
    this.overlayState.liveMode = this.liveMode;
    this.overlayState.hudVisible = this.hudVisible;
    this.overlayState.spawnInterval = this.spawner.spawnInterval;
    this.overlayState.spawnLiveInterval = this.spawner.currentInterval;
    this.overlayState.spawnPattern = this.spawner.spawnPattern;
    this.overlayState.grooveCharge = this.grooveCharge;
    this.overlayState.grooveTarget = GROOVE_TARGET;
    this.overlayState.grooveLevel = this.music.currentGrooveLevel;
    this.overlayState.grooveLayerLabel = this.getGrooveLayerLabel();
    this.overlayState.activeFormationCaught = formationSummary.caught;
    this.overlayState.activeFormationRequired = formationSummary.required;
    this.overlayState.activeFormationVisible = formationSummary.visible;
    this.overlayState.soloModeActive = this.soloMode.active;
    this.overlayState.soloMissesRemaining = Math.max(
      0,
      this.soloMode.maxConsecutiveMisses - this.soloMode.consecutiveMisses,
    );
    this.overlayState.paused = this.paused;
    this.overlayState.muted = this.muted;
    this.overlayState.freezeSpawning = this.freezeSpawning;
    this.overlayState.debugLabels = this.debugLabels;
    this.overlayState.masterVolume = this.music.volume;
    return this.overlayState;
  }

  private hasActiveSpecialFormation(): boolean {
    for (const progress of this.specialFormations.values()) {
      if (!progress.awarded) {
        return true;
      }
    }

    return false;
  }

  private getCompletionStats(): GameCompletionStats {
    return {
      specialCatches: this.specialCatchCount,
      longestSolo: Math.max(this.longestSoloCatchCount, this.currentSoloCatchCount),
    };
  }

  private getActiveFormationSummary(): { caught: number; required: number; visible: boolean } {
    let bestCaught = 0;
    let bestRequired = 0;

    for (const progress of this.specialFormations.values()) {
      if (progress.awarded) {
        continue;
      }

      const required = this.getRequiredFormationCatches(progress.total);
      const caught = Math.min(progress.touched.size, required);

      if (caught > bestCaught || (caught === bestCaught && required > bestRequired)) {
        bestCaught = caught;
        bestRequired = required;
      }
    }

    this.activeFormationSummary.caught = bestCaught;
    this.activeFormationSummary.required = bestRequired;
    this.activeFormationSummary.visible = bestRequired > 0;
    return this.activeFormationSummary;
  }

  private getGrooveLayerLabel(): string {
    if (this.sessionPhase === "completed") {
      return "Song Complete";
    }

    if (this.sessionPhase === "ending") {
      return "Final Pass";
    }

    if (this.transitionState.kind === "grooveLanding") {
      return `Groove ${this.transitionState.level} Live`;
    }

    if (this.transitionState.kind === "grooveBuild") {
      return `Groove ${this.music.currentGrooveLevel} -> ${this.transitionState.targetLevel}`;
    }

    const targetLevel = this.getGrooveLevelForCharge(this.grooveCharge);
    return targetLevel === this.music.currentGrooveLevel
      ? `Groove ${this.music.currentGrooveLevel}`
      : `Groove ${this.music.currentGrooveLevel} -> ${targetLevel}`;
  }

  private getGrooveIntensity(): number {
    if (this.grooveLevels.length <= 1) {
      return 0.16;
    }

    const grooveIndex = this.grooveLevels.indexOf(this.music.currentGrooveLevel);
    const normalizedLevel = grooveIndex <= 0 ? 0 : grooveIndex / (this.grooveLevels.length - 1);
    return 0.16 + normalizedLevel * 0.84;
  }

  private getGrooveLevelForCharge(charge: number): number {
    if (this.grooveLevels.length === 0) {
      return 1;
    }

    if (!Number.isFinite(charge)) {
      return this.grooveLevels[0] ?? 1;
    }

    const normalizedCharge = clamp(charge / GROOVE_TARGET, 0, 1);
    const grooveIndex = clamp(
      Math.round(normalizedCharge * (this.grooveLevels.length - 1)),
      0,
      this.grooveLevels.length - 1,
    );
    return this.grooveLevels[grooveIndex] ?? this.grooveLevels[this.grooveLevels.length - 1] ?? 1;
  }

  private syncSongCompletionState(): void {
    const songCompleted = this.music.isSongCompleted();
    if (!songCompleted || this.sessionPhase === "completed") {
      return;
    }

    this.setSessionPhase("completed");
    this.overlay.showNoteLabel("Locked In", this.canvas.clientWidth * 0.5, 94, "#ffca6e", "banner");
    this.overlay.showNoteLabel("Track Complete", this.canvas.clientWidth * 0.5, 94, "#eaf7ff", "banner");
    this.onSongCompleted?.(this.getCompletionStats());
  }

  private syncTransitionState(
    pendingGrooveBoost: ReturnType<MusicSystem["getPendingGrooveBoost"]>,
    endingState: ReturnType<MusicSystem["getEndingState"]>,
  ): void {
    if (endingState) {
      this.transitionState = {
        kind: "songEnding",
        progress: endingState.progress,
        intensity: endingState.intensity,
      };
      return;
    }

    if (this.grooveLandingLevel !== null && performance.now() < this.grooveLandingEndsAt) {
      const progress = 1 - (this.grooveLandingEndsAt - performance.now()) / GROOVE_LANDING_AFTERGLOW_MS;
      this.transitionState = {
        kind: "grooveLanding",
        level: this.grooveLandingLevel,
        progress: clamp(progress, 0, 1),
        intensity: 1 - clamp(progress, 0, 1) * 0.72,
      };
      return;
    }

    if (this.grooveLandingLevel !== null) {
      this.grooveLandingLevel = null;
      this.grooveLandingEndsAt = 0;
    }

    if (pendingGrooveBoost) {
      const progress = clamp((pendingGrooveBoost.intensity - 0.16) / 0.84, 0, 1);
      this.transitionState = {
        kind: "grooveBuild",
        targetLevel: pendingGrooveBoost.targetLevel,
        progress,
        intensity: pendingGrooveBoost.intensity,
      };
      return;
    }

    this.transitionState = { kind: "none" };
  }

  private setSessionPhase(phase: GameSessionPhase): void {
    this.sessionPhase = phase;
  }

  private pickBackdropDirection(): Vector2 {
    const directions = [
      [-0.92, -0.22],
      [-0.58, 0.64],
      [0.24, 0.96],
      [0.82, 0.38],
      [0.94, -0.16],
      [0.36, -0.92],
      [-0.28, -0.96],
      [-0.76, 0.46],
    ] as const;
    const choice = directions[Math.floor(Math.random() * directions.length)];
    return new Vector2(choice[0], choice[1]);
  }
}
