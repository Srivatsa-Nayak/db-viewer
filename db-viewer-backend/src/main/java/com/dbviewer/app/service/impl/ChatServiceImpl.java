package com.dbviewer.app.service.impl;

import com.dbviewer.app.auth.AuthContext;
import com.dbviewer.app.dto.ColumnInfo;
import com.dbviewer.app.dto.Relationship;
import com.dbviewer.app.dto.TableInfo;
import com.dbviewer.app.llm.ChatTurn;
import com.dbviewer.app.llm.LlmClient;
import com.dbviewer.app.llm.StreamResult;
import com.dbviewer.app.llm.SystemPrompt;
import com.dbviewer.app.service.ApiKeyService;
import com.dbviewer.app.service.ChatService;
import com.dbviewer.app.service.DatabaseService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;

/**
 * Builds the assistant's prompt from the schema of the file the user has open.
 *
 * <h2>Why there is no retrieval here</h2>
 *
 * <p>This is a port of a document chatbot, and the half that was deliberately left behind is its
 * retrieval pipeline — chunking, embeddings, a vector store, nearest-neighbour search. All of
 * that exists to find the relevant few thousand words inside a PDF that cannot fit in a prompt.
 * A schema is not a document: it is already structured, already in memory, and a hundred tables
 * serialise to a few tens of kilobytes. Retrieval over it would be slower, lossier and less
 * accurate than handing the model the whole thing, and it would introduce the one failure mode
 * this assistant must not have — answering about a table while a related one was not retrieved.
 *
 * <h2>What is deliberately not sent</h2>
 *
 * <p>No row values, ever. The schema comes from {@link DatabaseService#getSchemaInfo()}, which
 * never reads a row. The assistant's job is to reason about structure, which the structure alone
 * supports, and row data is the user's — sending it to a third-party model vendor is not
 * something an app should do as a side effect of a question about column names.
 *
 * <h2>Why the prompt has two halves</h2>
 *
 * <p>Instructions first, schema second ({@link SystemPrompt}). The instructions never change,
 * and the schema only changes when the file does, so a provider's prompt cache can serve both on
 * every turn after the first. Nothing that varies per request — a timestamp, the question — may
 * go into either half, or the cache never hits.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ChatServiceImpl implements ChatService {

    /**
     * How much schema text the prompt will carry.
     *
     * <p>Generous enough for several hundred tables. The cap exists so that a pathological file
     * produces an answer that says which tables it could not see, rather than a provider-side
     * error about context length that says nothing useful.
     */
    static final int MAX_SCHEMA_CHARS = 60_000;

    /** The list of omitted table names is itself capped, or a 5,000-table file would blow the budget. */
    private static final int MAX_OMITTED_LIST_CHARS = 2_000;

    /**
     * Turns of history sent back. Enough for "and what about the other one?" to resolve, short
     * enough that a long session does not quietly become an expensive one — the schema block is
     * re-sent every turn, so history is not the only thing paying for length.
     */
    private static final int MAX_HISTORY_TURNS = 8;

    /** A single question cannot be longer than this. Nothing legitimate is. */
    static final int MAX_MESSAGE_CHARS = 4_000;

    private final DatabaseService databaseService;
    private final ApiKeyService apiKeyService;
    private final LlmClient llmClient;

    @Value("${app.db.driver:sqlite}")
    private String dbDriver;

    @Override
    public ChatPrompt prepare(String message, List<ChatTurn> history) {
        if (message == null || message.isBlank()) {
            throw new IllegalArgumentException("Type a question first.");
        }
        String question = message.strip();
        if (question.length() > MAX_MESSAGE_CHARS) {
            throw new IllegalArgumentException(
                    "That question is too long. Keep it under " + MAX_MESSAGE_CHARS + " characters.");
        }

        Schema schema = readSchema();
        RenderedSchema rendered = renderSchema(schema, MAX_SCHEMA_CHARS);

        List<ChatTurn> messages = new ArrayList<>(trimHistory(history));
        messages.add(ChatTurn.user(question));

        return new ChatPrompt(
                apiKeyService.resolve(),
                new SystemPrompt(instructions(), schemaSection(rendered, schema.tables.size())),
                List.copyOf(messages),
                schema.tables.size(),
                rendered.omitted(),
                AuthContext.get());
    }

    @Override
    public StreamResult stream(ChatPrompt prompt, Consumer<String> onFragment) {
        return llmClient.stream(
                prompt.credentials(), prompt.system(), prompt.messages(), onFragment);
    }

    /* ------------------------------------------------------------------ *
     * History
     * ------------------------------------------------------------------ */

    /**
     * Keeps the last few usable turns.
     *
     * <p>Filtered rather than trusted: the history arrives from the browser, so a caller could
     * put anything in it — including a fabricated {@code system} turn. Only {@code user} and
     * {@code assistant} turns with actual text survive, which is the same guard the document
     * chatbot applied for the same reason.
     */
    private List<ChatTurn> trimHistory(List<ChatTurn> history) {
        if (history == null || history.isEmpty()) {
            return List.of();
        }
        List<ChatTurn> usable = history.stream()
                .filter(turn -> turn != null && turn.isUsable())
                .map(turn -> turn.content().length() > MAX_MESSAGE_CHARS
                        ? new ChatTurn(turn.role(), turn.content().substring(0, MAX_MESSAGE_CHARS))
                        : turn)
                .toList();
        List<ChatTurn> recent = usable.size() <= MAX_HISTORY_TURNS
                ? usable
                : usable.subList(usable.size() - MAX_HISTORY_TURNS, usable.size());
        // Start on a user turn. Some providers reject a conversation that opens with the
        // assistant, and the cap above can cut a pair in half.
        int first = 0;
        while (first < recent.size() && !"user".equals(recent.get(first).role())) {
            first++;
        }
        return recent.subList(first, recent.size());
    }

    /* ------------------------------------------------------------------ *
     * Schema
     * ------------------------------------------------------------------ */

    /** The structure of the open file. Rows are not part of it. */
    record Schema(List<TableInfo> tables, List<Relationship> relationships,
                  Map<String, List<String>> indexes, Map<String, String> views,
                  Map<String, List<String>> notes) {
    }

    /**
     * @param text     what goes into the prompt
     * @param omitted  tables that did not fit, in schema order
     */
    record RenderedSchema(String text, List<String> omitted) {
    }

    @SuppressWarnings("unchecked")
    private Schema readSchema() {
        Map<String, Object> info;
        try {
            info = databaseService.getSchemaInfo();
        } catch (Exception e) {
            // An unopened or unreadable workspace is not an error worth refusing the question
            // over — "what does this app do?" needs no schema at all.
            log.debug("No schema available for the chat prompt: {}", e.getMessage());
            return new Schema(List.of(), List.of(), Map.of(), Map.of(), Map.of());
        }

        return new Schema(
                (List<TableInfo>) info.getOrDefault("tables", List.of()),
                (List<Relationship>) info.getOrDefault("relationships", List.of()),
                (Map<String, List<String>>) info.getOrDefault("indexes", Map.of()),
                (Map<String, String>) info.getOrDefault("views", Map.of()),
                readNotes());
    }

    /**
     * The user's own notes on each table, keyed by table name.
     *
     * <p>Included because they are the one part of the file that records intent rather than
     * structure — "this is denormalised on purpose", "drop after the migration" — and an
     * assistant that suggests normalising a table the user has already explained is worse than
     * no assistant. Open items only; a note that has been ticked off is history.
     */
    private Map<String, List<String>> readNotes() {
        Map<String, List<String>> byTable = new LinkedHashMap<>();
        try {
            for (Map<String, Object> note : databaseService.getAllTableNotes()) {
                Object done = note.get("done");
                boolean isDone = done != null
                        && !"0".equals(String.valueOf(done))
                        && !"false".equalsIgnoreCase(String.valueOf(done));
                if (isDone) {
                    continue;
                }
                String table = String.valueOf(note.get("table_name"));
                String text = String.valueOf(note.get("note"));
                byTable.computeIfAbsent(table, t -> new ArrayList<>()).add(text);
            }
        } catch (Exception e) {
            log.debug("Could not read table notes for the chat prompt: {}", e.getMessage());
        }
        return byTable;
    }

    /**
     * Renders the schema as text, a whole table at a time, within {@code budget} characters.
     *
     * <p>Written as compact DDL-ish lines rather than as JSON. A model has read far more SQL than
     * it has read this application's JSON shapes, and the line
     * {@code author_id INTEGER NOT NULL -> authors.id} states in one place what the JSON spreads
     * over a column object and a separate relationship array.
     *
     * <p>When the schema does not fit, whole tables are left out — never half of one — and the
     * omitted names are listed, so the model can say "I can't see {@code t41}" instead of
     * claiming it does not exist. The RELATIONSHIPS section is budgeted first, because it is the
     * part a question about how tables connect needs, and it used to be the first thing cut.
     */
    RenderedSchema renderSchema(Schema schema, int budget) {
        if (schema.tables.isEmpty()) {
            return new RenderedSchema("The user has no tables in the file they currently have open. "
                    + "It is either empty or no file is open.", List.of());
        }

        Map<String, Relationship> fkByColumn = new LinkedHashMap<>();
        for (Relationship rel : schema.relationships) {
            if (rel.getSourceTable() != null && rel.getSourceColumn() != null) {
                fkByColumn.put(rel.getSourceTable() + "." + rel.getSourceColumn(), rel);
            }
        }

        String header = "ENGINE: " + engineName() + "\n\nTABLES\n======\n";
        String relationships = renderRelationships(schema.relationships);
        // Relationships get at most a third of the budget, so a file of nothing but foreign keys
        // still leaves room for the tables they join.
        if (relationships.length() > budget / 3) {
            int cut = relationships.lastIndexOf('\n', budget / 3);
            relationships = relationships.substring(0, Math.max(cut, 0))
                    + "\n  … more relationships not shown\n";
        }

        StringBuilder tables = new StringBuilder();
        List<String> omitted = new ArrayList<>();
        int remaining = budget - header.length() - relationships.length() - MAX_OMITTED_LIST_CHARS;
        for (TableInfo table : schema.tables) {
            String block = renderTable(table, fkByColumn, schema);
            if (omitted.isEmpty() && block.length() <= remaining) {
                tables.append(block);
                remaining -= block.length();
            } else {
                // Once one table is skipped, every later one is too: a gap in the middle of the
                // list reads as a table that does not exist.
                omitted.add(table.getName());
            }
        }

        StringBuilder out = new StringBuilder(header).append(tables);
        if (!omitted.isEmpty()) {
            String names = String.join(", ", omitted);
            if (names.length() > MAX_OMITTED_LIST_CHARS - 200) {
                names = names.substring(0, MAX_OMITTED_LIST_CHARS - 200) + ", …";
            }
            out.append("-- ").append(omitted.size())
                    .append(" more table(s) exist but were too large to include here: ")
                    .append(names).append('\n')
                    .append("-- If a question is about one of these, say you cannot see its columns.\n\n");
        }
        out.append(relationships);
        return new RenderedSchema(out.toString(), List.copyOf(omitted));
    }

    private String renderTable(TableInfo table, Map<String, Relationship> fkByColumn, Schema schema) {
        StringBuilder out = new StringBuilder();
        out.append(table.isView() ? "VIEW " : "TABLE ").append(table.getName()).append('\n');
        for (ColumnInfo column : columnsOf(table)) {
            out.append("  ").append(column.getName()).append(' ').append(column.getType());
            if (column.isPk()) {
                out.append(" PRIMARY KEY");
            }
            if (column.isAutoIncrement()) {
                out.append(" AUTOINCREMENT");
            }
            if (column.isNotNull() && !column.isPk()) {
                out.append(" NOT NULL");
            }
            if (column.isUnique() && !column.isPk()) {
                out.append(" UNIQUE");
            }
            if (column.getDefaultValue() != null && !column.getDefaultValue().isBlank()) {
                out.append(" DEFAULT ").append(column.getDefaultValue());
            }
            Relationship fk = fkByColumn.get(table.getName() + "." + column.getName());
            if (fk != null) {
                out.append("  -> ").append(fk.getTargetTable())
                        .append('.').append(fk.getTargetColumn());
                if (fk.getOnDelete() != null && !fk.getOnDelete().isBlank()) {
                    out.append(" ON DELETE ").append(fk.getOnDelete());
                }
            }
            out.append('\n');
        }

        // Indexes, so "which columns should be indexed?" is answered against the ones that exist
        // rather than by recommending them again.
        List<String> indexes = schema.indexes.get(table.getName());
        if (indexes != null) {
            for (String index : indexes) {
                out.append("  ").append(index).append('\n');
            }
        } else if (!table.isView()) {
            out.append("  -- no indexes beyond the primary key and UNIQUE columns\n");
        }

        String definition = schema.views.get(table.getName());
        if (definition != null) {
            out.append("  -- definition: ").append(definition.replaceAll("\\s+", " ")).append('\n');
        }

        List<String> notes = schema.notes.get(table.getName());
        if (notes != null && !notes.isEmpty()) {
            out.append("  -- the user's open notes on this table:\n");
            for (String note : notes) {
                out.append("  --   ").append(note.replace('\n', ' ')).append('\n');
            }
        }
        return out.append('\n').toString();
    }

    private String renderRelationships(List<Relationship> relationships) {
        if (relationships.isEmpty()) {
            return "";
        }
        StringBuilder out = new StringBuilder("RELATIONSHIPS\n=============\n");
        for (Relationship rel : relationships) {
            out.append("  ").append(rel.getSourceTable()).append('.')
                    .append(rel.getSourceColumn()).append(" -> ")
                    .append(rel.getTargetTable()).append('.')
                    .append(rel.getTargetColumn()).append('\n');
        }
        return out.toString();
    }

    private List<ColumnInfo> columnsOf(TableInfo table) {
        return table.getColumns() == null ? List.of() : table.getColumns();
    }

    private boolean isMysql() {
        return "mysql".equalsIgnoreCase(dbDriver);
    }

    private String engineName() {
        return isMysql() ? "MySQL" : "SQLite";
    }

    private String schemaSection(RenderedSchema rendered, int tableCount) {
        return String.join("\n", List.of(
                "SCHEMA",
                "======",
                rendered.omitted().isEmpty()
                        ? tableCount + " table(s) in the open file."
                        : tableCount + " table(s) in the open file; " + rendered.omitted().size()
                                + " could not be included in full.",
                rendered.text()));
    }

    /* ------------------------------------------------------------------ *
     * The prompt
     * ------------------------------------------------------------------ */

    /**
     * The assistant's instructions — the half of the system prompt that never changes.
     *
     * <p>The grounding rules are carried over from the document chatbot's {@code SYSTEM_PROMPT},
     * because they solve the same problem in a different domain: the model must answer from what
     * it was given and say plainly when the answer is not there. "This schema has no index on
     * {@code orders.customer_id}" is useful; an invented column name is worse than silence,
     * because the user will go looking for it.
     *
     * <p>Depends on nothing but the engine, which is fixed for the life of the process, so it is
     * byte-identical on every call — the precondition for prompt caching.
     */
    String instructions() {
        List<String> lines = new ArrayList<>(List.of(
                "You are the schema assistant built into DB Viewer, a web app for importing,",
                "designing, visualising and exporting relational database schemas.",
                "",
                "WHAT YOU HELP WITH",
                "- Explaining the schema the user has open: what the tables are, how they relate,",
                "  where the normalisation or indexing problems are.",
                "- Designing new tables and columns, written as SQL the user can review and run.",
                "- Explaining what DB Viewer itself can do, described under THE APP below.",
                "",
                "RULES",
                "- Answer from the SCHEMA block below. It is the complete structure of the file the",
                "  user has open - if something is not in it, it does not exist in their database.",
                "  If the block says some tables were too large to include, you cannot see those",
                "  tables' columns: say so rather than guessing.",
                "- Never invent a table, column, index or relationship. If the answer is not in the",
                "  schema, say so plainly and name what is missing.",
                "- Each table lists its indexes. Before recommending an index, check it is not",
                "  already there.",
                "- You are shown structure only. You cannot see any row values, so never claim",
                "  anything about the data a table contains. If asked, say that you only see the",
                "  schema, and point at the table's Edit data dialog.",
                "- The schema is the file as it is now. Earlier turns of this conversation may",
                "  describe it before the user ran your SQL; when they disagree, the schema wins.",
                "- When you propose schema changes, put the SQL in a single ```sql fenced block.",
                "  The user reviews it and runs it themselves in the SQL scratchpad (at most 50",
                "  statements per run); you cannot run anything. Write it for the ENGINE named in",
                "  the schema block, following ENGINE NOTES below.",
                "- Write complete, runnable statements - no placeholders like <table_name>.",
                "",
                "STYLE",
                "- Lead with the answer in a sentence or two, then any detail, then any SQL.",
                "- Short paragraphs or bullets; at most about eight bullets in a list.",
                "- No preamble such as \"Based on the schema provided\" and no closing offer to",
                "  help further.",
                "",
                "ENGINE NOTES"));
        lines.addAll(isMysql() ? List.of(
                "- MySQL 8. Auto-increment keys are INT AUTO_INCREMENT PRIMARY KEY.",
                "- Change a column with ALTER TABLE t MODIFY COLUMN c <new definition>; add a",
                "  foreign key with ALTER TABLE t ADD CONSTRAINT fk_name FOREIGN KEY (...)",
                "  REFERENCES p(...).")
                : List.of(
                "- SQLite. Auto-increment keys are INTEGER PRIMARY KEY AUTOINCREMENT. Types are",
                "  INTEGER, TEXT, REAL, NUMERIC and BLOB; VARCHAR(n) is accepted but not enforced.",
                "- SQLite's ALTER TABLE can only ADD COLUMN, RENAME TO, RENAME COLUMN and DROP",
                "  COLUMN. It cannot change a column's type, NOT NULL, default or foreign keys,",
                "  and there is no ALTER COLUMN, MODIFY or DROP CONSTRAINT. To make such a change,",
                "  write the rebuild: CREATE TABLE t_new (...); INSERT INTO t_new (cols) SELECT",
                "  cols FROM t; DROP TABLE t; ALTER TABLE t_new RENAME TO t; then recreate t's",
                "  indexes. Mention that the canvas's Edit column dialog does this for them for a",
                "  single column."));
        lines.addAll(List.of(
                "",
                "THE APP",
                "DB Viewer imports .sql dumps and CSV files (with a preview step that lets the user",
                "correct inferred column types before anything is created), draws the schema as a",
                "React Flow canvas with orthogonal edges and crow's-foot cardinality, and exports to",
                "SQL for a chosen engine, PNG, Mermaid or DBML. On the canvas the user can create",
                "tables and columns, drag between two columns to create a real foreign key, colour",
                "and tag tables, lasso tables into named domain groups, search with Ctrl+F, undo",
                "layout and reversible schema changes with Ctrl+Z, and delete a table - which leaves",
                "a ghost node with an Undo button for seven seconds before the drop actually runs.",
                "Each open file is an isolated workspace with its own database. A free account is",
                "needed to export, to create a read-only share link, to use the SQL scratchpad, and",
                "to talk to you. Notes can be attached to any table."));
        return String.join("\n", lines);
    }
}
