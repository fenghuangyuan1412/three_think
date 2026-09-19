/**
 * 房间纯逻辑：登录簿、座位随机分配、服务端权威的意图推进。
 *
 * 不碰 WebSocket / HTTP —— 传输层在 main.ts，这里只是一个可用 vitest 直测的
 * 状态对象。规则判定全部委托给 core/game.ts 的 applyIntent，本文件只做
 * 「这条意图是不是你这个座位该出的」这一层门禁。
 */
import { applyIntent, createGame, currentDecisionActor, startVoyage } from '../src/core/game';
import type { GameState, Intent } from '../src/core/game';
import { createRng, shuffle, splitSeed } from '../src/core/rng';
import type { PlayerId } from '../src/core/types';
import { SUPPORTED_PLAYER_COUNTS } from '../src/config/constants';
import type { RoomPhase, RoomSnapshot, SeatInfo } from '../src/net/protocol';

export interface AccountEntry {
  readonly account: string;
  readonly password: string;
  readonly name: string;
}

export type RoomOutcome<T = void> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: string; readonly message: string };

interface Member {
  readonly account: string;
  readonly displayName: string;
  seat: PlayerId | null;
  online: boolean;
}

export interface Room {
  /** 登录 / 断线后重新接管。同一账号只允许一条在线连接（后来者踢掉前者由传输层负责） */
  login(account: string, password: string): RoomOutcome;
  setOnline(account: string, online: boolean): void;
  /** 房主开局：当前在线的人随机分座 */
  start(byAccount: string, seed: number): RoomOutcome;
  /** 收到某个连接发来的意图。playerId 与连接座位不符即拒收 */
  applyIntentFrom(byAccount: string, intent: Intent): RoomOutcome;
  /** 一局结束后回到大厅，可再次开局 */
  reset(byAccount: string): RoomOutcome;
  hostAccount(): string | null;
  snapshot(): RoomSnapshot;
  /** 按观看者过滤的快照：对局中其他玩家的股份类型保密（只留张数），局终全公开 */
  snapshotFor(viewerAccount: string | null): RoomSnapshot;
}

export function createRoom(accounts: readonly AccountEntry[]): Room {
  const byAccount = new Map(accounts.map((a) => [a.account, a]));
  const members = new Map<string, Member>();
  let host: string | null = null;
  let state: GameState | null = null;

  function fail(code: string, message: string): RoomOutcome {
    return { ok: false, code, message };
  }

  function seatOf(account: string): PlayerId | null {
    return members.get(account)?.seat ?? null;
  }

  function roomPhase(): RoomPhase {
    if (!state) return 'lobby';
    return state.phase === 'game-over' ? 'over' : 'playing';
  }

  function onlineMembers(): Member[] {
    return [...members.values()].filter((m) => m.online);
  }

  return {
    login(account, password) {
      const entry = byAccount.get(account);
      if (!entry || entry.password !== password) {
        return fail('bad-credentials', '账号或密码不对。');
      }
      if (!members.has(account)) {
        members.set(account, {
          account,
          displayName: entry.name,
          seat: null,
          online: true,
        });
        host ??= account;
      } else {
        members.get(account)!.online = true;
      }
      return { ok: true, value: undefined };
    },

    setOnline(account, online) {
      const member = members.get(account);
      if (!member) return;
      member.online = online;
      // 房主离线时把开局权交给下一个在线的人
      if (account === host && !online) {
        host = onlineMembers()[0]?.account ?? null;
      }
      if (online && host === null) host = account;
    },

    start(byAccount, seed) {
      if (roomPhase() === 'playing') return fail('already-started', '对局已经在进行中。');
      if (byAccount !== host) return fail('not-host', '只有房主可以开局。');

      const players = onlineMembers();
      if (!(SUPPORTED_PLAYER_COUNTS as readonly number[]).includes(players.length)) {
        return fail('bad-count', `需要 ${SUPPORTED_PLAYER_COUNTS.join('/')} 人同时在线才能开局，当前 ${players.length} 人。`);
      }

      // 座位随机分配：createGame 按顺序发 p1..pN，洗牌决定谁坐哪个颜色位。
      // 走带种子的 PRNG（agent.md §5）：开局种子确定后，座位分配可复现。
      const shuffled = shuffle(players, createRng(splitSeed(seed, 1)));
      shuffled.forEach((m, i) => {
        m.seat = `p${i + 1}`;
      });

      state = startVoyage(
        createGame({
          playerCount: players.length,
          names: shuffled.map((m) => m.displayName),
          seed,
        }),
      );
      return { ok: true, value: undefined };
    },

    applyIntentFrom(byAccount, intent) {
      if (!state || roomPhase() !== 'playing') {
        return fail('no-game', '当前没有进行中的对局。');
      }
      const seat = seatOf(byAccount);
      if (!seat) return fail('no-seat', '本局没有你的座位，等房主重新开局。');

      if ('playerId' in intent) {
        if (intent.playerId !== seat) {
          return fail('seat-mismatch', '不能替别的座位出操作。');
        }
        // 谈判阶段是多人并行的，没有「轮到谁」；其余阶段必须等行动者
        if (state.phase !== 'negotiation') {
          const actor = currentDecisionActor(state);
          if (actor !== seat) {
            return fail('not-your-turn', '还没轮到你。');
          }
        }
      }

      const outcome = applyIntent(state, intent);
      if (!outcome.ok) return fail(outcome.error.code, outcome.error.message);
      state = outcome.state;
      return { ok: true, value: undefined };
    },

    reset(byAccount) {
      if (byAccount !== host) return fail('not-host', '只有房主可以重开。');
      // 局中房主也能强制回大厅（朋友局有人掉线打不完时的出口）
      state = null;
      for (const m of members.values()) m.seat = null;
      return { ok: true, value: undefined };
    },

    hostAccount() {
      return host;
    },

    snapshot(): RoomSnapshot {
      const seats: SeatInfo[] = [...members.values()].map((m) => ({
        account: m.account,
        displayName: m.displayName,
        seat: m.seat,
        online: m.online,
      }));
      return {
        roomPhase: roomPhase(),
        seats,
        hostAccount: host,
        state,
      };
    },
    snapshotFor(viewerAccount: string | null): RoomSnapshot {
      const base = this.snapshot();
      const seat = viewerAccount ? seatOf(viewerAccount) : null;
      if (!base.state || !seat || base.roomPhase !== 'playing') return base;
      const masked: GameState = {
        ...base.state,
        players: base.state.players.map((p) =>
          p.id === seat
            ? p
            : {
                ...p,
                shares: [],
                hiddenShares: {
                  count: p.shares.length,
                  mortgaged: p.shares.filter((s) => s.mortgaged).length,
                },
              },
        ),
      };
      return { ...base, state: masked };
    },
  };
}
