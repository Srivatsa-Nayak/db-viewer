import { describe, expect, it } from 'vitest';
import {
    describeWhen, forgetAllHistory, forgetHistory, loadHistory, MAX_ENTRIES, MAX_SQL_LENGTH, recordRun,
} from '@/services/queryHistory';

const memoryStorage = () => {
    const data = new Map<string, string>();
    return {
        getItem: (k: string) => data.get(k) ?? null,
        setItem: (k: string, v: string) => { data.set(k, v); },
        removeItem: (k: string) => { data.delete(k); },
        size: () => data.size,
    };
};

describe('queryHistory', () => {
    it('keeps the most recent run first, per file', () => {
        const s = memoryStorage();
        recordRun('fileA', 'SELECT 1', true, s, 1);
        recordRun('fileA', 'SELECT 2', false, s, 2);
        recordRun('fileB', 'SELECT 3', true, s, 3);

        expect(loadHistory('fileA', s).map(e => e.sql)).toEqual(['SELECT 2', 'SELECT 1']);
        expect(loadHistory('fileA', s)[0].ok).toBe(false);
        expect(loadHistory('fileB', s).map(e => e.sql)).toEqual(['SELECT 3']);
    });

    it('moves a repeated script to the top instead of listing it twice', () => {
        const s = memoryStorage();
        recordRun('f', 'SELECT 1', true, s, 1);
        recordRun('f', 'SELECT 2', true, s, 2);
        recordRun('f', '  SELECT 1  ', true, s, 3);
        expect(loadHistory('f', s).map(e => e.sql)).toEqual(['SELECT 1', 'SELECT 2']);
    });

    it('is capped in length and ignores blank or enormous scripts', () => {
        const s = memoryStorage();
        for (let i = 0; i < MAX_ENTRIES + 10; i++) recordRun('f', `SELECT ${i}`, true, s, i);
        expect(loadHistory('f', s)).toHaveLength(MAX_ENTRIES);

        recordRun('f', '   ', true, s);
        recordRun('f', 'x'.repeat(MAX_SQL_LENGTH + 1), true, s);
        expect(loadHistory('f', s)[0].sql).toBe(`SELECT ${MAX_ENTRIES + 9}`);
    });

    it('forgets one file, or everything', () => {
        const s = memoryStorage();
        recordRun('a', 'SELECT 1', true, s);
        recordRun('b', 'SELECT 2', true, s);
        forgetHistory('a', s);
        expect(loadHistory('a', s)).toEqual([]);
        expect(loadHistory('b', s)).toHaveLength(1);
        forgetAllHistory(s);
        expect(s.size()).toBe(0);
    });

    it('survives a corrupted store and no store at all', () => {
        const s = memoryStorage();
        s.setItem('sql-visualizer.query-history', '{not json');
        expect(loadHistory('f', s)).toEqual([]);
        // Without storage the run is still shown for this session; it is just not kept.
        expect(recordRun('f', 'SELECT 1', true, null)).toHaveLength(1);
        expect(loadHistory('f', null)).toEqual([]);
    });

    it('describes when, roughly', () => {
        const now = 10_000_000;
        expect(describeWhen(now - 10_000, now)).toBe('just now');
        expect(describeWhen(now - 5 * 60_000, now)).toBe('5 min ago');
        expect(describeWhen(now - 3 * 3_600_000, now)).toBe('3 h ago');
    });
});
