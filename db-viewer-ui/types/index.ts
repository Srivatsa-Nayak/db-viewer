export interface ColumnInfo {
    name: string;
    type: string;
}

export interface TableInfo {
    name: string;
    columns: ColumnInfo[]; // Was string[]
    rows: any[];
}

export interface Relationship {
    source_table: string;
    target_table: string;
    source_column: string;
}

export interface SchemaResponse {
    tables: TableInfo[];
    relationships: Relationship[];
}

export interface QueryResponse {
    data: any[];
}