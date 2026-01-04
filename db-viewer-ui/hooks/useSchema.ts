import { useState, useCallback, useEffect } from "react";
import {
  Node,
  Edge,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  Connection,
  NodeChange,
  EdgeChange,
  MarkerType,
} from "reactflow";
import { dbService } from "@/services/api";

export const useSchema = (
  onEditTable: (name: string) => void,
  onError: (message: string) => void
) => {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);

  const refreshSchema = useCallback(async () => {
    try {
      const response = await dbService.getSchema();
      const tables = response.tables || [];
      const relationships = response.relationships || [];

      // Transform API data into React Flow Nodes
      const newNodes: Node[] = tables.map((tbl, index) => ({
        id: tbl.name,
        type: "tableNode",
        position: {
           x: 250 * (index % 3),
          y: 100 + Math.floor(index / 3) * 300,
        },
        data: {
          label: tbl.name,
          columns: tbl.columns,
          onRefresh: refreshSchema,
          onEdit: onEditTable,
        },
      }));

      // Transform API relationships into Edges
      const newEdges: Edge[] = (response.relationships || []).map((rel: any, index: number) => ({
                id: `e-${index}`,
                
                // FLIP DIRECTION: Parent (TargetTable) -> Child (SourceTable)
                source: rel.target_table, 
                target: rel.source_table,

                // CONNECT TO SPECIFIC ROWS
                // Source Handle: The PK on the Parent (Right side)
                sourceHandle: `${rel.target_column}-right`,
                // Target Handle: The FK on the Child (Left side)
                targetHandle: `${rel.source_column}-left`,

                // STYLING
                type: 'smoothstep', // Makes neat 90-degree lines
                animated: true,
                style: { stroke: '#6366f1', strokeWidth: 1.5 },
                markerEnd: {
                    type: MarkerType.ArrowClosed, // The Arrow Head
                    color: '#6366f1',
                },
            }));

      setNodes(newNodes);
      setEdges(newEdges);
    } catch (err) {
      console.error("Failed to fetch schema", err);
    }
  }, [onEditTable]);

  // Initial load
  useEffect(() => {
    refreshSchema();
  }, [refreshSchema]);

  useEffect(() => {
    const handleRefresh = () => refreshSchema();
    window.addEventListener("schema-refresh", handleRefresh);
    return () => window.removeEventListener("schema-refresh", handleRefresh);
  }, [refreshSchema]);

  const handleFileUpload = async (file: File) => {
    setIsUploading(true);
    setFileName(file.name);
    try {
      await dbService.uploadFile(file);
      await refreshSchema();
    } catch (err) {
      console.error("Upload error:", err);

      // 1. Try to get the specific message from the Backend (Go)
      const backendMessage = (err as any).response?.data?.error;

      // 2. Fallback to generic message if backend didn't send one
      const displayMessage =
        backendMessage || "Upload failed. Check console for details.";

      onError(displayMessage);
    } finally {
      setIsUploading(false);
    }
  };

  const clearCanvas = async () => {
        try {
            await dbService.clearDatabase();
            setFileName(null);
            setNodes([]);
            setEdges([]);
        } catch (err) {
            onError("Failed to clear database");
        }
    };

  // React Flow Event Handlers
  const onNodesChange = useCallback(
    (changes: NodeChange[]) =>
      setNodes((nds) => applyNodeChanges(changes, nds)),
    []
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) =>
      setEdges((eds) => applyEdgeChanges(changes, eds)),
    []
  );
  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge(params, eds)),
    []
  );

  return {
    nodes,
    edges,
    isUploading,
    handleFileUpload,
    refreshSchema,
    clearCanvas,
    fileName,
    onNodesChange,
    onEdgesChange,
    onConnect,
  };
};
