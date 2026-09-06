"use client";

import React, { useState } from 'react';
import ReactFlow, {
    Background,
    Controls,
    ReactFlowInstance,
    Panel,
    Node,
    Edge,
    OnNodesChange,
    OnEdgesChange,
    OnConnect,
    BackgroundVariant
} from 'reactflow';
import "reactflow/dist/style.css";
import { ZoomIn, Info, Plus } from "lucide-react";
import TableNode from "@/components/tables/TableNode";
import { CreateTableModal } from "@/components/modal/CreateTableModal";
import { NewTableHelpModal } from "@/components/modal/NewTableHelpModal";

const nodeTypes = { tableNode: TableNode };

const proOptions = { hideAttribution: true };

interface VisualizerProps {
    nodes: Node[];
    edges: Edge[];
    onNodesChange: OnNodesChange;
    onEdgesChange: OnEdgesChange;
    onConnect: OnConnect;
    onRefreshRequest: () => void;
}

export const Visualizer = ({
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    onConnect,
    onRefreshRequest
}: VisualizerProps) => {
    const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null);
    const [zoomLevel, setZoomLevel] = useState(1);
    const [isCreateModalOpen, setCreateModalOpen] = useState(false);
    const [isNewTableHelpOpen, setNewTableHelpOpen] = useState(false);

    const handleZoomChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const zoom = parseFloat(e.target.value);
        setZoomLevel(zoom);
        if (rfInstance) {
            rfInstance.zoomTo(zoom, { duration: 800 });
        }
    };

    const getExistingTables = () => {
        const names = nodes
            .map(n => n.data?.name || n.data?.label || "")
            .filter(name => name !== "");
        return Array.from(new Set(names)); // Remove duplicates
    };

    return (
        <>
        <div className="flex-1 border-r relative transition-colors duration-300 bg-zinc-50 border-zinc-200 animate-fade-up">
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                nodeTypes={nodeTypes}
                onInit={setRfInstance}
                fitView
                proOptions={proOptions}
            >
                <Background
                    color="#a1a1aa"
                    gap={24}
                    size={1.5}
                    variant={BackgroundVariant.Dots}
                />

                <Controls className="bg-white border-zinc-200 fill-zinc-700" />

                <Panel position="top-left" className="flex gap-2">
                    <div className="flex p-1 rounded-md shadow-lg border bg-white border-zinc-200 card-hover animate-fade-up">
                        <button
                            onClick={() => setCreateModalOpen(true)}
                            className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded transition-all btn-animated"
                        >
                            <Plus size={14} /> New Table
                        </button>

                        <div className="w-px mx-1 my-1 bg-zinc-200" />

                        <button
                            onClick={() => setNewTableHelpOpen(true)}
                            className="p-1.5 rounded text-zinc-600 hover:bg-zinc-100"
                            title="What does New Table do?"
                        >
                            <Info size={16} />
                        </button>
                    </div>
                </Panel>

                {/* --- CUSTOM TOOLBAR --- */}
                <Panel position="top-right" className="flex gap-2">

                    {/* Zoom Select */}
                    <div className="flex items-center gap-2 px-2 py-1 rounded shadow-lg border bg-white border-zinc-200">
                        <ZoomIn size={14} className="text-zinc-400" />
                        <select
                            value={zoomLevel}
                            onChange={handleZoomChange}
                            className="bg-transparent text-xs font-mono focus:outline-none cursor-pointer text-zinc-900 btn-animated"
                        >
                            <option value={0.5}>50%</option>
                            <option value={1}>100%</option>
                            <option value={1.5}>150%</option>
                            <option value={2}>200%</option>
                        </select>
                    </div>
                </Panel>
            </ReactFlow>
        </div>
        <CreateTableModal
            isOpen={isCreateModalOpen}
            onClose={() => setCreateModalOpen(false)}
            onSuccess={() => {
                // Trigger parent to re-fetch/update nodes
                if(onRefreshRequest) onRefreshRequest();
            }}
            // Pass existing table names for Foreign Key support
            existingTables={getExistingTables()}
        />

        {/* Contextual help for the button beside it. The header's info button explains the
            app as a whole instead - the two are deliberately different. */}
        <NewTableHelpModal isOpen={isNewTableHelpOpen} onClose={() => setNewTableHelpOpen(false)} />

        </>
    );
};
