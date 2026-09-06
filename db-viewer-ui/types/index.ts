export interface ColumnInfo {
    name: string;
    type: string;
    is_pk?: boolean;
    isPk?: boolean;
    /** True when the column is declared NOT NULL. Used to pre-fill the edit-column form. */
    notNull?: boolean;
    not_null?: boolean;
}

export type RowData = Record<string, string | number | boolean | null>;

export interface TableInfo {
    name: string;
    columns: ColumnInfo[];
    rows: RowData[];
}

export interface Relationship {
    source_table?: string;
    target_table?: string;
    source_column?: string;
    target_column?: string;
    sourceTable?: string;
    targetTable?: string;
    sourceColumn?: string;
    targetColumn?: string;
}

export interface SchemaResponse {
    tables: TableInfo[];
    relationships: Relationship[];
}

export interface TableDataResponse {
    columns: ColumnInfo[] | string[];
    rows: RowData[];
}
