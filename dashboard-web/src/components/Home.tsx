import type { Encounter, Thread } from "../types";

type CycleStatus = "none" | "pre_only" | "both";

function cycleStatus(thread: Thread, hasEncounters: boolean): CycleStatus {
  if (thread.pending_pre_meeting_brief) return "pre_only";
  if (hasEncounters) return "both";
  return "none";
}

const RECOMMENDATION_BADGE: Record<string, string> = {
  hold: "🟢 Hold",
  reschedule: "🟡 Reschedule",
  skip: "🔴 Skip",
};

function ThreadStatusRow({ thread, hasEncounters }: { thread: Thread; hasEncounters: boolean }) {
  const status = cycleStatus(thread, hasEncounters);
  return (
    <tr>
      <td>{thread.thread_id}</td>
      <td>{thread.organizations || "—"}</td>
      <td>{thread.current_state || "—"}</td>
      <td>
        {status === "none" && <span className="badge badge-empty">Nothing recorded yet</span>}
        {status === "pre_only" && <span className="badge badge-pending">Pre-meeting recorded — post pending</span>}
        {status === "both" && <span className="badge badge-done">Pre + post recorded</span>}
      </td>
      <td>
        {thread.meeting_recommendation_decision ? (
          <span title={thread.meeting_recommendation_rationale || ""}>
            {RECOMMENDATION_BADGE[thread.meeting_recommendation_decision] || thread.meeting_recommendation_decision}
          </span>
        ) : (
          "—"
        )}
      </td>
      <td>{thread.next_followup_date || "—"}</td>
    </tr>
  );
}

export function Home({ threads, encounters }: { threads: Thread[]; encounters: Encounter[] }) {
  const rows = threads
    .filter((t) => t.thread_id)
    .map((t) => ({
      thread: t,
      hasEncounters: encounters.some((e) => e.thread_id === t.thread_id),
    }));

  const actionItems = encounters.flatMap((e) =>
    (e.commitments || []).map((c) => ({
      thread_id: e.thread_id,
      encounter: e.encounter_name,
      description: c.description,
      owner: c.owner,
      due_date: c.due_date,
    }))
  );

  return (
    <div className="home">
      <section>
        <h2>Threads</h2>
        {rows.length === 0 ? (
          <p className="empty-state">No threads yet — record a pre or post-meeting brief to create one.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Thread</th>
                <th>Organization</th>
                <th>State</th>
                <th>Recording status</th>
                <th>Is next meeting necessary?</th>
                <th>Next follow-up</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <ThreadStatusRow key={r.thread.thread_id} thread={r.thread} hasEncounters={r.hasEncounters} />
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2>Action items</h2>
        {actionItems.length === 0 ? (
          <p className="empty-state">No action items recorded yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Owner</th>
                <th>Description</th>
                <th>Thread</th>
                <th>Due</th>
              </tr>
            </thead>
            <tbody>
              {actionItems.map((a, i) => (
                <tr key={i}>
                  <td>{a.owner || "—"}</td>
                  <td>{a.description}</td>
                  <td>
                    {a.thread_id} <span className="muted">· {a.encounter}</span>
                  </td>
                  <td>{a.due_date || "no due date"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
