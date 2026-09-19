/**
 * 渲染场景：渲染器、相机、光照、循环。
 *
 * 相机约束（见 .dsh/skills/threejs-game-dev/SKILL.md §二）：
 * 限制极角与距离，禁止翻滚到棋盘背面；关闭平移，避免玩家把棋盘拖出视野。
 *
 * 取景方式：不写死距离，而是按棋盘包围范围与当前 fov / aspect 反推相机距离。
 * 这样改棋盘布局或改窗口尺寸都不会把内容截断。
 *
 * 生命周期（agent.md §6）：ResizeObserver 与动画循环都必须能被显式摘除。
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { BOARD_SIZE, CAMERA_TARGET, framingProbePoints } from './coords';

export interface RenderStats {
  /** draw call 数 */
  readonly calls: number;
  /** 三角形数 */
  readonly triangles: number;
  /** 帧率（滑动平均） */
  readonly fps: number;
}

export interface SceneHandle {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly controls: OrbitControls;
  readonly canvas: HTMLCanvasElement;
  onStats(callback: (stats: RenderStats) => void): void;
  /** 每帧回调，参数为距上一帧的秒数（供船只补间等使用） */
  onFrame(callback: (deltaSeconds: number) => void): void;
  dispose(): void;
}

/** 相机俯角（弧度）：46°，兼顾全局视野与立体感 */
const CAMERA_TILT = (46 * Math.PI) / 180;

/** 取景余量：1.03 表示留 3% 边距，避免内容贴边 */
const FIT_MARGIN = 1.03;

export function createScene(container: HTMLElement): SceneHandle {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  // 阴影在桌面上开启，窄屏（移动端）先关掉 —— agent.md §6
  const wantShadows = window.innerWidth >= 900;
  renderer.shadowMap.enabled = wantShadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const canvas = renderer.domElement;
  canvas.style.display = 'block';
  container.appendChild(canvas);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x06222a);
  scene.fog = new THREE.Fog(0x06222a, 46, 96);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 260);
  const target = new THREE.Vector3(CAMERA_TARGET.x, 0, CAMERA_TARGET.z);

  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(target);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  // 禁止把棋盘拖出视野；也不允许转到棋盘背面
  controls.enablePan = false;
  controls.minPolarAngle = Math.PI / 6;
  controls.maxPolarAngle = Math.PI / 2.2;
  controls.minDistance = 10;
  controls.maxDistance = 64;

  /**
   * 自动取景。
   *
   * 不用解析公式：倾斜的大平面上，近端的点离相机比注视点近得多，
   * 视锥在那一侧窄得多，按注视点距离算出来的可见范围会偏大（实测右端超出 32%）。
   * 因此改成二分搜索——直接问「这个距离下，所有关键点是否都落在视口内」。
   */
  const probes = framingProbePoints().map((p) => new THREE.Vector3(p.x, p.y, p.z));

  function placeAt(distance: number): void {
    camera.position.set(
      target.x,
      Math.sin(CAMERA_TILT) * distance,
      target.z + Math.cos(CAMERA_TILT) * distance,
    );
    camera.lookAt(target);
    camera.updateMatrixWorld(true);
  }

  function fitsAt(distance: number): boolean {
    placeAt(distance);
    for (const probe of probes) {
      const ndc = probe.clone().project(camera);
      if (ndc.x < -1 || ndc.x > 1 || ndc.y < -1 || ndc.y > 1) return false;
    }
    return true;
  }

  function frameCamera(): void {
    let near = 6;
    let far = 240;
    for (let i = 0; i < 26; i += 1) {
      const mid = (near + far) / 2;
      if (fitsAt(mid)) far = mid;
      else near = mid;
    }
    // 二分找到的是"刚好装下"，再退后 FIT_MARGIN 倍留出边距
    placeAt(Math.min(far * FIT_MARGIN, 240));
    controls.target.copy(target);
    controls.update();
  }

  // ---------------------------------------------------------------- 光照

  const hemi = new THREE.HemisphereLight(0xdff2fa, 0x3a4a52, 1.0);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff2d6, 1.7);
  sun.position.set(target.x + 10, 20, target.z + 12);
  sun.target.position.copy(target);
  scene.add(sun);
  scene.add(sun.target);

  if (wantShadows) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.bias = -0.0009;
    const shadowCamera = sun.shadow.camera;
    shadowCamera.left = -BOARD_SIZE.width * 0.75;
    shadowCamera.right = BOARD_SIZE.width * 0.75;
    shadowCamera.top = BOARD_SIZE.depth * 0.75;
    shadowCamera.bottom = -BOARD_SIZE.depth * 0.75;
    shadowCamera.near = 1;
    shadowCamera.far = 80;
    shadowCamera.updateProjectionMatrix();
  }

  // 补一盏冷色边光，让船与平台的轮廓更清楚
  const rim = new THREE.DirectionalLight(0x8fd0e4, 0.45);
  rim.position.set(target.x - 14, 9, target.z - 16);
  scene.add(rim);

  // ---------------------------------------------------------------- 循环

  let statsCallback: ((stats: RenderStats) => void) | null = null;
  let frameCallback: ((deltaSeconds: number) => void) | null = null;
  let fps = 0;
  let lastTime = performance.now();
  let lastReport = 0;
  let framed = false;

  const resize = (): void => {
    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(height, 1);
    camera.updateProjectionMatrix();
    // 只在首次确定尺寸时自动取景；之后交给玩家的轨道操作，不再抢夺相机
    if (!framed && width > 0 && height > 0) {
      frameCamera();
      framed = true;
    }
  };

  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();

  renderer.setAnimationLoop((time) => {
    const deltaMs = time - lastTime;
    lastTime = time;
    const deltaSeconds = Math.min(deltaMs / 1000, 0.1);
    if (deltaMs > 0) fps = fps === 0 ? 1000 / deltaMs : fps * 0.9 + (1000 / deltaMs) * 0.1;

    frameCallback?.(deltaSeconds);
    controls.update();
    renderer.render(scene, camera);

    // 每 500ms 汇报一次统计，避免频繁触碰 DOM
    if (statsCallback && time - lastReport > 500) {
      lastReport = time;
      statsCallback({
        calls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        fps: Math.round(fps),
      });
    }
  });

  return {
    scene,
    camera,
    renderer,
    controls,
    canvas,
    onStats(callback) {
      statsCallback = callback;
    },
    onFrame(callback) {
      frameCallback = callback;
    },
    dispose() {
      renderer.setAnimationLoop(null);
      observer.disconnect();
      controls.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}
