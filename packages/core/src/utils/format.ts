/** Round a coordinate for compact, deterministic SVG path data. */
export function roundCoord(v: number): number {
  return Math.round(v * 100) / 100;
}
