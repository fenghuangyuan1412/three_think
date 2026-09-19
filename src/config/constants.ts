/**
 * 全局规则常量 —— 对应《马尼拉》(Manila, 2005) 的规则数值。
 *
 * 来源：中文规则全文（魔方吧转载）
 * http://www.mf8-china.com/archiver/?tid-72459.html
 *
 * 标注「待核对」的数值**没有可靠来源**，是按规则文字推断的占位值。
 * 必须对照实物棋盘或官方规则书核实后才可用于结算。见 docs/design-v1.md。
 */

/** 起始资金。规则：「每位玩家得到３０元披索」 */
export const STARTING_CASH = 30;

/** 竞标起拍价。规则：「起标价最低为１元披索（或是ｐａｓｓ）」 */
export const MIN_BID = 1;

/** 每张未抵押股份可抵押贷款的金额。规则：「对每一张股份，海港的钱箱借款１２元披索」 */
export const MORTGAGE_LOAN = 12;

/** 赎回一张抵押股份的金额（本金 + 利息）。规则：「偿还贷款加上利息，一共１５元披索」 */
export const REDEEM_COST = 15;

/** 股份最低价。规则：「股份的最低价格永远为５元披索」 */
export const MIN_SHARE_PRICE = 5;

/** 游戏结束阈值。规则：「一旦当至少一种货物…价格达到３０元，游戏结束」 */
export const GAME_END_PRICE = 30;

/** 开局发到玩家手里的股份数。规则：「每位玩家得到两张」 */
export const STARTING_SHARES = 2;

/**
 * 每位玩家的小弟数。本作规则：任何人数局每人都是 3 个，
 * 与每段航程的 3 轮放置严格对齐，第 3 次移动后必进结算。
 */
export const ACCOMPLICES_BY_PLAYER_COUNT: Readonly<Record<number, number>> = {
  3: 3,
  4: 3,
  5: 3,
};

/** 可选玩家人数。规则：「支持 3~5 人游戏，最佳人数 4 人」 */
export const SUPPORTED_PLAYER_COUNTS = [3, 4, 5] as const;

export type SupportedPlayerCount = (typeof SUPPORTED_PLAYER_COUNTS)[number];

/** 单人局最大玩家数，用于校验 */
export const MAX_PLAYERS = 5;
export const MIN_PLAYERS = 3;
