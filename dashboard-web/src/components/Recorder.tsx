import { useRef, useState } from "react";
import type { Stage } from "../types";
import { postRecording, audioUrl } from "../api";

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
  pre: "Say who you're meeting (so it can be matched to a thread), then speak through: why you're meeting them, what you're trying to learn or decide, your hypothesis, what would make it useful or a waste of time, and what prior commitments to check.",
  post: "Say who the meeting was with, then speak through: what happened, who was there, what surprised you, what was agreed, who owns each next step, what evidence is needed, the next action, the thread's current state, and any date promised for the follow-up.",
  followup: "Say which relationship this follow-up is about, then speak through: what was supposed to happen since last time, whether it did, whether it created real progress, why not if it didn't, and whether the next meeting is still worth having.",
};

type Status = "idle" | "recording" | "processing" | "done" | "error";

interface RecorderResult {
  threadId: string;
  extracted: unknown;
  audioKey: string | null;
  note: string | null;
}

export function Recorder({ onRecorded }: { onRecorded: () => void }) {
  const [stage, setStage] = useState<Stage>("pre");
  const [status, setStatus] = useState<Status>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<RecorderResult | null>(null);
  const [error, setError] = useState("");
  const [nudgeStage, setNudgeStage] = useState<Stage | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | undefined>(undefined);

  function resetForNewTake() {
    setError("");
    setResult(null);
  }

  async function actuallyStart() {
    resetForNewTake();

    if (!navigator.mediaDevices?.getUserMedia) {
      setError(
        "Microphone access isn't available. This needs HTTPS (or localhost) — check the address bar."
      );
      setStatus("error");
      return;
    }

    try {
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
    } catch (e) {
      const name = e instanceof DOMException ? e.name : "";
      const message =
        name === "NotAllowedError"
          ? "Microphone access was denied. Allow it for this site in your browser settings and try again."
          : name === "NotFoundError"
            ? "No microphone was found on this device."
            : e instanceof Error
              ? e.message
              : String(e);
      setError(message);
      setStatus("error");
    }
  }

  function handleRecordClick() {
    if (status === "recording") {
      recorderRef.current?.stop();
      window.clearInterval(timerRef.current);
      setStatus("processing");
      return;
    }
    void actuallyStart();
  }

  async function processRecording(mimeType: string) {
    try {
      const blob = new Blob(chunksRef.current, { type: mimeType });
      const base64 = await blobToBase64(blob);
      const res = await postRecording({ stage, audio_base64: base64, mime_type: mimeType });
      setResult({
        threadId: res.thread_id,
        extracted: res.extracted,
        audioKey: res.audio_recording_key,
        note: res.note ?? null,
      });
      setStatus("done");
      // Nudge toward the natural next step. Pre -> Post is the one that was
      // explicitly asked for; Post's own completion just clears any pending nudge.
      setNudgeStage(stage === "pre" ? "post" : null);
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
            className={[
              "stage-tab",
              s === stage ? "active" : "",
              s === nudgeStage ? "nudge" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            disabled={status === "recording" || status === "processing"}
            onClick={() => {
              setStage(s);
              setStatus("idle");
              resetForNewTake();
              if (s === nudgeStage) setNudgeStage(null);
            }}
          >
            {STAGE_LABELS[s]}
          </button>
        ))}
      </div>

      {nudgeStage && (
        <p className="nudge-banner">
          Pre-meeting brief recorded — tap "{STAGE_LABELS[nudgeStage]}" above once the meeting's done.
        </p>
      )}

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
          {status === "processing" && (
            <span>Processing — this can take 10-30s while Gemini matches the thread and extracts details…</span>
          )}
          {status === "done" && result && <span>Done — matched to thread "{result.threadId}".</span>}
          {status === "error" && <span className="error-text">{error}</span>}
        </div>
      </div>

      {result && (
        <details className="result-preview" open>
          <summary>Extracted result — thread "{result.threadId}"</summary>
          {result.note && <p className="muted">{result.note}</p>}
          {result.audioKey && (
            <audio className="playback" controls src={audioUrl(result.audioKey)}>
              Your browser can't play this recording. It's still saved — retrieve it at{" "}
              {audioUrl(result.audioKey)}
            </audio>
          )}
          <pre>{JSON.stringify(result.extracted, null, 2)}</pre>
        </details>
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
