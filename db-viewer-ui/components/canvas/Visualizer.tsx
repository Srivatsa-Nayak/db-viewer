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
import { Sun, Moon, Monitor, ZoomIn, ChevronRight, ChevronLeft, Info, X, Plus} from "lucide-react";
import TableNode from "@/components/tables/TableNode";
import { CreateTableModal } from "@/components/modal/CreateTableModal";

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
    onRefreshRequest: () => void;
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
    onToggleSidebar,
    onRefreshRequest
}: VisualizerProps) => {
    const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null);
    const [zoomLevel, setZoomLevel] = useState(1);
    const [isCreateModalOpen, setCreateModalOpen] = useState(false);
    const [isInfoModalOpen, setInfoModalOpen] = useState(false);

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

                <Panel position="top-left" className="flex gap-2">
                    <div className={`flex p-1 rounded-lg shadow-lg border ${theme === 'light' ? 'bg-white border-slate-200' : 'bg-slate-800 border-slate-700'}`}>
                        <button 
                            onClick={() => setCreateModalOpen(true)}
                            className="flex items-center gap-2 px-3 py-1.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 rounded transition-all"
                        >
                            <Plus size={14} /> New Table
                        </button>
                        
                        <div className="w-px bg-slate-700 mx-1 my-1" />

                        <button 
                            onClick={() => setInfoModalOpen(true)}
                            className={`p-1.5 rounded ${theme === 'light' ? 'text-slate-600 hover:bg-slate-100' : 'text-slate-400 hover:text-white hover:bg-slate-700'}`}
                            title="Help & Info"
                        >
                            <Info size={16} />
                        </button>
                    </div>
                </Panel>
                
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

            {isInfoModalOpen && (
                <div className="fixed inset-0 bg-black/60 z-[110] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in">
                    <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-md shadow-2xl">
                        <div className="p-4 border-b border-slate-800 flex justify-between items-center">
                            <h3 className="font-bold text-white flex items-center gap-2">
                                <Info size={18} className="text-indigo-400" /> 
                                Help & Guide
                            </h3>
                            <button onClick={() => setInfoModalOpen(false)}><X className="text-slate-400 hover:text-white" /></button>
                        </div>
                        <div className="p-6 space-y-4 text-sm text-slate-300">
                             <p>This Visualizer allows you to design schemas interactively.</p>
                            <ul className="list-disc pl-5 space-y-2 text-slate-400">
                                <li><strong>Create Table:</strong> Use the top-left button to add new entities.</li>
                                <li><strong>Connect:</strong> Drag from one table handle to another to create relationships.</li>
                                <li><strong>Export:</strong> Click the Download icon to get the raw .sql file.</li>
                            </ul>
                        </div>
                        <div className="p-4 bg-slate-800/50 rounded-b-xl flex justify-end">
                            <button onClick={() => setInfoModalOpen(false)} className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded text-sm">Close</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};