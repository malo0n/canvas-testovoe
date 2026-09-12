import { defineConfig, devices } from '@playwright/test';

const WEB = 'http://localhost:5174';
const API = 'http://localhost:4001';

/**
 * Сценарии проверяются на живом бэкенде из этого же репозитория: подмены
 * ответов нет, поэтому проверяется именно интеграция.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    baseURL: WEB,
    trace: 'retain-on-failure',
    locale: 'ru-RU',
    viewport: { width: 1280, height: 900 },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npm run dev',
      cwd: '../..',
      url: `${API}/api/config`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: 'npm run dev -w @canvas/web',
      cwd: '../..',
      url: WEB,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
