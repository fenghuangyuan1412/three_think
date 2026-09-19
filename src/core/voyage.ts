/**
 * 一段航程（voyage）的状态类型、步骤表与格位规则。
 *
 * 本文件属于 core/，**不得 import three.js**（agent.md §3）。
 *
 * 规则来源：http://www.mf8-china.com/archiver/?tid-72459.html
 * 每段航程的四步：「１ 竞标海港负责人的办事处…２ 放置同伙并以掷骰移动平底船。
 * ３ 利润分配。４ 货物价格上升。」
 */
import {
  LANE_LAST_SPACE,
  PIRATE_SPACES,
  PILOT_LARGE_COST,
  PILOT_SMALL_COST,
  INSURANCE_COST,
  PORT_SPACES,
  SHIPYARD_SPACES,
  getWareLoad,
} from '../config/board-layout';
import type { GoodId, PlayerId } from './types';

// ---------------------------------------------------------------- 格位

export type PilotSize = 'small' | 'large';

/** 一个可放置小弟的格位 */
export type SpotRef =
  | { readonly kind: 'hold'; readonly boat: number; readonly space: number }
  | { readonly kind: 'deck'; readonly boat: number; readonly space: number }
  | { readonly kind: 'port'; readonly slot: number }
  | { readonly kind: 'shipyard'; readonly slot: number }
  | { readonly kind: 'pirate'; readonly space: number }
  | { readonly kind: 'pilot'; readonly size: PilotSize }
  | { readonly kind: 'insurance' };

export function spotKey(spot: SpotRef): string {
  switch (spot.kind) {
    case 'hold':
      return `hold:${spot.boat}:${spot.space}`;
    case 'deck':
      return `deck:${spot.boat}:${spot.space}`;
    case 'port':
      return `port:${spot.slot}`;
    case 'shipyard':
      return `shipyard:${spot.slot}`;
    case 'pirate':
      return `pirate:${spot.space}`;
    case 'pilot':
      return `pilot:${spot.size}`;
    case 'insurance':
      return 'insurance';
  }
}

export function spotLabel(spot: SpotRef, goodNames: (g: GoodId) => string, boatGood: (b: number) => GoodId | null): string {
  switch (spot.kind) {
    case 'hold': {
      const good = boatGood(spot.boat);
      return `${good ? goodNames(good) : '空'}货仓 第 ${spot.space + 1} 格`;
    }
    case 'deck':
      return `海盗甲板 ${spot.space === 0 ? '（船长位）' : `（${spot.space + 1} 号位）`}`;
    case 'port':
      return `港口 ${'ABC'[spot.slot] ?? '?'}`;
    case 'shipyard':
      return `修船场 ${'ABC'[spot.slot] ?? '?'}`;
    case 'pirate':
      return spot.space === 0 ? '海盗船（船长）' : '海盗船（二副）';
    case 'pilot':
      return spot.size === 'small' ? '小领航员（2 元）' : '大领航员（5 元）';
    case 'insurance':
      return '保险处';
  }
}

/** 一次小弟部署 */
export interface Placement {
  readonly playerId: PlayerId;
  readonly spot: SpotRef;
  /** 实际付出的费用 */
  readonly cost: number;
  /** 盲目的旅客：无钱可付，免费放置 */
  readonly blind: boolean;
  /**
   * 是否是「从海盗船登船」上来的海盗。
   *
   * 必须与普通货仓小弟区分：被劫掠时，普通小弟空手而回，只有海盗参与均分劫掠所得；
   * 抵达港口时，甲板海盗截获整船货款。
   */
  readonly fromPirate: boolean;
}

/** 格位容量。港口/修船场/海盗/领航员/保险处各只有 1 个位；货仓每格 1 个位 */
export const SPOT_CAPACITY = 1;

export function spotCost(spot: SpotRef): number {
  switch (spot.kind) {
    case 'hold':
      // 费用取决于该船装的哪块货仓
      return 0; // 由 holdCost() 按船与格位算，见下
    case 'deck':
      // 甲板不是放置格位，只有登船的海盗会站上去，无费用
      return 0;
    case 'port':
      return PORT_SPACES[spot.slot]?.cost ?? 0;
    case 'shipyard':
      return SHIPYARD_SPACES[spot.slot]?.cost ?? 0;
    case 'pirate':
      return PIRATE_SPACES[spot.space]?.cost ?? 0;
    case 'pilot':
      return spot.size === 'small' ? PILOT_SMALL_COST : PILOT_LARGE_COST;
    case 'insurance':
      return INSURANCE_COST;
  }
}

/** 货仓某格的放置费。需要知道该船装的是哪种货 */
export function holdCost(good: GoodId, space: number): number {
  return getWareLoad(good).spaces[space]?.cost ?? 0;
}

/** 港口/修船场格位的报酬。货仓的报酬在板块级别，此处为 0 */
export function spotReward(spot: SpotRef): number {
  switch (spot.kind) {
    case 'port':
      return PORT_SPACES[spot.slot]?.reward ?? 0;
    case 'shipyard':
      return SHIPYARD_SPACES[spot.slot]?.reward ?? 0;
    default:
      return 0;
  }
}

// ---------------------------------------------------------------- 平底船

export interface BoatState {
  readonly lane: number;
  /** 装的哪种货；null 表示本航程没装货（4 种里未被选中的那种） */
  readonly good: GoodId | null;
  /** 在航道上的位置 0..13 */
  readonly position: number;
  /** 抵达港口时的空格下标（0=A, 1=B, 2=C）；未抵达为 null */
  readonly arrivedSlot: number | null;
  /** 进入修船场时的空格下标；未进厂为 null */
  readonly shipyardSlot: number | null;
  /** 是否被海盗劫掠 */
  readonly plundered: boolean;
}

export function createBoats(): BoatState[] {
  return [0, 1, 2].map((lane) => ({
    lane,
    good: null,
    position: 0,
    arrivedSlot: null,
    shipyardSlot: null,
    plundered: false,
  }));
}

/** 船是否已经在港口 */
export function hasArrived(boat: BoatState): boolean {
  return boat.arrivedSlot !== null;
}

/** 船是否已经进修船场 */
export function isShipwrecked(boat: BoatState): boolean {
  return boat.shipyardSlot !== null;
}

/** 船是否还在海上（未抵达也未进厂） */
export function isAtSea(boat: BoatState): boolean {
  return !hasArrived(boat) && !isShipwrecked(boat);
}

// ---------------------------------------------------------------- 骰子

export interface DiceRoll {
  readonly good: GoodId;
  readonly pips: number;
}

// ---------------------------------------------------------------- 步骤表

export type VoyageStep = 'placement' | 'movement';

/**
 * 一段航程的步骤表。本作规则（房主定案）：任何人数局统一
 * 「P M P M P M」——3 轮放置对应 3 个小弟。
 * 第三次投骰结束后先进入谈判阶段（每人可转账一次），再由领航员行动，最后结算；
 * 这两步不在步骤表里，由 game.ts 在表走完后接管。
 * （官方规则书对 3 人局有"4 小弟 4 放置轮"的变体，本作不采用。）
 */
export function voyageSchedule(playerCount: number): VoyageStep[] {
  void playerCount;
  return ['placement', 'movement', 'placement', 'movement', 'placement', 'movement'];
}

/** 已经执行过几次移动回合（用于判断海盗是登船还是劫掠） */
export function movementRoundsDone(steps: readonly VoyageStep[], stepIndex: number): number {
  return steps.slice(0, stepIndex).filter((s) => s === 'movement').length;
}

/** 平底船能否抵达：位置加上点数必须**越过**第 13 格 */
export function willArrive(position: number, pips: number): boolean {
  return position + pips > LANE_LAST_SPACE;
}
