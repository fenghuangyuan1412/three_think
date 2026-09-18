/**
 * 联机协议：客户端与服务端共享的纯数据类型。
 *
 * 服务端权威：规则判定只在服务端跑 applyIntent，客户端把 Intent 发过去、
 * 收回整份 GameState 快照再渲染。马尼拉是全公开信息游戏（现金、股份、船位
 * 人人可见），所以可以直接广播完整状态，无需按玩家过滤隐藏信息。
 */
import type { GameState, Intent } from '../core/game';
import type { PlayerId } from '../core/types';

/** 一个账号在房间里的座位信息 */
export interface SeatInfo {
  readonly account: string;
  readonly displayName: string;
  /** 开局后分配的对局座位（p1..pN）；大厅阶段为 null */
  readonly seat: PlayerId | null;
  readonly online: boolean;
}

export type RoomPhase = 'lobby' | 'playing' | 'over';

/** 服务端每次广播的完整房间快照：大厅名单 + 对局状态 */
export interface RoomSnapshot {
  readonly roomPhase: RoomPhase;
  /** 登录顺序即大厅名单 */
  readonly seats: readonly SeatInfo[];
  /** 可以开局的人（第一个登录的账号） */
  readonly hostAccount: string | null;
  /** 对局状态；大厅阶段为 null */
  readonly state: GameState | null;
}

export type ClientMessage =
  /** 用账号密码登录 / 断线后重新接管原座位 */
  | { readonly type: 'login'; readonly account: string; readonly password: string }
  /** 房主开局：把当前在线的 3-5 人随机分到座位 */
  | { readonly type: 'start' }
  /** 玩家操作。playerId 由服务端按连接座位校验，客户端伪造无效 */
  | { readonly type: 'intent'; readonly intent: Intent }
  /** 房主回到大厅重开（局终后或局中放弃均可） */
  | { readonly type: 'reset' }
  /** 房主一键救援：断开除自己以外的所有连接，卡死/幽灵端会自动重连接回原座位 */
  | { readonly type: 'reconnect-all' };

export type ServerMessage =
  /** 登录成功：告知本连接代表的账号 */
  | { readonly type: 'login-ok'; readonly account: string }
  /** 任何时刻的完整快照（登录后立即收到，此后每个事件都重发） */
  | { readonly type: 'snapshot'; readonly snapshot: RoomSnapshot }
  /** 拒绝或错误提示，直接面向玩家显示 */
  | { readonly type: 'error'; readonly code: string; readonly message: string };
