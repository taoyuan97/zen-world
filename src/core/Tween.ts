export type EaseFn = (t: number) => number;

export const Ease = {
  linear: ((t: number) => t) as EaseFn,
  quadOut: ((t: number) => 1 - (1 - t) * (1 - t)) as EaseFn,
  cubicOut: ((t: number) => 1 - Math.pow(1 - t, 3)) as EaseFn,
  sineInOut: ((t: number) => -(Math.cos(Math.PI * t) - 1) / 2) as EaseFn,
};

interface TweenItem {
  elapsed: number;
  duration: number;
  ease: EaseFn;
  onUpdate: (k: number) => void;
  onComplete?: () => void;
}

/** 轻量补间：由宿主的 update(dt) 驱动，dt 单位秒（TDD §4.5）。 */
export class Tweens {
  private items: TweenItem[] = [];

  add(opts: {
    duration: number;
    ease?: EaseFn;
    onUpdate: (k: number) => void;
    onComplete?: () => void;
  }): void {
    this.items.push({
      elapsed: 0,
      duration: Math.max(opts.duration, 0.0001),
      ease: opts.ease ?? Ease.sineInOut,
      onUpdate: opts.onUpdate,
      onComplete: opts.onComplete,
    });
  }

  update(dt: number): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const tw = this.items[i];
      tw.elapsed += dt;
      const t = Math.min(tw.elapsed / tw.duration, 1);
      tw.onUpdate(tw.ease(t));
      if (t >= 1) {
        this.items.splice(i, 1);
        tw.onComplete?.();
      }
    }
  }

  clear(): void {
    this.items.length = 0;
  }
}
