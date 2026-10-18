import * as THREE from "three";
import type { CardLocation, GameController } from "../controller";
import type { SoundEngine } from "../audio/index";
import type { CardView } from "./cards";
import type { GameRenderer } from "./index";
import { pickCard } from "./index";
import { CARD_H, CARD_W, cardPlacement, DRAG_Z, nextPlacement, slotPlacement } from "./layout";
import type { Placement } from "./layout";
import type { PileRef } from "../game/types";

const DRAG_SLOP_PX = 5;
const DOUBLE_TAP_MS = 320;
const DOUBLE_TAP_PX = 24;

interface DragState {
  from: PileRef;
  count: number;
  views: CardView[];
  /** Pointer-to-lead-card offset captured at drag start (world units). */
  grabDx: number;
  grabDy: number;
  /** Per-card offset relative to the lead card (world units). */
  followers: { dx: number; dy: number; dz: number }[];
  startX: number;
  startY: number;
  active: boolean;
}

/**
 * Pointer interaction: click stock to draw, drag cards/runs onto drop targets,
 * double-click to auto-send to a foundation. Mouse and touch via pointer events.
 */
export class InputHandler {
  private drag: DragState | null = null;
  private pendingStockClick: { x: number; y: number } | null = null;
  private lastTap: { x: number; y: number; time: number } | null = null;
  private readonly canvas: HTMLCanvasElement;
  private readonly controller: GameController;
  private readonly renderer: GameRenderer;
  private readonly sounds?: SoundEngine;

  constructor(controller: GameController, renderer: GameRenderer, sounds?: SoundEngine) {
    this.controller = controller;
    this.renderer = renderer;
    this.sounds = sounds;
    this.canvas = renderer.rig.renderer.domElement;
    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    this.canvas.addEventListener("pointermove", this.onPointerMove);
    this.canvas.addEventListener("pointerup", this.onPointerUp);
    this.canvas.addEventListener("pointercancel", this.onPointerCancel);
    this.canvas.addEventListener("dblclick", this.onDoubleClick);
    this.canvas.addEventListener("contextmenu", this.onContextMenu);
    this.canvas.style.touchAction = "none";
  }

  dispose(): void {
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointercancel", this.onPointerCancel);
    this.canvas.removeEventListener("dblclick", this.onDoubleClick);
    this.canvas.removeEventListener("contextmenu", this.onContextMenu);
  }

  // ---------------------------------------------------------------- events

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    const { controller } = this;
    if (controller.state.status !== "playing") return;

    const world = this.pointerWorld(e, 0);
    const cardId = pickCard(this.renderer.rig, this.renderer.cardViews, e.clientX, e.clientY);

    if (!cardId) {
      // Clicking the empty stock slot recycles the waste.
      if (world && this.overStockSlot(world)) {
        this.pendingStockClick = { x: e.clientX, y: e.clientY };
      }
      return;
    }

    const location = controller.locateCard(cardId);
    if (!location) return;
    this.beginPotentialDrag(e, world, location);
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (this.drag) {
      if (!this.drag.active) {
        const dx = e.clientX - this.drag.startX;
        const dy = e.clientY - this.drag.startY;
        if (Math.hypot(dx, dy) < DRAG_SLOP_PX) return;
        this.activateDrag();
      }
      if (this.drag.active) this.updateDrag(e);
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    // Double-tap detection for touch/pen — the DOM `dblclick` event only
    // fires for mouse double-clicks, never for double-taps.
    let isDoubleTap = false;
    if (e.pointerType !== "mouse") {
      const now = performance.now();
      const last = this.lastTap;
      isDoubleTap =
        last !== null &&
        now - last.time < DOUBLE_TAP_MS &&
        Math.hypot(e.clientX - last.x, e.clientY - last.y) < DOUBLE_TAP_PX;
      this.lastTap = { x: e.clientX, y: e.clientY, time: now };
    }

    if (this.pendingStockClick) {
      const moved = Math.hypot(
        e.clientX - this.pendingStockClick.x,
        e.clientY - this.pendingStockClick.y,
      );
      this.pendingStockClick = null;
      if (moved < DRAG_SLOP_PX) this.controller.drawStock();
      if (isDoubleTap) this.onDoubleAction(e);
      return;
    }

    const drag = this.drag;
    this.drag = null;
    if (!drag) {
      if (isDoubleTap) this.onDoubleAction(e);
      return;
    }

    if (!drag.active) {
      // Simple click on a face-down stock top card draws.
      if (drag.from.type === "stock") this.controller.drawStock();
      if (isDoubleTap) this.onDoubleAction(e);
      return;
    }

    const world = this.pointerWorld(e, DRAG_Z);
    const target = world
      ? this.dropTargetAt(
          world.x + drag.grabDx,
          world.y + drag.grabDy,
          this.controller.legalDropTargets(drag.from, drag.count),
        )
      : null;

    this.clearHighlights();
    if (target) {
      this.controller.tryMove(drag.from, target, drag.count);
    } else {
      this.controller.refresh(); // snap back
      this.sounds?.play("invalid");
    }
  };

  private onPointerCancel = (): void => {
    if (this.drag?.active) {
      this.clearHighlights();
      this.drag = null;
      this.controller.refresh();
    }
    this.drag = null;
    this.pendingStockClick = null;
  };

  /** Mouse double-clicks arrive via `dblclick`. */
  private onDoubleClick = (e: MouseEvent): void => {
    this.onDoubleAction(e);
  };

  /**
   * Double click/tap: on a face-up pile-top card, send that card to a
   * foundation; on empty felt, sweep all collectable cards — the
   * touch-friendly counterpart of right-clicking. Double actions aimed at
   * the stock mean "draw twice", never a sweep.
   */
  private onDoubleAction = (e: { clientX: number; clientY: number }): void => {
    const { controller } = this;
    if (controller.busy || controller.state.status !== "playing") return;

    const cardId = pickCard(this.renderer.rig, this.renderer.cardViews, e.clientX, e.clientY);
    if (cardId) {
      const location = controller.locateCard(cardId);
      if (!location || location.ref.type === "stock") return;
      if (
        this.isPileTop(location) &&
        (location.ref.type === "waste" || location.ref.type === "tableau")
      ) {
        const pile = this.pileCards(location.ref);
        if (pile[location.index].faceUp) {
          if (!controller.autoToFoundation(location.ref)) this.sounds?.play("invalid");
        }
      }
      return; // a card was hit but nothing else applied — never sweep
    }

    // Taps on/near the stock slot are draw/recycle attempts, not a sweep.
    const world = this.pointerWorld(e, 0);
    if (world && this.overStockSlot(world)) return;
    void controller.autoCollect();
  };

  /**
   * Right click: on a face-up pile-top card, send that card to a foundation;
   * anywhere else (felt, stock, foundations), sweep all collectable cards.
   */
  private onContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
    const { controller } = this;
    if (controller.busy || controller.state.status !== "playing") return;

    const cardId = pickCard(this.renderer.rig, this.renderer.cardViews, e.clientX, e.clientY);
    if (cardId) {
      const location = controller.locateCard(cardId);
      if (
        location &&
        this.isPileTop(location) &&
        (location.ref.type === "waste" || location.ref.type === "tableau")
      ) {
        const pile = this.pileCards(location.ref);
        if (pile[location.index].faceUp) {
          if (!controller.autoToFoundation(location.ref)) this.sounds?.play("invalid");
          return;
        }
      }
    }
    void controller.autoCollect();
  };

  // ------------------------------------------------------------------ drag

  private beginPotentialDrag(
    e: PointerEvent,
    world: THREE.Vector3 | null,
    location: CardLocation,
  ): void {
    const { ref, index } = location;
    const pile = this.pileCards(ref);
    const card = pile[index];

    // Clicking a stock card = draw on release.
    if (ref.type === "stock") {
      this.drag = {
        from: ref,
        count: 0,
        views: [],
        grabDx: 0,
        grabDy: 0,
        followers: [],
        startX: e.clientX,
        startY: e.clientY,
        active: false,
      };
      return;
    }

    if (!card || !card.faceUp) return;
    if ((ref.type === "waste" || ref.type === "foundation") && index !== pile.length - 1) {
      return; // only pile tops move from waste/foundation
    }

    const count = pile.length - index;
    const views: CardView[] = [];
    for (let i = index; i < pile.length; i++) {
      const view = this.renderer.cardViews.get(pile[i].id);
      if (!view) return;
      views.push(view);
    }
    if (!world) return;

    const lead = views[0].group.position;
    this.drag = {
      from: ref,
      count,
      views,
      grabDx: lead.x - world.x,
      grabDy: lead.y - world.y,
      followers: views.map((v) => ({
        dx: v.group.position.x - lead.x,
        dy: v.group.position.y - lead.y,
        dz: v.group.position.z - lead.z,
      })),
      startX: e.clientX,
      startY: e.clientY,
      active: false,
    };
  }

  private activateDrag(): void {
    const drag = this.drag!;
    drag.active = true;
    this.sounds?.play("pickup");
    // Show legal drop targets for this stack.
    this.renderer.setHighlights(
      this.controller
        .legalDropTargets(drag.from, drag.count)
        .map((t) => this.targetHighlightPlacement(t)),
    );
  }

  private updateDrag(e: PointerEvent): void {
    const drag = this.drag!;
    const world = this.pointerWorld(e, DRAG_Z);
    if (!world) return;
    const leadX = world.x + drag.grabDx;
    const leadY = world.y + drag.grabDy;
    drag.views.forEach((view, i) => {
      const f = drag.followers[i];
      view.group.position.set(leadX + f.dx, leadY + f.dy, DRAG_Z + i * 0.01);
    });
  }

  // ---------------------------------------------------------- drop targets

  /**
   * Drop target for a dragged stack whose lead card is centered at
   * (leadX, leadY). Considers legal targets only, scoring each hitbox by
   * its overlap area with the lead card — the card visibly sitting over a
   * highlight is what counts, not where the pointer happens to be.
   */
  private dropTargetAt(leadX: number, leadY: number, targets: PileRef[]): PileRef | null {
    const hw = CARD_W / 2;
    const hh = CARD_H / 2;
    const state = this.controller.state;

    let best: { ref: PileRef; overlap: number } | null = null;
    const consider = (ref: PileRef, cx: number, top: number, bottom: number) => {
      const ox = Math.min(leadX + hw, cx + hw + 0.3) - Math.max(leadX - hw, cx - hw - 0.3);
      const oy = Math.min(leadY + hh, top) - Math.max(leadY - hh, bottom);
      if (ox <= 0 || oy <= 0) return;
      const overlap = ox * oy;
      if (!best || overlap > best.overlap) best = { ref, overlap };
    };

    for (const ref of targets) {
      if (ref.type === "tableau") {
        const slot = slotPlacement(ref);
        const pile = state.tableau[ref.index];
        // Column hitbox spans from above the slot to past the pile bottom.
        const bottom =
          pile.length > 0
            ? cardPlacement(state, ref, pile.length - 1).y - CARD_H / 2 - 0.3
            : slot.y - CARD_H / 2 - 0.3;
        consider(ref, slot.x, slot.y + CARD_H / 2 + 0.3, bottom);
      } else if (ref.type === "foundation") {
        const slot = slotPlacement(ref);
        consider(ref, slot.x, slot.y + CARD_H / 2 + 0.3, slot.y - CARD_H / 2 - 0.3);
      }
    }
    const found = best as { ref: PileRef; overlap: number } | null;
    return found && found.overlap >= CARD_W * CARD_H * 0.3 ? found.ref : null;
  }

  private overStockSlot(world: THREE.Vector3): boolean {
    const slot = slotPlacement({ type: "stock", index: 0 });
    return (
      Math.abs(world.x - slot.x) <= CARD_W / 2 + 0.15 &&
      Math.abs(world.y - slot.y) <= CARD_H / 2 + 0.15
    );
  }

  private targetHighlightPlacement(target: PileRef): Placement {
    return nextPlacement(this.controller.state, target);
  }

  // ------------------------------------------------------------- highlight

  private clearHighlights(): void {
    this.renderer.clearHighlights();
  }

  // ---------------------------------------------------------------- helpers

  private pileCards(ref: PileRef) {
    const state = this.controller.state;
    switch (ref.type) {
      case "stock":
        return state.stock;
      case "waste":
        return state.waste;
      case "tableau":
        return state.tableau[ref.index];
      case "foundation":
        return state.foundations[ref.index];
    }
  }

  private isPileTop(location: CardLocation): boolean {
    return location.index === this.pileCards(location.ref).length - 1;
  }

  /** Intersect the pointer ray with the plane z = worldZ. */
  private pointerWorld(
    e: { clientX: number; clientY: number },
    worldZ: number,
  ): THREE.Vector3 | null {
    const { rig } = this.renderer;
    const rect = rig.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, rig.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -worldZ);
    const point = new THREE.Vector3();
    return raycaster.ray.intersectPlane(plane, point) ? point : null;
  }
}
