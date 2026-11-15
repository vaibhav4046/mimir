import React, { useEffect, useRef, useState } from 'react';
import { apiFetch, encodeFilesForStaging, isFileDragEvent } from '../api.js';
import { MimirSagePortrait, WellOfWisdomOrb } from './MimirAsset.jsx';
import { AttachmentFileSvg, CloseCrossSvg, MimirCrestSvg, PlusPixelSvg, SendRunicSvg } from './Icons.jsx';

const SPEECH_RMS_THRESHOLD = 0.022;
const TRAILING_SILENCE_MS = 1250;
const MAX_IDLE_CAPTURE_MS = 30000;
const VAD_POLL_MS = 60;

const PHASE_META = {
  idle: { label: 'Ready', badge: 'Standby' },
  listening: { label: 'Listening, speak naturally', badge: 'Listening' },
  thinking: { label: 'Transcribing & thinking...', badge: 'Thinking' },
  speaking: { label: 'Speaking reply', badge: 'Speaking' },
};

function friendlyVoiceError(err, fallback = 'Voice request failed.') {
  const name = String(err?.name || '');
  const raw = String(err?.message || err || '').trim();
  const lower = `${name} ${raw}`.toLowerCase();
  if (lower.includes('notallowed') || lower.includes('permissiondenied') || lower.includes('permission denied')) {
    return 'Microphone access was blocked. Allow microphone permission in your browser or system settings, or type your message below.';
  }
  if (lower.includes('notfound') || lower.includes('devicesnotfound')) {
    return 'No microphone was detected on this device. Connect a mic or type your message below.';
  }
  if (lower.includes('not supported') || lower.includes('notsupported') || lower.includes('mediadevices')) {
    return 'Live microphone capture is unavailable in this window. Check browser permissions or type your message below.';
  }
  if (lower.includes('failed to fetch') || lower.includes('networkerror') || lower.includes('offline') || lower.includes('econnrefused')) {
    return 'Could not reach the local Mimir daemon. Confirm it is running and try again.';
  }
  return raw || fallback;
}

function createTurnId() {
  return `vt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      resolve(dataUrl.split(',')[1] || '');
    };
    reader.onerror = () => reject(new Error('Failed reading recorded audio'));
    reader.readAsDataURL(blob);
  });
}

function pickRecorderMimeType() {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return '';
  }
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg'];
  return candidates.find(type => MediaRecorder.isTypeSupported(type)) || '';
}

export function VoiceLiveModal({
  isOpen,
  onClose,
  activeBot,
  activeThreadId,
  onStageFiles,
  onThreadUpdated,
  onPhaseChange,
  settings,
}) {
  const dialogRef = useRef(null);
  const voiceFileInputRef = useRef(null);
  const voiceDragDepthRef = useRef(0);
  const isOpenRef = useRef(Boolean(isOpen));
  const activeCallRef = useRef(false);
  const pausedListeningRef = useRef(false);
  const discardCaptureRef = useRef(false);
  const forceSendRef = useRef(false);
  const speechDetectedRef = useRef(false);
  const listenSeqRef = useRef(0);
  const turnSeqRef = useRef(0);
  const turnAbortRef = useRef(null);
  const streamRef = useRef(null);
  const recorderRef = useRef(null);
  const audioCtxRef = useRef(null);
  const vadTimerRef = useRef(null);
  const playbackRef = useRef(null);
  const threadIdRef = useRef(activeThreadId || null);
  const transcriptEndRef = useRef(null);

  const [phase, setPhase] = useState('idle'); // idle | listening | thinking | speaking
  useEffect(() => {
    onPhaseChange?.(phase);
  }, [phase, onPhaseChange]);
  const [motionPaused, setMotionPaused] = useState(() => {
    if (typeof settings?.reducedMotion === 'boolean') return settings.reducedMotion;
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }
    return false;
  });
  const [listeningPaused, setListeningPaused] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [statusNote, setStatusNote] = useState('Open channel ready');
  const [errorMsg, setErrorMsg] = useState('');
  const [transcript, setTranscript] = useState([]);
  const [typedDraft, setTypedDraft] = useState('');
  const [stagedFiles, setStagedFiles] = useState([]);
  const [showTranscript, setShowTranscript] = useState(false);
  const [voiceDragActive, setVoiceDragActive] = useState(false);
  const [voiceDropBusy, setVoiceDropBusy] = useState(false);

  isOpenRef.current = Boolean(isOpen);

  useEffect(() => {
    if (activeThreadId) threadIdRef.current = activeThreadId;
  }, [activeThreadId]);

  useEffect(() => {
    if (typeof settings?.reducedMotion === 'boolean') {
      setMotionPaused(settings.reducedMotion);
    }
  }, [settings?.reducedMotion]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: motionPaused ? 'auto' : 'smooth' });
  }, [transcript.length, motionPaused]);

  const stopVadMonitor = () => {
    if (vadTimerRef.current) {
      clearInterval(vadTimerRef.current);
      vadTimerRef.current = null;
    }
    if (audioCtxRef.current) {
      try {
        audioCtxRef.current.close().catch(() => {});
      } catch {}
      audioCtxRef.current = null;
    }
    setMicLevel(0);
  };

  const stopActiveRecorder = ({ discard = true } = {}) => {
    discardCaptureRef.current = discard;
    stopVadMonitor();
    const mr = recorderRef.current;
    if (mr && mr.state !== 'inactive') {
      try {
        mr.stop();
      } catch {}
    }
    recorderRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => {
        try {
          track.stop();
        } catch {}
      });
      streamRef.current = null;
    }
  };

  const stopPlayback = () => {
    if (playbackRef.current) {
      try {
        playbackRef.current.onended = null;
        playbackRef.current.onerror = null;
        playbackRef.current.pause();
      } catch {}
      playbackRef.current = null;
    }
  };

  const stopAllMedia = () => {
    activeCallRef.current = false;
    listenSeqRef.current += 1;
    turnSeqRef.current += 1;
    if (turnAbortRef.current) {
      try {
        turnAbortRef.current.abort();
      } catch {}
      turnAbortRef.current = null;
    }
    stopActiveRecorder({ discard: true });
    stopPlayback();
    setPhase('idle');
  };

  const notifyParentClosed = () => {
    if (isOpenRef.current) {
      isOpenRef.current = false;
      onClose?.();
    }
  };

  const appendBubble = entry => {
    setTranscript(prev => [...prev.slice(-24), { id: createTurnId(), ts: Date.now(), ...entry }]);
  };

  const runDuplexTurn = async (text, turnAttachments = []) => {
    const cleanText = String(text || '').trim();
    const attached = Array.isArray(turnAttachments) && turnAttachments.length ? turnAttachments : stagedFiles;
    if ((!cleanText && attached.length === 0) || !isOpenRef.current) {
      if (activeCallRef.current && !pausedListeningRef.current) {
        startListeningTurn();
      } else {
        setPhase('idle');
      }
      return;
    }

    const turnPrompt = cleanText || `Inspect and summarize dropped file(s): ${attached.map(f => f.name).join(', ')}`;
    const mySeq = ++turnSeqRef.current;
    if (turnAbortRef.current) {
      try {
        turnAbortRef.current.abort();
      } catch {}
    }
    const controller = new AbortController();
    turnAbortRef.current = controller;

    setPhase('thinking');
    setErrorMsg('');
    setStatusNote(`Asking ${activeBot?.name || 'Mimir'}...`);
    appendBubble({ role: 'user', text: turnPrompt, attachments: attached });
    if (attached.length) setStagedFiles([]);

    try {
      const voiceEngine = settings?.localOnly ? 'sapi' : (settings?.voiceEngine || 'auto');
      const voiceName = settings?.voiceName || (settings?.localOnly ? 'david-sapi' : 'en-GB-RyanNeural');
      const res = await apiFetch('/v1/voice/duplex', {
        method: 'POST',
        signal: controller.signal,
        body: JSON.stringify({
          botId: activeBot?.id,
          threadId: threadIdRef.current || undefined,
          text: turnPrompt,
          attachments: attached,
          engine: voiceEngine,
          voice: voiceName,
        }),
      });

      if (mySeq !== turnSeqRef.current || !isOpenRef.current) return;

      if (res?.threadId) {
        threadIdRef.current = res.threadId;
        onThreadUpdated?.(res.threadId, res);
      }

      const replyText = String(res?.reply || '').trim() || '(No response)';
      appendBubble({
        role: 'assistant',
        text: replyText,
        engine: res?.engine || '',
      });

      if (res?.audioBase64) {
        setPhase('speaking');
        setStatusNote(res.engine ? `Speaking (${res.engine})` : 'Speaking reply...');
        const audio = new Audio(`data:${res.mime || 'audio/wav'};base64,${res.audioBase64}`);
        playbackRef.current = audio;

        const resumeAfterSpeech = () => {
          if (playbackRef.current === audio) playbackRef.current = null;
          if (mySeq !== turnSeqRef.current || !isOpenRef.current) return;
          if (activeCallRef.current && !pausedListeningRef.current) {
            startListeningTurn();
          } else {
            setPhase('idle');
            setStatusNote(pausedListeningRef.current ? 'Mic paused' : 'Ready');
          }
        };

        audio.onended = resumeAfterSpeech;
        audio.onerror = resumeAfterSpeech;
        try {
          await audio.play();
        } catch {
          resumeAfterSpeech();
        }
      } else if (activeCallRef.current && !pausedListeningRef.current) {
        startListeningTurn();
      } else {
        setPhase('idle');
        setStatusNote('Ready');
      }
    } catch (err) {
      if (err?.name === 'AbortError' || mySeq !== turnSeqRef.current || !isOpenRef.current) return;
      setErrorMsg(friendlyVoiceError(err, 'Voice turn failed.'));
      setPhase('idle');
      setStatusNote('Error: tap Resume Mic or retry');
    }
  };

  const transcribeAndRespond = async (chunks, mimeType) => {
    const mySeq = ++turnSeqRef.current;
    const controller = new AbortController();
    turnAbortRef.current = controller;

    setPhase('thinking');
    setStatusNote('Transcribing speech...');

    try {
      const blob = new Blob(chunks, { type: mimeType || 'audio/webm' });
      if (blob.size < 128) {
        if (activeCallRef.current && !pausedListeningRef.current && isOpenRef.current) {
          startListeningTurn();
        } else {
          setPhase('idle');
        }
        return;
      }

      const audioBase64 = await blobToBase64(blob);
      if (mySeq !== turnSeqRef.current || !isOpenRef.current) return;

      const lowerMime = String(mimeType || '').toLowerCase();
      const ext = lowerMime.includes('ogg') ? 'ogg' : lowerMime.includes('wav') ? 'wav' : 'webm';
      const sttRes = await apiFetch('/v1/voice/stt', {
        method: 'POST',
        signal: controller.signal,
        body: JSON.stringify({
          audioBase64,
          ext,
          model: settings?.whisperModel || 'tiny',
        }),
      });

      if (mySeq !== turnSeqRef.current || !isOpenRef.current) return;

      const spoken = String(sttRes?.text || '').trim();
      if (!spoken) {
        if (sttRes?.error) {
          setErrorMsg(friendlyVoiceError(sttRes.error, 'Speech transcription is unavailable right now.'));
          setPhase('idle');
          setStatusNote('STT unavailable');
          return;
        }
        setStatusNote('No speech detected, listening...');
        if (activeCallRef.current && !pausedListeningRef.current) {
          startListeningTurn();
        } else {
          setPhase('idle');
        }
        return;
      }

      await runDuplexTurn(spoken);
    } catch (err) {
      if (err?.name === 'AbortError' || mySeq !== turnSeqRef.current || !isOpenRef.current) return;
      setErrorMsg(friendlyVoiceError(err, 'Speech transcription failed.'));
      setPhase('idle');
      setStatusNote('Transcription error');
    }
  };

  const startListeningTurn = async () => {
    if (!isOpenRef.current || !activeCallRef.current || pausedListeningRef.current) {
      setPhase('idle');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setErrorMsg('Microphone capture is not supported in this browser. Type a message below.');
      setPhase('idle');
      setStatusNote('Mic unavailable');
      return;
    }

    const myListenSeq = ++listenSeqRef.current;
    stopActiveRecorder({ discard: true });
    stopPlayback();
    setErrorMsg('');
    setPhase('listening');
    setStatusNote('Listening (auto-sends after 1.25s silence)');

    try {
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
      if (myListenSeq !== listenSeqRef.current || !isOpenRef.current || !activeCallRef.current || pausedListeningRef.current) {
        stream.getTracks().forEach(t => t.stop());
        if (myListenSeq === listenSeqRef.current) setPhase('idle');
        return;
      }

      streamRef.current = stream;
      discardCaptureRef.current = false;
      forceSendRef.current = false;
      speechDetectedRef.current = false;

      const mimeType = pickRecorderMimeType();
      const mr = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recorderRef.current = mr;
      const chunks = [];
      let recycleSilent = false;

      mr.ondataavailable = evt => {
        if (evt.data?.size) chunks.push(evt.data);
      };

      mr.onerror = () => {
        stopActiveRecorder({ discard: true });
        setPhase('idle');
        setErrorMsg('Microphone recorder encountered an error.');
      };

      mr.onstop = () => {
        stopVadMonitor();
        stream.getTracks().forEach(t => {
          try {
            t.stop();
          } catch {}
        });
        if (streamRef.current === stream) streamRef.current = null;
        if (recorderRef.current === mr) recorderRef.current = null;

        if (!isOpenRef.current || discardCaptureRef.current) return;

        if (recycleSilent) {
          if (activeCallRef.current && !pausedListeningRef.current) {
            startListeningTurn();
          } else {
            setPhase('idle');
          }
          return;
        }

        if (!speechDetectedRef.current && !forceSendRef.current) {
          if (activeCallRef.current && !pausedListeningRef.current) {
            startListeningTurn();
          } else {
            setPhase('idle');
          }
          return;
        }

        transcribeAndRespond(chunks, mr.mimeType || mimeType || 'audio/webm');
      };

      mr.start(250);

      // Web Audio AnalyserNode RMS Silence VAD
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) {
        try {
          const ctx = new Ctx();
          audioCtxRef.current = ctx;
          ctx.resume?.().catch(() => {});
          const source = ctx.createMediaStreamSource(stream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 1024;
          source.connect(analyser);

          const floatBuf = new Float32Array(analyser.fftSize);
          const byteBuf = new Uint8Array(analyser.fftSize);
          const startedAt = performance.now();
          let lastSpeechAt = 0;

          vadTimerRef.current = setInterval(() => {
            if (!recorderRef.current || recorderRef.current !== mr || mr.state !== 'recording') {
              stopVadMonitor();
              return;
            }
            let sum = 0;
            if (typeof analyser.getFloatTimeDomainData === 'function') {
              analyser.getFloatTimeDomainData(floatBuf);
              for (let i = 0; i < floatBuf.length; i += 1) {
                sum += floatBuf[i] * floatBuf[i];
              }
            } else {
              analyser.getByteTimeDomainData(byteBuf);
              for (let i = 0; i < byteBuf.length; i += 1) {
                const v = (byteBuf[i] - 128) / 128;
                sum += v * v;
              }
            }
            const rms = Math.sqrt(sum / analyser.fftSize);
            setMicLevel(Math.min(1, rms * 8));

            const now = performance.now();
            if (rms >= SPEECH_RMS_THRESHOLD) {
              if (!speechDetectedRef.current) {
                setStatusNote('Speech detected...');
              }
              speechDetectedRef.current = true;
              lastSpeechAt = now;
            } else if (speechDetectedRef.current && now - lastSpeechAt >= TRAILING_SILENCE_MS) {
              stopVadMonitor();
              if (mr.state === 'recording') mr.stop();
            } else if (!speechDetectedRef.current && now - startedAt >= MAX_IDLE_CAPTURE_MS) {
              recycleSilent = true;
              stopVadMonitor();
              if (mr.state === 'recording') mr.stop();
            }
          }, VAD_POLL_MS);
        } catch {
          setStatusNote('Listening, tap Send Turn when done');
        }
      } else {
        setStatusNote('Listening, tap Send Turn when done');
      }
    } catch (err) {
      stopActiveRecorder({ discard: true });
      setPhase('idle');
      setErrorMsg(friendlyVoiceError(err, 'Microphone access denied.'));
      setStatusNote('Mic blocked: type below or grant access');
    }
  };

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return undefined;

    if (isOpen) {
      if (!dlg.open) {
        dlg.returnValue = '';
        dlg.showModal();
      }
      activeCallRef.current = true;
      pausedListeningRef.current = false;
      setListeningPaused(false);
      setErrorMsg('');
      startListeningTurn();
    } else {
      stopAllMedia();
      if (dlg.open) {
        dlg.returnValue = '';
        dlg.close();
      }
    }

    return () => {
      stopAllMedia();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- lifecycle synced cleanly to isOpen
  }, [isOpen]);

  const handleEndCall = () => {
    stopAllMedia();
    const dlg = dialogRef.current;
    if (dlg) {
      dlg.returnValue = '';
      if (dlg.open) dlg.close();
    }
    notifyParentClosed();
  };

  const handleSendNow = () => {
    const mr = recorderRef.current;
    if (!mr || mr.state !== 'recording') return;
    forceSendRef.current = true;
    discardCaptureRef.current = false;
    stopVadMonitor();
    mr.stop();
  };

  const handleBargeIn = () => {
    turnSeqRef.current += 1;
    if (turnAbortRef.current) {
      try {
        turnAbortRef.current.abort();
      } catch {}
      turnAbortRef.current = null;
    }
    stopPlayback();
    pausedListeningRef.current = false;
    setListeningPaused(false);
    activeCallRef.current = true;
    startListeningTurn();
  };

  const handleToggleListening = () => {
    if (listeningPaused || phase === 'idle') {
      pausedListeningRef.current = false;
      setListeningPaused(false);
      activeCallRef.current = true;
      startListeningTurn();
    } else {
      pausedListeningRef.current = true;
      setListeningPaused(true);
      stopActiveRecorder({ discard: true });
      setPhase('idle');
      setStatusNote('Mic paused');
    }
  };

  const stageVoiceFilesAndAutoTurn = async fileList => {
    const rawFiles = Array.from(fileList || []).filter(Boolean);
    if (!rawFiles.length || !isOpenRef.current) return;
    setVoiceDropBusy(true);
    setErrorMsg('');
    try {
      const { encoded, skipped } = await encodeFilesForStaging(rawFiles);
      if (skipped.length) setErrorMsg(`Skipped: ${skipped.join(', ')}`);
      if (!encoded.length) return;

      let staged = [];
      if (typeof onStageFiles === 'function') {
        staged = await onStageFiles(encoded);
      } else {
        const botId = activeBot?.id || 'bot-grok-default';
        for (const f of encoded) {
          staged.push(
            await apiFetch(`/v1/computer/${encodeURIComponent(botId)}/stage-file`, {
              method: 'POST',
              body: JSON.stringify(f),
            })
          );
        }
      }
      if (!isOpenRef.current) return;
      const merged = [...stagedFiles, ...staged];
      setStagedFiles(merged);
      stopActiveRecorder({ discard: true });
      stopPlayback();
      const draftNote = typedDraft.trim();
      setTypedDraft('');
      await runDuplexTurn(draftNote, merged);
    } catch (err) {
      if (isOpenRef.current) setErrorMsg(friendlyVoiceError(err, 'Failed staging file in Live Voice.'));
    } finally {
      if (isOpenRef.current) setVoiceDropBusy(false);
    }
  };

  const handleVoiceDragEnter = e => {
    if (!isFileDragEvent(e)) return;
    e.preventDefault();
    e.stopPropagation();
    voiceDragDepthRef.current += 1;
    setVoiceDragActive(true);
  };

  const handleVoiceDragOver = e => {
    if (!isFileDragEvent(e)) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  };

  const handleVoiceDragLeave = e => {
    if (!isFileDragEvent(e)) return;
    e.preventDefault();
    e.stopPropagation();
    voiceDragDepthRef.current = Math.max(0, voiceDragDepthRef.current - 1);
    if (voiceDragDepthRef.current === 0) setVoiceDragActive(false);
  };

  const handleVoiceDrop = async e => {
    if (!isFileDragEvent(e)) return;
    e.preventDefault();
    e.stopPropagation();
    voiceDragDepthRef.current = 0;
    setVoiceDragActive(false);
    await stageVoiceFilesAndAutoTurn(e.dataTransfer?.files);
  };

  const handleOrbTap = () => {
    if (phase === 'speaking' || phase === 'thinking') {
      handleBargeIn();
    } else {
      handleToggleListening();
    }
  };

  const handleTypedSubmit = async e => {
    e.preventDefault();
    const text = typedDraft.trim();
    if (!text && stagedFiles.length === 0) return;
    setTypedDraft('');
    stopActiveRecorder({ discard: true });
    stopPlayback();
    await runDuplexTurn(text, stagedFiles);
  };

  const phaseMeta = PHASE_META[phase] || PHASE_META.idle;
  const voiceModeLabel = settings?.localOnly ? 'Offline Windows voice' : 'Natural voice (offline backup)';
  const latestBubble = transcript.length ? transcript[transcript.length - 1] : null;
  const orbReactiveScale = phase === 'listening' ? 1 + Math.min(0.14, micLevel * 0.14) : phase === 'speaking' ? 1.05 : 1;

  return (
    <dialog
      ref={dialogRef}
      className={`mimir-dialog voice-live-dialog voice-live-chatgpt ${voiceDragActive ? 'is-drag-active' : ''}`}
      aria-labelledby="voice-live-title"
      data-testid="voice-live-dialog"
      onDragEnter={handleVoiceDragEnter}
      onDragOver={handleVoiceDragOver}
      onDragLeave={handleVoiceDragLeave}
      onDrop={handleVoiceDrop}
      onCancel={e => {
        e.preventDefault();
        handleEndCall();
      }}
      onClose={() => {
        if (dialogRef.current) dialogRef.current.returnValue = '';
        voiceDragDepthRef.current = 0;
        setVoiceDragActive(false);
        stopAllMedia();
        notifyParentClosed();
      }}
    >
      {(voiceDragActive || voiceDropBusy) && (
        <div className="drop-overlay" data-testid="voice-drop-overlay" aria-live="polite">
          <div className="drop-overlay-card">
            <AttachmentFileSvg size={28} />
            <strong>{voiceDropBusy ? 'Uploading file to Mimir...' : 'Drop file into Live Call'}</strong>
            <span>Mimir will inspect it right away and answer aloud</span>
          </div>
        </div>
      )}

      <div className="mimir-dialog-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <strong id="voice-live-title">Mimir Live</strong>
          <span className="status-pill" data-testid="voice-live-status">
            <span className={`status-dot ${phase === 'idle' ? 'warn' : ''}`} />
            {phaseMeta.badge}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-sm"
            data-testid="voice-transcript-toggle"
            aria-expanded={showTranscript}
            onClick={() => setShowTranscript(v => !v)}
          >
            {showTranscript ? 'Hide Captions' : `Captions (${transcript.length})`}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            data-testid="voice-pause-motion-btn"
            aria-pressed={motionPaused}
            onClick={() => setMotionPaused(v => !v)}
          >
            {motionPaused ? 'Resume Motion' : 'Pause Motion'}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            aria-label="Close live voice dialog"
            onClick={handleEndCall}
          >
            <CloseCrossSvg size={13} />
          </button>
        </div>
      </div>

      <div className="mimir-dialog-body voice-live-body voice-live-chatgpt-body">
        <div
          className={`voice-live-stage voice-live-hero-stage ${motionPaused ? 'is-motion-paused' : ''}`}
          data-state={phase}
          data-motion-paused={motionPaused ? 'true' : 'false'}
        >
          <button
            type="button"
            className="voice-live-orb-btn"
            data-testid="voice-orb-btn"
            aria-label={
              phase === 'speaking' || phase === 'thinking'
                ? 'Tap orb to interrupt Mimir and speak'
                : 'Tap orb to toggle microphone'
            }
            onClick={handleOrbTap}
          >
            <span
              className="voice-live-orb-wrap"
              style={{
                transform: motionPaused ? 'none' : `scale(${orbReactiveScale.toFixed(3)})`,
                transition: motionPaused ? 'none' : 'transform 90ms ease-out',
              }}
            >
              {WellOfWisdomOrb ? (
                <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                  <WellOfWisdomOrb state={phase} paused={motionPaused} size={184} />
                  <span style={{ position: 'absolute', pointerEvents: 'none' }}>
                    <MimirSagePortrait
                      size={88}
                      state={phase}
                      audioLevel={phase === 'speaking' ? Math.max(0.25, micLevel) : 0}
                      staticAvatar={motionPaused}
                      showStateBadge
                    />
                  </span>
                </span>
              ) : (
                <MimirCrestSvg size={132} animated={!motionPaused} />
              )}
            </span>
          </button>

          <div className="voice-live-caption-box" data-testid="voice-live-caption" aria-live="polite">
            <div className="voice-live-state-label">{phaseMeta.label}</div>
            <div className="voice-live-subnote">
              {statusNote} · {voiceModeLabel}
            </div>
            {latestBubble ? (
              <p className="voice-live-latest-line">
                <strong>{latestBubble.role === 'user' ? 'You:' : `${activeBot?.name || 'Mimir'}:`}</strong>{' '}
                {latestBubble.text}
              </p>
            ) : (
              <p className="voice-live-latest-line is-hint">
                Speak naturally or drop any file into this window. Mimir auto-inspects and speaks back.
              </p>
            )}
          </div>

          {stagedFiles.length > 0 && (
            <div className="chip-list" style={{ justifyContent: 'center' }}>
              {stagedFiles.map((f, i) => (
                <span key={`${f.name}-${i}`} className="chip">
                  <AttachmentFileSvg size={12} />
                  <span>{f.name}</span>
                </span>
              ))}
            </div>
          )}
        </div>

        {errorMsg && (
          <div role="alert" className="voice-live-error">
            {errorMsg}
          </div>
        )}

        {showTranscript && (
          <div className="voice-live-transcript" aria-live="polite">
            {transcript.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--ink-muted)', textAlign: 'center', padding: '14px 8px' }}>
                Conversation log appears here as turns complete.
              </div>
            ) : (
              transcript.map(item => (
                <div
                  key={item.id}
                  className={`voice-live-bubble ${item.role === 'user' ? 'is-user' : 'is-assistant'}`}
                >
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--ink-muted)', marginBottom: 2 }}>
                    {item.role === 'user' ? 'You' : activeBot?.name || 'Mimir'}
                  </div>
                  <div>{item.text}</div>
                </div>
              ))
            )}
            <div ref={transcriptEndRef} />
          </div>
        )}

        <div className="voice-live-dock" role="toolbar" aria-label="Live voice call controls">
          <input
            ref={voiceFileInputRef}
            type="file"
            multiple
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={async evt => {
              const files = evt.target.files;
              await stageVoiceFilesAndAutoTurn(files);
              evt.target.value = '';
            }}
          />
          <button
            type="button"
            className="voice-dock-btn"
            data-testid="voice-attach-btn"
            aria-label="Drop or attach file to inspect aloud"
            title="Drop or attach file (auto-runs aloud)"
            disabled={voiceDropBusy}
            onClick={() => voiceFileInputRef.current?.click()}
          >
            <PlusPixelSvg size={16} />
            <span>Drop File</span>
          </button>

          {phase === 'listening' && (
            <button
              type="button"
              className="voice-dock-btn is-primary"
              data-testid="voice-send-now-btn"
              onClick={handleSendNow}
            >
              <SendRunicSvg size={15} />
              <span>Send Turn</span>
            </button>
          )}

          <button
            type="button"
            className={`voice-dock-btn ${!listeningPaused && phase !== 'idle' ? 'is-active' : ''}`}
            data-testid="voice-mic-toggle-btn"
            onClick={handleToggleListening}
          >
            <span>{listeningPaused || phase === 'idle' ? 'Resume Mic' : 'Pause Mic'}</span>
          </button>

          <button
            type="button"
            className="voice-dock-btn is-warn"
            data-testid="voice-barge-in-btn"
            disabled={phase !== 'speaking' && phase !== 'thinking'}
            onClick={handleBargeIn}
          >
            <span>Interrupt</span>
          </button>

          <button
            type="button"
            className="voice-dock-btn is-end"
            data-testid="voice-end-call-btn"
            onClick={handleEndCall}
          >
            <CloseCrossSvg size={15} />
            <span>End Call</span>
          </button>
        </div>

        <form onSubmit={handleTypedSubmit} className="voice-live-quick-form">
          <input
            type="text"
            className="input"
            aria-label="Send a typed voice turn"
            placeholder="Whisper a quick message or drop files anywhere..."
            value={typedDraft}
            onChange={e => setTypedDraft(e.target.value)}
            style={{ flex: '1 1 180px', minWidth: 0 }}
          />
          <button
            type="submit"
            className="btn btn-sm"
            disabled={(!typedDraft.trim() && stagedFiles.length === 0) || phase === 'thinking'}
          >
            Send Text
          </button>
        </form>
      </div>
    </dialog>
  );
}
