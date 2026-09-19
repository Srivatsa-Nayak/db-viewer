/**
 * Orthogonal edge routing with obstacle avoidance.
 *
 * A relationship line drawn point-to-point is fine for six tables and unreadable for sixty: the
 * diagonals cross each other at every angle, and each one passes straight through whatever
 * happens to lie between its two ends — so a line that enters a table and a line that *ends* at
 * that table look identical. Right angles fix the first problem (parallel runs read as parallel,
 * and a crossing is unambiguous); routing around the boxes fixes the second.
 *
 * This is deliberately not a general pathfinder. A full visibility graph or an A* over a grid is
 * the textbook answer and far too slow to run on every frame of a node drag. Instead it proposes
 * a small set of candidate routes — the shapes a person would draw by hand — scores each against
 * the obstacles, and takes the best. The result is optimal for the easy cases, good for the hard
 * ones, and bounded in both directions.
 */

export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface Point {
    x: number;
    y: number;
}

/** How far a line travels straight out of a node before it is allowed to turn. */
const STUB = 22;

/** Clearance kept between a line and any box it passes. */
const MARGIN = 18;

/** A crossing costs about this many pixels of detour; the balance decides how eager to detour. */
const COLLISION_PENALTY = 4000;

/** Bends are cheap but not free, or the router picks a staircase over a straight line. */
const BEND_PENALTY = 26;

/** Only obstacles near the route matter, and an edge must not pay to consider all 200 tables. */
const NEIGHBOURHOOD = 400;

const between = (value: number, low: number, high: number) => value >= low && value <= high;

/** Does an axis-aligned segment pass through the rectangle? Touching the border does not count. */
const segmentHitsRect = (a: Point, b: Point, rect: Rect): boolean => {
    const left = rect.x - MARGIN;
    const right = rect.x + rect.width + MARGIN;
    const top = rect.y - MARGIN;
    const bottom = rect.y + rect.height + MARGIN;

    if (a.y === b.y) {
        const x1 = Math.min(a.x, b.x);
        const x2 = Math.max(a.x, b.x);
        return between(a.y, top, bottom) && x1 < right && x2 > left;
    }
    if (a.x === b.x) {
        const y1 = Math.min(a.y, b.y);
        const y2 = Math.max(a.y, b.y);
        return between(a.x, left, right) && y1 < bottom && y2 > top;
    }
    // Diagonals never occur here, but a wrong answer would be a silently missed collision.
    return false;
};

const pathLength = (points: Point[]): number => {
    let total = 0;
    for (let i = 1; i < points.length; i++) {
        total += Math.abs(points[i].x - points[i - 1].x) + Math.abs(points[i].y - points[i - 1].y);
    }
    return total;
};

const countCollisions = (points: Point[], obstacles: Rect[]): number => {
    let hits = 0;
    for (let i = 1; i < points.length; i++) {
        for (const rect of obstacles) {
            if (segmentHitsRect(points[i - 1], points[i], rect)) hits++;
        }
    }
    return hits;
};

/** Drops the middle of any three points that are on the same line, and any zero-length step. */
const simplify = (points: Point[]): Point[] => {
    const out: Point[] = [];
    for (const point of points) {
        const last = out[out.length - 1];
        if (last && Math.abs(last.x - point.x) < 0.5 && Math.abs(last.y - point.y) < 0.5) continue;
        out.push(point);
    }
    for (let i = out.length - 2; i > 0; i--) {
        const before = out[i - 1];
        const after = out[i + 1];
        const collinear = (before.x === out[i].x && out[i].x === after.x)
            || (before.y === out[i].y && out[i].y === after.y);
        if (collinear) out.splice(i, 1);
    }
    return out;
};

/**
 * Candidate routes, cheapest shape first.
 *
 * Every one leaves the source heading right and enters the target heading right, because that is
 * how the table nodes are wired: a key is a handle on the right edge, a foreign key a handle on
 * the left. The variety is in what happens in between.
 */
const candidateRoutes = (source: Point, target: Point, obstacles: Rect[]): Point[][] => {
    const exit = { x: source.x + STUB, y: source.y };
    const entry = { x: target.x - STUB, y: target.y };
    const routes: Point[][] = [];

    // 1. Straight across, when the two handles are already level.
    if (Math.abs(source.y - target.y) < 1) {
        routes.push([source, target]);
    }

    // 2. The ordinary case: out, along a vertical channel, in. The channel is tried at the
    //    midpoint first and then at the free edge of each obstacle in the way, which is what
    //    turns "through that table" into "just past it".
    const channels = new Set<number>([(exit.x + entry.x) / 2]);
    for (const rect of obstacles) {
        channels.add(rect.x - MARGIN - 6);
        channels.add(rect.x + rect.width + MARGIN + 6);
    }
    for (const channelX of channels) {
        if (channelX <= exit.x || channelX >= entry.x) continue;
        routes.push([
            source, exit,
            { x: channelX, y: source.y },
            { x: channelX, y: target.y },
            entry, target,
        ]);
    }

    // 3. The target is behind the source - a self-referencing chain, or a table the user has
    //    dragged to the left of the one pointing at it. The line has to double back, and it
    //    does so above or below everything rather than through it.
    if (entry.x <= exit.x) {
        const lanes = new Set<number>([
            Math.min(source.y, target.y) - 60,
            Math.max(source.y, target.y) + 60,
        ]);
        for (const rect of obstacles) {
            lanes.add(rect.y - MARGIN - 12);
            lanes.add(rect.y + rect.height + MARGIN + 12);
        }
        for (const laneY of lanes) {
            routes.push([
                source, exit,
                { x: exit.x, y: laneY },
                { x: entry.x, y: laneY },
                entry, target,
            ]);
        }
    }

    // 4. Last resort, and always collision-free in the vertical: leave, drop to a clear lane
    //    below both boxes, run across, and come back up.
    const clearance = Math.max(source.y, target.y)
        + obstacles.reduce((lowest, r) => Math.max(lowest, r.y + r.height - Math.max(source.y, target.y)), 0)
        + 70;
    routes.push([
        source, exit,
        { x: exit.x, y: clearance },
        { x: entry.x, y: clearance },
        entry, target,
    ]);

    return routes;
};

/**
 * The best route from the source handle to the target handle.
 *
 * @param obstacles every node on the canvas *except* the two this edge connects — an edge
 *                  necessarily touches its own endpoints, and counting those as collisions
 *                  would make every route equally bad and the scoring meaningless
 */
export const routeEdge = (source: Point, target: Point, obstacles: Rect[]): Point[] => {
    // Only what is nearby can be in the way, and an edge should not pay to consider the whole
    // canvas on every frame of a drag.
    const minX = Math.min(source.x, target.x) - NEIGHBOURHOOD;
    const maxX = Math.max(source.x, target.x) + NEIGHBOURHOOD;
    const minY = Math.min(source.y, target.y) - NEIGHBOURHOOD;
    const maxY = Math.max(source.y, target.y) + NEIGHBOURHOOD;

    const nearby = obstacles.filter(r =>
        r.x + r.width > minX && r.x < maxX && r.y + r.height > minY && r.y < maxY);

    let best: Point[] | null = null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (const route of candidateRoutes(source, target, nearby)) {
        const points = simplify(route);
        const score = countCollisions(points, nearby) * COLLISION_PENALTY
            + pathLength(points)
            + Math.max(0, points.length - 2) * BEND_PENALTY;
        if (score < bestScore) {
            bestScore = score;
            best = points;
        }
    }

    return best ?? simplify([source, { x: source.x + STUB, y: source.y },
        { x: target.x - STUB, y: source.y }, { x: target.x - STUB, y: target.y }, target]);
};

/**
 * An SVG path with the corners rounded off.
 *
 * Square corners on a 1.5px line alias badly at anything other than 100% zoom, and a diagram
 * full of them reads as a circuit board rather than a schema.
 */
export const toRoundedPath = (points: Point[], radius = 9): string => {
    if (points.length === 0) return '';
    if (points.length === 1) return `M ${points[0].x},${points[0].y}`;

    let path = `M ${points[0].x},${points[0].y}`;

    for (let i = 1; i < points.length - 1; i++) {
        const previous = points[i - 1];
        const corner = points[i];
        const next = points[i + 1];

        // Never round more than half of either leg, or adjacent corners overlap and the path
        // folds back on itself.
        const inLength = Math.hypot(corner.x - previous.x, corner.y - previous.y);
        const outLength = Math.hypot(next.x - corner.x, next.y - corner.y);
        const r = Math.min(radius, inLength / 2, outLength / 2);
        if (r < 1) continue;

        const start = {
            x: corner.x + (previous.x - corner.x) * (r / inLength),
            y: corner.y + (previous.y - corner.y) * (r / inLength),
        };
        const end = {
            x: corner.x + (next.x - corner.x) * (r / outLength),
            y: corner.y + (next.y - corner.y) * (r / outLength),
        };

        path += ` L ${start.x},${start.y} Q ${corner.x},${corner.y} ${end.x},${end.y}`;
    }

    const last = points[points.length - 1];
    return `${path} L ${last.x},${last.y}`;
};

/** The point to hang a label or a midpoint marker on: the middle of the longest straight run. */
export const midpointOf = (points: Point[]): Point => {
    if (points.length < 2) return points[0] ?? { x: 0, y: 0 };
    let bestIndex = 0;
    let bestLength = -1;
    for (let i = 1; i < points.length; i++) {
        const length = Math.abs(points[i].x - points[i - 1].x) + Math.abs(points[i].y - points[i - 1].y);
        if (length > bestLength) {
            bestLength = length;
            bestIndex = i;
        }
    }
    return {
        x: (points[bestIndex].x + points[bestIndex - 1].x) / 2,
        y: (points[bestIndex].y + points[bestIndex - 1].y) / 2,
    };
};
