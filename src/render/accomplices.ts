/**
 * 小弟棋子 —— 国际象棋「象（bishop）」造型。
 *
 * 程序化生成（agent.md §8 无外部美术）：LatheGeometry 旋转出轮廓，
 * 头部嵌一条深色斜劈缝（象的 miter cut），一眼能和圆盘/兵区分开。
 *
 * 货仓格位上的棋子会**挂在船体上**，因此船移动时棋子自动跟随，
 * 不需要每帧重新计算世界坐标（agent.md §6：避免每帧分配对象）。
 */
import * as THREE from 'three';
import type { Player, PlayerId } from '../core/types';
import type { BoatState, Placement, SpotRef } from '../core/voyage';
import { BOAT_SCALE, type BoardView } from './board';

export interface AccomplicesView {
  readonly group: THREE.Group;
  /** 按当前部署重建棋子；数量很少，重建比增量更新更不易出错 */
  sync(
    placements: readonly Placement[],
    players: readonly Player[],
    board: BoardView,
    boats: readonly BoatState[],
  ): void;
  dispose(): void;
}

/**
 * 象的轮廓（XZ 半剖面，绕 Y 轴旋转成型），单位高度 ≈ 0.46。
 * 顺序自底向上：底座喇叭口 → 细茎 → 领圈 → 鼓身 → 头冠 → 顶尖。
 */
const BISHOP_PROFILE: Array<[number, number]> = [
  [0, 0],
  [0.15, 0],
  [0.15, 0.028],
  [0.105, 0.05],
  [0.058, 0.07],
  [0.046, 0.11],
  [0.046, 0.145],
  [0.082, 0.168],
  [0.096, 0.205],
  [0.082, 0.248],
  [0.05, 0.275],
  [0.062, 0.305],
  [0.082, 0.345],
  [0.08, 0.385],
  [0.055, 0.42],
  [0.028, 0.442],
  [0, 0.45],
];

/** 旧圆片厚度的一半：棋子的「脚底」落在锚点下方这么多处 */
const FOOT_SINK = 0.035;

export function createAccomplices(): AccomplicesView {
  const group = new THREE.Group();
  group.name = 'accomplices';

  const profilePoints = BISHOP_PROFILE.map(([r, y]) => new THREE.Vector2(r, y));
  const geometry = new THREE.LatheGeometry(profilePoints, 24);
  /** 头冠上的斜劈缝：一条细盒略微嵌入，模拟象的 miter cut */
  const slitGeometry = new THREE.BoxGeometry(0.19, 0.03, 0.03);
  const slitMaterial = new THREE.MeshStandardMaterial({
    color: 0x14100a,
    roughness: 0.9,
  });
  const materialCache = new Map<PlayerId, THREE.MeshStandardMaterial>();
  const spawned: THREE.Object3D[] = [];

  function materialFor(player: Player | undefined): THREE.MeshStandardMaterial {
    const key = player?.id ?? 'unknown';
    const cached = materialCache.get(key);
    if (cached) return cached;

    const color = new THREE.Color(player?.color ?? '#cccccc');
    const material = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.42,
      metalness: 0.24,
      emissive: color.clone().multiplyScalar(0.16),
    });
    materialCache.set(key, material);
    return material;
  }

  function clearSpawned(): void {
    for (const mesh of spawned) {
      mesh.removeFromParent();
    }
    spawned.length = 0;
  }

  return {
    group,

    sync(placements, players, board, boats) {
      clearSpawned();

      for (const placement of placements) {
        const player = players.find((p) => p.id === placement.playerId);
        const piece = new THREE.Group();
        const body = new THREE.Mesh(geometry, materialFor(player));
        // 标记出来，便于调试与验证脚本统计棋子数量
        body.userData['accomplice'] = true;
        body.userData['playerId'] = placement.playerId;
        body.castShadow = true;
        const slit = new THREE.Mesh(slitGeometry, slitMaterial);
        slit.position.set(0, 0.365, 0);
        slit.rotation.z = Math.PI / 4.5;
        piece.add(body, slit);

        const spot: SpotRef = placement.spot;
        const anchor = board.spotAnchor(spot, boats);
        piece.position.copy(anchor.position);
        piece.position.y -= FOOT_SINK;
        // 棋子小、船在动：挂船上时稍微放大补回视觉尺寸
        if (spot.kind === 'hold' || spot.kind === 'deck') piece.scale.setScalar(1 / BOAT_SCALE);
        anchor.parent.add(piece);
        spawned.push(piece);
      }
    },

    dispose() {
      clearSpawned();
      geometry.dispose();
      slitGeometry.dispose();
      slitMaterial.dispose();
      for (const material of materialCache.values()) material.dispose();
      materialCache.clear();
      group.clear();
    },
  };
}
