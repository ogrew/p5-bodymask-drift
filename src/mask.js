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
