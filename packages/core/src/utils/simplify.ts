/**
 * Polygon simplification via the Ramer-Douglas-Peucker algorithm.
 *
 * Contours extracted by marching squares contain one vertex per cell-edge
 * crossing, so straight edges produce long runs of collinear points. RDP
 * collapses those runs while preserving corners that deviate by more than
 * the tolerance.
 */

export interface SimplifiablePoint {
  x: number;
  y: number;
}

/** Perpendicular distance from `p` to the line segment `a`–`b`. */
function pointLineDistance(
  p: SimplifiablePoint,
  a: SimplifiablePoint,
  b: SimplifiablePoint,
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(
    0,
    Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq),
  );
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Classic recursive RDP over an *open* chain; keeps the first and last points. */
function rdp(
  points: SimplifiablePoint[],
  tolerance: number,
): SimplifiablePoint[] {
  if (points.length < 3) return [...points];
  const first = points[0]!;
  const last = points[points.length - 1]!;

  let maxDist = -1;
  let index = -1;
  for (let i = 1; i < points.length - 1; i++) {
    const d = pointLineDistance(points[i]!, first, last);
    if (d > maxDist) {
      maxDist = d;
      index = i;
    }
  }

  if (maxDist > tolerance && index !== -1) {
    const left = rdp(points.slice(0, index + 1), tolerance);
    const right = rdp(points.slice(index), tolerance);
    return left.concat(right.slice(1));
  }
  return [first, last];
}

/**
 * Simplify a *closed* loop. The loop is split at its two farthest-apart
 * vertices into two open chains, each simplified with RDP, then re-joined
 * (dropping the shared split vertices). Collinear points on straight runs
 * are removed while genuine corners survive.
 */
export function simplifyLoop(
  points: SimplifiablePoint[],
  tolerance = 1,
): SimplifiablePoint[] {
  if (points.length < 4) return [...points];

  let maxSpan = -1;
  let splitA = 0;
  let splitB = 0;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const dx = points[i]!.x - points[j]!.x;
      const dy = points[i]!.y - points[j]!.y;
      const span = dx * dx + dy * dy;
      if (span > maxSpan) {
        maxSpan = span;
        splitA = i;
        splitB = j;
      }
    }
  }

  const n = points.length;
  const chainA: SimplifiablePoint[] = [];
  const chainB: SimplifiablePoint[] = [];
  for (let k = splitA; ; k = (k + 1) % n) {
    chainA.push(points[k]!);
    if (k === splitB) break;
  }
  for (let k = splitB; ; k = (k + 1) % n) {
    chainB.push(points[k]!);
    if (k === splitA) break;
  }

  const simpleA = rdp(chainA, tolerance);
  const simpleB = rdp(chainB, tolerance);
  return simpleA.concat(simpleB.slice(1, -1));
}
