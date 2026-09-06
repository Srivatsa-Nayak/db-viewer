import React, { useState, useEffect, useCallback } from 'react';
import { X, Loader2, Plus, Trash2, AlertTriangle, Save, AlertCircle, Pencil, Check } from 'lucide-react';
import { dbService } from '@/services/api';
import { ColumnInfo, RowData } from '@/types';

interface DataEditorProps {
    tableName: string | null;
    onClose: () => void;
}

// Helper to map SQL types to HTML Input types
const getInputType = (sqlType: string) => {
    const t = sqlType.toLowerCase();
    if (t.includes('datetime') || t.includes('timestamp')) return 'datetime-local';
    if (t.includes('date')) return 'date';
    if (t.includes('time')) return 'time';
    if (t.includes('int') || t.includes('decimal') || t.includes('float') || t.includes('double')) return 'number';
    if (t.includes('bool') || t.includes('bit')) return 'text';
    return 'text';
};

// Helper to format values for Date Pickers (YYYY-MM-DD)
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

export const DataEditor = ({ tableName, onClose }: DataEditorProps) => {
    const [data, setData] = useState<RowData[]>([]);
    // Store objects { name: "id", type: "INT" } instead of just strings
    const [columns, setColumns] = useState<ColumnInfo[]>([]);
    const [loading, setLoading] = useState(false);

    // Quick edit: a single cell, committed on blur or Enter.
    const [editingCell, setEditingCell] = useState<{rowId: string | number, col: string} | null>(null);
    const [editValue, setEditValue] = useState("");

    // Row edit: every editable field in one row at once, committed with Save.
    const [editingRowId, setEditingRowId] = useState<string | number | null>(null);
    const [rowDraft, setRowDraft] = useState<RowData>({});
    const [isSavingRow, setIsSavingRow] = useState(false);

    // Modal States
    const [deleteConfirm, setDeleteConfirm] = useState<{isOpen: boolean, rowId: string | number | null}>({ isOpen: false, rowId: null });
    const [errorModal, setErrorModal] = useState<{isOpen: boolean, message: string}>({ isOpen: false, message: "" });

    // Insert State
    const [isAdding, setIsAdding] = useState(false);
    const [newRowData, setNewRowData] = useState<RowData>({});

    const loadData = useCallback(async () => {
        if (!tableName) return;
        setLoading(true);
        try {
            const response = await dbService.getTableData(tableName);

            // 1. Handle { columns: [...], rows: [...] } format
            if (response && !Array.isArray(response) && 'columns' in response) {
                const rawCols = response.columns;

                // Robust Check: Is the backend sending strings ["id"] or objects [{name:"id", type:"INT"}]?
                if (Array.isArray(rawCols) && rawCols.every((col): col is string => typeof col === 'string')) {
                    // Fallback: Convert strings to objects so the UI doesn't break
                    setColumns(rawCols.map((c) => ({ name: c, type: 'TEXT' })));
                } else {
                    // Already in correct format
                    setColumns(rawCols || []);
                }

                setData(response.rows || []);
            }
            // 2. Handle fallback array format (Legacy: just rows)
            else if (Array.isArray(response)) {
                setData(response);
                if (response.length > 0) {
                    // Extract keys and default type to TEXT
                    const keys = Object.keys(response[0]);
                    setColumns(keys.map(k => ({ name: k, type: 'TEXT' })));
                }
            }
        } catch (e) {
            console.error("Failed to load data:", e);
        } finally {
            setLoading(false);
        }
    }, [tableName]);

    useEffect(() => {
        if (tableName) loadData();
    }, [tableName, loadData]);

    const handleSaveNewRow = async () => {
        try {
            await dbService.insertRow(tableName!, newRowData);
            setIsAdding(false);
            setNewRowData({});
            loadData();
            setTimeout(() => {
                const container = document.getElementById('data-table-container');
                if(container) container.scrollTop = container.scrollHeight;
            }, 100);
        } catch (err: unknown) {
            const message = err && typeof err === "object" && "response" in err
                ? (err as { response?: { data?: { error?: string } } }).response?.data?.error
                : undefined;
            setErrorModal({ isOpen: true, message: message || "Failed to add row" });
        }
    };

    // --- Row edit ---------------------------------------------------------------

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
        try {
            for (const col of changed) {
                await dbService.updateCell({
                    tableName,
                    recordId: editingRowId,
                    columnName: col.name,
                    newValue: String(rowDraft[col.name] ?? "")
                });
            }
            cancelRowEdit();
            await loadData();
        } catch (err: unknown) {
            const message = err && typeof err === "object" && "response" in err
                ? (err as { response?: { data?: { error?: string } } }).response?.data?.error
                : undefined;
            setErrorModal({ isOpen: true, message: message || "Failed to save row" });
            loadData();
        } finally {
            setIsSavingRow(false);
        }
    };

    // --- Single-cell quick edit -------------------------------------------------

    const handleSaveCell = async () => {
        if (!editingCell || !tableName) return;
        const cell = editingCell;
        const value = editValue;
        setEditingCell(null);

        setData(prev => prev.map(row =>
            getRowId(row) === cell.rowId ? { ...row, [cell.col]: value } : row
        ));

        try {
            await dbService.updateCell({
                tableName,
                recordId: cell.rowId,
                columnName: cell.col,
                newValue: value
            });
        } catch {
            setErrorModal({ isOpen: true, message: "Failed to update cell" });
            loadData();
        }
    };

    const confirmDeleteRow = async () => {
        const id = deleteConfirm.rowId;
        // Compared against null explicitly: a row with id 0 is still a real row.
        if (id === null || id === undefined) return;
        setData(prev => prev.filter(row => getRowId(row) !== id));
        setDeleteConfirm({ isOpen: false, rowId: null });
        try {
            await dbService.deleteRow(tableName!, id);
        } catch { loadData(); setErrorModal({ isOpen: true, message: "Failed to delete row" }); }
    };

    if (!tableName) return null;

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white w-full max-w-4xl max-h-[80vh] rounded-lg shadow-2xl flex flex-col border border-zinc-200 relative">

                {/* Header */}
                <div className="p-4 border-b border-zinc-200 flex justify-between items-center bg-white rounded-t-lg">
                    <div>
                        <h2 className="text-lg font-bold text-zinc-900 flex items-center gap-2">
                            Editing: <span className="text-blue-600 font-mono">{tableName}</span>
                        </h2>
                        <p className="text-xs text-zinc-400 mt-0.5">
                            Click a cell to edit it, or use <Pencil size={10} className="inline -mt-0.5" /> to edit the whole row.
                        </p>
                    </div>
                    <button onClick={onClose} className="text-zinc-400 hover:text-zinc-900"><X size={20} /></button>
                </div>

                {/* Content */}
                <div id="data-table-container" className="flex-1 overflow-auto p-4 bg-white">
                    {loading ? (
                        <div className="flex justify-center items-center h-40 text-zinc-500 gap-2"><Loader2 className="animate-spin" /> Loading...</div>
                    ) : (
                        <table className="w-full text-left border-collapse text-sm">
                            <thead>
                                <tr>
                                    {columns.map(col => (
                                        <th key={col.name} className="p-2 border-b border-zinc-200 text-zinc-500 font-medium sticky top-0 bg-white z-10 font-mono">
                                            <div className="flex flex-col">
                                                <span>{col.name}</span>
                                                <span className="text-[9px] text-zinc-400 uppercase">{col.type}</span>
                                            </div>
                                        </th>
                                    ))}
                                    <th className="p-2 border-b border-zinc-200 sticky top-0 bg-white z-10 w-20"></th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.length === 0 && !loading && (
                                    <tr><td colSpan={columns.length+1} className="p-8 text-center text-zinc-400 italic">Table is empty.</td></tr>
                                )}
                                {data.map((row, i) => {
                                    const rowId = getRowId(row);
                                    const isRowEditing = rowId !== null && rowId === editingRowId;
                                    return (
                                        <tr key={i} className={`transition-colors group ${isRowEditing ? 'bg-blue-50/60' : 'hover:bg-zinc-50'}`}>
                                            {columns.map(col => {
                                                const inputType = getInputType(col.type);
                                                const isEditing = editingCell?.rowId === rowId && editingCell?.col === col.name;
                                                const isLocked = isIdColumn(col.name);

                                                // Whole-row edit takes over the cell rendering.
                                                if (isRowEditing) {
                                                    return (
                                                        <td key={col.name} className="p-2 border-b border-zinc-100">
                                                            {isLocked ? (
                                                                <span className="text-zinc-400 font-mono">{row[col.name]?.toString()}</span>
                                                            ) : (
                                                                <input
                                                                    type={inputType}
                                                                    className="w-full bg-white text-zinc-900 p-1 rounded border border-blue-300 outline-none focus:border-blue-500"
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
                                                <td key={col.name}
                                                    className={`p-2 border-b border-zinc-100 text-zinc-700 ${isLocked ? '' : 'cursor-text hover:bg-blue-50/50 hover:ring-1 hover:ring-inset hover:ring-blue-200'}`}
                                                    title={isLocked ? undefined : "Click to edit"}
                                                    onClick={() => {
                                                        if(rowId !== null && !isLocked && !isEditing) {
                                                            setEditingCell({ rowId, col: col.name });
                                                            // Format date values for input
                                                            setEditValue(formatValueForInput(row[col.name], inputType));
                                                        }
                                                    }}
                                                >
                                                    {isEditing ? (
                                                        <input autoFocus
                                                            type={inputType}
                                                            className="w-full bg-white text-zinc-900 p-1 rounded border border-blue-400 outline-none"
                                                            value={editValue}
                                                            onChange={e => setEditValue(e.target.value)}
                                                            onBlur={handleSaveCell}
                                                            onKeyDown={e => {
                                                                if (e.key === 'Enter') handleSaveCell();
                                                                // Escape abandons the edit without writing.
                                                                if (e.key === 'Escape') setEditingCell(null);
                                                            }}
                                                        />
                                                    ) : (row[col.name]?.toString() || <span className="text-zinc-300 italic">null</span>)}
                                                </td>
                                            )})}

                                            <td className="p-2 border-b border-zinc-100 text-right whitespace-nowrap">
                                                {isRowEditing ? (
                                                    <div className="flex gap-1 justify-end">
                                                        <button onClick={handleSaveRow} disabled={isSavingRow}
                                                            className="p-1.5 rounded bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-60" title="Save row">
                                                            {isSavingRow ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                                                        </button>
                                                        <button onClick={cancelRowEdit} disabled={isSavingRow}
                                                            className="p-1.5 rounded bg-zinc-200 hover:bg-zinc-300 text-zinc-600" title="Cancel">
                                                            <X size={14} />
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <div className="flex gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                                                        <button onClick={(e) => { e.stopPropagation(); startRowEdit(row); }}
                                                            disabled={rowId === null}
                                                            className="text-zinc-400 hover:text-blue-600 p-1.5 disabled:opacity-30 disabled:cursor-not-allowed"
                                                            title={rowId === null ? "This row has no id column to edit by" : "Edit row"}>
                                                            <Pencil size={14} />
                                                        </button>
                                                        <button onClick={(e) => { e.stopPropagation(); setDeleteConfirm({ isOpen: true, rowId }); }}
                                                            className="text-zinc-400 hover:text-red-500 p-1.5" title="Delete row"><Trash2 size={14} /></button>
                                                    </div>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                </div>

                {/* Footer / Insert Form */}
                <div className="p-3 bg-white border-t border-zinc-200 rounded-b-lg">
                    {!isAdding ? (
                        <button onClick={() => setIsAdding(true)} className="flex items-center gap-1 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded text-sm font-semibold shadow-sm transition-colors">
                            <Plus size={16} /> Add New Row
                        </button>
                    ) : (
                        <div className="bg-zinc-50 p-3 rounded border border-zinc-200 animate-in slide-in-from-bottom-2">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                                {columns.map(col => {
                                    if(isIdColumn(col.name)) return null;
                                    const inputType = getInputType(col.type);
                                    return (
                                        <div key={col.name}>
                                            <label className="block text-[10px] uppercase text-zinc-500 font-bold mb-1">{col.name}</label>
                                            <input
                                                type={inputType}
                                                className="w-full bg-white border border-zinc-300 rounded px-2 py-1 text-sm text-zinc-900 focus:border-blue-500 outline-none"
                                                placeholder={inputType === 'text' ? "NULL" : ""}
                                                onChange={(e) => setNewRowData({...newRowData, [col.name]: e.target.value})}
                                            />
                                        </div>
                                    )
                                })}
                            </div>
                            <div className="flex justify-end gap-2">
                                <button onClick={() => { setIsAdding(false); }} className="px-3 py-1.5 text-zinc-500 hover:text-zinc-900 text-sm">Cancel</button>
                                <button onClick={handleSaveNewRow} className="flex items-center gap-2 px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm font-semibold shadow-sm">
                                    <Save size={14} /> Save Row
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Modal Logic (Errors / Delete) same as before... */}
            {errorModal.isOpen && (
                <div className="absolute inset-0 bg-black/60 z-[70] flex items-center justify-center p-4 backdrop-blur-sm">
                    <div className="bg-white border border-zinc-200 rounded-lg p-6 max-w-sm w-full text-center shadow-2xl">
                         <div className="text-red-500 mb-2 flex justify-center"><AlertCircle size={32} /></div>
                         <p className="text-zinc-700 mb-4">{errorModal.message}</p>
                         <button onClick={() => setErrorModal({ ...errorModal, isOpen: false })} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded w-full">Close</button>
                    </div>
                </div>
            )}
             {deleteConfirm.isOpen && (
                <div className="absolute inset-0 bg-black/60 z-[60] flex items-center justify-center p-4 backdrop-blur-sm">
                    <div className="bg-white border border-zinc-200 rounded-lg p-6 max-w-sm w-full shadow-2xl">
                        <div className="flex flex-col items-center text-center gap-4">
                            <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center text-red-500"><AlertTriangle size={24} /></div>
                            <div><h3 className="text-lg font-bold text-zinc-900 mb-1">Delete Row?</h3><p className="text-zinc-500 text-sm">Cannot be undone.</p></div>
                            <div className="flex gap-3 w-full mt-2">
                                <button onClick={() => setDeleteConfirm({ isOpen: false, rowId: null })} className="flex-1 px-4 py-2 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 rounded border border-zinc-200">Cancel</button>
                                <button onClick={confirmDeleteRow} className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded">Delete</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
