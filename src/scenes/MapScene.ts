import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { IScene } from '../core/SceneManager';
import type { EventBus } from '../core/EventBus';
import type { SaveSystem } from '../systems/SaveSystem';
import type { AudioManager } from '../systems/AudioManager';
import type { HillConfig } from '../data/types';
import type { PerfProfile } from '../core/perf';
import { Tweens } from '../core/Tween';
import { buildTerrain, type TerrainResult } from './map/TerrainBuilder';
import { createHill, type HillNode } from './map/HillFactory';
import type { Tooltip } from '../ui/Tooltip';

interface MapSceneDeps {
  bus: EventBus;
  save: SaveSystem;
  hills: HillConfig[];
  tooltip: Tooltip;
  canvas: HTMLCanvasElement;
  audio: AudioManager;
  perf: PerfProfile;
}

const IDLE_AUTOROTATE_DELAY = 5; // 秒（TDD §5.1：空闲 5s 后自动旋转）
const CLICK_DRAG_THRESHOLD = 5; // px，区分点击与拖拽
const HOVER_EMISSIVE_INTENSITY = 0.15;

/** 主场景：禅境地图 —— 地形、10 山、亮/暗双态、拾取（TDD §5.1）。 */
export class MapScene implements IScene {
  readonly id = 'map' as const;
  readonly scene3 = new THREE.Scene();
  readonly camera3: THREE.PerspectiveCamera;

  private controls: OrbitControls | null = null;
  private tweens = new Tweens();
  private terrain: TerrainResult | null = null;
  private hillNodes: HillNode[] = [];
  private raycaster = new THREE.Raycaster();
  private pointerNdc = new THREE.Vector2();
  private pointerDirty = false;
  private hovered: HillNode | null = null;
  private downPos: { x: number; y: number } | null = null;
  private lastInputAt = 0;
  private elapsed = 0;
  private disposers: Array<() => void> = [];
  // M4：点亮山常驻萤火（一个共享 Points，密度随性能档位）
  private fireflies: {
    points: THREE.Points;
    count: number;
    bases: Float32Array;
    phases: Float32Array;
    speeds: Float32Array;
  } | null = null;

  constructor(private deps: MapSceneDeps) {
    this.camera3 = new THREE.PerspectiveCamera(
      50,
      window.innerWidth / window.innerHeight,
      0.1,
      500,
    );
    this.camera3.position.set(0, 55, 85);
  }

  enter(): void {
    const { bus, save, hills, tooltip, canvas } = this.deps;

    this.scene3.background = new THREE.Color('#c9dbd2');
    this.scene3.fog = new THREE.Fog('#c9dbd2', 70, 190);

    const ambient = new THREE.AmbientLight('#e8f0e9', 1.0);
    const sun = new THREE.DirectionalLight('#fff3dd', 1.8);
    sun.position.set(60, 90, 40);
    this.scene3.add(ambient, sun);

    this.terrain = buildTerrain(hills);
    this.scene3.add(this.terrain.mesh, this.terrain.water);

    for (const config of hills) {
      const groundY = this.terrain.heightAt(config.mapPosition[0], config.mapPosition[2]);
      const node = createHill(config, groundY, this.tweens);
      node.setLit(save.isLit(config.id), true);
      this.hillNodes.push(node);
      this.scene3.add(node.group);
    }

    this.controls = new OrbitControls(this.camera3, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.minPolarAngle = THREE.MathUtils.degToRad(20);
    this.controls.maxPolarAngle = THREE.MathUtils.degToRad(60);
    this.controls.minDistance = 30;
    this.controls.maxDistance = 90;
    this.controls.enablePan = false;
    this.controls.autoRotateSpeed = 0.3;
    this.controls.target.set(0, 4, 0);
    this.lastInputAt = this.elapsed;

    const markInput = (): void => {
      this.lastInputAt = this.elapsed;
    };
    const onMove = (e: PointerEvent): void => {
      this.pointerNdc.set(
        (e.clientX / window.innerWidth) * 2 - 1,
        -(e.clientY / window.innerHeight) * 2 + 1,
      );
      this.pointerDirty = true;
    };
    const onDown = (e: PointerEvent): void => {
      markInput();
      this.downPos = { x: e.clientX, y: e.clientY };
    };
    const onWheel = (): void => markInput();
    const onUp = (e: PointerEvent): void => {
      markInput();
      if (!this.downPos) return;
      const moved = Math.hypot(e.clientX - this.downPos.x, e.clientY - this.downPos.y);
      this.downPos = null;
      if (moved < CLICK_DRAG_THRESHOLD && this.hovered) {
        bus.emit('hill:selected', { hillId: this.hovered.config.id });
      }
    };
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('wheel', onWheel);
    this.disposers.push(() => {
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('wheel', onWheel);
    });

    this.disposers.push(
      bus.on('debug:toggle-lit', ({ hillId, lit }) => {
        const node = this.hillNodes.find((n) => n.config.id === hillId);
        if (node) node.setLit(lit);
        save.debugSetLit(hillId, lit);
        bus.emit('ui:progress', { lit: save.litCount(), total: hills.length });
        this.rebuildFireflies();
      }),
    );

    this.rebuildFireflies(); // M4：点亮山常驻萤火
    bus.emit('ui:progress', { lit: save.litCount(), total: hills.length });
    tooltip.hide();
  }

  // ---------- M4：点亮山常驻萤火 ----------

  /** 按当前点亮状态重建共享萤火 Points（每座亮山一圈游移光点）。 */
  private rebuildFireflies(): void {
    this.disposeFireflies();
    const per = Math.max(5, Math.round(12 * this.deps.perf.particleScale));
    const litNodes = this.hillNodes.filter((n) => this.deps.save.isLit(n.config.id));
    const count = litNodes.length * per;
    if (count === 0) return;

    const positions = new Float32Array(count * 3);
    const bases = new Float32Array(count * 3);
    const phases = new Float32Array(count);
    const speeds = new Float32Array(count);
    let i = 0;
    for (const node of litNodes) {
      for (let k = 0; k < per; k++, i++) {
        const a = Math.random() * Math.PI * 2;
        const r = 3.5 + Math.random() * 6;
        bases[i * 3] = node.group.position.x + Math.cos(a) * r;
        bases[i * 3 + 1] = node.apexY - 4 + Math.random() * 5;
        bases[i * 3 + 2] = node.group.position.z + Math.sin(a) * r;
        positions[i * 3] = bases[i * 3];
        positions[i * 3 + 1] = bases[i * 3 + 1];
        positions[i * 3 + 2] = bases[i * 3 + 2];
        phases[i] = Math.random() * Math.PI * 2;
        speeds[i] = 0.3 + Math.random() * 0.5;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: '#ffdf9e',
      size: 0.9,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const points = new THREE.Points(geo, mat);
    this.scene3.add(points);
    this.fireflies = { points, count, bases, phases, speeds };
  }

  private disposeFireflies(): void {
    if (!this.fireflies) return;
    this.scene3.remove(this.fireflies.points);
    this.fireflies.points.geometry.dispose();
    (this.fireflies.points.material as THREE.Material).dispose();
    this.fireflies = null;
  }

  private updateFireflies(): void {
    const f = this.fireflies;
    if (!f) return;
    const attr = f.points.geometry.attributes.position as THREE.BufferAttribute;
    const t = this.elapsed;
    for (let i = 0; i < f.count; i++) {
      const p = f.phases[i];
      const sp = f.speeds[i];
      attr.setX(i, f.bases[i * 3] + Math.sin(t * sp + p) * 1.6);
      attr.setY(i, f.bases[i * 3 + 1] + Math.sin(t * sp * 1.6 + p * 2) * 0.7);
      attr.setZ(i, f.bases[i * 3 + 2] + Math.cos(t * sp * 0.7 + p) * 1.6);
    }
    attr.needsUpdate = true;
  }

  // ---------- M4：10/10 全局完成演出（B2b 灯光秀） ----------

  /**
   * 地图全景灯光秀：镜头缓拉高俯瞰 → 十山按序"熄灭-重亮"波浪 + 每山一声钵音。
   * 期间锁定 OrbitControls；resolve 后由主流程弹出终局贺词面板。
   */
  playFinale(): Promise<void> {
    return new Promise((resolve) => {
      try {
        this.playFinaleInner(resolve);
      } catch (err) {
        console.error('[MapScene] finale error', err);
        if (this.controls) this.controls.enabled = true;
        resolve();
      }
    });
  }

  private playFinaleInner(resolve: () => void): void {
    if (this.controls) this.controls.enabled = false;
    this.deps.tooltip.hide();

    // 镜头缓推到全景机位
    const camFrom = this.camera3.position.clone();
    const camTo = new THREE.Vector3(0, 95, 130);
    const targetFrom = this.controls?.target.clone() ?? new THREE.Vector3(0, 4, 0);
    this.tweens.add({
      duration: 3.2,
      ease: (k) => 1 - Math.pow(1 - k, 3),
      onUpdate: (k) => {
        this.camera3.position.lerpVectors(camFrom, camTo, k);
        this.controls?.target.lerpVectors(targetFrom, new THREE.Vector3(0, 4, 0), k);
      },
    });

    // 十山按距地图中心的方位角排序，依次重亮（波浪环绕一周）
    const ordered = [...this.hillNodes].sort(
      (a, b) =>
        Math.atan2(a.group.position.x, a.group.position.z) -
        Math.atan2(b.group.position.x, b.group.position.z),
    );
    const STEP = 0.45;
    ordered.forEach((node, i) => {
      // 延时 tween：i*STEP 后触发该山"熄灭→重亮"波浪
      this.tweens.add({
        duration: 0.05 + i * STEP,
        onUpdate: () => undefined,
        onComplete: () => {
          node.setLit(false, true);
          node.setLit(true);
          this.deps.audio.playSfx('lit');
          this.rebuildFireflies();
        },
      });
    });

    const total = 1.2 + ordered.length * STEP + 1.6;
    this.tweens.add({
      duration: total,
      onUpdate: () => undefined,
      onComplete: () => {
        if (this.controls) this.controls.enabled = true;
        resolve();
      },
    });
  }

  update(dt: number): void {
    this.elapsed += dt;
    this.tweens.update(dt);

    if (this.controls) {
      this.controls.autoRotate = this.elapsed - this.lastInputAt > IDLE_AUTOROTATE_DELAY;
      this.controls.update();
    }
    if (this.pointerDirty) {
      this.pointerDirty = false; // 每帧最多一次 Raycast（TDD §5.1）
      this.updateHover();
    }
    this.updateFireflies();
    this.updateTooltip();
  }

  private updateHover(): void {
    this.raycaster.setFromCamera(this.pointerNdc, this.camera3);
    const hits = this.raycaster.intersectObjects(
      this.hillNodes.map((n) => n.mesh),
      false,
    );
    const node = hits.length
      ? (this.hillNodes.find((n) => n.mesh === hits[0].object) ?? null)
      : null;
    if (node === this.hovered) return;

    if (this.hovered) this.setHoverEmissive(this.hovered, false);
    this.hovered = node;
    if (node) this.setHoverEmissive(node, true);
    document.body.style.cursor = node ? 'pointer' : '';
    if (!node) this.deps.tooltip.hide();
  }

  private setHoverEmissive(node: HillNode, on: boolean): void {
    const mat = node.mesh.material as THREE.MeshLambertMaterial;
    mat.emissive.set(on ? '#ffffff' : '#000000');
    mat.emissiveIntensity = on ? HOVER_EMISSIVE_INTENSITY : 0;
  }

  private updateTooltip(): void {
    if (!this.hovered) return;
    const v = new THREE.Vector3(
      this.hovered.group.position.x,
      this.hovered.apexY,
      this.hovered.group.position.z,
    );
    v.project(this.camera3);
    const x = (v.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-v.y * 0.5 + 0.5) * window.innerHeight;
    this.deps.tooltip.show(this.hovered.config.name, x, y);
  }

  resize(width: number, height: number): void {
    this.camera3.aspect = width / height;
    this.camera3.updateProjectionMatrix();
  }

  exit(): void {
    // 状态保留在成员中，资源由 dispose 统一释放
  }

  dispose(): void {
    for (const d of this.disposers) d();
    this.disposers = [];
    this.hovered = null;
    document.body.style.cursor = '';
    this.deps.tooltip.hide();
    this.disposeFireflies();
    this.controls?.dispose();
    this.controls = null;
    this.tweens.clear();
    for (const node of this.hillNodes) node.dispose();
    this.hillNodes = [];
    if (this.terrain) {
      this.terrain.mesh.geometry.dispose();
      (this.terrain.mesh.material as THREE.Material).dispose();
      this.terrain.water.geometry.dispose();
      (this.terrain.water.material as THREE.Material).dispose();
      this.terrain = null;
    }
    this.scene3.clear();
  }
}
