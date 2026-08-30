import { describe, it, expect } from 'vitest';
import {
  marchingSquares,
  polygonArea,
  type Point,
} from '../src/utils/contour.js';

function mkMask(
  width: number,
  height: number,
  fg: Array<[number, number]>,
): Uint8Array {
  const m = new Uint8Array(width * height);
  for (const [x, y] of fg) m[x + y * width] = 1;
  return m;
}

function areaOf(points: Point[][]): number[] {
  return points.map((l) => Math.abs(polygonArea(l)));
}

describe('marchingSquares', () => {
  it('returns no loops for an empty mask', () => {
    expect(marchingSquares(new Uint8Array(16), 4, 4)).toEqual([]);
  });

  it('traces an interior solid block as one closed loop', () => {
    const mask = mkMask(4, 4, [
      [1, 1],
      [2, 1],
      [1, 2],
      [2, 2],
    ]);
    const loops = marchingSquares(mask, 4, 4);
    expect(loops).toHaveLength(1);
    const loop = loops[0]!;
    // every recorded loop must actually close
    const first = loop[0]!;
    expect(loop[loop.length - 1]!.x).toBeCloseTo(first.x, 6);
    expect(loop[loop.length - 1]!.y).toBeCloseTo(first.y, 6);
    // 2x2 block => 8 half-integer vertices
    expect(loop.length).toBe(8);
    expect(areaOf(loops)[0]!).toBeCloseTo(3.25, 5);
  });

  it('closes a mask that touches the canvas corner (perimeter)', () => {
    // solid pixel at the very corner used to leave an open path
    const mask = mkMask(4, 4, [[0, 0]]);
    const loops = marchingSquares(mask, 4, 4);
    expect(loops).toHaveLength(1);
    expect(areaOf(loops)[0]!).toBeGreaterThan(0);
  });

  it('closes a fully-filled mask', () => {
    const fg: Array<[number, number]> = [];
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) fg.push([x, y]);
    const mask = mkMask(4, 4, fg);
    const result = marchingSquares(mask, 4, 4);
    expect(result).toHaveLength(1);
    // full canvas outline is a single closed loop covering ~the whole bitmap
    const loop = result[0]!;
    expect(areaOf(result)[0]!).toBeGreaterThan(0);
    expect(loop).toHaveLength(16);
  });

  it('traces two separate islands as two loops', () => {
    const mask = mkMask(6, 6, [
      [1, 1],
      [2, 1],
      [1, 2],
      [2, 2], // island A
      [4, 4], // island B (single px)
    ]);
    expect(marchingSquares(mask, 6, 6)).toHaveLength(2);
  });
});

describe('polygonArea', () => {
  it('computes the sholelace area of a square', () => {
    const square: Point[] = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ];
    expect(polygonArea(square)).toBeCloseTo(16, 9);
  });

  it('returns 0 for degenerate shapes', () => {
    expect(polygonArea([{ x: 0, y: 0 }])).toBe(0);
    expect(
      polygonArea([
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ]),
    ).toBe(0);
  });
});
