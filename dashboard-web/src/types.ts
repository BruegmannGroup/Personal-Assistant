export type Stage = "pre" | "post" | "followup";

export interface Thread {
  thread_id: string | null;
  organizations: string | null;
  current_state: string | null;
  last_encounter_date: string | null;
  next_followup_date: string | null;
  pending_pre_meeting_brief: string | null;
  pending_pre_meeting_recorded_at: string | null;
  last_followup_reviewed_at: string | null;
  meeting_recommendation_decision: string | null;
  meeting_recommendation_rationale: string | null;
}

export interface Commitment {
  description: string;
  owner: string;
  due_date?: string | null;
  evidence_required?: string;
}

export interface Encounter {
  thread_id: string;
  encounter_name: string;
  datetime_local: string;
  organization?: string;
  commitments?: Commitment[];
  topics?: string[];
  next_meeting_date?: string | null;
  current_state?: string;
  [key: string]: unknown;
}
