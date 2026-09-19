package com.dbviewer.app.sql;

import java.util.Locale;

/**
 * The database engines this application can read a script from and write a script back out for.
 *
 * <p>Everything is <em>stored</em> in SQLite regardless — a workspace is one SQLite file — so a
 * dialect is only ever an input format (what the uploaded dump was written for) or an output
 * format (what the user wants an export to run against). The engine the app itself runs on is a
 * separate question, answered by {@code DatabaseConfig.getCurrentDriver()}.
 *
 * <p>{@link #GENERIC} is the honest answer when a script carries no vendor fingerprint at all:
 * plain ANSI DDL, which every engine accepts. It is never guessed at — detection falls back to
 * it rather than picking a vendor arbitrarily.
 */
public enum SqlDialect {

    MYSQL("mysql", "MySQL", "`"),
    MARIADB("mariadb", "MariaDB", "`"),
    POSTGRES("postgres", "PostgreSQL", "\""),
    SQLSERVER("sqlserver", "SQL Server", "["),
    SQLITE("sqlite", "SQLite", "\""),
    GENERIC("generic", "Standard SQL", "\"");

    private final String id;
    private final String label;
    private final String quoteOpen;

    SqlDialect(String id, String label, String quoteOpen) {
        this.id = id;
        this.label = label;
        this.quoteOpen = quoteOpen;
    }

    /** Stable identifier used on the wire and in query parameters. */
    public String id() {
        return id;
    }

    /** Human-readable name, shown in the UI. */
    public String label() {
        return label;
    }

    /** Wraps an identifier in this engine's quoting characters. */
    public String quote(String identifier) {
        return switch (this) {
            case SQLSERVER -> "[" + identifier + "]";
            case MYSQL, MARIADB -> "`" + identifier + "`";
            default -> "\"" + identifier + "\"";
        };
    }

    public String quoteOpen() {
        return quoteOpen;
    }

    /** True for the two engines that share MySQL's syntax almost entirely. */
    public boolean isMysqlFamily() {
        return this == MYSQL || this == MARIADB;
    }

    /**
     * Resolves an id (or label) sent by a client, falling back to the given default rather than
     * throwing: an unknown dialect on an export request should produce a portable script, not a
     * 400.
     */
    public static SqlDialect fromId(String raw, SqlDialect fallback) {
        if (raw == null || raw.isBlank()) {
            return fallback;
        }
        String needle = raw.trim().toLowerCase(Locale.ROOT).replace(" ", "");
        for (SqlDialect dialect : values()) {
            if (dialect.id.equals(needle) || dialect.label.toLowerCase(Locale.ROOT).replace(" ", "").equals(needle)) {
                return dialect;
            }
        }
        // Spellings people actually type.
        return switch (needle) {
            case "psql", "postgresql", "pg" -> POSTGRES;
            case "mssql", "tsql", "transact-sql", "azuresql" -> SQLSERVER;
            case "maria" -> MARIADB;
            default -> fallback;
        };
    }
}
