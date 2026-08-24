import { useRef, useState } from "react";
import type { Stage, Thread } from "../types";
import { postRecording } from "../api";

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const STAGE_LABELS: Record<Stage, string> = {
  pre: "Pre-meeting",
  post: "Post-meeting",
  followup: "Follow-up",
};

const STAGE_HINTS: Record<Stage, string> = {
  pre: "Speak through: why you're meeting them, what you're trying to learn or decide, your hypothesis, what would make it useful or a waste of time, and what prior commitments to check.",
  post: "Speak through: what happened, who was there, what surprised you, what was agreed, who owns each next step, what evidence is needed, the next action, the thread's current state, and any date promised for the follow-up.",
  followup: "Speak through: what was supposed to happen since last time, whether it did, whether it created real progress, why not if it didn't, and whether the next meeting is still worth having.",
};

type Status = "idle" | "recording" | "processing" | "done" | "error";

export function Recorder({ threads, onRecorded }: { threads: Thread[]; onRecorded: () => void }) {
  const [stage, setStage] = useState<Stage>("pre");
  const [threadId, setThreadId] = useState("");
  const [organization, setOrganization] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState("");
  const [showPreCheck, setShowPreCheck] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | undefined>(undefined);

  const selectedThread = threads.find((t) => t.thread_id === threadId.trim());
  const hasPendingPre = !!selectedThread?.pending_pre_meeting_brief;

  async function actuallyStart() {
    setError("");
    setResult(null);
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "audio/webm";
    const recorder = new MediaRecorder(stream, { mimeType });
    chunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      void processRecording(mimeType);
    };
    recorderRef.current = recorder;
    recorder.start();
    setStatus("recording");
    setElapsed(0);
    timerRef.current = window.setInterval(() => setElapsed((e) => e + 1), 1000);
  }

  function handleRecordClick() {
    if (status === "recording") {
      recorderRef.current?.stop();
      window.clearInterval(timerRef.current);
      setStatus("processing");
      return;
    }
    if (!threadId.trim()) {
      setError("Enter a thread id first (a short slug like 'bhpro').");
      return;
    }
    if (stage === "post" && !hasPendingPre) {
      setShowPreCheck(true);
      return;
    }
    void actuallyStart();
  }

  async function processRecording(mimeType: string) {
    try {
      const blob = new Blob(chunksRef.current, { type: mimeType });
      const base64 = await blobToBase64(blob);
      const res = await postRecording({
        thread_id: threadId.trim(),
        stage,
        audio_base64: base64,
        mime_type: mimeType,
        organization: organization.trim() || undefined,
      });
      setResult(res.extracted);
      setStatus("done");
      onRecorded();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }

  return (
    <div className="recorder">
      <div className="stage-tabs">
        {(["pre", "post", "followup"] as Stage[]).map((s) => (
          <button
            key={s}
            className={s === stage ? "stage-tab active" : "stage-tab"}
            disabled={status === "recording" || status === "processing"}
            onClick={() => {
              setStage(s);
              setStatus("idle");
              setResult(null);
              setError("");
            }}
          >
            {STAGE_LABELS[s]}
          </button>
        ))}
      </div>

      <div className="recorder-form">
        <label>
          Thread id
          <input
            list="thread-ids"
            value={threadId}
            disabled={status === "recording" || status === "processing"}
            onChange={(e) => setThreadId(e.target.value)}
            placeholder="e.g. bhpro (new or existing)"
          />
          <datalist id="thread-ids">
            {threads.map((t) => (
              <option key={t.thread_id ?? ""} value={t.thread_id ?? ""} />
            ))}
          </datalist>
        </label>
        {stage === "pre" && (
          <label>
            Organization (optional)
            <input
              value={organization}
              disabled={status === "recording" || status === "processing"}
              onChange={(e) => setOrganization(e.target.value)}
              placeholder="e.g. BHPro"
            />
          </label>
        )}
      </div>

      <p className="stage-hint">{STAGE_HINTS[stage]}</p>

      <div className="record-control">
        <button
          className={`record-button ${status === "recording" ? "recording" : ""}`}
          onClick={handleRecordClick}
          disabled={status === "processing"}
          aria-label={status === "recording" ? "Stop recording" : "Start recording"}
        >
          <SpeakerIcon active={status === "recording"} />
        </button>
        <div className="record-status">
          {status === "idle" && <span>Tap to record your {STAGE_LABELS[stage].toLowerCase()} answer</span>}
          {status === "recording" && <span>Recording… {formatElapsed(elapsed)} — tap to stop</span>}
          {status === "processing" && <span>Processing…</span>}
          {status === "done" && <span>Done — tables updated.</span>}
          {status === "error" && <span className="error-text">{error}</span>}
        </div>
      </div>

      {result != null && (
        <details className="result-preview" open>
          <summary>Extracted result</summary>
          <pre>{JSON.stringify(result, null, 2)}</pre>
        </details>
      )}

      {showPreCheck && (
        <div className="modal-backdrop">
          <div className="modal">
            <h3>No pre-meeting brief recorded</h3>
            <p>
              Thread "{threadId.trim()}" doesn't have a pre-meeting brief recorded yet. Record it now, or
              continue with the post-meeting recording anyway?
            </p>
            <div className="modal-actions">
              <button
                onClick={() => {
                  setShowPreCheck(false);
                  setStage("pre");
                }}
              >
                Record pre-meeting brief
              </button>
              <button
                className="secondary"
                onClick={() => {
                  setShowPreCheck(false);
                  void actuallyStart();
                }}
              >
                Continue anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SpeakerIcon({ active }: { active: boolean }) {
  if (active) {
    return (
      <svg viewBox="0 0 24 24" width="32" height="32" fill="currentColor">
        <rect x="6" y="6" width="12" height="12" rx="2" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" width="32" height="32" fill="currentColor">
      <path d="M3 10v4h4l5 5V5L7 10H3z" />
      <path
        d="M16.5 12c0-1.77-.77-3.29-2-4.24v8.48c1.23-.95 2-2.47 2-4.24z"
        opacity="0.9"
      />
      <path
        d="M14.5 4.6v2.1c2.3 1.02 4 3.35 4 6.3s-1.7 5.28-4 6.3v2.1c3.5-1.11 6-4.42 6-8.4s-2.5-7.29-6-8.4z"
        opacity="0.7"
      />
    </svg>
  );
}
