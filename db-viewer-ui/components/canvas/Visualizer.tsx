"use client";

import React, { useCallback, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import ReactFlow, {
    Background,
    Controls,
    ReactFlowInstance,
    Panel,
    Node,
    Edge,
    OnNodesChange,
    BackgroundVariant,
    Viewport,
} from 'reactflow';
import "reactflow/dist/style.css";
import { ZoomIn, Info, Plus } from "lucide-react";
import TableNode from "@/components/tables/TableNode";

const CreateTableModal = dynamic(
    () => import('@/components/modal/CreateTableModal').then(m => m.CreateTableModal), { ssr: false });
const NewTableHelpModal = dynamic(
    () => import('@/components/modal/NewTableHelpModal').then(m => m.NewTableHelpModal), { ssr: false });

// Declared at module scope: React Flow warns (and rebuilds its internal node registry) when
// either of these is a new object on every render.
const nodeTypes = { tableNode: TableNode };
const proOptions = { hideAttribution: true };
const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.5, 2] as const;

interface VisualizerProps {
    nodes: Node[];
    edges: Edge[];
    onNodesChange: OnNodesChange;
    onRefreshRequest: () => void;
}

export const Visualizer = ({ nodes, edges, onNodesChange, onRefreshRequest }: VisualizerProps) => {
    const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null);
    const [zoomLevel, setZoomLevel] = useState(1);
    const [isCreateModalOpen, setCreateModalOpen] = useState(false);
    const [isNewTableHelpOpen, setNewTableHelpOpen] = useState(false);

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

    const existingTables = useMemo(
        () => Array.from(new Set(nodes.map(n => String(n.data?.label ?? '')).filter(Boolean))),
        [nodes]
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
            <div className="flex-1 relative bg-ink-50 min-h-0">
                <ReactFlow
                    nodes={nodes}
                    edges={edges}
                    onNodesChange={onNodesChange}
                    nodeTypes={nodeTypes}
                    onInit={setRfInstance}
                    onMove={handleMove}
                    fitView
                    minZoom={0.1}
                    maxZoom={2}
                    proOptions={proOptions}
                    // Dragging a handle used to start a connection that went nowhere: both
                    // `onConnect` and `onEdgesChange` were no-ops, so the canvas offered a
                    // gesture it could not honour. Relationships are created through the
                    // New Table / Edit Column dialogs, which do persist.
                    nodesConnectable={false}
                    edgesUpdatable={false}
                    deleteKeyCode={null}
                >
                    <Background color="#94a3b8" gap={24} size={1.5} variant={BackgroundVariant.Dots} />

                    <Controls className="bg-white border-line fill-ink-700" showInteractive={false} />

                    <Panel position="top-left" className="!m-2 sm:!m-4">
                        <div className="flex p-1 rounded-md shadow-glow-md border bg-white border-line">
                            <button
                                type="button"
                                onClick={() => setCreateModalOpen(true)}
                                className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold text-white brand-gradient brand-gradient-hover rounded transition-all"
                            >
                                <Plus size={14} /> New table
                            </button>

                            <div className="w-px mx-1 my-1 bg-ink-200" />

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

                    <Panel position="top-right" className="!m-2 sm:!m-4">
                        {/* Hidden on the narrowest screens, where pinch-zoom is the natural
                            gesture and the control would sit on top of the canvas content. */}
                        <div className="hidden sm:flex items-center gap-2 px-2 py-1 rounded-md shadow-glow-md border bg-white border-line">
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
