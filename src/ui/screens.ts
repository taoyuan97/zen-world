import type { HillConfig } from '../data/types';

/**
 * 场景浮层屏（TDD §7 screens.ts）：时长选择、完成页、中断确认框。
 * 只负责 DOM 填充与事件绑定，显隐由 UIManager 调度。
 */
export class Screens {
  constructor(
    private els: {
      durationPanel: HTMLElement;
      duration5: HTMLButtonElement;
      duration10: HTMLButtonElement;
      durationCancel: HTMLButtonElement;
      completion: HTMLElement;
      completionSession: HTMLElement;
      completionTotal: HTMLElement;
      completionBlessing: HTMLElement;
      completionBack: HTMLButtonElement;
      abortConfirm: HTMLElement;
      abortYes: HTMLButtonElement;
      abortNo: HTMLButtonElement;
    },
    private callbacks: {
      onDurationChosen: (minutes: 5 | 10) => void;
      onDurationCancel: () => void;
      onBackToMap: () => void;
      onAbortConfirmed: () => void;
      onAbortCancelled: () => void;
      onAnyClick?: () => void; // UI 点击音
    },
  ) {
    const click = (el: HTMLButtonElement, fn: () => void): void => {
      el.addEventListener('click', () => {
        this.callbacks.onAnyClick?.();
        fn();
      });
    };
    click(els.duration5, () => this.callbacks.onDurationChosen(5));
    click(els.duration10, () => this.callbacks.onDurationChosen(10));
    click(els.durationCancel, () => this.callbacks.onDurationCancel());
    click(els.completionBack, () => this.callbacks.onBackToMap());
    click(els.abortYes, () => this.callbacks.onAbortConfirmed());
    click(els.abortNo, () => this.callbacks.onAbortCancelled());
  }

  showDuration(hill: HillConfig): void {
    this.els.durationPanel.querySelector('.panel-sub')!.textContent =
      `${hill.teacher.name}在等你。想坐多久？`;
    this.els.durationPanel.classList.remove('hidden');
  }

  hideDuration(): void {
    this.els.durationPanel.classList.add('hidden');
  }

  showCompletion(args: {
    hill: HillConfig;
    sessionSeconds: number;
    totalSessions: number;
    totalSeconds: number;
    blessing: string;
  }): void {
    const mm = Math.floor(args.sessionSeconds / 60);
    this.els.completionSession.textContent = `本次冥想 ${mm} 分钟`;
    const totalMin = Math.round(args.totalSeconds / 60);
    this.els.completionTotal.textContent = `在「${args.hill.name}」共冥想 ${args.totalSessions} 次 · 累计 ${totalMin} 分钟`;
    this.els.completionBlessing.textContent = `—— ${args.hill.teacher.name}：「${args.blessing}」`;
    this.els.completion.classList.remove('hidden');
  }

  hideCompletion(): void {
    this.els.completion.classList.add('hidden');
  }

  showAbortConfirm(): void {
    this.els.abortConfirm.classList.remove('hidden');
  }

  hideAbortConfirm(): void {
    this.els.abortConfirm.classList.add('hidden');
  }
}
