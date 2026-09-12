package com.dbviewer.app.service;

import java.util.List;
import java.util.Map;

/**
 * Serves the bundled starter schemas.
 *
 * <p>Templates live entirely on the backend: a {@code .sql} file plus an entry in
 * {@code templates/manifest.json}. The frontend only renders what this returns, so adding a
 * template never needs a frontend change or release.
 *
 * <p>Table names and relationship counts are <b>derived from the SQL</b> rather than repeated in
 * the manifest, so the numbers on a template card cannot drift away from what the template
 * actually creates.
 *
 * <p>The shapes below live on the interface rather than the implementation: they are the
 * contract, referenced by the controller, the schema parser and the tests.
 *
 * @see com.dbviewer.app.service.impl.TemplateServiceImpl
 */
public interface TemplateService {

    /** A column as declared in the template. */
    record TemplateColumn(String name, String type, boolean pk) {
    }

    /** A foreign key, one pair per column for composite keys. */
    record TemplateRelationship(
            String sourceTable, String sourceColumn, String targetTable, String targetColumn) {
    }

    record TemplateTable(String name, List<TemplateColumn> columns) {
    }

    /** Enough structure for the UI to draw the diagram without parsing SQL itself. */
    record TemplateSchema(
            List<TemplateTable> tables, List<TemplateRelationship> relationships) {
    }

    /**
     * One bundled starter schema.
     *
     * <p>{@code sql} and {@code schema} are populated only on the detail endpoint. The list
     * response carries neither: they are what makes a template large, and the catalogue is
     * fetched on first paint of the landing page.
     */
    record Template(
            String id,
            String name,
            String description,
            String category,
            List<String> tags,
            boolean featured,
            List<String> tables,
            int tableCount,
            int relationshipCount,
            String sql,
            TemplateSchema schema) {

        /** The same template stripped of its heavy fields, for list responses. */
        public Template summary() {
            return new Template(id, name, description, category, tags, featured,
                    tables, tableCount, relationshipCount, null, null);
        }
    }

    /** Every template, without SQL bodies. */
    List<Template> list();

    /**
     * One template including its SQL, so the UI can show a preview before applying it.
     *
     * @throws IllegalArgumentException if no template has that id
     */
    Template get(String id);

    /** The distinct categories, in the order they first appear in the manifest. */
    List<String> categories();

    /**
     * Runs a template into the workspace on the current request.
     *
     * @throws IllegalArgumentException if the workspace already has tables
     */
    Map<String, Object> apply(String id);
}
