"use client";

import { useState, useEffect } from "react";

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

    // 1. Logic Hooks
    const { 
        nodes, edges, onNodesChange, onEdgesChange, onConnect, 
        handleFileUpload, refreshSchema, isUploading 
    } = useSchema(setEditingTable);

    // Handle Theme Class on Document Root
    useEffect(() => {
        const root = window.document.documentElement;
        root.classList.remove('dark', 'light');
        
        if (theme === 'system') {
            const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
            root.classList.add(systemTheme);
        } else {
            root.classList.add(theme);
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
                />

                {/* RIGHT: Editor & Results */}
                <div className="lg:w-[40%] flex flex-col bg-slate-950 transition-all duration-300">
                    
                    <SqlEditor 
                        query={query} 
                        setQuery={setQuery} 
                        runQuery={runQuery} 
                    />

                    <ResultsTable data={results} error={error} />
                </div>
            </div>
            {editingTable && (
                <DataEditor 
                    tableName={editingTable} 
                    onClose={() => setEditingTable(null)} 
                />
             )}
        </div>
    );
}