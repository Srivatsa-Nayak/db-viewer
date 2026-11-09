import { describe, expect, it } from 'vitest';
import { parseBlocks } from '@/components/chat/ChatAnswer';

/**
 * How an assistant answer is split into prose and SQL.
 *
 * The SQL blocks are what carry the "Open in scratchpad" button, so a block mis-split here is a
 * statement the user is invited to run with half of it missing.
 */
describe('parseBlocks', () => {
    it('separates prose from a fenced SQL block', () => {
        const blocks = parseBlocks('Add this:\n```sql\nCREATE TABLE t (id INT);\n```\nDone.');

        expect(blocks).toEqual([
            { kind: 'text', text: 'Add this:\n' },
            { kind: 'code', language: 'sql', code: 'CREATE TABLE t (id INT);', open: false },
            { kind: 'text', text: '\nDone.' },
        ]);
    });

    it('marks a block still being streamed as open, so it is not offered for running', () => {
        const blocks = parseBlocks('Here:\n```sql\nCREATE TABLE half (');

        expect(blocks.at(-1)).toMatchObject({ kind: 'code', open: true, code: 'CREATE TABLE half (' });
    });

    it('treats an unlabelled fence as SQL and keeps other languages as they are', () => {
        expect(parseBlocks('```\nSELECT 1;\n```')[0]).toMatchObject({ language: 'sql' });
        expect(parseBlocks('```json\n{}\n```')[0]).toMatchObject({ language: 'json' });
    });

    it('handles several blocks and prose with no blocks at all', () => {
        expect(parseBlocks('a\n```sql\nx\n```\nb\n```sql\ny\n```').filter(b => b.kind === 'code')).toHaveLength(2);
        expect(parseBlocks('just words')).toEqual([{ kind: 'text', text: 'just words' }]);
        expect(parseBlocks('')).toEqual([]);
    });
});
