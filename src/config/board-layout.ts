import type { GoodId } from '../core/types';

/**
 * 棋盘拓扑与格位数据 —— 只描述「棋盘上有什么、怎么连接、印了什么数」，不含任何渲染信息。
 * 渲染层（src/render/board.ts）读这份数据生成几何体；
 * 规则层（src/core/）读这份数据判断结果与结算。
 *
 * 来源：中文规则 http://www.mf8-china.com/archiver/?tid-72459.html
 *       「在游戏台上，每艘船有它的航线，航线上有从０到１３的空格，在目标港口结束。」
 *
 * ⚠️ 数值可信度见本文件末尾的 PRINTED_VALUES_PROVENANCE。
 */

// ---------------------------------------------------------------- 航道

/** 一条航道的最后一格编号。通过第 13 格即抵达马尼拉。 */
export const LANE_LAST_SPACE = 13;

/** 一条航道的格数（0..13） */
export const LANE_SPACES = LANE_LAST_SPACE + 1;

/** 航道数 = 平底船数 = 3。规则：「三艘平底船」 */
export const LANE_COUNT = 3;

/** 平底船起点可选的格子范围。规则：「将船放在航道中数字０到５中的任何一个起始位置」 */
export const LAUNCH_POSITIONS = [0, 1, 2, 3, 4, 5] as const;

/**
 * 三艘平底船起点之和必须等于此值。
 * 规则：「这三艘平底船的起始位置的和必须刚好是９」
 */
export const LAUNCH_POSITION_SUM = 9;

/** 港口空格数（A/B/C），按抵达顺序分配 */
export const PORT_SLOTS = ['A', 'B', 'C'] as const;

/** 修船场空格数（A/B/C），按进厂顺序分配 */
export const SHIPYARD_SLOTS = ['A', 'B', 'C'] as const;

export type PortSlot = (typeof PORT_SLOTS)[number];
export type ShipyardSlot = (typeof SHIPYARD_SLOTS)[number];

/** 移动回合数。规则：「这个阶段有三个…平底船移动回合」 */
export const MOVEMENT_ROUNDS = 3;

// ---------------------------------------------------------------- 货物

export interface GoodDef {
  readonly id: GoodId;
  readonly name: string;
  /** 骰子 / 货物 / 价值指示物 / 股份卡共用的颜色（英文名，供 UI 与调试） */
  readonly color: string;
  /** 骰子颜色索引。颜色对应关系见 docs/game-flow.md §5.3 的来源说明 */
  readonly dieIndex: number;
}

/**
 * 四种货物。颜色来自官方规则书 Abb. 2b 的「开局黑市状态」插图：
 * 棕=肉豆蔻、蓝=丝绸、米黄=人参、绿=玉。
 */
export const GOODS: readonly GoodDef[] = [
  { id: 'nutmeg', name: '肉豆蔻', color: 'brown', dieIndex: 0 },
  { id: 'silk', name: '丝绸', color: 'blue', dieIndex: 1 },
  { id: 'ginseng', name: '人参', color: 'tan', dieIndex: 2 },
  { id: 'jade', name: '玉', color: 'green', dieIndex: 3 },
];

export function getGood(id: GoodId): GoodDef {
  const found = GOODS.find((g) => g.id === id);
  if (!found) throw new Error(`未知货物: ${id}`);
  return found;
}

export function goodName(id: GoodId): string {
  return getGood(id).name;
}

// ---------------------------------------------------------------- 价格轨

/**
 * 黑市价格轨的刻度。
 *
 * **已核实**：官方规则书（Zoch Verlag, 2005）Abb. 2b「开局时黑市状态」插图明确画出
 * 五行数值 `30 / 20 / 10 / 5 / 0`，四种货物各一列，指示物起始位在 0 下方（价值按 0 计）。
 * 即一共 5 档，走上 4 次到达 30 元即结束。
 */
export const PRICE_TRACK: readonly number[] = [0, 5, 10, 20, 30];

// ---------------------------------------------------------------- 格位

/** 一个可放置小弟的格位 */
export interface SpotDef {
  /** 放置费用（披索） */
  readonly cost: number;
  /** 该格位的报酬。货仓的报酬在板块级别，这里为 0 */
  readonly reward: number;
}

/**
 * 货仓板块（ware load）。每艘船装一块，共 3 块上船、1 块留在岸上。
 *
 * 规则要点（官方规则书 p.4 / p.7 原文）：
 * - 「For ginseng, silk, and nutmeg, there are three accomplice spaces, and for jade there are four」
 * - 「he should choose the lowest-priced empty space of the desired ware」
 *   → spaces 必须按 cost 升序；这里的"价"就是**放置费**（已由规则书原文确认）
 * - 「On each ware load is the amount of profit to be earned, which the accomplices share」
 *   → totalReward 是整块货仓的总利润，由格位上的小弟**平分**
 *
 * **已核实**：费用读自官方规则书 p.4 的货仓实物照（肉豆蔻 2/3/4、丝绸 3/4/5、
 * 人参 1/2/3、玉 3/4/5/5）；总利润 24 与 36 另经规则书正文互证
 * （「nutmeg punt of 24 PESOS」「the 36 PESO profit」）。
 * 30（丝绸）与 18（人参）为实物照读数，规则书正文未直接写出。
 */
export interface WareLoadDef {
  readonly good: GoodId;
  /** 格位，**必须按 cost 升序**（规则要求依次填最低价空位） */
  readonly spaces: readonly SpotDef[];
  /** 该货仓的总利润，由占用格位的小弟均分 */
  readonly totalReward: number;
}

export const WARE_LOADS: readonly WareLoadDef[] = [
  {
    good: 'nutmeg',
    spaces: [
      { cost: 2, reward: 0 },
      { cost: 3, reward: 0 },
      { cost: 4, reward: 0 },
    ],
    totalReward: 24,
  },
  {
    good: 'silk',
    spaces: [
      { cost: 3, reward: 0 },
      { cost: 4, reward: 0 },
      { cost: 5, reward: 0 },
    ],
    totalReward: 30,
  },
  {
    good: 'ginseng',
    spaces: [
      { cost: 1, reward: 0 },
      { cost: 2, reward: 0 },
      { cost: 3, reward: 0 },
    ],
    totalReward: 18,
  },
  {
    good: 'jade',
    spaces: [
      { cost: 3, reward: 0 },
      { cost: 4, reward: 0 },
      { cost: 5, reward: 0 },
      // 官方实体板上玉的最后两格同为 5，不是严格递增
      { cost: 5, reward: 0 },
    ],
    totalReward: 36,
  },
];

export function getWareLoad(good: GoodId): WareLoadDef {
  const found = WARE_LOADS.find((w) => w.good === good);
  if (!found) throw new Error(`未知货仓: ${good}`);
  return found;
}

/**
 * 港口空格 A/B/C：按第 1/2/3 艘抵达的船分配；报酬由海港钱箱支付。
 *
 * **已核实**：读自官方规则书 p.4 的港口实物照（深色圈=报酬、黄圈=费用）——
 * A 旁 `6`+`4`、B 旁 `8`+`3`、C 旁 `15`+`2`。
 * 正文互证：fig.13a「2 punts reached the destination port → ORANGE earns 6, RED earns 8」。
 *
 * 注意 A/B/C 是**递增的到达门槛**：A 只要有 ≥1 艘抵达就赔、B 要 ≥2、C 要 ≥3，
 * 所以 C 的放置费最低（2）而报酬最高（15）。本实现按「第 N 艘停在空格 N-1」判定，
 * 与门槛写法等价。
 */
export const PORT_SPACES: readonly SpotDef[] = [
  { cost: 4, reward: 6 },
  { cost: 3, reward: 8 },
  { cost: 2, reward: 15 },
];

/**
 * 修船场空格 A/B/C：按第 1/2/3 艘进厂的船分配；赔偿由**保险仲介者**支付
 * （无人担任时由海港钱箱负担）。
 *
 * **已核实**：与港口**完全相同**（A `6`+`4`、B `8`+`3`、C `15`+`2`），
 * 读自官方规则书 p.4 的修船场实物照；正文互证 fig.13b（船厂 A 付 6）与 fig.14（付 6 与 8）。
 */
export const SHIPYARD_SPACES: readonly SpotDef[] = [
  { cost: 4, reward: 6 },
  { cost: 3, reward: 8 },
  { cost: 2, reward: 15 },
];

/**
 * 海盗船上的 2 个格位。
 *
 * 规则：「The first to use the pirate space will take the front space and become the captain.
 * If the captain space is occupied, the player places his accomplice in the second space.」
 * → 与货仓一样是**强制顺序**，不能自由挑。
 *
 * **已核实**：两格费用都是 **5**（官方规则书 p.4 海盗船实物照，两个黄圈都印 5）。
 */
export const PIRATE_SPACES: readonly SpotDef[] = [
  { cost: 5, reward: 0 },
  { cost: 5, reward: 0 },
];

/**
 * 海盗登船时，被劫掠货物的归属价值。
 *
 * 规则：海盗「平均分配利润」，「所有在被劫掠的平底船上的同伙则空手而回」。
 * 这里取被劫掠货仓的 totalReward 作为劫掠所得。
 */

/** 部署格费用（规则有明确数字的部分） */

/** 小领航员放置费。规则：「小领航员（放在２元披索的空格的）」 */
export const PILOT_SMALL_COST = 2;

/** 大领航员放置费。规则：「大领航员（放在５元披索的空格的）」 */
export const PILOT_LARGE_COST = 5;

/** 保险处放置费。规则：「不用负担任何费用，但是立即从港口的钱箱得到１０元披索」 */
export const INSURANCE_COST = 0;

/** 保险仲介者放置时立即取得的金额 */
export const INSURANCE_FEE = 10;

// ---------------------------------------------------------------- 数值可信度

/**
 * 棋盘印刷数值的可信度。
 *
 * - `verified`：已对照官方规则书或实物棋盘核实
 * - `placeholder`：无可靠来源，按规则文字推定的占位值
 *
 * 当前为 `verified`。核实依据：Zoch Verlag 官方英文规则书（©2005）内的棋盘实物照与正文例子，
 * 详见 docs/game-flow.md §5.3。**除丝绸/人参的货仓总利润（30/18）只有实物照读数外，
 * 其余数值都有正文互证。**
 */
export const PRINTED_VALUES_PROVENANCE: 'verified' | 'placeholder' = 'verified';

/** 占位值警示；数值已核实时返回 null */
export function printedValuesWarning(): string | null {
  if (PRINTED_VALUES_PROVENANCE === 'verified') return null;
  return '棋盘印刷数值（港口/修船场报酬、货仓费用与利润）尚无可靠来源，当前为推定占位值，结算结果不代表原版游戏。';
}
