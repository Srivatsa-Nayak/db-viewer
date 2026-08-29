import React, { useState } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';
import { dbService, NewTableColumn } from '@/services/api';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
    existingTables: string[];
}

export const CreateTableModal = ({ isOpen, onClose, onSuccess, existingTables }: Props) => {
    const defaultColumns: NewTableColumn[] = [{ name: "id", type: "INT", is_pk: true, not_null: true, length: 0, ref_table: "", ref_col: "" }];
    const [tableName, setTableName] = useState("");

    // Default State
    const [columns, setColumns] = useState<NewTableColumn[]>(defaultColumns);
    const [error, setError] = useState<string | null>(null);

    const resetForm = () => {
        setTableName("");
        setColumns(defaultColumns);
        setError(null);
    };

    const handleClose = () => {
        resetForm();
        onClose();
    };

    const handleAddColumn = () => {
        setColumns([
            ...columns,
            {
                name: "",
                type: "VARCHAR",
                length: 128,
                is_pk: false,
                not_null: false,
                ref_table: "",
                ref_col: ""
            }
        ]);
    };

    const handleRemoveColumn = (idx: number) => {
        // Prevent removing the last column if you want to enforce at least one
        setColumns(columns.filter((_, i) => i !== idx));
    };

    const updateColumn = (idx: number, field: keyof NewTableColumn, value: NewTableColumn[keyof NewTableColumn]) => {
        const newCols = [...columns];
        newCols[idx] = { ...newCols[idx], [field]: value };

        // Reset length if not VARCHAR
        if (field === 'type' && value !== 'VARCHAR') {
             newCols[idx].length = undefined;
        }
        // Default length for VARCHAR
        if (field === 'type' && value === 'VARCHAR' && !newCols[idx].length) {
             newCols[idx].length = 128;
        }

        // Auto-fill Ref Column if table selected
        if (field === 'ref_table') {
            if (value && value !== "") {
                if (!newCols[idx].ref_col) newCols[idx].ref_col = "id";
            } else {
                newCols[idx].ref_col = "";
            }
        }

        setColumns(newCols);
    };

    const handleSubmit = async () => {
        setError(null);
        if (!tableName) return setError("Table name is required");
        if (columns.some(c => !c.name.trim())) return setError("All columns must have a name");

        // CHECK FOR DUPLICATE COLUMN NAMES
        const names = columns.map(c => c.name.trim().toLowerCase());
        const uniqueNames = new Set(names);
        if (uniqueNames.size !== names.length) {
            return setError("Duplicate column names are not allowed (e.g., two 'id' columns).");
        }

        try {
            await dbService.createTable(tableName, columns);
            onSuccess(); // Triggers refresh in parent
            handleClose();
        } catch (err: unknown) {
            console.error(err);
            const message = err && typeof err === "object" && "response" in err
                ? (err as { response?: { data?: { error?: string } } }).response?.data?.error
                : undefined;
            setError(message || "Failed to create table");
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in">
            <div className="bg-white border border-zinc-200 rounded-xl w-full max-w-5xl flex flex-col shadow-2xl max-h-[90vh]">

                {/* Header */}
                <div className="p-4 border-b border-zinc-200 flex justify-between items-center bg-white">
                    <div>
                        <h2 className="text-lg font-bold text-zinc-900">Create New Table</h2>
                        <p className="text-xs text-zinc-500">Define your schema, types, and constraints.</p>
                    </div>
                    <button onClick={handleClose}><X className="text-zinc-400 hover:text-zinc-900" /></button>
                </div>

                {/* Body */}
                <div className="p-6 overflow-y-auto flex-1">
                    <div className="mb-6">
                        <label className="block text-xs font-bold text-zinc-500 uppercase mb-1">Table Name</label>
                        <input
                            className="w-full bg-white border border-zinc-300 rounded px-3 py-2 text-zinc-900 focus:border-blue-500 outline-none font-mono"
                            placeholder="e.g. user_profiles"
                            value={tableName}
                            onChange={e => setTableName(e.target.value)}
                        />
                    </div>

                    <div className="space-y-3">
                        <div className="flex justify-between items-end border-b border-zinc-200 pb-2 mb-2">
                            <label className="text-xs font-bold text-zinc-500 uppercase">Column Definitions</label>
                            <button onClick={handleAddColumn} className="text-xs flex items-center gap-1 text-blue-600 hover:text-blue-700">
                                <Plus size={14} /> Add Column
                            </button>
                        </div>

                        {columns.map((col, idx) => (
                            <div key={idx} className="grid grid-cols-12 gap-3 items-start bg-zinc-50 p-3 rounded border border-zinc-200 hover:border-blue-300 transition-colors">

                                {/* Name */}
                                <div className="col-span-2">
                                    <label className="text-[10px] text-zinc-400 uppercase block mb-1">Name</label>
                                    <input
                                        className="w-full bg-white border border-zinc-300 rounded px-2 py-1.5 text-sm text-zinc-900 font-mono focus:border-blue-500 outline-none"
                                        placeholder="id"
                                        value={col.name}
                                        onChange={e => updateColumn(idx, 'name', e.target.value)}
                                    />
                                </div>

                                {/* Type */}
                                <div className="col-span-3 flex gap-2">
                                    <div className="flex-1">
                                        <label className="text-[10px] text-zinc-400 uppercase block mb-1">Type</label>
                                        <select
                                            className="w-full bg-white border border-zinc-300 rounded px-2 py-1.5 text-sm text-zinc-900 focus:border-blue-500 outline-none"
                                            value={col.type}
                                            onChange={e => updateColumn(idx, 'type', e.target.value)}
                                        >
                                            <option value="INT">INT</option>
                                            <option value="VARCHAR">VARCHAR</option>
                                            <option value="TEXT">TEXT</option>
                                            <option value="BOOLEAN">BOOLEAN</option>
                                            <option value="DATE">DATE</option>
                                            <option value="TIME">TIME</option>
                                            <option value="DATETIME">DATETIME</option>
                                        </select>
                                    </div>
                                    {col.type === 'VARCHAR' && (
                                        <div className="w-20">
                                            <label className="text-[10px] text-zinc-400 uppercase block mb-1">Len</label>
                                            <select
                                                className="w-full bg-white border border-zinc-300 rounded px-1 py-1.5 text-sm text-zinc-700 outline-none"
                                                value={col.length || 128}
                                                onChange={e => updateColumn(idx, 'length', parseInt(e.target.value))}
                                            >
                                                <option value={64}>64</option>
                                                <option value={128}>128</option>
                                                <option value={256}>256</option>
                                            </select>
                                        </div>
                                    )}
                                </div>

                                {/* Constraints */}
                                <div className="col-span-2 flex flex-col gap-2 pt-6 pl-1">
                                     <label className={`flex items-center gap-2 text-xs cursor-pointer select-none ${col.is_pk ? 'text-blue-700 font-medium' : 'text-zinc-400'}`}>
                                        <input type="checkbox" checked={col.is_pk} onChange={e => updateColumn(idx, 'is_pk', e.target.checked)} className="rounded bg-white border-zinc-300 text-blue-600 focus:ring-0" />
                                        PK
                                    </label>
                                    <label className={`flex items-center gap-2 text-xs cursor-pointer select-none ${col.not_null ? 'text-blue-700 font-medium' : 'text-zinc-400'}`}>
                                        <input type="checkbox" checked={col.not_null} onChange={e => updateColumn(idx, 'not_null', e.target.checked)} className="rounded bg-white border-zinc-300 text-blue-600 focus:ring-0" />
                                        NN
                                    </label>
                                </div>

                                {/* Foreign Key */}
                                <div className="col-span-4">
                                    {!col.is_pk && (
                                        <div className="flex gap-2">
                                            <div className="flex-1">
                                                <label className="text-[10px] text-zinc-400 uppercase block mb-1">FK Table</label>
                                                <select
                                                    className="w-full bg-white border border-zinc-300 rounded px-1 py-1.5 text-xs text-zinc-700 focus:border-blue-500 outline-none"
                                                    value={col.ref_table || ""}
                                                    onChange={e => updateColumn(idx, 'ref_table', e.target.value)}
                                                >
                                                    <option value="">-- None --</option>
                                                    {existingTables.map(t => <option key={t} value={t}>{t}</option>)}
                                                </select>
                                            </div>
                                            {/* Ref Column Input */}
                                            {col.ref_table && (
                                                <div className="w-24 animate-in fade-in slide-in-from-left-2">
                                                    <label className="text-[10px] text-zinc-400 uppercase block mb-1">Ref Col</label>
                                                    <input
                                                        className="w-full bg-white border border-zinc-300 rounded px-2 py-1.5 text-xs text-zinc-700 font-mono focus:border-blue-500 outline-none"
                                                        placeholder="id"
                                                        value={col.ref_col || ""}
                                                        onChange={e => updateColumn(idx, 'ref_col', e.target.value)}
                                                    />
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>

                                {/* Delete */}
                                <div className="col-span-1 pt-6 text-right">
                                    <button onClick={() => handleRemoveColumn(idx)} className="p-1 text-zinc-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors">
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>

                    {error && (
                        <div className="mt-4 p-3 bg-red-50 text-red-600 text-xs rounded border border-red-200 flex items-center gap-2">
                            <span className="font-bold">Error:</span> {error}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-zinc-200 bg-white flex justify-between items-center">
                    <div className="text-xs text-zinc-400 italic">
                        * PK = Primary Key, NN = Not Null
                    </div>
                    <div className="flex gap-2">
                        <button onClick={handleClose} className="px-4 py-2 text-zinc-500 hover:text-zinc-900 text-sm transition-colors">Cancel</button>
                        <button onClick={handleSubmit} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm font-medium shadow-sm transition-all">
                            Create Table
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
