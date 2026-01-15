import React, { useState } from 'react';
import { 
    ChevronRight, ChevronDown, Database, Table, 
    Columns, FileCode, Search, LayoutPanelLeft, Plus 
} from 'lucide-react';

export interface ExplorerFile {
    id: string;
    name: string;
    tables: {
        name: string;
        columns: {
            name: string;
            type: string;
            is_pk?: boolean;
        }[];
    }[];
}

interface FileExplorerProps {
    files: ExplorerFile[];
    activeFileId: string | null;
    onSelectFile: (fileId: string) => void;
    onCreateFile: () => void; // <--- NEW PROP
    isOpen: boolean;
    onToggle: () => void;
}

export const FileExplorer = ({ 
    files, 
    activeFileId, 
    onSelectFile, 
    onCreateFile, // <--- Destructure
    isOpen, 
    onToggle 
}: FileExplorerProps) => {
    const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
    const [searchTerm, setSearchTerm] = useState("");

    const toggleExpand = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        const newSet = new Set(expandedIds);
        if (newSet.has(id)) newSet.delete(id);
        else newSet.add(id);
        setExpandedIds(newSet);
    };

    if (!isOpen) {
        return (
            <div className="w-12 border-r border-slate-800 bg-slate-900 flex flex-col items-center py-4 gap-4 transition-all duration-300">
                <button onClick={onToggle} className="p-2 text-slate-400 hover:text-white rounded-md hover:bg-slate-800 transition-colors">
                    <LayoutPanelLeft size={20} />
                </button>
                {/* Collapsed New File Button */}
                <button 
                    onClick={onCreateFile}
                    className="p-2 text-emerald-400 hover:text-emerald-300 hover:bg-slate-800 rounded-md transition-colors"
                    title="New SQL File"
                >
                    <Plus size={20} />
                </button>
                <div className="w-8 h-px bg-slate-800" /> {/* Divider */}

                {files.map(f => (
                    <button 
                        key={f.id}
                        onClick={() => onSelectFile(f.id)}
                        className={`p-2 rounded-md transition-colors relative group ${activeFileId === f.id ? 'bg-indigo-600/20 text-indigo-400' : 'text-slate-500 hover:text-slate-300'}`}
                    >
                        <Database size={18} />
                    </button>
                ))}
            </div>
        );
    }

    const filteredFiles = files.filter(f => f.name.toLowerCase().includes(searchTerm.toLowerCase()));

    return (
        <div className="w-64 border-r border-slate-800 bg-slate-900 flex flex-col h-full transition-all duration-300">
            {/* Header */}
            <div className="h-14 flex items-center justify-between px-4 border-b border-slate-800 shrink-0">
                <span className="font-bold text-slate-200 flex items-center gap-2 text-sm">
                    <FileCode size={18} className="text-indigo-500"/> Explorer
                </span>
                <div className="flex gap-1">
                     {/* NEW FILE BUTTON */}
                    <button 
                        onClick={onCreateFile}
                        className="p-1.5 text-slate-400 hover:text-emerald-400 hover:bg-slate-800 rounded transition-colors"
                        title="New Blank File"
                    >
                        <Plus size={18} />
                    </button>
                    <button onClick={onToggle} className="p-1.5 text-slate-500 hover:text-slate-300 hover:bg-slate-800 rounded transition-colors">
                        <LayoutPanelLeft size={18} />
                    </button>
                </div>
            </div>

            {/* Search */}
            <div className="p-3 border-b border-slate-800/50 shrink-0">
                <div className="relative">
                    <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input 
                        className="w-full bg-slate-800 border border-slate-700 rounded-md py-1.5 pl-8 pr-3 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 transition-colors placeholder:text-slate-600"
                        placeholder="Search files..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
            </div>

            {/* File Tree */}
            <div className="flex-1 overflow-y-auto p-2 scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">
                {filteredFiles.length === 0 && (
                    <div className="text-center text-slate-600 text-xs py-8">
                        {searchTerm ? 'No matches found' : 'No files opened'}
                    </div>
                )}
                
                {filteredFiles.map(file => {
                    const isFileExpanded = expandedIds.has(file.id);
                    const isActive = activeFileId === file.id;

                    return (
                        <div key={file.id} className="mb-1">
                            {/* File Item */}
                            <div 
                                className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md cursor-pointer select-none transition-colors border ${isActive ? 'bg-indigo-900/20 border-indigo-500/30' : 'hover:bg-slate-800 border-transparent'}`}
                                onClick={() => onSelectFile(file.id)}
                            >
                                <button 
                                    onClick={(e) => toggleExpand(file.id, e)}
                                    className="p-0.5 text-slate-500 hover:text-slate-300 rounded hover:bg-slate-700/50"
                                >
                                    {isFileExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                </button>
                                <Database size={14} className={`${isActive ? 'text-indigo-400' : 'text-slate-500'}`} />
                                <span className={`text-xs font-medium truncate flex-1 ${isActive ? 'text-indigo-200' : 'text-slate-300'}`}>
                                    {file.name}
                                </span>
                            </div>

                            {/* Tables List */}
                            {isFileExpanded && (
                                <div className="ml-3 pl-2 border-l border-slate-800 mt-1 space-y-0.5">
                                    {file.tables.map(table => {
                                        const tableId = `${file.id}-${table.name}`;
                                        const isTableExpanded = expandedIds.has(tableId);

                                        return (
                                            <div key={tableId}>
                                                <div 
                                                    className="flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-slate-800/50 cursor-pointer group transition-colors"
                                                    onClick={(e) => toggleExpand(tableId, e)}
                                                >
                                                    <span className="text-slate-600 group-hover:text-slate-400">
                                                        {isTableExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                                                    </span>
                                                    <Table size={12} className="text-emerald-500/70" />
                                                    <span className="text-xs text-slate-400 group-hover:text-slate-200 truncate flex-1">{table.name}</span>
                                                    <span className="text-[9px] text-slate-600 bg-slate-800 px-1.5 py-0.5 rounded-full min-w-[1.25rem] text-center">
                                                        {table.columns.length}
                                                    </span>
                                                </div>

                                                {/* Columns */}
                                                {isTableExpanded && (
                                                    <div className="ml-5 mt-0.5 space-y-0.5 mb-2">
                                                        {table.columns.map(col => (
                                                            <div key={col.name} className="flex items-center gap-2 px-2 py-0.5 hover:bg-slate-800/30 rounded text-[10px] text-slate-500 hover:text-slate-300 select-none group/col">
                                                                <Columns size={10} className="opacity-40 group-hover/col:opacity-70" />
                                                                <span className={`truncate flex-1 ${col.is_pk ? 'text-amber-500/80' : ''}`}>{col.name}</span>
                                                                <span className="text-[9px] font-mono text-slate-600 opacity-60">{col.type}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        )
                                    })}
                                </div>
                            )}
                        </div>
                    )
                })}
            </div>
        </div>
    );
};