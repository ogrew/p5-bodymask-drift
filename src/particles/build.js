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