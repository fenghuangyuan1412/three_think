/**
 * 平底船（banca）的程序化模型。
 *
 * 船体由基础几何体拼成：船身 + 船首三角 + 桅杆 + 帆 + 船舷描边。
 * 几何不依赖外部模型资源；v1.3 起船身/甲板贴 HD 材质皮肤（render/skins.ts）。
 */
import * as THREE from 'three';
import { PALETTE, standardMaterial } from './palette';
import { ResourceBag } from './resources';
import { skinTexture } from './skins';

export interface BoatHandle {
  readonly group: THREE.Group;
  dispose(): void;
}

/** 船的吃水高度：贴在水面上方一点点 */
export const BOAT_WATERLINE_Y = 0.16;

export function createBoat(): BoatHandle {
  const group = new THREE.Group();
  const bag = new ResourceBag();
  const track = bag.geo.bind(bag);
  const trackMat = bag.mat.bind(bag);
  const trackTex = bag.tex.bind(bag);

  const hullMat = trackMat(standardMaterial(0xffffff, {
    map: trackTex(skinTexture('hullOak', 2, 1)),
    roughness: 0.86,
  }));
  const deckMat = trackMat(standardMaterial(0xffffff, {
    map: trackTex(skinTexture('deckTeak', 1, 1)),
    roughness: 0.8,
  }));
  const trimMat = trackMat(standardMaterial(PALETTE.gold, { roughness: 0.35, metalness: 0.6 }));
  const mastMat = trackMat(standardMaterial(PALETTE.mast, { roughness: 0.9 }));
  const sailMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: PALETTE.sail,
      roughness: 0.95,
      side: THREE.DoubleSide,
    }),
  );

  // 船身
  const hull = new THREE.Mesh(track(new THREE.BoxGeometry(0.6, 0.22, 1.12)), hullMat);
  hull.position.y = 0.11;
  hull.castShadow = true;
  group.add(hull);

  // 甲板（略窄，形成船舷边缘的层次）
  const deck = new THREE.Mesh(track(new THREE.BoxGeometry(0.48, 0.05, 0.96)), deckMat);
  deck.position.y = 0.24;
  group.add(deck);

  // 船首：四棱锥，尖端朝 -Z（马尼拉方向）
  const bow = new THREE.Mesh(track(new THREE.ConeGeometry(0.3, 0.44, 4)), hullMat);
  bow.position.set(0, 0.11, -0.76);
  bow.rotation.set(-Math.PI / 2, 0, Math.PI / 4);
  bow.castShadow = true;
  group.add(bow);

  // 船舷描边
  const trim = new THREE.Mesh(track(new THREE.BoxGeometry(0.64, 0.035, 1.16)), trimMat);
  trim.position.y = 0.215;
  group.add(trim);

  // 桅杆
  const mast = new THREE.Mesh(track(new THREE.CylinderGeometry(0.032, 0.032, 0.78, 8)), mastMat);
  mast.position.set(0, 0.65, 0.05);
  group.add(mast);

  // 帆
  const sail = new THREE.Mesh(track(new THREE.PlaneGeometry(0.5, 0.46, 1, 1)), sailMat);
  sail.position.set(0, 0.68, 0.06);
  group.add(sail);

  // 帆的横桁
  const yard = new THREE.Mesh(track(new THREE.CylinderGeometry(0.022, 0.022, 0.56, 6)), mastMat);
  yard.position.set(0, 0.9, 0.06);
  yard.rotation.z = Math.PI / 2;
  group.add(yard);

  return {
    group,
    dispose() {
      bag.dispose();
    },
  };
}
