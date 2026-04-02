import { GAME_CONFIG } from "./config";
import type { ArenaBounds, TemporaryPlatform } from "./types";

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export class PlatformTool {
  private platforms: TemporaryPlatform[] = [];
  private nextId = 0;

  update(deltaTime: number): void {
    this.platforms = this.platforms
      .map((platform) => ({ ...platform, ttl: platform.ttl - deltaTime }))
      .filter((platform) => platform.ttl > 0);
  }

  place(x: number, y: number, bounds: ArenaBounds): void {
    const clampedX = clamp(x, bounds.left + 2.6, bounds.right - 2.6);
    const clampedY = clamp(y, bounds.floorY + 1.9, bounds.top - 2.2);
    const transpose = Math.round((clampedY - bounds.floorY) * 0.9);

    const platform: TemporaryPlatform = {
      id: `platform-${this.nextId += 1}`,
      x: clampedX,
      y: clampedY,
      length: GAME_CONFIG.platformLength,
      ttl: GAME_CONFIG.platformLifetime,
      transpose,
    };

    this.platforms = [platform, ...this.platforms].slice(0, GAME_CONFIG.maxPlatforms);
  }

  getPlatforms(): TemporaryPlatform[] {
    return this.platforms;
  }

  reset(): void {
    this.platforms = [];
  }
}
