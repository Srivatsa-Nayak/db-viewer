"use client";

import React, { memo, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { Handle, Position, useNodeId, useStore, useUpdateNodeInternals } from 'reactflow';
import {
  Database, KeyRound, Link2, Plus, Download, Edit3, Pencil, Trash2, StickyNote, MoreVertical, Eye,
  Undo2, Loader2, Table2, ChevronDown, ChevronRight,
} from 'lucide-react';
import { ColumnInfo, RowData, TagColour } from '@/types';
import { dbService } from '@/services/api';
import { ColorSwatchPicker } from '@/components/ui/ColorSwatchPicker';
import { Tooltip } from '@/components/ui/Tooltip';
import {
  AnchoredMenu, MenuAnchor, MenuItem, MenuSeparator, MenuLabel,
} from '@/components/ui/AnchoredMenu';

/**
 * Loaded on demand, and only while open.
 *
 * These three used to be mounted inside *every* table node — a twelve-table schema carried
 * thirty-six modal components, all rendering null, all re-rendering whenever their node did.
 */
const AddColumnModal = dynamic(
    () => import('@/components/modal/AddColumnModal').then(m => m.AddColumnModal), { ssr: false });
const EditColumnModal = dynamic(
    () => import('@/components/modal/EditColumnModal').then(m => m.EditColumnModal), { ssr: false });
const TableNotesModal = dynamic(
    () => import('@/components/modal/TableNotesModal').then(m => m.TableNotesModal), { ssr: false });

interface TableNodeData {
  label: string;
  columns: ColumnInfo[];
  /**
   * Columns that really do hold a foreign key, from the relationship list.
   *
   * The naming heuristic below is the fallback, not the source of truth. It has to stay, because
   * a schema that names its keys `customer` rather than `customer_id` still needs *something* —
   * but a relationship the backend reported is not a guess, and an edge whose column had no
   * handle simply did not render.
   */
  foreignKeyColumns?: string[];
  /** Columns other tables point at, which therefore need a handle on the right. */
  referencedColumns?: string[];
  onRefresh: () => void;
  onEdit: (tableName: string) => void;
  /** Asks the page to confirm and run the delete, so the dialog is not trapped in the canvas. */
  onDelete?: (tableName: string) => void;
  /** Downloading needs an account, so the page owns the error handling. */
  onDownloadCsv?: (tableName: string) => void;
  /** Count of open to-do notes, used for the badge. */
  openNotes?: number;
  onNotesChanged?: () => void;
  /** Set by the canvas search, to pick one row out of the table it landed on. */
  highlightColumn?: string;
  /**
   * The user's short label for this table, e.g. "Billing".
   *
   * The *colour* is not here — it arrives as a `className` on the React Flow node, so that
   * changing it does not invalidate `data` and re-render every node mid-drag. The tag is text
   * the node has to render, so it has no such option.
   */
  tag?: string;
  /**
   * What each foreign-key column points at, as `table.column`, keyed by column name.
   *
   * Passed in rather than derived: the node only ever sees its own table, so it cannot work out
   * where a foreign key leads.
   */
  references?: Record<string, string>;
  /**
   * True when this table exists only to join two others.
   *
   * Labelled rather than drawn as an M:N edge, because M:N is not what the database contains —
   * see `junctionTables` in the page. The badge is the honest version of the same information.
   */
  isJunction?: boolean;
  /**
   * True for a view. It is drawn, but it is not editable: a view has no rows of its own, and the
   * backend refuses every write to one — so offering the controls would be offering a dead end.
   */
  isView?: boolean;
  /** Current colour, for the picker to show as selected. Undefined means none. */
  colour?: TagColour;
  onColourChange?: (tableName: string, colour: TagColour | undefined) => void;
  /**
   * Set while this table is waiting to be dropped.
   *
   * The delete is *deferred*, not undone: the node stays on the canvas for `ghostMs` and the
   * backend is only called when that expires. Nothing has to be snapshotted or put back,
   * because nothing has happened yet — and a closed tab means the drop never happens at all,
   * which is the right way for this to fail.
   */
  ghost?: boolean;
  /** How long the countdown runs, so the drain bar and the timer read from one number. */
  ghostMs?: number;
  onUndoDelete?: (tableName: string) => void;
}

const ACTION_BUTTON = 'p-1 rounded text-white/80 hover:text-white transition-colors';

/**
 * How many rows the strip shows.
 *
 * Three, not ten, and fixed rather than "as many as fit". This is a peek at what is in the table
 * — enough to see whether `status` holds `active` or `1`, which is the question a diagram cannot
 * answer — and a node that scrolls is a node that has stopped being a node.
 *
 * It follows that the strip is **not** a way to reach a particular row, and must not look like
 * one: at a thousand rows these three are simply the three the database returned first. Finding
 * a row is the full editor's job, which is why the footer links to it. The size of the table is
 * deliberately not quoted either — `/table-data` is capped at 100, so any count taken from the
 * response is the window, not the table.
 */
const SAMPLE_ROWS = 3;

/**
 * The row's identity, the same way the row editor works it out.
 *
 * `POST /update-cell` addresses a row by `id`, so a table without one cannot be edited here at
 * all — `DataEditor` disables its buttons for exactly this reason rather than silently doing
 * nothing, and the strip says so in words.
 */
const rowIdOf = (row: RowData): string | number | null => {
    const value = row.id ?? row.ID;
    return typeof value === 'string' || typeof value === 'number' ? value : null;
};

/** Whatever the driver returned, as something short enough to sit in a 60px cell. */
const displayValue = (value: unknown): string => {
    if (value === null || value === undefined) return '∅';
    return String(value);
};

/** A foreign key, by declaration if we have one and by convention if we do not. */
const isForeignKey = (column: ColumnInfo, declared?: string[]): boolean =>
  declared?.includes(column.name) ?? false
    ? true
    : column.name !== 'id' && column.name.endsWith('_id');

/** A column needs a handle on the right if an edge can start there. */
const isSourceEnd = (column: ColumnInfo, referenced?: string[]): boolean =>
  (referenced?.includes(column.name) ?? false)
    || column.isPk
    || column.name === 'id'
    || column.name.endsWith('_id');

/**
 * A column's full definition, in the order SQL declares it.
 *
 * The node itself can only show a name and a type — it is 200px wide — so everything else the
 * schema knows lives here. Assembled rather than stored, because the parts are exactly what
 * `/db-info` reports and a second copy would be a second thing to keep in step.
 */
const describeColumn = (col: ColumnInfo, referencesLabel?: string): string => {
    const parts = [col.type];
    if (col.isPk) parts.push('PRIMARY KEY');
    if (col.autoIncrement) parts.push('AUTOINCREMENT');
    // A primary key is already unique and already not-null; repeating it is noise.
    if (col.isUnique && !col.isPk) parts.push('UNIQUE');
    if (col.notNull && !col.isPk) parts.push('NOT NULL');
    if (col.defaultValue !== undefined && col.defaultValue !== null) {
        parts.push(`DEFAULT ${col.defaultValue}`);
    }
    if (referencesLabel) parts.push(`→ ${referencesLabel}`);
    return parts.join(' ');
};

/**
 * True while a connection is being dragged anywhere on the canvas.
 *
 * Read from React Flow's own store rather than passed down through `data`: `data` is compared by
 * reference, so pushing a per-frame flag into it would rebuild every node's data object and
 * re-render the whole canvas for the duration of the gesture. Each node subscribes independently
 * and only re-renders when the value actually flips.
 */
const selectIsConnecting = (state: { connectionNodeId: string | null }) =>
    state.connectionNodeId !== null;

/**
 * How much of a table to draw, from how far away it is being looked at.
 *
 * Three tiers rather than a continuum, because the point is to stop rendering things, and a
 * continuum never stops rendering anything:
 *
 * - **full** — everything. The only tier where a column can be read, so the only tier that
 *   offers a control.
 * - **compact** — the columns an edge attaches to, names only. Below ~70% the 9px type label is
 *   six pixels tall, so it is ink that cannot be read; the key columns are what the diagram is
 *   *about* at this distance.
 * - **block** — the name and a count. At 40% a 265px node is a hundred pixels wide and the
 *   whole schema is on screen, which is a different question than "what is in this table".
 */
export type DetailTier = 'block' | 'compact' | 'full';

const COMPACT_BELOW = 0.7;
const BLOCK_BELOW = 0.4;

/**
 * The tier, **not** the zoom.
 *
 * This distinction is the whole feature. Selecting `transform[2]` would hand every node a new
 * value on every frame of a pinch or a wheel and re-render all hundred of them, which is the
 * cost this phase exists to remove. A selector that returns one of three strings re-renders a
 * node only when it crosses a boundary — twice, for a zoom from 10% to 200%.
 */
const selectTier = (state: { transform: [number, number, number] }): DetailTier => {
    const zoom = state.transform[2];
    if (zoom < BLOCK_BELOW) return 'block';
    if (zoom < COMPACT_BELOW) return 'compact';
    return 'full';
};

const TableNode = ({ data }: { data: TableNodeData }) => {
  const isConnecting = useStore(selectIsConnecting);
  const tier = useStore(selectTier);
  const nodeId = useNodeId();
  const updateNodeInternals = useUpdateNodeInternals();
  // The anchor *is* the open state: null means closed. Captured on click rather than measured
  // by the menu, because the menu sits on a canvas that pans and zooms — see `MenuAnchor`.
  const [menuAnchor, setMenuAnchor] = useState<MenuAnchor | null>(null);
  // The add-column form lives in its own modal (AddColumnModal) rather than inside the
  // node: the node is only ~200px wide and scales with the canvas zoom, which made the
  // inline form unusable at anything below 100%.
  const [isAddColumnOpen, setAddColumnOpen] = useState(false);
  const [editingColumn, setEditingColumn] = useState<ColumnInfo | null>(null);
  const [isNotesOpen, setNotesOpen] = useState(false);

  /* ── The sample-data strip ────────────────────────────────────────────────
     Rows are held here, in the node, and fetched only when the strip is opened. They are
     deliberately *not* carried in `data`: `/db-info` already returns up to a hundred rows per
     table and the page throws them away, because putting them back would mean a new `data`
     object for every node on every refresh — which React Flow compares by reference, so the
     whole canvas would re-render. Node-local state costs nothing until somebody asks.
     ──────────────────────────────────────────────────────────────────────── */
  const [isDataOpen, setDataOpen] = useState(false);
  const [rows, setRows] = useState<RowData[] | null>(null);
  const [isLoadingRows, setLoadingRows] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);
  const [editingCell, setEditingCell] = useState<{ rowId: string | number; col: string } | null>(null);
  const [cellDraft, setCellDraft] = useState('');
  /**
   * Set by Escape so the blur that follows it writes nothing.
   *
   * `DataEditor` records why there is exactly one commit path: it once had a second one in the
   * key handler, and every Enter fired a duplicate `update-cell`. Enter and Escape both only
   * call `blur()`; this flag is the difference between them.
   */
  const abandonCellRef = useRef(false);

  const openData = async () => {
    const next = !isDataOpen;
    setDataOpen(next);
    if (!next || rows !== null || isLoadingRows) return;
    setLoadingRows(true);
    setDataError(null);
    try {
      const result = await dbService.getTableData(data.label);
      setRows(Array.isArray(result) ? result : result.rows);
    } catch {
      setDataError('Could not read the rows.');
    } finally {
      setLoadingRows(false);
    }
  };

  const commitCell = async () => {
    const cell = editingCell;
    setEditingCell(null);
    if (!cell) return;
    if (abandonCellRef.current) {
      abandonCellRef.current = false;
      return;
    }

    const value = cellDraft;
    const previous = rows;
    setRows(prev => prev?.map(row =>
      rowIdOf(row) === cell.rowId ? { ...row, [cell.col]: value } : row) ?? prev);

    try {
      await dbService.updateCell({
        tableName: data.label, recordId: cell.rowId, columnName: cell.col, newValue: value,
      });
      setDataError(null);
    } catch {
      // Put the optimistic edit back. The strip is three rows of a table somebody is looking
      // at, so showing a value the database rejected is worse than showing the old one.
      setRows(previous);
      setDataError('That change was not saved.');
    }
  };

  const columnNames = data.columns.map(c => c.name);

  /**
   * Which columns an edge can attach to — the ones whose handles must exist at every tier.
   *
   * A handle that stops being rendered takes its edge with it: React Flow resolves an edge by
   * looking its handle up by id, and a missing one means the relationship is simply not drawn.
   * So the tiers below may drop a column's *row*, never its handle.
   */
  const edgeColumns = data.columns.filter(col =>
    isForeignKey(col, data.foreignKeyColumns) || isSourceEnd(col, data.referencedColumns));

  const visibleColumns = tier === 'block' ? []
    : tier === 'compact' ? edgeColumns
    : data.columns;

  /*
   * React Flow caches each handle's measured position and does not re-read the DOM on its own.
   * Changing which handles a node renders therefore leaves stale bounds behind — edges land at
   * the old offsets, or at the node's origin — until the node is explicitly re-measured. This
   * is the library's sanctioned escape hatch for exactly that, and the dependency is the tier,
   * so it runs twice in a full zoom rather than on every frame.
   */
  useEffect(() => {
    if (nodeId) updateNodeInternals(nodeId);
  }, [tier, nodeId, updateNodeInternals]);

  // Wider and taller than it was. The previous 190px was set by how many icon buttons had to fit
  // across the header; with those gone the constraint is the only one that should have applied
  // all along — how long a column name is before it truncates.
  return (
    <div className={`node-card bg-surface rounded-md min-w-[215px] max-w-[265px] shadow-glow-md
                     transition-shadow hover:shadow-glow-lg group/node ${
      data.isView ? 'border border-dashed border-ink-400' : 'border border-brand-200'
    }`}>

      <div className="node-header brand-gradient px-2.5 py-2 flex items-center justify-between rounded-t-md gap-1.5">
        <div className="flex items-center gap-1.5 overflow-hidden">
          {data.isView
            ? <Eye size={12} className="text-white shrink-0" />
            : <Database size={12} className="text-white shrink-0" />}
          <span className="font-bold text-white text-[11px] truncate leading-tight" title={data.label}>
            {data.label}
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {/* Every action is withheld while the table is on its way out. Offering "Add column"
              on something that will be dropped in four seconds is offering work that is about
              to be thrown away. */}
          {/* The note count stays on the face of the node. It is the one thing here that is
              information rather than an action — a table with open questions against it should
              say so without anyone opening a menu to find out. */}
          {!!data.openNotes && (
            <button
              onClick={(e) => { e.stopPropagation(); setNotesOpen(true); }}
              className="flex items-center gap-1 rounded-full bg-amber-400 px-1.5 py-px text-[9px]
                         font-bold text-amber-950 transition-transform hover:scale-105"
              title={`${data.openNotes} open note(s)`}
              aria-label={`${data.openNotes} open notes on ${data.label}`}
            >
              <StickyNote size={9} />
              {data.openNotes}
            </button>
          )}

          {/* One button instead of six.

              Six 11px glyphs in a 200px header left the table name about forty pixels wide and
              gave every action the same weight, so the one that drops the table looked exactly
              like the one that downloads it. A menu can afford words. */}
          {!data.ghost && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                const el = e.currentTarget;
                setMenuAnchor(open => (open ? null : { el, rect: el.getBoundingClientRect() }));
              }}
              className={`${ACTION_BUTTON} ${menuAnchor ? 'bg-white/20 text-white' : ''}`}
              title="Table actions"
              aria-label={`Actions for ${data.label}`}
              aria-haspopup="menu"
              aria-expanded={!!menuAnchor}
            >
              <MoreVertical size={14} />
            </button>
          )}
        </div>

        <AnchoredMenu
          anchor={menuAnchor}
          onClose={() => setMenuAnchor(null)}
          label={`Actions for ${data.label}`}
        >
          {/* A view has no rows of its own and no columns to alter. The backend refuses both,
              so the menu does not offer them — a control that always errors is worse than none. */}
          {!data.isView && (
            <>
              <MenuItem
                icon={<Edit3 size={14} />}
                onClick={() => { setMenuAnchor(null); data.onEdit(data.label); }}
                description="View, add and delete rows"
              >
                Edit data
              </MenuItem>
              <MenuItem
                icon={<Plus size={14} />}
                onClick={() => { setMenuAnchor(null); setAddColumnOpen(true); }}
                description="ALTER TABLE ... ADD COLUMN"
              >
                Add column
              </MenuItem>
            </>
          )}
          <MenuItem
            icon={<StickyNote size={14} />}
            onClick={() => { setMenuAnchor(null); setNotesOpen(true); }}
            badge={!!data.openNotes && (
              <span className="rounded-full bg-amber-400 px-1.5 text-[9px] font-bold text-amber-950">
                {data.openNotes}
              </span>
            )}
          >
            Notes
          </MenuItem>
          <MenuItem
            icon={<Download size={14} />}
            onClick={() => { setMenuAnchor(null); data.onDownloadCsv?.(data.label); }}
            description="Rows as a .csv file"
          >
            Download CSV
          </MenuItem>

          <MenuSeparator />

          <MenuLabel>Colour</MenuLabel>
          <div className="px-3 pb-2">
            <ColorSwatchPicker
              value={data.colour}
              label=""
              onChange={colour => {
                data.onColourChange?.(data.label, colour);
                setMenuAnchor(null);
              }}
            />
          </div>

          <MenuSeparator />

          <MenuItem
            icon={<Trash2 size={14} />}
            tone="danger"
            onClick={() => { setMenuAnchor(null); data.onDelete?.(data.label); }}
          >
            Delete table
          </MenuItem>
        </AnchoredMenu>
      </div>

      {/* The one thing on a ghost that is still clickable.

          Placed on the node rather than in a toast at the bottom of the canvas because the node
          is where the user is already looking — they just used its menu — and because two
          tables dropped in quick succession need two independent Undos, which a single toast
          cannot offer. */}
      {data.ghost && (
        <div className="border-b border-rose-300 bg-rose-50 px-2 py-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[9px] font-bold uppercase tracking-wide text-rose-700">
              Deleting…
            </span>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); data.onUndoDelete?.(data.label); }}
              className="flex items-center gap-1 rounded bg-rose-600 px-1.5 py-0.5 text-[9px]
                         font-bold text-white transition-colors hover:bg-rose-700"
              aria-label={`Keep ${data.label} — cancel the delete`}
            >
              <Undo2 size={9} /> Undo
            </button>
          </div>
          <div className="mt-1 h-0.5 w-full overflow-hidden rounded-full bg-rose-200">
            <div
              className="ghost-drain h-full w-full bg-rose-500"
              // Inline because the duration is data: it comes from the same constant that arms
              // the timer, so the bar cannot finish before or after the drop does.
              style={{ animationDuration: `${data.ghostMs ?? 7000}ms` }}
            />
          </div>
        </div>
      )}

      {/* The tag reads as a caption under the title rather than a badge beside it: the header
          already carries five controls, and a name plus a label competing for the same row is
          what makes a node illegible at 50%. */}
      {(data.tag || data.isJunction || data.isView) && (
        <div className="px-2 py-1 bg-surface-tint border-b border-line flex items-center gap-1.5">
          {data.isView && (
            <Tooltip
              content="A view: a saved query that reads from other tables. It has no rows of its
                       own, so it cannot be edited here — change the tables it reads from."
              className="shrink-0 rounded bg-ink-200 px-1 py-px text-[8px] font-bold uppercase
                         tracking-wide text-ink-600 outline-none focus-visible:ring-1 focus-visible:ring-brand-500"
            >
              view
            </Tooltip>
          )}
          {data.isJunction && (
            <Tooltip
              content="A join table: its whole primary key is made of foreign keys, so it exists to
                       connect the two tables it points at rather than to describe anything itself.
                       The two lines leaving it are the many-to-many."
              className="shrink-0 text-[8px] font-bold uppercase tracking-wide rounded px-1 py-px
                         bg-ink-200 text-ink-600 outline-none focus-visible:ring-1 focus-visible:ring-brand-500"
            >
              join
            </Tooltip>
          )}
          {data.tag && (
            <span className="text-[9px] font-semibold uppercase tracking-wide text-ink-500 truncate"
                  title={data.tag}>
              {data.tag}
            </span>
          )}
        </div>
      )}

      {/* `node-ghost-body` turns pointer events off in CSS. The columns still render, because
          each one carries the handle its edges attach to — hiding them would detach every
          relationship for the length of the countdown. */}
      <div className={`flex flex-col bg-ink-50 py-0.5 rounded-b-md ${
        data.ghost ? 'node-ghost-body' : ''
      }`}>
        {/* At block tier the rows are gone but the relationships are not, so every handle an
            edge names is still emitted — stacked in a zero-height strip at the top of the body,
            which is where the lines should converge when the node is a hundred pixels wide. */}
        {tier === 'block' && (
          <div className="relative h-0" aria-hidden="true">
            {edgeColumns.map((col) => (
              <React.Fragment key={col.name}>
                <Handle
                  type="target"
                  position={Position.Left}
                  id={`${col.name}-left`}
                  className="!h-px !w-px !min-h-0 !min-w-0 !border-0 !bg-transparent"
                  style={{ left: 0, top: 0 }}
                />
                <Handle
                  type="source"
                  position={Position.Right}
                  id={`${col.name}-right`}
                  className="!h-px !w-px !min-h-0 !min-w-0 !border-0 !bg-transparent"
                  style={{ right: 0, top: 0 }}
                />
              </React.Fragment>
            ))}
          </div>
        )}

        {/* What the node says instead of its columns. A count, because "does this table have
            three columns or thirty" is the one thing about its contents that still reads at
            this size. */}
        {tier === 'block' && (
          <div className="px-2.5 py-1 text-center text-[10px] font-medium text-ink-500">
            {data.columns.length} column{data.columns.length === 1 ? '' : 's'}
          </div>
        )}

        {tier === 'compact' && edgeColumns.length < data.columns.length && (
          <div className="px-2.5 pb-0.5 pt-1 text-[9px] font-medium text-ink-400">
            keys only · {data.columns.length} columns
          </div>
        )}

        {visibleColumns.map((col) => {
          // A foreign key points *out* of this table, so it is the target end of an edge.
          const foreign = isForeignKey(col, data.foreignKeyColumns);
          const sourceEnd = isSourceEnd(col, data.referencedColumns);
          const isMatch = data.highlightColumn === col.name;

          return (
            <div
              key={col.name}
              className={`group relative flex justify-between items-center px-2.5 py-0.5 transition-colors h-[26px] ${
                isMatch ? 'bg-brand-100 ring-1 ring-inset ring-brand-400' : 'hover:bg-ink-100'
              }`}
            >
              {/* A handle exists for a real foreign key, and — only while somebody is dragging
                  one — for every other column too, so there is something to drop onto. Rendering
                  them all permanently would register a thousand handles on a hundred-table schema
                  for a gesture nobody is making. */}
              {(foreign || isConnecting) && (
                <div className="absolute -left-1.5 top-1/2 -translate-y-1/2 z-50">
                  <Handle
                    type="target"
                    position={Position.Left}
                    id={`${col.name}-left`}
                    className={`!w-2.5 !h-2.5 !border-2 ${
                      foreign ? '!bg-key-fk' : '!bg-ink-300 !border-dashed'
                    }`}
                  />
                </div>
              )}

              <div className="flex items-center gap-1.5 overflow-hidden">
                {/* Two shapes as well as two colours — a key and a link — because the icons are
                    four pixels wide at the zoom level where a 100-table schema fits on screen. */}
                {col.isPk
                  ? <KeyRound size={10} className="text-key-pk shrink-0" />
                  : foreign
                    ? <Link2 size={10} className="text-key-fk shrink-0" />
                    : null}
                <Tooltip
                  content={
                    <>
                      <span className="font-mono font-semibold text-ink-900">{col.name}</span>
                      <span className="font-mono"> {describeColumn(col, data.references?.[col.name])}</span>
                    </>
                  }
                  className={`truncate font-mono text-[10px] leading-none outline-none
                    focus-visible:ring-1 focus-visible:ring-brand-500 rounded-sm ${
                    col.isPk
                      ? 'text-key-pk font-bold'
                      : foreign ? 'text-key-fk font-semibold' : 'text-ink-700 font-medium'
                  }`}
                >
                  {col.name}
                </Tooltip>
              </div>

              {/* Column type, with an edit affordance beside it on hover.

                  Both are dropped below full detail: at 60% the type label is six pixels tall
                  and the pencil is a five-pixel target, so they are cost without benefit — and
                  a control nobody can hit is worse than one that is not offered. */}
              {tier === 'full' && (
                <span className="flex items-center gap-1 shrink-0 ml-2">
                  <span className="text-ink-400 font-mono uppercase text-[9px] leading-none">
                    {col.type}
                  </span>
                  {!data.ghost && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setEditingColumn(col); }}
                      className="p-0.5 rounded text-ink-400 hover:text-brand-600 hover:bg-brand-50 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                      title={`Edit column "${col.name}"`}
                      aria-label={`Edit column ${col.name}`}
                    >
                      <Pencil size={10} />
                    </button>
                  )}
                </span>
              )}

              {(sourceEnd || isConnecting) && (
                <div className="absolute -right-1.5 top-1/2 -translate-y-1/2 z-50">
                  <Handle
                    type="source"
                    position={Position.Right}
                    id={`${col.name}-right`}
                    className={`!w-2.5 !h-2.5 !border-2 ${
                      sourceEnd
                        ? (col.isPk ? '!bg-key-pk' : '!bg-key-fk')
                        : '!bg-ink-300 !border-dashed'
                    }`}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Sample data ───────────────────────────────────────────────────
          Full detail only, and that is not a nicety. The comment on `isAddColumnOpen` above
          records why the add-column *form* was taken out of the node: at 200px wide and scaled
          by the canvas zoom it was unusable below 100%. A single cell is a much smaller target
          and survives that verdict — but only at a zoom where the text can be read, so the
          strip is not offered at all below the full tier rather than offered and unusable.

          Views are excluded because they have no rows of their own and the backend refuses
          every write to one; a ghost is excluded because it is on its way out. */}
      {tier === 'full' && !data.isView && !data.ghost && (
        <div className="border-t border-line">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); void openData(); }}
            className="flex w-full items-center gap-1 px-2.5 py-1 text-[9px] font-semibold
                       uppercase tracking-wide text-ink-500 transition-colors hover:bg-ink-100"
            aria-expanded={isDataOpen}
            aria-label={`${isDataOpen ? 'Hide' : 'Show'} sample rows for ${data.label}`}
          >
            {isDataOpen ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
            <Table2 size={9} />
            Data
            {isLoadingRows && <Loader2 size={9} className="ml-auto animate-spin" />}
          </button>

          {isDataOpen && (
            // `nodrag` or React Flow pans the node the moment a mousedown lands in the input;
            // `nowheel` so scrolling the strip sideways does not zoom the canvas instead.
            <div className="nodrag nowheel max-w-full overflow-x-auto scroll-slim bg-surface-tint px-1 pb-1">
              {dataError && (
                <p className="px-1.5 py-1 text-[9px] font-medium text-tone-error-ink">{dataError}</p>
              )}
              {rows !== null && rows.length === 0 && (
                <p className="px-1.5 py-1 text-[9px] text-ink-400">No rows yet.</p>
              )}
              {rows !== null && rows.length > 0 && (() => {
                // True when the strip is hiding something. Reliable in both directions: the
                // response is capped at 100 and the sample is 3, so `>` can only be wrong if
                // the cap were ever lowered below the sample size.
                const hasMoreRows = rows.length > SAMPLE_ROWS;
                return (
                <>
                  <table className="w-max border-separate border-spacing-x-1 text-[9px]">
                    <thead>
                      <tr>
                        {data.columns.map(col => (
                          <th key={col.name}
                              className="px-1 text-left font-mono font-semibold text-ink-400">
                            {col.name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.slice(0, SAMPLE_ROWS).map((row, index) => {
                        const rowId = rowIdOf(row);
                        return (
                          // Keyed by the row's own id, never by index — the rule the row
                          // editor already follows.
                          <tr key={rowId ?? `row-${index}`}>
                            {data.columns.map(col => {
                              const isEditing = editingCell?.rowId === rowId
                                && editingCell?.col === col.name;
                              if (isEditing) {
                                return (
                                  <td key={col.name} className="p-0">
                                    <input
                                      autoFocus
                                      value={cellDraft}
                                      onChange={e => setCellDraft(e.target.value)}
                                      // The only commit path. Enter and Escape both just blur.
                                      onBlur={() => { void commitCell(); }}
                                      onKeyDown={e => {
                                        if (e.key === 'Enter') e.currentTarget.blur();
                                        if (e.key === 'Escape') {
                                          abandonCellRef.current = true;
                                          e.currentTarget.blur();
                                        }
                                      }}
                                      aria-label={`${col.name} of row ${rowId}`}
                                      className="w-20 rounded border border-brand-400 bg-surface px-1
                                                 font-mono text-[9px] text-ink-900 outline-none"
                                    />
                                  </td>
                                );
                              }
                              return (
                                <td
                                  key={col.name}
                                  // Double-click, not single: a single click on a node is how
                                  // the canvas selects and drags it, and stealing that would
                                  // break grouping.
                                  onDoubleClick={(e) => {
                                    e.stopPropagation();
                                    if (rowId === null) return;
                                    abandonCellRef.current = false;
                                    setCellDraft(row[col.name] === null || row[col.name] === undefined
                                      ? '' : String(row[col.name]));
                                    setEditingCell({ rowId, col: col.name });
                                  }}
                                  title={rowId === null
                                    ? 'This row has no id column, so it cannot be edited here'
                                    : `Double-click to edit ${col.name}`}
                                  className={`max-w-[90px] truncate rounded px-1 font-mono text-ink-600 ${
                                    rowId === null ? 'cursor-default' : 'cursor-text hover:bg-brand-50'
                                  }`}
                                >
                                  {displayValue(row[col.name])}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {/* What the footer may claim depends on whether anything is hidden.

                      `/table-data` is capped at 100, so `rows.length` is the size of the window
                      and not of the table — quoting it as a total read "3 of 100" for a
                      150-row table, which is false. But *below* the sample size the two
                      coincide: three rows back means three rows exist, so a count is safe and
                      more useful than a vague one.

                      The same test decides the link. Offering "All rows" when all the rows are
                      already on screen is offering to show them again; the node menu's
                      "Edit data" is still there for adding and deleting, so nothing is lost by
                      leaving it out. */}
                  <p className="flex items-center gap-1 px-1 pt-0.5 text-[8px] text-ink-400">
                    {rowIdOf(rows[0]) === null
                      ? 'No id column — rows cannot be edited here.'
                      : hasMoreRows
                        ? 'First few rows. Double-click a cell to edit.'
                        : `All ${rows.length} row${rows.length === 1 ? '' : 's'}. Double-click a cell to edit.`}
                    {hasMoreRows && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); data.onEdit(data.label); }}
                        className="ml-auto shrink-0 rounded px-1 font-semibold text-brand-700
                                   underline underline-offset-2 transition-colors hover:bg-brand-50"
                      >
                        All rows
                      </button>
                    )}
                  </p>
                </>
                );
              })()}
            </div>
          )}
        </div>
      )}

      {isAddColumnOpen && (
        <AddColumnModal
          isOpen
          tableName={data.label}
          existingColumns={columnNames}
          onClose={() => setAddColumnOpen(false)}
          onSuccess={() => data.onRefresh?.()}
        />
      )}

      {editingColumn && (
        <EditColumnModal
          isOpen
          tableName={data.label}
          column={editingColumn}
          existingColumns={columnNames}
          onClose={() => setEditingColumn(null)}
          onSuccess={() => data.onRefresh?.()}
        />
      )}

      {isNotesOpen && (
        <TableNotesModal
          isOpen
          tableName={data.label}
          onClose={() => setNotesOpen(false)}
          onChanged={() => data.onNotesChanged?.()}
        />
      )}
    </div>
  );
};

export default memo(TableNode);
