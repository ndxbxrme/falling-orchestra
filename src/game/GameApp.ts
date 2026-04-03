import { Vector2 } from "@babylonjs/core/Maths/math.vector";
import { GAME_CONFIG } from "./config";
import { InputController } from "./InputController";
import { MusicSystem } from "./MusicSystem";
import { PlatformTool } from "./PlatformTool";
import { Spawner } from "./Spawner";
import { UIOverlay } from "./UIOverlay";
import { World } from "./World";
import type { MusicalObject, OverlayState, RootNoteName, ScaleModeName, SpawnPattern, Surface } from "./types";

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const GROOVE_SNARE_THRESHOLD = 3;
const GROOVE_HATS_THRESHOLD = 6;
const GROOVE_DRONE_THRESHOLD = 9;
const GROOVE_TARGET = GROOVE_DRONE_THRESHOLD;
const MEGA_COMBO_THRESHOLD = 6.4;
const MEGA_COMBO_COOLDOWN = 1.1;
const MEGA_COMBO_REWARD = 2;

interface FormationProgress {
  total: number;
  touched: Set<number>;
  resolved: Set<number>;
  awarded: boolean;
}

export class GameApp {
  private world: World;
  private music = new MusicSystem();
  private spawner = new Spawner();
  private platformTool = new PlatformTool();
  private input: InputController;
  private overlay: UIOverlay;
  private playerX = 0;
  private started = false;
  private paused = false;
  private muted = false;
  private liveMode = false;
  private hudVisible = true;
  private freezeSpawning = false;
  private debugLabels = false;
  private grooveCharge = 0;
  private snareUnlocked = false;
  private hatsUnlocked = false;
  private droneUnlocked = false;
  private specialFormations = new Map<string, FormationProgress>();
  private lastBackdropBarIndex = -1;
  private lastFrameTime = performance.now();
  private megaComboCooldown = 0;

  constructor(private canvas: HTMLCanvasElement, overlayRoot: HTMLDivElement) {
    this.world = new World(canvas);

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
    window.removeEventListener("resize", this.handleResize);
    this.input.dispose();
    this.music.dispose();
    this.world.dispose();
  }

  private tick(deltaTime: number): void {
    this.megaComboCooldown = Math.max(0, this.megaComboCooldown - deltaTime);
    this.music.update();
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

    const bounds = this.world.getBounds();
    this.playerX = clamp(
      this.playerX + this.input.horizontalAxis * GAME_CONFIG.playerSpeed * deltaTime,
      bounds.left + 3.2,
      bounds.right - 3.2,
    );
    this.world.setPlayerX(this.playerX);

    this.platformTool.update(deltaTime);
    this.world.syncTemporaryPlatforms(this.platformTool.getPlatforms());

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
  }

  private handleCanvasPointerDown = (event: PointerEvent): void => {
    void this.unlockAudio();

    const rect = this.canvas.getBoundingClientRect();
    const bounds = this.world.getBounds();
    const x =
      bounds.left + ((event.clientX - rect.left) / rect.width) * (bounds.right - bounds.left);
    const y =
      bounds.top - ((event.clientY - rect.top) / rect.height) * (bounds.top - bounds.bottom);

    this.platformTool.place(x, y, bounds);
    this.world.syncTemporaryPlatforms(this.platformTool.getPlatforms());
  };

  private handleResize = (): void => {
    this.world.resize();
  };

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

    if (object.specialFormationId && (surface.kind === "player" || surface.kind === "temporary")) {
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
    this.platformTool.reset();
    this.spawner.reset();
    this.world.reset();
    this.world.setPlayerX(this.playerX = 0);
    this.specialFormations.clear();
    this.megaComboCooldown = 0;
    this.grooveCharge = 0;
    this.snareUnlocked = false;
    this.hatsUnlocked = false;
    this.droneUnlocked = false;
    this.music.setSnareEnabled(false);
    this.music.setHatsEnabled(false);
    this.music.setDroneEnabled(false);
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
    if (this.grooveCharge >= GROOVE_SNARE_THRESHOLD && !this.snareUnlocked) {
      this.snareUnlocked = true;
      this.music.setSnareEnabled(true);
      this.overlay.showNoteLabel(
        "Snare Unlocked",
        this.canvas.clientWidth * 0.5,
        84,
        "#ffca6e",
        "banner",
      );
    }

    if (this.grooveCharge >= GROOVE_HATS_THRESHOLD && !this.hatsUnlocked) {
      this.hatsUnlocked = true;
      this.music.setHatsEnabled(true);
      this.overlay.showNoteLabel(
        "Hats Unlocked",
        this.canvas.clientWidth * 0.5,
        84,
        "#9fedff",
        "banner",
      );
    }

    if (this.grooveCharge >= GROOVE_DRONE_THRESHOLD && !this.droneUnlocked) {
      this.droneUnlocked = true;
      this.music.setDroneEnabled(true);
      this.overlay.showNoteLabel(
        "Drone Unlocked",
        this.canvas.clientWidth * 0.5,
        84,
        "#c5d4ff",
        "banner",
      );
    }
  }

  private getRequiredFormationCatches(total: number): number {
    const allowedMisses = total >= 10 ? 2 : 1;
    return Math.max(1, total - allowedMisses);
  }

  private getOverlayState(): OverlayState {
    return {
      started: this.started,
      activeObjects: this.world.getObjectCount(),
      activePlatforms: this.platformTool.getPlatforms().length,
      rootNote: this.music.rootNote,
      mode: this.music.mode,
      liveMode: this.liveMode,
      hudVisible: this.hudVisible,
      spawnInterval: this.spawner.spawnInterval,
      spawnLiveInterval: this.spawner.currentInterval,
      spawnPattern: this.spawner.spawnPattern,
      grooveCharge: this.grooveCharge,
      grooveTarget: GROOVE_TARGET,
      snareUnlocked: this.snareUnlocked,
      hatsUnlocked: this.hatsUnlocked,
      droneUnlocked: this.droneUnlocked,
      grooveLayerLabel: this.getGrooveLayerLabel(),
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
    if (this.droneUnlocked) {
      return "Kick + Snare + Hats + Drone";
    }

    if (this.hatsUnlocked) {
      return "Kick + Snare + Hats";
    }

    if (this.snareUnlocked) {
      return "Kick + Snare";
    }

    return "Kick Only";
  }

  private getGrooveIntensity(): number {
    if (this.droneUnlocked) {
      return 1;
    }

    if (this.hatsUnlocked) {
      return 0.72;
    }

    if (this.snareUnlocked) {
      return 0.42;
    }

    return 0.16;
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
