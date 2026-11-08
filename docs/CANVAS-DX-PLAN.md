# Canvas Mechanics, DX Tooling & Performance — Implementation Plan

## Context

The db-viewer editor currently renders a schema you can *read* and edit through dialogs. Every
structural change goes through a modal; the canvas itself is inert beyond dragging nodes. Three
consequences motivate this work:

- **The canvas offers gestures it cannot honour.** `nodesConnectable={false}` exists because
  `onConnect` was a no-op — `docs/SYSTEM-DESIGN.md` §8 already lists *"Dragging an edge on the
  canvas does not persist"* as a known limitation.
- **There is no safety net.** `DROP TABLE` is immediate and unrecoverable; there is no undo of any
  kind, anywhere, for anything — not even a node drag.
- **The diagram stops being readable at scale.** No cardinality notation, no grouping, no colour,
  and every node renders full detail at every zoom level.

Ten features across three themes address this. The intended outcome: a canvas you can *design* in,
with a reversible-by-default editing model and a diagram that stays legible at a hundred tables.

## Status

| Done | Remaining |
|---|---|
| ✅ 1 Colour-coding & tagging · ✅ 2 Crow's foot + tooltips · ✅ 3 Undo/redo · ✅ 4 Domain grouping · ✅ 5 Drag-and-drop foreign keys · ✅ 6 Ghost nodes · ✅ 7 SQL scratchpad + views · ✅ 8 Inline cell editing · ✅ 9 Viewport LOD | — |

**All ten phases and all four cross-cutting fixes (F1–F4) are in.** Backend suite: **171 tests**,
up from 96 when this plan was written.

Two deviations from the plan as written, both deliberate and both measured:

- **F4** was to apply `safeIdentifier` to the five row-operation endpoints. It *rewrites* an
  identifier (`my-table` → `my_table`) rather than rejecting it, which would silently address the
  wrong table for anything imported with a hyphen in its name. They validate against the live
  schema instead — an allowlist, not a transform.
- **Phase 9** was to add `onlyRenderVisibleElements` after measuring. Measured: on a 100-table
  file at fitted zoom the detail tiers alone take the canvas from **10,180 DOM elements to
  3,195**, and frame rate was already at the 60fps cap both with and without them. Culling
  therefore buys nothing here, and it would break PNG export, which relies on every node being in
  the DOM. Not adopted — the measurement is the reason, as the phase asked.

**Decisions taken up front** (confirmed with the user):

| Decision | Choice |
|---|---|
| Delivery | All ten, in sequenced phases; each phase ships independently |
| Undo depth | Layout + reversible DDL. Destructive ops are **not** in the stack — they get the deferred-drop ghost instead 
| Scratchpad power | Full SQL (DDL + DML), gated behind an account like export and share |
| SQL editor | Lightweight custom (textarea + highlight overlay), not Monaco or CodeMirror |

---

## What already exists (reuse these — do not rebuild)

| Need | Existing code |
|---|---|
| SQLite table rebuild | `DatabaseServiceImpl.rebuildSqliteTable` (L580-662) + `readSqliteColumns` (L675) + `readSqliteForeignKeys` (L690) — the last already re-emits FK clauses, so adding one is an append |
| Per-workspace metadata store | `__table_notes`: `Constants.Ddl.CREATE_NOTES_TABLE`, `Constants.Notes` DAO block, `ensureNotesTable()`, `__` prefix filtering in `getTableNames()`, cascade in `dropTable`, drop in `clearDatabase` |
| Arbitrary SQL execution | `POST /query` → `DatabaseServiceImpl.executeQuery` (L305) — **live and covered by tests**, contrary to the frontend CLAUDE.md note. Also `DatabaseService.runScript` (L145) is already declared |
| Multi-statement splitting | `SqlScriptSplitter.split` — comment/quote/`DELIMITER`/`GO` aware |
| SQL text → nodes+edges | `template/TemplateSchemaParser.parse` (no database needed) |
| Edge label/marker anchor | `edgeRouting.midpointOf` (L252) — written, documented, **currently unused** |
| Outside-click/Escape | `components/ui/useDismissable.ts` (capture-phase, works over React Flow) |
| Portal + SSR guard | `components/ui/Modal.tsx` |
| Single-commit cell edit | `DataEditor.tsx` — commit on `onBlur` only, Escape sets `abandonEditRef` |
| Account gate | `AuthContext.require()` (backend), `ExportModal`'s `needsAccount` (frontend) |
| Dialog-aware shortcuts | `document.body.dataset.dialogOpen` guard, as Ctrl+F uses in `Visualizer.tsx` L84 |

**Does not exist and must be built:** a Tooltip primitive (every hover hint today is a native
`title=`, ~70 of them), a Toast/undo-bar primitive, a colour picker, a drawer/panel primitive, any
history/command stack, any soft-delete, `isUnique` / `defaultValue` / `isView` anywhere in the type
system. Also absent from `globals.css`: **any exit animation at all** — there is `fadeIn`,
`dialogIn`, `sheetIn`, `menuIn` and nothing that plays on the way out, so a dismissing toast or a
closing drawer needs new keyframes. And `Callout` accepts only `'error' | 'warning' | 'info'`
although `.tone-success` exists in CSS — widen the union rather than bypassing the component.

**One conflict resolved:** `db-viewer-ui/CLAUDE.md` L24 says the SQL runner "was removed". That is
true of the *frontend panel* only — `POST /query` is live in `DatabaseController` L128 and exercised
by `DatabaseControllerIntegrationTest` and `ColumnEditTest`. The CLAUDE.md line is misleading and
should be corrected as part of Phase 7.

---

## Cross-cutting fixes that must land first

These are latent problems that every feature below trips over. Fixing them once is the difference
between nine clean phases and nine workarounds.

### ✅ F1. `refreshActiveSchema` destroys per-node state *(done, Phase 1)*
`app/app/page.tsx` L286-317 rebuilds every node from the server response, carrying over only
`position` and `openNotes`. Colour, group membership, ghost status and collapsed state would all be
wiped on every refresh.

**Fix:** introduce an explicit decoration layer. Keep a `decorations: Record<string, NodeDecoration>`
on `Workspace`, keyed by table name, and apply it in a `useMemo` that follows the existing
compare-then-clone pattern of `nodesWithNotes` (L192-198). `refreshActiveSchema` then only ever
produces *undecorated* nodes, and nothing it does can lose anything.

### ✅ F2. Edge ids are positional and unstable *(done, Phase 1)*
`transformRelationshipsToEdges` (L70-85) emits `e-0`, `e-1`… so **every id shifts when a foreign key
is added**. Per-edge state (cardinality overrides, selection) keyed by id would silently reattach to
the wrong edge.

**Fix:** derive a stable id — `` `${rel.targetTable}.${rel.targetColumn}->${rel.sourceTable}.${rel.sourceColumn}` ``.

### ✅ F3. The rebuild silently drops indexes, `UNIQUE` and `CHECK` *(done, Phase 5)*
`rebuildSqliteTable` reconstructs from `PRAGMA table_info` + `PRAGMA foreign_key_list`, neither of
which reports indexes or table-level `UNIQUE`/`CHECK`. Today this only bites on a column edit; once
a *drag gesture* triggers a rebuild it will bite constantly — and `isUnique` (needed for crow's foot)
is exactly the thing being lost.

**Fix:** read `PRAGMA index_list` + `PRAGMA index_info` before the rebuild and recreate every
non-auto index after it. Carry table-level `UNIQUE`/`CHECK` across by extracting them from
`sqlite_master.sql` (`getCreateTableSql` already fetches it). Assert this in `ColumnEditTest` too —
it is a pre-existing bug there.

### ✅ F4. `safeIdentifier` is applied inconsistently *(done, Phase 5)*
`addColumn`, `createTable`, `insertRow`, `updateCell` and `deleteRow` only do `.replace(" ", "_")`
(L431, L734, L782, L996) while `updateColumn`/`dropTable`/notes validate properly. Every new
endpoint below must use `safeIdentifier`, and the five existing ones should be brought in line while
the file is open.

---

## ✅ Phase 1 — Canvas metadata store + colour-coding & tagging *(done)*

**Goal:** assign a colour and an optional tag to a table; it persists with the file.

**Backend**
- New `__canvas_meta` table inside the workspace database, modelled exactly on `__table_notes`:
  `CREATE TABLE IF NOT EXISTS "__canvas_meta" (id …, kind VARCHAR(16) NOT NULL, ref VARCHAR(255), payload TEXT NOT NULL, updated_at VARCHAR(40) NOT NULL)`.
  `kind` is `'table'` (colour/tag, `ref` = table name) or `'group'` (Phase 4, `ref` = group id).
  One table, two kinds, so Phase 4 adds no schema.
- `Constants.CanvasMeta` block for the DAO statements; `ensureCanvasMetaTable()` beside `ensureNotesTable()`.
- Wire **all three** invisibility hooks, the way notes does: the `__` filter in `getTableNames()`
  already covers canvas/export/clear, but `dropTable` must cascade-delete the table's row
  (mirroring L908-913) and `clearDatabase` must drop the table (mirroring L796).
- `GET /canvas-meta`, `PUT /canvas-meta/table/{name}`, `DELETE /canvas-meta/table/{name}`.

**Frontend**
- **F1 first** — the decoration layer, since this is its first consumer. Note the palette problem:
  the design system is deliberately monochromatic (one blue brand ramp, slate neutrals, four
  semantic tones) and has **no categorical palette at all**. Six distinguishable hues have to be
  added as a new token family rather than borrowed.
- Colour is a **token name**, never a hex value: `slate | brand | violet | teal | amber | rose`.
  Add a `--color-tag-*` ramp to the `@theme` block in `globals.css` with a dark-theme counterpart,
  so a tagged table reads correctly in both themes. A hex would look wrong in one of them.
- Applied as a `className` on the node (`tag-brand`), **not** through `data` — this is the rule
  `DemoCanvas.tsx` L185-203 already documents for the refused-delete styling, and it keeps `data`
  identity stable across a drag.
- `Visualizer.displayNodes` (L120-132) currently *overwrites* `className` for search dim/hit —
  merge instead of replace, or the colour vanishes whenever search is open.
- `MiniMap` takes a `nodeColor` so tags show there too.
- New `components/ui/ColorSwatchPicker.tsx` (six swatches + clear), opened from a new button in the
  `TableNode` header row, dismissed via `useDismissable`.
- **`services/sessionStorage.ts` does not change.** Colours are semantic and belong to the file, so
  they live server-side in `__canvas_meta` — the same reasoning that put `__table_notes` inside the
  workspace. localStorage stays strictly layout-only. This also avoids its version gate, which
  *discards* rather than migrates (`STORAGE_VERSION = 1`, L50): bumping it would silently throw away
  every user's arranged canvas. Any future addition there must be additive and tolerant.

**Test cases**
| Case | Expect |
|---|---|
| Set a colour, refresh the schema | Colour survives (this is the F1 regression test) |
| Set a colour, reload the page | Colour restored from the backend |
| Set a colour, export SQL | `__canvas_meta` appears nowhere in the script |
| Drop the table | Its meta row is gone; no orphan |
| `DELETE /clear` | `__canvas_meta` dropped with everything else |
| Open the file in a different browser | Colours travel (they are server-side, unlike positions) |
| Toggle dark mode | All six tags still legible |
| Open canvas search while tags are set | Dim/hit styling and tag colour coexist |

**Risk:** low. The only sharp edge is the `className` collision in `displayNodes`.

---

## ✅ Phase 2 — Schema metadata enrichment → crow's foot + constraint tooltips *(done)*

These ship together because both are blocked on the same backend work.

**Goal:** edges carry 1:1 / 1:N notation; hovering a column shows its full definition.

**Backend**
- Enrich `ColumnInfo` with `isUnique`, `defaultValue`, `autoIncrement`. Sources: `PRAGMA index_list`
  + `PRAGMA index_info` for single-column unique indexes (PK counts as unique), `dflt_value` from
  `PRAGMA table_info` (already read, currently discarded), and `hasAutoIncrement()` (L718, exists).
- Enrich `Relationship` with `onDelete` and the constraint id — `readSqliteForeignKeys` already
  reads both and throws them away; `getForeignKeys` (L388) is the lossy one to fix.
- No new endpoint — `/db-info` just returns more.

**Frontend**
- `types/index.ts`: extend `ColumnInfo` and `Relationship`, plus the `Raw*` wire shapes; teach
  `normaliseColumn` / `normaliseRelationships` (`services/api.ts` L13-38) the new fields.
- **Cardinality is inferred, not stored.** Parent end is always "one" (a FK must reference a unique
  column). Child end is "one" iff the FK column is itself PK or unique, else "many". Optionality:
  `notNull` ⇒ mandatory bar, nullable ⇒ optional circle. Compute in
  `transformRelationshipsToEdges` and put it on `edge.data` — which is free, because `OrthogonalEdge`
  currently ignores `data` entirely.
- `OrthogonalEdge.tsx`: destructure `data`, drop `markerEnd` when notation is on, and draw the feet
  inline as `<path>` elements. **No rotation maths is needed** — `edgeRouting.ts` L103-109 guarantees
  every route leaves the source heading right and enters the target heading right.
- Notation toggle (crow's foot / plain arrow) in the canvas toolbar, default crow's foot.
- **M:N:** a many-to-many is always two 1:N edges through a junction table — that is what the
  database actually contains, and drawing it otherwise would be a lie. Detect the junction
  (composite PK made entirely of FK columns), badge it, and offer an optional toggle that collapses
  the pair into one dashed M:N edge between the outer tables. The two honest 1:N edges are the default.
- New `components/ui/Tooltip.tsx`: portal-based (a `position: fixed` child of React Flow's
  transformed viewport anchors to the pane, not the window — see `Modal.tsx` for the pattern and the
  `mounted` SSR guard). Open on hover with a ~350 ms delay, suppressed while the node is dragging.
- `TableNode.tsx` L174: replace the native `title` attribute with it. Content assembled as
  `VARCHAR(255) NOT NULL UNIQUE DEFAULT 'active'`, plus `→ orders.customer_id` for a FK.
- **The tooltip must be an enhancement, never the only channel.** `DialectMatrix.tsx` L24 records
  the house stance explicitly — *"Shown under the mark, so nothing depends on a tooltip."* Key
  status stays visible as the PK/FK icon; the tooltip only adds the detail that will not fit. Keep
  it keyboard-reachable (`aria-describedby`, opens on focus as well as hover) — there is no
  `aria-describedby` anywhere in the codebase today, so this sets the pattern.
- **Mirror canvases:** `DemoCanvas` uses `OrthogonalEdge`, so crow's foot appears on the landing page
  and docs sandboxes automatically — verify it looks right there. `app/share/[token]/page.tsx` uses
  built-in `smoothstep` and registers no `edgeTypes`; port it to `OrthogonalEdge` so a shared link
  shows the same notation.

**Test cases**
| Case | Expect |
|---|---|
| FK on a plain column | 1:N — crow's foot at the child end |
| FK on a column that is also PK / has a unique index | 1:1 — single bar both ends |
| Nullable FK | Optional circle; `NOT NULL` FK shows the mandatory bar |
| Junction table (composite PK of two FKs) | Badged; both 1:N edges drawn correctly |
| Self-referencing FK (`employees.manager_id → employees.id`) | Renders without a degenerate path |
| Composite FK (two columns, one constraint) | One edge, not two overlapping ones |
| Hover a column with default + unique + not-null | Full definition, correctly ordered |
| Hover while dragging the node | No tooltip |
| Hover at 25% zoom | Tooltip readable (it is portalled, so unscaled) |
| Landing page + docs sandboxes | Notation renders; nothing regressed |
| Shared link | Same notation as the editor |

**Risk:** medium. The mirror canvases are the easy thing to forget; `OrthogonalEdge` is shared by
three surfaces.

---

## ✅ Phase 3 — Undo/redo history stack *(done)*

**Goal:** Ctrl+Z / Ctrl+Shift+Z reverses layout, decoration and reversible schema changes.

**Design:** a command stack, not a state snapshot. Snapshots cannot express "run the inverse DDL".

```ts
interface HistoryEntry {
    label: string;                 // "Add column orders.status" — shown in the undo toast
    undo: () => Promise<void>;
    redo: () => Promise<void>;
    lossy?: boolean;               // a retype that cannot restore the original values
}
```

- New `services/history.ts` + a `useHistory` hook; the stack is owned by `app/app/page.tsx`, capped
  at 50 entries, and **cleared when the active workspace changes** (it is per-file).
- Registered: node move (coalesced to one entry per drag, on drag end), colour/tag, group ops
  (Phase 4), add column ↔ drop column, add FK ↔ drop FK (Phase 5), create table ↔ drop table,
  rename column ↔ rename back, retype column ↔ retype back (`lossy: true`).
- **Not** registered: dropping a table (the Phase 6 ghost is its safety net), row deletes, and
  anything the scratchpad runs.
- **History barrier.** After arbitrary SQL from the scratchpad, earlier inverses may no longer be
  valid — a column an entry wants to drop may have been dropped already. Push a barrier that undo
  refuses to cross, and say why. Silently applying a stale inverse is far worse than refusing.
- Undoing a `lossy` entry asks for confirmation first (`ConfirmDialog` exists).
- Keyboard registration follows the Ctrl+F precedent in `Visualizer.tsx` L84, with **two** extra
  guards: skip when `document.body.dataset.dialogOpen === 'true'`, and skip when the event target is
  an `input`/`textarea`/`contenteditable` — otherwise Ctrl+Z inside the scratchpad or an inline cell
  edit would undo a *schema change* instead of the user's typing.

**Backend:** one new endpoint, `POST /drop-column` (SQLite 3.35+ supports `ALTER TABLE … DROP COLUMN`
and sqlite-jdbc is 3.45). Refuse dropping a PK, or a column another table's FK references.

**Test cases**
| Case | Expect |
|---|---|
| Drag three tables, Ctrl+Z ×3 | Each drag reverses as one step, not per-frame |
| Add column, Ctrl+Z | Column gone from the database, not just the canvas |
| Ctrl+Z then Ctrl+Shift+Z | Column back |
| Add column, retype it, undo twice | Type restored, then column gone |
| Undo a retype that lost data | Confirmation first, and it says what is lost |
| Run `DROP TABLE x` in the scratchpad, then Ctrl+Z | Refused at the barrier, with a reason |
| Switch files, Ctrl+Z | Nothing happens — no cross-file undo |
| Ctrl+Z while typing in the scratchpad | Native text undo, schema untouched |
| Ctrl+Z with a modal open | Ignored |
| 60 operations then undo repeatedly | Stops cleanly at 50 |
| Undo an add-column whose column was since dropped externally | Fails gracefully, stack stays consistent |

**Risk:** high — this is the feature most able to corrupt a schema. The barrier and the lossy flag
are the mitigations; both are non-optional.

---

## ✅ Phase 4 — Domain grouping (sub-schemas) *(done)*

**Goal:** lasso a set of tables into a named, coloured domain — "Authentication", "Billing".

**Design decision: a group stores members, not geometry.** `{ id, name, colour, tables: string[] }`.
The box is the bounding rect of its members plus padding, recomputed each render. This matters
because node *positions* live in `localStorage` (client-side) while group metadata lives in the
workspace database (server-side) — persisting box coordinates would put the two out of step the
moment the file is opened on another machine. Deriving the box means it is always correct.

**Backend:** no new schema — a `kind='group'` row in the Phase 1 `__canvas_meta` table.
`GET /canvas-meta` already returns it; add `PUT`/`DELETE /canvas-meta/group/{id}`.

**Frontend**
- New `components/canvas/GroupBox.tsx` registered as a `group` node type in `Visualizer`'s
  module-scope `nodeTypes` (L30). Rendered with `zIndex: -1`, `selectable: false`, `draggable: true`.
- Explicitly **not** a React Flow parent node. `parentNode` + `extent: 'parent'` would switch child
  `position` to parent-relative, which breaks `saveSession` (L443, stores `n.position`), `focusHit`
  (L100, uses `node.position`) and `defaultPosition` all at once.
- Dragging the box translates its members by the delta.
- Lasso: shift-drag on the pane → "Group these N tables" prompt.
- **Group nodes must be excluded from six enumerations** — this is the whole cost of the feature:
  `selectNodeRects` in `OrthogonalEdge.tsx` L22 (otherwise every edge routes *around* the group,
  which is exactly wrong), `CanvasSearch.collectHits`, `existingTables` (`Visualizer` L144),
  `nodesWithNotes` (`page.tsx` L192), the `MiniMap`, and `saveSession`'s positions map.
  `downloadCanvasImage` is the exception — the box *should* be in the PNG.

**Test cases**
| Case | Expect |
|---|---|
| Lasso three tables, name the group | Box drawn around exactly those three |
| Drag a member out | Box shrinks to fit the remaining two |
| Drag the box | All members move together, spacing preserved |
| An edge crosses the boundary | Routed straight through, not around |
| Ctrl+F | Group names are not search hits; member tables still are |
| Export PNG | Boxes and labels included |
| Reload | Groups restored; a table added since is not silently in the group |
| Drop a member table | Group survives with the rest; no phantom member |
| Two overlapping groups | Both render; labels do not collide |
| Export SQL | No trace of groups |

**Risk:** medium. The six exclusions are mechanical but easy to miss one — the edge-obstacle one is
the only *visible* failure; the others fail silently.

---

## ✅ Phase 5 — Drag-and-drop foreign keys *(done)*

**Goal:** drag from a key in table A onto a column in table B; the FK is created for real.

**Backend — the substantial piece**
- Generalise `rebuildSqliteTable` from its current column-edit-specific signature to take a request
  object: an optional column change, a list of FK clauses to add, and a set of constraint ids to
  drop. `readSqliteForeignKeys` (L690) already renders existing FKs as table-level clauses, so
  adding one is genuinely an append to that list.
- **Apply F3 here** (index/`UNIQUE`/`CHECK` preservation) — a drag gesture makes rebuilds common.
- `POST /add-foreign-key` `{tableName, columnName, refTable, refColumn, onDelete?}` and
  `POST /drop-foreign-key` (the undo inverse). Both use `safeIdentifier`.
- **Pre-flight validation, before touching anything:**
  1. Both tables and both columns exist.
  2. The referenced column is PK or has a unique index — SQLite will not enforce a FK otherwise, and
     it would silently do nothing.
  3. No orphan rows: `SELECT COUNT(*) FROM child WHERE fk IS NOT NULL AND fk NOT IN (SELECT ref FROM parent)`.
     Refuse with the count, not a generic failure.
  4. Type compatibility between the two columns.
  5. The FK does not already exist.
- MySQL workspaces (`isMysql()`) take the real `ALTER TABLE … ADD CONSTRAINT` path; no rebuild.

**Frontend**
- `Visualizer.tsx`: `nodesConnectable={true}`, add `onConnect` / `onConnectStart` / `onConnectEnd` /
  `isValidConnection`.
- **The handle problem.** Handles exist today only on columns passing the PK/`*_id` heuristic, so
  most columns cannot be dropped onto. Rendering a handle on every column always would mean ~1000
  registered handles on a 100-table schema. Instead, read `connectionNodeId` from the React Flow
  store inside `TableNode` (`useStore`) and render the full set of handles **only while a connection
  gesture is in progress**. This is identity-safe and costs nothing at rest.
- Direction: React Flow `source` is the *referenced* table and `target` the FK holder (per the
  existing `transformRelationshipsToEdges`), which matches the gesture — drag from the key in A,
  drop on the column in B.
- Optimistic edge while the request is in flight; on rejection, remove it and show the reason via
  `NoticeModal`.
- Register the inverse in the Phase 3 history stack.
- Update `docs/SYSTEM-DESIGN.md` §8 — this removes the "dragging an edge does not persist" row.

**Test cases** (backend, `ForeignKeyConstraintTest`, in the house style — assert on resulting DDL and
data, not status codes)
| Case | Expect |
|---|---|
| Add a FK | `PRAGMA foreign_key_list` reports it |
| Table had data, PK, AUTOINCREMENT, other FKs, NOT NULL, defaults | All survive the rebuild |
| Table had a unique index and a plain index | **Both survive** (the F3 fix) |
| Orphan rows exist | Refused, message names the count, table unchanged |
| Referenced column is not PK/unique | Refused with a reason |
| Duplicate FK | Refused |
| Unknown table or column | Refused |
| `PRAGMA foreign_keys` was OFF beforehand | Still OFF afterwards (the existing `ColumnEditTest` invariant) |
| Rebuild fails midway | Original table intact, no `__rebuild` leftover |
| Drop one of three FKs | Only that one goes |
| Composite FK | Grouped by constraint id, not split |

Frontend: drop on an invalid target is refused before any request; a self-loop on the same column is
refused; the new edge gets correct crow's-foot notation without a manual refresh; Ctrl+Z removes it
from the database.

**Risk:** high — it writes DDL from a mouse gesture. Pre-flight validation and F3 are what make it
safe.

---

## ✅ Phase 6 — Ghost nodes for dropped tables *(done)*

**Goal:** a dropped table leaves a faded ghost with an Undo button before it actually disappears.

**Design decision: defer the drop, do not restore it.** The `DELETE /table/{name}` call fires only
when the ghost expires (~7 s). Undo cancels the timer. This needs **no** data snapshot, no restore
ordering, no backend change at all — and it fails safe, because a closed tab means the drop never
happened.

- Client-side FK pre-check first, from `activeWorkspace.relationships`, so a table another table
  references is refused *instantly* rather than 7 seconds later. The backend's 409
  (`TableInUseException`) stays authoritative.
- The ghost is a real node with `data.ghost = true`, so it must be filtered out of the same
  enumerations Phase 4 listed, plus `refreshActiveSchema`'s diff must not resurrect it.
- New `components/ui/UndoToast.tsx` — there is no toast primitive today. Also reusable by the
  history stack for "Undid: add column". Two constraints: `react-hooks/set-state-in-effect` is an
  **error**, so the countdown cannot be a naive `useEffect` + `setState` tick — drive it from a
  timer that calls a handler, or from CSS, the way `ExportModal`'s `setTimeout` "Copied" label does;
  and there is no exit animation in `globals.css`, so the dismiss keyframe is new work.
- If the deferred delete fails (backend 409), restore the node and explain via `NoticeModal`.

**Test cases**
| Case | Expect |
|---|---|
| Drop a table, wait | Ghost fades, then the table is really gone |
| Drop, click Undo | Table returns; backend never called |
| Drop a table another references | Refused immediately, no ghost |
| Drop, then close the file before expiry | Drop does not happen (fail-safe) |
| Drop A then B in quick succession | Two independent ghosts and timers |
| Drop, then Ctrl+F while the ghost is up | Ghost is not a search hit |
| Drop, then export PNG during the window | Ghost excluded |
| Ghost expires but the backend 409s | Node restored, error explained |

**Risk:** low-medium. Deferring rather than restoring removes almost all of it.

**Outcome.** Built as designed — no backend change at all, and no snapshot. Every case in the
table above verified in the browser (`phase6.js`): the ghost renders with its Undo button and
no request is sent; Undo cancels it and the backend is never called, even after the window has
passed; left alone it sends exactly one `DELETE`; a referenced table is refused instantly with
the dependant named; two ghosts run independent timers; a ghost is not a search hit.

Three things the plan did not anticipate:

- **The ghost must keep rendering its columns.** Each one carries the handle its edges attach to,
  so a header-only ghost silently detaches every relationship for the length of the countdown.
  Only pointer events are taken away, in CSS.
- **The timer has to re-check which file is open.** The workspace id travels as a request header,
  so a timer that outlived a file switch would drop a same-named table in the wrong database.
- **Excluding it from the PNG takes two changes, not one.** `html-to-image` walks the live DOM,
  so filtering the node array only shrank the canvas *around* the ghost, which stayed in the
  picture. It needs `toPng`'s own `filter` as well.

The `UndoToast` the plan called for was not needed: `ActionToast` already existed from Phase 3,
and the Undo button ended up on the node instead — that is where the user is already looking,
and two tables dropped in quick succession need two Undos, which one toast cannot offer.

---

## ✅ Phase 7 — Raw SQL scratchpad (+ views as nodes) *(done)*

**Goal:** a bottom drawer for raw SQL; a `CREATE VIEW` there renders as a node.

**Backend**
- Upgrade execution to multi-statement. `SqlScriptSplitter.split` already handles comments, quotes,
  `DELIMITER` and `GO`. Check `DatabaseService.runScript` (declared at L145) before writing anything
  new — the pattern to follow is the loop in `handleSqlUpload` (L131-144).
- Response contract per statement: `{sql, kind, rowCount | columns+rows, error}`, plus a top-level
  `schemaChanged: boolean` so the UI knows to call `refreshActiveSchema()`. The current
  `{data}`/`{error}` shape cannot express "statement 3 of 5 failed".
- **Gate with `AuthContext.require()`**, as `/export-sql` does (user's choice: signed-in only).
- Guardrails: statement-count cap, returned-row cap (~500), `Statement.setQueryTimeout`, and refuse
  any statement touching a `__`-prefixed internal table.
- **Views take three separate changes**, all of which are currently blockers:
  1. `Constants.Introspection.SQLITE_SELECT_USER_TABLES` (L193) filters `type='table'` → widen to
     `type IN ('table','view')`.
  2. `SqlDialectTranslator.UNSUPPORTED` (L116) *explicitly drops* `CREATE VIEW` on import.
  3. `TableInfo` needs an `isView` flag, and views must be excluded from row-editing endpoints and
     handled deliberately in `/export-sql`.
  `PRAGMA table_info` works on views, so columns come for free; `PRAGMA foreign_key_list` returns
  nothing, so a view node has no edges.

**Frontend**
- New `components/editor/SqlScratchpad.tsx`, mounted as a **sibling of the canvas** — CLAUDE.md L24
  is explicit that the old panel's mistake was nesting it inside `Visualizer.tsx`.
- Lightweight editor per the user's choice: a `<textarea>` over a `<pre>` of tokenised spans sharing
  one scroll container; `font-mono` picks up Geist Mono automatically. Keywords, strings, numbers and
  comments only — roughly 120 lines, no dependency. The project has seven runtime dependencies and
  Monaco would be the largest by an order of magnitude.
- Table/column autocomplete from `activeWorkspace.fileData.tables`.
- Ctrl+Enter runs; results in a tabbed pane below; a DDL statement triggers a schema refresh and a
  history barrier (Phase 3).
- View nodes render with a dashed border and a distinct header; no edit affordances.
- Git history has the old panel if it is useful as a reference: `git show 9f94caa^:db-viewer-ui/hooks/useQuery.ts`.

**Test cases**
| Case | Expect |
|---|---|
| `SELECT` | Columns and rows, capped, with the cap stated |
| Three statements, the second fails | Per-statement report naming which |
| `CREATE TABLE` in the scratchpad | Canvas refreshes, node appears |
| `CREATE VIEW v AS SELECT …` | View node appears, visibly distinct |
| Import a dump containing a view | View no longer silently dropped |
| Try to edit a row on a view | Refused, not a confusing SQL error |
| Export SQL with a view present | Handled deliberately, script still valid |
| `SELECT * FROM __table_notes` | Refused |
| Statement that never returns | Timed out, drawer stays usable |
| Signed out | Panel gated exactly as export is; API returns 401 |
| Semicolons inside string literals; `--` comments | Split correctly (existing splitter coverage) |
| Ctrl+Z in the editor | Native text undo |

**Risk:** medium-high. Views touch introspection, import and export at once; arbitrary SQL interacts
with undo. Largest phase — consider splitting the view support into its own step if it slips.

---

## ✅ Phase 8 — Inline data cell editing in a node *(done)*

**Goal:** double-click a cell in a node's sample-data strip to `UPDATE` it.

- Rows are **not** carried in node `data`. `/db-info` returns up to 100 rows per table and
  `page.tsx` drops them (L297-306) — putting them back would bloat every node and break `data`
  identity on refresh. Instead fetch lazily via the existing `dbService.getTableData(tableName)` when
  the user expands the strip, and hold them in node-**local** state.
- **This was tried once and removed.** `TableNode.tsx` L65-67: *"The add-column form lives in its own
  modal rather than inside the node: the node is only ~200px wide and scales with the canvas zoom,
  which made the inline form unusable at anything below 100%."* That verdict stands for a *form*;
  a single cell is a smaller target and survives it — but only if editing is gated to the full-detail
  zoom tier (Phase 9) and the strip is opt-in per node. If it cannot clear that bar in review, this
  phase should be dropped rather than shipped cramped.
- Show ~3 rows; the full grid stays in `DataEditor`.
- **Reuse `DataEditor`'s commit rule exactly**: commit on `onBlur` only; Enter and Escape both call
  `blur()`, with Escape setting an abandon flag. That file documents a duplicate-`update-cell` bug
  from having two commit paths — do not reintroduce it.
- React Flow v11 drags the node on mousedown inside an input unless the element carries `nodrag`
  (and `nowheel` for the scroll area).
- Row addressing assumes an `id`/`ID` column (existing limitation) — disable editing with a reason
  when absent, as `DataEditor` already does.
- Disabled below the Phase 9 detail threshold.

**Test cases**
| Case | Expect |
|---|---|
| Double-click, type, click away | One `update-cell`, value persists |
| Enter / Escape | Commit once / abandon; never two requests |
| Drag the node by the cell | Node does not move while editing |
| Table with no `id` column | Editing disabled with a reason |
| Edit at 50% zoom | Usable or cleanly disabled — not a broken half-state |
| Edit, then Ctrl+Z | Text-level undo, not a schema undo |
| Concurrent edit in the full `DataEditor` | Both converge after refresh |
| A view node | No editing affordance |

**Risk:** low-medium. The identity and `nodrag` traps are both already documented in the repo.

**Outcome.** Shipped, and it cleared the bar the plan set for it: the strip is offered only at the
`full` tier, so the verdict recorded in `TableNode` — that an inline form is unusable below 100%
zoom — is respected rather than argued with. Verified in `phase8.js`: nothing is fetched until the
disclosure is opened; a single click does not start an edit and a double-click does; Enter sends
**exactly one** `update-cell`; Escape sends none; the change survives a reload; dragging the node
by a cell does not move it (`nodrag`); and the strip is absent below full detail.

`DataEditor`'s commit rule was reused verbatim — `onBlur` only, with Escape setting an abandon
flag — so the duplicate-write bug that file documents has one implementation, not two.

---

## ✅ Phase 9 — Viewport lazy loading (level of detail) *(done)*

**Goal:** distant tables render as solid blocks; full detail only when zoomed in or on screen.

- `Visualizer.handleMove` (L69) already tracks zoom in state — but it is **unthrottled**, and zoom
  must **not** be passed down through node `data`, which would rebuild every node's `data` object on
  every frame of a pan. Read it inside `TableNode` via `useStore(s => s.transform[2])` instead:
  identity-safe, and each node subscribes independently.
- Three tiers, bounded by the canvas's `minZoom={0.1} maxZoom={2}`: **block** (name only),
  **compact** (name + key columns), **full** (everything). Thresholds tuned against a 100-table file.
- Off-viewport culling via React Flow v11's `onlyRenderVisibleElements`, measured before and after —
  it interacts with `fitView` and with the edge-obstacle selector, which reads `nodeInternals`.
- Written **last** deliberately: it has to account for everything the node renders by then — colour
  tags, tooltips, the sample-data strip, connection-mode handles.
- Mirror consideration: `DemoCanvas` has `minZoom={0.4}`, so LOD there would rarely trigger; leave it
  at full detail rather than adding a tier nobody sees.

**Test cases**
| Case | Expect |
|---|---|
| 100-table schema, zoom out fully | Blocks; frame rate stays smooth while panning |
| Zoom in | Tiers restore in order, no flicker at the boundary |
| Ctrl+F to a distant table | Pans, zooms, and that node is at full detail on arrival |
| Colour tags at block tier | Still visible — that is the tier where they matter most |
| Edges while zoomed out | Still routed correctly; obstacles still measured |
| Export PNG while zoomed out | Full detail regardless of screen zoom |
| Minimap during a fast pan | Keeps up |
| Inline cell editing at block tier | Cleanly unavailable |

**Outcome.** Three tiers, as designed, with one correction and one measured refusal.

The correction: the plan said to read the zoom in `TableNode` via `useStore`, which is right about
*where* and wrong about *what*. Selecting `transform[2]` hands every node a new value on every
frame of a wheel or pinch and re-renders all hundred — the exact cost the phase exists to remove.
The selector returns the **tier**, one of three strings, so a node re-renders only when it crosses
a boundary: twice for a zoom from 10% to 200%.

The trap the plan did not have: **a tier may drop a column's row, never its handle.** React Flow
resolves an edge by handle id, so a missing handle takes its relationship off the diagram with no
warning — and it caches measured handle positions rather than re-reading the DOM, so changing
which handles exist also needs `useUpdateNodeInternals`. The `block` tier emits a zero-height rail
of transparent handles for every edge endpoint. `phase9.js` asserts on each edge's
`getTotalLength()` rather than counting `<path>` elements, because a detached edge still leaves a
degenerate path in the DOM that a count would pass.

The refusal: **`onlyRenderVisibleElements` was measured and not adopted.** On a 100-table file at
fitted zoom the tiers take the canvas from **10,180 DOM elements to 3,195**, and frame rate was at
the 60fps cap both with and without them — so culling has nothing left to buy, and it would break
`exportImage.ts`, which relies on every node being in the DOM. The A/B was run by setting both
thresholds to 0 and re-running the same harness, not estimated.

**Risk:** medium. `onlyRenderVisibleElements` and the `nodeInternals`-based edge router can interact
badly — measure, as the hero-canvas flicker investigation did, rather than assume.

---

## Files that will change

**Backend** (`db-viewer-backend/src/main/java/com/dbviewer/app/`)
- `service/impl/DatabaseServiceImpl.java` — the bulk: generalised rebuild + F3, richer
  introspection, canvas-meta DAO, script execution, view support
- `common/Constants.java` — `CanvasMeta` block, widened table-listing SQL, new DDL
- `controller/DatabaseController.java` — new routes
- `service/DatabaseService.java`, `dto/ColumnInfo.java`, `dto/TableInfo.java`, `dto/Relationship.java`, new request DTOs
- `sql/SqlDialectTranslator.java` — stop dropping `CREATE VIEW`
- Tests: new `ForeignKeyConstraintTest`, `CanvasMetaTest`, `ScriptExecutionTest`, `ViewSupportTest`,
  `DropColumnTest`; extend `ColumnEditTest` (index/UNIQUE preservation) and
  `DatabaseControllerIntegrationTest`

**Frontend** (`db-viewer-ui/`)
- `app/app/page.tsx` — decoration layer (F1), stable edge ids (F2), history stack owner, ghost
  lifecycle, scratchpad mounting
- `components/canvas/Visualizer.tsx` — connectability, new node/edge types, LOD, toolbar toggles
- `components/tables/TableNode.tsx` — colour, tooltips, connection-mode handles, sample-data strip, LOD tiers
- `components/canvas/OrthogonalEdge.tsx` — cardinality markers (shared by three surfaces)
- `services/api.ts`, `types/index.ts` — new endpoints and enriched types
- `services/history.ts` (new), `components/canvas/GroupBox.tsx` (new),
  `components/editor/SqlScratchpad.tsx` (new), `components/ui/Tooltip.tsx` /
  `UndoToast.tsx` / `ColorSwatchPicker.tsx` (new)
- `app/globals.css` — `--color-tag-*` ramp in both themes, group-box and ghost styling
- `app/share/[token]/page.tsx` — port to `OrthogonalEdge`

**Docs** — this repo has an unusually explicit documentation contract; each phase owes all six:
1. `db-viewer-ui/CLAUDE.md` — a bullet in the Architecture list for each load-bearing decision:
   the canvas-connectability bullet (Phase 5 reverses it), the decoration layer (F1), the history
   barrier (Phase 3), and the "no SQL runner" claim at L24, which is wrong about the backend.
2. `db-viewer-ui/README.md` — a row in **Component guide** per new component, a bullet in
   **Styling** per new token/utility/animation, a numbered item in **Gotchas** per new trap.
3. `app/docs/page.tsx` — a `<Section id=… title=… lead=…>` plus a matching `GROUPS` entry (ids must
   agree). **Keybindings go in the `#shortcuts` `ActionTable` using `<Key>` from `DocsChrome`** —
   note that section currently lists only Enter, Esc and Scroll, so **Ctrl+F is already missing**;
   add it alongside Ctrl+Z while the file is open.
4. Root `README.md` — the **API reference** table for every new endpoint; **Troubleshooting** where
   a new failure mode is user-visible.
5. `docs/SYSTEM-DESIGN.md` — §4.3 API surface, §8 known limitations (two rows resolved by this
   work), §9 testing strategy; `docs/DATABASE-DESIGN.md` — §3.2a application-owned tables
   (`__canvas_meta`), §7.1 the generalised rebuild.
6. Optionally a `DocsSandbox` export. Undo/redo and crow's-foot notation are exactly the kind of
   claim that file's doc comment says the docs should *demonstrate* rather than assert.

---

## Verification

**Per phase, before moving on:**

```bash
# Backend
cd db-viewer-backend && ./mvnw test            # currently 96 green; must stay green
./mvnw test -Dtest=ForeignKeyConstraintTest    # the new suite for that phase

# Frontend — these are the only gates that exist
cd db-viewer-ui && npx tsc --noEmit && npm run lint && npm run build
```

There are **no project-local ESLint overrides** — everything comes from `eslint-config-next`'s
`react-hooks` plugin, and the following are **errors**, not warnings: `set-state-in-effect`,
`static-components`, `refs`, `immutability`, `purity`, `use-memo`, `set-state-in-render`. This work
will hit four of them:

- **`set-state-in-effect`** — the history stack and the undo toast both want "set state from an
  effect". Use `useSyncExternalStore` (as `Modal.tsx` and `ThemeToggle.tsx` do) or let *mounting be
  the reset*, which is the pattern every dialog in the repo already follows.
- **`immutability` / `purity`** — the undo stack must be push/pop via new arrays, never mutated in place.
- **`static-components`** — any component defined inside another must be hoisted to module scope.
- **`refs`** — refs may not be read or written during render; `activeWorkspaceIdRef` and
  `abandonEditRef` show the correct handler-and-effect-only usage.

The whole app currently carries exactly one suppression (`exhaustive-deps` at `page.tsx:429`).
Adding a second should be argued for, not assumed.

**End-to-end, in the browser** — start both servers, then drive Playwright from the npx cache the
way the existing `nav/verify.js` harness does. Per-phase checks are the test-case tables above; the
standing regression sweep across every phase:

1. Import a real `.sql` dump, confirm the canvas still renders and relationships are intact.
2. Both themes, at 1440px and 390px.
3. Landing page and `/docs` sandboxes — they share `OrthogonalEdge` and `DemoCanvas`, so Phase 2
   changes reach them whether intended or not.
4. A shared `/share/[token]` link.
5. Signed out: the scratchpad and export are gated; everything else still works.
6. A 100-table file for frame rate (Phase 9's premise; worth capturing a baseline in Phase 1 so the
   improvement is measurable rather than asserted).

**Backend test style to follow:** `@SpringBootTest` with inline `@TestPropertySource` forcing
`jdbc:sqlite::memory:`, a fresh random workspace per test bound in `@BeforeEach` and torn down in
`@AfterEach`, and assertions on the **resulting DDL and data** rather than on status codes —
`service/ColumnEditTest.java` is the model, and its `ddl(String table)` helper is the idiom for
asserting a constraint actually landed.

---

## Sequencing summary

| Phase | Feature | Depends on | Risk |
|---|---|---|---|
| ✅ 1 | Colour-coding & tagging (+ metadata store, F1) | — | Low |
| ✅ 2 | Crow's foot + constraint tooltips (+ metadata enrichment, F2) | — | Medium |
| ✅ 3 | Undo/redo stack | 1 | **High** |
| ✅ 4 | Domain grouping | 1, 3 | Medium |
| ✅ 5 | Drag-and-drop foreign keys (+ F3, F4) | 2, 3 | **High** |
| ✅ 6 | Ghost nodes | 3 | Low-med |
| ✅ 7 | SQL scratchpad + views | 3 | Med-high |
| ✅ 8 | Inline cell editing | — | Low-med |
| ✅ 9 | Viewport LOD | all | Medium |

Phases 1 and 2 are independent and could run in parallel. Phase 3 gates 4, 5, 6 and 7 — it is the
keystone, and the riskiest, which is the argument for doing it early rather than bolting undo onto
seven features after the fact.
