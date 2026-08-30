import * as ImageTracer from 'imagetracerjs';
import type { ImageTracerOptions, ImageTracerImageData } from 'imagetracerjs';
import type { LoadedImage, MethodOptions } from '../types.js';
import { KlearError } from '../types.js';

/**
 * Trace a bitmap via ImageTracer (fast color posterization + path tracing).
 *
 * This method is the fastest and handles color images well. It operates on
 * a normalized RGBA bitmap produced by sharp.
 */
export function traceViaImageTracer(
  image: LoadedImage,
  opts: MethodOptions,
): string {
  const imagedata: ImageTracerImageData = {
    data: image.data,
    width: image.width,
    height: image.height,
  };

  const tracerOpts: ImageTracerOptions = {
    colorsampling: 2,
    numberofcolors: opts.colors ?? opts.numberofcolors ?? 16,
    ltres: opts.ltres,
    qtres: opts.qtres,
    pathomit: opts.pathomit,
    scale: opts.scale,
    roundcoords: opts.roundcoords,
    strokewidth: 1,
    viewbox: true,
  };

  // If a preset name string was provided, imagetracer accepts it; otherwise
  // the options object above is used.
  let svg: string;
  try {
    svg = ImageTracer.imagedataToSVG(imagedata, cleanOpts(tracerOpts));
  } catch (cause) {
    throw new KlearError(
      `ImageTracer failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      'E_IMAGETRACER',
    );
  }

  if (typeof svg !== 'string' || svg.length === 0) {
    throw new KlearError('ImageTracer produced no output.', 'E_IMAGETRACER');
  }

  return svg;
}

/** Remove undefined keys so defaults propagate from ImageTracer. */
function cleanOpts(o: ImageTracerOptions): ImageTracerOptions {
  const out: ImageTracerOptions = {};
  for (const key of Object.keys(o)) {
    const v = o[key as keyof ImageTracerOptions];
    if (v !== undefined) {
      out[key as keyof ImageTracerOptions] = v;
    }
  }
  return out;
}
