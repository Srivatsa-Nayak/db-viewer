# SQL Visualizer — Frontend

Next.js 16 (App Router) single-page workspace for importing `.csv`/`.sql` files, visualizing their
schema as an interactive entity-relationship canvas, editing tables and rows, and exporting the
result.

> **Repo-level docs:** [root README](../README.md) ·
> [System design](../docs/SYSTEM-DESIGN.md) · [Database design](../docs/DATABASE-DESIGN.md) ·
> [Frontend gotchas & change workflow](CLAUDE.md)

---

## Contents

- [Getting started](#getting-started)
- [Scripts](#scripts)
- [Environment](#environment)
- [Project structure](#project-structure)
- [Architecture](#architecture)
  - [State ownership](#state-ownership)
  - [Workspaces](#workspaces)
  - [The API boundary](#the-api-boundary)
  - [Schema → canvas transform](#schema--canvas-transform)
- [Component guide](#component-guide)
- [Styling](#styling)
- [Gotchas](#gotchas)
- [Adding a feature](#adding-a-feature)

---

## Getting started

The backend must be running first — the UI does nothing useful without it.

```bash
# Terminal 1 — backend on :8080
cd ../db-viewer-backend
./mvnw spring-boot:run          # Windows: mvnw.cmd spring-boot:run

# Terminal 2 — frontend on :3000
npm install
npm run dev
```

Open <http://localhost:3000>, then either **Import** a `.csv`/`.sql` file or click **Create New
File** to start from an empty database.

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on <http://localhost:3000> (Turbopack) |
| `npm run build` | Production build — `output: "standalone"` for Azure |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint (flat config in `eslint.config.mjs`) |
| `npx tsc --noEmit` | Type-only check |

There is **no test suite**. `npx tsc --noEmit`, `npm run lint` and `npm run build` are the gates —
run all three before pushing.

---

## Environment

| Variable | Default | Notes |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `http://localhost:8080` | Backend base URL, read in `services/api.ts` |

Files present: `.env.local` (local dev) and `.env.production` (the deployed Azure API).

⚠️ `NEXT_PUBLIC_*` values are **inlined at build time**. Changing the API URL requires restarting
`npm run dev` or rebuilding — a restart of the running server is not enough.

---

## Project structure

```
db-viewer-ui/
├── app/
│   ├── layout.tsx              Root layout; Inter + Geist Mono via next/font
│   ├── page.tsx                Landing page (/) — hero, features, templates
│   ├── app/page.tsx            ★ The editor (/app); owns all application state
│   ├── share/[token]/page.tsx  Read-only view of a shared file (renders its own handles)
│   └── globals.css             Tailwind v4 entry + design tokens
├── components/
│   ├── header/Header.tsx           Import / refresh / export / clear / help
│   ├── editor/
│   │   ├── FileExplorer.tsx        Left tree: files → tables → columns; search; collapse
│   │   └── DataEditor.tsx          Row view / cell + whole-row edit / insert / delete modal
│   ├── canvas/Visualizer.tsx       React Flow canvas, toolbar, zoom control
│   ├── tables/TableNode.tsx        One table as a graph node (custom React Flow node)
│   └── modal/
│       ├── NewFileModal.tsx        Name a new empty SQL file
│       ├── CreateTableModal.tsx    Full table definition incl. PK / NOT NULL / FK
│       ├── AddColumnModal.tsx      Single-column ALTER TABLE (portalled)
│       ├── EditColumnModal.tsx     Rename / retype an existing column (portalled)
│       ├── NoticeModal.tsx         Error / warning / success with collapsible details
│       ├── AuthModal.tsx           Sign up / sign in, with the reason it was asked for
│       ├── ShareModal.tsx          Creates and copies a read-only link
│       ├── TableNotesModal.tsx     Per-table to-do list (portalled)
│       ├── NewTableHelpModal.tsx   Canvas toolbar: what the New Table button does
│       └── InfoModal.tsx           "What is this app" summary + version + credits
│   └── ui/
│       ├── Modal.tsx           ★ The dialog primitive every modal is built on
│       └── ConfirmDialog.tsx   Destructive confirmation, built on Modal
├── services/
│   ├── api.ts                  ★ The only module that talks to the backend
│   ├── sessionStorage.ts       Remembers open files + canvas layout across a refresh
│   └── exportImage.ts          Canvas → PNG via html-to-image
├── services/workspaceId.ts     Collision-free backend workspace ids
├── types/index.ts              Normalized UI types + the Raw* wire shapes
└── next.config.ts              standalone output, console stripping, import optimization
```

---

## Routes

| Route | What it is |
|---|---|
| `/` | Landing page — hero, Features and Templates sections, and the account controls. Marketing surface; holds no workspace state |
| `/app` | The editor. Everything in *State ownership* below refers to `app/app/page.tsx` |
| `/share/[token]` | Read-only view of a shared file |

The landing page hands a chosen template to the editor through **the session file the editor
already restores from** (`services/sessionStorage.ts`) rather than a bespoke handoff: it creates
a workspace, applies the template, appends the entry to the stored session and navigates to
`/app`, which then finds the workspace, confirms it via `GET /workspaces` and reads the schema
back like any other open file. That is why `/app` needed no changes to support templates.

## Architecture

### State ownership

`app/page.tsx` is deliberately the single owner of application state. Everything else is
presentational or calls `dbService` and then asks the page to refresh.

```ts
interface Workspace {
    id: string;             // also the backend workspace id
    name: string;           // filename shown in the explorer and used for export
    nodes: Node[];          // React Flow nodes — positions survive refreshes
    edges: Edge[];          // derived from backend relationships
    fileData: ExplorerFile; // tree projection for the file explorer
    isImported: boolean;    // uploaded vs. created empty (affects the export filename)
}
```

The server is the source of truth. After **any** mutation the page calls `refreshActiveSchema()`,
which re-fetches `GET /db-info` and rebuilds nodes and edges. The one genuinely client-side piece of
state is **node position**: `refreshActiveSchema` preserves the existing position of any node whose
table still exists, so a refresh never scatters a layout you arranged.

⚠️ **`refreshActiveSchema` must stay `useCallback(..., [])`.** Every table node stores it in its
React Flow `data.onRefresh`, captured when the node was built. It reads the active file from
`activeWorkspaceIdRef`, not from the `activeWorkspaceId` state, because a file is created and its
nodes are built in the same tick as `setActiveWorkspaceId` — a closure over the state value is
still the *previous* id (`null` for the first file), so refreshing from a node returned early and
the canvas silently never updated even though the backend change had gone through. Adding a
dependency to that `useCallback` reintroduces the bug.

### Workspaces

Each open file is an independent backend database. The file's `id` **is** the backend workspace id.

```mermaid
flowchart LR
    A["User switches file<br/>or creates a new one"] --> B["setActiveWorkspace(id)<br/>in services/api.ts"]
    B --> C["Axios interceptor adds<br/>X-Workspace-Id to every request"]
    C --> D["Backend resolves that file's<br/>own database"]
```

Two places set it:

- A `useEffect` in `page.tsx` on `activeWorkspaceId` change — the normal path.
- **Synchronously**, before the API call, in `handleFileUpload` and `handleCreateBlankFile`. This
  matters: a new file's id is generated and used in the same tick, before React re-renders, so
  waiting for the effect would send the upload to whichever file was previously open.

If an upload fails, the page rebinds the client to the previously active workspace so a failed
import doesn't strand later calls against a database that was never populated.

The File menu's **Delete file** calls `DELETE /workspace`, which deletes that file's database and
leaves every other open file untouched. It is named "delete" rather than "close" because there is no
close-without-deleting action — the wording has to match what it actually does.

### The API boundary

`services/api.ts` is the only module that talks to the backend. It owns the Axios instance, the
active workspace id, cache-busting, and the two download URL builders.

```ts
let activeWorkspaceId: string | null = null;

export const setActiveWorkspace = (workspaceId: string | null) => {
    activeWorkspaceId = workspaceId;
};

api.interceptors.request.use((config) => {
    if (activeWorkspaceId) config.headers.set('X-Workspace-Id', activeWorkspaceId);
    return config;
});
```

Workspace ids are minted by `services/workspaceId.ts`, never `Date.now()` — two files created in
the same millisecond used to land on the same backend database.

**Every request also carries `X-Client-Id`** (`services/clientId.ts`), a stable per-browser id in
localStorage. It is what gives a signed-out visitor an identity, so the backend can keep two
anonymous sessions from seeing each other's files. It is created lazily, on the first API call —
a fresh signed-out load with no stored session makes no requests at all, so do not expect the key
to exist before then. On sign-in the backend re-keys whatever this id owns onto the account, so
making an account never looks like losing your work.

Schema and table reads append a `_t`/`t` timestamp so the browser can never serve a stale schema.

**Responses are normalized here, not in components.** The backend has answered with both `is_pk`
and `isPk` (and `source_table`/`sourceTable`, `not_null`/`notNull`) over its life, so every reader
used to carry its own `c.is_pk ?? c.isPk` fallback — and a reader that forgot half of it silently
treated every primary key as an ordinary column. `normaliseColumn`, `normaliseRelationships` and
`normaliseSchema` fold both spellings into the camelCase types in `types/index.ts` at the boundary.
Those types are now ground truth; the `Raw*` types describing the wire format should be imported
only by `services/api.ts`.

| `dbService` method | Endpoint |
|---|---|
| `uploadFile(file)` | `POST /upload` |
| `getVersion()` | `GET /version` |
| `listWorkspaces()` | `GET /workspaces` |
| `getSchema()` | `GET /db-info` |
| `getTableData(table)` | `GET /table-data/{table}` |
| `createTable(name, cols)` | `POST /create-table` |
| `addColumn(params)` | `POST /alter-table` |
| `updateColumn(params)` | `POST /update-column` |
| `insertRow(table, data)` | `POST /insert-row` |
| `updateCell(params)` | `POST /update-cell` |
| `deleteRow(table, id)` | `POST /delete-row` |
| `deleteWorkspace()` | `DELETE /workspace` |
| `downloadTableCsv(table)` | `GET /export/{table}` (blob) |
| `downloadDatabaseSql(name)` | `GET /export-sql` (blob) |
| `authService.updateProfile(changes)` | `PATCH /auth/profile` |

### Session persistence

The open files survive a browser refresh. What is stored locally is deliberately minimal:

```ts
// localStorage key: sql-visualizer.session
{ version: 1, activeWorkspaceId: "1736512345",
  workspaces: [{ id, name, isImported, positions: { customers: {x, y} } }] }
```

Only ids, filenames and node positions — **never the schema**. On mount `page.tsx`:

1. reads the stored session,
2. calls `GET /workspaces` and keeps only entries whose database still exists,
3. re-fetches each one's schema with `GET /db-info` and rebuilds nodes and edges,
4. reapplies the saved positions per table name.

The databases stay the source of truth, so a cached schema can never go stale, and a wiped data
directory or a different backend leaves no ghost files in the explorer. If the backend is
unreachable the stored session is *kept*, not cleared — the file list should not be destroyed
because the server happened to be down.

Saving is debounced by 300 ms because dragging a node fires `onNodesChange` continuously. Every
`localStorage` access is wrapped in try/catch: it throws outright in Safari private browsing and
when storage is disabled by policy, and losing the session is not a reason to take the app down.

### Accounts

The app works fully signed out. Two actions need an account — **exporting** and **creating a share
link** — and both are enforced by the backend (401), not just hidden in the UI, so the gate cannot
be bypassed by calling the API.

Password rules (8+ characters, a capital letter, a special character) are mirrored in
`AuthModal` as a live checklist so they are visible while typing, but the backend remains the
authority — the UI copy is a convenience, not the enforcement.

The token lives in `localStorage` and is attached by an Axios interceptor. `AuthModal` takes a
`reason` prop so the prompt says *why* it appeared ("Exporting a file needs an account") rather
than appearing out of nowhere.

⚠️ **`handleDownloadCsv` must stay a stable `useCallback` that reads `userRef.current`.** It is
stored in every node's `data`, and the callback that rebuilds nodes is deliberately stable — so
reading `user` from the closure would pin it to its first-render value (`null`) and prompt for
sign-up forever, even once signed in. Same class of bug as the `refreshActiveSchema` note above.

### Exporting

The header's **Export** menu offers two things, which are for different jobs:

| Option | Built by | Good for |
|---|---|---|
| **SQL script** | `GET /export-sql` (browser download) | Re-importing, running elsewhere, diffing |
| **Diagram image (PNG)** | `services/exportImage.ts` | *Reading the schema offline* — no tools needed, drops into a doc or a chat |

The PNG is sized to the diagram's own bounding box (`getRectOfNodes` + `getTransformForBounds`)
rather than the visible pane, so the whole schema is captured regardless of the current scroll or
zoom. React Flow renders every node into the DOM (virtualisation is off), so nothing off-screen is
missing. `pixelRatio: 2` keeps the 9px column labels legible.

### Schema → canvas transform

`transformSchemaToWorkspace()` in `page.tsx` converts the backend payload into React Flow data:

- **Nodes** — one `tableNode` per table, laid out on a 3-column grid, carrying `label`, `columns`,
  and the `onRefresh` / `onEdit` callbacks.
- **Edges** — one per declared foreign key, drawn `target → source` (parent → child) with handle ids
  of the form `${column}-right` / `${column}-left`.

The transform tolerates both `snake_case` and `camelCase` on relationship fields
(`target_table ?? targetTable`), because the payload shape has changed across backend ports.

---

## Component guide

| Component | Responsibility | Notes |
|---|---|---|
| `Header` | **File** menu (new / import / export / close) and **Share**, both on the left; account and help on the right. There is no Refresh button — every mutation refreshes the canvas itself | The SQL option builds a URL and clicks a synthetic `<a>` (imported files get a `modified_` prefix); the PNG option calls back into `page.tsx`, which owns the nodes. The menu closes on outside-click and Escape |
| `FileExplorer` | Files → tables → columns tree, search, collapse rail | Collapsed mode shows one icon per open file |
| `Visualizer` | React Flow canvas, **New Table** button, zoom select | Renders `CreateTableModal` and `NewTableHelpModal` as *siblings* of the canvas wrapper — see [Gotchas](#gotchas) |
| `TableNode` | One table: header actions, column list, FK handles, per-column edit button | Handles are inferred from naming convention (`id`, `*_id`), not real metadata |
| `DataEditor` | Row grid with per-cell and whole-row editing, insert form, delete | Assumes every row has an `id`/`ID`; input types derived from the SQL type |
| `CreateTableModal` | Full table definition: type, length, PK, NOT NULL, FK | Validates required names and duplicate column names before submitting |
| `AddColumnModal` | Single `ALTER TABLE ... ADD COLUMN` | Portalled to `document.body`; validates identifier shape and duplicate names |
| `EditColumnModal` | Rename a column, change its type or nullability | Portalled; pre-filled from backend metadata, sends only changed fields, locks type/nullability on a primary key |
| `NewFileModal` | Name a new empty file | Appends `.sql` if omitted |
| `InfoModal` | Five-line description of the app, the version badge, and developer credits | Opened from the **header's** help button. Version comes from `GET /version`, i.e. the backend's `pom.xml` |
| `NewTableHelpModal` | What the **New Table** button does, step by step | Opened from the info button in the **canvas toolbar**. Deliberately distinct from `InfoModal`: help for a control lives next to that control |
| `NoticeModal` | Any error/warning the user must see | Used for import reports — a `.sql` dump is rarely fully portable, so skipped statements are listed here instead of only in the server log |

---

## Styling

- **Tailwind CSS v4**, configured entirely from CSS (`app/globals.css`). There is no
  `tailwind.config.js` — the scaffolded one pointed at `./src/**` paths that do not exist here.
- **One palette, declared in `@theme`.** `brand-*` (blue 50-900, plus `brand-violet`) and `ink-*`
  (slate-valued neutrals 50-950), plus `surface`, `surface-tint` and `line`. Use these rather than
  raw `blue-*` / `zinc-*` / `slate-*`: the landing page and the editor previously ran on two
  separate systems — a blue/indigo gradient set on slate for marketing, flat `blue-600` on zinc for
  the editor — which is what made moving between them feel like moving between two apps.
- **Shared utilities**: `brand-gradient(-hover)`, `brand-text-gradient`, `surface-card`,
  `section-wash(-tinted)`, `shadow-glow-sm|md|lg`, `rule-gradient`, `scroll-slim`.
- **Animation is local.** `tailwindcss-animate` was never installed, so the `animate-in` /
  `fade-in` / `slide-in-from-*` classes that appeared at 17 call sites did nothing at all. Use
  `anim-fade-in`, `anim-fade-up`, `anim-dialog-in`, `anim-menu-in`, all defined in `globals.css`
  and all inside a `prefers-reduced-motion` guard.
- **Light theme only.** The dark/system toggle was removed because it only ever restyled the
  canvas and table nodes, never the rest of the chrome; the leftover `.dark` token block and
  `@custom-variant` have now been deleted too, so nothing suggests a dark mode that is not there.
- **Focus rings are `:focus-visible`**, not `:focus` — the old rule painted a ring on every mouse
  click, including on table cells.
- **Fonts**: Inter (`--font-sans`) and Geist Mono (`--font-mono`), loaded in `app/layout.tsx`.
  Keep monospace content on `font-mono`; don't hardcode a family per component.
- **Breakpoints**: Tailwind's defaults plus `xs` (25rem), because the 320-639px band otherwise has
  no breakpoint at all and that is exactly where a second control stops fitting on one line.
- **Z-index**: dialogs compute their own from `--z-overlay-base` (100) and their depth in the open
  dialog stack. Don't add hand-picked `z-[130]` values.

---

## Gotchas

**1. Build dialogs with `components/ui/Modal.tsx`. Never hand-roll an overlay.** React Flow
transforms its viewport, which makes it the containing block for any `position: fixed` descendant —
a dialog opened from a table node would silently position itself against the canvas pane rather
than the window. The primitive always portals to `document.body`, so that class of bug cannot
recur. It also owns Escape (top of the stack only), the focus trap and focus restore, the body
scroll lock, `role="dialog"` / `aria-modal` / `aria-labelledby`, the z-index, and the phone bottom
-sheet layout. `ConfirmDialog` sits on top of it for destructive confirmations.

**2. Dialogs are mounted only while open.** The call sites render `{isOpen && <Foo isOpen … />}`
and import through `next/dynamic` with `ssr: false`. This is load-bearing in two ways: it keeps
form-heavy code out of the initial bundle, and it means *mounting is the reset*, which is why no
dialog re-seeds its form state from a `useEffect` (the lint config rejects that anyway).

**3. The canvas is deliberately not connectable.** `nodesConnectable={false}`, and every `Handle`
sets `isConnectable={false}`. Previously `onConnect` / `onEdgesChange` were no-ops while the
handles stayed live, so dragging one started a connection gesture the app could never honour.
Foreign keys are created through `CreateTableModal`. If drag-to-create is ever built, re-enable
connectability *and* wire up persistence in the same change.

**4. Connection handles are placed by naming convention, not metadata.** `TableNode` treats a
column literally named `id` or ending in `_id` as a key and gives it a connection handle. Real
key metadata *is* available now — `ColumnInfo` carries `isPk` and `notNull`, which `EditColumnModal`
uses to pre-fill and `FileExplorer` uses to highlight primary keys — but the handle heuristic was
deliberately left as-is, so a column can show a handle without being a key.

**5. Row operations need an `id` column.** `DataEditor`'s update and delete paths address rows by
`id`/`ID`. A table without one can be viewed but not row-edited.

---

## Adding a feature

1. Start from **`app/page.tsx`** for anything workspace-level.
2. Add or change backend calls **only** in `services/api.ts`, and confirm the endpoint exists in
   `../db-viewer-backend/src/main/java/com/dbviewer/app/controller/DatabaseController.java`.
3. If a new endpoint needs workspace scoping, it gets it for free through the Axios interceptor —
   unless it's a browser download, which needs `&workspaceId=` on the URL.
4. Update `types/index.ts` when relying on new backend response fields.
5. New fixed-position modal? Re-read [Gotchas](#gotchas) §1 first.
6. Run `npx tsc --noEmit`, `npm run lint`, and `npm run build`.
