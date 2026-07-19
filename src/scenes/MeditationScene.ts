import * as THREE from 'three';
import type { IScene } from '../core/SceneManager';
import type { EventBus } from '../core/EventBus';
import type { AssetLoader } from '../core/AssetLoader';
import { Ease, Tweens } from '../core/Tween';
import type { DialogueScript, HillConfig, MeditationScript } from '../data/types';
import type { SaveSystem } from '../systems/SaveSystem';
import { DialogueSystem } from '../systems/DialogueSystem';
import { MeditationSession } from '../systems/MeditationSession';
import { LightingRitual, type RitualStage } from '../systems/LightingRitual';
import type { AudioSystem } from '../systems/AudioSystem';
import { TeacherRig } from './meditation/TeacherRig';
import { buildThemeEnvironment, type ThemeEnvironment } from './meditation/ThemeEnvironment';
import type { Tooltip } from '../ui/Tooltip';

export interface MeditationParams {
  hill: HillConfig;
}

/** 内容文件加载器（main.ts 用 import.meta.glob 注入，保持数据驱动）。 */
export interface ContentLoader {
  loadDialogue(hill: HillConfig): DialogueScript;
  loadMeditation(hill: HillConfig, minutes: 5 | 10): MeditationScript;
}

/** 场景→UI 的浮层出口（由 main.ts 实现，内部走 UIManager 唯一入口）。 */
export interface MeditationSceneUI {
  setSceneHudVisible(visible: boolean): void;
  openDuration(hill: HillConfig): void;
  closeDuration(): void;
  showMeditationHud(script: MeditationScript): void;
  hideMeditationHud(): void;
  openCompletion(args: {
    hill: HillConfig;
    sessionSeconds: number;
    totalSessions: number;
    totalSeconds: number;
    blessing: string;
  }): void;
}

interface MeditationSceneDeps {
  bus: EventBus;
  save: SaveSystem;
  loader: AssetLoader;
  audio: AudioSystem;
  content: ContentLoader;
  ui: MeditationSceneUI;
  dialogue: DialogueSystem;
  tooltip: Tooltip;
  canvas: HTMLCanvasElement;
  debug: boolean;
}

type FlowState = 'empty' | 'intro' | 'idle' | 'dialogue' | 'duration' | 'meditation' | 'ritual' | 'done';

const INTRO_DURATION = 2.5; // 机位 1：入场缓推（cubic-out）
const DIALOGUE_CAM_DURATION = 1.2;
const ORBIT_SPEED = THREE.MathUtils.degToRad(2); // 机位 3：缓慢环绕 2°/s（D5）
const TEACHER_POS = new THREE.Vector3(0, 0, 0);
const CLICK_DRAG_THRESHOLD = 5;

/** 冥想场景模板：主题环境 + 老师 + 三段机位 + 对话/会话/演出编排（TDD §5.2）。 */
export class MeditationScene implements IScene, RitualStage {
  readonly id = 'meditation' as const;
  readonly scene3 = new THREE.Scene();
  readonly camera3: THREE.PerspectiveCamera;
  readonly tweens = new Tweens();

  private state: FlowState = 'empty';
  private hill: HillConfig | null = null;
  private env: ThemeEnvironment | null = null;
  private teacher: TeacherRig | null = null;
  private session: MeditationSession | null = null;
  private ritual: LightingRitual;
  private lights: THREE.Light[] = [];
  private inputLocked = false;
  private orbitAngle = 0;
  private camLook = new THREE.Vector3(0, 1.4, 0);
  private raycaster = new THREE.Raycaster();
  private pointerNdc = new THREE.Vector2();
  private downPos: { x: number; y: number } | null = null;
  private hoverTeacher = false;
  private disposers: Array<() => void> = [];

  constructor(private deps: MeditationSceneDeps) {
    this.camera3 = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 220);
    this.ritual = new LightingRitual(deps.audio);
  }

  async enter(params?: unknown): Promise<void> {
    const { hill } = (params ?? {}) as Partial<MeditationParams>;
    if (!hill) {
      console.error('[MeditationScene] 缺少 hill 参数');
      return;
    }
    this.hill = hill;
    this.state = 'intro';
    this.inputLocked = true;

    // ---- 主题应用：雾 / 灯光 / 环境 ----
    this.scene3.background = new THREE.Color(hill.env.fog);
    this.scene3.fog = new THREE.Fog(hill.env.fog, 26, 85);
    const ambient = new THREE.AmbientLight('#ffffff', 0.85);
    const sun = new THREE.DirectionalLight('#fff3dd', 1.5);
    sun.position.set(12, 22, 10);
    this.scene3.add(ambient, sun);
    this.lights = [ambient, sun];

    this.env = buildThemeEnvironment(hill);
    this.scene3.add(this.env.group);
    this.applyLightMix(0); // 初始 unlit 状态（雾/灯光同步降饱和）

    this.teacher = new TeacherRig(this.deps.loader, hill);
    this.teacher.group.position.copy(TEACHER_POS);
    this.scene3.add(this.teacher.group);
    await this.teacher.build();

    // ---- 机位 1：入场缓推（期间禁输入）----
    const camStart = new THREE.Vector3(0, 9.5, 30);
    const camEnd = new THREE.Vector3(0, 3.4, 12.5);
    const lookStart = new THREE.Vector3(0, 3, 0);
    const lookEnd = new THREE.Vector3(0, 1.5, 0);
    this.camera3.position.copy(camStart);
    this.camLook.copy(lookStart);
    this.camera3.lookAt(this.camLook);

    this.bindInput();
    this.deps.ui.setSceneHudVisible(true);

    // enter 在此返回（SceneManager 随即 fadeIn），运镜随首帧渲染同步开始
    this.tweens.add({
      duration: INTRO_DURATION,
      ease: Ease.cubicOut,
      onUpdate: (k) => {
        this.camera3.position.lerpVectors(camStart, camEnd, k);
        this.camLook.lerpVectors(lookStart, lookEnd, k);
        this.camera3.lookAt(this.camLook);
      },
      onComplete: () => {
        if (this.state !== 'intro') return; // 进入期间被打断（如快速退出）
        this.inputLocked = false;
        this.state = 'idle';
      },
    });

    // ---- 对话动作 → 时长选择 ----
    this.disposers.push(
      this.deps.bus.on('dialogue:action', ({ action }) => {
        if (action === 'start_meditation' && this.state === 'dialogue') {
          this.state = 'duration';
          this.deps.ui.openDuration(this.hill!);
        }
      }),
      this.deps.bus.on('meditation:duration-chosen', ({ minutes }) => {
        if (this.state === 'duration') this.beginMeditation(minutes);
      }),
      this.deps.bus.on('meditation:duration-cancelled', () => {
        if (this.state === 'duration') this.state = 'idle'; // 回到可再次点击老师的待机
      }),
      this.deps.bus.on('meditation:abort-confirmed', () => {
        if (this.state === 'meditation') this.abortMeditation();
      }),
    );
  }

  // ---------- 输入 ----------

  private bindInput(): void {
    const { canvas, bus } = this.deps;
    const onMove = (e: PointerEvent): void => {
      this.pointerNdc.set(
        (e.clientX / window.innerWidth) * 2 - 1,
        -(e.clientY / window.innerHeight) * 2 + 1,
      );
    };
    const onDown = (e: PointerEvent): void => {
      this.downPos = { x: e.clientX, y: e.clientY };
    };
    const onUp = (e: PointerEvent): void => {
      if (!this.downPos) return;
      const moved = Math.hypot(e.clientX - this.downPos.x, e.clientY - this.downPos.y);
      this.downPos = null;
      if (moved < CLICK_DRAG_THRESHOLD) this.handleClick();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && this.state === 'meditation' && !this.inputLocked) {
        bus.emit('meditation:abort-request', {});
      }
    };
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey);
    this.disposers.push(() => {
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
    });
  }

  private handleClick(): void {
    if (this.inputLocked) return; // 入场/演出期间吞输入
    if (this.state === 'idle' && this.hoverTeacher) this.startDialogue();
  }

  private pickTeacher(): boolean {
    if (!this.teacher) return false;
    this.raycaster.setFromCamera(this.pointerNdc, this.camera3);
    return this.raycaster.intersectObject(this.teacher.group, true).length > 0;
  }

  // ---------- 流程 ----------

  private startDialogue(): void {
    if (!this.hill) return;
    this.state = 'dialogue';
    this.deps.tooltip.hide();

    // 机位 2：过肩中景
    const camFrom = this.camera3.position.clone();
    const camTo = new THREE.Vector3(1.7, 2.3, 5.4);
    const lookFrom = this.camLook.clone();
    const lookTo = new THREE.Vector3(0, 1.6, 0);
    this.inputLocked = true;
    this.tweens.add({
      duration: DIALOGUE_CAM_DURATION,
      ease: Ease.sineInOut,
      onUpdate: (k) => {
        this.camera3.position.lerpVectors(camFrom, camTo, k);
        this.camLook.lerpVectors(lookFrom, lookTo, k);
        this.camera3.lookAt(this.camLook);
      },
      onComplete: () => {
        this.inputLocked = false;
      },
    });

    let script: DialogueScript;
    try {
      script = this.deps.content.loadDialogue(this.hill);
    } catch (err) {
      console.error('[MeditationScene] 对话剧本校验失败，本山维护中', err);
      this.state = 'idle';
      return;
    }
    this.deps.dialogue.start(script);
  }

  private beginMeditation(minutes: 5 | 10): void {
    if (!this.hill) return;
    this.deps.ui.closeDuration();

    let script: MeditationScript;
    try {
      script = this.deps.content.loadMeditation(this.hill, minutes);
    } catch (err) {
      console.error('[MeditationScene] 引导脚本校验失败', err);
      this.state = 'idle';
      return;
    }

    this.state = 'meditation';
    this.teacher?.setMeditating(true);
    this.deps.ui.showMeditationHud(script);
    this.deps.ui.setSceneHudVisible(false); // 冥想期间收起返回按钮，中断走 Esc 确认流

    // 机位 3：缓慢环绕（D5：day 预设 2°/s）
    this.orbitAngle = Math.atan2(this.camera3.position.x, this.camera3.position.z);

    this.session = new MeditationSession(this.deps.bus, this.hill.id);
    this.session.start(script, {
      debug: this.deps.debug,
      onComplete: () => void this.onSessionComplete(script.duration),
    });
  }

  private async onSessionComplete(seconds: number): Promise<void> {
    if (!this.hill || this.state !== 'meditation') return;
    this.state = 'ritual';
    this.inputLocked = true;
    this.deps.ui.hideMeditationHud();
    this.teacher?.setMeditating(false);

    // 存档：点亮 + 累计（重复冥想走 addSession）
    this.deps.save.markLit(this.hill.id, seconds);
    this.deps.bus.emit('ui:progress', {
      lit: this.deps.save.litCount(),
      total: this.deps.save.data.hills ? Object.keys(this.deps.save.data.hills).length : 10,
    });

    await this.ritual.play(this, this.hill);
    if (this.state !== 'ritual') return;
    this.state = 'done';
    this.deps.bus.emit('ritual:done', { hillId: this.hill.id });

    const hillSave = this.deps.save.data.hills[this.hill.id];
    let blessing = '山会一直记得这段安静。';
    try {
      blessing = this.deps.content.loadDialogue(this.hill).blessing ?? blessing;
    } catch {
      /* 剧本缺失时用默认赠言 */
    }
    this.deps.ui.openCompletion({
      hill: this.hill,
      sessionSeconds: seconds,
      totalSessions: hillSave.sessions,
      totalSeconds: hillSave.totalSeconds,
      blessing,
    });
  }

  private abortMeditation(): void {
    this.session?.abort();
    this.session = null;
    this.deps.ui.hideMeditationHud();
    this.teacher?.setMeditating(false);
    this.deps.bus.emit('meditation:aborted', {});
  }

  /** 供 UI 暂停遮罩恢复按钮调用。 */
  resumeSession(): void {
    this.session?.resume();
  }

  // ---------- RitualStage 实现 ----------

  teacherAnchor(): THREE.Vector3 {
    return TEACHER_POS.clone();
  }

  applyLightMix(k: number): void {
    this.env?.applyLightMix(k);
    if (this.hill && this.scene3.fog instanceof THREE.Fog) {
      // 雾色随点亮微微提亮
      const base = new THREE.Color(this.hill.env.fog);
      const dim = base.clone().multiplyScalar(0.82);
      (this.scene3.fog.color as THREE.Color).copy(dim.lerp(base, k));
      (this.scene3.background as THREE.Color).copy(this.scene3.fog.color);
    }
    for (const light of this.lights) {
      light.intensity = (light instanceof THREE.AmbientLight ? 0.85 : 1.5) * (0.8 + 0.2 * k);
    }
  }

  setInputLocked(locked: boolean): void {
    this.inputLocked = locked;
  }

  // ---------- 帧循环 ----------

  update(dt: number): void {
    this.tweens.update(dt);
    this.env?.update(dt);
    this.teacher?.update(dt);

    // 机位 3：冥想中缓慢环绕
    if (this.state === 'meditation' || this.state === 'ritual') {
      this.orbitAngle += ORBIT_SPEED * dt;
      const r = 12.5;
      this.camera3.position.set(
        Math.sin(this.orbitAngle) * r,
        3.4,
        Math.cos(this.orbitAngle) * r,
      );
      this.camera3.lookAt(0, 1.5, 0);
    }

    // 待机时老师悬停提示
    if (this.state === 'idle' && !this.inputLocked) {
      const hover = this.pickTeacher();
      if (hover !== this.hoverTeacher) {
        this.hoverTeacher = hover;
        document.body.style.cursor = hover ? 'pointer' : '';
        if (!hover) this.deps.tooltip.hide();
      }
      if (hover) {
        const v = new THREE.Vector3(0, 2.2, 0).project(this.camera3);
        this.deps.tooltip.show(
          '与老师交谈',
          (v.x * 0.5 + 0.5) * window.innerWidth,
          (-v.y * 0.5 + 0.5) * window.innerHeight,
        );
      }
    }
  }

  resize(width: number, height: number): void {
    this.camera3.aspect = width / height;
    this.camera3.updateProjectionMatrix();
  }

  exit(): void {
    // 中断残留的会话/对话，保证下次进入是干净状态
    this.session?.abort();
    this.session = null;
    this.deps.dialogue.stop();
    this.deps.ui.hideMeditationHud();
    this.deps.ui.closeDuration();
    this.deps.ui.setSceneHudVisible(false);
  }

  dispose(): void {
    for (const d of this.disposers) d();
    this.disposers = [];
    this.tweens.clear();
    this.hoverTeacher = false;
    document.body.style.cursor = '';
    this.deps.tooltip.hide();
    this.teacher?.dispose();
    this.teacher = null;
    this.env?.dispose();
    this.env = null;
    this.lights = [];
    this.scene3.clear();
    this.state = 'empty';
    this.hill = null;
    this.inputLocked = false;
  }
}
