import { describe, it, expect } from 'vitest';
import { quantize, colorDistance } from '../src/utils/color.js';

describe('quantize', () => {
  it('splits distinct opaque colors into separate palette entries', () => {
    // 2x1: pure red + pure blue
    const data = Buffer.from([255, 0, 0, 255, 0, 0, 255, 255]);
    const q = quantize(data, 2, 1, 2);
    expect(q.palette.length).toBe(2);
    expect(q.indices[0]).not.toBe(q.indices[1]);

    const idx0 = q.indices[0]!;
    const idx1 = q.indices[1]!;
    expect(
      colorDistance(q.palette[idx0]!, { r: 255, g: 0, b: 0, a: 255 }),
    ).toBeLessThan(1);
    expect(
      colorDistance(q.palette[idx1]!, { r: 0, g: 0, b: 255, a: 255 }),
    ).toBeLessThan(1);
  });

  it('deduplicates repeated splitting of saturated colors (bucket-range regression)', () => {
    // one solid color, many pixels: must collapse to a single palette entry
    const data = Buffer.alloc(64 * 64 * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 240;
      data[i + 1] = 200;
      data[i + 2] = 30;
      data[i + 3] = 255;
    }
    const q = quantize(data, 64, 64, 16);
    expect(q.palette).toHaveLength(1);
    expect(q.indices.every((i) => i === 0)).toBe(true);
  });

  it('keeps opaque colors distinct when splitting saturated colors (blue+green regression)', () => {
    // 2x1: blue (40,120,220) + green (40,180,60) — equal red channel
    const data = Buffer.from([40, 120, 220, 255, 40, 180, 60, 255]);
    const q = quantize(data, 2, 1, 16);
    expect(q.palette).toHaveLength(2);
    const a = q.palette[q.indices[0]!]!;
    const b = q.palette[q.indices[1]!]!;
    expect(colorDistance(a, { r: 40, g: 120, b: 220, a: 255 })).toBeLessThan(
      60,
    );
    expect(colorDistance(b, { r: 40, g: 180, b: 60, a: 255 })).toBeLessThan(60);
  });

  it('maps transparent pixels to the clear entry so they are never painted', () => {
    const data = Buffer.from([
      0,
      0,
      0,
      0, // fully transparent
      255,
      0,
      0,
      255, // red
    ]);
    const q = quantize(data, 2, 1, 2);
    // palette[0] is the clear entry
    expect(q.palette[0]!.a).toBe(0);
    // the transparent pixel must map to the clear entry...
    expect(q.indices[0]).toBe(0);
    // ...while the opaque pixel maps to the saturated color
    expect(q.indices[1]).not.toBe(0);
    expect(
      colorDistance(q.palette[q.indices[1]!]!, { r: 255, g: 0, b: 0, a: 255 }),
    ).toBeLessThan(1);
  });

  it('honours maxColors', () => {
    const data = Buffer.alloc(4 * 4 * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = (i / 4) % 4 === 0 ? 20 : 200;
      data[i + 1] = 30;
      data[i + 2] = 40;
      data[i + 3] = 255;
    }
    const q = quantize(data, 4, 4, 3);
    expect(q.palette.length).toBeLessThanOrEqual(3);
  });
});
