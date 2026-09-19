/**
 * 渲染资源的集中统领（agent.md §9：禁止散落魔术数）。
 *
 * - 货物颜色：骰子贴皮、货仓板块、价格标记共用同一份色值，
 *   与 config/board-layout 的 GOODS 颜色名一一对应，但**色值只写在这里**。
 * - ResourceBag：几何体/材质的登记与释放，各渲染模块不再各自手写追踪数组。
 */
import type { GoodId } from '../core/types';

/** 四种货物的 3D 色值（来源：官方规则书 Abb. 2b 开局黑市插图配色） */
export const GOOD_HEX: Record<GoodId, number> = {
  nutmeg: 0x7a4a2b,
  silk: 0x35558f,
  ginseng: 0xc9b27a,
  jade: 0x2f7a52,
};

export function goodHex(good: string): number {
  return GOOD_HEX[good as GoodId] ?? 0x888888;
}

/** Canvas 贴图 / CSS 用的颜色字符串（'#rrggbb'） */
export function goodHexCss(good: string): string {
  return `#${goodHex(good).toString(16).padStart(6, '0')}`;
}

/** 几何体与材质的登记袋：谁创建谁登记，dispose 时统一释放 */
export class ResourceBag {
  private readonly geometries: { dispose(): void }[] = [];
  private readonly materials: { dispose(): void }[] = [];

  geo<T extends { dispose(): void }>(g: T): T {
    this.geometries.push(g);
    return g;
  }

  mat<T extends { dispose(): void }>(m: T): T {
    this.materials.push(m);
    return m;
  }

  /** 贴图与材质同栈回收（都只需要 dispose） */
  tex<T extends { dispose(): void }>(t: T): T {
    this.materials.push(t);
    return t;
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.geometries.length = 0;
    this.materials.length = 0;
  }
}
