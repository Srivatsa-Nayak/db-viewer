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
} from "reactflow";
import { dbService } from "@/services/api";

export const useSchema = (onEditTable: (name: string) => void) => {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [isUploading, setIsUploading] = useState(false);

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
          onEdit: onEditTable
        },
      }));

      // Transform API relationships into Edges
      const newEdges: Edge[] = relationships.map((rel, i) => ({
        id: `e-${i}`,
        source: rel.source_table,
        target: rel.target_table,
        animated: true,
        style: { stroke: "#6366f1", strokeWidth: 2 },
      }));

      setNodes(newNodes);
      setEdges(newEdges);
    } catch (err) {
      console.error("Failed to fetch schema", err);
    }
  }, []);

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
    try {
      await dbService.uploadFile(file);
      await refreshSchema();
    } catch (err) {
      alert("Upload failed");
    } finally {
      setIsUploading(false);
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
    onNodesChange,
    onEdgesChange,
    onConnect,
  };
};
