// ============================================================
// CellParticle
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

    // 実行スナップショット
    this.cfg = cfg;

    // 寿命
    this.life = cfg.moveFrames;

    // 粒子ごと速度差
    this.forceScale = random(0.6, 1.4);
    this.maxSpeedScale = random(0.7, 1.3);

    this.fade = 255;
    this.scale = 1.0;

    this.dead = false;
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
    const endScale = Number.isFinite(this.cfg.tileScale) ? this.cfg.tileScale : 1.0;
    this.scale = map(this.age, 0, this.life, 1.0, endScale);

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
    if (this.cfg.wrapEdges) {
      if (this.x < 0) this.x += width;
      if (this.x >= width) this.x -= width;
      if (this.y < 0) this.y += height;
      if (this.y >= height) this.y -= height;
    } else {
      if (this.x < 0 || this.x >= width || this.y < 0 || this.y >= height) {
        this.dead = true;
      }
    }
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

    const drawSize = this.size * this.scale;
    if (this.cfg.tileShape === "circle") {
      g.circle(px, py, drawSize);
    } else {
      g.rect(px, py, drawSize, drawSize);
    }
  }
}
