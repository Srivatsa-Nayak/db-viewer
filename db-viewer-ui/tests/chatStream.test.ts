import { afterEach, describe, expect, it, vi } from 'vitest';
import { chatService } from '@/services/api';

/**
 * The browser side of the assistant's stream: reading server-sent events off `fetch`.
 *
 * Driven with a fake `fetch` whose body arrives in arbitrary chunks, because the real network
 * splits frames wherever it likes — mid-JSON, mid-line — and the reader has to reassemble them.
 */

const encoder = new TextEncoder();

/** A `fetch` that answers with `chunks`, one `read()` each. */
const fakeFetch = (chunks: string[], status = 200, contentType = 'text/event-stream') =>
    vi.fn(async () => {
        if (status !== 200) {
            return new Response(chunks.join(''), { status, headers: { 'Content-Type': 'application/json' } });
        }
        const stream = new ReadableStream<Uint8Array>({
            start(controller) {
                for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
                controller.close();
            },
        });
        return new Response(stream, { status, headers: { 'Content-Type': contentType } });
    });

const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

const collect = () => {
    const seen = { deltas: [] as string[], errors: [] as string[], meta: 0, truncated: 0, unauthorized: 0 };
    return {
        seen,
        handlers: {
            onMeta: () => { seen.meta++; },
            onDelta: (text: string) => { seen.deltas.push(text); },
            onError: (message: string) => { seen.errors.push(message); },
            onTruncated: () => { seen.truncated++; },
            onUnauthorized: () => { seen.unauthorized++; },
        },
    };
};

afterEach(() => { vi.unstubAllGlobals(); });

describe('chatService.stream', () => {
    it('reassembles frames split across chunks', async () => {
        const body = frame('meta', { model: 'm', usingOwnKey: false })
            + frame('delta', { text: 'Hel' }) + frame('delta', { text: 'lo' })
            + frame('done', { characters: 5, truncated: false });
        // Cut the stream at awkward places: inside a frame, inside the JSON.
        vi.stubGlobal('fetch', fakeFetch([body.slice(0, 7), body.slice(7, 60), body.slice(60, 61), body.slice(61)]));
        const { seen, handlers } = collect();

        await chatService.stream('q', [], handlers);

        expect(seen.meta).toBe(1);
        expect(seen.deltas.join('')).toBe('Hello');
        expect(seen.errors).toEqual([]);
    });

    it('reports a truncated answer without calling it an error', async () => {
        vi.stubGlobal('fetch', fakeFetch([frame('delta', { text: 'CREATE' }), frame('done', { truncated: true })]));
        const { seen, handlers } = collect();

        await chatService.stream('q', [], handlers);

        expect(seen.truncated).toBe(1);
        expect(seen.errors).toEqual([]);
    });

    /** A stream that just stops used to look exactly like a finished answer. */
    it('says so when the stream ends without done or error', async () => {
        vi.stubGlobal('fetch', fakeFetch([frame('delta', { text: 'Half an ans' })]));
        const { seen, handlers } = collect();

        await chatService.stream('q', [], handlers);

        expect(seen.errors).toHaveLength(1);
        expect(seen.errors[0]).toMatch(/ended before the answer finished/);
    });

    it('passes an error frame through and stops', async () => {
        vi.stubGlobal('fetch', fakeFetch([frame('error', { message: 'Rate limited' }), frame('delta', { text: 'ignored' })]));
        const { seen, handlers } = collect();

        await chatService.stream('q', [], handlers);

        expect(seen.errors).toEqual(['Rate limited']);
        expect(seen.deltas).toEqual([]);
    });

    it('reads a JSON refusal before the stream, and flags an expired session', async () => {
        vi.stubGlobal('fetch', fakeFetch([JSON.stringify({ error: 'Create a free account to use this feature.' })], 401));
        const { seen, handlers } = collect();

        await chatService.stream('q', [], handlers);

        expect(seen.errors).toEqual(['Create a free account to use this feature.']);
        expect(seen.unauthorized).toBe(1);
    });

    it('shows a spent quota as the server worded it', async () => {
        vi.stubGlobal('fetch', fakeFetch([JSON.stringify({ error: 'You have used today’s 100 questions', retryAfter: 60 })], 429));
        const { seen, handlers } = collect();

        await chatService.stream('q', [], handlers);

        expect(seen.errors[0]).toMatch(/100 questions/);
        expect(seen.unauthorized).toBe(0);
    });
});
