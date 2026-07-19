import * as THREE from 'three';
import { EventBus } from './EventBus';
import type { SceneManager } from './SceneManager';

const MAX_DT = 0.1; // 100ms 钳制，防止后台标签页恢复后跳帧（TDD §4.1）

/** 渲染器与主循环的唯一持有者。 */
export class GameApp {
  readonly renderer: THREE.WebGLRenderer;
  readonly bus = new EventBus();

  private scenes: SceneManager | null = null;
  private lastTime = 0;
  private frameCount = 0;
  private fpsWindowStart = 0;

  /** 供调试面板读取的滚动 FPS。 */
  fps = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    window.addEventListener('resize', this.onResize);
  }

  setScenes(scenes: SceneManager): void {
    this.scenes = scenes;
  }

  start(): void {
    this.renderer.setAnimationLoop(this.tick);
  }

  private tick = (time: number): void => {
    const dt = Math.min((time - this.lastTime) / 1000, MAX_DT);
    this.lastTime = time;

    this.frameCount++;
    if (time - this.fpsWindowStart >= 1000) {
      this.fps = (this.frameCount * 1000) / (time - this.fpsWindowStart);
      this.frameCount = 0;
      this.fpsWindowStart = time;
    }

    if (this.scenes) {
      // 单帧异常不杀死渲染循环（ISSUE-M2-001 F2）
      try {
        this.scenes.update(dt);
        const active = this.scenes.active;
        if (active) this.renderer.render(active.scene, active.camera);
      } catch (err) {
        console.error('[GameApp] frame error', err);
      }
    }
  };

  private onResize = (): void => {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.scenes?.resize(window.innerWidth, window.innerHeight);
  };
}
