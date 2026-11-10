/**
 * Turns text — pasted, or fetched from a URL — into the File the import pipeline takes.
 *
 * Everything ends up as a `.sql` or `.csv` File and goes through `handleFileChosen`, the same
 * pre-flight preview a picked file gets, so there is one import path rather than three. DBML is
 * converted to SQL here first (`dbmlImport.ts`); its notes about what could not be carried
 * across come back alongside the file.
 */
import { dbmlToSql } from './dbmlImport';

export type TextFormat = 'sql' | 'dbml' | 'csv';

export interface PreparedImport {
    file: File;
    /** Notes from converting DBML; empty for SQL and CSV. */
    warnings: string[];
}

/** DBML has `Table name {`; SQL has `CREATE TABLE`. Used when nothing else says which. */
export const looksLikeDbml = (text: string): boolean =>
    /^\s*Table\s+[^\s{]+(\s+as\s+\S+)?\s*(\[[^\]]*\])?\s*\{/im.test(text)
    && !/\bCREATE\s+TABLE\b/i.test(text);

export const formatOf = (fileName: string, text: string): TextFormat => {
    const lower = fileName.toLowerCase();
    if (lower.endsWith('.dbml')) return 'dbml';
    if (lower.endsWith('.csv')) return 'csv';
    if (lower.endsWith('.sql')) return 'sql';
    return looksLikeDbml(text) ? 'dbml' : 'sql';
};

/** `shop` / `shop.dbml` / `shop.sql` → `shop.sql` (or `.csv`). */
const withExtension = (name: string, extension: 'sql' | 'csv'): string => {
    const base = (name.trim() || 'imported').replace(/\.(sql|csv|dbml|txt)$/i, '');
    return `${base}.${extension}`;
};

export const prepareImport = (name: string, text: string, format: TextFormat = formatOf(name, text)): PreparedImport => {
    if (!text.trim()) throw new Error('There is nothing to import.');
    if (format === 'dbml') {
        const converted = dbmlToSql(text);
        if (converted.tableCount === 0) {
            throw new Error('No tables were found in that DBML. A table looks like: Table users { id int [pk] }');
        }
        return {
            file: new File([converted.sql], withExtension(name, 'sql'), { type: 'text/plain' }),
            warnings: converted.warnings,
        };
    }
    const extension = format === 'csv' ? 'csv' : 'sql';
    return {
        file: new File([text], withExtension(name, extension), { type: 'text/plain' }),
        warnings: [],
    };
};
