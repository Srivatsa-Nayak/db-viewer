import { AlertCircle } from 'lucide-react'; // Optional: Add icon for error

interface ResultsTableProps {
    data: any[];
    error: string;
}

export const ResultsTable = ({ data, error }: ResultsTableProps) => {
    return (
        // CHANGED: 'h-1/2' -> 'flex-1'
        <div className="flex-1 flex flex-col overflow-hidden bg-slate-950 min-h-0">
            <div className="p-2 bg-slate-900 border-b border-slate-800">
                <span className="text-xs font-bold text-slate-400">RESULTS</span>
            </div>
            <div className="flex-1 overflow-auto p-4">
                {error && (
                    <div className="text-red-400 text-sm font-mono bg-red-900/20 p-4 rounded border border-red-900 flex items-center gap-2">
                        <AlertCircle size={16} /> Error: {error}
                    </div>
                )}
                {!error && data.length > 0 ? (
                    <table className="w-full text-left text-sm border-collapse">
                        <thead>
                            <tr>
                                {Object.keys(data[0]).map((key) => (
                                    <th key={key} className="border-b border-slate-700 p-2 text-slate-400 font-medium sticky top-0 bg-slate-950">
                                        {key}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {data.map((row, i) => (
                                <tr key={i} className="hover:bg-slate-900/50 transition-colors">
                                    {Object.values(row).map((val: any, j) => (
                                        <td key={j} className="border-b border-slate-800 p-2 text-slate-300">
                                            {val}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                ) : (
                    !error && <div className="text-slate-600 text-center mt-10">Run a query to see results</div>
                )}
            </div>
        </div>
    );
};