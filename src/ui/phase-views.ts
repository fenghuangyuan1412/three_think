/**
 * 各阶段的界面区块。
 *
 * 属于 ui/ 层（agent.md §3）：**不做任何规则判定**，只把 core 算好的合法选项列出来，
 * 并把点击翻译成 Intent。合法性最终由 core 裁决 —— 这里的禁用只是体验优化。
 */
import {
  GOODS,
  PRICE_TRACK,
  printedValuesWarning,
} from '../config/board-layout';
import { creditLimit, minLegalBid } from '../core/bidding';
import type { PilotMove } from '../core/movement';
import {
  currentAuctionPlayer,
  currentPilot,
  currentPirateDecider,
  currentPlacementPlayer,
  movementRoundOf,
  placementContext,
  sharePrice,
  wealthOf,
  type GameState,
  type Intent,
} from '../core/game';
import { availableSpots, mustBeBlind, previewSpot } from '../core/placement';
import type { GoodId, PlayerId } from '../core/types';
import { spotLabel, type SpotRef } from '../core/voyage';

export interface PhaseViewContext {
  readonly state: GameState;
  readonly emit: (intent: Intent) => void;
  readonly error: string | null;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(text: string, className: string, onClick: () => void): HTMLButtonElement {
  const btn = el('button', className, text);
  btn.type = 'button';
  btn.addEventListener('click', onClick);
  return btn;
}

function section(title: string): HTMLElement {
  const wrap = el('section', 'phase-section');
  if (title) wrap.appendChild(el('h3', 'section-title', title));
  return wrap;
}

function playerName(state: GameState, id: PlayerId | null): string {
  if (!id) return '（无人）';
  return state.players.find((p) => p.id === id)?.name ?? id;
}

function goodName(good: GoodId): string {
  return GOODS.find((g) => g.id === good)?.name ?? good;
}

function spotText(state: GameState, spot: SpotRef): string {
  return spotLabel(
    spot,
    goodName,
    (b) => state.boats[b]?.good ?? null,
  );
}

// ---------------------------------------------------------------- 总入口

export function renderPhaseView(ctx: PhaseViewContext): HTMLElement {
  const wrap = el('div', 'phase-view');
  const { state } = ctx;

  switch (state.phase) {
    case 'auction':
      wrap.appendChild(auctionView(ctx));
      break;
    case 'buy-share':
      wrap.appendChild(buyShareView(ctx));
      break;
    case 'load':
      wrap.appendChild(loadView(ctx));
      break;
    case 'launch':
      wrap.appendChild(launchView(ctx));
      break;
    case 'placement':
      wrap.appendChild(placementView(ctx));
      break;
    case 'movement':
      wrap.appendChild(movementView(ctx));
      break;
    case 'pilot':
      wrap.appendChild(pilotView(ctx));
      break;
    case 'pirate-destination':
      wrap.appendChild(pirateView(ctx));
      break;
    case 'payout':
      wrap.appendChild(payoutView(ctx));
      break;
    case 'price-rise':
      wrap.appendChild(priceRiseView(ctx));
      break;
    case 'game-over':
      wrap.appendChild(gameOverView(ctx));
      break;
    default:
      wrap.appendChild(el('p', 'hint', '准备中…'));
  }

  const warning = printedValuesWarning();
  if (warning && state.phase !== 'game-over') {
    wrap.insertBefore(el('p', 'warning', `⚠ ${warning}`), wrap.firstChild);
  }

  if (ctx.error) wrap.appendChild(el('p', 'auction__error', ctx.error));
  return wrap;
}

// ---------------------------------------------------------------- 竞标

function auctionView(ctx: PhaseViewContext): HTMLElement {
  const { state, emit } = ctx;
  const bidding = state.bidding;
  const box = section('竞标港务长办事处');
  if (!bidding) return box;

  const who = currentAuctionPlayer(state);
  const high = el('p', 'kv');
  high.append(el('span', 'kv__k', '当前最高价'));
  high.append(
    el(
      'strong',
      'kv__v',
      bidding.highBidder === null
        ? '尚无人出价'
        : `${bidding.highBid} 元（${playerName(state, bidding.highBidder)}）`,
    ),
  );
  box.appendChild(high);

  const turn = el('p', 'kv');
  turn.append(el('span', 'kv__k', '轮到'));
  turn.append(el('strong', 'kv__v kv__v--gold', playerName(state, who)));
  box.appendChild(turn);

  const player = who ? state.players.find((p) => p.id === who) : undefined;
  const min = minLegalBid(bidding);
  const max = player ? creditLimit(player) : 0;

  const row = el('div', 'row');
  const input = el('input', 'num');
  input.type = 'number';
  input.min = String(min);
  input.max = String(max);
  input.value = String(Math.min(Math.max(min, bidding.highBid + 1), Math.max(max, min)));
  row.appendChild(input);
  row.appendChild(button('+1', 'btn btn--sm', () => {
    input.value = String(Number(input.value) + 1);
  }));
  row.appendChild(button('+5', 'btn btn--sm', () => {
    input.value = String(Number(input.value) + 5);
  }));
  box.appendChild(row);

  const actions = el('div', 'row row--split');
  actions.appendChild(
    button('出价', 'btn btn--primary', () => {
      if (who) emit({ type: 'auction-bid', playerId: who, amount: Number(input.value) });
    }),
  );
  actions.appendChild(
    button('过牌', 'btn', () => {
      if (who) emit({ type: 'auction-pass', playerId: who });
    }),
  );
  box.appendChild(actions);

  box.appendChild(
    el('p', 'hint', `最低 ${min} 元，最高 ${max} 元。过牌后本段航程不能再出价。`),
  );
  return box;
}

// ---------------------------------------------------------------- 买股份

function buyShareView(ctx: PhaseViewContext): HTMLElement {
  const { state, emit } = ctx;
  const master = state.harborMaster;
  const box = section(`港务长 ${playerName(state, master)} 的办事处 · 买股份`);

  if (!master) return box;

  const player = state.players.find((p) => p.id === master);
  const pool = [...new Set(state.sharePool.map((c) => c.good))];

  const list = el('div', 'spot-list');
  for (const good of pool) {
    const price = sharePrice(state, good);
    const canAfford = player ? creditLimit(player) >= price : false;
    const btn = button(
      `${goodName(good)} · ${price} 元`,
      'spot',
      () => emit({ type: 'master-buy-share', playerId: master, good }),
    );
    btn.disabled = !canAfford;
    list.appendChild(btn);
  }
  box.appendChild(list);

  box.appendChild(
    el('p', 'hint', '股份价格 = 该货物当前黑市价，最低 5 元。每段航程港务长只能买 1 张。'),
  );
  box.appendChild(
    button('不买，继续', 'btn btn--primary btn--wide', () =>
      emit({ type: 'master-skip-share', playerId: master }),
    ),
  );
  return box;
}

// ---------------------------------------------------------------- 装货

function loadView(ctx: PhaseViewContext): HTMLElement {
  const { state, emit } = ctx;
  const master = state.harborMaster;
  const box = section(`港务长 ${playerName(state, master)} 的办事处 · 装货`);
  if (!master) return box;

  // 选一种不装的货，其余三种按 GOODS 顺序装到 1/2/3 航道
  const list = el('div', 'spot-list');
  for (const skip of GOODS) {
    const laneAssignment = GOODS.filter((g) => g.id !== skip.id).map((g) => g.id);
    const detail = laneAssignment.map((g, i) => `${i + 1}→${goodName(g)}`).join(' ');
    const btn = button(
      `不装「${skip.name}」`,
      'spot',
      () => emit({ type: 'master-load', playerId: master, laneAssignment }),
    );
    btn.appendChild(el('span', 'spot__cost', detail));
    list.appendChild(btn);
  }
  box.appendChild(list);
  box.appendChild(
    el('p', 'hint', '从 4 种货物里挑 3 种，每种装一艘船；剩下一种本航程不装。'),
  );
  return box;
}

// ---------------------------------------------------------------- 放船

function launchView(ctx: PhaseViewContext): HTMLElement {
  const { state, emit } = ctx;
  const master = state.harborMaster;
  const box = section(`港务长 ${playerName(state, master)} 的办事处 · 放船`);
  if (!master) return box;

  const inputs: HTMLInputElement[] = [];
  const sumEl = el('p', 'hint');

  const updateSum = (): void => {
    const values = inputs.map((i) => Number(i.value));
    const sum = values.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
    sumEl.textContent = `起点之和 ${sum} / 需要正好 9`;
    sumEl.classList.toggle('is-bad', sum !== 9);
    confirm.disabled = sum !== 9;
  };

  for (let lane = 0; lane < 3; lane += 1) {
    const good = state.boats[lane]?.good ?? null;
    const row = el('div', 'row row--field');
    row.appendChild(el('span', 'row__label', `第 ${lane + 1} 航道（${good ? goodName(good) : '空'}）`));
    const input = el('input', 'num num--sm');
    input.type = 'number';
    input.min = '0';
    input.max = '5';
    input.value = String(2 + lane);
    input.addEventListener('input', updateSum);
    inputs.push(input);
    row.appendChild(input);
    box.appendChild(row);
  }

  box.appendChild(sumEl);
  const confirm = button('确认放船', 'btn btn--primary btn--wide', () => {
    emit({
      type: 'master-launch',
      playerId: master,
      positions: inputs.map((i) => Number(i.value)),
    });
  });
  box.appendChild(confirm);
  updateSum();
  box.appendChild(el('p', 'hint', '每艘船放在 0-5 之间，三艘船起点之和必须正好是 9。'));
  return box;
}

// ---------------------------------------------------------------- 放置小弟

function placementView(ctx: PhaseViewContext): HTMLElement {
  const { state, emit } = ctx;
  const who = currentPlacementPlayer(state);
  const round = state.schedule.slice(0, state.stepIndex + 1).filter((s) => s === 'placement').length;
  const box = section(`放置小弟（第 ${round} 轮）`);

  if (!who) {
    box.appendChild(el('p', 'hint', '本轮所有人都已行动。'));
    return box;
  }

  const row = el('p', 'kv');
  row.append(el('span', 'kv__k', '轮到'));
  row.append(el('strong', 'kv__v kv__v--gold', playerName(state, who)));
  box.appendChild(row);

  const ctxPlacement = placementContext(state);
  const player = state.players.find((p) => p.id === who);
  const blind = player ? mustBeBlind(ctxPlacement, player) : false;
  if (blind) {
    box.appendChild(
      el('p', 'hint hint--warn', `${playerName(state, who)} 现金不足，只能作为「盲目的旅客」免费放置（不能当保险仲介者）。`),
    );
  }

  const spots = availableSpots(ctxPlacement);
  if (spots.length === 0) {
    box.appendChild(el('p', 'hint', '已经没有空位了。'));
  }

  const list = el('div', 'spot-list');
  for (const spot of spots) {
    const preview = previewSpot(ctxPlacement, spot);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'spot spot--rich';
    btn.title = preview.note ?? preview.condition;

    const main = el('span', 'spot__main');
    main.appendChild(el('span', 'spot__name', spotText(state, spot)));
    main.appendChild(
      el(
        'span',
        'spot__money',
        preview.cost === 0
          ? preview.potential > 0
            ? `免费 → 得 ${preview.potential}`
            : '免费'
          : `付 ${preview.cost} → ${preview.potential > 0 ? `得 ${preview.potential}` : '无直接收益'}`,
      ),
    );
    btn.appendChild(main);
    btn.appendChild(el('span', 'spot__cond', preview.condition));
    if (blind && spot.kind === 'insurance') btn.disabled = true;

    btn.addEventListener('click', () => emit({ type: 'place', playerId: who, spot }));
    list.appendChild(btn);
  }
  box.appendChild(list);

  box.appendChild(
    button('自我克制（本段航程不再放置）', 'btn btn--wide', () =>
      emit({ type: 'decline-placement', playerId: who }),
    ),
  );
  box.appendChild(
    el('p', 'hint', '货仓与海盗船必须从最低价 / 第一格开始填，所以每个货仓只会出现一个可选项。'),
  );
  return box;
}

// ---------------------------------------------------------------- 移动

function movementView(ctx: PhaseViewContext): HTMLElement {
  const { state, emit } = ctx;
  const box = section(`第 ${movementRoundOf(state)} 次移动 · 掷骰推船`);

  const dice = el('div', 'dice-row');
  for (const roll of state.dice ?? []) {
    const die = el('div', 'die');
    die.appendChild(el('span', 'die__good', goodName(roll.good)));
    die.appendChild(el('span', 'die__pips', String(roll.pips)));
    dice.appendChild(die);
  }
  box.appendChild(dice);

  box.appendChild(el('p', 'hint', '船已按点数前进。越过第 13 格即抵达马尼拉港；正好停在第 13 格会招来海盗。'));
  box.appendChild(button('继续', 'btn btn--primary btn--wide', () => emit({ type: 'advance' })));
  return box;
}

// ---------------------------------------------------------------- 领航员

function pilotView(ctx: PhaseViewContext): HTMLElement {
  const { state, emit } = ctx;
  const current = currentPilot(state);
  const box = section('领航员');

  if (!current) {
    box.appendChild(el('p', 'hint', '没有领航员在任。'));
    box.appendChild(button('继续', 'btn btn--primary btn--wide', () => emit({ type: 'advance' })));
    return box;
  }

  const row = el('p', 'kv');
  row.append(el('span', 'kv__k', current.size === 'small' ? '小领航员' : '大领航员'));
  row.append(el('strong', 'kv__v kv__v--gold', playerName(state, current.playerId)));
  box.appendChild(row);

  const atSea = state.boats
    .map((b, i) => ({ b, i }))
    .filter(({ b }) => b.arrivedSlot === null && b.shipyardSlot === null);

  const list = el('div', 'spot-list');
  const moves: { label: string; moves: PilotMove[] }[] = [];

  if (current.size === 'small') {
    for (const { i } of atSea) {
      moves.push({ label: `第 ${i + 1} 航道 前进 1 格`, moves: [{ boat: i, delta: 1 }] });
      moves.push({ label: `第 ${i + 1} 航道 后退 1 格`, moves: [{ boat: i, delta: -1 }] });
    }
  } else {
    for (const { i } of atSea) {
      moves.push({ label: `第 ${i + 1} 航道 前进 2 格`, moves: [{ boat: i, delta: 2 }] });
      moves.push({ label: `第 ${i + 1} 航道 后退 2 格`, moves: [{ boat: i, delta: -2 }] });
    }
    for (const a of atSea) {
      for (const b of atSea) {
        if (a.i >= b.i) continue;
        moves.push({
          label: `第 ${a.i + 1}、${b.i + 1} 航道各前进 1 格`,
          moves: [
            { boat: a.i, delta: 1 },
            { boat: b.i, delta: 1 },
          ],
        });
        moves.push({
          label: `第 ${a.i + 1}、${b.i + 1} 航道各后退 1 格`,
          moves: [
            { boat: a.i, delta: -1 },
            { boat: b.i, delta: -1 },
          ],
        });
      }
    }
  }

  for (const option of moves) {
    list.appendChild(
      button(option.label, 'spot', () =>
        emit({ type: 'pilot-move', playerId: current.playerId, moves: option.moves }),
      ),
    );
  }
  box.appendChild(list);
  box.appendChild(
    button('放弃影响力', 'btn btn--wide', () =>
      emit({ type: 'pilot-skip', playerId: current.playerId }),
    ),
  );
  box.appendChild(el('p', 'hint', '移动通过第 13 格即抵达港口；正好停在第 13 格不会触发海盗。'));
  return box;
}

// ---------------------------------------------------------------- 海盗去向

function pirateView(ctx: PhaseViewContext): HTMLElement {
  const { state, emit } = ctx;
  const who = currentPirateDecider(state);
  const boat = state.piratePending[0];
  const box = section('海盗船长决定被劫掠船只的去向');

  box.appendChild(el('p', 'hint', `海盗船长：${playerName(state, who)}`));
  if (boat === undefined) {
    box.appendChild(button('继续', 'btn btn--primary btn--wide', () => emit({ type: 'advance' })));
    return box;
  }

  const info = state.boats[boat];
  box.appendChild(
    el(
      'p',
      'kv',
      `第 ${(info?.lane ?? boat) + 1} 航道（${info?.good ? goodName(info.good) : '空'}）被劫掠`,
    ),
  );

  const list = el('div', 'spot-list');
  if (who) {
    list.appendChild(
      button('送往港口（该货物涨价）', 'spot', () =>
        emit({ type: 'pirate-destination', playerId: who, boat, destination: 'port' }),
      ),
    );
    list.appendChild(
      button('送往修船场', 'spot', () =>
        emit({ type: 'pirate-destination', playerId: who, boat, destination: 'shipyard' }),
      ),
    );
  }
  box.appendChild(list);
  return box;
}

// ---------------------------------------------------------------- 结算

function payoutView(ctx: PhaseViewContext): HTMLElement {
  const { state, emit } = ctx;
  const box = section('利润分配');
  const report = state.payout;

  if (!report) return box;

  const lines = el('ul', 'report');
  for (const line of report.lines) {
    lines.appendChild(
      el(
        'li',
        '',
        `${playerName(state, line.playerId)} +${line.amount} 元 · ${line.reason}${
          line.source === 'insurance' ? '（由保险仲介者支付）' : ''
        }`,
      ),
    );
  }
  if (report.lines.length === 0) lines.appendChild(el('li', '', '没有人获得利润。'));
  box.appendChild(lines);

  if (report.obligations.length > 0) {
    box.appendChild(
      el(
        'p',
        'hint',
        `保险理赔：${report.obligations.map((o) => `${'ABC'[o.slot] ?? '?'} 格 ${o.amount} 元`).join('、')}。` +
          `仲介者付出 ${report.brokerPaid} 元，钱箱承担 ${report.bankCovered} 元。`,
      ),
    );
  }

  if (report.goodArrived.length > 0) {
    box.appendChild(
      el('p', 'hint', `抵达港口的货物：${[...new Set(report.goodArrived)].map(goodName).join('、')}（将涨价）。`),
    );
  }

  box.appendChild(button('继续', 'btn btn--primary btn--wide', () => emit({ type: 'advance' })));
  return box;
}

function priceRiseView(ctx: PhaseViewContext): HTMLElement {
  const { state, emit } = ctx;
  const box = section('货物价格上升');

  const list = el('ul', 'report');
  for (const good of GOODS) {
    const idx = state.priceIndex[good.id] ?? 0;
    list.appendChild(
      el('li', '', `${good.name}：${PRICE_TRACK[Math.max(0, idx - 1)] ?? 0} → ${PRICE_TRACK[idx] ?? 0} 元`),
    );
  }
  box.appendChild(list);

  const reached = GOODS.some((g) => (PRICE_TRACK[state.priceIndex[g.id] ?? 0] ?? 0) >= 30);
  box.appendChild(
    el('p', 'hint', reached ? '有货物达到 30 元，本局结束。' : '下一段航程即将开始。'),
  );
  box.appendChild(button('继续', 'btn btn--primary btn--wide', () => emit({ type: 'advance' })));
  return box;
}

function gameOverView(ctx: PhaseViewContext): HTMLElement {
  const { state } = ctx;
  const box = section('游戏结束');

  const ranked = [...state.players].sort((a, b) => wealthOf(state, b) - wealthOf(state, a));
  const list = el('ol', 'report report--rank');
  ranked.forEach((p, i) => {
    const lines = [
      `${p.name} · 财富 ${wealthOf(state, p)} 元`,
      `现金 ${p.cash}，股份 ${p.shares.length} 张（已抵押 ${p.shares.filter((s) => s.mortgaged).length} 张）`,
    ];
    const li = el('li', i === 0 ? 'is-winner' : '');
    li.appendChild(el('strong', '', lines[0] ?? ''));
    li.appendChild(el('span', 'hint', lines[1] ?? ''));
    list.appendChild(li);
  });
  box.appendChild(list);
  box.appendChild(
    el('p', 'hint', `${playerName(state, state.winner)} 成为马尼拉最成功的商人。刷新页面可开新局。`),
  );
  return box;
}

/** 供外壳显示当前阶段标题 */
export function phaseTitle(state: GameState): string {
  const map: Record<string, string> = {
    auction: '竞标港务长',
    'buy-share': '港务长买股份',
    load: '港务长装货',
    launch: '港务长放船',
    placement: '放置小弟',
    movement: '掷骰推船',
    pilot: '领航员',
    'pirate-destination': '海盗决定去向',
    payout: '利润分配',
    'price-rise': '货物涨价',
    'game-over': '游戏结束',
  };
  return map[state.phase] ?? state.phase;
}

/** 供外壳显示：本航程已占用的格位概况 */
export { movementRoundOf };

export function occupiedSpotSummary(state: GameState): string {
  const counts = { hold: 0, port: 0, shipyard: 0, pirate: 0, pilot: 0, insurance: 0 };
  for (const p of state.placements) counts[p.spot.kind] += 1;
  const parts: string[] = [];
  if (counts.hold) parts.push(`货仓 ${counts.hold}`);
  if (counts.port) parts.push(`港口 ${counts.port}/3`);
  if (counts.shipyard) parts.push(`修船场 ${counts.shipyard}/3`);
  if (counts.pirate) parts.push(`海盗 ${counts.pirate}/2`);
  if (counts.pilot) parts.push(`领航员 ${counts.pilot}/2`);
  if (counts.insurance) parts.push('保险 1/1');
  return parts.join(' · ');
}
