package com.dbviewer.app.dto;

import java.util.List;

/**
 * What an upload <em>would</em> do, worked out without touching the database.
 *
 * <p>An import used to be irreversible the instant the file left the file picker: the DDL ran,
 * the tables existed, and a column the importer had guessed was an integer had already dropped
 * the leading zeros off every postcode in it. There is no undo for that — the original values
 * are not in the database to recover.
 *
 * <p>So the work is split in two. This is the first half: parse the file, say which tables and
 * columns would be created and with what types, name everything that would be skipped, and
 * change nothing. The user reads it, corrects whatever the inference got wrong, and only then
 * does the second half run.
 *
 * @param type          {@code csv} or {@code sql}
 * @param fileName      the file as uploaded, echoed back for the dialog's title
 * @param dialect       id of the engine the script appears to be written for
 * @param dialectLabel  that dialect's display name
 * @param dataRowCount  rows found in a CSV, or INSERT statements found in a script
 * @param statementCount statements the script will attempt
 * @param editable      true when the types are guesses the user may usefully change - a CSV has
 *                      no declared types, whereas a script's are already explicit
 * @param typeOptions   the types offered in the dialog's dropdown
 * @param notes         everything that will be skipped, and why
 */
public record ImportPlan(
        String type,
        String fileName,
        String dialect,
        String dialectLabel,
        int dataRowCount,
        int statementCount,
        boolean editable,
        List<PlannedTable> tables,
        List<PlannedRelationship> relationships,
        List<String> typeOptions,
        List<String> notes) {

    /** A table the import would create. */
    public record PlannedTable(String name, List<PlannedColumn> columns) {
    }

    /**
     * A column the import would create.
     *
     * @param reason   why this type was chosen - shown beside it, because a guess the user can
     *                 see the reasoning for is one they can correct
     * @param samples  a few real values from the file
     * @param nullable true when at least one row left it empty
     */
    public record PlannedColumn(
            String name,
            String type,
            String reason,
            List<String> samples,
            boolean nullable,
            boolean primaryKey) {
    }

    /** A foreign key the import would create, so the preview can show the diagram's edges. */
    public record PlannedRelationship(
            String sourceTable, String sourceColumn, String targetTable, String targetColumn) {
    }
}
