import React, { useState, useEffect } from 'react';
import { X, Loader2, Plus, Trash2, AlertTriangle } from 'lucide-react'; // <--- Import AlertTriangle
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

    // NEW: Delete Confirmation State
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
            const rows = await dbService.getTableData(tableName);
            setData(rows || []);
            if (rows && rows.length > 0) {
                setColumns(Object.keys(rows[0]));
            }
        } catch (e) {
            console.error(e);
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

    if (!tableName) return null;

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            {/* Main Editor Modal */}
            <div className="bg-white dark:bg-slate-900 w-full max-w-4xl max-h-[80vh] rounded-lg shadow-2xl flex flex-col border border-slate-700 relative">
                
                {/* Header */}
                <div className="p-4 border-b border-slate-700 flex justify-between items-center bg-slate-800 rounded-t-lg">
                    <h2 className="text-lg font-bold text-white flex items-center gap-2">
                        Editing Table: <span className="text-indigo-400 font-mono">{tableName}</span>
                    </h2>
                    <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
                        <X size={20} />
                    </button>
                </div>

                {/* Content */}
                <div id="data-table-container" className="flex-1 overflow-auto p-4 bg-slate-950">
                    {loading ? (
                        <div className="flex justify-center items-center h-40 text-slate-400 gap-2">
                            <Loader2 className="animate-spin" /> Loading Data...
                        </div>
                    ) : (
                        <table className="w-full text-left border-collapse text-sm">
                            <thead>
                                <tr>
                                    {columns.map(col => (
                                        <th key={col} className="p-2 border-b border-slate-700 text-slate-400 font-medium sticky top-0 bg-slate-950 z-10">
                                            {col}
                                        </th>
                                    ))}
                                    <th className="p-2 border-b border-slate-700 sticky top-0 bg-slate-950 z-10 w-10"></th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.map((row, i) => (
                                    <tr key={i} className="hover:bg-slate-900 transition-colors group">
                                        {columns.map(col => {
                                            const isEditing = editingCell?.rowId === row.id && editingCell?.col === col;
                                            return (
                                                <td 
                                                    key={col} 
                                                    className="p-2 border-b border-slate-800 text-slate-300 cursor-pointer hover:bg-slate-800"
                                                    onClick={() => {
                                                        if (col !== 'id' && !isEditing) {
                                                            setEditingCell({ rowId: row.id, col });
                                                            setEditValue(row[col] || "");
                                                        }
                                                    }}
                                                >
                                                    {isEditing ? (
                                                        <input 
                                                            autoFocus
                                                            className="w-full bg-slate-700 text-white p-1 rounded border border-indigo-500 outline-none"
                                                            value={editValue}
                                                            onChange={e => setEditValue(e.target.value)}
                                                            onBlur={handleSaveCell}
                                                            onKeyDown={e => e.key === 'Enter' && handleSaveCell()}
                                                        />
                                                    ) : (
                                                        row[col] === null || row[col] === "" ? <span className="text-slate-600 italic">null</span> : row[col]
                                                    )}
                                                </td>
                                            );
                                        })}
                                        
                                        {/* Delete Button */}
                                        <td className="p-2 border-b border-slate-800 text-right">
                                            <button 
                                                onClick={(e) => {
                                                    e.stopPropagation(); 
                                                    promptDeleteRow(row.id); // <--- Changed to prompt
                                                }}
                                                className="text-slate-600 hover:text-red-500 hover:bg-red-500/10 p-1.5 rounded transition-all opacity-0 group-hover:opacity-100"
                                                title="Delete Row"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
                
                {/* Footer */}
                <div className="p-3 bg-slate-800 border-t border-slate-700 rounded-b-lg flex justify-between items-center">
                    <span className="text-xs text-slate-500">
                        Click cells to edit. Enter to save.
                    </span>
                    <button 
                        onClick={handleAddRow}
                        className="flex items-center gap-1 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded text-sm font-medium transition-colors shadow-lg"
                    >
                        <Plus size={16} /> Add New Row
                    </button>
                </div>
            </div>

            {/* --- CUSTOM CONFIRMATION MODAL --- */}
            {deleteConfirm.isOpen && (
                <div className="absolute inset-0 bg-black/60 z-[60] flex items-center justify-center p-4 backdrop-blur-sm">
                    <div className="bg-slate-900 border border-slate-700 rounded-lg p-6 max-w-sm w-full shadow-2xl transform scale-100 animate-in fade-in zoom-in duration-200">
                        
                        <div className="flex flex-col items-center text-center gap-4">
                            <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center text-red-500">
                                <AlertTriangle size={24} />
                            </div>
                            
                            <div>
                                <h3 className="text-lg font-bold text-white mb-1">Delete Row?</h3>
                                <p className="text-slate-400 text-sm">
                                    Are you sure you want to delete this row? This action cannot be undone.
                                </p>
                            </div>

                            <div className="flex gap-3 w-full mt-2">
                                <button 
                                    onClick={() => setDeleteConfirm({ isOpen: false, rowId: null })}
                                    className="flex-1 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg font-medium transition-colors border border-slate-700"
                                >
                                    Cancel
                                </button>
                                <button 
                                    onClick={confirmDeleteRow}
                                    className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors"
                                >
                                    Yes, Delete
                                </button>
                            </div>
                        </div>

                    </div>
                </div>
            )}
        </div>
    );
};