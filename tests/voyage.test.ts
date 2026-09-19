import { describe, expect, it } from 'vitest';
import {
  GOODS,
  PORT_SPACES,
  PRICE_TRACK,
  SHIPYARD_SPACES,
  getWareLoad,
} from '../src/config/board-layout';
import { LANE_LAST_SPACE } from '../src/config/board-layout';
import { GAME_END_PRICE, MIN_SHARE_PRICE } from '../src/config/constants';
import { creditLimit, minLegalBid } from '../src/core/bidding';
import {
  applyIntent,
  createGame,
  currentAuctionPlayer,
  currentPilot,
  currentPirateDecider,
  currentPlacementPlayer,
  placementContext,
  sharePrice,
  validatePilotMoves,
  wealthOf,
  type GameState,
  type Intent,
} from '../src/core/game';
import { validateLaunch, validateLoad } from '../src/core/master';
import { availableSpots, costOf } from '../src/core/placement';
import { advanceBoats, resolveEndOfVoyage, rollDice } from '../src/core/movement';
import { createRng } from '../src/core/rng';
import { settleVoyage } from '../src/core/payout';
import type { BoatState, Placement } from '../src/core/voyage';

// ---------------------------------------------------------------- 工具

function step(state: GameState, intent: Intent): GameState {
  const out = applyIntent(state, intent);
  if (!out.ok) throw new Error(`意图失败: ${out.error.code} ${out.error.message}（阶段 ${state.phase}）`);
  return out.state;
}

/** 跑完竞标，让指定玩家成为港务长（以最低价稳拿） */
function runAuction(state: GameState): GameState {
  let s = state;
  for (let i = 0; i < 200; i += 1) {
    const who = currentAuctionPlayer(s);
    if (!who) break;
    const p = s.players.find((x) => x.id === who);
    if (!p || !s.bidding) throw new Error('竞标状态异常');
    const min = minLegalBid(s.bidding);
    if (min <= creditLimit(p) && min <= 15) {
      s = step(s, { type: 'auction-bid', playerId: who, amount: min });
    } else {
      s = step(s, { type: 'auction-pass', playerId: who });
    }
  }
  return s;
}

/** 走完港务长职权：跳过买股份、装前三种货、按 2/3/4 放船 */
function runMasterDuties(state: GameState): GameState {
  let s = state;
  const master = s.harborMaster;
  if (!master) throw new Error('没有港务长');
  s = step(s, { type: 'master-skip-share', playerId: master });
  s = step(s, {
    type: 'master-load',
    playerId: master,
    laneAssignment: [GOODS[0]!.id, GOODS[1]!.id, GOODS[2]!.id],
  });
  s = step(s, { type: 'master-launch', playerId: master, positions: [2, 3, 4] });
  return s;
}

/** 通用自动出招：用于跑完整局 */
function pickIntent(s: GameState): Intent | null {
  switch (s.phase) {
    case 'auction': {
      const who = currentAuctionPlayer(s);
      if (!who || !s.bidding) return null;
      const p = s.players.find((x) => x.id === who);
      if (!p) return null;
      const min = minLegalBid(s.bidding);
      return min <= creditLimit(p) && min <= 15
        ? { type: 'auction-bid', playerId: who, amount: min }
        : { type: 'auction-pass', playerId: who };
    }
    case 'buy-share':
      return s.harborMaster ? { type: 'master-skip-share', playerId: s.harborMaster } : null;
    case 'load':
      return s.harborMaster
        ? {
            type: 'master-load',
            playerId: s.harborMaster,
            laneAssignment: [GOODS[0]!.id, GOODS[1]!.id, GOODS[2]!.id],
          }
        : null;
    case 'launch':
      return s.harborMaster
        ? { type: 'master-launch', playerId: s.harborMaster, positions: [2, 3, 4] }
        : null;
    case 'placement': {
      const who = currentPlacementPlayer(s);
      if (!who) return null;
      const ctx = placementContext(s);
      const spots = availableSpots(ctx);
      if (spots.length === 0) return { type: 'decline-placement', playerId: who };
      const cheapest = spots.reduce((best, spot) =>
        costOf(ctx, spot) < costOf(ctx, best) ? spot : best,
      );
      return { type: 'place', playerId: who, spot: cheapest };
    }
    case 'negotiation': {
      const who = s.players.find((p) => !s.negotiationConfirmed.includes(p.id));
      return who ? { type: 'negotiation-done', playerId: who.id } : null;
    }
    case 'pilot': {
      const cur = currentPilot(s);
      return cur ? { type: 'pilot-skip', playerId: cur.playerId } : null;
    }
    case 'pirate-destination': {
      const who = currentPirateDecider(s);
      const boat = s.piratePending[0];
      if (!who || boat === undefined) return null;
      return { type: 'pirate-destination', playerId: who, boat, destination: 'port' };
    }
    case 'movement':
    case 'payout':
    case 'price-rise':
      return { type: 'advance' };
    default:
      return null;
  }
}

function autoPlay(start: GameState, maxSteps = 4000): GameState {
  let s = start;
  for (let i = 0; i < maxSteps; i += 1) {
    if (s.phase === 'game-over') return s;
    const intent = pickIntent(s);
    if (!intent) throw new Error(`阶段 ${s.phase} 没有可执行的行动（第 ${i} 步）`);
    s = step(s, intent);
  }
  throw new Error('超过最大步数仍未结束');
}

// ---------------------------------------------------------------- 校验

describe('港务长职权校验', () => {
  it('装货必须是 3 种不同的货', () => {
    expect(validateLoad([GOODS[0]!.id, GOODS[0]!.id, GOODS[1]!.id]).ok).toBe(false);
    expect(validateLoad([GOODS[0]!.id, GOODS[1]!.id]).ok).toBe(false);
    expect(validateLoad([GOODS[0]!.id, GOODS[1]!.id, GOODS[2]!.id]).ok).toBe(true);
  });

  it('三艘平底船起点之和必须正好是 9，且各自在 0-5', () => {
    expect(validateLaunch([2, 3, 4]).ok).toBe(true);
    expect(validateLaunch([0, 4, 5]).ok).toBe(true);
    expect(validateLaunch([1, 3, 4]).ok).toBe(false); // 和 = 8
    expect(validateLaunch([3, 3, 3]).ok).toBe(true); // 和 = 9
    expect(validateLaunch([0, 3, 6]).ok).toBe(false); // 6 超出范围
    expect(validateLaunch([1, 3, 5]).ok).toBe(true);
  });

  it('装货后能推出没被装载的那种货', () => {
    let s = startVoyageForTest(3);
    s = runAuction(s);
    s = step(s, { type: 'master-skip-share', playerId: s.harborMaster! });
    s = step(s, {
      type: 'master-load',
      playerId: s.harborMaster!,
      laneAssignment: [GOODS[0]!.id, GOODS[1]!.id, GOODS[2]!.id],
    });
    expect(s.skippedGood).toBe(GOODS[3]!.id);
    expect(s.boats.map((b) => b.good)).toEqual([GOODS[0]!.id, GOODS[1]!.id, GOODS[2]!.id]);
  });
});

// ---------------------------------------------------------------- 买股份

describe('港务长买股份', () => {
  it('价格不低于 5 元，且从钱箱取走该股份', () => {
    let s = startVoyageForTest(3);
    s = runAuction(s);
    const master = s.harborMaster!;
    const before = s.players.find((p) => p.id === master)!;
    const good = GOODS[0]!.id;
    const priceBefore = sharePrice(s, good);
    expect(priceBefore).toBeGreaterThanOrEqual(MIN_SHARE_PRICE);

    s = step(s, { type: 'master-buy-share', playerId: master, good });

    const after = s.players.find((p) => p.id === master)!;
    expect(after.shares.length).toBe(before.shares.length + 1);
    expect(after.cash).toBe(before.cash - priceBefore);
    expect(s.sharePool.some((c) => c.good === good)).toBe(true);
    expect(s.phase).toBe('load');
  });

  it('只有港务长能买股份', () => {
    let s = startVoyageForTest(3);
    s = runAuction(s);
    const other = s.players.find((p) => p.id !== s.harborMaster)!;
    const out = applyIntent(s, { type: 'master-buy-share', playerId: other.id, good: GOODS[0]!.id });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe('not-your-turn');
  });
});

// ---------------------------------------------------------------- 放置小弟

describe('放置小弟', () => {
  it('货仓必须放在最低价的空位', () => {
    let s = runMasterDuties(runAuction(startVoyageForTest(3)));
    const who = currentPlacementPlayer(s)!;
    const jadeLane = s.boats.findIndex((b) => b.good === 'jade');
    if (jadeLane >= 0) {
      // jade 货仓有 4 格，必须从第 0 格开始
      const bad = applyIntent(s, {
        type: 'place',
        playerId: who,
        spot: { kind: 'hold', boat: jadeLane, space: 3 },
      });
      expect(bad.ok).toBe(false);
      if (!bad.ok) expect(bad.error.code).toBe('must-take-cheapest-hold-space');
    }
  });

  it('同一个格位不能放两个人', () => {
    let s = runMasterDuties(runAuction(startVoyageForTest(3)));
    const first = currentPlacementPlayer(s)!;
    s = step(s, { type: 'place', playerId: first, spot: { kind: 'pirate', space: 0 } });
    // 记录首位海盗船长
    expect(s.pirateCaptain).toBe(first);

    // 轮到别人时不能抢同一个位子
    const second = currentPlacementPlayer(s)!;
    const out = applyIntent(s, { type: 'place', playerId: second, spot: { kind: 'pirate', space: 0 } });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe('spot-taken');
  });

  it('保险处不收费且立即得到 10 元', () => {
    let s = runMasterDuties(runAuction(startVoyageForTest(3)));
    const who = currentPlacementPlayer(s)!;
    const before = s.players.find((p) => p.id === who)!.cash;
    s = step(s, { type: 'place', playerId: who, spot: { kind: 'insurance' } });
    const after = s.players.find((p) => p.id === who)!.cash;
    expect(after).toBe(before + 10);
  });

  it('自我克制后本段航程不再轮到该玩家', () => {
    let s = runMasterDuties(runAuction(startVoyageForTest(3)));
    const who = currentPlacementPlayer(s)!;
    s = step(s, { type: 'decline-placement', playerId: who });
    expect(s.declined).toContain(who);
    // 后续轮次不应再轮到该玩家
    for (let i = 0; i < 8 && s.phase === 'placement'; i += 1) {
      const cur = currentPlacementPlayer(s);
      if (cur === null) break;
      expect(cur).not.toBe(who);
      s = step(s, { type: 'decline-placement', playerId: cur });
    }
  });

  it('现金不足时成为盲目的旅客，只能付出全部现金且不能当保险仲介者', () => {
    let s = runMasterDuties(runAuction(startVoyageForTest(3)));
    // 把当前玩家现金压到 0
    const who = currentPlacementPlayer(s)!;
    s = {
      ...s,
      players: s.players.map((p) => (p.id === who ? { ...p, cash: 0 } : p)),
    };
    const out = applyIntent(s, { type: 'place', playerId: who, spot: { kind: 'insurance' } });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe('blind-cannot-be-insurer');

    const spot = { kind: 'port', slot: 0 } as const;
    s = step(s, { type: 'place', playerId: who, spot });
    const placed = s.placements[s.placements.length - 1];
    expect(placed?.blind).toBe(true);
    expect(placed?.cost).toBe(0);
  });
});

// ---------------------------------------------------------------- 移动

describe('掷骰推船', () => {
  const baseBoats = (): BoatState[] =>
    [0, 1, 2].map((lane) => ({
      lane,
      good: GOODS[lane]!.id,
      position: 0,
      arrivedSlot: null,
      shipyardSlot: null,
      plundered: false,
    }));

  it('越过第 13 格才算抵达；正好停在第 13 格不算', () => {
    const boats = baseBoats().map((b, i) => (i === 0 ? { ...b, position: 10 } : b));
    const dice = [{ good: GOODS[0]!.id, pips: 3 }];
    const moved = advanceBoats(boats, dice);
    expect(moved.boats[0]?.position).toBe(LANE_LAST_SPACE);
    expect(moved.boats[0]?.arrivedSlot).toBeNull();

    const dice2 = [{ good: GOODS[0]!.id, pips: 4 }];
    const moved2 = advanceBoats(boats, dice2);
    expect(moved2.boats[0]?.arrivedSlot).toBe(0);
  });

  it('抵达时多余点数被忽略，港口按抵达顺序分配', () => {
    const boats = baseBoats().map((b, i) => ({ ...b, position: i === 0 ? 12 : 12 }));
    const dice = [
      { good: GOODS[0]!.id, pips: 6 },
      { good: GOODS[1]!.id, pips: 6 },
    ];
    const moved = advanceBoats(boats, dice);
    expect(moved.boats[0]?.arrivedSlot).toBe(0);
    expect(moved.boats[1]?.arrivedSlot).toBe(1);
  });

  it('三次移动后仍在海上的船进入修船场', () => {
    const boats = baseBoats().map((b) => ({ ...b, position: 5 }));
    const resolved = resolveEndOfVoyage(boats, []);
    expect(resolved.boats.every((b) => b.shipyardSlot !== null)).toBe(true);
    expect(resolved.boats.map((b) => b.shipyardSlot)).toEqual([0, 1, 2]);
  });

  it('停在第 13 格且无海盗的船进入港口', () => {
    const boats = baseBoats().map((b) => ({ ...b, position: LANE_LAST_SPACE }));
    const resolved = resolveEndOfVoyage(boats, []);
    expect(resolved.boats.every((b) => b.arrivedSlot !== null)).toBe(true);
  });

  it('掷骰只给装了货的船', () => {
    const boats = baseBoats().map((b, i) => (i === 2 ? { ...b, good: null } : b));
    const dice = rollDice(boats, createRng(1));
    expect(dice).toHaveLength(2);
    expect(dice.every((d) => d.pips >= 1 && d.pips <= 6)).toBe(true);
  });
});

// ---------------------------------------------------------------- 结算

describe('利润分配与保险', () => {
  it('货仓利润由格位上的小弟均分', () => {
    const good = 'nutmeg' as const;
    const load = getWareLoad(good);
    const boats: BoatState[] = [
      { lane: 0, good, position: 13, arrivedSlot: 0, shipyardSlot: null, plundered: false },
    ];
    const placements: Placement[] = [
      { playerId: 'a', spot: { kind: 'hold', boat: 0, space: 0 }, cost: 1, blind: false, fromPirate: false },
      { playerId: 'b', spot: { kind: 'hold', boat: 0, space: 1 }, cost: 2, blind: false, fromPirate: false },
    ];
    const players = ['a', 'b', 'c'].map((id) => ({
      id,
      name: id.toUpperCase(),
      color: '#000',
      cash: 0,
      shares: [],
      accomplicesTotal: 3,
    }));

    const { players: after, report } = settleVoyage({
      boats,
      placements,
      players,
      priceOf: () => 5,
      nameOf: (id) => id,
    });

    const expected = Math.floor(load.totalReward / 2);
    expect(after.find((p) => p.id === 'a')?.cash).toBe(expected);
    expect(after.find((p) => p.id === 'b')?.cash).toBe(expected);
    expect(report.goodArrived).toEqual([good]);
  });

  it('港口格位的报酬由钱箱支付，空置格位的小弟空手而回', () => {
    const boats: BoatState[] = [
      { lane: 0, good: 'nutmeg', position: 13, arrivedSlot: 0, shipyardSlot: null, plundered: false },
    ];
    const placements: Placement[] = [
      { playerId: 'a', spot: { kind: 'port', slot: 0 }, cost: PORT_SPACES[0]!.cost, blind: false, fromPirate: false },
      { playerId: 'b', spot: { kind: 'port', slot: 1 }, cost: PORT_SPACES[1]!.cost, blind: false, fromPirate: false },
    ];
    const players = ['a', 'b'].map((id) => ({
      id, name: id, color: '#000', cash: 0, shares: [], accomplicesTotal: 3,
    }));

    const { players: after } = settleVoyage({
      boats, placements, players, priceOf: () => 5, nameOf: (id) => id,
    });

    expect(after.find((p) => p.id === 'a')?.cash).toBe(PORT_SPACES[0]!.reward);
    expect(after.find((p) => p.id === 'b')?.cash).toBe(0);
  });

  it('修船场赔偿由保险仲介者支付；仲介者钱不够时差额由钱箱负担', () => {
    const boats: BoatState[] = [
      { lane: 0, good: 'nutmeg', position: 5, arrivedSlot: null, shipyardSlot: 0, plundered: false },
      { lane: 1, good: 'silk', position: 5, arrivedSlot: null, shipyardSlot: 1, plundered: false },
    ];
    const placements: Placement[] = [
      { playerId: 'broker', spot: { kind: 'insurance' }, cost: 0, blind: false, fromPirate: false },
      { playerId: 'rider', spot: { kind: 'shipyard', slot: 0 }, cost: 3, blind: false, fromPirate: false },
    ];
    const players = ['broker', 'rider'].map((id) => ({
      id, name: id, color: '#000', cash: 2, shares: [], accomplicesTotal: 3,
    }));

    const { players: after, report } = settleVoyage({
      boats, placements, players, priceOf: () => 5, nameOf: (id) => id,
    });

    // 受益者拿到修船场 0 的赔偿（他本身有 2 元现金）
    expect(after.find((p) => p.id === 'rider')?.cash).toBe(2 + SHIPYARD_SPACES[0]!.reward);
    // 仲介者只有 2 元、无股份可抵押 → 只能付 2 元，其余由钱箱负担
    expect(report.broker).toBe('broker');
    expect(report.brokerPaid).toBe(2);
    expect(report.bankCovered).toBe(SHIPYARD_SPACES[0]!.reward + SHIPYARD_SPACES[1]!.reward - 2);
    expect(after.find((p) => p.id === 'broker')?.cash).toBe(0);
  });

  it('被劫掠的船上，普通小弟空手而回，只有海盗均分劫掠所得', () => {
    const good = 'silk' as const;
    const load = getWareLoad(good);
    // 被劫掠的船仍需先由海盗船长决定去向，之后才结算
    const boats: BoatState[] = [
      { lane: 0, good, position: LANE_LAST_SPACE, arrivedSlot: 0, shipyardSlot: null, plundered: true },
    ];
    const placements: Placement[] = [
      { playerId: 'victim', spot: { kind: 'hold', boat: 0, space: 0 }, cost: 1, blind: false, fromPirate: false },
      { playerId: 'pirate', spot: { kind: 'hold', boat: 0, space: 1 }, cost: 0, blind: false, fromPirate: true },
    ];
    const players = ['victim', 'pirate'].map((id) => ({
      id, name: id, color: '#000', cash: 0, shares: [], accomplicesTotal: 3,
    }));

    const { players: after } = settleVoyage({
      boats, placements, players, priceOf: () => 5, nameOf: (id) => id,
    });

    expect(after.find((p) => p.id === 'victim')?.cash).toBe(0);
    expect(after.find((p) => p.id === 'pirate')?.cash).toBe(load.totalReward);
  });
});

// ---------------------------------------------------------------- 谈判与领航员

/** 从放船之后推进到谈判阶段：放置轮全员自我克制，移动轮点继续 */
function driveToNegotiation(state: GameState): GameState {
  let s = state;
  for (let i = 0; i < 60 && s.phase !== 'negotiation'; i += 1) {
    if (s.phase === 'placement') {
      const who = currentPlacementPlayer(s);
      if (!who) throw new Error('放置阶段没有可行动者');
      s = step(s, { type: 'decline-placement', playerId: who });
    } else if (s.phase === 'movement') {
      s = step(s, { type: 'advance' });
    } else {
      throw new Error(`意外阶段 ${s.phase}`);
    }
  }
  return s;
}

describe('谈判与转账', () => {
  it('第三次投骰结束后、结算之前进入谈判阶段', () => {
    const s = driveToNegotiation(runMasterDuties(runAuction(startVoyageForTest(3))));
    expect(s.phase).toBe('negotiation');
    // 还轮到不了结算：领航员/结算都在全员确认之后
    expect(s.payout).toBeNull();
  });

  it('每人每段航程可转账一次，双方现金此消彼长', () => {
    let s = driveToNegotiation(runMasterDuties(runAuction(startVoyageForTest(3))));
    const a = s.players[0]!;
    const b = s.players[1]!;
    s = step(s, { type: 'transfer', playerId: a.id, toPlayerId: b.id, amount: 7 });
    expect(s.players.find((p) => p.id === a.id)!.cash).toBe(a.cash - 7);
    expect(s.players.find((p) => p.id === b.id)!.cash).toBe(b.cash + 7);

    // 第二次主动转出被拒
    const again = applyIntent(s, { type: 'transfer', playerId: a.id, toPlayerId: b.id, amount: 1 });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.code).toBe('already-transferred');
  });

  it('转账金额与对象受限：正整数、不能超现金、不能转给自己', () => {
    const s = driveToNegotiation(runMasterDuties(runAuction(startVoyageForTest(3))));
    const a = s.players[0]!;
    const b = s.players[1]!;
    expect(applyIntent(s, { type: 'transfer', playerId: a.id, toPlayerId: b.id, amount: 0 }).ok).toBe(false);
    expect(applyIntent(s, { type: 'transfer', playerId: a.id, toPlayerId: b.id, amount: 1.5 }).ok).toBe(false);
    expect(applyIntent(s, { type: 'transfer', playerId: a.id, toPlayerId: b.id, amount: a.cash + 1 }).ok).toBe(false);
    const self = applyIntent(s, { type: 'transfer', playerId: a.id, toPlayerId: a.id, amount: 1 });
    expect(self.ok).toBe(false);
    if (!self.ok) expect(self.error.code).toBe('self-transfer');
  });

  it('全员确认后进结算（无人担任领航员时直接利润分配）', () => {
    let s = driveToNegotiation(runMasterDuties(runAuction(startVoyageForTest(3))));
    for (const p of [...s.players]) {
      s = step(s, { type: 'negotiation-done', playerId: p.id });
    }
    expect(s.phase).toBe('payout');
  });
});

describe('领航员（每船一次，新额度）', () => {
  const seaBoats = (): BoatState[] =>
    [0, 1, 2].map((lane) => ({
      lane,
      good: GOODS[lane]!.id,
      position: 5,
      arrivedSlot: null,
      shipyardSlot: null,
      plundered: false,
    }));

  it('小领航员：每艘海上的船各可 ±1，但同一艘只能动一次', () => {
    expect(
      validatePilotMoves('small', [{ boat: 0, delta: 1 }, { boat: 1, delta: -1 }, { boat: 2, delta: 1 }], seaBoats()).ok,
    ).toBe(true);
    expect(validatePilotMoves('small', [{ boat: 0, delta: 2 }], seaBoats()).ok).toBe(false);
    expect(
      validatePilotMoves('small', [{ boat: 0, delta: 1 }, { boat: 0, delta: 1 }], seaBoats()).ok,
    ).toBe(false);
  });

  it('大领航员：每艘海上的船各可 ±2', () => {
    expect(
      validatePilotMoves('large', [{ boat: 0, delta: 2 }, { boat: 1, delta: -2 }, { boat: 2, delta: 2 }], seaBoats()).ok,
    ).toBe(true);
    expect(validatePilotMoves('large', [{ boat: 0, delta: 3 }], seaBoats()).ok).toBe(false);
    expect(
      validatePilotMoves('large', [{ boat: 1, delta: 1 }, { boat: 1, delta: 1 }], seaBoats()).ok,
    ).toBe(false);
  });

  it('领航员在谈判确认之后才行动，推完船立即进入结算链', () => {
    let s = runMasterDuties(runAuction(startVoyageForTest(3)));
    const first = currentPlacementPlayer(s)!;
    s = step(s, { type: 'place', playerId: first, spot: { kind: 'pilot', size: 'small' } });
    s = driveToNegotiation(s);
    expect(s.phase).toBe('negotiation');

    for (const p of [...s.players]) {
      s = step(s, { type: 'negotiation-done', playerId: p.id });
    }
    expect(s.phase).toBe('pilot');
    expect(currentPilot(s)?.playerId).toBe(first);
    expect(s.pilotPending).toEqual(['small']);

    // 每艘海上的船各推进 1 格（越过 13 即抵达，位置停在 13）
    const atSea = s.boats
      .map((b, i) => ({ b, i }))
      .filter(({ b }) => b.arrivedSlot === null && b.shipyardSlot === null);
    if (atSea.length > 0) {
      const before = s.boats.map((b) => b.position);
      s = step(s, {
        type: 'pilot-move',
        playerId: first,
        moves: atSea.map(({ i }) => ({ boat: i, delta: 1 })),
      });
      for (const { i } of atSea) {
        expect(s.boats[i]!.position).toBe(Math.min(before[i]! + 1, LANE_LAST_SPACE));
      }
    } else {
      s = step(s, { type: 'pilot-skip', playerId: first });
    }
    // 小领航员行动完（没人当大领航员）→ 航程收尾
    expect(['payout', 'pirate-destination']).toContain(s.phase);
  });
});

// ---------------------------------------------------------------- 整局

describe('完整一局', () => {
  it.each([3, 4, 5])('%i 人局能从开局自动跑到游戏结束', (n) => {
    const final = autoPlay(startVoyageForTest(n, 20260101 + n));

    expect(final.phase).toBe('game-over');
    expect(final.winner).not.toBeNull();

    // 结束条件：至少一种货物价格达到 30
    const reached = GOODS.some((g) => (PRICE_TRACK[final.priceIndex[g.id] ?? 0] ?? 0) >= GAME_END_PRICE);
    expect(reached).toBe(true);

    // 胜者是财富最高者
    const ranked = [...final.players].sort((a, b) => wealthOf(final, b) - wealthOf(final, a));
    expect(final.winner).toBe(ranked[0]?.id);
  });

  it('同一 seed + 同一串意图得到同一局（确定性）', () => {
    const a = autoPlay(startVoyageForTest(4, 777));
    const b = autoPlay(startVoyageForTest(4, 777));
    expect(a.log).toEqual(b.log);
    expect(a.priceIndex).toEqual(b.priceIndex);
    expect(a.players.map((p) => p.cash)).toEqual(b.players.map((p) => p.cash));
  });

  it('推进过程中日志始终在增长，且记录到每一段航程', () => {
    const final = autoPlay(startVoyageForTest(3, 99));
    expect(final.log.some((l) => l.includes('第 1 段航程'))).toBe(true);
    expect(final.log.some((l) => l.includes('利润分配'))).toBe(true);
    expect(final.log.some((l) => l.includes('货物价格上升'))).toBe(true);
    expect(final.log.some((l) => l.includes('游戏结束'))).toBe(true);
  });
});

function startVoyageForTest(n: number, seed = 42): GameState {
  return startVoyageState(createGame({ playerCount: n, seed }));
}

// 避免与 core 的 startVoyage 同名混淆
import { startVoyage as startVoyageState } from '../src/core/game';
