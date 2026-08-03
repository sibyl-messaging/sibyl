const HOLE_GRID_WIDTH = 12;
const HOLE_GRID_HEIGHT = 12;
const MAX_LEN = 280;

const GLYPH_ORDER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ .".split("");
const ACTIVE_HOLE_IDS = [
  0, 5, 10, 15, 21, 26, 31, 37, 42, 47, 53, 58, 63, 69, 74, 79, 85, 90, 95, 101,
  106, 111, 117, 122, 127, 133, 138, 143
];

const TRACE_VIEWBOX = {
  width: 360,
  height: 760,
  frameX: 18,
  frameY: 56,
  frameWidth: 324,
  frameHeight: 650,
  gridLeft: 42,
  gridTop: 102,
  gridRight: 318,
  gridBottom: 662,
  cols: 8,
  rows: 14
};

const TRACE_MODE_LABELS = {
  public: "Public frame",
  "share-a": "Share A",
  "share-b": "Share B",
  combined: "Combined preview"
};

const TRACE_MARKS_PER_SHARE = 10;

const TRACE_CANDIDATE_CELLS = (() => {
  const cells = [];
  for (let row = 1; row <= 12; row += 1) {
    for (let col = 1; col <= 6; col += 1) {
      if ((row + col) % 2 === 0) {
        cells.push({ col, row });
      }
    }
  }
  return cells;
})();

const HOLE_ID_TO_GLYPH = Object.fromEntries(
  ACTIVE_HOLE_IDS.map((holeId, idx) => [holeId, GLYPH_ORDER[idx]])
);
const GLYPH_TO_HOLE_ID = Object.fromEntries(
  GLYPH_ORDER.map((glyph, idx) => [glyph, ACTIVE_HOLE_IDS[idx]])
);

const state = {
  tab: "sheet",
  text: "HELLO.",
  noiseSeed: Date.now(),
  offsetX: 0,
  offsetY: 0,
  strobeOn: false,
  strobeTick: 0,
  maskLocked: false,
  codeBuffer: "",
  decodedText: "",
  mapping: generateBlindInputMapping(ACTIVE_HOLE_IDS),
  traceMode: "public",
  traceActive: false,
  tracePattern: createTracePattern()
};

const refs = {
  messageInput: byId("messageInput"),
  normalizedText: byId("normalizedText"),
  tokenCount: byId("tokenCount"),
  sheetGrid: byId("sheetGrid"),
  readStage: byId("readStage"),
  numberGrid: byId("numberGrid"),
  pendingCode: byId("pendingCode"),
  decodedText: byId("decodedText"),
  offsetText: byId("offsetText"),
  digitPad: byId("digitPad"),
  strobeBtn: byId("strobeBtn"),
  maskLockBtn: byId("maskLockBtn"),
  maskLockStatus: byId("maskLockStatus"),
  unlockFab: byId("unlockFab"),
  traceModeButtons: [...document.querySelectorAll("[data-trace-mode]")],
  traceModeLabel: byId("traceModeLabel"),
  traceFeatureStatus: byId("traceFeatureStatus"),
  tracePreview: byId("tracePreview"),
  traceStage: byId("traceStage"),
  traceStartBtn: byId("traceStartBtn"),
  traceRefreshBtn: byId("traceRefreshBtn"),
  traceOverlay: byId("traceOverlay"),
  traceLiveLabel: byId("traceLiveLabel"),
  traceLiveStatus: byId("traceLiveStatus"),
  traceExitHotspot: byId("traceExitHotspot")
};

let strobeTimer = null;
let lockedScrollY = 0;
let traceScrollY = 0;
let traceWakeLock = null;
let traceExitTimer = null;

bindEvents();
renderAll();

function bindEvents() {
  refs.messageInput.addEventListener("input", (e) => {
    state.text = String(e.target.value || "").slice(0, MAX_LEN);
    renderMessageMeta();
    renderReadBitmap();
  });

  byId("refreshNoise").addEventListener("click", () => {
    state.noiseSeed = Date.now();
    renderReadBitmap();
  });

  document.querySelectorAll(".tab").forEach((tabBtn) => {
    tabBtn.addEventListener("click", () => {
      setTab(tabBtn.dataset.tab);
    });
  });

  byId("leftBtn").addEventListener("click", () => move(-1, 0));
  byId("rightBtn").addEventListener("click", () => move(1, 0));
  byId("upBtn").addEventListener("click", () => move(0, -1));
  byId("downBtn").addEventListener("click", () => move(0, 1));
  byId("centerBtn").addEventListener("click", () => {
    state.offsetX = 0;
    state.offsetY = 0;
    renderReadBitmap();
  });

  refs.strobeBtn.addEventListener("click", () => {
    state.strobeOn = !state.strobeOn;
    refs.strobeBtn.textContent = state.strobeOn ? "Disable Strobe" : "Enable Strobe";

    if (state.strobeOn) {
      strobeTimer = setInterval(() => {
        state.strobeTick = state.strobeTick === 0 ? 1 : 0;
        renderReadBitmap();
      }, 140);
    } else if (strobeTimer) {
      clearInterval(strobeTimer);
      strobeTimer = null;
      state.strobeTick = 0;
      renderReadBitmap();
    }
  });

  byId("shuffleBtn").addEventListener("click", () => {
    shuffleMapping();
  });

  byId("clearBtn").addEventListener("click", () => {
    state.codeBuffer = "";
    state.decodedText = "";
    shuffleMapping();
    renderBlindInput();
  });

  refs.maskLockBtn.addEventListener("click", () => {
    setMaskLock(!state.maskLocked);
  });

  refs.unlockFab.addEventListener("click", () => {
    setMaskLock(false);
  });

  refs.traceModeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setTraceMode(button.dataset.traceMode);
    });
  });

  refs.traceStartBtn.addEventListener("click", () => {
    void enterTraceMode();
  });

  refs.traceRefreshBtn.addEventListener("click", () => {
    state.tracePattern = createTracePattern();
    renderTraceSurfaces();
  });

  const blockIfLocked = (event) => {
    if (state.maskLocked) {
      event.preventDefault();
    }
  };
  window.addEventListener("touchmove", blockIfLocked, { passive: false });
  window.addEventListener("wheel", blockIfLocked, { passive: false });
  window.addEventListener("gesturestart", blockIfLocked, { passive: false });
  window.addEventListener("gesturechange", blockIfLocked, { passive: false });

  const blockIfTracing = (event) => {
    if (state.traceActive) {
      event.preventDefault();
    }
  };
  refs.traceOverlay.addEventListener("touchmove", blockIfTracing, { passive: false });
  refs.traceOverlay.addEventListener("wheel", blockIfTracing, { passive: false });
  refs.traceOverlay.addEventListener("pointermove", blockIfTracing);

  refs.traceExitHotspot.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    clearTraceExitTimer();
    refs.traceLiveStatus.textContent = "Hold corner chip...";
    traceExitTimer = setTimeout(() => {
      void exitTraceMode();
    }, 1200);
  });

  ["pointerup", "pointerleave", "pointercancel"].forEach((eventName) => {
    refs.traceExitHotspot.addEventListener(eventName, () => {
      clearTraceExitTimer();
      if (state.traceActive) {
        refs.traceLiveStatus.textContent = "Best effort freeze";
      }
    });
  });

  document.addEventListener("visibilitychange", () => {
    if (state.traceActive && document.visibilityState === "visible") {
      void requestTraceWakeLock();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.traceActive) {
      void exitTraceMode();
    }
  });

  window.addEventListener("resize", () => {
    renderTraceSurfaces();
  });

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "←", "0", "C"];
  keys.forEach((key) => {
    const btn = document.createElement("button");
    btn.className = "digit";
    btn.textContent = key;
    btn.addEventListener("click", () => onDigitKey(key));
    refs.digitPad.appendChild(btn);
  });
}

function renderAll() {
  renderSheetGrid();
  renderMessageMeta();
  renderReadBitmap();
  renderBlindInput();
  renderTraceSurfaces();
  updateTraceFeatureCopy();
}

function setTab(nextTab) {
  if (nextTab !== "sheet" && state.maskLocked) {
    setMaskLock(false);
  }

  state.tab = nextTab;
  document.querySelectorAll(".tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === nextTab);
  });
  document.querySelectorAll(".panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === `panel-${nextTab}`);
  });
}

function renderSheetGrid() {
  refs.sheetGrid.innerHTML = "";
  for (let row = 0; row < HOLE_GRID_HEIGHT; row += 1) {
    for (let col = 0; col < HOLE_GRID_WIDTH; col += 1) {
      const holeId = row * HOLE_GRID_WIDTH + col;
      const glyph = HOLE_ID_TO_GLYPH[holeId] || "";
      const cell = document.createElement("div");
      cell.className = `sheet-cell ${glyph ? "active" : ""}`;
      cell.textContent = glyph;
      refs.sheetGrid.appendChild(cell);
    }
  }
}

function renderMessageMeta() {
  const normalized = normalizeText(state.text).slice(0, MAX_LEN);
  const tokens = textToTokens(normalized);

  refs.normalizedText.textContent = `Normalized: ${normalized || "(empty)"}`;
  refs.tokenCount.textContent = `Token count: ${tokens.length}`;
}

function renderReadBitmap() {
  const normalized = normalizeText(state.text).slice(0, MAX_LEN);
  const tokens = textToTokens(normalized);
  const bitmap = buildGhostBitmap(tokens, state.noiseSeed);

  refs.readStage.innerHTML = "";
  const dx = state.offsetX + state.strobeTick;
  const dy = state.offsetY;
  refs.offsetText.textContent = `Offset: (${dx}, ${dy})`;

  for (let row = 0; row < HOLE_GRID_HEIGHT; row += 1) {
    for (let col = 0; col < HOLE_GRID_WIDTH; col += 1) {
      const srcRow = clamp(row - dy, 0, HOLE_GRID_HEIGHT - 1);
      const srcCol = clamp(col - dx, 0, HOLE_GRID_WIDTH - 1);
      const bit = bitmap[srcRow][srcCol];
      const cell = document.createElement("div");
      cell.className = `read-cell ${bit ? "light" : "dark"}`;
      refs.readStage.appendChild(cell);
    }
  }
}

function move(dx, dy) {
  state.offsetX += dx;
  state.offsetY += dy;
  renderReadBitmap();
}

function renderBlindInput() {
  refs.numberGrid.innerHTML = "";
  for (let row = 0; row < HOLE_GRID_HEIGHT; row += 1) {
    for (let col = 0; col < HOLE_GRID_WIDTH; col += 1) {
      const holeId = row * HOLE_GRID_WIDTH + col;
      const code = state.mapping.codeByHoleId[String(holeId)] || "..";
      const cell = document.createElement("div");
      const isActive = code !== "..";
      cell.className = `number-cell ${isActive ? "active" : ""}`;
      cell.textContent = code;
      refs.numberGrid.appendChild(cell);
    }
  }

  refs.pendingCode.textContent = `Pending: ${state.codeBuffer || "--"}`;
  refs.decodedText.textContent = `Decoded: ${state.decodedText || "(none)"}`;
}

function setTraceMode(nextMode) {
  if (!TRACE_MODE_LABELS[nextMode]) {
    return;
  }

  state.traceMode = nextMode;
  refs.traceModeButtons.forEach((button) => {
    const active = button.dataset.traceMode === nextMode;
    button.classList.toggle("active", active);
    button.classList.toggle("secondary", !active);
  });
  renderTraceSurfaces();
}

function renderTraceSurfaces() {
  refs.traceModeLabel.textContent = `Pattern: ${TRACE_MODE_LABELS[state.traceMode]}`;
  refs.traceLiveLabel.textContent = `${TRACE_MODE_LABELS[state.traceMode]} · ${getTraceModeCountLabel(state.traceMode)}`;
  refs.tracePreview.innerHTML = buildTraceSvg({
    mode: state.traceMode,
    live: false
  });
  refs.traceStage.innerHTML = buildTraceSvg({
    mode: state.traceMode,
    live: true
  });
}

function updateTraceFeatureCopy() {
  const features = [];
  features.push(document.fullscreenEnabled ? "fullscreen" : "no fullscreen");
  features.push(screen.orientation && screen.orientation.lock ? "orientation lock" : "orientation free");
  features.push("wakeLock" in navigator ? "wake lock" : "no wake lock");
  refs.traceFeatureStatus.textContent = `Features: ${features.join(" · ")}`;
}

async function enterTraceMode() {
  if (state.traceActive) {
    return;
  }

  if (state.maskLocked) {
    setMaskLock(false);
  }

  state.traceActive = true;
  traceScrollY = window.scrollY;
  document.body.style.top = `-${traceScrollY}px`;
  document.body.classList.add("trace-live");
  refs.traceOverlay.classList.add("active");
  refs.traceOverlay.setAttribute("aria-hidden", "false");
  refs.traceLiveStatus.textContent = "Requesting fullscreen...";
  renderTraceSurfaces();

  const statusBits = [];

  if (document.documentElement.requestFullscreen) {
    try {
      await document.documentElement.requestFullscreen({ navigationUI: "hide" });
      statusBits.push("fullscreen on");
    } catch {
      statusBits.push("fullscreen unavailable");
    }
  } else {
    statusBits.push("fullscreen unavailable");
  }

  if (screen.orientation && screen.orientation.lock) {
    try {
      await screen.orientation.lock("portrait");
      statusBits.push("portrait lock");
    } catch {
      statusBits.push("orientation free");
    }
  } else {
    statusBits.push("orientation free");
  }

  statusBits.push(await requestTraceWakeLock());
  refs.traceLiveStatus.textContent = statusBits.join(" · ");
}

async function exitTraceMode() {
  if (!state.traceActive) {
    return;
  }

  clearTraceExitTimer();
  state.traceActive = false;
  refs.traceOverlay.classList.remove("active");
  refs.traceOverlay.setAttribute("aria-hidden", "true");

  await releaseTraceWakeLock();

  if (document.fullscreenElement && document.exitFullscreen) {
    try {
      await document.exitFullscreen();
    } catch {
      // noop
    }
  }

  if (screen.orientation && screen.orientation.unlock) {
    try {
      screen.orientation.unlock();
    } catch {
      // noop
    }
  }

  document.body.classList.remove("trace-live");
  document.body.style.top = "";
  window.scrollTo(0, traceScrollY);
  refs.traceLiveStatus.textContent = "Best effort freeze";
}

async function requestTraceWakeLock() {
  if (!("wakeLock" in navigator)) {
    return "wake lock unavailable";
  }

  try {
    if (traceWakeLock) {
      await traceWakeLock.release();
    }
    traceWakeLock = await navigator.wakeLock.request("screen");
    traceWakeLock.addEventListener("release", () => {
      if (state.traceActive) {
        refs.traceLiveStatus.textContent = "wake lock released";
      }
    });
    return "wake lock on";
  } catch {
    return "wake lock unavailable";
  }
}

async function releaseTraceWakeLock() {
  if (!traceWakeLock) {
    return;
  }

  try {
    await traceWakeLock.release();
  } catch {
    // noop
  }
  traceWakeLock = null;
}

function buildTraceSvg({ mode, live }) {
  const marks = getTraceMarks(mode);
  const gridXStep =
    (TRACE_VIEWBOX.gridRight - TRACE_VIEWBOX.gridLeft) / (TRACE_VIEWBOX.cols - 1);
  const gridYStep =
    (TRACE_VIEWBOX.gridBottom - TRACE_VIEWBOX.gridTop) / (TRACE_VIEWBOX.rows - 1);
  const topBandWidth = 220;
  const topBandHeight = 26;
  const topBandX = (TRACE_VIEWBOX.width - topBandWidth) / 2;
  const topBandY = 18;
  const notchWidth = 28;
  const notchHeight = 18;
  const notchX = (TRACE_VIEWBOX.width - notchWidth) / 2;
  const anchorInsetX = 24;
  const anchorInsetTop = 34;
  const anchorInsetBottom = 28;
  const tickSize = 18;
  const tickInset = 24;

  const verticalLines = [];
  for (let col = 0; col < TRACE_VIEWBOX.cols; col += 1) {
    const x = TRACE_VIEWBOX.gridLeft + col * gridXStep;
    verticalLines.push(
      `<line class="trace-grid-line" x1="${x}" y1="${TRACE_VIEWBOX.gridTop}" x2="${x}" y2="${TRACE_VIEWBOX.gridBottom}" />`
    );
  }

  const horizontalLines = [];
  for (let row = 0; row < TRACE_VIEWBOX.rows; row += 1) {
    const y = TRACE_VIEWBOX.gridTop + row * gridYStep;
    horizontalLines.push(
      `<line class="trace-grid-line" x1="${TRACE_VIEWBOX.gridLeft}" y1="${y}" x2="${TRACE_VIEWBOX.gridRight}" y2="${y}" />`
    );
  }

  const markNodes = marks.map((mark) => {
    const x = TRACE_VIEWBOX.gridLeft + mark.col * gridXStep;
    const y = TRACE_VIEWBOX.gridTop + mark.row * gridYStep;
    return `<circle class="trace-mark ${live ? "live" : mark.share}" cx="${x}" cy="${y}" r="10.5" />`;
  });

  const footerLabel = live
    ? ""
    : `<text class="trace-mark-label" x="${TRACE_VIEWBOX.width / 2}" y="${TRACE_VIEWBOX.height - 26}" text-anchor="middle">${TRACE_MODE_LABELS[mode]} · ${getTraceModeCountLabel(mode)}</text>`;

  return `
    <div class="trace-surface">
      <svg class="trace-svg" viewBox="0 0 ${TRACE_VIEWBOX.width} ${TRACE_VIEWBOX.height}" aria-label="${TRACE_MODE_LABELS[mode]} tracing pattern">
        <rect class="trace-surface-bg" x="0" y="0" width="${TRACE_VIEWBOX.width}" height="${TRACE_VIEWBOX.height}" rx="22" />
        <rect class="trace-top-band" x="${topBandX}" y="${topBandY}" width="${topBandWidth}" height="${topBandHeight}" rx="${topBandHeight / 2}" />
        <text class="trace-top-band-label" x="${TRACE_VIEWBOX.width / 2}" y="${topBandY + 17}" text-anchor="middle">TRACE THIS TOP EDGE</text>
        ${verticalLines.join("")}
        ${horizontalLines.join("")}
        <rect class="trace-frame" x="${TRACE_VIEWBOX.frameX}" y="${TRACE_VIEWBOX.frameY}" width="${TRACE_VIEWBOX.frameWidth}" height="${TRACE_VIEWBOX.frameHeight}" rx="18" />
        <path class="trace-notch" d="M${notchX} ${TRACE_VIEWBOX.frameY} h${notchWidth} l-10 -${notchHeight} h-8 z" />
        ${buildTraceAnchor(TRACE_VIEWBOX.frameX + anchorInsetX, TRACE_VIEWBOX.frameY + anchorInsetTop)}
        ${buildTraceAnchor(TRACE_VIEWBOX.frameX + TRACE_VIEWBOX.frameWidth - anchorInsetX, TRACE_VIEWBOX.frameY + anchorInsetTop)}
        ${buildTraceAnchor(TRACE_VIEWBOX.frameX + anchorInsetX, TRACE_VIEWBOX.frameY + TRACE_VIEWBOX.frameHeight - anchorInsetBottom)}
        <rect class="trace-anchor-tick" x="${TRACE_VIEWBOX.frameX + TRACE_VIEWBOX.frameWidth - tickInset - tickSize}" y="${TRACE_VIEWBOX.frameY + TRACE_VIEWBOX.frameHeight - tickInset - tickSize}" width="${tickSize}" height="${tickSize}" rx="3" />
        ${markNodes.join("")}
        ${footerLabel}
      </svg>
    </div>
  `;
}

function buildTraceAnchor(x, y) {
  return `
    <circle class="trace-anchor-ring" cx="${x}" cy="${y}" r="19" />
    <circle class="trace-anchor-core" cx="${x}" cy="${y}" r="6" />
  `;
}

function getTraceMarks(mode) {
  if (mode === "share-a") {
    return state.tracePattern.shareA.map((mark) => ({ ...mark, share: "share-a" }));
  }
  if (mode === "share-b") {
    return state.tracePattern.shareB.map((mark) => ({ ...mark, share: "share-b" }));
  }
  if (mode === "combined") {
    return [
      ...state.tracePattern.shareA.map((mark) => ({ ...mark, share: "share-a" })),
      ...state.tracePattern.shareB.map((mark) => ({ ...mark, share: "share-b" }))
    ];
  }
  return [];
}

function getTraceModeCountLabel(mode) {
  if (mode === "public") {
    return "3 anchors";
  }
  if (mode === "combined") {
    return `${TRACE_MARKS_PER_SHARE * 2} marks`;
  }
  return `${TRACE_MARKS_PER_SHARE} marks`;
}

function createTracePattern() {
  const cells = TRACE_CANDIDATE_CELLS.map((cell) => ({ ...cell }));
  secureShuffle(cells);
  return {
    shareA: cells.slice(0, TRACE_MARKS_PER_SHARE),
    shareB: cells.slice(TRACE_MARKS_PER_SHARE, TRACE_MARKS_PER_SHARE * 2)
  };
}

function clearTraceExitTimer() {
  if (!traceExitTimer) {
    return;
  }
  clearTimeout(traceExitTimer);
  traceExitTimer = null;
}

function onDigitKey(key) {
  if (key === "←") {
    state.codeBuffer = state.codeBuffer.slice(0, -1);
    renderBlindInput();
    return;
  }

  if (key === "C") {
    state.codeBuffer = "";
    renderBlindInput();
    return;
  }

  if (state.codeBuffer.length >= 2) {
    return;
  }

  state.codeBuffer += key;

  if (state.codeBuffer.length === 2) {
    const holeId = resolveCodeToHoleId(state.mapping, state.codeBuffer);
    if (holeId !== null) {
      const glyph = HOLE_ID_TO_GLYPH[holeId];
      if (glyph) {
        state.decodedText = `${state.decodedText}${glyph}`.slice(0, MAX_LEN);
      }
    }

    state.codeBuffer = "";
    shuffleMapping();
  }

  renderBlindInput();
}

function shuffleMapping() {
  state.mapping = generateBlindInputMapping(ACTIVE_HOLE_IDS, state.mapping.generation);
}

function setMaskLock(locked) {
  if (locked === state.maskLocked) {
    return;
  }

  state.maskLocked = locked;

  if (locked) {
    if (state.tab !== "sheet") {
      setTab("sheet");
    }
    refs.messageInput.blur();
    lockedScrollY = window.scrollY;
    document.body.style.top = `-${lockedScrollY}px`;
    document.body.classList.add("mask-locked");
    refs.maskLockBtn.textContent = "Unlock Mask Mode";
    refs.maskLockStatus.textContent = "Screen lock: ON";
    refs.unlockFab.classList.add("show");
  } else {
    document.body.classList.remove("mask-locked");
    document.body.style.top = "";
    window.scrollTo(0, lockedScrollY);
    refs.maskLockBtn.textContent = "Lock Mask Mode";
    refs.maskLockStatus.textContent = "Screen lock: OFF";
    refs.unlockFab.classList.remove("show");
  }
}

function normalizeText(value) {
  return String(value)
    .toUpperCase()
    .split("")
    .map((glyph) => (GLYPH_TO_HOLE_ID[glyph] !== undefined ? glyph : " "))
    .join("");
}

function textToTokens(normalizedText) {
  const tokens = [];
  for (const glyph of normalizedText) {
    const holeId = GLYPH_TO_HOLE_ID[glyph];
    if (holeId !== undefined) {
      tokens.push(holeId);
    }
  }
  return tokens;
}

function buildGhostBitmap(tokens, noiseSeed) {
  const signal = new Set(tokens);
  const matrix = [];
  let seed = noiseSeed >>> 0;

  for (let row = 0; row < HOLE_GRID_HEIGHT; row += 1) {
    const rowData = [];
    for (let col = 0; col < HOLE_GRID_WIDTH; col += 1) {
      const holeId = row * HOLE_GRID_WIDTH + col;
      if (signal.has(holeId)) {
        rowData.push(1);
      } else {
        seed = xorshift(seed);
        rowData.push(seed % 2 === 0 ? 1 : 0);
      }
    }
    matrix.push(rowData);
  }

  return matrix;
}

function xorshift(value) {
  let x = value || 2463534242;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return x >>> 0;
}

function generateBlindInputMapping(activeHoleIds, previousGeneration = 0) {
  const codes = Array.from({ length: 100 }, (_, i) => String(i).padStart(2, "0"));
  secureShuffle(codes);

  const codeByHoleId = {};
  const holeIdByCode = {};

  for (let i = 0; i < activeHoleIds.length; i += 1) {
    const holeId = activeHoleIds[i];
    const code = codes[i];
    codeByHoleId[String(holeId)] = code;
    holeIdByCode[code] = holeId;
  }

  return {
    generation: previousGeneration + 1,
    createdAtMs: Date.now(),
    codeByHoleId,
    holeIdByCode
  };
}

function resolveCodeToHoleId(mapping, code) {
  if (!/^\d{2}$/.test(code)) {
    return null;
  }

  const hit = mapping.holeIdByCode[code];
  return Number.isInteger(hit) ? hit : null;
}

function secureShuffle(items) {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = randomIntInclusive(0, i);
    [items[i], items[j]] = [items[j], items[i]];
  }
}

function randomIntInclusive(min, max) {
  const range = max - min + 1;
  const maxUnbiased = Math.floor(0xffffffff / range) * range;

  while (true) {
    const value = randomUint32();
    if (value < maxUnbiased) {
      return min + (value % range);
    }
  }
}

function randomUint32() {
  const bytes = new Uint8Array(4);
  if (globalThis.crypto && globalThis.crypto.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return (
    ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0
  );
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function byId(id) {
  return document.getElementById(id);
}
