/**
 * Builds the canvas's table nodes from a schema, and reads a file's stored annotations back.
 *
 * The editor builds nodes in two places — when a file is opened and when its schema is
 * re-read after an edit — and they used to be two copies of the same forty lines, which is how
 * a field added to one and not the other goes missing on refresh. Pure: the handlers a node
 * carries are passed in, so this can be tested without React.
 */
import type { Node } from 'reactflow';
import type { CanvasGroup, Relationship, TableInfo, TagColour } from '@/types';
import type { NodeDecoration } from '@/types/workspace';
import { defaultPosition, junctionTables, keyColumnsByTable } from './schemaGraph';

/** The callbacks every table node carries in its `data`. All must be stable references. */
export interface TableNodeHandlers {
    onRefresh: () => Promise<void> | void;
    onEdit: (tableName: string) => void;
    onDelete: (tableName: string) => void;
    onDownloadCsv: (tableName: string) => Promise<void> | void;
    onNotesChanged: () => Promise<void> | void;
    onColourChange: (tableName: string, colour: TagColour | undefined) => Promise<void> | void;
}

export interface BuildNodesOptions {
    /** Where a table already sits; tables without one go on the default grid. */
    positionOf?: (tableName: string) => { x: number; y: number } | undefined;
    /** Carried over from the previous node, so a refresh does not blank the badge. */
    openNotesOf?: (tableName: string) => number;
}

export const buildTableNodes = (
    tables: TableInfo[],
    relationships: Relationship[],
    handlers: TableNodeHandlers,
    { positionOf, openNotesOf }: BuildNodesOptions = {},
): Node[] => {
    const keys = keyColumnsByTable(relationships);
    const junctions = junctionTables(tables, relationships);
    return tables.map((tbl, index) => ({
        id: tbl.name,
        type: 'tableNode',
        position: positionOf?.(tbl.name) ?? defaultPosition(index, tables.length),
        data: {
            label: tbl.name,
            columns: tbl.columns,
            foreignKeyColumns: keys.foreignKeys[tbl.name] ?? [],
            referencedColumns: keys.referenced[tbl.name] ?? [],
            references: keys.references[tbl.name],
            isJunction: junctions.has(tbl.name),
            isView: tbl.isView,
            openNotes: openNotesOf?.(tbl.name) ?? 0,
            ...handlers,
        },
    }));
};

/** One stored annotation, as `GET /canvas-meta` returns it. */
export interface CanvasMetaEntry {
    kind: string;
    ref: string;
    payload: Record<string, unknown>;
}

/**
 * Turns stored annotations into table decorations and domain groups.
 *
 * Every field is checked rather than trusted: the payload is free-form JSON written by
 * whichever version of the app saved it, and a malformed one should cost one colour, not the
 * whole file.
 */
export const canvasMetaToState = (meta: CanvasMetaEntry[]): {
    decorations: Record<string, NodeDecoration>;
    groups: CanvasGroup[];
} => ({
    decorations: Object.fromEntries(meta
        .filter(m => m.kind === 'table')
        .map(m => [m.ref, {
            colour: m.payload.colour as TagColour | undefined,
            tag: typeof m.payload.tag === 'string' ? m.payload.tag : undefined,
        }])),
    groups: meta
        .filter(m => m.kind === 'group')
        .map(m => ({
            id: m.ref,
            name: typeof m.payload.name === 'string' ? m.payload.name : 'Group',
            colour: m.payload.colour as TagColour | undefined,
            tables: Array.isArray(m.payload.tables) ? m.payload.tables as string[] : [],
        })),
});
