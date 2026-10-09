import { spawn } from "node:child_process";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
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
  const child = spawn(process.env.NEWSROOM_CODEX_BIN || "codex", args, {
    env,
    stdio: ["pipe", "pipe", "pipe"],
    detached: true,
  });
  const stop = () => {
    try {
      process.kill(-child.pid, "SIGTERM");
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
