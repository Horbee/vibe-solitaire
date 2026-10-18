import * as THREE from "three";
import type { Card } from "../game/types";
import { backTileUV, faceTileUV, tileTexture } from "./atlas";
import { CARD_H, CARD_W } from "./layout";
import type { Placement } from "./layout";

const CORNER_RADIUS = 0.09;

function roundedRectShape(w: number, h: number, r: number): THREE.Shape {
  const x = -w / 2;
  const y = -h / 2;
  const shape = new THREE.Shape();
  shape.moveTo(x + r, y);
  shape.lineTo(x + w - r, y);
  shape.quadraticCurveTo(x + w, y, x + w, y + r);
  shape.lineTo(x + w, y + h - r);
  shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  shape.lineTo(x + r, y + h);
  shape.quadraticCurveTo(x, y + h, x, y + h - r);
  shape.lineTo(x, y + r);
  shape.quadraticCurveTo(x, y, x + r, y);
  return shape;
}

let cardGeometry: THREE.ShapeGeometry | null = null;

/** Shared rounded-rectangle geometry, UVs normalized to [0,1]. */
export function getCardGeometry(): THREE.ShapeGeometry {
  if (cardGeometry) return cardGeometry;
  const geometry = new THREE.ShapeGeometry(roundedRectShape(CARD_W, CARD_H, CORNER_RADIUS), 8);
  // ShapeGeometry copies vertex xy into uv; normalize across the card bbox.
  const uv = geometry.attributes.uv;
  const pos = geometry.attributes.position;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, (pos.getX(i) + CARD_W / 2) / CARD_W, (pos.getY(i) + CARD_H / 2) / CARD_H);
  }
  uv.needsUpdate = true;
  cardGeometry = geometry;
  return geometry;
}

/**
 * One playing card: a group holding a face mesh (front) and a back mesh.
 * `rotation.y = 0` shows the face, `Math.PI` shows the back.
 */
export class CardView {
  readonly card: Card;
  readonly group: THREE.Group;

  constructor(card: Card, atlas: THREE.Texture) {
    this.card = card;
    const geometry = getCardGeometry();

    const faceMat = new THREE.MeshStandardMaterial({
      map: tileTexture(atlas, faceTileUV(card.suit, card.rank)),
      roughness: 0.6,
      metalness: 0.0,
    });
    const faceMesh = new THREE.Mesh(geometry, faceMat);
    faceMesh.position.z = 0.002;
    faceMesh.castShadow = true;
    faceMesh.userData.cardId = card.id;

    const backMat = new THREE.MeshStandardMaterial({
      map: tileTexture(atlas, backTileUV()),
      roughness: 0.6,
      metalness: 0.0,
    });
    const backMesh = new THREE.Mesh(geometry, backMat);
    backMesh.position.z = -0.002;
    backMesh.rotation.y = Math.PI;
    backMesh.castShadow = true;
    backMesh.userData.cardId = card.id;

    this.group = new THREE.Group();
    this.group.add(faceMesh, backMesh);
    this.group.userData.cardId = card.id;
    this.setFaceUp(card.faceUp);
  }

  setFaceUp(faceUp: boolean): void {
    this.group.rotation.y = faceUp ? 0 : Math.PI;
  }

  setPlacement(p: Placement): void {
    this.group.position.set(p.x, p.y, p.z);
  }
}

export function createCardViews(cards: Card[], atlas: THREE.Texture): Map<string, CardView> {
  const views = new Map<string, CardView>();
  for (const card of cards) views.set(card.id, new CardView(card, atlas));
  return views;
}
