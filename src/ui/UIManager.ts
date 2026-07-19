import type { EventBus } from '../core/EventBus';
import type { HillConfig, MeditationScript } from '../data/types';
import type { SaveSystem } from '../systems/SaveSystem';
import { Tooltip } from './Tooltip';
import { DialogueBox } from './DialogueBox';
import { MeditationHud } from './MeditationHud';
import { Screens } from './screens';

interface UIElements {
  mapHud: HTMLElement;
  progressBadge: HTMLElement;
  muteBtn: HTMLButtonElement;
  onboarding: HTMLElement;
  tooltip: HTMLElement;
  // 冥想场景 HUD
  sceneHud: HTMLElement;
  sceneBackBtn: HTMLButtonElement;
  sceneMuteBtn: HTMLButtonElement;
  sceneHint: HTMLElement;
  // 对话
  dialogue: HTMLElement;
  dialogueSpeaker: HTMLElement;
  dialogueText: HTMLElement;
  dialogueOptions: HTMLElement;
  dialogueHint: HTMLElement;
  // 冥想 HUD
  medHud: HTMLElement;
  medRingFg: SVGCircleElement;
  medTime: HTMLElement;
  medCue: HTMLElement;
  medBreath: HTMLElement;
  medHideBtn: HTMLButtonElement;
  medShowBtn: HTMLButtonElement;
  medPausedMask: HTMLElement;
  medResumeBtn: HTMLButtonElement;
  // 屏：时长/完成/确认
  durationPanel: HTMLElement;
  duration5: HTMLButtonElement;
  duration10: HTMLButtonElement;
  durationFree: HTMLButtonElement;
  durationCancel: HTMLButtonElement;
  completion: HTMLElement;
  completionSession: HTMLElement;
  completionTotal: HTMLElement;
  completionBlessing: HTMLElement;
  completionBack: HTMLButtonElement;
  abortConfirm: HTMLElement;
  abortYes: HTMLButtonElement;
  abortNo: HTMLButtonElement;
  // M4 终局面板
  finale: HTMLElement;
  finaleTemple: HTMLButtonElement;
  finaleRoam: HTMLButtonElement;
}

interface UICommands {
  backToMap: () => void;
  resumeMeditation: () => void;
  advanceDialogue: () => void;
  playClick: () => void;
  finaleGoTemple: () => void; // M4：终局面板「前往古寺」
}

const ONBOARDING_MS = 3000; // A6：一次性操作提示 3s 淡出

/** UI 浮层显隐调度的唯一入口（TDD §7）。 */
export class UIManager {
  readonly tooltip: Tooltip;
  readonly dialogueBox: DialogueBox;
  readonly meditationHud: MeditationHud;
  readonly screens: Screens;
  private disposers: Array<() => void> = [];

  constructor(
    private deps: { bus: EventBus; save: SaveSystem; commands: UICommands; els: UIElements },
  ) {
    const { bus, save, commands, els } = deps;
    this.tooltip = new Tooltip(els.tooltip);

    this.dialogueBox = new DialogueBox(
      {
        root: els.dialogue,
        speaker: els.dialogueSpeaker,
        text: els.dialogueText,
        options: els.dialogueOptions,
        hint: els.dialogueHint,
      },
      { onAdvance: () => commands.advanceDialogue(), onClick: () => commands.playClick() },
    );

    this.meditationHud = new MeditationHud(
      {
        root: els.medHud,
        ringFg: els.medRingFg,
        timeLabel: els.medTime,
        cue: els.medCue,
        breath: els.medBreath,
        hideBtn: els.medHideBtn,
        showBtn: els.medShowBtn,
        pausedMask: els.medPausedMask,
        resumeBtn: els.medResumeBtn,
      },
      { onResume: () => commands.resumeMeditation() },
    );

    this.screens = new Screens(
      {
        durationPanel: els.durationPanel,
        duration5: els.duration5,
        duration10: els.duration10,
        durationFree: els.durationFree,
        durationCancel: els.durationCancel,
        completion: els.completion,
        completionSession: els.completionSession,
        completionTotal: els.completionTotal,
        completionBlessing: els.completionBlessing,
        completionBack: els.completionBack,
        abortConfirm: els.abortConfirm,
        abortYes: els.abortYes,
        abortNo: els.abortNo,
        finale: els.finale,
        finaleTemple: els.finaleTemple,
        finaleRoam: els.finaleRoam,
      },
      {
        onDurationChosen: (minutes) => bus.emit('meditation:duration-chosen', { minutes }),
        onDurationCancel: () => {
          els.durationPanel.classList.add('hidden');
          bus.emit('meditation:duration-cancelled', {});
        },
        onBackToMap: () => {
          els.completion.classList.add('hidden');
          commands.backToMap();
        },
        onAbortConfirmed: () => {
          els.abortConfirm.classList.add('hidden');
          bus.emit('meditation:abort-confirmed', {});
        },
        onAbortCancelled: () => {
          els.abortConfirm.classList.add('hidden');
        },
        onFinaleTemple: () => {
          els.finale.classList.add('hidden');
          commands.finaleGoTemple();
        },
        onFinaleRoam: () => {
          els.finale.classList.add('hidden'); // 自由漫游：留在全亮地图
        },
        onAnyClick: () => commands.playClick(),
      },
    );

    // ---- 静音（地图 HUD + 场景 HUD 双按钮，常驻，D6）----
    const syncMute = (muted: boolean): void => {
      els.muteBtn.textContent = muted ? '🔇' : '🔊';
      els.sceneMuteBtn.textContent = muted ? '🔇' : '🔊';
    };
    syncMute(save.data.settings.muted);
    const toggleMute = (): void => {
      save.setMuted(!save.data.settings.muted);
      bus.emit('settings:muted', { muted: save.data.settings.muted });
    };
    els.muteBtn.addEventListener('click', toggleMute);
    els.sceneMuteBtn.addEventListener('click', toggleMute);

    els.sceneBackBtn.addEventListener('click', () => commands.backToMap());

    // ---- 键盘：Space/Enter 推进对话；Esc 中断由场景监听 ----
    window.addEventListener('keydown', (e) => {
      if ((e.key === ' ' || e.key === 'Enter') && !els.dialogue.classList.contains('hidden')) {
        e.preventDefault();
        this.dialogueBox.handleAdvanceKey();
      }
    });

    this.disposers.push(
      bus.on('ui:progress', ({ lit, total }) => {
        els.progressBadge.textContent = `已点亮 ${lit}/${total}`;
      }),
      bus.on('settings:muted', ({ muted }) => syncMute(muted)),
      bus.on('scene:entered', ({ id }) => {
        els.mapHud.classList.toggle('hidden', id !== 'map');
        if (id === 'map') {
          this.maybeShowOnboarding();
          this.screens.hideCompletion();
          this.meditationHud.hide();
          this.dialogueBox.hide();
        } else {
          this.tooltip.hide();
        }
      }),
      // 冥想 HUD 数据流
      bus.on('meditation:cue', ({ text }) => this.meditationHud.setCue(text)),
      bus.on('meditation:progress', ({ elapsed, duration }) =>
        this.meditationHud.updateProgress(elapsed, duration),
      ),
      bus.on('meditation:paused-auto', () => this.meditationHud.setPaused(true)),
      bus.on('meditation:resumed', () => this.meditationHud.setPaused(false)),
      bus.on('meditation:abort-request', () => this.screens.showAbortConfirm()),
    );
  }

  /** 场景 HUD（返回按钮 + 提示）显隐，由 MeditationScene 驱动。 */
  setSceneHud(visible: boolean): void {
    this.deps.els.sceneHud.classList.toggle('hidden', !visible);
  }

  private maybeShowOnboarding(): void {
    const { save, els } = this.deps;
    if (save.data.settings.onboardingSeen) return;
    save.setOnboardingSeen();
    els.onboarding.classList.remove('hidden');
    window.setTimeout(() => els.onboarding.classList.add('hidden'), ONBOARDING_MS);
  }
}
