package com.dbviewer.app.sql;

import java.util.EnumMap;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Works out which engine a .sql file was written for.
 *
 * <p>Nobody labels a dump, so the dialect has to be read off the syntax itself. Each engine
 * leaves fingerprints an import can key on — {@code ENGINE=InnoDB} and backticks are MySQL,
 * {@code SERIAL} and {@code nextval(} are PostgreSQL, {@code IDENTITY(1,1)} and {@code GO}
 * batches are SQL Server — and the file is scored against all of them rather than matched
 * against the first one that hits, because a single marker can be coincidental (a table column
 * really can be called {@code identity}) while a dozen never are.
 *
 * <p>The whole point is that detection only ever <em>improves</em> an import. Every translation
 * rule is safe to apply to a script that did not need it, so a wrong guess degrades to the same
 * result the generic path would have produced, and a file with no fingerprints at all is
 * reported as {@link SqlDialect#GENERIC} instead of being forced into a vendor.
 */
public final class SqlDialectDetector {

    /** A marker, how much it is worth, and which engine it points at. */
    private record Marker(SqlDialect dialect, Pattern pattern, int weight) {
    }

    private static final Marker[] MARKERS = {
            // --- MySQL / MariaDB ---
            marker(SqlDialect.MYSQL, "ENGINE\\s*=\\s*(?:InnoDB|MyISAM|MEMORY|ARCHIVE)", 4),
            marker(SqlDialect.MYSQL, "AUTO_INCREMENT", 3),
            marker(SqlDialect.MYSQL, "DEFAULT\\s+CHARSET\\s*=", 3),
            marker(SqlDialect.MYSQL, "`[A-Za-z0-9_]+`", 2),
            marker(SqlDialect.MYSQL, "\\bUNSIGNED\\b", 2),
            marker(SqlDialect.MYSQL, "\\b(?:TINYINT|MEDIUMINT|LONGTEXT|MEDIUMTEXT|DATETIME)\\b", 1),
            marker(SqlDialect.MYSQL, "/\\*!\\d+", 3),
            marker(SqlDialect.MYSQL, "LOCK\\s+TABLES", 2),

            // --- MariaDB, which is MySQL plus its own markers ---
            marker(SqlDialect.MARIADB, "\\bMariaDB\\b", 6),
            marker(SqlDialect.MARIADB, "/\\*M!\\d+", 6),
            marker(SqlDialect.MARIADB, "PAGE_CHECKSUM\\s*=", 4),

            // --- PostgreSQL ---
            marker(SqlDialect.POSTGRES, "\\b(?:BIG|SMALL)?SERIAL\\b", 4),
            marker(SqlDialect.POSTGRES, "nextval\\s*\\(", 4),
            marker(SqlDialect.POSTGRES, "\\bOWNED\\s+BY\\b", 4),
            marker(SqlDialect.POSTGRES, "ALTER\\s+TABLE\\s+ONLY\\b", 4),
            marker(SqlDialect.POSTGRES, "COPY\\s+[^;]*FROM\\s+stdin", 5),
            marker(SqlDialect.POSTGRES, "SET\\s+search_path", 4),
            marker(SqlDialect.POSTGRES, "CREATE\\s+EXTENSION", 3),
            marker(SqlDialect.POSTGRES, "::(?:text|integer|character varying|bigint|jsonb?)", 3),
            marker(SqlDialect.POSTGRES, "\\b(?:JSONB|BYTEA|TSVECTOR|CHARACTER\\s+VARYING|DOUBLE\\s+PRECISION)\\b", 2),
            marker(SqlDialect.POSTGRES, "WITHOUT\\s+TIME\\s+ZONE", 3),
            marker(SqlDialect.POSTGRES, "\\bpg_catalog\\b", 4),

            // --- SQL Server ---
            marker(SqlDialect.SQLSERVER, "IDENTITY\\s*\\(\\s*\\d+\\s*,\\s*\\d+\\s*\\)", 5),
            marker(SqlDialect.SQLSERVER, "(?m)^\\s*GO\\s*$", 4),
            marker(SqlDialect.SQLSERVER, "\\[[A-Za-z0-9_ ]+\\]\\s*\\.\\s*\\[[A-Za-z0-9_ ]+\\]", 4),
            marker(SqlDialect.SQLSERVER, "\\bNVARCHAR\\s*\\(", 3),
            marker(SqlDialect.SQLSERVER, "\\b(?:DATETIME2|UNIQUEIDENTIFIER|NCHAR|NTEXT|SMALLMONEY|SYSNAME)\\b", 3),
            marker(SqlDialect.SQLSERVER, "SET\\s+(?:ANSI_NULLS|QUOTED_IDENTIFIER|IDENTITY_INSERT)", 4),
            marker(SqlDialect.SQLSERVER, "ON\\s+\\[PRIMARY\\]", 4),
            marker(SqlDialect.SQLSERVER, "\\bdbo\\s*\\.", 3),
            marker(SqlDialect.SQLSERVER, "\\bGETDATE\\s*\\(\\s*\\)", 3),

            // --- SQLite (usually our own export coming back in) ---
            marker(SqlDialect.SQLITE, "\\bAUTOINCREMENT\\b", 4),
            marker(SqlDialect.SQLITE, "\\bsqlite_(?:master|sequence)\\b", 5),
            marker(SqlDialect.SQLITE, "PRAGMA\\s+\\w+", 3),
    };

    private static Marker marker(SqlDialect dialect, String regex, int weight) {
        return new Marker(dialect, Pattern.compile(regex, Pattern.CASE_INSENSITIVE), weight);
    }

    /** Below this the fingerprints are too thin to call, and GENERIC is the truthful answer. */
    private static final int CONFIDENCE_FLOOR = 3;

    private SqlDialectDetector() {
    }

    /**
     * Best guess at the engine a script targets.
     *
     * @return the winning dialect, or {@link SqlDialect#GENERIC} when nothing scores
     */
    public static SqlDialect detect(String script) {
        return detectWithScores(script).dialect();
    }

    /** The guess plus the evidence behind it, so an import report can explain itself. */
    public record Detection(SqlDialect dialect, int score, Map<SqlDialect, Integer> scores) {
    }

    public static Detection detectWithScores(String script) {
        Map<SqlDialect, Integer> scores = new EnumMap<>(SqlDialect.class);
        if (script == null || script.isBlank()) {
            return new Detection(SqlDialect.GENERIC, 0, scores);
        }

        // A huge dump tells us everything we need in its first few hundred kilobytes, and the
        // regex sweep is linear in the length: cap it rather than scanning 200MB of INSERTs.
        String sample = script.length() > 400_000 ? script.substring(0, 400_000) : script;

        for (Marker m : MARKERS) {
            if (m.pattern().matcher(sample).find()) {
                scores.merge(m.dialect(), m.weight(), Integer::sum);
            }
        }

        // MariaDB is a MySQL superset: its own markers are decisive, but everything MySQL-shaped
        // in the file supports it too, so it inherits that score before the comparison.
        int mysql = scores.getOrDefault(SqlDialect.MYSQL, 0);
        if (scores.containsKey(SqlDialect.MARIADB)) {
            scores.merge(SqlDialect.MARIADB, mysql, Integer::sum);
        }

        SqlDialect best = SqlDialect.GENERIC;
        int bestScore = 0;
        for (Map.Entry<SqlDialect, Integer> entry : scores.entrySet()) {
            if (entry.getValue() > bestScore) {
                best = entry.getKey();
                bestScore = entry.getValue();
            }
        }

        return bestScore >= CONFIDENCE_FLOOR
                ? new Detection(best, bestScore, scores)
                : new Detection(SqlDialect.GENERIC, bestScore, scores);
    }
}
