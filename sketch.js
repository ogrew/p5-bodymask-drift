// ============================================================
// Tweakpane + ml5 BodySegmentation + CellParticle（最新版）
// - PLAYでスナップショット → 推論 → 粒子生成 → アニメ
// - 実行中は paneParams.disabled = true でロック
// - STOP は「一時停止」ではなく「キャンセル終了」
// - モデル初期化は callback に依存せず Promise/await で待つ
// ============================================================

// ============================================================
// 固定設定（表現コア）
// ============================================================

// Flow Field
const FLOW_FREQ = 0.08; // ノイズ周波数
const FLOW_TWIST = 2.0; // 回転量倍率
const FLOW_Z_SPEED = 0.01; // 時間方向

// 粒子（セル）の移動
// const FORCE = 0.35;
const FORCE = 0.035;

// 描画
const DRAW_BASE_IMAGE = true;

// ml5
const MODEL = "SelfieSegmentation";
const OPTIONS = { maskType: "person" };

// セグメンテーションのリトライ回数 / タイムアウト
const SEG_RETRY_MAX = 3;
const SEG_TIMEOUT_MS = 20000;

// モデルロードのタイムアウト（沈黙回避）
const MODEL_TIMEOUT_MS = 30000;

// 重い処理をフレーム分割するためのバジェット
const BUILD_CELLS_PER_FRAME = 4000; // 粒子生成（グリッド走査）を1フレームで何セル処理するか

// ============================================================
// UI パラメータ（paneParamsで編集）
// ※変更は即反映しない：PLAYでスナップショットを作る
// ============================================================

const IMAGE_OPTIONS = {
  "t0.jpg": "assets/t0.jpg",
  "t1.jpg": "assets/t1.jpg",
  "t2.jpg": "assets/t2.jpg",
  "t3.jpg": "assets/t3.jpg",
  "t4.jpg": "assets/t4.jpg",
  "t5.jpg": "assets/t5.jpg",
};

const PARAMS = {
  imgPath: IMAGE_OPTIONS["t1.jpg"],

  cellSize: 10,
  moveFrames: 180,
  maxSpeed: 2.8,
  snapToGrid: true,
  applyToPerson: true,

  flowFreq: 0.08,
  flowTwist: 2.0,
  flowZSpeed: 0.1,
  force: 0.2,

  // 追加：セルの最終的な透過（0.0〜1.0）
  tileAlpha: 1.0,
};


// Runペインの表示用（readonly）
const RUN_UI = {
  status: "LOADING_MODEL",
  detail: "",
  progress: "",
};

// ============================================================
// グローバル（p5 / ml5 実体）
// ============================================================

let img; // 現在表示しているベース画像
let srcG; // セグメンテーション入力用（CanvasImageSource）
let trailG; // 軌跡レイヤー

let bodySeg = null; // ml5 model
let modelReady = false; // モデル準備完了フラグ

let paneRun = null;
let paneParams = null;
let btnPlay = null;
let btnStop = null;

// 実行状態（PLAYごとに作り直す）
let run = null;
let runToken = 0;

// ============================================================
// p5 lifecycle
// ============================================================

function preload() {
  // 初期表示用にデフォルト画像だけ読み込む（選択変更はPLAY時にロード）
  img = loadImage(PARAMS.imgPath);
}

function setup() {
  pixelDensity(1);
  createCanvas(img.width, img.height);
  rectMode(CENTER);
  noStroke();

  // 推論入力は CanvasImageSource に寄せる
  srcG = createGraphics(img.width, img.height);
  srcG.pixelDensity(1);
  srcG.image(img, 0, 0);

  // 軌跡レイヤー
  trailG = createGraphics(width, height);
  trailG.pixelDensity(1);
  trailG.rectMode(CENTER);
  trailG.noStroke();
  trailG.clear();

  // UI構築
  initTweakpane();

  // モデルロード開始（非同期）
  setStatus("LOADING_MODEL", "ml5 model loading...", "");
  refreshRunPane();

  initBodySegModel()
    .then((model) => {
      bodySeg = model;
      modelReady = true;
      setStatus("IDLE", "model ready", "");
      refreshRunPane();
      setParamsLocked(false);
      redraw(); // 状態表示更新
    })
    .catch((e) => {
      modelReady = false;
      setStatus("ERROR", "model load failed", String(e?.message ?? e));
      refreshRunPane();
      setParamsLocked(false);
      redraw();
      console.error(e);
    });

  // 通常は止めておく（PLAYで loop()）
  noLoop();
  redraw();
}

function draw() {
  if (DRAW_BASE_IMAGE) {
    image(img, 0, 0);
  } else {
    background(0);
  }

  image(trailG, 0, 0);

  if (!run) {
    drawStatusOverlay();
    return;
  }

  if (run.canceled) {
    finalizeToIdle("canceled");
    return;
  }

  if (run.phase === "SEGMENTING") {
    drawStatusOverlay();
    return;
  }

  if (run.phase === "BUILDING_LAYER") {
    const done = buildGridParticlesChunk(BUILD_CELLS_PER_FRAME);

    if (run.build) {
      const pct = Math.floor((run.build.done / run.build.total) * 100);
      RUN_UI.progress = `building ${pct}% (${run.build.done}/${run.build.total})`;
      if (frameCount % 6 === 0) refreshRunPane();
    }

    if (done) {
      run.phase = "RENDERING";
      run.zoff = 0;
      run.renderFrame = 0;
      setStatus("RENDERING", `particles=${run.particles.length}`, `rendering 0/${run.cfg.moveFrames}`);
      refreshRunPane();
    }

    drawStatusOverlay();
    return;
  }

  if (run.phase === "RENDERING") {
    // ★ここだけ：UIで変えた flowZSpeed を使う
    run.zoff += run.cfg.flowZSpeed;

    for (let i = 0; i < run.particles.length; i++) {
      run.particles[i].step(run.zoff);
      run.particles[i].paint(trailG);
    }

    run.renderFrame += 1;
    RUN_UI.progress = `rendering ${run.renderFrame}/${run.cfg.moveFrames}`;
    if (frameCount % 6 === 0) refreshRunPane();

    if (run.renderFrame >= run.cfg.moveFrames) {
      run.phase = "DONE";
      setStatus("DONE", "", "");
      refreshRunPane();
      setParamsLocked(false);
      run = null;
      noLoop();
      redraw();
    }

    drawStatusOverlay();
    return;
  }

  drawStatusOverlay();
}


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

  // --- 追加：Flow/Move（実行中はロックされる）
  paneParams.addBinding(PARAMS, "flowFreq", {
    label: "FLOW_FREQ",
    min: 0.001,
    max: 0.1,
    step: 0.001,
  });

  paneParams.addBinding(PARAMS, "flowTwist", {
    label: "FLOW_TWIST",
    min: 0.1, // ※指定が逆だったので修正
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

  setParamsLocked(false);

  paneRun.refresh();
  paneParams.refresh();
}

/**
 * パラメータペインをロック/解除（paneParams.disabled を使う）:contentReference[oaicite:1]{index=1}
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

  // スナップショット作成（ここが“即反映なし”の核）
  const cfg = snapshotParams(PARAMS);

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

  // 選択画像をロード（変更はここで初めて反映）
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

    // 追加：0..1 にクランプ
    tileAlpha: clampNumber(Number.isFinite(tileAlpha) ? tileAlpha : 1.0, 0.0, 1.0),
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
  // 右上に縦積みでPaneを配置するための親コンテナ
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

// ============================================================
// ml5: model init（callback依存をやめる）
// ============================================================

/**
 * BodySegmentationモデルを初期化して返す（Promise/同期どちらでも対応）
 * - callback方式に頼らない（ここが LOADING_MODEL 固定の根治）
 */
async function initBodySegModel() {
  if (typeof ml5 === "undefined") {
    throw new Error("ml5 is undefined (ml5 script not loaded)");
  }

  // タイムアウト（沈黙回避）
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("model load timeout")), MODEL_TIMEOUT_MS)
  );

  // ml5.bodySegmentation が Promise を返す場合も、同期で返す場合も吸収
  const task = (async () => {
    const maybe = ml5.bodySegmentation(MODEL, OPTIONS);
    if (maybe && typeof maybe.then === "function") {
      return await maybe;
    }
    return maybe;
  })();

  return await Promise.race([task, timeout]);
}

// ============================================================
// セグメンテーション（1回だけ＋リトライ）
// ============================================================

/**
 * セグメンテーションを1回だけ実行（失敗したらリトライ）
 */
function runSegmentationOnceWithRetry(runObj, tryIndex) {
  safeDetectOnce(
    bodySeg,
    srcG.elt,
    SEG_TIMEOUT_MS,
    (results) => {
      if (!isRunAlive(runObj, runObj.token)) return;
      runObj.detecting = false;

      try {
        onSegmentationResults(runObj, results);
      } catch (e) {
        logWeirdError(e, "post-process failed");
        failOrRetry(e);
      }
    },
    (err) => {
      if (!isRunAlive(runObj, runObj.token)) return;
      runObj.detecting = false;

      logWeirdError(err, "segmentation failed");
      failOrRetry(err);
    }
  );

  function failOrRetry(err) {
    if (!isRunAlive(runObj, runObj.token)) return;

    if (tryIndex + 1 >= SEG_RETRY_MAX) {
      setRunError("segmentation failed (see console)");
      return;
    }
    setStatus(
      "SEGMENTING",
      `retry... (${tryIndex + 1}/${SEG_RETRY_MAX - 1})`,
      ""
    );
    refreshRunPane();
    setTimeout(() => runSegmentationOnceWithRetry(runObj, tryIndex + 1), 400);
  }
}

/**
 * detect / detectStart のどちらでも「1回だけ」実行して結果を返す
 * - コールバックが来ない場合はタイムアウト
 */
function safeDetectOnce(model, source, timeoutMs, onOk, onError) {
  let done = false;
  let timer = null;

  function finishOk(res) {
    if (done) return;
    done = true;
    cleanup();
    onOk(res);
  }

  function finishErr(err) {
    if (done) return;
    done = true;
    cleanup();
    onError(err ?? new Error("unknown segmentation error"));
  }

  function cleanup() {
    if (timer) clearTimeout(timer);
    timer = null;
    try {
      if (model && typeof model.detectStop === "function") model.detectStop();
    } catch (_) {}
  }

  timer = setTimeout(() => {
    finishErr(new Error("segmentation timeout"));
  }, timeoutMs);

  try {
    // 1-shot detect があれば優先
    if (model && typeof model.detect === "function") {
      model.detect(source, (results) => finishOk(results));
      return;
    }
    // 連続ストリーム形式（detectStart/detectStop）
    if (model && typeof model.detectStart === "function") {
      model.detectStart(source, (results) => finishOk(results));
      return;
    }
    finishErr(new Error("model has no detect/detectStart"));
  } catch (e) {
    finishErr(e);
  }
}

/**
 * セグメンテーション結果を受けて、マスク生成→粒子生成（分割）へ
 */
function onSegmentationResults(runObj, results) {
  const r = Array.isArray(results) ? results[0] : results;

  const anyMask = r?.mask ?? r?.segmentationMask ?? r?.maskImage;
  if (!anyMask) {
    console.log("No mask keys:", r ? Object.keys(r) : r);
    throw new Error("mask not found");
  }

  runObj.maskImg = toP5Image(anyMask, width, height);
  runObj.maskImg.loadPixels();
  runObj.maskInfo = analyzeMask(runObj.maskImg);

  // 粒子生成を分割で開始
  startBuildingParticles(runObj);

  runObj.phase = "BUILDING_LAYER";
  setStatus("BUILDING_LAYER", "", "building 0%");
  refreshRunPane();
}

// ============================================================
// 粒子生成（フレーム分割）
// ============================================================

/**
 * 粒子生成フェーズを開始（走査状態を初期化）
 */
function startBuildingParticles(runObj) {
  runObj.particles = [];
  img.loadPixels();

  const c = runObj.cfg.cellSize;
  const cols = Math.ceil(width / c);
  const rows = Math.ceil(height / c);

  runObj.build = {
    bx: 0,
    by: 0,
    cell: c,
    cols,
    rows,
    done: 0,
    total: cols * rows,
  };
}

/**
 * 粒子生成を少しだけ進める（budgetセル分）
 * - true を返したら完了
 */
function buildGridParticlesChunk(budget) {
  if (!run || !run.build || !run.maskImg || !run.maskInfo) return true;

  const cfg = run.cfg;
  const c = run.build.cell;

  let steps = 0;

  while (steps < budget && run.build.by < height) {
    const bx = run.build.bx;
    const by = run.build.by;
    const bw = Math.min(c, width - bx);
    const bh = Math.min(c, height - by);

    const isPersonBlock = blockIsPerson(
      run.maskImg,
      run.maskInfo,
      bx,
      by,
      bw,
      bh
    );
    const take = cfg.applyToPerson ? isPersonBlock : !isPersonBlock;

    if (take) {
      const cx = bx + bw * 0.5;
      const cy = by + bh * 0.5;
      const col = sampleImageRGB(img, cx, cy);
      run.particles.push(new CellParticle(cx, cy, c, col, cfg));
    }

    // 次のセルへ
    run.build.bx += c;
    if (run.build.bx >= width) {
      run.build.bx = 0;
      run.build.by += c;
    }

    run.build.done += 1;
    steps += 1;
  }

  return run.build.by >= height;
}

// ============================================================
// CellParticle（あなたの核）
// ============================================================

class CellParticle {
  /**
   * 粒子を初期化（cfgを保持し、グローバル定数への依存を減らす）
   */
  constructor(x, y, size, col, cfg) {
    this.x = x;
    this.y = y;
    this.size = size;

    this.r = col[0];
    this.g = col[1];
    this.b = col[2];

    // 初期速度方向
    const a = random(TWO_PI);
    this.vx = cos(a);
    this.vy = sin(a);
    this.ax = 0;
    this.ay = 0;

    // 何フレーム動いたか
    this.age = 0;

    // 実行スナップショット（ここが重要：実行中にUIが変わっても影響しない）
    this.cfg = cfg;

    // 寿命（このフレーム数を超えたら動かない）
    this.life = cfg.moveFrames;

    // 粒子ごと速度差
    this.forceScale = random(0.6, 1.4);
    this.maxSpeedScale = random(0.7, 1.3);

    this.fade = 255;
  }

  /**
   * Flow field に従って進める
   */
  step(t) {
    if (this.age >= this.life) return;
    this.age++;

    const c = this.cfg.cellSize;

    // セル座標（グリッドベースで flow を作る）
    const cx = floor(this.x / c);
    const cy = floor(this.y / c);

    const n = noise(cx * this.cfg.flowFreq, cy * this.cfg.flowFreq, t);
    const angle = n * TWO_PI * this.cfg.flowTwist;

    this.ax += cos(angle) * this.cfg.force * this.forceScale;
    this.ay += sin(angle) * this.cfg.force * this.forceScale;

    this.vx += this.ax;
    this.vy += this.ay;

    // フェード
    this.fade = map(this.age, 0, this.life, 255, 255 * this.cfg.tileAlpha);

    // 速度制限
    const sp = sqrt(this.vx * this.vx + this.vy * this.vy);
    const maxSp = this.cfg.maxSpeed * this.maxSpeedScale;
    if (sp > maxSp) {
      const k = maxSp / sp;
      this.vx *= k;
      this.vy *= k;
    }

    this.x += this.vx;
    this.y += this.vy;

    this.ax = 0;
    this.ay = 0;

    // wrap
    if (this.x < 0) this.x += width;
    if (this.x >= width) this.x -= width;
    if (this.y < 0) this.y += height;
    if (this.y >= height) this.y -= height;
  }

  /**
   * 軌跡レイヤーに描画（焼き付け）
   */
  paint(g) {
    g.fill(this.r, this.g, this.b, this.fade);

    let px, py;
    if (this.cfg.snapToGrid) {
      // グリッドにスナップ（セルっぽさ維持）
      px = floor(this.x / this.size) * this.size + this.size * 0.5;
      py = floor(this.y / this.size) * this.size + this.size * 0.5;
    } else {
      px = this.x;
      py = this.y;
    }

    g.rect(px, py, this.size, this.size);
  }
}

// ============================================================
// マスク関連ユーティリティ
// ============================================================

/**
 * mask（CanvasImageSource等）を p5.Image に変換してサイズを合わせる
 */
function toP5Image(any, w, h) {
  if (any instanceof p5.Image) {
    const im = any.get();
    if (im.width !== w || im.height !== h) im.resize(w, h);
    return im;
  }
  const g = createGraphics(w, h);
  g.pixelDensity(1);
  g.image(any, 0, 0, w, h);
  return g.get();
}

/**
 * マスクの「人物が透明側か不透明側か」を推定する
 */
function analyzeMask(m) {
  const w = m.width,
    h = m.height;
  const p = m.pixels;

  let z = 0,
    o = 0;
  for (let y = 0; y < h; y += 4) {
    for (let x = 0; x < w; x += 4) {
      const idx = 4 * (y * w + x);
      const a = p[idx + 3];
      if (a < 16) z++;
      else if (a > 239) o++;
    }
  }

  const hasTransparency = z > 0;
  const personIsTransparent = hasTransparency ? z < o : null;
  return { hasTransparency, personIsTransparent };
}

/**
 * セルが人物かどうか（中心＋四隅で多数決）
 */
function blockIsPerson(maskImg, maskInfo, bx, by, bw, bh) {
  const votes =
    (isPersonAt(maskImg, maskInfo, bx + bw * 0.5, by + bh * 0.5) ? 1 : 0) +
    (isPersonAt(maskImg, maskInfo, bx + 1, by + 1) ? 1 : 0) +
    (isPersonAt(maskImg, maskInfo, bx + bw - 2, by + 1) ? 1 : 0) +
    (isPersonAt(maskImg, maskInfo, bx + 1, by + bh - 2) ? 1 : 0) +
    (isPersonAt(maskImg, maskInfo, bx + bw - 2, by + bh - 2) ? 1 : 0);

  return votes >= 3;
}

/**
 * 座標(x,y)が人物かどうか
 */
function isPersonAt(maskImg, maskInfo, x, y) {
  const w = maskImg.width,
    h = maskImg.height;
  const ix = clampInt(floor(x), 0, w - 1);
  const iy = clampInt(floor(y), 0, h - 1);
  const idx = 4 * (iy * w + ix);

  const r = maskImg.pixels[idx + 0];
  const g = maskImg.pixels[idx + 1];
  const b = maskImg.pixels[idx + 2];
  const a = maskImg.pixels[idx + 3];

  if (maskInfo.hasTransparency) {
    return maskInfo.personIsTransparent ? a < 128 : a >= 128;
  } else {
    const v = (r + g + b) / 3;
    return v < 128; // 逆なら v > 128
  }
}

/**
 * 画像の色を中心1点でサンプリング
 */
function sampleImageRGB(im, x, y) {
  const w = im.width,
    h = im.height;
  const ix = clampInt(floor(x), 0, w - 1);
  const iy = clampInt(floor(y), 0, h - 1);
  const idx = 4 * (iy * w + ix);
  return [im.pixels[idx + 0], im.pixels[idx + 1], im.pixels[idx + 2]];
}

function clampInt(v, lo, hi) {
  return max(lo, min(hi, v));
}

function clampNumber(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// ============================================================
// 画像ロード＆キャンバス調整
// ============================================================

/**
 * loadImage を Promise 化
 */
function loadImageAsync(path) {
  return new Promise((resolve, reject) => {
    loadImage(
      path,
      (im) => resolve(im),
      (err) => reject(err ?? new Error("loadImage failed: " + path))
    );
  });
}

/**
 * 画像に合わせて canvas / offscreen を作り直す
 */
function setupCanvasesForImage(newImg) {
  resizeCanvas(newImg.width, newImg.height);
  pixelDensity(1);
  rectMode(CENTER);
  noStroke();

  // 入力用
  srcG = createGraphics(width, height);
  srcG.pixelDensity(1);
  srcG.image(newImg, 0, 0);

  // 軌跡用
  trailG = createGraphics(width, height);
  trailG.pixelDensity(1);
  trailG.rectMode(CENTER);
  trailG.noStroke();
  trailG.clear();
}

// ============================================================
// ログ・表示
// ============================================================

/**
 * `{}` しか出ない系の“謎エラー”を、無理やり展開してログに出す
 */
function logWeirdError(err, label) {
  console.group(`🧨 ${label}`);
  console.log("raw:", err);
  console.log("type:", typeof err);
  console.log("ctor:", err?.constructor?.name);
  try {
    console.log("keys:", Object.keys(err));
  } catch (_) {}
  try {
    console.log("props:", Object.getOwnPropertyNames(err));
  } catch (_) {}
  console.log("message:", err?.message);
  console.log("stack:", err?.stack);
  try {
    console.log("string:", String(err));
  } catch (_) {}
  try {
    console.log("json:", JSON.stringify(err));
  } catch (_) {}
  console.groupEnd();
}

function drawStatusOverlay() {
  // 画面（canvas）上のステータスHUDは使わない
  // （RunペインのSTATUS/DETAIL/PROGRESSで十分なので重複を避ける）
}
