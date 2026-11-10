import { describe, expect, it, vi } from 'vitest';
import { buildTableNodes, canvasMetaToState, type TableNodeHandlers } from '@/services/workspaceNodes';
import type { ColumnInfo, Relationship, TableInfo } from '@/types';

const col = (name: string, extra: Partial<ColumnInfo> = {}): ColumnInfo =>
    ({ name, type: 'INTEGER', isPk: false, notNull: false, isUnique: false, ...extra } as ColumnInfo);

const tables: TableInfo[] = [
    { name: 'customers', columns: [col('id', { isPk: true })] } as TableInfo,
    { name: 'orders', columns: [col('id', { isPk: true }), col('customer_id')] } as TableInfo,
];
const relationships: Relationship[] = [
    { sourceTable: 'orders', sourceColumn: 'customer_id', targetTable: 'customers', targetColumn: 'id' },
];

const handlers = (): TableNodeHandlers => ({
    onRefresh: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn(),
    onDownloadCsv: vi.fn(), onNotesChanged: vi.fn(), onColourChange: vi.fn(),
});

describe('buildTableNodes', () => {
    it('makes one table node per table, with its key columns and every handler', () => {
        const h = handlers();
        const nodes = buildTableNodes(tables, relationships, h);

        expect(nodes.map(n => n.id)).toEqual(['customers', 'orders']);
        expect(nodes.every(n => n.type === 'tableNode')).toBe(true);
        const orders = nodes.find(n => n.id === 'orders')!;
        expect(orders.data.foreignKeyColumns).toEqual(['customer_id']);
        expect(nodes.find(n => n.id === 'customers')!.data.referencedColumns).toEqual(['id']);
        expect(orders.data.onDelete).toBe(h.onDelete);
        expect(orders.data.onColourChange).toBe(h.onColourChange);
        expect(orders.data.openNotes).toBe(0);
    });

    it('keeps a known position and badge, and grids everything else', () => {
        const nodes = buildTableNodes(tables, relationships, handlers(), {
            positionOf: name => (name === 'orders' ? { x: 900, y: 40 } : undefined),
            openNotesOf: name => (name === 'orders' ? 3 : 0),
        });
        const orders = nodes.find(n => n.id === 'orders')!;
        expect(orders.position).toEqual({ x: 900, y: 40 });
        expect(orders.data.openNotes).toBe(3);
        expect(nodes.find(n => n.id === 'customers')!.position).toBeDefined();
    });
});

describe('canvasMetaToState', () => {
    it('splits annotations into table decorations and groups', () => {
        const state = canvasMetaToState([
            { kind: 'table', ref: 'orders', payload: { colour: 'rose', tag: 'billing' } },
            { kind: 'group', ref: 'g1', payload: { name: 'Sales', colour: 'sky', tables: ['orders', 'customers'] } },
        ]);
        expect(state.decorations).toEqual({ orders: { colour: 'rose', tag: 'billing' } });
        expect(state.groups).toEqual([{ id: 'g1', name: 'Sales', colour: 'sky', tables: ['orders', 'customers'] }]);
    });

    it('tolerates a malformed payload rather than dropping the file', () => {
        const state = canvasMetaToState([
            { kind: 'table', ref: 'orders', payload: { tag: 42 } },
            { kind: 'group', ref: 'g2', payload: { tables: 'not-a-list' } },
        ]);
        expect(state.decorations.orders.tag).toBeUndefined();
        expect(state.groups[0]).toEqual({ id: 'g2', name: 'Group', colour: undefined, tables: [] });
    });
});
