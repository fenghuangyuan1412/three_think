/**
 * 棋盘坐标 → 世界坐标的**唯一换算点**。
 *
 * agent.md §3：「棋盘尺寸统一用世界单位格子，所有落子坐标由单点换算，禁止散落魔法数。」
 *
 * 本文件是纯数字计算（不 import three.js），因此可以直接被测试。
 * 棋盘铺在 XZ 平面上，Y 轴向上；-Z 指向马尼拉港。
 *
 * 布局（俯视）：
 * ```
 *            ┌──── 马尼拉港 A B C ────┐        ← 港口在航道正前方
 *   海盗船 ●  │  ║航道1║航道2║航道3║  │  ┌ 修船场 ┐
 *            │  ║ 0-13 ║ … ║ … ║  │  │ A B C  │   ← 修船场在右侧
 *   领航员岛  │  ║      ║    ║    │  └────────┘
 *   保险处    │  ║      ║    ║    │  ┌ 黑市价格 ┐
 *            └────────────────────┘  └──────────┘
 * ```
 */
import { LANE_COUNT, LANE_SPACES, PORT_SLOTS, PRICE_TRACK, SHIPYARD_SLOTS } from '../config/board-layout';

/** 相邻航道的间距 */
export const LANE_GAP = 3.4;

/** 同一航道内相邻格子的间距 */
export const SPACE_PITCH = 0.85;

/** 港口行的 Z 坐标（航道正前方，船越远越接近） */
export const PORT_ROW_Z = -13.4;

/** 修船场（右侧一列）的 X 坐标 */
export const SHIPYARD_X = 6.8;

/** 修船场最上（最远）一格 A 的 Z 坐标 */
export const SHIPYARD_Z0 = -12.4;

/** 修船场相邻两格的间距 */
export const SHIPYARD_PITCH = 1.7;

/** 左侧功能区（海盗 / 领航员 / 保险）的 X 坐标 */
export const SIDE_COLUMN_X = -6.4;

/** 黑市价格轨第 0 档的中心 X */
export const PRICE_TRACK_X = 5.4;

/** 价格轨每一档的间距 */
export const PRICE_STEP_PITCH = 0.78;

/** 价格轨第 0 行（第一种货）的中心 Z */
export const PRICE_TRACK_Z0 = -6.5;

/**
 * 画布贴图的像素尺寸。
 *
 * 放在这里（而不是 textures.ts）是因为**贴图尺寸与它在世界中的尺寸必须一致**：
 * board.ts 用这些数字把贴图映射回世界坐标。layout 只允许有一个来源。
 */
export const LANE_STRIP_PX = { cellW: 96, cellH: 110 } as const;
export const PRICE_TRACK_PX = { cellW: 130, cellH: 96, rowLabelW: 170, headerH: 70 } as const;

/** 世界单位 / 画布像素：由「一格航道 = SPACE_PITCH」反推 */
export const LANE_STRIP_SCALE = SPACE_PITCH / LANE_STRIP_PX.cellH;

/** 航道长条贴图在世界中的宽度 */
export const LANE_STRIP_WORLD_WIDTH = LANE_STRIP_PX.cellW * LANE_STRIP_SCALE;

/** 世界单位 / 画布像素：由「价格轨一档 = PRICE_STEP_PITCH」反推 */
export const PRICE_TRACK_SCALE = PRICE_STEP_PITCH / PRICE_TRACK_PX.cellW;

/** 价格轨每一行（每种货物）的间距，必须与贴图行高一致 */
export const PRICE_ROW_PITCH = PRICE_TRACK_PX.cellH * PRICE_TRACK_SCALE;

export interface FlatPoint {
  readonly x: number;
  readonly z: number;
}

/** 航道中心线的 X 坐标 */
export function laneX(lane: number): number {
  return (lane - (LANE_COUNT - 1) / 2) * LANE_GAP;
}

/** 航道内第 space 格的世界坐标 */
export function laneSpacePosition(lane: number, space: number): FlatPoint {
  return { x: laneX(lane), z: -space * SPACE_PITCH };
}

/** 港口空格 A/B/C 的世界坐标（横跨三条航道，按抵达顺序使用） */
export function portSlotPosition(index: number): FlatPoint {
  return { x: laneX(index), z: PORT_ROW_Z };
}

/** 修船场空格 A/B/C 的世界坐标（右侧一列，A 在最远，B、C 依次靠近） */
export function shipyardSlotPosition(index: number): FlatPoint {
  return { x: SHIPYARD_X, z: SHIPYARD_Z0 + index * SHIPYARD_PITCH };
}

/** 黑市价格轨上第 goodIndex 种货物、第 step 档的世界坐标 */
export function priceCellPosition(goodIndex: number, step: number): FlatPoint {
  return {
    x: PRICE_TRACK_X + step * PRICE_STEP_PITCH,
    z: PRICE_TRACK_Z0 - goodIndex * PRICE_ROW_PITCH,
  };
}

/**
 * 左侧功能区各区块的中心坐标。
 * 海盗船特意放在**第 13 格旁边**（z = -13 × SPACE_PITCH），与实体棋盘一致。
 */
export const SIDE_BLOCKS = {
  pirate: { x: SIDE_COLUMN_X, z: -13 * SPACE_PITCH },
  pilot: { x: SIDE_COLUMN_X, z: -6.6 },
  insurance: { x: SIDE_COLUMN_X, z: -3.0 },
} as const;

/** 棋盘的包围范围（用于画底板与摆相机） */
export const BOARD_BOUNDS = {
  minX: SIDE_COLUMN_X - 1.5,
  maxX: Math.max(
    SHIPYARD_X + 1.4,
    PRICE_TRACK_X + (PRICE_TRACK.length - 1) * PRICE_STEP_PITCH + 0.5,
  ),
  minZ: PORT_ROW_Z - 1.5,
  maxZ: 1.9,
} as const;

export const BOARD_CENTER: FlatPoint = {
  x: (BOARD_BOUNDS.minX + BOARD_BOUNDS.maxX) / 2,
  z: (BOARD_BOUNDS.minZ + BOARD_BOUNDS.maxZ) / 2,
};

export const BOARD_SIZE = {
  width: BOARD_BOUNDS.maxX - BOARD_BOUNDS.minX,
  depth: BOARD_BOUNDS.maxZ - BOARD_BOUNDS.minZ,
} as const;

/**
 * 相机注视点。
 *
 * 特意**不**取包围盒中心：包围盒中心偏向右侧（价格轨与修船场都在右边），
 * 若把相机对准它，透视会把左侧航道画得比右侧低，看起来像长度不同。
 * 对准航道中心线 x=0，三条航道才会对称。
 */
export const CAMERA_TARGET: FlatPoint = {
  x: 0,
  z: (PORT_ROW_Z + BOARD_BOUNDS.maxZ) / 2,
};

export interface ProbePoint {
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * 自动取景必须覆盖的关键点。
 *
 * scene.ts 用它二分搜索相机距离，dev-hook.ts 用它做取景断言 ——
 * **两边必须用同一组点**，否则「拟合好了」和「测出来没截断」会各说各话。
 */
export function framingProbePoints(): ProbePoint[] {
  const { minX, maxX, minZ, maxZ } = BOARD_BOUNDS;
  const points: ProbePoint[] = [];
  for (const y of [0, 1.5]) {
    points.push(
      { name: `棋盘角(${minX.toFixed(1)},${y},${minZ.toFixed(1)})`, x: minX, y, z: minZ },
      { name: `棋盘角(${maxX.toFixed(1)},${y},${minZ.toFixed(1)})`, x: maxX, y, z: minZ },
      { name: `棋盘角(${minX.toFixed(1)},${y},${maxZ.toFixed(1)})`, x: minX, y, z: maxZ },
      { name: `棋盘角(${maxX.toFixed(1)},${y},${maxZ.toFixed(1)})`, x: maxX, y, z: maxZ },
    );
  }
  return points;
}

/** 供渲染层遍历：所有航道的所有格子 */
export function allLaneSpaces(): Array<{ lane: number; space: number } & FlatPoint> {
  const out: Array<{ lane: number; space: number } & FlatPoint> = [];
  for (let lane = 0; lane < LANE_COUNT; lane += 1) {
    for (let space = 0; space < LANE_SPACES; space += 1) {
      out.push({ lane, space, ...laneSpacePosition(lane, space) });
    }
  }
  return out;
}

/** 供渲染层遍历：港口与修船场空格 */
export function allSlots(): Array<{ kind: 'port' | 'shipyard'; label: string } & FlatPoint> {
  const out: Array<{ kind: 'port' | 'shipyard'; label: string } & FlatPoint> = [];
  PORT_SLOTS.forEach((label, i) => out.push({ kind: 'port', label, ...portSlotPosition(i) }));
  SHIPYARD_SLOTS.forEach((label, i) =>
    out.push({ kind: 'shipyard', label, ...shipyardSlotPosition(i) }),
  );
  return out;
}
