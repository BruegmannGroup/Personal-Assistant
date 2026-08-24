"""Cross-platform live audio capture — the Granola-style "no bot" alternative to
pulling transcripts through Teams/Graph (which is blocked by admin consent; see
NEXT_STEPS.md / the plan file for why).

Works below the application layer, at the OS audio layer, so it's identical for
Teams, Zoom, in-person meetings, or anything else. No Graph permissions involved.

Pluggable to any device: this module never branches on OS. It just records from
whichever named device(s) the caller gives it and mixes them. Which devices are
available — and whether a loopback-capable one exists at all — is entirely a
property of what the OS exposes:
  - Windows: WASAPI loopback is native, no driver needed.
  - Linux: PulseAudio/PipeWire monitor sources are native, no driver needed.
  - macOS: no native loopback concept; a virtual driver (e.g. BlackHole) is
    required for system-audio capture, and shows up here as a normal device
    once installed — no macOS-specific code path exists in this file.

If no loopback device is available, mic-only capture still works everywhere —
that's the universal baseline, and is sufficient if call audio plays through
speakers rather than headphones (the mic then hears both sides of the call).
"""

from __future__ import annotations

import threading
import wave
from pathlib import Path

import numpy as np
import soundcard as sc

SAMPLE_RATE = 16000  # matches what faster-whisper expects


def list_devices() -> list[dict]:
    """Every recordable device the OS exposes, real mics and loopback alike."""
    devices = []
    for m in sc.all_microphones(include_loopback=True):
        devices.append({"name": m.name, "is_loopback": bool(getattr(m, "isloopback", False))})
    return devices


def record_to_wav(device_names: list[str], out_path: Path, stop_event: threading.Event) -> None:
    """Record from one or more named devices simultaneously until stop_event is set,
    mixing them into a single mono 16-bit PCM WAV file at out_path.

    Raises ValueError if any requested device name isn't found — callers should
    validate against list_devices() first (live_capture.py does).
    """
    all_mics = {m.name: m for m in sc.all_microphones(include_loopback=True)}
    missing = [name for name in device_names if name not in all_mics]
    if missing:
        raise ValueError(f"Unknown device(s): {missing}. Run --list-devices to see what's available.")

    recorders = [all_mics[name] for name in device_names]
    chunk_frames = SAMPLE_RATE // 10  # 100ms chunks, keeps stop latency low
    mixed_chunks = []

    open_recorders = [
        rec.recorder(samplerate=SAMPLE_RATE, channels=1).__enter__() for rec in recorders
    ]
    try:
        while not stop_event.is_set():
            frames = [r.record(numframes=chunk_frames) for r in open_recorders]
            mixed = np.sum(frames, axis=0)
            mixed_chunks.append(np.clip(mixed, -1.0, 1.0))
    finally:
        for rec in open_recorders:
            rec.__exit__(None, None, None)

    if not mixed_chunks:
        audio = np.zeros((0, 1), dtype=np.float32)
    else:
        audio = np.concatenate(mixed_chunks, axis=0)

    pcm16 = (audio.flatten() * 32767).astype(np.int16)
    with wave.open(str(out_path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(SAMPLE_RATE)
        wf.writeframes(pcm16.tobytes())
