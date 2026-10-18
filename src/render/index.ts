import * as THREE from "three";
import { createAtlasTexture } from "./atlas";
import { Animator } from "./anim";
import { CardView, createCardViews, getCardGeometry } from "./cards";
import { cardPlacement, slotPlacement } from "./layout";
import type { Placement } from "./layout";
import { createSceneRig } from "./scene";
import type { SceneRig } from "./scene";
import { createDeck } from "../game/deck";
import type { Card, GameState, PileRef } from "../game/types";

interface Pose {
  x: number;
  y: number;
  z: number;
  faceUp: boolean;
  /** Pile the card lives in (and its index) — used to classify transitions. */
  ref?: PileRef;
  index?: number;
}

const ARC_LIFT = 0.35; // z bump while a card is in transit

export interface GameRenderer {
  readonly rig: SceneRig;
  readonly cardViews: Map<string, CardView>;
  readonly animator: Animator;
  /** Instant (non-animated) synchronization of the scene to a state. */
  syncState(state: GameState): void;
  /** Animated transition between two states (moves, draws, flips, undo). */
  animateStateChange(prev: GameState, next: GameState): Promise<void>;
  /** Deal animation: cards fly out of the stock one by one. */
  animateDeal(state: GameState): Promise<void>;
  /** Show drop-target style highlights at the given placements. */
  setHighlights(placements: Placement[]): void;
  clearHighlights(): void;
  /** Highlight momentarily (e.g. for hints). */
  flashHighlights(placements: Placement[], durationMs?: number): void;
  start(): void;
  stop(): void;
  dispose(): void;
}

export async function createGameRenderer(container: HTMLElement): Promise<GameRenderer> {
  const atlas = await createAtlasTexture();
  const rig = createSceneRig(container);
  const animator = new Animator();

  // One view per card in the deck, all hidden until placed.
  const cardViews = createCardViews(createDeck(), atlas);
  for (const view of cardViews.values()) {
    view.group.visible = false;
    rig.scene.add(view.group);
  }

  const locate = (state: GameState): { ref: PileRef; pile: Card[] }[] => [
    { ref: { type: "stock", index: 0 }, pile: state.stock },
    { ref: { type: "waste", index: 0 }, pile: state.waste },
    ...state.tableau.map((pile, index) => ({
      ref: { type: "tableau", index } as PileRef,
      pile,
    })),
    ...state.foundations.map((pile, index) => ({
      ref: { type: "foundation", index } as PileRef,
      pile,
    })),
  ];

  /** Absolute pose of every card in a state. */
  const posesOf = (state: GameState): Map<string, Pose> => {
    const poses = new Map<string, Pose>();
    for (const { ref, pile } of locate(state)) {
      pile.forEach((card, stackIndex) => {
        const p = cardPlacement(state, ref, stackIndex);
        poses.set(card.id, {
          x: p.x,
          y: p.y,
          z: p.z,
          faceUp: card.faceUp,
          ref,
          index: stackIndex,
        });
      });
    }
    return poses;
  };

  const syncState = (state: GameState): void => {
    animator.cancelAll();
    for (const view of cardViews.values()) view.group.visible = false;
    for (const { ref, pile } of locate(state)) {
      pile.forEach((card, stackIndex) => {
        const view = cardViews.get(card.id);
        if (!view) return;
        view.setFaceUp(card.faceUp);
        view.setPlacement(cardPlacement(state, ref, stackIndex));
        view.group.visible = true;
      });
    }
  };

  /** Tween one card between two poses; flips the card when faceUp differs. */
  const tweenCard = (
    view: CardView,
    from: Pose,
    to: Pose,
    delay: number,
    duration: number,
  ): Promise<void> => {
    const group = view.group;
    const fromRot = from.faceUp ? 0 : Math.PI;
    const toRot = to.faceUp ? 0 : Math.PI;
    group.visible = true;
    group.position.set(from.x, from.y, from.z);
    group.rotation.y = fromRot;
    return animator
      .add({
        key: view.card.id,
        duration,
        delay,
        update: (t) => {
          group.position.set(
            from.x + (to.x - from.x) * t,
            from.y + (to.y - from.y) * t,
            from.z + (to.z - from.z) * t + Math.sin(t * Math.PI) * ARC_LIFT,
          );
          if (from.faceUp !== to.faceUp) {
            // Hold the flip until the second half of the flight.
            const rt = Math.min(1, Math.max(0, (t - 0.35) / 0.65));
            group.rotation.y = fromRot + (toRot - fromRot) * rt;
          }
        },
      })
      .then(() => {
        group.position.set(to.x, to.y, to.z);
        group.rotation.y = toRot;
      });
  };

  const animateStateChange = async (prev: GameState, next: GameState): Promise<void> => {
    const from = posesOf(prev);
    const to = posesOf(next);

    // Sequencing: cards drawn from the stock fly after existing waste cards
    // have shifted aside, staggered by draw order — flight paths never cross.
    const drawnIds = [...to.entries()]
      .filter(([id, p]) => p.ref?.type === "waste" && from.get(id)?.ref?.type === "stock")
      .sort((a, b) => (a[1].index ?? 0) - (b[1].index ?? 0))
      .map(([id]) => id);
    const drawOrder = new Map(drawnIds.map((id, i) => [id, i]));

    const jobs: Promise<void>[] = [];
    for (const [id, dest] of to) {
      const start = from.get(id);
      const view = cardViews.get(id);
      if (!view) continue;
      const moved =
        !start ||
        Math.abs(start.x - dest.x) > 1e-4 ||
        Math.abs(start.y - dest.y) > 1e-4 ||
        Math.abs(start.z - dest.z) > 1e-4;
      const flipped = start !== undefined && start.faceUp !== dest.faceUp;
      if (!moved && !flipped) {
        view.setFaceUp(dest.faceUp);
        view.setPlacement(dest);
        view.group.visible = true;
        continue;
      }

      let delay = 0;
      let duration = 260;
      const srcType = start?.ref?.type;
      const dstType = dest.ref?.type;
      if (drawOrder.has(id)) {
        delay = 110 + drawOrder.get(id)! * 90; // stock -> waste draw
        duration = 240;
      } else if (srcType === "waste" && dstType === "waste") {
        duration = 130; // fast shift out of the way first
      } else if (srcType === "waste" && dstType === "stock") {
        delay = (dest.index ?? 0) * 8; // recycle sweep
        duration = 200;
      }
      jobs.push(tweenCard(view, start ?? defaultSpawnPose(), dest, delay, duration));
    }
    await Promise.all(jobs);
    syncState(next);
  };

  const defaultSpawnPose = (): Pose => {
    const s = slotPlacement({ type: "stock", index: 0 });
    return { x: s.x, y: s.y, z: s.z, faceUp: false };
  };

  const animateDeal = async (state: GameState): Promise<void> => {
    const to = posesOf(state);
    const jobs: Promise<void>[] = [];
    const spawn = defaultSpawnPose();

    // Tableau cards fly out in deal order (row-major), then the stock lands.
    for (let col = 0; col < 7; col++) {
      const pile = state.tableau[col];
      for (let row = 0; row < pile.length; row++) {
        const id = pile[row].id;
        const view = cardViews.get(id);
        const dest = to.get(id);
        if (!view || !dest) continue;
        jobs.push(tweenCard(view, spawn, dest, (row * 7 + col) * 24, 220));
      }
    }
    for (const card of state.stock) {
      const view = cardViews.get(card.id);
      const dest = to.get(card.id);
      if (!view || !dest) continue;
      view.setFaceUp(false);
      view.setPlacement(dest);
      view.group.visible = true;
    }
    await Promise.all(jobs);
    syncState(state);
  };

  let running = false;
  const loop = () => {
    animator.tick();
    rig.renderer.render(rig.scene, rig.camera);
  };

  // ---- shared highlight meshes (drop targets, hints) ----
  const highlights: THREE.Mesh[] = [];
  const clearHighlights = (): void => {
    for (const mesh of highlights) {
      rig.scene.remove(mesh);
      (mesh.material as THREE.Material).dispose();
    }
    highlights.length = 0;
  };
  const setHighlights = (placements: Placement[]): void => {
    clearHighlights();
    for (const p of placements) {
      const mesh = new THREE.Mesh(
        getCardGeometry(),
        new THREE.MeshBasicMaterial({
          color: 0xffe28a,
          transparent: true,
          opacity: 0.4,
          depthWrite: false,
        }),
      );
      mesh.position.set(p.x, p.y, p.z + 0.03);
      rig.scene.add(mesh);
      highlights.push(mesh);
    }
  };
  const flashHighlights = (placements: Placement[], durationMs = 1400): void => {
    setHighlights(placements);
    window.setTimeout(clearHighlights, durationMs);
  };

  return {
    rig,
    cardViews,
    animator,
    syncState,
    animateStateChange,
    animateDeal,
    setHighlights,
    clearHighlights,
    flashHighlights,
    start() {
      if (running) return;
      running = true;
      rig.renderer.setAnimationLoop(loop);
    },
    stop() {
      running = false;
      rig.renderer.setAnimationLoop(null);
    },
    dispose() {
      rig.dispose();
    },
  };
}

/** Raycast helper: find the card id under a pointer event, if any. */
export function pickCard(
  rig: SceneRig,
  cardViews: Map<string, CardView>,
  clientX: number,
  clientY: number,
): string | null {
  const rect = rig.renderer.domElement.getBoundingClientRect();
  const pointer = new THREE.Vector2(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  );
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(pointer, rig.camera);
  const meshes = [...cardViews.values()]
    .filter((v) => v.group.visible)
    .flatMap((v) => v.group.children);
  const hits = raycaster.intersectObjects(meshes, false);
  return hits.length > 0 ? (hits[0].object.userData.cardId as string) : null;
}
