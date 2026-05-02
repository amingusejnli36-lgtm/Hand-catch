/**
 * Web Audio ambience and UI cues (no external files).
 */

export function createAudioEngine() {
  let AudioContextCtor = typeof window !== "undefined" ? window.AudioContext || window.webkitAudioContext : null;

  /** @type {AudioContext | null} */
  let ctx = null;

  /** @type {OscillatorNode | null} */
  let ambienceOscLow = null;
  /** @type {OscillatorNode | null} */
  let ambienceOscHigh = null;
  /** @type {GainNode | null} */
  let ambienceGain = null;

  function ensureContext() {
    if (!AudioContextCtor) {
      return null;
    }
    ctx = ctx || new AudioContextCtor();
    return ctx;
  }

  async function unlock() {
    try {
      const c = ensureContext();
      if (!c) return false;
      if (c.state === "suspended" && typeof c.resume === "function") {
        await c.resume();
      }
      return c.state === "running";
    } catch {
      return false;
    }
  }

  function stopAmbient() {
    try {
      if (ambienceOscLow) {
        ambienceOscLow.stop();
        ambienceOscLow.disconnect();
      }
      if (ambienceOscHigh) {
        ambienceOscHigh.stop();
        ambienceOscHigh.disconnect();
      }
      if (ambienceGain) ambienceGain.disconnect();
    } catch {
      // ignore teardown race
    } finally {
      ambienceOscLow = null;
      ambienceOscHigh = null;
      ambienceGain = null;
    }
  }

  async function startAmbient() {
    const opened = await unlock();
    const c = ctx;
    if (!opened || !c) return;

    stopAmbient();

    ambienceGain = c.createGain();
    ambienceGain.gain.setValueAtTime(1e-4, c.currentTime);

    ambienceOscLow = c.createOscillator();
    ambienceOscLow.type = "sine";
    ambienceOscLow.frequency.setValueAtTime(58, c.currentTime);

    ambienceOscHigh = c.createOscillator();
    ambienceOscHigh.type = "triangle";
    ambienceOscHigh.frequency.setValueAtTime(196, c.currentTime);

    const highGain = c.createGain();
    highGain.gain.setValueAtTime(1e-4, c.currentTime);

    ambienceOscLow.connect(ambienceGain);
    ambienceOscHigh.connect(highGain);
    highGain.connect(ambienceGain);
    ambienceGain.connect(c.destination);

    ambienceOscLow.start();
    ambienceOscHigh.start();

    const now = c.currentTime;
    ambienceGain.gain.exponentialRampToValueAtTime(0.028, now + 2.25);
    highGain.gain.exponentialRampToValueAtTime(0.012, now + 2.25);

    ambienceOscLow.frequency.linearRampToValueAtTime(52, now + 6);
    ambienceOscLow.frequency.linearRampToValueAtTime(61, now + 14);

    ambienceOscHigh.frequency.linearRampToValueAtTime(207, now + 7);
    ambienceOscHigh.frequency.linearRampToValueAtTime(188, now + 17);
  }

  function envelopeTone(startFreq, peakMs, decayMs, peakGain) {
    const c = ctx;
    if (!c) return;

    const now = c.currentTime;
    const osc = c.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(startFreq, now);

    const g = c.createGain();
    g.gain.setValueAtTime(1e-4, now);
    g.gain.exponentialRampToValueAtTime(peakGain, now + peakMs / 1000);

    osc.connect(g);
    g.connect(c.destination);

    osc.start(now);
    g.gain.exponentialRampToValueAtTime(1e-4, now + decayMs / 1000);

    osc.stop(now + decayMs / 1000 + 0.06);
    setTimeout(() => {
      try {
        osc.disconnect();
        g.disconnect();
      } catch {
        // ignore
      }
    }, decayMs + 200);
  }

  /** Short rising tone before capture. */
  function playRecordingStartCue() {
    const c = ensureContext();
    if (!c) return;
    if (ctx && ctx.state === "suspended") {
      unlock().then(() => envelopeTone(360, 12, 120, 0.09));
      return;
    }
    envelopeTone(360, 12, 120, 0.09);
  }

  /** Gentle falling tone after capture stops. */
  function playRecordingStopCue() {
    const c = ensureContext();
    if (!c) return;
    envelopeTone(220, 10, 180, 0.07);
  }

  /** Two-note completion chime after simulated upload completes. */
  function playUploadCompleteCue() {
    const c = ensureContext();
    if (!c) return;
    const now = c.currentTime;

    function shortNote(freq, delay, peak, dur) {
      const t0 = now + delay;
      const osc = c.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, t0);
      const g = c.createGain();
      g.gain.setValueAtTime(1e-4, t0);
      g.gain.exponentialRampToValueAtTime(peak, t0 + 0.024);
      g.gain.exponentialRampToValueAtTime(1e-4, t0 + dur);
      osc.connect(g);
      g.connect(c.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.05);

      window.setTimeout(() => {
        try {
          osc.disconnect();
          g.disconnect();
        } catch {
          // ignore
        }
      }, (dur + delay) * 1000 + 150);
    }

    shortNote(659.255, 0, 0.07, 0.15);
    shortNote(783.991, 0.11, 0.06, 0.22);
  }

  return {
    unlock,
    startAmbient,
    stopAmbient,
    playRecordingStartCue,
    playRecordingStopCue,
    playUploadCompleteCue,
  };
}
