package com.dbviewer.service.impl;

import com.dbviewer.config.DatabaseConfig;
import com.dbviewer.dto.*;
import com.dbviewer.service.DatabaseService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

@Slf4j
@Service
@RequiredArgsConstructor
public class DatabaseServiceImpl implements DatabaseService {

    private final JdbcTemplate jdbcTemplate;
    private final DatabaseConfig databaseConfig;

    /**
     * Handles CSV and SQL file uploads. Mirrors HandleFileUpload in Go.
     */
    @Override
    public Map<String, Object> handleFileUpload(MultipartFile file) throws Exception {
        String filename = file.getOriginalFilename() != null
                ? file.getOriginalFilename().toLowerCase() : "";

        if (filename.endsWith(".sql")) {
            return handleSqlUpload(file);
        } else if (filename.endsWith(".csv")) {
            return handleCsvUpload(file);
        } else {
            throw new IllegalArgumentException("Only .csv and .sql files are supported");
        }
    }

    private Map<String, Object> handleSqlUpload(MultipartFile file) throws Exception {
        String content = new String(file.getBytes(), StandardCharsets.UTF_8);
        if (isSqlite()) {
            content = cleanSqlForSQLite(content);
        }
        // Split on semicolons and execute each statement individually
        // (JdbcTemplate.execute does not support multi-statement strings natively)
        String[] statements = content.split(";");
        for (String stmt : statements) {
            String trimmed = stmt.trim();
            if (!trimmed.isEmpty() && !trimmed.startsWith("--")) {
                try {
                    jdbcTemplate.execute(trimmed);
                } catch (Exception e) {
                    log.warn("Skipping statement ({}): {}", e.getMessage(), trimmed.substring(0, Math.min(80, trimmed.length())));
                }
            }
        }
        return Map.of("message", "SQL executed successfully", "type", "sql");
    }

    private Map<String, Object> handleCsvUpload(MultipartFile file) throws Exception {
        String originalName = file.getOriginalFilename() != null ? file.getOriginalFilename() : "upload.csv";
        String tableName = originalName
                .replaceAll("(?i)\\.csv$", "")
                .replaceAll("[\\s\\-]", "_");

        List<String[]> records = parseCsv(file);
        if (records.isEmpty()) {
            throw new IllegalArgumentException("CSV is empty");
        }

        String[] rawHeaders = records.get(0);
        String[] headers = Arrays.stream(rawHeaders)
                .map(h -> h.trim()
                        .replaceAll("\\s+", "_")
                        .replaceAll("/", "_")
                        .replaceAll("\\.", ""))
                .toArray(String[]::new);

        List<String[]> dataRows = records.size() > 1 ? records.subList(1, records.size()) : List.of();

        String[] columnTypes = guessColumnTypes(headers, dataRows);
        String createSql = buildSmartCreateTableSql(tableName, headers, columnTypes);
        jdbcTemplate.execute(createSql);

        if (!dataRows.isEmpty()) {
            insertData(tableName, headers, dataRows);
        }

        return Map.of(
                "message", "CSV uploaded successfully",
                "tableName", tableName,
                "columns", headers,
                "type", "csv"
        );
    }

    private List<String[]> parseCsv(MultipartFile file) throws Exception {
        List<String[]> rows = new ArrayList<>();
        try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(file.getInputStream(), StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                // Basic CSV split (handles quoted fields with commas)
                rows.add(parseCsvLine(line));
            }
        }
        return rows;
    }

    private String[] parseCsvLine(String line) {
        List<String> fields = new ArrayList<>();
        boolean inQuotes = false;
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < line.length(); i++) {
            char c = line.charAt(i);
            if (c == '"') {
                inQuotes = !inQuotes;
            } else if (c == ',' && !inQuotes) {
                fields.add(sb.toString());
                sb.setLength(0);
            } else {
                sb.append(c);
            }
        }
        fields.add(sb.toString());
        return fields.toArray(new String[0]);
    }

    // ─── Query Execution ──────────────────────────────────────────────────────────

    /**
     * Executes raw SQL. Mirrors HandleQuery.
     */
    @Override
    public List<Map<String, Object>> executeQuery(String sql) {
        String trimmed = sql.trim().toUpperCase();
        if (trimmed.startsWith("SELECT") || trimmed.startsWith("PRAGMA") || trimmed.startsWith("SHOW")) {
            return jdbcTemplate.queryForList(sql);
        } else {
            // DML / DDL: execute and return affected rows
            int affected = jdbcTemplate.update(sql);
            return List.of(Map.of("affected_rows", affected));
        }
    }

    // ─── DB Info ─────────────────────────────────────────────────────────────────

    /**
     * Gets all table schemas and relationships. Mirrors HandleGetDBInfo.
     */
    @Override
    public Map<String, Object> getDbInfo() {
        List<String> tableNames = getTableNames();
        List<TableInfo> tables = new ArrayList<>();
        List<Relationship> relationships = new ArrayList<>();

        for (String tbl : tableNames) {
            List<ColumnInfo> columns = getColumnsForTable(tbl);
            List<Relationship> fks = getForeignKeys(tbl);
            relationships.addAll(fks);

            List<Map<String, Object>> rows = safeQueryRows("SELECT * FROM \"" + tbl + "\" LIMIT 100");
            tables.add(TableInfo.builder().name(tbl).columns(columns).rows(rows).build());
        }

        return Map.of("tables", tables, "relationships", relationships);
    }

    private List<String> getTableNames() {
        if (isMysql()) {
            return jdbcTemplate.queryForList("SHOW TABLES", String.class);
        }
        return jdbcTemplate.queryForList(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
                String.class);
    }

    private List<ColumnInfo> getColumnsForTable(String tableName) {
        List<ColumnInfo> columns = new ArrayList<>();
        if (isMysql()) {
            jdbcTemplate.query("DESCRIBE " + tableName, rs -> {
                columns.add(ColumnInfo.builder()
                        .name(rs.getString("Field"))
                        .type(rs.getString("Type"))
                        .build());
            });
        } else {
            jdbcTemplate.query("PRAGMA table_info(\"" + tableName + "\")", rs -> {
                String type = rs.getString("type");
                if (type == null || type.isEmpty()) type = "TEXT";
                columns.add(ColumnInfo.builder()
                        .name(rs.getString("name"))
                        .type(type)
                        .build());
            });
        }
        return columns;
    }

    private List<Relationship> getForeignKeys(String tableName) {
        List<Relationship> rels = new ArrayList<>();
        if (isMysql()) {
            String sql = """
                    SELECT COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
                    FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
                    WHERE TABLE_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL
                    """;
            jdbcTemplate.query(sql, rs -> {
                rels.add(Relationship.builder()
                        .sourceTable(tableName)
                        .sourceColumn(rs.getString("COLUMN_NAME"))
                        .targetTable(rs.getString("REFERENCED_TABLE_NAME"))
                        .targetColumn(rs.getString("REFERENCED_COLUMN_NAME"))
                        .build());
            }, tableName);
        } else {
            jdbcTemplate.query("PRAGMA foreign_key_list(\"" + tableName + "\")", rs -> {
                rels.add(Relationship.builder()
                        .sourceTable(tableName)
                        .sourceColumn(rs.getString("from"))
                        .targetTable(rs.getString("table"))
                        .targetColumn(rs.getString("to"))
                        .build());
            });
        }
        return rels;
    }

    // ─── Table Data ───────────────────────────────────────────────────────────────

    /**
     * Gets columns and rows for a specific table. Mirrors HandleGetTableData.
     */
    @Override
    public Map<String, Object> getTableData(String tableName) {
        List<ColumnInfo> columns = getColumnsForTable(tableName);
        List<Map<String, Object>> rows = safeQueryRows("SELECT * FROM \"" + tableName + "\" LIMIT 100");
        return Map.of("columns", columns, "rows", rows);
    }

    // ─── Add Column ───────────────────────────────────────────────────────────────

    /**
     * Adds a column to an existing table. Mirrors HandleAddColumn.
     */
    @Override
    public void addColumn(AddColumnRequest req) {
        String tableName = req.getTableName().replace(" ", "_");
        String colName = req.getColumnName().replace(" ", "_");
        String baseType = req.getColumnType().toUpperCase();

        String typeDef = resolveTypeDef(baseType, req.getLength(), req.isNotNull());
        String sql = String.format("ALTER TABLE \"%s\" ADD COLUMN \"%s\" %s", tableName, colName, typeDef);
        jdbcTemplate.execute(sql);
    }

    private String resolveTypeDef(String baseType, int length, boolean notNull) {
        String typeDef;
        switch (baseType) {
            case "VARCHAR" -> {
                int len = length == 0 ? 128 : length;
                typeDef = "VARCHAR(" + len + ")";
            }
            case "INT" -> typeDef = isSqlite() ? "INTEGER" : "INT";
            default -> typeDef = baseType;
        }

        if (notNull) {
            typeDef += " NOT NULL";
            typeDef += switch (baseType) {
                case "VARCHAR", "TEXT" -> " DEFAULT ''";
                case "INT", "INTEGER", "DECIMAL" -> " DEFAULT 0";
                case "BOOLEAN" -> " DEFAULT 0";
                default -> baseType.contains("DATE") || baseType.contains("TIME") ? " DEFAULT '1970-01-01'" : "";
            };
        }
        return typeDef;
    }

    // ─── Update Cell ─────────────────────────────────────────────────────────────

    /**
     * Updates a single cell by record ID. Mirrors HandleUpdateCell.
     */
    @Override
    public void updateCell(UpdateCellRequest req) {
        String tableName = req.getTableName().replace(" ", "_");
        String colName = req.getColumnName().replace(" ", "_");
        String sql = String.format("UPDATE \"%s\" SET \"%s\" = ? WHERE id = ?", tableName, colName);
        jdbcTemplate.update(sql, req.getNewValue(), req.getRecordId());
    }

    // ─── Insert Row ───────────────────────────────────────────────────────────────

    /**
     * Inserts a row (empty or with data). Mirrors HandleInsertRow.
     */
    @Override
    public Map<String, Object> insertRow(InsertRowRequest req) {
        String tableName = req.getTableName();
        Map<String, Object> data = req.getData() != null ? req.getData() : new HashMap<>();

        // Strip id and empty values
        Map<String, Object> cleanData = data.entrySet().stream()
                .filter(e -> !e.getKey().equalsIgnoreCase("id"))
                .filter(e -> e.getValue() != null)
                .filter(e -> !(e.getValue() instanceof String s && s.trim().isEmpty()))
                .collect(Collectors.toMap(Map.Entry::getKey, Map.Entry::getValue));

        String q = isMysql() ? "`" : "\"";

        if (cleanData.isEmpty()) {
            String sql = isMysql()
                    ? String.format("INSERT INTO %s%s%s () VALUES ()", q, tableName, q)
                    : String.format("INSERT INTO %s%s%s DEFAULT VALUES", q, tableName, q);
            jdbcTemplate.execute(sql);
            return Map.of("message", "Row created");
        }

        List<String> cols = new ArrayList<>(cleanData.keySet());
        List<Object> vals = cols.stream().map(cleanData::get).collect(Collectors.toList());
        String colsSql = cols.stream().map(c -> q + c + q).collect(Collectors.joining(", "));
        String placeholders = cols.stream().map(c -> "?").collect(Collectors.joining(", "));

        String sql = String.format("INSERT INTO %s%s%s (%s) VALUES (%s)",
                q, tableName, q, colsSql, placeholders);
        jdbcTemplate.update(sql, vals.toArray());
        return Map.of("message", "Row added successfully");
    }

    // ─── Delete Row ───────────────────────────────────────────────────────────────

    /**
     * Deletes a row by id. Mirrors HandleDeleteRow.
     */
    @Override
    public void deleteRow(DeleteRowRequest req) {
        String tableName = req.getTableName().replace(" ", "_");
        jdbcTemplate.update("DELETE FROM \"" + tableName + "\" WHERE id = ?", req.getRecordId());
    }

    // ─── Clear Database ───────────────────────────────────────────────────────────

    /**
     * Drops all tables. Mirrors HandleClearDatabase.
     */
    @Override
    public void clearDatabase() {
        List<String> tables = getTableNames();
        if (isMysql()) {
            jdbcTemplate.execute("SET FOREIGN_KEY_CHECKS = 0");
            for (String t : tables) {
                jdbcTemplate.execute("DROP TABLE IF EXISTS " + t);
            }
            jdbcTemplate.execute("SET FOREIGN_KEY_CHECKS = 1");
        } else {
            jdbcTemplate.execute("PRAGMA foreign_keys = OFF");
            for (String t : tables) {
                jdbcTemplate.execute("DROP TABLE IF EXISTS \"" + t + "\"");
            }
            jdbcTemplate.execute("PRAGMA foreign_keys = ON");
        }
    }

    // ─── Create Table ─────────────────────────────────────────────────────────────

    /**
     * Creates a new table from a definition. Mirrors HandleCreateTable.
     */
    public void createTable(CreateTableRequest req) {
        String tableName = req.getTableName().replace(" ", "_");
        String q = isMysql() ? "`" : "\"";

        List<String> colDefs = new ArrayList<>();
        List<String> fkDefs = new ArrayList<>();

        for (var col : req.getColumns()) {
            String colName = col.getName().replace(" ", "_");
            String baseType = col.getType().toUpperCase();
            String typeDef = buildColTypeDef(baseType, col.getLength(), col.isPk(), col.isNotNull());

            colDefs.add(String.format("%s%s%s %s", q, colName, q, typeDef));

            if (col.getRefTable() != null && !col.getRefTable().isEmpty()
                    && col.getRefCol() != null && !col.getRefCol().isEmpty()) {
                fkDefs.add(String.format(
                        "FOREIGN KEY (%s%s%s) REFERENCES %s%s%s(%s%s%s) ON DELETE CASCADE",
                        q, colName, q,
                        q, col.getRefTable(), q,
                        q, col.getRefCol(), q));
            }
        }

        List<String> allDefs = new ArrayList<>(colDefs);
        allDefs.addAll(fkDefs);
        String sql = String.format("CREATE TABLE %s%s%s (%s)", q, tableName, q,
                String.join(", ", allDefs));
        jdbcTemplate.execute(sql);
    }

    private String buildColTypeDef(String baseType, int length, boolean isPk, boolean notNull) {
        String typeDef = baseType.equals("VARCHAR")
                ? "VARCHAR(" + (length == 0 ? 128 : length) + ")"
                : (baseType.equals("INT") && isSqlite() ? "INTEGER" : baseType);

        if (isPk) {
            typeDef += isSqlite() ? " PRIMARY KEY AUTOINCREMENT" : " AUTO_INCREMENT PRIMARY KEY";
        } else {
            if (notNull) typeDef += " NOT NULL";
            if (baseType.equals("INT") || baseType.equals("INTEGER")) typeDef += " DEFAULT 0";
            if (baseType.equals("BOOLEAN")) typeDef += " DEFAULT 0";
        }
        return typeDef;
    }

    // ─── Export CSV ───────────────────────────────────────────────────────────────

    /**
     * Gets all rows from a table for CSV export. Mirrors HandleExportCSV.
     */
    public List<Map<String, Object>> getTableRows(String tableName) {
        return jdbcTemplate.queryForList("SELECT * FROM \"" + tableName + "\"");
    }

    // ─── Export SQL ───────────────────────────────────────────────────────────────

    /**
     * Generates a full SQL dump. Mirrors HandleExportDatabaseSQL.
     */
    public String exportDatabaseSql() {
        StringBuilder sb = new StringBuilder();
        sb.append("-- SQL Dump generated by SQL Visualizer\n");

        List<String> tables = getTableNames();
        String q = isMysql() ? "`" : "\"";

        for (String table : tables) {
            String createSql = getCreateTableSql(table);
            if (createSql != null && !createSql.isEmpty()) {
                sb.append(String.format("\n-- Structure for table `%s`\n", table));
                sb.append(String.format("DROP TABLE IF EXISTS `%s`;\n", table));
                sb.append(createSql).append(";\n\n");
            }

            sb.append(String.format("-- Data for table `%s`\n", table));
            List<Map<String, Object>> rows = safeQueryRows("SELECT * FROM \"" + table + "\"");
            List<String> colNames = rows.isEmpty() ? List.of()
                    : new ArrayList<>(rows.get(0).keySet());

            for (Map<String, Object> row : rows) {
                List<String> vals = colNames.stream()
                        .map(c -> {
                            Object v = row.get(c);
                            if (v == null) return "NULL";
                            return "'" + v.toString().replace("'", "''") + "'";
                        }).collect(Collectors.toList());
                sb.append(String.format("INSERT INTO %s%s%s (%s) VALUES (%s);\n",
                        q, table, q,
                        String.join(", ", colNames),
                        String.join(", ", vals)));
            }
            sb.append("\n");
        }
        return sb.toString();
    }

    private String getCreateTableSql(String table) {
        try {
            if (isMysql()) {
                return jdbcTemplate.queryForObject("SHOW CREATE TABLE " + table,
                        (rs, n) -> rs.getString(2));
            } else {
                return jdbcTemplate.queryForObject(
                        "SELECT sql FROM sqlite_master WHERE type='table' AND name = ?",
                        String.class, table);
            }
        } catch (Exception e) {
            return null;
        }
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────────

    private void insertData(String tableName, String[] headers, List<String[]> rows) {
        String q = isMysql() ? "`" : "\"";
        String quotedHeaders = Arrays.stream(headers)
                .map(h -> q + h + q)
                .collect(Collectors.joining(", "));
        String placeholders = Arrays.stream(headers).map(h -> "?").collect(Collectors.joining(", "));
        String sql = String.format("INSERT INTO %s%s%s (%s) VALUES (%s)",
                q, tableName, q, quotedHeaders, placeholders);

        for (String[] row : rows) {
            Object[] args = new Object[row.length];
            for (int i = 0; i < row.length; i++) args[i] = row[i];
            jdbcTemplate.update(sql, args);
        }
    }

    private String[] guessColumnTypes(String[] headers, List<String[]> rows) {
        String[] types = new String[headers.length];
        for (int i = 0; i < headers.length; i++) {
            List<String> colValues = new ArrayList<>();
            for (String[] row : rows) {
                if (i < row.length) colValues.add(row[i]);
            }
            types[i] = inferColumnType(colValues);
        }
        return types;
    }

    private String inferColumnType(List<String> values) {
        if (values.isEmpty()) return "VARCHAR";
        Pattern intPat = Pattern.compile("^-?\\d+$");
        Pattern floatPat = Pattern.compile("^-?\\d*\\.\\d+$");
        boolean isInt = true, isFloat = true, isBool = true, hasData = false;

        for (String v : values) {
            if (v == null || v.isEmpty()) continue;
            hasData = true;
            if (!intPat.matcher(v).matches()) isInt = false;
            if (!floatPat.matcher(v).matches() && !intPat.matcher(v).matches()) isFloat = false;
            String lv = v.toLowerCase();
            if (!List.of("true", "false", "0", "1", "yes", "no").contains(lv)) isBool = false;
        }

        if (!hasData) return "VARCHAR";
        if (isBool) return "BOOL";
        if (isInt) return "INT";
        if (isFloat) return "DECIMAL";
        return "VARCHAR";
    }

    private String buildSmartCreateTableSql(String tableName, String[] headers, String[] types) {
        String q = isMysql() ? "`" : "\"";
        List<String> cols = new ArrayList<>();

        boolean hasId = Arrays.stream(headers).anyMatch(h -> h.equalsIgnoreCase("id"));

        if (!hasId) {
            cols.add(isMysql()
                    ? q + "id" + q + " INT AUTO_INCREMENT PRIMARY KEY"
                    : q + "id" + q + " INTEGER PRIMARY KEY AUTOINCREMENT");
        }

        for (int i = 0; i < headers.length; i++) {
            String header = headers[i];
            String colType = types[i];

            if (header.equalsIgnoreCase("id")) {
                colType = isSqlite() ? "INTEGER PRIMARY KEY" : "INT AUTO_INCREMENT PRIMARY KEY";
            } else if (isMysql() && colType.equals("TEXT")) {
                colType = "VARCHAR(255)";
            }
            cols.add(String.format("%s%s%s %s", q, header, q, colType));
        }

        return String.format("CREATE TABLE IF NOT EXISTS %s%s%s (%s);",
                q, tableName, q, String.join(", ", cols));
    }

    private String cleanSqlForSQLite(String sqlContent) {
        String[] lines = sqlContent.split("\n");
        List<String> clean = new ArrayList<>();
        for (String line : lines) {
            String trimmed = line.trim();
            if (trimmed.startsWith("SET") || trimmed.startsWith("LOCK TABLES")
                    || trimmed.startsWith("UNLOCK TABLES") || trimmed.startsWith("/*!")
                    || trimmed.startsWith("BEGIN") || trimmed.startsWith("COMMIT")
                    || trimmed.startsWith("START") || trimmed.startsWith("USE")) {
                continue;
            }
            clean.add(line);
        }
        String result = String.join("\n", clean);
        result = result.replaceAll("\\) ENGINE=[^;]+;", ");");
        result = result.replace("AUTO_INCREMENT", "");
        return result;
    }

    private List<Map<String, Object>> safeQueryRows(String sql) {
        try {
            return jdbcTemplate.queryForList(sql);
        } catch (Exception e) {
            log.warn("Failed to query rows: {}", e.getMessage());
            return List.of();
        }
    }

    public boolean isSqlite() {
        String driver = databaseConfig.getCurrentDriver();
        return "sqlite".equalsIgnoreCase(driver) || "sqlite3".equalsIgnoreCase(driver);
    }

    public boolean isMysql() {
        return "mysql".equalsIgnoreCase(databaseConfig.getCurrentDriver());
    }
}
