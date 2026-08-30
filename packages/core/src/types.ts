/**
 * Klear core — shared types for the vectorization engine.
 */

export type VectorizeMethod = 'potrace' | 'imagetracer' | 'edge';

export interface MethodMeta {
  id: VectorizeMethod;
  name: string;
  description: string;
}

export interface MethodOptions {
  /** Potrace options */
  threshold?: number; // 0-255, default 128
  color?: string;
  background?: string;
  turdSize?: number;
  alphaMax?: number;
  optCurve?: boolean;
  /** ImageTracer options */
  colors?: number;
  ltres?: number;
  qtres?: number;
  pathomit?: number;
  scale?: number;
  roundcoords?: number;
  numberofcolors?: number;
  /** Edge-specific options */
  maxColors?: number;
  resizeMax?: number;
  edgeTolerance?: number;
}

export interface VectorizeOptions {
  method?: VectorizeMethod;
  /** Optimize the produced SVG with SVGO */
  optimize?: boolean;
  /** Override for method-specific options */
  options?: MethodOptions;
}

export interface VectorizeResult {
  svg: string;
  width: number;
  height: number;
  method: VectorizeMethod;
  note?: string;
}

export interface LoadedImage {
  width: number;
  height: number;
  data: Buffer; // RGBA pixels
  originalWidth: number;
  originalHeight: number;
}

export class KlearError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'KlearError';
    this.code = code;
  }
}
