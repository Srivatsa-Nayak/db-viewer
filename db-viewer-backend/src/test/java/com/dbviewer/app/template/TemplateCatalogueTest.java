package com.dbviewer.app.template;

import com.dbviewer.app.service.TemplateService;
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
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * The starter-schema catalogue.
 *
 * <p>Every template is applied for real against SQLite rather than merely listed: a template that
 * parses but does not execute would reach the landing page looking perfectly healthy and only fail
 * when someone actually clicked it.
 */
@SpringBootTest
@TestPropertySource(properties = {
        "spring.datasource.url=jdbc:sqlite::memory:",
        "spring.datasource.driver-class-name=org.sqlite.JDBC",
        "app.db.driver=sqlite"
})
class TemplateCatalogueTest {

    @Autowired
    private TemplateService templateService;

    @Autowired
    private DatabaseServiceImpl databaseService;

    @BeforeEach
    void openWorkspace() {
        WorkspaceContext.set("tpl" + UUID.randomUUID().toString().replace("-", ""));
    }

    @AfterEach
    void closeWorkspace() {
        databaseService.deleteWorkspace();
        WorkspaceContext.clear();
    }

    @SuppressWarnings("unchecked")
    private List<TableInfo> tables() {
        return (List<TableInfo>) databaseService.getDbInfo().get("tables");
    }

    @Test
    void catalogue_shouldNotBeEmptyAndShouldDescribeEachTemplate() {
        List<TemplateService.Template> templates = templateService.list();

        assertThat(templates).isNotEmpty();
        assertThat(templates).allSatisfy(t -> {
            assertThat(t.id()).isNotBlank();
            assertThat(t.name()).isNotBlank();
            assertThat(t.description()).isNotBlank();
            assertThat(t.category()).isNotBlank();
            // The card shows these counts, so they must be real rather than placeholders.
            assertThat(t.tableCount()).isGreaterThan(0);
            assertThat(t.tables()).hasSize(t.tableCount());
            // SQL bodies are withheld from the list response - they would bloat it for nothing.
            assertThat(t.sql()).isNull();
        });
    }

    @Test
    void everyTemplate_shouldActuallyApply() {
        for (TemplateService.Template summary : templateService.list()) {
            // A fresh workspace per template: applying refuses on a non-empty one.
            WorkspaceContext.set("tpl" + UUID.randomUUID().toString().replace("-", ""));

            templateService.apply(summary.id());

            assertThat(tables())
                    .as("tables created by template '%s'", summary.id())
                    .extracting(TableInfo::getName)
                    .containsExactlyInAnyOrderElementsOf(summary.tables());

            databaseService.deleteWorkspace();
        }
    }

    @Test
    void everyTemplate_shouldProduceRelationshipsForTheDiagram() {
        for (TemplateService.Template summary : templateService.list()) {
            WorkspaceContext.set("tpl" + UUID.randomUUID().toString().replace("-", ""));
            templateService.apply(summary.id());

            // Foreign keys are what the canvas draws edges from. A template without them would
            // render as a row of disconnected boxes, which defeats the point of showing one.
            assertThat((List<?>) databaseService.getDbInfo().get("relationships"))
                    .as("relationships in template '%s'", summary.id())
                    .isNotEmpty();

            databaseService.deleteWorkspace();
        }
    }

    @Test
    void everyTemplate_shouldIncludeSampleRows() {
        for (TemplateService.Template summary : templateService.list()) {
            WorkspaceContext.set("tpl" + UUID.randomUUID().toString().replace("-", ""));
            templateService.apply(summary.id());

            // An empty template teaches nothing about the data, only the shape.
            assertThat(tables())
                    .as("tables with rows in template '%s'", summary.id())
                    .anyMatch(t -> !t.getRows().isEmpty());

            databaseService.deleteWorkspace();
        }
    }

    @Test
    void statedCounts_shouldMatchWhatTheTemplateActuallyCreates() {
        for (TemplateService.Template summary : templateService.list()) {
            WorkspaceContext.set("tpl" + UUID.randomUUID().toString().replace("-", ""));
            templateService.apply(summary.id());

            // The card's numbers are counted from the SQL text, so they can drift from reality.
            // They originally did: a header comment containing the words "foreign keys" was
            // counted as a relationship, so the Online Store card claimed 9 instead of 8.
            assertThat(tables())
                    .as("table count stated by template '%s'", summary.id())
                    .hasSize(summary.tableCount());
            assertThat((List<?>) databaseService.getDbInfo().get("relationships"))
                    .as("relationship count stated by template '%s'", summary.id())
                    .hasSize(summary.relationshipCount());

            databaseService.deleteWorkspace();
        }
    }

    @Test
    @SuppressWarnings("unchecked")
    void parsedSchema_shouldMatchTheDatabaseTheTemplateActuallyCreates() {
        // The preview draws its diagram from TemplateSchemaParser rather than from a real
        // database, so the parser is only trustworthy while this holds. Applying each template
        // and comparing against the live metadata is what keeps a hand-written parser honest:
        // if a template is ever authored in a style it mishandles, this fails rather than the
        // preview quietly showing the wrong shape.
        for (TemplateService.Template summary : templateService.list()) {
            WorkspaceContext.set("tpl" + UUID.randomUUID().toString().replace("-", ""));

            TemplateService.Template full = templateService.get(summary.id());
            templateService.apply(summary.id());

            Map<String, Object> info = databaseService.getDbInfo();
            List<TableInfo> actualTables = (List<TableInfo>) info.get("tables");
            List<Relationship> actualRelationships = (List<Relationship>) info.get("relationships");

            // Same tables, each with the same columns in the same order.
            assertThat(full.schema().tables())
                    .as("tables parsed from template '%s'", summary.id())
                    .extracting(TemplateService.TemplateTable::name)
                    .containsExactlyInAnyOrderElementsOf(
                            actualTables.stream().map(TableInfo::getName).toList());

            for (TemplateService.TemplateTable parsed : full.schema().tables()) {
                List<ColumnInfo> actualColumns = actualTables.stream()
                        .filter(t -> t.getName().equals(parsed.name()))
                        .findFirst().orElseThrow().getColumns();

                assertThat(parsed.columns())
                        .as("columns parsed for %s.%s", summary.id(), parsed.name())
                        .extracting(TemplateService.TemplateColumn::name)
                        .containsExactlyElementsOf(actualColumns.stream().map(ColumnInfo::getName).toList());

                // Primary keys drive the key icon in the preview.
                assertThat(parsed.columns().stream().filter(TemplateService.TemplateColumn::pk)
                                .map(TemplateService.TemplateColumn::name).toList())
                        .as("primary keys parsed for %s.%s", summary.id(), parsed.name())
                        .containsExactlyInAnyOrderElementsOf(
                                actualColumns.stream().filter(ColumnInfo::isPk)
                                        .map(ColumnInfo::getName).toList());
            }

            // And the same foreign keys, which become the edges.
            assertThat(full.schema().relationships())
                    .as("relationships parsed from template '%s'", summary.id())
                    .extracting(TemplateService.TemplateRelationship::sourceTable,
                            TemplateService.TemplateRelationship::sourceColumn,
                            TemplateService.TemplateRelationship::targetTable,
                            TemplateService.TemplateRelationship::targetColumn)
                    .containsExactlyInAnyOrderElementsOf(
                            actualRelationships.stream()
                                    .map(r -> org.assertj.core.groups.Tuple.tuple(
                                            r.getSourceTable(), r.getSourceColumn(),
                                            r.getTargetTable(), r.getTargetColumn()))
                                    .toList());

            databaseService.deleteWorkspace();
        }
    }

    @Test
    void listResponse_shouldOmitTheHeavyFields() {
        // The catalogue is fetched on first paint; shipping every SQL body and parsed schema
        // in it would be the single largest thing on the landing page.
        assertThat(templateService.list()).allSatisfy(t -> {
            assertThat(t.sql()).isNull();
            assertThat(t.schema()).isNull();
        });
        assertThat(templateService.get("ecommerce").schema()).isNotNull();
    }

    @Test
    void get_shouldIncludeTheSqlBody() {
        TemplateService.Template template = templateService.get("ecommerce");

        assertThat(template.sql()).contains("CREATE TABLE");
        assertThat(template.relationshipCount()).isGreaterThan(0);
    }

    @Test
    void get_withAnUnknownId_shouldThrow() {
        assertThatThrownBy(() -> templateService.get("no-such-template"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("No template");
    }

    @Test
    void apply_toAWorkspaceThatAlreadyHasTables_shouldBeRefused() {
        templateService.apply("library");

        assertThatThrownBy(() -> templateService.apply("blog"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("already has tables");
    }

    @Test
    void categories_shouldBeDistinct() {
        List<String> categories = templateService.categories();

        assertThat(categories).isNotEmpty();
        assertThat(categories).doesNotHaveDuplicates();
    }
}
