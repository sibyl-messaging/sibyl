import { HOLE_GRID_HEIGHT, HOLE_GRID_WIDTH } from "@sibyl/protocol";

export interface GhostBitmapOptions {
  tokens: readonly number[];
  noiseSeed: number;
}

export type GhostBitmap = number[][];

export function buildGhostBitmap(options: GhostBitmapOptions): GhostBitmap {
  const signal = new Set(options.tokens);
  const matrix: number[][] = [];
  let seed = options.noiseSeed;

  for (let row = 0; row < HOLE_GRID_HEIGHT; row += 1) {
    const rowData: number[] = [];
    for (let col = 0; col < HOLE_GRID_WIDTH; col += 1) {
      const holeId = row * HOLE_GRID_WIDTH + col;
      const signalPixel = signal.has(holeId);

      if (signalPixel) {
        rowData.push(1);
      } else {
        seed = xorshift(seed);
        rowData.push(seed % 2 === 0 ? 1 : 0);
      }
    }
    matrix.push(rowData);
  }

  return matrix;
}

function xorshift(value: number): number {
  let x = value || 2463534242;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return x >>> 0;
}
