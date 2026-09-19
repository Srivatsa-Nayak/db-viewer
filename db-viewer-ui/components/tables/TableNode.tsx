"use client";

import React, { memo, useState } from 'react';
import dynamic from 'next/dynamic';
import { Handle, Position } from 'reactflow';
import {
  Database, KeyRound, Link2, Plus, Download, Edit3, Pencil, Trash2, StickyNote, MoreVertical,
} from 'lucide-react';
import { ColumnInfo, TagColour } from '@/types';
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
  /** Current colour, for the picker to show as selected. Undefined means none. */
  colour?: TagColour;
  onColourChange?: (tableName: string, colour: TagColour | undefined) => void;
}

const ACTION_BUTTON = 'p-1 rounded text-white/80 hover:text-white transition-colors';

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

const TableNode = ({ data }: { data: TableNodeData }) => {
  // The anchor *is* the open state: null means closed. Captured on click rather than measured
  // by the menu, because the menu sits on a canvas that pans and zooms — see `MenuAnchor`.
  const [menuAnchor, setMenuAnchor] = useState<MenuAnchor | null>(null);
  // The add-column form lives in its own modal (AddColumnModal) rather than inside the
  // node: the node is only ~200px wide and scales with the canvas zoom, which made the
  // inline form unusable at anything below 100%.
  const [isAddColumnOpen, setAddColumnOpen] = useState(false);
  const [editingColumn, setEditingColumn] = useState<ColumnInfo | null>(null);
  const [isNotesOpen, setNotesOpen] = useState(false);

  const columnNames = data.columns.map(c => c.name);

  // Wider and taller than it was. The previous 190px was set by how many icon buttons had to fit
  // across the header; with those gone the constraint is the only one that should have applied
  // all along — how long a column name is before it truncates.
  return (
    <div className="node-card bg-surface border border-brand-200 rounded-md min-w-[215px] max-w-[265px] shadow-glow-md transition-shadow hover:shadow-glow-lg group/node">

      <div className="node-header brand-gradient px-2.5 py-2 flex items-center justify-between rounded-t-md gap-1.5">
        <div className="flex items-center gap-1.5 overflow-hidden">
          <Database size={12} className="text-white shrink-0" />
          <span className="font-bold text-white text-[11px] truncate leading-tight" title={data.label}>
            {data.label}
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
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
        </div>

        <AnchoredMenu
          anchor={menuAnchor}
          onClose={() => setMenuAnchor(null)}
          label={`Actions for ${data.label}`}
        >
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

      {/* The tag reads as a caption under the title rather than a badge beside it: the header
          already carries five controls, and a name plus a label competing for the same row is
          what makes a node illegible at 50%. */}
      {(data.tag || data.isJunction) && (
        <div className="px-2 py-1 bg-surface-tint border-b border-line flex items-center gap-1.5">
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

      <div className="flex flex-col bg-ink-50 py-0.5 rounded-b-md">
        {data.columns.map((col) => {
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
              {foreign && (
                <div className="absolute -left-1.5 top-1/2 -translate-y-1/2 z-50">
                  <Handle
                    type="target"
                    position={Position.Left}
                    id={`${col.name}-left`}
                    isConnectable={false}
                    className="!w-2.5 !h-2.5 !bg-key-fk !border-2"
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

              {/* Column type, with an edit affordance beside it on hover. */}
              <span className="flex items-center gap-1 shrink-0 ml-2">
                <span className="text-ink-400 font-mono uppercase text-[9px] leading-none">
                  {col.type}
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); setEditingColumn(col); }}
                  className="p-0.5 rounded text-ink-400 hover:text-brand-600 hover:bg-brand-50 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                  title={`Edit column "${col.name}"`}
                  aria-label={`Edit column ${col.name}`}
                >
                  <Pencil size={10} />
                </button>
              </span>

              {sourceEnd && (
                <div className="absolute -right-1.5 top-1/2 -translate-y-1/2 z-50">
                  <Handle
                    type="source"
                    position={Position.Right}
                    id={`${col.name}-right`}
                    isConnectable={false}
                    className={`!w-2.5 !h-2.5 !border-2 ${col.isPk ? '!bg-key-pk' : '!bg-key-fk'}`}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

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
