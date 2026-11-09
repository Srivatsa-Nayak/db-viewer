package com.dbviewer.app.service.impl;

import com.dbviewer.app.dto.ColumnInfo;
import com.dbviewer.app.dto.Relationship;
import com.dbviewer.app.dto.TableInfo;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * How a schema too large for the prompt is cut down.
 *
 * <p>It used to be a plain substring at 60,000 characters: it could end mid-column, and the
 * RELATIONSHIPS section, coming last, was the first thing lost. Now whole tables are dropped and
 * named, and the relationships are kept.
 */
class ChatSchemaRenderTest {

    private final ChatServiceImpl service = new ChatServiceImpl(null, null, null);

    private static TableInfo table(String name, int columns) {
        List<ColumnInfo> cols = new ArrayList<>();
        for (int i = 0; i < columns; i++) {
            ColumnInfo c = new ColumnInfo();
            c.setName("column_number_" + i);
            c.setType("TEXT");
            cols.add(c);
        }
        return TableInfo.builder().name(name).columns(cols).rows(List.of()).build();
    }

    private static ChatServiceImpl.Schema schemaOf(int tables) {
        List<TableInfo> list = new ArrayList<>();
        List<Relationship> rels = new ArrayList<>();
        for (int i = 0; i < tables; i++) {
            list.add(table("table_" + i, 30));
            if (i > 0) {
                rels.add(Relationship.builder().sourceTable("table_" + i).sourceColumn("column_number_0")
                        .targetTable("table_0").targetColumn("column_number_0").build());
            }
        }
        return new ChatServiceImpl.Schema(list, rels, Map.of(), Map.of(), Map.of());
    }

    @Test
    void aSchemaThatFitsIsSentWhole() {
        ChatServiceImpl.RenderedSchema rendered = service.renderSchema(schemaOf(3), 60_000);

        assertThat(rendered.omitted()).isEmpty();
        assertThat(rendered.text()).contains("TABLE table_2").contains("RELATIONSHIPS");
    }

    @Test
    void anOversizedSchemaDropsWholeTablesNamesThemAndKeepsRelationships() {
        ChatServiceImpl.RenderedSchema rendered = service.renderSchema(schemaOf(200), 20_000);

        assertThat(rendered.omitted()).isNotEmpty();
        assertThat(rendered.text().length()).isLessThanOrEqualTo(20_000);
        // Named, so the model can say which tables it cannot see.
        assertThat(rendered.text()).contains("too large to include here: table_");
        assertThat(rendered.text()).contains(rendered.omitted().get(0));
        // The relationships survive the cut, which the old substring never allowed.
        assertThat(rendered.text()).contains("RELATIONSHIPS").contains("table_1.column_number_0 -> table_0");
        // No table is cut in half: the last table included still has its last column.
        String last = "TABLE table_" + (200 - rendered.omitted().size() - 1) + "\n";
        int at = rendered.text().indexOf(last);
        assertThat(at).isPositive();
        assertThat(rendered.text().substring(at)).contains("column_number_29");
    }
}
