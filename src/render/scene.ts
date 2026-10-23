import * as THREE from "three";
import { easeOutCubic } from "./anim";
import { getCardGeometry } from "./cards";
import { allSlots, BOARD_BOTTOM, BOARD_MARGIN, BOARD_TOP, BOARD_W, slotPlacement } from "./layout";

/** Felt table texture: base green + fine noise + a soft vignette. */
function createFeltTexture(): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "#1d5c31";
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 6000; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    ctx.fillStyle = Math.random() < 0.5 ? "rgba(255,255,255,0.025)" : "rgba(0,0,0,0.05)";
    ctx.fillRect(x, y, 1.4, 1.4);
  }

  const vignette = ctx.createRadialGradient(
    size / 2,
    size / 2,
    size * 0.25,
    size / 2,
    size / 2,
    size * 0.75,
  );
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(0,0,0,0.38)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3, 3);
  return texture;
}

function createTable(): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 60),
    new THREE.MeshStandardMaterial({
      map: createFeltTexture(),
      roughness: 0.95,
      metalness: 0,
    }),
  );
  mesh.receiveShadow = true;
  return mesh;
}

/** Subtle dark slots marking the stock, foundations, and tableau bases. */
function createSlots(): THREE.Group {
  const group = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0.22,
  });
  for (const ref of allSlots()) {
    const { x, y, z } = slotPlacement(ref);
    const mesh = new THREE.Mesh(getCardGeometry(), material);
    mesh.position.set(x, y, z - 0.005);
    group.add(mesh);
  }
  return group;
}

function createLights(): THREE.Light[] {
  const ambient = new THREE.AmbientLight(0xffffff, 0.8);
  const key = new THREE.DirectionalLight(0xffffff, 1.5);
  key.position.set(5, 8, 10);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -6;
  key.shadow.camera.right = 6;
  key.shadow.camera.top = 6;
  key.shadow.camera.bottom = -6;
  key.shadow.camera.near = 2;
  key.shadow.camera.far = 30;
  key.shadow.bias = -0.0005;
  return [ambient, key];
}

export interface SceneRig {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /**
   * Fit the camera to content down to `bottom` (see `contentBottom`).
   * With `animate` the camera glides to the new zoom; otherwise it snaps.
   */
  fitBounds(bottom: number, animate: boolean): void;
  /** Immediate refit to the current bounds (used on container resize). */
  resize(): void;
  /**
   * Multiply the manual zoom by `scale` (clamped to MIN/MAX_ZOOM) and
   * refit immediately. Wheel and pinch both feed this; the factor survives
   * resizes and state-driven refits.
   */
  zoomBy(scale: number): void;
  /** Advance any in-flight zoom tween; call from the render loop. */
  tick(): void;
  dispose(): void;
}

const ZOOM_MS = 550;
// Extra slack below the deepest card: keeps big stacks clear of the screen
// edge (browser chrome, rounded corners, fingers) instead of hugging it.
const BOTTOM_PAD = 1.1;
// Manual zoom (wheel/pinch) multiplies the fit distance; 1 is the default
// fit, lower factors zoom in, higher zoom out.
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2;

export function createSceneRig(container: HTMLElement): SceneRig {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.add(createTable());
  scene.add(createSlots());
  scene.add(...createLights());

  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);

  // Camera fitting tracks the content bottom (deepest tableau card) rather
  // than the static worst-case board height, so wide screens stay zoomed in.
  let fitBottom = BOARD_BOTTOM;
  let userZoom = 1;
  const applied = { dist: 0, cy: 0 };
  let zoom: {
    from: { dist: number; cy: number };
    to: { dist: number; cy: number };
    startAt: number;
  } | null = null;

  const fitTarget = (): { dist: number; cy: number } => {
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    renderer.setSize(w, h);
    camera.aspect = w / h;

    const top = BOARD_TOP + BOARD_MARGIN;
    const bottom = fitBottom - BOTTOM_PAD;
    const fitW = BOARD_W + BOARD_MARGIN * 2;
    const fitH = top - bottom;
    const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
    const distForHeight = fitH / 2 / Math.tan(halfFov);
    const distForWidth = fitW / 2 / Math.tan(halfFov) / camera.aspect;
    const dist = Math.max(distForHeight, distForWidth) * 1.02 * userZoom;

    return { dist, cy: (top + bottom) / 2 };
  };

  const applyCamera = (dist: number, cy: number): void => {
    applied.dist = dist;
    applied.cy = cy;
    camera.position.set(0, cy, dist);
    camera.lookAt(0, cy, 0);
    camera.updateProjectionMatrix();
  };

  const debugLog = (dist: number): void => {
    if (!location.search.includes("debug")) return;
    const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    console.info(
      `[rig] container=${w}x${h} aspect=${camera.aspect.toFixed(3)} dist=${dist.toFixed(2)} ` +
        `visibleW=${(2 * dist * Math.tan(halfFov) * camera.aspect).toFixed(2)} ` +
        `canvas=${renderer.domElement.width}x${renderer.domElement.height} style=${renderer.domElement.style.width}x${renderer.domElement.style.height}`,
    );
  };

  const snapToFit = (): void => {
    zoom = null;
    const { dist, cy } = fitTarget();
    applyCamera(dist, cy);
    debugLog(dist);
  };

  const fitBounds = (bottom: number, animate: boolean): void => {
    fitBottom = bottom;
    const target = fitTarget();
    const moved =
      Math.abs(target.dist - applied.dist) > 1e-3 || Math.abs(target.cy - applied.cy) > 1e-3;
    if (!animate || !moved) {
      zoom = null;
      applyCamera(target.dist, target.cy);
    } else {
      // Retarget mid-flight when the bounds change again before we arrive.
      zoom = { from: { ...applied }, to: target, startAt: performance.now() };
    }
    debugLog(target.dist);
  };

  const zoomBy = (scale: number): void => {
    const next = THREE.MathUtils.clamp(userZoom * scale, MIN_ZOOM, MAX_ZOOM);
    if (next === userZoom) return;
    userZoom = next;
    snapToFit();
  };

  const tick = (): void => {
    if (!zoom) return;
    const t = Math.min(1, (performance.now() - zoom.startAt) / ZOOM_MS);
    const e = easeOutCubic(t);
    applyCamera(
      zoom.from.dist + (zoom.to.dist - zoom.from.dist) * e,
      zoom.from.cy + (zoom.to.cy - zoom.from.cy) * e,
    );
    if (t >= 1) zoom = null;
  };

  snapToFit();

  const observer = new ResizeObserver(snapToFit);
  observer.observe(container);

  return {
    renderer,
    scene,
    camera,
    fitBounds,
    resize: snapToFit,
    zoomBy,
    tick,
    dispose() {
      observer.disconnect();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
