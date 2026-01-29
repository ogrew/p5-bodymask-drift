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
  const fitted = fitImageToWindow(newImg);
  resizeCanvas(fitted.width, fitted.height);
  pixelDensity(1);
  rectMode(CENTER);
  noStroke();

  // 入力用
  srcG = createGraphics(width, height);
  srcG.pixelDensity(1);
  srcG.image(fitted, 0, 0);

  // 軌跡用
  trailG = createGraphics(width, height);
  trailG.pixelDensity(1);
  trailG.rectMode(CENTER);
  trailG.noStroke();
  trailG.clear();

  return fitted;
}

const UPLOAD_LIMIT_BYTES = 5 * 1024 * 1024;

const UPLOAD_STATE = {
  file: null,
  url: "",
  name: "",
  size: 0,
};

function getUploadedUrl() {
  return UPLOAD_STATE.url;
}

function getUploadedLabel() {
  if (!UPLOAD_STATE.file) return "(none)";
  const mb = (UPLOAD_STATE.size / (1024 * 1024)).toFixed(2);
  return `${UPLOAD_STATE.name} (${mb} MB)`;
}

/**
 * JPEGのみ / 5MBまで
 * okなら objectURL を更新（古いURLは revoke）
 */
function setUploadedFile(file) {
  if (!file) return { ok: false, message: "no file" };

  // type はブラウザにより空のことがあるので、拡張子でも保険をかける
  const name = String(file.name ?? "");
  const lower = name.toLowerCase();
  const extOk = lower.endsWith(".jpg") || lower.endsWith(".jpeg");
  const typeOk = file.type === "image/jpeg" || file.type === "";

  if (!(extOk && typeOk)) {
    return { ok: false, message: "JPEG (.jpg/.jpeg) only" };
  }

  if (file.size > UPLOAD_LIMIT_BYTES) {
    return { ok: false, message: "File too large (max 5MB)" };
  }

  // 古い objectURL を破棄
  try {
    if (UPLOAD_STATE.url) URL.revokeObjectURL(UPLOAD_STATE.url);
  } catch (_) {}

  const url = URL.createObjectURL(file);

  UPLOAD_STATE.file = file;
  UPLOAD_STATE.url = url;
  UPLOAD_STATE.name = name || "upload.jpg";
  UPLOAD_STATE.size = file.size;

  return { ok: true, message: "ok" };
}

/**
 * 画像をウィンドウ内に収まるサイズへスケーリング
 * - アスペクト比維持
 * - 小さな画像はウィンドウに合わせて拡大
 */
function fitImageToWindow(im) {
  const bounds = getStageBounds();
  const maxW = Math.max(
    1,
    Math.floor(bounds?.width || window.innerWidth || im.width)
  );
  const maxH = Math.max(
    1,
    Math.floor(bounds?.height || window.innerHeight || im.height)
  );
  const scale = Math.min(maxW / im.width, maxH / im.height);
  const w = Math.max(1, Math.floor(im.width * scale));
  const h = Math.max(1, Math.floor(im.height * scale));

  if (w === im.width && h === im.height) return im;

  const resized = im.get();
  resized.resize(w, h);
  return resized;
}

function getStageBounds() {
  const stage = document.getElementById("stage");
  if (!stage) return null;
  const rect = stage.getBoundingClientRect();
  if (!rect || !rect.width || !rect.height) return null;
  return rect;
}
