import React, { useState, useEffect } from 'react';
import { X, Loader2, Plus, Trash2, AlertTriangle, Save, AlertCircle } from 'lucide-react';
import { dbService } from '@/services/api';

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
const formatValueForInput = (val: any, type: string) => {
    if (!val) return "";
    const strVal = String(val);
    // datetime-local expects "YYYY-MM-DDTHH:mm", SQL often gives "YYYY-MM-DD HH:mm:ss"
    if (type === 'datetime-local' && strVal.includes(' ')) {
        return strVal.replace(' ', 'T').substring(0, 16);
    }
    return strVal;
};

export const DataEditor = ({ tableName, onClose }: DataEditorProps) => {
    const [data, setData] = useState<any[]>([]);
    // Store objects { name: "id", type: "INT" } instead of just strings
    const [columns, setColumns] = useState<{name: string, type: string}[]>([]); 
    const [loading, setLoading] = useState(false);
    
    // Edit State
    const [editingCell, setEditingCell] = useState<{rowId: any, col: string} | null>(null);
    const [editValue, setEditValue] = useState("");

    // Modal States
    const [deleteConfirm, setDeleteConfirm] = useState<{isOpen: boolean, rowId: any | null}>({ isOpen: false, rowId: null });
    const [errorModal, setErrorModal] = useState<{isOpen: boolean, message: string}>({ isOpen: false, message: "" });

    // Insert State
    const [isAdding, setIsAdding] = useState(false);
    const [newRowData, setNewRowData] = useState<any>({});

    useEffect(() => {
        if (tableName) loadData();
    }, [tableName]);

    const loadData = async () => {
        if (!tableName) return;
        setLoading(true);
        try {
            const response = await dbService.getTableData(tableName);
            
            // 1. Handle { columns: [...], rows: [...] } format
            if (response && !Array.isArray(response) && 'columns' in response) {
                const rawCols = (response as any).columns;
                
                // Robust Check: Is the backend sending strings ["id"] or objects [{name:"id", type:"INT"}]?
                if (Array.isArray(rawCols) && rawCols.length > 0 && typeof rawCols[0] === 'string') {
                    // Fallback: Convert strings to objects so the UI doesn't break
                    setColumns(rawCols.map((c: string) => ({ name: c, type: 'TEXT' })));
                } else {
                    // Already in correct format
                    setColumns(rawCols || []);
                }
                
                setData((response as any).rows || []); 
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
    };

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
        } catch (err: any) {
            setErrorModal({ isOpen: true, message: err.response?.data?.error || "Failed to add row" });
        }
    };

    const handleSaveCell = async () => {
        if (!editingCell || !tableName) return;
        const newData = [...data];
        const rowIndex = newData.findIndex(r => (r.id || r.ID) == editingCell.rowId);
        
        if (rowIndex !== -1) {
            newData[rowIndex][editingCell.col] = editValue;
            setData(newData);
        }

        try {
            await dbService.updateCell({
                tableName,
                recordId: editingCell.rowId,
                columnName: editingCell.col,
                newValue: editValue
            });
        } catch (err) {
            setErrorModal({ isOpen: true, message: "Failed to update cell" });
            loadData(); 
        }
        setEditingCell(null);
    };

    const confirmDeleteRow = async () => {
        const id = deleteConfirm.rowId;
        if (!id) return;
        setData(prev => prev.filter(row => (row.id || row.ID) !== id));
        setDeleteConfirm({ isOpen: false, rowId: null });
        try {
            await dbService.deleteRow(tableName!, id);
        } catch (err) { loadData(); setErrorModal({ isOpen: true, message: "Failed to delete row" }); }
    };

    if (!tableName) return null;

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-900 w-full max-w-4xl max-h-[80vh] rounded-lg shadow-2xl flex flex-col border border-slate-700 relative">
                
                {/* Header */}
                <div className="p-4 border-b border-slate-700 flex justify-between items-center bg-slate-800 rounded-t-lg">
                    <h2 className="text-lg font-bold text-white flex items-center gap-2">
                        Editing: <span className="text-indigo-400 font-mono">{tableName}</span>
                    </h2>
                    <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={20} /></button>
                </div>

                {/* Content */}
                <div id="data-table-container" className="flex-1 overflow-auto p-4 bg-slate-950">
                    {loading ? (
                        <div className="flex justify-center items-center h-40 text-slate-400 gap-2"><Loader2 className="animate-spin" /> Loading...</div>
                    ) : (
                        <table className="w-full text-left border-collapse text-sm">
                            <thead>
                                <tr>
                                    {columns.map(col => (
                                        <th key={col.name} className="p-2 border-b border-slate-700 text-slate-400 font-medium sticky top-0 bg-slate-950 z-10">
                                            <div className="flex flex-col">
                                                <span>{col.name}</span>
                                                <span className="text-[9px] text-slate-600 uppercase">{col.type}</span>
                                            </div>
                                        </th>
                                    ))}
                                    <th className="p-2 border-b border-slate-700 sticky top-0 bg-slate-950 z-10 w-10"></th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.length === 0 && !loading && (
                                    <tr><td colSpan={columns.length+1} className="p-8 text-center text-slate-500 italic">Table is empty.</td></tr>
                                )}
                                {data.map((row, i) => {
                                    const rowId = row.id || row.ID;
                                    return (
                                        <tr key={i} className="hover:bg-slate-900 transition-colors group">
                                            {columns.map(col => {
                                                const inputType = getInputType(col.type);
                                                const isEditing = editingCell?.rowId === rowId && editingCell?.col === col.name;
                                                return (
                                                <td key={col.name} 
                                                    className="p-2 border-b border-slate-800 text-slate-300 cursor-pointer hover:bg-slate-800"
                                                    onClick={() => {
                                                        if(col.name.toLowerCase() !== 'id' && !isEditing) {
                                                            setEditingCell({ rowId, col: col.name });
                                                            // Format date values for input
                                                            setEditValue(formatValueForInput(row[col.name], inputType));
                                                        }
                                                    }}
                                                >
                                                    {isEditing ? (
                                                        <input autoFocus 
                                                            type={inputType}
                                                            className="w-full bg-slate-700 text-white p-1 rounded border border-indigo-500 outline-none"
                                                            value={editValue} 
                                                            onChange={e => setEditValue(e.target.value)}
                                                            onBlur={handleSaveCell} 
                                                            onKeyDown={e => e.key === 'Enter' && handleSaveCell()}
                                                        />
                                                    ) : (row[col.name]?.toString() || <span className="text-slate-600 italic">null</span>)}
                                                </td>
                                            )})}
                                            <td className="p-2 border-b border-slate-800 text-right">
                                                <button onClick={(e) => { e.stopPropagation(); setDeleteConfirm({ isOpen: true, rowId }); }}
                                                    className="text-slate-600 hover:text-red-500 p-1.5 opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 size={14} /></button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                </div>

                {/* Footer / Insert Form */}
                <div className="p-3 bg-slate-800 border-t border-slate-700 rounded-b-lg">
                    {!isAdding ? (
                        <button onClick={() => setIsAdding(true)} className="flex items-center gap-1 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded text-sm font-medium shadow-lg transition-colors">
                            <Plus size={16} /> Add New Row
                        </button>
                    ) : (
                        <div className="bg-slate-700/50 p-3 rounded border border-slate-600 animate-in slide-in-from-bottom-2">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                                {columns.map(col => {
                                    if(col.name.toLowerCase() === 'id') return null;
                                    const inputType = getInputType(col.type);
                                    return (
                                        <div key={col.name}>
                                            <label className="block text-[10px] uppercase text-slate-400 font-bold mb-1">{col.name}</label>
                                            <input 
                                                type={inputType}
                                                className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1 text-sm text-white focus:border-indigo-500 outline-none"
                                                placeholder={inputType === 'text' ? "NULL" : ""}
                                                onChange={(e) => setNewRowData({...newRowData, [col.name]: e.target.value})}
                                            />
                                        </div>
                                    )
                                })}
                            </div>
                            <div className="flex justify-end gap-2">
                                <button onClick={() => { setIsAdding(false); }} className="px-3 py-1.5 text-slate-400 hover:text-white text-sm">Cancel</button>
                                <button onClick={handleSaveNewRow} className="flex items-center gap-2 px-4 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded text-sm font-medium shadow-lg">
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
                    <div className="bg-slate-900 border border-slate-700 rounded-lg p-6 max-w-sm w-full text-center">
                         <div className="text-red-500 mb-2 flex justify-center"><AlertCircle size={32} /></div>
                         <p className="text-slate-300 mb-4">{errorModal.message}</p>
                         <button onClick={() => setErrorModal({ ...errorModal, isOpen: false })} className="bg-slate-800 text-white px-4 py-2 rounded w-full">Close</button>
                    </div>
                </div>
            )}
             {deleteConfirm.isOpen && (
                <div className="absolute inset-0 bg-black/60 z-[60] flex items-center justify-center p-4 backdrop-blur-sm">
                    <div className="bg-slate-900 border border-slate-700 rounded-lg p-6 max-w-sm w-full shadow-2xl">
                        <div className="flex flex-col items-center text-center gap-4">
                            <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center text-red-500"><AlertTriangle size={24} /></div>
                            <div><h3 className="text-lg font-bold text-white mb-1">Delete Row?</h3><p className="text-slate-400 text-sm">Cannot be undone.</p></div>
                            <div className="flex gap-3 w-full mt-2">
                                <button onClick={() => setDeleteConfirm({ isOpen: false, rowId: null })} className="flex-1 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700">Cancel</button>
                                <button onClick={confirmDeleteRow} className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded">Delete</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};