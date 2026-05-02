const MAX_SECONDS = 50;

/** @typedef {{ ok: boolean; reason?: string }} StreamResult */

function pickMimeType() {
  try {
    if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
      return "";
    }
    const ordered = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
    for (const t of ordered) {
      if (MediaRecorder.isTypeSupported(t)) return t;
    }
    if (MediaRecorder.isTypeSupported("video/mp4")) return "video/mp4";
    if (MediaRecorder.isTypeSupported("video/mp4; codecs=avc1.41E029")) return "video/mp4; codecs=avc1.41E029";
  } catch {
    return "";
  }
  return "";
}

export class RecorderController {
  constructor() {
    this.maxSeconds = MAX_SECONDS;
    /** @type {MediaStream | null} */
    this.stream = null;
    /** @type {MediaRecorder | null} */
    this.recorder = null;
    /** @type {BlobPart[]} */
    this.chunks = [];
    /** @type {Blob | null} */
    this.lastBlob = null;

    /** @type {(() => void) | null} */
    this.onLimitReached = null;
    /** @type {((seconds: number) => void) | null} */
    this.onTick = null;

    this._elapsedMs = 0;
    /** @type {number | null} */
    this._tickId = null;
    /** @type {number | null} */
    this._recordStartPerf = null;
    this._mimeType = "";
    /** @type {boolean} */
    this._limitDispatched = false;
  }

  /**
   * @returns {Promise<StreamResult>}
   */
  async openCamera() {
    try {
      if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
        return { ok: false, reason: "Camera API is unavailable in this browser or context." };
      }

      try {
        this.stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "user",
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: true,
        });
      } catch (err) {
        const named = typeof err !== "undefined" && err !== null ? err.name : "";
        let reason = "Permission was declined or hardware is unavailable.";
        if (named === "NotAllowedError") {
          reason = "Camera access was denied. Allow permissions to record.";
        } else if (named === "NotFoundError") {
          reason = "No camera was found.";
        } else if (named === "NotReadableError") {
          reason = "Camera is busy or cannot be accessed.";
        } else if (named === "OverconstrainedError") {
          try {
            this.stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
          } catch {
            reason = "Camera constraints are not satisfied on this device.";
            return { ok: false, reason };
          }
        } else if (named === "SecurityError") {
          reason = "Camera access blocked for security reasons. Use HTTPS or localhost.";
          return { ok: false, reason };
        } else if (named) {
          reason = `${reason} (${named})`;
        }

        return { ok: !!this.stream, reason: this.stream ? undefined : reason };
      }

      return { ok: true };
    } catch {
      return { ok: false, reason: "Unexpected failure while requesting the camera." };
    }
  }

  /**
   * @param {HTMLVideoElement | null} el
   */
  attachLivePreview(el) {
    if (!el || !this.stream) return;

    try {
      el.srcObject = this.stream;
      const p = el.play();
      if (p !== undefined && typeof p.catch === "function") {
        p.catch(() => {
          /* autoplay quirks are fine to ignore until user interacts */
        });
      }
    } catch {
      // ignore attachment errors per resilience contract
    }
  }

  /**
   * @returns {{ ok: boolean; reason?: string }}
   */
  startRecording() {
    try {
      if (!this.stream) {
        return { ok: false, reason: "Open the camera before recording." };
      }
      if (typeof MediaRecorder === "undefined") {
        return { ok: false, reason: "Recording is not supported in this browser." };
      }

      this._cleanupRecorderArtifacts();

      this.chunks = [];
      this.lastBlob = null;

      const mimeHint = pickMimeType();
      this._mimeType = mimeHint;
      /** @type {MediaRecorderOptions} */
      const options = mimeHint ? { mimeType: mimeHint } : {};
      try {
        this.recorder = new MediaRecorder(this.stream, options);
      } catch {
        try {
          this.recorder = new MediaRecorder(this.stream);
        } catch {
          return { ok: false, reason: "Failed to start recorder on this device." };
        }
      }

      const rec = this.recorder;
      if (!rec || typeof rec.addEventListener !== "function") {
        return { ok: false, reason: "Recorder unavailable." };
      }

      rec.addEventListener(
        "dataavailable",
        (ev) => {
          try {
            if (ev.data && ev.data.size > 0) this.chunks.push(ev.data);
          } catch {
            // ignore malformed chunk payloads
          }
        },
        { passive: true }
      );

      rec.addEventListener(
        "error",
        () => {
          try {
            this.stopRecording();
          } catch {
            /* ignore */
          }
        },
        { passive: true, once: true }
      );

      rec.start(180);

      this._elapsedMs = 0;
      this._limitDispatched = false;
      this._recordStartPerf =
        typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
      if (typeof this.onTick === "function") this.onTick(0);
      if (typeof this._tickId === "number") clearInterval(this._tickId);

      const tick = () => {
        try {
          if (!rec || rec.state !== "recording") return;
          const now =
            typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
          const start = this._recordStartPerf ?? now;
          this._elapsedMs = Math.max(0, now - start);
          const sec = Math.min(this.maxSeconds, this._elapsedMs / 1000);
          if (typeof this.onTick === "function") this.onTick(sec);
          if (!this._limitDispatched && this._elapsedMs >= this.maxSeconds * 1000) {
            this._limitDispatched = true;
            if (typeof this._tickId === "number") {
              window.clearInterval(this._tickId);
              this._tickId = null;
            }
            if (typeof this.onLimitReached === "function") {
              window.requestAnimationFrame(() => {
                try {
                  this.onLimitReached?.();
                } catch {
                  /* host callback must not break recorder */
                }
              });
            }
          }
        } catch {
          // tick must never throw
        }
      };

      this._tickId = window.setInterval(tick, 120);
      return { ok: true };
    } catch {
      return { ok: false, reason: "Unexpected failure starting capture." };
    }
  }

  /**
   * @returns {Promise<Blob | null>}
   */
  stopRecording() {
    return new Promise((resolve) => {
      try {
        if (typeof this._tickId === "number") {
          window.clearInterval(this._tickId);
          this._tickId = null;
        }

        const rec = this.recorder;
        this.recorder = null;

        if (!rec || rec.state === "inactive") {
          resolve(this.finalizeBlob([]));
          return;
        }

        const done = () => {
          resolve(this.finalizeBlob(this.chunks));
        };

        rec.addEventListener("stop", done, { passive: true, once: true });
        try {
          rec.stop();
        } catch {
          done();
        }
      } catch {
        resolve(null);
      }
    });
  }

  /**
   * @param {BlobPart[]} parts
   * @returns {Blob | null}
   */
  finalizeBlob(parts) {
    try {
      if (!parts.length) return null;
      let type =
        typeof this._mimeType === "string" && this._mimeType.length ? this._mimeType.split(";")[0] : "video/webm";
      if (!type.startsWith("video/")) type = "video/webm";
      const blob = new Blob(parts, { type });
      if (!blob || blob.size === 0) {
        this.lastBlob = null;
        return null;
      }
      this.lastBlob = blob;
      return blob;
    } catch {
      this.lastBlob = null;
      return null;
    }
  }

  teardown() {
    try {
      this.stopRecording();
    } catch {
      /* ignore */
    }

    if (typeof this._tickId === "number") {
      window.clearInterval(this._tickId);
      this._tickId = null;
    }

    if (this.stream) {
      try {
        const tracks = this.stream.getTracks();
        for (const t of tracks) {
          try {
            t.stop();
          } catch {
            /* ignore */
          }
        }
      } catch {
        /* ignore */
      }
      this.stream = null;
    }

    this._cleanupRecorderArtifacts();
    this.recorder = null;
    this.chunks = [];
  }

  _cleanupRecorderArtifacts() {
    if (this.recorder && typeof this.recorder.stop === "function") {
      try {
        if (this.recorder.state !== "inactive") this.recorder.stop();
      } catch {
        /* ignore */
      }
    }
    this.recorder = null;
  }
}
