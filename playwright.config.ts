import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
export default defineConfig({
  projects: [
    {
      name: "editorial-demo",
      testDir: "tests/e2e",
      use: { baseURL: "http://localhost:3100" },
    },
    {
      name: "live-discovery",
      testDir: "tests/discovery-e2e",
      use: { baseURL: "http://localhost:3101" },
    },
  ],
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: "http://localhost:3100",
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
      command: "npm run start -- --port 3100",
      url: "http://localhost:3100",
      reuseExistingServer: false,
      env: {
        CONTENT_OS_MODE: "demo",
        CONTENT_OS_DATA_MODE: "demo",
        CONTENT_OS_DATA_DIR: ".data/e2e",
      },
      timeout: 60000,
    },
    {
      command: "npm run start -- --port 3101",
      url: "http://localhost:3101",
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
