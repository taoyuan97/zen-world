import './style.css';
import hillsJson from './data/hills.json';
import { validateDialogue, validateHills, validateMeditation } from './core/validate';
import { GameApp } from './core/GameApp';
import { SceneManager } from './core/SceneManager';
import { AssetLoader } from './core/AssetLoader';
import { SaveSystem } from './systems/SaveSystem';
import { AudioSystem } from './systems/AudioSystem';
import { DialogueSystem } from './systems/DialogueSystem';
import { MapScene } from './scenes/MapScene';
import { MeditationScene, type ContentLoader } from './scenes/MeditationScene';
import { TransitionOverlay } from './ui/TransitionOverlay';
import { UIManager } from './ui/UIManager';
import { DebugPanel } from './ui/DebugPanel';
import type { DialogueScript, HillConfig, MeditationScript } from './data/types';

function must<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`DOM 节点 #${id} 不存在`);
  return el as T;
}

function mustSvg<T extends SVGElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`DOM 节点 #${id} 不存在`);
  return el as unknown as T;
}

// ---- 数据驱动底座：启动即校验，失败 fail-fast（TDD §4.6）----
const hills = validateHills(hillsJson);

// ---- 内容文件注册表（import.meta.glob 静态打包，路径来自 hills.json 配置）----
const dialogueFiles = import.meta.glob('./data/dialogues/*.json', {
  eager: true,
  import: 'default',
}) as Record<string, unknown>;
const meditationFiles = import.meta.glob('./data/meditations/*.json', {
  eager: true,
  import: 'default',
}) as Record<string, unknown>;

const content: ContentLoader = {
  loadDialogue(hill: HillConfig): DialogueScript {
    const raw = dialogueFiles[`./data/${hill.dialogue}`];
    if (!raw) throw new Error(`对话文件缺失: ${hill.dialogue}`);
    return validateDialogue(raw, hill.id);
  },
  loadMeditation(hill: HillConfig, minutes: 5 | 10): MeditationScript {
    const path = hill.meditations[String(minutes) as '5' | '10'];
    const raw = meditationFiles[`./data/${path}`];
    if (!raw) throw new Error(`引导文件缺失: ${path}`);
    return validateMeditation(raw, hill.id);
  },
};

const query = new URLSearchParams(window.location.search);
const debug = query.has('debug');

// ---- 全局单例 ----
const save = new SaveSystem(hills.map((h) => h.id));
const app = new GameApp(must<HTMLCanvasElement>('scene'));
const overlay = new TransitionOverlay(must('transition-overlay'));
const scenes = new SceneManager(app, overlay, app.bus);
app.setScenes(scenes);
const loader = new AssetLoader(app.bus);
const audio = new AudioSystem({ bus: app.bus, save });

// ---- 场景（meditationScene 在 UI 命令闭包中引用，先声明）----
let meditationScene: MeditationScene;

// ---- UI 层 ----
const ui = new UIManager({
  bus: app.bus,
  save,
  commands: {
    backToMap: () => {
      void scenes.go('map');
    },
    resumeMeditation: () => meditationScene?.resumeSession(),
    advanceDialogue: () => dialogue.advance(),
    playClick: () => audio.playClick(),
  },
  els: {
    mapHud: must('map-hud'),
    progressBadge: must('progress-badge'),
    muteBtn: must<HTMLButtonElement>('mute-btn'),
    onboarding: must('onboarding'),
    tooltip: must('tooltip'),
    sceneHud: must('scene-hud'),
    sceneBackBtn: must<HTMLButtonElement>('scene-back'),
    sceneMuteBtn: must<HTMLButtonElement>('scene-mute-btn'),
    sceneHint: must('scene-hint'),
    dialogue: must('dialogue'),
    dialogueSpeaker: must('dialogue-speaker'),
    dialogueText: must('dialogue-text'),
    dialogueOptions: must('dialogue-options'),
    dialogueHint: must('dialogue-hint'),
    medHud: must('med-hud'),
    medRingFg: mustSvg<SVGCircleElement>('med-ring-fg'),
    medTime: must('med-time'),
    medCue: must('med-cue'),
    medBreath: must('med-breath'),
    medHideBtn: must<HTMLButtonElement>('med-hide-btn'),
    medShowBtn: must<HTMLButtonElement>('med-show-btn'),
    medPausedMask: must('med-paused-mask'),
    medResumeBtn: must<HTMLButtonElement>('med-resume-btn'),
    durationPanel: must('duration-panel'),
    duration5: must<HTMLButtonElement>('duration-5'),
    duration10: must<HTMLButtonElement>('duration-10'),
    durationCancel: must<HTMLButtonElement>('duration-cancel'),
    completion: must('completion'),
    completionSession: must('completion-session'),
    completionTotal: must('completion-total'),
    completionBlessing: must('completion-blessing'),
    completionBack: must<HTMLButtonElement>('completion-back'),
    abortConfirm: must('abort-confirm'),
    abortYes: must<HTMLButtonElement>('abort-yes'),
    abortNo: must<HTMLButtonElement>('abort-no'),
  },
});

// ---- 地图场景 ----
const mapScene = new MapScene({
  bus: app.bus,
  save,
  hills,
  tooltip: ui.tooltip,
  canvas: app.renderer.domElement,
});

// ---- 对话系统 ----
const dialogue = new DialogueSystem(ui.dialogueBox);
dialogue.onAction = (action) => app.bus.emit('dialogue:action', { action });

// ---- 冥想场景 ----
meditationScene = new MeditationScene({
  bus: app.bus,
  save,
  loader,
  audio,
  content,
  dialogue,
  tooltip: ui.tooltip,
  canvas: app.renderer.domElement,
  debug,
  ui: {
    setSceneHudVisible: (v) => ui.setSceneHud(v),
    openDuration: (hill) => ui.screens.showDuration(hill),
    closeDuration: () => ui.screens.hideDuration(),
    showMeditationHud: (script) => ui.meditationHud.show(script),
    hideMeditationHud: () => ui.meditationHud.hide(),
    openCompletion: (args) => ui.screens.showCompletion(args),
  },
});

scenes.register(mapScene);
scenes.register(meditationScene);

// ---- 交互流：点击山 → 进入冥想场景；中断 → 返回地图 ----
app.bus.on('hill:selected', ({ hillId }) => {
  const hill = hills.find((h) => h.id === hillId);
  if (!hill) return;
  void scenes.go('meditation', { hill });
});
app.bus.on('meditation:aborted', () => {
  void scenes.go('map');
});

// ---- 调试开关 ?debug（D8 / TDD §10）----
if (debug) {
  new DebugPanel({ app, bus: app.bus, save, hills, el: must('debug-panel') });
}

// ---- 存档兜底：页面隐藏/关闭时立即落盘 ----
window.addEventListener('beforeunload', () => save.flush());
document.addEventListener('visibilitychange', () => {
  if (document.hidden) save.flush();
});

app.start();

// ---- ?hill=<id> 跳过地图直进场景（TDD §10，M2 起）----
const directHill = query.get('hill');
const target = directHill ? hills.find((h) => h.id === directHill) : undefined;
if (target) {
  void scenes.go('meditation', { hill: target });
} else {
  void scenes.go('map');
}
