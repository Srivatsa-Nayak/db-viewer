import { describe, expect, it } from 'vitest';
import { describeChange, diffSchemas, migrationScript, type SchemaSide } from '@/services/schemaDiff';
import type { ColumnInfo } from '@/types';

const col = (name: string, type = 'INTEGER', extra: Partial<ColumnInfo> = {}): ColumnInfo =>
    ({ name, type, isPk: false, notNull: false, isUnique: false, ...extra } as ColumnInfo);

const before: SchemaSide = {
    tables: [
        { name: 'customers', columns: [col('id', 'INTEGER', { isPk: true }), col('name', 'VARCHAR(64)'), col('fax', 'TEXT')] },
        { name: 'orders', columns: [col('id', 'INTEGER', { isPk: true }), col('customer_id')] },
        { name: 'legacy', columns: [col('id')] },
    ],
    relationships: [{ sourceTable: 'orders', sourceColumn: 'customer_id', targetTable: 'customers', targetColumn: 'id' }],
};

const after: SchemaSide = {
    tables: [
        { name: 'Customers', columns: [col('id', 'INTEGER', { isPk: true }), col('name', 'VARCHAR(128)', { notNull: true }), col('email', 'TEXT')] },
        { name: 'orders', columns: [col('id', 'INTEGER', { isPk: true }), col('customer_id'), col('product_id')] },
        { name: 'products', columns: [col('id', 'INTEGER', { isPk: true }), col('title', 'TEXT')] },
    ],
    relationships: [
        { sourceTable: 'orders', sourceColumn: 'customer_id', targetTable: 'customers', targetColumn: 'id' },
        { sourceTable: 'orders', sourceColumn: 'product_id', targetTable: 'products', targetColumn: 'id' },
    ],
};

describe('diffSchemas', () => {
    it('finds every kind of change, matching names case-insensitively', () => {
        const lines = diffSchemas(before, after).map(describeChange);
        expect(lines).toEqual(expect.arrayContaining([
            'New table products (2 columns)',
            'Table legacy removed',
            'Customers.email added (TEXT)',
            'Customers.fax removed',
            'Customers.name: type VARCHAR(64) → VARCHAR(128), now NOT NULL',
            'orders.product_id added (INTEGER)',
            'orders.product_id now references products.id',
        ]));
        // `customers` vs `Customers` is the same table, not a drop and an add.
        expect(lines.some(l => l.includes('customers removed'))).toBe(false);
    });

    it('reports nothing for identical schemas', () => {
        expect(diffSchemas(before, before)).toEqual([]);
        expect(migrationScript([], before, 'Same')).toContain('No differences');
    });

    it('does not count a new table\'s own keys, or a dropped table\'s, as separate changes', () => {
        const withKeyedTable: SchemaSide = {
            tables: [...before.tables, { name: 'notes', columns: [col('id', 'INTEGER', { isPk: true }), col('order_id')] }],
            relationships: [...before.relationships, { sourceTable: 'notes', sourceColumn: 'order_id', targetTable: 'orders', targetColumn: 'id' }],
        };
        const kinds = diffSchemas(before, withKeyedTable).map(c => c.kind);
        expect(kinds).toEqual(['add-table']);
        expect(diffSchemas(withKeyedTable, before).map(c => c.kind)).toEqual(['drop-table']);
    });
});

describe('migrationScript', () => {
    const script = migrationScript(diffSchemas(before, after), after, 'v1 → now');

    it('creates new tables with their keys, then alters, then drops', () => {
        const create = script.indexOf('CREATE TABLE "products"');
        const add = script.indexOf('ALTER TABLE "orders" ADD COLUMN "product_id" INTEGER;');
        const drop = script.indexOf('DROP TABLE "legacy";');
        expect(create).toBeGreaterThan(-1);
        expect(add).toBeGreaterThan(create);
        expect(drop).toBeGreaterThan(add);
        expect(script).toContain('"id" INTEGER PRIMARY KEY');
    });

    it('warns before anything that loses data, and describes what needs an engine\'s own syntax', () => {
        expect(script).toContain('-- This discards every value in Customers.fax.');
        expect(script).toContain('-- This discards legacy and every row in it.');
        expect(script).toContain('-- Customers.name: type VARCHAR(64) → VARCHAR(128), now NOT NULL.');
        expect(script).toContain('ALTER TABLE "orders" ADD FOREIGN KEY ("product_id") REFERENCES "products" ("id");');
    });

    it('does not add a NOT NULL column without a default, which would fail on a table with rows', () => {
        const s = migrationScript([{ kind: 'add-column', table: 't', column: col('x', 'INTEGER', { notNull: true }) }],
            { tables: [], relationships: [] }, 'x');
        expect(s).toContain('ALTER TABLE "t" ADD COLUMN "x" INTEGER;');
        expect(s).toContain('existing rows need one');
    });
});
