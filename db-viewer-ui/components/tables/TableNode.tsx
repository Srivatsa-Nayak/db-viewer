"use client";

import React, { memo, useState } from 'react';
import dynamic from 'next/dynamic';
import { Handle, Position } from 'reactflow';
import { Database, KeyRound, Link2, Plus, Download, Edit3, Pencil, Trash2, StickyNote } from 'lucide-react';
import { ColumnInfo } from '@/types';

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

const TableNode = ({ data }: { data: TableNodeData }) => {
  // The add-column form lives in its own modal (AddColumnModal) rather than inside the
  // node: the node is only ~200px wide and scales with the canvas zoom, which made the
  // inline form unusable at anything below 100%.
  const [isAddColumnOpen, setAddColumnOpen] = useState(false);
  const [editingColumn, setEditingColumn] = useState<ColumnInfo | null>(null);
  const [isNotesOpen, setNotesOpen] = useState(false);

  const columnNames = data.columns.map(c => c.name);

  return (
    <div className="bg-surface border border-brand-200 rounded-md min-w-[190px] max-w-[230px] shadow-glow-md transition-shadow hover:shadow-glow-lg group/node">

      <div className="brand-gradient px-2 py-1.5 flex items-center justify-between rounded-t-md gap-1">
        <div className="flex items-center gap-1.5 overflow-hidden">
          <Database size={10} className="text-white shrink-0" />
          <span className="font-bold text-white text-[10px] truncate leading-tight" title={data.label}>
            {data.label}
          </span>
        </div>

        <div className="flex gap-0.5 shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); setNotesOpen(true); }}
            className={`relative ${ACTION_BUTTON}`}
            title={data.openNotes ? `${data.openNotes} open note(s)` : 'Notes / to-do'}
            aria-label={`Notes for ${data.label}`}
          >
            <StickyNote size={11} />
            {!!data.openNotes && (
              <span className="absolute -top-1 -right-1 min-w-[12px] h-[12px] px-0.5 rounded-full bg-amber-400 text-[7px] font-bold text-amber-950 flex items-center justify-center">
                {data.openNotes}
              </span>
            )}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); data.onEdit(data.label); }}
            className={ACTION_BUTTON}
            title="Edit data"
            aria-label={`Edit data in ${data.label}`}
          >
            <Edit3 size={11} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); setAddColumnOpen(true); }}
            className={ACTION_BUTTON}
            title="Add column"
            aria-label={`Add a column to ${data.label}`}
          >
            <Plus size={11} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); data.onDownloadCsv?.(data.label); }}
            className={ACTION_BUTTON}
            title="Download CSV"
            aria-label={`Download ${data.label} as CSV`}
          >
            <Download size={11} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); data.onDelete?.(data.label); }}
            className={`${ACTION_BUTTON} hover:bg-red-500`}
            title="Delete table"
            aria-label={`Delete ${data.label}`}
          >
            <Trash2 size={11} />
          </button>
        </div>
      </div>

      <div className="flex flex-col bg-ink-50 py-0.5 rounded-b-md">
        {data.columns.map((col) => {
          // A foreign key points *out* of this table, so it is the target end of an edge.
          const foreign = isForeignKey(col, data.foreignKeyColumns);
          const sourceEnd = isSourceEnd(col, data.referencedColumns);
          const isMatch = data.highlightColumn === col.name;

          return (
            <div
              key={col.name}
              className={`group relative flex justify-between items-center px-2 py-0.5 transition-colors h-[22px] ${
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
                  ? <KeyRound size={8} className="text-key-pk shrink-0" />
                  : foreign
                    ? <Link2 size={8} className="text-key-fk shrink-0" />
                    : null}
                <span
                  className={`truncate font-mono text-[9px] leading-none ${
                    col.isPk
                      ? 'text-key-pk font-bold'
                      : foreign ? 'text-key-fk font-semibold' : 'text-ink-700 font-medium'
                  }`}
                  title={col.notNull ? `${col.name} (NOT NULL)` : col.name}
                >
                  {col.name}
                </span>
              </div>

              {/* Column type, with an edit affordance beside it on hover. */}
              <span className="flex items-center gap-1 shrink-0 ml-2">
                <span className="text-ink-400 font-mono uppercase text-[8px] leading-none">
                  {col.type}
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); setEditingColumn(col); }}
                  className="p-0.5 rounded text-ink-400 hover:text-brand-600 hover:bg-brand-50 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                  title={`Edit column "${col.name}"`}
                  aria-label={`Edit column ${col.name}`}
                >
                  <Pencil size={8} />
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
