import * as THREE from 'three';
import type { HillConfig } from '../../data/types';
import type { Tweens } from '../../core/Tween';

export interface HillNode {
  config: HillConfig;
  group: THREE.Group;
  mesh: THREE.Mesh;
  /** 山顶世界坐标 Y（浮签定位用）。 */
  apexY: number;
  setLit(lit: boolean, immediate?: boolean): void;
  dispose(): void;
}

const HILL_RADIUS = 7;
const HILL_HEIGHT = 10;
const LIT_LIGHT_INTENSITY = 35;
const LIT_TWEEN_SECONDS = 1.2;
const UNLIT_SAT_SCALE = 0.6; // 未点亮降饱和 40%（GDD §3.1）
const UNLIT_VAL_SCALE = 0.72;

function desaturateDarken(hex: string, satScale: number, valScale: number): THREE.Color {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s * satScale, hsl.l * valScale);
  return c;
}

/** 以山 id 为种子的确定性随机：同一座山每次生成都一样。 */
function seededRandom(seedStr: string): () => number {
  let seed = 2166136261;
  for (const ch of seedStr) {
    seed ^= ch.charCodeAt(0);
    seed = Math.imul(seed, 16777619);
  }
  return () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967295;
  };
}

/**
 * 单座山：圆锥低模山体 + 顶部暖光 + 灯笼点缀 + 占位树。
 * 亮/暗双态用两套顶点色数组 + Tween 混合系数（TDD §12，禁止逐帧改几何）。
 */
export function createHill(config: HillConfig, groundY: number, tweens: Tweens): HillNode {
  const rand = seededRandom(config.id);
  const group = new THREE.Group();
  group.position.set(config.mapPosition[0], groundY, config.mapPosition[2]);

  // ---- 山体几何：圆锥 + 顶点扰动 ----
  const geo = new THREE.ConeGeometry(HILL_RADIUS, HILL_HEIGHT, 8, 4);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (Math.abs(y - HILL_HEIGHT / 2) > 0.01) {
      // 非顶点：径向与高度微扰，制造低模不规则感
      pos.setX(i, pos.getX(i) * (0.9 + rand() * 0.25));
      pos.setZ(i, pos.getZ(i) * (0.9 + rand() * 0.25));
      pos.setY(i, y + (rand() - 0.5) * 0.8);
    }
  }
  geo.translate(0, HILL_HEIGHT / 2, 0); // 底部对齐 group 原点

  // ---- 亮/暗两套顶点色 ----
  const lit = new Float32Array(pos.count * 3);
  const unlit = new Float32Array(pos.count * 3);
  const cBase = new THREE.Color(config.palette.accent1);
  const cMid = new THREE.Color(config.palette.primary);
  const cTop = new THREE.Color(config.palette.accent2);
  const uBase = desaturateDarken(config.palette.accent1, UNLIT_SAT_SCALE, UNLIT_VAL_SCALE);
  const uMid = desaturateDarken(config.palette.primary, UNLIT_SAT_SCALE, UNLIT_VAL_SCALE);
  const uTop = desaturateDarken(config.palette.accent2, UNLIT_SAT_SCALE, UNLIT_VAL_SCALE);
  const tmp = new THREE.Color();
  const tmpU = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = THREE.MathUtils.clamp(pos.getY(i) / HILL_HEIGHT, 0, 1);
    if (t < 0.55) {
      tmp.copy(cBase).lerp(cMid, t / 0.55);
      tmpU.copy(uBase).lerp(uMid, t / 0.55);
    } else {
      tmp.copy(cMid).lerp(cTop, (t - 0.55) / 0.45);
      tmpU.copy(uMid).lerp(uTop, (t - 0.55) / 0.45);
    }
    lit.set([tmp.r, tmp.g, tmp.b], i * 3);
    unlit.set([tmpU.r, tmpU.g, tmpU.b], i * 3);
  }
  const colorAttr = new THREE.BufferAttribute(new Float32Array(unlit), 3);
  geo.setAttribute('color', colorAttr);
  geo.computeVertexNormals();

  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.userData.hillId = config.id;
  mesh.name = `hill-${config.id}`;
  group.add(mesh);

  // ---- 顶部暖光（默认关闭）----
  const light = new THREE.PointLight('#ffd9a0', 0, 30, 2);
  light.position.y = HILL_HEIGHT + 2;
  group.add(light);

  // ---- 灯笼点缀（点亮时显现）----
  const lanternGeo = new THREE.IcosahedronGeometry(0.45, 0);
  const lanternMat = new THREE.MeshBasicMaterial({ color: '#ffcf87', transparent: true, opacity: 0 });
  const lanterns: THREE.Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const angle = (i / 3) * Math.PI * 2 + rand();
    const lantern = new THREE.Mesh(lanternGeo, lanternMat);
    lantern.position.set(
      Math.cos(angle) * (HILL_RADIUS + 1.5),
      1.2,
      Math.sin(angle) * (HILL_RADIUS + 1.5),
    );
    lantern.scale.setScalar(0.01);
    lantern.visible = false;
    group.add(lantern);
    lanterns.push(lantern);
  }

  // ---- 占位树（M1 一种，M3 按 env.decor 替换）----
  const treeGeo = new THREE.ConeGeometry(0.9, 2.2, 6);
  treeGeo.translate(0, 1.1, 0);
  const treeMat = new THREE.MeshLambertMaterial({ color: config.palette.accent1, flatShading: true });
  for (let i = 0; i < 3; i++) {
    const angle = rand() * Math.PI * 2;
    const dist = HILL_RADIUS + 2.5 + rand() * 2.5;
    const tree = new THREE.Mesh(treeGeo, treeMat);
    tree.position.set(Math.cos(angle) * dist, 0, Math.sin(angle) * dist);
    tree.scale.setScalar(0.8 + rand() * 0.5);
    group.add(tree);
  }

  // ---- 亮/暗混合 ----
  let litK = 0;
  const applyBlend = (k: number): void => {
    litK = k;
    const arr = colorAttr.array as Float32Array;
    for (let i = 0; i < arr.length; i++) {
      arr[i] = unlit[i] + (lit[i] - unlit[i]) * k;
    }
    colorAttr.needsUpdate = true;
    light.intensity = k * LIT_LIGHT_INTENSITY;
    for (const lantern of lanterns) {
      lantern.visible = k > 0.02;
      lantern.scale.setScalar(Math.max(k, 0.01));
    }
    lanternMat.opacity = k;
  };

  const setLit = (litState: boolean, immediate = false): void => {
    const to = litState ? 1 : 0;
    if (immediate) {
      applyBlend(to);
      return;
    }
    const from = litK;
    tweens.add({
      duration: LIT_TWEEN_SECONDS,
      onUpdate: (k) => applyBlend(from + (to - from) * k),
    });
  };

  const dispose = (): void => {
    geo.dispose();
    mat.dispose();
    lanternGeo.dispose();
    lanternMat.dispose();
    treeGeo.dispose();
    treeMat.dispose();
  };

  return { config, group, mesh, apexY: groundY + HILL_HEIGHT + 1, setLit, dispose };
}
