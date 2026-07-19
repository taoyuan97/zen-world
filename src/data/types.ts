// 数据格式 TS 类型（对齐 TDD 附录 A/B）
export type SceneId = 'map' | 'meditation';

export interface HillPalette {
  primary: string;
  accent1: string;
  accent2: string;
}

export interface HillEnv {
  fog: string;
  sky: 'day' | 'night' | 'sunset';
  decor: string[];
  particles: 'leaves' | 'fireflies' | 'snow' | 'petals' | 'steam' | 'none';
  /** 可选雾距（M3 决策 D2）：缺省 26/85，雾谷等浓雾主题可调近。 */
  fogNear?: number;
  fogFar?: number;
}

export interface HillTeacher {
  name: string;
  color: string;
  prop: string;
}

export interface HillConfig {
  id: string;
  name: string;
  mapPosition: [number, number, number];
  palette: HillPalette;
  env: HillEnv;
  teacher: HillTeacher;
  dialogue: string;
  meditations: { '5': string; '10': string };
}

export interface HillSave {
  lit: boolean;
  firstLitAt?: string;
  sessions: number;
  totalSeconds: number;
}

export interface SaveData {
  version: 1;
  hills: Record<string, HillSave>;
  stats: { totalSessions: number; totalSeconds: number };
  settings: { muted: boolean; onboardingSeen: boolean };
}

// —— 对话剧本（TDD 附录 A）——
export interface DialogueNode {
  id: string;
  text: string;
  next?: string;
  options?: { label: string; reply: string }[];
  action?: string; // 如 'start_meditation'
}

export interface DialogueScript {
  hillId: string;
  teacher: string;
  blessing?: string; // 完成页赠言
  nodes: DialogueNode[]; // 首个节点为入口
}

// —— 冥想引导脚本（TDD 附录 A）——
export interface MeditationCue {
  t: number; // 秒
  text: string;
}

export interface MeditationScript {
  hillId: string;
  duration: number; // 秒
  breathCycle: { inhale: number; exhale: number };
  cues: MeditationCue[]; // 按 t 升序，最后一条 t < duration
}

export interface EventMap {
  'hill:selected': { hillId: string };
  'scene:entered': { id: SceneId };
  'ui:progress': { lit: number; total: number };
  'settings:muted': { muted: boolean };
  'assets:progress': { loaded: number; total: number };
  'debug:toggle-lit': { hillId: string; lit: boolean };
  'debug:time-scale': { scale: number }; // 冥想计时加速（仅 ?debug）
  // —— M2：对话 / 冥想会话 / 点亮演出 ——
  'dialogue:action': { action: string };
  'meditation:cue': { text: string };
  'meditation:progress': { elapsed: number; duration: number };
  'meditation:paused-auto': Record<string, never>;
  'meditation:resumed': Record<string, never>;
  'meditation:abort-request': Record<string, never>; // UI→系统：请求中断确认
  'meditation:abort-confirmed': Record<string, never>; // 确认框→场景：执行中断
  'meditation:aborted': Record<string, never>; // 场景→App：中断完成，返回地图
  'meditation:duration-chosen': { minutes: 5 | 10 }; // 时长面板→场景
  'meditation:duration-cancelled': Record<string, never>; // 时长面板取消→场景
  'meditation:complete': { hillId: string; seconds: number };
  'ritual:done': { hillId: string };
}
