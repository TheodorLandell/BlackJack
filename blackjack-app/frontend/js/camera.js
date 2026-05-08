// camera.js — webcam + live YOLO detection pipeline (9b) + auto-feed (9d)

let stream              = null;
let isRunning           = false;
let detectionInProgress = false;
let frameTimes          = [];

const videoEl       = document.getElementById("cameraVideo");
const overlayCanvas = document.getElementById("overlayCanvas");
const captureCanvas = document.getElementById("captureCanvas");
const toggleBtn     = document.getElementById("cameraToggle");
const fpsEl         = document.getElementById("cameraFps");
const inferenceEl   = document.getElementById("cameraInference");
const detCountEl    = document.getElementById("cameraDetCount");
const overlayCtx    = overlayCanvas.getContext("2d");

// ---------------------------------------------------------------------------
// Stable-detection state (DEL 4)
// ---------------------------------------------------------------------------

const detectionCounters = new Map(); // nyckel: "<class>:<zone>", värde: antal frames
const THRESHOLD         = 3;
const CONFIDENCE_MIN    = 0.7;

// ---------------------------------------------------------------------------
// Camera lifecycle
// ---------------------------------------------------------------------------

async function startCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: true });
    videoEl.srcObject = stream;
    videoEl.addEventListener("loadedmetadata", () => {
      const w = videoEl.videoWidth;
      const h = videoEl.videoHeight;
      overlayCanvas.width  = w;
      overlayCanvas.height = h;
      captureCanvas.width  = w;
      captureCanvas.height = h;
    }, { once: true });
    isRunning = true;
    toggleBtn.textContent = "Stop camera";
    frameLoop();
  } catch (err) {
    const msg = err.name === "NotAllowedError" ? "Permission denied" : "Camera not available";
    setDebugError(msg);
  }
}

function stopCamera() {
  isRunning = false;
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  videoEl.srcObject = null;
  overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  toggleBtn.textContent = "Start camera";
  frameTimes = [];
  fpsEl.textContent       = "—";
  inferenceEl.textContent = "—";
  detCountEl.textContent  = "—";
  detectionCounters.clear();
}

// ---------------------------------------------------------------------------
// Frame capture + detection loop
// ---------------------------------------------------------------------------

function captureFrame() {
  const ctx = captureCanvas.getContext("2d");
  ctx.drawImage(videoEl, 0, 0, captureCanvas.width, captureCanvas.height);
  return captureCanvas.toDataURL("image/jpeg", 0.7);
}

async function detectFrame() {
  if (detectionInProgress) return;
  detectionInProgress = true;
  try {
    const dataUrl = captureFrame();
    const res  = await fetch("http://localhost:5000/api/vision/detect", {
      method : "POST",
      headers: { "Content-Type": "application/json" },
      body   : JSON.stringify({ image: dataUrl }),
    });
    const data = await res.json();
    if (data.error) {
      const msg = (data.error.includes("Modell saknas") || data.error.includes("best.pt"))
        ? "Model not loaded"
        : data.error.slice(0, 28);
      setDebugError(msg);
      return;
    }
    drawOverlay(data.detections, data.image_size);
    processDetections(data.detections, data.image_size);
    updateDebugInfo(data.inference_time_ms, data.detections.length);
  } catch (err) {
    setDebugError(`Network: ${err.message.slice(0, 22)}`);
  } finally {
    detectionInProgress = false;
  }
}

function frameLoop() {
  if (!isRunning) return;
  detectFrame();
  setTimeout(frameLoop, 100);
}

// ---------------------------------------------------------------------------
// Zone helpers + class validation (DEL 5)
// ---------------------------------------------------------------------------

function determineZone(centerY, imageHeight) {
  return centerY < imageHeight / 2 ? "top" : "bottom";
}

function expectedZoneFor(waitingFor) {
  const playerStates = ["player_card_1", "player_card_2", "player_hit", "player_double_card"];
  const dealerStates = ["dealer_card_1", "dealer_card_2", "dealer_reveal", "dealer_hit"];
  if (playerStates.includes(waitingFor)) return "bottom";
  if (dealerStates.includes(waitingFor)) return "top";
  return null;
}

function isCardClassValidFor(cardClass, waitingFor) {
  if (waitingFor === "dealer_card_2") return cardClass === "back";
  return cardClass !== "back";
}

// ---------------------------------------------------------------------------
// Stable-detection processing (DEL 4)
// ---------------------------------------------------------------------------

function processDetections(detections, imageSize) {
  const imgH = imageSize?.height || overlayCanvas.height;
  const seenThisFrame = new Set();

  for (const det of detections) {
    if (det.confidence < CONFIDENCE_MIN) continue;
    const zone = determineZone(det.center.y, imgH);
    seenThisFrame.add(`${det.class}:${zone}`);
  }

  // Reset counters för kort som inte setts denna frame
  for (const key of [...detectionCounters.keys()]) {
    if (!seenThisFrame.has(key)) detectionCounters.delete(key);
  }

  // Öka räknare för sedda kort
  for (const key of seenThisFrame) {
    detectionCounters.set(key, (detectionCounters.get(key) || 0) + 1);
  }

  // Kontrollera threshold — samla upp alla kandidater före feed
  const toFeed = [];
  for (const [key, count] of detectionCounters) {
    if (count >= THRESHOLD) {
      const colonIdx = key.indexOf(":");
      toFeed.push({ cardClass: key.slice(0, colonIdx), zone: key.slice(colonIdx + 1) });
    }
  }
  for (const { cardClass, zone } of toFeed) {
    tryAutoFeed(cardClass, zone);
  }
}

// ---------------------------------------------------------------------------
// Auto-feed (DEL 6)
// ---------------------------------------------------------------------------

function tryAutoFeed(cardClass, zone) {
  if (window.gameState.currentMode !== "camera") return;
  if (window.gameState.isAnimating) return;
  if (window.gameState.waitingFor === null) return;
  if (window.gameState.consumedClasses.has(cardClass)) return;

  const expected = expectedZoneFor(window.gameState.waitingFor);
  if (zone !== expected) return;
  if (!isCardClassValidFor(cardClass, window.gameState.waitingFor)) return;

  // Alla gate-checks passerade — trigga feed
  window.gameState.consumedClasses.add(cardClass);
  detectionCounters.clear();

  fetch("http://localhost:5000/api/round/feed_card", {
    method : "POST",
    headers: { "Content-Type": "application/json" },
    body   : JSON.stringify({ card_code: cardClass }),
  })
    .then((r) => r.json())
    .then((state) => {
      if (window.handleStateUpdate) window.handleStateUpdate(state);
    })
    .catch((err) => {
      console.error("Auto-feed misslyckades:", err);
    });
}

// ---------------------------------------------------------------------------
// Overlay rendering (DEL 7: stable-detection counter-visning)
// ---------------------------------------------------------------------------

function drawOverlay(detections, imageSize) {
  const cw = overlayCanvas.width;
  const ch = overlayCanvas.height;
  const scaleX  = cw / (imageSize?.width  || cw);
  const scaleY  = ch / (imageSize?.height || ch);
  const imgH    = imageSize?.height || ch;
  const wf      = window.gameState?.waitingFor ?? null;
  const expZone = wf ? expectedZoneFor(wf) : null;

  overlayCtx.clearRect(0, 0, cw, ch);

  // Horisontell mittlinje — dealer/player-zon-markering
  const midY = ch / 2;
  overlayCtx.save();
  overlayCtx.setLineDash([6, 4]);
  overlayCtx.strokeStyle = "rgba(255, 240, 140, 0.5)";
  overlayCtx.lineWidth   = 1;
  overlayCtx.beginPath();
  overlayCtx.moveTo(0, midY);
  overlayCtx.lineTo(cw, midY);
  overlayCtx.stroke();
  overlayCtx.setLineDash([]);
  overlayCtx.restore();

  overlayCtx.font      = "bold 9px sans-serif";
  overlayCtx.fillStyle = "rgba(255, 240, 140, 0.55)";
  overlayCtx.fillText("DEALER", 4, midY - 4);
  overlayCtx.fillText("PLAYER", 4, midY + 12);

  for (const det of detections) {
    const x1 = det.box.x1 * scaleX;
    const y1 = det.box.y1 * scaleY;
    const x2 = det.box.x2 * scaleX;
    const y2 = det.box.y2 * scaleY;

    const conf  = det.confidence;
    const color = conf >= 0.8 ? "#4ade80" : conf >= 0.6 ? "#facc15" : "#f87171";

    overlayCtx.strokeStyle = color;
    overlayCtx.lineWidth   = 1.5;
    overlayCtx.strokeRect(x1, y1, x2 - x1, y2 - y1);

    // Stable-detection räknare (DEL 7)
    const zone      = determineZone(det.center.y, imgH);
    const key       = `${det.class}:${zone}`;
    const count     = detectionCounters.get(key) || 0;
    const isRelevant = wf && zone === expZone
      && isCardClassValidFor(det.class, wf)
      && conf >= CONFIDENCE_MIN;

    let suffix = "";
    if (isRelevant && count >= 1) {
      suffix = count >= THRESHOLD ? " ✓" : ` (${count}/${THRESHOLD})`;
    }

    const label = `${det.class} ${conf.toFixed(2)}${suffix}`;
    overlayCtx.font = "bold 10px sans-serif";
    const tw = overlayCtx.measureText(label).width;
    const lx = x1;
    const ly = y1 > 14 ? y1 - 2 : y2 + 12;
    overlayCtx.fillStyle = "rgba(0, 0, 0, 0.55)";
    overlayCtx.fillRect(lx - 1, ly - 11, tw + 4, 13);
    overlayCtx.fillStyle = color;
    overlayCtx.fillText(label, lx + 1, ly);
  }
}

// ---------------------------------------------------------------------------
// Debug info
// ---------------------------------------------------------------------------

function updateDebugInfo(inferenceMs, detCount) {
  const now = performance.now();
  frameTimes.push(now);
  if (frameTimes.length > 12) frameTimes.shift();

  if (frameTimes.length >= 2) {
    const span = frameTimes[frameTimes.length - 1] - frameTimes[0];
    const fps  = ((frameTimes.length - 1) / span) * 1000;
    fpsEl.textContent = `${fps.toFixed(1)} fps`;
  }
  inferenceEl.textContent = `${inferenceMs.toFixed(0)} ms`;
  detCountEl.textContent  = `${detCount} det`;
}

function setDebugError(msg) {
  fpsEl.textContent       = "—";
  inferenceEl.textContent = "—";
  detCountEl.textContent  = msg;
}

// ---------------------------------------------------------------------------
// Toggle
// ---------------------------------------------------------------------------

toggleBtn.addEventListener("click", () => {
  if (isRunning) stopCamera(); else startCamera();
});
