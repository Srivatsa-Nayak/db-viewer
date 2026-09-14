"use client";

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    Loader2, Plus, Trash2, Save, AlertCircle, Pencil, Check, X, RefreshCw,
} from 'lucide-react';
import { dbService } from '@/services/api';
import { ColumnInfo, RowData } from '@/types';
import { Callout, GhostButton, Modal, PrimaryButton } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

interface DataEditorProps {
    tableName: string | null;
    onClose: () => void;
}

/** Maps a SQL type onto the HTML input that edits it most comfortably. */
const getInputType = (sqlType: string) => {
    const t = (sqlType || '').toLowerCase();
    if (t.includes('datetime') || t.includes('timestamp')) return 'datetime-local';
    if (t.includes('date')) return 'date';
    if (t.includes('time')) return 'time';
    if (t.includes('int') || t.includes('decimal') || t.includes('float') || t.includes('double')) return 'number';
    return 'text';
};

const formatValueForInput = (val: RowData[string] | undefined, type: string) => {
    // Checked against null/undefined rather than falsiness so a literal 0 or false
    // still reaches the input instead of being blanked out.
    if (val === null || val === undefined) return "";
    const strVal = String(val);
    // datetime-local expects "YYYY-MM-DDTHH:mm", SQL often gives "YYYY-MM-DD HH:mm:ss"
    if (type === 'datetime-local' && strVal.includes(' ')) {
        return strVal.replace(' ', 'T').substring(0, 16);
    }
    return strVal;
};

const getRowId = (row: RowData): string | number | null => {
    const value = row.id ?? row.ID;
    return typeof value === 'string' || typeof value === 'number' ? value : null;
};

const isIdColumn = (name: string) => name.toLowerCase() === 'id';

const CELL_INPUT = 'w-full bg-white text-ink-900 px-2 py-1.5 rounded border border-brand-300 '
    + 'outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 text-sm';

export const DataEditor = ({ tableName, onClose }: DataEditorProps) => {
    const [data, setData] = useState<RowData[]>([]);
    const [columns, setColumns] = useState<ColumnInfo[]>([]);
    const [loading, setLoading] = useState(false);
    /** A load that failed. Previously swallowed, so a dead backend rendered "Table is empty". */
    const [loadError, setLoadError] = useState<string | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);

    // Quick edit: a single cell, committed on blur.
    const [editingCell, setEditingCell] = useState<{ rowId: string | number; col: string } | null>(null);
    const [editValue, setEditValue] = useState("");
    /**
     * Set by Escape so the blur that follows does not write.
     *
     * Both Enter and blur used to commit, and Enter's own `setEditingCell(null)` unmounts the
     * input — which fires blur as well. Every Enter therefore risked a second, identical
     * `update-cell` request. There is now exactly one commit path (blur), and the keys just
     * decide whether it saves or abandons.
     */
    const abandonEditRef = useRef(false);

    // Row edit: every editable field in one row at once, committed with Save.
    const [editingRowId, setEditingRowId] = useState<string | number | null>(null);
    const [rowDraft, setRowDraft] = useState<RowData>({});
    const [isSavingRow, setIsSavingRow] = useState(false);

    const [deleteRowId, setDeleteRowId] = useState<string | number | null>(null);
    const [isDeletingRow, setDeletingRow] = useState(false);

    // Insert
    const [isAdding, setIsAdding] = useState(false);
    const [newRowData, setNewRowData] = useState<RowData>({});
    const [isInserting, setInserting] = useState(false);

    const loadData = useCallback(async () => {
        if (!tableName) return;
        setLoading(true);
        setLoadError(null);
        try {
            const response = await dbService.getTableData(tableName);

            if (response && !Array.isArray(response) && 'columns' in response) {
                const rawCols = response.columns;
                // The backend has shipped both `["id"]` and `[{name, type}]` over its life.
                if (Array.isArray(rawCols) && rawCols.every((col): col is string => typeof col === 'string')) {
                    setColumns(rawCols.map((c) => ({ name: c, type: 'TEXT' })));
                } else {
                    setColumns((rawCols as ColumnInfo[]) || []);
                }
                setData(response.rows || []);
            } else if (Array.isArray(response)) {
                setData(response);
                setColumns(response.length > 0
                    ? Object.keys(response[0]).map(k => ({ name: k, type: 'TEXT' }))
                    : []);
            }
        } catch (e) {
            console.error("Failed to load data:", e);
            setLoadError('Could not load this table. The backend may be unreachable.');
            setData([]);
        } finally {
            setLoading(false);
        }
    }, [tableName]);

    useEffect(() => {
        if (tableName) loadData();
    }, [tableName, loadData]);

    const describeError = (err: unknown, fallback: string) => {
        const message = err && typeof err === "object" && "response" in err
            ? (err as { response?: { data?: { error?: string } } }).response?.data?.error
            : undefined;
        return message || fallback;
    };

    /* ── Insert ──────────────────────────────────────────────────────────── */

    const cancelAdd = () => {
        setIsAdding(false);
        // Cleared on cancel too. Without this the next "Add new row" opened with blank-looking
        // inputs that still carried the abandoned values, and saved them.
        setNewRowData({});
    };

    const handleSaveNewRow = async (e: React.FormEvent) => {
        e.preventDefault();
        setInserting(true);
        try {
            await dbService.insertRow(tableName!, newRowData);
            setIsAdding(false);
            setNewRowData({});
            setActionError(null);
            await loadData();
        } catch (err: unknown) {
            setActionError(describeError(err, "Failed to add the row."));
        } finally {
            setInserting(false);
        }
    };

    /* ── Row edit ────────────────────────────────────────────────────────── */

    const startRowEdit = (row: RowData) => {
        const rowId = getRowId(row);
        if (rowId === null) return;
        setEditingCell(null);
        setEditingRowId(rowId);
        setRowDraft({ ...row });
    };

    const cancelRowEdit = () => {
        setEditingRowId(null);
        setRowDraft({});
    };

    const handleSaveRow = async () => {
        if (editingRowId === null || !tableName) return;
        const original = data.find(r => getRowId(r) === editingRowId);
        if (!original) return cancelRowEdit();

        // Only push the fields the user actually touched.
        const changed = columns.filter(col =>
            !isIdColumn(col.name) &&
            String(rowDraft[col.name] ?? "") !== String(original[col.name] ?? "")
        );
        if (changed.length === 0) return cancelRowEdit();

        setIsSavingRow(true);
        const written: string[] = [];
        try {
            // One request per field, because the backend only exposes update-cell. If one
            // fails partway the earlier ones have already been committed, so say which —
            // silently reporting "failed" over a half-written row is worse than the failure.
            for (const col of changed) {
                await dbService.updateCell({
                    tableName,
                    recordId: editingRowId,
                    columnName: col.name,
                    newValue: String(rowDraft[col.name] ?? ""),
                });
                written.push(col.name);
            }
            cancelRowEdit();
            setActionError(null);
            await loadData();
        } catch (err: unknown) {
            const base = describeError(err, "Failed to save the row.");
            setActionError(written.length > 0
                ? `${base} ${written.join(', ')} ${written.length === 1 ? 'was' : 'were'} saved before the error; the rest were not.`
                : base);
            cancelRowEdit();
            await loadData();
        } finally {
            setIsSavingRow(false);
        }
    };

    /* ── Single-cell quick edit ──────────────────────────────────────────── */

    const commitCellEdit = async () => {
        const cell = editingCell;
        setEditingCell(null);
        if (!cell || !tableName) return;
        if (abandonEditRef.current) {
            abandonEditRef.current = false;
            return;
        }

        const value = editValue;
        const previous = data;
        setData(prev => prev.map(row =>
            getRowId(row) === cell.rowId ? { ...row, [cell.col]: value } : row
        ));

        try {
            await dbService.updateCell({
                tableName, recordId: cell.rowId, columnName: cell.col, newValue: value,
            });
            setActionError(null);
        } catch (err: unknown) {
            // Put the optimistic edit back the way it was, then re-read to be sure.
            setData(previous);
            setActionError(describeError(err, "Failed to update the cell."));
            loadData();
        }
    };

    const confirmDeleteRow = async () => {
        if (deleteRowId === null) return;
        setDeletingRow(true);
        try {
            await dbService.deleteRow(tableName!, deleteRowId);
            setDeleteRowId(null);
            setActionError(null);
            await loadData();
        } catch (err: unknown) {
            setDeleteRowId(null);
            setActionError(describeError(err, "Failed to delete the row."));
            await loadData();
        } finally {
            setDeletingRow(false);
        }
    };

    const editableColumns = columns.filter(c => !isIdColumn(c.name));

    return (
        <>
            <Modal
                isOpen={tableName !== null}
                onClose={onClose}
                size="full"
                title={<span className="font-mono text-brand-700">{tableName}</span>}
                subtitle={
                    loading ? 'Loading…'
                        : `${data.length} row${data.length === 1 ? '' : 's'} · click a cell to edit it, or use the pencil for a whole row`
                }
                footer={
                    !isAdding ? (
                        <div className="flex items-center justify-between gap-3">
                            <PrimaryButton onClick={() => setIsAdding(true)} disabled={columns.length === 0}>
                                <Plus size={16} /> Add new row
                            </PrimaryButton>
                            <GhostButton onClick={loadData} disabled={loading} title="Reload from the database">
                                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                                <span className="hidden sm:inline">Refresh</span>
                            </GhostButton>
                        </div>
                    ) : (
                        <form onSubmit={handleSaveNewRow}>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-3 max-h-56 overflow-y-auto scroll-slim pr-1">
                                {editableColumns.map(col => {
                                    const inputType = getInputType(col.type);
                                    return (
                                        <div key={col.name}>
                                            <label
                                                htmlFor={`new-${col.name}`}
                                                className="block text-[10px] uppercase text-ink-500 font-bold mb-1 truncate"
                                            >
                                                {col.name}
                                            </label>
                                            <input
                                                id={`new-${col.name}`}
                                                type={inputType}
                                                className="w-full bg-white border border-ink-300 rounded px-2 py-2 text-sm text-ink-900 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                                                placeholder={inputType === 'text' ? "NULL" : ""}
                                                // Controlled, so Cancel genuinely discards.
                                                value={String(newRowData[col.name] ?? '')}
                                                onChange={(e) => setNewRowData(prev => ({ ...prev, [col.name]: e.target.value }))}
                                            />
                                        </div>
                                    );
                                })}
                            </div>
                            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
                                <GhostButton onClick={cancelAdd}>Cancel</GhostButton>
                                <PrimaryButton type="submit" disabled={isInserting}>
                                    {isInserting ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                                    Save row
                                </PrimaryButton>
                            </div>
                        </form>
                    )
                }
            >
                {actionError && (
                    <div className="mb-3">
                        <Callout tone="error" icon={<AlertCircle size={14} />}>{actionError}</Callout>
                    </div>
                )}

                {loading ? (
                    <div className="flex justify-center items-center h-40 text-ink-500 gap-2">
                        <Loader2 className="animate-spin" size={18} /> Loading…
                    </div>
                ) : loadError ? (
                    <div className="py-8">
                        <Callout tone="error" icon={<AlertCircle size={14} />}>
                            {loadError}{' '}
                            <button onClick={loadData} className="underline underline-offset-2 font-semibold">
                                Try again
                            </button>
                        </Callout>
                    </div>
                ) : (
                    // The table is the one thing allowed to scroll sideways: a wide table on a
                    // phone has no honest vertical layout, and squeezing columns to fit makes
                    // every value unreadable instead of just the ones off-screen.
                    <div className="-mx-4 sm:-mx-5 overflow-x-auto scroll-slim">
                        <table className="w-full min-w-max text-left border-collapse text-sm">
                            <thead>
                                <tr>
                                    {columns.map(col => (
                                        <th
                                            key={col.name}
                                            scope="col"
                                            className="px-3 py-2 border-b border-ink-200 text-ink-500 font-medium sticky top-0 bg-white z-10 font-mono whitespace-nowrap"
                                        >
                                            <span className="block">{col.name}</span>
                                            <span className="block text-[9px] text-ink-400 uppercase">{col.type}</span>
                                        </th>
                                    ))}
                                    <th className="px-3 py-2 border-b border-ink-200 sticky top-0 bg-white z-10 w-24" />
                                </tr>
                            </thead>
                            <tbody>
                                {data.length === 0 && (
                                    <tr>
                                        <td colSpan={columns.length + 1} className="p-8 text-center text-ink-400 italic">
                                            This table has no rows yet.
                                        </td>
                                    </tr>
                                )}
                                {data.map((row, i) => {
                                    const rowId = getRowId(row);
                                    const isRowEditing = rowId !== null && rowId === editingRowId;
                                    return (
                                        // Keyed by the row's own id where it has one. Keying by
                                        // array index meant deleting row 2 shifted every later
                                        // row up into a stale key, so an open editor could end
                                        // up bound to a different row than the one it started on.
                                        <tr
                                            key={rowId ?? `row-${i}`}
                                            className={`transition-colors group ${isRowEditing ? 'bg-brand-50/60' : 'hover:bg-ink-50'}`}
                                        >
                                            {columns.map(col => {
                                                const inputType = getInputType(col.type);
                                                const isEditing = editingCell?.rowId === rowId && editingCell?.col === col.name;
                                                const isLocked = isIdColumn(col.name);

                                                if (isRowEditing) {
                                                    return (
                                                        <td key={col.name} className="px-3 py-2 border-b border-ink-100">
                                                            {isLocked ? (
                                                                <span className="text-ink-400 font-mono">{row[col.name]?.toString()}</span>
                                                            ) : (
                                                                <input
                                                                    type={inputType}
                                                                    aria-label={col.name}
                                                                    className={CELL_INPUT}
                                                                    value={formatValueForInput(rowDraft[col.name], inputType)}
                                                                    onChange={e => setRowDraft(prev => ({ ...prev, [col.name]: e.target.value }))}
                                                                    onKeyDown={e => {
                                                                        if (e.key === 'Enter') handleSaveRow();
                                                                        if (e.key === 'Escape') cancelRowEdit();
                                                                    }}
                                                                />
                                                            )}
                                                        </td>
                                                    );
                                                }

                                                return (
                                                    <td
                                                        key={col.name}
                                                        className={`px-3 py-2 border-b border-ink-100 text-ink-700 max-w-xs truncate ${
                                                            isLocked ? '' : 'cursor-text hover:bg-brand-50/50 hover:ring-1 hover:ring-inset hover:ring-brand-200'
                                                        }`}
                                                        title={isLocked ? undefined : "Click to edit"}
                                                        onClick={() => {
                                                            if (rowId !== null && !isLocked && !isEditing) {
                                                                abandonEditRef.current = false;
                                                                setEditingCell({ rowId, col: col.name });
                                                                setEditValue(formatValueForInput(row[col.name], inputType));
                                                            }
                                                        }}
                                                    >
                                                        {isEditing ? (
                                                            <input
                                                                autoFocus
                                                                type={inputType}
                                                                aria-label={col.name}
                                                                className={CELL_INPUT}
                                                                value={editValue}
                                                                onChange={e => setEditValue(e.target.value)}
                                                                onBlur={commitCellEdit}
                                                                onKeyDown={e => {
                                                                    // Both keys just blur; the blur handler is the
                                                                    // single place a cell edit is ever committed.
                                                                    if (e.key === 'Enter') e.currentTarget.blur();
                                                                    if (e.key === 'Escape') {
                                                                        abandonEditRef.current = true;
                                                                        e.currentTarget.blur();
                                                                    }
                                                                }}
                                                            />
                                                        ) : (
                                                            row[col.name]?.toString() || <span className="text-ink-300 italic">null</span>
                                                        )}
                                                    </td>
                                                );
                                            })}

                                            <td className="px-3 py-2 border-b border-ink-100 text-right whitespace-nowrap">
                                                {isRowEditing ? (
                                                    <div className="flex gap-1 justify-end">
                                                        <button
                                                            onClick={handleSaveRow}
                                                            disabled={isSavingRow}
                                                            className="p-1.5 rounded brand-gradient text-white disabled:opacity-60"
                                                            aria-label="Save row"
                                                        >
                                                            {isSavingRow ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                                                        </button>
                                                        <button
                                                            onClick={cancelRowEdit}
                                                            disabled={isSavingRow}
                                                            className="p-1.5 rounded bg-ink-200 hover:bg-ink-300 text-ink-600"
                                                            aria-label="Cancel row edit"
                                                        >
                                                            <X size={14} />
                                                        </button>
                                                    </div>
                                                ) : (
                                                    // Visible by default on touch, where there is no hover.
                                                    <div className="flex gap-1 justify-end opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100 transition-opacity">
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); startRowEdit(row); }}
                                                            disabled={rowId === null}
                                                            className="text-ink-400 hover:text-brand-600 p-1.5 disabled:opacity-30 disabled:cursor-not-allowed"
                                                            aria-label="Edit row"
                                                            title={rowId === null ? "This row has no id column to edit by" : "Edit row"}
                                                        >
                                                            <Pencil size={14} />
                                                        </button>
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); setDeleteRowId(rowId); }}
                                                            disabled={rowId === null}
                                                            className="text-ink-400 hover:text-red-500 p-1.5 disabled:opacity-30 disabled:cursor-not-allowed"
                                                            aria-label="Delete row"
                                                            title={rowId === null ? "This row has no id column to delete by" : "Delete row"}
                                                        >
                                                            <Trash2 size={14} />
                                                        </button>
                                                    </div>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </Modal>

            <ConfirmDialog
                isOpen={deleteRowId !== null}
                title="Delete row?"
                message="This row will be permanently removed from the table."
                detail="This cannot be undone."
                confirmLabel="Delete row"
                isBusy={isDeletingRow}
                onConfirm={confirmDeleteRow}
                onClose={() => setDeleteRowId(null)}
            />
        </>
    );
};
