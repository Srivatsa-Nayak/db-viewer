"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { Trash2, FileCode, Plus, Loader2 } from 'lucide-react';

import { Header } from "@/components/header/Header";
import { Visualizer } from "@/components/canvas/Visualizer";

import { DataEditor } from "@/components/editor/DataEditor";
import { InfoModal } from '@/components/modal/InfoModal';
import { NewFileModal } from '@/components/modal/NewFileModal';
import { Notice, NoticeModal } from '@/components/modal/NoticeModal';
import { FileExplorer, ExplorerFile } from "@/components/editor/FileExplorer";
import { Edge, MarkerType, Node, applyNodeChanges, NodeChange } from "reactflow";
import { dbService, setActiveWorkspace } from "@/services/api";
import { clearSession, loadSession, saveSession } from "@/services/sessionStorage";
import { downloadCanvasImage } from "@/services/exportImage";
import { Relationship, TableInfo } from "@/types";

/**
 * One open SQL file. The `id` is also the backend workspace id: the backend keeps a
 * separate database per id, so tables created in one file are invisible to every
 * other file and two files may reuse the same table names.
 */
interface Workspace {
    id: string; // unique ID (timestamp), also the backend workspace id
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
    const [notice, setNotice] = useState<Notice>({ isOpen: false, severity: 'error', title: '', message: '' });
    const [showClearConfirm, setShowClearConfirm] = useState(false);
    const [isInfoOpen, setInfoOpen] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [isNewFileModalOpen, setNewFileModalOpen] = useState(false);
    const [newFileModalKey, setNewFileModalKey] = useState(0);
    // True until the previous session has been restored, so the empty state does not flash
    // and the save effect does not overwrite storage with an empty list on first render.
    const [isRestoring, setIsRestoring] = useState(true);

    const activeWorkspace = workspaces.find(w => w.id === activeWorkspaceId);

    /**
     * The active file id, readable from callbacks that outlive the render that created them.
     *
     * Every table node stores `onRefresh` in its React Flow `data`, captured when the node was
     * built. If that callback closed over `activeWorkspaceId` directly it would be stale: a file
     * is created and its nodes are built in the same tick as `setActiveWorkspaceId`, so the
     * captured value is still the *previous* id (null for the first file). Refreshing from a
     * node then returned early and the canvas silently never updated, even though the backend
     * change had gone through.
     */
    const activeWorkspaceIdRef = useRef<string | null>(null);

    // Point every subsequent API call at the file the user is looking at.
    useEffect(() => {
        activeWorkspaceIdRef.current = activeWorkspaceId;
        setActiveWorkspace(activeWorkspaceId);
    }, [activeWorkspaceId]);

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

    const transformSchemaToWorkspace = (
        tables: TableInfo[],
        relationships: Relationship[],
        fileName: string,
        id: string,
        isImported: boolean,
        savedPositions: Record<string, { x: number; y: number }> = {}
    ): Workspace => {
        const nodes: Node[] = tables.map((tbl, index) => ({
            id: tbl.name,
            type: "tableNode",
            // Restore the layout the user arranged; fall back to the default grid for a table
            // that did not exist when the session was saved.
            position: savedPositions[tbl.name] ?? { x: 250 * (index % 3), y: 100 + Math.floor(index / 3) * 300 },
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
        const newId = Date.now().toString();
        // Bind the API client to the new workspace before uploading: the file must land
        // in its own database, not in whichever file happened to be open.
        setActiveWorkspace(newId);
        try {
            const report = await dbService.uploadFile(file);
            const response = await dbService.getSchema();
            const tables = response.tables || [];
            const warnings = report.warnings ?? [];

            if (tables.length === 0) {
                // The import ran but produced nothing. Without this the user just gets a blank
                // canvas and no idea why, which is exactly what the server log was hiding.
                await dbService.deleteWorkspace().catch(() => {});
                setActiveWorkspace(activeWorkspaceId);
                setNotice({
                    isOpen: true,
                    severity: 'error',
                    title: 'Nothing could be imported',
                    message: `No tables were created from "${file.name}". `
                        + (warnings.length
                            ? 'Every statement in the file was skipped or failed - see the details below.'
                            : 'The file may be empty, or contain no CREATE TABLE statements.'),
                    details: warnings,
                });
                return;
            }

            const newWorkspace = transformSchemaToWorkspace(
                tables,
                response.relationships || [],
                file.name,
                newId,
                true
            );
            setWorkspaces(prev => [...prev, newWorkspace]);
            setActiveWorkspaceId(newId);

            if (warnings.length > 0) {
                const total = report.warningCount ?? warnings.length;
                setNotice({
                    isOpen: true,
                    severity: 'warning',
                    title: 'Imported with warnings',
                    message: `Created ${tables.length} table${tables.length === 1 ? '' : 's'} from `
                        + `"${file.name}", but ${total} statement${total === 1 ? '' : 's'} could not be run. `
                        + 'This is normal for a MySQL dump - triggers, procedures and engine options '
                        + 'have no SQLite equivalent.',
                    details: warnings,
                });
            }
        } catch (err: unknown) {
            console.error(err);
            await dbService.deleteWorkspace().catch(() => {});
            setActiveWorkspace(activeWorkspaceId);
            const message = err && typeof err === "object" && "response" in err
                ? (err as { response?: { data?: { error?: string } } }).response?.data?.error
                : undefined;
            setNotice({
                isOpen: true,
                severity: 'error',
                title: 'Upload failed',
                message: message || `"${file.name}" could not be imported.`,
            });
        } finally {
            setIsUploading(false);
        }
    };

    // --- CREATE BLANK FILE LOGIC ---
    const handleCreateBlankFile = (fileName: string) => {
        const newId = Date.now().toString();

        // The backend creates the workspace database lazily on its first request; all
        // we have to do here is point the API client at the new id.
        setActiveWorkspace(newId);

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

    // Restore the files that were open before the refresh. Runs once, on mount.
    useEffect(() => {
        let cancelled = false;

        const restore = async () => {
            const saved = loadSession();
            if (!saved || saved.workspaces.length === 0) {
                setIsRestoring(false);
                return;
            }

            try {
                // Only restore files whose database still exists. A wiped data directory or a
                // different backend would otherwise resurrect empty ghosts of old files.
                const existing = new Set(await dbService.listWorkspaces());
                const alive = saved.workspaces.filter(w => existing.has(w.id));

                const restored: Workspace[] = [];
                for (const entry of alive) {
                    setActiveWorkspace(entry.id);
                    try {
                        const schema = await dbService.getSchema();
                        restored.push(transformSchemaToWorkspace(
                            schema.tables || [],
                            schema.relationships || [],
                            entry.name,
                            entry.id,
                            entry.isImported,
                            entry.positions
                        ));
                    } catch (e) {
                        console.error(`Could not restore "${entry.name}"`, e);
                    }
                }

                if (cancelled) return;

                if (restored.length === 0) {
                    clearSession();
                } else {
                    const nextActive = restored.some(w => w.id === saved.activeWorkspaceId)
                        ? saved.activeWorkspaceId
                        : restored[restored.length - 1].id;
                    setWorkspaces(restored);
                    setActiveWorkspaceId(nextActive);
                }
            } catch (e) {
                // Backend unreachable: keep the stored session for the next attempt rather than
                // deleting the user's file list because the server happened to be down.
                console.error("Could not restore the previous session", e);
            } finally {
                if (!cancelled) setIsRestoring(false);
            }
        };

        restore();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Persist the open files whenever they change. Debounced because dragging a node fires
    // onNodesChange continuously.
    useEffect(() => {
        if (isRestoring) return;

        const handle = setTimeout(() => {
            saveSession({
                version: 1,
                activeWorkspaceId,
                workspaces: workspaces.map(w => ({
                    id: w.id,
                    name: w.name,
                    isImported: w.isImported,
                    positions: Object.fromEntries(w.nodes.map(n => [n.id, n.position])),
                })),
            });
        }, 300);

        return () => clearTimeout(handle);
    }, [workspaces, activeWorkspaceId, isRestoring]);

    // Deliberately dependency-free so the reference stays stable for the lifetime of the page
    // and the copy stored in every node's `data.onRefresh` is never stale.
    const refreshActiveSchema = useCallback(async () => {
        const workspaceId = activeWorkspaceIdRef.current;
        if (!workspaceId) return;
        try {
            const response = await dbService.getSchema();
            const tables = response.tables || [];
            const edges = transformRelationshipsToEdges(response.relationships || []);
            
            setWorkspaces(prev => prev.map(w => {
                if (w.id === workspaceId) {
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
    }, []);

    const onNodesChange = useCallback((changes: NodeChange[]) => {
        setWorkspaces(prevWorkspaces => 
            prevWorkspaces.map(workspace => {
                if (workspace.id === activeWorkspaceIdRef.current) {
                    return { ...workspace, nodes: applyNodeChanges(changes, workspace.nodes) };
                }
                return workspace;
            })
        );
    }, []);

    const handleExportImage = async () => {
        if (!activeWorkspace) return;
        try {
            await downloadCanvasImage(activeWorkspace.nodes, activeWorkspace.name);
        } catch (e) {
            setNotice({
                isOpen: true,
                severity: 'error',
                title: 'Could not export the image',
                message: e instanceof Error ? e.message : 'The diagram could not be rendered to a PNG.',
            });
        }
    };

    const handleClearRequest = () => {
        if (!activeWorkspace) {
             setNotice({
                 isOpen: true,
                 severity: 'warning',
                 title: 'No file open',
                 message: 'Open or create a file before trying to close one.',
             });
             return;
        }
        setShowClearConfirm(true);
    };

    const confirmClear = async () => {
        const closingId = activeWorkspaceId;
        try {
            // Drops this file's own database only - other open files are untouched.
            await dbService.deleteWorkspace();
        } catch (e) {
            console.error("Failed to delete workspace", e);
        }
        const remaining = workspaces.filter(w => w.id !== closingId);
        const nextId = remaining.length > 0 ? remaining[remaining.length - 1].id : null;
        setWorkspaces(remaining);
        setActiveWorkspaceId(nextId);
        setActiveWorkspace(nextId);
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
                onExportImage={handleExportImage}
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
                    ) : isRestoring ? (
                        <div className="flex-1 flex flex-col items-center justify-center bg-white text-zinc-400 gap-3">
                            <Loader2 size={28} className="animate-spin text-blue-500" />
                            <p className="text-sm text-zinc-500">Restoring your files...</p>
                        </div>
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
            
            <NoticeModal notice={notice} onClose={() => setNotice({ ...notice, isOpen: false })} />

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
