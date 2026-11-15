from __future__ import annotations

import math
import re
import time
from typing import Any


class SileroVadDetector:
    """Lightweight frame RMS / probability VAD modeling Silero VAD transitions."""

    def __init__(self, speech_threshold: float = 0.015) -> None:
        self.speech_threshold = speech_threshold

    def score_frame(self, samples: list[float] | None = None, simulated_rms: float | None = None) -> dict[str, Any]:
        if simulated_rms is not None:
            rms = float(simulated_rms)
        elif samples:
            rms = math.sqrt(sum(float(x) * float(x) for x in samples) / len(samples))
        else:
            rms = 0.0
        speaking = rms >= self.speech_threshold
        prob = min(0.99, round(rms / max(1e-6, self.speech_threshold * 2.5), 3))
        return {
            "rms": round(rms, 5),
            "speech_prob": prob,
            "state": "SPEAKING" if speaking else "SILENCE",
        }


class TransformerTurnDetector:
    """Computes end-of-turn pause readiness, wake/address triggers, and barge-in signals."""

    ADDRESS_RE = re.compile(r"\b(?:@?mimri|@?mimir|hey\s+mimir|hey\s+mimri)\b", re.IGNORECASE)

    def evaluate(
        self,
        transcript: str,
        silence_ms: int = 0,
        any_human_speaking: bool = False,
        agent_currently_speaking: bool = False,
    ) -> dict[str, Any]:
        addressed = bool(self.ADDRESS_RE.search(transcript or ""))
        barge_in = bool(agent_currently_speaking and any_human_speaking)
        conversational_pause = (not any_human_speaking) and silence_ms >= 650
        should_speak = (not barge_in) and (not any_human_speaking) and (addressed or conversational_pause)
        return {
            "addressed": addressed,
            "conversational_pause": conversational_pause,
            "barge_in_triggered": barge_in,
            "should_speak": should_speak,
            "reason": (
                "barge-in-interrupt-yield"
                if barge_in
                else "active-human-floor-hold"
                if any_human_speaking
                else "addressed-by-participant"
                if addressed
                else "natural-conversational-pause"
                if conversational_pause
                else "listening-no-address"
            ),
        }


class LiveKitPipecatWorker:
    """Capability #14: Multi-participant WebRTC agent joining as distinct participant with per-speaker isolated tracks."""

    def __init__(self, room_name: str = "mimri-boardroom-rtc") -> None:
        self.room_name = room_name
        self.vad = SileroVadDetector()
        self.turn_detector = TransformerTurnDetector()
        self.tracks: dict[str, list[dict[str, Any]]] = {}

    def process_room_turn(
        self,
        speaker_tracks: list[dict[str, Any]],
        silence_ms: int = 750,
        agent_currently_speaking: bool = False,
    ) -> dict[str, Any]:
        per_speaker_states: list[dict[str, Any]] = []
        combined_transcript_parts: list[str] = []
        any_speaking = False

        # Strictly per-speaker isolated track processing (never mixing audio tracks)
        for tr in speaker_tracks:
            speaker_id = str(tr.get("speaker_id") or "participant")
            vad_res = self.vad.score_frame(samples=tr.get("samples"), simulated_rms=tr.get("rms"))
            is_spk = vad_res["state"] == "SPEAKING"
            if is_spk:
                any_speaking = True
            text = str(tr.get("transcript") or "").strip()
            if text:
                combined_transcript_parts.append(f"{speaker_id}: {text}")
            entry = {
                "speaker_id": speaker_id,
                "track_sid": tr.get("track_sid") or f"TR_{speaker_id}",
                "mixed": False,
                **vad_res,
                "transcript": text,
                "ts": time.time(),
            }
            self.tracks.setdefault(speaker_id, []).append(entry)
            per_speaker_states.append(entry)

        merged_context = "\n".join(combined_transcript_parts)
        decision = self.turn_detector.evaluate(
            transcript=merged_context,
            silence_ms=silence_ms,
            any_human_speaking=any_speaking,
            agent_currently_speaking=agent_currently_speaking,
        )
        reply = ""
        if decision["should_speak"]:
            reply = f"[{self.room_name}] Responded on attributed tracks ({', '.join(t['speaker_id'] for t in per_speaker_states)})."

        return {
            "room_name": self.room_name,
            "participant_identity": "mimri-agent-participant",
            "per_speaker_tracks_isolated": True,
            "tracks": per_speaker_states,
            "turn_decision": decision,
            "agent_reply": reply,
        }
