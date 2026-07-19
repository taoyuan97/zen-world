import type { DialogueScript, HillConfig, MeditationScript } from '../data/types';

const SKY_VALUES = new Set(['day', 'night', 'sunset']);
const PARTICLE_VALUES = new Set(['leaves', 'fireflies', 'snow', 'petals', 'steam', 'none']);
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const MIN_HILL_DISTANCE = 15;
const EXPECTED_HILL_COUNT = 10;

/** 启动时全量校验 hills.json：结构/类型/间距错误 fail-fast；M2/M3 才存在的内容文件仅提示。 */
export function validateHills(raw: unknown): HillConfig[] {
  const errors: string[] = [];

  if (!Array.isArray(raw)) {
    throw new Error('[validate] hills.json 必须是数组');
  }
  if (raw.length !== EXPECTED_HILL_COUNT) {
    errors.push(`山数量应为 ${EXPECTED_HILL_COUNT}，实际 ${raw.length}`);
  }

  const hills: HillConfig[] = [];
  const ids = new Set<string>();

  raw.forEach((item, i) => {
    const h = item as Partial<HillConfig>;
    const where = `hills[${i}]`;
    if (!h || typeof h !== 'object') {
      errors.push(`${where}: 不是对象`);
      return;
    }
    if (typeof h.id !== 'string' || h.id.length === 0) {
      errors.push(`${where}: id 缺失`);
      return;
    }
    if (ids.has(h.id)) errors.push(`${h.id}: id 重复`);
    ids.add(h.id);

    if (typeof h.name !== 'string' || h.name.length === 0) errors.push(`${h.id}: name 缺失`);
    if (
      !Array.isArray(h.mapPosition) ||
      h.mapPosition.length !== 3 ||
      h.mapPosition.some((n) => typeof n !== 'number')
    ) {
      errors.push(`${h.id}: mapPosition 必须是 [number, number, number]`);
    }
    if (
      !h.palette ||
      !HEX_RE.test(h.palette.primary ?? '') ||
      !HEX_RE.test(h.palette.accent1 ?? '') ||
      !HEX_RE.test(h.palette.accent2 ?? '')
    ) {
      errors.push(`${h.id}: palette 三色必须为 #RRGGBB`);
    }
    if (!h.env || !SKY_VALUES.has(h.env.sky as string)) {
      errors.push(`${h.id}: env.sky 必须是 day/night/sunset`);
    }
    if (h.env && !HEX_RE.test(h.env.fog ?? '')) errors.push(`${h.id}: env.fog 必须为 #RRGGBB`);
    if (h.env && !PARTICLE_VALUES.has(h.env.particles as string)) {
      errors.push(`${h.id}: env.particles 非法`);
    }
    if (!h.teacher || typeof h.teacher.name !== 'string') errors.push(`${h.id}: teacher.name 缺失`);
    if (typeof h.dialogue !== 'string' || !h.dialogue.endsWith('.json')) {
      errors.push(`${h.id}: dialogue 路径无效`);
    }
    if (
      !h.meditations ||
      typeof h.meditations['5'] !== 'string' ||
      typeof h.meditations['10'] !== 'string'
    ) {
      errors.push(`${h.id}: meditations 需要 "5"/"10" 两档路径`);
    }

    hills.push(h as HillConfig);
  });

  for (let a = 0; a < hills.length; a++) {
    for (let b = a + 1; b < hills.length; b++) {
      const [ax, , az] = hills[a].mapPosition;
      const [bx, , bz] = hills[b].mapPosition;
      const d = Math.hypot(ax - bx, az - bz);
      if (d < MIN_HILL_DISTANCE) {
        errors.push(`山位过近: ${hills[a].id} ↔ ${hills[b].id}（${d.toFixed(1)} < ${MIN_HILL_DISTANCE}）`);
      }
    }
  }

  // 注：dialogue/meditations 指向的内容文件在 M2/M3 才创建，此处只校验路径格式，存在性留待对应里程碑校验。
  if (errors.length > 0) {
    console.error('[validate] hills.json 校验失败:', errors);
    throw new Error(`hills.json 校验失败（${errors.length} 项），详见控制台`);
  }
  if (import.meta.env?.DEV) {
    console.info(`[validate] hills.json 通过（${hills.length} 座山，内容文件存在性待 M2/M3 校验）`);
  }
  return hills;
}

/** 对话剧本校验：节点引用闭环、入口存在、选项/动作互斥使用合法（TDD §4.6 / 任务文档 §4）。 */
export function validateDialogue(raw: unknown, expectHillId: string): DialogueScript {
  const errors: string[] = [];
  const d = raw as Partial<DialogueScript>;

  if (!d || typeof d !== 'object') throw new Error('[validate] 对话剧本必须是对象');
  if (d.hillId !== expectHillId) errors.push(`hillId 应为 ${expectHillId}，实际 ${String(d.hillId)}`);
  if (typeof d.teacher !== 'string' || d.teacher.length === 0) errors.push('teacher 缺失');
  if (!Array.isArray(d.nodes) || d.nodes.length === 0) {
    errors.push('nodes 必须是非空数组');
  }

  if (Array.isArray(d.nodes)) {
    const ids = new Set<string>();
    d.nodes.forEach((n, i) => {
      const where = `nodes[${i}]`;
      if (!n || typeof n !== 'object') {
        errors.push(`${where}: 不是对象`);
        return;
      }
      if (typeof n.id !== 'string' || n.id.length === 0) {
        errors.push(`${where}: id 缺失`);
        return;
      }
      if (ids.has(n.id)) errors.push(`${where}: id "${n.id}" 重复`);
      ids.add(n.id);
      if (typeof n.text !== 'string' || n.text.length === 0) errors.push(`${n.id}: text 缺失`);
      if (n.options) {
        if (!Array.isArray(n.options) || n.options.length === 0) {
          errors.push(`${n.id}: options 必须是非空数组`);
        } else {
          n.options.forEach((o, j) => {
            if (typeof o?.label !== 'string' || typeof o?.reply !== 'string') {
              errors.push(`${n.id}: options[${j}] 需要 label 与 reply`);
            }
          });
        }
      }
      if (!n.options && !n.next && !n.action) {
        errors.push(`${n.id}: 需要 next / options / action 之一`);
      }
    });
    // 引用闭环
    d.nodes.forEach((n) => {
      if (n?.next && !ids.has(n.next)) errors.push(`${n.id}: next 指向不存在的 "${n.next}"`);
      n?.options?.forEach((o) => {
        if (o.reply && !ids.has(o.reply)) {
          errors.push(`${n.id}: reply 指向不存在的 "${o.reply}"`);
        }
      });
    });
  }

  if (errors.length > 0) {
    throw new Error(`对话剧本校验失败（${expectHillId}）：${errors.join('；')}`);
  }
  return d as DialogueScript;
}

/** 冥想引导脚本校验：cue 升序、最大 t < duration、呼吸周期为正（任务文档 §4）。 */
export function validateMeditation(raw: unknown, expectHillId: string): MeditationScript {
  const errors: string[] = [];
  const m = raw as Partial<MeditationScript>;

  if (!m || typeof m !== 'object') throw new Error('[validate] 引导脚本必须是对象');
  if (m.hillId !== expectHillId) errors.push(`hillId 应为 ${expectHillId}，实际 ${String(m.hillId)}`);
  if (typeof m.duration !== 'number' || m.duration <= 0) errors.push('duration 必须为正数（秒）');
  if (
    !m.breathCycle ||
    typeof m.breathCycle.inhale !== 'number' ||
    m.breathCycle.inhale <= 0 ||
    typeof m.breathCycle.exhale !== 'number' ||
    m.breathCycle.exhale <= 0
  ) {
    errors.push('breathCycle.inhale/exhale 必须为正数');
  }
  if (!Array.isArray(m.cues) || m.cues.length === 0) {
    errors.push('cues 必须是非空数组');
  } else {
    let prev = -1;
    m.cues.forEach((c, i) => {
      if (typeof c?.t !== 'number' || typeof c?.text !== 'string' || c.text.length === 0) {
        errors.push(`cues[${i}]: 需要 t:number 与 text:string`);
        return;
      }
      if (c.t < 0) errors.push(`cues[${i}]: t 不能为负`);
      if (c.t <= prev && i > 0) errors.push(`cues[${i}]: t 必须严格升序（${c.t} <= ${prev}）`);
      prev = c.t;
      if (typeof m.duration === 'number' && c.t >= m.duration) {
        errors.push(`cues[${i}]: t=${c.t} 必须 < duration=${m.duration}`);
      }
    });
  }

  if (errors.length > 0) {
    throw new Error(`引导脚本校验失败（${expectHillId}）：${errors.join('；')}`);
  }
  return m as MeditationScript;
}
