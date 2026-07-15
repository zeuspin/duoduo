#!/usr/bin/env python3

import json
import os
import sys
from pathlib import Path

from dashscope.audio.asr import Recognition, RecognitionCallback


def load_env(path: str = ".env") -> None:
    env_path = Path(path)
    if not env_path.exists():
        return
    for raw_line in env_path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


class CollectingCallback(RecognitionCallback):
    def __init__(self) -> None:
        self.events = []
        self.errors = []
        self.opened = False
        self.completed = False
        self.closed = False

    def on_open(self) -> None:
        self.opened = True

    def on_close(self) -> None:
        self.closed = True

    def on_complete(self) -> None:
        self.completed = True

    def on_error(self, result) -> None:
        self.errors.append(result_to_dict(result))

    def on_event(self, result) -> None:
        self.events.append(result_to_dict(result))


def result_to_dict(result):
    if isinstance(result, dict):
        return dict(result)
    try:
        to_dict = object.__getattribute__(result, "to_dict")
    except Exception:
        to_dict = None
    if callable(to_dict):
        return to_dict()
    try:
        return dict(result.__dict__)
    except Exception:
        return {"repr": repr(result)}


def extract_texts(events):
    texts = []
    for event in events:
        for key in ("sentence", "output", "result"):
            value = event.get(key)
            if isinstance(value, dict):
                text = value.get("text") or value.get("sentence")
                if text:
                    texts.append(text)
            elif isinstance(value, str) and value:
                texts.append(value)
        text = event.get("text")
        if isinstance(text, str) and text:
            texts.append(text)
    deduped = []
    for text in texts:
        if text not in deduped:
            deduped.append(text)
    return deduped


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: bailian_asr_smoke.py <wav-file> [model]", file=sys.stderr)
        return 2

    load_env()
    api_key = os.environ.get("BAILIAN_API_KEY") or os.environ.get("DASHSCOPE_API_KEY")
    if not api_key:
        print(json.dumps({"ok": False, "reason": "missing-api-key"}))
        return 2

    audio_path = Path(sys.argv[1])
    model = sys.argv[2] if len(sys.argv) > 2 else "paraformer-realtime-v2"
    output_path = Path(sys.argv[3]) if len(sys.argv) > 3 else None
    callback = CollectingCallback()
    recognition = Recognition(
        model=model,
        callback=callback,
        format="wav",
        sample_rate=16000,
        api_key=api_key,
    )

    try:
        result = recognition.call(str(audio_path))
    except Exception as exc:
        print(json.dumps({"ok": False, "reason": "exception", "model": model, "error": str(exc)}, ensure_ascii=False))
        return 1

    payload = {
        "ok": not callback.errors,
        "model": model,
        "audio_file": str(audio_path),
        "opened": callback.opened,
        "completed": callback.completed,
        "closed": callback.closed,
        "event_count": len(callback.events),
        "errors": callback.errors,
        "texts": extract_texts(callback.events),
        "final_result": result_to_dict(result),
    }
    rendered = json.dumps(payload, ensure_ascii=False, indent=2)
    if output_path:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(rendered + "\n")
        print(json.dumps({
            "ok": payload["ok"],
            "model": payload["model"],
            "audio_file": payload["audio_file"],
            "event_count": payload["event_count"],
            "sentence_count": len(payload.get("final_result", {}).get("output", {}).get("sentence", [])),
            "output_file": str(output_path),
        }, ensure_ascii=False, indent=2))
    else:
        print(rendered)
    return 0 if payload["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
