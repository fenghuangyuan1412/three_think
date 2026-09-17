/**
 * 侧栏外壳：航程标题 + 当前阶段区块 + 玩家状态 + 对局记录 + 规则速查。
 *
 * 属于 ui/ 层（agent.md §3）：不做规则判定，只负责把 core 的状态显示出来，
 * 并把玩家操作翻译成 Intent 交给 app.ts。
 */
import { GOODS } from '../config/board-layout';
import { creditLimit } from '../core/bidding';
import type { GameState, Intent } from '../core/game';
import { sharePrice } from '../core/game';
import type { Player } from '../core/types';
import { occupiedSpotSummary, phaseTitle, renderPhaseView } from './phase-views';
import { renderEarningsTable } from './earnings';

export interface GamePanelOptions {
  readonly onIntent: (intent: Intent) => void;
}

export interface GamePanelHandle {
  readonly element: HTMLElement;
  render(state: GameState, error: string | null): void;
  dispose(): void;
}

export function createGamePanel(options: GamePanelOptions): GamePanelHandle {
  const element = document.createElement('aside');
  element.className = 'panel';
  element.innerHTML = `
    <header class="panel__head">
      <p class="panel__eyebrow" data-role="voyage"></p>
      <h2 class="panel__title" data-role="phase"></h2>
      <p class="panel__sub" data-role="occupied"></p>
    </header>
    <div data-role="phase-host"></div>
    <details class="earnings-host" data-role="earnings" open>
      <summary>本航程收益一览（每轮更新）</summary>
      <div data-role="earnings-body"></div>
    </details>
    <section class="players">
      <h3 class="section-title">玩家</h3>
      <ul class="player-list" data-role="players"></ul>
    </section>
    <section class="log">
      <h3 class="section-title">对局记录</h3>
      <ol class="log-list" data-role="log"></ol>
    </section>
    <details class="rules">
      <summary>本航程流程</summary>
      <ol>
        <li>竞标港务长办事处</li>
        <li>港务长买 1 张股份（可选）</li>
        <li>港务长选 3 种货装船</li>
        <li>港务长把船放进 0-5，三船之和须为 9</li>
        <li>放置小弟 ⇄ 掷骰推船，交替进行（含海盗、领航员）</li>
        <li>利润分配与保险理赔</li>
        <li>抵达港口的货物涨价 → 下一段航程</li>
      </ol>
      <p class="rules__note">任一货物价格达到 30 元时游戏结束，现金 + 股份 − 抵押欠款最高者胜。</p>
    </details>
  `;

  const q = <T extends HTMLElement>(role: string): T => {
    const found = element.querySelector<T>(`[data-role="${role}"]`);
    if (!found) throw new Error(`面板缺少节点: ${role}`);
    return found;
  };

  const voyageEl = q<HTMLParagraphElement>('voyage');
  const phaseEl = q<HTMLHeadingElement>('phase');
  const occupiedEl = q<HTMLParagraphElement>('occupied');
  const phaseHost = q<HTMLDivElement>('phase-host');
  const earningsHost = q<HTMLDetailsElement>('earnings');
  const earningsBody = q<HTMLDivElement>('earnings-body');
  const playersEl = q<HTMLUListElement>('players');
  const logEl = q<HTMLOListElement>('log');

  function tag(text: string, className: string): HTMLElement {
    const span = document.createElement('span');
    span.className = `tag ${className}`;
    span.textContent = text;
    return span;
  }

  function renderPlayer(player: Player, state: GameState, isCurrent: boolean): HTMLElement {
    const li = document.createElement('li');
    li.className = 'player';
    if (isCurrent) li.classList.add('is-turn');
    if (player.id === state.harborMaster) li.classList.add('is-master');

    const head = document.createElement('div');
    head.className = 'player__head';
    const dot = document.createElement('span');
    dot.className = 'player__dot';
    dot.style.background = player.color;
    const name = document.createElement('span');
    name.className = 'player__name';
    name.textContent = player.name;
    const cash = document.createElement('span');
    cash.className = 'player__cash';
    cash.textContent = `${player.cash} 元`;
    head.append(dot, name, cash);
    li.appendChild(head);

    const tags = document.createElement('div');
    tags.className = 'player__tags';
    if (player.id === state.harborMaster) tags.appendChild(tag('港务长', 'tag--master'));
    if (state.declined.includes(player.id)) tags.appendChild(tag('已克制', 'tag--passed'));
    if (state.bidding?.passed.includes(player.id)) tags.appendChild(tag('已过牌', 'tag--passed'));
    if (isCurrent) tags.appendChild(tag('行动中', 'tag--turn'));

    const placed = state.placements.filter((p) => p.playerId === player.id).length;
    tags.appendChild(tag(`小弟 ${placed}/${player.accomplicesTotal}`, 'tag--muted'));
    li.appendChild(tags);

    const shares = document.createElement('div');
    shares.className = 'shares';
    if (player.shares.length === 0) {
      shares.appendChild(tag('无股份', 'tag--muted'));
    } else {
      for (const share of player.shares) {
        const name2 = GOODS.find((g) => g.id === share.good)?.name ?? share.good;
        shares.appendChild(
          tag(
            `${name2} ${sharePrice(state, share.good)}${share.mortgaged ? '（抵押）' : ''}`,
            share.mortgaged ? 'tag--mortgaged' : 'tag--share',
          ),
        );
      }
    }
    li.appendChild(shares);

    const credit = document.createElement('p');
    credit.className = 'player__credit';
    credit.textContent = `出价上限 ${creditLimit(player)} 元 · 放置小弟 ${placed}/${player.accomplicesTotal}`;
    li.appendChild(credit);

    return li;
  }

  /** 当前该行动的玩家，用于高亮 */
  function currentActor(state: GameState): string | null {
    switch (state.phase) {
      case 'auction':
        return state.bidding ? (state.bidding.order[state.bidding.cursor] ?? null) : null;
      case 'buy-share':
      case 'load':
      case 'launch':
        return state.harborMaster;
      default:
        return null;
    }
  }

  return {
    element,

    render(state, error) {
      voyageEl.textContent = `第 ${state.voyage} 段航程`;
      phaseEl.textContent = phaseTitle(state);
      occupiedEl.textContent = occupiedSpotSummary(state);

      phaseHost.replaceChildren(renderPhaseView({ state, emit: options.onIntent, error }));

      // 收益一览：每轮都按当前状态重算，让玩家知道"现在放上去能拿多少"
      earningsBody.replaceChildren(renderEarningsTable(state));
      earningsHost.hidden = state.phase === 'game-over';

      const actor = currentActor(state);
      playersEl.replaceChildren(...state.players.map((p) => renderPlayer(p, state, p.id === actor)));

      logEl.replaceChildren();
      for (const line of state.log) {
        const li = document.createElement('li');
        li.textContent = line;
        logEl.appendChild(li);
      }
      // 只滚动日志自身，不要用 scrollIntoView —— 那会把整个侧栏顶下去，
      // 导致当前阶段的操作区被滚出视野（实测踩过）。
      logEl.scrollTop = logEl.scrollHeight;
      element.scrollTop = 0;
    },

    dispose() {
      element.remove();
    },
  };
}
