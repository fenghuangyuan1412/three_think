/**
 * 规则说明书：棋盘底部按钮 + 全屏弹层。
 *
 * 棋盘重构后板面只留名称与得/付数字，被删掉的玩法说明全部收进这里
 * （用户需求：「一些多余的介绍不需要……说明书可以在下面弄一个按钮让玩家看」）。
 * 数值一律从 config/board-layout 取，避免和板面/结算逻辑脱节。
 */
import {
  GOODS,
  INSURANCE_FEE,
  PIRATE_SPACES,
  PILOT_LARGE_COST,
  PILOT_SMALL_COST,
  PORT_SPACES,
  SHIPYARD_SPACES,
  WARE_LOADS,
} from '../config/board-layout';
import { MORTGAGE_LOAN, REDEEM_COST } from '../config/constants';

export interface RulebookHandle {
  readonly element: HTMLElement;
  dispose(): void;
}

function costs(spaces: readonly { cost: number }[]): string {
  return spaces.map((s) => s.cost).join('/');
}

export function createRulebook(): RulebookHandle {
  const element = document.createElement('div');
  element.className = 'rulebook';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn rulebook__fab';
  button.textContent = '规则说明书';

  const portLine = PORT_SPACES.map((s, i) => `${'ABC'[i]} 付${s.cost}→得${s.reward}`).join('，');
  const yardLine = SHIPYARD_SPACES.map((s, i) => `${'ABC'[i]} 付${s.cost}→得${s.reward}`).join('，');
  const wareLines = WARE_LOADS.map((w) => {
    const name = GOODS.find((g) => g.id === w.good)?.name ?? w.good;
    return `${name}：格费 ${costs(w.spaces)}，总利润 ${w.totalReward}`;
  }).join('；');

  const overlay = document.createElement('div');
  overlay.className = 'rulebook__overlay';
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="rulebook__card">
      <h2 class="rulebook__title">马尼拉 · 规则说明书</h2>
      <section>
        <h3 class="rulebook__h">一段航程的流程</h3>
        <ol class="rulebook__ol">
          <li>竞标港务长办事处（出价上限 = 现金 + 未抵押股份 × ${MORTGAGE_LOAN}）</li>
          <li>港务长按黑市现价买 1 张股份（可选，种类保密）</li>
          <li>港务长挑 3 种货装上三艘平底船</li>
          <li>港务长把船放进 0–5 起点格，三船起点之和必须等于 9</li>
          <li>放置小弟 ⇄ 掷骰推船，交替进行 3 轮；第 1、2 轮若有船恰好停第 13 格，海盗登船占其甲板（多艘候选由海盗船长挑）；第 3 轮则直接劫掠</li>
          <li>三次投骰结束 → 谈判与转账（每人可向任意玩家转账一次，各自看完回放并确认）</li>
          <li>领航员行动（先小后大），随后结算：货仓分利、港口 / 修船场赔付、保险理赔（每人点「我看完了」才继续）</li>
          <li>抵达港口的货物按黑市价格轨上涨一档 → 进入下一段航程</li>
        </ol>
      </section>
      <section>
        <h3 class="rulebook__h">棋盘上的位置</h3>
        <ul class="rulebook__ul">
          <li><strong>货仓</strong>：${wareLines}。利润由船舱格上的小弟平分，船必须活着抵达港口才结算。</li>
          <li><strong>马尼拉港</strong>：掷骰让船越过第 13 格即进港；最后结算时恰好停在 13 格且海盗位无人，也算平安进港。空格按第 1/2/3 艘到港的船依次认领 ${portLine}。</li>
          <li><strong>修船场</strong>：一段航程结束仍没能进港的船都要进厂，空格按第 1/2/3 艘进厂的船依次认领 ${yardLine}；赔偿由保险仲介者支付（无人投保时由银行付）。</li>
          <li><strong>海盗船</strong>：两格各付 ${PIRATE_SPACES.map((s) => s.cost).join('/')}。第 1、2 轮有船恰好停第 13 格时，海盗跳上该船的海盗甲板（不占货仓、不挤人）；这艘船若之后抵达港口，<strong>整船货款归甲板上的海盗均分</strong>，货仓小弟空手。第 3 轮停在第 13 格的船则被直接劫掠。</li>
          <li><strong>领航员</strong>：小领航员付 ${PILOT_SMALL_COST}，大领航员付 ${PILOT_LARGE_COST}。三次投骰全部结束、谈判确认后行动：每艘还在海上的船都可以被他推/拉一次，小每艘 ±1 格、大每艘 ±2 格。本身没有收益，用来把自家船推进港、或把别人拖出节奏。</li>
          <li><strong>保险处</strong>：免费放，立即从银行领 ${INSURANCE_FEE} 元，但本航程修船场的全部赔偿由你承担。</li>
        </ul>
      </section>
      <section>
        <h3 class="rulebook__h">股份与结束</h3>
        <ul class="rulebook__ul">
          <li>股份可在缺钱时抵押给银行换 ${MORTGAGE_LOAN} 元/张，赎回需付 ${REDEEM_COST} 元。</li>
          <li>任一货物价格达到 30 元时游戏结束；以「现金 + 股份现价 − 每张抵押股份 ${REDEEM_COST} 元」总财富最高者获胜。</li>
        </ul>
      </section>
      <button type="button" class="btn btn--primary btn--wide rulebook__close">关 闭</button>
    </div>
  `;

  const close = () => {
    overlay.hidden = true;
  };
  const open = () => {
    overlay.hidden = false;
  };
  button.addEventListener('click', open);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  overlay.querySelector('.rulebook__close')?.addEventListener('click', close);

  element.append(button, overlay);

  return {
    element,
    dispose() {
      element.remove();
    },
  };
}
