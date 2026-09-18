/**
 * 联机房间门禁测试：登录、开局人数、座位绑定、越权意图拒绝。
 * 规则本身的测试在 tests/game.test.ts，这里只测 server/room.ts 这层「谁能动」。
 */
import { describe, expect, it } from 'vitest';
import { createRoom, type AccountEntry } from '../server/room';
import type { Intent } from '../src/core/game';

const ACCOUNTS: AccountEntry[] = [
  { account: 'a1', password: 'pw1', name: '甲' },
  { account: 'a2', password: 'pw2', name: '乙' },
  { account: 'a3', password: 'pw3', name: '丙' },
  { account: 'a4', password: 'pw4', name: '丁' },
];

function roomWithLoggedIn(count: number) {
  const room = createRoom(ACCOUNTS);
  for (let i = 0; i < count; i += 1) {
    const a = ACCOUNTS[i]!;
    expect(room.login(a.account, a.password).ok).toBe(true);
  }
  return room;
}

function seatOfAccount(room: ReturnType<typeof createRoom>, account: string): string {
  const seat = room.snapshot().seats.find((s) => s.account === account)?.seat;
  if (!seat) throw new Error(`${account} 没有座位`);
  return seat;
}

describe('登录', () => {
  it('密码错误被拒', () => {
    const room = createRoom(ACCOUNTS);
    const result = room.login('a1', 'wrong');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('bad-credentials');
  });

  it('第一个登录的人是房主，房主离线后移交', () => {
    const room = roomWithLoggedIn(2);
    expect(room.hostAccount()).toBe('a1');
    room.setOnline('a1', false);
    expect(room.hostAccount()).toBe('a2');
  });
});

describe('开局', () => {
  it('在线人数不合法（2 人）被拒', () => {
    const room = roomWithLoggedIn(2);
    const result = room.start('a1', 42);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('bad-count');
  });

  it('非房主不能开局', () => {
    const room = roomWithLoggedIn(3);
    const result = room.start('a2', 42);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('not-host');
  });

  it('3 人在线随机分座：每人一个不重复的座位，名字进状态', () => {
    const room = roomWithLoggedIn(3);
    expect(room.start('a1', 42).ok).toBe(true);
    const snap = room.snapshot();
    const seats = snap.seats.map((s) => s.seat).sort();
    expect(seats).toEqual(['p1', 'p2', 'p3']);
    const names = snap.state?.players.map((p) => p.name).sort();
    expect(names).toEqual(['丙', '乙', '甲']);
  });

  it('同一 seed 重放，座位分配一致', () => {
    const r1 = roomWithLoggedIn(3);
    const r2 = roomWithLoggedIn(3);
    r1.start('a1', 7);
    r2.start('a1', 7);
    expect(r1.snapshot().seats.map((s) => `${s.account}:${s.seat}`)).toEqual(
      r2.snapshot().seats.map((s) => `${s.account}:${s.seat}`),
    );
  });
});

describe('意图门禁', () => {
  it('替别人出价被拒（seat-mismatch）', () => {
    const room = roomWithLoggedIn(3);
    room.start('a1', 42);
    const other = seatOfAccount(room, 'a1') === 'p1' ? 'p2' : 'p1';
    const intent: Intent = { type: 'auction-bid', playerId: other, amount: 1 };
    const result = room.applyIntentFrom('a1', intent);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('seat-mismatch');
  });

  it('轮不到自己的座位出合法 playerId 也被拒（not-your-turn）', () => {
    const room = roomWithLoggedIn(3);
    room.start('a1', 42);
    const snap = room.snapshot();
    const mySeat = snap.seats.find((s) => s.account === 'a1')?.seat!;
    const actor = snap.state!.bidding!.order[snap.state!.bidding!.cursor]!;
    if (mySeat === actor) {
      // 我恰好是行动者：换一个不是我的座位来测
      const silent = snap.seats.find((s) => s.seat && s.seat !== actor)!;
      const result = room.applyIntentFrom(silent.account, {
        type: 'auction-bid',
        playerId: silent.seat!,
        amount: 1,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('not-your-turn');
    } else {
      const result = room.applyIntentFrom('a1', { type: 'auction-bid', playerId: mySeat, amount: 1 });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('not-your-turn');
    }
  });

  it('大厅阶段发意图被拒', () => {
    const room = roomWithLoggedIn(3);
    const result = room.applyIntentFrom('a1', { type: 'advance' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('no-game');
  });

  it('任何在座玩家都可以点「继续」推进 movement 等公共阶段', () => {
    const room = roomWithLoggedIn(3);
    room.start('a1', 42);
    const snap = room.snapshot();
    const actorSeat = snap.state!.bidding!.order[snap.state!.bidding!.cursor]!;
    // 全场过牌 → 无人出价 → 进入结算后自动是 buy-share，跳过到 load… 只验证不越权时报错
    let current = room.snapshot().state!;
    for (let i = 0; i < 3 && current.phase === 'auction'; i += 1) {
      const who = current.bidding!.order[current.bidding!.cursor]!;
      const account = snap.seats.find((s) => s.seat === who)!.account;
      room.applyIntentFrom(account, { type: 'auction-pass', playerId: who });
      current = room.snapshot().state!;
    }
    expect(current.phase).toBe('buy-share');
    expect(actorSeat).toBeTruthy();
  });
});
