import type { EventBus } from '../core/EventBus';
import { Timeline } from '../core/Timeline';
import type { MeditationScript } from '../data/types';

interface SessionOpts {
  onComplete: () => void;
  debug?: boolean; // 仅调试模式响应 debug:time-scale
  /** M4 不限时模式：cue 播完后不自动完成，Esc 中断退出且不计进度（B2b 无限冥想）。 */
  free?: boolean;
}

const TICK_MS = 250; // HUD 进度刷新间隔

/**
 * 冥想会话核心（TDD §6.3）：
 * - 计时用 performance.now() 差值（Timeline 内部实现），杜绝 dt 累加误差；
 * - pause/resume/abort；visibilitychange hidden 自动暂停并 emit meditation:paused-auto；
 * - cue 调度由内部 Timeline 完成，到点 emit meditation:cue；
 * - elapsed >= duration 且最后 cue 已触发 → 完成。
 */
export class MeditationSession {
  private timeline = new Timeline();
  private script: MeditationScript | null = null;
  private timer: number | null = null;
  private completed = false;
  private free = false;
  private onComplete: (() => void) | null = null;
  private disposers: Array<() => void> = [];

  constructor(
    private bus: EventBus,
    private hillId: string,
  ) {}

  get isActive(): boolean {
    return this.script !== null && !this.completed;
  }

  start(script: MeditationScript, opts: SessionOpts): void {
    this.disposeListeners();
    this.script = script;
    this.completed = false;
    this.free = !!opts.free;
    this.onComplete = opts.onComplete;

    this.timeline = new Timeline();
    script.cues.forEach((cue, index) => {
      this.timeline.add(cue.t, () => this.bus.emit('meditation:cue', { text: cue.text, index }));
    });

    // 页面隐藏自动暂停（TDD §6.3）
    const onVisibility = (): void => {
      if (document.hidden && this.isActive && this.timeline.isRunning) {
        this.pause();
        this.bus.emit('meditation:paused-auto', {});
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    this.disposers.push(() => document.removeEventListener('visibilitychange', onVisibility));

    // 调试加速（仅 ?debug 模式注入）
    if (opts.debug) {
      this.disposers.push(
        this.bus.on('debug:time-scale', ({ scale }) => this.timeline.setScale(scale)),
      );
    }

    this.timeline.start();
    this.bus.emit('meditation:progress', { elapsed: 0, duration: script.duration });
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
  }

  pause(): void {
    this.timeline.pause();
  }

  resume(): void {
    if (!this.isActive) return;
    this.timeline.resume();
    this.bus.emit('meditation:resumed', {});
  }

  /** 中途退出：不计完成（验收标准第 4 条）。 */
  abort(): void {
    this.teardown();
  }

  private tick(): void {
    if (!this.isActive || !this.script) return;
    // try/catch 保底：任何下游异常都不能阻断完成判定（ISSUE-M2-001 F3）
    try {
      this.timeline.tick();
      const elapsed = this.timeline.elapsed;
      this.bus.emit('meditation:progress', { elapsed, duration: this.script.duration });
      if (!this.free && elapsed >= this.script.duration) {
        this.completed = true;
        const seconds = this.script.duration;
        console.info(`[MeditationSession] complete @${elapsed.toFixed(2)}s / ${seconds}s`);
        this.teardown();
        this.bus.emit('meditation:complete', { hillId: this.hillId, seconds });
        this.onComplete?.();
      }
    } catch (err) {
      console.error('[MeditationSession] tick error', err);
    }
  }

  private teardown(): void {
    this.timeline.stop();
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    this.disposeListeners();
    this.script = null;
    this.onComplete = null;
  }

  private disposeListeners(): void {
    for (const d of this.disposers) d();
    this.disposers = [];
  }
}
