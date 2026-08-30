/**
 * Minimal ambient type declarations for `imagetracerjs` (Node.js surface).
 *
 * The package ships no TypeScript types. Its stable Node.js entry point is
 * `imagedataToSVG(imagedata, options)` which returns an SVG string
 * synchronously. `imageToSVG` is browser-only (requires a canvas/URL).
 */
declare module "imagetracerjs" {
  export interface ImageTracerImageData {
    data: Uint8Array | Uint8ClampedArray | ArrayLike<number>;
    width: number;
    height: number;
  }

  export interface ImageTracerOptions {
    numberofcolors?: number;
    colorsampling?: number;
    mincolorratio?: number;
    colorquantcycles?: number;
    ltres?: number;
    qtres?: number;
    rightangleenhance?: boolean;
    pathomit?: number;
    layering?: number;
    strokewidth?: number;
    linefilter?: boolean;
    scale?: number;
    roundcoords?: number;
    viewbox?: boolean;
    desc?: boolean;
    blurradius?: number;
    blurdelta?: number;
    lcpr?: number;
    qcpr?: number;
    [key: string]: unknown;
  }

  export function imagedataToSVG(
    imagedata: ImageTracerImageData,
    options?: ImageTracerOptions | string,
  ): string;

  export function imageToSVG(
    image_url: string,
    callback: (svgstr: string) => void,
    options?: ImageTracerOptions | string,
  ): void;

  export const optionpresets: Record<string, ImageTracerOptions>;
  export const versionnumber: string;
}
