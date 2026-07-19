import type { EventBus } from '../core/EventBus';
import type { SaveSystem } from './SaveSystem';

/**
 * WebAudio 占位音（决策 D6，M4 前）：
 * - 钵音：振荡器合成（基频 + 泛音，约 1.5s 指数衰减），LightingRitual t=0 复用同一函数；
 * - UI 点击音：短促正弦 blip；
 * - 首次用户手势解锁 AudioContext；静音状态读写存档，即时生效。
 */
export class AudioSystem {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private muted: boolean;

  constructor(deps: { bus: EventBus; save: SaveSystem }) {
    const { bus, save } = deps;
    this.muted = save.data.settings.muted;

    const unlock = (): void => {
      this.ensureContext();
      void this.ctx?.resume();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);

    bus.on('settings:muted', ({ muted }) => {
      this.muted = muted;
      if (this.master && this.ctx) {
        this.master.gain.setTargetAtTime(muted ? 0 : 1, this.ctx.currentTime, 0.02);
      }
    });
  }

  private ensureContext(): void {
    if (this.ctx) return;
    const AC = window.AudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 1;
    this.master.connect(this.ctx.destination);
  }

  /** 钵音：基频 + 两个泛音，1.5s 指数衰减。不刺耳优先（D6）。 */
  playBowl(): void {
    this.ensureContext();
    if (!this.ctx || !this.master) return;
    void this.ctx.resume();
    const t0 = this.ctx.currentTime;
    const partials: Array<{ freq: number; gain: number }> = [
      { freq: 196, gain: 0.5 }, // G3 基频
      { freq: 196 * 2.76, gain: 0.18 }, // 非谐泛音，模拟钵体
      { freq: 196 * 5.4, gain: 0.06 },
    ];
    for (const p of partials) {
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = p.freq;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(p.gain, t0 + 0.015); // 极短起音避免爆音
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.5);
      osc.connect(g).connect(this.master);
      osc.start(t0);
      osc.stop(t0 + 1.6);
    }
  }

  /** UI 点击音：80ms 短 blip。 */
  playClick(): void {
    this.ensureContext();
    if (!this.ctx || !this.master) return;
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(660, t0);
    osc.frequency.exponentialRampToValueAtTime(440, t0 + 0.08);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.12, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.09);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + 0.1);
  }
}
