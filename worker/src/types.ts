export interface Env {
  SMARTSHEET_API_TOKEN: string;
  GEMINI_API_KEY: string;
  DASHBOARD_KEY: string;
  ENCOUNTER_SHEET_ID: string;
  THREAD_SHEET_ID: string;
  GEMINI_MODEL: string;
  AUDIO_BUCKET: R2Bucket;
  SENDGRID_API_KEY: string;
  ALERT_FROM_EMAIL: string;
  ALERT_TO_EMAIL: string;
  CRON_TOKEN: string;
}

export type Stage = "pre" | "post" | "followup";

export interface RecordRequestBody {
  stage: Stage;
  audio_base64: string;
  mime_type: string;
}
