import { describe, it, expect } from 'vitest';
import { traceViaEdge } from '../src/methods/edge.js';
import type { LoadedImage } from '../src/types.js';

function makeImage(
  width: number,
  height: number,
  fill: (x: number, y: number) => [number, number, number, number],
): LoadedImage {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = fill(x, y);
      const i = (x + y * width) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
  return { width, height, data, originalWidth: width, originalHeight: height };
}

describe('traceViaEdge', () => {
  it('emits one simplified <path> per opaque region', () => {
    // 4x4: left half red, right half blue
    const img = makeImage(4, 4, (x) =>
      x < 2 ? [255, 0, 0, 255] : [0, 0, 255, 255],
    );
    const svg = traceViaEdge(img, {});
    expect(svg).toContain(`width="4"`);
    expect(svg).toContain(`height="4"`);
    expect(svg).toContain(`viewBox="0 0 4 4"`);
    expect(svg).toContain('fill="rgb(255,0,0)"');
    expect(svg).toContain('fill="rgb(0,0,255)"');
    expect(svg).not.toContain('undefined');
    // simplified: the two regions collapse to 4-point rectangles
    const d = svg.match(/d="([^"]*)"/g) ?? [];
    const nd = d.filter((s) => !s.includes('d=""'));
    expect(nd.length).toBeGreaterThanOrEqual(2);
    // grid goes left-half vs right-half -> count 'M' subpaths
    const ms = nd.map((s) => (s.match(/M/g) ?? []).length);
    expect(ms).toEqual([1, 1]);
  });

  it('skips fully-transparent colors entirely', () => {
    const img = makeImage(
      2,
      2,
      () => [10, 20, 30, 0] as [number, number, number, number],
    );
    const svg = traceViaEdge(img, {});
    // no opaque color to draw -> only the bare <svg> wrapper
    expect(svg).toMatch(/<svg[^>]*><\/svg>/);
  });

  it('applies the edgeTolerance option without crashing', () => {
    const img = makeImage(8, 8, (x, y) =>
      x < 4 ? [0, 0, 0, 255] : [255, 255, 255, 255],
    );
    const svg = traceViaEdge(img, { edgeTolerance: 2 });
    expect(svg).toContain('<svg');
  });
});
