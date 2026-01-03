"use client";

import React, { useState, useCallback } from 'react';
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
import { Sun, Moon, Monitor, ZoomIn, ChevronRight, ChevronLeft } from "lucide-react";
import TableNode from "@/components/TableNode";

const nodeTypes = { tableNode: TableNode };

const proOptions = { hideAttribution: true };

interface VisualizerProps {
    nodes: Node[];
    edges: Edge[];
    onNodesChange: OnNodesChange;
    onEdgesChange: OnEdgesChange;
    onConnect: OnConnect;
    theme: 'dark' | 'light' | 'system';
    setTheme: (theme: 'dark' | 'light' | 'system') => void;
    isSidebarOpen: boolean;
    onToggleSidebar: () => void;
}

export const Visualizer = ({
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    onConnect,
    theme,
    setTheme,
    isSidebarOpen,
    onToggleSidebar
}: VisualizerProps) => {
    const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null);
    const [zoomLevel, setZoomLevel] = useState(1);

    const handleZoomChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const zoom = parseFloat(e.target.value);
        setZoomLevel(zoom);
        if (rfInstance) {
            rfInstance.zoomTo(zoom, { duration: 800 });
        }
    };

    return (
        <div className={`flex-1 border-r relative transition-colors duration-300 ${
            // Light Mode: Slate-50 background (not pure white)
            theme === 'light' ? 'bg-slate-50 border-slate-200' : 'bg-slate-900 border-slate-800'
        }`}>
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                nodeTypes={nodeTypes}
                onInit={setRfInstance}
                fitView
                className={theme === 'dark' ? 'dark' : ''}
                proOptions={proOptions}
            >
                <Background 
                    color={theme === 'light' ? '#94a3b8' : '#334155'} 
                    gap={24} 
                    size={1} 
                    variant={BackgroundVariant.Dots} // Ensure you import BackgroundVariant
                />

                <Controls className={`${theme === 'light' ? 'bg-white border-slate-200 fill-slate-700' : 'bg-slate-800 border-slate-700 fill-black'
                    }`} />

                {/* --- CUSTOM TOOLBAR --- */}
                <Panel position="top-right" className="flex gap-2">

                    {/* Zoom Select */}
                    <div className={`flex items-center gap-2 px-2 py-1 rounded shadow-lg border ${theme === 'light' ? 'bg-white border-slate-200' : 'bg-slate-800 border-slate-700 text-white'
                        }`}>
                        <ZoomIn size={14} className="text-slate-400" />
                        <select
                            value={zoomLevel}
                            onChange={handleZoomChange}
                            className={`bg-transparent text-xs font-mono focus:outline-none cursor-pointer ${theme === 'light' ? 'text-black' : 'text-black'
                                }`}
                        >
                            <option value={0.5}>50%</option>
                            <option value={1}>100%</option>
                            <option value={1.5}>150%</option>
                            <option value={2}>200%</option>
                        </select>
                    </div>

                    {/* Theme Toggles */}
                    <div className={`flex p-1 rounded-lg shadow-lg border ${theme === 'light' ? 'bg-white border-slate-200' : 'bg-slate-800 border-slate-700'
                        }`}>
                        <button
                            onClick={() => setTheme('light')}
                            className={`p-1.5 rounded ${theme === 'light' ? 'bg-indigo-100 text-indigo-600' : 'text-slate-400 hover:text-slate-200'}`}
                            title="Light Mode"
                        >
                            <Sun size={14} />
                        </button>
                        <button
                            onClick={() => setTheme('dark')}
                            className={`p-1.5 rounded ${theme === 'dark' ? 'bg-indigo-900/50 text-indigo-400' : 'text-slate-400 hover:text-slate-600'}`}
                            title="Dark Mode"
                        >
                            <Moon size={14} />
                        </button>
                        <button
                            onClick={() => setTheme('system')}
                            className={`p-1.5 rounded ${theme === 'system' ? 'bg-slate-200 text-slate-800' : 'text-slate-400 hover:text-slate-600'}`}
                            title="System"
                        >
                            <Monitor size={14} />
                        </button>
                    </div>
                </Panel>
                <button
                    onClick={onToggleSidebar}
                    className="absolute right-0 top-1/2 -translate-y-1/2 z-50 bg-slate-800 border border-slate-700 border-r-0 rounded-l-md p-1 hover:bg-indigo-600 hover:border-indigo-500 hover:text-white transition-all shadow-xl"
                    title={isSidebarOpen ? "Maximize Visualizer" : "Show Editor"}
                >
                    {isSidebarOpen ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}
                </button>
            </ReactFlow>
        </div>
    );
};