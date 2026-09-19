import { ColumnInfo, Relationship, TableInfo } from '@/types';

/**
 * Text renderings of the schema, for the places a PNG cannot go.
 *
 * A picture of a diagram is the wrong artefact for a repository: it cannot be diffed, it goes
 * stale silently, and nobody can search it. Both formats here are plain text that renders as a
 * diagram where it lands — Mermaid in a GitHub README, a Jira ticket or a Notion page, DBML in
 * dbdiagram.io and dbdocs — so the diagram travels with the code that owns it.
 *
 * Everything is derived from the same `tables` + `relationships` the canvas draws, so the export
 * cannot describe a schema different from the one on screen.
 */

/** A table plus its column metadata, which is exactly what the canvas already holds. */
export interface DiagramSource {
    tables: Pick<TableInfo, 'name' | 'columns'>[];
    relationships: Relationship[];
}

/* ── Mermaid ──────────────────────────────────────────────────────────────── */

/**
 * Mermaid's parser accepts a length in parentheses but not a comma inside one, so a
 * `DECIMAL(10,2)` would break the whole diagram rather than that one row.
 *
 * The precision is dropped in that case rather than mangled: this is documentation, and DBML
 * (below) carries the exact type for anyone who needs it.
 */
const mermaidType = (type: string): string => {
    const cleaned = (type || 'TEXT').trim();
    return cleaned.includes(',') ? cleaned.replace(/\s*\([^)]*\)/, '') : cleaned.replace(/\s+/g, '_');
};

/**
 * Mermaid identifiers are bare words that must start with a letter.
 *
 * A table called `2024_orders` is perfectly legal SQL and a parse error in Mermaid — and one bad
 * identifier does not degrade the diagram, it fails the whole block.
 */
const mermaidName = (name: string): string => {
    const cleaned = name.replace(/[^A-Za-z0-9_]/g, '_');
    return /^[A-Za-z]/.test(cleaned) ? cleaned : `t_${cleaned}`;
};

/** PK wins over FK when a column is both — the key it *is* matters more than what it points at. */
const keyMarker = (column: ColumnInfo, foreignKeys: Set<string>): string => {
    if (column.isPk) return ' PK';
    return foreignKeys.has(column.name) ? ' FK' : '';
};

export const toMermaid = ({ tables, relationships }: DiagramSource): string => {
    const lines: string[] = ['erDiagram'];

    for (const table of tables) {
        const foreignKeys = new Set(
            relationships.filter(r => r.sourceTable === table.name).map(r => r.sourceColumn)
        );

        lines.push(`    ${mermaidName(table.name)} {`);
        if (table.columns.length === 0) {
            // An entity with an empty body is a parse error, not an empty box.
            lines.push('        string placeholder "no columns yet"');
        }
        for (const column of table.columns) {
            const comment = column.notNull ? ' "not null"' : '';
            lines.push(`        ${mermaidType(column.type)} ${mermaidName(column.name)}`
                + `${keyMarker(column, foreignKeys)}${comment}`);
        }
        lines.push('    }');
    }

    if (relationships.length > 0) {
        lines.push('');
        for (const rel of relationships) {
            // A foreign key is many-children-to-one-parent, and the child side is optional
            // because nothing obliges a parent row to have children.
            lines.push(`    ${mermaidName(rel.targetTable)} ||--o{ ${mermaidName(rel.sourceTable)}`
                + ` : "${rel.sourceColumn}"`);
        }
    }

    return lines.join('\n') + '\n';
};

/** The same diagram inside a fenced block, which is what a README or a ticket actually wants. */
export const toMermaidMarkdown = (source: DiagramSource, title: string): string => {
    const name = title.replace(/\.(sql|csv)$/i, '') || 'Schema';
    const tableCount = source.tables.length;
    const relCount = source.relationships.length;

    return `# ${name}\n\n`
        + `${tableCount} table${tableCount === 1 ? '' : 's'}, `
        + `${relCount} relationship${relCount === 1 ? '' : 's'}.\n\n`
        + '```mermaid\n'
        + toMermaid(source)
        + '```\n';
};

/* ── DBML ─────────────────────────────────────────────────────────────────── */

/** DBML quotes an identifier that is not a bare word, and only then. */
const dbmlName = (name: string): string =>
    /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : `"${name.replace(/"/g, '\\"')}"`;

const dbmlType = (type: string): string => (type || 'text').trim().toLowerCase();

export const toDbml = ({ tables, relationships }: DiagramSource): string => {
    const blocks: string[] = [];

    for (const table of tables) {
        const settingsFor = (column: ColumnInfo): string => {
            const settings: string[] = [];
            if (column.isPk) settings.push('pk');
            // An integer primary key is where the value comes from on every engine this exports
            // to, so dbdiagram should show it as generated rather than as one you must supply.
            if (column.isPk && /^int/i.test(column.type || '')) settings.push('increment');
            if (column.notNull && !column.isPk) settings.push('not null');
            return settings.length > 0 ? ` [${settings.join(', ')}]` : '';
        };

        const columns = table.columns.map(
            c => `  ${dbmlName(c.name)} ${dbmlType(c.type)}${settingsFor(c)}`
        );

        blocks.push(`Table ${dbmlName(table.name)} {\n${columns.join('\n')}\n}`);
    }

    // `>` is "many to one", read left to right: many orders point at one customer.
    const refs = relationships.map(
        r => `Ref: ${dbmlName(r.sourceTable)}.${dbmlName(r.sourceColumn)}`
            + ` > ${dbmlName(r.targetTable)}.${dbmlName(r.targetColumn)}`
    );

    return [...blocks, ...(refs.length > 0 ? ['', ...refs] : [])].join('\n\n') + '\n';
};

/* ── Delivery ─────────────────────────────────────────────────────────────── */

/**
 * Saves generated text as a file. Built entirely in the browser — nothing is uploaded to produce
 * it — which is exactly why the account gate for this has to live in the caller (`ExportModal`)
 * rather than on a server that never sees the request: there is nothing here for a 401 to refuse.
 */
export const downloadText = (content: string, fileName: string, mime = 'text/plain') => {
    const url = URL.createObjectURL(new Blob([content], { type: `${mime};charset=utf-8` }));
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
};

/**
 * Copies text to the clipboard, falling back to a hidden textarea.
 *
 * `navigator.clipboard` is unavailable on a page served over plain HTTP, which is exactly how
 * someone running this locally will meet it — so the fallback is the common path, not an edge
 * case.
 */
export const copyText = async (content: string): Promise<boolean> => {
    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(content);
            return true;
        }
    } catch {
        // Denied or unavailable; fall through to the manual route.
    }

    try {
        const area = document.createElement('textarea');
        area.value = content;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        const copied = document.execCommand('copy');
        document.body.removeChild(area);
        return copied;
    } catch {
        return false;
    }
};

/** `orders.sql` -> `orders`, for naming the generated file. */
export const baseFileName = (fileName: string): string =>
    (fileName || 'schema').replace(/\.(sql|csv)$/i, '') || 'schema';
