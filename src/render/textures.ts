/**
 * 把棋盘上「重复的小字」烘成一张 Canvas 贴图。
 *
 * 动机（agent.md §6 性能预算：draw call < 150）：
 * 3 条航道 × 14 格 = 42 个格子编号，若每格一个文字网格就是 42 次 draw call。
 * 烘成每航道一张长条贴图后，只需 3 次。价格轨同理，4×7=28 格压成 1 次。
 */
import * as THREE from 'three';
import { LANE_STRIP_PX, PRICE_TRACK_PX } from './coords';
import { CSS } from './palette';

function makeTexture(width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建 2D 画布上下文');
  draw(ctx);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}

/**
 * 单条航道的长条贴图：每格画边框与格子编号。
 *
 * 注意朝向：贴图最终会被平铺在 XZ 平面并绕 X 轴旋转 -90°，
 * 此时画布**顶部**对应世界的 -Z（远端，即马尼拉港方向）。
 * 所以格子 0 必须画在画布**底部**。
 */
export function createLaneStripTexture(spaceCount: number): THREE.CanvasTexture {
  const { cellW, cellH } = LANE_STRIP_PX;
  return makeTexture(cellW, cellH * spaceCount, (ctx) => {
    for (let space = 0; space < spaceCount; space += 1) {
      // 画布底部 = 格子 0
      const y = (spaceCount - 1 - space) * cellH;
      ctx.fillStyle = space % 2 === 0 ? CSS.parchment : '#d0b57f';
      ctx.fillRect(0, y, cellW, cellH);

      ctx.strokeStyle = CSS.laneLine;
      ctx.lineWidth = 12;
      ctx.strokeRect(6, y + 6, cellW - 12, cellH - 12);

      ctx.fillStyle = CSS.ink;
      ctx.font = '700 108px "Noto Sans SC","Microsoft YaHei",system-ui,sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(space), cellW / 2, y + cellH / 2);
    }
  });
}

/** 黑市价格轨：每种货物一行，每档一列，格子里印价格 */
export function createPriceTrackTexture(
  goods: readonly { readonly name: string }[],
  prices: readonly number[],
): THREE.CanvasTexture {
  const { cellW, cellH, rowLabelW, headerH } = PRICE_TRACK_PX;
  const width = rowLabelW + cellW * prices.length;
  const height = headerH + cellH * goods.length;

  return makeTexture(width, height, (ctx) => {
    ctx.fillStyle = CSS.trackBg;
    ctx.fillRect(0, 0, width, height);

    ctx.textBaseline = 'middle';

    // 表头
    ctx.fillStyle = CSS.gold;
    ctx.font = '700 84px "Noto Sans SC","Microsoft YaHei",system-ui,sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('黑市价格', 36, headerH / 2);

    // 每种货物一行：货物名 + 各档价格
    goods.forEach((good, row) => {
      const y = headerH + row * cellH;

      ctx.fillStyle = row % 2 === 0 ? '#143038' : '#0f2831';
      ctx.fillRect(0, y, width, cellH);

      ctx.fillStyle = CSS.cream;
      ctx.font = '700 80px "Noto Sans SC","Microsoft YaHei",system-ui,sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(good.name, 40, y + cellH / 2);

      prices.forEach((price, col) => {
        const x = rowLabelW + col * cellW;
        ctx.strokeStyle = '#33565f';
        ctx.lineWidth = 6;
        ctx.strokeRect(x + 4, y + 4, cellW - 8, cellH - 8);

        ctx.fillStyle = price >= 30 ? CSS.gold : '#cfe4e8';
        ctx.font = '600 80px "Noto Sans SC","Microsoft YaHei",system-ui,sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(String(price), x + cellW / 2, y + cellH / 2);
      });
    });
  });
}
