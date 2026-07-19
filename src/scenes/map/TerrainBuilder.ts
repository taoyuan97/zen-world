import * as THREE from 'three';
import type { HillConfig } from '../../data/types';

// ---- 自实现 value-noise（约 20 行，不引第三方库，TDD §5.1）----
function hash2(ix: number, iz: number): number {
  let h = (ix * 374761393 + iz * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function smoothstep01(t: number): number {
  const c = Math.min(Math.max(t, 0), 1);
  return c * c * (3 - 2 * c);
}

function valueNoise(x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = smoothstep01(x - ix);
  const fz = smoothstep01(z - iz);
  const a = hash2(ix, iz);
  const b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1);
  const d = hash2(ix + 1, iz + 1);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}

function fbm(x: number, z: number, octaves: number): number {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x * freq, z * freq) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

export const HILL_PLATEAU_Y = 2.0;
export const WATER_Y = 0.35;

const HILL_FLATTEN_RADIUS = 13;
const TERRAIN_SIZE = 200;
const TERRAIN_SEGMENTS = 96;

/** 地形高度场：山位处压平台，边缘隆起形成环形远山剪影。 */
export function makeHeightField(hills: HillConfig[]): (x: number, z: number) => number {
  return (x: number, z: number): number => {
    let h = fbm(x * 0.02, z * 0.02, 4) * 12 - 3.5;
    const r = Math.hypot(x, z);
    h += smoothstep01((r - 60) / 35) * 14;
    for (const hill of hills) {
      const [hx, , hz] = hill.mapPosition;
      const d = Math.hypot(x - hx, z - hz);
      if (d < HILL_FLATTEN_RADIUS) {
        const k = smoothstep01(1 - d / HILL_FLATTEN_RADIUS);
        h = h * (1 - k) + HILL_PLATEAU_Y * k;
      }
    }
    return h;
  };
}

export interface TerrainResult {
  mesh: THREE.Mesh;
  water: THREE.Mesh;
  heightAt: (x: number, z: number) => number;
}

export function buildTerrain(hills: HillConfig[]): TerrainResult {
  const heightAt = makeHeightField(hills);

  const geo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, TERRAIN_SEGMENTS, TERRAIN_SEGMENTS);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);

  // 按高度分带的顶点色（TDD §5.1：水下蓝灰 / 低海拔苔绿 / 高处岩灰）
  const cUnder = new THREE.Color('#6d7f8a');
  const cShore = new THREE.Color('#a9b388');
  const cLow = new THREE.Color('#7d9b76');
  const cHigh = new THREE.Color('#8fa883');
  const cRock = new THREE.Color('#8c8578');
  const cPeak = new THREE.Color('#a39a8c');
  const tmp = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = heightAt(x, z);
    pos.setY(i, y);

    if (y < WATER_Y + 0.15) tmp.copy(cUnder);
    else if (y < 1.2) tmp.copy(cShore);
    else if (y < 5) tmp.copy(cLow).lerp(cHigh, (y - 1.2) / 3.8);
    else if (y < 9) tmp.copy(cHigh).lerp(cRock, (y - 5) / 4);
    else tmp.copy(cRock).lerp(cPeak, Math.min((y - 9) / 8, 1));

    colors[i * 3] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
  );
  mesh.name = 'terrain';

  const waterGeo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, 1, 1);
  waterGeo.rotateX(-Math.PI / 2);
  const water = new THREE.Mesh(
    waterGeo,
    new THREE.MeshLambertMaterial({ color: '#5e8ba0', transparent: true, opacity: 0.72 }),
  );
  water.position.y = WATER_Y;
  water.name = 'water';

  return { mesh, water, heightAt };
}
