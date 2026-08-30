/**
 * Marching Squares contour extraction for binary masks.
 *
 * Given a binary mask (1 = inside region, 0 = outside), produces the set of
 * closed boundary polygons (loops) as arrays of `{ x, y }` vertices. Each
 * vertex lies on a cell edge midpoint (half-integer coordinates), so a
 * `viewBox="0 0 w h"` over a `w × h` bitmap renders them correctly.
 *
 * Cases 5 and 10 (diagonal ambiguity) are resolved by sampling the cell
 * center (average of the four corners).
 *
 * Boundary tracing uses the clockwise-next rule on an undirected
 * adjacency graph: at each vertex, having arrived from a neighbour,
 * the next edge is the first clockwise neighbour.
 */

export interface Point {
  x: number;
  y: number;
}

/** Lookup table: case index -> list of (edgeA, edgeB) segments. */
const SEGS: ReadonlyArray<ReadonlyArray<[number, number]>> = [
  [], // 0
  [[3, 0]], // 1
  [[0, 1]], // 2
  [[3, 1]], // 3
  [[1, 2]], // 4
  [], // 5 (ambiguous, computed dynamically)
  [[0, 2]], // 6
  [[3, 2]], // 7
  [[2, 3]], // 8
  [[0, 2]], // 9
  [], // 10 (ambiguous, computed dynamically)
  [[1, 2]], // 11
  [[3, 1]], // 12
  [[0, 1]], // 13
  [[0, 3]], // 14
  [], // 15
];

/** Midpoint of each cell edge, relative to the cell's top-left corner. */
const EDGE: ReadonlyArray<(cx: number, cy: number) => Point> = [
  (cx, cy) => ({ x: cx + 0.5, y: cy }), // 0: top
  (cx, cy) => ({ x: cx + 1, y: cy + 0.5 }), // 1: right
  (cx, cy) => ({ x: cx + 0.5, y: cy + 1 }), // 2: bottom
  (cx, cy) => ({ x: cx, y: cy + 0.5 }), // 3: left
];

/** Clockwise angle of direction (dx, dy) in screen coords (y down), in [0, 2π). */
function clockAngle(dx: number, dy: number): number {
  const a = Math.atan2(dy, dx);
  return a < 0 ? a + 2 * Math.PI : a;
}

function vkey(p: Point): string {
  return `${Math.round(p.x * 100) / 100},${Math.round(p.y * 100) / 100}`;
}

function corner(
  mask: Uint8Array,
  w: number,
  h: number,
  x: number,
  y: number,
): number {
  if (x < 0 || y < 0 || x >= w || y >= h) return 0;
  return mask[x + y * w] ?? 0;
}

export function keyToPoint(key: string): Point {
  const parts = key.split(',');
  const x = Number(parts[0] ?? '0');
  const y = Number(parts[1] ?? '0');
  return { x, y };
}

/** Signed area of a polygon (shoelace); used for filtering + winding. */
export function polygonArea(points: Point[]): number {
  let area = 0;
  const n = points.length;
  if (n < 3) return 0;
  for (let i = 0; i < n; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % n]!;
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

/**
 * Extract closed boundary loops from a binary mask using marching squares.
 */
export function marchingSquares(
  mask: Uint8Array,
  width: number,
  height: number,
): Point[][] {
  if (width < 2 || height < 2) return [];

  // 1. Build undirected adjacency multigraph.
  //    Each marching-squares segment a—b adds b to adj[a] and a to adj[b].
  const adj = new Map<string, string[]>();

  const addEdge = (a: Point, b: Point): void => {
    const ka = vkey(a);
    const kb = vkey(b);
    let la = adj.get(ka);
    if (!la) {
      la = [];
      adj.set(ka, la);
    }
    la.push(kb);
    let lb = adj.get(kb);
    if (!lb) {
      lb = [];
      adj.set(kb, lb);
    }
    lb.push(ka);
  };

  // Iterate one ring of out-of-canvas cells around the mask. `corner()` maps
  // out-of-bounds grid points to 0, so a region touching the canvas edge gets
  // its perimeter segments traced here too — otherwise masks whose boundary
  // coincides with the canvas edge would never close into a loop.
  for (let cy = -1; cy <= height; cy++) {
    for (let cx = -1; cx <= width; cx++) {
      const tl = corner(mask, width, height, cx, cy);
      const tr = corner(mask, width, height, cx + 1, cy);
      const br = corner(mask, width, height, cx + 1, cy + 1);
      const bl = corner(mask, width, height, cx, cy + 1);
      const idx =
        (tl & 1) | ((tr & 1) << 1) | ((br & 1) << 2) | ((bl & 1) << 3);

      let segs: ReadonlyArray<[number, number]> =
        idx < SEGS.length ? (SEGS[idx] ?? []) : [];
      if (idx === 5 || idx === 10) {
        const centerFg = (tl + tr + br + bl) / 4 >= 0.5;
        if (idx === 5) {
          segs = centerFg
            ? [
                [0, 1],
                [2, 3],
              ]
            : [
                [0, 3],
                [1, 2],
              ];
        } else {
          segs = centerFg
            ? [
                [0, 3],
                [1, 2],
              ]
            : [
                [0, 1],
                [2, 3],
              ];
        }
      }

      for (const [ea, eb] of segs) {
        const a = EDGE[ea]!(cx, cy);
        const b = EDGE[eb]!(cx, cy);
        addEdge(a, b);
      }
    }
  }

  if (adj.size === 0) return [];

  // 2. Deduplicate and sort neighbours clockwise at each vertex.
  for (const [key, neighbours] of adj) {
    const unique = [...new Set(neighbours)];
    const parts = key.split(',');
    const vx = Number(parts[0]);
    const vy = Number(parts[1]);
    unique.sort((a, b) => {
      const aP = a.split(',');
      const bP = b.split(',');
      return (
        clockAngle(Number(aP[0]) - vx, Number(aP[1]) - vy) -
        clockAngle(Number(bP[0]) - vx, Number(bP[1]) - vy)
      );
    });
    adj.set(key, unique);
  }

  // 3. Trace closed loops using the clockwise-next rule.
  //    At vertex `curKey`, having arrived from `prevKey`, the next neighbour
  //    is the one just clockwise from `prevKey` in the sorted list (index + 1).
  const loops: Point[][] = [];
  const visitedEdges = new Set<string>();

  for (const [startKey, neighbours] of adj) {
    for (const nextKey of neighbours) {
      const edgeId = `${startKey}|${nextKey}`;
      if (visitedEdges.has(edgeId)) continue;
      visitedEdges.add(edgeId);

      const loop: Point[] = [keyToPoint(startKey)];
      let prevKey = startKey;
      let curKey = nextKey;
      let guard = 0;
      const MAX_GUARD = adj.size * 4 + 16;

      while (curKey !== startKey) {
        guard++;
        if (guard > MAX_GUARD) break;

        const curNeighbours = adj.get(curKey);
        if (!curNeighbours || curNeighbours.length === 0) break;

        const prevIdx = curNeighbours.indexOf(prevKey);
        if (prevIdx === -1) break;

        const nextIdx = (prevIdx + 1) % curNeighbours.length;
        const nextNextKey = curNeighbours[nextIdx]!;

        const nextEdgeId = `${curKey}|${nextNextKey}`;
        const revEdgeId = `${nextNextKey}|${curKey}`;
        if (visitedEdges.has(nextEdgeId) || visitedEdges.has(revEdgeId)) break;
        visitedEdges.add(nextEdgeId);
        visitedEdges.add(revEdgeId);

        loop.push(keyToPoint(nextNextKey));
        prevKey = curKey;
        curKey = nextNextKey;
      }

      if (loop.length >= 3 && curKey === startKey) {
        loops.push(loop);
      }
    }
  }

  return loops;
}
