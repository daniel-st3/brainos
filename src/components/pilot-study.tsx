import { DiscoveryForm } from "./discovery-actions";
import {
  bogotaDate,
  pilotDates,
  dailyObservations,
  verdicts,
  type PilotStudy,
} from "@/domain/pilot";
import type { PilotEvent } from "@/ingestion/types";
export function PilotStudyPanel({
  study,
  events,
  live,
}: {
  study: PilotStudy;
  events: PilotEvent[];
  live: boolean;
}) {
  const today = bogotaDate();
  if (!live)
    return (
      <div className="notice">
        Switch to live data mode to run the ten-day comparison. Demo activity is
        excluded.
      </div>
    );
  if (!study.config)
    return (
      <section className="panel">
        <h2>Start the ten-day comparison</h2>
        <p>
          Each day, time your brief review and your usual manual browsing. Use
          the same editorial bar for “useful.” Add missed stories from the inbox
          and record both results here.
        </p>
        <p className="subtle">
          Starting fixes the ten-day window in Bogotá time. It does not schedule
          ingestion or publish content.
        </p>
        <DiscoveryForm
          endpoint="/api/pilot/study"
          values={{ action: "start" }}
          label="Start ten-day pilot"
        >
          <label>
            First day
            <input name="starts_on" type="date" required defaultValue={today} />
          </label>
        </DiscoveryForm>
      </section>
    );
  const dates = pilotDates(study.config.starts_on);
  return (
    <section className="panel-stack">
      <div className="section-heading">
        <div>
          <h2>{study.days.length} of 10 daily comparisons recorded</h2>
          <p>
            {dates[0]} — {dates[9]} · Bogotá time
          </p>
        </div>
        <a className="button secondary" href="/api/pilot/export" download>
          Export pilot JSON
        </a>
      </div>
      <p className="subtle">
        Time and useful-story counts are your assessment. Observed events below
        count distinct stories per day; missing telemetry is not zero recall. A
        draft is not a published result.
      </p>
      {dates.map((day, i) => {
        const saved = study.days.find((d) => d.day === day);
        const observed = dailyObservations(events, day);
        const future = day > today;
        return (
          <details key={day} className="panel" open={day === today}>
            <summary>
              Day {i + 1} · {day} ·{" "}
              {saved ? "Recorded" : future ? "Upcoming" : "Not recorded"}
            </summary>
            <p className="inline-meta">
              Observed: {observed.surfaced} surfaced · {observed.opened} opened
              · {observed.saved} saved · {observed.dismissed} dismissed ·{" "}
              {observed.manual_misses} missed · {observed.drafted} drafted
            </p>
            {future ? (
              <p>Record the comparison on or after this date.</p>
            ) : (
              <DiscoveryForm
                key={saved?.updated_at ?? day}
                endpoint="/api/pilot/study"
                values={{ action: "save_day", day }}
                label={`Save day ${i + 1}`}
              >
                <div className="field-grid">
                  <label>
                    Brief review minutes
                    <input
                      name="brief_minutes"
                      type="number"
                      min="0"
                      max="240"
                      step="0.1"
                      required
                      defaultValue={saved?.brief_minutes}
                    />
                  </label>
                  <label>
                    Manual browsing minutes
                    <input
                      name="manual_minutes"
                      type="number"
                      min="0"
                      max="240"
                      step="0.1"
                      required
                      defaultValue={saved?.manual_minutes}
                    />
                  </label>
                  <label>
                    Manual candidates checked
                    <input
                      name="manual_candidates"
                      type="number"
                      min="0"
                      max="500"
                      required
                      defaultValue={saved?.manual_candidates}
                    />
                  </label>
                  <label>
                    Useful manual stories
                    <input
                      name="manual_useful"
                      type="number"
                      min="0"
                      max="500"
                      required
                      defaultValue={saved?.manual_useful}
                    />
                  </label>
                  <label>
                    Useful brief stories
                    <input
                      name="brief_useful"
                      type="number"
                      min="0"
                      max="500"
                      required
                      defaultValue={saved?.brief_useful}
                    />
                  </label>
                  <label>
                    Which was more useful?
                    <select
                      name="verdict"
                      defaultValue={saved?.verdict ?? "undecided"}
                    >
                      {verdicts.map((v) => (
                        <option value={v} key={v}>
                          {v.replaceAll("_", " ")}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label>
                  What worked or was missed?
                  <textarea
                    name="notes"
                    maxLength={5000}
                    defaultValue={saved?.notes ?? ""}
                  />
                </label>
              </DiscoveryForm>
            )}
          </details>
        );
      })}
    </section>
  );
}
