import { describe, expect, it } from 'vitest';
import { dbmlToSql } from '@/services/dbmlImport';
import { toDbml } from '@/services/exportDiagram';
import type { ColumnInfo, Relationship, TableInfo } from '@/types';

const col = (name: string, type: string, extra: Partial<ColumnInfo> = {}): ColumnInfo =>
    ({ name, type, isPk: false, notNull: false, isUnique: false, ...extra } as ColumnInfo);

describe('dbmlToSql', () => {
    it('round-trips the app\'s own DBML export', () => {
        const tables: TableInfo[] = [
            { name: 'customers', columns: [col('id', 'INTEGER', { isPk: true }), col('name', 'VARCHAR(128)', { notNull: true })] } as TableInfo,
            { name: 'orders', columns: [col('id', 'INTEGER', { isPk: true }), col('customer_id', 'INTEGER')] } as TableInfo,
        ];
        const relationships: Relationship[] = [
            { sourceTable: 'orders', sourceColumn: 'customer_id', targetTable: 'customers', targetColumn: 'id' },
        ];

        const { sql, tableCount, warnings } = dbmlToSql(toDbml({ tables, relationships }));

        expect(tableCount).toBe(2);
        expect(warnings).toEqual([]);
        expect(sql).toContain('CREATE TABLE "customers"');
        expect(sql).toContain('"id" INTEGER PRIMARY KEY AUTOINCREMENT');
        expect(sql).toContain('"name" VARCHAR(128) NOT NULL');
        expect(sql).toContain('FOREIGN KEY ("customer_id") REFERENCES "customers" ("id")');
    });

    it('reads what dbdiagram.io writes: settings, defaults, enums, inline refs, every direction', () => {
        const { sql, tableCount, warnings } = dbmlToSql(`
            // A comment, and a /* block */ one
            Project shop { database_type: 'PostgreSQL' }

            Enum order_status { pending  shipped  "on hold" }

            Table users as U {
              id integer [pk, increment]
              email varchar(255) [unique, not null, note: 'login, never shown']
              created_at timestamp [default: \`now()\`]
              Note: 'Everyone who can sign in'
            }

            Table orders {
              id int [pk]
              user_id int [ref: > U.id]
              status order_status [default: 'pending']
              total "double precision" [default: 0]
            }

            Table products { id int [pk] }

            Table order_items {
              order_id int
              product_id int
              indexes {
                (order_id, product_id) [pk]
                product_id
              }
            }

            Ref: order_items.order_id > orders.id
            Ref { products.id < order_items.product_id }
            Ref: products.id <> users.id
        `);

        expect(tableCount).toBe(4);
        expect(sql).toContain('"email" VARCHAR(255) NOT NULL UNIQUE');
        expect(sql).toContain('"created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
        expect(sql).toContain('"status" VARCHAR(255) DEFAULT \'pending\'');
        expect(sql).toContain('"total" DOUBLE PRECISION DEFAULT 0');
        // The alias resolves to the real table.
        expect(sql).toContain('FOREIGN KEY ("user_id") REFERENCES "users" ("id")');
        expect(sql).toContain('PRIMARY KEY ("order_id", "product_id")');
        expect(sql).toContain('FOREIGN KEY ("order_id") REFERENCES "orders" ("id")');
        // `<` points the other way: order_items holds the key.
        expect(sql).toContain('FOREIGN KEY ("product_id") REFERENCES "products" ("id")');
        expect(warnings.some(w => w.includes('many-to-many'))).toBe(true);
    });

    it('says what it skipped rather than failing', () => {
        const { tableCount, warnings } = dbmlToSql(`
            Table a { id int [pk]  b_id int }
            Ref: a.b_id > missing.id
            Ref: a.(x, y) > a.(x, y)
        `);
        expect(tableCount).toBe(1);
        expect(warnings.some(w => w.includes('no table called missing'))).toBe(true);
        expect(warnings.some(w => w.includes('composite'))).toBe(true);
    });

    it('returns nothing for a file with no tables', () => {
        expect(dbmlToSql('Project x { }').tableCount).toBe(0);
    });
});
