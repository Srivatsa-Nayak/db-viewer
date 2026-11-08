package com.dbviewer.app.service.impl;

import com.dbviewer.app.dto.ColumnInfo;
import com.dbviewer.app.dto.Relationship;
import com.dbviewer.app.dto.TableInfo;
import com.dbviewer.app.llm.ChatTurn;
import com.dbviewer.app.llm.LlmClient;
import com.dbviewer.app.llm.StreamResult;
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
 * <p>No row values, ever. {@link DatabaseService#getDbInfo()} returns up to 100 rows per table
 * and every one of them is dropped here. The assistant's job is to reason about structure, which
 * the structure alone supports, and row data is the user's — sending it to a third-party model
 * vendor is not something an app should do as a side effect of a question about column names.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ChatServiceImpl implements ChatService {

    /**
     * How much schema text the prompt will carry.
     *
     * <p>Generous enough for several hundred tables. The cap exists so that a pathological file
     * produces a truncated answer that says it was truncated, rather than a provider-side error
     * about context length that says nothing useful.
     */
    private static final int MAX_SCHEMA_CHARS = 60_000;

    /**
     * Turns of history sent back. Enough for "and what about the other one?" to resolve, short
     * enough that a long session does not quietly become an expensive one — the schema block is
     * re-sent every turn, so history is not the only thing paying for length.
     */
    private static final int MAX_HISTORY_TURNS = 8;

    /** A single question cannot be longer than this. Nothing legitimate is. */
    private static final int MAX_MESSAGE_CHARS = 4_000;

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
        String schemaBlock = renderSchema(schema);
        boolean truncated = schemaBlock.length() > MAX_SCHEMA_CHARS;
        if (truncated) {
            schemaBlock = schemaBlock.substring(0, MAX_SCHEMA_CHARS)
                    + "\n\n… the schema was too large to include in full; "
                    + "later tables have been left out.";
        }

        List<ChatTurn> messages = new ArrayList<>(trimHistory(history));
        messages.add(ChatTurn.user(question));

        return new ChatPrompt(
                apiKeyService.resolve(),
                systemPrompt(schemaBlock, schema.tables.size(), truncated),
                List.copyOf(messages),
                schema.tables.size(),
                truncated);
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
        return usable.size() <= MAX_HISTORY_TURNS
                ? usable
                : usable.subList(usable.size() - MAX_HISTORY_TURNS, usable.size());
    }

    /* ------------------------------------------------------------------ *
     * Schema
     * ------------------------------------------------------------------ */

    /** The parts of {@code getDbInfo()} that are about structure. Rows are not among them. */
    private record Schema(List<TableInfo> tables, List<Relationship> relationships,
                          Map<String, List<String>> notes) {
    }

    @SuppressWarnings("unchecked")
    private Schema readSchema() {
        Map<String, Object> info;
        try {
            info = databaseService.getDbInfo();
        } catch (Exception e) {
            // An unopened or unreadable workspace is not an error worth refusing the question
            // over — "what does this app do?" needs no schema at all.
            log.debug("No schema available for the chat prompt: {}", e.getMessage());
            return new Schema(List.of(), List.of(), Map.of());
        }

        List<TableInfo> tables = (List<TableInfo>) info.getOrDefault("tables", List.of());
        List<Relationship> relationships =
                (List<Relationship>) info.getOrDefault("relationships", List.of());
        return new Schema(tables, relationships, readNotes());
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
     * Renders the schema as text.
     *
     * <p>Written as compact DDL-ish lines rather than as JSON. Both work, but a model has read
     * far more SQL than it has read this application's JSON shapes, and the line
     * {@code author_id INTEGER NOT NULL FK -> authors.id} states in one place what the JSON
     * spreads over a column object and a separate relationship array.
     */
    private String renderSchema(Schema schema) {
        if (schema.tables.isEmpty()) {
            return "The user has no tables in the file they currently have open. "
                    + "It is either empty or no file is open.";
        }

        // Indexed first so each column line can carry its own foreign key inline.
        Map<String, Relationship> fkByColumn = new LinkedHashMap<>();
        for (Relationship rel : schema.relationships) {
            if (rel.getSourceTable() != null && rel.getSourceColumn() != null) {
                fkByColumn.put(rel.getSourceTable() + "." + rel.getSourceColumn(), rel);
            }
        }

        StringBuilder out = new StringBuilder();
        out.append("ENGINE: ").append("mysql".equalsIgnoreCase(dbDriver) ? "MySQL" : "SQLite")
                .append("\n\nTABLES\n======\n");

        for (TableInfo table : schema.tables) {
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

            List<String> notes = schema.notes.get(table.getName());
            if (notes != null && !notes.isEmpty()) {
                out.append("  -- the user's open notes on this table:\n");
                for (String note : notes) {
                    out.append("  --   ").append(note.replace('\n', ' ')).append('\n');
                }
            }
            out.append('\n');
        }

        if (!schema.relationships.isEmpty()) {
            out.append("RELATIONSHIPS\n=============\n");
            for (Relationship rel : schema.relationships) {
                out.append("  ").append(rel.getSourceTable()).append('.')
                        .append(rel.getSourceColumn()).append(" -> ")
                        .append(rel.getTargetTable()).append('.')
                        .append(rel.getTargetColumn()).append('\n');
            }
        }
        return out.toString();
    }

    private List<ColumnInfo> columnsOf(TableInfo table) {
        return table.getColumns() == null ? List.of() : table.getColumns();
    }

    /* ------------------------------------------------------------------ *
     * The prompt
     * ------------------------------------------------------------------ */

    /**
     * The assistant's instructions.
     *
     * <p>The grounding rules are carried over from the document chatbot's {@code SYSTEM_PROMPT},
     * because they solve the same problem in a different domain: the model must answer from what
     * it was given and say plainly when the answer is not there. "This schema has no index on
     * {@code orders.customer_id}" is useful; an invented column name is worse than silence,
     * because the user will go looking for it.
     *
     * <p>The application description is here rather than in a document because the user asked
     * for an assistant that can also explain the app, and the app's own feature set is small,
     * stable and known at build time. Anything about it that changes belongs in this block.
     */
    private String systemPrompt(String schemaBlock, int tableCount, boolean truncated) {
        return String.join("\n", List.of(
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
                "- Never invent a table, column or relationship. If the answer is not in the schema,",
                "  say so plainly and name what is missing.",
                "- You are shown structure only. You cannot see any row values, so never claim",
                "  anything about the data a table contains. If asked, say that you only see the",
                "  schema, and point at the table's Edit data dialog.",
                "- When you propose schema changes, put the SQL in a single ```sql fenced block.",
                "  The user reviews it and runs it themselves in the SQL scratchpad; you cannot run",
                "  anything. Write it for the ENGINE named in the schema block.",
                "- Write complete, runnable statements - no placeholders like <table_name>.",
                "- Be concise. Short paragraphs or bullets. No preamble such as \"Based on the",
                "  schema provided\" and no closing offer to help further.",
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
                "to talk to you. Notes can be attached to any table.",
                "",
                "SCHEMA",
                "======",
                truncated
                        ? "(Too large to include in full - some tables are missing.)"
                        : tableCount + " table(s) in the open file.",
                schemaBlock));
    }
}
