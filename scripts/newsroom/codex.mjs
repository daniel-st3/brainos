import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
const instructionsPath = fileURLToPath(
  new URL("./instructions.md", import.meta.url),
);
const hash = (value) => createHash("sha256").update(value).digest("hex");
export async function codexJSON({
  prompt,
  schema,
  directory,
  name,
  images = [],
}) {
  await mkdir(directory, { recursive: true });
  const schemaPath = path.resolve(directory, `${name}.schema.json`),
    output = path.resolve(directory, `${name}.json`);
  await writeFile(schemaPath, JSON.stringify(schema));
  const env = Object.fromEntries(
    ["HOME", "PATH", "TMPDIR", "LANG"]
      .filter((k) => process.env[k])
      .map((k) => [k, process.env[k]]),
  );
  const binary = process.env.NEWSROOM_CODEX_BIN || "codex";
  // Recheck each invocation: changing the local login to an API key must not cause paid fallback.
  try {
    const login = await promisify(execFile)(binary, ["login", "status"], {
      env,
      timeout: 10000,
    });
    if (!/ChatGPT/i.test(login.stdout + login.stderr))
      throw Error("Wrong auth mode");
  } catch {
    throw Error("CHATGPT_LOGIN_REQUIRED_NO_API_FALLBACK");
  }
  // Login remains in the local official CLI store. No service keys or paid API fallback.
  const args = [
    "exec",
    "--ignore-user-config",
    "--ignore-rules",
    "--skip-git-repo-check",
    "--ephemeral",
    "--sandbox",
    "read-only",
    "--disable",
    "shell_tool",
    "--disable",
    "apps",
    "--disable",
    "browser_use",
    "--disable",
    "computer_use",
    "--disable",
    "plugins",
    "--disable",
    "hooks",
    "--disable",
    "memories",
    "-c",
    `model_instructions_file=${JSON.stringify(instructionsPath)}`,
    "-c",
    "project_doc_max_bytes=0",
    "-c",
    "memories.use_memories=false",
    "-c",
    'web_search="disabled"',
    "-c",
    'model_reasoning_effort="high"',
    "-m",
    process.env.NEWSROOM_CODEX_MODEL || "gpt-6.1-sol",
    "--json",
    "--output-schema",
    schemaPath,
    "--output-last-message",
    output,
    "-C",
    directory,
  ];
  for (const image of images) args.push("--image", path.resolve(image));
  args.push("-");
  const started = Date.now(),
    events = [];
  let stderr = "",
    buffer = "",
    tools = 0;
  const child = spawn(binary, args, {
    env,
    stdio: ["pipe", "pipe", "pipe"],
    detached: true,
  });
  let killTimer;
  const stop = () => {
    try {
      process.kill(-child.pid, "SIGTERM");
      killTimer = setTimeout(() => {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {}
      }, 5000);
    } catch {}
  };
  process.once("SIGTERM", stop);
  const timer = setTimeout(() => {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {}
  }, 300000);
  child.stdout.on("data", (b) => {
    buffer += b;
    let i;
    while ((i = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, i);
      buffer = buffer.slice(i + 1);
      try {
        const e = JSON.parse(line);
        events.push(e);
        if (
          e.type === "item.completed" &&
          e.item?.type !== "agent_message" &&
          e.item?.type !== "reasoning"
        )
          tools++;
      } catch {}
    }
  });
  child.stderr.on("data", (b) => {
    stderr = (stderr + b).slice(-16000);
  });
  child.stdin.end(prompt);
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  }).finally(() => {
    clearTimeout(timer);
    clearTimeout(killTimer);
    process.removeListener("SIGTERM", stop);
  });
  const usage = events
    .filter((e) => e.type === "turn.completed")
    .map((e) => e.usage);
  const metrics = {
    model: process.env.NEWSROOM_CODEX_MODEL || "gpt-6.1-sol",
    elapsed_seconds: (Date.now() - started) / 1000,
    code,
    usage,
    tool_events: tools,
    agent_messages: events.filter(
      (e) => e.type === "item.completed" && e.item?.type === "agent_message",
    ).length,
    visible_errors: events.filter(
      (e) => e.type === "error" || e.type === "turn.failed",
    ).length,
    prompt_bytes: Buffer.byteLength(prompt),
    prompt_sha256: hash(prompt),
    schema_sha256: hash(JSON.stringify(schema)),
    instructions_sha256: hash(await readFile(instructionsPath)),
    image_inputs: await Promise.all(
      images.map(async (file) => {
        const bytes = await readFile(file);
        return {
          name: path.basename(file),
          bytes: bytes.length,
          sha256: hash(bytes),
        };
      }),
    ),
    label:
      "Executed using existing ChatGPT/Codex subscription capacity. No incremental API charge. Subscription usage is still a consumed resource.",
  };
  await writeFile(
    path.resolve(directory, `${name}.metrics.json`),
    JSON.stringify(metrics, null, 2),
  );
  await writeFile(
    path.resolve(directory, `${name}.events.jsonl`),
    events.map((e) => JSON.stringify(e)).join("\n"),
    { mode: 0o600 },
  );
  if (code !== 0 || tools)
    throw Error(`CODEX_EXEC_FAILED_${code}_TOOLS_${tools}`);
  try {
    return { value: JSON.parse(await readFile(output, "utf8")), metrics };
  } catch {
    throw Error("CODEX_INVALID_STRUCTURED_OUTPUT");
  }
}
