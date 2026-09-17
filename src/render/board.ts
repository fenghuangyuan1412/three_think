/**
 * 程序化 3D 棋盘装配。
 *
 * 第一版不含任何外部美术资源：全部由基础几何体 + Canvas 贴图构成，
 * 因此没有资源许可问题（见 agent.md §8）。
 *
 * 布局（俯视）：
 * ```
 *           ┌───── 马尼拉港 A B C ─────┐          ← 港口在航道正前方
 *  海盗船 ●  │  ║航道1║航道2║航道3║   │   ┌ 修船场 ┐
 *           │  ║ 0-13 ║ …  ║ …  ║   │   │ A B C  │  ← 修船场在右侧
 *  领航员岛  │  ║      ║    ║    ║   │   └────────┘
 *  保险处    │  ║      ║    ║    ║   │   ┌ 黑市价格 ┐
 *           └──────────────────────┘   └──────────┘
 * ```
 *
 * 每个可下注的格位都直接印上「得多少 / 付多少」，玩家不必查表。
 *
 * 性能（agent.md §6）：重复的小字烘成整条贴图，3 条航道共用同一张贴图与材质。
 */
import * as THREE from 'three';
import {
  GOODS,
  LANE_COUNT,
  LANE_LAST_SPACE,
  LANE_SPACES,
  PORT_SLOTS,
  PORT_SPACES,
  PIRATE_SPACES,
  PILOT_LARGE_COST,
  PILOT_SMALL_COST,
  PRICE_TRACK,
  SHIPYARD_SLOTS,
  SHIPYARD_SPACES,
  getWareLoad,
} from '../config/board-layout';
import { INSURANCE_FEE } from '../config/board-layout';
import type { BoatState, SpotRef } from '../core/voyage';
import { createBoat } from './boat';
import {
  BOARD_CENTER,
  BOARD_SIZE,
  LANE_GAP,
  LANE_STRIP_WORLD_WIDTH,
  PORT_ROW_Z,
  PRICE_ROW_PITCH,
  PRICE_STEP_PITCH,
  PRICE_TRACK_PX,
  PRICE_TRACK_SCALE,
  PRICE_TRACK_X,
  PRICE_TRACK_Z0,
  SHIPYARD_X,
  SIDE_BLOCKS,
  SPACE_PITCH,
  laneX,
  portSlotPosition,
  priceCellPosition,
  shipyardSlotPosition,
} from './coords';
import { createBillboardLabel, createFlatLabel } from './labels';
import { PALETTE, goldMaterial, standardMaterial } from './palette';
import { createLaneStripTexture, createPriceTrackTexture } from './textures';

/** 船的缩放：船体原长在 1.6 世界单位左右，缩到略大于一个航道格 */
export const BOAT_SCALE = 0.85;

/** 船停在水面上的高度 */
const BOAT_Y = 0.09;

export interface BoardView {
  readonly group: THREE.Group;
  /** 把第 index 艘船放到指定航道的指定格（瞬时） */
  placeBoat(index: number, lane: number, space: number): void;
  /** 按对局状态同步三艘船的位置（默认补间）与船上的货仓板块 */
  syncBoats(boats: readonly BoatState[], immediate?: boolean): void;
  /** 某格位在世界中的位置（供拾取代理与调试使用） */
  spotPosition(spot: SpotRef, boats: readonly BoatState[]): THREE.Vector3;
  /**
   * 某格位的挂载点：货仓格位挂在船体上（随船一起动），其余挂在棋盘根节点。
   * 返回的 position 是相对 parent 的局部坐标。
   */
  spotAnchor(spot: SpotRef, boats0: readonly BoatState[]): { parent: THREE.Object3D; position: THREE.Vector3 };
  /** 把第 goodIndex 种货物的价格标记移到价格轨第 step 档 */
  setPriceIndex(goodIndex: number, step: number): void;
  /** 每帧推进船只补间 */
  update(deltaSeconds: number): void;
  dispose(): void;
}

/** 货物色（与规则书 Abb. 2b 的四种颜色一致） */
const GOOD_COLORS: Record<string, number> = {
  nutmeg: 0x7a4a2b,
  silk: 0x35558f,
  ginseng: 0xc9b27a,
  jade: 0x2f7a52,
};

export function createBoard(): BoardView {
  const group = new THREE.Group();
  group.name = 'board';

  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const geo = <T extends THREE.BufferGeometry>(g: T): T => {
    geometries.push(g);
    return g;
  };
  const mat = <T extends THREE.Material>(m: T): T => {
    materials.push(m);
    return m;
  };
  /** 挂一个平贴标签（自动记录几何体与材质以便释放） */
  const flatLabel = (
    parent: THREE.Object3D,
    text: string,
    x: number,
    y: number,
    z: number,
    opts: Parameters<typeof createFlatLabel>[1] = {},
  ): THREE.Mesh => {
    const label = createFlatLabel(text, opts);
    label.position.set(x, y, z);
    geometries.push(label.geometry);
    materials.push(label.material as THREE.Material);
    parent.add(label);
    return label;
  };
  const billboard = (
    parent: THREE.Object3D,
    text: string,
    x: number,
    y: number,
    z: number,
    opts: Parameters<typeof createBillboardLabel>[1] = {},
  ): THREE.Sprite => {
    const sprite = createBillboardLabel(text, opts);
    sprite.position.set(x, y, z);
    materials.push(sprite.material as THREE.Material);
    parent.add(sprite);
    return sprite;
  };

  const inkColor = '#241d13';

  // ---------------------------------------------------------------- 桌面与棋盘外框

  const table = new THREE.Mesh(
    geo(new THREE.BoxGeometry(BOARD_SIZE.width + 9, 0.6, BOARD_SIZE.depth + 9)),
    mat(standardMaterial(PALETTE.waterDeep, { roughness: 0.92, metalness: 0.05 })),
  );
  table.position.set(BOARD_CENTER.x, -0.46, BOARD_CENTER.z);
  group.add(table);

  const frame = new THREE.Mesh(
    geo(new THREE.BoxGeometry(BOARD_SIZE.width + 1.6, 0.32, BOARD_SIZE.depth + 1.6)),
    mat(standardMaterial(PALETTE.frame, { roughness: 0.82, metalness: 0.12 })),
  );
  frame.position.set(BOARD_CENTER.x, -0.15, BOARD_CENTER.z);
  frame.receiveShadow = true;
  group.add(frame);

  const water = new THREE.Mesh(
    geo(new THREE.PlaneGeometry(BOARD_SIZE.width, BOARD_SIZE.depth)),
    mat(new THREE.MeshStandardMaterial({ color: PALETTE.water, roughness: 0.36, metalness: 0.32 })),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(BOARD_CENTER.x, 0, BOARD_CENTER.z);
  water.receiveShadow = true;
  group.add(water);

  // ---------------------------------------------------------------- 航道

  const laneStripMaterial = mat(
    new THREE.MeshStandardMaterial({ map: createLaneStripTexture(LANE_SPACES), roughness: 0.86 }),
  );
  const laneBaseGeometry = geo(
    new THREE.BoxGeometry(LANE_STRIP_WORLD_WIDTH + 0.06, 0.06, LANE_SPACES * SPACE_PITCH + 0.06),
  );
  const laneStripGeometry = geo(
    new THREE.PlaneGeometry(LANE_STRIP_WORLD_WIDTH, LANE_SPACES * SPACE_PITCH),
  );
  const laneBaseMaterial = mat(standardMaterial(PALETTE.plateEdge, { roughness: 0.92 }));
  const laneCenterZ = -((LANE_SPACES - 1) * SPACE_PITCH) / 2;

  for (let lane = 0; lane < LANE_COUNT; lane += 1) {
    const x = laneX(lane);

    const base = new THREE.Mesh(laneBaseGeometry, laneBaseMaterial);
    base.position.set(x, 0.04, laneCenterZ);
    base.receiveShadow = true;
    group.add(base);

    const strip = new THREE.Mesh(laneStripGeometry, laneStripMaterial);
    strip.rotation.x = -Math.PI / 2;
    strip.position.set(x, 0.075, laneCenterZ);
    group.add(strip);

    billboard(group, `第 ${lane + 1} 航道`, x, 0.42, 1.05, {
      worldHeight: 0.34,
      bold: true,
      background: 'rgba(10,28,38,0.78)',
    });
  }

  // 起点区提示线（规则：三船起点之和必须是 9）
  const launchLine = new THREE.Mesh(
    geo(new THREE.BoxGeometry(LANE_GAP * LANE_COUNT, 0.03, 0.05)),
    mat(goldMaterial()),
  );
  launchLine.position.set(0, 0.085, -5.5 * SPACE_PITCH);
  group.add(launchLine);
  flatLabel(group, '起点区 0–5', -LANE_GAP * 1.5 - 0.85, 0.09, -5.5 * SPACE_PITCH, {
    worldHeight: 0.38,
    color: '#d9a441',
    bold: true,
  });

  // ---------------------------------------------------------------- 通用格位

  const slotGeometry = geo(new THREE.CylinderGeometry(0.3, 0.3, 0.05, 28));
  const smallSlotGeometry = geo(new THREE.CylinderGeometry(0.26, 0.26, 0.05, 24));
  const dockMaterial = mat(standardMaterial(PALETTE.dock, { roughness: 0.84 }));
  const dockSlotMaterial = mat(standardMaterial(PALETTE.hull, { roughness: 0.7 }));
  const yardSlotMaterial = mat(standardMaterial(PALETTE.hull, { roughness: 0.74 }));

  // ---------------------------------------------------------------- 港口（航道正前方）

  const dock = new THREE.Mesh(
    geo(new THREE.BoxGeometry(LANE_GAP * LANE_COUNT + 2.0, 0.34, 1.7)),
    dockMaterial,
  );
  dock.position.set(0, 0.17, PORT_ROW_Z);
  dock.receiveShadow = true;
  dock.castShadow = true;
  group.add(dock);

  PORT_SLOTS.forEach((letter, i) => {
    const p = portSlotPosition(i);
    const disc = new THREE.Mesh(slotGeometry, dockSlotMaterial);
    disc.position.set(p.x, 0.36, p.z + 0.38);
    group.add(disc);

    // 台面是浅木色，深色字才看得清
    const spec = PORT_SPACES[i];
    flatLabel(
      group,
      `${letter}  得${spec?.reward ?? 0} 付${spec?.cost ?? 0}`,
      p.x,
      0.38,
      p.z - 0.42,
      { worldHeight: 0.44, color: inkColor, bold: true },
    );
  });

  billboard(group, '马尼拉港 · 船过第 13 格即抵达', 0, 1.5, PORT_ROW_Z - 0.35, {
    worldHeight: 0.46,
    bold: true,
    background: 'rgba(10,28,38,0.85)',
  });

  // ---------------------------------------------------------------- 修船场（右侧一列）

  const shipyardPlatform = new THREE.Mesh(
    geo(new THREE.BoxGeometry(2.5, 0.3, 4.4)),
    dockMaterial,
  );
  shipyardPlatform.position.set(SHIPYARD_X, 0.15, -11.1);
  shipyardPlatform.receiveShadow = true;
  shipyardPlatform.castShadow = true;
  group.add(shipyardPlatform);

  SHIPYARD_SLOTS.forEach((letter, i) => {
    const p = shipyardSlotPosition(i);
    const disc = new THREE.Mesh(slotGeometry, yardSlotMaterial);
    disc.position.set(p.x - 0.62, 0.365, p.z);
    group.add(disc);

    const spec = SHIPYARD_SPACES[i];
    flatLabel(
      group,
      `${letter} 得${spec?.reward ?? 0} 付${spec?.cost ?? 0}`,
      p.x + 0.48,
      0.405,
      p.z,
      { worldHeight: 0.4, color: inkColor, bold: true },
    );
  });

  billboard(group, '修船场', SHIPYARD_X, 1.0, -13.6, {
    worldHeight: 0.46,
    bold: true,
    background: 'rgba(10,28,38,0.85)',
  });

  // ---------------------------------------------------------------- 海盗船（贴着第 13 格）

  const pirateHull = new THREE.Mesh(
    geo(new THREE.BoxGeometry(1.9, 0.34, 0.9)),
    mat(standardMaterial(PALETTE.hull, { roughness: 0.9 })),
  );
  pirateHull.position.set(SIDE_BLOCKS.pirate.x, 0.17, SIDE_BLOCKS.pirate.z);
  pirateHull.castShadow = true;
  group.add(pirateHull);

  const pirateSeatMaterial = mat(standardMaterial(PALETTE.parchment, { roughness: 0.8 }));
  for (let s = 0; s < PIRATE_SPACES.length; s += 1) {
    const x = SIDE_BLOCKS.pirate.x + (s === 0 ? -0.46 : 0.46);
    const disc = new THREE.Mesh(smallSlotGeometry, pirateSeatMaterial);
    disc.position.set(x, 0.36, SIDE_BLOCKS.pirate.z);
    group.add(disc);
    flatLabel(group, `付${PIRATE_SPACES[s]?.cost ?? 0}`, x, 0.4, SIDE_BLOCKS.pirate.z, {
      worldHeight: 0.28,
      color: inkColor,
      bold: true,
    });
  }

  billboard(group, '海盗船 · 在第 13 格出手', SIDE_BLOCKS.pirate.x, 1.0, SIDE_BLOCKS.pirate.z, {
    worldHeight: 0.44,
    bold: true,
    background: 'rgba(60,16,16,0.88)',
  });

  // ---------------------------------------------------------------- 领航员岛

  const pilotIsland = new THREE.Mesh(
    geo(new THREE.CylinderGeometry(1.05, 1.15, 0.2, 32)),
    mat(standardMaterial(PALETTE.island, { roughness: 0.95 })),
  );
  pilotIsland.position.set(SIDE_BLOCKS.pilot.x, 0.1, SIDE_BLOCKS.pilot.z);
  pilotIsland.receiveShadow = true;
  group.add(pilotIsland);

  const pilotSeats: Array<{ size: 'small' | 'large'; cost: number; dx: number }> = [
    { size: 'small', cost: PILOT_SMALL_COST, dx: -0.44 },
    { size: 'large', cost: PILOT_LARGE_COST, dx: 0.44 },
  ];
  for (const seat of pilotSeats) {
    const x = SIDE_BLOCKS.pilot.x + seat.dx;
    const disc = new THREE.Mesh(smallSlotGeometry, pirateSeatMaterial);
    disc.position.set(x, 0.235, SIDE_BLOCKS.pilot.z);
    group.add(disc);
    flatLabel(group, seat.size === 'small' ? '小\n付2' : '大\n付5', x, 0.315, SIDE_BLOCKS.pilot.z, {
      worldHeight: 0.34,
      color: inkColor,
      bold: true,
    });
  }

  billboard(group, '领航员岛 · 无直接收益', SIDE_BLOCKS.pilot.x, 1.0, SIDE_BLOCKS.pilot.z, {
    worldHeight: 0.44,
    bold: true,
    background: 'rgba(10,28,38,0.88)',
  });

  // ---------------------------------------------------------------- 保险处

  const insurance = new THREE.Mesh(
    geo(new THREE.BoxGeometry(1.8, 0.72, 1.0)),
    mat(standardMaterial(PALETTE.building, { roughness: 0.88 })),
  );
  insurance.position.set(SIDE_BLOCKS.insurance.x, 0.36, SIDE_BLOCKS.insurance.z);
  insurance.castShadow = true;
  group.add(insurance);

  const insuranceSeat = new THREE.Mesh(smallSlotGeometry, pirateSeatMaterial);
  insuranceSeat.position.set(SIDE_BLOCKS.insurance.x, 0.755, SIDE_BLOCKS.insurance.z);
  group.add(insuranceSeat);
  flatLabel(group, `立得${INSURANCE_FEE}\n但赔修理费`, SIDE_BLOCKS.insurance.x, 0.84, SIDE_BLOCKS.insurance.z, {
    worldHeight: 0.34,
    color: inkColor,
    bold: true,
  });

  billboard(group, '保险处', SIDE_BLOCKS.insurance.x, 1.4, SIDE_BLOCKS.insurance.z, {
    worldHeight: 0.44,
    bold: true,
    background: 'rgba(10,28,38,0.88)',
  });

  // ---------------------------------------------------------------- 黑市价格轨

  const priceWidth =
    (PRICE_TRACK_PX.rowLabelW + PRICE_TRACK_PX.cellW * PRICE_TRACK.length) * PRICE_TRACK_SCALE;
  const priceDepth =
    (PRICE_TRACK_PX.headerH + PRICE_TRACK_PX.cellH * GOODS.length) * PRICE_TRACK_SCALE;
  const priceLeft =
    PRICE_TRACK_X - PRICE_STEP_PITCH / 2 - PRICE_TRACK_PX.rowLabelW * PRICE_TRACK_SCALE;
  const priceTopZ =
    PRICE_TRACK_Z0 + PRICE_TRACK_PX.headerH * PRICE_TRACK_SCALE + PRICE_ROW_PITCH / 2;

  const pricePlane = new THREE.Mesh(
    geo(new THREE.PlaneGeometry(priceWidth, priceDepth)),
    mat(
      new THREE.MeshBasicMaterial({
        map: createPriceTrackTexture(GOODS, PRICE_TRACK),
        toneMapped: false,
      }),
    ),
  );
  pricePlane.rotation.x = -Math.PI / 2;
  pricePlane.position.set(priceLeft + priceWidth / 2, 0.03, priceTopZ - priceDepth / 2);
  group.add(pricePlane);

  const priceMarkerGeometry = geo(new THREE.BoxGeometry(0.26, 0.1, 0.26));
  const priceMarkerMaterial = mat(goldMaterial());
  const priceMarkers: THREE.Mesh[] = GOODS.map(() => {
    const marker = new THREE.Mesh(priceMarkerGeometry, priceMarkerMaterial);
    marker.position.y = 0.09;
    group.add(marker);
    return marker;
  });

  // ---------------------------------------------------------------- 平底船 + 货仓板块

  const boats = Array.from({ length: LANE_COUNT }, () => createBoat());
  for (const boat of boats) {
    boat.group.scale.setScalar(BOAT_SCALE);
    group.add(boat.group);
  }

  /**
   * 每艘船预先准备 4 块货仓板块（每种货一块），按需显示其中一块。
   *
   * 甲板上放一块**彩色板块**表明装的哪种货；数字用**悬浮牌**挂在帆之上 ——
   * 平贴在甲板上会被桅杆与帆挡住（实测踩过）。
   *
   * 预先建好而不是运行时重建，是为了避免每次状态变化都创建/释放几何体与材质。
   */
  const wareTiles: THREE.Object3D[][] = boats.map((boat) => {
    const parts = GOODS.map((good) => {
      const load = getWareLoad(good.id);
      const color = GOOD_COLORS[good.id] ?? 0x888888;

      const tile = new THREE.Mesh(
        geo(new THREE.BoxGeometry(0.74, 0.06, 0.66)),
        mat(standardMaterial(color, { roughness: 0.72 })),
      );
      // 船体带 0.85 缩放，除以缩放让世界尺寸一致
      tile.position.set(0, 0.28 / BOAT_SCALE, 0.34 / BOAT_SCALE);
      tile.visible = false;
      boat.group.add(tile);

      const costs = load.spaces.map((s) => s.cost).join('·');
      const label = createBillboardLabel(`${good.name} ${load.totalReward}\n付${costs}`, {
        worldHeight: 0.42,
        bold: true,
        background: 'rgba(8,22,30,0.82)',
      });
      label.position.set(0, 1.3 / BOAT_SCALE, 0.1 / BOAT_SCALE);
      label.visible = false;
      materials.push(label.material as THREE.Material);
      boat.group.add(label);

      return [tile, label] as THREE.Object3D[];
    });
    return parts.flat();
  });

  // ---------------------------------------------------------------- 位置与挂载

  const boatTargets: (THREE.Vector3 | null)[] = boats.map(() => null);

  function boatPositionOf(index: number, boats0: readonly BoatState[]): THREE.Vector3 {
    const state = boats0[index];
    if (state?.arrivedSlot !== null && state?.arrivedSlot !== undefined) {
      const p = portSlotPosition(state.arrivedSlot);
      return new THREE.Vector3(p.x, BOAT_Y, p.z + 0.38);
    }
    if (state?.shipyardSlot !== null && state?.shipyardSlot !== undefined) {
      const p = shipyardSlotPosition(state.shipyardSlot);
      return new THREE.Vector3(p.x - 0.62, BOAT_Y, p.z);
    }
    const lane = state?.lane ?? index;
    const space = Math.min(state?.position ?? 0, LANE_LAST_SPACE);
    return new THREE.Vector3(laneX(lane), BOAT_Y, -space * SPACE_PITCH);
  }

  function holdLocalOffset(
    spot: Extract<SpotRef, { kind: 'hold' }>,
    boats0: readonly BoatState[],
  ): THREE.Vector3 {
    const good = boats0[spot.boat]?.good ?? null;
    const count = good ? getWareLoad(good).spaces.length : 3;
    const dz = ((spot.space - (count - 1) / 2) * 0.2) / BOAT_SCALE;
    return new THREE.Vector3(0, 0.36 / BOAT_SCALE, dz);
  }

  function staticSpotPosition(spot: SpotRef): THREE.Vector3 {
    switch (spot.kind) {
      case 'port': {
        const p = portSlotPosition(spot.slot);
        return new THREE.Vector3(p.x, 0.46, p.z + 0.38);
      }
      case 'shipyard': {
        const p = shipyardSlotPosition(spot.slot);
        return new THREE.Vector3(p.x - 0.62, 0.4, p.z);
      }
      case 'pirate':
        return new THREE.Vector3(
          SIDE_BLOCKS.pirate.x + (spot.space === 0 ? -0.46 : 0.46),
          0.42,
          SIDE_BLOCKS.pirate.z,
        );
      case 'pilot':
        return new THREE.Vector3(
          SIDE_BLOCKS.pilot.x + (spot.size === 'small' ? -0.44 : 0.44),
          0.3,
          SIDE_BLOCKS.pilot.z,
        );
      case 'insurance':
        return new THREE.Vector3(SIDE_BLOCKS.insurance.x, 0.82, SIDE_BLOCKS.insurance.z);
      case 'hold':
        return new THREE.Vector3();
    }
  }

  const view: BoardView = {
    group,

    placeBoat(index, lane, space) {
      const boat = boats[index];
      if (!boat) return;
      boat.group.position.set(laneX(lane), BOAT_Y, -space * SPACE_PITCH);
      boatTargets[index] = null;
    },

    syncBoats(next, immediate = false) {
      next.forEach((state, index) => {
        const target = boatPositionOf(index, next);
        if (immediate) {
          boats[index]?.group.position.copy(target);
          boatTargets[index] = null;
        } else {
          boatTargets[index] = target;
        }

        // 船上的货仓板块：显示对应货物的那一块
        const tiles = wareTiles[index];
        if (tiles) {
          GOODS.forEach((good, gi) => {
            const visible = state.good === good.id;
            const tile = tiles[gi * 2];
            const label = tiles[gi * 2 + 1];
            if (tile) tile.visible = visible;
            if (label) label.visible = visible;
          });
        }
      });
    },

    spotPosition(spot, boats0) {
      if (spot.kind === 'hold') {
        const g = boats[spot.boat]?.group;
        const base = g ? g.position.clone() : new THREE.Vector3();
        base.add(holdLocalOffset(spot, boats0).multiplyScalar(BOAT_SCALE));
        return base;
      }
      return staticSpotPosition(spot);
    },

    spotAnchor(spot, boats0) {
      if (spot.kind === 'hold') {
        const boatGroup = boats[spot.boat]?.group;
        if (boatGroup) {
          return { parent: boatGroup, position: holdLocalOffset(spot, boats0) };
        }
      }
      return { parent: group, position: staticSpotPosition(spot) };
    },

    update(deltaSeconds) {
      const k = Math.min(1, deltaSeconds * 6);
      boats.forEach((boat, index) => {
        const target = boatTargets[index];
        if (!target) return;
        boat.group.position.lerp(target, k);
        if (boat.group.position.distanceToSquared(target) < 1e-4) {
          boat.group.position.copy(target);
          boatTargets[index] = null;
        }
      });
    },

    setPriceIndex(goodIndex, step) {
      const marker = priceMarkers[goodIndex];
      if (!marker) return;
      const p = priceCellPosition(goodIndex, step);
      marker.position.set(p.x, 0.09, p.z);
    },

    dispose() {
      for (const boat of boats) boat.dispose();
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
      group.clear();
    },
  };

  view.placeBoat(0, 0, 2);
  view.placeBoat(1, 1, 3);
  view.placeBoat(2, 2, 4);
  GOODS.forEach((_, i) => view.setPriceIndex(i, 0));

  return view;
}
