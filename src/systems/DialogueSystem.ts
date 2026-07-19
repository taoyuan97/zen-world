import type { DialogueNode, DialogueScript } from '../data/types';

/** 对话框 UI 接口（由 DialogueBox 实现，系统只依赖此接口与 JSON，与场景解耦 TDD §6.2）。 */
export interface DialogueView {
  showLine(speaker: string, text: string, onSettled: () => void): void;
  showOptions(labels: string[], onChoose: (index: number) => void): void;
  hide(): void;
}

/** 对话状态机：text 节点打字机→等待前进；options 节点渲染选项；action 触发回调并结束。 */
export class DialogueSystem {
  onAction?: (action: string) => void;
  onEnd?: () => void;

  private script: DialogueScript | null = null;
  private current: DialogueNode | null = null;
  private active = false;

  constructor(private view: DialogueView) {}

  get isActive(): boolean {
    return this.active;
  }

  start(script: DialogueScript): void {
    this.script = script;
    this.active = true;
    this.goto(script.nodes[0].id);
  }

  /** 点击/空格/回车前进（打字机未走完时由 view 先补全，再走 next）。 */
  advance(): void {
    if (!this.active || !this.current || !this.script) return;
    const node = this.current;
    if (node.options) return; // 选项节点必须点按钮
    if (node.action) {
      this.finish();
      this.onAction?.(node.action);
      return;
    }
    if (node.next) this.goto(node.next);
    else this.finish();
  }

  choose(index: number): void {
    if (!this.active || !this.current?.options) return;
    const opt = this.current.options[index];
    if (!opt) return;
    this.goto(opt.reply);
  }

  stop(): void {
    this.finish();
  }

  private goto(id: string): void {
    const node = this.script?.nodes.find((n) => n.id === id);
    if (!node) {
      console.error(`[DialogueSystem] 节点不存在: ${id}`);
      this.finish();
      return;
    }
    this.current = node;
    if (node.options) {
      // 先播文本，再出选项
      this.view.showLine(this.script!.teacher, node.text, () => {
        if (this.current === node && this.active) {
          this.view.showOptions(
            node.options!.map((o) => o.label),
            (i) => this.choose(i),
          );
        }
      });
    } else {
      this.view.showLine(this.script!.teacher, node.text, () => {
        /* 打字机自然完成；前进由 advance() 驱动 */
      });
    }
  }

  private finish(): void {
    this.active = false;
    this.current = null;
    this.view.hide();
    this.onEnd?.();
  }
}
