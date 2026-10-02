import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { editor } from "@/server/auth";
import { sameOrigin } from "@/server/request";
import { applicationRpc } from "@/ingestion/store";
import { dataMode } from "@/server/mode";
import { controlSnapshot } from "@/control/service";
import { projectExport, csv } from "@/control/export";
import { hash } from "@/control/model";
export async function POST(request: Request) {
  if (!sameOrigin(request))
    return NextResponse.json(
      { error: "Cross-origin request rejected" },
      { status: 403 },
    );
  try {
    const actor = await editor(),
      rpc = await applicationRpc(),
      demo = dataMode() === "demo",
      { state, stories, production } = await controlSnapshot(rpc, demo);
    const topic = new URL(request.url).searchParams.get("topic") ?? "project";
    if (
      ![
        "project",
        "content",
        "publications",
        "analytics",
        "experiments",
        "sources",
      ].includes(topic)
    )
      throw Error("Unknown export");
    const data = projectExport(state, stories, production),
      kind = {
        content: "content",
        publications: "publication",
        analytics: "publication",
        experiments: "experiment",
      }[topic];
    const output =
      topic === "project"
        ? JSON.stringify(data, null, 2)
        : csv(
            topic === "sources"
              ? stories.flatMap((s) => s.sources.map((s) => ({ ...s })))
              : state.entities
                  .filter((e) => e.kind === kind)
                  .map((e) => ({
                    id: e.id,
                    version: e.version,
                    is_demo: e.is_demo,
                    ...e.data,
                  })),
          );
    const id = randomUUID(),
      jobId = randomUUID();
    await rpc("commit_control", {
      p_epoch: state.epoch,
      p_entities: [
        {
          id,
          kind: "review",
          version: 1,
          is_demo: demo,
          story_id: null,
          draft_id: null,
          parent_id: null,
          data: {
            type: "export",
            topic,
            sha256: hash(output),
            actor,
            at: new Date().toISOString(),
          },
        },
      ],
      p_jobs: [
        {
          id: jobId,
          kind: "export",
          entity_id: id,
          entity_version: 1,
          is_demo: demo,
          idempotency_key: `export:${jobId}`,
          status: "succeeded",
          due_at: new Date().toISOString(),
          input: { topic },
          error: null,
          retryable: false,
        },
      ],
      p_public: [],
      p_actor: actor,
    });
    return new Response(output, {
      headers: {
        "Content-Type": topic === "project" ? "application/json" : "text/csv",
        "Content-Disposition": `attachment; filename="brainos-${topic}.${topic === "project" ? "json" : "csv"}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Export failed" },
      { status: 422 },
    );
  }
}
