/**
 * 掷骰推船、抵达与船难、海盗登船与劫掠、领航员影响力。
 *
 * 规则来源：http://www.mf8-china.com/archiver/?tid-72459.html
 * - 「海港负责人掷三颗骰子，每一颗骰子的颜色对应上船的货仓。接着他（依照任何顺序）
 *    移动三艘平底船，沿着它的航道前进骰子的点数。」
 * - 「每艘通过第１３个空格的平底船，抵达马尼拉的目的地港口。第一艘抵达…放在港口空格Ａ，
 *    第二艘放在Ｂ，第三艘放在Ｃ。」
 * - 「在三次移动回合之后未能抵达马尼拉的平底船，船只受损而必须进入修船场。」
 * - 「当平底船在移动回合结束时停留在第１３个空格，海盗攻击平底船。」
 *   「平底船在第二个移动回合以后抵达空格１３，海盗将登船。」
 *   「平底船在第三个移动回合以后抵达空格１３，海盗将劫掠船只。」
 * - 领航员：「他可以将一艘平底船向前或向后移动一格」（小）、
 *   「将其中一艘平底船移动两格或是将两艘平底船各移动一格」（大）
 */
import { LANE_LAST_SPACE, SHIPYARD_SLOTS } from '../config/board-layout';
import type { Rng } from './rng';
import type { PlayerId } from './types';
import {
  isAtSea,
  spotKey,
  willArrive,
  type BoatState,
  type DiceRoll,
  type Placement,
  type SpotRef,
} from './voyage';

export interface MoveResult {
  readonly boats: BoatState[];
  readonly notes: readonly string[];
}

/** 掷骰：每艘装了货的船掷一颗对应颜色的骰子 */
export function rollDice(boats: readonly BoatState[], rng: Rng): DiceRoll[] {
  const rolls: DiceRoll[] = [];
  for (const boat of boats) {
    if (boat.good === null) continue;
    rolls.push({ good: boat.good, pips: 1 + rng.int(6) });
  }
  return rolls;
}

function pipsFor(dice: readonly DiceRoll[], boat: BoatState): number {
  if (boat.good === null) return 0;
  return dice.find((d) => d.good === boat.good)?.pips ?? 0;
}

/** 下一个空闲的港口空格下标 */
export function nextFreePortSlot(boats: readonly BoatState[]): number | null {
  const used = new Set(
    boats.map((b) => b.arrivedSlot).filter((s): s is number => s !== null),
  );
  for (let slot = 0; slot < 3; slot += 1) {
    if (!used.has(slot)) return slot;
  }
  return null;
}

/** 下一个空闲的修船场空格下标 */
export function nextFreeShipyardSlot(boats: readonly BoatState[]): number | null {
  const used = new Set(
    boats.map((b) => b.shipyardSlot).filter((s): s is number => s !== null),
  );
  for (let slot = 0; slot < SHIPYARD_SLOTS.length; slot += 1) {
    if (!used.has(slot)) return slot;
  }
  return null;
}

const SLOT_LETTERS = ['A', 'B', 'C'] as const;

/**
 * 按骰子推进船只。
 *
 * 同时抵达的船按航道顺序（0→1→2）分配港口空格。
 * 「当平底船抵达目的地港口，且还有剩余的点数，这些点数被忽略不计。」
 */
export function advanceBoats(boats: readonly BoatState[], dice: readonly DiceRoll[]): MoveResult {
  const notes: string[] = [];
  let working = boats.map((b) => ({ ...b }));

  for (let i = 0; i < working.length; i += 1) {
    const boat = working[i];
    if (!boat || !isAtSea(boat)) continue;

    const pips = pipsFor(dice, boat);
    if (pips === 0) continue;

    if (willArrive(boat.position, pips)) {
      const slot = nextFreePortSlot(working);
      if (slot === null) continue;
      working[i] = { ...boat, position: LANE_LAST_SPACE, arrivedSlot: slot };
      notes.push(
        `第 ${boat.lane + 1} 航道（${boat.good ?? '空'}）前进 ${pips} 格，越过第 13 格抵达马尼拉港，停在港口空格 ${SLOT_LETTERS[slot]}。`,
      );
    } else {
      working[i] = { ...boat, position: boat.position + pips };
      notes.push(
        `第 ${boat.lane + 1} 航道（${boat.good ?? '空'}）前进 ${pips} 格，到第 ${boat.position + pips} 格。`,
      );
    }
  }

  return { boats: working, notes };
}

/** 移动回合结束时恰好停在第 13 格的船（海盗的触发条件） */
export function boatsOnThirteen(boats: readonly BoatState[]): number[] {
  const out: number[] = [];
  boats.forEach((boat, i) => {
    if (isAtSea(boat) && boat.position === LANE_LAST_SPACE && !boat.plundered) out.push(i);
  });
  return out;
}

/** 海盗船上的小弟，按格位顺序（船长在前） */
export function piratesInOrder(placements: readonly Placement[]): Placement[] {
  return placements
    .filter((p) => p.spot.kind === 'pirate')
    .slice()
    .sort((a, b) => {
      const sa = a.spot.kind === 'pirate' ? a.spot.space : 0;
      const sb = b.spot.kind === 'pirate' ? b.spot.space : 0;
      return sa - sb;
    });
}

/** 海盗船上是否有海盗 */
export function hasPirate(placements: readonly Placement[]): boolean {
  return placements.some((p) => p.spot.kind === 'pirate');
}

/**
 * 海盗登船：海盗从海盗船跳到该船的海盗甲板。
 *
 * 本作规则（房主定案）：海盗只上船、不占货仓格，也不把原来在船上的小弟踢下去；
 * 甲板是海盗的专属区，多名海盗在甲板上互相共享。货仓满不满与登船无关。
 */
export function boardPirates(
  boats: readonly BoatState[],
  placements: readonly Placement[],
  boatIndex: number,
): { boats: BoatState[]; placements: Placement[]; notes: string[] } {
  const notes: string[] = [];
  const boat = boats[boatIndex];
  const nextPlacements = placements.map((p) => ({ ...p }));
  if (!boat || boat.good === null) {
    return { boats: boats.map((b) => ({ ...b })), placements: nextPlacements, notes };
  }

  for (const pirate of piratesInOrder(nextPlacements)) {
    const idx = nextPlacements.findIndex(
      (p) => p.playerId === pirate.playerId && p.spot.kind === 'pirate',
    );
    if (idx < 0) continue;
    nextPlacements[idx] = {
      ...pirate,
      spot: {
        kind: 'deck',
        boat: boatIndex,
        space: pirate.spot.kind === 'pirate' ? pirate.spot.space : 0,
      },
      fromPirate: true,
    };
    notes.push(`海盗 ${pirate.playerId} 跳上第 ${boat.lane + 1} 航道的船（海盗甲板）。`);
  }

  return { boats: boats.map((b) => ({ ...b })), placements: nextPlacements, notes };
}

/**
 * 海盗劫掠：把船标记为被劫掠。
 * 规则：「平底船在第三个移动回合以后抵达空格１３，海盗将劫掠船只。」
 */
export function plunderBoat(
  boats: readonly BoatState[],
  boatIndex: number,
): MoveResult {
  const next = boats.map((b) => ({ ...b }));
  const boat = next[boatIndex];
  if (!boat) return { boats: next, notes: [] };
  next[boatIndex] = { ...boat, plundered: true };
  return {
    boats: next,
    notes: [`第 ${boat.lane + 1} 航道的船在第 13 格被海盗劫掠。`],
  };
}

/** 第三次移动回合结束后：把停在第 13 格且无海盗的船送进港，其余未抵达的送进修船场 */
export function resolveEndOfVoyage(
  boats: readonly BoatState[],
  placements: readonly Placement[],
): MoveResult {
  const notes: string[] = [];
  let working = boats.map((b) => ({ ...b }));

  // 1) 停在第 13 格、无海盗的船 → 进入下一个港口空格
  const piratePresent = hasPirate(placements);
  for (let i = 0; i < working.length; i += 1) {
    const boat = working[i];
    if (!boat || !isAtSea(boat) || boat.position !== LANE_LAST_SPACE) continue;
    if (piratePresent) continue; // 已被劫掠，去向由海盗船长决定
    const slot = nextFreePortSlot(working);
    if (slot === null) continue;
    working[i] = { ...boat, arrivedSlot: slot };
    notes.push(
      `第 ${boat.lane + 1} 航道的船停在第 13 格且无海盗，进入港口空格 ${SLOT_LETTERS[slot]}。`,
    );
  }

  // 2) 其余仍在海上的船 → 修船场（被劫掠的船除外，它的去向由海盗船长决定）
  for (let i = 0; i < working.length; i += 1) {
    const boat = working[i];
    if (!boat || !isAtSea(boat) || boat.plundered) continue;
    const slot = nextFreeShipyardSlot(working);
    if (slot === null) continue;
    working[i] = { ...boat, shipyardSlot: slot };
    notes.push(
      `第 ${boat.lane + 1} 航道的船未能抵达马尼拉，进入修船场空格 ${SLOT_LETTERS[slot]}。`,
    );
  }

  return { boats: working, notes };
}

// ---------------------------------------------------------------- 领航员

export interface PilotMove {
  readonly boat: number;
  /** 正数前进、负数后退 */
  readonly delta: number;
}

/**
 * 执行领航员的移动。
 *
 * 规则：「当领航员将船移动通过第１３个空格，平底船抵达目的地港口…
 * 当领航员将船移动至第１３个空格，没有事情发生（海盗只在移动回合结束时立即进行攻击）。」
 * 「领航员无法影响已经抵达马尼拉的平底船。」
 */
export function applyPilotMoves(boats: readonly BoatState[], moves: readonly PilotMove[]): MoveResult {
  const notes: string[] = [];
  let working = boats.map((b) => ({ ...b }));

  for (const move of moves) {
    const boat = working[move.boat];
    if (!boat || !isAtSea(boat)) {
      notes.push('领航员无法影响已经抵达或已进船厂的平底船。');
      continue;
    }
    if (move.delta === 0) continue;

    const target = boat.position + move.delta;

    if (target > LANE_LAST_SPACE) {
      const slot = nextFreePortSlot(working);
      if (slot === null) continue;
      working[move.boat] = { ...boat, position: LANE_LAST_SPACE, arrivedSlot: slot };
      notes.push(
        `领航员把第 ${boat.lane + 1} 航道的船移动通过第 13 格，抵达港口空格 ${SLOT_LETTERS[slot]}。`,
      );
    } else {
      const clamped = Math.max(0, target);
      working[move.boat] = { ...boat, position: clamped };
      notes.push(
        `领航员把第 ${boat.lane + 1} 航道的船${move.delta > 0 ? '前进' : '后退'}到第 ${clamped} 格。`,
      );
    }
  }

  return { boats: working, notes };
}

/** 领航员能选择的目标：还在海上的船 */
export function pilotTargets(boats: readonly BoatState[]): number[] {
  const out: number[] = [];
  boats.forEach((b, i) => {
    if (isAtSea(b)) out.push(i);
  });
  return out;
}

/** 找出某格位上的部署（用于结算） */
export function placementsOn(
  placements: readonly Placement[],
  match: (spot: SpotRef) => boolean,
): Placement[] {
  return placements.filter((p) => match(p.spot));
}

/** 某玩家是否是保险仲介者 */
export function insuranceBroker(placements: readonly Placement[]): PlayerId | null {
  const found = placements.find((p) => spotKey(p.spot) === 'insurance');
  return found ? found.playerId : null;
}
