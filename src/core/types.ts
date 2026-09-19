/**
 * 规则层的基础类型。**本文件与整个 src/core/ 不允许 import three.js。**
 * 见 agent.md §3：删掉 src/render/ 后，core/ 的测试必须仍然全绿。
 */
import { REDEEM_COST } from '../config/constants';

/** 四种货物。规则：肉豆蔻、丝绸、玉、人参 */
export type GoodId = 'nutmeg' | 'silk' | 'jade' | 'ginseng';

export type PlayerId = string;

/** 一张股份。抵押后可用于贷款，赎回需付 REDEEM_COST。 */
export interface ShareCard {
  readonly id: string;
  /** 该股份所属货物 */
  readonly good: GoodId;
  /**
   * 是否已抵押给钱箱。
   * 已抵押的股份：① 不能再用于贷款 ② 游戏结束时扣 REDEEM_COST 元 ③ 不再计入信用额度。
   */
  readonly mortgaged: boolean;
}

/** 一位玩家。整个对象不可变：任何变化都产生新对象（agent.md §5）。 */
export interface Player {
  readonly id: PlayerId;
  readonly name: string;
  /** 渲染层用的颜色标识，规则层只当它是一个标识符 */
  readonly color: string;
  /** 现金（披索） */
  readonly cash: number;
  readonly shares: readonly ShareCard[];
  /** 本局分到的小弟总数（任何人数局都是 3 个） */
  readonly accomplicesTotal: number;
  /** 仅存在于联机按观看者过滤的广播中：他人股份隐去类型后留下的 {总张数, 抵押数} */
  readonly hiddenShares?: { readonly count: number; readonly mortgaged: number };
}

export function findPlayer(players: readonly Player[], id: PlayerId): Player | undefined {
  return players.find((p) => p.id === id);
}

/** 玩家总财富。规则：现金 + 股份价值 − 每张抵押股份 15 元 */
export function netWorth(player: Player, sharePrice: (good: GoodId) => number): number {
  const sharesValue = player.shares.reduce((sum, s) => sum + sharePrice(s.good), 0);
  const mortgaged = player.shares.filter((s) => s.mortgaged).length;
  return player.cash + sharesValue - mortgaged * REDEEM_COST;
}
