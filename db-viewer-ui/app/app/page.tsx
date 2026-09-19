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
    AuthUser, TableNote, WorkspaceSummary,
} from "@/services/api";
import { clearSession, loadSession, saveSession } from "@/services/sessionStorage";
import { newWorkspaceId } from "@/services/workspaceId";
import { downloadCanvasImage } from "@/services/exportImage";
import { ImportPlan, Relationship, SqlDialectId, TableInfo } from "@/types";

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
const ExportModal = dynamic(() => import('@/components/modal/ExportModal').then(m => m.ExportModal), { ssr: false });
const ImportPreviewModal = dynamic(
    () => import('@/components/modal/ImportPreviewModal').then(m => m.ImportPreviewModal), { ssr: false });
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
    /**
     * The relationships as the backend reported them, kept beside the edges they produced.
     *
     * An `Edge` is a drawing instruction — two node ids and two handle ids — and the text
     * exports need the schema, not the drawing. Deriving one back from the other would mean
     * parsing handle ids, which is exactly the sort of thing that quietly stops working.
     */
    relationships: Relationship[];
    fileData: ExplorerFile;
    isImported: boolean;
}

/**
 * A CSS variable rather than a hex value, so the lines follow the theme.
 *
 * React Flow puts the marker colour in a `style` object and the edge colour in one too, and
 * `var()` resolves in both. The dot grid is the one place it does not - see `Visualizer`.
 */
const EDGE_COLOUR = 'var(--color-edge)';

const transformRelationshipsToEdges = (relationships: Relationship[]): Edge[] =>
    relationships.map((rel, index) => ({
        id: `e-${index}`,
        source: rel.targetTable,
        target: rel.sourceTable,
        sourceHandle: `${rel.targetColumn}-right`,
        targetHandle: `${rel.sourceColumn}-left`,
        // Right angles that route around the tables in the way, rather than a diagonal through
        // them - see `components/canvas/edgeRouting.ts`.
        type: 'orthogonal',
        // Not animated. A marching dash on one edge reads as flow; on eighty of them it reads as
        // noise, and this is a diagram people keep open for hours.
        animated: false,
        style: { stroke: EDGE_COLOUR, strokeWidth: 1.6 },
        markerEnd: { type: MarkerType.ArrowClosed, color: EDGE_COLOUR, width: 16, height: 16 },
    }));

/**
 * Which columns of each table are foreign keys, and which are pointed at.
 *
 * A table node needs this to place its connection handles, and an edge with no handle at one end
 * silently does not render. It used to be worked out from the `*_id` naming convention alone,
 * which is a good guess and no more: a schema whose foreign key is called `customer` rather than
 * `customer_id` drew no line at all, even though the backend had reported the relationship.
 */
const keyColumnsByTable = (relationships: Relationship[]) => {
    const foreignKeys: Record<string, string[]> = {};
    const referenced: Record<string, string[]> = {};

    for (const rel of relationships) {
        (foreignKeys[rel.sourceTable] ??= []).push(rel.sourceColumn);
        (referenced[rel.targetTable] ??= []).push(rel.targetColumn);
    }
    return { foreignKeys, referenced };
};

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
    /** False until the stored token has been resolved (or found absent). */
    const [isAuthResolved, setAuthResolved] = useState(false);
    // What the user was trying to do when we asked them to sign up, so the prompt can say why.
    const [authReason, setAuthReason] = useState<string | null>(null);
    const [isAuthOpen, setAuthOpen] = useState(false);
    const [isShareOpen, setShareOpen] = useState(false);
    const [isExportOpen, setExportOpen] = useState(false);
    /**
     * The file the user has chosen but not yet imported, and what importing it would do.
     *
     * Both halves are needed: the plan is what the dialog shows, and the File itself is what gets
     * sent when they confirm. Holding the File rather than re-reading it means the confirm step
     * cannot import something different from what was previewed.
     */
    const [pendingImport, setPendingImport] = useState<{ file: File; plan: ImportPlan } | null>(null);
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
    // `isAuthResolved` gates the first file-list restore: starting it before we know who is
    // asking would run it once as nobody and again as the user, for the same answer.
    useEffect(() => {
        let cancelled = false;
        authService.me()
            .then(u => { if (!cancelled) setUser(u); })
            .finally(() => { if (!cancelled) setAuthResolved(true); });
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
            const keys = keyColumnsByTable(response.relationships);

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
                            foreignKeyColumns: keys.foreignKeys[tbl.name] ?? [],
                            referencedColumns: keys.referenced[tbl.name] ?? [],
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
                    relationships: response.relationships,
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
    ): Workspace => {
        const keys = keyColumnsByTable(relationships);
        return {
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
                foreignKeyColumns: keys.foreignKeys[tbl.name] ?? [],
                referencedColumns: keys.referenced[tbl.name] ?? [],
                openNotes: 0,
                onRefresh: refreshActiveSchema,
                onEdit: setEditingTable,
                onDelete: requestTableDelete,
                onDownloadCsv: handleDownloadCsv,
                onNotesChanged: refreshNotes,
            },
        })),
        edges: transformRelationshipsToEdges(relationships),
        relationships,
        fileData: {
            id,
            name: fileName,
            tables: tables.map(t => ({ name: t.name, columns: t.columns })),
        },
        };
    }, [refreshActiveSchema, requestTableDelete, handleDownloadCsv, refreshNotes]);

    /**
     * Rebuilds the open-file list for whoever is signed in now.
     *
     * **The backend is the authority on which files exist.** `GET /workspaces` is scoped to the
     * caller's identity, and closing a file deletes its workspace, so what it returns is exactly
     * the set that should be open. localStorage contributes only the canvas layout and a
     * fallback name.
     *
     * It used to be the other way round — the stored session was the list, and the backend was
     * consulted only to filter it — which meant signing out (which clears storage) destroyed the
     * only record of a user's files. They were still on disk and still owned, and nothing ever
     * asked for them again.
     */
    const restoreOpenFiles = useCallback(async (): Promise<void> => {
        const saved = loadSession();
        const savedById = new Map((saved?.workspaces ?? []).map(w => [w.id, w]));

        let owned: WorkspaceSummary[];
        try {
            owned = await dbService.listWorkspaces();
        } catch (e) {
            // Backend unreachable. Keep whatever is on screen and the stored session with it,
            // rather than emptying someone's explorer because the server was restarting.
            console.error("Could not list workspaces", e);
            return;
        }

        const restored: Workspace[] = [];
        for (const entry of owned) {
            setActiveWorkspace(entry.id);
            const stored = savedById.get(entry.id);
            // Server-side name first; the browser's copy only covers files created before names
            // were recorded there.
            const name = entry.name ?? stored?.name ?? 'Untitled.sql';
            try {
                const schema = await dbService.getSchema();
                restored.push(transformSchemaToWorkspace(
                    schema.tables, schema.relationships,
                    name, entry.id, stored?.isImported ?? false, stored?.positions ?? {}
                ));
            } catch (e) {
                // A file that is no longer ours is simply dropped. Not worth interrupting the
                // user for: it is what signing in as somebody else is supposed to look like.
                if (!isForeignWorkspace(e)) {
                    console.error(`Could not open "${name}"`, e);
                }
            }
        }

        if (restored.length === 0) {
            clearSession();
            setWorkspaces([]);
            setActiveWorkspaceId(null);
            setActiveWorkspace(null);
            return;
        }

        const nextActive = restored.some(w => w.id === saved?.activeWorkspaceId)
            ? saved!.activeWorkspaceId
            : restored[restored.length - 1].id;
        setWorkspaces(restored);
        setActiveWorkspaceId(nextActive);
        setActiveWorkspace(nextActive);
    }, [transformSchemaToWorkspace]);

    /**
     * Rebuild the file list on mount, and again whenever the identity changes.
     *
     * Signing in and signing out both change which files are "yours", and neither is a page
     * load — so without the second trigger the explorer keeps showing the previous identity's
     * files, or nothing at all. `identity` is the *value* that matters; re-running on every
     * `user` object would refetch on an unrelated profile edit.
     */
    const identity = user?.email ?? null;
    useEffect(() => {
        if (!isAuthResolved) return;
        let cancelled = false;
        (async () => {
            try {
                await restoreOpenFiles();
            } finally {
                if (!cancelled) setIsRestoring(false);
            }
        })();
        return () => { cancelled = true; };
    }, [identity, isAuthResolved, restoreOpenFiles]);

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

    /**
     * Step one of an import: work out what the file would create, and show it.
     *
     * Nothing is created here and no workspace is opened, so cancelling the dialog leaves
     * exactly as much behind as never having picked the file.
     */
    const handleFileChosen = async (file: File) => {
        setIsUploading(true);
        try {
            const plan = await dbService.analyzeUpload(file);
            setPendingImport({ file, plan });
        } catch (err: unknown) {
            setNotice({
                isOpen: true,
                severity: 'error',
                title: 'That file could not be read',
                message: errorMessage(err) || `"${file.name}" could not be parsed as CSV or SQL.`,
            });
        } finally {
            setIsUploading(false);
        }
    };

    /** Step two: the user has seen the plan and corrected whatever the inference got wrong. */
    const handleFileUpload = async (file: File, typeOverrides: Record<string, string> = {}) => {
        setIsUploading(true);
        const newId = newWorkspaceId();
        // Bind the API client to the new workspace before uploading: the file must land
        // in its own database, not in whichever file happened to be open.
        setActiveWorkspace(newId);
        try {
            const report = await dbService.uploadFile(file, typeOverrides);
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

            // Record the name server-side so this file is still findable after a sign-out,
            // and from any other machine the same account signs in from.
            await dbService.setWorkspaceName(file.name);

            setWorkspaces(prev => [...prev, transformSchemaToWorkspace(
                tables, response.relationships, file.name, newId, true
            )]);
            setActiveWorkspaceId(newId);
            setPendingImport(null);

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

        // Also the first request this workspace ever sees, which is what claims it for the
        // current user — and what makes an empty file survive a sign-out.
        dbService.setWorkspaceName(fileName);

        setWorkspaces(prev => [...prev, {
            id: newId,
            name: fileName,
            nodes: [],
            edges: [],
            relationships: [],
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
                await dbService.setWorkspaceName('example-store.sql');
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
    const handleExportSql = async (dialect: SqlDialectId) => {
        if (!activeWorkspace) return;
        if (!user) return requireAccount('Exporting a file');
        let name = activeWorkspace.name || 'database_dump.sql';
        if (activeWorkspace.isImported) name = `modified_${name}`;
        if (!name.toLowerCase().endsWith('.sql')) name += '.sql';
        try {
            await dbService.downloadDatabaseSql(name, dialect);
        } catch (e) {
            if (isAuthRequired(e)) return requireAccount('Exporting a file');
            setNotice({ isOpen: true, severity: 'error', title: 'Export failed',
                message: 'The SQL file could not be downloaded.' });
        }
    };

    /**
     * A PNG never touches the backend — it is rendered straight out of the DOM — so unlike the
     * SQL export there is no 401 backstopping this. `ExportModal` already refuses to call it
     * signed out, but that guard living in one caller is exactly the shape of bug that let PNG,
     * Mermaid and DBML export without an account in the first place; checking again here means
     * a second caller added later cannot reopen it.
     */
    const handleExportImage = async () => {
        if (!activeWorkspace) return;
        if (!user) return requireAccount('Exporting a file');
        await downloadCanvasImage(activeWorkspace.nodes, activeWorkspace.name);
    };

    const handleExportRequest = () => {
        if (!activeWorkspace) {
            setNotice({
                isOpen: true,
                severity: 'warning',
                title: 'No file open',
                message: 'Open or create a file before exporting one.',
            });
            return;
        }
        setExportOpen(true);
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
     *
     * That last sentence was untrue for a while, and it is the reason `file_name` is stored
     * server-side: the list was rebuilt from localStorage, which this function clears, so
     * signing out destroyed the only record of a user's files. Nothing re-listed them either.
     * Both halves are fixed — the name lives in `workspace_owners`, and `restoreOpenFiles`
     * re-runs whenever the identity changes.
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
        <div className="h-[100dvh] w-full bg-surface text-ink-800 flex flex-col overflow-hidden">
            <Header
                onUpload={handleFileChosen}
                onNewFile={() => setNewFileModalOpen(true)}
                isUploading={isUploading}
                fileName={activeWorkspace?.name || null}
                onClear={handleClearRequest}
                hasData={!!activeWorkspace}
                onShowInfo={() => setInfoOpen(true)}
                onExport={handleExportRequest}
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
                    className={`lg:hidden absolute inset-0 z-30 bg-scrim/50 transition-opacity duration-300 motion-reduce:transition-none ${
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
                        <div className="flex-1 flex flex-col items-center justify-center bg-surface text-ink-400 gap-3">
                            <Loader2 size={28} className="animate-spin text-brand-500" />
                            <p className="text-sm text-ink-500">Restoring your files...</p>
                        </div>
                    ) : (
                        <div className="flex-1 flex flex-col items-center justify-center bg-surface text-ink-400 gap-4 px-6">
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
                                        className="px-4 py-2.5 bg-surface border border-ink-300 hover:bg-ink-50 text-ink-700 rounded-md text-sm font-semibold flex items-center justify-center gap-2 transition-colors"
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

            {/* Mounted only while open, so opening it *is* the reset - there is no stale plan
                or half-edited type mapping to clear. */}
            {pendingImport && (
                <ImportPreviewModal
                    isOpen
                    plan={pendingImport.plan}
                    isImporting={isUploading}
                    onConfirm={(typeOverrides) => handleFileUpload(pendingImport.file, typeOverrides)}
                    onClose={() => setPendingImport(null)}
                />
            )}

            {isExportOpen && activeWorkspace && (
                <ExportModal
                    isOpen
                    fileName={activeWorkspace.name}
                    tables={activeWorkspace.fileData.tables}
                    relationships={activeWorkspace.relationships}
                    hasAccount={!!user}
                    onExportSql={handleExportSql}
                    onExportImage={handleExportImage}
                    onNeedsAccount={() => requireAccount('Exporting a file')}
                    onClose={() => setExportOpen(false)}
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
