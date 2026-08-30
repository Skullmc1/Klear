import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { vectorize, listMethods, getDefaultMethod } from '../src/index.js';

async function fourTilePng(): Promise<Buffer> {
  return sharp({
    create: {
      width: 32,
      height: 32,
      channels: 3,
      background: { r: 245, g: 245, b: 245 },
    },
  })
    .composite([
      {
        input: {
          create: {
            width: 16,
            height: 16,
            channels: 3,
            background: { r: 220, g: 40, b: 40 },
          },
        },
        left: 0,
        top: 0,
      },
      {
        input: {
          create: {
            width: 16,
            height: 16,
            channels: 3,
            background: { r: 40, g: 120, b: 220 },
          },
        },
        left: 16,
        top: 0,
      },
      {
        input: {
          create: {
            width: 16,
            height: 16,
            channels: 3,
            background: { r: 40, g: 180, b: 60 },
          },
        },
        left: 0,
        top: 16,
      },
      {
        input: {
          create: {
            width: 16,
            height: 16,
            channels: 3,
            background: { r: 240, g: 200, b: 30 },
          },
        },
        left: 16,
        top: 16,
      },
    ])
    .png()
    .toBuffer();
}

describe('vectorize (integration)', () => {
  it('exposes methods metadata', () => {
    const ids = listMethods().map((m) => m.id);
    expect(ids).toContain('potrace');
    expect(ids).toContain('imagetracer');
    expect(ids).toContain('edge');
    expect(getDefaultMethod()).toBe('potrace');
  });

  it("runs all three methods and never emits 'undefined'", async () => {
    const buf = await fourTilePng();
    for (const method of ['potrace', 'imagetracer', 'edge'] as const) {
      const res = await vectorize(buf, { method, optimize: true });
      expect(res.method).toBe(method);
      expect(res.width).toBe(32);
      expect(res.height).toBe(32);
      expect(res.svg.startsWith('<svg')).toBe(true);
      expect(res.svg).toContain('viewBox="0 0 32 32"');
      expect(res.svg).not.toContain('undefined');
      // every production path must have data (empty d would lose the shape)
      expect(/\bd=""/.test(res.svg)).toBe(false);
    }
  }, 30_000);

  it('falls back to the edge method when requested one fails', async () => {
    // invalid buffer -> metadata read fails -> both primary and fallback fail -> KlearError
    const buf = Buffer.from('this is not an image', 'utf8');
    await expect(vectorize(buf, { method: 'potrace' })).rejects.toThrow();
  });

  it('normalizes dimensions when the method downscales (edge resizeMax)', async () => {
    const buf = await fourTilePng();
    const res = await vectorize(buf, {
      method: 'edge',
      options: { resizeMax: 16 },
    });
    // SVG viewBox reflects the traced (resized) bitmap...
    expect(res.svg).toContain('viewBox=');
    // ...but the reported dimensions are the source image's
    expect(res.width).toBe(32);
    expect(res.height).toBe(32);
  }, 30_000);
});
