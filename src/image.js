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

