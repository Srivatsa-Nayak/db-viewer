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
            <div className="w-12 border-r border-zinc-200 bg-white flex flex-col items-center py-4 gap-4 transition-all duration-300">
                <button onClick={onToggle} className="p-2 text-zinc-500 hover:text-blue-600 rounded-md hover:bg-zinc-100 transition-colors">
                    <LayoutPanelLeft size={20} />
                </button>
                {/* Collapsed New File Button */}
                <button
                    onClick={onCreateFile}
                    className="p-2 text-zinc-500 hover:text-blue-600 hover:bg-zinc-100 rounded-md transition-colors"
                    title="New SQL File"
                >
                    <Plus size={20} />
                </button>
                <div className="w-8 h-px bg-zinc-200" /> {/* Divider */}

                {files.map(f => (
                    <button
                        key={f.id}
                        onClick={() => onSelectFile(f.id)}
                        className={`p-2 rounded-md transition-colors relative group ${activeFileId === f.id ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-zinc-700'}`}
                    >
                        <Database size={18} />
                    </button>
                ))}
            </div>
        );
    }

    const filteredFiles = files.filter(f => f.name.toLowerCase().includes(searchTerm.toLowerCase()));

    return (
        <div className="w-64 border-r border-zinc-200 bg-white flex flex-col h-full transition-all duration-300">
            {/* Header */}
            <div className="h-14 flex items-center justify-between px-4 border-b border-zinc-200 shrink-0">
                <span className="font-semibold text-zinc-800 flex items-center gap-2 text-sm">
                    <FileCode size={18} className="text-zinc-500"/> Explorer
                </span>
                <div className="flex gap-1">
                     {/* NEW FILE BUTTON */}
                    <button
                        onClick={onCreateFile}
                        className="p-1.5 text-zinc-500 hover:text-blue-600 hover:bg-zinc-100 rounded transition-colors"
                        title="New Blank File"
                    >
                        <Plus size={18} />
                    </button>
                    <button onClick={onToggle} className="p-1.5 text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 rounded transition-colors">
                        <LayoutPanelLeft size={18} />
                    </button>
                </div>
            </div>

            {/* Search */}
            <div className="p-3 border-b border-zinc-200/70 shrink-0">
                <div className="relative">
                    <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
                    <input
                        className="w-full bg-white border border-zinc-300 rounded-md py-1.5 pl-8 pr-3 text-xs text-zinc-800 focus:outline-none focus:border-blue-500 transition-colors placeholder:text-zinc-400"
                        placeholder="Search files..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
            </div>

            {/* File Tree */}
            <div className="flex-1 overflow-y-auto p-2 scrollbar-thin scrollbar-thumb-zinc-300 scrollbar-track-transparent">
                {filteredFiles.length === 0 && (
                    <div className="text-center text-zinc-400 text-xs py-8">
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
                                className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md cursor-pointer select-none transition-colors border ${isActive ? 'bg-blue-50 border-blue-200' : 'hover:bg-zinc-100 border-transparent'}`}
                                onClick={() => onSelectFile(file.id)}
                            >
                                <button
                                    onClick={(e) => toggleExpand(file.id, e)}
                                    className={`p-0.5 rounded ${isActive ? 'text-blue-500 hover:text-blue-700 hover:bg-blue-100' : 'text-zinc-400 hover:text-zinc-700 hover:bg-zinc-200'}`}
                                >
                                    {isFileExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                </button>
                                <Database size={14} className={`${isActive ? 'text-blue-600' : 'text-zinc-400'}`} />
                                <span className={`text-xs font-medium truncate flex-1 ${isActive ? 'text-blue-700' : 'text-zinc-700'}`}>
                                    {file.name}
                                </span>
                            </div>

                            {/* Tables List */}
                            {isFileExpanded && (
                                <div className="ml-3 pl-2 border-l border-zinc-200 mt-1 space-y-0.5">
                                    {file.tables.map(table => {
                                        const tableId = `${file.id}-${table.name}`;
                                        const isTableExpanded = expandedIds.has(tableId);

                                        return (
                                            <div key={tableId}>
                                                <div
                                                    className="flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-zinc-100 cursor-pointer group transition-colors"
                                                    onClick={(e) => toggleExpand(tableId, e)}
                                                >
                                                    <span className="text-zinc-400 group-hover:text-zinc-600">
                                                        {isTableExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                                                    </span>
                                                    <Table size={12} className="text-zinc-400" />
                                                    <span className="text-xs text-zinc-500 group-hover:text-zinc-800 truncate flex-1">{table.name}</span>
                                                    <span className="text-[9px] text-zinc-500 bg-zinc-100 px-1.5 py-0.5 rounded-full min-w-[1.25rem] text-center">
                                                        {table.columns.length}
                                                    </span>
                                                </div>

                                                {/* Columns */}
                                                {isTableExpanded && (
                                                    <div className="ml-5 mt-0.5 space-y-0.5 mb-2">
                                                        {table.columns.map(col => (
                                                            <div key={col.name} className="flex items-center gap-2 px-2 py-0.5 hover:bg-zinc-100 rounded text-[10px] text-zinc-400 hover:text-zinc-700 select-none group/col">
                                                                <Columns size={10} className="opacity-40 group-hover/col:opacity-70" />
                                                                <span className={`truncate flex-1 font-mono ${col.is_pk ? 'text-blue-600 font-semibold' : ''}`}>{col.name}</span>
                                                                <span className="text-[9px] font-mono text-zinc-400 opacity-70">{col.type}</span>
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
