import sharp from 'sharp';
import { KlearError, type LoadedImage } from '../types.js';

/** Minimal structural view of sharp's metadata we care about. */
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

/**
 * Load an image (file path or Buffer) into a normalized RGBA bitmap at the
 * source resolution. Throws a KlearError for unsupported/invalid images.
 */
export async function loadImage(input: string | Buffer): Promise<LoadedImage> {
  let meta: SharpMeta;
  try {
    meta = await sharp(input).metadata();
  } catch (cause) {
    throw new KlearError(
      `Unable to read image: ${errorCause(cause)}`,
      'E_IMAGE_LOAD',
    );
  }
  assertReadable(meta);

  let data: Buffer;
  try {
    data = await sharp(input).ensureAlpha().raw().toBuffer();
  } catch (cause) {
    throw new KlearError(
      `Failed to decode pixel data: ${errorCause(cause)}`,
      'E_IMAGE_DECODE',
    );
  }

  return {
    width: meta.width ?? 0,
    height: meta.height ?? 0,
    data,
    originalWidth: meta.width ?? 0,
    originalHeight: meta.height ?? 0,
  };
}

/**
 * Load an image into RGBA, optionally downscaling so the longer side is at
 * most `resizeMax` (used by the pure-JS `edge` + `imagetracer` methods for
 * speed). Returned `width`/`height` are the (possibly resized) bitmap
 * dimensions; `originalWidth`/`originalHeight` are the source dimensions.
 */
export async function loadImageRgba(
  input: string | Buffer,
  resizeMax?: number,
): Promise<LoadedImage> {
  let meta: SharpMeta;
  try {
    meta = await sharp(input).metadata();
  } catch (cause) {
    throw new KlearError(
      `Unable to read image: ${errorCause(cause)}`,
      'E_IMAGE_LOAD',
    );
  }
  assertReadable(meta);

  const origW = meta.width ?? 0;
  const origH = meta.height ?? 0;

  let pipeline = sharp(input);
  let outW = origW;
  let outH = origH;
  if (
    typeof resizeMax === 'number' &&
    resizeMax > 0 &&
    origW > 0 &&
    origH > 0
  ) {
    const ratio = Math.min(resizeMax / origW, resizeMax / origH);
    if (ratio < 1) {
      outW = Math.max(1, Math.round(origW * ratio));
      outH = Math.max(1, Math.round(origH * ratio));
      pipeline = pipeline.resize(outW, outH, { fit: 'fill' });
    }
  }

  let data: Buffer;
  try {
    data = await pipeline.ensureAlpha().raw().toBuffer();
  } catch (cause) {
    throw new KlearError(
      `Failed to decode pixel data: ${errorCause(cause)}`,
      'E_IMAGE_DECODE',
    );
  }

  return {
    width: outW,
    height: outH,
    data,
    originalWidth: origW,
    originalHeight: origH,
  };
}

function errorCause(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  return String(cause);
}
