#!/usr/bin/env python3
"""Live audio capture for a meeting in progress — the Granola-style "no bot" alternative
to pulling transcripts through Teams/Graph (blocked by admin consent).

Records from one or more audio devices (mic-only works everywhere; add a loopback-capable
device for full system audio where the OS exposes one — see audio_capture.py) until you
stop it, then runs the same pipeline transcribe_and_extract.py uses.

Usage:
  python live_capture.py --list-devices
  python live_capture.py --thread-id bhpro --metadata bhpro_pre.json --sync-smartsheet
  python live_capture.py --devices "MacBook Pro Microphone,BlackHole 2ch" --sync-smartsheet
"""

from __future__ import annotations

import argparse
import json
import threading
from datetime import datetime
from pathlib import Path

from audio_capture import list_devices, record_to_wav
from transcribe_and_extract import run_pipeline

REPO_ROOT = Path(__file__).resolve().parent
DEVICES_CONFIG_PATH = REPO_ROOT / "audio_devices.json"


def print_device_list() -> None:
    devices = list_devices()
    if not devices:
        print("No audio input devices found.")
        return
    print("Available devices:")
    for d in devices:
        tag = " (loopback — full system audio)" if d["is_loopback"] else ""
        print(f"  - {d['name']}{tag}")


def load_saved_devices() -> list[str] | None:
    if DEVICES_CONFIG_PATH.exists():
        return json.loads(DEVICES_CONFIG_PATH.read_text(encoding="utf-8")).get("devices")
    return None


def save_devices(device_names: list[str]) -> None:
    DEVICES_CONFIG_PATH.write_text(json.dumps({"devices": device_names}, indent=2), encoding="utf-8")


def prompt_for_devices() -> list[str]:
    devices = list_devices()
    print("No device selection saved yet. Available devices:")
    for i, d in enumerate(devices):
        tag = " (loopback)" if d["is_loopback"] else ""
        print(f"  [{i}] {d['name']}{tag}")
    raw = input("Enter device number(s) to record from, comma-separated (e.g. 0 or 0,1): ").strip()
    indexes = [int(x) for x in raw.split(",") if x.strip()]
    chosen = [devices[i]["name"] for i in indexes]
    save_devices(chosen)
    print(f"Saved device selection to {DEVICES_CONFIG_PATH.name} — future runs won't ask again.")
    return chosen


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--list-devices", action="store_true", help="List available audio devices and exit")
    p.add_argument("--devices", help="Comma-separated device name(s) to record from (overrides saved selection)")
    p.add_argument("--metadata", help="Optional JSON file with pre-meeting metadata (e.g. from pre_meeting.py)")
    p.add_argument("--out", default="out.json", help="Output JSON file with final results")
    p.add_argument("--llm-provider", default=None, help="gemini | openai | anthropic (default: $LLM_PROVIDER or gemini)")
    p.add_argument("--llm-model", default=None, help="Model name (default: the chosen provider's own default)")
    p.add_argument("--sync-smartsheet", action="store_true", help="Push the validated encounter record to Smartsheet")
    args = p.parse_args()

    if args.list_devices:
        print_device_list()
        return

    if args.devices:
        device_names = [d.strip() for d in args.devices.split(",")]
    else:
        device_names = load_saved_devices() or prompt_for_devices()

    metadata = {}
    if args.metadata:
        metadata = json.loads(Path(args.metadata).read_text(encoding="utf-8"))

    audio_path = REPO_ROOT / f"live_recording_{datetime.now().strftime('%Y%m%d_%H%M%S')}.wav"
    stop_event = threading.Event()

    print(f"Recording from: {', '.join(device_names)}")
    print("Press Enter to stop recording...")

    record_thread = threading.Thread(target=record_to_wav, args=(device_names, audio_path, stop_event))
    record_thread.start()
    input()
    stop_event.set()
    record_thread.join()

    print(f"Recording saved to {audio_path}. Running transcription + extraction...")

    run_pipeline(
        audio_path=str(audio_path),
        metadata=metadata,
        provider=args.llm_provider,
        model_name=args.llm_model,
        sync_smartsheet=args.sync_smartsheet,
        out_path=args.out,
    )


if __name__ == "__main__":
    main()
