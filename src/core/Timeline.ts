interface TimelineCue {
  t: number; // 秒
  fn: () => void;
}

/**
 * 时间轴：注册 { t, fn } 序列，performance.now() 差值驱动（TDD §4.5）。
 * 支持 pause/resume/seek/stop、时间缩放（仅调试模式使用），到期回调去重触发。
 */
export class Timeline {
  private cues: TimelineCue[] = [];
  private fired = new Set<number>();
  private running = false;
  private baseElapsed = 0; // 已结算的虚拟秒
  private baseNow = 0; // 结算锚点（performance.now()）
  private scale = 1;

  /** 当前虚拟时间（秒）。 */
  get elapsed(): number {
    if (!this.running) return this.baseElapsed;
    return this.baseElapsed + ((performance.now() - this.baseNow) / 1000) * this.scale;
  }

  get isRunning(): boolean {
    return this.running;
  }

  add(t: number, fn: () => void): this {
    this.cues.push({ t, fn });
    this.cues.sort((a, b) => a.t - b.t);
    return this;
  }

  start(): void {
    this.stop();
    this.running = true;
    this.baseElapsed = 0;
    this.baseNow = performance.now();
    this.tick();
  }

  pause(): void {
    if (!this.running) return;
    this.baseElapsed = this.elapsed;
    this.running = false;
  }

  resume(): void {
    if (this.running) return;
    this.baseNow = performance.now();
    this.running = true;
  }

  stop(): void {
    this.running = false;
    this.baseElapsed = 0;
    this.fired.clear();
  }

  seek(seconds: number): void {
    const wasRunning = this.running;
    this.baseElapsed = Math.max(0, seconds);
    this.baseNow = performance.now();
    this.fired.clear();
    // seek 之后的 cue 才允许再触发
    this.cues.forEach((c, i) => {
      if (c.t <= this.baseElapsed) this.fired.add(i);
    });
    if (wasRunning) this.tick();
  }

  /** 调试加速：改变缩放时把已流逝时间结算进 base，避免跳变。 */
  setScale(scale: number): void {
    if (scale <= 0 || scale === this.scale) return;
    this.baseElapsed = this.elapsed;
    this.baseNow = performance.now();
    this.scale = scale;
  }

  /** 每帧/每间隔调用：触发到点 cue（去重）。 */
  tick(): void {
    if (!this.running) return;
    const now = this.elapsed;
    for (let i = 0; i < this.cues.length; i++) {
      if (this.fired.has(i)) continue;
      if (this.cues[i].t <= now) {
        this.fired.add(i);
        this.cues[i].fn();
      } else {
        break; // cues 已按 t 升序
      }
    }
  }
}
