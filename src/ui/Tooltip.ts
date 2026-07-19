/** 山名浮签：位置由 MapScene 投影后驱动（TDD §7）。 */
export class Tooltip {
  constructor(private el: HTMLElement) {}

  show(text: string, x: number, y: number): void {
    this.el.textContent = text;
    this.el.style.left = `${x}px`;
    this.el.style.top = `${y - 14}px`;
    this.el.classList.remove('hidden');
  }

  hide(): void {
    this.el.classList.add('hidden');
  }
}
