"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import dynamic from "next/dynamic";
import { FileCode, Plus, Loader2, Sparkles } from 'lucide-react';

import { Header } from "@/components/header/Header";
import { Visualizer } from "@/components/canvas/Visualizer";
import { FileExplorer, ExplorerFile } from "@/components/editor/FileExplorer";
import { Notice } from '@/components/modal/NoticeModal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Edge, MarkerType, Node, applyNodeChanges, NodeChange } from "reactflow";
import {
    dbService, setActiveWorkspace, authService, isAuthRequired, isForeignWorkspace,
    AuthUser, TableNote,
} from "@/services/api";
import { clearSession, loadSession, saveSession } from "@/services/sessionStorage";
import { newWorkspaceId } from "@/services/workspaceId";
import { downloadCanvasImage } from "@/services/exportImage";
import { Relationship, TableInfo } from "@/types";

/**
 * Dialogs are code-split.
 *
 * None of them is on the path to first paint, and between them they pull in most of the
 * form-heavy code in the app. Loading them on demand takes that weight out of the initial
 * editor bundle; `ssr: false` because every one of them is inert on the server anyway.
 */
const DataEditor = dynamic(() => import('@/components/editor/DataEditor').then(m => m.DataEditor), { ssr: false });
const InfoModal = dynamic(() => import('@/components/modal/InfoModal').then(m => m.InfoModal), { ssr: false });
const NewFileModal = dynamic(() => import('@/components/modal/NewFileModal').then(m => m.NewFileModal), { ssr: false });
const NoticeModal = dynamic(() => import('@/components/modal/NoticeModal').then(m => m.NoticeModal), { ssr: false });
const AuthModal = dynamic(() => import('@/components/modal/AuthModal').then(m => m.AuthModal), { ssr: false });
const ShareModal = dynamic(() => import('@/components/modal/ShareModal').then(m => m.ShareModal), { ssr: false });
const ProfileModal = dynamic(() => import('@/components/modal/ProfileModal').then(m => m.ProfileModal), { ssr: false });

/**
 * One open SQL file. The `id` is also the backend workspace id: the backend keeps a
 * separate database per id, so tables created in one file are invisible to every
 * other file and two files may reuse the same table names.
 */
interface Workspace {
    id: string;
    name: string;
    nodes: Node[];
    edges: Edge[];
    fileData: ExplorerFile;
    isImported: boolean;
}

const EDGE_COLOUR = '#2563eb';

const transformRelationshipsToEdges = (relationships: Relationship[]): Edge[] =>
    relationships.map((rel, index) => ({
        id: `e-${index}`,
        source: rel.targetTable,
        target: rel.sourceTable,
        sourceHandle: `${rel.targetColumn}-right`,
        targetHandle: `${rel.sourceColumn}-left`,
        type: 'smoothstep',
        animated: true,
        style: { stroke: EDGE_COLOUR, strokeWidth: 1.5 },
        markerEnd: { type: MarkerType.ArrowClosed, color: EDGE_COLOUR },
    }));

const defaultPosition = (index: number) => ({
    x: 250 * (index % 3),
    y: 100 + Math.floor(index / 3) * 300,
});

const errorMessage = (err: unknown): string | undefined =>
    err && typeof err === "object" && "response" in err
        ? (err as { response?: { data?: { error?: string } } }).response?.data?.error
        : undefined;

export default function Home() {
    const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
    const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
    const [isExplorerOpen, setIsExplorerOpen] = useState(false);
    const [editingTable, setEditingTable] = useState<string | null>(null);
    const [notice, setNotice] = useState<Notice>({ isOpen: false, severity: 'error', title: '', message: '' });
    const [showClearConfirm, setShowClearConfirm] = useState(false);
    const [isClearing, setClearing] = useState(false);
    const [isInfoOpen, setInfoOpen] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [isNewFileModalOpen, setNewFileModalOpen] = useState(false);
    // True until the previous session has been restored, so the empty state does not flash
    // and the save effect does not overwrite storage with an empty list on first render.
    const [isRestoring, setIsRestoring] = useState(true);
    const [user, setUser] = useState<AuthUser | null>(null);
    // What the user was trying to do when we asked them to sign up, so the prompt can say why.
    const [authReason, setAuthReason] = useState<string | null>(null);
    const [isAuthOpen, setAuthOpen] = useState(false);
    const [isShareOpen, setShareOpen] = useState(false);
    const [isProfileOpen, setProfileOpen] = useState(false);
    const [notes, setNotes] = useState<TableNote[]>([]);
    const [tableToDelete, setTableToDelete] = useState<string | null>(null);
    const [isDeletingTable, setDeletingTable] = useState(false);
    const [isLoadingExample, setLoadingExample] = useState(false);

    /**
     * The signed-in user, readable from callbacks that outlive the render that created them.
     *
     * `handleDownloadCsv` is stored in every node's `data`, and the callback that rebuilds
     * those nodes is deliberately stable - so reading `user` from the closure would pin it to
     * its first-render value (null) and prompt for sign-up even once signed in.
     */
    const userRef = useRef<AuthUser | null>(null);

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

    const activeWorkspace = useMemo(
        () => workspaces.find(w => w.id === activeWorkspaceId) ?? null,
        [workspaces, activeWorkspaceId]
    );

    /** Open (not ticked off) note count per table, for the badge on each node. */
    const openNoteCounts = useMemo(
        () => notes.reduce<Record<string, number>>((counts, note) => {
            if (!note.done) counts[note.table_name] = (counts[note.table_name] ?? 0) + 1;
            return counts;
        }, {}),
        [notes]
    );

    /**
     * Nodes with their note badge folded in.
     *
     * Memoised because this used to run inline in the JSX: every render produced a brand new
     * `data` object for every node, which React Flow compares by reference — so dragging one
     * table re-rendered all of them, on every mouse move.
     */
    const nodesWithNotes = useMemo(() => {
        if (!activeWorkspace) return [];
        return activeWorkspace.nodes.map(n => {
            const openNotes = openNoteCounts[n.id] ?? 0;
            return openNotes === n.data.openNotes ? n : { ...n, data: { ...n.data, openNotes } };
        });
    }, [activeWorkspace, openNoteCounts]);

    const requireAccount = useCallback((reason: string) => {
        setAuthReason(reason);
        setAuthOpen(true);
    }, []);

    // Point every subsequent API call at the file the user is looking at.
    useEffect(() => {
        activeWorkspaceIdRef.current = activeWorkspaceId;
        setActiveWorkspace(activeWorkspaceId);
    }, [activeWorkspaceId]);

    // The explorer is a persistent column on a wide screen and an overlay drawer on a narrow
    // one. Opening it by default only makes sense in the first case, and the decision has to
    // happen after mount or the server and client would render different markup.
    useEffect(() => {
        setIsExplorerOpen(window.matchMedia('(min-width: 1024px)').matches);
    }, []);

    useEffect(() => {
        userRef.current = user;
    }, [user]);

    // Resolve the stored token back to a user, so a refresh does not sign anyone out.
    useEffect(() => {
        let cancelled = false;
        authService.me().then(u => { if (!cancelled) setUser(u); });
        return () => { cancelled = true; };
    }, []);

    const refreshNotes = useCallback(async () => {
        if (!activeWorkspaceIdRef.current) { setNotes([]); return; }
        try {
            setNotes(await dbService.getAllTableNotes());
        } catch {
            setNotes([]);
        }
    }, []);

    // Stable, because they are captured in node data that outlives the render.
    const handleDownloadCsv = useCallback(async (tableName: string) => {
        if (!userRef.current) return requireAccount('Downloading a table');
        try {
            await dbService.downloadTableCsv(tableName);
        } catch (e) {
            if (isAuthRequired(e)) return requireAccount('Downloading a table');
            setNotice({
                isOpen: true, severity: 'error', title: 'Download failed',
                message: `"${tableName}" could not be downloaded.`,
            });
        }
    }, [requireAccount]);

    const requestTableDelete = useCallback((tableName: string) => setTableToDelete(tableName), []);

    /** Drops a file that is no longer ours, rather than leaving a tab that 403s on every action. */
    const closeForeignWorkspace = useCallback((workspaceId: string) => {
        setWorkspaces(prev => {
            const remaining = prev.filter(w => w.id !== workspaceId);
            setActiveWorkspaceId(current => {
                if (current !== workspaceId) return current;
                const next = remaining.length > 0 ? remaining[remaining.length - 1].id : null;
                setActiveWorkspace(next);
                return next;
            });
            return remaining;
        });
        setNotice({
            isOpen: true,
            severity: 'warning',
            title: 'That file is not yours',
            message: 'It belongs to a different session, so it has been closed. '
                + 'Sign in with the account that created it to open it again.',
        });
    }, []);

    // Deliberately dependency-free so the reference stays stable for the lifetime of the page
    // and the copy stored in every node's `data.onRefresh` is never stale.
    const refreshActiveSchema = useCallback(async () => {
        const workspaceId = activeWorkspaceIdRef.current;
        if (!workspaceId) return;
        try {
            const response = await dbService.getSchema();
            const tables = response.tables;
            const edges = transformRelationshipsToEdges(response.relationships);

            setWorkspaces(prev => prev.map(w => {
                if (w.id !== workspaceId) return w;

                const nodes: Node[] = tables.map((tbl, index) => {
                    const existing = w.nodes.find(n => n.id === tbl.name);
                    return {
                        id: tbl.name,
                        type: "tableNode",
                        position: existing ? existing.position : defaultPosition(index),
                        data: {
                            label: tbl.name,
                            columns: tbl.columns,
                            openNotes: existing?.data?.openNotes ?? 0,
                            onRefresh: refreshActiveSchema,
                            onEdit: setEditingTable,
                            onDelete: requestTableDelete,
                            onDownloadCsv: handleDownloadCsv,
                            onNotesChanged: refreshNotes,
                        },
                    };
                });

                return {
                    ...w,
                    nodes,
                    edges,
                    fileData: { ...w.fileData, tables: tables.map(t => ({ name: t.name, columns: t.columns })) },
                };
            }));
        } catch (e) {
            if (isForeignWorkspace(e)) {
                closeForeignWorkspace(workspaceId);
                return;
            }
            console.error("Refresh failed", e);
        }
        // All four are stable useCallbacks, so this array never actually changes - it is
        // declared so the dependency is explicit rather than silently captured.
    }, [handleDownloadCsv, requestTableDelete, refreshNotes, closeForeignWorkspace]);

    const transformSchemaToWorkspace = useCallback((
        tables: TableInfo[],
        relationships: Relationship[],
        fileName: string,
        id: string,
        isImported: boolean,
        savedPositions: Record<string, { x: number; y: number }> = {}
    ): Workspace => ({
        id,
        name: fileName,
        isImported,
        nodes: tables.map((tbl, index) => ({
            id: tbl.name,
            type: "tableNode",
            // Restore the layout the user arranged; fall back to the default grid for a table
            // that did not exist when the session was saved.
            position: savedPositions[tbl.name] ?? defaultPosition(index),
            data: {
                label: tbl.name,
                columns: tbl.columns,
                openNotes: 0,
                onRefresh: refreshActiveSchema,
                onEdit: setEditingTable,
                onDelete: requestTableDelete,
                onDownloadCsv: handleDownloadCsv,
                onNotesChanged: refreshNotes,
            },
        })),
        edges: transformRelationshipsToEdges(relationships),
        fileData: {
            id,
            name: fileName,
            tables: tables.map(t => ({ name: t.name, columns: t.columns })),
        },
    }), [refreshActiveSchema, requestTableDelete, handleDownloadCsv, refreshNotes]);

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
                            schema.tables, schema.relationships,
                            entry.name, entry.id, entry.isImported, entry.positions
                        ));
                    } catch (e) {
                        // A file that is no longer ours is simply dropped from the restored
                        // list. It is not an error worth interrupting the user for: it is what
                        // signing out, or signing in as somebody else, is supposed to look like.
                        if (!isForeignWorkspace(e)) {
                            console.error(`Could not restore "${entry.name}"`, e);
                        }
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

    useEffect(() => {
        if (isRestoring) return;
        refreshNotes();
    }, [activeWorkspaceId, isRestoring, refreshNotes]);

    /* ── File lifecycle ──────────────────────────────────────────────────── */

    const handleFileUpload = async (file: File) => {
        setIsUploading(true);
        const newId = newWorkspaceId();
        // Bind the API client to the new workspace before uploading: the file must land
        // in its own database, not in whichever file happened to be open.
        setActiveWorkspace(newId);
        try {
            const report = await dbService.uploadFile(file);
            const response = await dbService.getSchema();
            const tables = response.tables;
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

            setWorkspaces(prev => [...prev, transformSchemaToWorkspace(
                tables, response.relationships, file.name, newId, true
            )]);
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
            setNotice({
                isOpen: true,
                severity: 'error',
                title: 'Upload failed',
                message: errorMessage(err) || `"${file.name}" could not be imported.`,
            });
        } finally {
            setIsUploading(false);
        }
    };

    const handleCreateBlankFile = (fileName: string) => {
        const newId = newWorkspaceId();

        // The backend creates the workspace database lazily on its first request; all
        // we have to do here is point the API client at the new id.
        setActiveWorkspace(newId);

        setWorkspaces(prev => [...prev, {
            id: newId,
            name: fileName,
            nodes: [],
            edges: [],
            fileData: { id: newId, name: fileName, tables: [] },
            isImported: false,
        }]);
        setActiveWorkspaceId(newId);
    };

    /** Fills an empty file with the bundled example so a first visit shows something real. */
    const handleLoadExample = async () => {
        setLoadingExample(true);
        try {
            let workspaceId = activeWorkspaceIdRef.current;
            const isNewFile = !workspaceId;
            if (!workspaceId) {
                workspaceId = newWorkspaceId();
                setActiveWorkspace(workspaceId);
                activeWorkspaceIdRef.current = workspaceId;
            }
            await dbService.loadExampleSchema();

            if (isNewFile) {
                const schema = await dbService.getSchema();
                setWorkspaces(prev => [...prev, transformSchemaToWorkspace(
                    schema.tables, schema.relationships, 'example-store.sql', workspaceId!, false
                )]);
                setActiveWorkspaceId(workspaceId);
            } else {
                await refreshActiveSchema();
            }
            refreshNotes();
        } catch (err: unknown) {
            setNotice({
                isOpen: true, severity: 'error', title: 'Could not load the example',
                message: errorMessage(err) || 'The example schema could not be loaded.',
            });
        } finally {
            setLoadingExample(false);
        }
    };

    const confirmTableDelete = async () => {
        if (!tableToDelete) return;
        setDeletingTable(true);
        try {
            await dbService.dropTable(tableToDelete);
            setTableToDelete(null);
            await refreshActiveSchema();
            refreshNotes();
        } catch (err: unknown) {
            const response = err && typeof err === 'object' && 'response' in err
                ? (err as { response?: { status?: number; data?: { error?: string; referencedBy?: string[] } } }).response
                : undefined;
            setTableToDelete(null);
            setNotice({
                isOpen: true,
                // 409 is the expected, meaningful case: another table depends on this one.
                severity: response?.status === 409 ? 'warning' : 'error',
                title: response?.status === 409 ? 'Table is still referenced' : 'Could not delete the table',
                message: response?.data?.error || 'The table could not be deleted.',
                details: response?.data?.referencedBy?.map(t => `${t} has a foreign key pointing at this table`),
            });
        } finally {
            setDeletingTable(false);
        }
    };

    const confirmClear = async () => {
        const closingId = activeWorkspaceId;
        setClearing(true);
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
        setClearing(false);
    };

    /* ── Exports and sharing ─────────────────────────────────────────────── */

    /** Exports need an account; the backend enforces it too, this just explains why. */
    const handleExportSql = async () => {
        if (!activeWorkspace) return;
        if (!user) return requireAccount('Exporting a file');
        let name = activeWorkspace.name || 'database_dump.sql';
        if (activeWorkspace.isImported) name = `modified_${name}`;
        if (!name.toLowerCase().endsWith('.sql')) name += '.sql';
        try {
            await dbService.downloadDatabaseSql(name);
        } catch (e) {
            if (isAuthRequired(e)) return requireAccount('Exporting a file');
            setNotice({ isOpen: true, severity: 'error', title: 'Export failed',
                message: 'The SQL file could not be downloaded.' });
        }
    };

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
                message: 'Open or create a file before trying to delete one.',
            });
            return;
        }
        setShowClearConfirm(true);
    };

    /**
     * Signing out closes every open file.
     *
     * The workspaces on screen belong to the account that just left, so every request about
     * them would now come back 403. Clearing them is not data loss — the databases are
     * untouched and signing back in restores the list from the backend.
     */
    const handleSignOut = () => {
        authService.logout();
        setUser(null);
        setWorkspaces([]);
        setActiveWorkspaceId(null);
        setActiveWorkspace(null);
        setNotes([]);
        clearSession();
    };

    const handleShare = () => {
        if (!activeWorkspace) return;
        if (!user) return requireAccount('Creating a share link');
        setShareOpen(true);
    };

    const onNodesChange = useCallback((changes: NodeChange[]) => {
        setWorkspaces(prev => prev.map(workspace =>
            workspace.id === activeWorkspaceIdRef.current
                ? { ...workspace, nodes: applyNodeChanges(changes, workspace.nodes) }
                : workspace
        ));
    }, []);

    const selectFile = useCallback((fileId: string) => {
        setActiveWorkspaceId(fileId);
        // On a phone the explorer covers the canvas, so picking a file has to get out of
        // the way — otherwise the user taps a file and appears to land nowhere.
        if (!window.matchMedia('(min-width: 1024px)').matches) setIsExplorerOpen(false);
    }, []);

    return (
        <div className="h-[100dvh] w-full bg-white text-ink-800 flex flex-col overflow-hidden">
            <Header
                onUpload={handleFileUpload}
                onNewFile={() => setNewFileModalOpen(true)}
                isUploading={isUploading}
                fileName={activeWorkspace?.name || null}
                onClear={handleClearRequest}
                hasData={!!activeWorkspace}
                onShowInfo={() => setInfoOpen(true)}
                onExportSql={handleExportSql}
                onExportImage={handleExportImage}
                onShare={handleShare}
                onSignIn={() => { setAuthReason(null); setAuthOpen(true); }}
                onSignOut={handleSignOut}
                onEditProfile={() => setProfileOpen(true)}
                user={user}
            />

            <div className="flex-1 flex overflow-hidden relative min-h-0">
                {/* Scrim for the drawer. Only below lg, where the explorer overlays the canvas.
                    Always mounted and animated by opacity, so it fades out with the drawer's
                    slide rather than blinking away the instant the state flips. */}
                <div
                    className={`lg:hidden absolute inset-0 z-30 bg-ink-900/40 transition-opacity duration-300 motion-reduce:transition-none ${
                        isExplorerOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
                    }`}
                    onClick={() => setIsExplorerOpen(false)}
                    aria-hidden="true"
                />

                <FileExplorer
                    files={workspaces.map(w => w.fileData)}
                    activeFileId={activeWorkspaceId}
                    onSelectFile={selectFile}
                    onCreateFile={() => setNewFileModalOpen(true)}
                    isOpen={isExplorerOpen}
                    onToggle={() => setIsExplorerOpen(v => !v)}
                />

                <main className="flex-1 flex flex-col relative h-full min-w-0">
                    {activeWorkspace ? (
                        <Visualizer
                            key={activeWorkspace.id}
                            nodes={nodesWithNotes}
                            edges={activeWorkspace.edges}
                            onNodesChange={onNodesChange}
                            onRefreshRequest={refreshActiveSchema}
                        />
                    ) : isRestoring ? (
                        <div className="flex-1 flex flex-col items-center justify-center bg-white text-ink-400 gap-3">
                            <Loader2 size={28} className="animate-spin text-brand-500" />
                            <p className="text-sm text-ink-500">Restoring your files...</p>
                        </div>
                    ) : (
                        <div className="flex-1 flex flex-col items-center justify-center bg-white text-ink-400 gap-4 px-6">
                            <div className="w-16 h-16 bg-ink-100 rounded-full flex items-center justify-center shadow-inner">
                                <FileCode size={32} className="opacity-40" />
                            </div>
                            <div className="text-center max-w-sm">
                                <p className="text-base font-semibold text-ink-700 mb-1">Nothing open yet</p>
                                <p className="text-sm text-ink-500 mb-5 leading-relaxed">
                                    Load the example to see what a schema looks like here, or start
                                    an empty file of your own.
                                </p>
                                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3">
                                    <button
                                        onClick={handleLoadExample}
                                        disabled={isLoadingExample}
                                        className="px-4 py-2.5 brand-gradient brand-gradient-hover disabled:opacity-60 text-white rounded-md text-sm font-semibold flex items-center justify-center gap-2 shadow-glow-sm transition-all"
                                    >
                                        {isLoadingExample
                                            ? <Loader2 size={16} className="animate-spin" />
                                            : <Sparkles size={16} />}
                                        Show me an example
                                    </button>
                                    <button
                                        onClick={() => setNewFileModalOpen(true)}
                                        className="px-4 py-2.5 bg-white border border-ink-300 hover:bg-ink-50 text-ink-700 rounded-md text-sm font-semibold flex items-center justify-center gap-2 transition-colors"
                                    >
                                        <Plus size={16} /> New file
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </main>
            </div>

            {editingTable && <DataEditor tableName={editingTable} onClose={() => setEditingTable(null)} />}

            {notice.isOpen && (
                <NoticeModal notice={notice} onClose={() => setNotice(n => ({ ...n, isOpen: false }))} />
            )}

            {isAuthOpen && (
                <AuthModal
                    isOpen
                    reason={authReason}
                    onClose={() => setAuthOpen(false)}
                    onSignedIn={setUser}
                />
            )}

            {isShareOpen && (
                <ShareModal
                    isOpen
                    fileName={activeWorkspace?.name ?? null}
                    onClose={() => setShareOpen(false)}
                    onNeedsAccount={() => requireAccount('Creating a share link')}
                />
            )}

            <ConfirmDialog
                isOpen={tableToDelete !== null}
                title="Delete table?"
                message={
                    <>
                        <span className="font-mono text-ink-900">{tableToDelete}</span> and all of
                        its rows will be permanently removed.
                    </>
                }
                detail="If another table's foreign key points at it, the delete is refused instead of leaving broken references behind."
                confirmLabel="Delete table"
                isBusy={isDeletingTable}
                onConfirm={confirmTableDelete}
                onClose={() => setTableToDelete(null)}
            />

            <ConfirmDialog
                isOpen={showClearConfirm}
                title="Delete file?"
                message={
                    <>
                        &quot;{activeWorkspace?.name}&quot; and its database will be permanently
                        deleted, along with every table and row in it.
                    </>
                }
                detail="Any share link for this file stops working. This cannot be undone."
                confirmLabel="Delete file"
                isBusy={isClearing}
                onConfirm={confirmClear}
                onClose={() => setShowClearConfirm(false)}
            />

            {isProfileOpen && user && (
                <ProfileModal
                    isOpen
                    user={user}
                    onClose={() => setProfileOpen(false)}
                    onUpdated={setUser}
                />
            )}

            {isInfoOpen && <InfoModal isOpen onClose={() => setInfoOpen(false)} />}

            {isNewFileModalOpen && (
                <NewFileModal
                    isOpen
                    onClose={() => setNewFileModalOpen(false)}
                    onConfirm={handleCreateBlankFile}
                    defaultName={`Untitled-${workspaces.length + 1}.sql`}
                />
            )}
        </div>
    );
}
