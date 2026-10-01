import Link from "next/link";
import { Mic, Layers, CheckCircle2 } from "lucide-react";
import { newsroom } from "@/server/data";
import { PageHeader, Status, Empty } from "@/components/ui";
import { CommandForm } from "@/components/actions";
import { activeDraft } from "@/domain/workflow";
import { DraftContent } from "@/components/story-panels";
export default async function Production() {
  const stories = (await newsroom()).filter(
    (s) =>
      !s.archived &&
      ["recording_needed", "render_ready", "review", "approved"].includes(
        s.status,
      ),
  );
  return (
    <>
      <PageHeader
        eyebrow="PRODUCTION / 04"
        title="Make room for making."
        description="Batch your recording. Prepare your visuals. Keep the approved copy in view."
      />
      <p>
        <Link className="button" href="/production/studio">
          Abrir estudio de grabación y edición
        </Link>
      </p>
      <div className="notice">
        <CheckCircle2 size={18} />
        <p>
          Production preparation starts before review. Approved packages stay
          here until the checklist is complete. No video is recorded or rendered
          automatically.
        </p>
      </div>
      {(["recording", "render"] as const).map((branch) => {
        const batch = stories.filter((s) =>
          branch === "recording"
            ? activeDraft(s)?.platform === "short_video"
            : activeDraft(s)?.platform !== "short_video",
        );
        return (
          <section key={branch} className="production-section">
            <div className="section-heading">
              <h2>
                {branch === "recording" ? (
                  <Mic size={21} />
                ) : (
                  <Layers size={21} />
                )}{" "}
                {branch === "recording" ? "Recording needed" : "Render ready"}
              </h2>
              <span className="count">{batch.length}</span>
            </div>
            <div className="production-grid">
              {batch.map((s) => {
                const d = activeDraft(s)!;
                return (
                  <article className="panel production-card" key={s.id}>
                    <div className="section-heading">
                      <span className="small-cap">
                        {d.target_duration ? `${d.target_duration} SEC / ` : ""}
                        {d.language.toUpperCase()} / v{d.revision}
                      </span>
                      <Status value={s.status} />
                    </div>
                    <h3>
                      <Link href={`/stories/${s.id}`}>{s.title}</Link>
                    </h3>
                    <blockquote>{d.hook}</blockquote>
                    {d.shot_notes && (
                      <div className="shot-notes">
                        <span className="small-cap">SHOT / B-ROLL NOTES</span>
                        <p>{d.shot_notes}</p>
                      </div>
                    )}
                    <details>
                      <summary>Open script / copy</summary>
                      <DraftContent draft={d} />
                    </details>
                    <CommandForm
                      key={s.version}
                      storyId={s.id}
                      version={s.version}
                      command={{ type: "production" }}
                      label={
                        s.production_completed
                          ? "Update checklist"
                          : "Save production checklist"
                      }
                      arrays={["checklist"]}
                    >
                      <fieldset>
                        <legend>
                          {s.production_completed
                            ? "Preparation complete"
                            : "Production checklist"}
                        </legend>
                        {[
                          ["script", "Script / copy checked"],
                          [
                            "sound",
                            branch === "recording"
                              ? "Recording and audio captured"
                              : "Copy proofread for output",
                          ],
                          [
                            "visuals",
                            "Selected visuals and attribution prepared",
                          ],
                        ].map(([key, label]) => (
                          <label key={key} className="check">
                            <input
                              type="checkbox"
                              name="checklist"
                              value={key}
                              defaultChecked={s.production_checklist.includes(
                                key,
                              )}
                            />
                            {label}
                          </label>
                        ))}
                      </fieldset>
                    </CommandForm>
                    {["recording_needed", "render_ready"].includes(
                      s.status,
                    ) && (
                      <CommandForm
                        storyId={s.id}
                        version={s.version}
                        command={{ type: "transition", target: "review" }}
                        label="Send for review"
                        variant="quiet"
                      />
                    )}
                    {s.status === "approved" && (
                      <Link href="/publish" className="text-link">
                        Open approved publishing package
                      </Link>
                    )}
                  </article>
                );
              })}
            </div>
            {!batch.length && (
              <Empty
                title={
                  branch === "recording"
                    ? "No scripts waiting for recording"
                    : "No render packages waiting"
                }
              />
            )}
          </section>
        );
      })}
    </>
  );
}
