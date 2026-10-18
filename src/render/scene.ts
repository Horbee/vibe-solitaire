import * as THREE from "three";
import { getCardGeometry } from "./cards";
import { allSlots, BOARD_CENTER_Y, BOARD_H, BOARD_MARGIN, BOARD_W, slotPlacement } from "./layout";

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
  resize(): void;
  dispose(): void;
}

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

  const fitCamera = () => {
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    renderer.setSize(w, h);
    camera.aspect = w / h;

    const fitW = BOARD_W + BOARD_MARGIN * 2;
    const fitH = BOARD_H + BOARD_MARGIN * 2;
    const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
    const distForHeight = fitH / 2 / Math.tan(halfFov);
    const distForWidth = fitW / 2 / Math.tan(halfFov) / camera.aspect;
    const dist = Math.max(distForHeight, distForWidth) * 1.02;

    camera.position.set(0, BOARD_CENTER_Y, dist);
    camera.lookAt(0, BOARD_CENTER_Y, 0);
    camera.updateProjectionMatrix();
    if (location.search.includes("debug")) {
      console.info(
        `[rig] container=${w}x${h} aspect=${camera.aspect.toFixed(3)} dist=${dist.toFixed(2)} ` +
          `visibleW=${(2 * dist * Math.tan(halfFov) * camera.aspect).toFixed(2)} ` +
          `canvas=${renderer.domElement.width}x${renderer.domElement.height} style=${renderer.domElement.style.width}x${renderer.domElement.style.height}`,
      );
    }
  };
  fitCamera();

  const observer = new ResizeObserver(fitCamera);
  observer.observe(container);

  return {
    renderer,
    scene,
    camera,
    resize: fitCamera,
    dispose() {
      observer.disconnect();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
