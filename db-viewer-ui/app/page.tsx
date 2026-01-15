"use client";

import { useState, useEffect, useCallback } from "react";
import { AlertCircle, X, Trash2, FileCode, Plus, ChevronRight, ChevronLeft } from 'lucide-react';

import { Header } from "@/components/header/Header";
import { ResultsTable } from "@/components/tables/ResultsTable";
import { Visualizer } from "@/components/canvas/Visualizer";
import { SqlEditor } from "@/components/editor/SqlEditor";

import { useQuery } from "@/hooks/useQuery";
import { DataEditor } from "@/components/editor/DataEditor";
import { InfoModal } from '@/components/modal/InfoModal';
import { FileExplorer, ExplorerFile } from "@/components/editor/FileExplorer";
import { Edge, MarkerType, Node, applyNodeChanges, NodeChange } from "reactflow";
import { dbService } from "@/services/api";

interface Workspace {
    id: string; // unique ID (timestamp)
    name: string; // filename
    nodes: Node[];
    edges: Edge[];
    fileData: ExplorerFile; // Structure for the explorer (tables/cols)
}

export default function Home() {
    const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
    const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
    const [isExplorerOpen, setIsExplorerOpen] = useState(true);
    const [isRightSidebarOpen, setIsRightSidebarOpen] = useState(true);
    const [editingTable, setEditingTable] = useState<string | null>(null);
    const [theme, setTheme] = useState<'dark' | 'light' | 'system'>('dark');
    const [errorModal, setErrorModal] = useState<{ isOpen: boolean, message: string }>({ isOpen: false, message: "" });
    const [showClearConfirm, setShowClearConfirm] = useState(false);
    const [isInfoOpen, setInfoOpen] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const { query, setQuery, results, error, runQuery } = useQuery();

    const activeWorkspace = workspaces.find(w => w.id === activeWorkspaceId);

    const transformSchemaToWorkspace = (tables: any[], relationships: any[], fileName: string, id: string): Workspace => {
        const nodes: Node[] = tables.map((tbl, index) => ({
            id: tbl.name,
            type: "tableNode",
            position: { x: 250 * (index % 3), y: 100 + Math.floor(index / 3) * 300 },
            data: {
                label: tbl.name,
                columns: tbl.columns,
                onRefresh: refreshActiveSchema, 
                onEdit: setEditingTable,
            },
        }));

        const edges: Edge[] = relationships.map((rel: any, index: number) => ({
            id: `e-${index}`,
            source: rel.target_table,
            target: rel.source_table,
            sourceHandle: `${rel.target_column}-right`,
            targetHandle: `${rel.source_column}-left`,
            type: 'smoothstep',
            animated: true,
            style: { stroke: '#6366f1', strokeWidth: 1.5 },
            markerEnd: { type: MarkerType.ArrowClosed, color: '#6366f1' },
        }));

        const fileData: ExplorerFile = {
            id: id,
            name: fileName,
            tables: tables.map(t => ({
                name: t.name,
                columns: t.columns.map((c: any) => ({ name: c.name, type: c.type, is_pk: c.is_pk }))
            }))
        };

        return { id, name: fileName, nodes, edges, fileData };
    };

    const handleFileUpload = async (file: File) => {
        setIsUploading(true);
        try {
            await dbService.uploadFile(file);
            const response = await dbService.getSchema();
            const newId = Date.now().toString();
            const newWorkspace = transformSchemaToWorkspace(
                response.tables || [],
                response.relationships || [],
                file.name,
                newId
            );
            setWorkspaces(prev => [...prev, newWorkspace]);
            setActiveWorkspaceId(newId);
        } catch (err: any) {
            console.error(err);
            setErrorModal({ isOpen: true, message: err.response?.data?.error || "Upload failed." });
        } finally {
            setIsUploading(false);
        }
    };

    // --- NEW: CREATE BLANK FILE LOGIC ---
    const handleCreateBlankFile = async () => {
        const newId = Date.now().toString();
        const fileName = `Untitled-${workspaces.length + 1}.sql`;
        
        // Optionally notify backend to create a blank DB context if needed
        // For now, we create a frontend workspace.
        
        const newWorkspace: Workspace = {
            id: newId,
            name: fileName,
            nodes: [],
            edges: [],
            fileData: { id: newId, name: fileName, tables: [] }
        };

        setWorkspaces(prev => [...prev, newWorkspace]);
        setActiveWorkspaceId(newId);
    };

    const refreshActiveSchema = useCallback(async () => {
        if (!activeWorkspaceId) return;
        try {
            const response = await dbService.getSchema();
            const tables = response.tables || [];
            
            setWorkspaces(prev => prev.map(w => {
                if (w.id === activeWorkspaceId) {
                    const newNodes: Node[] = tables.map((tbl, index) => {
                        const existingNode = w.nodes.find(n => n.id === tbl.name);
                        return {
                            id: tbl.name,
                            type: "tableNode",
                            position: existingNode ? existingNode.position : { x: 250 * (index % 3), y: 100 + Math.floor(index / 3) * 300 },
                            data: { label: tbl.name, columns: tbl.columns, onRefresh: refreshActiveSchema, onEdit: setEditingTable },
                        };
                    });
                    
                    const updatedFileData: ExplorerFile = {
                        ...w.fileData,
                        tables: tables.map(t => ({ 
                            name: t.name, 
                            columns: t.columns.map((c:any) => ({ name: c.name, type: c.type, is_pk: c.is_pk })) 
                        }))
                    };
                    return { ...w, nodes: newNodes, fileData: updatedFileData };
                }
                return w;
            }));
        } catch (e) { console.error("Refresh failed", e); }
    }, [activeWorkspaceId]);

    const onNodesChange = useCallback((changes: NodeChange[]) => {
        setWorkspaces(prevWorkspaces => 
            prevWorkspaces.map(workspace => {
                if (workspace.id === activeWorkspaceId) {
                    return { ...workspace, nodes: applyNodeChanges(changes, workspace.nodes) };
                }
                return workspace;
            })
        );
    }, [activeWorkspaceId]);

    const handleClearRequest = () => {
        if (!activeWorkspace) {
             setErrorModal({ isOpen: true, message: "No active workspace to clear." });
             return;
        }
        setShowClearConfirm(true);
    };

    const confirmClear = async () => {
        await dbService.clearDatabase();
        setWorkspaces(prev => prev.filter(w => w.id !== activeWorkspaceId));
        setActiveWorkspaceId(null);
        setShowClearConfirm(false);
    };

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
                onRefresh={refreshActiveSchema}
                isUploading={isUploading}
                fileName={activeWorkspace?.name || null}
                onClear={handleClearRequest}
                hasData={!!activeWorkspace}
                onShowInfo={() => setInfoOpen(true)}
            />

            <div className="flex-1 flex overflow-hidden relative">
                <FileExplorer 
                    files={workspaces.map(w => w.fileData)}
                    activeFileId={activeWorkspaceId}
                    onSelectFile={setActiveWorkspaceId}
                    onCreateFile={handleCreateBlankFile} // <--- Pass the new handler
                    isOpen={isExplorerOpen}
                    onToggle={() => setIsExplorerOpen(!isExplorerOpen)}
                />

                <div className="flex-1 flex flex-col relative h-full">
                    {activeWorkspace ? (
                        <Visualizer
                            key={activeWorkspace.id} 
                            nodes={activeWorkspace.nodes}
                            edges={activeWorkspace.edges}
                            onNodesChange={onNodesChange}
                            onEdgesChange={() => {}}
                            onConnect={() => {}} 
                            theme={theme}
                            setTheme={setTheme}
                            isSidebarOpen={isRightSidebarOpen}
                            onToggleSidebar={() => setIsRightSidebarOpen(!isRightSidebarOpen)}
                            onRefreshRequest={refreshActiveSchema}
                        />
                    ) : (
                        <div className="flex-1 flex flex-col items-center justify-center bg-slate-900/50 text-slate-500 gap-4">
                            <div className="w-16 h-16 bg-slate-800 rounded-full flex items-center justify-center shadow-inner">
                                <FileCode size={32} className="opacity-40" />
                            </div>
                            <div className="text-center">
                                <p className="text-sm font-medium text-slate-400 mb-2">No file selected</p>
                                <button 
                                    onClick={handleCreateBlankFile}
                                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-sm flex items-center gap-2 mx-auto"
                                >
                                    <Plus size={16} /> Create New File
                                </button>
                            </div>
                        </div>
                    )}

                    <button
                        onClick={() => setIsRightSidebarOpen(!isRightSidebarOpen)}
                        className="absolute right-0 top-1/2 -translate-y-1/2 z-50 bg-slate-800 border border-slate-700 border-r-0 rounded-l-md p-1 hover:bg-indigo-600 hover:border-indigo-500 hover:text-white transition-all shadow-xl"
                        title={isRightSidebarOpen ? "Close Sidebar" : "Open Sidebar"}
                    >
                        {isRightSidebarOpen ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}
                    </button>
                </div>

                <div className={`flex flex-col border-l border-slate-800 bg-slate-900 transition-all duration-300 ease-in-out z-10 ${
                        isRightSidebarOpen ? 'w-[40%] opacity-100' : 'w-0 opacity-0 pointer-events-none overflow-hidden'
                    }`}
                >
                    <SqlEditor query={query} setQuery={setQuery} runQuery={runQuery} />
                    <ResultsTable data={results} error={error} />
                </div>
            </div>

            {editingTable && <DataEditor tableName={editingTable} onClose={() => setEditingTable(null)} />}
            
            {errorModal.isOpen && (
                <div className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4 backdrop-blur-sm">
                    <div className="bg-slate-900 border border-slate-700 rounded-lg p-6 max-w-sm w-full text-center">
                        <div className="text-red-500 mb-2 flex justify-center"><AlertCircle size={32} /></div>
                        <h3 className="text-lg font-bold text-white mb-2">Error</h3>    
                        <p className="text-slate-400 text-sm mb-4">{errorModal.message}</p>
                        <button onClick={() => setErrorModal({ ...errorModal, isOpen: false })} className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-white rounded">Close</button>
                    </div>
                </div>
            )}

            {showClearConfirm && (
                <div className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4 backdrop-blur-sm">
                    <div className="bg-slate-900 border border-slate-700 rounded-lg p-6 max-w-md w-full shadow-2xl border-t-4 border-t-red-500">
                        <h3 className="text-lg font-bold text-white flex items-center gap-2"><Trash2 size={20} className="text-red-500"/> Close Workspace?</h3>
                        <p className="text-slate-400 text-sm mt-2 mb-4">This will remove "{activeWorkspace?.name}" from your view.</p>
                        <div className="flex gap-3 justify-end">
                            <button onClick={() => setShowClearConfirm(false)} className="px-4 py-2 text-slate-300 hover:text-white">Cancel</button>
                            <button onClick={confirmClear} className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded">Close File</button>
                        </div>
                    </div>
                </div>
            )}
            
            {isInfoOpen && <InfoModal isOpen={isInfoOpen} onClose={() => setInfoOpen(false)} />}
        </div>
    );
}