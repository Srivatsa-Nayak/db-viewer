import React, { memo, useState } from 'react';
import { Handle, Position } from 'reactflow';
import { Database, KeyRound, Plus, Download, X, Check, Edit3 } from 'lucide-react';
import { dbService } from '@/services/api';

interface ColumnData {
  name: string;
  type: string;
}

interface TableNodeData {
  label: string;
  columns: ColumnData[];
  onRefresh: () => void;
  onEdit: (tableName: string) => void;
}

const TableNode = ({ data }: { data: TableNodeData }) => {
  // Local state for "Add Column"
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

  const handleDownload = (e: React.MouseEvent) => {
      e.stopPropagation();
      window.open(dbService.getDownloadUrl(data.label), '_blank');
  };

  return (
    // CONTAINER: Theme-aware, Compact, Shadowed
    <div className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-md min-w-[180px] max-w-[220px] shadow-xl dark:shadow-md overflow-hidden transition-all duration-200">
      
      {/* HEADER: Indigo brand color */}
      <div className="bg-indigo-600 dark:bg-indigo-700 px-2 py-1.5 flex items-center justify-between">
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
              className="p-0.5 hover:bg-indigo-500 rounded text-white/80 hover:text-white transition-colors"
              title="Edit Data"
           >
              <Edit3 size={10} />
           </button>
           <button 
              onClick={(e) => { e.stopPropagation(); setIsAdding(!isAdding); }} 
              className="p-0.5 hover:bg-indigo-500 rounded text-white/80 hover:text-white transition-colors"
              title="Add Column"
           >
              <Plus size={10} />
           </button>
           <button 
              onClick={handleDownload}
              className="p-0.5 hover:bg-indigo-500 rounded text-white/80 hover:text-white transition-colors"
              title="Download CSV"
           >
              <Download size={10} />
           </button>
        </div>
      </div>
      
      {/* ADD COLUMN FORM (Compact) */}
      {isAdding && (
          <div className="p-1.5 bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
              <input 
                className="w-full text-[9px] p-1 mb-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white outline-none focus:border-indigo-500"
                placeholder="Column Name"
                value={newColName}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setNewColName(e.target.value)}
              />
              <div className="flex gap-1">
                  <select 
                    className="flex-1 text-[9px] p-0.5 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white outline-none"
                    value={newColType}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setNewColType(e.target.value)}
                  >
                      <option value="VARCHAR">TEXT</option>
                      <option value="INT">INT</option>
                      <option value="DECIMAL">DEC</option>
                      <option value="BOOLEAN">BOOL</option>
                  </select>
                  <button 
                    onClick={(e) => { e.stopPropagation(); handleAddColumn(); }}
                    disabled={isLoading}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white p-0.5 rounded"
                  >
                      <Check size={10} />
                  </button>
                  <button 
                    onClick={(e) => { e.stopPropagation(); setIsAdding(false); }}
                    className="bg-rose-500 hover:bg-rose-600 text-white p-0.5 rounded"
                  >
                      <X size={10} />
                  </button>
              </div>
          </div>
      )}

      {/* COLUMNS LIST */}
      <div className="flex flex-col bg-slate-50 dark:bg-slate-950/50 py-0.5">
        {data.columns.map((col, i) => (
          <div key={i} className="group relative flex justify-between items-center px-2 py-0.5 hover:bg-indigo-50 dark:hover:bg-slate-800 transition-colors h-[22px]">
            
            {/* Left Handle (Target) */}
            <div className="absolute -left-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
                <Handle type="target" position={Position.Left} id={`${col.name}-left`} className="!w-1.5 !h-1.5 !bg-indigo-500" />
            </div>

            {/* Column Name */}
            <div className="flex items-center gap-1.5 overflow-hidden">
              {(col.name === 'id' || col.name.endsWith('_id')) && (
                 <KeyRound size={8} className="text-amber-500 shrink-0" /> 
              )}
              <span className="truncate font-mono text-[9px] text-slate-700 dark:text-slate-300 leading-none font-medium">
                {col.name}
              </span>
            </div>
            
            {/* Column Type */}
            <span className="text-slate-400 dark:text-slate-500 font-mono uppercase text-[8px] shrink-0 ml-2 leading-none">
              {col.type}
            </span>

             {/* Right Handle (Source) */}
            <div className="absolute -right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
                <Handle type="source" position={Position.Right} id={`${col.name}-right`} className="!w-1.5 !h-1.5 !bg-indigo-500" />
            </div>

          </div>
        ))}
      </div>
    </div>
  );
};

export default memo(TableNode);