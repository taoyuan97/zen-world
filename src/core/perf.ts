/**
 * 性能档位（M4 任务 4.4/4.6/4.7）：
 * - high：桌面默认，满粒子密度，pixelRatio ≤ 2；
 * - medium：触屏设备或窄屏，粒子 ×0.6，pixelRatio ≤ 1.5；
 * - low：移动端弱机兜底（`?perf=low` 强制），粒子 ×0.35，pixelRatio = 1。
 * 判定走通用 API（matchMedia/pointer），无浏览器特定分支（任务 4.8）。
 */
export type PerfTier = 'high' | 'medium' | 'low';

export interface PerfProfile {
  tier: PerfTier;
  /** 环境粒子密度倍率（ThemeEnvironment / 地图萤火共用）。 */
  particleScale: number;
  maxPixelRatio: number;
}

const PROFILES: Record<PerfTier, Omit<PerfProfile, 'tier'>> = {
  high: { particleScale: 1, maxPixelRatio: 2 },
  medium: { particleScale: 0.6, maxPixelRatio: 1.5 },
  low: { particleScale: 0.35, maxPixelRatio: 1 },
};

export function detectPerfProfile(): PerfProfile {
  const query = new URLSearchParams(window.location.search);
  const forced = query.get('perf');
  if (forced === 'low' || forced === 'medium' || forced === 'high') {
    return { tier: forced, ...PROFILES[forced] };
  }
  // 粗指针（触屏）或窄屏 → 移动端档位；桌面保持 high
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const narrow = Math.min(window.innerWidth, window.innerHeight) < 720;
  const tier: PerfTier = coarse || narrow ? 'medium' : 'high';
  return { tier, ...PROFILES[tier] };
}
