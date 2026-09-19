package com.dbviewer.app.importing;

import com.dbviewer.app.dto.ImportPlan;
import com.dbviewer.app.service.TemplateService;
import com.dbviewer.app.sql.SqlDialect;
import com.dbviewer.app.sql.SqlDialectDetector;
import com.dbviewer.app.sql.SqlDialectTranslator;
import com.dbviewer.app.sql.SqlScriptSplitter;
import com.dbviewer.app.template.TemplateSchemaParser;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Reads an uploaded file and reports what importing it would produce, without importing it.
 *
 * <p>Everything here is a dry run of the real path — the same splitter, the same dialect
 * detection, the same translator — so the preview cannot describe one import and the confirm
 * perform a different one. The only thing that does not happen is the execution.
 */
public final class ImportAnalyzer {

    /** A pathological file must not make the preview itself the slow part. */
    private static final int MAX_NOTES = 40;

    private ImportAnalyzer() {
    }

    public static ImportPlan analyze(String fileName, String content) {
        String name = fileName == null ? "" : fileName;
        return name.toLowerCase(Locale.ROOT).endsWith(".csv")
                ? analyzeCsv(name, content)
                : analyzeSql(name, content);
    }

    /* ── CSV ─────────────────────────────────────────────────────────────────── */

    private static ImportPlan analyzeCsv(String fileName, String content) {
        CsvReader.CsvTable table = CsvReader.read(content);
        if (table.isEmpty()) {
            throw new IllegalArgumentException("That CSV file has no header row to read.");
        }

        List<ImportPlan.PlannedColumn> columns = new ArrayList<>();
        for (ColumnTypeInference.Proposal proposal : ColumnTypeInference.propose(table)) {
            columns.add(new ImportPlan.PlannedColumn(
                    proposal.name(), proposal.inferredType(), proposal.reason(),
                    proposal.samples(), proposal.nullable(), false));
        }

        List<String> notes = new ArrayList<>();
        boolean hasId = columns.stream().anyMatch(c -> c.name().equalsIgnoreCase("id"));
        if (!hasId) {
            notes.add("An auto-incrementing `id` column will be added, because editing and "
                    + "deleting rows in the app addresses them by id.");
        }
        if (table.delimiter() != ',') {
            notes.add("Fields are separated by '" + describeDelimiter(table.delimiter())
                    + "', not a comma.");
        }

        return new ImportPlan(
                "csv",
                fileName,
                SqlDialect.GENERIC.id(),
                SqlDialect.GENERIC.label(),
                table.rows().size(),
                1,
                true,
                List.of(new ImportPlan.PlannedTable(CsvReader.tableNameFor(fileName), columns)),
                List.of(),
                ColumnTypeInference.OFFERED_TYPES,
                notes);
    }

    private static String describeDelimiter(char delimiter) {
        return switch (delimiter) {
            case '\t' -> "tab";
            case ';' -> "semicolon";
            case '|' -> "pipe";
            default -> String.valueOf(delimiter);
        };
    }

    /* ── SQL ─────────────────────────────────────────────────────────────────── */

    private static ImportPlan analyzeSql(String fileName, String content) {
        List<String> statements = SqlScriptSplitter.split(content);
        SqlDialect dialect = SqlDialectDetector.detect(content);
        SqlDialectTranslator.Result translated = SqlDialectTranslator.translate(statements, dialect);

        // The translated script is plain SQLite DDL, which is exactly what this parser reads -
        // so the preview shows the tables as they will actually be created, not as the source
        // file declared them.
        TemplateService.TemplateSchema schema =
                TemplateSchemaParser.parse(String.join(";\n", translated.statements()) + ";");

        List<ImportPlan.PlannedTable> tables = schema.tables().stream()
                .map(t -> new ImportPlan.PlannedTable(t.name(), t.columns().stream()
                        .map(c -> new ImportPlan.PlannedColumn(
                                c.name(), c.type(), null, List.of(), false, c.pk()))
                        .toList()))
                .toList();

        List<ImportPlan.PlannedRelationship> relationships = schema.relationships().stream()
                .map(r -> new ImportPlan.PlannedRelationship(
                        r.sourceTable(), r.sourceColumn(), r.targetTable(), r.targetColumn()))
                .toList();

        int inserts = (int) translated.statements().stream()
                .filter(s -> s.regionMatches(true, 0, "INSERT", 0, 6))
                .count();

        List<String> notes = translated.notes().size() > MAX_NOTES
                ? new ArrayList<>(translated.notes().subList(0, MAX_NOTES))
                : new ArrayList<>(translated.notes());
        if (translated.notes().size() > MAX_NOTES) {
            notes.add("...and " + (translated.notes().size() - MAX_NOTES) + " more.");
        }
        if (tables.isEmpty()) {
            notes.add(0, "No CREATE TABLE statement could be read from this file, so the import "
                    + "would produce an empty diagram.");
        }

        return new ImportPlan(
                "sql",
                fileName,
                dialect.id(),
                dialect.label(),
                inserts,
                translated.statements().size(),
                // A script declares its types; there is nothing inferred to correct, so the
                // dialog is a review rather than an editor.
                false,
                tables,
                relationships,
                ColumnTypeInference.OFFERED_TYPES,
                notes);
    }
}
