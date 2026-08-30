import sharp from 'sharp';
import type {
  MethodMeta,
  MethodOptions,
  VectorizeMethod,
  VectorizeOptions,
  VectorizeResult,
  LoadedImage,
} from './types.js';
import { KlearError } from './types.js';
import { loadImage, loadImageRgba } from './utils/image.js';
import { normalizeSvg, optimizeSvg } from './utils/svg.js';
import { traceViaPotrace } from './methods/potrace.js';
import { traceViaImageTracer } from './methods/imagetracer.js';
import { traceViaEdge } from './methods/edge.js';

export const METHODS: MethodMeta[] = [
  {
    id: 'potrace',
    name: 'Potrace',
    description:
      'Highest quality, clean posterized vector output (native C port).',
  },
  {
    id: 'imagetracer',
    name: 'ImageTracer',
    description: 'Fast color quantization + path tracing via imagetracerjs.',
  },
  {
    id: 'edge',
    name: 'Edge',
    description:
      'Pure-JS fallback: median-cut quantization + marching squares contours.',
  },
];

export const DEFAULT_METHOD: VectorizeMethod = 'potrace';
const EDGE_RESIZE_MAX = 256;

export function listMethods(): MethodMeta[] {
  return METHODS;
}

export function getDefaultMethod(): VectorizeMethod {
  return DEFAULT_METHOD;
}

interface MethodOutput {
  svg: string;
  vbw: number;
  vbh: number;
}

/**
 * Vectorize a raster image (PNG/JPEG file path or Buffer) into an SVG string.
 *
 * If the requested `method` fails (e.g. a native binding is unavailable),
 * Klear automatically falls back to the pure-JS `edge` method and records
 * the reason in `result.note`.
 */
export async function vectorize(
  input: string | Buffer,
  options?: VectorizeOptions,
): Promise<VectorizeResult> {
  const method = options?.method ?? DEFAULT_METHOD;
  const opts: MethodOptions = options?.options ?? {};
  const doOptimize = options?.optimize ?? true;

  const meta = await sharp(input).metadata();
  assertReadable(meta);
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;

  let svg: string;
  let viewBoxWidth: number;
  let viewBoxHeight: number;
  const used: VectorizeMethod = method;

  try {
    const out = await runMethod(method, input, opts, width, height);
    svg = out.svg;
    viewBoxWidth = out.vbw;
    viewBoxHeight = out.vbh;
  } catch (primary) {
    // Graceful fallback: if the requested method fails, try `edge` (pure JS).
    if (method !== 'edge') {
      const fallback = await runMethod(
        'edge',
        input,
        opts,
        width,
        height,
      ).catch(() => null);
      if (fallback) {
        const note =
          `${capitalize(method)} failed (${primary instanceof Error ? primary.message : String(primary)}); ` +
          'fell back to the Edge method.';
        return buildResult(
          fallback.svg,
          width,
          height,
          'edge',
          doOptimize,
          note,
          fallback.vbw,
          fallback.vbh,
        );
      }
    }
    throw primary;
  }

  return buildResult(
    svg,
    width,
    height,
    used,
    doOptimize,
    undefined,
    viewBoxWidth,
    viewBoxHeight,
  );
}

async function runMethod(
  method: VectorizeMethod,
  input: string | Buffer,
  opts: MethodOptions,
  width: number,
  height: number,
): Promise<MethodOutput> {
  switch (method) {
    case 'potrace': {
      // potrace decodes the source itself; vb dimensions = full resolution.
      const svg = await traceViaPotrace(input, opts);
      return { svg, vbw: width, vbh: height };
    }
    case 'imagetracer': {
      const image: LoadedImage = await loadImage(input);
      const svg = traceViaImageTracer(image, opts);
      return { svg, vbw: image.width, vbh: image.height };
    }
    case 'edge': {
      const image: LoadedImage = await loadImageRgba(
        input,
        opts.resizeMax ?? EDGE_RESIZE_MAX,
      );
      const svg = traceViaEdge(image, opts);
      return { svg, vbw: image.width, vbh: image.height };
    }
    default: {
      const exhaustive: never = method;
      return exhaustive;
    }
  }
}

function buildResult(
  svg: string,
  width: number,
  height: number,
  method: VectorizeMethod,
  optimize: boolean,
  note: string | undefined,
  viewBoxWidth: number,
  viewBoxHeight: number,
): VectorizeResult {
  let final = normalizeSvg(svg, {
    width,
    height,
    viewBoxWidth,
    viewBoxHeight,
  });
  if (optimize) {
    final = optimizeSvg(final);
  }
  const result: VectorizeResult = { svg: final, width, height, method };
  if (note) result.note = note;
  return result;
}

interface SharpMeta {
  width?: number;
  height?: number;
  format?: string | undefined;
}

function assertReadable(meta: SharpMeta): void {
  if (typeof meta.width !== 'number' || typeof meta.height !== 'number') {
    throw new KlearError(
      'Unable to read image dimensions.',
      'E_IMAGE_DIMENSIONS',
    );
  }
  if (meta.format !== 'png' && meta.format !== 'jpeg') {
    throw new KlearError(
      `Unsupported image format '${meta.format ?? 'unknown'}'. ` +
        'Klear supports PNG and JPEG.',
      'E_IMAGE_FORMAT',
    );
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export type {
  VectorizeMethod,
  VectorizeOptions,
  MethodOptions,
  VectorizeResult,
  MethodMeta,
  LoadedImage,
};
export { loadImage, loadImageRgba } from './utils/image.js';
export { optimizeSvg, normalizeSvg, defaultSvgoConfig } from './utils/svg.js';
export { traceViaPotrace } from './methods/potrace.js';
export { traceViaImageTracer } from './methods/imagetracer.js';
export { traceViaEdge } from './methods/edge.js';
export { quantize, colorDistance } from './utils/color.js';
export { marchingSquares, polygonArea } from './utils/contour.js';
export { simplifyLoop } from './utils/simplify.js';
export { KlearError } from './types.js';
