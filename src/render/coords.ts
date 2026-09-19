/**
 * 棋盘坐标 → 世界坐标的**唯一换算点**。
 *
 * agent.md §3：「棋盘尺寸统一用世界单位格子，所有落子坐标由单点换算，禁止散落魔法数。」
 *
 * 本文件是纯数字计算（不 import three.js），因此可以直接被测试。
 * 棋盘铺在 XZ 平面上，Y 轴向上；-Z 指向马尼拉港。
 *
 * 布局（俯视）—— 参考实体棋盘的实拍图，**水道区整体斜切**：航道与港口
 * 沿斜向展开，长条贴图与几何体统一绕 Y 轴旋转 `LANE_SKEW`（见 skew()）。
 * ```
 *                马尼拉港 ╲(斜)      ┌ 修船场 ┐┌保险处┐
 *   海盗船 ● ──线── 第13格 ╲╱航道 ╲╱ ╲ │ A B C  ││      │
 *                领航员岛          ╲  ╲        └──────┘└──────┘
 *                起点区 ─ ─  ─ ─ ─  ─ ─ ┘   ╲╱
 *                                            ┌ 黑市价格（右下横条）┐
 *                                            └────────────────────┘
 * ```
 */
import {
  GOODS,
  LANE_COUNT,
  LANE_SPACES,
  PORT_SLOTS,
  PRICE_TRACK,
  SHIPYARD_SLOTS,
} from '../config/board-layout';

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

/** 保险处：挪到修船场旁边（右侧一列的更右边） */
export const INSURANCE_X = SHIPYARD_X + 2.6;
export const INSURANCE_Z = SHIPYARD_Z0 + 1.9;

/** 黑市价格条：横卧棋盘**右下角**（修船场/保险处那一列的正下方），中心点 */
export const PRICE_STRIP_CENTER: FlatPoint = { x: 7.6, z: 3.4 };

/**
 * 画布贴图的像素尺寸。
 *
 * 放在这里（而不是 textures.ts）是因为**贴图尺寸与它在世界中的尺寸必须一致**：
 * board.ts 用这些数字把贴图映射回世界坐标。layout 只允许有一个来源。
 *
 * 像素值整体是「1 世界单位 ≈ 70 画布像素」的超采样基准；字发糊时优先翻倍
 * 这里的尺寸（下面的 SCALE 全部由它反推，世界尺寸不变，只是贴图变清晰）。
 */
export const LANE_STRIP_PX = { cellW: 192, cellH: 220 } as const;
export const PRICE_TRACK_PX = { cellW: 260, cellH: 192, rowLabelW: 340, headerH: 140 } as const;

/** 世界单位 / 画布像素：由「一格航道 = SPACE_PITCH」反推 */
export const LANE_STRIP_SCALE = SPACE_PITCH / LANE_STRIP_PX.cellH;

/** 航道长条贴图在世界中的宽度 */
export const LANE_STRIP_WORLD_WIDTH = LANE_STRIP_PX.cellW * LANE_STRIP_SCALE;

/** 世界单位 / 画布像素：由「价格轨一档 = PRICE_STEP_PITCH」反推 */
export const PRICE_STEP_PITCH = 0.78;
export const PRICE_TRACK_SCALE = PRICE_STEP_PITCH / PRICE_TRACK_PX.cellW;

/** 价格轨每一行（每种货物）的间距，必须与贴图行高一致 */
export const PRICE_ROW_PITCH = PRICE_TRACK_PX.cellH * PRICE_TRACK_SCALE;

/** 价格条在世界中的外形尺寸（贴图与几何体共用） */
export const PRICE_STRIP_SIZE = {
  width: (PRICE_TRACK_PX.rowLabelW + PRICE_TRACK_PX.cellW * PRICE_TRACK.length) * PRICE_TRACK_SCALE,
  depth: (PRICE_TRACK_PX.headerH + PRICE_TRACK_PX.cellH * GOODS.length) * PRICE_TRACK_SCALE,
} as const;

/** 价格条左缘（贴图行名列从这里开始） */
export const PRICE_STRIP_LEFT = PRICE_STRIP_CENTER.x - PRICE_STRIP_SIZE.width / 2;

/** 黑市价格轨第 0 档的中心 X：跳过行名列后落第一格 */
export const PRICE_TRACK_X =
  PRICE_STRIP_LEFT + PRICE_TRACK_PX.rowLabelW * PRICE_TRACK_SCALE + PRICE_STEP_PITCH / 2;

/** 价格条远缘（贴图表头朝 -Z 侧，即朝向航道那一侧） */
export const PRICE_STRIP_TOP_Z = PRICE_STRIP_CENTER.z - PRICE_STRIP_SIZE.depth / 2;

/** 价格轨第 0 行（第一种货）的中心 Z：贴着表头下缘，向 +Z（玩家方向）逐行排开 */
export const PRICE_TRACK_Z0 =
  PRICE_STRIP_TOP_Z + PRICE_TRACK_PX.headerH * PRICE_TRACK_SCALE + PRICE_ROW_PITCH / 2;

export interface FlatPoint {
  readonly x: number;
  readonly z: number;
}

/**
 * 水道区斜切角（绕 Y 轴弧度）：远端（港口方向）向左偏，与实拍图一致。
 * board.ts 里所有长条几何体（航道、码头、起点线）的 rotation.y 都用它，
 * 保证贴图方向与坐标换算永远同源。
 */
export const LANE_SKEW = (15 * Math.PI) / 180;

/** 斜切旋转中心：取航道中段，避免斜完整体大幅偏移 */
const SKEW_PIVOT: FlatPoint = { x: 0, z: -((LANE_SPACES - 1) * SPACE_PITCH) / 2 };

/** 航道局部坐标 → 斜切后的世界坐标 */
export function skew(point: FlatPoint): FlatPoint {
  const dx = point.x - SKEW_PIVOT.x;
  const dz = point.z - SKEW_PIVOT.z;
  const c = Math.cos(LANE_SKEW);
  const s = Math.sin(LANE_SKEW);
  return {
    x: SKEW_PIVOT.x + dx * c + dz * s,
    z: SKEW_PIVOT.z - dx * s + dz * c,
  };
}

/** 在已斜切的点上追加一个随水道方向旋转的小偏移（如「格心再朝港口 0.38」） */
export function skewOffset(base: FlatPoint, dx: number, dz: number): FlatPoint {
  const c = Math.cos(LANE_SKEW);
  const s = Math.sin(LANE_SKEW);
  return { x: base.x + dx * c + dz * s, z: base.z - dx * s + dz * c };
}

/** 航道中心线的 X 坐标（航道局部系，未经斜切；要世界坐标请用 laneSpacePosition） */
export function laneX(lane: number): number {
  return (lane - (LANE_COUNT - 1) / 2) * LANE_GAP;
}

/** 航道内第 space 格的世界坐标（已斜切） */
export function laneSpacePosition(lane: number, space: number): FlatPoint {
  return skew({ x: laneX(lane), z: -space * SPACE_PITCH });
}

/** 港口空格 A/B/C 的世界坐标（横跨三条航道，按抵达顺序使用；已斜切） */
export function portSlotPosition(index: number): FlatPoint {
  return skew({ x: laneX(index), z: PORT_ROW_Z });
}

/** 修船场空格 A/B/C 的世界坐标（右侧一列，A 在最远，B、C 依次靠近；不随水道斜切） */
export function shipyardSlotPosition(index: number): FlatPoint {
  return { x: SHIPYARD_X, z: SHIPYARD_Z0 + index * SHIPYARD_PITCH };
}

/** 黑市价格条上第 goodIndex 种货物、第 step 档的世界坐标 */
export function priceCellPosition(goodIndex: number, step: number): FlatPoint {
  return {
    x: PRICE_TRACK_X + step * PRICE_STEP_PITCH,
    z: PRICE_TRACK_Z0 + goodIndex * PRICE_ROW_PITCH,
  };
}

/**
 * 海盗船与领航员岛的锚点。
 * 海盗船特意放在**第 13 格旁边**，与实拍图一致；位置从斜切后的航道反推，不写死。
 */
const pirateAnchor = skew({ x: laneX(0), z: -13 * SPACE_PITCH });

export const SIDE_BLOCKS = {
  pirate: { x: pirateAnchor.x - 2.8, z: pirateAnchor.z + 0.2 },
  pilot: skew({ x: laneX(0) - 2.7, z: -6.6 }),
  insurance: { x: INSURANCE_X, z: INSURANCE_Z },
} as const;

/**
 * 棋盘的包围范围（用于画底板与摆相机）。
 * 斜切后不能再用「常数加减」推包围盒，直接取所有关键块的四至。
 */
const boundCandidates: FlatPoint[] = [
  skew({ x: laneX(0) - LANE_STRIP_WORLD_WIDTH / 2 - 0.2, z: 0.6 }),
  skew({ x: laneX(LANE_COUNT - 1) + LANE_STRIP_WORLD_WIDTH / 2 + 0.2, z: 0.6 }),
  skew({ x: laneX(0) - 1.3, z: PORT_ROW_Z - 1.5 }),
  skew({ x: laneX(LANE_COUNT - 1) + 1.3, z: PORT_ROW_Z - 1.5 }),
  { x: SIDE_BLOCKS.pirate.x - 1.2, z: SIDE_BLOCKS.pirate.z },
  { x: SIDE_BLOCKS.pilot.x - 1.3, z: SIDE_BLOCKS.pilot.z },
  { x: SHIPYARD_X + 1.4, z: SHIPYARD_Z0 - 1.3 },
  { x: SHIPYARD_X + 1.4, z: SHIPYARD_Z0 + 2 * SHIPYARD_PITCH + 1.0 },
  { x: INSURANCE_X + 1.1, z: INSURANCE_Z },
  { x: PRICE_STRIP_CENTER.x - PRICE_STRIP_SIZE.width / 2 - 0.3, z: PRICE_STRIP_TOP_Z - 0.2 },
  { x: PRICE_STRIP_CENTER.x + PRICE_STRIP_SIZE.width / 2 + 0.3, z: PRICE_STRIP_CENTER.z + PRICE_STRIP_SIZE.depth / 2 + 0.2 },
  { x: 0, z: 0.6 },
];

export const BOARD_BOUNDS = {
  minX: Math.min(...boundCandidates.map((p) => p.x)),
  maxX: Math.max(...boundCandidates.map((p) => p.x)),
  minZ: Math.min(...boundCandidates.map((p) => p.z)),
  maxZ: Math.max(...boundCandidates.map((p) => p.z)),
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
