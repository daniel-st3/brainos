import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { codexJSON } from "../scripts/newsroom/codex.mjs";
const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    directories.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});
async function fakeCLI(login: string) {
  const directory = await mkdtemp(path.join(tmpdir(), "newsroom-cli-"));
  directories.push(directory);
  const binary = path.join(directory, "codex");
  await writeFile(
    binary,
    `#!${process.execPath}
const fs=require('node:fs');
const args=process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(path.join(directory, "calls"))},args[0]+'\\n');
if(args[0]==='login'){console.log(${JSON.stringify(login)});process.exit(0)}
if(process.env.OPENAI_API_KEY || process.env.PRODUCTION_WORKER_TOKEN)process.exit(90);
fs.writeFileSync(${JSON.stringify(path.join(directory, "args.json"))}, JSON.stringify(args));
process.stdin.resume();
process.stdin.on('end',()=>{
fs.writeFileSync(args[args.indexOf('--output-last-message')+1],JSON.stringify({pass:true}));
console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'{"pass":true}'}}));
console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:10,output_tokens:2,cached_input_tokens:0}}));
});
`,
    { mode: 0o700 },
  );
  vi.stubEnv("NEWSROOM_CODEX_BIN", binary);
  return directory;
}
it("blocks API-key authentication before any inference invocation", async () => {
  const directory = await fakeCLI("Logged in using an API key");
  await expect(
    codexJSON({ directory, name: "blocked", prompt: "test", schema: {} }),
  ).rejects.toThrow("CHATGPT_LOGIN_REQUIRED_NO_API_FALLBACK");
  expect(await readFile(path.join(directory, "calls"), "utf8")).toBe("login\n");
});
it("isolates worker credentials and uses compact instructions while retaining usage evidence", async () => {
  const directory = await fakeCLI("Logged in using ChatGPT");
  vi.stubEnv("OPENAI_API_KEY", "test-only-never-forward");
  vi.stubEnv("PRODUCTION_WORKER_TOKEN", "test-only-never-forward");
  const result = await codexJSON({
    directory,
    name: "check",
    prompt: "Unchanged task",
    schema: { type: "object" },
  });
  expect(result.value).toEqual({ pass: true });
  expect(result.metrics).toMatchObject({
    agent_messages: 1,
    tool_events: 0,
    visible_errors: 0,
    prompt_bytes: 14,
  });
  const args: string[] = JSON.parse(
    await readFile(path.join(directory, "args.json"), "utf8"),
  );
  expect(args).toContain("read-only");
  expect(args).toContain("project_doc_max_bytes=0");
  expect(args).toContain("memories.use_memories=false");
  expect(args.some((x) => x.startsWith("model_instructions_file="))).toBe(true);
  expect(args).toContain('model_reasoning_effort="high"');
  expect(await readFile(path.join(directory, "calls"), "utf8")).toBe(
    "login\nexec\n",
  );
});
