import * as THREE from "three";
import type { CardLocation, GameController } from "../controller";
import type { CardView } from "./cards";
import type { GameRenderer } from "./index";
import { pickCard } from "./index";
import { CARD_H, CARD_W, cardPlacement, DRAG_Z, nextPlacement, slotPlacement } from "./layout";
import type { Placement } from "./layout";
import type { PileRef } from "../game/types";

const DRAG_SLOP_PX = 5;

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
  private readonly canvas: HTMLCanvasElement;
  private readonly controller: GameController;
  private readonly renderer: GameRenderer;

  constructor(controller: GameController, renderer: GameRenderer) {
    this.controller = controller;
    this.renderer = renderer;
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
    if (this.pendingStockClick) {
      const moved = Math.hypot(
        e.clientX - this.pendingStockClick.x,
        e.clientY - this.pendingStockClick.y,
      );
      this.pendingStockClick = null;
      if (moved < DRAG_SLOP_PX) this.controller.drawStock();
      return;
    }

    const drag = this.drag;
    this.drag = null;
    if (!drag) return;

    if (!drag.active) {
      // Simple click on a face-down stock top card draws.
      if (drag.from.type === "stock") this.controller.drawStock();
      return;
    }

    const world = this.pointerWorld(e, 0);
    const target = world ? this.dropTargetAt(world) : null;
    const legal = target
      ? this.controller
          .legalDropTargets(drag.from, drag.count)
          .some((t) => t.type === target.type && t.index === target.index)
      : false;

    this.clearHighlights();
    if (target && legal) {
      this.controller.tryMove(drag.from, target, drag.count);
    } else {
      this.controller.refresh(); // snap back
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

  private onDoubleClick = (e: MouseEvent): void => {
    const { controller } = this;
    if (controller.state.status !== "playing") return;
    const cardId = pickCard(this.renderer.rig, this.renderer.cardViews, e.clientX, e.clientY);
    if (!cardId) return;
    const location = controller.locateCard(cardId);
    if (!location) return;

    const isTop = this.isPileTop(location);
    if (!isTop) return;
    if (location.ref.type !== "waste" && location.ref.type !== "tableau") return;

    const pile = this.pileCards(location.ref);
    if (!pile[location.index].faceUp) return;
    controller.autoToFoundation(location.ref);
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
          controller.autoToFoundation(location.ref);
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

  /** Pile under a world point (tableau columns & foundations only). */
  private dropTargetAt(world: THREE.Vector3): PileRef | null {
    let best: { ref: PileRef; dist: number } | null = null;

    const consider = (ref: PileRef, cx: number, top: number, bottom: number) => {
      if (Math.abs(world.x - cx) > CARD_W / 2 + 0.3) return;
      if (world.y > top || world.y < bottom) return;
      const dist = Math.hypot(
        world.x - cx,
        Math.min(Math.abs(world.y - top), Math.abs(world.y - bottom)),
      );
      if (!best || dist < best.dist) best = { ref, dist };
    };

    const state = this.controller.state;
    for (let i = 0; i < 7; i++) {
      const slot = slotPlacement({ type: "tableau", index: i });
      const pile = state.tableau[i];
      // Column hitbox spans from above the slot to past the pile bottom.
      const bottom =
        pile.length > 0
          ? cardPlacement(state, { type: "tableau", index: i }, pile.length - 1).y -
            CARD_H / 2 -
            0.3
          : slot.y - CARD_H / 2 - 0.3;
      consider({ type: "tableau", index: i }, slot.x, slot.y + CARD_H / 2 + 0.3, bottom);
    }
    for (let f = 0; f < 4; f++) {
      const slot = slotPlacement({ type: "foundation", index: f });
      consider({ type: "foundation", index: f }, slot.x, slot.y + CARD_H / 2, slot.y - CARD_H / 2);
    }
    const found = best as { ref: PileRef; dist: number } | null;
    return found?.ref ?? null;
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
