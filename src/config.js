// ============================================================
// 固定設定
// ============================================================

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
const DEFAULT_SAMPLE_PATH = "assets/samples/p001.png";

const PARAM_DEFAULTS = {
  imgSource: "sample",
  imgPath: DEFAULT_SAMPLE_PATH,

  cellSize: 6,
  tileShape: "rect",
  moveFrames: 120,
  maxSpeed: 1.6,
  snapToGrid: true,
  applyToPerson: true,

  flowFreq: 0.12,
  flowTwist: 2.0,
  flowZSpeed: 0.1,
  force: 0.2,

  tileAlpha: 1.0,

  noiseSeed: Math.floor(Math.random() * 100000) + 1,
  wrapEdges: true,
};

const PARAMS = { ...PARAM_DEFAULTS };


// Runペインの表示用（readonly）
const RUN_UI = {
  status: "LOADING_MODEL",
  detail: "",
  progress: "",
};

const UPLOAD_UI = {
  file: "(none)",
};
