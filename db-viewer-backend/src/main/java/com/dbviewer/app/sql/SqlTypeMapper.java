package com.dbviewer.app.sql;

import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Translates column types between engines.
 *
 * <p>Two directions, and they are not symmetrical:
 *
 * <ul>
 *   <li><b>In</b> ({@link #toSqlite}) a vendor type has to become something SQLite will accept.
 *       SQLite is forgiving — it keeps the declared type as written and applies type affinity —
 *       but not infinitely so: {@code NVARCHAR(MAX)} and {@code INTEGER[]} are parse errors, and
 *       a {@code SERIAL} is a whole sequence rather than a type. The mapping is lossy on purpose
 *       and the original spelling is never needed again, because the workspace database is the
 *       new source of truth.</li>
 *   <li><b>Out</b> ({@link #fromSqlite}) a stored type has to become the spelling the target
 *       engine expects. This is where the difference between {@code AUTO_INCREMENT},
 *       {@code SERIAL}, {@code IDENTITY(1,1)} and {@code AUTOINCREMENT} lives, and getting it
 *       wrong produces a script that looks right and will not run.</li>
 * </ul>
 */
public final class SqlTypeMapper {

    /** Splits {@code VARCHAR(64)} or {@code DECIMAL(10, 2)} into a base name and its arguments. */
    private static final Pattern PARAMETERISED = Pattern.compile(
            "^\\s*([A-Za-z_][A-Za-z0-9_ ]*?)\\s*(?:\\(\\s*([^)]*)\\s*\\))?\\s*$");

    private SqlTypeMapper() {
    }

    /* ── Incoming: vendor type -> something SQLite accepts ──────────────────── */

    /**
     * Rewrites a declared type so SQLite can store it.
     *
     * @param declared the type exactly as the source script wrote it
     * @param source   the engine the script was written for, used only where the same spelling
     *                 means different things (SQL Server's {@code BIT} is a boolean; MySQL's is
     *                 a bit-field)
     */
    public static String toSqlite(String declared, SqlDialect source) {
        if (declared == null || declared.isBlank()) {
            return "TEXT";
        }

        String type = declared.trim();

        // Postgres array types, in both spellings. SQLite has no array, so the value lands as text.
        if (type.endsWith("[]") || type.startsWith("_")) {
            return "TEXT";
        }

        Matcher m = PARAMETERISED.matcher(type);
        if (!m.matches()) {
            // Something with an unexpected shape (a user-defined type, an enum). TEXT stores it.
            return "TEXT";
        }

        String base = m.group(1).trim().replaceAll("\\s+", " ").toUpperCase(Locale.ROOT);
        String args = m.group(2) == null ? null : m.group(2).trim();

        // MAX is a SQL Server length that has no numeric equivalent anywhere else.
        if (args != null && args.equalsIgnoreCase("MAX")) {
            args = null;
            base = base.startsWith("N") || base.contains("CHAR") ? "TEXT" : base;
        }

        String mapped = switch (base) {
            // Auto-increment integers. The sequence itself is handled by the translator; here
            // they are just integers.
            case "SERIAL", "BIGSERIAL", "SMALLSERIAL", "SERIAL4", "SERIAL8" -> "INTEGER";

            // Integers.
            case "INT", "INTEGER", "INT4", "INT8", "INT2", "BIGINT", "SMALLINT", "TINYINT",
                 "MEDIUMINT", "YEAR" -> "INTEGER";

            // Booleans. SQLite has no boolean; BOOLEAN has NUMERIC affinity and reads back as 0/1.
            case "BOOL", "BOOLEAN" -> "BOOLEAN";
            case "BIT" -> source == SqlDialect.SQLSERVER ? "BOOLEAN" : "INTEGER";

            // Exact numerics keep their precision, which SQLite preserves in the declared type
            // even though it stores them as REAL.
            case "DECIMAL", "NUMERIC", "MONEY", "SMALLMONEY", "DEC", "FIXED" -> "DECIMAL";

            // Approximate numerics.
            case "FLOAT", "REAL", "DOUBLE", "DOUBLE PRECISION", "FLOAT4", "FLOAT8" -> "REAL";

            // Character data.
            case "VARCHAR", "NVARCHAR", "CHARACTER VARYING", "VARCHAR2", "NVARCHAR2" -> "VARCHAR";
            case "CHAR", "NCHAR", "CHARACTER", "BPCHAR" -> "CHAR";
            case "TEXT", "NTEXT", "LONGTEXT", "MEDIUMTEXT", "TINYTEXT", "CLOB", "XML",
                 "JSON", "JSONB", "UUID", "UNIQUEIDENTIFIER", "TSVECTOR", "CITEXT",
                 "INET", "CIDR", "MACADDR", "ENUM", "SET" -> "TEXT";

            // Dates and times. SQLite stores them as text; keeping the declared name means an
            // export can put the right type back.
            case "DATE" -> "DATE";
            case "TIME", "TIMETZ", "TIME WITHOUT TIME ZONE", "TIME WITH TIME ZONE" -> "TIME";
            case "DATETIME", "DATETIME2", "SMALLDATETIME", "DATETIMEOFFSET" -> "DATETIME";
            case "TIMESTAMP", "TIMESTAMPTZ", "TIMESTAMP WITHOUT TIME ZONE",
                 "TIMESTAMP WITH TIME ZONE" -> "TIMESTAMP";

            // Binary.
            case "BLOB", "BYTEA", "VARBINARY", "BINARY", "IMAGE", "LONGBLOB", "MEDIUMBLOB",
                 "TINYBLOB", "ROWVERSION", "TIMESTAMP_BINARY" -> "BLOB";

            default -> null;
        };

        if (mapped == null) {
            // Unknown to us, but SQLite accepts any word as a type name and applies affinity by
            // substring, so passing it through loses less than forcing it to TEXT would.
            return args == null || args.isEmpty() ? base : base + "(" + args + ")";
        }

        // Lengths and precisions are only meaningful on the types that take them.
        boolean keepsArgs = switch (mapped) {
            case "VARCHAR", "CHAR", "DECIMAL" -> true;
            default -> false;
        };
        if (keepsArgs && args != null && !args.isEmpty() && args.matches("\\d+(\\s*,\\s*\\d+)?")) {
            return mapped + "(" + args.replaceAll("\\s+", "") + ")";
        }
        // A VARCHAR with no usable length would be invalid on MySQL if it ever went back out.
        return mapped.equals("VARCHAR") ? "VARCHAR(255)" : mapped;
    }

    /* ── Outgoing: stored type -> the target engine's spelling ──────────────── */

    /**
     * Renders a stored column type in the target engine's own vocabulary.
     *
     * @param stored the type as the workspace database reports it
     * @param target the engine the export is aimed at
     */
    public static String fromSqlite(String stored, SqlDialect target) {
        if (stored == null || stored.isBlank()) {
            return target == SqlDialect.SQLSERVER ? "NVARCHAR(255)" : "TEXT";
        }

        Matcher m = PARAMETERISED.matcher(stored.trim());
        String base = m.matches()
                ? m.group(1).trim().replaceAll("\\s+", " ").toUpperCase(Locale.ROOT)
                : stored.trim().toUpperCase(Locale.ROOT);
        String args = m.matches() && m.group(2) != null ? m.group(2).replaceAll("\\s+", "") : null;

        return switch (target) {
            case POSTGRES -> postgresType(base, args);
            case SQLSERVER -> sqlServerType(base, args);
            case MYSQL, MARIADB -> mysqlType(base, args);
            case SQLITE -> sqliteType(base, args);
            case GENERIC -> genericType(base, args);
        };
    }

    private static String postgresType(String base, String args) {
        return switch (base) {
            case "INTEGER", "INT", "TINYINT", "SMALLINT", "MEDIUMINT" -> "INTEGER";
            case "BIGINT" -> "BIGINT";
            case "BOOLEAN", "BOOL", "BIT" -> "BOOLEAN";
            case "REAL", "FLOAT", "DOUBLE" -> "DOUBLE PRECISION";
            case "DECIMAL", "NUMERIC" -> args == null ? "NUMERIC" : "NUMERIC(" + args + ")";
            case "VARCHAR", "NVARCHAR" -> args == null ? "VARCHAR(255)" : "VARCHAR(" + args + ")";
            case "CHAR", "NCHAR" -> args == null ? "CHAR(1)" : "CHAR(" + args + ")";
            case "DATETIME", "TIMESTAMP" -> "TIMESTAMP";
            case "DATE" -> "DATE";
            case "TIME" -> "TIME";
            case "BLOB" -> "BYTEA";
            default -> "TEXT";
        };
    }

    private static String sqlServerType(String base, String args) {
        return switch (base) {
            case "INTEGER", "INT", "MEDIUMINT" -> "INT";
            case "TINYINT" -> "TINYINT";
            case "SMALLINT" -> "SMALLINT";
            case "BIGINT" -> "BIGINT";
            case "BOOLEAN", "BOOL", "BIT" -> "BIT";
            case "REAL", "FLOAT", "DOUBLE" -> "FLOAT";
            case "DECIMAL", "NUMERIC" -> args == null ? "DECIMAL(18, 2)" : "DECIMAL(" + args + ")";
            case "VARCHAR" -> args == null ? "NVARCHAR(255)" : "NVARCHAR(" + args + ")";
            case "CHAR", "NCHAR" -> args == null ? "NCHAR(1)" : "NCHAR(" + args + ")";
            case "DATETIME", "TIMESTAMP" -> "DATETIME2";
            case "DATE" -> "DATE";
            case "TIME" -> "TIME";
            case "BLOB" -> "VARBINARY(MAX)";
            default -> "NVARCHAR(MAX)";
        };
    }

    private static String mysqlType(String base, String args) {
        return switch (base) {
            case "INTEGER", "INT" -> "INT";
            case "TINYINT" -> "TINYINT";
            case "SMALLINT" -> "SMALLINT";
            case "MEDIUMINT" -> "MEDIUMINT";
            case "BIGINT" -> "BIGINT";
            case "BOOLEAN", "BOOL", "BIT" -> "TINYINT(1)";
            case "REAL", "FLOAT" -> "FLOAT";
            case "DOUBLE" -> "DOUBLE";
            case "DECIMAL", "NUMERIC" -> args == null ? "DECIMAL(10, 2)" : "DECIMAL(" + args + ")";
            case "VARCHAR", "NVARCHAR" -> args == null ? "VARCHAR(255)" : "VARCHAR(" + args + ")";
            case "CHAR", "NCHAR" -> args == null ? "CHAR(1)" : "CHAR(" + args + ")";
            case "DATETIME", "TIMESTAMP" -> "DATETIME";
            case "DATE" -> "DATE";
            case "TIME" -> "TIME";
            case "BLOB" -> "BLOB";
            default -> "TEXT";
        };
    }

    private static String sqliteType(String base, String args) {
        return switch (base) {
            case "INTEGER", "INT", "TINYINT", "SMALLINT", "MEDIUMINT", "BIGINT" -> "INTEGER";
            case "BOOLEAN", "BOOL", "BIT" -> "BOOLEAN";
            case "REAL", "FLOAT", "DOUBLE" -> "REAL";
            case "DECIMAL", "NUMERIC" -> args == null ? "DECIMAL" : "DECIMAL(" + args + ")";
            case "VARCHAR", "NVARCHAR" -> args == null ? "VARCHAR(255)" : "VARCHAR(" + args + ")";
            case "CHAR", "NCHAR" -> args == null ? "CHAR(1)" : "CHAR(" + args + ")";
            case "BLOB" -> "BLOB";
            case "DATE", "TIME", "DATETIME", "TIMESTAMP" -> base;
            default -> "TEXT";
        };
    }

    /** ANSI spellings only, so the script runs anywhere. */
    private static String genericType(String base, String args) {
        return switch (base) {
            case "INTEGER", "INT", "TINYINT", "SMALLINT", "MEDIUMINT" -> "INTEGER";
            case "BIGINT" -> "BIGINT";
            case "BOOLEAN", "BOOL", "BIT" -> "BOOLEAN";
            case "REAL", "FLOAT" -> "REAL";
            case "DOUBLE" -> "DOUBLE PRECISION";
            case "DECIMAL", "NUMERIC" -> args == null ? "DECIMAL" : "DECIMAL(" + args + ")";
            case "VARCHAR", "NVARCHAR" -> args == null ? "VARCHAR(255)" : "VARCHAR(" + args + ")";
            case "CHAR", "NCHAR" -> args == null ? "CHAR(1)" : "CHAR(" + args + ")";
            case "DATE", "TIME", "TIMESTAMP" -> base;
            case "DATETIME" -> "TIMESTAMP";
            case "BLOB" -> "BLOB";
            default -> "VARCHAR(255)";
        };
    }

    /**
     * How the target engine declares an auto-incrementing integer primary key.
     *
     * <p>This is the single most dialect-specific line in any schema, and the reason a diagram
     * exported as "SQL" without a target is only ever nearly right.
     *
     * @return the full column definition tail, following the quoted column name
     */
    public static String autoIncrementPrimaryKey(SqlDialect target) {
        return switch (target) {
            case POSTGRES -> "SERIAL PRIMARY KEY";
            case SQLSERVER -> "INT IDENTITY(1,1) PRIMARY KEY";
            case MYSQL, MARIADB -> "INT AUTO_INCREMENT PRIMARY KEY";
            case SQLITE -> "INTEGER PRIMARY KEY AUTOINCREMENT";
            case GENERIC -> "INTEGER PRIMARY KEY";
        };
    }
}
