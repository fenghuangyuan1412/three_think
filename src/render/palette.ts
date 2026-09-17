/**
 * 配色与共享材质。
 *
 * 主题：1821 年马尼拉港的黑市贸易 —— 深海、旧木、羊皮纸、黄铜。
 * 所有颜色集中在这里，避免散落到各处（agent.md §9：禁止魔术数字）。
 */
import * as THREE from 'three';

export const PALETTE = {
  waterDeep: 0x0a2531,
  water: 0x11404f,
  /** 棋盘木质外框 */
  frame: 0x4b3520,
  plate: 0x1d1710,
  plateEdge: 0x3a2c1e,
  /** 领航员岛（沙土） */
  island: 0x6f5c3c,
  /** 保险处建筑 */
  building: 0x5d4a34,
  /**
   * 码头 / 修船场的台面（浅木色）。
   * 特意用浅色：格位上要印深色数字，深色木台上会看不见（实测踩过）。
   */
  dock: 0xb09468,
  parchment: 0xcbb68e,
  parchmentAlt: 0xbfa87c,
  laneLine: 0x6d5c40,
  port: 0xd9c79b,
  shipyard: 0xb59f78,
  trackBg: 0x101f27,
  gold: 0xd9a441,
  goldDim: 0x8a6a2c,
  ink: 0x2c2419,
  hull: 0x7a4a2b,
  deck: 0xa9764a,
  sail: 0xece3cf,
  mast: 0x4a3421,
} as const;

/** 渲染层用到的颜色文本（Canvas 贴图需要 CSS 颜色字符串） */
export const CSS = {
  parchment: '#cbb68e',
  ink: '#2c2419',
  gold: '#d9a441',
  cream: '#f2ead9',
  trackBg: '#101f27',
  laneLine: '#6d5c40',
} as const;

export function standardMaterial(color: number, options: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.78, metalness: 0.06, ...options });
}

export function goldMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: PALETTE.gold,
    roughness: 0.32,
    metalness: 0.72,
    emissive: new THREE.Color(PALETTE.gold).multiplyScalar(0.12),
  });
}
