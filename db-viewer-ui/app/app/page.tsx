"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import dynamic from "next/dynamic";

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
import { CanvasGroup, ImportPlan, Relationship, SqlDialectId, TableInfo } from "@/types";
import type { NodeDecoration, Workspace } from "@/types/workspace";
import { useToast } from "@/hooks/useToast";
import { useUndoRedo } from "@/hooks/useUndoRedo";
import { useAssistantPanel } from "@/hooks/useAssistantPanel";
import { useNodeDragHistory } from "@/hooks/useNodeDragHistory";
import { groupNodes, transformRelationshipsToEdges } from "@/services/schemaGraph";
import { buildTableNodes, canvasMetaToState, type TableNodeHandlers } from "@/services/workspaceNodes";
import { autoLayout } from "@/services/autoLayout";
import { prepareImport, type PreparedImport } from "@/services/textImport";
import { forgetAllHistory, forgetHistory } from "@/services/queryHistory";
import { GHOST_MS, useTableGhosts } from "@/hooks/useTableGhosts";
import { useTableColours } from "@/hooks/useTableColours";
import { useDomainGroups } from "@/hooks/useDomainGroups";
import { EmptyEditorState } from "@/components/editor/EmptyEditorState";
import { TableListView } from "@/components/editor/TableListView";
import { useMediaQuery } from "@/hooks/useMediaQuery";
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
const ImportTextModal = dynamic(
    () => import('@/components/modal/ImportTextModal').then(m => m.ImportTextModal), { ssr: false });
const VersionsModal = dynamic(
    () => import('@/components/modal/VersionsModal').then(m => m.VersionsModal), { ssr: false });
const ProfileModal = dynamic(() => import('@/components/modal/ProfileModal').then(m => m.ProfileModal), { ssr: false });



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
    const [isImportTextOpen, setImportTextOpen] = useState(false);
    const [isVersionsOpen, setVersionsOpen] = useState(false);
    /**
     * Diagram or list, on a phone. The list is the default there: at 375px the fitted diagram
     * is legible only as a shape. Wider screens always get the diagram, so a window resized
     * past the breakpoint cannot be left on a list with no switch to leave it by.
     */
    const isPhone = useMediaQuery('(max-width: 639px)');
    const [phoneView, setPhoneView] = useState<'list' | 'diagram'>('list');
    const showTableList = isPhone && phoneView === 'list';
    const [notes, setNotes] = useState<TableNote[]>([]);
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

    /** What a confirmed table drop runs once it has gone through; set below, once both exist. */
    const afterDropRef = useRef<() => Promise<void>>(async () => {});
    const {
        ghosts, tableToDelete, requestTableDelete, cancelTableDelete, confirmTableDelete, handleUndoDelete,
    } = useTableGhosts(activeWorkspaceIdRef, activeWorkspaceRef, setNotice, afterDropRef);

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

    const handleColourChange = useTableColours(activeWorkspaceIdRef, setWorkspaces);

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

    /** The callbacks every table node carries. Read at call time, so each is defined by then. */
    const nodeHandlers = (): TableNodeHandlers => ({
        onRefresh: refreshActiveSchema,
        onEdit: setEditingTable,
        onDelete: requestTableDelete,
        onDownloadCsv: handleDownloadCsv,
        onNotesChanged: refreshNotes,
        onColourChange: handleColourChange,
    });

    // Deliberately dependency-free so the reference stays stable for the lifetime of the page
    // and the copy stored in every node's `data.onRefresh` is never stale.
    const refreshActiveSchema = useCallback(async () => {
        const workspaceId = activeWorkspaceIdRef.current;
        if (!workspaceId) return;
        try {
            const response = await dbService.getSchema();
            const tables = response.tables;
            const edges = transformRelationshipsToEdges(response.relationships, tables);

            setWorkspaces(prev => prev.map(w => {
                if (w.id !== workspaceId) return w;

                const nodes: Node[] = buildTableNodes(tables, response.relationships, nodeHandlers(), {
                    positionOf: name => w.nodes.find(n => n.id === name)?.position,
                    openNotesOf: name => w.nodes.find(n => n.id === name)?.data?.openNotes ?? 0,
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
        // All stable useCallbacks, so this array never actually changes - it is declared so the
        // dependency is explicit rather than silently captured. nodeHandlers() reads only these.
        // eslint-disable-next-line react-hooks/exhaustive-deps
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
    ): Workspace => ({
        id,
        name: fileName,
        isImported,
        // Restore the layout the user arranged; a table that did not exist when the session
        // was saved goes on the default grid.
        nodes: buildTableNodes(tables, relationships, nodeHandlers(), {
            positionOf: name => savedPositions[name],
        }),
        edges: transformRelationshipsToEdges(relationships, tables),
        relationships,
        fileData: {
            id,
            name: fileName,
            tables: tables.map(t => ({ name: t.name, columns: t.columns })),
        },
        decorations,
        groups,
    // nodeHandlers() reads only these, all stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [refreshActiveSchema, requestTableDelete, handleDownloadCsv, refreshNotes, handleColourChange]);

    useEffect(() => {
        afterDropRef.current = async () => { await refreshActiveSchema(); refreshNotes(); };
    }, [refreshActiveSchema, refreshNotes]);

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
            return canvasMetaToState(await dbService.getCanvasMeta());
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
    const handleFileChosen = async (chosen: File) => {
        setIsUploading(true);
        try {
            // A .dbml file is converted to SQL in the browser and then imported like one.
            let file = chosen;
            if (/\.dbml$/i.test(chosen.name)) {
                const prepared = prepareImport(chosen.name, await chosen.text(), 'dbml');
                file = prepared.file;
                announceConversionNotes(prepared.warnings);
            }
            const plan = await dbService.analyzeUpload(file);
            setPendingImport({ file, plan });
        } catch (err: unknown) {
            setNotice({
                isOpen: true,
                severity: 'error',
                title: 'That file could not be read',
                message: errorMessage(err) || (err instanceof Error ? err.message : '')
                    || `"${chosen.name}" could not be parsed as CSV, SQL or DBML.`,
            });
        } finally {
            setIsUploading(false);
        }
    };

    /** DBML that could not be carried across completely says what was left out. */
    const announceConversionNotes = (warnings: string[]) => {
        if (warnings.length === 0) return;
        setNotice({
            isOpen: true,
            severity: 'warning',
            title: 'Some of the DBML was left out',
            message: 'The rest was converted to SQL and is shown in the preview.',
            details: warnings,
        });
    };

    /** Pasted or fetched text, already turned into a file: on to the same preview. */
    const handleTextPrepared = (prepared: PreparedImport) => {
        announceConversionNotes(prepared.warnings);
        void handleFileChosen(prepared.file);
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
                // In parallel: neither depends on the other, and one after the other they were
                // most of the wait after the example itself had been created.
                const [schema] = await Promise.all([
                    dbService.getSchema(),
                    dbService.setWorkspaceName('example-store.sql'),
                ]);
                setWorkspaces(prev => [...prev, transformSchemaToWorkspace(
                    schema.tables, schema.relationships, 'example-store.sql', workspaceId!, false
                )]);
                // Changing the active file runs the notes effect, so no refreshNotes() here —
                // calling it as well fetched the same notes twice.
                setActiveWorkspaceId(workspaceId);
            } else {
                await refreshActiveSchema();
                refreshNotes();
            }
        } catch (err: unknown) {
            setNotice({
                isOpen: true, severity: 'error', title: 'Could not load the example',
                message: errorMessage(err) || 'The example schema could not be loaded.',
            });
        } finally {
            setLoadingExample(false);
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
        // The schema this conversation was about no longer exists, so neither should the
        // conversation. Every other file's is untouched.
        if (closingId) {
            chatStore.forget(closingId);
            forgetHistory(closingId);
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
        forgetAllHistory();
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

    const { handleCreateGroup, handleRenameGroup, handleGroupColour, handleUngroup } =
        useDomainGroups(activeWorkspaceIdRef, activeWorkspaceRef, setWorkspaces, showToast);

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

    const { handleNodeDragStart, handleNodeDrag, handleNodeDragStop, placeNodes } =
        useNodeDragHistory(activeWorkspaceIdRef, activeWorkspaceRef, setWorkspaces);

    /**
     * Arranges the tables by their relationships, as one undoable step.
     *
     * Sizes come from React Flow's own measurements where it has them, so a forty-column table
     * gets the room it actually takes; the estimate is only for a node not yet drawn.
     */
    const handleAutoLayout = useCallback(() => {
        const workspace = activeWorkspaceRef.current;
        if (!workspace || workspace.nodes.length === 0) return;
        const byId = new Map(workspace.nodes.map(n => [n.id, n]));
        const after = autoLayout(workspace.nodes.map(n => n.id), workspace.relationships, id => {
            const node = byId.get(id);
            const columns = (node?.data?.columns as unknown[] | undefined)?.length ?? 4;
            return { width: node?.width ?? 265, height: node?.height ?? 56 + columns * 22 };
        });
        const before = Object.fromEntries(workspace.nodes.map(n => [n.id, { ...n.position }]));
        placeNodes(after);
        history.push({
            label: 'Tidy layout',
            undo: async () => placeNodes(before),
            redo: async () => placeNodes(after),
        });
        showToast({ message: 'Arranged the tables by their relationships', tone: 'ok' });
    }, [placeNodes, showToast]);

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
                onImportText={() => setImportTextOpen(true)}
                onVersions={() => setVersionsOpen(true)}
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
                    {activeWorkspace && isPhone && (
                        <div role="tablist" aria-label="How to show the file"
                             className="flex shrink-0 gap-1 border-b border-line bg-surface p-1.5">
                            {(['list', 'diagram'] as const).map(mode => (
                                <button
                                    key={mode}
                                    type="button"
                                    role="tab"
                                    aria-selected={phoneView === mode}
                                    onClick={() => setPhoneView(mode)}
                                    className={`flex-1 rounded-md py-1.5 text-xs font-semibold transition-colors ${
                                        phoneView === mode ? 'bg-brand-50 text-brand-700' : 'text-ink-500'}`}
                                >
                                    {mode === 'list' ? 'Tables' : 'Diagram'}
                                </button>
                            ))}
                        </div>
                    )}
                    {activeWorkspace && showTableList ? (
                        <TableListView
                            tables={activeWorkspace.nodes.map(n => ({
                                name: n.id, columns: n.data.columns, isView: n.data.isView,
                            }))}
                            relationships={activeWorkspace.relationships}
                            onEditTable={setEditingTable}
                        />
                    ) : activeWorkspace ? (
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
                            onAutoLayout={handleAutoLayout}
                            toast={<ActionToast toast={toast} onDismiss={dismissToast} />}
                            chat={<ChatLauncher isOpen={isChatOpen} onToggle={toggleChat}
                                                hasConversation={hasConversation} />}
                        />
                    ) : (
                        <EmptyEditorState
                            isRestoring={isRestoring}
                            isLoadingExample={isLoadingExample}
                            onLoadExample={handleLoadExample}
                            onNewFile={() => setNewFileModalOpen(true)}
                        />
                    )}
                    {/* A sibling of the canvas, never a child of it: the visualiser should not
                        own a text editor, and a scrolling editor inside a zoomable transformed
                        viewport is unusable. Only with a file open — there is nothing to run
                        against otherwise. */}
                    {activeWorkspace && (
                        <SqlScratchpad
                            // Per file as well as per seed: each file has its own history.
                            key={`${activeWorkspace.id}:${scratchpadSeed?.n ?? 'blank'}`}
                            workspaceId={activeWorkspace.id}
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
                onClose={cancelTableDelete}
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

            {isVersionsOpen && activeWorkspace && (
                <VersionsModal
                    isOpen
                    onClose={() => setVersionsOpen(false)}
                    fileName={activeWorkspace.name}
                    current={{ tables: activeWorkspace.fileData.tables, relationships: activeWorkspace.relationships }}
                    otherFiles={workspaces.filter(w => w.id !== activeWorkspace.id).map(w => ({ id: w.id, name: w.name }))}
                    hasAccount={!!user}
                    onNeedsAccount={() => requireAccount('Saving versions of a file')}
                    onRestored={async () => {
                        // Every undo entry before this describes a file that no longer exists.
                        await handleScratchpadRanDdl();
                        refreshNotes();
                    }}
                    onOpenInScratchpad={sendToScratchpad}
                />
            )}

            {isImportTextOpen && (
                <ImportTextModal
                    isOpen
                    onClose={() => setImportTextOpen(false)}
                    onPrepared={handleTextPrepared}
                    defaultName={`Untitled-${workspaces.length + 1}.sql`}
                />
            )}

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
