/**
 * 「本航程收益一览」—— 每轮都给玩家看的对账表。
 *
 * 用户需求：「在游戏过程中也需要告诉每轮玩家这个位置现在可能的收益」。
 * 棋盘上印的是**固定的**印刷数值；这里给的是**当下**的估算：
 * 货仓要按已经站了几个小弟来算每人能分多少，港口 / 修船场要按还差几艘船才算达成。
 *
 * 属于 ui/ 层：只读 core 的状态，不做任何规则判定。
 */
import { GOODS, PORT_SPACES, SHIPYARD_SPACES, getWareLoad } from '../config/board-layout';
import type { GameState } from '../core/game';

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

const LETTERS = ['A', 'B', 'C'] as const;

/** 一艘船此刻的货物 / 小弟数 / 每人可得 */
interface HoldRow {
  readonly lane: number;
  readonly goodName: string;
  readonly color: string;
  readonly total: number;
  readonly occupants: number;
  readonly shareIfNow: number;
  readonly position: number;
  /** 已登上这艘船的海盗数（>0 时抵达货款整船归海盗） */
  readonly deckPirates: number;
}

export function renderEarningsTable(state: GameState): HTMLElement {
  const wrap = el('div', 'earnings');

  // ---------------- 货仓 ----------------
  const holds: HoldRow[] = [];
  state.boats.forEach((boat, i) => {
    if (!boat.good) return;
    const def = GOODS.find((g) => g.id === boat.good);
    const load = getWareLoad(boat.good);
    const occupants = state.placements.filter(
      (p) => p.spot.kind === 'hold' && p.spot.boat === i,
    ).length;
    holds.push({
      lane: i + 1,
      goodName: def?.name ?? boat.good,
      color: def?.color ?? 'brown',
      total: load.totalReward,
      occupants,
      shareIfNow: Math.floor(load.totalReward / Math.max(1, occupants)),
      position: boat.position,
      deckPirates: state.placements.filter((p) => p.spot.kind === 'deck' && p.spot.boat === i).length,
    });
  });

  if (holds.length > 0) {
    const block = el('div', 'earnings__block');
    block.appendChild(el('p', 'earnings__title', '货仓（随船抵达港口才结算，由格位上的小弟平分）'));
    for (const row of holds) {
      const line = el('div', 'earnings__row');
      line.appendChild(el('span', `dot dot--${row.color}`));
      line.appendChild(
        el(
          'span',
          'earnings__name',
          `第 ${row.lane} 航道 ${row.goodName}（第 ${row.position} 格）`,
        ),
      );
      line.appendChild(
        el(
          'span',
          'earnings__val',
          row.deckPirates > 0
            ? `总 ${row.total} · 船上有 ${row.deckPirates} 名海盗，抵达则整船归海盗`
            : row.occupants === 0
              ? `总 ${row.total} · 现在放全拿`
              : `总 ${row.total} · ${row.occupants} 人已分，每人 ${row.shareIfNow}`,
        ),
      );
      block.appendChild(line);
    }
    wrap.appendChild(block);
  }

  // ---------------- 港口 ----------------
  const arrived = new Set(
    state.boats.map((b) => b.arrivedSlot).filter((s): s is number => s !== null),
  );
  const portBlock = el('div', 'earnings__block');
  portBlock.appendChild(
    el('p', 'earnings__title', `港口（已抵达 ${arrived.size} 艘；空格越靠后门槛越高、报酬越大）`),
  );
  PORT_SPACES.forEach((spec, i) => {
    const filled = state.placements.find((p) => p.spot.kind === 'port' && p.spot.slot === i);
    const reached = arrived.size >= i + 1;
    const line = el('div', 'earnings__row');
    line.appendChild(el('span', 'earnings__name', `港口 ${LETTERS[i]}`));
    line.appendChild(el('span', 'earnings__val', `付 ${spec.cost} → 得 ${spec.reward}`));
    line.appendChild(
      el(
        'span',
        `earnings__tag ${reached ? 'is-ok' : ''}`,
        reached ? '已达成' : `需 ${i + 1} 艘抵达`,
      ),
    );
    line.appendChild(
      el('span', 'earnings__tag', filled ? '已占' : '空位'),
    );
    portBlock.appendChild(line);
  });
  wrap.appendChild(portBlock);

  // ---------------- 修船场 ----------------
  const wrecked = new Set(
    state.boats.map((b) => b.shipyardSlot).filter((s): s is number => s !== null),
  );
  const yardBlock = el('div', 'earnings__block');
  yardBlock.appendChild(
    el('p', 'earnings__title', `修船场（已进厂 ${wrecked.size} 艘；赔偿由保险仲介者支付）`),
  );
  SHIPYARD_SPACES.forEach((spec, i) => {
    const filled = state.placements.find((p) => p.spot.kind === 'shipyard' && p.spot.slot === i);
    const line = el('div', 'earnings__row');
    line.appendChild(el('span', 'earnings__name', `修船场 ${LETTERS[i]}`));
    line.appendChild(el('span', 'earnings__val', `付 ${spec.cost} → 得 ${spec.reward}`));
    line.appendChild(el('span', 'earnings__tag', `需 ${i + 1} 艘进厂`));
    line.appendChild(el('span', 'earnings__tag', filled ? '已占' : '空位'));
    yardBlock.appendChild(line);
  });
  wrap.appendChild(yardBlock);

  // ---------------- 其它 ----------------
  const misc = el('div', 'earnings__block');
  misc.appendChild(el('p', 'earnings__title', '其它位置'));
  const pirateOccupants = state.placements.filter((p) => p.spot.kind === 'pirate').length;
  for (const line of [
    `海盗船 付 5 · 第 1、2 轮有船停第 13 格时登船占甲板（船长挑船），该船抵达货款整船归海盗；第 3 轮直接劫掠（现有 ${pirateOccupants} 人在船）`,
    '小领航员 付 2 · 无直接收益，三次投骰后每艘海上的船可推 / 拉 1 格',
    '大领航员 付 5 · 无直接收益，三次投骰后每艘海上的船可推 / 拉 2 格',
    '保险处 免费 · 立即得 10 元，但承担本航程全部修船赔偿',
  ]) {
    const row = el('div', 'earnings__row');
    row.appendChild(el('span', 'earnings__name earnings__name--wide', line));
    misc.appendChild(row);
  }
  wrap.appendChild(misc);

  return wrap;
}
