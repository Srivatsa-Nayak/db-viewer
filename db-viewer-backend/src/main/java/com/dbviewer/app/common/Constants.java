package com.dbviewer.app.common;

/**
 * Every SQL statement the application issues.
 *
 * <p>The logic classes describe <em>what</em> happens; this file holds <em>how</em> it is asked
 * of the database. Keeping the two apart means a statement can be read, reviewed or corrected
 * without wading through the surrounding control flow, and the whole SQL surface of the app is
 * visible in one place.
 *
 * <p>Conventions used throughout:
 * <ul>
 *   <li>A {@code ?} is a real JDBC bind parameter — values are never concatenated in.</li>
 *   <li>A {@code %s} is a <strong>format slot for an identifier or a fragment</strong>, filled in
 *       with {@link String#format}. Identifiers cannot be bound as parameters, so callers must
 *       pass names that have already been validated — see the {@code safeIdentifier} check in
 *       {@code DatabaseServiceImpl}.</li>
 *   <li>Statements that differ between engines are named for the engine they belong to
 *       ({@code MYSQL_} / {@code SQLITE_}); anything unprefixed runs on both.</li>
 * </ul>
 *
 * <p>Grouped into nested classes rather than one flat list, because a flat list of sixty
 * constants is no easier to navigate than the code it came out of.
 */
public final class Constants {

    private Constants() {
        // Constants holder; never instantiated.
    }

    /** Identifier quoting and the names the application reserves for itself. */
    public static final class Identifiers {
        private Identifiers() { }

        /** MySQL quotes identifiers with backticks; everything else uses double quotes. */
        public static final String MYSQL_QUOTE = "`";
        public static final String STANDARD_QUOTE = "\"";

        /** Tables the application keeps inside a workspace for its own purposes. */
        public static final String INTERNAL_TABLE_PREFIX = "__";

        /** Per-workspace to-do notes. Prefixed so it never reaches the canvas or an export. */
        public static final String NOTES_TABLE = "__table_notes";

        /**
         * Per-workspace canvas annotations: table colours and tags, and domain groups.
         *
         * <p>Inside the workspace rather than the default database for the same reason as notes —
         * an annotation is about this file's tables, so it should travel with the file and go when
         * the file goes. Node <em>positions</em> stay client-side; a colour is a statement about
         * the schema, a position is a preference about one screen.
         */
        public static final String CANVAS_META_TABLE = "__canvas_meta";

        /** Suffix for the scratch table used while rebuilding a SQLite table. */
        public static final String REBUILD_TABLE_SUFFIX = "__rebuild";
    }

    /** Schema creation for tables the application owns, as opposed to the user's data. */
    public static final class Ddl {
        private Ddl() { }

        public static final String MYSQL_AUTO_INCREMENT_PK = "INT AUTO_INCREMENT PRIMARY KEY";
        public static final String SQLITE_AUTO_INCREMENT_PK = "INTEGER PRIMARY KEY AUTOINCREMENT";

        public static final String CREATE_DEFAULT_USERS_TABLE = """
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT
                )
                """;

        /** %s: the engine's auto-increment primary key clause. */
        public static final String CREATE_APP_USERS_TABLE = """
                CREATE TABLE IF NOT EXISTS app_users (
                    id %s,
                    email VARCHAR(320) NOT NULL UNIQUE,
                    display_name VARCHAR(120),
                    password_hash VARCHAR(120) NOT NULL,
                    created_at VARCHAR(40) NOT NULL
                )
                """;

        /**
         * Who each workspace belongs to.
         *
         * <p>Kept out of the workspace databases themselves: a workspace must be attributable
         * before it is opened, and opening it is exactly what the check is meant to prevent.
         */
        public static final String CREATE_WORKSPACE_OWNERS_TABLE = """
                CREATE TABLE IF NOT EXISTS workspace_owners (
                    workspace_id VARCHAR(64) NOT NULL PRIMARY KEY,
                    owner_key VARCHAR(400) NOT NULL,
                    file_name VARCHAR(255),
                    created_at VARCHAR(40) NOT NULL
                )
                """;

        /**
         * Adds {@code file_name} to a table created before it existed.
         *
         * <p>Needed because the name used to live only in the browser's localStorage, which
         * signing out clears — so a user's own files became unreachable the moment they logged
         * out, even though the databases were still on disk and still theirs. Run unconditionally
         * and ignore the failure: there is no portable "add column if missing".
         */
        public static final String ADD_WORKSPACE_OWNERS_FILE_NAME =
                "ALTER TABLE workspace_owners ADD COLUMN file_name VARCHAR(255)";

        /** Owner lookups are the hot path — every request that names a workspace does one. */
        public static final String CREATE_WORKSPACE_OWNERS_INDEX =
                "CREATE INDEX IF NOT EXISTS idx_workspace_owners_owner ON workspace_owners (owner_key)";

        public static final String CREATE_SHARED_LINKS_TABLE = """
                CREATE TABLE IF NOT EXISTS shared_links (
                    token VARCHAR(64) NOT NULL PRIMARY KEY,
                    workspace_id VARCHAR(64) NOT NULL,
                    file_name VARCHAR(255),
                    owner_email VARCHAR(320) NOT NULL,
                    created_at VARCHAR(40) NOT NULL
                )
                """;

        /** %s: notes table name. %s: the engine's auto-increment primary key clause. */
        public static final String CREATE_NOTES_TABLE = """
                CREATE TABLE IF NOT EXISTS "%s" (
                    id %s,
                    table_name VARCHAR(255) NOT NULL,
                    note TEXT NOT NULL,
                    done INTEGER NOT NULL DEFAULT 0,
                    created_at VARCHAR(40) NOT NULL
                )
                """;

        /**
         * Canvas annotations. %s: the table name.
         *
         * <p>One table for two kinds of thing, distinguished by {@code kind}: a {@code 'table'} row
         * annotates the table named in {@code ref}, and a {@code 'group'} row is a domain box whose
         * {@code ref} is its own generated id. Keeping them together means grouping needs no new
         * schema, and the UI reads every annotation in one request.
         *
         * <p>{@code payload} is JSON, and deliberately opaque to the backend: which fields a colour
         * or a group carries is a question about the canvas, and the server has no opinion worth
         * encoding in columns it would have to migrate.
         */
        public static final String CREATE_CANVAS_META_TABLE = """
                CREATE TABLE IF NOT EXISTS "%s" (
                    kind VARCHAR(16) NOT NULL,
                    ref VARCHAR(255) NOT NULL,
                    payload TEXT NOT NULL,
                    updated_at VARCHAR(40) NOT NULL,
                    PRIMARY KEY (kind, ref)
                )
                """;
    }

    /** Accounts. These run against the default database, not a workspace. */
    public static final class Auth {
        private Auth() { }

        public static final String INSERT_USER =
                "INSERT INTO app_users (email, display_name, password_hash, created_at) "
                        + "VALUES (?, ?, ?, ?)";

        public static final String SELECT_USER_BY_EMAIL =
                "SELECT * FROM app_users WHERE email = ?";

        public static final String UPDATE_DISPLAY_NAME =
                "UPDATE app_users SET display_name = ? WHERE email = ?";

        public static final String UPDATE_PASSWORD_HASH =
                "UPDATE app_users SET password_hash = ? WHERE email = ?";
    }

    /**
     * Workspace ownership.
     *
     * <p>Lives in the default database beside accounts and share links, because the question
     * "may this caller open that workspace?" has to be answerable without opening it.
     */
    public static final class Ownership {
        private Ownership() { }

        public static final String SELECT_OWNER =
                "SELECT owner_key FROM workspace_owners WHERE workspace_id = ?";

        public static final String INSERT_OWNER =
                "INSERT INTO workspace_owners (workspace_id, owner_key, file_name, created_at) "
                        + "VALUES (?, ?, ?, ?)";

        public static final String SELECT_WORKSPACES_BY_OWNER =
                "SELECT workspace_id, file_name FROM workspace_owners WHERE owner_key = ?";

        /**
         * Records what the user called the file. Stored here rather than in the workspace
         * database because the file list has to be readable before any workspace is opened.
         */
        public static final String UPDATE_FILE_NAME =
                "UPDATE workspace_owners SET file_name = ? WHERE workspace_id = ?";

        public static final String DELETE_OWNER =
                "DELETE FROM workspace_owners WHERE workspace_id = ?";

        /**
         * Hands a browser's anonymous workspaces to the account it has just signed into, so the
         * work someone did before making an account is not stranded behind an identity they can
         * never present again.
         */
        public static final String ADOPT_ANONYMOUS =
                "UPDATE workspace_owners SET owner_key = ? WHERE owner_key = ?";
    }

    /** Read-only share links. Also in the default database — a link outlives any one file. */
    public static final class Share {
        private Share() { }

        public static final String INSERT_LINK =
                "INSERT INTO shared_links (token, workspace_id, file_name, owner_email, created_at) "
                        + "VALUES (?, ?, ?, ?, ?)";

        public static final String SELECT_TOKEN_BY_WORKSPACE_AND_OWNER =
                "SELECT token FROM shared_links WHERE workspace_id = ? AND owner_email = ?";

        public static final String SELECT_LINK_BY_TOKEN =
                "SELECT * FROM shared_links WHERE token = ?";

        public static final String SELECT_LINKS_BY_OWNER =
                "SELECT token, workspace_id, file_name, created_at FROM shared_links "
                        + "WHERE owner_email = ? ORDER BY created_at DESC";

        public static final String DELETE_LINK_BY_TOKEN_AND_OWNER =
                "DELETE FROM shared_links WHERE token = ? AND owner_email = ?";

        public static final String DELETE_LINKS_BY_WORKSPACE =
                "DELETE FROM shared_links WHERE workspace_id = ?";
    }

    /** Reading a database's own description of itself: tables, columns, keys. */
    public static final class Introspection {
        private Introspection() { }

        public static final String MYSQL_SHOW_TABLES = "SHOW TABLES";

        public static final String SQLITE_SELECT_USER_TABLES =
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'";

        /** %s: table name, unquoted (MySQL accepts it bare here). */
        public static final String MYSQL_DESCRIBE_TABLE = "DESCRIBE %s";

        /** %s: table name. Reports pk as a 1-based position, 0 meaning "not a key". */
        public static final String SQLITE_TABLE_INFO = "PRAGMA table_info(\"%s\")";

        /**
         * Indexes on a table. %s: table name.
         *
         * <p>The only way to learn that a column is UNIQUE: {@code PRAGMA table_info} does not
         * report it, so before this the schema had no way to tell a one-to-one relationship
         * from a one-to-many.
         */
        public static final String SQLITE_INDEX_LIST = "PRAGMA index_list(\"%s\")";

        /** Columns in one index. %s: index name. */
        public static final String SQLITE_INDEX_INFO = "PRAGMA index_info(\"%s\")";

        /** Single-column unique indexes, MySQL. ?: table name. */
        public static final String MYSQL_UNIQUE_COLUMNS =
                "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.STATISTICS "
                        + "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND NON_UNIQUE = 0 "
                        + "GROUP BY INDEX_NAME, COLUMN_NAME HAVING COUNT(*) OVER (PARTITION BY INDEX_NAME) = 1";

        /** ?: table name. */
        public static final String MYSQL_FOREIGN_KEYS = """
                SELECT COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
                FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
                WHERE TABLE_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL
                """;

        /** %s: table name. */
        public static final String SQLITE_FOREIGN_KEY_LIST = "PRAGMA foreign_key_list(\"%s\")";

        /** %s: table name. Returns the original CREATE statement in column 2. */
        public static final String MYSQL_SHOW_CREATE_TABLE = "SHOW CREATE TABLE %s";

        /** ?: table name. */
        public static final String SQLITE_SELECT_TABLE_SQL =
                "SELECT sql FROM sqlite_master WHERE type='table' AND name = ?";
    }

    /**
     * Connection-level switches.
     *
     * <p>A workspace holds one long-lived connection, so anything set here persists for every
     * later statement on that workspace — always restore the previous value rather than
     * assuming a default.
     */
    public static final class Session {
        private Session() { }

        public static final String SQLITE_READ_FOREIGN_KEYS = "PRAGMA foreign_keys";
        public static final String SQLITE_FOREIGN_KEYS_OFF = "PRAGMA foreign_keys = OFF";
        /** %s: ON or OFF. */
        public static final String SQLITE_SET_FOREIGN_KEYS = "PRAGMA foreign_keys = %s";

        public static final String MYSQL_FOREIGN_KEY_CHECKS_OFF = "SET FOREIGN_KEY_CHECKS = 0";
        public static final String MYSQL_FOREIGN_KEY_CHECKS_ON = "SET FOREIGN_KEY_CHECKS = 1";
    }

    /** Creating, altering and dropping the user's own tables. */
    public static final class Tables {
        private Tables() { }

        /** %s: quoted table name. %s: joined column and constraint definitions. */
        public static final String CREATE_TABLE = "CREATE TABLE %s (%s)";

        /** %s: quoted table name. %s: joined column definitions. */
        public static final String CREATE_TABLE_IF_NOT_EXISTS =
                "CREATE TABLE IF NOT EXISTS %s (%s);";

        /** %s: quoted table name. */
        public static final String DROP_TABLE = "DROP TABLE %s";

        /** %s: table name, unquoted. Used on the MySQL clear-database path. */
        public static final String DROP_TABLE_IF_EXISTS = "DROP TABLE IF EXISTS %s";

        /** %s: table name. */
        public static final String DROP_TABLE_IF_EXISTS_QUOTED = "DROP TABLE IF EXISTS \"%s\"";

        /** %s: table name. %s: column name. %s: rendered type definition. */
        public static final String ADD_COLUMN =
                "ALTER TABLE \"%s\" ADD COLUMN \"%s\" %s";

        /** %s: table. %s: existing column. %s: new column. %s: rendered type definition. */
        public static final String MYSQL_CHANGE_COLUMN =
                "ALTER TABLE `%s` CHANGE COLUMN `%s` `%s` %s";

        /** %s: quoted table. %s: quoted existing column. %s: quoted new column. */
        public static final String RENAME_COLUMN = "ALTER TABLE %s RENAME COLUMN %s TO %s";

        /** %s: current table name. %s: new table name. */
        public static final String RENAME_TABLE = "ALTER TABLE \"%s\" RENAME TO \"%s\"";

        /** %s: destination table. %s: destination columns. %s: source expressions. %s: source table. */
        public static final String COPY_ROWS =
                "INSERT INTO \"%s\" (%s) SELECT %s FROM \"%s\"";

        /** %s: from columns. %s: referenced table. %s: referenced columns. %s: ON DELETE clause or "". */
        public static final String FOREIGN_KEY_CLAUSE =
                "FOREIGN KEY (%s) REFERENCES \"%s\"(%s)%s";

        /** %s: quoted column. %s: quoted referenced table. %s: quoted referenced column. */
        public static final String FOREIGN_KEY_CASCADE_CLAUSE =
                "FOREIGN KEY (%s) REFERENCES %s(%s) ON DELETE CASCADE";
    }

    /** Row-level reads and writes. */
    public static final class Rows {
        private Rows() { }

        /** %s: table name. */
        public static final String SELECT_ALL = "SELECT * FROM \"%s\"";

        /** %s: table name. Capped so a large table cannot flood the canvas. */
        public static final String SELECT_ALL_LIMITED = "SELECT * FROM \"%s\" LIMIT 100";

        /** %s: table. %s: column. ?: new value. ?: record id. */
        public static final String UPDATE_CELL_BY_ID =
                "UPDATE \"%s\" SET \"%s\" = ? WHERE id = ?";

        /** %s: table. ?: record id. */
        public static final String DELETE_BY_ID = "DELETE FROM \"%s\" WHERE id = ?";

        /** %s: quoted table. %s: quoted columns. %s: bind placeholders. */
        public static final String INSERT = "INSERT INTO %s (%s) VALUES (%s)";

        /** %s: quoted table. MySQL's way of inserting a row of pure defaults. */
        public static final String MYSQL_INSERT_EMPTY = "INSERT INTO %s () VALUES ()";

        /** %s: quoted table. SQLite's equivalent. */
        public static final String SQLITE_INSERT_DEFAULTS = "INSERT INTO %s DEFAULT VALUES";
    }

    /** The per-table to-do list stored inside each workspace. */
    public static final class Notes {
        private Notes() { }

        private static final String COLUMNS = "id, table_name, note, done, created_at";
        private static final String ORDER = " ORDER BY done ASC, id DESC";

        /** %s: notes table. ?: table name. */
        public static final String SELECT_FOR_TABLE =
                "SELECT " + COLUMNS + " FROM \"%s\" WHERE table_name = ?" + ORDER;

        /** %s: notes table. */
        public static final String SELECT_ALL =
                "SELECT " + COLUMNS + " FROM \"%s\"" + ORDER;

        /** %s: notes table. ?: table name, note text, created-at timestamp. */
        public static final String INSERT =
                "INSERT INTO \"%s\" (table_name, note, done, created_at) VALUES (?, ?, 0, ?)";

        /** %s: notes table. ?: done flag. ?: note id. */
        public static final String SET_DONE = "UPDATE \"%s\" SET done = ? WHERE id = ?";

        /** %s: notes table. ?: note id. */
        public static final String DELETE_BY_ID = "DELETE FROM \"%s\" WHERE id = ?";

        /** %s: notes table. ?: table name. */
        public static final String DELETE_FOR_TABLE = "DELETE FROM \"%s\" WHERE table_name = ?";
    }

    /**
     * Canvas annotations — table colours and tags, and (later) domain groups.
     *
     * <p>Every statement takes the annotations table name as its first {@code %s}, like
     * {@link Notes}.
     */
    public static final class CanvasMeta {
        private CanvasMeta() { }

        public static final String KIND_TABLE = "table";
        public static final String KIND_GROUP = "group";

        /** %s: annotations table. */
        public static final String SELECT_ALL =
                "SELECT kind, ref, payload FROM \"%s\" ORDER BY kind, ref";

        /**
         * %s: annotations table. ?: kind, ref, payload, updated-at timestamp.
         *
         * <p>An upsert, because setting a colour twice is one annotation and not two. Both engines
         * in play accept this spelling — SQLite since 3.24, MySQL since 8.0.19 — and the bundled
         * driver is well past both.
         */
        public static final String UPSERT =
                "INSERT INTO \"%s\" (kind, ref, payload, updated_at) VALUES (?, ?, ?, ?) "
                        + "ON CONFLICT (kind, ref) DO UPDATE SET payload = excluded.payload, "
                        + "updated_at = excluded.updated_at";

        /** %s: annotations table. ?: kind, ref. */
        public static final String DELETE_ONE = "DELETE FROM \"%s\" WHERE kind = ? AND ref = ?";

        /** %s: annotations table. ?: table name. Used so a colour cannot outlive its table. */
        public static final String DELETE_FOR_TABLE =
                "DELETE FROM \"%s\" WHERE kind = 'table' AND ref = ?";
    }

    /** Creating and discarding the per-file databases themselves. */
    public static final class Workspaces {
        private Workspaces() { }

        /** %s: schema name. */
        public static final String MYSQL_CREATE_SCHEMA = "CREATE DATABASE IF NOT EXISTS `%s`";

        /** %s: schema name. */
        public static final String MYSQL_DROP_SCHEMA = "DROP DATABASE IF EXISTS `%s`";

        public static final String MYSQL_LIST_WORKSPACE_SCHEMAS =
                "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA "
                        + "WHERE SCHEMA_NAME LIKE 'ws\\_%'";
    }

    /** Fragments of the generated .sql dump. Not executed here — written to a file. */
    public static final class Export {
        private Export() { }

        public static final String DUMP_HEADER = "-- SQL Dump generated by SQL Visualizer\n";

        /** %s: table name. */
        public static final String DUMP_STRUCTURE_COMMENT = "\n-- Structure for table `%s`\n";

        /** %s: table name. */
        public static final String DUMP_DROP_TABLE = "DROP TABLE IF EXISTS `%s`;\n";

        /** %s: table name. */
        public static final String DUMP_DATA_COMMENT = "-- Data for table `%s`\n";

        /** %s: quoted table. %s: column list. %s: value list. */
        public static final String DUMP_INSERT_ROW = "INSERT INTO %s (%s) VALUES (%s);\n";
    }
}
