#!/usr/bin/env node
/**
 * An eval set for the schema assistant, run against a live backend.
 *
 * Applies three bundled templates to fresh workspaces, asks the assistant questions about each,
 * and grades every answer with a deterministic check — no second model judging the first:
 *
 *   - summary         names at least two of the file's real tables
 *   - fake-column     says a column that does not exist does not exist
 *   - fake-table      says a table that does not exist does not exist
 *   - no-data         says it cannot see row values
 *   - add-column-sql  writes SQL that actually runs in the scratchpad
 *   - retype-sql      writes SQLite DDL for a type change that actually runs (the rebuild case)
 *
 * Every question is a real model call, so a run costs money. Use your own OpenRouter key
 * (EVAL_OPENROUTER_KEY) or a local backend started with LLM_QUOTA_PER_HOUR=0: the app key's
 * default limit of 20 questions an hour per user is lower than one full run.
 *
 * Usage (Node 18+, backend running):
 *   EVAL_EMAIL=evals@example.com EVAL_PASSWORD='An-eval-password1!' \
 *   EVAL_OPENROUTER_KEY=sk-or-... EVAL_MODEL=openai/gpt-4o \
 *   node evals/run-evals.mjs [--base http://localhost:8080] [--templates ecommerce,blog,library]
 *
 * Writes evals/results/<timestamp>.json and prints a table. Exit code 1 when anything failed.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, arg, i, all) => {
    if (arg.startsWith('--')) pairs.push([arg.slice(2), all[i + 1]]);
    return pairs;
}, []));
const BASE = (args.base ?? process.env.EVAL_BASE_URL ?? 'http://localhost:8080').replace(/\/$/, '');
const TEMPLATES = (args.templates ?? 'ecommerce,blog,library').split(',').map(t => t.trim()).filter(Boolean);
const EMAIL = process.env.EVAL_EMAIL ?? 'schema-assistant-evals@example.com';
const PASSWORD = process.env.EVAL_PASSWORD ?? 'Schema-Evals-2026!';
const CLIENT_ID = `evals-${Date.now()}`;

let token = null;

const headers = (workspace) => ({
    'Content-Type': 'application/json',
    'X-Client-Id': CLIENT_ID,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(workspace ? { 'X-Workspace-Id': workspace } : {}),
});

async function call(method, path, { body, workspace } = {}) {
    const res = await fetch(BASE + path, {
        method, headers: headers(workspace), body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    return { status: res.status, json, text };
}

async function signIn() {
    let res = await call('POST', '/auth/login', { body: { email: EMAIL, password: PASSWORD } });
    if (res.status === 401) {
        res = await call('POST', '/auth/signup', { body: { email: EMAIL, password: PASSWORD, displayName: 'Evals' } });
    }
    if (res.status !== 200 || !res.json?.token) {
        throw new Error(`Could not sign in as ${EMAIL}: ${res.status} ${res.text}`);
    }
    token = res.json.token;

    if (process.env.EVAL_OPENROUTER_KEY) {
        const saved = await call('PUT', '/auth/api-key', {
            body: { provider: 'OPENROUTER', apiKey: process.env.EVAL_OPENROUTER_KEY, model: process.env.EVAL_MODEL },
        });
        if (saved.status !== 200) throw new Error(`Could not save the OpenRouter key: ${saved.text}`);
    }
    const config = await call('GET', '/chat/config');
    if (!config.json?.available) throw new Error(`The assistant is not available: ${config.text}`);
    return config.json;
}

/** Asks one question and reads the SSE stream to the end. */
async function ask(workspace, question) {
    const res = await fetch(`${BASE}/chat`, {
        method: 'POST', headers: headers(workspace), body: JSON.stringify({ message: question, history: [] }),
    });
    if (!res.ok) return { error: `${res.status} ${await res.text()}`, text: '' };

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let text = '';
    let error = null;
    let truncated = false;
    for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split('\n\n');
        buffer = frames.pop() ?? '';
        for (const frame of frames) {
            let event = 'message';
            let data = '';
            for (const line of frame.split('\n')) {
                if (line.startsWith('event:')) event = line.slice(6).trim();
                else if (line.startsWith('data:')) data += line.slice(5).trim();
            }
            if (!data) continue;
            const parsed = JSON.parse(data);
            if (event === 'delta') text += parsed.text;
            if (event === 'error') error = parsed.message;
            if (event === 'done') truncated = parsed.truncated === true;
        }
    }
    return { text, error, truncated };
}

const sqlBlocks = (text) => [...text.matchAll(/```(?:sql)?\s*\n([\s\S]*?)```/gi)].map(m => m[1].trim());

const SAYS_MISSING = /(doesn['’]t|does not|isn['’]t|is not|no (such )?)(exist|column|table|in the schema|part of)|not (in|part of) (the|this) schema|there is no|there['’]s no|can['’]t find|cannot find|not present/i;
const SAYS_NO_DATA = /(can['’]?not|can['’]t|don['’]t|do not|unable to) (see|access|view|read)|only (see|have|shown) (the )?(schema|structure)|structure only|no access to (the )?(data|rows|values)/i;

async function runSql(workspace, sql) {
    const res = await call('POST', '/scratchpad', { body: { script: sql }, workspace });
    if (res.status !== 200) return { ok: false, detail: res.json?.error ?? res.text };
    const failed = (res.json?.statements ?? []).find(s => s.error);
    return failed ? { ok: false, detail: failed.error } : { ok: true, detail: `${res.json?.statements?.length ?? 0} statement(s)` };
}

function casesFor(schema) {
    const tables = schema.tables.filter(t => !t.view);
    const table = tables.find(t => t.columns.length >= 3) ?? tables[0];
    const column = table.columns.find(c => !(c.isPk ?? c.is_pk)) ?? table.columns[0];
    const names = tables.map(t => t.name);

    return [
        {
            id: 'summary',
            question: 'Summarise this schema in a few sentences.',
            grade: (a) => {
                const mentioned = names.filter(n => a.text.toLowerCase().includes(n.toLowerCase()));
                return { pass: mentioned.length >= Math.min(2, names.length), detail: `mentions ${mentioned.length}/${names.length} tables` };
            },
        },
        {
            id: 'fake-column',
            question: `What does the column ${table.name}.zz_loyalty_tier_override do?`,
            grade: (a) => ({ pass: SAYS_MISSING.test(a.text), detail: 'should say the column does not exist' }),
        },
        {
            id: 'fake-table',
            question: `How is the warehouse_robots table related to ${table.name}?`,
            grade: (a) => ({ pass: SAYS_MISSING.test(a.text), detail: 'should say the table does not exist' }),
        },
        {
            id: 'no-data',
            question: `What are the actual values stored in ${table.name}.${column.name}?`,
            grade: (a) => ({ pass: SAYS_NO_DATA.test(a.text), detail: 'should say it cannot see row values' }),
        },
        {
            id: 'add-column-sql',
            question: `Write the SQL to add a nullable text column named eval_note to ${table.name}. Reply with the SQL only.`,
            runsSql: true,
        },
        {
            id: 'retype-sql',
            question: `Write the SQL to change the type of ${table.name}.${column.name} to TEXT, keeping all its rows. Reply with the SQL only.`,
            runsSql: true,
        },
    ];
}

async function main() {
    const config = await signIn();
    console.log(`Evaluating ${config.model} (${config.usingOwnKey ? 'own key' : 'app key'}) at ${BASE}\n`);

    const results = [];
    for (const template of TEMPLATES) {
        const workspace = `eval${template.replace(/[^a-z0-9]/gi, '')}${Date.now()}`;
        const applied = await call('POST', `/templates/${template}/apply`, { workspace });
        if (applied.status !== 200) {
            results.push({ template, id: 'setup', pass: false, detail: applied.text });
            continue;
        }
        const schema = (await call('GET', '/db-info', { workspace })).json;

        for (const evalCase of casesFor(schema)) {
            const started = Date.now();
            const answer = await ask(workspace, evalCase.question);
            let verdict;
            if (answer.error) {
                verdict = { pass: false, detail: `assistant error: ${answer.error}` };
            } else if (evalCase.runsSql) {
                const [sql] = sqlBlocks(answer.text);
                verdict = sql ? await runSql(workspace, sql) : { ok: false, detail: 'no ```sql block in the answer' };
                verdict = { pass: verdict.ok, detail: verdict.detail };
            } else {
                verdict = evalCase.grade(answer);
            }
            if (answer.truncated) verdict.detail += ' (answer was truncated)';
            results.push({
                template, id: evalCase.id, pass: verdict.pass, detail: verdict.detail,
                ms: Date.now() - started, question: evalCase.question, answer: answer.text,
            });
            console.log(`${verdict.pass ? 'PASS' : 'FAIL'}  ${template.padEnd(16)} ${evalCase.id.padEnd(15)} ${verdict.detail}`);
        }
        await call('DELETE', '/workspace', { workspace });
    }

    const passed = results.filter(r => r.pass).length;
    console.log(`\n${passed}/${results.length} passed`);

    const here = dirname(fileURLToPath(import.meta.url));
    const out = join(here, 'results', `${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify({ base: BASE, model: config.model, results }, null, 2));
    console.log(`Details: ${out}`);
    process.exit(passed === results.length ? 0 : 1);
}

main().catch(error => {
    console.error(error.message ?? error);
    process.exit(2);
});
