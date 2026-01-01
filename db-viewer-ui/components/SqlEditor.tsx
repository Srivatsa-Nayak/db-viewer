"use client";

import React, { useState } from 'react';
import Editor from "@monaco-editor/react";
import { Play, ChevronDown, ChevronUp } from "lucide-react";

interface SqlEditorProps {
    query: string;
    setQuery: (query: string) => void;
    runQuery: () => void;
}

export const SqlEditor = ({ query, setQuery, runQuery }: SqlEditorProps) => {
    const [isCollapsed, setIsCollapsed] = useState(false);

    return (
        <div 
            className={`flex flex-col border-b border-slate-800 transition-all duration-300 ease-in-out ${
                isCollapsed ? "h-10" : "h-1/2"
            }`}
        >
            {/* Toolbar */}
            <div className="h-10 px-2 bg-slate-900 border-b border-slate-800 flex justify-between items-center shrink-0">
                <div 
                    className="flex items-center gap-2 cursor-pointer hover:text-white text-slate-400 transition-colors select-none"
                    onClick={() => setIsCollapsed(!isCollapsed)}
                >
                    {isCollapsed ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    <span className="text-xs font-bold">SQL EDITOR</span>
                </div>
                
                <button
                    onClick={runQuery}
                    disabled={isCollapsed}
                    className={`flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded text-xs transition-all duration-200 ${
                        isCollapsed ? 'opacity-0 pointer-events-none' : 'opacity-100'
                    }`}
                >
                    <Play size={12} /> Run Query
                </button>
            </div>

            {/* Monaco Editor */}
            <div className={`flex-1 overflow-hidden transition-opacity duration-200 ${
                isCollapsed ? 'opacity-0' : 'opacity-100'
            }`}>
                <Editor
                    height="100%"
                    defaultLanguage="sql"
                    theme="vs-dark"
                    value={query}
                    onChange={(val : any) => setQuery(val || "")}
                    options={{ 
                        minimap: { enabled: false }, 
                        fontSize: 14,
                        padding: { top: 10 },
                        scrollBeyondLastLine: false,
                    }}
                />
            </div>
        </div>
    );
};