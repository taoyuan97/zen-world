const FADE_MS = 500; // TDD §4.2：0.5s 黑场

/** 场景切换过渡遮罩：过渡期间 pointer-events 拦截全部输入。 */
export class TransitionOverlay {
  constructor(private el: HTMLElement) {
    this.el.style.transitionDuration = `${FADE_MS}ms`;
  }

  fadeOut(): Promise<void> {
    return this.fade(true);
  }

  fadeIn(): Promise<void> {
    return this.fade(false);
  }

  private fade(toBlack: boolean): Promise<void> {
    return new Promise((resolve) => {
      this.el.style.pointerEvents = 'auto';
      this.el.style.opacity = toBlack ? '1' : '0';
      window.setTimeout(() => {
        if (!toBlack) this.el.style.pointerEvents = 'none';
        resolve();
      }, FADE_MS);
    });
  }
}
