import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';

/**
 * The one path every visitor takes: land, open the editor, load the example, see the schema.
 * If this fails, nothing else about the app matters.
 *
 * Also collects Content-Security-Policy reports. The policy is report-only (next.config.ts), so
 * a violation breaks nothing yet — this is where one shows up before the policy is enforced.
 */
const cspViolations = (page: Page) => {
    const seen: string[] = [];
    page.on('console', (message: ConsoleMessage) => {
        if (/Content[- ]Security[- ]Policy/i.test(message.text())) seen.push(message.text());
    });
    return seen;
};

test('the landing page shows its headline and links to the editor', async ({ page }) => {
    const violations = cspViolations(page);
    await page.goto('/');

    await expect(page.getByRole('heading', { level: 1 })).toContainText('See your database');
    await expect(page.getByRole('link', { name: /Open the app/ })).toBeVisible();
    expect(violations).toEqual([]);
});

test('loading the example draws its tables and relationships', async ({ page }) => {
    const violations = cspViolations(page);
    await page.goto('/app');

    await page.getByRole('button', { name: /Show me an example/ }).click();

    // The example is the Online Store template: these tables, joined by foreign keys.
    const canvas = page.locator('.react-flow');
    for (const table of ['customers', 'orders', 'products']) {
        await expect(canvas.locator('.react-flow__node', { hasText: table }).first()).toBeVisible();
    }
    await expect(canvas.locator('.react-flow__edge').first()).toBeAttached();

    // The file is listed in the explorer under the name the example is saved as.
    await expect(page.getByText('example-store.sql').first()).toBeVisible();
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
