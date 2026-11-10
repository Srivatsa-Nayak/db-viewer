import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

/**
 * The paths every visitor takes: land, open the editor, load the example, see the schema, and
 * take it out again. If these fail, nothing else about the app matters.
 *
 * Every test also collects Content-Security-Policy violations. The policy is enforced
 * (next.config.ts), so a violation means something was blocked — this is where a policy change
 * that breaks a page, or an export, shows up first.
 */
const API = process.env.E2E_API_URL || 'http://localhost:8080';

const cspViolations = (page: Page) => {
    const seen: string[] = [];
    page.on('console', (message: ConsoleMessage) => {
        if (/Content[- ]Security[- ]Policy/i.test(message.text())) seen.push(message.text());
    });
    return seen;
};

/** Opens the editor with the example loaded. */
const openExample = async (page: Page) => {
    await page.goto('/app');
    await page.getByRole('button', { name: /Show me an example/ }).click();
    const canvas = page.locator('.react-flow');
    await expect(canvas.locator('.react-flow__node', { hasText: 'customers' }).first()).toBeVisible();
    return canvas;
};

/**
 * Signs this browser in with a throwaway account made through the API, the same way the UI
 * stores a session. Exports need an account; the account exists only in the test database.
 */
const signIn = async (page: Page) => {
    await page.goto('/');
    const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
    const password = `E2e-${Math.random().toString(36).slice(2, 12)}!`;
    const res = await page.request.post(`${API}/auth/signup`, { data: { email, password } });
    expect(res.ok()).toBe(true);
    const { token } = await res.json();
    await page.evaluate(t => window.localStorage.setItem('sql-visualizer.token', t), token);
};

const openExportDialog = async (page: Page) => {
    await page.getByRole('button', { name: /^File/ }).click();
    await page.getByText('Export...').click();
    await expect(page.getByRole('dialog')).toBeVisible();
};

test('the landing page shows its headline and links to the editor', async ({ page }) => {
    const violations = cspViolations(page);
    await page.goto('/');

    await expect(page.getByRole('heading', { level: 1 })).toContainText('See your database');
    await expect(page.getByRole('link', { name: /Open the app/ })).toBeVisible();
    expect(violations).toEqual([]);
});

test('the docs page renders under the policy', async ({ page }) => {
    const violations = cspViolations(page);
    await page.goto('/docs');

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(violations).toEqual([]);
});

test('loading the example draws its tables and relationships', async ({ page }) => {
    const violations = cspViolations(page);
    const canvas = await openExample(page);

    // The example is the Online Store template: these tables, joined by foreign keys.
    for (const table of ['orders', 'products']) {
        await expect(canvas.locator('.react-flow__node', { hasText: table }).first()).toBeVisible();
    }
    await expect(canvas.locator('.react-flow__edge').first()).toBeAttached();
    await expect(page.getByText('example-store.sql').first()).toBeVisible();
    expect(violations).toEqual([]);
});

test('deleting a table leaves an undoable ghost, and undo keeps the table', async ({ page }) => {
    const canvas = await openExample(page);

    // `reviews` is a leaf: nothing points at it, so the delete is allowed.
    // The node itself is a button, so its menu button is not in the accessibility tree.
    await page.locator('button[aria-label="Actions for reviews"]').click();
    await page.getByRole('menuitem', { name: /Delete table/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete table' }).click();

    await expect(canvas.locator('.react-flow__node.node-ghost', { hasText: 'reviews' })).toHaveCount(1);
    await page.locator('button[aria-label="Keep reviews — cancel the delete"]').click();
    await expect(canvas.locator('.react-flow__node.node-ghost')).toHaveCount(0);

    // Past the countdown, the table is still there: the delete was never sent.
    await page.waitForTimeout(7_500);
    await expect(canvas.locator('.react-flow__node', { hasText: 'reviews' }).first()).toBeVisible();
});

test('the diagram exports as a PNG', async ({ page }) => {
    const violations = cspViolations(page);
    await signIn(page);
    await openExample(page);
    await openExportDialog(page);

    await page.getByRole('button', { name: /^Image/ }).click();
    const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: /^Download$/ }).click(),
    ]);

    expect(download.suggestedFilename()).toBe('example-store.png');
    const bytes = readFileSync(await download.path());
    // A real PNG of a nine-table diagram, not an empty or broken image.
    expect(bytes.subarray(1, 4).toString()).toBe('PNG');
    expect(bytes.length).toBeGreaterThan(20_000);
    expect(violations).toEqual([]);
});

test('the schema exports as a SQL script', async ({ page }) => {
    const violations = cspViolations(page);
    await signIn(page);
    await openExample(page);
    await openExportDialog(page);

    const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: /^Download$/ }).click(),
    ]);

    const sql = readFileSync(await download.path(), 'utf8');
    expect(sql).toMatch(/CREATE TABLE/i);
    expect(sql).toContain('customers');
    expect(violations).toEqual([]);
});

test('robots.txt and the sitemap are served', async ({ request }) => {
    const robots = await request.get('/robots.txt');
    expect(robots.ok()).toBe(true);
    expect(await robots.text()).toContain('Disallow: /share/');

    const sitemap = await request.get('/sitemap.xml');
    expect(sitemap.ok()).toBe(true);
    expect(await sitemap.text()).toContain('/docs');
});
