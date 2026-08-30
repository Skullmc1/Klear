import potrace, { type PotraceOptions } from 'potrace';
import type { MethodOptions } from '../types.js';
import { KlearError } from '../types.js';

/**
 * Trace a bitmap via Potrace (clean, posterized vector output).
 *
 * Potrace accepts a file path or a PNG/JPEG/BMP Buffer directly (its Jimp
 * backend decodes those formats). We pass the raw input through.
 *
 * Resolves with the resulting SVG markup.
 */
export async function traceViaPotrace(
  input: string | Buffer,
  opts: MethodOptions,
): Promise<string> {
  const color = toPotraceColor(opts.color);
  const background = opts.background
    ? (normaliseColor(opts.background) ?? undefined)
    : undefined;

  // NOTE: potrace misbehaves when a key is present but `undefined` (e.g.
  // `turdSize` yields an empty path), so only defined keys are forwarded.
  const params: Record<string, number | string | boolean> = {};
  if (opts.threshold !== undefined) params.threshold = opts.threshold;
  if (opts.turdSize !== undefined) params.turdSize = opts.turdSize;
  if (opts.alphaMax !== undefined) params.alphaMax = opts.alphaMax;
  if (opts.optCurve !== undefined) params.optCurve = opts.optCurve;
  if (color !== undefined) params.color = color;
  if (background !== undefined) params.background = background;

  return new Promise<string>((resolve, reject) => {
    potrace.trace(
      input,
      params as PotraceOptions,
      (err: Error | null, svg: string) => {
        if (err) {
          reject(new KlearError(`Potrace failed: ${err.message}`, 'E_POTRACE'));
        } else {
          resolve(svg);
        }
      },
    );
  });
}

/** Potrace accepts `#rgb`/`#rrggbb`/named colors; we normalize to `#rrggbb`. */
function toPotraceColor(color: string | undefined): string | undefined {
  if (!color) return undefined;
  const normalized = normaliseColor(color);
  return normalized ?? undefined;
}

function normaliseColor(color: string): string | null {
  const trimmed = color.trim().toLowerCase();
  // #rrggbb
  if (/^#[0-9a-f]{6}$/.test(trimmed)) return trimmed;
  // #rgb → #rrggbb
  if (/^#[0-9a-f]{3}$/.test(trimmed)) {
    const r = trimmed[1] ?? '0';
    const g = trimmed[2] ?? '0';
    const b = trimmed[3] ?? '0';
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  // named color — pass through (potrace handles a fixed set)
  if (/^[a-z]+$/.test(trimmed)) return trimmed;
  return null;
}
