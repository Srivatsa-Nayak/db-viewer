import React, { memo, useState } from 'react';
import { Handle, Position } from 'reactflow';
import { Database, KeyRound, Plus, Download, X, Check, Edit3, AlertCircle, Info } from 'lucide-react';
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
  const [newColType, setNewColType] = useState("VARCHAR");
  const [isLoading, setIsLoading] = useState(false);

  const [colLength, setColLength] = useState(128);
  const [isNotNull, setIsNotNull] = useState(false);

  // Global Error Modal State
  const [errorModal, setErrorModal] = useState<{ isOpen: boolean, message: string }>({
    isOpen: false,
    message: ""
  });

  const handleAddColumn = async () => {
    if (!newColName) return;
    setIsLoading(true);
    try {
      await dbService.addColumn({
        tableName: data.label,
        columnName: newColName,
        columnType: newColType,
        length: colLength,
        notNull: isNotNull
      });
      if (data.onRefresh) {
        data.onRefresh();
      }
      setIsAdding(false);
      setNewColName("");
      setColLength(128);
      setIsNotNull(false);
    } catch (err) {
      // alert("Failed to add column");
      setErrorModal({
        isOpen: true,
        message: "Failed to add a column, Please try again."
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    window.open(dbService.getDownloadUrl(data.label), '_blank');
  };

  return (
    // CONTAINER: overflow-hidden REMOVED so dots can sit outside
    <div className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-md min-w-[180px] max-w-[220px] shadow-xl dark:shadow-md transition-all duration-200 group/node">

      {/* HEADER: Added rounded-t-md */}
      <div className="bg-indigo-600 dark:bg-indigo-700 px-2 py-1.5 flex items-center justify-between rounded-t-md">
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

      {/* ADD COLUMN FORM */}
      {isAdding && (
        <div className="p-2 bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 flex flex-col gap-2">
            
            {/* 1. Name Input */}
            <input
                className="w-full text-[10px] p-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white outline-none focus:border-indigo-500"
                placeholder="Column Name"
                value={newColName}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setNewColName(e.target.value)}
            />

            <div className="flex gap-1">
                {/* 2. Type Select */}
                <select
                    className="flex-1 text-[9px] p-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white outline-none"
                    value={newColType}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setNewColType(e.target.value)}
                >
                    <option value="VARCHAR">VARCHAR</option>
                    <option value="INT">INT</option>
                    <option value="DECIMAL">DECIMAL</option>
                    <option value="BOOLEAN">BOOL</option>
                    <option value="DATE">DATE</option>
                    <option value="TIME">TIME</option>
                    <option value="DATETIME">DATETIME</option>
                </select>

                {/* 3. Length Select */}
                {newColType === 'VARCHAR' && (
                    <select
                        className="w-14 text-[9px] p-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white outline-none"
                        value={colLength}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setColLength(Number(e.target.value))}
                    >
                        <option value={64}>64</option>
                        <option value={128}>128</option>
                        <option value={256}>256</option>
                    </select>
                )}
            </div>

            {/* 4. Required Checkbox + Buttons */}
            <div className="flex justify-between items-center mt-1">
                <div className="flex items-center gap-1.5">
                    <label className="flex items-center gap-1 cursor-pointer" onClick={(e) => e.stopPropagation()}>
                        <input 
                            type="checkbox" 
                            checked={isNotNull} 
                            onChange={(e) => setIsNotNull(e.target.checked)}
                            className="rounded border-slate-600 bg-slate-700 text-indigo-500 w-3 h-3 focus:ring-0 focus:ring-offset-0"
                        />
                        <span className="text-[9px] text-slate-500 dark:text-slate-400 font-medium">Required</span>
                    </label>
                    <div className="relative group flex items-center justify-center cursor-help text-slate-500 hover:text-indigo-400 transition-colors">
                        <Info size={10} />
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-32 p-2 bg-slate-800 text-slate-200 text-[9px] leading-tight rounded-md shadow-xl border border-slate-700 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
                            Enforces NOT NULL. Prevents empty values.
                            <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-[1px] border-4 border-transparent border-t-slate-800"></div>
                        </div>
                    </div>
                </div>
                
                <div className="flex gap-1">
                    <button onClick={(e) => { e.stopPropagation(); handleAddColumn(); }} disabled={isLoading} className="bg-emerald-600 hover:bg-emerald-700 text-white p-1 rounded"><Check size={12} /></button>
                    <button onClick={(e) => { e.stopPropagation(); setIsAdding(false); }} className="bg-rose-500 hover:bg-rose-600 text-white p-1 rounded"><X size={12} /></button>
                </div>
            </div>
        </div>
      )}

      {/* COLUMNS LIST */}
      <div className="flex flex-col bg-slate-50 dark:bg-slate-950/50 py-0.5 rounded-b-md">
        {data.columns.map((col, i) => (
          <div key={i} className="group relative flex justify-between items-center px-2 py-0.5 hover:bg-indigo-50 dark:hover:bg-slate-800 transition-colors h-[22px]">

            {/* LEFT HANDLE (Target): Only if column ends in _id (Foreign Key) but is not "id" */}
            {(col.name !== 'id' && col.name.endsWith('_id')) && (
                <div className="absolute -left-1.5 top-1/2 -translate-y-1/2 z-50">
                    <Handle type="target" position={Position.Left} id={`${col.name}-left`} className="!w-2.5 !h-2.5 !bg-indigo-500 !border-2 !border-slate-900" />
                </div>
            )}

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

            {/* RIGHT HANDLE (Source): If it's 'id' OR ends in '_id' (allows referencing table_id from another table) */}
            {(col.name === 'id' || col.name.endsWith('_id')) && (
                <div className="absolute -right-1.5 top-1/2 -translate-y-1/2 z-50">
                    <Handle type="source" position={Position.Right} id={`${col.name}-right`} className="!w-2.5 !h-2.5 !bg-indigo-500 !border-2 !border-slate-900" />
                </div>
            )}

          </div>
        ))}
      </div>

      {errorModal.isOpen && (
        <div className="absolute inset-0 bg-slate-900/95 z-50 flex flex-col items-center justify-center p-4 text-center animate-in fade-in zoom-in duration-200">
          <AlertCircle size={24} className="text-red-500 mb-2" />
          <h4 className="text-white font-bold text-xs mb-1">Error</h4>
          <p className="text-slate-400 text-[10px] leading-tight mb-3 px-1">{errorModal.message}</p>
          <button
            onClick={(e) => { e.stopPropagation(); setErrorModal({ ...errorModal, isOpen: false }); }}
            className="bg-slate-800 hover:bg-slate-700 text-white text-[10px] px-3 py-1 rounded border border-slate-700 transition-colors"
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
};

export default memo(TableNode);