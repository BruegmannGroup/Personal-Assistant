import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { fetchAudioUrl } from "../api";

// Playback links are minted on demand and expire after a few minutes, so they
// cannot be read straight out of props the way a static URL could. Each of
// these components fetches its own signed URL and renders once it arrives.
function useSignedAudioUrl(audioKey: string | null | undefined) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!audioKey) {
      setUrl(null);
      return;
    }
    let cancelled = false;
    setError("");
    setUrl(null);
    fetchAudioUrl(audioKey)
      .then((signed) => {
        if (!cancelled) setUrl(signed);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [audioKey]);

  return { url, error };
}

export function AudioPlayer({ audioKey }: { audioKey: string }) {
  const { url, error } = useSignedAudioUrl(audioKey);

  if (error) return <p className="error-text">Couldn't load recording: {error}</p>;
  if (!url) return <p className="muted">Loading recording…</p>;

  return (
    <audio className="playback" controls src={url}>
      Your browser can't play this recording. It's still saved in R2 under key {audioKey}.
    </audio>
  );
}

export function AudioLink({
  audioKey,
  title,
  children,
}: {
  audioKey: string;
  title?: string;
  children: ReactNode;
}) {
  const { url } = useSignedAudioUrl(audioKey);
  if (!url) return null;

  return (
    <a
      className="listen-link"
      href={url}
      target="_blank"
      rel="noreferrer"
      title={title}
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </a>
  );
}
