// ============================================================
// 固定設定
// ============================================================

// Flow Field
const FLOW_FREQ = 0.08; // ノイズ周波数
const FLOW_TWIST = 2.0; // 回転量倍率
const FLOW_Z_SPEED = 0.01; // 時間方向

// 粒子（セル）の移動
const FORCE = 0.35;

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
// 粒子生成（グリッド走査）を1フレームで何セル処理するか
const BUILD_CELLS_PER_FRAME = 4000; 

// ============================================================
// UI パラメータ（paneParamsで編集）
// ============================================================

const SAMPLE_MANIFEST_URL = "assets/samples/manifest.json";
const DEFAULT_SAMPLE_PATH = "assets/samples/t1.jpg";

const PARAMS = {
  imgSource: "sample",
  imgPath: DEFAULT_SAMPLE_PATH,

  cellSize: 10,
  tileShape: "rect",
  moveFrames: 180,
  maxSpeed: 2.8,
  snapToGrid: true,
  applyToPerson: true,

  flowFreq: 0.08,
  flowTwist: 2.0,
  flowZSpeed: 0.1,
  force: 0.2,

  tileAlpha: 1.0,

  noiseSeed: 37452,
  wrapEdges: true,
};


// Runペインの表示用（readonly）
const RUN_UI = {
  status: "LOADING_MODEL",
  detail: "",
  progress: "",
};

const UPLOAD_UI = {
  file: "(none)",
};
