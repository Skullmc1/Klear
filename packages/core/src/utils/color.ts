/**
 * Color quantization utilities for the pure-JS `edge` tracing method.
 *
 * These operate on raw RGBA buffers (4 bytes per pixel, unmultiplied alpha).
 */

export interface RgbaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface QuantizerResult {
  palette: RgbaColor[];
  indices: Uint8Array; // per-pixel index into palette (0..palette.length-1)
}

/** Euclidean distance between two RGB colors (ignores alpha). */
export function colorDistance(a: RgbaColor, b: RgbaColor): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function getColor(data: Buffer, i: number): RgbaColor {
  return {
    r: data[i] ?? 0,
    g: data[i + 1] ?? 0,
    b: data[i + 2] ?? 0,
    a: data[i + 3] ?? 0,
  };
}

/**
 * Reduce `data` (RGBA, 4 bytes per pixel) to at most `maxColors` palette
 * entries via a simple median-cut quantization. Fully opaque pixels are
 * preferred; fully transparent pixels are grouped into a single "clear"
 * entry at index 0.
 */
export function quantize(
  data: Buffer,
  width: number,
  height: number,
  maxColors: number,
): QuantizerResult {
  const n = maxColors;
  const pixelCount = width * height;

  // Separate transparent vs opaque pixels.
  const transparentIndices: number[] = [];
  const opaquePoints: number[] = [];
  for (let p = 0; p < pixelCount; p++) {
    const i = p * 4;
    if ((data[i + 3] ?? 0) < 128) {
      transparentIndices.push(p);
    } else {
      opaquePoints.push(p);
    }
  }

  const palette: RgbaColor[] = [];
  // Index 0 is the transparent color (if any).
  if (transparentIndices.length > 0) {
    palette.push({ r: 0, g: 0, b: 0, a: 0 });
  }

  const colorsPerBucket = Math.max(1, n - palette.length);
  const buckets = medianCut(opaquePoints, data, colorsPerBucket);

  for (const bucket of buckets) {
    palette.push(average(bucket, data));
  }

  const indices = new Uint8Array(pixelCount);
  // The clear entry (alpha 0) always sits at palette index 0 when transparency
  // is present. Transparent pixels must map to it so they are never painted
  // with an opaque color; opaque pixels search colors starting past it.
  const opaqueStart = transparentIndices.length > 0 ? 1 : 0;

  for (const p of transparentIndices) {
    indices[p] = 0;
  }
  for (let p = 0; p < pixelCount; p++) {
    if ((data[p * 4 + 3] ?? 0) < 128) continue;
    const px = getColor(data, p * 4);
    let best = opaqueStart;
    let bestDist = Infinity;
    for (let c = opaqueStart; c < palette.length; c++) {
      const dist = colorDistance(px, palette[c]!);
      if (dist < bestDist) {
        bestDist = dist;
        best = c;
      }
    }
    indices[p] = best;
  }

  return { palette, indices };
}

/** One pass of median-cut: buckets pixels by the channel with widest range. */
function medianCut(
  points: number[],
  data: Buffer,
  maxBuckets: number,
): number[][] {
  if (points.length === 0) return [[]] as number[][];
  const buckets: number[][] = [points];
  while (buckets.length < maxBuckets) {
    // Find the bucket with the largest color range to split.
    let splitIdx = -1;
    let splitRange = -1;
    for (let b = 0; b < buckets.length; b++) {
      const range = bucketRange(buckets[b]!, data);
      if (range > splitRange) {
        splitRange = range;
        splitIdx = b;
      }
    }
    if (splitIdx === -1 || splitRange <= 0) break;

    const target = buckets[splitIdx]!;
    const axis = widestAxis(target, data);
    // Sort a copy by the chosen axis.
    target.sort((a, b) => {
      const va = sampleAxis(data, a, axis);
      const vb = sampleAxis(data, b, axis);
      return va - vb;
    });

    const mid = Math.floor(target.length / 2);
    const left = target.slice(0, mid);
    const right = target.slice(mid);
    if (left.length === 0 || right.length === 0) break;
    buckets.splice(splitIdx, 1, left, right);
  }
  return buckets;
}

function widestAxis(points: number[], data: Buffer): 'r' | 'g' | 'b' {
  let r0 = 255,
    r1 = 0,
    g0 = 255,
    g1 = 0,
    b0 = 255,
    b1 = 0;
  for (const p of points) {
    const i = p * 4;
    const r = data[i] ?? 0;
    const g = data[i + 1] ?? 0;
    const b = data[i + 2] ?? 0;
    if (r < r0) r0 = r;
    if (r > r1) r1 = r;
    if (g < g0) g0 = g;
    if (g > g1) g1 = g;
    if (b < b0) b0 = b;
    if (b > b1) b1 = b;
  }
  const dr = r1 - r0;
  const dg = g1 - g0;
  const db = b1 - b0;
  if (dr >= dg && dr >= db) return 'r';
  if (dg >= db) return 'g';
  return 'b';
}

function sampleAxis(data: Buffer, p: number, axis: 'r' | 'g' | 'b'): number {
  const i = p * 4;
  if (axis === 'r') return data[i] ?? 0;
  if (axis === 'g') return data[i + 1] ?? 0;
  return data[i + 2] ?? 0;
}

/**
 * Largest per-channel color spread in a bucket. Using per-channel extremes
 * keeps the metric within 0..255, so a solid-color bucket reports 0 and
 * terminates the split loop (unlike a raw r+g+b sum, which exceeds 255 and
 * never reaches 0 for saturated colors).
 */
function bucketRange(points: number[], data: Buffer): number {
  let r0 = 255,
    r1 = 0,
    g0 = 255,
    g1 = 0,
    b0 = 255,
    b1 = 0;
  for (const p of points) {
    const i = p * 4;
    const r = data[i] ?? 0;
    const g = data[i + 1] ?? 0;
    const b = data[i + 2] ?? 0;
    if (r < r0) r0 = r;
    if (r > r1) r1 = r;
    if (g < g0) g0 = g;
    if (g > g1) g1 = g;
    if (b < b0) b0 = b;
    if (b > b1) b1 = b;
  }
  return Math.max(r1 - r0, g1 - g0, b1 - b0);
}

function average(points: number[], data: Buffer): RgbaColor {
  let r = 0,
    g = 0,
    b = 0;
  for (const p of points) {
    const i = p * 4;
    r += data[i] ?? 0;
    g += data[i + 1] ?? 0;
    b += data[i + 2] ?? 0;
  }
  const n = Math.max(1, points.length);
  return { r: r / n, g: g / n, b: b / n, a: 255 };
}
