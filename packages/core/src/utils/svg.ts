import { optimize, type Config, type Output } from 'svgo';
import { KlearError } from '../types.js';

/**
 * Default SVGO preset — clean, compact output.
 *
 * IMPORTANT: `removeViewBox` is intentionally omitted so that the `viewBox`
 * we set in `normalizeSvg` survives optimization. `removeDimensions` is also
 * absent, so explicit `width`/`height` are preserved.
 */
export const defaultSvgoConfig: Config = {
  multipass: true,
  plugins: [
    { name: 'removeDoctype' },
    { name: 'removeXMLProcInst' },
    { name: 'removeComments' },
    { name: 'removeMetadata' },
    { name: 'removeEditorsNSData' },
    { name: 'minifyStyles' },
    { name: 'convertStyleToAttrs' },
    { name: 'cleanupAttrs' },
    { name: 'cleanupNumericValues', params: { floatPrecision: 3 } },
    { name: 'sortAttrs' },
    { name: 'mergePaths' },
    'removeUselessDefs',
    'removeEmptyAttrs',
    'removeEmptyContainers',
    'removeEmptyText',
    {
      name: 'convertPathData',
      params: { floatPrecision: 3, transformPrecision: 5 },
    },
    { name: 'convertTransform' },
    { name: 'convertEllipseToCircle' },
    { name: 'cleanupListOfValues' },
  ],
};

/**
 * Optimize an SVG string with SVGO. Returns the optimized markup.
 */
export function optimizeSvg(svg: string, config?: Config): string {
  let result: Output;
  try {
    result = optimize(svg, { ...defaultSvgoConfig, ...config });
  } catch (cause) {
    throw new KlearError(
      `SVG optimization failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      'E_SVG_OPTIMIZE',
    );
  }
  if (typeof result.data !== 'string') {
    throw new KlearError('SVGO did not produce a string.', 'E_SVG_OPTIMIZE');
  }
  return result.data;
}

/**
 * Rewrite the root `<svg>` opening tag so the rendered size (`width`/`height`)
 * and coordinate space (`viewBox`) are consistent across all methods, even
 * when a method downscaled before tracing.
 */
export function normalizeSvg(
  svg: string,
  params: {
    width: number;
    height: number;
    viewBoxWidth: number;
    viewBoxHeight: number;
  },
): string {
  const { width, height, viewBoxWidth, viewBoxHeight } = params;
  if (viewBoxWidth <= 0 || viewBoxHeight <= 0) {
    throw new KlearError(
      'Cannot normalize SVG with zero dimensions.',
      'E_SVG_NORMALIZE',
    );
  }
  const tag =
    `<svg xmlns="http://www.w3.org/2000/svg"` +
    ` width="${Math.round(width)}"` +
    ` height="${Math.round(height)}"` +
    ` viewBox="0 0 ${Math.round(viewBoxWidth)} ${Math.round(viewBoxHeight)}"` +
    ` preserveAspectRatio="xMidYMid meet">`;
  // Replace only the first <svg ...> opening tag.
  return svg.replace(/<svg\b[^>]*>/, tag);
}

/** Escape a value for safe inclusion as an SVG attribute. */
export function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
