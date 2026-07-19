import type { GameApp } from '../core/GameApp';
import type { EventBus } from '../core/EventBus';
import type { SaveSystem } from '../systems/SaveSystem';
import type { HillConfig } from '../data/types';

/** ?debug 面板：fps / draw calls / 每山点亮切换（任务 1.13）。 */
export class DebugPanel {
  constructor(deps: {
    app: GameApp;
    bus: EventBus;
    save: SaveSystem;
    hills: HillConfig[];
    el: HTMLElement;
  }) {
    const { app, bus, save, hills, el } = deps;
    el.classList.remove('hidden');

    const stats = document.createElement('div');
    stats.className = 'debug-stats';
    el.appendChild(stats);

    const list = document.createElement('div');
    for (const hill of hills) {
      const btn = document.createElement('button');
      btn.className = 'debug-hill-btn';
      const refresh = (): void => {
        btn.textContent = `${save.isLit(hill.id) ? '💡' : '▫'} ${hill.name}`;
      };
      refresh();
      btn.addEventListener('click', () => {
        bus.emit('debug:toggle-lit', { hillId: hill.id, lit: !save.isLit(hill.id) });
        refresh();
      });
      bus.on('ui:progress', refresh);
      list.appendChild(btn);
    }
    el.appendChild(list);

    // 冥想计时加速（仅限调试模式，任务 2.14 / 验收 §2）
    const scaleRow = document.createElement('div');
    scaleRow.className = 'debug-stats';
    scaleRow.textContent = '冥想计时:';
    el.appendChild(scaleRow);
    for (const scale of [1, 10, 60]) {
      const btn = document.createElement('button');
      btn.className = 'debug-hill-btn';
      btn.textContent = `×${scale}`;
      btn.addEventListener('click', () => bus.emit('debug:time-scale', { scale }));
      el.appendChild(btn);
    }

    window.setInterval(() => {
      const info = app.renderer.info.render;
      stats.textContent = `fps ${app.fps.toFixed(0)} · draw calls ${info.calls} · tris ${(info.triangles / 1000).toFixed(1)}k`;
    }, 500);
  }
}
