"use client";

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import ReactFlow, {
    Background,
    Controls,
    MiniMap,
    ReactFlowInstance,
    Panel,
    Node,
    Edge,
    OnNodesChange,
    BackgroundVariant,
    Viewport,
    MarkerType,
    Connection,
} from 'reactflow';
import "reactflow/dist/style.css";
import { ZoomIn, Info, Plus, Search, Map as MapIcon, Spline, Undo2, Redo2, Boxes } from "lucide-react";
import type { HistorySnapshot } from "@/services/history";
import type { ColumnInfo } from "@/types";
import TableNode from "@/components/tables/TableNode";
import GroupBox from "@/components/canvas/GroupBox";
import { OrthogonalEdge } from "@/components/canvas/OrthogonalEdge";
import { CanvasSearch, SearchHit } from "@/components/canvas/CanvasSearch";

const CreateTableModal = dynamic(
    () => import('@/components/modal/CreateTableModal').then(m => m.CreateTableModal), { ssr: false });
const NewTableHelpModal = dynamic(
    () => import('@/components/modal/NewTableHelpModal').then(m => m.NewTableHelpModal), { ssr: false });

// Declared at module scope: React Flow warns (and rebuilds its internal node registry) when
// either of these is a new object on every render.
/**
 * `domainGroup`, not `group`: React Flow ships a **built-in node type called `group`** with
 * its own `.react-flow__node-group` styling — a grey rounded box with a dark border. A custom
 * type of the same name inherits it, so every domain box was drawn twice, once by us and once
 * by the library underneath.
 */
const nodeTypes = { tableNode: TableNode, domainGroup: GroupBox };
const edgeTypes = { orthogonal: OrthogonalEdge };
const proOptions = { hideAttribution: true };
const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.5, 2] as const;

/** Zoom used when jumping to a search hit — close enough to read the column names. */
const FOCUS_ZOOM = 1.2;

/**
 * Shared by the fit on load and the toolbar's fit button, which otherwise use different defaults.
 *
 * `maxZoom: 1` because fitting should never *magnify*. React Flow will happily scale up to the
 * canvas `maxZoom` when the content is small, so a file with one table opened at 200% with the
 * table marooned in the middle of an empty pane — technically fitted, and not what anyone means
 * by it. Extra padding because the cardinality marks and the 1/N labels are drawn outside the
 * node boxes, and `fitView` only measures nodes.
 */
const FIT_VIEW_OPTIONS = { padding: 0.18, maxZoom: 1 };

/** Matches the edge colour the page assigns, so a toggled-back arrowhead is not a different blue. */
const EDGE_COLOUR = 'var(--color-edge)';

interface VisualizerProps {
    nodes: Node[];
    edges: Edge[];
    onNodesChange: OnNodesChange;
    /** React Flow's drag callbacks, so a whole drag becomes one undo step rather than a hundred. */
    onNodeDragStart?: (event: React.MouseEvent, node: Node, nodes: Node[]) => void;
    onNodeDragStop?: (event: React.MouseEvent, node: Node, nodes: Node[]) => void;
    onRefreshRequest: () => void;
    history?: HistorySnapshot;
    onUndo?: () => void;
    onRedo?: () => void;
    /**
     * Rendered inside the canvas rather than by the page, because it has to sit over the diagram
     * and the page's own layout has no element in that position.
     */
    toast?: React.ReactNode;
    /** Called when a relationship is dragged between two columns. */
    onCreateRelationship?: (link: RelationshipDraft) => void;
    /** Called with the table names to put in a new domain group. */
    onCreateGroup?: (tables: string[]) => void;
    onNodeDrag?: (event: React.MouseEvent, node: Node, nodes: Node[]) => void;
}

/** A group's React Flow id is prefixed; a table's id is just the table name. */
const GROUP_NODE_PREFIX = 'group:';
const isGroupNode = (node: { id: string }) => node.id.startsWith(GROUP_NODE_PREFIX);

/** A relationship the user has just drawn, in schema terms rather than React Flow's. */
export interface RelationshipDraft {
    /** The table holding the new foreign key. */
    childTable: string;
    childColumn: string;
    /** The table being pointed at. */
    parentTable: string;
    parentColumn: string;
}

/** Splits `customer_id-left` back into the column it names. */
const columnFromHandle = (handleId: string | null | undefined, suffix: string): string | null =>
    handleId && handleId.endsWith(suffix) ? handleId.slice(0, -suffix.length) : null;

export const Visualizer = ({
    nodes, edges, onNodesChange, onNodeDragStart, onNodeDragStop, onRefreshRequest,
    history, onUndo, onRedo, toast, onCreateRelationship, onCreateGroup, onNodeDrag,
}: VisualizerProps) => {
    const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null);
    const [zoomLevel, setZoomLevel] = useState(1);
    const [isCreateModalOpen, setCreateModalOpen] = useState(false);
    const [isNewTableHelpOpen, setNewTableHelpOpen] = useState(false);
    const [isSearchOpen, setSearchOpen] = useState(false);
    const [activeHit, setActiveHit] = useState<SearchHit | null>(null);
    // Off on a small canvas, where it would cover more than it helps. Remembered per session
    // only: a preference this cheap to re-set is not worth persisting.
    const [isMinimapOpen, setMinimapOpen] = useState(true);
    // Crow's foot by default: it says how many rows sit at each end, which an arrowhead cannot.
    // The arrow stays available because it is what the rest of the product's diagrams use, and
    // somebody reading a screenshot beside one of those should be able to match them.
    const [showNotation, setShowNotation] = useState(true);
    /**
     * Table names currently selected, for the "group these" affordance.
     *
     * Shift-drag on the pane is React Flow's own box selection (`selectionKeyCode` defaults to
     * Shift), so the lasso comes for free; all this does is notice the result. Groups are
     * excluded because a box is not something you put inside another box here.
     */
    const [selectedTables, setSelectedTables] = useState<string[]>([]);

    const handleSelectionChange = useCallback(({ nodes: selected }: { nodes: Node[] }) => {
        setSelectedTables(selected.filter(n => !isGroupNode(n)).map(n => n.id));
    }, []);

    const handleZoomChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const zoom = parseFloat(e.target.value);
        setZoomLevel(zoom);
        rfInstance?.zoomTo(zoom, { duration: 400 });
    };

    /**
     * Keeps the zoom control honest.
     *
     * It used to hold its own state and never hear about anything else, so the moment you
     * scroll-wheeled, pinched, or hit the canvas's own +/- buttons it was showing a number
     * that had nothing to do with the canvas.
     */
    const handleMove = useCallback((_: unknown, viewport: Viewport) => {
        setZoomLevel(viewport.zoom);
    }, []);

    /* ── Search ──────────────────────────────────────────────────────────── */

    /**
     * Ctrl+F opens the canvas search instead of the browser's.
     *
     * Taking a browser shortcut is only defensible when the replacement does the same job better
     * on the thing in front of the user, and here it does: the browser's find bar cannot see
     * table names inside React Flow's transformed viewport, and highlighting text it cannot
     * scroll to is worse than nothing. A dialog on top wins the shortcut back, because then the
     * canvas is not what is being read.
     */
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            const isFind = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f';
            if (!isFind) return;
            if (document.body.dataset.dialogOpen === 'true') return;
            event.preventDefault();
            setSearchOpen(true);
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, []);

    const focusHit = useCallback((hit: SearchHit) => {
        setActiveHit(hit);
        const node = nodes.find(n => n.id === hit.nodeId);
        if (!node || !rfInstance) return;
        const x = node.position.x + (node.width ?? 210) / 2;
        const y = node.position.y + (node.height ?? 120) / 2;
        rfInstance.setCenter(x, y, { zoom: Math.max(rfInstance.getZoom(), FOCUS_ZOOM), duration: 450 });
    }, [nodes, rfInstance]);

    const closeSearch = useCallback(() => {
        setSearchOpen(false);
        setActiveHit(null);
    }, []);

    /**
     * The canvas with the search result picked out of it.
     *
     * Dimming rather than highlighting: on a hundred-table canvas a highlighted node is still
     * one node among a hundred, and the eye has nothing to reject. Turning everything else down
     * leaves exactly one thing to look at.
     *
     * Returns the original arrays unchanged when nothing is selected, so the common case costs
     * nothing and React Flow's reference comparison keeps every node from re-rendering on a drag.
     */
    const displayNodes = useMemo(() => {
        if (!activeHit) return nodes;
        return nodes.map(node => {
            const isHit = node.id === activeHit.nodeId;
            // Appended, not assigned. A tagged table carries its colour in `className`, and
            // overwriting it here made every colour vanish the moment search was opened.
            const focus = isHit ? 'node-hit' : 'node-dim';
            return {
                ...node,
                className: node.className ? `${node.className} ${focus}` : focus,
                data: isHit && activeHit.column
                    ? { ...node.data, highlightColumn: activeHit.column }
                    : node.data,
            };
        });
    }, [nodes, activeHit]);

    const displayEdges = useMemo(() => {
        if (!activeHit && showNotation) return edges;
        return edges.map(edge => {
            // Dropping `data` is what turns the notation off: OrthogonalEdge falls back to the
            // plain arrowhead when it has no cardinality to draw.
            const base = showNotation ? edge : {
                ...edge,
                data: undefined,
                markerEnd: { type: MarkerType.ArrowClosed, color: EDGE_COLOUR, width: 16, height: 16 },
            };
            if (!activeHit) return base;
            const touchesHit = edge.source === activeHit.nodeId || edge.target === activeHit.nodeId;
            return touchesHit
                ? base
                : { ...base, style: { ...base.style, opacity: 0.15 }, animated: false };
        });
    }, [edges, activeHit, showNotation]);

    /**
     * Turns a dropped connection into a relationship.
     *
     * React Flow's `source` is the end the drag *started* from, which the handle layout makes the
     * referenced (parent) table — keys are handles on the right, foreign keys on the left. So the
     * gesture reads the way it should: drag from the key in A, drop on the column in B, and B
     * gets the foreign key.
     */
    const handleConnect = useCallback((connection: Connection) => {
        const parentColumn = columnFromHandle(connection.sourceHandle, '-right');
        const childColumn = columnFromHandle(connection.targetHandle, '-left');
        if (!connection.source || !connection.target || !parentColumn || !childColumn) return;

        onCreateRelationship?.({
            parentTable: connection.source,
            parentColumn,
            childTable: connection.target,
            childColumn,
        });
    }, [onCreateRelationship]);

    /**
     * Refuses the obviously wrong drops before a request is made.
     *
     * Only the checks that can be made from what is already on screen. The backend re-checks
     * everything and owns the ones that need the data — orphan rows especially — because it is
     * the only side that can see them.
     */
    const isValidConnection = useCallback((connection: Connection): boolean => {
        const parentColumn = columnFromHandle(connection.sourceHandle, '-right');
        const childColumn = columnFromHandle(connection.targetHandle, '-left');
        if (!parentColumn || !childColumn) return false;
        // A column pointing at itself is meaningless; two columns of the same table is fine.
        if (connection.source === connection.target && parentColumn === childColumn) return false;

        const parent = nodes.find(n => n.id === connection.source);
        const column = (parent?.data?.columns as ColumnInfo[] | undefined)
            ?.find(c => c.name === parentColumn);
        // A foreign key must point at something unique, or the database will not enforce it.
        return !!column && (!!column.isPk || !!column.isUnique);
    }, [nodes]);

    /**
     * Tables only.
     *
     * Groups are React Flow nodes too, so every list built by walking `nodes` has to say whether
     * it means them. This one feeds the New Table dialog's duplicate-name check; the search panel
     * gets the same treatment below, and the edge router filters them out of its obstacle list —
     * an edge crossing a boundary is the interesting one, so routing *around* the box would be
     * exactly backwards.
     */
    const tableNodes = useMemo(() => nodes.filter(n => !isGroupNode(n)), [nodes]);

    const existingTables = useMemo(
        () => Array.from(new Set(tableNodes.map(n => String(n.data?.label ?? '')).filter(Boolean))),
        [tableNodes]
    );

    // The exact zoom is rarely one of the presets, so the current value joins the list
    // rather than the select falling back to blank.
    const zoomOptions = useMemo(() => {
        const rounded = Math.round(zoomLevel * 100) / 100;
        const steps: number[] = [...ZOOM_STEPS];
        if (!steps.includes(rounded)) steps.push(rounded);
        return steps.sort((a, b) => a - b);
    }, [zoomLevel]);

    return (
        <>
            {/* No transform on this wrapper. A `position: fixed` descendant resolves against the
                nearest transformed ancestor rather than the viewport, so an animation here would
                silently trap every dialog opened from the canvas inside the canvas pane. */}
            <div className="flex-1 relative bg-canvas min-h-0">
                <ReactFlow
                    nodes={displayNodes}
                    edges={displayEdges}
                    onNodesChange={onNodesChange}
                    onNodeDragStart={onNodeDragStart}
                    onNodeDrag={onNodeDrag}
                    onNodeDragStop={onNodeDragStop}
                    onSelectionChange={handleSelectionChange}
                    nodeTypes={nodeTypes}
                    edgeTypes={edgeTypes}
                    onInit={setRfInstance}
                    onMove={handleMove}
                    fitView
                    fitViewOptions={FIT_VIEW_OPTIONS}
                    minZoom={0.1}
                    maxZoom={2}
                    proOptions={proOptions}
                    // Dragging a handle used to start a connection that went nowhere: both
                    // `onConnect` and `onEdgesChange` were no-ops, so the canvas offered a
                    // gesture it could not honour. Relationships are created through the
                    // New Table / Edit Column dialogs, which do persist.
                    // Connectable now that dragging a handle does something: `onConnect` creates
                    // a real foreign key. It was deliberately off while the gesture went nowhere.
                    nodesConnectable={!!onCreateRelationship}
                    onConnect={handleConnect}
                    isValidConnection={isValidConnection}
                    connectionRadius={28}
                    // React Flow defaults this to Meta alone, which leaves Windows with no
                    // click-based way to select a second table — only the shift-drag lasso.
                    multiSelectionKeyCode={['Meta', 'Control']}
                    edgesUpdatable={false}
                    deleteKeyCode={null}
                >
                    {/* The colour is themed from CSS, not from this prop: React Flow writes it to
                        the pattern's `fill` *attribute*, where a CSS variable is not valid. The
                        value below is only what shows if that rule is ever lost. */}
                    <Background color="#94a3b8" gap={24} size={1.5} variant={BackgroundVariant.Dots} />

                    {/* Given the same options as the initial fit: the button reads its own
                        defaults otherwise, so the two disagreed about what "fit" meant. */}
                    <Controls showInteractive={false} fitViewOptions={FIT_VIEW_OPTIONS} />

                    {/* The minimap earns its space only once the diagram outgrows the window,
                        which is also the point at which panning stops being self-explanatory. */}
                    {isMinimapOpen && (
                        <MiniMap
                            pannable
                            zoomable
                            ariaLabel="Schema minimap"
                            nodeBorderRadius={3}
                            // Coloured by CSS rather than by prop, so the map follows the theme
                            // with everything else - see `.react-flow__minimap-node` in globals.
                            // Still by class, not by `nodeColor`. React Flow puts nodeColor in a
                            // `fill` *attribute*, and the `.react-flow__minimap-node` rule in
                            // globals.css is a CSS rule — which beats any presentation attribute,
                            // so a colour passed that way is silently ignored. Measured: the
                            // attribute read back as the tag colour while the computed fill stayed
                            // brand-400. A class lets the cascade do it properly.
                            //
                            // Search focus wins over the tag: at minimap scale the point of the
                            // highlight is that exactly one dot stands out.
                            nodeClassName={(node) => {
                                if (isGroupNode(node)) {
                                    // A coloured group keeps its colour on the map too — at this
                                    // scale hue is the only thing left that identifies anything.
                                    const colour = (node.data as { group?: { colour?: string } })
                                        ?.group?.colour;
                                    return colour
                                        ? `minimap-node-group minimap-group-${colour}`
                                        : 'minimap-node-group';
                                }
                                // A table counting down to deletion is greyed here too. The
                                // map is how anyone finds a node that is off screen, and a
                                // ghost is precisely the node somebody may need to get back to.
                                if (node.data?.ghost) return 'minimap-node minimap-node-ghost';
                                if (node.id === activeHit?.nodeId) return 'minimap-node-hit';
                                const tag = node.data?.colour as string | undefined;
                                return tag ? `minimap-node minimap-tag-${tag}` : 'minimap-node';
                            }}
                            // Sized through `style`, which is where React Flow reads it from -
                            // a width utility class lands on the panel and leaves the svg at its
                            // default 200x150. Hidden on a phone, where it would cover the
                            // diagram it is meant to help you find your way around.
                            // A little larger than it was: at 182px a hundred-table schema was a
                            // grey smudge, and the map is the only thing that makes that many
                            // tables navigable at all.
                            style={{ width: 208, height: 148 }}
                            className="!bottom-3 !right-3 hidden sm:!block"
                        />
                    )}

                    {/* Appears only when there is something to group. Shift-drag a box around
                        some tables — React Flow's own lasso — and this offers to draw a boundary
                        around exactly those. */}
                    {onCreateGroup && selectedTables.length > 1 && (
                        <Panel position="top-center" className="!mt-2 sm:!mt-4">
                            <button
                                type="button"
                                onClick={() => onCreateGroup(selectedTables)}
                                className="flex items-center gap-2 rounded-full border border-line bg-surface
                                           px-4 py-2 text-xs font-semibold text-ink-700 shadow-glow-md
                                           transition-colors hover:bg-ink-50 anim-fade-in"
                            >
                                <Boxes size={14} className="text-brand-600" />
                                Group these {selectedTables.length} tables
                            </button>
                        </Panel>
                    )}

                    <Panel position="top-left" className="!m-2 sm:!m-4">
                        <div className="flex p-1 rounded-md shadow-glow-md border bg-surface border-line">
                            <button
                                type="button"
                                onClick={() => setCreateModalOpen(true)}
                                className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold text-white brand-gradient brand-gradient-hover rounded transition-all"
                            >
                                <Plus size={14} /> New table
                            </button>

                            <div className="w-px mx-1 my-1 bg-ink-200" />

                            {onUndo && (
                                <>
                                    <button
                                        type="button"
                                        onClick={onUndo}
                                        disabled={!history?.canUndo && !history?.blockedBy}
                                        className="p-1.5 rounded text-ink-600 transition-colors hover:bg-ink-100
                                                   disabled:opacity-35 disabled:hover:bg-transparent"
                                        aria-label="Undo"
                                        title={history?.undoLabel
                                            ? `Undo: ${history.undoLabel}  (Ctrl+Z)`
                                            : 'Undo  (Ctrl+Z)'}
                                    >
                                        <Undo2 size={16} />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={onRedo}
                                        disabled={!history?.canRedo}
                                        className="p-1.5 rounded text-ink-600 transition-colors hover:bg-ink-100
                                                   disabled:opacity-35 disabled:hover:bg-transparent"
                                        aria-label="Redo"
                                        title={history?.redoLabel
                                            ? `Redo: ${history.redoLabel}  (Ctrl+Shift+Z)`
                                            : 'Redo  (Ctrl+Shift+Z)'}
                                    >
                                        <Redo2 size={16} />
                                    </button>
                                    <div className="w-px mx-1 my-1 bg-ink-200" />
                                </>
                            )}

                            {onCreateGroup && (
                                <button
                                    type="button"
                                    onClick={() => onCreateGroup(selectedTables)}
                                    className={`relative p-1.5 rounded transition-colors ${
                                        selectedTables.length > 1
                                            ? 'bg-brand-50 text-brand-700'
                                            : 'text-ink-600 hover:bg-ink-100'
                                    }`}
                                    aria-label="Group tables"
                                    // The title carries the instructions, because the gesture that
                                    // does this — shift-drag a lasso — is invisible until somebody
                                    // tells you about it. The button is the telling.
                                    title={selectedTables.length > 1
                                        ? `Group the ${selectedTables.length} selected tables`
                                        : 'Group tables — hold Shift and drag a box around two or '
                                          + 'more, or Ctrl-click each one, then press this'}
                                >
                                    <Boxes size={16} />
                                    {selectedTables.length > 1 && (
                                        <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center
                                                         justify-center rounded-full bg-brand-600 px-1 text-[8px]
                                                         font-bold text-white">
                                            {selectedTables.length}
                                        </span>
                                    )}
                                </button>
                            )}

                            <button
                                type="button"
                                onClick={() => setShowNotation(v => !v)}
                                className={`p-1.5 rounded transition-colors ${
                                    showNotation ? 'bg-brand-50 text-brand-700' : 'text-ink-600 hover:bg-ink-100'
                                }`}
                                aria-pressed={showNotation}
                                aria-label="Show relationship cardinality"
                                title={showNotation
                                    ? 'Crow’s foot notation — click for plain arrows'
                                    : 'Plain arrows — click for crow’s foot notation'}
                            >
                                <Spline size={16} />
                            </button>

                            {/* Ctrl+F is the real entry point; this is how anyone finds out it
                                exists. */}
                            <button
                                type="button"
                                onClick={() => setSearchOpen(v => !v)}
                                className={`p-1.5 rounded transition-colors ${
                                    isSearchOpen ? 'bg-brand-50 text-brand-700' : 'text-ink-600 hover:bg-ink-100'
                                }`}
                                aria-label="Find a table or column (Ctrl+F)"
                                title="Find a table or column  (Ctrl+F)"
                            >
                                <Search size={16} />
                            </button>

                            <button
                                type="button"
                                onClick={() => setMinimapOpen(v => !v)}
                                className={`p-1.5 rounded transition-colors ${
                                    isMinimapOpen ? 'bg-brand-50 text-brand-700' : 'text-ink-600 hover:bg-ink-100'
                                }`}
                                aria-label={isMinimapOpen ? 'Hide the minimap' : 'Show the minimap'}
                                title={isMinimapOpen ? 'Hide the minimap' : 'Show the minimap'}
                                aria-pressed={isMinimapOpen}
                            >
                                <MapIcon size={16} />
                            </button>

                            <button
                                type="button"
                                onClick={() => setNewTableHelpOpen(true)}
                                className="p-1.5 rounded text-ink-600 hover:bg-ink-100"
                                aria-label="What does New Table do?"
                                title="What does New Table do?"
                            >
                                <Info size={16} />
                            </button>
                        </div>
                    </Panel>

                    {/* Top-centre, above the diagram rather than beside it: the canvas moves under
                        the panel as you arrow through the results, so the panel must not be the
                        thing that moves. */}
                    {isSearchOpen && (
                        <Panel position="top-center" className="!m-2 sm:!m-4">
                            <CanvasSearch nodes={tableNodes} onSelect={focusHit} onClose={closeSearch} />
                        </Panel>
                    )}

                    <Panel position="top-right" className="!m-2 sm:!m-4">
                        {/* Hidden on the narrowest screens, where pinch-zoom is the natural
                            gesture and the control would sit on top of the canvas content. */}
                        <div className="hidden sm:flex items-center gap-2 px-2 py-1 rounded-md shadow-glow-md border bg-surface border-line">
                            <ZoomIn size={14} className="text-ink-400" />
                            <select
                                value={zoomOptions.includes(Math.round(zoomLevel * 100) / 100)
                                    ? Math.round(zoomLevel * 100) / 100
                                    : 1}
                                onChange={handleZoomChange}
                                aria-label="Zoom level"
                                className="bg-transparent text-xs font-mono focus:outline-none cursor-pointer text-ink-900"
                            >
                                {zoomOptions.map(z => (
                                    <option key={z} value={z}>{Math.round(z * 100)}%</option>
                                ))}
                            </select>
                        </div>
                    </Panel>
                </ReactFlow>

                {/* Outside <ReactFlow> so it is not inside the transformed viewport: a toast that
                    scaled with the zoom would be unreadable at 25%. */}
                {toast}
            </div>

            {isCreateModalOpen && (
                <CreateTableModal
                    isOpen
                    onClose={() => setCreateModalOpen(false)}
                    onSuccess={onRefreshRequest}
                    existingTables={existingTables}
                />
            )}

            {/* Contextual help for the button beside it. The header's info button explains the
                app as a whole instead - the two are deliberately different. */}
            {isNewTableHelpOpen && (
                <NewTableHelpModal isOpen onClose={() => setNewTableHelpOpen(false)} />
            )}
        </>
    );
};
