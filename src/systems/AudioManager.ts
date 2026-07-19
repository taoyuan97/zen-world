import { Howl, Howler } from 'howler';
import type { EventBus } from '../core/EventBus';
import type { SaveSystem } from './SaveSystem';

/**
 * AudioManager（M4 任务 4.1，Howler 实现，替代 M1~M3 的 WebAudio 占位 AudioSystem）：
 * - 音量分组：ambience / voice / sfx 三组，主静音开关（settings:muted）同时控制三组；
 * - 环境音：进山渐起（2s fade-in）、出山渐弱（1.2s fade-out），WebAudio 整段缓冲循环
 *   （html5:false，避免 HTMLAudio 循环接缝，决策 D2）；
 * - 语音引导：按 cue 预载 Howl，同一时间轴到点 play（任务 4.2，偏差 <300ms 见 4.3 说明）；
 * - 首次用户手势解锁 AudioContext（Howler 自动处理 + 显式 resume，兼容 iOS Safari，TDD §12）；
 * - 标签页后台：暂停环境音与语音（Howler.ctx 级 mute + 停 voice），回前台按静音设置恢复。
 *
 * 资源清单来自 public/audio/voice/manifest.json（生成脚本 tools/gen_audio.py 产出，
 * 含每条语音时长 duration，供 cue 时间轴微调）；缺失条目回退纯文字（决策 D1）。
 */

export type SfxName = 'lit' | 'complete' | 'ui-confirm' | 'ui-open';

interface VoiceManifestEntry {
  hillId: string;
  minutes: number;
  index: number;
  t: number;
  text: string;
  file: string;
  ok: boolean;
  duration?: number;
}

interface VoiceManifest {
  voiceId: string;
  entries: VoiceManifestEntry[];
  missing: VoiceManifestEntry[];
}

const VOL = { ambience: 0.55, voice: 0.9, sfx: 0.7 } as const;
const AMBIENCE_FADE_IN_MS = 2000;
const AMBIENCE_FADE_OUT_MS = 1200;

export class AudioManager {
  private muted: boolean;
  private manifest: VoiceManifest | null = null;
  private manifestReady: Promise<void>;
  private ambience: { hillId: string; howl: Howl } | null = null;
  private voice: Howl | null = null;
  private sfx = new Map<SfxName, Howl>();
  private suspendedByHidden = false;

  constructor(deps: { bus: EventBus; save: SaveSystem }) {
    const { bus, save } = deps;
    this.muted = save.data.settings.muted;
    Howler.volume(this.muted ? 0 : 1);

    // iOS Safari：首次手势解锁 AudioContext（Howler 内部也做，这里显式兜底）
    const unlock = (): void => {
      void Howler.ctx?.resume();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);

    bus.on('settings:muted', ({ muted }) => {
      this.muted = muted;
      if (!this.suspendedByHidden) Howler.volume(muted ? 0 : 1);
    });

    // 后台标签页：音频暂停；回前台恢复（任务 4.1 / 验收第 5 条）
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.suspendedByHidden = true;
        Howler.volume(0);
        this.stopVoice();
        this.ambience?.howl.pause();
      } else {
        this.suspendedByHidden = false;
        Howler.volume(this.muted ? 0 : 1);
        if (this.ambience && !this.ambience.howl.playing()) this.ambience.howl.play();
      }
    });

    this.manifestReady = this.loadManifest();
  }

  private async loadManifest(): Promise<void> {
    try {
      const res = await fetch('audio/voice/manifest.json');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.manifest = (await res.json()) as VoiceManifest;
    } catch (err) {
      console.warn('[AudioManager] 语音清单加载失败，全程回退纯文字 cue（D1）', err);
      this.manifest = { voiceId: '', entries: [], missing: [] };
    }
  }

  // ---------- 环境音 ----------

  /** 进山：环境音渐起；与旧环境音交叉淡化。 */
  startAmbience(hillId: string): void {
    if (this.ambience?.hillId === hillId) return;
    this.stopAmbience();
    const howl = new Howl({
      src: [`audio/ambience/${hillId}.mp3`],
      loop: true,
      html5: false, // 整段缓冲，循环无缝（D2）
      volume: 0,
      onloaderror: (_id, err) => {
        console.warn(`[AudioManager] 环境音缺失 ${hillId}，静默回退（D1）`, err);
        if (this.ambience?.howl === howl) this.ambience = null;
      },
    });
    this.ambience = { hillId, howl };
    howl.play();
    howl.fade(0, VOL.ambience, AMBIENCE_FADE_IN_MS);
  }

  /** 出山：环境音渐弱后卸载。 */
  stopAmbience(): void {
    const current = this.ambience;
    if (!current) return;
    this.ambience = null;
    current.howl.fade(current.howl.volume(), 0, AMBIENCE_FADE_OUT_MS);
    window.setTimeout(() => current.howl.unload(), AMBIENCE_FADE_OUT_MS + 60);
  }

  // ---------- 语音引导（任务 4.2） ----------

  /**
   * 预载某山某档全部 cue 语音。返回 index → { howl, duration }；
   * 缺失/加载失败的 cue 不出现在表中，调用方回退纯文字。
   */
  async preloadVoice(
    hillId: string,
    minutes: number,
  ): Promise<Map<number, { howl: Howl; duration: number }>> {
    await this.manifestReady;
    const result = new Map<number, { howl: Howl; duration: number }>();
    if (!this.manifest) return result;
    const entries = this.manifest.entries.filter(
      (e) => e.ok && e.hillId === hillId && e.minutes === minutes,
    );
    await Promise.all(
      entries.map(
        (e) =>
          new Promise<void>((resolve) => {
            const howl = new Howl({
              src: [e.file],
              volume: VOL.voice,
              onload: () => {
                result.set(e.index, { howl, duration: e.duration ?? howl.duration() });
                resolve();
              },
              onloaderror: () => resolve(), // 缺失即回退纯文字，不阻塞
            });
          }),
      ),
    );
    return result;
  }

  /** 播放一条 cue 语音（与文字 cue 同一时间轴触发，任务 4.3）。 */
  playVoice(howl: Howl): void {
    this.stopVoice();
    this.voice = howl;
    howl.play();
  }

  stopVoice(): void {
    this.voice?.stop();
    this.voice = null;
  }

  // ---------- 音效 ----------

  playSfx(name: SfxName): void {
    let howl = this.sfx.get(name);
    if (!howl) {
      howl = new Howl({
        src: [`audio/sfx/${name}.mp3`],
        volume: VOL.sfx,
        onloaderror: () => this.sfx.delete(name), // 缺失静默回退
      });
      this.sfx.set(name, howl);
    }
    howl.play();
  }

  /** 兼容 M1~M3 调用点：点亮钵音 → 生成的颂钵音效。 */
  playBowl(): void {
    this.playSfx('lit');
  }

  /** 兼容 M1~M3 调用点：UI 点击音。 */
  playClick(): void {
    this.playSfx('ui-confirm');
  }
}
