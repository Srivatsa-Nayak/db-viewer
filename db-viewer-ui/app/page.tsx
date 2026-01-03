"use client";

import { useState, useEffect } from "react";
import { AlertCircle, X } from 'lucide-react';

// Components
import { Header } from "@/components/Header";
import { ResultsTable } from "@/components/ResultsTable";
import { Visualizer } from "@/components/Visualizer";
import { SqlEditor } from "@/components/SqlEditor";

// Hooks
import { useSchema } from "@/hooks/useSchema";
import { useQuery } from "@/hooks/useQuery";
import { DataEditor } from "@/components/DataEditor";

export default function Home() {
    const [editingTable, setEditingTable] = useState<string | null>(null);
    const { query, setQuery, results, error, runQuery } = useQuery();
    const [theme, setTheme] = useState<'dark' | 'light' | 'system'>('dark');
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);
    const [errorModal, setErrorModal] = useState<{isOpen: boolean, message: string}>({
        isOpen: false,
        message: ""
    });

    // 1. Logic Hooks
    const { 
        nodes, edges, onNodesChange, onEdgesChange, onConnect, 
        handleFileUpload, refreshSchema, isUploading 
    } = useSchema(setEditingTable, (msg) => setErrorModal({ isOpen: true, message: msg }));

    const handleRunQuery = async () => {
        await runQuery();
        if (!isSidebarOpen) setIsSidebarOpen(true);
    };

    // Handle Theme Class on Document Root
   useEffect(() => {
        const root = window.document.documentElement;
        
        // Remove old classes
        root.classList.remove('dark', 'light');

        if (theme === 'system') {
            const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
            root.classList.add(systemTheme);
        } else {
            root.classList.add(theme); // Adds 'dark' or 'light' class to <html>
        }
    }, [theme]);

    return (
        <div className="h-screen w-full bg-slate-950 text-slate-200 flex flex-col">
            <Header 
                onUpload={handleFileUpload} 
                onRefresh={refreshSchema} 
                isUploading={isUploading} 
            />

            <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
                
                {/* LEFT: Visualizer */}
                <Visualizer 
                    nodes={nodes}
                    edges={edges}
                    onNodesChange={onNodesChange}
                    onEdgesChange={onEdgesChange}
                    onConnect={onConnect}
                    theme={theme}
                    setTheme={setTheme}
                    isSidebarOpen={isSidebarOpen}
                    onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
                />

                {/* RIGHT: Editor & Results */}
                {/* RIGHT: Editor & Results (Collapsible) */}
                <div 
                    className={`flex flex-col border-l border-slate-800 bg-slate-900 transition-all duration-300 ease-in-out ${
                        isSidebarOpen ? 'w-[40%] opacity-100' : 'w-0 opacity-0 pointer-events-none overflow-hidden'
                    }`}
                >
                    
                    <SqlEditor 
                        query={query} 
                        setQuery={setQuery} 
                        runQuery={runQuery} 
                    />

                    <ResultsTable data={results} error={error} />
                </div>
            </div>
            {/* --- DATA EDITOR MODAL --- */}
            {editingTable && (
                <DataEditor 
                    tableName={editingTable} 
                    onClose={() => setEditingTable(null)} 
                />
             )}
             {/* --- ERROR MODAL --- */}
             {errorModal.isOpen && (
                <div className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-slate-900 border border-slate-700 rounded-lg shadow-2xl max-w-sm w-full p-6 transform scale-100 animate-in zoom-in-95 duration-200">
                        <div className="flex flex-col items-center text-center gap-4">
                            
                            {/* Icon */}
                            <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center text-red-500 mb-2">
                                <AlertCircle size={24} />
                            </div>

                            {/* Content */}
                            <div>
                                <h3 className="text-lg font-bold text-white mb-2">Upload Failed</h3>
                                <p className="text-slate-400 text-sm leading-relaxed">
                                    {errorModal.message}
                                </p>
                            </div>

                            {/* Button */}
                            <button 
                                onClick={() => setErrorModal({ ...errorModal, isOpen: false })}
                                className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg font-medium transition-colors border border-slate-700 mt-2"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}