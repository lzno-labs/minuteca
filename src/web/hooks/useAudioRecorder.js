import { useCallback, useEffect, useRef, useState } from "react";
import { db, SESSION_STATUS, requestPersistentStorage } from "../lib/db";
import { t } from "../i18n";

const TIMESLICE_MS = 5000;
const BITRATE = 32_000; // ~14 MB per hour with Opus

const MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/ogg;codecs=opus"];

// Capture only system audio (no microphone)
async function createSystemAudioOnlyStream() {
  let systemStream = null;
  try {
    systemStream = await navigator.mediaDevices.getDisplayMedia({
      audio: { echoCancellation: false },
      video: false,
    });
  } catch (err) {
    if (err?.name === "NotAllowedError") {
      throw new Error("Audio permission denied. When selecting your screen, make sure to enable 'Share audio'.");
    }
    if (err?.message?.includes("Not supported")) {
      throw new Error("System audio not available. Check that 'Share audio' is enabled in the system dialog.");
    }
    throw err;
  }

  return {
    stream: systemStream,
    micStream: null,
    systemStream,
    audioCtx: null,
  };
}

// Mix microphone and system audio into a single stream
async function createMixedAudioStream(micStream, recordSystemAudio) {
  if (!recordSystemAudio) {
    return { stream: micStream, micStream, systemStream: null, audioCtx: null };
  }

  let systemStream = null;
  try {
    systemStream = await navigator.mediaDevices.getDisplayMedia({
      audio: { echoCancellation: false },
      video: false,
    });
  } catch (err) {
    // User cancelled screen capture or browser doesn't support it
    if (err?.name === "NotAllowedError") {
      throw new Error("Audio permission denied. When selecting your screen, make sure to enable 'Share audio'.");
    }
    if (err?.message?.includes("Not supported")) {
      throw new Error("System audio not available. Check that 'Share audio' is enabled in the system dialog.");
    }
    throw err;
  }

  try {
    // Create audio context to mix streams
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const micSource = audioCtx.createMediaStreamSource(micStream);
    const systemSource = audioCtx.createMediaStreamSource(systemStream);
    const destination = audioCtx.createMediaStreamAudioDestination();

    // Balance: system audio (70%) + microphone (30%) to avoid clipping
    const systemGain = audioCtx.createGain();
    const micGain = audioCtx.createGain();
    systemGain.gain.value = 0.7;
    micGain.gain.value = 0.3;

    micSource.connect(micGain);
    systemSource.connect(systemGain);
    micGain.connect(destination);
    systemGain.connect(destination);

    // Keep references to stop tracks later
    return {
      stream: destination.stream,
      micStream,
      systemStream,
      audioCtx,
    };
  } catch (err) {
    // Clean up system stream if mixing fails
    systemStream.getTracks().forEach((t) => t.stop());
    throw err;
  }
}

export function pickMimeType() {
  if (typeof MediaRecorder === "undefined") return null;
  return MIME_CANDIDATES.find((t) => MediaRecorder.isTypeSupported?.(t)) ?? "";
}

export function isRecordingSupported() {
  return Boolean(navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined");
}

export function isSystemAudioSupported() {
  // Check if getDisplayMedia is available and supports system audio
  // Note: Safari (including macOS) doesn't support getDisplayMedia()
  const isSafari = /Safari/.test(navigator.userAgent) && !/Chrome|Edge|Firefox/.test(navigator.userAgent);
  return Boolean(
    navigator.mediaDevices?.getDisplayMedia &&
      navigator.mediaDevices.enumerateDevices &&
      typeof AudioContext !== "undefined" &&
      !isSafari &&
      // iOS Safari also doesn't support it
      !/iPad|iPhone|iPod/.test(navigator.userAgent)
  );
}

/**
 * Crash-resilient microphone recorder.
 *
 * Every 5 s MediaRecorder emits a slice that is appended to IndexedDB
 * (`chunks`, keyed by session + sequence). A `sessions` row tracks status and
 * elapsed time. If the tab crashes or reloads, the slices remain and
 * `findUnfinalizedSessions()` can rebuild the audio. Slices are also kept in
 * memory so a failing disk write (quota) never loses the current recording.
 *
 * status: "idle" | "requesting" | "recording" | "paused" | "stopping"
 */
export function useAudioRecorder() {
  const [status, setStatus] = useState("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState(null);
  const [warning, setWarning] = useState(null);
  const [analyser, setAnalyser] = useState(null);
  const [bytes, setBytes] = useState(0);
  const [sessionId, setSessionId] = useState(null);
  const r = useRef(null);

  const currentElapsed = () => {
    const s = r.current;
    if (!s) return 0;
    return s.accumulatedMs + (s.segmentStart ? Date.now() - s.segmentStart : 0);
  };

  // Timer tick. Elapsed is derived from wall-clock deltas, so background-tab
  // timer throttling does not make it drift.
  useEffect(() => {
    if (status !== "recording") return undefined;
    const id = setInterval(() => setElapsedMs(currentElapsed()), 250);
    return () => clearInterval(id);
  }, [status]);

  // Warn before closing the tab mid-recording (the audio is still safe on disk).
  useEffect(() => {
    if (status !== "recording" && status !== "paused") return undefined;
    const onBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [status]);

  // Keep the screen awake while recording; re-acquire after tab switches.
  useEffect(() => {
    if (status !== "recording") return undefined;
    let lock = null;
    let cancelled = false;
    const acquire = async () => {
      try {
        if (document.visibilityState === "visible" && navigator.wakeLock) {
          lock = await navigator.wakeLock.request("screen");
          if (cancelled) lock.release();
        }
      } catch {
        // Unsupported or denied (e.g. low battery); recording continues.
      }
    };
    acquire();
    document.addEventListener("visibilitychange", acquire);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", acquire);
      lock?.release().catch(() => {});
    };
  }, [status]);

  const teardown = useCallback(() => {
    const s = r.current;
    if (!s) return;
    s.stream?.getTracks().forEach((t) => t.stop());
    s.micStream?.getTracks().forEach((t) => t.stop());
    s.systemStream?.getTracks().forEach((t) => t.stop());
    s.audioCtx?.close().catch(() => {});
    s.mixingCtx?.close().catch(() => {});
    setAnalyser(null);
  }, []);

  // Release the microphone if the component unmounts. The staged session is
  // intentionally kept so it can be recovered.
  useEffect(() => teardown, [teardown]);

  const persistChunk = (sessionId, seq, blob) => {
    const s = r.current;
    s.writes = s.writes
      .then(() =>
        db.transaction("rw", db.chunks, db.sessions, async () => {
          await db.chunks.add({ sessionId, seq, blob });
          await db.sessions.update(sessionId, {
            updatedAt: new Date().toISOString(),
            elapsedMs: currentElapsed(),
            chunkCount: seq + 1,
          });
        }),
      )
      .catch((err) => {
        console.error("Failed to persist audio chunk", err);
        setWarning(t("recorder.errors.diskWarning"));
      });
  };

  const start = useCallback(async (audioSource = "microphoneOnly") => {
    if (r.current?.recorder && r.current.recorder.state !== "inactive") return;
    setError(null);
    setWarning(null);

    if (!isRecordingSupported()) {
      setError(t("recorder.errors.unsupported"));
      return;
    }

    // Validate audio source selection
    const needsMic = audioSource !== "systemAudioOnly";
    const needsSystemAudio = audioSource !== "microphoneOnly";

    if (needsSystemAudio && !isSystemAudioSupported()) {
      setError(t("recorder.errors.systemAudioNotSupported"));
      return;
    }

    setStatus("requesting");
    let micStream = null;
    let streamData;

    // Get microphone if needed
    if (needsMic) {
      try {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            // Tuned for a room mic: keep voices across the table audible.
            echoCancellation: false,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
      } catch (err) {
        setStatus("idle");
        setError(
          err?.name === "NotAllowedError"
            ? t("recorder.errors.micDenied")
            : err?.name === "NotFoundError"
              ? t("recorder.errors.micNotFound")
              : t("recorder.errors.micFailed", { message: err?.message || err }),
        );
        return;
      }
    }

    // Handle stream based on audio source selection
    try {
      if (audioSource === "microphoneOnly") {
        streamData = { stream: micStream, micStream, systemStream: null, audioCtx: null };
      } else if (audioSource === "systemAudioOnly") {
        streamData = await createSystemAudioOnlyStream();
      } else {
        // bothAudioSources
        streamData = await createMixedAudioStream(micStream, true);
      }
    } catch (err) {
      setStatus("idle");
      micStream?.getTracks().forEach((t) => t.stop());
      const msgKey = audioSource === "systemAudioOnly" ? "recorder.errors.systemAudioFailed" : "recorder.errors.systemAudioFailed";
      setError(t(msgKey, { message: err?.message || err }));
      return;
    }

    const stream = streamData.stream;

    const mimeType = pickMimeType();
    let recorder;
    try {
      recorder = new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
        audioBitsPerSecond: BITRATE,
      });
    } catch {
      recorder = new MediaRecorder(stream);
    }
    const effectiveMime = recorder.mimeType || mimeType || "audio/webm";

    const sessionId = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    await db.sessions.put({
      id: sessionId,
      startedAt,
      updatedAt: startedAt,
      mimeType: effectiveMime,
      status: SESSION_STATUS.RECORDING,
      elapsedMs: 0,
      chunkCount: 0,
    });
    requestPersistentStorage();

    // Level meter: mic → analyser (not connected to speakers).
    let audioCtx = null;
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const node = audioCtx.createAnalyser();
      node.fftSize = 1024;
      node.smoothingTimeConstant = 0.6;
      audioCtx.createMediaStreamSource(stream).connect(node);
      setAnalyser(node);
    } catch {
      // Meter is cosmetic; recording works without it.
    }

    r.current = {
      recorder,
      stream,
      micStream: streamData.micStream,
      systemStream: streamData.systemStream,
      audioCtx,
      mixingCtx: streamData.audioCtx,
      sessionId,
      startedAt,
      mimeType: effectiveMime,
      seq: 0,
      memoryChunks: [],
      writes: Promise.resolve(),
      accumulatedMs: 0,
      segmentStart: Date.now(),
      stopped: null,
    };

    recorder.ondataavailable = (e) => {
      if (!e.data || e.data.size === 0) return;
      const s = r.current;
      s.memoryChunks.push(e.data);
      setBytes((b) => b + e.data.size);
      persistChunk(s.sessionId, s.seq++, e.data);
    };
    r.current.stopped = new Promise((resolve) => {
      recorder.onstop = resolve;
    });
    recorder.onerror = (e) => {
      setError(t("recorder.errors.recorderError", { message: e.error?.message || t("recorder.errors.unknown") }));
      stopRef.current?.();
    };
    // Mic unplugged / permission revoked mid-meeting.
    stream.getAudioTracks()[0]?.addEventListener("ended", () => {
      setWarning(t("recorder.errors.micDisconnected"));
      stopRef.current?.();
    });

    recorder.start(TIMESLICE_MS);
    setSessionId(sessionId);
    setBytes(0);
    setElapsedMs(0);
    setStatus("recording");
  }, []);

  const pause = useCallback(() => {
    const s = r.current;
    if (!s || s.recorder.state !== "recording") return;
    s.recorder.pause();
    s.recorder.requestData(); // flush the partial slice to disk now
    s.accumulatedMs += Date.now() - s.segmentStart;
    s.segmentStart = null;
    setElapsedMs(s.accumulatedMs);
    db.sessions.update(s.sessionId, { status: SESSION_STATUS.PAUSED, elapsedMs: s.accumulatedMs });
    setStatus("paused");
  }, []);

  const resume = useCallback(() => {
    const s = r.current;
    if (!s || s.recorder.state !== "paused") return;
    s.recorder.resume();
    s.segmentStart = Date.now();
    db.sessions.update(s.sessionId, { status: SESSION_STATUS.RECORDING });
    setStatus("recording");
  }, []);

  /**
   * Stops recording and resolves with the finished audio. The staged session
   * stays in IndexedDB (status "stopped") until the caller deletes it after a
   * successful transcription.
   * @returns {Promise<{ sessionId, blob, mimeType, durationSec, startedAt } | null>}
   */
  const stop = useCallback(async () => {
    const s = r.current;
    if (!s || s.recorder.state === "inactive") return null;
    if (s.stopping) return s.stopping;

    s.stopping = (async () => {
      setStatus("stopping");
      if (s.segmentStart) {
        s.accumulatedMs += Date.now() - s.segmentStart;
        s.segmentStart = null;
      }
      s.recorder.stop(); // emits the final dataavailable, then stop
      await s.stopped;
      await s.writes;
      await db.sessions
        .update(s.sessionId, {
          status: SESSION_STATUS.STOPPED,
          elapsedMs: s.accumulatedMs,
          updatedAt: new Date().toISOString(),
        })
        .catch(() => {});
      teardown();
      setElapsedMs(s.accumulatedMs);
      setStatus("idle");
      return {
        sessionId: s.sessionId,
        blob: new Blob(s.memoryChunks, { type: s.mimeType }),
        mimeType: s.mimeType,
        durationSec: Math.round(s.accumulatedMs / 1000),
        startedAt: s.startedAt,
      };
    })();
    return s.stopping;
  }, [teardown]);

  // Lets event handlers registered in start() reach the latest stop().
  const stopRef = useRef(stop);
  stopRef.current = stop;

  return {
    status,
    isActive: status !== "idle",
    sessionId,
    elapsedMs,
    bytes,
    analyser,
    error,
    warning,
    clearError: () => setError(null),
    start,
    pause,
    resume,
    stop,
    supportsSystemAudio: isSystemAudioSupported(),
  };
}
