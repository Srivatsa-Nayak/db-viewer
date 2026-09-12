package com.dbviewer.app.template;

import com.dbviewer.app.service.TemplateService;
import com.dbviewer.app.sql.MySqlToSqliteTranslator;
import com.dbviewer.app.sql.SqlScriptSplitter;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Reads a template's {@code CREATE TABLE} statements into a structure the UI can draw.
 *
 * <p>Exists so the template preview can show the diagram as well as the SQL, without the
 * frontend having to parse SQL or the backend having to create a throwaway database per
 * preview.
 *
 * <p>This is a deliberately narrow parser, not a general SQL one: it only has to understand
 * the templates we author ourselves, which are written in one consistent style.
 * {@code TemplateCatalogueTest} applies every template for real and asserts that what this
 * produces matches the schema the database actually ends up with — so if a template is ever
 * written in a way the parser mishandles, a test fails rather than the preview quietly lying.
 */
public final class TemplateSchemaParser {

    private static final Pattern CREATE_TABLE = Pattern.compile(
            "^CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?[\"`\\[]?([A-Za-z0-9_]+)[\"`\\]]?\\s*\\(",
            Pattern.CASE_INSENSITIVE);

    private static final Pattern FOREIGN_KEY = Pattern.compile(
            "^(?:CONSTRAINT\\s+\\S+\\s+)?FOREIGN\\s+KEY\\s*\\(([^)]*)\\)\\s*"
                    + "REFERENCES\\s+[\"`\\[]?([A-Za-z0-9_]+)[\"`\\]]?\\s*\\(([^)]*)\\)",
            Pattern.CASE_INSENSITIVE);

    private static final Pattern TABLE_PRIMARY_KEY = Pattern.compile(
            "^PRIMARY\\s+KEY\\s*\\(([^)]*)\\)", Pattern.CASE_INSENSITIVE);

    /** Column name, then the declared type — which may carry its own parentheses. */
    private static final Pattern COLUMN = Pattern.compile(
            "^[\"`\\[]?([A-Za-z0-9_]+)[\"`\\]]?\\s+([A-Za-z]+(?:\\s*\\([^)]*\\))?)");

    /** Constraint keywords that are not columns and carry no relationship. */
    private static final Pattern IGNORED = Pattern.compile(
            "^(UNIQUE|CHECK|KEY|INDEX|FULLTEXT|SPATIAL)\\b", Pattern.CASE_INSENSITIVE);

    private TemplateSchemaParser() {
    }

    public static TemplateService.TemplateSchema parse(String sql) {
        List<TemplateService.TemplateTable> tables = new ArrayList<>();
        List<TemplateService.TemplateRelationship> relationships = new ArrayList<>();

        // Splitting first strips comments and string literals out of the way, so prose that
        // happens to mention "foreign key" is never mistaken for a constraint.
        for (String statement : SqlScriptSplitter.split(sql)) {
            Matcher header = CREATE_TABLE.matcher(statement);
            if (!header.find()) {
                continue;
            }

            String tableName = header.group(1);
            String body = bodyOf(statement, header.end() - 1);
            if (body == null) {
                continue;
            }

            List<TemplateService.TemplateColumn> columns = new ArrayList<>();
            Set<String> primaryKeys = new LinkedHashSet<>();

            for (String raw : MySqlToSqliteTranslator.splitTopLevel(body)) {
                String item = raw.trim();
                if (item.isEmpty()) {
                    continue;
                }

                Matcher fk = FOREIGN_KEY.matcher(item);
                if (fk.find()) {
                    List<String> from = identifiers(fk.group(1));
                    List<String> to = identifiers(fk.group(3));
                    // Composite keys pair positionally; a mismatched pair would be malformed SQL.
                    for (int i = 0; i < Math.min(from.size(), to.size()); i++) {
                        relationships.add(new TemplateService.TemplateRelationship(
                                tableName, from.get(i), fk.group(2), to.get(i)));
                    }
                    continue;
                }

                Matcher tablePk = TABLE_PRIMARY_KEY.matcher(item);
                if (tablePk.find()) {
                    primaryKeys.addAll(identifiers(tablePk.group(1)));
                    continue;
                }

                if (IGNORED.matcher(item).find()) {
                    continue;
                }

                Matcher column = COLUMN.matcher(item);
                if (column.find()) {
                    String name = column.group(1);
                    boolean inlinePk = item.toUpperCase().contains("PRIMARY KEY");
                    if (inlinePk) {
                        primaryKeys.add(name);
                    }
                    columns.add(new TemplateService.TemplateColumn(
                            name, column.group(2).replaceAll("\\s+", ""), inlinePk));
                }
            }

            // Fold table-level PRIMARY KEY(...) back onto the columns it names.
            List<TemplateService.TemplateColumn> resolved = columns.stream()
                    .map(c -> c.pk() || primaryKeys.contains(c.name())
                            ? new TemplateService.TemplateColumn(c.name(), c.type(), true)
                            : c)
                    .toList();

            tables.add(new TemplateService.TemplateTable(tableName, resolved));
        }

        return new TemplateService.TemplateSchema(tables, relationships);
    }

    /** The text between the {@code CREATE TABLE (...)} parentheses, or null if unbalanced. */
    private static String bodyOf(String statement, int openParen) {
        int depth = 0;
        char quote = 0;

        for (int i = openParen; i < statement.length(); i++) {
            char c = statement.charAt(i);

            if (quote != 0) {
                if (c == quote) quote = 0;
                continue;
            }
            if (c == '\'' || c == '"' || c == '`') {
                quote = c;
                continue;
            }
            if (c == '(') {
                depth++;
            } else if (c == ')') {
                depth--;
                if (depth == 0) {
                    return statement.substring(openParen + 1, i);
                }
            }
        }
        return null;
    }

    private static List<String> identifiers(String list) {
        List<String> names = new ArrayList<>();
        for (String part : list.split(",")) {
            String name = part.trim().replaceAll("^[\"`\\[]|[\"`\\]]$", "").trim();
            // phpMyAdmin can emit a prefix length, e.g. `name`(20).
            name = name.replaceAll("\\s*\\(\\d+\\)$", "").trim();
            if (!name.isEmpty()) {
                names.add(name);
            }
        }
        return names;
    }
}
