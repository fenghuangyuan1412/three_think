/**
 * 谈判阶段的全屏交易界面（第三次投骰结束后弹出）。
 *
 * 属于 ui/ 层（agent.md §3）：不做规则判定，只把 core 给的状态照单渲染，
 * 点击翻译成 transfer / negotiation-done 意图。
 *
 * 布局：左侧是当前操作者的转账区，右侧固定回放「本轮金额变化 + 本航程操作」。
 * 每位玩家都必须亲手点「确认」，界面才会往下走 —— 没人能替别人把它点掉，
 * 慢慢看完回放再走是允许的（core 里只要求全员确认，不限顺序）。
 */
import type { GameState, Intent } from '../core/game';
import type { PlayerId } from '../core/types';

export interface NegotiationHandle {
  readonly element: HTMLElement;
  render(state: GameState): void;
  dispose(): void;
}

interface Options {
  /** 联机模式本设备代表的座位；null = 热座（逐个轮到未确认的玩家） */
  readonly you: PlayerId | null;
  readonly onIntent: (intent: Intent) => void;
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

export function createNegotiation({ you, onIntent }: Options): NegotiationHandle {
  const overlay = el('div', 'trade');

  function renderActions(state: GameState): HTMLElement {
    const main = el('div', 'trade__main');

    const unconfirmed = state.players.filter((p) => !state.negotiationConfirmed.includes(p.id));
    const actor: PlayerId | null =
      you === null
        ? unconfirmed[0]?.id ?? null
        : unconfirmed.some((p) => p.id === you)
          ? you
          : null;

    if (actor === null) {
      main.appendChild(el('p', 'hint hint--warn', '你已确认。等待其余玩家结束谈判…'));
    } else {
      const me = state.players.find((p) => p.id === actor);
      const who = el('p', 'kv');
      who.append(el('span', 'kv__k', '正在操作'));
      who.append(el('strong', 'kv__v kv__v--gold', me?.name ?? actor));
      main.appendChild(who);

      if (state.transferredThisVoyage.includes(actor)) {
        main.appendChild(el('p', 'hint', '你本段航程已经转过一次账了。'));
      } else {
        main.appendChild(
          el('p', 'hint', '每段航程可转账一次。先和对方谈好价码（口头/私聊），这里只是把钱到账——金额与对象随你定。'),
        );

        let target: PlayerId | null = null;
        const targetBtns: HTMLButtonElement[] = [];
        const targets = el('div', 'row');
        for (const p of state.players) {
          if (p.id === actor) continue;
          const btn = button(p.name, 'btn btn--sm', () => {
            target = p.id;
            targetBtns.forEach((b) => b.classList.toggle('is-active', b === btn));
          });
          targetBtns.push(btn);
          targets.appendChild(btn);
        }
        main.appendChild(targets);

        const row = el('div', 'row row--field');
        row.appendChild(el('span', 'row__label', '金额'));
        const input = el('input', 'num num--sm');
        input.type = 'number';
        input.min = '1';
        input.max = String(me?.cash ?? 0);
        input.value = '5';
        row.appendChild(input);
        row.appendChild(
          button('转账', 'btn btn--primary btn--sm', () => {
            if (!target) return;
            onIntent({ type: 'transfer', playerId: actor, toPlayerId: target, amount: Number(input.value) });
          }),
        );
        main.appendChild(row);
      }

      main.appendChild(
        button('确认（我的谈判结束了）', 'btn btn--primary btn--wide', () =>
          onIntent({ type: 'negotiation-done', playerId: actor }),
        ),
      );
    }

    main.appendChild(
      el(
        'p',
        'hint',
        `已确认 ${state.negotiationConfirmed.length} / ${state.players.length} 人。全员确认后进入领航员阶段。`,
      ),
    );
    return main;
  }

  function renderReplay(state: GameState): HTMLElement {
    const side = el('div', 'trade__side');
    side.appendChild(el('h4', 'trade__side-title', '本轮金额变化'));

    const money = el('ul', 'money-delta');
    for (const p of state.players) {
      const start = state.roundStartCash[p.id];
      const delta = start === undefined ? 0 : p.cash - start;
      const li = el('li');
      li.appendChild(el('span', 'money-delta__name', p.name));
      li.appendChild(el('span', 'money-delta__cash', `现金 ${p.cash}`));
      li.appendChild(
        el(
          'span',
          `money-delta__diff${delta > 0 ? ' is-up' : delta < 0 ? ' is-down' : ''}`,
          delta === 0 ? '±0' : `${delta > 0 ? '+' : '−'}${Math.abs(delta)}`,
        ),
      );
      li.appendChild(
        el(
          'span',
          'money-delta__flags',
          [
            state.transferredThisVoyage.includes(p.id) ? '已转账' : null,
            state.negotiationConfirmed.includes(p.id) ? '已确认' : null,
          ]
            .filter((s): s is string => s !== null)
            .join('·') || '—',
        ),
      );
      money.appendChild(li);
    }
    side.appendChild(money);

    side.appendChild(el('h4', 'trade__side-title', '本航程操作'));
    const logList = el('ul', 'round-log');
    const lines = state.log.slice(state.roundLogMark);
    for (const line of lines) logList.appendChild(el('li', '', line));
    if (lines.length === 0) logList.appendChild(el('li', 'round-log__empty', '本航程还没有记录。'));
    side.appendChild(logList);
    return side;
  }

  return {
    element: overlay,
    render(state: GameState): void {
      overlay.replaceChildren();

      const card = el('div', 'trade__card');
      const head = el('div', 'trade__head');
      head.appendChild(el('h2', 'trade__title', `谈判与转账 · 第 ${state.voyage} 段航程`));
      head.appendChild(
        el('p', 'trade__sub', '三次投骰结束，结算之前。想雇领航员、想分战利品，现在把钱谈妥。'),
      );
      card.appendChild(head);

      const layout = el('div', 'trade__layout');
      layout.append(renderActions(state), renderReplay(state));
      card.appendChild(layout);

      overlay.appendChild(card);
    },
    dispose(): void {
      overlay.remove();
    },
  };
}
