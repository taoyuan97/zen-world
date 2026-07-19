import * as THREE from 'three';
import type { GameApp } from './GameApp';
import type { EventBus } from './EventBus';
import type { SceneId } from '../data/types';
import type { TransitionOverlay } from '../ui/TransitionOverlay';

export interface IScene {
  readonly id: SceneId;
  readonly scene3: THREE.Scene;
  readonly camera3: THREE.Camera;
  enter(params?: unknown): Promise<void> | void;
  exit(): void;
  update(dt: number): void;
  resize(width: number, height: number): void;
  dispose(): void;
}

/** 场景切换唯一入口：淡入淡出 + 切换期吞输入（TDD §4.2）。 */
export class SceneManager {
  private scenes = new Map<SceneId, IScene>();
  private current: IScene | null = null;
  private transitioning = false;

  constructor(
    private app: GameApp,
    private overlay: TransitionOverlay,
    private bus: EventBus,
  ) {}

  register(scene: IScene): void {
    this.scenes.set(scene.id, scene);
  }

  get active(): { scene: THREE.Scene; camera: THREE.Camera } | null {
    return this.current ? { scene: this.current.scene3, camera: this.current.camera3 } : null;
  }

  async go(id: SceneId, params?: unknown): Promise<void> {
    if (this.transitioning) return;
    const next = this.scenes.get(id);
    if (!next) {
      console.error(`[SceneManager] 未注册的场景: ${id}`);
      return;
    }
    this.transitioning = true;
    await this.overlay.fadeOut();
    if (this.current) {
      this.current.exit();
      this.current.dispose();
    }
    await next.enter(params);
    this.current = next;
    this.resizeToWindow();
    this.bus.emit('scene:entered', { id });
    await this.overlay.fadeIn();
    this.transitioning = false;
  }

  update(dt: number): void {
    if (this.transitioning) return;
    this.current?.update(dt);
  }

  resize(width: number, height: number): void {
    this.current?.resize(width, height);
  }

  private resizeToWindow(): void {
    const size = this.app.renderer.getSize(new THREE.Vector2());
    this.current?.resize(size.x, size.y);
  }
}
