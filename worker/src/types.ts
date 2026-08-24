export interface Env {
  SMARTSHEET_API_TOKEN: string;
  GEMINI_API_KEY: string;
  DASHBOARD_KEY: string;
  ENCOUNTER_SHEET_ID: string;
  THREAD_SHEET_ID: string;
  GEMINI_MODEL: string;
}

export type Stage = "pre" | "post" | "followup";

export interface RecordRequestBody {
  thread_id: string;
  stage: Stage;
  audio_base64: string;
  mime_type: string;
  organization?: string;
  encounter_name?: string;
  location?: string;
}
