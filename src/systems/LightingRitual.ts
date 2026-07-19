import * as THREE from 'three';
import { Ease, Tweens } from '../core/Tween';
import type { HillConfig } from '../data/types';
import type { AudioSystem } from './AudioSystem';

/** 演出宿主接口：由 MeditationScene 实现，系统层不直接触碰场景内部。 */
export interface RitualStage {
  readonly scene3: THREE.Scene;
  readonly tweens: Tweens;
  /** 老师身后光柱锚点（世界坐标）。 */
  teacherAnchor(): THREE.Vector3;
  /** unlit(0) → lit(1) 场景配色插值。 */
  applyLightMix(k: number): void;
  /** 演出期间吞掉全部输入。 */
  setInputLocked(locked: boolean): void;
}

const GOLD = '#ffd98a';
const PARTICLE_COUNT = 300;
const PARTICLE_LIFE = 1.5;

/**
 * 点亮演出（TDD §6.4，约 4s，全部 Tween 串联）：
 * t=0 钵音 → t=0.2 光柱升起（加色 ShaderMaterial）→ t=0.8 金粒扩散（300 Points）
 * → t=0.8~3.0 场景配色 unlit→lit → t=3.0 光柱淡出 → resolve。
 */
export class LightingRitual {
  constructor(private audio: AudioSystem) {}

  play(stage: RitualStage, theme: HillConfig): Promise<void> {
    return new Promise((resolve) => {
      // 异常兜底：任何一步失败都清理并 resolve，绝不悬挂完成流程（ISSUE-M2-001 F5）
      try {
        this.playInner(stage, theme, resolve);
      } catch (err) {
        console.error('[LightingRitual] play error', err);
        stage.setInputLocked(false);
        resolve();
      }
    });
  }

  private playInner(stage: RitualStage, theme: HillConfig, resolve: () => void): void {
    {
      stage.setInputLocked(true);
      const anchor = stage.teacherAnchor();
      const disposables: Array<{ dispose(): void }> = [];

      // ---- 光柱：圆柱 + 加色渐变 ShaderMaterial ----
      const pillarGeo = new THREE.CylinderGeometry(0.9, 1.15, 14, 20, 1, true);
      const pillarMat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        uniforms: {
          uColor: { value: new THREE.Color(theme.palette.accent2).lerp(new THREE.Color(GOLD), 0.5) },
          uOpacity: { value: 0 },
        },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor;
          uniform float uOpacity;
          varying vec2 vUv;
          void main() {
            float fade = smoothstep(0.0, 0.25, vUv.y) * (1.0 - smoothstep(0.55, 1.0, vUv.y));
            gl_FragColor = vec4(uColor, uOpacity * fade);
          }
        `,
      });
      const pillar = new THREE.Mesh(pillarGeo, pillarMat);
      pillar.position.copy(anchor).add(new THREE.Vector3(0, 7, -1.2));
      stage.scene3.add(pillar);
      disposables.push(pillarGeo, pillarMat);

      // ---- 金粒扩散环：300 Points ----
      const pGeo = new THREE.BufferGeometry();
      const positions = new Float32Array(PARTICLE_COUNT * 3);
      const dirs = new Float32Array(PARTICLE_COUNT * 3);
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const a = Math.random() * Math.PI * 2;
        const up = Math.random() * 0.8;
        const len = Math.hypot(1, up);
        dirs[i * 3] = Math.cos(a) / len;
        dirs[i * 3 + 1] = up / len;
        dirs[i * 3 + 2] = Math.sin(a) / len;
        positions[i * 3] = anchor.x;
        positions[i * 3 + 1] = anchor.y + 0.8;
        positions[i * 3 + 2] = anchor.z;
      }
      pGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const pMat = new THREE.PointsMaterial({
        color: GOLD,
        size: 0.14,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const sparks = new THREE.Points(pGeo, pMat);
      stage.scene3.add(sparks);
      disposables.push(pGeo, pMat);

      const cleanup = (): void => {
        stage.scene3.remove(pillar, sparks);
        for (const d of disposables) d.dispose();
        stage.setInputLocked(false);
      };

      const tw = stage.tweens;

      // t=0：钵音（D6：与 HUD 占位音复用同一合成函数）
      this.audio.playBowl();

      // t=0.2：光柱升起（透明度 0→0.6）
      delay(tw, 0.2, () => {
        tw.add({
          duration: 0.7,
          ease: Ease.cubicOut,
          onUpdate: (k) => {
            pillarMat.uniforms.uOpacity.value = k * 0.6;
          },
        });
      });

      // t=0.8：金粒扩散（1.5s 生命周期）
      delay(tw, 0.8, () => {
        const attr = pGeo.attributes.position as THREE.BufferAttribute;
        tw.add({
          duration: PARTICLE_LIFE,
          ease: Ease.quadOut,
          onUpdate: (k) => {
            const r = k * 9;
            for (let i = 0; i < PARTICLE_COUNT; i++) {
              attr.setXYZ(
                i,
                anchor.x + dirs[i * 3] * r,
                anchor.y + 0.8 + dirs[i * 3 + 1] * r,
                anchor.z + dirs[i * 3 + 2] * r,
              );
            }
            attr.needsUpdate = true;
            pMat.opacity = k < 0.2 ? k / 0.2 : 1 - (k - 0.2) / 0.8;
          },
        });
      });

      // t=0.8~3.0：场景配色 unlit → lit
      delay(tw, 0.8, () => {
        tw.add({
          duration: 2.2,
          ease: Ease.sineInOut,
          onUpdate: (k) => stage.applyLightMix(k),
        });
      });

      // t=3.0：光柱淡出 → 收尾
      delay(tw, 3.0, () => {
        tw.add({
          duration: 0.9,
          ease: Ease.sineInOut,
          onUpdate: (k) => {
            pillarMat.uniforms.uOpacity.value = 0.6 * (1 - k);
          },
          onComplete: () => {
            cleanup();
            resolve();
          },
        });
      });
    }
  }
}

/** 用宿主 Tweens 实现一次性延时回调（保持单一时钟源）。 */
function delay(tweens: Tweens, seconds: number, fn: () => void): void {
  tweens.add({ duration: seconds, onUpdate: () => undefined, onComplete: fn });
}
