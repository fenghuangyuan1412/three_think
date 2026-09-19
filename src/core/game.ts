/**
 * 对局状态与唯一的状态推进入口。
 *
 * 分层要求（agent.md §3）：本文件属于 core/，**不得 import three.js**。
 *
 * 联机预留：状态推进只通过 applyIntent(state, intent) —— 意图是纯数据，可序列化。
 * 随机性通过 (seed, rngCounter) 派生，同一 seed + 同一串意图必然复现同一局。
 *
 * 完整航程流程（每段航程四步，规则见 config 与 docs/game-flow.md）：
 *   竞标港务长 → 买股份 → 装货 → 放船
 *   → 放置小弟 / 掷骰推船 交替（含海盗登船）
 *   → 谈判与转账 → 领航员 → 海盗去向 → 利润分配 → 货物涨价 → 下一段航程
 *   任一货物价格达到 30 元 → 游戏结束，财富最高者胜。
 */
import {
  GOODS,
  LANE_LAST_SPACE,
  PRICE_TRACK,
  PRINTED_VALUES_PROVENANCE,
} from '../config/board-layout';
import {
  ACCOMPLICES_BY_PLAYER_COUNT,
  GAME_END_PRICE,
  MAX_PLAYERS,
  MIN_PLAYERS,
  MIN_SHARE_PRICE,
  STARTING_CASH,
  STARTING_SHARES,
} from '../config/constants';
import {
  applyBiddingAction,
  createBidding,
  type BiddingAction,
  type BiddingEvent,
  type BiddingState,
} from './bidding';
import { payToBank } from './economy';
import { fail, ok, sharePriceAt, skippedGoodOf, validateLaunch, validateLoad } from './master';
import {
  applyPilotMoves,
  boardPirates,
  boatsOnThirteen,
  hasPirate,
  nextFreePortSlot,
  nextFreeShipyardSlot,
  piratesInOrder,
  plunderBoat,
  resolveEndOfVoyage,
  rollDice,
  advanceBoats,
  type PilotMove,
} from './movement';
import { settleVoyage, type PayoutReport } from './payout';
import {
  applyPlacement,
  cheapestEmptyHoldSpace,
  placedCount,
  placementOrder,
  type PlacementContext,
} from './placement';
import { createRng, shuffle, splitSeed } from './rng';
import { findPlayer, type GoodId, type Player, type PlayerId, type ShareCard } from './types';
import {
  createBoats,
  spotKey,
  type BoatState,
  type DiceRoll,
  type Placement,
  type PilotSize,
  type SpotRef,
  type VoyageStep,
  voyageSchedule,
} from './voyage';

// ---------------------------------------------------------------- 阶段

export type GamePhase =
  | 'setup'
  | 'auction'
  | 'buy-share'
  | 'load'
  | 'launch'
  | 'placement'
  | 'movement'
  | 'pirate-boarding'
  | 'negotiation'
  | 'pilot'
  | 'pirate-destination'
  | 'payout'
  | 'price-rise'
  | 'game-over';

export interface GameState {
  readonly phase: GamePhase;
  /** 随机主种子，写进对局记录以便复现 */
  readonly seed: number;
  /** 取随机数的次数；与 seed 一起派生每次随机 */
  readonly rngCounter: number;
  /** 航程序号，从 1 开始 */
  readonly voyage: number;
  readonly players: readonly Player[];
  /** 尚未被买走的股份（港务长每航程可买 1 张） */
  readonly sharePool: readonly ShareCard[];
  readonly bidding: BiddingState | null;
  readonly harborMaster: PlayerId | null;
  /** 各货物在黑市价格轨上的下标 */
  readonly priceIndex: Readonly<Record<GoodId, number>>;
  readonly boats: readonly BoatState[];
  readonly placements: readonly Placement[];
  /** 本航程的步骤表（放置 / 移动；谈判与领航员在表走完后由 game.ts 接管） */
  readonly schedule: readonly VoyageStep[];
  readonly stepIndex: number;
  /** 当前放置回合内已放置过的玩家 */
  readonly actedThisRound: readonly PlayerId[];
  /** 本段航程已自我克制（不再放小弟）的玩家 */
  readonly declined: readonly PlayerId[];
  /** 本航程没装船的那种货 */
  readonly skippedGood: GoodId | null;
  readonly dice: readonly DiceRoll[] | null;
  /** 海盗船的船长（第一个占据海盗第一格的人），负责决定被劫掠船只去向 */
  readonly pirateCaptain: PlayerId | null;
  /** 待决定去向的被劫掠船只下标 */
  readonly piratePending: readonly number[];
  /** 停第 13 格、等海盗船长挑选登船目标的船只下标（仅第 1、2 轮使用） */
  readonly pirateBoardPending: readonly number[];
  /** 利润分配阶段已点「我看完了」的玩家；全员确认后才继续涨价/下一航程 */
  readonly payoutConfirmed: readonly PlayerId[];
  /** 领航员阶段：还没行动的领航员（先小后大） */
  readonly pilotPending: readonly PilotSize[];
  /** 本段航程已经转过账的玩家（每人每段航程只能主动转出一次） */
  readonly transferredThisVoyage: readonly PlayerId[];
  /** 谈判阶段已点「确认」的玩家；全员确认后才轮到领航员行动 */
  readonly negotiationConfirmed: readonly PlayerId[];
  /** 放船时各玩家现金快照，谈判界面用它显示「本轮金额变化」 */
  readonly roundStartCash: Readonly<Partial<Record<PlayerId, number>>>;
  /** 放船时的日志长度快照，谈判界面只回放本航程的操作 */
  readonly roundLogMark: number;
  readonly payout: PayoutReport | null;
  /** 面向玩家的中文事件日志 */
  readonly log: readonly string[];
  readonly winner: PlayerId | null;
}

// ---------------------------------------------------------------- 意图

export type Intent =
  | { readonly type: 'auction-bid'; readonly playerId: PlayerId; readonly amount: number }
  | { readonly type: 'auction-pass'; readonly playerId: PlayerId }
  | { readonly type: 'master-buy-share'; readonly playerId: PlayerId; readonly good: GoodId }
  | { readonly type: 'master-skip-share'; readonly playerId: PlayerId }
  | { readonly type: 'master-load'; readonly playerId: PlayerId; readonly laneAssignment: readonly GoodId[] }
  | { readonly type: 'master-launch'; readonly playerId: PlayerId; readonly positions: readonly number[] }
  | { readonly type: 'place'; readonly playerId: PlayerId; readonly spot: SpotRef }
  | { readonly type: 'decline-placement'; readonly playerId: PlayerId }
  | { readonly type: 'pilot-move'; readonly playerId: PlayerId; readonly moves: readonly PilotMove[] }
  | { readonly type: 'pilot-skip'; readonly playerId: PlayerId }
  | { readonly type: 'pirate-board'; readonly playerId: PlayerId; readonly boat: number }
  | { readonly type: 'payout-viewed'; readonly playerId: PlayerId }
  | {
      readonly type: 'transfer';
      readonly playerId: PlayerId;
      readonly toPlayerId: PlayerId;
      readonly amount: number;
    }
  | { readonly type: 'negotiation-done'; readonly playerId: PlayerId }
  | {
      readonly type: 'pirate-destination';
      readonly playerId: PlayerId;
      readonly boat: number;
      readonly destination: 'port' | 'shipyard';
    }
  | { readonly type: 'advance' };

export interface IntentError {
  readonly code: string;
  readonly message: string;
}

export type IntentOutcome =
  | { readonly ok: true; readonly state: GameState; readonly events: readonly BiddingEvent[] }
  | { readonly ok: false; readonly error: IntentError };

/** 五色玩家标识 */
const PLAYER_COLORS = ['#d9a441', '#4aa39a', '#c4614f', '#6f83c9', '#9a6fbd'] as const;

export interface CreateGameOptions {
  readonly playerCount: number;
  readonly names?: readonly string[];
  readonly seed?: number;
}

// ---------------------------------------------------------------- 建局

export function createGame(options: CreateGameOptions): GameState {
  const { playerCount } = options;
  if (!Number.isInteger(playerCount) || playerCount < MIN_PLAYERS || playerCount > MAX_PLAYERS) {
    throw new Error(`玩家人数必须在 ${MIN_PLAYERS}-${MAX_PLAYERS} 之间，收到 ${playerCount}`);
  }

  const seed = options.seed ?? 1;
  const rng = createRng(seed);
  const accomplices = ACCOMPLICES_BY_PLAYER_COUNT[playerCount] ?? 3;

  // 全部 20 张股份（每种 5 张）
  const allShares: ShareCard[] = [];
  for (const good of GOODS) {
    for (let copy = 0; copy < 5; copy += 1) {
      allShares.push({ id: `${good.id}-${copy + 1}`, good: good.id, mortgaged: false });
    }
  }

  // 规则：每种各拿 3 张（共 12 张）洗牌，每位玩家得 2 张；其余放在游戏台旁
  const dealDeck = shuffle(
    allShares.filter((s) => {
      const idx = Number(s.id.split('-')[1] ?? '0');
      return idx <= 3;
    }),
    rng,
  );

  const dealt: ShareCard[] = [];
  const hands: ShareCard[][] = Array.from({ length: playerCount }, () => []);
  for (const card of dealDeck) {
    const target = hands.find((h) => h.length < STARTING_SHARES);
    if (!target) break;
    target.push(card);
    dealt.push(card);
  }

  const dealtIds = new Set(dealt.map((c) => c.id));
  const sharePool = allShares.filter((c) => !dealtIds.has(c.id));

  const players: Player[] = hands.map((shares, i) => ({
    id: `p${i + 1}`,
    name: options.names?.[i]?.trim() || `玩家 ${i + 1}`,
    color: PLAYER_COLORS[i] ?? '#888888',
    cash: STARTING_CASH,
    shares,
    accomplicesTotal: accomplices,
  }));

  const priceIndex = Object.fromEntries(GOODS.map((g) => [g.id, 0])) as Record<GoodId, number>;

  return {
    phase: 'setup',
    seed,
    rngCounter: 0,
    voyage: 1,
    players,
    sharePool,
    bidding: null,
    harborMaster: null,
    priceIndex,
    boats: createBoats(),
    placements: [],
    schedule: [],
    stepIndex: 0,
    actedThisRound: [],
    declined: [],
    skippedGood: null,
    dice: null,
    pirateCaptain: null,
    piratePending: [],
    pirateBoardPending: [],
    payoutConfirmed: [],
    pilotPending: [],
    transferredThisVoyage: [],
    negotiationConfirmed: [],
    roundStartCash: {},
    roundLogMark: 0,
    payout: null,
    log: [
      `${playerCount} 人局开始，每人 ${STARTING_CASH} 元披索、${accomplices} 个小弟、${STARTING_SHARES} 张股份。`,
      ...(PRINTED_VALUES_PROVENANCE === 'placeholder'
        ? ['⚠ 棋盘印刷数值为推定占位值，结算结果不代表原版游戏（见 docs/design-v1.md §5）。']
        : []),
    ],
    winner: null,
  };
}

/** 开始一段航程的竞标 */
export function startVoyage(state: GameState): GameState {
  const order = state.players.map((p) => p.id);
  const incumbent = state.harborMaster;
  const starter = incumbent ?? order[0];
  if (starter === undefined) throw new Error('没有玩家，无法开始竞标');

  const bidding = createBidding(order, starter, incumbent);
  const starterName = findPlayer(state.players, starter)?.name ?? starter;

  return {
    ...state,
    phase: 'auction',
    bidding,
    boats: createBoats(),
    placements: [],
    schedule: [],
    stepIndex: 0,
    actedThisRound: [],
    declined: [],
    skippedGood: null,
    dice: null,
    pirateCaptain: null,
    piratePending: [],
    pirateBoardPending: [],
    payoutConfirmed: [],
    pilotPending: [],
    transferredThisVoyage: [],
    negotiationConfirmed: [],
    roundStartCash: {},
    roundLogMark: 0,
    payout: null,
    harborMaster: null,
    log: [
      ...state.log,
      `── 第 ${state.voyage} 段航程 ──`,
      `竞标港务长办事处，由 ${starterName} 起叫，起拍价 1 元。`,
    ],
  };
}

/** 货物当前单价（股份价值） */
export function sharePrice(state: GameState, good: GoodId): number {
  return Math.max(MIN_SHARE_PRICE, PRICE_TRACK[state.priceIndex[good] ?? 0] ?? MIN_SHARE_PRICE);
}

export function playerCreditLimit(player: Player): number {
  return player.cash + player.shares.filter((s) => !s.mortgaged).length * 12;
}

/** 玩家总财富：现金 + 股份价值 − 每张抵押股份 15 元 */
export function wealthOf(state: GameState, player: Player): number {
  const sharesValue = player.shares.reduce((sum, s) => sum + sharePrice(state, s.good), 0);
  const mortgaged = player.shares.filter((s) => s.mortgaged).length;
  return player.cash + sharesValue - mortgaged * 15;
}

// ---------------------------------------------------------------- 查询helper（供 UI 用）

export function placementContext(state: GameState): PlacementContext {
  return { boats: state.boats, placements: state.placements, players: state.players };
}

/** 当前该放小弟的玩家；本回合所有人都放完了则返回 null */
export function currentPlacementPlayer(state: GameState): PlayerId | null {
  if (state.phase !== 'placement') return null;
  const master = state.harborMaster;
  if (!master) return null;
  const ctx = placementContext(state);

  for (const id of placementOrder(state.players, master, state.declined)) {
    if (state.actedThisRound.includes(id)) continue;
    const player = findPlayer(state.players, id);
    if (!player) continue;
    if (placedCount(ctx, id) >= player.accomplicesTotal) continue;
    return id;
  }
  return null;
}

/** 当前该行动的领航员持有者 */
export function currentPilot(state: GameState): { size: PilotSize; playerId: PlayerId } | null {
  if (state.phase !== 'pilot') return null;
  for (let i = 0; i < state.pilotPending.length; i += 1) {
    const size = state.pilotPending[i];
    if (!size) continue;
    const holder = state.placements.find((p) => p.spot.kind === 'pilot' && p.spot.size === size);
    if (holder) return { size, playerId: holder.playerId };
  }
  return null;
}

/** 当前该决定被劫掠船只去向的海盗船长 */
export function currentPirateDecider(state: GameState): PlayerId | null {
  if (state.phase !== 'pirate-destination') return null;
  return state.pirateCaptain;
}

/** 有效的最低出价（竞标阶段） */
export function currentAuctionPlayer(state: GameState): PlayerId | null {
  if (state.phase !== 'auction' || !state.bidding) return null;
  if (state.bidding.status !== 'open') return null;
  return state.bidding.order[state.bidding.cursor] ?? null;
}

/**
 * 需要指定玩家做决定的阶段里，当前该行动的人；
 * 推进类阶段（movement / price-rise / game-over / setup）与并发自助阶段
 * （negotiation、payout —— 每人各自确认，无顺序）返回 null。
 * 联机模式下服务端校验与客户端 UI 门控共用这一份真源。
 */
export function currentDecisionActor(state: GameState): PlayerId | null {
  switch (state.phase) {
    case 'auction':
      return currentAuctionPlayer(state);
    case 'buy-share':
    case 'load':
    case 'launch':
      return state.harborMaster;
    case 'placement':
      return currentPlacementPlayer(state);
    case 'pilot':
      return currentPilot(state)?.playerId ?? null;
    case 'pirate-boarding':
    case 'pirate-destination':
      return state.pirateCaptain;
    default:
      return null;
  }
}

// ---------------------------------------------------------------- 随机

function nextRng(state: GameState): { rng: ReturnType<typeof createRng>; counter: number } {
  const counter = state.rngCounter + 1;
  return { rng: createRng(splitSeed(state.seed, counter)), counter };
}

// ---------------------------------------------------------------- 意图分发

export function applyIntent(state: GameState, intent: Intent): IntentOutcome {
  switch (state.phase) {
    case 'auction':
      return handleAuction(state, intent);
    case 'buy-share':
      return handleBuyShare(state, intent);
    case 'load':
      return handleLoad(state, intent);
    case 'launch':
      return handleLaunch(state, intent);
    case 'placement':
      return handlePlacement(state, intent);
    case 'movement':
      return handleMovementAdvance(state, intent);
    case 'pirate-boarding':
      return handlePirateBoarding(state, intent);
    case 'negotiation':
      return handleNegotiation(state, intent);
    case 'pilot':
      return handlePilot(state, intent);
    case 'pirate-destination':
      return handlePirateDestination(state, intent);
    case 'payout':
      return handlePayout(state, intent);
    case 'price-rise':
      return handlePriceRiseAdvance(state, intent);
    default:
      return err('wrong-phase', `当前阶段（${state.phase}）不接受任何操作。`);
  }
}

function err(code: string, message: string): IntentOutcome {
  return { ok: false, error: { code, message } };
}

function okState(state: GameState, events: readonly BiddingEvent[] = []): IntentOutcome {
  return { ok: true, state, events };
}

function withLog(state: GameState, lines: readonly string[]): GameState {
  if (lines.length === 0) return state;
  return { ...state, log: [...state.log, ...lines] };
}

// ---------------------------------------------------------------- 竞标

function handleAuction(state: GameState, intent: Intent): IntentOutcome {
  if (!state.bidding) return err('wrong-phase', '竞标尚未开始。');
  if (intent.type !== 'auction-bid' && intent.type !== 'auction-pass') {
    return err('wrong-intent', '竞标阶段只能出价或过牌。');
  }

  const action: BiddingAction =
    intent.type === 'auction-bid'
      ? { type: 'bid', playerId: intent.playerId, amount: intent.amount }
      : { type: 'pass', playerId: intent.playerId };

  const outcome = applyBiddingAction(state.bidding, state.players, action);
  if (!outcome.ok) return err(outcome.error.code, outcome.error.message);

  let next: GameState = {
    ...state,
    bidding: outcome.state,
    log: [...state.log, ...outcome.events.map((e) => describeEvent(state, e))],
  };

  if (outcome.state.status === 'open') return okState(next, outcome.events);

  // 竞标结算：得标者付款，成为港务长
  const winner = outcome.state.winner;
  if (winner && outcome.state.paid > 0) {
    const idx = next.players.findIndex((p) => p.id === winner);
    const payer = next.players[idx];
    if (payer) {
      const paid = payToBank(payer, outcome.state.paid, (g) => sharePrice(next, g));
      const players = [...next.players];
      players[idx] = paid.player;
      next = { ...next, players };
      if (paid.note) next = withLog(next, [paid.note]);
    }
  }

  const masterName = winner ? (findPlayer(next.players, winner)?.name ?? winner) : '（无）';
  next = withLog(next, [`${masterName} 就任第 ${state.voyage} 段航程的港务长。`]);
  return okState({ ...next, phase: 'buy-share', harborMaster: winner }, outcome.events);
}

function describeEvent(state: GameState, event: BiddingEvent): string {
  const name = (id: PlayerId): string => findPlayer(state.players, id)?.name ?? id;
  switch (event.type) {
    case 'bid':
      return `${name(event.playerId)} 出价 ${event.amount} 元。`;
    case 'pass':
      return `${name(event.playerId)} 过牌，退出本段航程竞标。`;
    case 'won':
      return `${name(event.playerId)} 以 ${event.amount} 元得标。`;
    case 'incumbent-holds':
      return `无人出价，${name(event.playerId)} 连任港务长。`;
    case 'no-bid-default':
      return `无人出价且无在任者，起叫者 ${name(event.playerId)} 以 0 元接任港务长。`;
  }
}

// ---------------------------------------------------------------- 港务长：买股份

function handleBuyShare(state: GameState, intent: Intent): IntentOutcome {
  const master = state.harborMaster;
  if (!master) return err('no-master', '没有港务长。');
  if (intent.type !== 'master-buy-share' && intent.type !== 'master-skip-share') {
    return err('wrong-intent', '现在只能买股份或跳过。');
  }
  if (intent.playerId !== master) return err('not-your-turn', '只有港务长可以买股份。');

  if (intent.type === 'master-skip-share') {
    return okState(withLog({ ...state, phase: 'load' }, ['港务长放弃购买股份。']));
  }

  const player = findPlayer(state.players, master);
  if (!player) return err('unknown-player', '找不到港务长。');

  const cardIndex = state.sharePool.findIndex((c) => c.good === intent.good);
  if (cardIndex < 0) return err('no-share', `钱箱里已经没有「${intent.good}」的股份了。`);

  const cost = sharePriceAt(state.priceIndex[intent.good] ?? 0);
  const affordable = playerCreditLimit(player) >= cost;
  if (!affordable) {
    return err('cannot-afford', `股份要 ${cost} 元，现金加可贷款额度不足。`);
  }

  const card = state.sharePool[cardIndex];
  if (!card) return err('no-share', '股份不存在。');

  const paid = payToBank(player, cost, (g) => sharePrice(state, g));
  const players = state.players.map((p) =>
    p.id === master ? { ...paid.player, shares: [...paid.player.shares, card] } : p,
  );
  const pool = state.sharePool.filter((_, i) => i !== cardIndex);

  let next: GameState = {
    ...state,
    phase: 'load',
    players,
    sharePool: pool,
    log: [
      ...state.log,
      `港务长 ${player.name} 以 ${cost} 元买入 1 张股份（种类保密）。`,
    ],
  };
  if (paid.note) next = withLog(next, [paid.note]);
  return okState(next);
}

function goodLabel(good: GoodId): string {
  return GOODS.find((g) => g.id === good)?.name ?? good;
}

// ---------------------------------------------------------------- 港务长：装货

function handleLoad(state: GameState, intent: Intent): IntentOutcome {
  const master = state.harborMaster;
  if (!master) return err('no-master', '没有港务长。');
  if (intent.type !== 'master-load') return err('wrong-intent', '现在只能装货。');
  if (intent.playerId !== master) return err('not-your-turn', '只有港务长可以装货。');

  const check = validateLoad(intent.laneAssignment);
  if (!check.ok) return err('invalid-load', check.message);

  const boats: BoatState[] = state.boats.map((boat, lane) => ({
    ...boat,
    good: intent.laneAssignment[lane] ?? null,
    position: 0,
    arrivedSlot: null,
    shipyardSlot: null,
    plundered: false,
  }));

  const skipped = skippedGoodOf(intent.laneAssignment);
  const lines = intent.laneAssignment.map(
    (good, lane) => `第 ${lane + 1} 航道装上「${goodLabel(good)}」。`,
  );
  if (skipped) lines.push(`本航程不装载「${goodLabel(skipped)}」。`);

  return okState(
    withLog({ ...state, phase: 'launch', boats, skippedGood: skipped }, lines),
  );
}

// ---------------------------------------------------------------- 港务长：放船

function handleLaunch(state: GameState, intent: Intent): IntentOutcome {
  const master = state.harborMaster;
  if (!master) return err('no-master', '没有港务长。');
  if (intent.type !== 'master-launch') return err('wrong-intent', '现在只能放船。');
  if (intent.playerId !== master) return err('not-your-turn', '只有港务长可以放船。');

  const check = validateLaunch(intent.positions);
  if (!check.ok) return err('invalid-launch', check.message);

  const boats = state.boats.map((boat, lane) => ({ ...boat, position: intent.positions[lane] ?? 0 }));
  const lines = [
    `平底船入海：${intent.positions.map((p, i) => `第 ${i + 1} 航道从第 ${p} 格`).join('、')}。（起点之和 ${intent.positions.reduce((a, b) => a + b, 0)}）`,
  ];

  const schedule = voyageSchedule(state.players.length);
  const logLines = [...state.log, ...lines];
  const next: GameState = {
    ...state,
    boats,
    schedule,
    stepIndex: 0,
    actedThisRound: [],
    declined: [],
    pilotPending: [],
    transferredThisVoyage: [],
    negotiationConfirmed: [],
    roundStartCash: Object.fromEntries(state.players.map((p) => [p.id, p.cash])),
    roundLogMark: logLines.length,
    log: logLines,
  };
  return okState(enterStep(next));
}

// ---------------------------------------------------------------- 步骤推进

/**
 * 进入当前 stepIndex 指向的步骤。
 * - placement：等待玩家逐个放小弟
 * - movement：立即掷骰 + 推船 + 处理海盗触发，然后等待「继续」
 * 步骤表走完（第三次投骰结束）→ 谈判阶段，之后才是领航员与结算。
 */
function enterStep(state: GameState): GameState {
  const step = state.schedule[state.stepIndex];

  if (step === undefined) {
    return startNegotiation(state);
  }

  switch (step) {
    case 'placement': {
      const entered = withLog({ ...state, phase: 'placement', actedThisRound: [] }, [
        `放置小弟（第 ${state.schedule.slice(0, state.stepIndex + 1).filter((s) => s === 'placement').length} 轮）。`,
      ]);
      // 所有人都已自我克制 / 用完小弟 → 这一轮无人可行动，直接越过，避免卡在放置盘上
      if (currentPlacementPlayer(entered) === null) {
        return enterStep({ ...entered, stepIndex: state.stepIndex + 1 });
      }
      return entered;
    }

    case 'movement':
      return runMovement(state);
  }
}

/** 掷骰、推船、处理海盗触发 */
function runMovement(state: GameState): GameState {
  const { rng, counter } = nextRng(state);
  const dice = rollDice(state.boats, rng);
  const round = state.schedule.slice(0, state.stepIndex + 1).filter((s) => s === 'movement').length;

  const diceLine = `第 ${round} 次移动：掷骰 ${dice.map((d) => `${goodLabel(d.good)} ${d.pips}`).join('、')}。`;
  const moved = advanceBoats(state.boats, dice);

  let next: GameState = {
    ...state,
    phase: 'movement',
    rngCounter: counter,
    dice,
    boats: moved.boats,
    log: [...state.log, diceLine, ...moved.notes],
  };

  // 海盗触发：移动回合结束时恰好停在第 13 格的船。
  // 第 1、2 轮登船（多艘候选时由海盗船长挑一艘，全船海盗跳上它的甲板）；
  // 第 3 轮再登船已无意义，直接劫掠。
  const onThirteen = boatsOnThirteen(next.boats);
  if (onThirteen.length > 0 && hasPirate(next.placements)) {
    if (round >= 3) {
      for (const boatIndex of onThirteen) {
        const result = plunderBoat(next.boats, boatIndex);
        next = withLog({ ...next, boats: result.boats }, result.notes);
      }
    } else if (onThirteen.length === 1) {
      const result = boardPirates(next.boats, next.placements, onThirteen[0] ?? 0);
      next = withLog({ ...next, boats: result.boats, placements: result.placements }, result.notes);
    } else {
      next = withLog({ ...next, phase: 'pirate-boarding', pirateBoardPending: onThirteen }, [
        `有 ${onThirteen.length} 艘船停在第 13 格，等海盗船长选择登上哪一艘。`,
      ]);
    }
  } else if (onThirteen.length > 0) {
    next = withLog(next, ['有船停在第 13 格，但海盗船上没有人。']);
  }

  return next;
}

function handleMovementAdvance(state: GameState, intent: Intent): IntentOutcome {
  if (intent.type !== 'advance') return err('wrong-intent', '移动阶段只能点「继续」。');
  return okState(enterStep({ ...state, stepIndex: state.stepIndex + 1 }));
}

// ---------------------------------------------------------------- 海盗选择登船

function handlePirateBoarding(state: GameState, intent: Intent): IntentOutcome {
  if (intent.type !== 'pirate-board') return err('wrong-intent', '海盗船长需要选择登上哪艘船。');
  const captain = state.pirateCaptain ?? piratesInOrder(state.placements)[0]?.playerId ?? null;
  if (!captain) return err('no-captain', '没有海盗船长。');
  if (intent.playerId !== captain) {
    return err('not-your-turn', '只有海盗船长可以选择登船目标。');
  }
  if (!state.pirateBoardPending.includes(intent.boat)) {
    return err('not-pending', '这艘船不在登船候选里。');
  }

  const result = boardPirates(state.boats, state.placements, intent.boat);
  const next: GameState = {
    ...state,
    boats: result.boats,
    placements: result.placements,
    pirateBoardPending: [],
    phase: 'movement',
    log: [...state.log, ...result.notes],
  };
  return okState(next);
}

// ---------------------------------------------------------------- 放置小弟

function handlePlacement(state: GameState, intent: Intent): IntentOutcome {
  if (intent.type !== 'place' && intent.type !== 'decline-placement') {
    return err('wrong-intent', '放置阶段只能放小弟或自我克制。');
  }

  const expected = currentPlacementPlayer(state);
  if (expected !== intent.playerId) {
    const name = expected ? (findPlayer(state.players, expected)?.name ?? expected) : '（无人）';
    return err('not-your-turn', `现在轮到 ${name}。`);
  }

  if (intent.type === 'decline-placement') {
    const player = findPlayer(state.players, intent.playerId);
    let next = withLog(
      {
        ...state,
        declined: [...state.declined, intent.playerId],
        actedThisRound: [...state.actedThisRound, intent.playerId],
      },
      [`${player?.name ?? intent.playerId} 自我克制，本段航程不再放置小弟。`],
    );
    next = maybeAdvancePlacement(next);
    return okState(next);
  }

  const ctx = placementContext(state);
  const outcome = applyPlacement(ctx, intent.playerId, intent.spot);
  if (!outcome.ok) return err(outcome.error.code, outcome.error.message);

  const placement = outcome.placement;
  const player = findPlayer(state.players, intent.playerId);
  const lines = [...outcome.notes];

  // 付放置费；保险处反而立即拿钱
  let players = state.players;
  if (player) {
    if (placement.spot.kind === 'insurance') {
      players = state.players.map((p) =>
        p.id === player.id ? { ...p, cash: p.cash + 10 } : p,
      );
      lines.push(`${player.name} 担任保险仲介者，立即从钱箱取得 10 元。`);
    } else if (placement.cost > 0) {
      lines.push(`${player.name} 付出放置费 ${placement.cost} 元。`);
    }
  }

  const isCaptainSeat = placement.spot.kind === 'pirate' && placement.spot.space === 0;
  const pirateCaptain = isCaptainSeat ? player?.id ?? state.pirateCaptain : state.pirateCaptain;

  let next: GameState = {
    ...state,
    players,
    placements: [...state.placements, placement],
    actedThisRound: [...state.actedThisRound, intent.playerId],
    pirateCaptain,
    log: [...state.log, ...lines],
  };

  next = maybeAdvancePlacement(next);
  return okState(next);
}

/** 本回合所有人都放完了（或自我克制了）就进入下一步骤 */
function maybeAdvancePlacement(state: GameState): GameState {
  if (currentPlacementPlayer(state) !== null) return state;
  return enterStep({ ...state, stepIndex: state.stepIndex + 1 });
}

// ---------------------------------------------------------------- 谈判与转账

/** 第三次投骰结束、领航员行动之前：所有人有一次转账窗口（私下谈判的落地形式） */
function startNegotiation(state: GameState): GameState {
  return withLog(
    { ...state, phase: 'negotiation', negotiationConfirmed: [], pilotPending: [] },
    ['── 谈判阶段 ──', '三次投骰结束。每人本段航程可转账一次，全员确认后由领航员行动。'],
  );
}

function handleNegotiation(state: GameState, intent: Intent): IntentOutcome {
  if (intent.type === 'transfer') {
    if (state.transferredThisVoyage.includes(intent.playerId)) {
      return err('already-transferred', '你本段航程已经转过一次账了。');
    }
    const from = findPlayer(state.players, intent.playerId);
    const to = findPlayer(state.players, intent.toPlayerId);
    if (!from || !to) return err('unknown-player', '找不到转账的双方。');
    if (from.id === to.id) return err('self-transfer', '不能转给自己。');
    if (!Number.isInteger(intent.amount) || intent.amount < 1) {
      return err('bad-amount', '转账金额必须是至少 1 元的整数。');
    }
    if (intent.amount > from.cash) {
      return err('cannot-afford', `现金只有 ${from.cash} 元，转不出 ${intent.amount} 元。`);
    }

    const players = state.players.map((p) =>
      p.id === from.id
        ? { ...p, cash: p.cash - intent.amount }
        : p.id === to.id
          ? { ...p, cash: p.cash + intent.amount }
          : p,
    );
    return okState({
      ...state,
      players,
      transferredThisVoyage: [...state.transferredThisVoyage, from.id],
      log: [...state.log, `${from.name} 转账 ${intent.amount} 元给 ${to.name}。`],
    });
  }

  if (intent.type === 'negotiation-done') {
    const player = findPlayer(state.players, intent.playerId);
    if (!player) return err('unknown-player', '找不到玩家。');
    if (state.negotiationConfirmed.includes(player.id)) {
      return err('already-confirmed', '你已经确认过了。');
    }
    const confirmed = [...state.negotiationConfirmed, player.id];
    const next = { ...state, negotiationConfirmed: confirmed };
    if (state.players.some((p) => !confirmed.includes(p.id))) return okState(next);
    return okState(startPilotPhase(next));
  }

  return err('wrong-intent', '谈判阶段只能转账或确认结束谈判。');
}

/** 全员确认谈判后：有领航员则先小后大依次行动，否则直接进结算链 */
function startPilotPhase(state: GameState): GameState {
  const pending: PilotSize[] = [];
  for (const size of ['small', 'large'] as const) {
    if (state.placements.some((p) => p.spot.kind === 'pilot' && p.spot.size === size)) {
      pending.push(size);
    }
  }
  if (pending.length === 0) return finishVoyage({ ...state, pilotPending: [] });
  return withLog({ ...state, phase: 'pilot', pilotPending: pending }, [
    '领航员阶段：按先小后大的顺序行动。',
  ]);
}

// ---------------------------------------------------------------- 领航员

function handlePilot(state: GameState, intent: Intent): IntentOutcome {
  if (intent.type !== 'pilot-move' && intent.type !== 'pilot-skip') {
    return err('wrong-intent', '领航员阶段只能移动船只或放弃。');
  }

  const current = currentPilot(state);
  if (!current) {
    // 领航员位子没人担任 → 直接结算
    return okState(finishVoyage({ ...state, pilotPending: [] }));
  }
  if (intent.playerId !== current.playerId) {
    const name = findPlayer(state.players, current.playerId)?.name ?? current.playerId;
    return err('not-your-turn', `现在轮到 ${name} 的领航员。`);
  }

  const lines: string[] = [];
  let boats = state.boats;

  if (intent.type === 'pilot-move') {
    const check = validatePilotMoves(current.size, intent.moves, state.boats);
    if (!check.ok) return err('invalid-pilot', check.message);
    if (intent.moves.length > 0) {
      const result = applyPilotMoves(state.boats, intent.moves);
      boats = result.boats;
      lines.push(...result.notes);
    } else {
      lines.push('领航员放弃了他的影响力。');
    }
  } else {
    lines.push('领航员放弃了他的影响力。');
  }

  const remaining = state.pilotPending.filter((s) => s !== current.size);
  const next: GameState = { ...state, boats, pilotPending: remaining, log: [...state.log, ...lines] };

  if (currentPilot(next) === null) {
    return okState(finishVoyage({ ...next, pilotPending: [] }));
  }
  return okState(next);
}

/**
 * 领航员影响力的合法性（本作规则，房主定案）：
 * 每艘还在海上的船都可以被他移动一次，小领航员每艘 ±1 格、大领航员每艘 ±2 格。
 */
export function validatePilotMoves(
  size: PilotSize,
  moves: readonly PilotMove[],
  boats: readonly BoatState[],
): { ok: true } | { ok: false; message: string } {
  if (moves.some((m) => !boats[m.boat])) return fail('目标船只不存在。');
  if (moves.some((m) => boats[m.boat]?.arrivedSlot !== null || boats[m.boat]?.shipyardSlot !== null)) {
    return fail('领航员无法影响已经抵达或已进船厂的平底船。');
  }
  if (moves.some((m) => !Number.isInteger(m.delta))) return fail('移动格数必须是整数。');

  const seen = new Set<number>();
  for (const m of moves) {
    if (seen.has(m.boat)) return fail('每艘船只能被领航员移动一次。');
    seen.add(m.boat);
  }

  const max = size === 'small' ? 1 : 2;
  if (moves.some((m) => Math.abs(m.delta) > max)) {
    return fail(
      `${size === 'small' ? '小' : '大'}领航员每艘船最多移动 ${max} 格。`,
    );
  }
  return ok();
}

// ---------------------------------------------------------------- 海盗去向

function handlePirateDestination(state: GameState, intent: Intent): IntentOutcome {
  if (intent.type !== 'pirate-destination') return err('wrong-intent', '海盗船长需要为被劫掠的船决定去向。');
  if (!state.pirateCaptain) return err('no-captain', '没有海盗船长。');
  if (intent.playerId !== state.pirateCaptain) {
    return err('not-your-turn', '只有海盗船长可以决定被劫掠船只的去向。');
  }
  if (!state.piratePending.includes(intent.boat)) {
    return err('not-pending', '这艘船不需要决定去向。');
  }

  const boat = state.boats[intent.boat];
  if (!boat) return err('unknown-boat', '找不到这艘船。');

  let slot: number | null;
  let boats: BoatState[];
  if (intent.destination === 'port') {
    slot = nextFreePortSlot(state.boats);
    if (slot === null) return err('no-slot', '港口空格已满。');
    boats = state.boats.map((b, i) => (i === intent.boat ? { ...b, arrivedSlot: slot } : b));
  } else {
    slot = nextFreeShipyardSlot(state.boats);
    if (slot === null) return err('no-slot', '修船场空格已满。');
    boats = state.boats.map((b, i) => (i === intent.boat ? { ...b, shipyardSlot: slot } : b));
  }

  const letter = 'ABC'[slot] ?? '?';
  const lines = [
    `海盗船长把第 ${boat.lane + 1} 航道的被劫掠船只送往${
      intent.destination === 'port' ? `港口空格 ${letter}（该货物涨价）` : `修船场空格 ${letter}`
    }。`,
  ];

  const pending = state.piratePending.filter((b) => b !== intent.boat);
  let next: GameState = { ...state, boats, piratePending: pending, log: [...state.log, ...lines] };

  if (pending.length === 0) next = beginPayout(next);
  return okState(next);
}

// ---------------------------------------------------------------- 航程收尾

/** 最后一步移动之后：船难判定 → 海盗去向 → 结算 */
function finishVoyage(state: GameState): GameState {
  const resolved = resolveEndOfVoyage(state.boats, state.placements);
  let next = withLog({ ...state, boats: resolved.boats }, resolved.notes);

  const pending: number[] = [];
  next.boats.forEach((boat, i) => {
    if (boat.plundered && boat.arrivedSlot === null && boat.shipyardSlot === null) pending.push(i);
  });

  if (pending.length > 0) {
    const captainName = next.pirateCaptain
      ? (findPlayer(next.players, next.pirateCaptain)?.name ?? next.pirateCaptain)
      : '（无人）';
    next = withLog({ ...next, phase: 'pirate-destination', piratePending: pending }, [
      `被劫掠的船只需决定去向，由海盗船长 ${captainName} 决定。`,
    ]);
    return next;
  }

  return beginPayout(next);
}

function beginPayout(state: GameState): GameState {
  const { players, report } = settleVoyage({
    boats: state.boats,
    placements: state.placements,
    players: state.players,
    priceOf: (good) => sharePrice(state, good),
    nameOf: (id) => findPlayer(state.players, id)?.name ?? id,
  });

  return withLog(
    { ...state, phase: 'payout', players, payout: report, piratePending: [], payoutConfirmed: [] },
    ['── 利润分配 ──', ...report.notes],
  );
}

/** 利润分配是并发自助阶段：每人看完本回合收益后各自确认，全员确认才继续 */
function handlePayout(state: GameState, intent: Intent): IntentOutcome {
  if (intent.type !== 'payout-viewed') {
    return err('wrong-intent', '利润分配阶段每位玩家看完后点「我看完了」。');
  }
  const player = findPlayer(state.players, intent.playerId);
  if (!player) return err('unknown-player', '找不到玩家。');
  if (state.payoutConfirmed.includes(player.id)) {
    return err('already-confirmed', '你已经确认看完了。');
  }
  const confirmed = [...state.payoutConfirmed, player.id];
  const next = { ...state, payoutConfirmed: confirmed };
  if (state.players.some((p) => !confirmed.includes(p.id))) return okState(next);
  return okState(advanceAfterPayout(next));
}

function advanceAfterPayout(state: GameState): GameState {
  const arrived = state.payout?.goodArrived ?? [];

  const priceIndex = { ...state.priceIndex };
  const lines: string[] = [];
  for (const good of new Set(arrived)) {
    const current = priceIndex[good] ?? 0;
    const nextIndex = Math.min(current + 1, PRICE_TRACK.length - 1);
    priceIndex[good] = nextIndex;
    lines.push(
      `「${goodLabel(good)}」价格上升到 ${PRICE_TRACK[nextIndex] ?? 0} 元。`,
    );
  }
  if (arrived.length === 0) lines.push('本航程没有货物抵达港口，价格不变。');

  return withLog({ ...state, phase: 'price-rise', priceIndex }, ['── 货物价格上升 ──', ...lines]);
}

function handlePriceRiseAdvance(state: GameState, intent: Intent): IntentOutcome {
  if (intent.type !== 'advance') return err('wrong-intent', '涨价阶段只能点「继续」。');

  const reachEnd = GOODS.some(
    (g) => (PRICE_TRACK[state.priceIndex[g.id] ?? 0] ?? 0) >= GAME_END_PRICE,
  );

  if (reachEnd) {
    const ranked = [...state.players].sort((a, b) => wealthOf(state, b) - wealthOf(state, a));
    const winner = ranked[0]?.id ?? null;
    const lines = [
      '── 游戏结束 ──',
      '有货物价格达到 30 元，游戏结束。',
      ...ranked.map(
        (p, i) => `第 ${i + 1} 名：${p.name}，财富 ${wealthOf(state, p)} 元（现金 ${p.cash}）。`,
      ),
      winner ? `${findPlayer(state.players, winner)?.name ?? winner} 成为马尼拉最成功的商人。` : '',
    ].filter((l) => l.length > 0);
    return okState(withLog({ ...state, phase: 'game-over', winner }, lines));
  }

  const nextVoyage: GameState = {
    ...state,
    voyage: state.voyage + 1,
    log: [...state.log, '── 本段航程结束，回收所有小弟与平底船 ──'],
  };
  return okState(startVoyage(nextVoyage));
}

/** 供 UI 显示：当前航程第几次移动 */
export function movementRoundOf(state: GameState): number {
  return state.schedule.slice(0, state.stepIndex + 1).filter((s) => s === 'movement').length;
}

/** 供 UI 显示：航道终点常量 */
export const LAST_SPACE = LANE_LAST_SPACE;

/** 供 UI 显示：某船货仓最低空位 */
export function cheapestHoldSpace(state: GameState, boatIndex: number): number | null {
  return cheapestEmptyHoldSpace(placementContext(state), boatIndex);
}

/** 供 UI 显示：海盗船长 */
export function pirateCaptainOf(state: GameState): PlayerId | null {
  return state.pirateCaptain;
}

/** 供 UI 显示：海盗顺序（用于展示） */
export function pirateOrder(state: GameState): readonly Placement[] {
  return piratesInOrder(state.placements);
}

/** 某格位是否已被占用 */
export function isSpotTaken(state: GameState, spot: SpotRef): boolean {
  return state.placements.some((p) => spotKey(p.spot) === spotKey(spot));
}

export { skippedGoodOf };
