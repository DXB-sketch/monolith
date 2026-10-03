import type { QualityTier, SceneTier } from './quality';

export interface SceneOptions {
  tier: SceneTier;
  onFirstFrame?: () => void;
  onTierChange?: (tier: QualityTier) => void;
}

export interface SceneHandle {
  setProgress(p: number): void;
  setChapter(index: number): void;
  setPointer(x: number, y: number): void;
  pause(): void;
  resume(): void;
  dispose(): void;
}

export async function createScene(
  _canvas: HTMLCanvasElement,
  _options: SceneOptions,
): Promise<SceneHandle> {
  throw new Error('Scene not implemented yet');
}
