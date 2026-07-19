import type { MeditationCue } from '../data/types';

/**
 * 语音时长驱动的 cue 时间轴微调（M4 任务 4.2）：
 * 语音实际时长来自 manifest（Howler duration 兜底），保证每条 cue 的文字+语音
 * 播完后至少留 MIN_GAP_AFTER_VOICE 秒静默再进入下一条；原脚本间隙普遍 ≥ 20s，
 * 语音 2.5~13s，因此仅个别间隙过紧处会后移，整体时间轴保持原设计。
 * 同步保证（任务 4.3）：文字与语音由同一 Timeline 同一回调触发，结构性偏差 <300ms。
 */
const MIN_GAP_AFTER_VOICE = 3;

export function adjustCueTiming(
  cues: MeditationCue[],
  voiceDurations: Map<number, number>,
  duration: number,
): MeditationCue[] {
  const adjusted: MeditationCue[] = [];
  let shift = 0;
  for (let i = 0; i < cues.length; i++) {
    const t = cues[i].t + shift;
    adjusted.push({ t, text: cues[i].text });
    const voice = voiceDurations.get(i);
    if (voice === undefined) continue;
    const next = cues[i + 1];
    if (next) {
      const minNext = t + voice + MIN_GAP_AFTER_VOICE;
      if (next.t + shift < minNext) shift = minNext - next.t;
    }
  }
  // 末尾保护：最后一条不得顶到 duration（校验不变式 t < duration）
  const last = adjusted[adjusted.length - 1];
  if (last && Number.isFinite(duration) && last.t >= duration) {
    last.t = duration - 1;
  }
  return adjusted;
}
