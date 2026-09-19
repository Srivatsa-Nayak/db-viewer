package com.dbviewer.app.service;

import com.dbviewer.app.dto.ColumnInfo;
import com.dbviewer.app.dto.Relationship;
import com.dbviewer.app.dto.TableInfo;
import com.dbviewer.app.service.impl.DatabaseServiceImpl;
import com.dbviewer.app.workspace.WorkspaceContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.TestPropertySource;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The extra schema facts the diagram needs: uniqueness, defaults, auto-increment, and which
 * constraint a foreign key column belongs to.
 *
 * <p>Uniqueness is the one that matters most. It is what separates a one-to-one relationship from
 * a one-to-many, and {@code PRAGMA table_info} does not report it — so before this the canvas had
 * no way to draw the difference and every relationship looked the same.
 */
@SpringBootTest
@TestPropertySource(properties = {
        "spring.datasource.url=jdbc:sqlite::memory:",
        "spring.datasource.driver-class-name=org.sqlite.JDBC",
        "app.db.driver=sqlite"
})
class SchemaMetadataTest {

    @Autowired
    private DatabaseServiceImpl service;

    @BeforeEach
    void openWorkspace() {
        WorkspaceContext.set("schemameta" + UUID.randomUUID().toString().replace("-", ""));
    }

    @AfterEach
    void closeWorkspace() {
        service.deleteWorkspace();
        WorkspaceContext.clear();
    }

    @SuppressWarnings("unchecked")
    private List<TableInfo> tables() {
        return (List<TableInfo>) service.getDbInfo().get("tables");
    }

    @SuppressWarnings("unchecked")
    private List<Relationship> relationships() {
        return (List<Relationship>) service.getDbInfo().get("relationships");
    }

    private ColumnInfo column(String table, String name) {
        return tables().stream()
                .filter(t -> t.getName().equals(table)).findFirst().orElseThrow()
                .getColumns().stream()
                .filter(c -> c.getName().equals(name)).findFirst().orElseThrow();
    }

    @Test
    void solealPrimaryKey_shouldBeReportedAsUniqueAndAutoIncrementing() {
        service.executeQuery("""
                CREATE TABLE users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    email VARCHAR(255) UNIQUE,
                    status VARCHAR(20) NOT NULL DEFAULT 'active',
                    nickname VARCHAR(50)
                )""");

        assertThat(column("users", "id").isUnique()).isTrue();
        assertThat(column("users", "id").isAutoIncrement()).isTrue();
    }

    @Test
    void aUniqueColumn_shouldBeReportedAsUnique() {
        service.executeQuery("""
                CREATE TABLE users (
                    id INTEGER PRIMARY KEY,
                    email VARCHAR(255) UNIQUE,
                    nickname VARCHAR(50)
                )""");

        assertThat(column("users", "email").isUnique()).isTrue();
        // The control: an ordinary column must not be swept up by the same query.
        assertThat(column("users", "nickname").isUnique()).isFalse();
    }

    @Test
    void aCompositeKey_shouldMakeNeitherColumnUnique() {
        // The trap: either column of a composite key looks key-ish, but neither is unique on its
        // own. Calling one unique would draw a one-to-many as a one-to-one.
        service.executeQuery("""
                CREATE TABLE memberships (
                    user_id INTEGER NOT NULL,
                    group_id INTEGER NOT NULL,
                    PRIMARY KEY (user_id, group_id)
                )""");

        assertThat(column("memberships", "user_id").isUnique()).isFalse();
        assertThat(column("memberships", "group_id").isUnique()).isFalse();
    }

    @Test
    void aMultiColumnUniqueIndex_shouldMakeNeitherColumnUnique() {
        service.executeQuery("CREATE TABLE bookings (room INTEGER, day VARCHAR(10), note TEXT)");
        service.executeQuery("CREATE UNIQUE INDEX idx_room_day ON bookings (room, day)");

        assertThat(column("bookings", "room").isUnique()).isFalse();
        assertThat(column("bookings", "day").isUnique()).isFalse();
    }

    @Test
    void aSingleColumnUniqueIndex_shouldMakeThatColumnUnique() {
        service.executeQuery("CREATE TABLE bookings (room INTEGER, code VARCHAR(10), note TEXT)");
        service.executeQuery("CREATE UNIQUE INDEX idx_code ON bookings (code)");

        assertThat(column("bookings", "code").isUnique()).isTrue();
        assertThat(column("bookings", "note").isUnique()).isFalse();
        // A non-unique index must not count.
        service.executeQuery("CREATE INDEX idx_note ON bookings (note)");
        assertThat(column("bookings", "note").isUnique()).isFalse();
    }

    @Test
    void defaults_shouldBeReported() {
        service.executeQuery("""
                CREATE TABLE users (
                    id INTEGER PRIMARY KEY,
                    status VARCHAR(20) NOT NULL DEFAULT 'active',
                    score INTEGER DEFAULT 0,
                    nickname VARCHAR(50)
                )""");

        assertThat(column("users", "status").getDefaultValue()).isEqualTo("'active'");
        assertThat(column("users", "score").getDefaultValue()).isEqualTo("0");
        assertThat(column("users", "nickname").getDefaultValue()).isNull();
    }

    @Test
    void foreignKeys_shouldCarryTheirConstraintIdAndOnDeleteAction() {
        service.executeQuery("CREATE TABLE authors (id INTEGER PRIMARY KEY)");
        service.executeQuery("""
                CREATE TABLE books (
                    id INTEGER PRIMARY KEY,
                    author_id INTEGER REFERENCES authors(id) ON DELETE CASCADE
                )""");

        assertThat(relationships()).singleElement().satisfies(rel -> {
            assertThat(rel.getSourceTable()).isEqualTo("books");
            assertThat(rel.getTargetTable()).isEqualTo("authors");
            assertThat(rel.getConstraintId()).isNotNull();
            assertThat(rel.getOnDelete()).isEqualTo("CASCADE");
        });
    }

    @Test
    void noOnDeleteAction_shouldBeNullRatherThanTheLiteralNoAction() {
        // "NO ACTION" is what SQLite reports for "nothing was declared". Passing that through
        // would have the tooltip claim a behaviour the user never wrote.
        service.executeQuery("CREATE TABLE authors (id INTEGER PRIMARY KEY)");
        service.executeQuery("""
                CREATE TABLE books (
                    id INTEGER PRIMARY KEY,
                    author_id INTEGER REFERENCES authors(id)
                )""");

        assertThat(relationships()).singleElement()
                .extracting(Relationship::getOnDelete).isNull();
    }

    @Test
    void aCompositeForeignKey_shouldShareOneConstraintId() {
        service.executeQuery("""
                CREATE TABLE parts (
                    maker VARCHAR(20),
                    code VARCHAR(20),
                    PRIMARY KEY (maker, code)
                )""");
        service.executeQuery("""
                CREATE TABLE orders (
                    id INTEGER PRIMARY KEY,
                    part_maker VARCHAR(20),
                    part_code VARCHAR(20),
                    FOREIGN KEY (part_maker, part_code) REFERENCES parts(maker, code)
                )""");

        List<Relationship> rels = relationships();
        assertThat(rels).hasSize(2);
        // One relationship reported as two columns — the id is how the canvas knows to draw one
        // edge rather than two on top of each other.
        assertThat(rels).extracting(Relationship::getConstraintId).containsOnly(rels.get(0).getConstraintId());
    }

    @Test
    void aForeignKeyOnAUniqueColumn_shouldBeDistinguishableFromOneOnAPlainColumn() {
        // This is the whole point of the uniqueness work: these two relationships are drawn
        // differently (1:1 versus 1:N) and the only thing that separates them is `unique`.
        service.executeQuery("CREATE TABLE users (id INTEGER PRIMARY KEY)");
        service.executeQuery("""
                CREATE TABLE profiles (
                    user_id INTEGER UNIQUE REFERENCES users(id)
                )""");
        service.executeQuery("""
                CREATE TABLE posts (
                    id INTEGER PRIMARY KEY,
                    user_id INTEGER REFERENCES users(id)
                )""");

        assertThat(column("profiles", "user_id").isUnique()).isTrue();
        assertThat(column("posts", "user_id").isUnique()).isFalse();
    }
}
