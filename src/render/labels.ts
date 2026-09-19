/**
 * 程序化文字标签。
 *
 * 第一版不使用任何外部美术资源（用户已确认「程序化几何体」），
 * 所以棋盘上的中文全部用 Canvas 贴图生成，不依赖字体文件。
 *
 * 资源纪律（agent.md §6）：贴图带缓存，且提供 dispose()，避免切换场景后显存不回落。
 */
import * as THREE from 'three';

export interface LabelOptions {
  /** 画布内的字号（像素），影响清晰度不影响世界尺寸 */
  readonly fontSize?: number;
  readonly color?: string;
  readonly background?: string;
  readonly bold?: boolean;
  /** 标签在世界中的高度（宽度按比例） */
  readonly worldHeight?: number;
  /** 贴图透明度 */
  readonly opacity?: number;
}

type Resolved = Required<LabelOptions>;

const DEFAULTS: Resolved = {
  // 字号只决定贴图分辨率（世界尺寸由 worldHeight 定）。64px 中文在斜视角下会被
  // 缩采样糊掉，实测看不清，整体提到 112px 做超采样。
  fontSize: 112,
  color: '#f2ead9',
  background: 'transparent',
  bold: false,
  worldHeight: 0.42,
  opacity: 1,
};

const FONT_STACK =
  '"Noto Sans SC","PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif';

/** '#rrggbb'/'#rgb' → 相对亮度（0~1）；解析不了当作浅色字处理 */
function colorLuminance(css: string): number {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(css.trim())?.[1];
  if (!hex) return 1;
  const full = hex.length === 3 ? hex.replace(/./g, (c) => c + c) : hex;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const textureCache = new Map<string, THREE.CanvasTexture>();

function resolve(options: LabelOptions): Resolved {
  return { ...DEFAULTS, ...options };
}

/** 生成（或复用）一张文字贴图。`text` 支持用 `\n` 换行 */
export function createTextTexture(text: string, options: LabelOptions = {}): THREE.CanvasTexture {
  const o = resolve(options);
  const key = `${text}|${o.fontSize}|${o.color}|${o.background}|${o.bold}`;
  const cached = textureCache.get(key);
  if (cached) return cached;

  const font = `${o.bold ? '700' : '500'} ${o.fontSize}px ${FONT_STACK}`;
  // 带底色药丸时需要留白；纯文字则要紧贴，否则字形只占贴图高度的一半，
  // 看上去会比设定的 worldHeight 小一半（这是实测踩过的坑）。
  const hasBackground = o.background !== 'transparent';
  const pad = Math.round(o.fontSize * (hasBackground ? 0.3 : 0.08));

  const lines = text.split('\n');
  const lineHeight = Math.ceil(o.fontSize * 1.18);

  const measureCanvas = document.createElement('canvas');
  const measureCtx = measureCanvas.getContext('2d');
  if (!measureCtx) throw new Error('无法创建 2D 画布上下文，文字标签无法生成');
  measureCtx.font = font;
  const textWidth = Math.max(...lines.map((line) => Math.ceil(measureCtx.measureText(line).width)), 1);

  const width = textWidth + pad * 2;
  const height =
    hasBackground && lines.length === 1
      ? Math.ceil(o.fontSize * 1.35) + pad * 2
      : lineHeight * lines.length + pad * 2;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建 2D 画布上下文，文字标签无法生成');

  if (hasBackground) {
    ctx.fillStyle = o.background;
    const r = Math.min(height / 2, 18);
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.lineTo(width - r, 0);
    ctx.quadraticCurveTo(width, 0, width, r);
    ctx.lineTo(width, height - r);
    ctx.quadraticCurveTo(width, height, width - r, height);
    ctx.lineTo(r, height);
    ctx.quadraticCurveTo(0, height, 0, height - r);
    ctx.lineTo(0, r);
    ctx.quadraticCurveTo(0, 0, r, 0);
    ctx.closePath();
    ctx.fill();
  }

  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // 无底色的字漂在木纹/水面上，缩采样后最先糊：给字描一圈反差光晕。
  // 深字配浅晕、浅字配深晕，任何台面都拉得开对比。
  const halo = !hasBackground && colorLuminance(o.color) < 0.5
    ? 'rgba(245, 239, 221, 0.8)'
    : 'rgba(6, 14, 20, 0.75)';
  const blockHeight = lineHeight * lines.length;
  lines.forEach((line, i) => {
    const y = (height - blockHeight) / 2 + lineHeight * (i + 0.5);
    if (!hasBackground) {
      ctx.strokeStyle = halo;
      ctx.lineJoin = 'round';
      ctx.miterLimit = 2;
      ctx.lineWidth = o.fontSize * 0.12;
      ctx.strokeText(line, width / 2, y);
    }
    ctx.fillStyle = o.color;
    ctx.fillText(line, width / 2, y);
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  // 标签平贴在斜切台面上，斜视角是各向异性缩采样，不开这个必糊
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  textureCache.set(key, texture);
  return texture;
}

/**
 * 平贴在棋盘上的文字（绕 X 轴 -90°，朝上）。
 * 用于棋盘本身印刷的文字：航道编号、港口/修船场空格、价格刻度。
 */
export function createFlatLabel(text: string, options: LabelOptions = {}): THREE.Mesh {
  const o = resolve(options);
  const texture = createTextTexture(text, o);
  const aspect = texture.image.width / texture.image.height;
  const geometry = new THREE.PlaneGeometry(o.worldHeight * aspect, o.worldHeight);
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity: o.opacity,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

/**
 * 始终面向相机的文字。用于棋子、船只等需要从任意角度看都清晰的标签。
 */
export function createBillboardLabel(text: string, options: LabelOptions = {}): THREE.Sprite {
  const o = resolve(options);
  const texture = createTextTexture(text, o);
  const aspect = texture.image.width / texture.image.height;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    opacity: o.opacity,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(o.worldHeight * aspect, o.worldHeight, 1);
  return sprite;
}

/** 释放所有缓存贴图。切换对局/卸载场景时调用，避免显存泄漏。 */
export function disposeLabelTextures(): void {
  for (const texture of textureCache.values()) texture.dispose();
  textureCache.clear();
}
