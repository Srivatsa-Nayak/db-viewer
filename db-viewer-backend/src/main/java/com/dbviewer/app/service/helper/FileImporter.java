package com.dbviewer.app.service.helper;

import com.dbviewer.app.common.Constants;
import com.dbviewer.app.config.DatabaseConfig;
import com.dbviewer.app.dto.ImportPlan;
import com.dbviewer.app.importing.ColumnTypeInference;
import com.dbviewer.app.importing.CsvReader;
import com.dbviewer.app.importing.ImportAnalyzer;
import com.dbviewer.app.sql.SqlDialect;
import com.dbviewer.app.sql.SqlDialectDetector;
import com.dbviewer.app.sql.SqlDialectTranslator;
import com.dbviewer.app.sql.SqlScriptSplitter;
import com.dbviewer.app.sql.SqlTypeMapper;
import com.dbviewer.app.workspace.WorkspaceManager;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.web.multipart.MultipartFile;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * Imports a {@code .csv} or {@code .sql} file into the current workspace, and reports what one
 * would create without creating it ({@link #analyze}).
 *
 * <p>Split out of {@code DatabaseServiceImpl}, which still owns {@code /upload} and
 * {@code /import/analyze} and delegates here.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class FileImporter {

    private final WorkspaceManager workspaceManager;
    private final DatabaseConfig databaseConfig;

    private JdbcTemplate jdbc() {
        return workspaceManager.current();
    }

    private boolean isMysql() {
        return "mysql".equalsIgnoreCase(databaseConfig.getCurrentDriver());
    }

    private boolean isSqlite() {
        String driver = databaseConfig.getCurrentDriver();
        return "sqlite".equalsIgnoreCase(driver) || "sqlite3".equalsIgnoreCase(driver);
    }

    private String quote(String identifier) {
        String q = isMysql() ? Constants.Identifiers.MYSQL_QUOTE : Constants.Identifiers.STANDARD_QUOTE;
        return q + identifier + q;
    }


    /**
     * Runs an import the user has already seen and approved.
     *
     * @param typeOverrides the types the user corrected in the pre-flight dialog, keyed by
     *                      column name for a CSV and by {@code table.column} for a script. An
     *                      empty map means "use what was inferred", which is what the plain
     *                      upload path passes.
     */
    public Map<String, Object> importFile(MultipartFile file,
                                          Map<String, String> typeOverrides) throws Exception {
        String filename = file.getOriginalFilename() != null
                ? file.getOriginalFilename().toLowerCase() : "";
        Map<String, String> overrides = typeOverrides == null ? Map.of() : typeOverrides;

        if (filename.endsWith(".sql")) {
            return handleSqlUpload(file, overrides);
        } else if (filename.endsWith(".csv")) {
            return handleCsvUpload(file, overrides);
        } else {
            throw new IllegalArgumentException("Only .csv and .sql files are supported");
        }
    }

    /**
     * The most statements one {@code .sql} import may run, and the most rows one CSV may load.
     * An import runs on a request thread against a single free-tier instance; without a cap, one
     * file can occupy it for minutes. Both are far above any schema dump a person uploads.
     */
    @org.springframework.beans.factory.annotation.Value("${app.import.max-statements:20000}")
    private int maxImportStatements = 20_000;

    @org.springframework.beans.factory.annotation.Value("${app.import.max-csv-rows:200000}")
    private int maxCsvRows = 200_000;

    private void checkStatementCount(int count) {
        if (count > maxImportStatements) {
            throw new IllegalArgumentException("That script has " + count + " statements; an import "
                    + "can run at most " + maxImportStatements + ". Split it into smaller files.");
        }
    }

    private void checkCsvRowCount(long rows) {
        if (rows > maxCsvRows) {
            throw new IllegalArgumentException("That CSV has about " + rows + " rows; an import can "
                    + "load at most " + maxCsvRows + ". Split it into smaller files.");
        }
    }

    /**
     * Reports what an upload would create, without creating any of it.
     *
     * <p>Deliberately free of side effects — it never touches the workspace database — so the
     * dialog it feeds can be cancelled with nothing to undo.
     */
    public ImportPlan analyze(MultipartFile file) throws Exception {
        String filename = file.getOriginalFilename() == null ? "" : file.getOriginalFilename();
        String lower = filename.toLowerCase();
        if (!lower.endsWith(".sql") && !lower.endsWith(".csv")) {
            throw new IllegalArgumentException("Only .csv and .sql files are supported");
        }
        String content = new String(file.getBytes(), StandardCharsets.UTF_8);
        // Checked here as well as on upload, so the preview refuses a file the upload would.
        if (lower.endsWith(".sql")) {
            checkStatementCount(SqlScriptSplitter.split(content).size());
        } else {
            checkCsvRowCount(content.lines().count() - 1);
        }
        return ImportAnalyzer.analyze(filename, content);
    }

    /**
     * Executes an uploaded .sql script one statement at a time, because JdbcTemplate cannot run
     * a multi-statement string.
     *
     * <p>Returns a report rather than a bare success message: a dump is rarely 100% portable, and
     * silently swallowing what could not be run is how an import ends up looking like it worked
     * while producing an empty canvas.
     */
    private Map<String, Object> handleSqlUpload(MultipartFile file,
                                                Map<String, String> typeOverrides) throws Exception {
        String content = new String(file.getBytes(), StandardCharsets.UTF_8);

        List<String> statements = SqlScriptSplitter.split(content);
        checkStatementCount(statements.size());
        List<String> warnings = new ArrayList<>();
        SqlDialect dialect = SqlDialectDetector.detect(content);

        if (isSqlite()) {
            SqlDialectTranslator.Result translated =
                    SqlDialectTranslator.translate(statements, dialect, typeOverrides);
            statements = translated.statements();
            warnings.addAll(translated.notes());
        }

        List<String> failures = new ArrayList<>();
        List<String> toRun = statements;
        java.util.function.IntSupplier runAll = () -> {
            int count = 0;
            for (String statement : toRun) {
                try {
                    jdbc().execute(statement);
                    count++;
                } catch (Exception e) {
                    String reason = StatementText.rootCauseMessage(e);
                    failures.add(StatementText.summarize(statement) + " - " + reason);
                    log.warn("Skipping statement ({}): {}", reason, StatementText.summarize(statement));
                }
            }
            return count;
        };
        // On SQLite the whole import is one transaction: a crash halfway leaves the file as it
        // was rather than with half its tables, and thousands of INSERTs commit once instead of
        // once each. A statement that fails still only undoes itself, so skipping one and
        // carrying on works exactly as before. A script with its own BEGIN/COMMIT is run as
        // written, since a transaction cannot be nested inside another.
        int executed = isSqlite() && !managesItsOwnTransactions(toRun)
                ? workspaceManager.currentTransaction().execute(status -> runAll.getAsInt())
                : runAll.getAsInt();

        warnings.addAll(failures);

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("message", failures.isEmpty()
                ? "SQL executed successfully"
                : "SQL imported with " + failures.size() + " statement(s) skipped");
        result.put("type", "sql");
        // The engine the file was written for. Worth reporting even on a clean import: it is the
        // difference between "nothing was skipped" and "nothing was skipped, and it read this as
        // a PostgreSQL dump", which is what tells the user the translation was the right one.
        result.put("dialect", dialect.id());
        result.put("dialectLabel", dialect.label());
        result.put("statementsExecuted", executed);
        result.put("statementsSkipped", failures.size());
        // Capped so a pathological dump cannot return a megabyte of warnings.
        result.put("warnings", warnings.size() > 25 ? warnings.subList(0, 25) : warnings);
        result.put("warningCount", warnings.size());
        return result;
    }

    private static final Pattern TRANSACTION_CONTROL = Pattern.compile(
            "^\\s*(BEGIN|COMMIT|END|ROLLBACK|SAVEPOINT|RELEASE|START\\s+TRANSACTION)\\b",
            Pattern.CASE_INSENSITIVE);

    public static boolean managesItsOwnTransactions(List<String> statements) {
        return statements.stream().anyMatch(sql -> TRANSACTION_CONTROL.matcher(sql).find());
    }



    /**
     * Creates a table from a CSV file and loads its rows.
     *
     * <p>Column types come from {@link ColumnTypeInference} unless the user corrected them in the
     * pre-flight dialog, in which case their choice wins outright — the whole point of showing
     * the plan is that the person looking at the data knows things the heuristic cannot.
     */
    private Map<String, Object> handleCsvUpload(MultipartFile file,
                                                Map<String, String> typeOverrides) throws Exception {
        String originalName = file.getOriginalFilename() != null
                ? file.getOriginalFilename() : "upload.csv";
        String tableName = SqlIdentifiers.safe(CsvReader.tableNameFor(originalName), "table name");

        CsvReader.CsvTable csv = CsvReader.read(
                new String(file.getBytes(), StandardCharsets.UTF_8));
        if (csv.isEmpty()) {
            throw new IllegalArgumentException("CSV is empty");
        }
        checkCsvRowCount(csv.rows().size());

        List<String> headers = csv.headers();
        List<ColumnTypeInference.Proposal> proposals = ColumnTypeInference.propose(csv);

        List<String> resolvedTypes = new ArrayList<>();
        for (int i = 0; i < headers.size(); i++) {
            String header = headers.get(i);
            String chosen = firstNonBlank(
                    typeOverrides.get(header),
                    typeOverrides.get(tableName + "." + header),
                    proposals.get(i).inferredType());
            resolvedTypes.add(storageType(chosen));
        }

        jdbc().execute(buildCsvCreateTableSql(tableName, headers, resolvedTypes));

        int inserted = csv.rows().isEmpty() ? 0 : insertCsvRows(tableName, csv);

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("message", "CSV uploaded successfully");
        result.put("tableName", tableName);
        result.put("columns", headers);
        result.put("type", "csv");
        result.put("rowsInserted", inserted);
        result.put("statementsExecuted", inserted + 1);
        result.put("statementsSkipped", csv.rows().size() - inserted);
        result.put("warnings", List.of());
        result.put("warningCount", 0);
        return result;
    }

    private static String firstNonBlank(String... candidates) {
        for (String candidate : candidates) {
            if (candidate != null && !candidate.isBlank()) {
                return candidate.trim();
            }
        }
        return "VARCHAR(255)";
    }

    /**
     * Validates a requested column type and renders it for the engine actually in use.
     *
     * <p>A type cannot be a bind parameter, so anything that is not a plain type name with an
     * optional precision is rejected rather than escaped.
     */
    private String storageType(String requested) {
        if (!requested.matches("(?i)[A-Za-z][A-Za-z0-9 ]*(\\(\\s*\\d+\\s*(,\\s*\\d+\\s*)?\\))?")) {
            throw new IllegalArgumentException("Invalid column type: \"" + requested + "\"");
        }
        String sqliteForm = SqlTypeMapper.toSqlite(requested, SqlDialect.GENERIC);
        return isMysql() ? SqlTypeMapper.fromSqlite(sqliteForm, SqlDialect.MYSQL) : sqliteForm;
    }

    private String buildCsvCreateTableSql(String tableName, List<String> headers, List<String> types) {
        List<String> definitions = new ArrayList<>();
        boolean hasId = headers.stream().anyMatch(h -> h.equalsIgnoreCase("id"));

        // Row editing and deletion address a row by its id, so a CSV without one gets a key of
        // its own rather than being read-only once it is imported.
        if (!hasId) {
            definitions.add(quote("id") + " " + (isMysql()
                    ? Constants.Ddl.MYSQL_AUTO_INCREMENT_PK
                    : Constants.Ddl.SQLITE_AUTO_INCREMENT_PK));
        }

        for (int i = 0; i < headers.size(); i++) {
            String header = headers.get(i);
            String type = header.equalsIgnoreCase("id")
                    ? (isMysql() ? "INT AUTO_INCREMENT PRIMARY KEY" : "INTEGER PRIMARY KEY")
                    : types.get(i);
            definitions.add(quote(header) + " " + type);
        }

        return String.format(Constants.Tables.CREATE_TABLE_IF_NOT_EXISTS,
                quote(tableName), String.join(", ", definitions));
    }

    /**
     * Loads the rows in one batch.
     *
     * <p>An empty cell is written as NULL rather than as an empty string: on a column the user
     * has just declared to be a number or a date, {@code ''} is neither missing nor valid.
     */
    private int insertCsvRows(String tableName, CsvReader.CsvTable csv) {
        List<String> headers = csv.headers();
        String columnList = headers.stream().map(this::quote).collect(Collectors.joining(", "));
        String placeholders = headers.stream().map(h -> "?").collect(Collectors.joining(", "));
        String sql = String.format(Constants.Rows.INSERT, quote(tableName), columnList, placeholders);

        List<Object[]> batch = new ArrayList<>(csv.rows().size());
        for (List<String> row : csv.rows()) {
            Object[] args = new Object[headers.size()];
            for (int i = 0; i < headers.size(); i++) {
                String value = csv.valueAt(row, i);
                args[i] = value == null || value.isEmpty() ? null : value;
            }
            batch.add(args);
        }

        int[] results = jdbc().batchUpdate(sql, batch);
        return results.length;
    }
}
