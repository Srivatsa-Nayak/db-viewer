import { useState } from 'react';
import { dbService } from '@/services/api';

export const useQuery = () => {
    const [query, setQuery] = useState("SELECT * FROM users LIMIT 10;");
    const [results, setResults] = useState<any[]>([]);
    const [error, setError] = useState("");
    const [isLoading, setIsLoading] = useState(false);

    const runQuery = async () => {
        setIsLoading(true);
        setError("");
        setResults([]);
        try {
            const response = await dbService.runQuery(query);
            setResults(response.data || []);
        } catch (err: any) {
            setError(err.response?.data?.error || "Query execution failed");
        } finally {
            setIsLoading(false);
        }
    };

    return {
        query,
        setQuery,
        results,
        error,
        isLoading,
        runQuery
    };
};