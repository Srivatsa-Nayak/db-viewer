/**
 * Reads DBML (dbdiagram.io's format) and writes the equivalent SQL.
 *
 * DBML is already an export format here, and dbdiagram is where a lot of schemas start — so a
 * DBML file is translated to a SQL script in the browser and then goes through exactly the same
 * import as a `.sql` file: the pre-flight preview, the backend's translator, the same report.
 * Nothing on the backend has to know DBML exists.
 *
 * Covered: `Table` (with `as` aliases and schema-qualified names), column types including quoted
 * ones (`"double precision"`), the column settings `pk`/`primary key`, `not null`, `null`,
 * `unique`, `increment`, `default:` and inline `ref:`, composite primary keys in an `indexes`
 * block, top-level `Ref:` lines and `Ref { }` blocks in all three directions, and `Enum` (stored
 * as text). Skipped, with a note: many-to-many refs (`<>`, which need a junction table nobody
 * has designed yet) and composite refs. Ignored without a note, because they describe nothing a
 * database holds: `Project`, `TableGroup`, `Note`s and other indexes.
 */

export interface DbmlImport {
    sql: string;
    tableCount: number;
    /** What was read but could not be carried across. */
    warnings: string[];
}

interface Column {
    name: string;
    type: string;
    pk: boolean;
    notNull: boolean;
    unique: boolean;
    increment: boolean;
    defaultValue?: string;
}

interface Table {
    name: string;
    columns: Column[];
    compositeKey?: string[];
}

interface Ref {
    childTable: string;
    childColumn: string;
    parentTable: string;
    parentColumn: string;
}

/** Comments out, string contents kept: a `//` inside a quoted note is not a comment. */
const stripComments = (text: string): string => {
    let out = '';
    let quote: string | null = null;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (quote) {
            out += c;
            if (c === '\\' && i + 1 < text.length) { out += text[++i]; continue; }
            if (text.startsWith(quote, i)) {
                out += quote.slice(1);
                i += quote.length - 1;
                quote = null;
            }
            continue;
        }
        if (text.startsWith("'''", i)) { quote = "'''"; out += "'''"; i += 2; continue; }
        if (c === "'" || c === '"' || c === '`') { quote = c; out += c; continue; }
        if (text.startsWith('//', i)) {
            while (i < text.length && text[i] !== '\n') i++;
            out += '\n';
            continue;
        }
        if (text.startsWith('/*', i)) {
            const end = text.indexOf('*/', i + 2);
            i = end < 0 ? text.length : end + 1;
            continue;
        }
        out += c;
    }
    return out;
};

/** The text between the brace at `open` and its partner, honouring quotes. */
const blockBody = (text: string, open: number): { body: string; end: number } | null => {
    let depth = 0;
    let quote: string | null = null;
    for (let i = open; i < text.length; i++) {
        const c = text[i];
        if (quote) {
            if (c === '\\') { i++; continue; }
            if (c === quote) quote = null;
            continue;
        }
        if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
        if (c === '{') depth++;
        else if (c === '}' && --depth === 0) return { body: text.slice(open + 1, i), end: i };
    }
    return null;
};

/** `"order items"`, `public.orders` or `orders` → the table's own name. */
const unquote = (name: string): string => {
    const n = name.trim();
    return (n.startsWith('"') && n.endsWith('"')) || (n.startsWith('`') && n.endsWith('`'))
        ? n.slice(1, -1).replace(/\\"/g, '"')
        : n;
};
const tableNameOf = (raw: string): string => {
    const parts = raw.trim().match(/"[^"]*"|[^.\s]+/g) ?? [raw];
    return unquote(parts[parts.length - 1]);
};

/** Splits `a, b [x, y], c` on top-level commas. */
const splitTopLevel = (text: string): string[] => {
    const parts: string[] = [];
    let depth = 0;
    let quote: string | null = null;
    let start = 0;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (quote) { if (c === quote) quote = null; continue; }
        if (c === "'" || c === '"' || c === '`') quote = c;
        else if (c === '(' || c === '[') depth++;
        else if (c === ')' || c === ']') depth--;
        else if (c === ',' && depth === 0) { parts.push(text.slice(start, i)); start = i + 1; }
    }
    parts.push(text.slice(start));
    return parts.map(p => p.trim()).filter(Boolean);
};

/** `table.column`, either side of a ref, possibly quoted. */
const endpoint = (raw: string): { table: string; column: string } | 'composite' | null => {
    const r = raw.trim();
    if (r.includes('(')) return 'composite';
    const parts = r.match(/"[^"]*"|[^.\s]+/g);
    if (!parts || parts.length < 2) return null;
    return { table: unquote(parts[parts.length - 2]), column: unquote(parts[parts.length - 1]) };
};

const REF_PATTERN = /^\s*(.+?)\s*(<>|<|>|-)\s*(.+?)\s*(?:\[.*\])?\s*$/;

const parseRef = (line: string, warnings: string[]): Ref | null => {
    const m = line.match(REF_PATTERN);
    if (!m) return null;
    const [, left, op, right] = m;
    if (op === '<>') {
        warnings.push(`Skipped the many-to-many ${left.trim()} <> ${right.trim()}: it needs a junction table.`);
        return null;
    }
    const a = endpoint(left);
    const b = endpoint(right);
    if (a === 'composite' || b === 'composite') {
        warnings.push(`Skipped the composite reference ${left.trim()} ${op} ${right.trim()}.`);
        return null;
    }
    if (!a || !b) return null;
    // `>` many-to-one and `-` one-to-one: the left side holds the key. `<` is the mirror.
    const [child, parent] = op === '<' ? [b, a] : [a, b];
    return { childTable: child.table, childColumn: child.column, parentTable: parent.table, parentColumn: parent.column };
};

const sqlLiteral = (raw: string): string => {
    const v = raw.trim();
    if (v.startsWith('`') && v.endsWith('`')) {
        const expr = v.slice(1, -1).trim();
        return /^now\(\)$/i.test(expr) ? 'CURRENT_TIMESTAMP' : `(${expr})`;
    }
    if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) {
        return `'${v.slice(1, -1).replace(/'/g, "''")}'`;
    }
    if (/^(true|false|null)$/i.test(v)) return v.toUpperCase();
    if (/^-?\d+(\.\d+)?$/.test(v)) return v;
    return `'${v.replace(/'/g, "''")}'`;
};

/** A DBML type in SQL: quotes dropped, enums as text. */
const sqlType = (raw: string, enums: Set<string>): string => {
    const t = unquote(raw.trim());
    if (enums.has(t) || enums.has(tableNameOf(t))) return 'VARCHAR(255)';
    return t.toUpperCase();
};

const quoteIdent = (name: string) => `"${name.replace(/"/g, '""')}"`;

export const dbmlToSql = (source: string): DbmlImport => {
    const text = stripComments(source);
    const warnings: string[] = [];
    const tables: Table[] = [];
    const refs: Ref[] = [];
    const enums = new Set<string>();
    const aliases = new Map<string, string>();

    const header = /\b(Table|Enum|Ref|Project|TableGroup|Note|TablePartial)\b([^{\n]*)\{/gi;
    const consumed: Array<[number, number]> = [];
    let match: RegExpExecArray | null;
    while ((match = header.exec(text)) !== null) {
        const keyword = match[1].toLowerCase();
        const open = match.index + match[0].length - 1;
        const block = blockBody(text, open);
        if (!block) break;
        consumed.push([match.index, block.end]);
        header.lastIndex = block.end + 1;

        if (keyword === 'enum') {
            enums.add(tableNameOf(match[2].trim()));
        } else if (keyword === 'ref') {
            for (const line of block.body.split('\n')) {
                const ref = parseRef(line, warnings);
                if (ref) refs.push(ref);
            }
        } else if (keyword === 'table') {
            const head = match[2].replace(/\[.*\]/, '').trim();
            const [rawName, , alias] = head.split(/\s+(as)\s+/i);
            const name = tableNameOf(rawName);
            if (alias) aliases.set(unquote(alias.trim()), name);
            tables.push(parseTableBody(name, block.body, enums, refs, warnings));
        }
        // Project, TableGroup, Note: nothing a database holds.
    }

    // Top-level one-line refs: everything outside the blocks.
    let outside = '';
    let last = 0;
    for (const [from, to] of consumed) { outside += text.slice(last, from) + '\n'; last = to + 1; }
    outside += text.slice(last);
    for (const line of outside.split('\n')) {
        const m = line.match(/^\s*Ref\b[^:]*:\s*(.+)$/i);
        if (m) {
            const ref = parseRef(m[1], warnings);
            if (ref) refs.push(ref);
        }
    }

    // Enum types used before the Enum block was read.
    for (const table of tables) {
        for (const column of table.columns) {
            if (enums.has(column.type) || enums.has(tableNameOf(column.type))) column.type = 'VARCHAR(255)';
        }
    }

    const resolve = (name: string) => aliases.get(name) ?? name;
    const byName = new Map(tables.map(t => [t.name, t]));
    const statements: string[] = [];
    for (const table of tables) {
        const definitions: string[] = [];
        const singleKey = !table.compositeKey && table.columns.filter(c => c.pk).length === 1;
        for (const c of table.columns) {
            let def = `${quoteIdent(c.name)} `;
            if (singleKey && c.pk && c.increment) {
                def += 'INTEGER PRIMARY KEY AUTOINCREMENT';
            } else {
                def += c.type || 'TEXT';
                if (singleKey && c.pk) def += ' PRIMARY KEY';
                if (c.notNull && !c.pk) def += ' NOT NULL';
                if (c.unique && !c.pk) def += ' UNIQUE';
                if (c.defaultValue !== undefined) def += ` DEFAULT ${c.defaultValue}`;
            }
            definitions.push(def);
        }
        const multiKey = table.compositeKey
            ?? (table.columns.filter(c => c.pk).length > 1 ? table.columns.filter(c => c.pk).map(c => c.name) : undefined);
        if (multiKey) definitions.push(`PRIMARY KEY (${multiKey.map(quoteIdent).join(', ')})`);

        for (const ref of refs) {
            if (resolve(ref.childTable) !== table.name) continue;
            const parent = resolve(ref.parentTable);
            if (!byName.has(parent)) {
                warnings.push(`Skipped ${table.name}.${ref.childColumn} → ${parent}: there is no table called ${parent}.`);
                continue;
            }
            definitions.push(`FOREIGN KEY (${quoteIdent(ref.childColumn)}) REFERENCES `
                + `${quoteIdent(parent)} (${quoteIdent(ref.parentColumn)})`);
        }
        statements.push(`CREATE TABLE ${quoteIdent(table.name)} (\n    ${definitions.join(',\n    ')}\n);`);
    }

    return {
        sql: statements.length > 0
            ? `-- Converted from DBML by SQL Visualizer.\n\n${statements.join('\n\n')}\n`
            : '',
        tableCount: statements.length,
        warnings,
    };
};

const parseTableBody = (
    name: string, body: string, enums: Set<string>, refs: Ref[], warnings: string[],
): Table => {
    const table: Table = { name, columns: [] };

    // Nested blocks first: `indexes { }` can declare a composite key, `Note { }` is ignored.
    let rest = body;
    const nested = /\b(indexes|Note)\s*\{/gi;
    let m: RegExpExecArray | null;
    while ((m = nested.exec(rest)) !== null) {
        const block = blockBody(rest, m.index + m[0].length - 1);
        if (!block) break;
        if (m[1].toLowerCase() === 'indexes') {
            for (const line of block.body.split('\n')) {
                const key = line.match(/^\s*\(([^)]*)\)\s*\[([^\]]*)\]/);
                if (key && /\b(pk|primary key)\b/i.test(key[2])) {
                    table.compositeKey = key[1].split(',').map(s => unquote(s));
                }
            }
        }
        rest = rest.slice(0, m.index) + rest.slice(block.end + 1);
        nested.lastIndex = m.index;
    }

    for (const raw of rest.split('\n')) {
        const line = raw.trim();
        if (!line || /^Note\s*:/i.test(line)) continue;
        const col = line.match(/^("[^"]+"|`[^`]+`|[^\s\[]+)\s+("[^"]+"|[^\s\[]+(?:\s*\([^)]*\))?)\s*(?:\[(.*)\])?\s*$/);
        if (!col) continue;
        const column: Column = {
            name: unquote(col[1]),
            type: sqlType(col[2], enums),
            pk: false, notNull: false, unique: false, increment: false,
        };
        for (const setting of splitTopLevel(col[3] ?? '')) {
            const s = setting.trim();
            const lower = s.toLowerCase();
            if (lower === 'pk' || lower === 'primary key') column.pk = true;
            else if (lower === 'not null') column.notNull = true;
            else if (lower === 'unique') column.unique = true;
            else if (lower === 'increment') column.increment = true;
            else if (lower.startsWith('default:')) column.defaultValue = sqlLiteral(s.slice('default:'.length));
            else if (lower.startsWith('ref:')) {
                const ref = parseRef(`${name}.${column.name} ${s.slice('ref:'.length).trim()}`, warnings);
                if (ref) refs.push(ref);
            }
        }
        table.columns.push(column);
    }
    return table;
};
