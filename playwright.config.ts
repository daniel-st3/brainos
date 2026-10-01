import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
const demoPort = Number(process.env.E2E_PORT_BASE ?? 3100);
const livePort = demoPort + 1;
export default defineConfig({
  projects: [
    {
      name: "editorial-demo",
      testDir: "tests/e2e",
      use: { baseURL: `http://localhost:${demoPort}` },
    },
    {
      name: "live-discovery",
      testDir: "tests/discovery-e2e",
      use: { baseURL: `http://localhost:${livePort}` },
    },
  ],
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: `http://localhost:${demoPort}`,
    viewport: { width: 1440, height: 1000 },
    launchOptions: {
      executablePath:
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ??
        (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
      args: ["--no-sandbox"],
    },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: `npm run start -- --port ${demoPort}`,
      url: `http://localhost:${demoPort}`,
      reuseExistingServer: false,
      env: {
        CONTENT_OS_MODE: "demo",
        CONTENT_OS_DATA_MODE: "demo",
        CONTENT_OS_DATA_DIR: ".data/e2e",
      },
      timeout: 60000,
    },
    {
      command: `npm run start -- --port ${livePort}`,
      url: `http://localhost:${livePort}`,
      reuseExistingServer: false,
      env: {
        CONTENT_OS_MODE: "demo",
        CONTENT_OS_DATA_MODE: "live",
        CONTENT_OS_DATA_DIR: ".data/e2e-live",
      },
      timeout: 60000,
    },
  ],
});
