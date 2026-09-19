package com.dbviewer.app.sql;

import com.dbviewer.app.dto.ColumnInfo;
import com.dbviewer.app.dto.ImportPlan;
import com.dbviewer.app.dto.Relationship;
import com.dbviewer.app.dto.TableInfo;
import com.dbviewer.app.service.impl.DatabaseServiceImpl;
import com.dbviewer.app.workspace.WorkspaceContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.TestPropertySource;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Import and export coverage for the engines other than MySQL.
 *
 * <p>Each of these dumps is written the way its own tool emits one — pg_dump puts the keys in
 * {@code ALTER TABLE ONLY} statements and the rows in a {@code COPY ... FROM stdin} block, SSMS
 * wraps everything in brackets and separates batches with {@code GO} — and none of it runs on
 * SQLite as written. What the assertions check is not that the import survived but that the
 * <em>schema</em> did: primary keys, foreign keys and row data all have to arrive, because those
 * are what the diagram is drawn from.
 */
@SpringBootTest
@TestPropertySource(properties = {
        "spring.datasource.url=jdbc:sqlite::memory:",
        "spring.datasource.driver-class-name=org.sqlite.JDBC",
        "app.db.driver=sqlite"
})
class MultiDialectImportTest {

    @Autowired
    private DatabaseServiceImpl service;

    @BeforeEach
    void openWorkspace() {
        WorkspaceContext.set("dialect" + UUID.randomUUID().toString().replace("-", ""));
    }

    @AfterEach
    void closeWorkspace() {
        service.deleteWorkspace();
        WorkspaceContext.clear();
    }

    private Map<String, Object> upload(String name, String sql) throws Exception {
        return service.handleFileUpload(new MockMultipartFile(
                "file", name, "application/sql", sql.getBytes(StandardCharsets.UTF_8)));
    }

    @SuppressWarnings("unchecked")
    private List<TableInfo> tables() {
        return (List<TableInfo>) service.getDbInfo().get("tables");
    }

    @SuppressWarnings("unchecked")
    private List<Relationship> relationships() {
        return (List<Relationship>) service.getDbInfo().get("relationships");
    }

    @SuppressWarnings("unchecked")
    private List<ColumnInfo> columnsOf(String table) {
        return (List<ColumnInfo>) service.getTableData(table).get("columns");
    }

    /* ── PostgreSQL ───────────────────────────────────────────────────────────── */

    private static final String PG_DUMP = """
            SET statement_timeout = 0;
            SET search_path = public, pg_catalog;

            CREATE TABLE public.customers (
                id integer NOT NULL,
                email character varying(255) NOT NULL,
                postcode character varying(10),
                tags text[],
                signed_up timestamp without time zone DEFAULT now(),
                active boolean DEFAULT true
            );

            CREATE SEQUENCE public.customers_id_seq START WITH 1;
            ALTER SEQUENCE public.customers_id_seq OWNED BY public.customers.id;
            ALTER TABLE ONLY public.customers ALTER COLUMN id SET DEFAULT nextval('public.customers_id_seq'::regclass);
            ALTER TABLE ONLY public.customers ADD CONSTRAINT customers_pkey PRIMARY KEY (id);

            CREATE TABLE public.orders (
                id bigserial NOT NULL,
                customer_id integer NOT NULL,
                total numeric(10,2) DEFAULT 0.00,
                CONSTRAINT orders_pkey PRIMARY KEY (id)
            );
            ALTER TABLE ONLY public.orders
                ADD CONSTRAINT orders_customer_fk FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;

            COPY public.customers (id, email, postcode, tags, signed_up, active) FROM stdin;
            1\tada@example.com\t01234\t{a,b}\t2024-01-02 10:00:00\tt
            2\tgrace@example.com\t02138\t\\N\t2024-02-03 11:30:00\tf
            \\.

            COMMENT ON TABLE public.customers IS 'people';
            """;

    @Test
    void postgresDump_shouldBeDetectedAndImportedWholesale() throws Exception {
        Map<String, Object> report = upload("pg.sql", PG_DUMP);

        assertThat(report).containsEntry("dialect", "postgres");
        assertThat(tables()).extracting(TableInfo::getName)
                .containsExactlyInAnyOrder("customers", "orders");
    }

    @Test
    void postgres_shouldFoldAlterTableKeysAndSequencesIntoTheSchema() throws Exception {
        upload("pg.sql", PG_DUMP);

        // The key is declared by a later ALTER TABLE ONLY, and the sequence default is what makes
        // it auto-incrementing - neither of which SQLite can execute.
        assertThat(columnsOf("customers")).filteredOn(ColumnInfo::isPk)
                .extracting(ColumnInfo::getName).containsExactly("id");
        assertThat(columnsOf("orders")).filteredOn(ColumnInfo::isPk)
                .extracting(ColumnInfo::getName).containsExactly("id");

        assertThat(relationships())
                .extracting(Relationship::getSourceTable, Relationship::getSourceColumn,
                        Relationship::getTargetTable, Relationship::getTargetColumn)
                .containsExactly(org.assertj.core.groups.Tuple.tuple(
                        "orders", "customer_id", "customers", "id"));
    }

    @Test
    void postgres_shouldMapVendorTypesOntoSomethingSqliteAccepts() throws Exception {
        upload("pg.sql", PG_DUMP);

        Map<String, String> types = columnsOf("customers").stream()
                .collect(java.util.stream.Collectors.toMap(ColumnInfo::getName, ColumnInfo::getType));

        assertThat(types).containsEntry("email", "VARCHAR(255)");
        // An array has no SQLite equivalent at all, so it lands as text rather than failing.
        assertThat(types).containsEntry("tags", "TEXT");
        assertThat(types).containsEntry("signed_up", "TIMESTAMP");
        assertThat(types).containsEntry("active", "BOOLEAN");
    }

    @Test
    void postgres_copyBlock_shouldBecomeRows() throws Exception {
        upload("pg.sql", PG_DUMP);

        List<Map<String, Object>> rows = service.getTableRows("customers");
        assertThat(rows).hasSize(2);
        assertThat(rows.get(0)).containsEntry("email", "ada@example.com");
        // The leading zero survives because the column is text, as the source declared it.
        assertThat(rows.get(0)).containsEntry("postcode", "01234");
        assertThat(rows.get(1).get("tags")).isNull();
    }

    /* ── SQL Server ───────────────────────────────────────────────────────────── */

    private static final String SQLSERVER_DUMP = """
            USE [Shop]
            GO
            SET ANSI_NULLS ON
            GO
            CREATE TABLE [dbo].[Categories](
                [CategoryId] [int] IDENTITY(1,1) NOT NULL,
                [Name] [nvarchar](100) NOT NULL,
                [Notes] [nvarchar](max) NULL,
                [Active] [bit] NOT NULL,
                [Created] [datetime2](7) NOT NULL DEFAULT (getdate()),
             CONSTRAINT [PK_Categories] PRIMARY KEY CLUSTERED ([CategoryId] ASC)
            ) ON [PRIMARY] TEXTIMAGE_ON [PRIMARY]
            GO
            CREATE TABLE [dbo].[Products](
                [ProductId] [int] IDENTITY(1,1) NOT NULL,
                [CategoryId] [int] NOT NULL,
                [Price] [money] NOT NULL,
             CONSTRAINT [PK_Products] PRIMARY KEY CLUSTERED ([ProductId] ASC)
            ) ON [PRIMARY]
            GO
            ALTER TABLE [dbo].[Products] ADD CONSTRAINT [FK_Products_Categories]
                FOREIGN KEY([CategoryId]) REFERENCES [dbo].[Categories] ([CategoryId])
            GO
            INSERT [dbo].[Categories] ([CategoryId], [Name], [Notes], [Active], [Created])
                VALUES (1, N'Tools', N'Hand tools', 1, '2024-01-01')
            GO
            """;

    @Test
    void sqlServerScript_shouldImportAcrossGoBatches() throws Exception {
        Map<String, Object> report = upload("mssql.sql", SQLSERVER_DUMP);

        assertThat(report).containsEntry("dialect", "sqlserver");
        assertThat(tables()).extracting(TableInfo::getName)
                .containsExactlyInAnyOrder("Categories", "Products");

        // The schema qualifier has nowhere to go in a flat database, and leaving it on would
        // stop the foreign key ever matching the table it points at.
        assertThat(relationships())
                .extracting(Relationship::getSourceTable, Relationship::getTargetTable)
                .containsExactly(org.assertj.core.groups.Tuple.tuple("Products", "Categories"));
    }

    @Test
    void sqlServer_shouldMapIdentityAndVendorTypes() throws Exception {
        upload("mssql.sql", SQLSERVER_DUMP);

        assertThat(columnsOf("Categories")).filteredOn(ColumnInfo::isPk)
                .extracting(ColumnInfo::getName).containsExactly("CategoryId");

        Map<String, String> types = columnsOf("Categories").stream()
                .collect(java.util.stream.Collectors.toMap(ColumnInfo::getName, ColumnInfo::getType));
        assertThat(types).containsEntry("Name", "VARCHAR(100)");
        // NVARCHAR(MAX) is a parse error in SQLite, not merely an unknown type.
        assertThat(types).containsEntry("Notes", "TEXT");
        assertThat(types).containsEntry("Active", "BOOLEAN");
    }

    @Test
    void sqlServer_unicodeLiterals_shouldBeStripped() throws Exception {
        upload("mssql.sql", SQLSERVER_DUMP);

        List<Map<String, Object>> rows = service.getTableRows("Categories");
        assertThat(rows).hasSize(1);
        assertThat(rows.get(0)).containsEntry("Name", "Tools");
    }

    /* ── MariaDB ──────────────────────────────────────────────────────────────── */

    @Test
    void mariaDbDump_shouldBeRecognisedAsItsOwnDialect() throws Exception {
        String dump = """
                -- MariaDB dump 10.19  Distrib 10.6.12-MariaDB
                /*M!100101 SET @OLD_SQL_MODE=@@SQL_MODE */;
                CREATE TABLE `staff` (
                  `id` int(11) NOT NULL AUTO_INCREMENT,
                  `name` varchar(80) COLLATE utf8mb4_general_ci NOT NULL,
                  PRIMARY KEY (`id`)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 PAGE_CHECKSUM=1;
                INSERT INTO `staff` (`name`) VALUES ('Ada');
                """;

        Map<String, Object> report = upload("maria.sql", dump);

        assertThat(report).containsEntry("dialect", "mariadb");
        assertThat(columnsOf("staff")).filteredOn(ColumnInfo::isPk)
                .extracting(ColumnInfo::getName).containsExactly("id");
        assertThat(service.getTableRows("staff")).hasSize(1);
    }

    /* ── Pre-flight preview ───────────────────────────────────────────────────── */

    @Test
    void analyzingAFile_shouldDescribeItWithoutCreatingAnything() throws Exception {
        ImportPlan plan = service.analyzeUpload(new MockMultipartFile(
                "file", "pg.sql", "application/sql", PG_DUMP.getBytes(StandardCharsets.UTF_8)));

        assertThat(plan.dialect()).isEqualTo("postgres");
        assertThat(plan.dialectLabel()).isEqualTo("PostgreSQL");
        assertThat(plan.tables()).extracting(ImportPlan.PlannedTable::name)
                .containsExactlyInAnyOrder("customers", "orders");
        assertThat(plan.relationships()).hasSize(1);
        assertThat(plan.editable()).isFalse();

        // The whole point: nothing was created.
        assertThat(tables()).isEmpty();
    }

    @Test
    void csvPreview_shouldFlagLeadingZerosRatherThanQuietlyDestroyingThem() throws Exception {
        String csv = """
                name,postcode,orders,joined
                Ada,01234,7,2024-01-02
                Grace,02138,12,2024-03-04
                """;

        ImportPlan plan = service.analyzeUpload(new MockMultipartFile(
                "file", "people.csv", "text/csv", csv.getBytes(StandardCharsets.UTF_8)));

        assertThat(plan.type()).isEqualTo("csv");
        assertThat(plan.editable()).isTrue();
        assertThat(plan.dataRowCount()).isEqualTo(2);

        Map<String, ImportPlan.PlannedColumn> columns = plan.tables().get(0).columns().stream()
                .collect(java.util.stream.Collectors.toMap(
                        ImportPlan.PlannedColumn::name, c -> c));

        // Digits only, so the naive answer is INT - and the leading zero would be gone for good.
        assertThat(columns.get("postcode").type()).startsWith("VARCHAR");
        assertThat(columns.get("postcode").reason()).contains("leading zero");
        assertThat(columns.get("orders").type()).isEqualTo("INTEGER");
        assertThat(columns.get("joined").type()).isEqualTo("DATE");
        assertThat(columns.get("name").samples()).contains("Ada");
    }

    @Test
    void csvImport_shouldHonourTheTypeTheUserChose() throws Exception {
        String csv = """
                sku,quantity
                00042,5
                00043,9
                """;

        // Nothing here looks like text, so inference would make both columns numeric; the user
        // says otherwise in the dialog, and their answer is the one that runs.
        service.handleFileUpload(
                new MockMultipartFile("file", "stock.csv", "text/csv",
                        csv.getBytes(StandardCharsets.UTF_8)),
                Map.of("quantity", "VARCHAR(16)"));

        Map<String, String> types = columnsOf("stock").stream()
                .collect(java.util.stream.Collectors.toMap(ColumnInfo::getName, ColumnInfo::getType));
        assertThat(types).containsEntry("quantity", "VARCHAR(16)");
        assertThat(service.getTableRows("stock")).hasSize(2);
        assertThat(service.getTableRows("stock").get(0)).containsEntry("sku", "00042");
    }

    @Test
    void csvWithQuotedFieldsAndSemicolons_shouldStillParse() throws Exception {
        String csv = "name;note\n"
                + "\"Ada, Countess\";\"said \"\"hello\"\"\nover two lines\"\n";

        service.handleFileUpload(new MockMultipartFile(
                "file", "notes.csv", "text/csv", csv.getBytes(StandardCharsets.UTF_8)), Map.of());

        List<Map<String, Object>> rows = service.getTableRows("notes");
        assertThat(rows).hasSize(1);
        assertThat(rows.get(0)).containsEntry("name", "Ada, Countess");
        assertThat((String) rows.get(0).get("note")).contains("said \"hello\"").contains("\n");
    }

    /* ── Targeted export ──────────────────────────────────────────────────────── */

    @Test
    void exportingToEachDialect_shouldUseThatEnginesAutoIncrementAndQuoting() throws Exception {
        upload("pg.sql", PG_DUMP);

        String postgres = service.exportDatabaseSql(SqlDialect.POSTGRES);
        assertThat(postgres).contains("\"customers\"").contains("SERIAL PRIMARY KEY");

        String mysql = service.exportDatabaseSql(SqlDialect.MYSQL);
        assertThat(mysql).contains("`customers`").contains("INT AUTO_INCREMENT PRIMARY KEY");

        String sqlServer = service.exportDatabaseSql(SqlDialect.SQLSERVER);
        assertThat(sqlServer).contains("[customers]").contains("IDENTITY(1,1)").contains("\nGO\n");

        String sqlite = service.exportDatabaseSql(SqlDialect.SQLITE);
        assertThat(sqlite).contains("INTEGER PRIMARY KEY AUTOINCREMENT");
    }

    @Test
    void export_shouldMakeGeneratedKeysAcceptTheIdsTheRowsAlreadyHave() throws Exception {
        upload("pg.sql", PG_DUMP);

        // The rows carry their original ids because the foreign keys refer to them. SQL Server
        // rejects that outright on an IDENTITY column...
        String sqlServer = service.exportDatabaseSql(SqlDialect.SQLSERVER);
        assertThat(sqlServer)
                .contains("SET IDENTITY_INSERT [customers] ON;")
                .contains("SET IDENTITY_INSERT [customers] OFF;");

        // ...and PostgreSQL accepts it, then hands out a colliding id on the very next insert
        // because its sequence never moved.
        String postgres = service.exportDatabaseSql(SqlDialect.POSTGRES);
        assertThat(postgres).contains("setval(pg_get_serial_sequence('customers', 'id')");
    }

    @Test
    void export_shouldEmitParentTablesBeforeTheTablesThatReferenceThem() throws Exception {
        upload("pg.sql", PG_DUMP);

        String script = service.exportDatabaseSql(SqlDialect.POSTGRES);
        assertThat(script.indexOf("CREATE TABLE \"customers\""))
                .isLessThan(script.indexOf("CREATE TABLE \"orders\""));
        assertThat(script).contains("REFERENCES \"customers\" (\"id\")");
    }
}
