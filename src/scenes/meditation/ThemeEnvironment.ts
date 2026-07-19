import * as THREE from 'three';
import type { HillConfig } from '../../data/types';

/**
 * 冥想场景主题环境（TDD §5.2 模板 / 决策 D2：装饰全部程序化生成）：
 * - themeGround：直径 40m 圆形地块，双色调低模；
 * - skyDome：大反转球体顶点色渐变（day/night/sunset 预设 × 主题色），night 追加星点与流星；
 * - decorGroup：按 env.decor 清单实例化（InstancedMesh + 共享材质），M3 已补齐全部 14 种 key；
 * - particles：按 env.particles 类型差异化（落叶/雪/花瓣/萤火/蒸汽），Points ≤ 500。
 * 主题色来自 hills.json 配置；树干/岩石等辅件用固定中性色，代码无主题专属分支。
 *
 * 布局约定：中央 r<9 留给老师/玩家/对话机位；冥想机位 r=12.5 环绕，
 * 高大装饰放外环 r13~19，低矮装饰可放 r9~13；固定随机种子保证每次进入布局一致。
 */

export interface ThemeEnvironment {
  group: THREE.Group;
  /** 点亮演出用：k=0 unlit（降饱和 40%）→ k=1 lit 全饱和。 */
  applyLightMix(k: number): void;
  update(dt: number): void;
  dispose(): void;
}

interface ColorPair {
  unlit: THREE.Color;
  lit: THREE.Color;
  apply(c: THREE.Color): void; // 把插值结果写回目标
}

type Updatable = (dt: number, t: number) => void;
type Disposables = Array<{ dispose(): void }>;

const GROUND_RADIUS = 20;
const PARTICLE_COUNT = 300;
const STEAM_COUNT = 160;

export function buildThemeEnvironment(config: HillConfig): ThemeEnvironment {
  const group = new THREE.Group();
  const disposables: Disposables = [];
  const updatables: Updatable[] = [];
  const pairs: ColorPair[] = [];

  // ---------- 地面（直径 40m，双色调顶点色）----------
  const groundGeo = new THREE.CircleGeometry(GROUND_RADIUS, 40, 0, Math.PI * 2);
  const pos = groundGeo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const cA = new THREE.Color(config.palette.accent1);
  const cB = new THREE.Color(config.palette.primary).lerp(cA, 0.5);
  for (let i = 0; i < pos.count; i++) {
    const r = Math.hypot(pos.getX(i), pos.getY(i)) / GROUND_RADIUS;
    const c = cA.clone().lerp(cB, Math.min(r * 1.2, 1));
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  groundGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const groundMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  group.add(ground);
  disposables.push(groundGeo, groundMat);

  // ---------- 天穹（反转球体，顶点色渐变）----------
  const skyPresets: Record<HillConfig['env']['sky'], { zenith: string; horizon: string }> = {
    day: { zenith: '#9ec8e8', horizon: config.env.fog },
    sunset: { zenith: '#5a4a7a', horizon: '#e8a06a' },
    night: { zenith: '#101828', horizon: '#2a3448' },
  };
  const preset = skyPresets[config.env.sky];
  const skyGeo = new THREE.SphereGeometry(90, 24, 12);
  const spos = skyGeo.attributes.position;
  const scolors = new Float32Array(spos.count * 3);
  const zenith = new THREE.Color(preset.zenith);
  const horizon = new THREE.Color(preset.horizon);
  for (let i = 0; i < spos.count; i++) {
    const k = THREE.MathUtils.clamp(spos.getY(i) / 90, 0, 1);
    const c = horizon.clone().lerp(zenith, Math.pow(k, 0.7));
    scolors[i * 3] = c.r;
    scolors[i * 3 + 1] = c.g;
    scolors[i * 3 + 2] = c.b;
  }
  skyGeo.setAttribute('color', new THREE.BufferAttribute(scolors, 3));
  const skyMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  group.add(sky);
  disposables.push(skyGeo, skyMat);

  // ---------- 夜空：星点 + 流星（仅 night 预设，M3-D2）----------
  if (config.env.sky === 'night') {
    const starField = buildStarField(disposables);
    group.add(starField.object);
    updatables.push(starField.update);
  }

  // ---------- 装饰（InstancedMesh，D2 程序化）----------
  const decorBuilders: Record<string, () => THREE.Object3D> = {
    bamboo: () => buildBambooGrove(config, disposables),
    stone_lantern: () => buildStoneLanterns(config, disposables),
    pine: () => buildPines(config, disposables),
    rock: () => buildRocks(disposables),
    reed: () => buildReeds(disposables),
    crystal: () => buildCrystals(config, disposables),
    dry_tree: () => buildDryTrees(disposables),
    sakura_tree: () => buildSakuraTrees(config, disposables),
    grass_tuft: () => buildGrassTufts(config, disposables, updatables),
    steam_vent: () => buildSteamVents(disposables),
    pagoda: () => buildPagodas(config, disposables),
    banner: () => buildBanners(config, disposables, updatables),
    water_glint: () => buildWaterGlint(config, disposables, updatables),
    dune: () => buildDunes(config, disposables),
  };
  for (const key of config.env.decor) {
    const builder = decorBuilders[key];
    if (!builder) {
      console.warn(`[ThemeEnvironment] 未知装饰 key: ${key}`);
      continue;
    }
    group.add(builder());
  }

  // ---------- 粒子（按类型差异化，Points ≤ 500）----------
  const particles = buildParticles(config, disposables);
  if (particles) {
    group.add(particles.points);
    updatables.push(particles.update);
  }

  // ---------- unlit/lit 插值 ----------
  // 地面/天穹顶点色按 lit 烘焙；材质 color 作为乘性系数在冷灰(unlit)与白(lit)间插值
  const unlitTint = new THREE.Color('#8f9a90'); // 降饱和冷灰乘色
  const litTint = new THREE.Color('#ffffff');
  pairs.push(
    { unlit: unlitTint, lit: litTint, apply: (c) => groundMat.color.copy(c) },
    { unlit: unlitTint.clone(), lit: litTint.clone(), apply: (c) => skyMat.color.copy(c) },
  );

  const tmp = new THREE.Color();
  const applyLightMix = (k: number): void => {
    for (const p of pairs) {
      tmp.copy(p.unlit).lerp(p.lit, k);
      p.apply(tmp);
    }
  };
  applyLightMix(0); // 默认 unlit（演出时渐变到 lit）

  let t = 0;
  return {
    group,
    applyLightMix,
    update(dt) {
      t += dt;
      for (const u of updatables) u(dt, t);
    },
    dispose() {
      for (const d of disposables) d.dispose();
      group.clear();
    },
  };
}

// ============================================================
// 共用工具
// ============================================================

/** 固定种子伪随机：保证每次进入布局一致。 */
function makeRand(seed: number): () => number {
  let s = seed;
  return (): number => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

/** 环形布点：rMin~rMax 之间随机取一点（中央空地由 rMin 保证）。 */
function ringPos(rand: () => number, rMin: number, rMax: number): { x: number; z: number } {
  const a = rand() * Math.PI * 2;
  const r = rMin + rand() * (rMax - rMin);
  return { x: Math.cos(a) * r, z: Math.sin(a) * r };
}

const _base = new THREE.Matrix4();
const _local = new THREE.Matrix4();
const _composed = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

/** 组合实例矩阵：T(pos)·R(yaw+可选 tilt)·S(scale)·local（local 可级联多个）。 */
function setInstance(
  mesh: THREE.InstancedMesh,
  i: number,
  x: number,
  y: number,
  z: number,
  yaw: number,
  scale: THREE.Vector3,
  ...locals: THREE.Matrix4[]
): void {
  _e.set(0, yaw, 0);
  _q.setFromEuler(_e);
  _base.compose(new THREE.Vector3(x, y, z), _q, scale);
  _composed.copy(_base);
  for (const l of locals) _composed.multiply(l);
  mesh.setMatrixAt(i, _composed);
}

function t(x: number, y: number, z: number): THREE.Matrix4 {
  return new THREE.Matrix4().makeTranslation(x, y, z);
}

function rz(angle: number): THREE.Matrix4 {
  return new THREE.Matrix4().makeRotationZ(angle);
}

function ry(angle: number): THREE.Matrix4 {
  return new THREE.Matrix4().makeRotationY(angle);
}

function lambert(color: THREE.ColorRepresentation, disposables: Disposables): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial({ color, flatShading: true });
  disposables.push(m);
  return m;
}

function instanced(
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  count: number,
  disposables: Disposables,
): THREE.InstancedMesh {
  disposables.push(geo);
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  return mesh;
}

// ============================================================
// 装饰件（全部程序化，InstancedMesh）
// ============================================================

/** 竹丛：三节竹竿 + 叶冠，绕场地边缘环形分布（InstancedMesh）。 */
function buildBambooGrove(config: HillConfig, disposables: Disposables): THREE.Object3D {
  const COUNT = 56;
  const stalkGeo = new THREE.CylinderGeometry(0.07, 0.09, 1, 6);
  const leafGeo = new THREE.ConeGeometry(0.55, 1.1, 6);
  const stalkMat = new THREE.MeshLambertMaterial({ color: config.palette.primary, flatShading: true });
  const leafMat = new THREE.MeshLambertMaterial({ color: config.palette.accent1, flatShading: true });
  disposables.push(stalkGeo, leafGeo, stalkMat, leafMat);

  const stalks = new THREE.InstancedMesh(stalkGeo, stalkMat, COUNT);
  const leaves = new THREE.InstancedMesh(leafGeo, leafMat, COUNT);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);

  const rand = makeRand(42);
  for (let i = 0; i < COUNT; i++) {
    const { x, z } = ringPos(rand, 10.5, 19);
    const h = 4.5 + rand() * 3.5;
    const tilt = (rand() - 0.5) * 0.08;
    q.setFromAxisAngle(up, rand() * Math.PI * 2);
    const tiltQ = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(x / (Math.hypot(x, z) || 1), 0, z / (Math.hypot(x, z) || 1)),
      tilt,
    );
    q.premultiply(tiltQ);

    m.compose(new THREE.Vector3(x, h / 2, z), q, new THREE.Vector3(1, h, 1));
    stalks.setMatrixAt(i, m);
    m.compose(new THREE.Vector3(x, h + 0.4, z), q, new THREE.Vector3(1, 1, 1));
    leaves.setMatrixAt(i, m);
  }
  stalks.instanceMatrix.needsUpdate = true;
  leaves.instanceMatrix.needsUpdate = true;

  const grove = new THREE.Group();
  grove.add(stalks, leaves);
  return grove;
}

/** 石灯笼：叠放基座/灯室/顶盖，沿入口小径两侧布置（InstancedMesh）。 */
function buildStoneLanterns(config: HillConfig, disposables: Disposables): THREE.Object3D {
  const COUNT = 6;
  const stoneMat = new THREE.MeshLambertMaterial({ color: '#9aa39b', flatShading: true });
  const glowMat = new THREE.MeshLambertMaterial({
    color: config.palette.accent2,
    emissive: config.palette.accent2,
    emissiveIntensity: 0.25,
    flatShading: true,
  });
  const baseGeo = new THREE.CylinderGeometry(0.32, 0.4, 0.5, 6);
  const boxGeo = new THREE.BoxGeometry(0.42, 0.36, 0.42);
  const roofGeo = new THREE.ConeGeometry(0.42, 0.3, 6);
  disposables.push(stoneMat, glowMat, baseGeo, boxGeo, roofGeo);

  const bases = new THREE.InstancedMesh(baseGeo, stoneMat, COUNT);
  const boxes = new THREE.InstancedMesh(boxGeo, glowMat, COUNT);
  const roofs = new THREE.InstancedMesh(roofGeo, stoneMat, COUNT);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();

  for (let i = 0; i < COUNT; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    const row = Math.floor(i / 2);
    const x = side * (2.6 + row * 0.4);
    const z = 6.5 - row * 3.2; // 从入口（+Z）向场地中心排布
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (i * Math.PI) / 7);
    m.compose(new THREE.Vector3(x, 0.25, z), q, new THREE.Vector3(1, 1, 1));
    bases.setMatrixAt(i, m);
    m.compose(new THREE.Vector3(x, 0.68, z), q, new THREE.Vector3(1, 1, 1));
    boxes.setMatrixAt(i, m);
    m.compose(new THREE.Vector3(x, 1.01, z), q, new THREE.Vector3(1, 1, 1));
    roofs.setMatrixAt(i, m);
  }
  bases.instanceMatrix.needsUpdate = true;
  boxes.instanceMatrix.needsUpdate = true;
  roofs.instanceMatrix.needsUpdate = true;

  const lanterns = new THREE.Group();
  lanterns.add(bases, boxes, roofs);
  return lanterns;
}

/** 松树：干 + 两层塔形叶冠，外环布置（雪顶/雾谷）。 */
function buildPines(config: HillConfig, disposables: Disposables): THREE.Object3D {
  const COUNT = 12;
  const trunkGeo = new THREE.CylinderGeometry(0.09, 0.13, 1.3, 6);
  const cone1Geo = new THREE.ConeGeometry(1.0, 1.5, 7);
  const cone2Geo = new THREE.ConeGeometry(0.68, 1.15, 7);
  const trunkMat = lambert('#6e4f33', disposables);
  const leafMat = lambert(config.palette.accent1, disposables);

  const trunks = instanced(trunkGeo, trunkMat, COUNT, disposables);
  const cones1 = instanced(cone1Geo, leafMat, COUNT, disposables);
  const cones2 = instanced(cone2Geo, leafMat, COUNT, disposables);

  const rand = makeRand(101);
  const s = new THREE.Vector3();
  for (let i = 0; i < COUNT; i++) {
    const { x, z } = ringPos(rand, 13, 19);
    const k = 0.9 + rand() * 0.5;
    s.set(k, k, k);
    const yaw = rand() * Math.PI * 2;
    setInstance(trunks, i, x, 0.65 * k, z, yaw, s);
    setInstance(cones1, i, x, 0, z, yaw, s, t(0, 1.8, 0));
    setInstance(cones2, i, x, 0, z, yaw, s, t(0, 2.75, 0));
  }
  trunks.instanceMatrix.needsUpdate = true;
  cones1.instanceMatrix.needsUpdate = true;
  cones2.instanceMatrix.needsUpdate = true;

  const pines = new THREE.Group();
  pines.add(trunks, cones1, cones2);
  return pines;
}

/** 岩石：扁平低多边形石块，任意环带（低矮，不挡冥想机位）。 */
function buildRocks(disposables: Disposables): THREE.Object3D {
  const COUNT = 12;
  const geo = new THREE.IcosahedronGeometry(1, 0);
  const mat = lambert('#8f969b', disposables);
  const rocks = instanced(geo, mat, COUNT, disposables);

  const rand = makeRand(202);
  const s = new THREE.Vector3();
  for (let i = 0; i < COUNT; i++) {
    const { x, z } = ringPos(rand, 9.5, 18);
    s.set(0.3 + rand() * 0.8, 0.22 + rand() * 0.5, 0.3 + rand() * 0.8);
    setInstance(rocks, i, x, 0.08, z, rand() * Math.PI * 2, s);
  }
  rocks.instanceMatrix.needsUpdate = true;
  return rocks;
}

/** 芦苇：细茎 + 穗头，外环成丛（湖畔）。 */
function buildReeds(disposables: Disposables): THREE.Object3D {
  const COUNT = 36;
  const stemGeo = new THREE.CylinderGeometry(0.02, 0.03, 1.6, 5);
  stemGeo.translate(0, 0.8, 0); //  pivot 移到根部
  const tipGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.22, 5);
  const stemMat = lambert('#7d9a5e', disposables);
  const tipMat = lambert('#8a6b42', disposables);

  const stems = instanced(stemGeo, stemMat, COUNT, disposables);
  const tips = instanced(tipGeo, tipMat, COUNT, disposables);

  const rand = makeRand(303);
  const s = new THREE.Vector3();
  for (let i = 0; i < COUNT; i++) {
    const { x, z } = ringPos(rand, 13.5, 18);
    const k = 0.7 + rand() * 0.5;
    s.set(k, k, k);
    const yaw = rand() * Math.PI * 2;
    setInstance(stems, i, x, 0, z, yaw, s, rz((rand() - 0.5) * 0.12));
    setInstance(tips, i, x, 0, z, yaw, s, t(0, 1.62, 0));
  }
  stems.instanceMatrix.needsUpdate = true;
  tips.instanceMatrix.needsUpdate = true;

  const reeds = new THREE.Group();
  reeds.add(stems, tips);
  return reeds;
}

/** 水晶簇：八面体竖立微光，中环散布（星空原）。 */
function buildCrystals(config: HillConfig, disposables: Disposables): THREE.Object3D {
  const COUNT = 10;
  const geo = new THREE.OctahedronGeometry(1, 0);
  const mat = new THREE.MeshLambertMaterial({
    color: config.palette.accent2,
    emissive: config.palette.accent2,
    emissiveIntensity: 0.35,
    flatShading: true,
  });
  disposables.push(mat);
  const crystals = instanced(geo, mat, COUNT, disposables);

  const rand = makeRand(404);
  const s = new THREE.Vector3();
  for (let i = 0; i < COUNT; i++) {
    const { x, z } = ringPos(rand, 10, 17);
    const sy = 0.8 + rand() * 0.9;
    s.set(0.28 + rand() * 0.22, sy, 0.28 + rand() * 0.22);
    setInstance(crystals, i, x, 0.45 * sy, z, rand() * Math.PI * 2, s, rz((rand() - 0.5) * 0.15));
  }
  crystals.instanceMatrix.needsUpdate = true;
  return crystals;
}

/** 枯树：斜干 + 两根枯枝，外环点缀（沙漠）。 */
function buildDryTrees(disposables: Disposables): THREE.Object3D {
  const COUNT = 8;
  const trunkGeo = new THREE.CylinderGeometry(0.07, 0.12, 2.0, 6);
  const branchGeo = new THREE.CylinderGeometry(0.03, 0.05, 0.9, 5);
  branchGeo.translate(0, 0.45, 0); // pivot 移到枝根
  const mat = lambert('#7a6a58', disposables);

  const trunks = instanced(trunkGeo, mat, COUNT, disposables);
  const branches1 = instanced(branchGeo, mat, COUNT, disposables);
  const branches2 = instanced(branchGeo, mat, COUNT, disposables);

  const rand = makeRand(505);
  const s = new THREE.Vector3();
  for (let i = 0; i < COUNT; i++) {
    const { x, z } = ringPos(rand, 13, 18);
    const k = 0.85 + rand() * 0.4;
    s.set(k, k, k);
    const yaw = rand() * Math.PI * 2;
    setInstance(trunks, i, x, 1.0 * k, z, yaw, s, rz((rand() - 0.5) * 0.1));
    setInstance(branches1, i, x, 0, z, yaw, s, t(0, 1.55, 0), rz(0.75));
    setInstance(branches2, i, x, 0, z, yaw, s, t(0, 1.15, 0), ry(2.1), rz(-0.65));
  }
  trunks.instanceMatrix.needsUpdate = true;
  branches1.instanceMatrix.needsUpdate = true;
  branches2.instanceMatrix.needsUpdate = true;

  const trees = new THREE.Group();
  trees.add(trunks, branches1, branches2);
  return trees;
}

/** 樱花树：干 + 团状花冠，外环布置（樱花坡）。 */
function buildSakuraTrees(config: HillConfig, disposables: Disposables): THREE.Object3D {
  const COUNT = 10;
  const trunkGeo = new THREE.CylinderGeometry(0.11, 0.15, 1.6, 6);
  const canopyGeo = new THREE.IcosahedronGeometry(1.25, 1);
  const trunkMat = lambert('#6e4f3a', disposables);
  const canopyMat = lambert(config.palette.primary, disposables);

  const trunks = instanced(trunkGeo, trunkMat, COUNT, disposables);
  const canopies = instanced(canopyGeo, canopyMat, COUNT, disposables);

  const rand = makeRand(606);
  const s = new THREE.Vector3();
  for (let i = 0; i < COUNT; i++) {
    const { x, z } = ringPos(rand, 13, 19);
    const k = 0.9 + rand() * 0.4;
    s.set(k, k, k);
    const yaw = rand() * Math.PI * 2;
    setInstance(trunks, i, x, 0.8 * k, z, yaw, s);
    setInstance(canopies, i, x, 0, z, yaw, s, t(0, 2.35, 0));
  }
  trunks.instanceMatrix.needsUpdate = true;
  canopies.instanceMatrix.needsUpdate = true;

  const trees = new THREE.Group();
  trees.add(trunks, canopies);
  return trees;
}

/** 草丛：小锥体满铺 + 风中摇摆（草浪，草原）。 */
function buildGrassTufts(
  config: HillConfig,
  disposables: Disposables,
  updatables: Updatable[],
): THREE.Object3D {
  const COUNT = 140;
  const geo = new THREE.ConeGeometry(0.1, 0.55, 4);
  geo.translate(0, 0.275, 0); // pivot 移到根部，摇摆更自然
  const mat = lambert(config.palette.primary, disposables);
  const tufts = instanced(geo, mat, COUNT, disposables);

  const rand = makeRand(707);
  const bases: THREE.Matrix4[] = [];
  const phases: number[] = [];
  const s = new THREE.Vector3();
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  for (let i = 0; i < COUNT; i++) {
    const { x, z } = ringPos(rand, 8.5, 19);
    const k = 0.7 + rand() * 0.7;
    s.set(k, k, k);
    pos.set(x, 0, z);
    quat.setFromEuler(new THREE.Euler(0, rand() * Math.PI * 2, 0));
    bases.push(new THREE.Matrix4().compose(pos, quat, s));
    phases.push(rand() * Math.PI * 2);
  }

  const sway = new THREE.Matrix4();
  const out = new THREE.Matrix4();
  updatables.push((_dt, tNow) => {
    for (let i = 0; i < COUNT; i++) {
      sway.makeRotationZ(Math.sin(tNow * 1.6 + phases[i]) * 0.1);
      out.copy(bases[i]).multiply(sway);
      tufts.setMatrixAt(i, out);
    }
    tufts.instanceMatrix.needsUpdate = true;
  });
  return tufts;
}

/** 蒸汽孔：低丘 + 暗色孔口，中环布置（温泉谷，蒸汽粒子从此带升起）。 */
function buildSteamVents(disposables: Disposables): THREE.Object3D {
  const COUNT = 5;
  const moundGeo = new THREE.CylinderGeometry(0.45, 0.75, 0.55, 7);
  const craterGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.12, 7);
  const moundMat = lambert('#8a7a6a', disposables);
  const craterMat = lambert('#3a332c', disposables);

  const mounds = instanced(moundGeo, moundMat, COUNT, disposables);
  const craters = instanced(craterGeo, craterMat, COUNT, disposables);

  const rand = makeRand(808);
  const s = new THREE.Vector3();
  for (let i = 0; i < COUNT; i++) {
    const { x, z } = ringPos(rand, 9.5, 13.5);
    const k = 0.8 + rand() * 0.5;
    s.set(k, k, k);
    const yaw = rand() * Math.PI * 2;
    setInstance(mounds, i, x, 0.27 * k, z, yaw, s);
    setInstance(craters, i, x, 0, z, yaw, s, t(0, 0.56, 0));
  }
  mounds.instanceMatrix.needsUpdate = true;
  craters.instanceMatrix.needsUpdate = true;

  const vents = new THREE.Group();
  vents.add(mounds, craters);
  return vents;
}

/** 寺塔：三层塔，入口两侧后方各一（古寺；每部件 InstancedMesh × 2 实例）。 */
function buildPagodas(config: HillConfig, disposables: Disposables): THREE.Object3D {
  const COUNT = 2;
  const bodyMat = lambert('#a84038', disposables);
  const roofMat = lambert('#413c48', disposables);
  const baseMat = lambert('#8f969b', disposables);
  const finialMat = lambert(config.palette.accent2, disposables);

  const baseGeo = new THREE.BoxGeometry(1.9, 0.5, 1.9);
  const tierGeos = [
    new THREE.BoxGeometry(1.5, 0.55, 1.5),
    new THREE.BoxGeometry(1.15, 0.55, 1.15),
    new THREE.BoxGeometry(0.85, 0.55, 0.85),
  ];
  const roofGeos = [
    new THREE.ConeGeometry(1.35, 0.5, 4),
    new THREE.ConeGeometry(1.05, 0.5, 4),
    new THREE.ConeGeometry(0.8, 0.5, 4),
  ];
  const finialGeo = new THREE.CylinderGeometry(0.05, 0.12, 0.5, 6);

  const bases = instanced(baseGeo, baseMat, COUNT, disposables);
  const tiers = tierGeos.map((g) => instanced(g, bodyMat, COUNT, disposables));
  const roofs = roofGeos.map((g) => instanced(g, roofMat, COUNT, disposables));
  const finials = instanced(finialGeo, finialMat, COUNT, disposables);

  // 两塔：入口（+Z）后方左右，错位一近一远
  const placements = [
    { angle: (135 * Math.PI) / 180, radius: 15.5, scale: 1.0, yaw: 0.3 },
    { angle: (225 * Math.PI) / 180, radius: 17, scale: 1.25, yaw: 1.1 },
  ];
  const s = new THREE.Vector3();
  // 各层局部 y 偏移：基座顶 0.5 → 层/檐交替叠放
  const tierY = [0.775, 1.825, 2.875];
  const roofY = [1.3, 2.35, 3.4];
  for (let i = 0; i < COUNT; i++) {
    const p = placements[i];
    const x = Math.cos(p.angle) * p.radius;
    const z = Math.sin(p.angle) * p.radius;
    s.set(p.scale, p.scale, p.scale);
    setInstance(bases, i, x, 0.25 * p.scale, z, p.yaw, s);
    for (let lv = 0; lv < 3; lv++) {
      setInstance(tiers[lv], i, x, 0, z, p.yaw, s, t(0, tierY[lv], 0));
      setInstance(roofs[lv], i, x, 0, z, p.yaw + Math.PI / 4, s, t(0, roofY[lv], 0));
    }
    setInstance(finials, i, x, 0, z, p.yaw, s, t(0, 3.9, 0));
  }
  bases.instanceMatrix.needsUpdate = true;
  for (const m of [...tiers, ...roofs]) m.instanceMatrix.needsUpdate = true;
  finials.instanceMatrix.needsUpdate = true;

  const pagodas = new THREE.Group();
  pagodas.add(bases, ...tiers, ...roofs, finials);
  return pagodas;
}

/** 幡：立杆 + 垂布，沿入口小径两侧，布面随风轻摆（古寺）。 */
function buildBanners(
  config: HillConfig,
  disposables: Disposables,
  updatables: Updatable[],
): THREE.Object3D {
  const COUNT = 6;
  const poleGeo = new THREE.CylinderGeometry(0.03, 0.04, 2.6, 6);
  const clothGeo = new THREE.PlaneGeometry(0.55, 1.15);
  clothGeo.translate(0, -0.6, 0); // pivot 移到布顶边
  const poleMat = lambert('#5e4a36', disposables);
  const clothMat = new THREE.MeshLambertMaterial({
    color: config.palette.primary,
    side: THREE.DoubleSide,
    flatShading: true,
  });
  disposables.push(clothMat);

  const poles = instanced(poleGeo, poleMat, COUNT, disposables);
  const cloths = instanced(clothGeo, clothMat, COUNT, disposables);

  const s = new THREE.Vector3(1, 1, 1);
  const phases: number[] = [];
  const spots: { x: number; z: number; yaw: number }[] = [];
  for (let i = 0; i < COUNT; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    const row = Math.floor(i / 2);
    const x = side * 3.4;
    const z = 7.5 - row * 4.2; // 从入口（+Z）向场地中心排布
    const yaw = side > 0 ? -0.35 : 0.35 + Math.PI; // 布面朝场内
    spots.push({ x, z, yaw });
    phases.push(i * 1.3);
    setInstance(poles, i, x, 1.3, z, yaw, s);
  }
  poles.instanceMatrix.needsUpdate = true;

  const out = new THREE.Matrix4();
  updatables.push((_dt, tNow) => {
    for (let i = 0; i < COUNT; i++) {
      const sp = spots[i];
      _e.set(Math.sin(tNow * 1.1 + phases[i]) * 0.09, sp.yaw, 0);
      _q.setFromEuler(_e);
      out.compose(new THREE.Vector3(sp.x, 2.45, sp.z), _q, s);
      cloths.setMatrixAt(i, out);
    }
    cloths.instanceMatrix.needsUpdate = true;
  });
  void _local;

  const banners = new THREE.Group();
  banners.add(poles, cloths);
  return banners;
}

/** 水面反光片：半透明大圆片贴地，微微呼吸式明暗（湖畔，M3-D2）。 */
function buildWaterGlint(
  config: HillConfig,
  disposables: Disposables,
  updatables: Updatable[],
): THREE.Object3D {
  const geo = new THREE.CircleGeometry(9, 28);
  const mat = new THREE.MeshBasicMaterial({
    color: config.palette.accent2,
    transparent: true,
    opacity: 0.3,
    depthWrite: false,
  });
  disposables.push(geo, mat);
  const water = new THREE.Mesh(geo, mat);
  water.rotation.x = -Math.PI / 2;
  water.position.set(9, 0.03, -7); // 铺在场地边缘一侧，半入外环
  updatables.push((_dt, tNow) => {
    mat.opacity = 0.27 + 0.07 * Math.sin(tNow * 0.8);
  });
  return water;
}

/** 沙丘：压扁球体成丘，外环弧线（沙漠）。 */
function buildDunes(config: HillConfig, disposables: Disposables): THREE.Object3D {
  const COUNT = 6;
  const geo = new THREE.SphereGeometry(1, 12, 8);
  const mat = lambert(config.palette.accent2, disposables);
  const dunes = instanced(geo, mat, COUNT, disposables);

  const rand = makeRand(909);
  const s = new THREE.Vector3();
  for (let i = 0; i < COUNT; i++) {
    const { x, z } = ringPos(rand, 14, 19);
    s.set(5 + rand() * 3, 1.2 + rand() * 0.8, 3.5 + rand() * 2);
    setInstance(dunes, i, x, 0, z, rand() * Math.PI * 2, s);
  }
  dunes.instanceMatrix.needsUpdate = true;
  return dunes;
}

// ============================================================
// 夜空（仅 night 预设）：星点 + 流星
// ============================================================

function buildStarField(disposables: Disposables): { object: THREE.Object3D; update: Updatable } {
  const group = new THREE.Group();

  // 星点：上半球内贴穹顶随机分布，sizeAttenuation=false 保证远处可见
  const STAR_COUNT = 380;
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(STAR_COUNT * 3);
  const rand = makeRand(1201);
  for (let i = 0; i < STAR_COUNT; i++) {
    const az = rand() * Math.PI * 2;
    const el = Math.asin(0.12 + rand() * 0.88); // 仰角 7°~90°
    const r = 84;
    positions[i * 3] = Math.cos(el) * Math.cos(az) * r;
    positions[i * 3 + 1] = Math.sin(el) * r;
    positions[i * 3 + 2] = Math.cos(el) * Math.sin(az) * r;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const starMat = new THREE.PointsMaterial({
    color: '#dfe8ff',
    size: 1.7,
    sizeAttenuation: false,
    transparent: true,
    opacity: 0.95,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  });
  disposables.push(geo, starMat);
  const stars = new THREE.Points(geo, starMat);
  group.add(stars);

  // 流星：细长条带沿高空划过，0.8s 一生，间隔 5~11s 随机
  const meteorGeo = new THREE.BoxGeometry(0.07, 0.07, 3.4);
  const meteorMat = new THREE.MeshBasicMaterial({
    color: '#eef3ff',
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  });
  disposables.push(meteorGeo, meteorMat);
  const meteor = new THREE.Mesh(meteorGeo, meteorMat);
  meteor.visible = false;
  group.add(meteor);

  let wait = 3; // 首次流星较快出现
  let flying = false;
  let flyT = 0;
  const FLY_DURATION = 0.8;
  const from = new THREE.Vector3();
  const to = new THREE.Vector3();
  const mrand = makeRand(1301);

  const update: Updatable = (dt) => {
    if (!flying) {
      wait -= dt;
      if (wait <= 0) {
        const az = mrand() * Math.PI * 2;
        const y = 28 + mrand() * 20;
        const r = 62 + mrand() * 12;
        from.set(Math.cos(az) * r, y, Math.sin(az) * r);
        const sweep = az + (0.6 + mrand() * 0.5);
        to.set(Math.cos(sweep) * r, y - 4 - mrand() * 6, Math.sin(sweep) * r);
        flying = true;
        flyT = 0;
        meteor.visible = true;
      }
      return;
    }
    flyT += dt;
    const k = Math.min(flyT / FLY_DURATION, 1);
    meteor.position.lerpVectors(from, to, k);
    meteor.lookAt(to);
    meteorMat.opacity = Math.sin(k * Math.PI) * 0.9;
    if (k >= 1) {
      flying = false;
      meteor.visible = false;
      meteorMat.opacity = 0;
      wait = 5 + mrand() * 6;
    }
  };

  return { object: group, update };
}

// ============================================================
// 粒子（按 env.particles 类型差异化）
// ============================================================

interface ParticleSystem {
  points: THREE.Points;
  update: Updatable;
}

function buildParticles(config: HillConfig, disposables: Disposables): ParticleSystem | null {
  switch (config.env.particles) {
    case 'none':
      return null;
    case 'leaves':
      return buildFalling(config, disposables, { speedMin: 0.5, speedMax: 1.3, size: 0.16, sway: 0.5 });
    case 'snow':
      return buildFalling(config, disposables, { speedMin: 0.25, speedMax: 0.6, size: 0.12, sway: 0.35 });
    case 'petals':
      return buildFalling(config, disposables, { speedMin: 0.4, speedMax: 0.85, size: 0.18, sway: 0.9 });
    case 'fireflies':
      return buildFireflies(config, disposables);
    case 'steam':
      return buildSteam(disposables);
  }
}

/** 下落型粒子（落叶/雪/花瓣共用）：循环下落 + 横向摇摆，颜色取 accent2。 */
function buildFalling(
  config: HillConfig,
  disposables: Disposables,
  opts: { speedMin: number; speedMax: number; size: number; sway: number },
): ParticleSystem {
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(PARTICLE_COUNT * 3);
  const speeds = new Float32Array(PARTICLE_COUNT);
  const phases = new Float32Array(PARTICLE_COUNT);
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 36;
    positions[i * 3 + 1] = Math.random() * 12;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 36;
    speeds[i] = opts.speedMin + Math.random() * (opts.speedMax - opts.speedMin);
    phases[i] = Math.random() * Math.PI * 2;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: config.palette.accent2,
    size: opts.size,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.85,
  });
  disposables.push(geo, mat);
  const points = new THREE.Points(geo, mat);

  const update: Updatable = (dt, tNow) => {
    const attr = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      let y = attr.getY(i) - speeds[i] * dt;
      if (y < 0.05) y = 10 + Math.random() * 3;
      attr.setY(i, y);
      attr.setX(i, attr.getX(i) + Math.sin(tNow * 1.4 + phases[i]) * dt * opts.sway);
    }
    attr.needsUpdate = true;
  };
  return { points, update };
}

/** 萤火：低空漂浮游移，加色发光（湖畔/星空原/古寺）。 */
function buildFireflies(config: HillConfig, disposables: Disposables): ParticleSystem {
  const COUNT = 120;
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(COUNT * 3);
  const bases = new Float32Array(COUNT * 3);
  const phases = new Float32Array(COUNT);
  const speeds = new Float32Array(COUNT);
  const rand = makeRand(1501);
  for (let i = 0; i < COUNT; i++) {
    const a = rand() * Math.PI * 2;
    const r = 3 + rand() * 14;
    bases[i * 3] = Math.cos(a) * r;
    bases[i * 3 + 1] = 0.4 + rand() * 2.4;
    bases[i * 3 + 2] = Math.sin(a) * r;
    positions[i * 3] = bases[i * 3];
    positions[i * 3 + 1] = bases[i * 3 + 1];
    positions[i * 3 + 2] = bases[i * 3 + 2];
    phases[i] = rand() * Math.PI * 2;
    speeds[i] = 0.4 + rand() * 0.5;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: config.palette.accent2,
    size: 0.22,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  disposables.push(geo, mat);
  const points = new THREE.Points(geo, mat);

  const update: Updatable = (_dt, tNow) => {
    const attr = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < COUNT; i++) {
      const p = phases[i];
      const sp = speeds[i];
      attr.setX(i, bases[i * 3] + Math.sin(tNow * sp + p) * 1.2);
      attr.setY(i, bases[i * 3 + 1] + Math.sin(tNow * sp * 1.7 + p * 2) * 0.4);
      attr.setZ(i, bases[i * 3 + 2] + Math.cos(tNow * sp * 0.8 + p) * 1.2);
    }
    attr.needsUpdate = true;
  };
  return { points, update };
}

/** 蒸汽：从蒸汽孔环带升起，到顶循环（温泉谷）。 */
function buildSteam(disposables: Disposables): ParticleSystem {
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(STEAM_COUNT * 3);
  const speeds = new Float32Array(STEAM_COUNT);
  const phases = new Float32Array(STEAM_COUNT);
  const rand = makeRand(1601);
  const spawn = (i: number, yMax: number): void => {
    const a = rand() * Math.PI * 2;
    const r = 9 + rand() * 5;
    positions[i * 3] = Math.cos(a) * r;
    positions[i * 3 + 1] = rand() * yMax;
    positions[i * 3 + 2] = Math.sin(a) * r;
  };
  for (let i = 0; i < STEAM_COUNT; i++) {
    spawn(i, 4);
    speeds[i] = 0.5 + rand() * 0.5;
    phases[i] = rand() * Math.PI * 2;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: '#f6f2ea',
    size: 0.55,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.32,
    depthWrite: false,
  });
  disposables.push(geo, mat);
  const points = new THREE.Points(geo, mat);

  const update: Updatable = (dt, tNow) => {
    const attr = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < STEAM_COUNT; i++) {
      let y = attr.getY(i) + speeds[i] * dt;
      if (y > 4.5) {
        spawn(i, 0.5);
        y = positions[i * 3 + 1];
        attr.setX(i, positions[i * 3]);
        attr.setZ(i, positions[i * 3 + 2]);
      }
      attr.setY(i, y);
      attr.setX(i, attr.getX(i) + Math.sin(tNow * 0.9 + phases[i]) * dt * 0.3);
    }
    attr.needsUpdate = true;
  };
  return { points, update };
}
