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

/**
 * The colours a table can be tagged with.
 *
 * Token names, not hex values. The palette is defined once as `--color-tag-*` in `globals.css`
 * with a dark-theme counterpart, so a tagged table reads correctly in both themes; a hex chosen
 * for light mode is unreadable in dark, which is exactly the mistake the token system exists to
 * prevent.
 */
export const TAG_COLOURS = ['slate', 'brand', 'violet', 'teal', 'amber', 'rose'] as const;
export type TagColour = typeof TAG_COLOURS[number];

export interface ColumnInfo {
    name: string;
    type: string;
    /** True when the column is the table's primary key. */
    isPk?: boolean;
    /** True when the column is declared NOT NULL. */
    notNull?: boolean;
    /**
     * True when a single-column UNIQUE index covers this column, or it is the sole primary key.
     *
     * This is what separates a 1:1 relationship from a 1:N — a foreign key pointing at a unique
     * column can match at most one row. Composite keys report false for every member, because
     * none of them is unique alone.
     */
    isUnique?: boolean;
    /** The DEFAULT as written in the schema (`'active'`, `0`), or undefined. */
    defaultValue?: string;
    autoIncrement?: boolean;
}

export type RowData = Record<string, string | number | boolean | null>;

export interface TableInfo {
    name: string;
    columns: ColumnInfo[];
    rows: RowData[];
}

export interface Relationship {
    /** The table holding the foreign key — the "many" end, usually. */
    sourceTable: string;
    sourceColumn: string;
    /** The table being pointed at — the "one" end. */
    targetTable: string;
    targetColumn: string;
    /**
     * The engine's id for the constraint. Columns of a composite key share one.
     *
     * Without it two columns of a single constraint look like two constraints, and the canvas
     * draws two edges on top of each other where there is one relationship.
     */
    constraintId?: number;
    /** Declared ON DELETE action, or undefined when none was written. */
    onDelete?: string;
}

export interface SchemaResponse {
    tables: TableInfo[];
    relationships: Relationship[];
}

export interface TableDataResponse {
    columns: ColumnInfo[] | string[];
    rows: RowData[];
}

/* ── Import staging ───────────────────────────────────────────────────────
   What an upload *would* create, worked out by the backend without running any
   of it. The whole point of the shape is that it can be shown to someone and
   then thrown away: `POST /import/analyze` touches no database, so cancelling
   the dialog it feeds leaves nothing behind. */

/** The engines a script can be read from and an export can be written for. */
export type SqlDialectId = 'mysql' | 'mariadb' | 'postgres' | 'sqlserver' | 'sqlite' | 'generic';

export interface PlannedColumn {
    name: string;
    type: string;
    /** Why this type was chosen. Null for a script, whose types are declared rather than guessed. */
    reason?: string | null;
    /** A few real values from the file, so the guess can be sanity-checked against the data. */
    samples: string[];
    nullable: boolean;
    primaryKey: boolean;
}

export interface PlannedTable {
    name: string;
    columns: PlannedColumn[];
}

export interface PlannedRelationship {
    sourceTable: string;
    sourceColumn: string;
    targetTable: string;
    targetColumn: string;
}

export interface ImportPlan {
    type: 'csv' | 'sql';
    fileName: string;
    dialect: SqlDialectId;
    dialectLabel: string;
    /** Rows in a CSV, or INSERT statements in a script. */
    dataRowCount: number;
    statementCount: number;
    /**
     * True when the types are inferred and worth correcting — a CSV. A script declares its own
     * types, so its dialog is a review rather than an editor.
     */
    editable: boolean;
    tables: PlannedTable[];
    relationships: PlannedRelationship[];
    typeOptions: string[];
    /** Everything that will be skipped, and why. */
    notes: string[];
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
    unique?: boolean;
    isUnique?: boolean;
    default_value?: string | null;
    defaultValue?: string | null;
    auto_increment?: boolean;
    autoIncrement?: boolean;
}

export interface RawRelationship {
    constraintId?: number;
    constraint_id?: number;
    onDelete?: string | null;
    on_delete?: string | null;
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
