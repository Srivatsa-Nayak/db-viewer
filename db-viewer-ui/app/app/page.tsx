"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import dynamic from "next/dynamic";
import { FileCode, Plus, Loader2, Sparkles } from 'lucide-react';

import { Header } from "@/components/header/Header";
import { Visualizer, RelationshipDraft } from "@/components/canvas/Visualizer";
import { FileExplorer } from "@/components/editor/FileExplorer";
import { SqlScratchpad } from "@/components/editor/SqlScratchpad";
import { SchemaChat } from "@/components/chat/SchemaChat";
import { chatStore } from "@/services/chatStore";
import { ChatLauncher } from "@/components/chat/ChatLauncher";
import { Notice } from '@/components/modal/NoticeModal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ActionToast } from '@/components/ui/ActionToast';
import { Node, applyNodeChanges, NodeChange } from "reactflow";
import {
    dbService, setActiveWorkspace, authService, isAuthRequired, isForeignWorkspace,
    AuthUser, TableNote, WorkspaceSummary,
} from "@/services/api";
import { clearSession, loadSession, saveSession } from "@/services/sessionStorage";
import { history } from "@/services/history";
import { newWorkspaceId } from "@/services/workspaceId";
import { downloadCanvasImage } from "@/services/exportImage";
import { CanvasGroup, ImportPlan, Relationship, SqlDialectId, TableInfo, TagColour } from "@/types";
import type { NodeDecoration, Workspace } from "@/types/workspace";
import { useToast } from "@/hooks/useToast";
import { useUndoRedo } from "@/hooks/useUndoRedo";
import { useAssistantPanel } from "@/hooks/useAssistantPanel";
import { useNodeDragHistory } from "@/hooks/useNodeDragHistory";
import {
    defaultPosition, groupNodes, junctionTables,
    keyColumnsByTable, transformRelationshipsToEdges,
} from "@/services/schemaGraph";
import { errorMessage } from "@/services/errors";

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
 * How long a dropped table lingers as a ghost before the delete is really sent.
 *
 * Long enough to notice the mistake and reach the button, short enough that the canvas is not
 * lying about what the database contains for any length of time. The same number drives the
 * drain bar on the node, passed down rather than duplicated in CSS.
 */
const GHOST_MS = 7000;

export default function Home() {
    const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
    const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
    const [isExplorerOpen, setIsExplorerOpen] = useState(false);
    /**
     * The assistant panel, which is a column of the shell rather than a popover — so its open
     * state belongs here with the explorer's, not inside the component.
     */
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
    const [isScratchpadOpen, setScratchpadOpen] = useState(false);
    const [notes, setNotes] = useState<TableNote[]>([]);
    const [tableToDelete, setTableToDelete] = useState<string | null>(null);
    /**
     * Tables whose delete has been agreed to but not yet sent.
     *
     * The node stays on the canvas, greyed, with an Undo button, and `DELETE /table/{name}`
     * only goes out when the timer expires. Nothing is snapshotted and nothing is restored,
     * because until then nothing has happened — which also means closing the tab, navigating
     * away or losing the network all fail in the direction of *not* dropping the table.
     *
     * Keyed by table name and carrying the workspace it belongs to, because the delete is
     * workspace-scoped through a request header: a timer that fired after the user switched
     * files would otherwise drop a same-named table in the wrong database.
     */
    const [ghosts, setGhosts] = useState<{ table: string; workspaceId: string }[]>([]);
    /**
     * The pending `setTimeout` per ghosted table.
     *
     * A ref rather than state: nothing renders from it, and storing timer ids in state would
     * re-render the canvas twice for every delete.
     */
    const ghostTimers = useRef<Map<string, number>>(new Map());

    /*
     * Leaving the page cancels every pending drop.
     *
     * This is the fail-safe direction and it is deliberate. A user who closes the tab three
     * seconds after pressing Delete has not confirmed anything a second time, and a table that
     * is still there can be deleted again — a table that is gone cannot be brought back.
     */
    useEffect(() => {
        const timers = ghostTimers.current;
        return () => {
            timers.forEach(id => window.clearTimeout(id));
            timers.clear();
        };
    }, []);

    /** Cancels the countdown. Nothing to restore — the drop was never sent. */
    const handleUndoDelete = useCallback((tableName: string) => {
        const timer = ghostTimers.current.get(tableName);
        if (timer !== undefined) {
            window.clearTimeout(timer);
            ghostTimers.current.delete(tableName);
        }
        setGhosts(prev => prev.filter(g => g.table !== tableName));
    }, []);

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

    /**
     * The active workspace, reachable from a stable callback.
     *
     * The group handlers need to read the current groups but must not be rebuilt whenever one
     * changes — they are passed into node `data`, and a new identity there re-renders the canvas.
     */
    const activeWorkspaceRef = useRef<Workspace | null>(null);

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
        const decorations = activeWorkspace.decorations;
        /*
         * Ghosting is *not* a decoration.
         *
         * Decorations are what the user has said about a table and they are written back to
         * `__canvas_meta`; "this is being deleted" is neither — it lasts seven seconds and must
         * never reach the server. Keeping it in its own state is what stops a colour change on
         * a ghosted table persisting the flag by accident.
         */
        const ghosted = new Set(ghosts
            .filter(g => g.workspaceId === activeWorkspace.id)
            .map(g => g.table));

        return activeWorkspace.nodes.map(n => {
            const openNotes = openNoteCounts[n.id] ?? 0;
            const decoration = decorations[n.id];
            // The colour rides on `className`, so `data` identity survives a drag; the tag is
            // text the node renders, so it has to be in `data`.
            const tagClass = decoration?.colour ? `tag-${decoration.colour}` : undefined;
            const isGhost = ghosted.has(n.id);
            // Appended, exactly as the search focus is: a table can be coloured *and* on its
            // way out, and assigning here would drop whichever was written second.
            const className = [tagClass, isGhost ? 'node-ghost' : undefined]
                .filter(Boolean).join(' ') || undefined;
            const tag = decoration?.tag;

            const colour = decoration?.colour;

            const dataUnchanged = openNotes === n.data.openNotes
                && tag === n.data.tag
                && colour === n.data.colour
                && isGhost === !!n.data.ghost;
            if (dataUnchanged && className === n.className) return n;
            return {
                ...n,
                className,
                data: dataUnchanged ? n.data : {
                    ...n.data,
                    openNotes, tag, colour,
                    ghost: isGhost || undefined,
                    ghostMs: isGhost ? GHOST_MS : undefined,
                    onUndoDelete: handleUndoDelete,
                },
            };
        });
    }, [activeWorkspace, openNoteCounts, ghosts, handleUndoDelete]);

    const requireAccount = useCallback((reason: string) => {
        setAuthReason(reason);
        setAuthOpen(true);
    }, []);

    // Point every subsequent API call at the file the user is looking at.
    useEffect(() => {
        activeWorkspaceIdRef.current = activeWorkspaceId;
        setActiveWorkspace(activeWorkspaceId);
    }, [activeWorkspaceId]);

    // Written in an effect rather than during render, which `react-hooks/refs` forbids.
    useEffect(() => { activeWorkspaceRef.current = activeWorkspace ?? null; }, [activeWorkspace]);

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

    /**
     * Sets or clears a table's colour, optimistically.
     *
     * Optimistic because the alternative is a visible lag on what reads as a pure UI gesture, and
     * the cost of being wrong is one wrong colour until the next refresh — not lost work. On
     * failure the previous decoration goes back, so the canvas never disagrees with the server
     * for longer than the round trip.
     */
    const handleColourChange = useCallback(async (
        tableName: string, colour: TagColour | undefined, record = true,
    ) => {
        const workspaceId = activeWorkspaceIdRef.current;
        if (!workspaceId) return;

        let previous: NodeDecoration | undefined;
        setWorkspaces(prev => prev.map(w => {
            if (w.id !== workspaceId) return w;
            previous = w.decorations[tableName];
            const next = { ...w.decorations };
            const decoration = { ...next[tableName], colour };
            if (!decoration.colour && !decoration.tag) delete next[tableName];
            else next[tableName] = decoration;
            return { ...w, decorations: next };
        }));

        try {
            const decoration = { ...previous, colour };
            if (!decoration.colour && !decoration.tag) {
                await dbService.deleteCanvasMeta('table', tableName);
            } else {
                await dbService.setCanvasMeta('table', tableName, decoration);
            }
            // `record` is false when the call *is* an undo, so reversing a colour does not push
            // a fresh entry and leave Ctrl+Z toggling between two colours for ever.
            if (record) {
                const before = previous?.colour;
                history.push({
                    label: colour ? `Colour ${tableName}` : `Clear colour on ${tableName}`,
                    undo: async () => { await handleColourChangeRef.current(tableName, before, false); },
                    redo: async () => { await handleColourChangeRef.current(tableName, colour, false); },
                });
            }
        } catch (e) {
            console.error('Could not save the table colour', e);
            setWorkspaces(prev => prev.map(w => {
                if (w.id !== workspaceId) return w;
                const next = { ...w.decorations };
                if (previous) next[tableName] = previous;
                else delete next[tableName];
                return { ...w, decorations: next };
            }));
        }
    }, []);

    /**
     * The handler reaching itself, for the undo it registers.
     *
     * A `useCallback` cannot close over itself, and giving it a dependency on itself is circular.
     * The ref is written in an effect, which is the sanctioned place — writing one during render
     * is what `react-hooks/refs` forbids.
     */
    const handleColourChangeRef = useRef(handleColourChange);
    useEffect(() => { handleColourChangeRef.current = handleColourChange; }, [handleColourChange]);

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
            const edges = transformRelationshipsToEdges(response.relationships, tables);
            const keys = keyColumnsByTable(response.relationships);
            const junctions = junctionTables(tables, response.relationships);

            setWorkspaces(prev => prev.map(w => {
                if (w.id !== workspaceId) return w;

                const nodes: Node[] = tables.map((tbl, index) => {
                    const existing = w.nodes.find(n => n.id === tbl.name);
                    return {
                        id: tbl.name,
                        type: "tableNode",
                        position: existing ? existing.position : defaultPosition(index, tables.length),
                        data: {
                            label: tbl.name,
                            columns: tbl.columns,
                            foreignKeyColumns: keys.foreignKeys[tbl.name] ?? [],
                            referencedColumns: keys.referenced[tbl.name] ?? [],
                            references: keys.references[tbl.name],
                            isJunction: junctions.has(tbl.name),
                            isView: tbl.isView,
                            openNotes: existing?.data?.openNotes ?? 0,
                            onRefresh: refreshActiveSchema,
                            onEdit: setEditingTable,
                            onDelete: requestTableDelete,
                            onDownloadCsv: handleDownloadCsv,
                            onNotesChanged: refreshNotes,
                            onColourChange: handleColourChange,
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
    }, [handleDownloadCsv, requestTableDelete, refreshNotes, closeForeignWorkspace, handleColourChange]);

    const transformSchemaToWorkspace = useCallback((
        tables: TableInfo[],
        relationships: Relationship[],
        fileName: string,
        id: string,
        isImported: boolean,
        savedPositions: Record<string, { x: number; y: number }> = {},
        decorations: Record<string, NodeDecoration> = {},
        groups: CanvasGroup[] = []
    ): Workspace => {
        const keys = keyColumnsByTable(relationships);
        const junctions = junctionTables(tables, relationships);
        return {
        id,
        name: fileName,
        isImported,
        nodes: tables.map((tbl, index) => ({
            id: tbl.name,
            type: "tableNode",
            // Restore the layout the user arranged; fall back to the default grid for a table
            // that did not exist when the session was saved.
            position: savedPositions[tbl.name] ?? defaultPosition(index, tables.length),
            data: {
                label: tbl.name,
                columns: tbl.columns,
                foreignKeyColumns: keys.foreignKeys[tbl.name] ?? [],
                referencedColumns: keys.referenced[tbl.name] ?? [],
                references: keys.references[tbl.name],
                isJunction: junctions.has(tbl.name),
                isView: tbl.isView,
                openNotes: 0,
                onRefresh: refreshActiveSchema,
                onEdit: setEditingTable,
                onDelete: requestTableDelete,
                onDownloadCsv: handleDownloadCsv,
                onNotesChanged: refreshNotes,
                onColourChange: handleColourChange,
            },
        })),
        edges: transformRelationshipsToEdges(relationships, tables),
        relationships,
        fileData: {
            id,
            name: fileName,
            tables: tables.map(t => ({ name: t.name, columns: t.columns })),
        },
        decorations,
        groups,
        };
    }, [refreshActiveSchema, requestTableDelete, handleDownloadCsv, refreshNotes, handleColourChange]);

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
    /**
     * Reads this workspace's annotations back into the shape the canvas wants.
     *
     * Failure is deliberately soft: a file that opens without its colours is a worse-looking
     * canvas, while a file that refuses to open because a colour could not be read is lost work.
     */
    const loadCanvasMeta = useCallback(async (): Promise<{
        decorations: Record<string, NodeDecoration>;
        groups: CanvasGroup[];
    }> => {
        try {
            const meta = await dbService.getCanvasMeta();
            const decorations = Object.fromEntries(meta
                .filter(m => m.kind === 'table')
                .map(m => [m.ref, {
                    colour: m.payload.colour as TagColour | undefined,
                    tag: typeof m.payload.tag === 'string' ? m.payload.tag : undefined,
                }]));
            const groups = meta
                .filter(m => m.kind === 'group')
                .map(m => ({
                    id: m.ref,
                    name: typeof m.payload.name === 'string' ? m.payload.name : 'Group',
                    colour: m.payload.colour as TagColour | undefined,
                    tables: Array.isArray(m.payload.tables) ? m.payload.tables as string[] : [],
                }));
            return { decorations, groups };
        } catch (e) {
            console.error('Could not read canvas annotations', e);
            return { decorations: {}, groups: [] };
        }
    }, []);

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
                const meta = await loadCanvasMeta();
                restored.push(transformSchemaToWorkspace(
                    schema.tables, schema.relationships,
                    name, entry.id, stored?.isImported ?? false, stored?.positions ?? {},
                    meta.decorations, meta.groups
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
    }, [transformSchemaToWorkspace, loadCanvasMeta]);

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
            decorations: {},
            groups: [],
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

    /**
     * The delete, finally sent.
     *
     * Re-checks which file is open first. The workspace id travels as a request header, so a
     * timer that outlived a file switch would drop a table of that name in whichever database
     * is open *now*. Abandoning is the right answer: the user has moved on, and not deleting
     * is the recoverable half of the two mistakes.
     */
    const commitTableDelete = useCallback(async (tableName: string, workspaceId: string) => {
        if (activeWorkspaceIdRef.current !== workspaceId) {
            setGhosts(prev => prev.filter(g => g.table !== tableName));
            return;
        }
        try {
            await dbService.dropTable(tableName);
            setGhosts(prev => prev.filter(g => g.table !== tableName));
            await refreshActiveSchema();
            refreshNotes();
        } catch (err: unknown) {
            const response = err && typeof err === 'object' && 'response' in err
                ? (err as { response?: { status?: number; data?: { error?: string; referencedBy?: string[] } } }).response
                : undefined;
            // The node comes back to life rather than staying a ghost over a table that is
            // still there — the canvas must not go on claiming something the database denies.
            setGhosts(prev => prev.filter(g => g.table !== tableName));
            setNotice({
                isOpen: true,
                // 409 is the expected, meaningful case: another table depends on this one.
                severity: response?.status === 409 ? 'warning' : 'error',
                title: response?.status === 409 ? 'Table is still referenced' : 'Could not delete the table',
                message: response?.data?.error || `${tableName} could not be deleted.`,
                details: response?.data?.referencedBy?.map(t => `${t} has a foreign key pointing at this table`),
            });
        }
    }, [refreshActiveSchema, refreshNotes]);

    /**
     * Confirming a delete starts a countdown; it does not call the backend.
     *
     * The alternative — drop it now and offer to put it back — means snapshotting every row,
     * every index and every constraint, then replaying them in an order that satisfies the
     * foreign keys. Deferring needs none of that, and it is the version that fails safely: a
     * closed tab, a dead network or a reloaded page all leave the table exactly where it was.
     */
    const confirmTableDelete = () => {
        const tableName = tableToDelete;
        const workspaceId = activeWorkspaceIdRef.current;
        if (!tableName || !workspaceId) return;
        setTableToDelete(null);

        /*
         * Refused here rather than seven seconds from here.
         *
         * The backend is still the authority and answers 409 for this, but it would answer it
         * *after* the countdown — so the user would watch a table fade out and then be told it
         * was never going anywhere. Everything needed to know the answer is already on screen.
         */
        const referencedBy = Array.from(new Set(
            (activeWorkspaceRef.current?.relationships ?? [])
                .filter(rel => rel.targetTable === tableName && rel.sourceTable !== tableName)
                .map(rel => rel.sourceTable)
        ));
        if (referencedBy.length > 0) {
            setNotice({
                isOpen: true,
                severity: 'warning',
                title: 'Table is still referenced',
                message: `${tableName} cannot be deleted while other tables point at it. `
                    + 'Remove those foreign keys first, or delete those tables.',
                details: referencedBy.map(t => `${t} has a foreign key pointing at this table`),
            });
            return;
        }

        setGhosts(prev => prev.some(g => g.table === tableName && g.workspaceId === workspaceId)
            ? prev
            : [...prev, { table: tableName, workspaceId }]);

        const timer = window.setTimeout(() => {
            ghostTimers.current.delete(tableName);
            void commitTableDelete(tableName, workspaceId);
        }, GHOST_MS);
        ghostTimers.current.set(tableName, timer);
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
        // The schema this conversation was about no longer exists, so neither should the
        // conversation. Every other file's is untouched.
        if (closingId) chatStore.forget(closingId);

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
        // The whole viewport is captured, so a group box is in the picture either way — but
        // the image is *sized* from these, and tables alone would crop the boxes around them.
        await downloadCanvasImage(canvasNodes, activeWorkspace.name);
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
        // The assistant conversations go with the files they were about. Same reasoning as the
        // open-file list: those workspaces are no longer this caller's, and a second user on a
        // shared browser must not find the first one's talk waiting for them.
        chatStore.forgetAll();
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

    /* ── Undo / redo ─────────────────────────────────────────────────────── */

    const { toast, showToast, dismissToast } = useToast();
    const {
        historyState, requestUndo, requestRedo, pendingLossyUndo, confirmLossyUndo, cancelLossyUndo,
    } = useUndoRedo(activeWorkspaceId, showToast);

    /**
     * Creates the relationship someone just drew on the canvas.
     *
     * Not optimistic, unlike the colour change: this writes DDL and can legitimately be refused —
     * a unique-less target, mismatched types, rows that already break the key — and an edge that
     * appeared and then vanished would be a worse account of what happened than one that only
     * appears once it is real. The refusal carries the reason, which is the useful part.
     */
    const handleCreateRelationship = useCallback(async (link: RelationshipDraft) => {
        const params = {
            tableName: link.childTable,
            columnName: link.childColumn,
            refTable: link.parentTable,
            refColumn: link.parentColumn,
        };
        try {
            await dbService.addForeignKey(params);
            await refreshActiveSchema();
            showToast({
                message: `Linked ${link.childTable}.${link.childColumn} to ${link.parentTable}.${link.parentColumn}`,
                tone: 'ok',
            });
            history.push({
                label: `Link ${link.childTable}.${link.childColumn} to ${link.parentTable}`,
                undo: async () => { await dbService.dropForeignKey(params); await refreshActiveSchema(); },
                redo: async () => { await dbService.addForeignKey(params); await refreshActiveSchema(); },
            });
        } catch (e) {
            setNotice({
                isOpen: true,
                severity: 'error',
                title: 'That relationship was refused',
                message: errorMessage(e)
                    || `${link.childTable}.${link.childColumn} could not be linked to ${link.parentTable}.${link.parentColumn}.`,
            });
        }
    }, [refreshActiveSchema, showToast]);

    /**
     * Called after the scratchpad runs something that may have changed the schema.
     *
     * Refreshes the canvas, and then closes the history behind a barrier. Every entry beneath it
     * is a guess from here on: an entry that wants to drop a column cannot know whether the
     * column is still there, still that type, or now holds data somebody cares about. Refusing to
     * cross the barrier is the honest answer; silently applying a stale inverse is not.
     */
    const handleScratchpadRanDdl = useCallback(async () => {
        await refreshActiveSchema();
        history.pushBarrier(
            'Undo stops here: SQL you ran by hand may have changed what the earlier steps assumed.');
    }, [refreshActiveSchema]);


    /* ── Domain groups ───────────────────────────────────────────────────── */

    /**
     * Writes a group, or removes it when `group` is null, and keeps the canvas in step.
     *
     * One function for all four operations — create, rename, recolour, ungroup — because they are
     * the same write with a different payload, and because that makes each one's inverse another
     * call to this with the previous value. `record: false` is how an undo avoids pushing an
     * entry of its own and leaving Ctrl+Z toggling for ever.
     */
    const writeGroup = useCallback(async (
        id: string, group: CanvasGroup | null, label: string, record = true,
    ) => {
        const workspaceId = activeWorkspaceIdRef.current;
        if (!workspaceId) return;

        let previous: CanvasGroup | undefined;
        setWorkspaces(prev => prev.map(w => {
            if (w.id !== workspaceId) return w;
            previous = w.groups.find(g => g.id === id);
            const others = w.groups.filter(g => g.id !== id);
            return { ...w, groups: group ? [...others, group] : others };
        }));

        try {
            if (group) await dbService.setCanvasMeta('group', id, group);
            else await dbService.deleteCanvasMeta('group', id);

            if (record) {
                const before = previous;
                history.push({
                    label,
                    undo: async () => { await writeGroupRef.current(id, before ?? null, label, false); },
                    redo: async () => { await writeGroupRef.current(id, group, label, false); },
                });
            }
        } catch (e) {
            console.error('Could not save the group', e);
            setWorkspaces(prev => prev.map(w => {
                if (w.id !== workspaceId) return w;
                const others = w.groups.filter(g => g.id !== id);
                return { ...w, groups: previous ? [...others, previous] : others };
            }));
        }
    }, []);

    /** As with `handleColourChange`: a useCallback cannot close over itself. */
    const writeGroupRef = useRef(writeGroup);
    useEffect(() => { writeGroupRef.current = writeGroup; }, [writeGroup]);

    const handleCreateGroup = useCallback((tables: string[]) => {
        // Pressing the toolbar button with nothing selected is how most people will first meet
        // this, so it answers rather than doing nothing: the gesture that selects tables is
        // invisible, and a button that silently ignores you teaches nothing.
        if (tables.length < 2) {
            showToast({
                message: 'Select two or more tables first — hold Shift and drag a box around them, '
                    + 'or Ctrl-click each one.',
                tone: 'error',
            });
            return;
        }
        // Letters, digits and underscores only: the backend validates the reference as an
        // identifier and would rewrite a hyphen, leaving the two sides naming different groups.
        const id = `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        const existing = activeWorkspaceRef.current?.groups.length ?? 0;
        void writeGroup(id, { id, name: `Group ${existing + 1}`, tables }, `Group ${tables.length} tables`);
        showToast({ message: `Grouped ${tables.length} tables`, tone: 'ok' });
    }, [writeGroup, showToast]);

    const handleRenameGroup = useCallback((id: string, name: string) => {
        const group = activeWorkspaceRef.current?.groups.find(g => g.id === id);
        if (!group) return;
        void writeGroup(id, { ...group, name }, `Rename group to ${name}`);
    }, [writeGroup]);

    const handleGroupColour = useCallback((id: string, colour: TagColour | undefined) => {
        const group = activeWorkspaceRef.current?.groups.find(g => g.id === id);
        if (!group) return;
        void writeGroup(id, { ...group, colour }, `Colour group ${group.name}`);
    }, [writeGroup]);

    const handleUngroup = useCallback((id: string) => {
        const group = activeWorkspaceRef.current?.groups.find(g => g.id === id);
        if (!group) return;
        void writeGroup(id, null, `Ungroup ${group.name}`);
        showToast({ message: `Removed the ${group.name} box. The tables are untouched.`, tone: 'ok' });
    }, [writeGroup, showToast]);

    /**
     * Everything the canvas draws: the tables, and the boxes derived from wherever they are.
     *
     * Declared after the group handlers on purpose — it calls them, and a `useMemo` body runs
     * during render, so referencing a `const` defined further down would be a temporal dead zone
     * error rather than a hoisting convenience.
     *
     * Groups come first in the array as well as carrying `zIndex: -1`: React Flow honours both,
     * and the order decides paint order for anything that lands at the same z.
     */
    const canvasNodes = useMemo(() => {
        if (!activeWorkspace || activeWorkspace.groups.length === 0) return nodesWithNotes;
        return [
            ...groupNodes(activeWorkspace.groups, nodesWithNotes, {
                onRename: handleRenameGroup,
                onColour: handleGroupColour,
                onUngroup: handleUngroup,
            }),
            ...nodesWithNotes,
        ];
    }, [activeWorkspace, nodesWithNotes, handleRenameGroup, handleGroupColour, handleUngroup]);

    const { handleNodeDragStart, handleNodeDrag, handleNodeDragStop } =
        useNodeDragHistory(activeWorkspaceIdRef, activeWorkspaceRef, setWorkspaces);

    const closeExplorer = useCallback(() => setIsExplorerOpen(false), []);
    const openScratchpad = useCallback(() => setScratchpadOpen(true), []);
    const {
        isChatOpen, closeChat, toggleChat, hasConversation, scratchpadSeed, sendToScratchpad,
        chatConfigKey, noteProfileClosed,
    } = useAssistantPanel({
        activeWorkspaceId, activeWorkspaceIdRef, userEmail: user?.email ?? null,
        closeExplorer, openScratchpad,
    });

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
                {/* Scrim for whichever drawer is open. Only below lg, where the explorer and the
                    assistant overlay the canvas instead of flanking it. Always mounted and
                    animated by opacity, so it fades out with the drawer's slide rather than
                    blinking away the instant the state flips. One element for both panels: they
                    are mutually exclusive at this width, and a second scrim would only ever
                    stack on the first. */}
                <div
                    className={`lg:hidden absolute inset-0 z-30 bg-scrim/50 transition-opacity duration-300 motion-reduce:transition-none ${
                        isExplorerOpen || isChatOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
                    }`}
                    onClick={() => { setIsExplorerOpen(false); closeChat(); }}
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
                            nodes={canvasNodes}
                            edges={activeWorkspace.edges}
                            onNodesChange={onNodesChange}
                            onNodeDragStart={handleNodeDragStart}
                            onNodeDrag={handleNodeDrag}
                            onNodeDragStop={handleNodeDragStop}
                            onRefreshRequest={refreshActiveSchema}
                            history={historyState}
                            onUndo={requestUndo}
                            onRedo={requestRedo}
                            onCreateRelationship={handleCreateRelationship}
                            onCreateGroup={handleCreateGroup}
                            toast={<ActionToast toast={toast} onDismiss={dismissToast} />}
                            chat={<ChatLauncher isOpen={isChatOpen} onToggle={toggleChat}
                                                hasConversation={hasConversation} />}
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
                    {/* A sibling of the canvas, never a child of it: the visualiser should not
                        own a text editor, and a scrolling editor inside a zoomable transformed
                        viewport is unusable. Only with a file open — there is nothing to run
                        against otherwise. */}
                    {activeWorkspace && (
                        <SqlScratchpad
                            key={scratchpadSeed?.n ?? 'blank'}
                            initialSql={scratchpadSeed?.sql}
                            isOpen={isScratchpadOpen}
                            onToggle={() => setScratchpadOpen(v => !v)}
                            tableNames={activeWorkspace.fileData.tables.map(t => t.name)}
                            hasAccount={!!user}
                            onNeedsAccount={() => requireAccount('Running SQL')}
                            onSchemaChanged={handleScratchpadRanDdl}
                        />
                    )}
                </main>

                {/* The far side of the canvas, mirroring the explorer. A column from `lg` up and
                    an overlay drawer below, so opening it narrows the diagram rather than
                    covering it — the two are meant to be read together. Only with a file open:
                    there is nothing to ask about otherwise. */}
                {activeWorkspace && (
                    <SchemaChat
                        isOpen={isChatOpen}
                        onClose={closeChat}
                        workspaceKey={activeWorkspace.id}
                        tableNames={activeWorkspace.fileData.tables.map(t => t.name)}
                        hasAccount={!!user}
                        onNeedsAccount={() => requireAccount('Asking the assistant')}
                        onSendToScratchpad={sendToScratchpad}
                        onManageKey={() => (user ? setProfileOpen(true)
                            : requireAccount('Adding your own API key'))}
                        configKey={chatConfigKey}
                    />
                )}
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

            {/* Undo that cannot put everything back asks first. Retyping VARCHAR to INT drops
                whatever did not parse, and retyping back leaves nulls where the text was —
                reversing the change is not the same as restoring the data. */}
            <ConfirmDialog
                isOpen={pendingLossyUndo !== null}
                title="Undo this change?"
                message={
                    <>
                        Undoing <span className="font-mono text-ink-900">{pendingLossyUndo}</span>{' '}
                        restores the column&apos;s previous type, but not any values that were lost
                        when the type changed.
                    </>
                }
                detail="Changing a column's type discards anything that could not be converted. Undo puts the type back; it cannot put the data back."
                confirmLabel="Undo anyway"
                tone="danger"
                onConfirm={confirmLossyUndo}
                onClose={cancelLossyUndo}
            />

            <ConfirmDialog
                isOpen={tableToDelete !== null}
                title="Delete table?"
                message={
                    <>
                        <span className="font-mono text-ink-900">{tableToDelete}</span> and all of
                        its rows will be permanently removed.
                    </>
                }
                detail="The table stays on the canvas for a few seconds with an Undo button before the delete is sent. If another table's foreign key points at it, the delete is refused instead of leaving broken references behind."
                confirmLabel="Delete table"
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
                    onClose={() => { setProfileOpen(false); noteProfileClosed(); }}
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
