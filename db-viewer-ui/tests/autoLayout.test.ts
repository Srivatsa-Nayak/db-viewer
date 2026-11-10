import { describe, expect, it } from 'vitest';
import { autoLayout, crossings } from '@/services/autoLayout';
import type { Relationship } from '@/types';

const fk = (child: string, parent: string): Relationship =>
    ({ sourceTable: child, sourceColumn: `${parent}_id`, targetTable: parent, targetColumn: 'id' });

const size = () => ({ width: 260, height: 120 });

describe('autoLayout', () => {
    it('puts a referenced table to the left of every table that references it', () => {
        const rels = [fk('orders', 'customers'), fk('order_items', 'orders'), fk('order_items', 'products')];
        const at = autoLayout(['order_items', 'orders', 'customers', 'products'], rels, size);

        expect(at.customers.x).toBeLessThan(at.orders.x);
        expect(at.orders.x).toBeLessThan(at.order_items.x);
        expect(at.products.x).toBeLessThan(at.order_items.x);
    });

    it('lays out every table, and never two in the same place', () => {
        const tables = ['a', 'b', 'c', 'd', 'loner'];
        const at = autoLayout(tables, [fk('b', 'a'), fk('c', 'a'), fk('d', 'b')], size);

        expect(Object.keys(at).sort()).toEqual([...tables].sort());
        const spots = new Set(Object.values(at).map(p => `${p.x},${p.y}`));
        expect(spots.size).toBe(tables.length);
    });

    it('survives a cycle and a self-reference', () => {
        const rels = [fk('a', 'b'), fk('b', 'a'), fk('employees', 'employees')];
        const at = autoLayout(['a', 'b', 'employees'], rels, size);
        expect(Object.keys(at)).toHaveLength(3);
        expect(at.a.x).not.toBe(at.b.x);
    });

    it('keeps tables without relationships out of the first column', () => {
        const at = autoLayout(['orders', 'customers', 'settings'], [fk('orders', 'customers')], size);
        expect(at.settings.y).toBeGreaterThan(Math.max(at.orders.y, at.customers.y));
    });

    it('orders a layer so that lines do not cross when they need not', () => {
        // Two independent chains, listed interleaved: a1 -> a2, b1 -> b2. Listed as given, the
        // second column would put b2 opposite a1 and the two lines would cross.
        const rels = [fk('a2', 'a1'), fk('b2', 'b1')];
        const at = autoLayout(['a1', 'b1', 'b2', 'a2'], rels, size);
        expect(crossings(at, rels)).toBe(0);
    });

    it('stacks a column by the real height of its tables', () => {
        const heights: Record<string, number> = { parent: 100, tall: 400, short: 80 };
        const at = autoLayout(['parent', 'tall', 'short'], [fk('tall', 'parent'), fk('short', 'parent')],
            t => ({ width: 260, height: heights[t] }));
        const [first, second] = [at.tall, at.short].sort((p, q) => p.y - q.y);
        const firstHeight = first === at.tall ? 400 : 80;
        expect(second.y - first.y).toBeGreaterThanOrEqual(firstHeight);
    });
});
