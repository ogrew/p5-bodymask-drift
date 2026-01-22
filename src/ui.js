// ============================================================
// UI / 実行制御
// ============================================================

/**
 * Tweakpaneを初期化（paneRun / paneParams の2ペイン）
 */
function initTweakpane() {
  const PaneCtor =
    window.Pane ?? window.Tweakpane?.Pane ?? window.tweakpane?.Pane;

  if (!PaneCtor) {
    console.warn("Tweakpane Pane が見つかりません（読み込み方法を確認）");
    return;
  }

  const containers = ensurePaneContainers();

  try {
    paneRun?.dispose?.();
  } catch (_) {}
  try {
    paneParams?.dispose?.();
  } catch (_) {}

  paneRun = new PaneCtor({ title: "Run", container: containers.run });
  paneParams = new PaneCtor({ title: "Params", container: containers.params });

  // --- Run: 状態表示
  paneRun.addBinding(RUN_UI, "status", { label: "STATUS", readonly: true });
  paneRun.addBinding(RUN_UI, "detail", { label: "DETAIL", readonly: true });
  paneRun.addBinding(RUN_UI, "progress", { label: "PROGRESS", readonly: true });

  // --- Run: ボタン
  btnPlay = paneRun.addButton({ title: "PLAY" });
  btnStop = paneRun.addButton({ title: "STOP" });

  btnPlay.on("click", () => onPlay());
  btnStop.on("click", () => onStop());

  btnStop.disabled = true;

  // --- Params
  paneParams.addBinding(PARAMS, "imgPath", {
    label: "IMAGE",
    options: IMAGE_OPTIONS,
  });

  paneParams.addBinding(PARAMS, "cellSize", {
    label: "CELL_SIZE",
    min: 1,
    max: 50,
    step: 1,
  });

  paneParams.addBinding(PARAMS, "moveFrames", {
    label: "MOVE_FRAMES",
    step: 1,
  });

  paneParams.addBinding(PARAMS, "maxSpeed", {
    label: "MAX_SPEED",
    min: 1.0,
    max: 10.0,
    step: 0.1,
  });

  paneParams.addBinding(PARAMS, "snapToGrid", { label: "SNAP_TO_GRID" });
  paneParams.addBinding(PARAMS, "applyToPerson", { label: "APPLY_TO_PERSON" });

  paneParams.addBinding(PARAMS, "flowFreq", {
    label: "FLOW_FREQ",
    min: 0.001,
    max: 0.1,
    step: 0.001,
  });

  paneParams.addBinding(PARAMS, "flowTwist", {
    label: "FLOW_TWIST",
    min: 0.1,
    max: 10.0,
    step: 0.1,
  });

  paneParams.addBinding(PARAMS, "flowZSpeed", {
    label: "FLOW_Z_SPEED",
    min: 0.001,
    max: 1.0,
    step: 0.001,
  });

  paneParams.addBinding(PARAMS, "force", {
    label: "FORCE",
    min: 0.01,
    max: 5.0,
    step: 0.01,
  });

  paneParams.addBinding(PARAMS, "tileAlpha", {
    label: "TILE_ALPHA",
    min: 0.0,
    max: 1.0,
    step: 0.01,
  });

  paneParams.addBinding(PARAMS, "noiseSeed", {
    label: "NOISE_SEED",
    step: 1,
  });

  paneParams.addBinding(PARAMS, "wrapEdges", {
    label: "WRAP_EDGES",
  });  

  setParamsLocked(false);

  paneRun.refresh();
  paneParams.refresh();
}

/**
 * パラメータペインをロック/解除
 */
function setParamsLocked(locked) {
  // Paramsペインは実行中ロック
  if (paneParams) paneParams.disabled = locked;

  // Play/Stopの有効・無効を確実に反映
  const canPlay = !locked && !!modelReady && !!bodySeg;
  if (btnPlay) btnPlay.disabled = !canPlay;
  if (btnStop) btnStop.disabled = !locked;

  // 重要：disabled状態がUIに反映されないケースがあるので refresh を強制
  try {
    paneRun?.refresh?.();
  } catch (_) {}
  try {
    paneParams?.refresh?.();
  } catch (_) {}
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

  // スナップショット作成
  const cfg = snapshotParams(PARAMS);

  randomSeed(cfg.noiseSeed);
  noiseSeed(cfg.noiseSeed);

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

  setStatus("LOADING_IMAGE", cfg.imgPath, "");
  refreshRunPane();
  loop();

  // 選択画像をロード
  loadImageAsync(cfg.imgPath)
    .then((loaded) => {
      if (!isRunAlive(run, runToken)) return;

      // 画像に合わせて canvas / offscreen を作り直す
      img = loaded;
      setupCanvasesForImage(img);

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
  const cellSize = clampInt(Math.floor(Number(p.cellSize)), 1, 50);
  const moveFrames = Math.max(1, Math.floor(Number(p.moveFrames) || 1));
  const maxSpeed = Number(p.maxSpeed);

  const flowFreq = Number(p.flowFreq);
  const flowTwist = Number(p.flowTwist);
  const flowZSpeed = Number(p.flowZSpeed);
  const force = Number(p.force);

  const tileAlpha = Number(p.tileAlpha);
  const noiseSeed = clampInt(Math.floor(Number(p.noiseSeed) || 1), 1, 100000);

  return {
    imgPath: String(p.imgPath),
    cellSize,
    moveFrames,
    maxSpeed: Number.isFinite(maxSpeed) ? maxSpeed : 2.8,
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
  if (paneRun) paneRun.refresh();
}

/**
 * ステータス更新
 */
function setStatus(status, detail, progress) {
  RUN_UI.status = status;
  RUN_UI.detail = detail ?? "";
  RUN_UI.progress = progress ?? "";
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

function ensurePaneContainers() {
  const parentId = "tp-stack";
  let parent = document.getElementById(parentId);
  if (!parent) {
    parent = document.createElement("div");
    parent.id = parentId;
    document.body.appendChild(parent);
  }

  // 右上固定＆縦積み
  parent.style.position = "fixed";
  parent.style.top = "10px";
  parent.style.right = "10px";
  parent.style.zIndex = "99999";
  parent.style.display = "flex";
  parent.style.flexDirection = "column";
  parent.style.gap = "10px"; // RunとParamsの間隔
  parent.style.alignItems = "flex-end";
  parent.style.pointerEvents = "auto";

  // 子コンテナ（Run / Params）を親の下にぶら下げる
  const makeChild = (id) => {
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement("div");
      el.id = id;
    }
    // もし別の場所に居てもここに移動
    parent.appendChild(el);

    // 幅は好みで（Tweakpaneは中身に合わせて伸びるけど、ここで固定すると安定）
    el.style.width = "360px";

    // 再初期化時に中身が残らないように
    el.innerHTML = "";
    return el;
  };

  return {
    run: makeChild("tp-run"),
    params: makeChild("tp-params"),
  };
}