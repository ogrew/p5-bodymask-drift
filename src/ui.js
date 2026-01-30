// ============================================================
// UI / 実行制御
// ============================================================

let layoutReady = false;
let externalUiLocked = false;
let uploadInputBound = false;
let sampleManifest = [];
let didSelectInitialSample = false;

function setEmptyVisible(isVisible) {
  const emptyState = document.getElementById("empty-state");
  if (!emptyState) return;
  emptyState.classList.toggle("is-visible", !!isVisible);
}

function syncEmptyState() {
  setEmptyVisible(!baseImgOriginal);
}

/**
 * Tweakpaneを初期化（Paramsペインのみ）
 */
function initTweakpane() {
  const PaneCtor =
    window.Pane ?? window.Tweakpane?.Pane ?? window.tweakpane?.Pane;

  if (!PaneCtor) {
    console.warn("Tweakpane Pane が見つかりません（読み込み方法を確認）");
    return;
  }

  initLayoutUI();

  const container = ensurePaneContainer();

  try {
    paneParams?.dispose?.();
  } catch (_) {}

  paneParams = new PaneCtor({ title: "Params", container, expanded: false });

  const tiles = paneParams.addFolder({ title: "Tiles", expanded: true });
  tiles.addBinding(PARAMS, "cellSize", {
    label: "Cell Size (px)",
    min: 1,
    max: 24,
    step: 1,
  });

  const bTileShape = tiles.addBlade({
    view: "list",
    label: "Tile Shape",
    options: [
      { text: "Rectangle", value: "rect" },
      { text: "Circle", value: "circle" },
    ],
    value: PARAMS.tileShape,
  });
  bTileShape.on("change", (ev) => {
    PARAMS.tileShape = ev.value;
  });

  tiles.addBinding(PARAMS, "tileAlpha", {
    label: "Tile Opacity",
    min: 0.0,
    max: 1.0,
    step: 0.01,
  });

  const motion = paneParams.addFolder({ title: "Motion", expanded: false });
  motion.addBinding(PARAMS, "moveFrames", {
    label: "Frames (steps)",
    step: 1,
  });
  motion.addBinding(PARAMS, "maxSpeed", {
    label: "Max Speed",
    min: 0.1,
    max: 5.0,
    step: 0.1,
  });

  const flow = paneParams.addFolder({ title: "Flow Field", expanded: false });
  flow.addBinding(PARAMS, "flowFreq", {
    label: "Frequency",
    min: 0.001,
    max: 0.2,
    step: 0.001,
  });
  flow.addBinding(PARAMS, "flowTwist", {
    label: "Twist",
    min: 0.1,
    max: 10.0,
    step: 0.1,
  });
  flow.addBinding(PARAMS, "flowZSpeed", {
    label: "Z Speed",
    min: 0.001,
    max: 1.0,
    step: 0.001,
  });

  const behavior = paneParams.addFolder({ title: "Behavior", expanded: false });
  behavior.addBinding(PARAMS, "force", {
    label: "Force Strength",
    min: 0.01,
    max: 5.0,
    step: 0.01,
  });
  behavior.addBinding(PARAMS, "snapToGrid", { label: "Snap to Grid" });
  behavior.addBinding(PARAMS, "wrapEdges", { label: "Wrap Edges" });
  behavior.addBinding(PARAMS, "applyToPerson", { label: "Apply to Person" });

  const randomness = paneParams.addFolder({ title: "Randomness", expanded: false });
  randomness.addBinding(PARAMS, "noiseSeed", {
    label: "Noise Seed",
    step: 1,
  });

  const resetButton = paneParams.addButton({ title: "RESET PARAMS" });
  resetButton.on("click", () => resetParamsToDefaults());

  const saveButton = paneParams.addButton({ title: "SAVE PNG" });
  saveButton.on("click", () => saveCurrentCanvas());

  syncImageSourceUI();
  updateUploadLabel();

  setParamsLocked(false);

  paneParams.refresh();
}

/**
 * パラメータペインをロック/解除
 */
function setParamsLocked(locked) {
  // Paramsペインは実行中ロック
  if (paneParams) paneParams.disabled = locked;
  setExternalControlsLocked(locked);

  // Play/Stopの有効・無効を確実に反映
  const canPlay = !locked && !!modelReady && !!bodySeg;
  if (btnPlay) btnPlay.disabled = !canPlay;
  if (btnStop) btnStop.disabled = !locked;

  try { paneParams?.refresh?.(); } catch (_) {}
}

/**
 * PLAY：スナップショット→画像ロード→推論→粒子生成→描画開始
 */
function onPlay() {
  if (!modelReady || !bodySeg) {
    setStatus("LOADING_MODEL", "model not ready", "");
    refreshRunPane();
    redraw();
    return;
  }

  // 走っていたら強制終了してからやり直す（連打で壊れない）
  if (run) {
    onStop();
  }

  // スナップショット作成（PLAY中にパラメータは変えない前提）
  const cfg = snapshotParams(PARAMS);

  // 乱数＆ノイズを固定（再現性）
  randomSeed(cfg.noiseSeed);
  noiseSeed(cfg.noiseSeed);

  // どの画像を使うか確定
  let imageUrl = cfg.imgPath;
  if (cfg.imgSource === "upload") {
    imageUrl = getUploadedUrl();
    if (!imageUrl) {
      setRunError("upload jpeg not selected");
      return;
    }
  }

  // 実行状態を作る
  runToken += 1;
  run = {
    token: runToken,
    canceled: false,
    phase: "LOADING_IMAGE",
    cfg,

    // segmentation
    maskImg: null,
    maskInfo: null,

    // particles
    particles: [],
    build: null,
    zoff: 0,
    renderFrame: 0,

    // detectStop を呼ぶためのフラグ
    detecting: false,
  };

  // UIロック（実行中は変更不可）
  setParamsLocked(true);

  // 表示をリセット（“p5 editorの▶︎”っぽく）
  trailG.clear();

  setStatus("LOADING_IMAGE", imageUrl, "");
  refreshRunPane();
  loop();

  // 選択画像をロード
  loadImageAsync(imageUrl)
    .then((loaded) => {
      if (!isRunAlive(run, runToken)) return;

      // 画像に合わせて canvas / offscreen を作り直す
      img = setupCanvasesForImage(loaded);
      syncEmptyState();

      // 推論開始
      setStatus("SEGMENTING", "running segmentation...", "");
      refreshRunPane();

      run.phase = "SEGMENTING";
      run.detecting = true;

      runSegmentationOnceWithRetry(run, 0);
    })
    .catch((e) => {
      if (!isRunAlive(run, runToken)) return;
      setRunError(e?.message ?? String(e));
    });
}

/**
 * STOP：一時停止ではなくキャンセル終了（IDLEに戻す）
 */
function onStop() {
  if (!run) {
    setStatus(
      modelReady ? "IDLE" : "LOADING_MODEL",
      modelReady ? "model ready" : "ml5 model loading...",
      ""
    );
    refreshRunPane();
    redraw();
    return;
  }

  // detect中なら止める（可能なら）
  try {
    if (run.detecting && bodySeg && typeof bodySeg.detectStop === "function") {
      bodySeg.detectStop();
    }
  } catch (_) {}

  run.canceled = true;
}

/**
 * PARAMSの値を正規化してスナップショット化
 */
function snapshotParams(p) {
  const cellSize = clampInt(Math.floor(Number(p.cellSize)), 1, 24);
  const moveFrames = Math.max(1, Math.floor(Number(p.moveFrames) || 1));
  const maxSpeed = Number(p.maxSpeed);

  const flowFreq = Number(p.flowFreq);
  const flowTwist = Number(p.flowTwist);
  const flowZSpeed = Number(p.flowZSpeed);
  const force = Number(p.force);

  const tileAlpha = Number(p.tileAlpha);
  const noiseSeed = clampInt(Math.floor(Number(p.noiseSeed) || 1), 1, 100000);

  return {
    imgSource: String(p.imgSource === "upload" ? "upload" : "sample"),
    imgPath: String(p.imgPath),
    cellSize,
    tileShape: String(p.tileShape === "circle" ? "circle" : "rect"),
    moveFrames,
    maxSpeed: Number.isFinite(maxSpeed) ? maxSpeed : 1.6,
    snapToGrid: !!p.snapToGrid,
    applyToPerson: !!p.applyToPerson,

    flowFreq: clampNumber(Number.isFinite(flowFreq) ? flowFreq : 0.08, 0.001, 0.1),
    flowTwist: clampNumber(Number.isFinite(flowTwist) ? flowTwist : 2.0, 0.1, 10.0),
    flowZSpeed: clampNumber(Number.isFinite(flowZSpeed) ? flowZSpeed : 0.1, 0.001, 1.0),
    force: clampNumber(Number.isFinite(force) ? force : 0.2, 0.01, 5.0),

    tileAlpha: clampNumber(Number.isFinite(tileAlpha) ? tileAlpha : 1.0, 0.0, 1.0),
    noiseSeed: noiseSeed,
    wrapEdges: !!p.wrapEdges,
  };
}

/**
 * runToken と canceled で「古い非同期結果」を弾く
 */
function isRunAlive(r, token) {
  return !!r && r.token === token && !r.canceled;
}

/**
 * キャンセル時の後始末（IDLEへ）
 */
function finalizeToIdle(reason) {
  run = null;
  setParamsLocked(false);
  setStatus("IDLE", reason ?? "", "");
  refreshRunPane();
  noLoop();
  redraw();
}

/**
 * Runペインの表示更新
 */
function refreshRunPane() {
  updateStatusDom();
}

/**
 * ステータス更新
 */
function setStatus(status, detail, progress) {
  RUN_UI.status = status;
  RUN_UI.detail = detail ?? "";
  RUN_UI.progress = progress ?? "";
  updateStatusDom();
}

/**
 * エラー終了（UIアンロック、ループ停止）
 */
function setRunError(message) {
  setStatus("ERROR", message, "");
  refreshRunPane();
  setParamsLocked(false);
  run = null;
  noLoop();
  redraw();
}

function resetParamsToDefaults() {
  Object.keys(PARAM_DEFAULTS).forEach((key) => {
    PARAMS[key] = PARAM_DEFAULTS[key];
  });
  syncImageSourceUI();
  updateUploadLabel();
  const sampleSelect = document.getElementById("sampleSelect");
  if (sampleSelect) {
    syncSampleSelectValue(sampleSelect, sampleManifest);
  }
  paneParams?.refresh?.();
}

function saveCurrentCanvas() {
  const unixTime = Math.floor(Date.now() / 1000);
  const base = getCurrentImageBaseName();
  const filename = `${base}-DM-${unixTime}`;
  saveCanvas(filename, "png");
}

function getCurrentImageBaseName() {
  if (PARAMS.imgSource === "upload" && UPLOAD_STATE?.name) {
    return stripExtension(UPLOAD_STATE.name);
  }
  if (PARAMS.imgPath) {
    const parts = PARAMS.imgPath.split("/");
    const name = parts[parts.length - 1] || PARAMS.imgPath;
    return stripExtension(name);
  }
  return "DriftMask";
}

function stripExtension(name) {
  const dotIndex = name.lastIndexOf(".");
  if (dotIndex > 0) {
    return name.slice(0, dotIndex);
  }
  return name;
}

async function fetchSampleManifest() {
  try {
    const response = await fetch(SAMPLE_MANIFEST_URL, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Manifest not found: ${response.status}`);
    }
    const data = await response.json();
    return Array.isArray(data.samples) ? data.samples : [];
  } catch (error) {
    console.warn("Failed to load sample manifest", error);
    return [];
  }
}

async function reloadSampleManifest() {
  const samples = await fetchSampleManifest();
  applySampleManifest(samples);
}

function applySampleManifest(samples) {
  sampleManifest = samples.filter((sample) => sample?.file);
  const sampleSelect = document.getElementById("sampleSelect");
  const refreshSamples = document.getElementById("refreshSamples");

  if (!sampleSelect) return;

  if (!sampleManifest.length) {
    sampleSelect.innerHTML = "";
    const option = document.createElement("option");
    option.textContent = "No samples found";
    sampleSelect.appendChild(option);
    sampleSelect.disabled = true;
    if (refreshSamples) refreshSamples.disabled = false;
    updateImageControlsUI();
    return;
  }

  if (!didSelectInitialSample && PARAMS.imgSource === "sample") {
    const pick = sampleManifest[Math.floor(Math.random() * sampleManifest.length)];
    if (pick?.file) {
      PARAMS.imgPath = pick.file;
    }
    didSelectInitialSample = true;
  }

  sampleSelect.disabled = false;
  populateSampleSelect(sampleSelect, sampleManifest);

  const exists = sampleManifest.some(
    (sample) => sample.file === PARAMS.imgPath
  );
  if (!exists) {
    PARAMS.imgPath = sampleManifest[0].file;
  }

  syncSampleSelectValue(sampleSelect, sampleManifest);
  paneParams?.refresh?.();
  updateImageControlsUI();

  if (PARAMS.imgSource === "sample" && PARAMS.imgPath) {
    loadImageAsync(PARAMS.imgPath)
      .then((loaded) => {
        img = setupCanvasesForImage(loaded);
        syncEmptyState();
        redraw();
      })
      .catch(() => {});
  }
}

function initLayoutUI() {
  if (layoutReady) return;
  const ui = document.getElementById("ui");
  if (!ui) return;
  layoutReady = true;

  const toggleButton = document.getElementById("togglePanel");
  if (toggleButton) {
    const updateToggle = (isCollapsed) => {
      toggleButton.textContent = isCollapsed ? "Show Panel" : "Hide Panel";
    };
    updateToggle(ui.classList.contains("is-collapsed"));
    toggleButton.addEventListener("click", () => {
      const isCollapsed = ui.classList.toggle("is-collapsed");
      updateToggle(isCollapsed);
    });
  }

  document.addEventListener("keydown", (event) => {
    const tag = document.activeElement?.tagName?.toLowerCase();
    if (tag === "input" || tag === "textarea" || document.activeElement?.isContentEditable) {
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key !== "p" && key !== "s") return;
    event.preventDefault();
    if (key === "p") {
      const isCollapsed = ui.classList.toggle("is-collapsed");
      if (toggleButton) {
        toggleButton.textContent = isCollapsed ? "Show Panel" : "Hide Panel";
      }
    }
    if (key === "s") {
      saveCurrentCanvas();
    }
  });

  btnPlay = document.getElementById("playButton");
  btnStop = document.getElementById("stopButton");
  if (btnPlay) btnPlay.addEventListener("click", () => onPlay());
  if (btnStop) btnStop.addEventListener("click", () => onStop());

  const sampleSelect = document.getElementById("sampleSelect");
  const refreshSamples = document.getElementById("refreshSamples");
  if (sampleSelect) {
    sampleSelect.addEventListener("change", () => {
      const selected = sampleSelect.value;
      if (selected) {
        PARAMS.imgPath = selected;
      }
      PARAMS.imgSource = "sample";
      syncImageSourceUI();
      paneParams?.refresh?.();
    });
  }
  if (refreshSamples) {
    refreshSamples.addEventListener("click", () => {
      if (!sampleSelect) return;
      reloadSampleManifest();
    });
  }

  const fileInput = ensureUploadInput();
  const dropZone = document.getElementById("dropZone");
  if (dropZone) {
    const setDrag = (active) => {
      dropZone.classList.toggle("is-dragover", active);
    };

    dropZone.addEventListener("dragover", (event) => {
      event.preventDefault();
      setDrag(true);
    });

    dropZone.addEventListener("dragleave", () => setDrag(false));
    dropZone.addEventListener("drop", (event) => {
      event.preventDefault();
      setDrag(false);
      const file = event.dataTransfer?.files?.[0];
      if (file) {
        handleUploadFile(file, fileInput);
      }
    });

    dropZone.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        fileInput?.click();
      }
    });
  }

  reloadSampleManifest();
  updateImageControlsUI();
  updateUploadLabel();
  updateStatusDom();
  syncEmptyState();
}

function updateStatusDom() {
  const statusEl = document.getElementById("statusValue");
  const detailEl = document.getElementById("detailValue");
  const progressEl = document.getElementById("progressValue");
  if (!statusEl || !detailEl || !progressEl) return;

  statusEl.textContent = RUN_UI.status || "";
  detailEl.textContent = RUN_UI.detail || "";
  progressEl.textContent = RUN_UI.progress || "";

  statusEl.classList.remove("is-success", "is-error");
  if (RUN_UI.status === "ERROR") {
    statusEl.classList.add("is-error");
    return;
  }
  if (RUN_UI.status === "DONE" || RUN_UI.status === "IDLE") {
    statusEl.classList.add("is-success");
  }
}

function setExternalControlsLocked(locked) {
  externalUiLocked = locked;
  updateImageControlsUI();
}

function updateImageControlsUI() {
  const sampleSelect = document.getElementById("sampleSelect");
  const refreshSamples = document.getElementById("refreshSamples");
  const dropZone = document.getElementById("dropZone");
  const fileInput = document.getElementById("fileInput");

  const disabled = externalUiLocked;
  const noSamples = sampleManifest.length === 0;

  if (sampleSelect) sampleSelect.disabled = disabled || noSamples;
  if (refreshSamples) refreshSamples.disabled = disabled;
  if (fileInput) fileInput.disabled = disabled;
  if (dropZone) {
    dropZone.classList.toggle("is-disabled", disabled);
  }
}

function populateSampleSelect(selectEl, samples = sampleManifest) {
  selectEl.innerHTML = "";
  samples.forEach((sample) => {
    if (!sample?.file) return;
    const option = document.createElement("option");
    option.value = sample.file;
    option.textContent = sample.label || getSampleLabelFromPath(sample.file);
    selectEl.appendChild(option);
  });
}

function syncSampleSelectValue(selectEl, samples = sampleManifest) {
  if (!PARAMS.imgPath) return;
  const match = samples.find((sample) => sample.file === PARAMS.imgPath);
  if (match) {
    selectEl.value = match.file;
  }
}

function getSampleLabelFromPath(path) {
  if (!path) return "";
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}

function updateUploadLabel(message) {
  const label = message ?? getUploadedLabel();
  const textEl = document.querySelector("#dropZone .drop-zone-text");
  if (textEl) {
    const text =
      label && label !== "(none)" ? label : "Drop file or click to browse";
    textEl.textContent = text;
  }
}

function handleUploadFile(file, inputEl) {
  const r = setUploadedFile(file);
  if (!r.ok) {
    try {
      if (inputEl) inputEl.value = "";
    } catch (_) {}
    UPLOAD_UI.file = `ERROR: ${r.message}`;
    updateUploadLabel(UPLOAD_UI.file);
    paneParams?.refresh?.();
    return;
  }

  UPLOAD_UI.file = getUploadedLabel();
  PARAMS.imgSource = "upload";
  updateUploadLabel(UPLOAD_UI.file);
  syncImageSourceUI();
  paneParams?.refresh?.();
}

function ensurePaneContainer() {
  const parentId = "pane";
  let parent = document.getElementById(parentId);
  if (!parent) {
    parent = document.createElement("div");
    parent.id = parentId;
    document.body.appendChild(parent);
  }

  parent.innerHTML = "";

  const el = document.createElement("div");
  el.id = "tp-params";
  el.style.width = "100%";
  parent.appendChild(el);
  return el;
}

let uploadInputEl = null;

function ensureUploadInput() {
  if (uploadInputEl) return uploadInputEl;

  const existing = document.getElementById("fileInput");
  const el = existing ?? document.createElement("input");
  if (!existing) {
    el.type = "file";
    el.accept = ".jpg,.jpeg,.png,image/jpeg,image/png";
    el.style.display = "none";
    document.body.appendChild(el);
  }

  if (!uploadInputBound) {
    el.addEventListener("change", () => {
      const file = el.files && el.files[0] ? el.files[0] : null;
      if (!file) return;
      handleUploadFile(file, el);
    });
    uploadInputBound = true;
  }

  uploadInputEl = el;
  return uploadInputEl;
}

/**
 * IMG_SOURCE に応じて SAMPLE/UPLOAD のUIを相互排他で有効/無効にする
 * - SAMPLE: SAMPLE_IMAGE 有効 / UPLOAD_IMAGE と CHOOSE_JPEG 無効
 * - UPLOAD: UPLOAD_IMAGE と CHOOSE_JPEG 有効 / SAMPLE_IMAGE 無効
 */
function syncImageSourceUI() {
  updateImageControlsUI();

  // 念のため反映
  try {
    paneParams?.refresh?.();
  } catch (_) {}
}
