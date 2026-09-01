import { useState } from "react";
import type { Encounter, MomentumReview, Thread } from "../types";
import { audioUrl, generateReview } from "../api";

const RECOMMENDATION_BADGE: Record<string, string> = {
  hold: "🟢 Hold",
  reschedule: "🟡 Reschedule",
  skip: "🔴 Skip",
};

function List({ items }: { items?: string[] }) {
  if (!items || !items.length) return <p className="muted">None recorded.</p>;
  return (
    <ul>
      {items.map((it, i) => (
        <li key={i}>{it}</li>
      ))}
    </ul>
  );
}

function parseMomentumReview(raw: string | null): MomentumReview | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as MomentumReview;
  } catch {
    return null;
  }
}

export function ThreadDetail({
  thread,
  encounters,
  onClose,
  onRefresh,
}: {
  thread: Thread;
  encounters: Encounter[];
  onClose: () => void;
  onRefresh: () => void | Promise<void>;
}) {
  const review = parseMomentumReview(thread.last_momentum_review_json);
  const latest = encounters[0]; // encounters already sorted newest-first by the API

  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState("");

  async function handleGenerateReview() {
    if (!thread.thread_id) return;
    setGenerating(true);
    setGenerateError("");
    try {
      await generateReview(thread.thread_id);
      await onRefresh();
    } catch (e) {
      setGenerateError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal thread-detail" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <h2>{thread.thread_id}</h2>
        <p className="muted">
          {thread.organizations || "Unknown organization"} · {thread.current_state || "unknown state"}
          {thread.next_followup_date && <> · next follow-up {thread.next_followup_date}</>}
        </p>

        {thread.meeting_recommendation_decision && (
          <div className="recommendation-banner">
            <strong>
              {RECOMMENDATION_BADGE[thread.meeting_recommendation_decision] || thread.meeting_recommendation_decision}
            </strong>
            <p>{thread.meeting_recommendation_rationale}</p>
          </div>
        )}

        {latest && (
          <section>
            <h3>Latest encounter — {latest.encounter_name}</h3>
            <p className="muted">{latest.datetime_local}</p>
            <p>
              <strong>Purpose:</strong> {latest.pre_meeting_purpose || "—"}
            </p>
            <p>
              <strong>Decisions made:</strong>
            </p>
            <List items={latest.decisions_made} />
            <p>
              <strong>Commitments:</strong>
            </p>
            {latest.commitments?.length ? (
              <ul>
                {latest.commitments.map((c, i) => (
                  <li key={i}>
                    {c.description} — <em>{c.owner}</em>
                    {c.due_date ? `, due ${c.due_date}` : ""}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">None recorded.</p>
            )}
            {latest.audio_recording_key && <audio className="playback" controls src={audioUrl(latest.audio_recording_key)} />}
          </section>
        )}

        <section>
          <div className="section-header">
            <h3>Latest momentum review</h3>
            <button
              className="secondary-button"
              disabled={generating || encounters.length === 0}
              onClick={() => void handleGenerateReview()}
              title={encounters.length === 0 ? "No encounters recorded yet for this thread" : undefined}
            >
              {generating ? "Generating…" : review ? "Refresh review" : "Generate review"}
            </button>
          </div>
          {generateError && <p className="error-text">{generateError}</p>}

          {review ? (
            <>
              <p>
              <strong>Original purpose:</strong> {review.purpose || "—"}
            </p>
            <p>
              <strong>Original hypothesis:</strong> {review.hypothesis || "—"}
            </p>
            <p>
              <strong>Agreed actions:</strong>
            </p>
            <List items={review.agreed_actions} />
            <p>
              <strong>Owners:</strong> {review.owners?.join(", ") || "—"}
            </p>
            <p>
              <strong>Evidence expected:</strong>
            </p>
            <List items={review.evidence_required} />
            <p>
              <strong>What happened since then:</strong>
            </p>
            <List items={review.what_happened_since} />
            <p>
              <strong>New work generated:</strong>
            </p>
            <List items={review.new_work_generated} />
            <p>
              <strong>Conclusion reached:</strong> {review.conclusion_reached || "None yet"}
            </p>
            <p>
              <strong>What did not advance:</strong>
            </p>
            <List items={review.items_not_advanced} />
            {review.non_advance_analysis && review.non_advance_analysis.length > 0 && (
              <>
                <p>
                  <strong>Why it did not advance:</strong>
                </p>
                <ul>
                  {review.non_advance_analysis.map((n, i) => (
                    <li key={i}>
                      {n.item} — <em>{n.reason_type}</em>: {n.details}
                    </li>
                  ))}
                </ul>
              </>
            )}
            <p>
              <strong>Ownership existed:</strong> {review.ownership_existence || "—"}
            </p>
            <p>
              <strong>Recommended objective for next meeting:</strong>{" "}
              {review.recommended_objective_for_next_meeting || "—"}
            </p>
            {review.weak_followup_flags && review.weak_followup_flags.length > 0 && (
              <>
                <p>
                  <strong>Weak follow-up flags:</strong>
                </p>
                <ul>
                  {review.weak_followup_flags.map((f, i) => (
                    <li key={i}>
                      [{f.flag_type}] {f.statement} → {f.recommendation}
                    </li>
                  ))}
                </ul>
              </>
            )}
            </>
          ) : (
            <p className="muted">No follow-up review recorded for this thread yet.</p>
          )}
        </section>
      </div>
    </div>
  );
}
