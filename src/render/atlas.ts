import * as THREE from "three";
import type { Suit } from "../game/types";

/**
 * All card art lives in ONE SVG atlas: 13 rank columns x 4 suit rows for the
 * faces, plus a card-back tile in the last column of an extra row.
 */
export const ATLAS_COLS = 13;
export const ATLAS_ROWS = 5;
const TILE_W = 300;
const TILE_H = 420;

const SUIT_ROW: Record<Suit, number> = {
  spades: 0,
  hearts: 1,
  diamonds: 2,
  clubs: 3,
};
const SUIT_GLYPH: Record<Suit, string> = {
  spades: "♠",
  hearts: "♥",
  diamonds: "♦",
  clubs: "♣",
};
const SUIT_FILL: Record<Suit, string> = {
  spades: "#1b1b1f",
  clubs: "#1b1b1f",
  hearts: "#c1282f",
  diamonds: "#c1282f",
};
const RANK_LABELS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

export interface TileUV {
  ox: number;
  oy: number;
  rx: number;
  ry: number;
}

/** UV window of one tile within the atlas texture. */
export function faceTileUV(suit: Suit, rank: number): TileUV {
  return tileUV(rank - 1, SUIT_ROW[suit]);
}

export function backTileUV(): TileUV {
  return tileUV(ATLAS_COLS - 1, ATLAS_ROWS - 1);
}

function tileUV(col: number, row: number): TileUV {
  return {
    ox: col / ATLAS_COLS,
    oy: 1 - (row + 1) / ATLAS_ROWS,
    rx: 1 / ATLAS_COLS,
    ry: 1 / ATLAS_ROWS,
  };
}

function faceTileSVG(suit: Suit, rank: number, x: number, y: number): string {
  const glyph = SUIT_GLYPH[suit];
  const label = RANK_LABELS[rank - 1];
  const fill = SUIT_FILL[suit];

  const corner = `
    <text x="30" y="72" font-size="60" font-weight="700" fill="${fill}" text-anchor="middle">${label}</text>
    <text x="30" y="128" font-size="50" fill="${fill}" text-anchor="middle">${glyph}</text>`;

  let center: string;
  if (rank === 1) {
    center = `<text x="150" y="310" font-size="230" fill="${fill}" text-anchor="middle">${glyph}</text>`;
  } else if (rank >= 11) {
    center = `
      <circle cx="150" cy="185" r="68" fill="#f2e7c9" stroke="${fill}" stroke-width="5"/>
      <text x="150" y="207" font-size="76" font-weight="700" fill="${fill}" text-anchor="middle">${label}</text>
      <text x="150" y="352" font-size="120" fill="${fill}" text-anchor="middle">${glyph}</text>`;
  } else {
    center = `<text x="150" y="292" font-size="170" fill="${fill}" text-anchor="middle">${glyph}</text>`;
  }

  return `
  <g transform="translate(${x},${y})">
    <rect x="3" y="3" width="${TILE_W - 6}" height="${TILE_H - 6}" rx="26" fill="#ffffff" stroke="#c9cbd1" stroke-width="3"/>
    ${corner}
    <g transform="translate(${TILE_W},${TILE_H}) rotate(180)">${corner}</g>
    ${center}
  </g>`;
}

function backTileSVG(x: number, y: number): string {
  return `
  <g transform="translate(${x},${y})">
    <defs>
      <pattern id="backweave" width="24" height="24" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
        <rect width="24" height="24" fill="#28355e"/>
        <rect width="8" height="24" fill="#33457e"/>
      </pattern>
    </defs>
    <rect x="3" y="3" width="${TILE_W - 6}" height="${TILE_H - 6}" rx="26" fill="url(#backweave)" stroke="#eef1ff" stroke-width="6"/>
    <rect x="26" y="26" width="${TILE_W - 52}" height="${TILE_H - 52}" rx="14" fill="none" stroke="#eef1ff" stroke-width="2.5" opacity="0.7"/>
  </g>`;
}

export function buildAtlasSVG(): string {
  const w = ATLAS_COLS * TILE_W;
  const h = ATLAS_ROWS * TILE_H;
  const parts: string[] = [];

  const suits: Suit[] = ["spades", "hearts", "diamonds", "clubs"];
  for (const suit of suits) {
    for (let rank = 1; rank <= 13; rank++) {
      parts.push(faceTileSVG(suit, rank, (rank - 1) * TILE_W, SUIT_ROW[suit] * TILE_H));
    }
  }
  parts.push(backTileSVG((ATLAS_COLS - 1) * TILE_W, (ATLAS_ROWS - 1) * TILE_H));

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="Georgia, 'Times New Roman', serif">${parts.join("")}</svg>`;
}

/** Rasterize the atlas SVG into a single shared texture. */
export async function createAtlasTexture(): Promise<THREE.Texture> {
  const svg = buildAtlasSVG();
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();

  const texture = new THREE.Texture(img);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}

/** Clone of the shared atlas with its UV window pointed at one tile. */
export function tileTexture(atlas: THREE.Texture, uv: TileUV): THREE.Texture {
  const texture = atlas.clone();
  texture.offset.set(uv.ox, uv.oy);
  texture.repeat.set(uv.rx, uv.ry);
  texture.needsUpdate = true;
  return texture;
}
