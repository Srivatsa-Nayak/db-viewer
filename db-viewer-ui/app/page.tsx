"use client";

import { useState, useEffect } from "react";
import { AlertCircle, X, Trash2 } from 'lucide-react';

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
    const [errorModal, setErrorModal] = useState<{ isOpen: boolean, message: string }>({
        isOpen: false,
        message: ""
    });
    const [showClearConfirm, setShowClearConfirm] = useState(false);

    // 1. Logic Hooks
    const {
        nodes, edges, onNodesChange, onEdgesChange, onConnect,
        handleFileUpload, refreshSchema, isUploading, clearCanvas, fileName
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

    const handleClearRequest = () => {
        // 1. Check if there is anything to delete
        if (nodes.length === 0) {
            setErrorModal({
                isOpen: true,
                message: "The workspace is already empty. There is nothing to delete."
            });
            return;
        }
        // 2. Open the custom confirmation modal
        setShowClearConfirm(true);
    };

    // --- NEW: EXECUTE CLEAR ---
    const confirmClear = async () => {
        await clearCanvas();
        setShowClearConfirm(false);
    };

    return (
        <div className="h-screen w-full bg-slate-950 text-slate-200 flex flex-col">
            <Header
                onUpload={handleFileUpload}
                onRefresh={refreshSchema}
                isUploading={isUploading}
                fileName={fileName}
                onClear={handleClearRequest}
                hasData={nodes.length > 0}
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
                    className={`flex flex-col border-l border-slate-800 bg-slate-900 transition-all duration-300 ease-in-out ${isSidebarOpen ? 'w-[40%] opacity-100' : 'w-0 opacity-0 pointer-events-none overflow-hidden'
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
                <div className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4 backdrop-blur-sm">
                    <div className="bg-slate-900 border border-slate-700 rounded-lg p-6 max-w-sm w-full">
                        <div className="flex flex-col items-center text-center gap-4">
                            <div className="text-red-500"><AlertCircle size={32} /></div>
                            <div>
                                {/* CHANGE THIS LINE: */}
                                <h3 className="text-lg font-bold text-white">Error</h3>

                                <p className="text-slate-400 text-sm">{errorModal.message}</p>
                            </div>
                            <button
                                onClick={() => setErrorModal({ ...errorModal, isOpen: false })}
                                className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-white rounded border border-slate-700"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {/* 2. DELETE CONFIRMATION MODAL */}
            {showClearConfirm && (
                <div className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-slate-900 border border-slate-700 rounded-lg p-6 max-w-md w-full shadow-2xl border-t-4 border-t-red-500">
                        <div className="flex flex-col gap-4">
                            {/* Header */}
                            <div className="flex items-center gap-4">
                                <div className="p-3 bg-red-500/10 rounded-full shrink-0">
                                    <Trash2 size={24} className="text-red-500" />
                                </div>
                                <div>
                                    <h3 className="text-lg font-bold text-white">Clear Database?</h3>
                                    <p className="text-slate-400 text-sm mt-1">
                                        Are you sure you want to delete all tables and data? This action cannot be undone.
                                    </p>
                                </div>
                            </div>

                            {/* Buttons */}
                            <div className="flex gap-3 mt-2 justify-end">
                                <button
                                    onClick={() => setShowClearConfirm(false)}
                                    className="px-4 py-2 text-slate-300 hover:text-white hover:bg-slate-800 rounded transition-colors text-sm font-medium"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={confirmClear}
                                    className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded shadow-lg shadow-red-900/20 transition-colors text-sm font-medium flex items-center gap-2"
                                >
                                    <Trash2 size={16} />
                                    Yes, Delete Everything
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}