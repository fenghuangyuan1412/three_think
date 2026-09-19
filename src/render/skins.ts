/**
 * HD 材质皮肤（v1.3 建模精细化）。
 *
 * 几何仍然全程序化，只把「大面积台面」换成 AI 生成的无缝贴图
 * （Meowa game-assets skill 生成，来源与提示词登记在 docs/resource-registry.md）。
 * 贴图在模块级缓存、跨场景复用，卸载时调用 disposeSkins()。
 */
import * as THREE from 'three';
import deckTeakUrl from '../../assets/textures/deck_teak.webp';
import hullOakUrl from '../../assets/textures/hull_oak_dark.webp';
import parchmentUrl from '../../assets/textures/paper_parchment.webp';
import waterTealUrl from '../../assets/textures/water_teal.webp';
import dockPineUrl from '../../assets/textures/dock_pine_light.webp';

export type SkinName = 'deckTeak' | 'hullOak' | 'parchment' | 'waterTeal' | 'dockPine';

const URLS: Record<SkinName, string> = {
  deckTeak: deckTeakUrl,
  hullOak: hullOakUrl,
  parchment: parchmentUrl,
  waterTeal: waterTealUrl,
  dockPine: dockPineUrl,
};

const baseTextures = new Map<SkinName, THREE.Texture>();

/**
 * 取一张贴图（clone 出独立的 repeat/offset，可放心按面尺寸设置平铺）。
 * 底层像素共享，只加载一次。
 */
export function skinTexture(name: SkinName, repeatX = 1, repeatY = 1): THREE.Texture {
  let base = baseTextures.get(name);
  if (!base) {
    base = new THREE.TextureLoader().load(URLS[name]);
    base.colorSpace = THREE.SRGBColorSpace;
    base.anisotropy = 8;
    base.wrapS = THREE.RepeatWrapping;
    base.wrapT = THREE.RepeatWrapping;
    baseTextures.set(name, base);
  }
  const texture = base.clone();
  texture.needsUpdate = true;
  texture.repeat.set(repeatX, repeatY);
  return texture;
}

/** 释放所有皮肤贴图（页面卸载时调用；场景级资源仍走 ResourceBag） */
export function disposeSkins(): void {
  for (const texture of baseTextures.values()) texture.dispose();
  baseTextures.clear();
}
