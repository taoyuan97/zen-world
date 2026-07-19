import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { EventBus } from './EventBus';

/**
 * 资源加载管线（TDD §4.4）：
 * - 包装 GLTFLoader，dedupe 同 URL 并发请求（缓存只在飞行期内有效，
 *   结果对象的所有权交给调用方，场景 dispose 时随场景释放，避免缓存对象被二次使用已释放的几何体）；
 * - loadMany 并发加载并 emit assets:progress；
 * - 失败不阻断：reject 由调用方回退程序化占位，console.warn 记录。
 */
export class AssetLoader {
  private gltfLoader = new GLTFLoader();
  private inflight = new Map<string, Promise<THREE.Group>>();

  constructor(private bus: EventBus) {}

  /** 加载 GLB/GLTF，返回场景根 Group（每次调用返回独立 Promise，不跨场景缓存）。 */
  loadModel(url: string): Promise<THREE.Group> {
    const existing = this.inflight.get(url);
    if (existing) return existing.then((g) => g.clone(true));

    const promise = new Promise<THREE.Group>((resolve, reject) => {
      this.gltfLoader.load(
        url,
        (gltf) => resolve(gltf.scene),
        undefined,
        (err) => {
          console.warn(`[AssetLoader] 模型加载失败: ${url}`, err);
          reject(err instanceof Error ? err : new Error(String(err)));
        },
      );
    });
    this.inflight.set(url, promise);
    void promise.finally(() => this.inflight.delete(url));
    return promise;
  }

  /** 并发加载一组模型，逐项 emit assets:progress；单项失败记 warn 并返回 null 占位。 */
  async loadMany(urls: string[]): Promise<Array<THREE.Group | null>> {
    const total = urls.length;
    if (total === 0) return [];
    let loaded = 0;
    this.bus.emit('assets:progress', { loaded: 0, total });
    const results = await Promise.all(
      urls.map(async (url) => {
        try {
          const model = await this.loadModel(url);
          return model;
        } catch {
          return null; // 调用方回退程序化占位
        } finally {
          loaded += 1;
          this.bus.emit('assets:progress', { loaded, total });
        }
      }),
    );
    return results;
  }
}

/** 归一化：包围盒缩放到目标高度、底部落在 y=0、统一朝向 +Z（TDD §4.4/§5.2）。 */
export function normalizeModel(root: THREE.Object3D, targetHeight: number): void {
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const scale = targetHeight / Math.max(size.y, 0.0001);
  root.scale.setScalar(scale);
  // 缩放后重新计算，把包围盒底部对齐 y=0、中心对齐 x/z=0
  const box2 = new THREE.Box3().setFromObject(root);
  const center = box2.getCenter(new THREE.Vector3());
  root.position.x -= center.x;
  root.position.z -= center.z;
  root.position.y -= box2.min.y;
  root.rotation.y = 0; // 统一朝向 +Z（多数 CC0 人形默认面向 +Z）
}
