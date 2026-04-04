import { GAME_CONFIG } from "./config";
import type { ArenaBounds, ObjectType, SpawnPattern } from "./types";

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export interface SpawnRequest {
  type: ObjectType;
  x: number;
  velocityX?: number;
  velocityY?: number;
  specialFormationId?: string;
  formationTotal?: number;
  formationColor?: string;
}

type SpecialBurstPattern = "snakeBell" | "sparkRibbon" | "bassMarch" | "snareRoll";

interface SpecialBurst {
  id: string;
  pattern: SpecialBurstPattern;
  index: number;
  count: number;
  stepInterval: number;
  nextSpawnIn: number;
  direction: number;
  centerBias: number;
  amplitude: number;
  waveCount: number;
}

export class Spawner {
  spawnInterval: number = GAME_CONFIG.spawnIntervalDefault;
  currentInterval: number = GAME_CONFIG.spawnIntervalDefault;
  spawnPattern: SpawnPattern = "rain";
  frozen = false;

  private time = 0;
  private nextSpawnIn = 0.45;
  private laneIndex = 0;
  private rateWindowIndex = -1;
  private specialWindowIndex = -1;
  private specialBurst: SpecialBurst | null = null;
  private nextSpecialId = 0;
  private megaQueued = false;

  update(deltaTime: number, bounds: ArenaBounds, activeObjects: number): SpawnRequest[] {
    this.time += deltaTime;

    if (this.frozen || activeObjects >= GAME_CONFIG.maxObjects) {
      return [];
    }

    const requests: SpawnRequest[] = [];
    this.nextSpawnIn -= deltaTime;

    while (this.nextSpawnIn <= 0 && activeObjects + requests.length < GAME_CONFIG.maxObjects) {
      this.nextSpawnIn += this.currentInterval;
      requests.push({
        type: this.pickType(),
        x: this.pickX(bounds),
      });
    }

    if (this.specialBurst) {
      this.specialBurst.nextSpawnIn -= deltaTime;

      while (
        this.specialBurst &&
        this.specialBurst.nextSpawnIn <= 0 &&
        activeObjects + requests.length < GAME_CONFIG.maxObjects
      ) {
        this.specialBurst.nextSpawnIn += this.specialBurst.stepInterval;
        requests.push(this.buildSpecialRequest(this.specialBurst, bounds));
        this.specialBurst.index += 1;

        if (this.specialBurst.index >= this.specialBurst.count) {
          this.specialBurst = null;
        }
      }
    }

    if (this.spawnPattern === "swing" && requests.length > 0 && Math.random() < 0.18) {
      const lastRequest = requests[requests.length - 1];

      if (activeObjects + requests.length < GAME_CONFIG.maxObjects) {
        requests.push({
          type: "spark",
          x: clamp(lastRequest.x + (Math.random() - 0.5) * 2.2, bounds.left + 1.5, bounds.right - 1.5),
          velocityX: (lastRequest.velocityX ?? 0) * 0.55,
          velocityY: lastRequest.velocityY,
        });
      }
    }

    if (this.megaQueued && activeObjects + requests.length < GAME_CONFIG.maxObjects) {
      this.megaQueued = false;
      requests.push(this.buildMegaRequest(bounds));
    }

    return requests;
  }

  reset(): void {
    this.time = 0;
    this.nextSpawnIn = 0.4;
    this.laneIndex = 0;
    this.rateWindowIndex = -1;
    this.specialWindowIndex = -1;
    this.currentInterval = this.spawnInterval;
    this.specialBurst = null;
    this.nextSpecialId = 0;
    this.megaQueued = false;
  }

  syncTransportQuarter(quarterIndex: number, activeObjects: number): void {
    const nextWindow = Math.floor(quarterIndex / 4);

    if (nextWindow === this.rateWindowIndex) {
      this.maybeQueueSpecialBurst(quarterIndex, activeObjects);
      return;
    }

    this.rateWindowIndex = nextWindow;
    this.currentInterval = this.randomizedWindowInterval();
    this.nextSpawnIn = Math.min(this.nextSpawnIn, this.currentInterval);
    this.maybeQueueSpecialBurst(quarterIndex, activeObjects);
  }

  private randomizedWindowInterval(): number {
    const baseInterval = Math.max(this.spawnInterval, GAME_CONFIG.spawnIntervalSafeMin);
    return clamp(
      baseInterval * (0.55 + Math.random() * 0.65),
      GAME_CONFIG.spawnIntervalSafeMin,
      GAME_CONFIG.spawnIntervalMax * 1.1,
    );
  }

  private maybeQueueSpecialBurst(quarterIndex: number, activeObjects: number): void {
    if (this.specialBurst || activeObjects > GAME_CONFIG.maxObjects - 10 || quarterIndex <= 0) {
      return;
    }

    const specialWindow = Math.floor(quarterIndex / 16);

    if (specialWindow === this.specialWindowIndex || quarterIndex % 16 !== 0) {
      return;
    }

    this.specialWindowIndex = specialWindow;

    if (Math.random() > 0.38) {
      return;
    }

    const patternRoll = Math.random();

    if (patternRoll < 0.4) {
      this.specialBurst = {
        id: `special-${this.nextSpecialId += 1}`,
        pattern: "snakeBell",
        index: 0,
        count: 11,
        stepInterval: 0.12,
        nextSpawnIn: 0.05,
        direction: Math.random() < 0.5 ? -1 : 1,
        centerBias: [0.32, 0.5, 0.68][Math.floor(Math.random() * 3)],
        amplitude: 0.18,
        waveCount: 0.65,
      };
      return;
    }

    if (patternRoll < 0.68) {
      this.specialBurst = {
        id: `special-${this.nextSpecialId += 1}`,
        pattern: "sparkRibbon",
        index: 0,
        count: 12,
        stepInterval: 0.09,
        nextSpawnIn: 0.05,
        direction: Math.random() < 0.5 ? -1 : 1,
        centerBias: [0.38, 0.5, 0.62][Math.floor(Math.random() * 3)],
        amplitude: 0.24,
        waveCount: 0.9,
      };
      return;
    }

    if (patternRoll < 0.9) {
      this.specialBurst = {
        id: `special-${this.nextSpecialId += 1}`,
        pattern: "snareRoll",
        index: 0,
        count: 22,
        stepInterval: 0.06,
        nextSpawnIn: 0.04,
        direction: Math.random() < 0.5 ? -1 : 1,
        centerBias: [0.34, 0.5, 0.66][Math.floor(Math.random() * 3)],
        amplitude: 0.18,
        waveCount: 0.72,
      };
      return;
    }

    this.specialBurst = {
      id: `special-${this.nextSpecialId += 1}`,
      pattern: "bassMarch",
      index: 0,
      count: 5,
      stepInterval: 0.34,
      nextSpawnIn: 0.06,
      direction: Math.random() < 0.5 ? -1 : 1,
      centerBias: Math.random() < 0.5 ? 0.3 : 0.7,
      amplitude: 0.16,
      waveCount: 0,
    };
  }

  queueMegaSpawn(): void {
    this.megaQueued = true;
  }

  private buildSpecialRequest(burst: SpecialBurst, bounds: ArenaBounds): SpawnRequest {
    if (burst.pattern === "snakeBell") {
      const progress = burst.index / Math.max(1, burst.count - 1);
      const directedProgress = burst.direction > 0 ? progress : 1 - progress;
      const center = bounds.left + burst.centerBias * (bounds.right - bounds.left);
      const amplitude = (bounds.right - bounds.left) * burst.amplitude;
      const angle = directedProgress * Math.PI * 2 * burst.waveCount;
      const waveX = center + Math.sin(angle) * amplitude;

      return {
        type: "bell",
        x: clamp(waveX, bounds.left + 1.5, bounds.right - 1.5),
        velocityX: Math.cos(angle) * 1.3 * burst.direction,
        velocityY: -1.2,
        specialFormationId: burst.id,
        formationTotal: burst.count,
        formationColor: "#ffe594",
      };
    }

    if (burst.pattern === "sparkRibbon") {
      const progress = burst.index / Math.max(1, burst.count - 1);
      const directedProgress = burst.direction > 0 ? progress : 1 - progress;
      const center = bounds.left + burst.centerBias * (bounds.right - bounds.left);
      const spread = (bounds.right - bounds.left) * burst.amplitude;
      const ribbon = Math.sin(directedProgress * Math.PI * 2 * burst.waveCount) * spread;

      return {
        type: "spark",
        x: clamp(center + ribbon, bounds.left + 1.5, bounds.right - 1.5),
        velocityX:
          Math.cos(directedProgress * Math.PI * 2 * burst.waveCount) * 1.9 * burst.direction,
        velocityY: -1.0,
        specialFormationId: burst.id,
        formationTotal: burst.count,
        formationColor: "#baf8ff",
      };
    }

    if (burst.pattern === "snareRoll") {
      const progress = burst.index / Math.max(1, burst.count - 1);
      const directedProgress = burst.direction > 0 ? progress : 1 - progress;
      const center = bounds.left + burst.centerBias * (bounds.right - bounds.left);
      const amplitude = (bounds.right - bounds.left) * burst.amplitude;
      const angle = directedProgress * Math.PI * 2 * burst.waveCount;
      const waveX = center + Math.sin(angle) * amplitude;

      return {
        type: "snare",
        x: clamp(waveX, bounds.left + 1.45, bounds.right - 1.45),
        velocityX: Math.cos(angle) * 1.45 * burst.direction,
        velocityY: -1.12,
        specialFormationId: burst.id,
        formationTotal: burst.count,
        formationColor: "#ffc0dd",
      };
    }

    const laneOffsets = [-0.18, 0.02, 0.2];
    const lane = laneOffsets[burst.index % laneOffsets.length];
    const centerBias = burst.direction > 0 ? 0.26 : 0.74;
    const x = bounds.left + (centerBias + lane) * (bounds.right - bounds.left);

    return {
      type: "bass",
      x: clamp(x, bounds.left + 1.7, bounds.right - 1.7),
      velocityX: -burst.direction * 1.1,
      velocityY: -1.6,
      specialFormationId: burst.id,
      formationTotal: burst.count,
      formationColor: "#ffb7a7",
    };
  }

  private buildMegaRequest(bounds: ArenaBounds): SpawnRequest {
    const center = (bounds.left + bounds.right) * 0.5;
    const spread = (bounds.right - bounds.left) * 0.22;

    return {
      type: "mega",
      x: clamp(center + (Math.random() - 0.5) * spread * 2, bounds.left + 2.2, bounds.right - 2.2),
      velocityX: (Math.random() - 0.5) * 1.4,
      velocityY: -0.85 - Math.random() * 0.5,
    };
  }

  private pickType(): ObjectType {
    const roll = Math.random();

    if (roll < 0.34) {
      return "bass";
    }

    if (roll < 0.59) {
      return "bell";
    }

    if (roll < 0.77) {
      return "snare";
    }

    return "spark";
  }

  private pickX(bounds: ArenaBounds): number {
    if (this.spawnPattern === "lanes") {
      const laneCount = 6;
      this.laneIndex = (this.laneIndex + 1) % laneCount;
      const ratio = (this.laneIndex + (Math.random() * 0.2 - 0.1)) / (laneCount - 1);
      return bounds.left + 1.4 + ratio * (bounds.right - bounds.left - 2.8);
    }

    if (this.spawnPattern === "swing") {
      const swingCenter =
        (bounds.left + bounds.right) * 0.5 +
        Math.sin(this.time * 1.2) * (bounds.right - bounds.left) * 0.26;

      return clamp(
        swingCenter + (Math.random() - 0.5) * 2.6,
        bounds.left + 1.4,
        bounds.right - 1.4,
      );
    }

    return bounds.left + 1.4 + Math.random() * (bounds.right - bounds.left - 2.8);
  }
}
