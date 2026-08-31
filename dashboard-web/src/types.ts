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
  audio_recording_key: string | null;
  last_momentum_review_json: string | null;
}

export interface NonAdvanceItem {
  item: string;
  reason_type: string;
  details: string;
}

export interface WeakFollowupFlag {
  flag_type: string;
  statement: string;
  recommendation: string;
}

export interface MomentumReview {
  thread_id: string;
  thread_name?: string;
  purpose?: string;
  hypothesis?: string;
  agreed_actions?: string[];
  owners?: string[];
  evidence_required?: string[];
  what_happened_since?: string[];
  new_work_generated?: string[];
  conclusion_reached?: string | null;
  items_not_advanced?: string[];
  non_advance_analysis?: NonAdvanceItem[];
  ownership_existence?: string;
  recommended_objective_for_next_meeting?: string;
  thread_state?: string;
  weak_followup_flags?: WeakFollowupFlag[];
  meeting_recommendation?: { decision: string; rationale: string };
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
  pre_meeting_purpose?: string;
  decisions_made?: string[];
  commitments?: Commitment[];
  topics?: string[];
  next_meeting_date?: string | null;
  current_state?: string;
  audio_recording_key?: string | null;
  [key: string]: unknown;
}
