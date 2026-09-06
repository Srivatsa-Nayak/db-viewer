import React, { memo, useState } from 'react';
import { Handle, Position } from 'reactflow';
import { Database, KeyRound, Plus, Download, Edit3, Pencil } from 'lucide-react';
import { dbService } from '@/services/api';
import { AddColumnModal } from '@/components/modal/AddColumnModal';
import { EditColumnModal } from '@/components/modal/EditColumnModal';
import { ColumnInfo } from '@/types';

interface TableNodeData {
  label: string;
  columns: ColumnInfo[];
  onRefresh: () => void;
  onEdit: (tableName: string) => void;
}

const TableNode = ({ data }: { data: TableNodeData }) => {
  // The add-column form lives in its own modal (AddColumnModal) rather than inside the
  // node: the node is only ~200px wide and scales with the canvas zoom, which made the
  // inline form unusable at anything below 100%.
  const [isAddColumnOpen, setAddColumnOpen] = useState(false);
  const [editingColumn, setEditingColumn] = useState<ColumnInfo | null>(null);

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    window.open(dbService.getDownloadUrl(data.label), '_blank');
  };

  return (
    // CONTAINER: overflow-hidden REMOVED so dots can sit outside
    <div className="bg-white border border-blue-200 rounded-md min-w-[180px] max-w-[220px] shadow-xl transition-all duration-200 group/node">

      {/* HEADER: Added rounded-t-md */}
      <div className="bg-blue-600 px-2 py-1.5 flex items-center justify-between rounded-t-md">
        <div className="flex items-center gap-1.5 overflow-hidden">
          <Database size={10} className="text-white shrink-0" />
          <span className="font-bold text-white text-[10px] truncate leading-tight" title={data.label}>
            {data.label}
          </span>
        </div>

        {/* HEADER ACTIONS */}
        <div className="flex gap-0.5 shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); data.onEdit(data.label); }}
            className="p-0.5 hover:bg-blue-700 rounded text-white/80 hover:text-white transition-colors"
            title="Edit Data"
          >
            <Edit3 size={10} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); setAddColumnOpen(true); }}
            className="p-0.5 hover:bg-blue-700 rounded text-white/80 hover:text-white transition-colors"
            title="Add Column"
          >
            <Plus size={10} />
          </button>
          <button
            onClick={handleDownload}
            className="p-0.5 hover:bg-blue-700 rounded text-white/80 hover:text-white transition-colors"
            title="Download CSV"
          >
            <Download size={10} />
          </button>
        </div>
      </div>

      {/* COLUMNS LIST */}
      <div className="flex flex-col bg-zinc-50 py-0.5 rounded-b-md">
        {data.columns.map((col, i) => (
          <div key={i} className="group relative flex justify-between items-center px-2 py-0.5 hover:bg-zinc-100 transition-colors h-[22px]">

            {/* LEFT HANDLE (Target): Only if column ends in _id (Foreign Key) but is not "id" */}
            {(col.name !== 'id' && col.name.endsWith('_id')) && (
                <div className="absolute -left-1.5 top-1/2 -translate-y-1/2 z-50">
                    <Handle type="target" position={Position.Left} id={`${col.name}-left`} className="!w-2.5 !h-2.5 !bg-blue-500 !border-2 !border-white" />
                </div>
            )}

            {/* Column Name */}
            <div className="flex items-center gap-1.5 overflow-hidden">
              {(col.name === 'id' || col.name.endsWith('_id')) && (
                <KeyRound size={8} className="text-blue-500 shrink-0" />
              )}
              <span className="truncate font-mono text-[9px] text-zinc-700 leading-none font-medium">
                {col.name}
              </span>
            </div>

            {/* Column Type, swapped for an edit affordance on hover */}
            <span className="flex items-center gap-1 shrink-0 ml-2">
              <span className="text-zinc-400 font-mono uppercase text-[8px] leading-none">
                {col.type}
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); setEditingColumn(col); }}
                className="p-0.5 rounded text-zinc-400 hover:text-blue-600 hover:bg-blue-50 opacity-0 group-hover:opacity-100 transition-opacity"
                title={`Edit column "${col.name}"`}
              >
                <Pencil size={8} />
              </button>
            </span>

            {/* RIGHT HANDLE (Source): If it's 'id' OR ends in '_id' (allows referencing table_id from another table) */}
            {(col.name === 'id' || col.name.endsWith('_id')) && (
                <div className="absolute -right-1.5 top-1/2 -translate-y-1/2 z-50">
                    <Handle type="source" position={Position.Right} id={`${col.name}-right`} className="!w-2.5 !h-2.5 !bg-blue-500 !border-2 !border-white" />
                </div>
            )}

          </div>
        ))}
      </div>

      <AddColumnModal
        isOpen={isAddColumnOpen}
        tableName={data.label}
        existingColumns={data.columns.map(c => c.name)}
        onClose={() => setAddColumnOpen(false)}
        onSuccess={() => data.onRefresh?.()}
      />

      <EditColumnModal
        isOpen={editingColumn !== null}
        tableName={data.label}
        column={editingColumn}
        existingColumns={data.columns.map(c => c.name)}
        onClose={() => setEditingColumn(null)}
        onSuccess={() => data.onRefresh?.()}
      />
    </div>
  );
};

export default memo(TableNode);
