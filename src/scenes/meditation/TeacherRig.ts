import * as THREE from 'three';
import { AssetLoader, normalizeModel } from '../../core/AssetLoader';
import { Ease, Tweens } from '../../core/Tween';
import type { HillConfig } from '../../data/types';

const TEACHER_MODEL_URL = './assets/models/character-human.glb';
const TARGET_HEIGHT = 1.7; // 归一化目标高度（米）
const CUSHION_RADIUS = 0.85;
const CUSHION_HEIGHT = 0.28;
const NOD_MIN_INTERVAL = 6;
const NOD_MAX_INTERVAL = 9;
const MEDITATION_AMPLITUDE = 0.5; // 冥想中动作幅度减半（TDD §5.2）

/**
 * 老师装配（决策 D1 / TDD §5.2）：
 * - 优先加载 Kenney CC0 站立人形 GLB，包围盒归一化；配程序化蒲团遮挡下半身；
 * - 加载失败回退程序化拼装（胶囊身体 + 球头 + 斗笠）；
 * - 程序化待机：呼吸 scale + 随机点头 Tween；冥想中幅度减半；
 * - teacher.color 应用为主衣色。
 */
export class TeacherRig {
  readonly group = new THREE.Group();

  private tweens = new Tweens();
  private body: THREE.Object3D | null = null;
  private head: THREE.Object3D | null = null;
  private baseBodyScaleY = 1;
  private amplitude = 1;
  private elapsed = 0;
  private nextNodAt = this.randomNodDelay();
  private nodding = false;
  private disposables: Array<{ dispose(): void }> = [];

  constructor(
    private loader: AssetLoader,
    private config: HillConfig,
  ) {}

  async build(): Promise<void> {
    const themeColor = new THREE.Color(this.config.teacher.color);

    // 蒲团（程序化，遮挡下半身 —— D1）
    const cushionGeo = new THREE.CylinderGeometry(CUSHION_RADIUS, CUSHION_RADIUS * 1.12, CUSHION_HEIGHT, 12);
    const cushionMat = new THREE.MeshLambertMaterial({
      color: themeColor.clone().multiplyScalar(0.55),
      flatShading: true,
    });
    const cushion = new THREE.Mesh(cushionGeo, cushionMat);
    cushion.position.y = CUSHION_HEIGHT / 2;
    this.group.add(cushion);
    this.track(cushionGeo, cushionMat);

    let model: THREE.Group | null = null;
    try {
      model = await this.loader.loadModel(TEACHER_MODEL_URL);
    } catch {
      console.warn('[TeacherRig] GLB 加载失败，回退程序化拼装老师');
    }

    if (model) {
      normalizeModel(model, TARGET_HEIGHT);
      // 应用主题主衣色：遍历材质向 teacher.color 染色（原 GLB 材质即刻释放，防 GPU 泄漏）
      model.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          const old = obj.material as THREE.MeshStandardMaterial;
          const lambert = new THREE.MeshLambertMaterial({
            color: old.color ? themeColor.clone().lerp(old.color, 0.35) : themeColor,
            flatShading: true,
          });
          obj.material = lambert;
          this.track(obj.geometry as THREE.BufferGeometry, lambert);
          if (old.map) this.track(old.map);
          old.dispose();
        }
      });
      // 站立人形坐到蒲团上：下半身没入蒲团，视觉为盘坐（D1 遮挡方案）
      model.position.y = CUSHION_HEIGHT - 0.32;
      this.group.add(model);
      this.body = model;
      this.baseBodyScaleY = model.scale.y; // 归一化后的缩放作为呼吸基准
      this.head = model; // GLB 无拆分头节点，点头动作用整体轻俯仰代替
    } else {
      this.buildProcedural(themeColor);
    }
  }

  /** 程序化回退：胶囊身体 + 球头 + 斗笠（TDD §5.2 回退方案）。 */
  private buildProcedural(themeColor: THREE.Color): void {
    const bodyGeo = new THREE.CapsuleGeometry(0.34, 0.72, 4, 10);
    const bodyMat = new THREE.MeshLambertMaterial({ color: themeColor, flatShading: true });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = CUSHION_HEIGHT + 0.62;
    this.group.add(body);

    const headGeo = new THREE.SphereGeometry(0.24, 12, 10);
    const headMat = new THREE.MeshLambertMaterial({ color: '#e8c9a8', flatShading: true });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = CUSHION_HEIGHT + 1.42;
    this.group.add(head);

    const hatGeo = new THREE.ConeGeometry(0.42, 0.24, 12);
    const hatMat = new THREE.MeshLambertMaterial({
      color: themeColor.clone().multiplyScalar(0.7),
      flatShading: true,
    });
    const hat = new THREE.Mesh(hatGeo, hatMat);
    hat.position.y = 0.2; // 头部局部坐标，随点头一起动
    head.add(hat);

    this.track(bodyGeo, bodyMat, headGeo, headMat, hatGeo, hatMat);
    this.body = body;
    this.head = head;
  }

  /** 冥想中动作幅度减半；对话/待机恢复。 */
  setMeditating(meditating: boolean): void {
    this.amplitude = meditating ? MEDITATION_AMPLITUDE : 1;
  }

  update(dt: number): void {
    this.elapsed += dt;
    this.tweens.update(dt);

    // 呼吸：scale.y = base × (1 + 0.015·sin(t·1.2))（TDD §5.2）
    if (this.body) {
      const k = 1 + 0.015 * this.amplitude * Math.sin(this.elapsed * 1.2);
      this.body.scale.y = this.baseBodyScaleY * k;
    }

    // 随机点头（每 6~9s 一次）
    if (!this.nodding && this.elapsed >= this.nextNodAt && this.head) {
      this.nodding = true;
      const depth = 0.09 * this.amplitude;
      const head = this.head;
      this.tweens.add({
        duration: 0.9,
        ease: Ease.sineInOut,
        onUpdate: (k) => {
          head.rotation.x = Math.sin(k * Math.PI) * depth;
        },
        onComplete: () => {
          head.rotation.x = 0;
          this.nodding = false;
          this.nextNodAt = this.elapsed + this.randomNodDelay();
        },
      });
    }
  }

  dispose(): void {
    this.tweens.clear();
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.group.clear();
    this.body = null;
    this.head = null;
  }

  private track(...items: Array<{ dispose(): void }>): void {
    this.disposables.push(...items);
  }

  private randomNodDelay(): number {
    return NOD_MIN_INTERVAL + Math.random() * (NOD_MAX_INTERVAL - NOD_MIN_INTERVAL);
  }
}
