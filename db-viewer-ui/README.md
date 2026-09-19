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
│   ├── landing/
│   │   ├── DemoCanvas.tsx          The real canvas, with a literal schema (hero + docs)
│   │   ├── HeroCanvas.tsx          The hero: a .sql file blooming into that canvas
│   │   ├── FeaturesSection.tsx     Feature rail + one sticky demo panel
│   │   ├── FeatureDemos.tsx        The looping scenes the panel plays
│   │   ├── EngineBanner.tsx        "your engine is supported", with the marks
│   │   └── DatabaseLogos.tsx       Engine marks (Simple Icons; SQL Server drawn)
│   ├── docs/
│   │   ├── DialectMatrix.tsx       What survives an import and an export, per engine
│   │   └── DocsSandbox.tsx         Live try-it examples embedded in the manual
│   ├── canvas/
│   │   ├── Visualizer.tsx          React Flow canvas, toolbar, minimap, zoom control
│   │   ├── CanvasSearch.tsx        Ctrl+F panel: find a table or column and jump to it
│   │   ├── OrthogonalEdge.tsx      Custom edge: right angles, routed around the nodes
│   │   └── edgeRouting.ts          The router itself — candidate routes, scored
│   ├── tables/TableNode.tsx        One table as a graph node (custom React Flow node)
│   └── modal/
│       ├── NewFileModal.tsx        Name a new empty SQL file
│       ├── CreateTableModal.tsx    Full table definition incl. PK / NOT NULL / FK
│       ├── AddColumnModal.tsx      Single-column ALTER TABLE (portalled)
│       ├── EditColumnModal.tsx     Rename / retype an existing column (portalled)
│       ├── ImportPreviewModal.tsx  Pre-flight: what an import would create, before it does
│       ├── ExportModal.tsx         SQL (per dialect) / Mermaid / DBML / PNG
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
| `analyzeUpload(file)` | `POST /import/analyze` |
| `uploadFile(file, columnTypes?)` | `POST /upload` |
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
| `downloadDatabaseSql(name, dialect)` | `GET /export-sql?dialect=` (blob) |
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

Four formats, one dialog (`components/modal/ExportModal.tsx`). They live together because the
choice between them is not a preference — each answers a different question, and two of them need
an input the old menu items had nowhere to ask for:

| Option | Built by | Good for |
|---|---|---|
| **SQL script** | `GET /export-sql?dialect=` (browser download) | Running it somewhere. The engine must be named: `AUTOINCREMENT`, `SERIAL`, `IDENTITY(1,1)` and `AUTO_INCREMENT` are four spellings of one idea and no engine accepts another's |
| **Mermaid** | `services/exportDiagram.ts` | Docs-as-code — renders as a diagram in a GitHub README, a Jira ticket or a Notion page. Download wraps it in a fenced Markdown block |
| **DBML** | `services/exportDiagram.ts` | dbdiagram.io and dbdocs; or committed beside the code as the schema of record |
| **Diagram image (PNG)** | `services/exportImage.ts` | *Reading the schema offline* — no tools needed, drops into a doc or a chat |

Mermaid and DBML are generated entirely in the browser from the same `tables` + `relationships`
the canvas draws, so they cannot describe a different schema from the one on screen. That does not
make them free, though: exporting any format — PNG and the text formats included — still needs an
account, because the account boundary is about data leaving the app, not about which formats
happen to touch the backend to produce. `ExportModal` gates all four the same way
(`needsAccount = !hasAccount`); it used to check `format === 'sql'` only, and PNG, Mermaid and DBML
went straight out the door signed out because there was no server-side 401 to catch them. Mermaid
also drops a precision that contains a comma (`DECIMAL(10,2)` → `DECIMAL`): a comma inside
parentheses fails Mermaid's parser and takes the whole diagram down with it, and DBML carries the
exact type for anyone who needs it.

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
| `Header` | **File** menu (new / import / export / close) and **Share**, both on the left; theme, account and help on the right. There is no Refresh button — every mutation refreshes the canvas itself | Export is a single item that opens `ExportModal`, because the formats now ask questions a menu line cannot. The menu closes on outside-click and Escape |
| `FileExplorer` | Files → tables → columns tree, search, collapse rail | Collapsed mode shows one icon per open file |
| `Visualizer` | React Flow canvas, **New Table** button, minimap, search, zoom select | Renders `CreateTableModal` and `NewTableHelpModal` as *siblings* of the canvas wrapper — see [Gotchas](#gotchas) |
| `CanvasSearch` | Find a table or column; arrow keys move the canvas with the selection | Bound to Ctrl+F, and stands down while a dialog is open |
| `OrthogonalEdge` | One relationship line, routed around whatever is in its way | Reads node positions from React Flow's store, not from props — they must be the *current* ones while a node is being dragged |
| `TableNode` | One table: header actions, column list, PK/FK handles, per-column edit button | Handles come from the relationship list, with `id` / `*_id` naming as the fallback |
| `ImportPreviewModal` | The staging step: tables, inferred types, why, and sample values | Correcting a type here is the only chance to — a postcode imported as `INT` has lost its leading zeros for good |
| `ExportModal` | SQL for a named engine, Mermaid, DBML, PNG | All four require an account — generated client-side is not the same as free to take out |
| `DataEditor` | Row grid with per-cell and whole-row editing, insert form, delete | Assumes every row has an `id`/`ID`; input types derived from the SQL type |
| `CreateTableModal` | Full table definition: type, length, PK, NOT NULL, FK | Validates required names and duplicate column names before submitting |
| `AddColumnModal` | Single `ALTER TABLE ... ADD COLUMN` | Portalled to `document.body`; validates identifier shape and duplicate names |
| `EditColumnModal` | Rename a column, change its type or nullability | Portalled; pre-filled from backend metadata, sends only changed fields, locks type/nullability on a primary key |
| `NewFileModal` | Name a new empty file | Appends `.sql` if omitted |
| `InfoModal` | Five-line description of the app, the version badge, and developer credits | Opened from the **header's** help button. Version comes from `GET /version`, i.e. the backend's `pom.xml` |
| `NewTableHelpModal` | What the **New Table** button does, step by step | Opened from the info button in the **canvas toolbar**. Deliberately distinct from `InfoModal`: help for a control lives next to that control |
| `AnchoredMenu` | Portalled dropdown for controls that live on the canvas | Caller captures the anchor rect on click; closes on wheel/resize rather than following the canvas. See [Gotchas](#gotchas) |
| `Tooltip` | Hover/focus definition popover | Portals to `document.body` and renders its own trigger `<span>`; see [Gotchas](#gotchas) |
| `ColorSwatchPicker` | The six table colours plus "none", as a `radiogroup` | Deliberately not `<input type="color">`: an arbitrary hex is unreadable in one of the two themes and indistinguishable from its neighbours at canvas zoom |
| `NoticeModal` | Any error/warning the user must see | Used for import reports — a `.sql` dump is rarely fully portable, so skipped statements are listed here instead of only in the server log |

---

## Styling

- **`--color-tag-*` is the one categorical palette.** Six hues (`slate`, `brand`, `violet`,
  `teal`, `amber`, `rose`), defined in `@theme` and redefined in `[data-theme="dark"]`. The rest
  of the system is one blue ramp plus neutrals, which is right for chrome and useless for
  "these are six different kinds of thing". A table's colour is stored as the **token name**,
  never a hex, so it resolves correctly in both themes. A seventh colour is one token plus one
  `.tag-*` rule plus one `.minimap-tag-*` rule.

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
- **Light, dark, or the system setting.** The theme works by *redefining the tokens*, not by
  adding classes: `[data-theme="dark"]` in `globals.css` gives the same custom properties new
  values, and because Tailwind v4 emits every utility as a `var()` reference, the entire product
  flips without a single utility class changing. That is what the previous attempt got wrong — it
  restyled the canvas and table nodes by hand and left the rest of the chrome light. Rules that
  follow from it: `bg-surface` rather than `bg-white`; `bg-scrim/60` rather than `bg-ink-900/50`
  for an overlay (the ink scale inverts, so an inverted scrim is a white flash); and the
  `tone-info` / `tone-warning` / `tone-error` / `tone-success` classes for a tinted block rather
  than a `bg-red-50 border-red-200 text-red-700` triple that can drift apart. A `dark:` variant
  exists for the handful of colours a token cannot express — it is a last resort, not the method.
  The preference lives in `services/theme.ts` and is applied by a blocking script in
  `app/layout.tsx` before first paint; without that, every load flashes white.
- **React Flow's chrome is the exception.** Its stylesheet is imported from a component, so it
  lands after `globals.css` and wins any tie — every `.react-flow__*` override is prefixed with
  `.react-flow` purely for specificity. The background dot colour is set from CSS rather than the
  `color` prop, because React Flow writes that to the pattern's `fill` *attribute*, where `var()`
  is not valid.
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

**0c. `fitView` measures nodes only, and will happily zoom *in*.** Pass the same `fitViewOptions` to `<ReactFlow>` and `<Controls>` (the button has its own defaults otherwise), cap `maxZoom` at 1 so a single table is not blown up to 200%, and keep the padding generous because edge notation is drawn outside the node boxes that `fitView` measures. Whenever the node width changes, `GRID_STEP_X` in `page.tsx` has to change with it — at a 250px step the 265px nodes nearly touched.

**0b. A dismissal listener must not depend on a prop that changes identity every render.** `AnchoredMenu`'s Escape/outside-click effect originally listed `onClose` in its deps. Callers pass an inline arrow, so the effect re-ran on every render — and a real Escape keypress makes React Flow re-render the node *while the event is still bubbling*, so the cleanup removed the listener before the event reached `document`. Escape did nothing, while a synthetically dispatched Escape worked, which is exactly the shape of bug a test can miss. `onClose` now goes through a ref so the effect depends only on whether the menu is open.

**0a. A tooltip inside the canvas must be portalled, and must not be a cloned child.** React Flow transforms its viewport, so a `position: fixed` tooltip rendered in place anchors to the canvas pane *and is scaled by the current zoom* — unreadable at 25%. `components/ui/Tooltip.tsx` portals to `document.body`. It also renders its own trigger element rather than `cloneElement`-ing the caller's child, because the lint config rejects that (`react-hooks/refs`).

**0. A node's `className` is shared, so append to it — never assign.** The table colour rides on
`className` (not in `data`, which React Flow compares by reference — putting it there rebuilds
every node's data object on each frame of a drag). `Visualizer.displayNodes` also writes
`node-hit` / `node-dim` there for canvas search. It used to *replace* the string, so every colour
vanished the moment search opened. Relatedly, the minimap cannot be coloured with React Flow's
`nodeColor` prop: that lands in a `fill` **attribute**, and the `.react-flow__minimap-node` rule
in `globals.css` is a CSS rule, which always wins. Measured — the attribute read back as the tag
colour while the computed fill stayed `brand-400`. Use `nodeClassName` and a CSS rule.

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

**4. Connection handles come from the relationships, and the naming heuristic is only a
fallback.** `page.tsx` builds `foreignKeyColumns` / `referencedColumns` per table from the
relationship list and puts them in the node's `data`; `TableNode` places its handles from those,
treating a column named `id` or ending in `_id` as a key only when there is nothing better. The
fallback used to be the *whole* rule, and the cost was invisible: a schema whose foreign key was
called `customer` rather than `customer_id` got no handle, and an edge with no handle at one end
does not render — so the relationship simply never appeared, with nothing logged.

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
