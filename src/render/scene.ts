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
  texture.repeat.set(6, 6); // keeps the felt grain at the same world scale
  return texture;
}

function createTable(): THREE.Mesh {
  // Large enough that a tilted camera never sees past the edge, even at
  // max zoom-out on a tall phone.
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(120, 120),
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
   * Fit the camera to content down to `bottom` (see `contentBottom`):
   * picks the orbit radius for the current tilt/aspect. With `animate`
   * the camera glides there; otherwise it snaps.
   */
  fitBounds(bottom: number, animate: boolean): void;
  /** Immediate refit to the current bounds (used on container resize). */
  resize(): void;
  /**
   * Multiply the manual zoom factor by `scale` (clamped to MIN/MAX_ZOOM)
   * and refit immediately. Wheel and pinch both feed this; the factor
   * survives resizes and state-driven refits.
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
// Manual zoom (wheel/pinch) multiplies the fit radius; 1 is the default
// fit, lower factors lean in, higher pull back.
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2;
// Seated at the tableau side of the table: the camera orbits the content
// center from BELOW the board (where the deep stacks grow), looking
// across toward the stock and foundations. A straight-down camera
// letterboxes a width-fitted board into a strip on tall phone screens;
// the tilt grows as the viewport narrows, so the near tableau rows —
// where the game actually happens — render large while the far row
// foreshortens. Wide screens keep a subtle tilt just for depth.
const MIN_TILT = THREE.MathUtils.degToRad(8);
const MAX_TILT = THREE.MathUtils.degToRad(50);
const TILT_WIDE_ASPECT = 1.5; // at or above this aspect: MIN_TILT
const TILT_NARROW_ASPECT = 0.5; // at or below this aspect: MAX_TILT
// NDC breathing room around the fitted board corners. The bottom gets
// extra: mobile browser chrome and gesture bars live there.
const PAD_X = 0.04;
const PAD_TOP = 0.04;
const PAD_BOTTOM = 0.08;
const FIT_SLACK = 1.02; // small safety on the binary-searched radius
const FIT_STEPS = 36; // binary search iterations (~1e-10 precision)

export function createSceneRig(container: HTMLElement): SceneRig {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  // Dark felt tone: if the camera ever glimpses past the table plane
  // (extreme aspect + zoom-out), the void reads as distant felt, not black.
  scene.background = new THREE.Color(0x0c2e1b);
  scene.add(createTable());
  scene.add(createSlots());
  scene.add(...createLights());

  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);

  // The camera orbits the vertical center of the content. Fitting tracks
  // the content bottom (deepest tableau card) rather than the static
  // worst-case board height, so wide screens stay zoomed in.
  interface Pose {
    /** Orbit radius from the look-at target. */
    radius: number;
    /** World y the camera looks at (vertical center of content). */
    cy: number;
    /** Radians from straight-down (0 = top-down). */
    tilt: number;
  }

  let fitBottom = BOARD_BOTTOM;
  let userZoom = 1;
  const applied: Pose = { radius: 0, cy: 0, tilt: 0 };
  let zoom: { from: Pose; to: Pose; startAt: number } | null = null;

  const tiltForAspect = (aspect: number): number => {
    const t = THREE.MathUtils.clamp(
      (TILT_WIDE_ASPECT - aspect) / (TILT_WIDE_ASPECT - TILT_NARROW_ASPECT),
      0,
      1,
    );
    const smooth = t * t * (3 - 2 * t);
    return MIN_TILT + (MAX_TILT - MIN_TILT) * smooth;
  };

  // Board y grows toward the far row (stock/foundations); the camera sits
  // at negative y — the tableau side, "below" the board — so the near
  // tableau stacks land at the bottom of the screen, large, and the far
  // row recedes toward the top.
  const poseCamera = (p: Pose): void => {
    camera.position.set(0, p.cy - Math.sin(p.tilt) * p.radius, Math.cos(p.tilt) * p.radius);
    camera.lookAt(0, p.cy, 0);
    camera.updateMatrixWorld();
  };

  /**
   * Smallest orbit that keeps every board corner on screen. Projective
   * maps preserve convexity, so the four z=0 corners bound the whole
   * board; the far-edge pair is repeated at flip height so in-place
   * reveals keep headroom. The projected quad shrinks monotonically as
   * the orbit widens — binary-search the radius.
   */
  const fitTarget = (): Pose => {
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();

    const top = BOARD_TOP + BOARD_MARGIN;
    const bottom = fitBottom - BOTTOM_PAD;
    const cy = (top + bottom) / 2;
    const tilt = tiltForAspect(camera.aspect);
    const halfW = BOARD_W / 2 + BOARD_MARGIN;
    const corners: THREE.Vector3[] = [
      new THREE.Vector3(-halfW, top, 0),
      new THREE.Vector3(halfW, top, 0),
      new THREE.Vector3(-halfW, bottom, 0),
      new THREE.Vector3(halfW, bottom, 0),
      new THREE.Vector3(-halfW, top, 1),
      new THREE.Vector3(halfW, top, 1),
    ];
    const probe = new THREE.Vector3();
    const fits = (radius: number): boolean => {
      poseCamera({ radius, cy, tilt });
      for (const c of corners) {
        probe.copy(c).project(camera);
        if (Math.abs(probe.x) > 1 - PAD_X) return false;
        if (probe.y > 1 - PAD_TOP || probe.y < -1 + PAD_BOTTOM) return false;
      }
      return true;
    };

    let lo = 0;
    let hi = 8;
    while (!fits(hi) && hi < 512) {
      lo = hi;
      hi *= 2;
    }
    for (let i = 0; i < FIT_STEPS; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) hi = mid;
      else lo = mid;
    }
    return { radius: hi * FIT_SLACK * userZoom, cy, tilt };
  };

  const applyCamera = (p: Pose): void => {
    applied.radius = p.radius;
    applied.cy = p.cy;
    applied.tilt = p.tilt;
    poseCamera(p);
  };

  const debugLog = (): void => {
    if (!location.search.includes("debug")) return;
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    console.info(
      `[rig] container=${w}x${h} aspect=${camera.aspect.toFixed(3)} ` +
        `radius=${applied.radius.toFixed(2)} ` +
        `tilt=${THREE.MathUtils.radToDeg(applied.tilt).toFixed(1)}deg ` +
        `zoom=${userZoom.toFixed(2)} canvas=${renderer.domElement.width}x${renderer.domElement.height}`,
    );
  };

  const snapToFit = (): void => {
    zoom = null;
    applyCamera(fitTarget());
    debugLog();
  };

  const fitBounds = (bottom: number, animate: boolean): void => {
    fitBottom = bottom;
    const target = fitTarget();
    const moved =
      Math.abs(target.radius - applied.radius) > 1e-3 ||
      Math.abs(target.cy - applied.cy) > 1e-3 ||
      Math.abs(target.tilt - applied.tilt) > 1e-6;
    if (!animate || !moved) {
      zoom = null;
      applyCamera(target);
    } else {
      // Retarget mid-flight when the bounds change again before we arrive.
      zoom = { from: { ...applied }, to: target, startAt: performance.now() };
    }
    debugLog();
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
    applyCamera({
      radius: zoom.from.radius + (zoom.to.radius - zoom.from.radius) * e,
      cy: zoom.from.cy + (zoom.to.cy - zoom.from.cy) * e,
      tilt: zoom.from.tilt + (zoom.to.tilt - zoom.from.tilt) * e,
    });
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
