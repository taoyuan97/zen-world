import * as THREE from 'three';
import type { HillConfig } from '../../data/types';

/**
 * 冥想场景主题环境（TDD §5.2 模板 / 决策 D2：装饰全部程序化生成）：
 * - themeGround：直径 40m 圆形地块，双色调低模；
 * - skyDome：大反转球体顶点色渐变（day/night/sunset 预设 × 主题色）；
 * - decorGroup：按 env.decor 清单实例化（InstancedMesh + 共享材质）；
 * - particles：主题落叶粒子（Points ≤ 500）。
 * 全部视觉值来自 hills.json 配置，代码零硬编码主题。
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

const GROUND_RADIUS = 20;
const PARTICLE_COUNT = 300;

export function buildThemeEnvironment(config: HillConfig): ThemeEnvironment {
  const group = new THREE.Group();
  const disposables: Array<{ dispose(): void }> = [];
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

  // ---------- 装饰（InstancedMesh，D2 程序化）----------
  const decorBuilders: Record<string, () => THREE.Object3D> = {
    bamboo: () => buildBambooGrove(config, disposables),
    stone_lantern: () => buildStoneLanterns(config, disposables),
  };
  for (const key of config.env.decor) {
    const builder = decorBuilders[key];
    if (!builder) {
      console.warn(`[ThemeEnvironment] 未知装饰 key: ${key}（M3 补齐）`);
      continue;
    }
    group.add(builder());
  }

  // ---------- 粒子（落叶，Points ≤ 500）----------
  const particles = buildParticles(config, disposables);
  if (particles) group.add(particles.points);

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

  return {
    group,
    applyLightMix,
    update(dt) {
      particles?.update(dt);
    },
    dispose() {
      for (const d of disposables) d.dispose();
      group.clear();
    },
  };
}

/** 竹丛：三节竹竿 + 叶冠，绕场地边缘环形分布（InstancedMesh）。 */
function buildBambooGrove(
  config: HillConfig,
  disposables: Array<{ dispose(): void }>,
): THREE.Object3D {
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

  let seed = 42; // 固定伪随机种子，保证每次进入布局一致
  const rand = (): number => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };

  for (let i = 0; i < COUNT; i++) {
    const angle = rand() * Math.PI * 2;
    const radius = 10.5 + rand() * 8.5; // 中央空地留给老师与玩家
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const h = 4.5 + rand() * 3.5;
    const tilt = (rand() - 0.5) * 0.08;
    q.setFromAxisAngle(up, rand() * Math.PI * 2);
    const tiltQ = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle)),
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
function buildStoneLanterns(
  config: HillConfig,
  disposables: Array<{ dispose(): void }>,
): THREE.Object3D {
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

/** 落叶粒子：Points 循环下落 + 横向摇摆（≤ 500 粒，TDD §9）。 */
function buildParticles(
  config: HillConfig,
  disposables: Array<{ dispose(): void }>,
): { points: THREE.Points; update(dt: number): void } | null {
  if (config.env.particles === 'none') return null;

  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(PARTICLE_COUNT * 3);
  const speeds = new Float32Array(PARTICLE_COUNT);
  const phases = new Float32Array(PARTICLE_COUNT);
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 36;
    positions[i * 3 + 1] = Math.random() * 12;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 36;
    speeds[i] = 0.5 + Math.random() * 0.8;
    phases[i] = Math.random() * Math.PI * 2;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: config.palette.accent2,
    size: 0.16,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.85,
  });
  disposables.push(geo, mat);
  const points = new THREE.Points(geo, mat);

  let t = 0;
  const update = (dt: number): void => {
    t += dt;
    const attr = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      let y = attr.getY(i) - speeds[i] * dt;
      if (y < 0.05) y = 10 + Math.random() * 3;
      attr.setY(i, y);
      attr.setX(i, attr.getX(i) + Math.sin(t * 1.4 + phases[i]) * dt * 0.5);
    }
    attr.needsUpdate = true;
  };
  return { points, update };
}
