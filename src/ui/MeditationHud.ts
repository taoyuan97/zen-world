import type { MeditationScript } from '../data/types';

const RING_RADIUS = 54;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
const CUE_FADE_MS = 600;

/**
 * 冥想 HUD（TDD §7 / 验收 §1 步骤 8-9）：
 * - SVG 圆环进度（stroke-dashoffset）+ 剩余时间；
 * - 引导语淡入淡出；
 * - CSS 呼吸环（WAAPI 驱动，周期由 breathCycle 内联变量/keyframes 控制）；
 * - "隐藏界面"按钮（保留小圆点可恢复）；
 * - 自动暂停遮罩（"已为你暂停 · 点击继续"）。
 */
export class MeditationHud {
  private breathAnim: Animation | null = null;
  private cueTimer: number | null = null;
  private hidden2 = false;

  constructor(
    private els: {
      root: HTMLElement;
      ringFg: SVGCircleElement;
      timeLabel: HTMLElement;
      cue: HTMLElement;
      breath: HTMLElement;
      hideBtn: HTMLButtonElement;
      showBtn: HTMLButtonElement;
      pausedMask: HTMLElement;
      resumeBtn: HTMLButtonElement;
    },
    private callbacks: { onResume: () => void },
  ) {
    els.hideBtn.addEventListener('click', () => this.setHidden(true));
    els.showBtn.addEventListener('click', () => this.setHidden(false));
    els.resumeBtn.addEventListener('click', () => this.callbacks.onResume());
  }

  show(script: MeditationScript): void {
    this.els.root.classList.remove('hidden');
    this.setHidden(false);
    this.setPaused(false);
    this.setCue('');
    this.updateProgress(0, script.duration);
    this.startBreath(script.breathCycle.inhale, script.breathCycle.exhale);
  }

  hide(): void {
    this.els.root.classList.add('hidden');
    this.breathAnim?.cancel();
    this.breathAnim = null;
    if (this.cueTimer !== null) {
      window.clearTimeout(this.cueTimer);
      this.cueTimer = null;
    }
  }

  updateProgress(elapsed: number, duration: number): void {
    const k = Math.min(elapsed / duration, 1);
    this.els.ringFg.style.strokeDashoffset = String(RING_CIRCUMFERENCE * (1 - k));
    const remaining = Math.max(0, Math.ceil(duration - elapsed));
    const mm = Math.floor(remaining / 60);
    const ss = remaining % 60;
    this.els.timeLabel.textContent = `${mm}:${String(ss).padStart(2, '0')}`;
  }

  /** 引导语淡入淡出：先淡出旧文本，换文案后淡入。 */
  setCue(text: string): void {
    const cue = this.els.cue;
    if (this.cueTimer !== null) window.clearTimeout(this.cueTimer);
    cue.classList.remove('cue-visible');
    this.cueTimer = window.setTimeout(() => {
      cue.textContent = text;
      if (text) cue.classList.add('cue-visible');
      this.cueTimer = null;
    }, text ? CUE_FADE_MS / 2 : 0);
  }

  setPaused(paused: boolean): void {
    this.els.pausedMask.classList.toggle('hidden', !paused);
    if (paused) this.breathAnim?.pause();
    else this.breathAnim?.play();
  }

  get isPausedMaskShown(): boolean {
    return !this.els.pausedMask.classList.contains('hidden');
  }

  private setHidden(hidden: boolean): void {
    this.hidden2 = hidden;
    this.els.root.classList.toggle('hud-collapsed', hidden);
    this.els.showBtn.classList.toggle('hidden', !hidden);
  }

  private startBreath(inhale: number, exhale: number): void {
    this.breathAnim?.cancel();
    const total = inhale + exhale;
    // 周期由 breathCycle 驱动（等价内联变量控制，WAAPI 允许非对称吸/呼时长）
    this.els.root.style.setProperty('--breath-cycle', `${total}s`);
    this.breathAnim = this.els.breath.animate(
      [
        { transform: 'scale(0.72)', offset: 0 },
        { transform: 'scale(1.0)', offset: inhale / total },
        { transform: 'scale(0.72)', offset: 1 },
      ],
      { duration: total * 1000, iterations: Infinity, easing: 'ease-in-out' },
    );
  }
}

export const RING_GEOMETRY = { radius: RING_RADIUS, circumference: RING_CIRCUMFERENCE };
