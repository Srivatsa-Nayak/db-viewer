package com.dbviewer.app.service;

import com.dbviewer.app.dto.Relationship;
import com.dbviewer.app.dto.TableInfo;
import com.dbviewer.app.dto.ColumnInfo;
import com.dbviewer.app.service.impl.DatabaseServiceImpl;
import com.dbviewer.app.workspace.WorkspaceContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.TestPropertySource;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Declaring a foreign key on a table that already exists — what dragging a line on the canvas does.
 *
 * <p>Two halves, and the second is the one that matters. SQLite cannot add a constraint, so this
 * rebuilds the table; the tests therefore spend most of their time checking that everything the
 * old table carried is still there afterwards. Indexes, {@code UNIQUE} and {@code CHECK} used to
 * be dropped silently by that rebuild, which a column retype could already trigger.
 */
@SpringBootTest
@TestPropertySource(properties = {
        "spring.datasource.url=jdbc:sqlite::memory:",
        "spring.datasource.driver-class-name=org.sqlite.JDBC",
        "app.db.driver=sqlite"
})
class ForeignKeyConstraintTest {

    @Autowired
    private DatabaseServiceImpl service;

    @BeforeEach
    void openWorkspace() {
        WorkspaceContext.set("fkctest" + UUID.randomUUID().toString().replace("-", ""));
        service.executeQuery("CREATE TABLE customers (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT)");
        service.executeQuery("CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER, total INTEGER)");
        service.executeQuery("INSERT INTO customers (id, email) VALUES (1, 'a@example.com')");
        service.executeQuery("INSERT INTO orders (id, customer_id, total) VALUES (10, 1, 500)");
    }

    @AfterEach
    void closeWorkspace() {
        service.deleteWorkspace();
        WorkspaceContext.clear();
    }

    @SuppressWarnings("unchecked")
    private List<Relationship> relationships() {
        return (List<Relationship>) service.getDbInfo().get("relationships");
    }

    @SuppressWarnings("unchecked")
    private List<TableInfo> tables() {
        return (List<TableInfo>) service.getDbInfo().get("tables");
    }

    private String ddl(String table) {
        return String.valueOf(service.executeQuery(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name='" + table + "'"));
    }

    private List<Map<String, Object>> indexes(String table) {
        return service.executeQuery(
                "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='" + table
                        + "' AND sql IS NOT NULL");
    }

    @Test
    void addForeignKey_shouldBeReportedByTheSchema() {
        service.addForeignKey("orders", "customer_id", "customers", "id", null);

        assertThat(relationships()).singleElement().satisfies(rel -> {
            assertThat(rel.getSourceTable()).isEqualTo("orders");
            assertThat(rel.getSourceColumn()).isEqualTo("customer_id");
            assertThat(rel.getTargetTable()).isEqualTo("customers");
            assertThat(rel.getTargetColumn()).isEqualTo("id");
        });
    }

    @Test
    void addForeignKey_shouldKeepRowsKeyAutoIncrementAndOtherColumns() {
        service.addForeignKey("orders", "customer_id", "customers", "id", "CASCADE");

        assertThat(service.getTableRows("orders")).singleElement()
                .satisfies(row -> {
                    assertThat(row).containsEntry("id", 10);
                    assertThat(row).containsEntry("total", 500);
                });
        assertThat(ddl("orders")).contains("PRIMARY KEY");
        assertThat(relationships()).singleElement()
                .extracting(Relationship::getOnDelete).isEqualTo("CASCADE");
    }

    @Test
    void addForeignKey_shouldPreserveIndexesUniqueAndCheck() {
        // The F3 regression, in one table: every one of these used to disappear on a rebuild.
        service.executeQuery("""
                CREATE TABLE items (
                    id INTEGER PRIMARY KEY,
                    sku TEXT UNIQUE,
                    owner_id INTEGER,
                    qty INTEGER CHECK (qty >= 0)
                )""");
        service.executeQuery("CREATE INDEX idx_items_qty ON items (qty)");
        service.executeQuery("CREATE UNIQUE INDEX idx_items_owner ON items (owner_id)");
        service.executeQuery("INSERT INTO items (id, sku, owner_id, qty) VALUES (1, 'A1', 1, 5)");

        service.addForeignKey("items", "owner_id", "customers", "id", null);

        String schema = ddl("items");
        assertThat(schema).contains("UNIQUE");
        assertThat(schema).contains("CHECK");
        assertThat(indexes("items").toString())
                .contains("idx_items_qty")
                .contains("idx_items_owner");

        // Still enforced, not merely still written down.
        assertThatThrownBy(() -> service.executeQuery(
                "INSERT INTO items (id, sku, owner_id, qty) VALUES (2, 'A1', 1, 1)"))
                .isInstanceOf(Exception.class);
        assertThatThrownBy(() -> service.executeQuery(
                "INSERT INTO items (id, sku, owner_id, qty) VALUES (3, 'B2', 9, -1)"))
                .isInstanceOf(Exception.class);

        assertThat(service.getTableRows("items")).hasSize(1);
    }

    @Test
    void orphanRows_shouldBeRefusedWithACount() {
        service.executeQuery("INSERT INTO orders (id, customer_id, total) VALUES (11, 999, 10)");
        service.executeQuery("INSERT INTO orders (id, customer_id, total) VALUES (12, 998, 20)");

        assertThatThrownBy(() ->
                service.addForeignKey("orders", "customer_id", "customers", "id", null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("2 rows");

        // Nothing was written: the table is exactly as it was.
        assertThat(relationships()).isEmpty();
        assertThat(service.getTableRows("orders")).hasSize(3);
    }

    @Test
    void nullKeys_shouldNotCountAsOrphans() {
        // An optional relationship is allowed to be absent; only a value pointing nowhere is wrong.
        service.executeQuery("INSERT INTO orders (id, customer_id, total) VALUES (13, NULL, 30)");

        service.addForeignKey("orders", "customer_id", "customers", "id", null);
        assertThat(relationships()).hasSize(1);
    }

    @Test
    void aNonUniqueTarget_shouldBeRefused() {
        // SQLite would accept this and then never enforce it, so the diagram would claim a
        // guarantee the database is not making.
        assertThatThrownBy(() ->
                service.addForeignKey("orders", "customer_id", "customers", "email", null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("not unique");
    }

    @Test
    void mismatchedTypes_shouldBeRefused() {
        service.executeQuery("CREATE TABLE tags (name TEXT PRIMARY KEY)");

        assertThatThrownBy(() ->
                service.addForeignKey("orders", "customer_id", "tags", "name", null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("matching types");
    }

    @Test
    void equivalentTypeSpellings_shouldBeAccepted() {
        // INT and INTEGER are the same storage class; refusing that pair would reject ordinary
        // schemas for no reason.
        service.executeQuery("CREATE TABLE regions (id INT PRIMARY KEY)");
        service.executeQuery("ALTER TABLE orders ADD COLUMN region_id BIGINT");

        service.addForeignKey("orders", "region_id", "regions", "id", null);
        assertThat(relationships()).anySatisfy(rel ->
                assertThat(rel.getTargetTable()).isEqualTo("regions"));
    }

    @Test
    void aDuplicateKey_shouldBeRefused() {
        service.addForeignKey("orders", "customer_id", "customers", "id", null);

        assertThatThrownBy(() ->
                service.addForeignKey("orders", "customer_id", "customers", "id", null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("already exists");
    }

    @Test
    void unknownTableOrColumn_shouldBeRefused() {
        assertThatThrownBy(() -> service.addForeignKey("nope", "x", "customers", "id", null))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> service.addForeignKey("orders", "nope", "customers", "id", null))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> service.addForeignKey("orders", "customer_id", "customers", "nope", null))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void aColumnReferencingItself_shouldBeRefused() {
        assertThatThrownBy(() -> service.addForeignKey("orders", "id", "orders", "id", null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("itself");
    }

    @Test
    void aSelfReferenceBetweenDifferentColumns_shouldBeAllowed() {
        // employees.manager_id -> employees.id is an ordinary and useful shape.
        service.executeQuery("CREATE TABLE staff (id INTEGER PRIMARY KEY, manager_id INTEGER)");
        service.executeQuery("INSERT INTO staff (id, manager_id) VALUES (1, NULL)");

        service.addForeignKey("staff", "manager_id", "staff", "id", null);
        assertThat(relationships()).anySatisfy(rel -> {
            assertThat(rel.getSourceTable()).isEqualTo("staff");
            assertThat(rel.getTargetTable()).isEqualTo("staff");
        });
    }

    @Test
    void foreignKeyEnforcement_shouldBeLeftAsItWasFound() {
        // A workspace holds one long-lived connection, so flipping this permanently would change
        // how every later insert behaves. Read rather than set: `PRAGMA foreign_keys = OFF`
        // returns no result set, and `executeQuery` sends everything starting with PRAGMA to
        // `queryForList` — a real limitation, and one the SQL scratchpad has to fix properly.
        Object before = service.executeQuery("PRAGMA foreign_keys").get(0).get("foreign_keys");

        service.addForeignKey("orders", "customer_id", "customers", "id", null);

        Object after = service.executeQuery("PRAGMA foreign_keys").get(0).get("foreign_keys");
        assertThat(after).isEqualTo(before);
    }

    @Test
    void dropForeignKey_shouldRemoveOnlyThatOne() {
        service.executeQuery("CREATE TABLE regions (id INTEGER PRIMARY KEY)");
        service.executeQuery("ALTER TABLE orders ADD COLUMN region_id INTEGER");
        service.addForeignKey("orders", "customer_id", "customers", "id", null);
        service.addForeignKey("orders", "region_id", "regions", "id", null);
        assertThat(relationships()).hasSize(2);

        service.dropForeignKey("orders", "customer_id", "customers", "id");

        assertThat(relationships()).singleElement()
                .extracting(Relationship::getTargetTable).isEqualTo("regions");
    }

    @Test
    void addThenDrop_shouldRoundTripAndKeepTheData() {
        // Exactly what undo does after a drag.
        service.addForeignKey("orders", "customer_id", "customers", "id", null);
        service.dropForeignKey("orders", "customer_id", "customers", "id");

        assertThat(relationships()).isEmpty();
        assertThat(service.getTableRows("orders")).singleElement()
                .satisfies(row -> assertThat(row).containsEntry("total", 500));
        assertThat(tables()).extracting(TableInfo::getName).contains("orders", "customers");
    }

    @Test
    void droppingAKeyThatIsNotThere_shouldBeRefused() {
        assertThatThrownBy(() ->
                service.dropForeignKey("orders", "customer_id", "customers", "id"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("No relationship");
    }

    @Test
    void aCompositeForeignKey_shouldSurviveAnUnrelatedAdd() {
        service.executeQuery("""
                CREATE TABLE parts (
                    maker TEXT, code TEXT, PRIMARY KEY (maker, code)
                )""");
        service.executeQuery("""
                CREATE TABLE builds (
                    id INTEGER PRIMARY KEY,
                    part_maker TEXT, part_code TEXT, owner_id INTEGER,
                    FOREIGN KEY (part_maker, part_code) REFERENCES parts(maker, code)
                )""");

        service.addForeignKey("builds", "owner_id", "customers", "id", null);

        // The composite key is still one constraint over two columns, not two constraints.
        List<Relationship> partRels = relationships().stream()
                .filter(r -> "parts".equals(r.getTargetTable())).toList();
        assertThat(partRels).hasSize(2);
        assertThat(partRels).extracting(Relationship::getConstraintId)
                .containsOnly(partRels.get(0).getConstraintId());
    }

    @Test
    void uniquenessSurvives_soCardinalityStaysCorrect() {
        // The diagram reads `isUnique` to tell a 1:1 from a 1:N. If a rebuild drops the unique
        // index, a one-to-one silently becomes a one-to-many on screen.
        service.executeQuery("CREATE TABLE profiles (user_id INTEGER UNIQUE, bio TEXT)");

        service.addForeignKey("profiles", "user_id", "customers", "id", null);

        ColumnInfo userId = tables().stream()
                .filter(t -> t.getName().equals("profiles")).findFirst().orElseThrow()
                .getColumns().stream()
                .filter(c -> c.getName().equals("user_id")).findFirst().orElseThrow();
        assertThat(userId.isUnique()).isTrue();
    }
}
