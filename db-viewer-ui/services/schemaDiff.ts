/**
 * What changed between two versions of a schema, and a script that makes the old one the new one.
 *
 * "Old" and "new" are whatever the caller compares — a saved version against the file now, or
 * one open file against another. The change list is the point; the script is a starting draft
 * for a migration, written in portable SQL with a comment wherever an engine needs its own
 * syntax (a column type change is `ALTER COLUMN ... TYPE` on PostgreSQL, `MODIFY COLUMN` on
 * MySQL, and a table rebuild on SQLite — so it is described, not guessed). It is offered for the
 * SQL panel to edit and run, never run by itself.
 *
 * Tables and columns are matched by name, case-insensitively, as the engines do. A rename looks
 * like a drop and an add, because nothing in two schemas says it was one; the script carries a
 * warning where a drop would lose data, so nobody runs a rename-as-drop by accident.
 */
import type { ColumnInfo, Relationship, TableInfo } from '@/types';

export interface SchemaSide {
    tables: Pick<TableInfo, 'name' | 'columns'>[];
    relationships: Relationship[];
}

export type Change =
    | { kind: 'add-table'; table: string; columns: ColumnInfo[] }
    | { kind: 'drop-table'; table: string }
    | { kind: 'add-column'; table: string; column: ColumnInfo }
    | { kind: 'drop-column'; table: string; column: string }
    | { kind: 'change-column'; table: string; column: string; from: ColumnInfo; to: ColumnInfo; what: string[] }
    | { kind: 'add-key'; relationship: Relationship }
    | { kind: 'drop-key'; relationship: Relationship };

const key = (name: string) => name.toLowerCase();
const relKey = (r: Relationship) =>
    `${key(r.sourceTable)}.${key(r.sourceColumn)}->${key(r.targetTable)}.${key(r.targetColumn)}`;
const normalType = (type: string | undefined) => (type ?? '').replace(/\s+/g, ' ').trim().toUpperCase();

/** Which properties of a column differ, in words. Empty when the two are the same. */
const columnDifferences = (from: ColumnInfo, to: ColumnInfo): string[] => {
    const what: string[] = [];
    if (normalType(from.type) !== normalType(to.type)) what.push(`type ${from.type} → ${to.type}`);
    if (!!from.notNull !== !!to.notNull) what.push(to.notNull ? 'now NOT NULL' : 'now nullable');
    if (!!from.isPk !== !!to.isPk) what.push(to.isPk ? 'now part of the primary key' : 'no longer part of the primary key');
    if (!!from.isUnique !== !!to.isUnique && !from.isPk && !to.isPk) what.push(to.isUnique ? 'now UNIQUE' : 'no longer UNIQUE');
    if ((from.defaultValue ?? null) !== (to.defaultValue ?? null)) {
        what.push(`default ${from.defaultValue ?? 'none'} → ${to.defaultValue ?? 'none'}`);
    }
    return what;
};

export const diffSchemas = (before: SchemaSide, after: SchemaSide): Change[] => {
    const changes: Change[] = [];
    const oldTables = new Map(before.tables.map(t => [key(t.name), t]));
    const newTables = new Map(after.tables.map(t => [key(t.name), t]));

    for (const table of after.tables) {
        const old = oldTables.get(key(table.name));
        if (!old) {
            changes.push({ kind: 'add-table', table: table.name, columns: table.columns });
            continue;
        }
        const oldColumns = new Map(old.columns.map(c => [key(c.name), c]));
        const newColumns = new Map(table.columns.map(c => [key(c.name), c]));
        for (const column of table.columns) {
            const was = oldColumns.get(key(column.name));
            if (!was) {
                changes.push({ kind: 'add-column', table: table.name, column });
            } else {
                const what = columnDifferences(was, column);
                if (what.length > 0) {
                    changes.push({ kind: 'change-column', table: table.name, column: column.name, from: was, to: column, what });
                }
            }
        }
        for (const column of old.columns) {
            if (!newColumns.has(key(column.name))) {
                changes.push({ kind: 'drop-column', table: table.name, column: column.name });
            }
        }
    }
    for (const table of before.tables) {
        if (!newTables.has(key(table.name))) changes.push({ kind: 'drop-table', table: table.name });
    }

    const oldKeys = new Map(before.relationships.map(r => [relKey(r), r]));
    const newKeys = new Map(after.relationships.map(r => [relKey(r), r]));
    for (const [k, r] of newKeys) {
        // A key on a brand-new table is part of its CREATE TABLE, not a change of its own.
        if (!oldKeys.has(k) && oldTables.has(key(r.sourceTable))) changes.push({ kind: 'add-key', relationship: r });
    }
    for (const [k, r] of oldKeys) {
        // Likewise a key that went with a dropped table.
        if (!newKeys.has(k) && newTables.has(key(r.sourceTable))) changes.push({ kind: 'drop-key', relationship: r });
    }
    return changes;
};

/** One line for the change list. */
export const describeChange = (change: Change): string => {
    switch (change.kind) {
        case 'add-table': return `New table ${change.table} (${change.columns.length} column${change.columns.length === 1 ? '' : 's'})`;
        case 'drop-table': return `Table ${change.table} removed`;
        case 'add-column': return `${change.table}.${change.column.name} added (${change.column.type})`;
        case 'drop-column': return `${change.table}.${change.column} removed`;
        case 'change-column': return `${change.table}.${change.column}: ${change.what.join(', ')}`;
        case 'add-key': {
            const r = change.relationship;
            return `${r.sourceTable}.${r.sourceColumn} now references ${r.targetTable}.${r.targetColumn}`;
        }
        case 'drop-key': {
            const r = change.relationship;
            return `${r.sourceTable}.${r.sourceColumn} no longer references ${r.targetTable}.${r.targetColumn}`;
        }
    }
};

const q = (name: string) => `"${name.replace(/"/g, '""')}"`;

const columnDefinition = (c: ColumnInfo, singleKey: boolean): string => {
    let def = `${q(c.name)} ${c.type || 'TEXT'}`;
    if (singleKey && c.isPk) def += ' PRIMARY KEY';
    if (c.notNull && !c.isPk) def += ' NOT NULL';
    if (c.isUnique && !c.isPk) def += ' UNIQUE';
    if (c.defaultValue) def += ` DEFAULT ${c.defaultValue}`;
    return def;
};

/**
 * A migration draft: run on the old schema, it produces the new one. Tables are created before
 * the keys that point at them and dropped after the keys that pointed at them are gone.
 */
export const migrationScript = (changes: Change[], after: SchemaSide, title: string): string => {
    if (changes.length === 0) return `-- ${title}\n-- No differences: nothing to migrate.\n`;
    const lines: string[] = [
        `-- ${title}`,
        '-- A draft, in portable SQL. Review it before running: a column that was renamed shows up',
        '-- as a drop and an add, and a drop discards that column\'s data.',
        '',
    ];

    const relationshipsOf = (table: string) =>
        after.relationships.filter(r => key(r.sourceTable) === key(table));

    for (const change of changes.filter(c => c.kind === 'add-table')) {
        if (change.kind !== 'add-table') continue;
        const keys = change.columns.filter(c => c.isPk);
        const singleKey = keys.length === 1;
        const defs = change.columns.map(c => columnDefinition(c, singleKey));
        if (keys.length > 1) defs.push(`PRIMARY KEY (${keys.map(c => q(c.name)).join(', ')})`);
        for (const r of relationshipsOf(change.table)) {
            defs.push(`FOREIGN KEY (${q(r.sourceColumn)}) REFERENCES ${q(r.targetTable)} (${q(r.targetColumn)})`);
        }
        lines.push(`CREATE TABLE ${q(change.table)} (\n    ${defs.join(',\n    ')}\n);`, '');
    }

    for (const change of changes) {
        switch (change.kind) {
            case 'add-column': {
                const c = change.column;
                let def = columnDefinition(c, false);
                // Adding a NOT NULL column to a table with rows needs a default on every engine.
                if (c.notNull && !c.defaultValue) {
                    lines.push(`-- ${change.table}.${c.name} is NOT NULL with no default: existing rows need one.`);
                    def = def.replace(' NOT NULL', '');
                }
                lines.push(`ALTER TABLE ${q(change.table)} ADD COLUMN ${def};`, '');
                break;
            }
            case 'change-column':
                lines.push(
                    `-- ${change.table}.${change.column}: ${change.what.join(', ')}.`,
                    '--   PostgreSQL: ALTER TABLE ... ALTER COLUMN ... TYPE / SET NOT NULL',
                    '--   MySQL:      ALTER TABLE ... MODIFY COLUMN ...',
                    '--   SQLite:     rebuild the table (or change it from the canvas, which does that for you)',
                    '');
                break;
            case 'add-key': {
                const r = change.relationship;
                lines.push(`-- SQLite cannot add a foreign key to an existing table; draw it on the canvas instead.`,
                    `ALTER TABLE ${q(r.sourceTable)} ADD FOREIGN KEY (${q(r.sourceColumn)}) `
                    + `REFERENCES ${q(r.targetTable)} (${q(r.targetColumn)});`, '');
                break;
            }
            case 'drop-key': {
                const r = change.relationship;
                lines.push(`-- Drop the key ${r.sourceTable}.${r.sourceColumn} → ${r.targetTable}.${r.targetColumn}.`,
                    '--   Its constraint name differs per engine; on SQLite remove it from the canvas.', '');
                break;
            }
            case 'drop-column':
                lines.push(`-- This discards every value in ${change.table}.${change.column}.`,
                    `ALTER TABLE ${q(change.table)} DROP COLUMN ${q(change.column)};`, '');
                break;
            default:
                break;
        }
    }

    for (const change of changes) {
        if (change.kind === 'drop-table') {
            lines.push(`-- This discards ${change.table} and every row in it.`,
                `DROP TABLE ${q(change.table)};`, '');
        }
    }
    return lines.join('\n');
};
