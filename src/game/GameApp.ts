import { Vector2 } from "@babylonjs/core/Maths/math.vector";
import { GAME_CONFIG } from "./config";
import { InputController } from "./InputController";
import { MusicSystem } from "./MusicSystem";
import type { SongConfig } from "./songConfig";
import { Spawner } from "./Spawner";
import { UIOverlay } from "./UIOverlay";
import { World } from "./World";
import type { MusicalObject, OverlayState, RootNoteName, ScaleModeName, SpawnPattern, Surface } from "./types";

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const GROOVE_TARGET = 9;
const MEGA_COMBO_THRESHOLD = 6.4;
const MEGA_COMBO_COOLDOWN = 1.1;
const MEGA_COMBO_REWARD = 2;
const LAUNCH_COUNTDOWN_STEP_MS = 620;
const LAUNCH_COUNTDOWN_STEPS = 4;

interface FormationProgress {
  total: number;
  touched: Set<number>;
  resolved: Set<number>;
  awarded: boolean;
}

interface GameAppOptions {
  songConfig: SongConfig;
  onSongCompleted?: () => void;
}

export class GameApp {
  private songConfig: SongConfig;
  private world: World;
  private music = new MusicSystem();
  private spawner = new Spawner();
  private input: InputController;
  private overlay: UIOverlay;
  private playerX = 0;
  private started = false;
  private songCompleted = false;
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
  private onSongCompleted?: () => void;
  private launchCountdownUntil = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    overlayRoot: HTMLDivElement,
    options: GameAppOptions,
  ) {
    this.songConfig = options.songConfig;
    this.onSongCompleted = options.onSongCompleted;
    this.grooveLevels = this.songConfig.grooveLevels.map((grooveLevel) => grooveLevel.level);
    this.world = new World(canvas);
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

    this.canvas.addEventListener("pointerdown", this.handleCanvasPointerDown);
    this.canvas.addEventListener("pointermove", this.handleCanvasPointerMove);
    this.canvas.addEventListener("pointerup", this.handleCanvasPointerUp);
    this.canvas.addEventListener("pointercancel", this.handleCanvasPointerUp);
    window.addEventListener("resize", this.handleResize);
  }

  start(): void {
    this.world.engine.runRenderLoop(() => {
      const now = performance.now();
      const deltaTime = Math.min((now - this.lastFrameTime) / 1000, GAME_CONFIG.maxDeltaTime);
      this.lastFrameTime = now;

      if (!this.paused) {
        this.tick(deltaTime);
      }

      this.overlay.update(this.getOverlayState());
      this.world.render();
    });
  }

  dispose(): void {
    this.canvas.removeEventListener("pointerdown", this.handleCanvasPointerDown);
    this.canvas.removeEventListener("pointermove", this.handleCanvasPointerMove);
    this.canvas.removeEventListener("pointerup", this.handleCanvasPointerUp);
    this.canvas.removeEventListener("pointercancel", this.handleCanvasPointerUp);
    window.removeEventListener("resize", this.handleResize);
    this.input.dispose();
    this.music.dispose();
    this.world.dispose();
  }

  async beginFromSelection(): Promise<void> {
    this.started = true;
    this.songCompleted = false;
    this.launchCountdownUntil = performance.now() + LAUNCH_COUNTDOWN_STEP_MS * LAUNCH_COUNTDOWN_STEPS;
    await this.music.unlock();
    this.overlay.playLaunchCountdown();
  }

  private tick(deltaTime: number): void {
    this.megaComboCooldown = Math.max(0, this.megaComboCooldown - deltaTime);
    this.music.update();
    const grooveLandingEvent = this.music.consumeGrooveLandingEvent();
    if (grooveLandingEvent) {
      this.applySpawnProfileForLevel(grooveLandingEvent.level);
      this.overlay.triggerGrooveLandingFlash();
    }
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

    if (performance.now() < this.launchCountdownUntil) {
      return;
    }

    if (this.songCompleted) {
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

    this.spawner.frozen = this.freezeSpawning;
    const requests = this.spawner.update(deltaTime, bounds, this.world.getObjectCount());
    for (const request of requests) {
      const object = this.world.spawnObject(
        request.type,
        request.x,
        request.velocityX,
        request.velocityY,
        request.specialFormationId,
        request.formationColor,
      );

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
    this.started = true;
    this.songCompleted = false;
  }

  private handleCanvasPointerDown = (event: PointerEvent): void => {
    void this.unlockAudio();

    if (!this.isDirectTouchPointer(event)) {
      return;
    }

    this.activeTouchPointerId = event.pointerId;
    this.touchPlayerTargetX = this.pointerEventToWorldX(event);
    this.playerX = this.world.clampPlayerX(this.touchPlayerTargetX);
    this.world.setPlayerX(this.playerX);
    this.canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  private handleCanvasPointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.activeTouchPointerId || !this.isDirectTouchPointer(event)) {
      return;
    }

    this.touchPlayerTargetX = this.pointerEventToWorldX(event);
    event.preventDefault();
  };

  private handleCanvasPointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.activeTouchPointerId) {
      return;
    }

    this.touchPlayerTargetX = null;
    this.activeTouchPointerId = null;

    if (this.canvas.hasPointerCapture(event.pointerId)) {
      this.canvas.releasePointerCapture(event.pointerId);
    }
  };

  private handleResize = (): void => {
    this.world.resize();
  };

  private isDirectTouchPointer(event: PointerEvent): boolean {
    return event.pointerType === "touch" || event.pointerType === "pen";
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
    this.paused = !this.paused;
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
    this.spawner.reset();
    this.world.reset();
    this.world.setPlayerX(this.playerX = 0);
    this.specialFormations.clear();
    this.megaComboCooldown = 0;
    this.grooveCharge = 0;
    this.songCompleted = false;
    this.lastBackdropBarIndex = -1;
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
    this.grooveCharge = Math.min(GROOVE_TARGET, this.grooveCharge + amount);
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

  private getOverlayState(): OverlayState {
    const pendingGrooveBoost = this.music.getPendingGrooveBoost();

    return {
      started: this.started,
      songCompleted: this.songCompleted,
      songCompletionTitle: "Fade Reached",
      songCompletionMessage: "The final one-shot has landed. Replay the song to run the whole arc again.",
      activeObjects: this.world.getObjectCount(),
      rootNote: this.music.rootNote,
      mode: this.music.mode,
      liveMode: this.liveMode,
      hudVisible: this.hudVisible,
      spawnInterval: this.spawner.spawnInterval,
      spawnLiveInterval: this.spawner.currentInterval,
      spawnPattern: this.spawner.spawnPattern,
      grooveCharge: this.grooveCharge,
      grooveTarget: GROOVE_TARGET,
      grooveLevel: this.music.currentGrooveLevel,
      grooveLayerLabel: this.getGrooveLayerLabel(),
      grooveBoostIncoming: pendingGrooveBoost !== null,
      grooveBoostTargetLevel: pendingGrooveBoost?.targetLevel ?? null,
      grooveBoostIntensity: pendingGrooveBoost?.intensity ?? 0,
      activeFormationCaught: this.getActiveFormationSummary().caught,
      activeFormationRequired: this.getActiveFormationSummary().required,
      activeFormationVisible: this.getActiveFormationSummary().visible,
      paused: this.paused,
      muted: this.muted,
      freezeSpawning: this.freezeSpawning,
      debugLabels: this.debugLabels,
      masterVolume: this.music.volume,
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

    return {
      caught: bestCaught,
      required: bestRequired,
      visible: bestRequired > 0,
    };
  }

  private getGrooveLayerLabel(): string {
    if (this.songCompleted) {
      return "Song Complete";
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

    const normalizedCharge = clamp(charge / GROOVE_TARGET, 0, 1);
    const grooveIndex = Math.round(normalizedCharge * (this.grooveLevels.length - 1));
    return this.grooveLevels[grooveIndex];
  }

  private syncSongCompletionState(): void {
    const songCompleted = this.music.isSongCompleted();
    if (!songCompleted || this.songCompleted) {
      return;
    }

    this.songCompleted = true;
    this.overlay.showNoteLabel("Locked In", this.canvas.clientWidth * 0.5, 94, "#ffca6e", "banner");
    this.overlay.showNoteLabel("Track Complete", this.canvas.clientWidth * 0.5, 94, "#eaf7ff", "banner");
    this.onSongCompleted?.();
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
