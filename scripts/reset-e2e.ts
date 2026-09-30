import { rm } from "node:fs/promises";
await rm(".data/e2e", { recursive: true, force: true });
