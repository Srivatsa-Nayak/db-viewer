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
import { Relationship } from "@/types";

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
      const newEdges = (response.relationships || [])
        .flatMap((rel: Relationship, index: number): Edge[] => {
          const targetTable = rel.target_table ?? rel.targetTable;
          const sourceTable = rel.source_table ?? rel.sourceTable;
          const targetColumn = rel.target_column ?? rel.targetColumn ?? "id";
          const sourceColumn = rel.source_column ?? rel.sourceColumn;

          if (!targetTable || !sourceTable || !sourceColumn) return [];

          return [{
            id: `e-${index}`,
            source: targetTable,
            target: sourceTable,
            sourceHandle: `${targetColumn}-right`,
            targetHandle: `${sourceColumn}-left`,
            type: 'smoothstep',
            animated: true,
            style: { stroke: '#6366f1', strokeWidth: 1.5 },
            markerEnd: {
              type: MarkerType.ArrowClosed,
              color: '#6366f1',
            },
          }];
        });

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
      const backendMessage = err && typeof err === "object" && "response" in err
        ? (err as { response?: { data?: { error?: string } } }).response?.data?.error
        : undefined;

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
        } catch {
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
