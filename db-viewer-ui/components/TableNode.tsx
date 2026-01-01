import React, { memo } from 'react';
import { Handle, Position } from 'reactflow';
import { Database, KeyRound } from 'lucide-react';

// Define the shape of a column with its type
interface ColumnData {
  name: string;
  type: string;
}

const TableNode = ({ data }: { data: { label: string; columns: ColumnData[] } }) => {
  return (
    <div className="bg-white dark:bg-slate-900 border-2 border-slate-300 dark:border-slate-700 rounded-lg min-w-[220px] shadow-xl overflow-hidden transition-colors duration-200">
      
      {/* Header */}
      <div className="bg-indigo-600 p-2 text-white font-bold flex items-center gap-2 border-b border-indigo-500">
        <Database size={16} />
        <span className="text-sm">{data.label}</span>
      </div>
      
      {/* Columns List */}
      <div className="p-2 bg-slate-50 dark:bg-slate-900">
        {data.columns.map((col, i) => (
          <div key={i} className="flex justify-between items-center py-1.5 px-2 border-b border-slate-200 dark:border-slate-800 last:border-0 hover:bg-slate-100 dark:hover:bg-slate-800/50 transition-colors">
            
            {/* LEFT: Column Name */}
            <div className="flex items-center gap-2">
               {/* Show a Key icon if it looks like an ID */}
              {(col.name === 'id' || col.name.endsWith('_id')) && (
                <KeyRound size={10} className="text-amber-500" /> 
              )}
              {/* FIX IS HERE: We render {col.name}, not {col} */}
              <span className="text-slate-700 dark:text-slate-300 text-xs font-medium">
                {col.name}
              </span>
            </div>

            {/* RIGHT: Column Type */}
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