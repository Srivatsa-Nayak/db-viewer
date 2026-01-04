import React, { useState, useEffect } from 'react';
import { X, Loader2, Plus, Trash2, AlertTriangle, Save } from 'lucide-react'; // <--- Import AlertTriangle
import { dbService } from '@/services/api';

interface DataEditorProps {
    tableName: string | null;
    onClose: () => void;
}

export const DataEditor = ({ tableName, onClose }: DataEditorProps) => {
    const [data, setData] = useState<any[]>([]);
    const [columns, setColumns] = useState<string[]>([]);
    const [loading, setLoading] = useState(false);
    
    const [editingCell, setEditingCell] = useState<{rowId: any, col: string} | null>(null);
    const [editValue, setEditValue] = useState("");

    // Insert State
    const [isAdding, setIsAdding] = useState(false);
    const [newRowData, setNewRowData] = useState<any>({});
    const [insertError, setInsertError] = useState<string | null>(null);

    // Delete Confirmation State
    const [deleteConfirm, setDeleteConfirm] = useState<{isOpen: boolean, rowId: any | null}>({
        isOpen: false,
        rowId: null
    });

    useEffect(() => {
        if (tableName) {
            loadData();
        }
    }, [tableName]);

    const loadData = async () => {
        if (!tableName) return;
        setLoading(true);
        try {
            const response = await dbService.getTableData(tableName);
            
            // Handle { columns: [...], rows: [...] } format
            if (response && !Array.isArray(response) && 'columns' in response) {
                setColumns((response as any).columns);
                setData((response as any).rows || []); 
            } 
            // Handle fallback array format
            else if (Array.isArray(response)) {
                setData(response);
                if (response.length > 0) {
                    setColumns(Object.keys(response[0]));
                }
            }
        } catch (e) {
            console.error("Failed to load data:", e);
        } finally {
            setLoading(false);
        }
    };

    // Trigger the Delete Modal
    const promptDeleteRow = (id: any) => {
        setDeleteConfirm({ isOpen: true, rowId: id });
    };

    // Actually Delete the Row (After clicking "Yes")
    const confirmDeleteRow = async () => {
        const id = deleteConfirm.rowId;
        if (!id) return;

        // Optimistic UI Update
        setData(prev => prev.filter(row => row.id !== id));
        setDeleteConfirm({ isOpen: false, rowId: null }); // Close modal immediately

        try {
            await dbService.deleteRow(tableName!, id);
        } catch (err) {
            alert("Failed to delete row");
            loadData();
        }
    };

    const handleSaveCell = async () => {
        if (!editingCell || !tableName) return;

        const newData = [...data];
        const rowIndex = newData.findIndex(r => r.id == editingCell.rowId);
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
            alert("Failed to save value");
            loadData(); 
        }
        
        setEditingCell(null);
    };

    const handleAddRow = async () => {
        if (!tableName) return;
        try {
            await dbService.insertRow(tableName);
            await loadData(); 
            const container = document.getElementById('data-table-container');
            if(container) container.scrollTop = container.scrollHeight;
        } catch (err) {
            alert("Failed to add row");
        }
    };

    const handleSaveNewRow = async () => {
        try {
            await dbService.insertRow(tableName!, newRowData);
            setIsAdding(false);
            setNewRowData({});
            setInsertError(null);
            loadData(); // Refresh to see new row
            
            // Auto scroll to bottom
            setTimeout(() => {
                const container = document.getElementById('data-table-container');
                if(container) container.scrollTop = container.scrollHeight;
            }, 100);
        } catch (err: any) {
            setInsertError(err.response?.data?.error || "Failed to add row");
        }
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
                                        <th key={col} className="p-2 border-b border-slate-700 text-slate-400 font-medium sticky top-0 bg-slate-950 z-10">{col}</th>
                                    ))}
                                    <th className="p-2 border-b border-slate-700 sticky top-0 bg-slate-950 z-10 w-10"></th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.length === 0 && !loading && (
                                    <tr><td colSpan={columns.length+1} className="p-8 text-center text-slate-500 italic">Table is empty.</td></tr>
                                )}
                                {data.map((row, i) => {
                                    const rowId = row.id || row.ID || row.Id;
                                    return (
                                        <tr key={i} className="hover:bg-slate-900 transition-colors group">
                                            {columns.map(col => (
                                                <td key={col} 
                                                    className="p-2 border-b border-slate-800 text-slate-300 cursor-pointer hover:bg-slate-800"
                                                    onClick={() => {
                                                        if(col.toLowerCase() !== 'id' && !(editingCell?.rowId === rowId && editingCell?.col === col)) {
                                                            setEditingCell({ rowId, col });
                                                            setEditValue(row[col] || "");
                                                        }
                                                    }}
                                                >
                                                    {editingCell?.rowId === rowId && editingCell?.col === col ? (
                                                        <input autoFocus className="w-full bg-slate-700 text-white p-1 rounded border border-indigo-500 outline-none"
                                                            value={editValue} onChange={e => setEditValue(e.target.value)}
                                                            onBlur={handleSaveCell} onKeyDown={e => e.key === 'Enter' && handleSaveCell()}
                                                        />
                                                    ) : (row[col]?.toString() || <span className="text-slate-600 italic">null</span>)}
                                                </td>
                                            ))}
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
                    {insertError && (
                        <div className="mb-2 p-2 bg-red-500/10 border border-red-500/20 text-red-400 text-xs rounded flex justify-between">
                            {insertError} <button onClick={() => setInsertError(null)}><X size={12}/></button>
                        </div>
                    )}
                    
                    {!isAdding ? (
                        <div className="flex justify-between items-center">
                            <span className="text-xs text-slate-500">Click cells to edit.</span>
                            <button onClick={() => setIsAdding(true)} className="flex items-center gap-1 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded text-sm font-medium shadow-lg transition-colors">
                                <Plus size={16} /> Add New Row
                            </button>
                        </div>
                    ) : (
                        <div className="bg-slate-700/50 p-3 rounded border border-slate-600 animate-in slide-in-from-bottom-2">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                                {columns.map(col => {
                                    if(col.toLowerCase() === 'id') return null; // Hide ID
                                    return (
                                        <div key={col}>
                                            <label className="block text-[10px] uppercase text-slate-400 font-bold mb-1">{col}</label>
                                            <input className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1 text-sm text-white focus:border-indigo-500 outline-none"
                                                placeholder="NULL"
                                                onChange={(e) => setNewRowData({...newRowData, [col]: e.target.value})}
                                            />
                                        </div>
                                    )
                                })}
                            </div>
                            <div className="flex justify-end gap-2">
                                <button onClick={() => { setIsAdding(false); setInsertError(null); }} className="px-3 py-1.5 text-slate-400 hover:text-white text-sm">Cancel</button>
                                <button onClick={handleSaveNewRow} className="flex items-center gap-2 px-4 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded text-sm font-medium shadow-lg">
                                    <Save size={14} /> Save Row
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
            
            {/* Delete Modal */}
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