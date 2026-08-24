import encounterSchema from "./schemas/encounter-record.schema.json";
import momentumSchema from "./schemas/momentum-review.schema.json";
import { PRE_MEETING_QUESTIONS, POST_MEETING_QUESTIONS, FOLLOWUP_QUESTIONS } from "./questions";

function numbered(questions: string[]): string {
  return questions.map((q, i) => `${i + 1}. ${q}`).join("\n");
}

export function buildPrePrompt(threadId: string): string {
  return JSON.stringify(
    {
      instructions:
        "The attached audio is the user speaking their answers, in order, to the following pre-meeting " +
        `questions:\n${numbered(PRE_MEETING_QUESTIONS)}\n` +
        "Produce a single JSON object with exactly these keys and no others: " +
        "pre_meeting_purpose (string, answer to Q1+Q2), hypothesis (string, answer to Q3), " +
        "success_criteria (string array, from Q2 and Q4), waste_of_time_criteria (string, answer to Q5), " +
        "prior_commitments_to_check (string array, answer to Q6, empty array if none mentioned). " +
        "Use the user's own words, cleaned up into complete sentences — do not invent content they didn't say.",
      thread_id: threadId,
    },
    null,
    2
  );
}

export function buildPostPrompt(threadId: string, pendingPreBrief: any, referenceDate: string): string {
  return JSON.stringify(
    {
      instructions:
        "The attached audio is the user speaking their own answers, in order, to the following post-meeting " +
        `debrief questions:\n${numbered(POST_MEETING_QUESTIONS)}\n` +
        "Produce a single JSON object with two top-level keys: 'encounter_record' and 'momentum_review'.\n" +
        "encounter_record MUST validate against encounter_record_schema below: use exactly the property names " +
        "it defines, use exactly one of the listed enum values for any enum property (never free text), match " +
        "each property's declared type (arrays must be JSON arrays, not strings), and include no properties " +
        "beyond those the schema defines (additionalProperties is false).\n" +
        "This audio is the user's own spoken answers directly mapping onto the schema fields (Q1->observations, " +
        "Q2->people_present, Q3/Q4->observations, Q5->decisions_made, Q6->commitments (owner per item), " +
        "Q7->evidence_required, Q8->next_logical_action, Q9->current_state, Q10->next_meeting_date) — this is " +
        "direct extraction, not inference from a raw conversation transcript.\n" +
        `thread_id is '${threadId}'. If pendingPreBrief is non-null, use its fields verbatim for ` +
        "pre_meeting_purpose/hypothesis/success_criteria rather than re-deriving them from the audio.\n" +
        "encounter_name: a short descriptive title if not obvious from context, e.g. '<organization> check-in'. " +
        "local_timezone/meeting_type/momentum_status/recommended_next_action/failure_mode: infer a reasonable " +
        "value if not explicitly stated — never leave a required field null.\n" +
        `datetime_local is required and must never be null — if not stated, use ${referenceDate}.\n` +
        "next_meeting_date: if a follow-up date was promised or implied (Q10), set it (YYYY-MM-DD), else null.\n" +
        "topics: 1-4 short (1-3 word) thematic tags for what was discussed.\n" +
        "momentum_review should conform to momentum_review_schema. Omit it (set to null) if this is a first " +
        "encounter on this thread with no prior history to review.\n" +
        "Label statements explicitly by type: [FACT], [ASSUMPTION], [HYPOTHESIS], [DECISION], [COMMITMENT], " +
        "[OPEN QUESTION], [RECOMMENDATION]. If something is unclear, add an [OPEN QUESTION] entry to " +
        "epistemic_log rather than invent details.",
      encounter_record_schema: encounterSchema,
      momentum_review_schema: momentumSchema,
      thread_id: threadId,
      pendingPreBrief: pendingPreBrief || null,
      reference_date: referenceDate,
    },
    null,
    2
  );
}

export function buildFollowupPrompt(threadId: string, encounterHistory: string): string {
  return JSON.stringify(
    {
      instructions:
        "The attached audio is the user speaking their own answers, in order, to the following follow-up " +
        `maturity questions:\n${numbered(FOLLOWUP_QUESTIONS)}\n` +
        `Combine those spoken answers with the encounter history for thread_id='${threadId}' below to produce ` +
        "a single JSON object conforming to momentum_review_schema, under a top-level key 'momentum_review'. " +
        "Be direct about whether this thread is Dormant, whether follow-up was activity without impact, and " +
        "whether the next meeting should continue, close, reassign, restart, or replace the player.\n" +
        "meeting_recommendation is required: explicitly answer 'is the next meeting really necessary' as " +
        "decision='hold' (yes, proceed as planned), 'skip' (no — e.g. thread is Dormant, agreed work never " +
        "happened and nothing changed, or it would be a repeat meeting with no new information), or " +
        "'reschedule' (worth having, but not yet — evidence/work is still pending). rationale must be a short, " +
        "direct justification grounded in both the history and the user's own spoken assessment.",
      momentum_review_schema: momentumSchema,
      thread_id: threadId,
      encounter_history: encounterHistory,
    },
    null,
    2
  );
}
