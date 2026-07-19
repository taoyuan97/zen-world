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
 * - teacher.color 应用为主衣色；teacher.prop 程序化配饰（M3-D3：固定偏移摆放，不做手部挂接）。
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

    this.buildProp();
  }

  /** 创建配饰小件并登记释放（局部辅助）。 */
  private propMesh(
    geo: THREE.BufferGeometry,
    color: THREE.ColorRepresentation,
    px: number,
    py: number,
    pz: number,
    rx = 0,
    ry = 0,
    rz = 0,
    emissive = false,
  ): THREE.Mesh {
    const mat = new THREE.MeshLambertMaterial({
      color,
      flatShading: true,
      ...(emissive ? { emissive: color, emissiveIntensity: 0.6 } : {}),
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(px, py, pz);
    mesh.rotation.set(rx, ry, rz);
    this.group.add(mesh);
    this.track(geo, mat);
    return mesh;
  }

  /**
   * 程序化配饰（M3-D3）：GLB 无手部骨点，配饰按固定偏移摆放在身侧/身前/胸前。
   * 老师面向 +Z（玩家入口），前 = +Z。
   */
  private buildProp(): void {
    switch (this.config.teacher.prop) {
      case 'bamboo_staff': // 竹杖（竹心）：身侧倚杖
        this.propMesh(new THREE.CylinderGeometry(0.03, 0.035, 1.5, 6), '#7a9a52', 0.95, 0.73, 0.1, 0, 0, -0.18);
        break;
      case 'prayer_beads': // 念珠（雪寂）：胸前垂挂
        this.propMesh(new THREE.TorusGeometry(0.16, 0.032, 8, 16), '#7a5230', 0, 1.0, 0.18, 1.35, 0, 0);
        break;
      case 'tea_bowl': // 茶碗（涟漪）：蒲团前侧碗 + 托
        this.propMesh(new THREE.CylinderGeometry(0.14, 0.11, 0.025, 10), '#8fa8a0', 0.42, 0.3, 0.62);
        this.propMesh(new THREE.CylinderGeometry(0.09, 0.05, 0.08, 10), '#a8c0b8', 0.42, 0.35, 0.62);
        break;
      case 'star_chart': { // 星图（星野）：斜倚蒲团的星点图板
        const board = this.propMesh(new THREE.BoxGeometry(0.5, 0.34, 0.02), '#232d45', -0.78, 0.34, 0.52, -0.45, 0.3, 0);
        for (const [sx, sy] of [[-0.15, 0.08], [0.05, 0.12], [0.16, -0.02], [-0.02, -0.09]] as const) {
          const dot = this.propMesh(new THREE.SphereGeometry(0.016, 6, 5), '#cfe0ff', 0, 0, 0, 0, 0, 0, true);
          dot.position.set(sx, sy, 0.015);
          board.add(dot);
        }
        break;
      }
      case 'wooden_fish': // 木鱼（无尘）：身前小垫上的木鱼 + 槌
        this.propMesh(new THREE.CylinderGeometry(0.2, 0.22, 0.045, 10), '#5e4a36', 0, 0.03, 0.95);
        this.propMesh(new THREE.SphereGeometry(0.14, 10, 8), '#8a5a2e', 0, 0.15, 0.95).scale.set(1, 0.78, 1.12);
        this.propMesh(new THREE.CylinderGeometry(0.015, 0.015, 0.3, 5), '#6e4a26', 0.22, 0.06, 0.98, 0, 0, 1.35);
        break;
      case 'paper_umbrella': // 纸伞（花见）：身侧立伞
        this.propMesh(new THREE.CylinderGeometry(0.02, 0.02, 1.4, 6), '#8a6b42', -1.0, 0.7, 0.15);
        this.propMesh(new THREE.ConeGeometry(0.6, 0.24, 10), '#e8a0b0', -1.0, 1.42, 0.15);
        this.propMesh(new THREE.SphereGeometry(0.035, 6, 5), '#c86a80', -1.0, 1.58, 0.15);
        break;
      case 'walking_stick': // 拐杖（雾隐）：身侧短杖 + 弯头
        this.propMesh(new THREE.CylinderGeometry(0.028, 0.033, 1.15, 6), '#8a7a5e', -0.92, 0.56, 0.18, 0, 0, 0.14);
        this.propMesh(new THREE.SphereGeometry(0.05, 6, 5), '#7a6a4e', -1.0, 1.12, 0.18);
        break;
      case 'reed_flute': // 芦笛（风行）：横放蒲团前
        this.propMesh(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 6), '#c8b070', 0, 0.31, 0.6, 0, 0.25, Math.PI / 2);
        break;
      case 'wooden_ladle': // 木勺（暖阳）：身侧勺柄 + 勺头
        this.propMesh(new THREE.CylinderGeometry(0.016, 0.016, 0.38, 6), '#9e6f3a', 0.85, 0.2, 0.5, 0, 0, 0.9);
        this.propMesh(new THREE.SphereGeometry(0.065, 8, 6), '#8a5f30', 0.68, 0.06, 0.5).scale.set(1, 0.55, 1);
        break;
      case 'temple_bell': // 寺钟（了然）：身前小座铜钟
        this.propMesh(new THREE.CylinderGeometry(0.22, 0.24, 0.06, 10), '#5e4a36', -0.65, 0.03, 0.85);
        this.propMesh(new THREE.CylinderGeometry(0.13, 0.19, 0.26, 10), '#b08a3e', -0.65, 0.2, 0.85);
        this.propMesh(new THREE.TorusGeometry(0.045, 0.012, 6, 10), '#8a6a2e', -0.65, 0.35, 0.85);
        break;
      default:
        console.warn(`[TeacherRig] 未知配饰 prop: ${this.config.teacher.prop}`);
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
