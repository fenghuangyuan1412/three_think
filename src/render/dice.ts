/**
 * 3D 骰子演出：每次移动回合掷骰时，在棋盘水面上抛掷并定格。
 *
 * 纯程序化（agent.md §8）：六面用 Canvas 烘点数贴图，落定用欧拉表把
 * 对应面转到 +Y。动画由 app.ts 在 `state.dice` 变化时触发一次。
 */
import * as THREE from 'three';
import type { DiceRoll } from '../core/voyage';
import type { FlatPoint } from './coords';

export interface DiceView {
  readonly group: THREE.Group;
  /** 在 center 附近抛掷这组骰子（同一组点数重复调用不会重播） */
  throw(rolls: readonly DiceRoll[], center: FlatPoint): void;
  /** 每帧推进动画 */
  update(deltaSeconds: number): void;
  dispose(): void;
}

const DIE_SIZE = 0.34;
const PIP_LAYOUT: Record<number, Array<[number, number]>> = {
  1: [[0, 0]],
  2: [[-1, -1], [1, 1]],
  3: [[-1, -1], [0, 0], [1, 1]],
  4: [[-1, -1], [-1, 1], [1, -1], [1, 1]],
  5: [[-1, -1], [-1, 1], [0, 0], [1, -1], [1, 1]],
  6: [[-1, -1], [-1, 0], [-1, 1], [1, -1], [1, 0], [1, 1]],
};

/** BoxGeometry 材质顺序 [+x,-x,+y,-y,+z,-z] 各自转到 +Y（面朝上）所需的欧拉角 */
const FACE_UP_ROTATION: Record<number, [number, number, number]> = {
  0: [0, 0, Math.PI / 2],
  1: [0, 0, -Math.PI / 2],
  2: [0, 0, 0],
  3: [Math.PI, 0, 0],
  4: [-Math.PI / 2, 0, 0],
  5: [Math.PI / 2, 0, 0],
};

function createDieFaceTexture(value: number, background: string): THREE.CanvasTexture {
  const px = 128;
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建 2D 画布上下文');

  ctx.fillStyle = background;
  ctx.fillRect(0, 0, px, px);
  // 四周压一点暗边，立方体上更有立体感
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 10;
  ctx.strokeRect(5, 5, px - 10, px - 10);

  ctx.fillStyle = '#f5efdd';
  for (const [gx, gy] of PIP_LAYOUT[value] ?? []) {
    ctx.beginPath();
    ctx.arc(px / 2 + gx * px * 0.27, px / 2 + gy * px * 0.27, px * 0.095, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

interface Die {
  readonly mesh: THREE.Mesh;
  readonly materials: THREE.MeshStandardMaterial[];
  readonly velocities: THREE.Vector3;
  start: THREE.Vector3;
  end: THREE.Vector3;
  endQuat: THREE.Quaternion;
  t: number;
  phase: 'idle' | 'flying' | 'resting';
  restLeft: number;
}

const THROW_SECONDS = 1.05;
const REST_SECONDS = 3.2;

/** goodColorOf 由 app.ts 注入（render/resources 的 goodHexCss，颜色单一来源） */
export function createDice(goodColorOf: (good: string) => string): DiceView {
  const group = new THREE.Group();
  group.name = 'dice';
  group.visible = false;

  const geometry = new THREE.BoxGeometry(DIE_SIZE, DIE_SIZE, DIE_SIZE);
  const textures: THREE.CanvasTexture[] = [];
  const dies: Die[] = [];
  let seedShuffle = 0;

  function makeDie(): Die {
    const materials = [1, 2, 3, 4, 5, 6].map((value) => {
      const texture = createDieFaceTexture(value, '#4b3623');
      textures.push(texture);
      return new THREE.MeshStandardMaterial({ map: texture, roughness: 0.55 });
    });
    const mesh = new THREE.Mesh(geometry, materials);
    mesh.castShadow = true;
    mesh.visible = false;
    group.add(mesh);
    return {
      mesh,
      materials,
      velocities: new THREE.Vector3(),
      start: new THREE.Vector3(),
      end: new THREE.Vector3(),
      endQuat: new THREE.Quaternion(),
      t: 0,
      phase: 'idle',
      restLeft: 0,
    };
  }

  /** 面点数 → 材质下标（该点数烘在 material[点数-1] 上） */
  function faceUpQuaternion(value: number): THREE.Quaternion {
    const e = FACE_UP_ROTATION[value - 1] ?? [0, 0, 0];
    return new THREE.Quaternion().setFromEuler(new THREE.Euler(e[0], e[1], e[2]));
  }

  /** 伪随机但不依赖 Math.random，联机各端演出可复现 */
  function rand(): number {
    seedShuffle = (seedShuffle * 1103515245 + 12345) & 0x7fffffff;
    return (seedShuffle >>> 8) / 8388608;
  }

  function ensureDices(count: number): void {
    while (dies.length < count) dies.push(makeDie());
  }

  /** 掷出后按颜色重建点数贴皮（不同货物颜色不同） */
  function recolor(die: Die, background: string): void {
    if (die.mesh.userData['color'] === background) return;
    die.materials.forEach((material, i) => {
      const old = material.map as THREE.CanvasTexture | null;
      if (old) {
        const idx = textures.indexOf(old);
        if (idx >= 0) textures.splice(idx, 1);
        old.dispose();
      }
      const texture = createDieFaceTexture(i + 1, background);
      textures.push(texture);
      material.map = texture;
      material.needsUpdate = true;
    });
    die.mesh.userData['color'] = background;
  }

  return {
    group,

    throw(rolls, center) {
      if (rolls.length === 0) return;
      ensureDices(rolls.length);
      group.visible = true;
      rolls.forEach((roll, i) => {
        const die = dies[i];
        if (!die) return;
        recolor(die, goodColorOf(roll.good) || '#4b3623');
        const angle = (i / rolls.length) * Math.PI * 2 + rand();
        const spread = 0.55 + rand() * 0.3;
        die.start.set(
          center.x + Math.cos(angle) * spread,
          2.4 + rand() * 0.5,
          center.z + Math.sin(angle) * spread,
        );
        die.end.set(
          center.x + Math.cos(angle) * (0.45 + rand() * 0.5),
          DIE_SIZE / 2 + 0.02,
          center.z + Math.sin(angle) * (0.45 + rand() * 0.5),
        );
        die.endQuat.copy(faceUpQuaternion(roll.pips));
        die.velocities.set((rand() - 0.5) * 14, (rand() - 0.5) * 10, (rand() - 0.5) * 14);
        die.mesh.position.copy(die.start);
        die.mesh.quaternion.setFromEuler(new THREE.Euler(rand() * 6, rand() * 6, rand() * 6));
        die.mesh.scale.setScalar(1);
        die.mesh.visible = true;
        die.t = 0;
        die.phase = 'flying';
      });
      // 多余的旧骰子直接收起
      for (let i = rolls.length; i < dies.length; i += 1) {
        const die = dies[i];
        if (die) {
          die.phase = 'idle';
          die.mesh.visible = false;
        }
      }
    },

    update(deltaSeconds) {
      if (!group.visible) return;
      let anyAlive = false;
      for (const die of dies) {
        if (die.phase === 'flying') {
          die.t += deltaSeconds / THROW_SECONDS;
          const e = Math.min(1, die.t);
          const ease = 1 - (1 - e) * (1 - e);
          die.mesh.position.lerpVectors(die.start, die.end, ease);
          if (e < 1) {
            die.mesh.rotation.x += die.velocities.x * deltaSeconds;
            die.mesh.rotation.y += die.velocities.y * deltaSeconds;
            die.mesh.rotation.z += die.velocities.z * deltaSeconds;
          } else {
            die.mesh.quaternion.slerp(die.endQuat, 0.35);
            die.phase = 'resting';
            die.restLeft = REST_SECONDS;
          }
          anyAlive = true;
        } else if (die.phase === 'resting') {
          die.mesh.quaternion.slerp(die.endQuat, Math.min(1, deltaSeconds * 8));
          die.restLeft -= deltaSeconds;
          if (die.restLeft <= 0.6) die.mesh.scale.setScalar(Math.max(0.02, die.restLeft / 0.6));
          if (die.restLeft <= 0) {
            die.phase = 'idle';
            die.mesh.visible = false;
          } else {
            anyAlive = true;
          }
        }
      }
      if (!anyAlive) group.visible = false;
    },

    dispose() {
      for (const texture of textures) texture.dispose();
      textures.length = 0;
      for (const die of dies) for (const material of die.materials) material.dispose();
      dies.length = 0;
      geometry.dispose();
      group.clear();
    },
  };
}
