// ============================================================
// p5 lifecycle
// ============================================================

function preload() {
  // 初期表示は空状態にして、サンプルはマニフェスト読み込み後に選択する
}

function setup() {
  pixelDensity(1);
  if (img) {
    baseImgOriginal = img;
    img = fitImageToWindow(img);
    const canvas = createCanvas(img.width, img.height);
    canvas.parent("canvas-wrap");
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
  } else {
    const initial = getInitialCanvasSize();
    const canvas = createCanvas(initial.width, initial.height);
    canvas.parent("canvas-wrap");
    rectMode(CENTER);
    noStroke();

    const blank = createGraphics(initial.width, initial.height);
    blank.pixelDensity(1);
    blank.background(255);
    img = blank;
    baseImgOriginal = null;

    srcG = createGraphics(initial.width, initial.height);
    srcG.pixelDensity(1);
    srcG.background(255);

    trailG = createGraphics(initial.width, initial.height);
    trailG.pixelDensity(1);
    trailG.rectMode(CENTER);
    trailG.noStroke();
    trailG.clear();
  }

  // UI構築
  initTweakpane();
  if (typeof syncEmptyState === "function") {
    syncEmptyState();
  }

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

function windowResized() {
  if (run) return;
  if (!baseImgOriginal) return;
  img = setupCanvasesForImage(baseImgOriginal);
  redraw();
}

function draw() {
  if (DRAW_BASE_IMAGE && img) {
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
    run.zoff += run.cfg.flowZSpeed;

    for (let i = run.particles.length - 1; i >= 0; i--) {
      const p = run.particles[i];
      p.step(run.zoff);
      if (p.dead) {
        run.particles.splice(i, 1);
        continue;
      }
      p.paint(trailG);
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

function getInitialCanvasSize() {
  const bounds = getStageBounds();
  const maxW = bounds?.width || window.innerWidth || 960;
  const maxH = bounds?.height || window.innerHeight || 640;
  const width = Math.max(240, Math.min(960, Math.floor(maxW)));
  const height = Math.max(240, Math.min(640, Math.floor(maxH)));
  return { width, height };
}
