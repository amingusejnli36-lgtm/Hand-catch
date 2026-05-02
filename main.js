import { createAudioEngine } from "./audio-engine.js";
import { FeedStore } from "./feed-store.js";
import { RecorderController } from "./recorder-controller.js";

const MAX_SECONDS = 50;

/**
 * @param {number} sec
 * @returns {string}
 */
function formatClock(sec) {
  const s = Math.max(0, Math.min(MAX_SECONDS, sec));
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

/**
 * @param {HTMLElement} el
 * @param {boolean} show
 */
function toggleHidden(el, show) {
  if (!el) return;
  el.classList.toggle("hidden", !show);
}

function main() {
  const splash = document.getElementById("splash");
  const splashEnter = document.getElementById("splash-enter");
  const mainApp = document.getElementById("main-app");

  const bannerError = document.getElementById("banner-error");
  const bannerSoft = document.getElementById("banner-soft");

  const previewLive = document.getElementById("preview-live");
  const previewPlayback = document.getElementById("preview-playback");
  const previewPlaceholder = document.getElementById("preview-placeholder");
  const recordingPulse = document.getElementById("recording-pulse");
  const ringOuter = document.getElementById("ring-outer");

  const timerEl = document.getElementById("timer");
  const recInstruction = document.getElementById("rec-instruction");
  const recordButton = document.getElementById("record-button");
  const postActions = document.getElementById("post-actions");
  const btnDiscard = document.getElementById("btn-discard");
  const btnUpload = document.getElementById("btn-upload");

  const galleryGrid = document.getElementById("gallery-grid");
  const galleryEmpty = document.getElementById("gallery-empty");

  const uploadDialog = document.getElementById("dialog-upload");
  const progressBar = document.getElementById("progress-bar");
  const progressFill = document.getElementById("progress-fill");
  const progressLabel = document.getElementById("progress-label");

  const audio = createAudioEngine();
  const feed = new FeedStore();
  const recorder = new RecorderController();

  /** @type {"idle" | "recording" | "preview" | "uploading"} */
  let uiMode = "idle";
  let cameraReady = false;
  let cameraStarting = false;
  /** @type {string | null} */
  let playbackObjectUrl = null;
  let pressActive = false;

  function setError(msg) {
    if (!bannerError) return;
    bannerError.textContent = msg;
    toggleHidden(bannerError, true);
  }

  function clearError() {
    if (!bannerError) return;
    bannerError.textContent = "";
    toggleHidden(bannerError, false);
  }

  function setSoft(msg) {
    if (!bannerSoft) return;
    bannerSoft.textContent = msg;
    toggleHidden(bannerSoft, true);
  }

  function clearSoft() {
    if (!bannerSoft) return;
    bannerSoft.textContent = "";
    toggleHidden(bannerSoft, false);
  }

  function setTimerLabel(seconds) {
    if (!timerEl) return;
    timerEl.textContent = `${formatClock(seconds)} / ${formatClock(MAX_SECONDS)}`;
  }

  function updateRecordAvailability() {
    if (!recordButton) return;
    const disableHold = uiMode === "preview" || uiMode === "uploading";
    recordButton.disabled = disableHold;
    recordButton.setAttribute("aria-disabled", disableHold ? "true" : "false");
  }

  /**
   * @param {boolean} isPreview
   */
  function setPreviewChrome(isPreview) {
    toggleHidden(previewLive, Boolean(!isPreview && cameraReady));
    toggleHidden(previewPlayback, isPreview);

    const showPlaceholder = Boolean(!cameraReady && !isPreview);
    toggleHidden(previewPlaceholder, showPlaceholder);

    toggleHidden(postActions, isPreview);
    if (recInstruction) {
      recInstruction.textContent = isPreview
        ? "Preview your wish. Send to gallery or discard."
        : "Press and hold the button to record.";
    }

    updateRecordAvailability();
  }

  function clearPlayback() {
    if (previewPlayback) {
      try {
        previewPlayback.pause();
      } catch {
        /* ignore */
      }
      previewPlayback.removeAttribute("src");
      try {
        previewPlayback.load();
      } catch {
        /* ignore */
      }
    }
    if (playbackObjectUrl) {
      try {
        URL.revokeObjectURL(playbackObjectUrl);
      } catch {
        /* ignore */
      }
      playbackObjectUrl = null;
    }
  }

  function syncLivePreview() {
    if (!cameraReady || !previewLive || !recorder.stream) return;

    recorder.attachLivePreview(previewLive);

    if (uiMode === "preview") {
      toggleHidden(previewLive, false);
      return;
    }

    toggleHidden(previewLive, true);
    if (previewPlaceholder) {
      toggleHidden(previewPlaceholder, !cameraReady);
    }
  }

  async function ensureCamera() {
    if (cameraReady) return true;
    if (cameraStarting) return false;
    cameraStarting = true;
    clearError();
    setSoft("Requesting camera access");

    const res = await recorder.openCamera();
    cameraStarting = false;
    clearSoft();

    if (!res.ok) {
      setError(res.reason || "Camera could not be opened.");
      cameraReady = false;
      return false;
    }

    cameraReady = true;
    syncLivePreview();
    return true;
  }

  async function beginRecording() {
    clearError();
    clearSoft();

    if (uiMode === "preview" || uiMode === "uploading") return;

    const okCam = await ensureCamera();
    if (!okCam) return;

    clearPlayback();
    uiMode = "recording";

    setPreviewChrome(false);

    if (previewPlayback) previewPlayback.classList.add("hidden");
    if (previewLive) previewLive.classList.remove("hidden");
    if (previewPlaceholder) previewPlaceholder.classList.add("hidden");

    if (ringOuter) ringOuter.classList.add("ring-active");
    if (recordingPulse) recordingPulse.classList.remove("hidden");
    if (recordButton) recordButton.setAttribute("aria-pressed", "true");

    audio.playRecordingStartCue();

    recorder.onTick = (sec) => {
      setTimerLabel(sec);
    };
    recorder.onLimitReached = () => {
      setSoft("Maximum length reached. Capture stopped automatically.");
      window.setTimeout(() => clearSoft(), 5200);
      void endRecording();
    };

    const started = recorder.startRecording();
    if (!started.ok) {
      audio.playRecordingStopCue();
      if (recordingPulse) recordingPulse.classList.add("hidden");
      if (ringOuter) ringOuter.classList.remove("ring-active");
      if (recordButton) recordButton.setAttribute("aria-pressed", "false");
      setError(started.reason || "Recording could not start.");
      uiMode = "idle";
      setPreviewChrome(false);
      syncLivePreview();
      updateRecordAvailability();
      return;
    }

    setTimerLabel(0);
  }

  async function endRecording() {
    pressActive = false;

    if (uiMode !== "recording") return;

    if (ringOuter) ringOuter.classList.remove("ring-active");
    if (recordingPulse) recordingPulse.classList.add("hidden");
    if (recordButton) recordButton.setAttribute("aria-pressed", "false");

    audio.playRecordingStopCue();

    const blob = await recorder.stopRecording();

    idleAfterCapture(blob);
  }

  /**
   * @param {Blob | null} blob
   */
  function idleAfterCapture(blob) {
    clearSoft();

    if (!blob || blob.size === 0) {
      setSoft("Recording produced an empty clip. Try again.");
      uiMode = "idle";
      setPreviewChrome(false);
      syncLivePreview();
      setTimerLabel(0);
      updateRecordAvailability();
      return;
    }

    clearPlayback();
    playbackObjectUrl = URL.createObjectURL(blob);
    if (previewPlayback) {
      previewPlayback.src = playbackObjectUrl;
      previewPlayback.classList.remove("hidden");
    }
    if (previewLive) previewLive.classList.add("hidden");

    toggleHidden(recordingPulse, false);

    uiMode = "preview";
    setPreviewChrome(true);

    try {
      const q = previewPlayback?.play?.();
      if (q !== undefined && typeof q.catch === "function") q.catch(() => {});
    } catch {
      /* ignore */
    }

    setTimerLabel(0);
  }

  /**
   * @returns {Promise<void>}
   */
  async function simulateUpload() {
    if (!uploadDialog || !progressBar || !progressFill || !progressLabel || uiMode !== "preview") return;

    uiMode = "uploading";
    updateRecordAvailability();

    toggleHidden(uploadDialog, true);
    if (typeof uploadDialog.showModal === "function") {
      try {
        uploadDialog.showModal();
      } catch {
        toggleHidden(uploadDialog, false);
      }
    }

    const lastBlob = recorder.lastBlob;
    if (!lastBlob) {
      if (uploadDialog.open) uploadDialog.close();
      uiMode = "preview";
      updateRecordAvailability();
      return;
    }

    let pct = 0;
    progressBar.setAttribute("aria-valuenow", "0");
    progressFill.style.width = "0%";
    progressLabel.textContent = "0 percent";

    await new Promise((resolve) => {
      const step = () => {
        pct += Math.random() * 9 + 5;
        if (pct >= 100) pct = 100;
        progressBar?.setAttribute("aria-valuenow", String(Math.floor(pct)));
        progressFill.style.width = `${pct}%`;
        progressLabel.textContent = `${Math.floor(pct)} percent`;
        if (pct >= 100) {
          window.requestAnimationFrame(() => resolve(undefined));
          return;
        }
        window.requestAnimationFrame(step);
      };
      window.requestAnimationFrame(step);
    });

    audio.playUploadCompleteCue();

    const item = feed.push(lastBlob);
    renderGallery();

    window.setTimeout(() => {
      if (uploadDialog.open) uploadDialog.close();
      discardPreview();
    }, 650);
  }

  function discardPreview() {
    clearPlayback();

    recorder.lastBlob = null;
    recorder.chunks = [];

    uiMode = "idle";
    setPreviewChrome(false);
    syncLivePreview();
    setTimerLabel(0);
    clearError();
    clearSoft();
    updateRecordAvailability();
  }

  function renderGallery() {
    if (!galleryGrid || !galleryEmpty) return;

    galleryGrid.innerHTML = "";
    toggleHidden(galleryEmpty, feed.items.length === 0);

    for (const item of feed.items) {
      const card = document.createElement("article");
      card.className = "card";

      const vid = document.createElement("video");
      vid.className = "card-video";
      vid.src = item.url;
      vid.controls = false;
      vid.playsInline = true;
      vid.loop = true;
      vid.muted = true;
      vid.setAttribute("preload", "metadata");
      vid.setAttribute(
        "aria-label",
        `Recorded wish preview from ${new Date(item.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
      );

      vid.addEventListener(
        "click",
        () => {
          try {
            if (!vid.paused && typeof vid.pause === "function") vid.pause();
            else typeof vid.play === "function" && vid.play();
          } catch {
            /* ignore */
          }
        },
        { passive: true }
      );

      vid.addEventListener(
        "pointerenter",
        () => {
          try {
            if (vid.paused) vid.play()?.catch(() => {});
          } catch {
            /* ignore */
          }
        },
        { passive: true }
      );

      const overlay = document.createElement("div");
      overlay.className = "card-overlay";
      overlay.textContent = new Date(item.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "card-remove";
      removeBtn.setAttribute("aria-label", "Remove clip from gallery");
      removeBtn.textContent = "\u00d7";
      removeBtn.addEventListener("click", () => {
        feed.remove(item.id);
        renderGallery();
      });

      card.append(vid, overlay, removeBtn);
      galleryGrid.append(card);
    }
  }

  function mountRecordingControls() {
    if (!recordButton) return;

    const onDown = (ev) => {
      if ("button" in ev && ev.button !== 0) return;
      pressActive = true;
      window.requestAnimationFrame(() => {
        void beginRecording();
      });

      try {
        if ("pointerId" in ev && typeof recordButton.setPointerCapture === "function") {
          recordButton.setPointerCapture(ev.pointerId);
        }
      } catch {
        /* ignore unsupported capture environments */
      }
    };

    const onUpOrCancel = () => {
      window.requestAnimationFrame(() => {
        void endRecording();
      });
    };

    recordButton.addEventListener("pointerdown", onDown);
    recordButton.addEventListener("pointerup", onUpOrCancel);
    recordButton.addEventListener("pointercancel", onUpOrCancel);
    recordButton.addEventListener("lostpointercapture", onUpOrCancel);

    recordButton.addEventListener(
      "keydown",
      (e) => {
        if (recordButton.disabled) return;
        if (e.code !== "Space" || e.repeat) return;
        e.preventDefault();
        pressActive = true;
        void beginRecording();
      },
      { passive: false }
    );

    recordButton.addEventListener(
      "keyup",
      (e) => {
        if (e.code !== "Space") return;
        e.preventDefault();
        pressActive = false;
        void endRecording();
      },
      { passive: false }
    );
  }

  function mountSplash() {
    splashEnter?.addEventListener(
      "click",
      async () => {
        clearError();

        splash?.classList.add("splash-exit");
        audio.unlock().catch(() => {});
        await audio.startAmbient().catch(() => {});
        splash?.setAttribute("aria-hidden", "true");

        window.setTimeout(() => {
          if (splash) splash.style.pointerEvents = "none";
          if (mainApp) {
            mainApp.classList.remove("hidden");
            mainApp.classList.add("ready");
            mainApp.focus({ preventScroll: true });
          }
        }, 900);

        const cam = await ensureCamera();
        if (!cam && bannerSoft) {
          setSoft("Allow camera access any time before recording begins.");
          window.setTimeout(() => clearSoft(), 8200);
        }
      },
      { passive: true }
    );
  }

  btnDiscard?.addEventListener("click", () => discardPreview());
  btnUpload?.addEventListener("click", () => {
    void simulateUpload();
  });

  recorder.onTick = () => {};

  renderGallery();
  setTimerLabel(0);
  uiMode = "idle";
  toggleHidden(recordingPulse, false);
  setPreviewChrome(false);

  mountRecordingControls();
  mountSplash();

  /** Best-effort: release camera tab when hidden. */
  document.addEventListener(
    "visibilitychange",
    () => {
      if (document.visibilityState !== "hidden") return;
      if (uiMode === "recording") {
        window.requestAnimationFrame(() => endRecording());
      }
    },
    { passive: true }
  );

  uploadDialog?.addEventListener("cancel", (e) => {
    e.preventDefault();
  });

  window.addEventListener(
    "beforeunload",
    () => {
      try {
        recorder.teardown();
      } catch {
        /* ignore */
      }
      try {
        audio.stopAmbient();
      } catch {
        /* ignore */
      }
    },
    { passive: true }
  );
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", main, { once: true, passive: true });
} else {
  main();
}
