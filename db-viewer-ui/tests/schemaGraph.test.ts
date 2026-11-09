import { describe, expect, it } from 'vitest';
import {
    cardinalityFor, defaultPosition, edgeIdFor, gridColumns, junctionTables, keyColumnsByTable,
    transformRelationshipsToEdges,
} from '@/services/schemaGraph';
import { normaliseSchema } from '@/services/api';
import { errorMessage, errorText } from '@/services/errors';
import { toDbml, toMermaid } from '@/services/exportDiagram';
import type { ColumnInfo, Relationship, TableInfo } from '@/types';

const col = (name: string, extra: Partial<ColumnInfo> = {}): ColumnInfo =>
    ({ name, type: 'INTEGER', isPk: false, notNull: false, isUnique: false, ...extra } as ColumnInfo);

const customers: TableInfo = { name: 'customers', columns: [col('id', { isPk: true })] } as TableInfo;
const orders: TableInfo = {
    name: 'orders',
    columns: [col('id', { isPk: true }), col('customer_id', { notNull: true })],
} as TableInfo;
const passports: TableInfo = {
    name: 'passports',
    columns: [col('id', { isPk: true }), col('customer_id', { isUnique: true })],
} as TableInfo;
const tagging: TableInfo = {
    name: 'post_tags',
    columns: [col('post_id', { isPk: true }), col('tag_id', { isPk: true })],
} as TableInfo;

const rel = (sourceTable: string, sourceColumn: string, targetTable: string, targetColumn = 'id'): Relationship =>
    ({ sourceTable, sourceColumn, targetTable, targetColumn } as Relationship);

describe('schemaGraph', () => {
    it('gives an edge an id from what it joins, not where it sits in the list', () => {
        expect(edgeIdFor(rel('orders', 'customer_id', 'customers'))).toBe('customers.id->orders.customer_id');
    });

    it('infers one-to-many, one-to-one and optionality from the child column', () => {
        const tables = [customers, orders, passports];
        expect(cardinalityFor(rel('orders', 'customer_id', 'customers'), tables))
            .toMatchObject({ childMany: true, childOptional: false });
        expect(cardinalityFor(rel('passports', 'customer_id', 'customers'), tables))
            .toMatchObject({ childMany: false, childOptional: true });
    });

    it('builds edges that leave the parent on the right and enter the child on the left', () => {
        const [edge] = transformRelationshipsToEdges([rel('orders', 'customer_id', 'customers')], [customers, orders]);
        expect(edge).toMatchObject({
            source: 'customers', target: 'orders',
            sourceHandle: 'id-right', targetHandle: 'customer_id-left', type: 'orthogonal',
        });
    });

    it('finds a junction table only when its whole composite key is foreign keys', () => {
        const rels = [rel('post_tags', 'post_id', 'posts'), rel('post_tags', 'tag_id', 'tags'),
            rel('orders', 'customer_id', 'customers')];
        expect([...junctionTables([tagging, orders], rels)]).toEqual(['post_tags']);
    });

    it('records which columns each table needs handles for', () => {
        const keys = keyColumnsByTable([rel('orders', 'customer_id', 'customers')]);
        expect(keys.foreignKeys).toEqual({ orders: ['customer_id'] });
        expect(keys.referenced).toEqual({ customers: ['id'] });
        expect(keys.references.orders.customer_id).toBe('customers.id');
    });

    it('lays tables out in a roughly square grid', () => {
        expect(gridColumns(1)).toBe(1);
        expect(gridColumns(18)).toBe(5);
        expect(defaultPosition(0, 4)).toEqual({ x: 0, y: 120 });
        expect(defaultPosition(3, 4).x).toBeGreaterThan(0);
    });
});

describe('normaliseSchema', () => {
    it('folds both spellings the backend has shipped into one shape', () => {
        const schema = normaliseSchema({
            tables: [{ name: 't', columns: [{ name: 'id', type: 'INT', is_pk: true, not_null: true }] }],
            relationships: [{ source_table: 'a', source_column: 'b', target_table: 'c', target_column: 'd' }],
        } as never);
        expect(schema.tables[0].columns[0]).toMatchObject({ isPk: true, notNull: true });
        expect(schema.relationships[0]).toMatchObject({ sourceTable: 'a', targetColumn: 'd' });
    });
});

describe('errors', () => {
    it('reads the backend message and falls back when there is none', () => {
        const fromBackend = { response: { data: { error: 'No such table' } } };
        expect(errorMessage(fromBackend)).toBe('No such table');
        expect(errorMessage(new Error('x'))).toBeUndefined();
        expect(errorText(null, 'Fallback')).toBe('Fallback');
    });
});

describe('diagram exports', () => {
    const source = { tables: [customers, orders], relationships: [rel('orders', 'customer_id', 'customers')] };

    it('writes Mermaid that names both tables and the relationship', () => {
        const mermaid = toMermaid(source);
        expect(mermaid).toMatch(/^erDiagram/);
        expect(mermaid).toContain('customers');
        expect(mermaid).toContain('orders');
    });

    it('writes DBML with the foreign key as a Ref', () => {
        const dbml = toDbml(source);
        expect(dbml).toContain('Table customers');
        expect(dbml).toMatch(/Ref: *"?orders"?\."?customer_id"? *> *"?customers"?\."?id"?/);
    });
});
