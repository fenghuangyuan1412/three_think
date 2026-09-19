import { describe, expect, it } from 'vitest';
import { applyIntent, createGame, playerCreditLimit, sharePrice, startVoyage } from '../src/core/game';
import type { GameState } from '../src/core/game';
import { ACCOMPLICES_BY_PLAYER_COUNT, MIN_SHARE_PRICE, STARTING_CASH } from '../src/config/constants';
import type { Player } from '../src/core/types';

function startGame(playerCount: number, seed = 42): GameState {
  return startVoyage(createGame({ playerCount, seed }));
}

describe('建局', () => {
  it.each([3, 4, 5])('%i 人局：每人 30 元、2 张股份', (n) => {
    const state = createGame({ playerCount: n });
    expect(state.players).toHaveLength(n);
    for (const p of state.players) {
      expect(p.cash).toBe(STARTING_CASH);
      expect(p.shares).toHaveLength(2);
      expect(p.shares.every((s) => !s.mortgaged)).toBe(true);
    }
  });

  it('小弟数：任何人数局每人 3 个', () => {
    for (const n of [3, 4, 5]) {
      const state = createGame({ playerCount: n });
      for (const p of state.players) {
        expect(p.accomplicesTotal).toBe(ACCOMPLICES_BY_PLAYER_COUNT[n]);
      }
    }
  });

  it('人数不在 3-5 之间时抛错', () => {
    expect(() => createGame({ playerCount: 2 })).toThrow();
    expect(() => createGame({ playerCount: 6 })).toThrow();
  });

  it('同一seed发牌结果一致，不同seed洗牌不同', () => {
    const a = createGame({ playerCount: 4, seed: 7 });
    const b = createGame({ playerCount: 4, seed: 7 });
    const c = createGame({ playerCount: 4, seed: 8 });
    const hand = (s: GameState) => s.players.map((p) => p.shares.map((x) => x.id).join(','));
    expect(hand(a)).toEqual(hand(b));
    expect(hand(a)).not.toEqual(hand(c));
  });

  it('初始状态不是竞标阶段', () => {
    expect(createGame({ playerCount: 4 }).phase).toBe('setup');
  });

  it('第一段航程由座位第 1 位起叫', () => {
    const state = startGame(4);
    expect(state.phase).toBe('auction');
    expect(state.bidding?.order[state.bidding.cursor]).toBe('p1');
    expect(state.bidding?.incumbent).toBeNull();
  });
});

describe('股份价格', () => {
  it('价格轨起点为 0，但股份最低价恒为 5 元', () => {
    const state = createGame({ playerCount: 3 });
    expect(sharePrice(state, 'jade')).toBe(MIN_SHARE_PRICE);
  });
});

describe('竞标结算', () => {
  it('得标者付款入钱箱、成为港务长，阶段推进到买股份', () => {
    let state = startGame(3);
    // 顺序 p1 → p2 → p3
    state = ok(applyIntent(state, { type: 'auction-bid', playerId: 'p1', amount: 5 }));
    state = ok(applyIntent(state, { type: 'auction-bid', playerId: 'p2', amount: 8 }));
    state = ok(applyIntent(state, { type: 'auction-pass', playerId: 'p3' }));
    state = ok(applyIntent(state, { type: 'auction-pass', playerId: 'p1' }));

    expect(state.phase).toBe('buy-share');
    expect(state.harborMaster).toBe('p2');
    expect(state.bidding?.paid).toBe(8);

    const p1 = state.players.find((p) => p.id === 'p1');
    const p2 = state.players.find((p) => p.id === 'p2');
    expect(p2?.cash).toBe(STARTING_CASH - 8);
    expect(p1?.cash).toBe(STARTING_CASH); // 未得标者不付款
  });

  it('结算后不再接受竞标意图', () => {
    let state = startGame(3);
    state = ok(applyIntent(state, { type: 'auction-bid', playerId: 'p1', amount: 5 }));
    state = ok(applyIntent(state, { type: 'auction-pass', playerId: 'p2' }));
    state = ok(applyIntent(state, { type: 'auction-pass', playerId: 'p3' }));

    const bad = applyIntent(state, { type: 'auction-bid', playerId: 'p1', amount: 9 });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe('wrong-intent');
  });

  it('现金不足时自动抵押股份贷款补足', () => {
    const base = createGame({ playerCount: 3, seed: 1 });
    // 把 p1 的现金压到 3 元，保留 2 张未抵押股份 → 额度 3 + 24 = 27
    const poor: Player = { ...base.players[0]!, cash: 3 };
    const rigged: GameState = startVoyage({
      ...base,
      players: [poor, base.players[1]!, base.players[2]!],
    });
    expect(playerCreditLimit(poor)).toBe(3 + 2 * 12);

    let state = ok(applyIntent(rigged, { type: 'auction-bid', playerId: 'p1', amount: 20 }));
    state = ok(applyIntent(state, { type: 'auction-pass', playerId: 'p2' }));
    state = ok(applyIntent(state, { type: 'auction-pass', playerId: 'p3' }));

    const p1 = state.players.find((p) => p.id === 'p1');
    // 3 + 24 = 27，付出 20 → 余 7；两张股份全部抵押
    expect(p1?.cash).toBe(7);
    expect(p1?.shares.every((s) => s.mortgaged)).toBe(true);
    expect(state.log.some((line) => line.includes('抵押'))).toBe(true);
  });

  it('拒绝超出信用额度的出价', () => {
    const base = createGame({ playerCount: 3, seed: 1 });
    const poor: Player = { ...base.players[0]!, cash: 3 };
    const rigged = startVoyage({ ...base, players: [poor, base.players[1]!, base.players[2]!] });

    const bad = applyIntent(rigged, { type: 'auction-bid', playerId: 'p1', amount: 28 });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe('over-credit-limit');
  });

  it('日志记录了竞标过程与结果', () => {
    let state = startGame(3);
    state = ok(applyIntent(state, { type: 'auction-bid', playerId: 'p1', amount: 6 }));
    state = ok(applyIntent(state, { type: 'auction-pass', playerId: 'p2' }));
    state = ok(applyIntent(state, { type: 'auction-pass', playerId: 'p3' }));

    expect(state.log.some((l) => l.includes('出价 6 元'))).toBe(true);
    expect(state.log.some((l) => l.includes('过牌'))).toBe(true);
    expect(state.log.some((l) => l.includes('港务长'))).toBe(true);
  });
});

describe('不可变性（agent.md §5）', () => {
  it('applyIntent 不修改传入的 state', () => {
    const state = startGame(3);
    const snapshot = JSON.stringify(state);
    applyIntent(state, { type: 'auction-bid', playerId: 'p1', amount: 5 });
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it('applyIntent 不修改传入的 players 数组元素', () => {
    const state = startGame(3);
    const before = { ...state.players[1]! };
    let next = ok(applyIntent(state, { type: 'auction-bid', playerId: 'p1', amount: 5 }));
    next = ok(applyIntent(next, { type: 'auction-pass', playerId: 'p2' }));
    next = ok(applyIntent(next, { type: 'auction-pass', playerId: 'p3' }));
    expect(state.players[1]).toEqual(before);
  });
});

function ok(outcome: ReturnType<typeof applyIntent>): GameState {
  if (!outcome.ok) throw new Error(`预期成功，实际失败: ${outcome.error.code} ${outcome.error.message}`);
  return outcome.state;
}
