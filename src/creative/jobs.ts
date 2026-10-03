import { creativeHash as hash } from "./fingerprint";
import { randomUUID } from "node:crypto";
import { type Entity, type Job } from "../control/model";
import { creativeOperations } from "./schema";
import type { CreativeRecord } from "./model";
export type CreativeOperation = (typeof creativeOperations)[number];
/** Reserved, inert jobs: existing processors never claim kind=creative. */
export function creativeJob(
  record: Entity<CreativeRecord>,
  operation: CreativeOperation,
  now: string,
): Job {
  const p = record.data.package;
  const input = {
    schema_version: 1,
    operation,
    binding: p.binding,
    brief_id: p.brief.id,
    brief_revision: p.brief.revision,
    specification_sha256: hash(p),
  };
  return {
    id: randomUUID(),
    kind: "creative",
    entity_id: record.id,
    entity_version: record.version,
    is_demo: record.is_demo,
    idempotency_key: `creative/v1/${hash({ id: record.id, version: record.version, input })}`,
    status: "blocked",
    due_at: now,
    input,
    error:
      operation === "WAIT_FOR_EXTERNAL_VISUAL" ||
      operation === "IMPORT_EXTERNAL_VISUAL"
        ? "WAITING_FOR_EXTERNAL_VISUAL · use the manual human handoff"
        : "CREATIVE_EXECUTOR_NOT_CONFIGURED · reserved contract; no generation or rendering is performed",
    retryable: true,
    attempts: 0,
  };
}
export function currentCreativeJob(job: Job, record: Entity<CreativeRecord>) {
  return (
    job.kind === "creative" &&
    job.entity_id === record.id &&
    job.entity_version === record.version &&
    job.input.specification_sha256 === hash(record.data.package) &&
    job.input.brief_revision === record.data.package.brief.revision
  );
}
