import type { LoadedImage, MethodOptions } from '../types.js';
import { KlearError } from '../types.js';
import { quantize } from '../utils/color.js';
import { marchingSquares, polygonArea } from '../utils/contour.js';
import { roundCoord } from '../utils/format.js';
import { simplifyLoop, type SimplifiablePoint } from '../utils/simplify.js';

/**
 * Pure-JavaScript fallback tracer.
 *
 * Pipeline:
 *   1. color quantization (median-cut) to `maxColors` buckets
 *   2. for each color, build a binary mask of that color's pixels
 *   3. marching-squares contour extraction on the mask
 *   4. emit one filled `<path>` (evenodd) per color, combining all loops
 *
 * This method needs no native bindings and is the graceful fallback when
 * Potrace/ImageTracer are unavailable. Output is clean, flat-color SVG.
 */
export function traceViaEdge(image: LoadedImage, opts: MethodOptions): string {
  const maxColors = Math.max(2, opts.maxColors ?? 16);
  const resizeMax = opts.resizeMax;
  void resizeMax; // downsampling is done by the caller (loadImageRgba)

  let quant;
  try {
    quant = quantize(image.data, image.width, image.height, maxColors);
  } catch (cause) {
    throw new KlearError(
      `Color quantization failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      'E_QUANTIZE',
    );
  }

  const paths: string[] = [];
  const seen = new Set<string>();

  // Order colors by frequency (most pixels first) so detail sits on top.
  const freq = new Map<number, number>();
  for (let i = 0; i < quant.indices.length; i++) {
    const idx = quant.indices[i]!;
    freq.set(idx, (freq.get(idx) ?? 0) + 1);
  }
  const ordered = Array.from(freq.entries()).sort((a, b) => b[1] - a[1]);

  for (const [ci] of ordered) {
    const color = quant.palette[ci]!;
    if (!color) continue;

    // Skip fully-transparent (background) colors.
    if (color.a < 128) continue;

    const fillId = `c${ci}`;
    if (seen.has(fillId)) continue;
    seen.add(fillId);

    const subpaths = traceColor(
      quant.indices,
      image.width,
      image.height,
      ci,
      opts.edgeTolerance ?? 1,
    );
    if (subpaths.length === 0) continue;

    paths.push(
      `<path fill="rgb(${clamp(color.r)},${clamp(color.g)},${clamp(color.b)})" ` +
        `fill-rule="evenodd" d="${subpaths.join(' ')}"/>`,
    );
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${image.width}" ` +
    `height="${image.height}" viewBox="0 0 ${image.width} ${image.height}">` +
    `${paths.join('')}</svg>`;

  return svg;
}

/**
 * Build a binary mask for a single palette index and extract all contour
 * loops as SVG subpath strings.
 */
function traceColor(
  indices: Uint8Array,
  width: number,
  height: number,
  colorIndex: number,
  tolerance: number,
): string[] {
  const mask = new Uint8Array(width * height);
  let any = false;
  for (let i = 0; i < indices.length; i++) {
    if (indices[i] === colorIndex) {
      mask[i] = 1;
      any = true;
    }
  }
  if (!any) return [];

  const loops = marchingSquares(mask, width, height);
  if (loops.length === 0) return [];

  const result: string[] = [];
  for (const loop of loops) {
    // Filter out degenerate/tiny loops (sub-pixel area).
    if (polygonArea(loop) < 0.5) continue;
    // Collapse collinear vertex runs (Ramer-Douglas-Peucker).
    const simplified = simplifyLoop(loop as SimplifiablePoint[], tolerance);
    if (polygonArea(simplified) < 0.5) continue;
    const d = pathFromLoop(simplified);
    if (d) {
      result.push(d);
    }
  }
  return result;
}

function pathFromLoop(points: Array<{ x: number; y: number }>): string {
  if (points.length < 3) return '';
  let d = `M ${roundCoord(points[0]!.x)} ${roundCoord(points[0]!.y)}`;
  for (let i = 1; i < points.length; i++) {
    const p = points[i]!;
    d += ` L ${roundCoord(p.x)} ${roundCoord(p.y)}`;
  }
  d += ' Z';
  return d;
}

function clamp(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}
