import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * The features added on top of the core path: tidy layout, pasted DBML, query history,
 * versions and compare, the phone view, and the URL import's refusal of non-GitHub hosts.
 * Each is driven the way a person would, against the real UI and backend.
 */
const API = process.env.E2E_API_URL || 'http://localhost:8080';

const signIn = async (page: Page) => {
    await page.goto('/');
    const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
    const password = `E2e-${Math.random().toString(36).slice(2, 12)}!`;
    const res = await page.request.post(`${API}/auth/signup`, { data: { email, password } });
    expect(res.ok()).toBe(true);
    const { token } = await res.json();
    await page.evaluate(t => window.localStorage.setItem('sql-visualizer.token', t), token);
};

const openExample = async (page: Page) => {
    await page.goto('/app');
    await page.getByRole('button', { name: /Show me an example/ }).click();
    await expect(page.locator('.react-flow__node', { hasText: 'customers' }).first()).toBeVisible();
};

const openFileMenuItem = async (page: Page, item: RegExp) => {
    await page.getByRole('button', { name: /^File/ }).click();
    await page.getByRole('menuitem', { name: item }).click();
};

/** A node's canvas position, read from React Flow's transform. */
const positionOf = async (node: Locator) => {
    const transform = await node.evaluate(el => (el as HTMLElement).style.transform);
    const [x, y] = (transform.match(/-?\d+(\.\d+)?/g) ?? ['0', '0']).map(Number);
    return { x, y };
};

test('Tidy layout puts a referenced table to the left of the tables that use it', async ({ page }) => {
    await openExample(page);
    const customers = page.locator('.react-flow__node[data-id="customers"]');
    const orders = page.locator('.react-flow__node[data-id="orders"]');

    await page.getByRole('button', { name: 'Tidy layout' }).click();
    await expect(page.getByText('Arranged the tables by their relationships')).toBeVisible();

    expect((await positionOf(customers)).x).toBeLessThan((await positionOf(orders)).x);
    // And it is one undo step.
    await expect(page.getByRole('button', { name: /^Undo/ })).toBeEnabled();
});

test('pasted DBML goes through the import preview and lands on the canvas', async ({ page }) => {
    await page.goto('/app');
    await openFileMenuItem(page, /Paste or link/);

    await page.getByRole('textbox', { name: 'Schema text' }).fill(`
        Table authors {
          id integer [pk, increment]
          name varchar(128) [not null]
        }
        Table books {
          id integer [pk]
          author_id integer [ref: > authors.id]
        }
    `);
    await expect(page.getByRole('button', { name: 'DBML', pressed: true })).toBeVisible();
    await page.getByRole('button', { name: 'Preview import' }).click();
    await page.getByRole('button', { name: 'Import 2 tables' }).click();

    await expect(page.locator('.react-flow__node[data-id="authors"]')).toBeVisible();
    await expect(page.locator('.react-flow__node[data-id="books"]')).toBeVisible();
    await expect(page.locator('.react-flow__edge').first()).toBeAttached();
});

test('importing by address refuses anything but GitHub, without fetching it', async ({ page }) => {
    await page.goto('/app');
    await openFileMenuItem(page, /Paste or link/);
    await page.getByRole('tab', { name: /From a link/ }).click();
    await page.getByPlaceholder(/gist\.github\.com/).fill('https://example.com/schema.sql');
    await page.getByRole('button', { name: 'Fetch and preview' }).click();
    await expect(page.getByText(/Only GitHub gists/)).toBeVisible();
});

test('the SQL panel remembers what was run against the file', async ({ page }) => {
    await signIn(page);
    await openExample(page);
    await page.getByRole('button', { name: /^SQL$/ }).click();

    const editor = page.getByRole('textbox', { name: 'SQL' });
    await editor.fill('SELECT COUNT(*) AS n FROM customers;');
    await editor.press('Control+Enter');
    await expect(page.getByText('1 row').first()).toBeVisible();

    await page.getByRole('button', { name: /History/ }).click();
    const entry = page.getByRole('menuitem', { name: /SELECT COUNT\(\*\) AS n FROM customers/ });
    await expect(entry).toBeVisible();

    await editor.fill('');
    await entry.click();
    await expect(editor).toHaveValue('SELECT COUNT(*) AS n FROM customers;');
});

test('a saved version can be compared with the file and restored', async ({ page }) => {
    await signIn(page);
    await openExample(page);

    await openFileMenuItem(page, /Versions and compare/);
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('textbox', { name: 'Version name' }).fill('Before the change');
    await dialog.getByRole('button', { name: 'Save now' }).click();
    await expect(dialog.locator('li p', { hasText: 'Before the change' }).first()).toBeVisible();
    await dialog.getByRole('button', { name: 'Close' }).last().click();

    // Change the file: drop a leaf table by hand.
    await page.getByRole('button', { name: /^SQL$/ }).click();
    const editor = page.getByRole('textbox', { name: 'SQL' });
    await editor.fill('DROP TABLE reviews;');
    await editor.press('Control+Enter');
    await expect(page.locator('.react-flow__node[data-id="reviews"]')).toHaveCount(0);

    await openFileMenuItem(page, /Versions and compare/);
    await dialog.getByRole('button', { name: 'Compare with Before the change' }).click();
    // From the version to now: the table is gone.
    await expect(dialog.getByText('Table reviews removed')).toBeVisible();
    await expect(dialog.getByText('DROP TABLE "reviews";')).toBeVisible();

    await dialog.getByRole('button', { name: 'Restore Before the change' }).click();
    await dialog.getByRole('button', { name: 'Replace the file' }).click();
    await expect(dialog.getByText(/Restored/)).toBeVisible();
    await expect(page.locator('.react-flow__node[data-id="reviews"]')).toHaveCount(1);
});

test.describe('on a phone', () => {
    test.use({ viewport: { width: 375, height: 760 }, isMobile: true, hasTouch: true });

    test('a file opens as a readable list of tables, with the diagram one tap away', async ({ page }) => {
        // Not openExample(): on a phone the file opens in the list, so there is no diagram to wait for.
        await page.goto('/app');
        await page.getByRole('button', { name: /Show me an example/ }).click();
        await expect(page.getByRole('tab', { name: 'Tables', selected: true })).toBeVisible();
        await expect(page.getByRole('button', { name: /customers/ }).first()).toBeVisible();

        await page.getByRole('button', { name: /^customers/ }).first().click();
        await expect(page.getByText('email').first()).toBeVisible();

        await page.getByRole('tab', { name: 'Diagram' }).click();
        await expect(page.locator('.react-flow')).toBeVisible();
    });
});
