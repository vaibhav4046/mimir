"""Mimir Local Open-Source Voice Engine (TTS + STT).

Supports:
- Persistent `--mode daemon` JSON-lines worker over stdin/stdout (keeps faster-whisper warm in RAM)
- Backward-compatible one-shot CLI flags (`--mode status`, `--mode tts`, `--mode stt`)
- Neural edge-tts synthesis (en-GB-RyanNeural / en-US-AndrewNeural) with automatic SAPI5 fallback
- Offline Windows System.Speech SAPI5 WAV synthesis (always available offline on Win11)
- Local offline speech-to-text via faster-whisper (WhisperModel tiny/base)
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import json
import os
import subprocess
import sys
from typing import Any

os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")
os.environ.setdefault("TQDM_DISABLE", "1")

_WHISPER_MODELS: dict[str, Any] = {}


def _resolve_sapi_voice_pref(voice_pref: str) -> str:
    lower = str(voice_pref or "").lower()
    if any(tok in lower for tok in ("zira", "aria", "sonia", "jenny", "libby")):
        return "Zira"
    return "David"


def synthesize_sapi(text: str, out_path: str, voice_pref: str = "david", rate: int = 0) -> dict:
    preferred = _resolve_sapi_voice_pref(voice_pref)
    clamped_rate = int(max(-4, min(4, int(rate))))
    ps_script = (
        "Add-Type -AssemblyName System.Speech; "
        "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; "
        f"$match = $s.GetInstalledVoices() | Where-Object {{ $_.VoiceInfo.Name -like '*{preferred}*' }} | Select-Object -First 1; "
        "if ($match) { $s.SelectVoice($match.VoiceInfo.Name); }; "
        f"$s.Rate = {clamped_rate}; "
        "$s.SetOutputToWaveFile($env:MIMIR_TTS_OUT); "
        "$s.Speak($env:MIMIR_TTS_TEXT); "
        "$name = $s.Voice.Name; "
        "$s.Dispose(); "
        "Write-Output $name"
    )
    env = os.environ.copy()
    env["MIMIR_TTS_TEXT"] = text
    env["MIMIR_TTS_OUT"] = out_path
    proc = subprocess.run(
        ["powershell", "-NoProfile", "-Command", ps_script],
        capture_output=True,
        text=True,
        timeout=20,
        check=True,
        env=env,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    voice_used = proc.stdout.strip().splitlines()[-1] if proc.stdout.strip() else preferred
    size = os.path.getsize(out_path) if os.path.exists(out_path) else 0
    return {
        "ok": os.path.exists(out_path) and size > 44,
        "engine": "windows-sapi5-offline",
        "voice": voice_used,
        "mime": "audio/wav",
        "outPath": out_path,
        "bytes": size,
    }


async def synthesize_edge(
    text: str,
    out_path: str,
    voice: str = "en-GB-RyanNeural",
    rate: int = 0,
) -> dict:
    import edge_tts

    pct = int(max(-50, min(50, int(rate) * 10)))
    rate_str = f"{pct:+d}%"
    communicate = edge_tts.Communicate(
        text,
        voice,
        rate=rate_str,
        connect_timeout=5,
        receive_timeout=15,
    )
    await asyncio.wait_for(communicate.save(out_path), timeout=18.0)
    size = os.path.getsize(out_path) if os.path.exists(out_path) else 0
    if not (os.path.exists(out_path) and size > 100):
        raise RuntimeError("edge-tts produced empty audio output")
    return {
        "ok": True,
        "engine": "edge-tts-neural",
        "voice": voice,
        "mime": "audio/mpeg",
        "outPath": out_path,
        "bytes": size,
    }


def get_whisper_model(model_size: str = "tiny") -> tuple[Any, bool]:
    key = str(model_size or "tiny").strip() or "tiny"
    was_cached = key in _WHISPER_MODELS
    if not was_cached:
        from faster_whisper import WhisperModel

        _WHISPER_MODELS[key] = WhisperModel(key, device="cpu", compute_type="int8")
    return _WHISPER_MODELS[key], was_cached


def transcribe_whisper(audio_path: str, model_size: str = "tiny") -> dict:
    model, was_cached = get_whisper_model(model_size)
    segments, info = model.transcribe(audio_path, beam_size=1)
    text_parts = [seg.text.strip() for seg in segments if seg.text.strip()]
    return {
        "ok": True,
        "engine": f"faster-whisper-{model_size}",
        "language": getattr(info, "language", "en"),
        "text": " ".join(text_parts).strip(),
        "modelCached": was_cached,
    }


def get_status() -> dict:
    has_fw = False
    has_edge = False
    try:
        import faster_whisper  # noqa: F401
        has_fw = True
    except Exception:
        pass
    try:
        import edge_tts  # noqa: F401
        has_edge = True
    except Exception:
        pass
    return {
        "ok": True,
        "pid": os.getpid(),
        "sapiOffline": True,
        "edgeTts": has_edge,
        "fasterWhisper": has_fw,
        "whisperCached": list(_WHISPER_MODELS.keys()),
    }


def handle_tts(
    text: str,
    out_path: str,
    engine: str = "auto",
    voice: str = "en-GB-RyanNeural",
    rate: int = 0,
    local_only: bool = False,
) -> dict:
    clean_text = str(text or "").strip()
    if not clean_text:
        return {"ok": False, "error": "Empty TTS text"}

    out_abs = os.path.abspath(out_path)
    os.makedirs(os.path.dirname(out_abs), exist_ok=True)

    voice_str = str(voice or "en-GB-RyanNeural").strip() or "en-GB-RyanNeural"
    engine_str = str(engine or "auto").strip().lower()
    force_sapi = bool(local_only) or engine_str == "sapi" or voice_str.lower().endswith("-sapi")

    fallback_used = False
    fallback_reason = None

    if not force_sapi and engine_str in ("auto", "neural"):
        neural_voice = voice_str if not voice_str.lower().endswith("-sapi") else "en-GB-RyanNeural"
        mp3_path = out_abs if out_abs.lower().endswith(".mp3") else f"{os.path.splitext(out_abs)[0]}.mp3"
        try:
            res = asyncio.run(synthesize_edge(clean_text, mp3_path, neural_voice, rate))
            res["fallbackUsed"] = False
            return res
        except Exception as exc:
            fallback_used = True
            fallback_reason = str(exc)
            try:
                if os.path.exists(mp3_path) and os.path.getsize(mp3_path) <= 100:
                    os.remove(mp3_path)
            except Exception:
                pass

    wav_path = out_abs if out_abs.lower().endswith(".wav") else f"{os.path.splitext(out_abs)[0]}.wav"
    try:
        res = synthesize_sapi(clean_text, wav_path, voice_str, rate)
    except Exception:
        try:
            if os.path.exists(wav_path) and os.path.getsize(wav_path) <= 44:
                os.remove(wav_path)
        except Exception:
            pass
        raise
    res["fallbackUsed"] = fallback_used
    if fallback_reason:
        res["fallbackReason"] = fallback_reason
    return res


def handle_stt(audio_path: str, model_size: str = "tiny") -> dict:
    if not audio_path or not os.path.exists(audio_path):
        return {"ok": False, "error": f"Audio file not found: {audio_path}"}
    try:
        return transcribe_whisper(audio_path, model_size)
    except Exception as exc:
        return {"ok": False, "error": f"STT unavailable: {exc}"}


def _write_json_line(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def run_daemon() -> int:
    if hasattr(sys.stdin, "reconfigure"):
        sys.stdin.reconfigure(encoding="utf-8", errors="replace")
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue
        req_id = None
        try:
            req = json.loads(line)
            req_id = req.get("id")
            op = str(req.get("op") or "").strip().lower()

            with contextlib.redirect_stdout(sys.stderr):
                if op == "shutdown":
                    res = {"ok": True, "pid": os.getpid(), "shuttingDown": True}
                elif op == "status":
                    res = get_status()
                elif op == "warmup":
                    if req.get("preloadStt"):
                        get_whisper_model(str(req.get("model") or "tiny"))
                    res = get_status()
                elif op == "tts":
                    res = handle_tts(
                        text=req.get("text", ""),
                        out_path=req.get("outPath") or req.get("out") or "",
                        engine=req.get("engine", "auto"),
                        voice=req.get("voice", "en-GB-RyanNeural"),
                        rate=int(req.get("rate", 0)),
                        local_only=bool(req.get("localOnly", False)),
                    )
                    res["pid"] = os.getpid()
                elif op == "stt":
                    res = handle_stt(
                        audio_path=req.get("audioPath") or req.get("audio") or "",
                        model_size=str(req.get("model") or "tiny"),
                    )
                    res["pid"] = os.getpid()
                else:
                    res = {"ok": False, "error": f"Unknown op: {op}", "pid": os.getpid()}

            _write_json_line({"id": req_id, **res})
            if op == "shutdown":
                return 0
        except Exception as exc:
            _write_json_line({"id": req_id, "ok": False, "error": str(exc), "pid": os.getpid()})

    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", required=True, choices=["tts", "stt", "status", "daemon"])
    parser.add_argument("--text", default="")
    parser.add_argument("--out", default="")
    parser.add_argument("--audio", default="")
    parser.add_argument("--engine", default="auto", choices=["auto", "sapi", "neural"])
    parser.add_argument("--voice", default="en-GB-RyanNeural")
    parser.add_argument("--rate", type=int, default=0)
    parser.add_argument("--model", default="tiny")
    parser.add_argument("--local-only", action="store_true", dest="local_only")
    args = parser.parse_args()

    if args.mode == "daemon":
        return run_daemon()

    if args.mode == "status":
        print(json.dumps(get_status()))
        return 0

    if args.mode == "tts":
        res = handle_tts(
            text=args.text,
            out_path=args.out,
            engine=args.engine,
            voice=args.voice,
            rate=args.rate,
            local_only=args.local_only,
        )
        print(json.dumps(res))
        return 0 if res.get("ok") else 1

    if args.mode == "stt":
        res = handle_stt(args.audio, args.model)
        print(json.dumps(res))
        return 0 if (res.get("ok") or "Audio file not found" not in str(res.get("error", ""))) else 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
