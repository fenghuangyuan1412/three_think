/**
 * 配色与共享材质。
 *
 * 主题：1821 年马尼拉港的黑市贸易 —— 热带潟湖、暖橙木栈、羊皮纸、黄铜。
 * v1.3 对照实拍棋盘提高饱和度（用户反馈：颜色要更艳）。
 * 所有颜色集中在这里，避免散落到各处（agent.md §9：禁止魔术数字）。
 */
import * as THREE from 'three';

export const PALETTE = {
  waterDeep: 0x0d3a40,
  water: 0x1d7a7e,
  /** 棋盘木质外框 */
  frame: 0x8a5426,
  plate: 0x2a2013,
  plateEdge: 0x6b4a26,
  /** 领航员岛（植被） */
  island: 0x4f9a4e,
  /** 保险处建筑 */
  building: 0x9a6b3f,
  /**
   * 码头 / 修船场的台面（浅木色）。
   * 特意用浅色：格位上要印深色数字，深色木台上会看不见（实测踩过）。
   */
  dock: 0xcf9a54,
  parchment: 0xe3cd97,
  parchmentAlt: 0xd4bb83,
  laneLine: 0x84663a,
  port: 0xefd9a6,
  shipyard: 0xd4b077,
  trackBg: 0x0e2a30,
  gold: 0xd9a441,
  goldDim: 0xa87f33,
  ink: 0x2c2419,
  hull: 0x96562c,
  deck: 0xc2854e,
  sail: 0xf5ecd8,
  mast: 0x5f3d20,
} as const;

/** 渲染层用到的颜色文本（Canvas 贴图需要 CSS 颜色字符串） */
export const CSS = {
  parchment: '#e3cd97',
  ink: '#241a0e',
  gold: '#d9a441',
  cream: '#f7f0dd',
  trackBg: '#0e2a30',
  laneLine: '#84663a',
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
