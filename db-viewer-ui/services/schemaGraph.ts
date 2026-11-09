import { Edge, MarkerType, Node } from "reactflow";
import type { EdgeCardinality } from "@/components/canvas/OrthogonalEdge";
import type { GroupBoxData } from "@/components/canvas/GroupBox";
import { CanvasGroup, Relationship, TableInfo } from "@/types";

/**
 * Turning the backend's schema into what React Flow draws: edges with crow's-foot cardinality,
 * the handles each node needs, group boxes, and the initial grid.
 *
 * Moved out of `app/app/page.tsx` unchanged. They are pure functions of the schema, so they are
 * the part of the page that can be tested without rendering it — and the page was 1,900 lines.
 */

/**
 * A CSS variable rather than a hex value, so the lines follow the theme.
 *
 * React Flow puts the marker colour in a `style` object and the edge colour in one too, and
 * `var()` resolves in both. The dot grid is the one place it does not - see `Visualizer`.
 */
const EDGE_COLOUR = 'var(--color-edge)';

/**
 * A stable identity for a relationship, independent of where it sits in the list.
 *
 * Edge ids used to be positional (`e-0`, `e-1`…), which meant every id shifted the moment a
 * foreign key was added or removed. Anything keyed by edge id — per-edge state, a selection, a
 * cardinality override — would silently reattach to a different edge.
 */
export const edgeIdFor = (rel: Relationship): string =>
    `${rel.targetTable}.${rel.targetColumn}->${rel.sourceTable}.${rel.sourceColumn}`;

/** Distinguishes a group's React Flow node from a table's, whose id is the table name. */
export const GROUP_NODE_PREFIX = 'group:';

const GROUP_PADDING = 28;
const GROUP_HEADER = 22;

/**
 * Turns each group into a React Flow node sized to whatever it currently contains.
 *
 * A group whose tables have all been dropped produces nothing — it is not an error and not worth
 * a message, it is just a box with nothing to draw around. The same skip handles a member that
 * was renamed or removed, which is why membership never has to be tidied up after a drop.
 */
export const groupNodes = (
    groups: CanvasGroup[],
    tableNodes: Node[],
    handlers: Omit<GroupBoxData, 'group' | 'memberCount'>,
): Node[] =>
    groups.flatMap(group => {
        const members = tableNodes.filter(n => group.tables.includes(n.id));
        if (members.length === 0) return [];

        const left = Math.min(...members.map(n => n.position.x));
        const top = Math.min(...members.map(n => n.position.y));
        // `width`/`height` are written onto the node by React Flow once it has measured it;
        // the fallbacks cover the frames before that, when a box would otherwise be the wrong size.
        const right = Math.max(...members.map(n => n.position.x + (n.width ?? 240)));
        const bottom = Math.max(...members.map(n => n.position.y + (n.height ?? 140)));

        const width = right - left + GROUP_PADDING * 2;
        const height = bottom - top + GROUP_PADDING * 2 + GROUP_HEADER;

        return [{
            id: `${GROUP_NODE_PREFIX}${group.id}`,
            // See the note on `nodeTypes` in Visualizer: `group` is taken by React Flow.
            type: 'domainGroup',
            position: { x: left - GROUP_PADDING, y: top - GROUP_PADDING - GROUP_HEADER },
            style: { width, height },
            /**
             * Given, not measured — and without them the box never appears at all.
             *
             * React Flow keeps a node hidden (`visibility: hidden`) until it knows its size, and
             * in controlled mode it learns that from a `dimensions` change round-tripping back
             * through the `nodes` prop. `onNodesChange` applies changes to `workspace.nodes`,
             * which holds tables only, so a group's measurement was discarded every time and the
             * box stayed invisible for ever. Since the size is derived here anyway, saying it
             * outright is both the fix and the honest description.
             */
            width,
            height,
            // Deliberately *not* `zIndex: -1`. That does put the box behind the tables — and
            // behind React Flow's own interaction pane as well, which makes every control on the
            // box unclickable: `elementFromPoint` over its menu button returned the pane.
            // Painting order comes from array order instead (groups are emitted first), and the
            // box body sets `pointer-events: none` so it cannot swallow a click meant for the
            // canvas underneath it.
            selectable: false,
            data: { group, memberCount: members.length, ...handlers },
        }];
    });

/**
 * Tables that exist only to join two others.
 *
 * A many-to-many relationship is not something a relational database can hold: it is always two
 * one-to-many relationships through a junction table, and that is what the canvas draws. Rather
 * than inventing an M:N edge that corresponds to nothing in the schema, the junction itself is
 * labelled — which says the same thing and stays true to what is actually there.
 *
 * The test is the one that does not produce false positives: every column of a composite primary
 * key is also a foreign key. A table with a surrogate `id` is a real entity with its own identity,
 * even when it happens to hold two foreign keys.
 */
export const junctionTables = (tables: TableInfo[], relationships: Relationship[]): Set<string> => {
    const fkColumns = new Map<string, Set<string>>();
    for (const rel of relationships) {
        let columns = fkColumns.get(rel.sourceTable);
        if (!columns) { columns = new Set(); fkColumns.set(rel.sourceTable, columns); }
        columns.add(rel.sourceColumn);
    }

    const junctions = new Set<string>();
    for (const table of tables) {
        const keys = table.columns.filter(c => c.isPk);
        if (keys.length < 2) continue;
        const foreign = fkColumns.get(table.name);
        if (foreign && keys.every(k => foreign.has(k.name))) junctions.add(table.name);
    }
    return junctions;
};

/**
 * How many rows can sit at each end of a relationship.
 *
 * Inferred, never stored — the database already knows, and a second copy of the answer would be
 * a second thing to keep in step. The parent end is always "one": a foreign key must reference a
 * unique column, so at most one row can be on that side. The child end is "one" only when the
 * foreign key column is itself unique, which is exactly what makes a 1:1 a 1:1; otherwise many
 * child rows can share a parent.
 *
 * Optionality is the column's nullability: a nullable foreign key means the child may have no
 * parent, which crow's-foot notation draws as a circle rather than a bar.
 */
export const cardinalityFor = (rel: Relationship, tables: TableInfo[]): EdgeCardinality => {
    const child = tables.find(t => t.name === rel.sourceTable);
    const column = child?.columns.find(c => c.name === rel.sourceColumn);
    return {
        childMany: !(column?.isUnique || column?.isPk),
        childOptional: !column?.notNull,
        onDelete: rel.onDelete,
        // Carried so the edge can describe itself in words. The edge knows its two node ids, but
        // not which columns joined them, and "customers has many orders" is the sentence that
        // makes the notation mean something to somebody who has not met it before.
        parentTable: rel.targetTable,
        parentColumn: rel.targetColumn,
        childTable: rel.sourceTable,
        childColumn: rel.sourceColumn,
    };
};

export const transformRelationshipsToEdges = (relationships: Relationship[], tables: TableInfo[]): Edge[] =>
    relationships.map(rel => ({
        id: edgeIdFor(rel),
        // `data` was unread by OrthogonalEdge until now, so carrying the notation here costs
        // nothing and keeps the edge component free of schema lookups.
        data: cardinalityFor(rel, tables),
        source: rel.targetTable,
        target: rel.sourceTable,
        sourceHandle: `${rel.targetColumn}-right`,
        targetHandle: `${rel.sourceColumn}-left`,
        // Right angles that route around the tables in the way, rather than a diagonal through
        // them - see `components/canvas/edgeRouting.ts`.
        type: 'orthogonal',
        // Not animated. A marching dash on one edge reads as flow; on eighty of them it reads as
        // noise, and this is a diagram people keep open for hours.
        animated: false,
        style: { stroke: EDGE_COLOUR, strokeWidth: 1.35 },
        markerEnd: { type: MarkerType.ArrowClosed, color: EDGE_COLOUR, width: 16, height: 16 },
    }));

/**
 * Which columns of each table are foreign keys, and which are pointed at.
 *
 * A table node needs this to place its connection handles, and an edge with no handle at one end
 * silently does not render. It used to be worked out from the `*_id` naming convention alone,
 * which is a good guess and no more: a schema whose foreign key is called `customer` rather than
 * `customer_id` drew no line at all, even though the backend had reported the relationship.
 */
export const keyColumnsByTable = (relationships: Relationship[]) => {
    const foreignKeys: Record<string, string[]> = {};
    const referenced: Record<string, string[]> = {};
    /** `table -> { column -> "target.column" }`, so a node can say where its keys lead. */
    const references: Record<string, Record<string, string>> = {};

    for (const rel of relationships) {
        (foreignKeys[rel.sourceTable] ??= []).push(rel.sourceColumn);
        (referenced[rel.targetTable] ??= []).push(rel.targetColumn);
        (references[rel.sourceTable] ??= {})[rel.sourceColumn] =
            `${rel.targetTable}.${rel.targetColumn}`;
    }
    return { foreignKeys, referenced, references };
};

/**
 * Where a table lands before anyone has arranged it.
 *
 * The step has to clear the widest a node can be, with room to spare: a relationship line needs
 * somewhere to go, and its cardinality marks sit 8-16px outside each table. At the old 250px step
 * — set when nodes were at most 230px wide — adjacent tables very nearly touched and every edge
 * between two of them was a cramped stub with the notation piled on top of it.
 */
export const GRID_STEP_X = 360;
export const GRID_STEP_Y = 340;

/**
 * How many tables to put in a row: √n, so the block stays roughly square.
 *
 * It used to be three, always, which is fine for a handful and wrong for anything more. Eighteen
 * tables became a three-wide, six-deep strip, and "fit to view" then had to shrink it to 42% to
 * get the *height* on screen — 400px of dead canvas down either side and not one table readable.
 *
 * Square rather than screen-shaped, which is the thing worth writing down: a wide grid looks like
 * the better match for a wide pane, and measures worse. Tables are much shorter than the vertical
 * step (that step has to clear a twenty-column table, and most have five), so a row of them is far
 * wider than it is tall and width becomes the binding constraint long before height does. Measured
 * across the bundled example and an eighteen-table file, √n beat √(1.2n) and √(1.7n) on resulting
 * zoom — 0.64 against 0.52 for the larger one.
 */
export const gridColumns = (total: number): number =>
    Math.max(1, Math.min(total, Math.ceil(Math.sqrt(total))));

export const defaultPosition = (index: number, total: number) => {
    const columns = gridColumns(total);
    return {
        x: GRID_STEP_X * (index % columns),
        y: 120 + Math.floor(index / columns) * GRID_STEP_Y,
    };
};
