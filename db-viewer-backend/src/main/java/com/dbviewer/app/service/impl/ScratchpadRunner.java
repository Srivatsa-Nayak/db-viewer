package com.dbviewer.app.service.impl;

import com.dbviewer.app.sql.SqlScriptSplitter;
import com.dbviewer.app.workspace.WorkspaceManager;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Runs the SQL panel's scripts ({@code POST /scratchpad}) against the current workspace.
 *
 * <p>Split out of {@code DatabaseServiceImpl}, which still owns the endpoint and delegates here.
 * Account-gated at the controller; this class enforces the limits that keep a paste from
 * running away: a statement count, a row cap and a per-statement timeout.
 */
@Component
@RequiredArgsConstructor
public class ScratchpadRunner {

    private final WorkspaceManager workspaceManager;

    private JdbcTemplate jdbc() {
        return workspaceManager.current();
    }

    /** Enough statements for a real migration, few enough that a paste cannot run away. */
    private static final int MAX_STATEMENTS = 50;
    /** Rows returned to the UI per statement. The panel is not a data grid. */
    private static final int MAX_RESULT_ROWS = 500;
    /** A statement that has not finished in this long is not going to. */
    private static final int STATEMENT_TIMEOUT_SECONDS = 15;

    /**
     * Runs a user's SQL, statement by statement, and reports what each one did.
     *
     * <p>Deliberately not {@code DatabaseService#executeQuery}, which runs a single statement and answers with
     * either rows or a count. A scratchpad is used to run several at once, and the question that
     * matters when something goes wrong is <em>which</em> one — a shape the old response could not
     * express at all.
     *
     * <p>Execution stops at the first failure. A script is usually a sequence where the later
     * statements assume the earlier ones worked, so carrying on past an error produces a cascade
     * of confusing secondary failures and leaves the schema somewhere nobody intended.
     */
    public Map<String, Object> run(String script) {
        if (script == null || script.isBlank()) {
            throw new IllegalArgumentException("Nothing to run.");
        }

        List<String> statements = SqlScriptSplitter.split(script);
        if (statements.isEmpty()) {
            throw new IllegalArgumentException("Nothing to run.");
        }
        if (statements.size() > MAX_STATEMENTS) {
            throw new IllegalArgumentException(
                    "That is " + statements.size() + " statements. Run at most " + MAX_STATEMENTS
                            + " at a time — use Import for a whole file.");
        }
        for (String statement : statements) {
            refuseInternalTables(statement);
        }

        List<Map<String, Object>> report = new ArrayList<>();
        boolean schemaChanged = false;
        boolean stopped = false;

        for (String statement : statements) {
            if (stopped) {
                report.add(statementReport(statement, "skipped", null, null, null,
                        "Not run: an earlier statement failed.", false));
                continue;
            }
            String kind = statementKind(statement);
            try {
                if (returnsRows(statement)) {
                    List<Map<String, Object>> rows = queryWithLimit(statement);
                    boolean truncated = rows.size() > MAX_RESULT_ROWS;
                    if (truncated) rows = rows.subList(0, MAX_RESULT_ROWS);
                    report.add(statementReport(statement, kind,
                            rows.isEmpty() ? List.of() : new ArrayList<>(rows.get(0).keySet()),
                            rows, rows.size(), null, truncated));
                } else {
                    int affected = updateWithTimeout(statement);
                    report.add(statementReport(statement, kind, null, null, affected, null, false));
                    if (!"SELECT".equals(kind)) schemaChanged = true;
                }
            } catch (Exception e) {
                report.add(statementReport(statement, kind, null, null, null,
                        StatementText.rootCauseMessage(e), false));
                stopped = true;
            }
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("statements", report);
        // Tells the UI whether the canvas needs re-reading. A SELECT changes nothing, and
        // refreshing the whole schema after every one of those would be wasteful and jumpy.
        result.put("schemaChanged", schemaChanged);
        result.put("failed", stopped);
        return result;
    }

    private Map<String, Object> statementReport(String sql, String kind, List<String> columns,
                                                List<Map<String, Object>> rows, Integer count,
                                                String error, boolean truncated) {
        Map<String, Object> entry = new LinkedHashMap<>();
        entry.put("sql", StatementText.summarize(sql));
        entry.put("kind", kind);
        if (columns != null) entry.put("columns", columns);
        if (rows != null) entry.put("rows", rows);
        if (count != null) entry.put("rowCount", count);
        if (error != null) entry.put("error", error);
        entry.put("truncated", truncated);
        return entry;
    }

    /**
     * Whether a statement produces a result set.
     *
     * <p>{@code PRAGMA} is the awkward one: the read form returns rows and the assignment form
     * does not, and sending the latter to a query call fails with "query does not return
     * ResultSet" — which is exactly what {@code executeQuery} still does.
     */
    private boolean returnsRows(String statement) {
        String head = statement.stripLeading().toUpperCase();
        if (head.startsWith("SELECT") || head.startsWith("WITH") || head.startsWith("EXPLAIN")
                || head.startsWith("SHOW") || head.startsWith("VALUES")) {
            return true;
        }
        // A read pragma is a bare name; `PRAGMA foreign_keys = ON` is an assignment.
        return head.startsWith("PRAGMA") && !head.contains("=");
    }

    private String statementKind(String statement) {
        String head = statement.stripLeading().toUpperCase();
        for (String word : List.of("SELECT", "INSERT", "UPDATE", "DELETE", "CREATE VIEW",
                "CREATE TABLE", "CREATE INDEX", "ALTER", "DROP", "PRAGMA", "WITH", "EXPLAIN")) {
            if (head.startsWith(word)) return word;
        }
        int space = head.indexOf(' ');
        return space > 0 ? head.substring(0, space) : head;
    }

    private List<Map<String, Object>> queryWithLimit(String sql) {
        return jdbc().execute((org.springframework.jdbc.core.StatementCallback<List<Map<String, Object>>>) stmt -> {
            stmt.setQueryTimeout(STATEMENT_TIMEOUT_SECONDS);
            // One more than the cap, so the caller can tell "exactly 500" from "at least 500".
            stmt.setMaxRows(MAX_RESULT_ROWS + 1);
            try (java.sql.ResultSet rs = stmt.executeQuery(sql)) {
                return readRows(rs);
            }
        });
    }

    private List<Map<String, Object>> readRows(java.sql.ResultSet rs) throws java.sql.SQLException {
        java.sql.ResultSetMetaData meta = rs.getMetaData();
        int columns = meta.getColumnCount();
        List<Map<String, Object>> rows = new ArrayList<>();
        while (rs.next()) {
            Map<String, Object> row = new LinkedHashMap<>();
            for (int i = 1; i <= columns; i++) {
                row.put(meta.getColumnLabel(i), rs.getObject(i));
            }
            rows.add(row);
        }
        return rows;
    }

    private int updateWithTimeout(String sql) {
        Integer affected = jdbc().execute((org.springframework.jdbc.core.StatementCallback<Integer>) stmt -> {
            stmt.setQueryTimeout(STATEMENT_TIMEOUT_SECONDS);
            stmt.execute(sql);
            int count = stmt.getUpdateCount();
            return count < 0 ? 0 : count;
        });
        return affected == null ? 0 : affected;
    }

    /**
     * Refuses a statement that names one of the application's own tables.
     *
     * <p>They are filtered out of every listing, so nobody can see them to mean them; a statement
     * naming one is either a mistake or an attempt to reach behind the UI, and neither should be
     * allowed to corrupt the notes or the canvas annotations.
     */
    static void refuseInternalTables(String statement) {
        java.util.regex.Matcher matcher =
                java.util.regex.Pattern.compile("(?<![A-Za-z0-9_])__[A-Za-z0-9_]+")
                        .matcher(statement);
        if (matcher.find()) {
            throw new IllegalArgumentException(
                    "\"" + matcher.group() + "\" belongs to the application. Tables whose names "
                            + "start with __ are not yours to change.");
        }
    }
}
