import React from 'react';

/**
 * SQL syntax colouring, shared by the scratchpad editor and the assistant's code blocks.
 *
 * Moved out of `SqlScratchpad` so that SQL the assistant writes looks the same as the SQL it
 * opens in the scratchpad: two highlighters would drift, and the moment they disagreed the
 * hand-off would look like it had changed the statement.
 */

/** Only what a scratchpad needs: enough to see structure at a glance. */
const KEYWORDS = new Set([
    'SELECT', 'FROM', 'WHERE', 'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE', 'CREATE',
    'TABLE', 'VIEW', 'INDEX', 'DROP', 'ALTER', 'ADD', 'COLUMN', 'JOIN', 'LEFT', 'RIGHT', 'INNER',
    'OUTER', 'ON', 'AS', 'AND', 'OR', 'NOT', 'NULL', 'IS', 'IN', 'LIKE', 'ORDER', 'BY', 'GROUP',
    'HAVING', 'LIMIT', 'OFFSET', 'DISTINCT', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'PRIMARY',
    'KEY', 'FOREIGN', 'REFERENCES', 'UNIQUE', 'DEFAULT', 'CHECK', 'CASCADE', 'INTEGER', 'TEXT',
    'VARCHAR', 'BOOLEAN', 'DATE', 'DATETIME', 'REAL', 'BLOB', 'IF', 'EXISTS', 'PRAGMA', 'WITH',
    'UNION', 'ALL', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'ASC', 'DESC', 'REPLACE', 'RENAME',
    'TO', 'AUTOINCREMENT', 'BEGIN', 'COMMIT', 'TRANSACTION',
]);

/**
 * Splits SQL into spans.
 *
 * Order matters: comments and strings are consumed whole, before anything inside them can be
 * mistaken for a keyword. `SELECT` inside `'a SELECT string'` must not light up.
 */
const TOKEN = /(--[^\n]*|\/\*[\s\S]*?\*\/)|('(?:[^']|'')*')|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z0-9_]*)/g;

export const highlightSql = (sql: string): React.ReactNode[] => {
    const out: React.ReactNode[] = [];
    let last = 0;
    let key = 0;

    for (const match of sql.matchAll(TOKEN)) {
        const [text, comment, string, num, word] = match;
        const at = match.index ?? 0;
        if (at > last) out.push(sql.slice(last, at));

        if (comment) out.push(<span key={key++} className="text-ink-400 italic">{text}</span>);
        else if (string) out.push(<span key={key++} className="text-emerald-600">{text}</span>);
        else if (num) out.push(<span key={key++} className="text-amber-600">{text}</span>);
        else if (word && KEYWORDS.has(word.toUpperCase())) {
            out.push(<span key={key++} className="text-brand-600 font-semibold">{text}</span>);
        } else out.push(text);

        last = at + text.length;
    }
    out.push(sql.slice(last));
    return out;
};
