import type { DialogueView } from '../systems/DialogueSystem';

const CHARS_PER_SECOND = 25; // 打字机 20~30 字/秒（TDD §6.2）

/**
 * 对话框：打字机（点击补全）、名字牌、选项按钮（TDD §7）。
 * 键盘 Space/Enter 前进由 UIManager 统一转发到 advance()。
 */
export class DialogueBox implements DialogueView {
  private typeTimer: number | null = null;
  private fullText = '';
  private settled = false;
  private onSettled: (() => void) | null = null;
  private optionHandler: ((index: number) => void) | null = null;

  constructor(
    private els: {
      root: HTMLElement;
      speaker: HTMLElement;
      text: HTMLElement;
      options: HTMLElement;
      hint: HTMLElement;
    },
    private callbacks: { onAdvance: () => void; onClick?: () => void },
  ) {
    // 点击对话框：打字中→补全；已完成→前进
    els.root.addEventListener('click', () => {
      if (!this.settled) this.completeTyping();
      else if (!this.optionHandler) this.callbacks.onAdvance();
    });
  }

  get isTyping(): boolean {
    return !this.settled;
  }

  showLine(speaker: string, text: string, onSettled: () => void): void {
    this.els.root.classList.remove('hidden');
    this.els.options.classList.add('hidden');
    this.els.options.innerHTML = '';
    this.optionHandler = null;
    this.els.speaker.textContent = speaker;
    this.els.text.textContent = '';
    this.els.hint.classList.add('hidden');
    this.fullText = text;
    this.settled = false;
    this.onSettled = onSettled;

    if (this.typeTimer !== null) window.clearInterval(this.typeTimer);
    let shown = 0;
    const interval = 1000 / CHARS_PER_SECOND;
    this.typeTimer = window.setInterval(() => {
      shown += 1;
      this.els.text.textContent = this.fullText.slice(0, shown);
      if (shown >= this.fullText.length) this.completeTyping();
    }, interval);
  }

  showOptions(labels: string[], onChoose: (index: number) => void): void {
    this.optionHandler = onChoose;
    this.els.options.innerHTML = '';
    labels.forEach((label, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dialogue-option';
      btn.textContent = label;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const handler = this.optionHandler;
        this.optionHandler = null;
        handler?.(i);
      });
      this.els.options.appendChild(btn);
    });
    this.els.options.classList.remove('hidden');
  }

  hide(): void {
    if (this.typeTimer !== null) {
      window.clearInterval(this.typeTimer);
      this.typeTimer = null;
    }
    this.optionHandler = null;
    this.els.root.classList.add('hidden');
  }

  /** 空格/回车前进：打字中先补全（TDD §6.2）。 */
  handleAdvanceKey(): void {
    if (!this.settled) this.completeTyping();
    else if (!this.optionHandler) this.callbacks.onAdvance();
  }

  private completeTyping(): void {
    if (this.typeTimer !== null) {
      window.clearInterval(this.typeTimer);
      this.typeTimer = null;
    }
    this.els.text.textContent = this.fullText;
    this.settled = true;
    this.els.hint.classList.remove('hidden');
    const cb = this.onSettled;
    this.onSettled = null;
    cb?.();
  }
}
