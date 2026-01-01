import React, { memo, useState } from 'react';
import { Handle, Position } from 'reactflow';
import { Database, KeyRound, Plus, Download, X, Check } from 'lucide-react';
import { dbService } from '@/services/api';

interface TableNodeData {
  label: string;
  columns: ColumnData[];
  onRefresh: () => void; 
}

interface ColumnData {
  name: string;
  type: string;
}

const TableNode = ({ data }: { data: TableNodeData }) => {
  // Local state for the "Add Column" form
  const [isAdding, setIsAdding] = useState(false);
  const [newColName, setNewColName] = useState("");
  const [newColType, setNewColType] = useState("TEXT");
  const [isLoading, setIsLoading] = useState(false);

  const handleAddColumn = async () => {
    if (!newColName) return;
    setIsLoading(true);
    try {
        await dbService.addColumn({
            tableName: data.label,
            columnName: newColName,
            columnType: newColType
        });
        // We trigger a global refresh via a custom event or callback passed in data
        // For MVP, we can reload window or dispatch an event
        if (data.onRefresh) {
            data.onRefresh(); 
        }

        setIsAdding(false);
        setNewColName("");
    } catch (err) {
        alert("Failed to add column");
    } finally {
        setIsLoading(false);
    }
  };

  const handleDownload = () => {
      // Trigger browser download
      window.open(dbService.getDownloadUrl(data.label), '_blank');
  };

  return (
    <div className="bg-white dark:bg-slate-900 border-2 border-slate-300 dark:border-slate-700 rounded-lg min-w-[240px] shadow-xl overflow-hidden transition-colors duration-200">
      
      {/* Header */}
      <div className="bg-indigo-600 p-2 text-white font-bold flex items-center justify-between border-b border-indigo-500">
        <div className="flex items-center gap-2">
            <Database size={16} />
            <span className="text-sm">{data.label}</span>
        </div>
        <div className="flex gap-1">
            <button 
                onClick={() => setIsAdding(!isAdding)} 
                className="p-1 hover:bg-indigo-500 rounded transition-colors"
                title="Add Column"
            >
                <Plus size={14} />
            </button>
            <button 
                onClick={handleDownload}
                className="p-1 hover:bg-indigo-500 rounded transition-colors"
                title="Download CSV"
            >
                <Download size={14} />
            </button>
        </div>
      </div>
      
      {/* Add Column Form */}
      {isAdding && (
          <div className="p-2 bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
              <input 
                className="w-full text-xs p-1 mb-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 dark:text-white"
                placeholder="Column Name"
                value={newColName}
                onChange={(e) => setNewColName(e.target.value)}
              />
              <div className="flex gap-1">
                  <select 
                    className="flex-1 text-xs p-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 dark:text-white"
                    value={newColType}
                    onChange={(e) => setNewColType(e.target.value)}
                  >
                      <option value="VARCHAR">VARCHAR</option>
                      <option value="INT">INT</option>
                      <option value="DECIMAL">DECIMAL</option>
                      <option value="BOOLEAN">BOOL</option>
                  </select>
                  <button 
                    onClick={handleAddColumn}
                    disabled={isLoading}
                    className="bg-green-600 hover:bg-green-700 text-white p-1 rounded"
                  >
                      <Check size={14} />
                  </button>
                  <button 
                    onClick={() => setIsAdding(false)}
                    className="bg-red-500 hover:bg-red-600 text-white p-1 rounded"
                  >
                      <X size={14} />
                  </button>
              </div>
          </div>
      )}

      {/* Columns List */}
      <div className="p-2 bg-slate-50 dark:bg-slate-900 max-h-[200px] overflow-y-auto">
        {data.columns.map((col, i) => (
          <div key={i} className="flex justify-between items-center py-1.5 px-2 border-b border-slate-200 dark:border-slate-800 last:border-0 hover:bg-slate-100 dark:hover:bg-slate-800/50 transition-colors">
            <div className="flex items-center gap-2">
              {(col.name === 'id' || col.name.endsWith('_id')) && (
                <KeyRound size={10} className="text-amber-500" /> 
              )}
              <span className="text-slate-700 dark:text-slate-300 text-xs font-medium">
                {col.name}
              </span>
            </div>
            <span className="text-xs text-slate-400 font-mono uppercase tracking-tighter">
              {col.type}
            </span>
          </div>
        ))}
      </div>

      <Handle type="target" position={Position.Left} className="!bg-indigo-500 !w-3 !h-3" />
      <Handle type="source" position={Position.Right} className="!bg-indigo-500 !w-3 !h-3" />
    </div>
  );
};

export default memo(TableNode);