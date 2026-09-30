import { defineConfig } from "@trigger.dev/sdk";
export default defineConfig({
  project: process.env.TRIGGER_PROJECT_REF ?? "configure-project-before-deploy",
  runtime: "node",
  dirs: ["./src/trigger"],
  maxDuration: 120,
});
