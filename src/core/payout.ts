/**
 * 利润分配与保险理赔（每段航程的第三步）。
 *
 * 规则来源：http://www.mf8-china.com/archiver/?tid-72459.html
 * - 海盗：「海盗掠夺这些平底船，并且平均分配利润…所有在被劫掠的平底船上的同伙则空手而回。」
 * - 货仓：「装载货仓上的同伙只有当他们的平底船抵达马尼拉的目的地港口时，才可以分配利润。
 *   每个货仓上有可分配的利润，由同伙均分。如果平底船损坏而送进修船场，船上的同伙空手而回。」
 * - 港口／修船场：「只有在平底船抵达他们被部署的港口或是修船场空格才可以赚取利润…
 *   港口的利润由港口的钱箱分配。修船场的利润由保险仲介者发出（如果没有保险仲介者，
 *   则由海港的钱箱付出）。所有被部署在闲置的港口或修船场空间的同伙空手而回。」
 * - 保险理赔：「如果平底船停泊的修船场空格有部署同伙，给同伙所属玩家；
 *   如果…没有部署同伙，则付给海港的钱箱。」
 *   「保险仲介者的玩家在付出平底船修理费用之前，首先在航程中得到利润。」
 */
import { getWareLoad } from '../config/board-layout';
import { payToBank } from './economy';
import type { GoodId, Player, PlayerId } from './types';
import type { BoatState, Placement } from './voyage';
import { spotReward } from './voyage';

export interface PayoutLine {
  readonly playerId: PlayerId;
  readonly amount: number;
  readonly reason: string;
  /** bank = 海港钱箱支付；insurance = 保险仲介者支付 */
  readonly source: 'bank' | 'insurance';
}

export interface InsuranceObligation {
  readonly slot: number;
  readonly amount: number;
  /** 受益玩家；null 表示付给海港钱箱 */
  readonly payee: PlayerId | null;
}

export interface PayoutReport {
  readonly lines: readonly PayoutLine[];
  readonly obligations: readonly InsuranceObligation[];
  readonly broker: PlayerId | null;
  /** 保险仲介者实际付出的理赔总额 */
  readonly brokerPaid: number;
  /** 仲介者付不出、由钱箱承担的金额 */
  readonly bankCovered: number;
  /** 本航程抵达港口、因而涨价的货物 */
  readonly goodArrived: readonly GoodId[];
  readonly notes: readonly string[];
}

export interface SettleInput {
  readonly boats: readonly BoatState[];
  readonly placements: readonly Placement[];
  readonly players: readonly Player[];
  /** 取货物当前单价，用于抵押时挑选最便宜的股份 */
  readonly priceOf: (good: GoodId) => number;
  /** 玩家名，用于日志 */
  readonly nameOf: (id: PlayerId) => string;
}

/** 均分，余数留在钱箱（避免出现小数金额） */
function splitEvenly(total: number, count: number): number {
  if (count <= 0) return 0;
  return Math.floor(total / count);
}

export function settleVoyage(input: SettleInput): {
  players: Player[];
  report: PayoutReport;
} {
  const { boats, placements, players, priceOf, nameOf } = input;
  const lines: PayoutLine[] = [];
  const notes: string[] = [];

  const onHold = (boatIndex: number): Placement[] =>
    placements.filter((p) => p.spot.kind === 'hold' && p.spot.boat === boatIndex);

  const onDeck = (boatIndex: number): Placement[] =>
    placements.filter((p) => p.spot.kind === 'deck' && p.spot.boat === boatIndex);

  // ---- 1) 货仓与海盗 ----
  boats.forEach((boat, boatIndex) => {
    if (boat.good === null) return;
    if (boat.arrivedSlot === null && boat.shipyardSlot === null) return;

    const load = getWareLoad(boat.good);
    const occupants = onHold(boatIndex);
    const pirates = onDeck(boatIndex);

    if (boat.plundered) {
      // 被劫掠：普通货仓小弟空手而回，只有登船的海盗均分劫掠所得
      const victims = occupants;

      if (victims.length > 0) {
        notes.push(
          `第 ${boat.lane + 1} 航道的船被劫掠，货仓上 ${victims.length} 名小弟空手而回。`,
        );
      }

      if (pirates.length > 0) {
        const each = splitEvenly(load.totalReward, pirates.length);
        for (const p of pirates) {
          lines.push({
            playerId: p.playerId,
            amount: each,
            reason: `劫掠 ${load.good} 货仓的所得`,
            source: 'bank',
          });
        }
        notes.push(
          `${load.good} 货仓原值 ${load.totalReward} 元，由 ${pirates.length} 名海盗各得 ${each} 元。`,
        );
      } else {
        notes.push(`第 ${boat.lane + 1} 航道的船被劫掠，但船上没有海盗，货物无人认领。`);
      }
      return;
    }

    if (boat.arrivedSlot !== null) {
      if (pirates.length > 0) {
        // 船上载着登船海盗：整船货款归海盗（多名海盗在甲板内部均分），货仓小弟空手而回
        const each = splitEvenly(load.totalReward, pirates.length);
        for (const p of pirates) {
          lines.push({
            playerId: p.playerId,
            amount: each,
            reason: `押船 ${load.good} 抵达，截获整船货款`,
            source: 'bank',
          });
        }
        if (occupants.length > 0) {
          notes.push(
            `第 ${boat.lane + 1} 航道的船带着海盗抵达，货仓上 ${occupants.length} 名小弟空手而回。`,
          );
        }
        notes.push(
          `${load.good} 整船货值 ${load.totalReward} 元由 ${pirates.length} 名登船海盗各得 ${each} 元。`,
        );
        return;
      }
      if (occupants.length === 0) return;
      const each = splitEvenly(load.totalReward, occupants.length);
      for (const p of occupants) {
        lines.push({
          playerId: p.playerId,
          amount: each,
          reason: `${load.good} 货仓抵达港口，与 ${occupants.length} 人均分 ${load.totalReward} 元`,
          source: 'bank',
        });
      }
      notes.push(
        `${load.good} 货仓抵达港口，总值 ${load.totalReward} 元由 ${occupants.length} 人各得 ${each} 元。`,
      );
      return;
    }

    // 进修船场：货仓上的小弟空手而回
    if (occupants.length > 0) {
      notes.push(
        `第 ${boat.lane + 1} 航道的船进了修船场，${load.good} 货仓上的 ${occupants.length} 名小弟空手而回。`,
      );
    }
  });

  // ---- 2) 港口与修船场格位 ----
  const obligations: InsuranceObligation[] = [];

  for (const placement of placements) {
    const spot = placement.spot;
    if (spot.kind !== 'port' && spot.kind !== 'shipyard') continue;

    const reward = spotReward(spot);
    const letter = 'ABC'[spot.slot] ?? '?';

    if (spot.kind === 'port') {
      const arrived = boats.some((b) => b.arrivedSlot === spot.slot);
      if (!arrived) {
        notes.push(`港口 ${letter} 无人抵达，${nameOf(placement.playerId)} 的小弟空手而回。`);
        continue;
      }
      lines.push({
        playerId: placement.playerId,
        amount: reward,
        reason: `港口 ${letter} 有船抵达，报酬 ${reward} 元`,
        source: 'bank',
      });
      continue;
    }

    const wrecked = boats.some((b) => b.shipyardSlot === spot.slot);
    if (!wrecked) {
      notes.push(`修船场 ${letter} 空置，${nameOf(placement.playerId)} 的小弟空手而回。`);
      continue;
    }
    lines.push({
      playerId: placement.playerId,
      amount: reward,
      reason: `修船场 ${letter} 有船进厂，赔偿 ${reward} 元`,
      source: 'insurance',
    });
  }

  // 保险理赔义务：每艘进修船场的船一笔
  for (const boat of boats) {
    if (boat.shipyardSlot === null) continue;
    const occupant = placements.find(
      (p) => p.spot.kind === 'shipyard' && p.spot.slot === boat.shipyardSlot,
    );
    obligations.push({
      slot: boat.shipyardSlot,
      amount: spotReward({ kind: 'shipyard', slot: boat.shipyardSlot }),
      payee: occupant ? occupant.playerId : null,
    });
  }

  // ---- 3) 结算到玩家 ----
  let working: Player[] = players.map((p) => ({ ...p }));

  const addCash = (playerId: PlayerId, amount: number): void => {
    if (amount === 0) return;
    working = working.map((p) => (p.id === playerId ? { ...p, cash: p.cash + amount } : p));
  };

  for (const line of lines) addCash(line.playerId, line.amount);

  // ---- 4) 保险仲介者理赔 ----
  const brokerPlacement = placements.find((p) => p.spot.kind === 'insurance');
  const broker = brokerPlacement ? brokerPlacement.playerId : null;
  const totalObligation = obligations.reduce((sum, o) => sum + o.amount, 0);

  let brokerPaid = 0;
  let bankCovered = 0;

  if (totalObligation > 0) {
    if (broker === null) {
      // 没有人担任保险仲介者：由海港钱箱负担
      bankCovered = totalObligation;
      notes.push(`无人担任保险仲介者，修船费 ${totalObligation} 元由海港钱箱负担。`);
    } else {
      // 规则：「在付出平底船修理费用之前，首先在航程中得到利润」→ 收益已在上一步入账
      const idx = working.findIndex((p) => p.id === broker);
      const current = working[idx];
      if (current) {
        const paid = payToBank(current, totalObligation, priceOf);
        if (paid.note) notes.push(paid.note);
        working = working.map((p, i) => (i === idx ? paid.player : p));
        brokerPaid = paid.paid;
        bankCovered = totalObligation - paid.paid;
        if (bankCovered > 0) {
          notes.push(
            `保险仲介者 ${nameOf(broker)} 付不出全部理赔，差额 ${bankCovered} 元由海港钱箱负担。`,
          );
        }
        if (paid.paid > 0) {
          notes.push(`保险仲介者 ${nameOf(broker)} 付出修船理赔 ${paid.paid} 元。`);
        }
      }
    }
  }

  const goodArrived = boats
    .filter((b) => b.arrivedSlot !== null && b.good !== null)
    .map((b) => b.good as GoodId);

  return {
    players: working,
    report: {
      lines,
      obligations,
      broker,
      brokerPaid,
      bankCovered,
      goodArrived,
      notes,
    },
  };
}
