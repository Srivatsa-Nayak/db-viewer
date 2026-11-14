/**
 * Arranges tables by their relationships: a table on the left, the tables that point at it to
 * its right, and so on down the chain.
 *
 * The default grid (`defaultPosition`) places tables in whatever order the database lists them,
 * which for an imported dump of thirty tables means every foreign key crosses half the canvas.
 * This is a small layered ("Sugiyama-style") layout rather than a library: elkjs is over a
 * megabyte, and a schema needs only the basic version —
 *
 * 1. **Layers.** A referenced table goes to the left of everything that references it, so each
 *    table's column is the length of the longest chain of keys leading to it. Cycles (two tables
 *    pointing at each other, or a longer loop) are broken by ignoring the edge that closes them.
 * 2. **Order within a layer.** A few sweeps placing each table at the average position of its
 *    neighbours in the column before (then after), which is the standard way to remove most
 *    line crossings without solving the problem exactly.
 * 3. **Coordinates.** Columns are spaced by the widest table, tables in a column by their real
 *    heights, and each column is centred against the tallest.
 *
 * Tables with no relationships at all are laid out in a grid underneath, so they neither sit in
 * the first column pretending to be parents nor push the connected diagram apart. Pure — sizes
 * are passed in — so it is unit-tested.
 */
import type { Relationship } from '@/types';

export type Point = { x: number; y: number };
export type Size = { width: number; height: number };

const GAP_X = 140;
const GAP_Y = 56;
const SWEEPS = 6;

export const autoLayout = (
    tables: string[],
    relationships: Relationship[],
    sizeOf: (table: string) => Size,
): Record<string, Point> => {
    const known = new Set(tables);
    const parents = new Map<string, Set<string>>(tables.map(t => [t, new Set()]));
    const children = new Map<string, Set<string>>(tables.map(t => [t, new Set()]));
    for (const rel of relationships) {
        const child = rel.sourceTable;
        const parent = rel.targetTable;
        if (child === parent || !known.has(child) || !known.has(parent)) continue;
        parents.get(child)!.add(parent);
        children.get(parent)!.add(child);
    }

    const connected = tables.filter(t => parents.get(t)!.size > 0 || children.get(t)!.size > 0);
    const isolated = tables.filter(t => !connected.includes(t));

    // 1. Layers: a table's column is one past its deepest parent's, by a memoised depth-first
    // search. An edge to a table still on the stack closes a cycle and is ignored, which is
    // what breaks it.
    const layer = new Map<string, number>();
    const onStack = new Set<string>();
    const depth = (table: string): number => {
        const cached = layer.get(table);
        if (cached !== undefined) return cached;
        onStack.add(table);
        let d = 0;
        for (const parent of parents.get(table)!) {
            if (onStack.has(parent)) continue;
            d = Math.max(d, depth(parent) + 1);
        }
        onStack.delete(table);
        layer.set(table, d);
        return d;
    };
    connected.forEach(depth);

    const layers: string[][] = [];
    for (const table of connected) {
        const l = layer.get(table)!;
        (layers[l] ??= []).push(table);
    }

    // 2. Order within each layer by the barycentre of the neighbours in the adjacent layer.
    const indexIn = (list: string[]) => new Map(list.map((t, i) => [t, i]));
    const barycentre = (table: string, neighbours: Set<string>, positions: Map<string, number>) => {
        const at = [...neighbours].map(n => positions.get(n)).filter((i): i is number => i !== undefined);
        return at.length === 0 ? undefined : at.reduce((a, b) => a + b, 0) / at.length;
    };
    const reorder = (list: string[], reference: string[], neighboursOf: (t: string) => Set<string>) => {
        const positions = indexIn(reference);
        const current = indexIn(list);
        return [...list].sort((a, b) => {
            const ba = barycentre(a, neighboursOf(a), positions) ?? current.get(a)!;
            const bb = barycentre(b, neighboursOf(b), positions) ?? current.get(b)!;
            return ba - bb || current.get(a)! - current.get(b)!;
        });
    };
    for (let sweep = 0; sweep < SWEEPS; sweep++) {
        if (sweep % 2 === 0) {
            for (let l = 1; l < layers.length; l++) {
                layers[l] = reorder(layers[l], layers[l - 1], t => parents.get(t)!);
            }
        } else {
            for (let l = layers.length - 2; l >= 0; l--) {
                layers[l] = reorder(layers[l], layers[l + 1], t => children.get(t)!);
            }
        }
    }

    // 3. Coordinates.
    const positions: Record<string, Point> = {};
    const columnWidth = Math.max(0, ...tables.map(t => sizeOf(t).width));
    const heightOf = (column: string[]) =>
        column.reduce((sum, t) => sum + sizeOf(t).height, 0) + GAP_Y * Math.max(0, column.length - 1);
    const tallest = Math.max(0, ...layers.map(heightOf));

    layers.forEach((column, l) => {
        let y = (tallest - heightOf(column)) / 2;
        for (const table of column) {
            positions[table] = { x: l * (columnWidth + GAP_X), y: Math.round(y) };
            y += sizeOf(table).height + GAP_Y;
        }
    });

    if (isolated.length > 0) {
        const perRow = Math.max(1, Math.max(layers.length, Math.ceil(Math.sqrt(isolated.length))));
        const top = connected.length > 0 ? tallest + GAP_Y * 3 : 0;
        let rowTop = top;
        for (let start = 0; start < isolated.length; start += perRow) {
            const row = isolated.slice(start, start + perRow);
            row.forEach((table, i) => {
                positions[table] = { x: i * (columnWidth + GAP_X), y: Math.round(rowTop) };
            });
            rowTop += Math.max(...row.map(t => sizeOf(t).height)) + GAP_Y;
        }
    }

    return positions;
};

/** How many relationship lines cross — what the layout tries to keep low. For tests. */
export const crossings = (positions: Record<string, Point>, relationships: Relationship[]): number => {
    const segments = relationships
        .filter(r => r.sourceTable !== r.targetTable && positions[r.sourceTable] && positions[r.targetTable])
        .map(r => [positions[r.targetTable], positions[r.sourceTable]] as const);
    let count = 0;
    for (let i = 0; i < segments.length; i++) {
        for (let j = i + 1; j < segments.length; j++) {
            const [a1, a2] = segments[i];
            const [b1, b2] = segments[j];
            // Only segments between the same two columns can cross in a layered drawing.
            if (a1.x !== b1.x || a2.x !== b2.x) continue;
            if ((a1.y - b1.y) * (a2.y - b2.y) < 0) count++;
        }
    }
    return count;
};
