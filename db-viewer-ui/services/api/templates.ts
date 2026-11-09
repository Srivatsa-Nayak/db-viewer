/** The starter-schema catalogue's types. */

/**
 * A bundled starter schema.
 *
 * Authored on the backend (a .sql file plus a manifest entry) and only rendered here, so a new
 * template needs no frontend change. `sql` is present only on the detail endpoint.
 */
export interface TemplateColumn {
    name: string;
    type: string;
    pk: boolean;
}

export interface TemplateRelationship {
    sourceTable: string;
    sourceColumn: string;
    targetTable: string;
    targetColumn: string;
}

export interface TemplateTable {
    name: string;
    columns: TemplateColumn[];
}

/** Enough structure to draw the diagram without the frontend parsing any SQL. */
export interface TemplateSchema {
    tables: TemplateTable[];
    relationships: TemplateRelationship[];
}

export interface SchemaTemplate {
    id: string;
    name: string;
    description: string;
    category: string;
    tags: string[];
    featured: boolean;
    tables: string[];
    tableCount: number;
    relationshipCount: number;
    /**
     * Detail endpoint only — omitted from the list so the catalogue stays small.
     *
     * Nothing renders this any more. The preview used to show it beside the diagram, which
     * spent half the dialog on DDL nobody was choosing a template by; anyone who wants the SQL
     * can open the template and export it, and get their own edits with it.
     */
    sql?: string | null;
    /** Detail endpoint only. */
    schema?: TemplateSchema | null;
}
