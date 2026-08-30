import { describe, it, expect } from 'vitest';
import { simplifyLoop } from '../src/utils/simplify.js';

describe('simplifyLoop', () => {
  it('collapses collinear runs back to corner vertices', () => {
    // a 2x2 square with edge midpoints (8 pts) -> 4 corners
    const square = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 1 },
      { x: 2, y: 2 },
      { x: 1, y: 2 },
      { x: 0, y: 2 },
      { x: 0, y: 1 },
    ];
    const out = simplifyLoop(square, 1);
    expect(out).toEqual([
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
      { x: 0, y: 2 },
    ]);
  });

  it('preserves corners that exceed the tolerance', () => {
    // square with a notch: (1,1) is 1px off the diagonal
    const notched = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
      { x: 0, y: 2 },
    ];
    const out = simplifyLoop(notched, 0.5);
    expect(out.some((p) => p.x === 1 && p.y === 1)).toBe(true);
  });

  it('is a no-op for small loops', () => {
    const tri = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 0, y: 2 },
    ];
    expect(simplifyLoop(tri)).toEqual(tri.map((p) => ({ ...p })));
  });
});
