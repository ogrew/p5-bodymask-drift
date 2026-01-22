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
