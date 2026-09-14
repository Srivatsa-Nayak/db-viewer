/**
 * The shapes the UI works with.
 *
 * These are the *normalised* shapes, not the wire format. The backend has shipped both
 * `is_pk` and `isPk` (and `source_table` / `sourceTable`, `not_null` / `notNull`) over its
 * life, and every consumer used to carry its own `c.is_pk ?? c.isPk` dance — which meant a
 * component that forgot one half silently treated every primary key as an ordinary column.
 * `services/api.ts` now folds both spellings into these types at the boundary, so nothing
 * downstream has to know the wire format ever had two.
 */

export interface ColumnInfo {
    name: string;
    type: string;
    /** True when the column is the table's primary key. */
    isPk?: boolean;
    /** True when the column is declared NOT NULL. */
    notNull?: boolean;
}

export type RowData = Record<string, string | number | boolean | null>;

export interface TableInfo {
    name: string;
    columns: ColumnInfo[];
    rows: RowData[];
}

export interface Relationship {
    sourceTable: string;
    sourceColumn: string;
    targetTable: string;
    targetColumn: string;
}

export interface SchemaResponse {
    tables: TableInfo[];
    relationships: Relationship[];
}

export interface TableDataResponse {
    columns: ColumnInfo[] | string[];
    rows: RowData[];
}

/* ── Wire formats ─────────────────────────────────────────────────────────
   Only `services/api.ts` should need these. */

export interface RawColumnInfo {
    name: string;
    type: string;
    is_pk?: boolean;
    isPk?: boolean;
    not_null?: boolean;
    notNull?: boolean;
}

export interface RawRelationship {
    source_table?: string;
    target_table?: string;
    source_column?: string;
    target_column?: string;
    sourceTable?: string;
    targetTable?: string;
    sourceColumn?: string;
    targetColumn?: string;
}

export interface RawTableInfo {
    name: string;
    columns?: RawColumnInfo[];
    rows?: RowData[];
}

export interface RawSchemaResponse {
    tables?: RawTableInfo[];
    relationships?: RawRelationship[];
}
