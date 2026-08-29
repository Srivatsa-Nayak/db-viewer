# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # start dev server (http://localhost:3000)
npm run build    # production build
npm run start    # run production build
npm run lint     # eslint (flat config in eslint.config.mjs)
```

There is no test suite in this repo. There is no single-file lint/typecheck shortcut beyond `npm run lint`; use `npx tsc --noEmit` for a type-only check.

The backend (sibling directory `../db-viewer-backend`, Spring Boot / Java 17) must be running on port 8080 for the UI to do anything useful: `./mvnw spring-boot:run` (or `mvnw.cmd spring-boot:run` on Windows) from that directory. Swagger UI is at `http://localhost:8080/swagger-ui.html`.

## Environment

The backend base URL comes from `NEXT_PUBLIC_API_URL`, falling back to `http://localhost:8080` (`services/api.ts`). Env files present: `.env.local`, `.env.production`.

## Architecture

This is a Next.js (App Router) single-page workspace app for importing CSV/SQL files, visualizing schema as a graph, editing table data, and exporting. There is no in-app SQL query runner — that panel (`SqlEditor`/`ResultsTable`/`useQuery`, plus `dbService.runQuery`/`POST /query`) was removed; if it needs to come back, it must be re-added as a sibling of the canvas, not nested inside `Visualizer.tsx` (see the fixed-positioning note below). Nearly all state lives in one place:

- **`app/page.tsx`** is the owner of almost everything: `workspaces`, `activeWorkspaceId`, explorer open state, table-editing state, and upload/clear/error/info modal state. It also contains the schema→React-Flow transform (`transformSchemaToWorkspace`) and refresh logic. Start here for any workspace-level behavior change.
- **Workspaces are frontend-only state.** The backend holds one active database context at a time — there is no backend concept of multiple workspaces. Be careful with any change that assumes per-workspace backend isolation; switching workspaces in the UI does not switch backend state.
- **`services/api.ts`** centralizes every backend call (`dbService`). Check/extend this before adding new API calls anywhere else. Endpoints: `POST /upload`, `POST /alter-table`, `GET /db-info`, `GET /export/{tableName}`, `GET /table-data/{tableName}`, `POST /update-cell`, `POST /insert-row`, `POST /delete-row`, `DELETE /clear`, `GET /export-sql`, `POST /create-table`. Most cache-sensitive reads append a `_t`/`t` timestamp query param to bust caching.
- **`types/index.ts`** holds the shared types (`ColumnInfo`, `TableInfo`, `Relationship`, `SchemaResponse`, `TableDataResponse`). Some components already rely on fields not declared here (e.g. `is_pk`, `target_column`) — when you touch backend response shapes, update this file and the consuming components together rather than trusting the interface as ground truth.
- **`components/canvas/Visualizer.tsx`** + **`components/tables/TableNode.tsx`**: the React Flow schema canvas, light-theme only (the dark/system toggle was removed — it only ever restyled the canvas/table nodes, never the rest of the chrome, and looked inconsistent). `TableNode` infers PK/FK handles purely from column naming convention (`id` / `*_id`), not from real metadata — a column literally named `id` or ending in `_id` gets treated as a key. React Flow's own edge-creation handlers in `app/page.tsx` are currently no-ops, so dragging a new relationship in the canvas does not persist anything to the backend.
- **Fixed-position modals must not be nested inside an animated/transformed ancestor.** `Visualizer.tsx`'s canvas wrapper has `animate-fade-up`, which sets a CSS `transform` — any `position: fixed` descendant then gets contained by that element's box instead of the viewport, silently shrinking to the canvas pane's width instead of centering on the full screen. `CreateTableModal` and the in-canvas help modal are rendered as siblings of that wrapper (via a `<>...</>` fragment) specifically to avoid this. Keep any new fixed-position modal a sibling of, not a child of, elements carrying `animate-fade-up` or other `transform`-affecting classes.
- **`components/editor/DataEditor.tsx`**: row view/edit/add/delete modal. Update/delete paths assume every row has an `id` or `ID` field.
- **`hooks/useSchema.ts`** is a legacy/alternate schema-state hook — the live app duplicates this logic directly in `app/page.tsx` instead of using it. Don't assume it's on the active code path.
- **Styling**: Tailwind v4 via CSS import (`app/globals.css`), not the JS config content-globbing convention — `tailwind.config.js` still lists `./src/**` paths that don't exist in this project (no `src/` dir) and appears to be vestigial from scaffolding. The UI is a fixed blue header / white body / blue-accent theme — there is no dark mode.
- **Font**: JetBrains Mono is loaded via `next/font/google` in `app/layout.tsx` and wired into Tailwind's `--font-mono` variable in `globals.css`, so every existing `font-mono` utility class (table/column names, filenames, zoom %, Monaco's `fontFamily`) picks it up automatically — don't hardcode a separate font-family per component.

## Suggested change workflow

1. Start from `app/page.tsx` for anything workspace-level.
2. Check `services/api.ts` before adding/changing a backend call, and confirm the endpoint exists on the backend side (`../db-viewer-backend`, controllers under `src/main/java/com/dbviewer/controller/`).
3. Update `types/index.ts` when relying on new backend response fields.
4. Run `npm run lint` after TypeScript/component edits.
