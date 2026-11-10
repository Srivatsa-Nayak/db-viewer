import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end smoke tests (`npm run test:e2e`): a real browser against the real UI and backend.
 *
 * **The backend is not started here** — it has to be running on :8080 already. In CI the
 * workflow starts the built jar and waits for its health check; locally, run it as usual
 * (`mvnw spring-boot:run`). Keeping it out of this file avoids a cross-platform shell command
 * for a Maven build.
 *
 * The UI is started by Playwright unless one is already on :3000: the production server in CI
 * (the standalone output, which is what Azure runs), the dev server locally. Locally the tests
 * use the installed Chrome (`channel: 'chrome'`) so nothing has to be downloaded; CI installs
 * Playwright's own Chromium.
 */
const isCI = !!process.env.CI;

export default defineConfig({
    testDir: './e2e',
    timeout: 90_000,
    expect: { timeout: 30_000 },
    fullyParallel: false,
    retries: isCI ? 1 : 0,
    reporter: isCI ? [['github'], ['list']] : 'list',
    use: {
        baseURL: 'http://127.0.0.1:3000',
        trace: 'retain-on-failure',
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'], ...(isCI ? {} : { channel: 'chrome' }) },
        },
    ],
    webServer: {
        command: isCI ? 'node .next/standalone/server.js' : 'npm run dev',
        url: 'http://127.0.0.1:3000',
        reuseExistingServer: !isCI,
        timeout: 180_000,
        env: { PORT: '3000', HOSTNAME: '127.0.0.1' },
    },
});
