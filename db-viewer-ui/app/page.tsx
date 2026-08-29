"use client";

import { useState, useCallback } from "react";
import { AlertCircle, Trash2, FileCode, Plus } from 'lucide-react';

import { Header } from "@/components/header/Header";
import { Visualizer } from "@/components/canvas/Visualizer";

import { DataEditor } from "@/components/editor/DataEditor";
import { InfoModal } from '@/components/modal/InfoModal';
import { NewFileModal } from '@/components/modal/NewFileModal';
import { FileExplorer, ExplorerFile } from "@/components/editor/FileExplorer";
import { Edge, MarkerType, Node, applyNodeChanges, NodeChange } from "reactflow";
import { dbService } from "@/services/api";
import { Relationship, TableInfo } from "@/types";

interface Workspace {
    id: string; // unique ID (timestamp)
    name: string; // filename
    nodes: Node[];
    edges: Edge[];
    fileData: ExplorerFile; // Structure for the explorer (tables/cols)
    isImported: boolean; // true if loaded from an uploaded .csv/.sql file, false if created in-app
}

export default function Home() {
    const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
    const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
    const [isExplorerOpen, setIsExplorerOpen] = useState(true);
    const [editingTable, setEditingTable] = useState<string | null>(null);
    const [errorModal, setErrorModal] = useState<{ isOpen: boolean, message: string }>({ isOpen: false, message: "" });
    const [showClearConfirm, setShowClearConfirm] = useState(false);
    const [isInfoOpen, setInfoOpen] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [isNewFileModalOpen, setNewFileModalOpen] = useState(false);
    const [newFileModalKey, setNewFileModalKey] = useState(0);

    const activeWorkspace = workspaces.find(w => w.id === activeWorkspaceId);

    const openNewFileModal = () => {
        setNewFileModalKey(k => k + 1);
        setNewFileModalOpen(true);
    };

    const transformRelationshipsToEdges = (relationships: Relationship[]): Edge[] => {
        return relationships.flatMap((rel, index): Edge[] => {
            const targetTable = rel.target_table ?? rel.targetTable;
            const sourceTable = rel.source_table ?? rel.sourceTable;
            const targetColumn = rel.target_column ?? rel.targetColumn ?? "id";
            const sourceColumn = rel.source_column ?? rel.sourceColumn;

            if (!targetTable || !sourceTable || !sourceColumn) return [];

            return [{
                id: `e-${index}`,
                source: targetTable,
                target: sourceTable,
                sourceHandle: `${targetColumn}-right`,
                targetHandle: `${sourceColumn}-left`,
                type: 'smoothstep',
                animated: true,
                style: { stroke: '#2563eb', strokeWidth: 1.5 },
                markerEnd: { type: MarkerType.ArrowClosed, color: '#2563eb' },
            }];
        });
    };

    const transformSchemaToWorkspace = (tables: TableInfo[], relationships: Relationship[], fileName: string, id: string, isImported: boolean): Workspace => {
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

        const edges = transformRelationshipsToEdges(relationships);

        const fileData: ExplorerFile = {
            id: id,
            name: fileName,
            tables: tables.map(t => ({
                name: t.name,
                columns: t.columns.map((c) => ({ name: c.name, type: c.type, is_pk: c.is_pk ?? c.isPk }))
            }))
        };

        return { id, name: fileName, nodes, edges, fileData, isImported };
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
                newId,
                true
            );
            setWorkspaces(prev => [...prev, newWorkspace]);
            setActiveWorkspaceId(newId);
        } catch (err: unknown) {
            console.error(err);
            const message = err && typeof err === "object" && "response" in err
                ? (err as { response?: { data?: { error?: string } } }).response?.data?.error
                : undefined;
            setErrorModal({ isOpen: true, message: message || "Upload failed." });
        } finally {
            setIsUploading(false);
        }
    };

    // --- CREATE BLANK FILE LOGIC ---
    const handleCreateBlankFile = (fileName: string) => {
        const newId = Date.now().toString();

        // Optionally notify backend to create a blank DB context if needed
        // For now, we create a frontend workspace.

        const newWorkspace: Workspace = {
            id: newId,
            name: fileName,
            nodes: [],
            edges: [],
            fileData: { id: newId, name: fileName, tables: [] },
            isImported: false
        };

        setWorkspaces(prev => [...prev, newWorkspace]);
        setActiveWorkspaceId(newId);
    };

    const refreshActiveSchema = useCallback(async () => {
        if (!activeWorkspaceId) return;
        try {
            const response = await dbService.getSchema();
            const tables = response.tables || [];
            const edges = transformRelationshipsToEdges(response.relationships || []);
            
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
                            columns: t.columns.map((c) => ({ name: c.name, type: c.type, is_pk: c.is_pk ?? c.isPk })) 
                        }))
                    };
                    return { ...w, nodes: newNodes, edges, fileData: updatedFileData };
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

    return (
        <div className="h-screen w-full bg-white text-zinc-800 flex flex-col">
            <Header
                onUpload={handleFileUpload}
                onRefresh={refreshActiveSchema}
                isUploading={isUploading}
                fileName={activeWorkspace?.name || null}
                isImported={activeWorkspace?.isImported ?? false}
                onClear={handleClearRequest}
                hasData={!!activeWorkspace}
                onShowInfo={() => setInfoOpen(true)}
            />

            <div className="flex-1 flex overflow-hidden relative">
                <FileExplorer
                    files={workspaces.map(w => w.fileData)}
                    activeFileId={activeWorkspaceId}
                    onSelectFile={setActiveWorkspaceId}
                    onCreateFile={openNewFileModal}
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
                            onRefreshRequest={refreshActiveSchema}
                        />
                    ) : (
                        <div className="flex-1 flex flex-col items-center justify-center bg-white text-zinc-400 gap-4">
                            <div className="w-16 h-16 bg-zinc-100 rounded-full flex items-center justify-center shadow-inner">
                                <FileCode size={32} className="opacity-40" />
                            </div>
                            <div className="text-center">
                                <p className="text-sm font-medium text-zinc-500 mb-2">No file selected</p>
                                <button
                                    onClick={openNewFileModal}
                                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm font-semibold flex items-center gap-2 mx-auto"
                                >
                                    <Plus size={16} /> Create New File
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {editingTable && <DataEditor tableName={editingTable} onClose={() => setEditingTable(null)} />}
            
            {errorModal.isOpen && (
                <div className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4 backdrop-blur-sm">
                    <div className="bg-white border border-zinc-200 rounded-lg p-6 max-w-sm w-full text-center shadow-2xl">
                        <div className="text-red-500 mb-2 flex justify-center"><AlertCircle size={32} /></div>
                        <h3 className="text-lg font-bold text-zinc-900 mb-2">Error</h3>
                        <p className="text-zinc-500 text-sm mb-4">{errorModal.message}</p>
                        <button onClick={() => setErrorModal({ ...errorModal, isOpen: false })} className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded">Close</button>
                    </div>
                </div>
            )}

            {showClearConfirm && (
                <div className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4 backdrop-blur-sm">
                    <div className="bg-white border border-zinc-200 rounded-lg p-6 max-w-md w-full shadow-2xl border-t-4 border-t-red-500">
                        <h3 className="text-lg font-bold text-zinc-900 flex items-center gap-2"><Trash2 size={20} className="text-red-500"/> Close Workspace?</h3>
                        <p className="text-zinc-500 text-sm mt-2 mb-4">This will remove &quot;{activeWorkspace?.name}&quot; from your view.</p>
                        <div className="flex gap-3 justify-end">
                            <button onClick={() => setShowClearConfirm(false)} className="px-4 py-2 text-zinc-500 hover:text-zinc-900">Cancel</button>
                            <button onClick={confirmClear} className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded">Close File</button>
                        </div>
                    </div>
                </div>
            )}
            
            {isInfoOpen && <InfoModal isOpen={isInfoOpen} onClose={() => setInfoOpen(false)} />}

            <NewFileModal
                key={newFileModalKey}
                isOpen={isNewFileModalOpen}
                onClose={() => setNewFileModalOpen(false)}
                onConfirm={handleCreateBlankFile}
                defaultName={`Untitled-${workspaces.length + 1}.sql`}
            />
        </div>
    );
}
