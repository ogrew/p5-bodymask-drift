// ============================================================
// グローバル
// ============================================================

let img; // 現在表示しているベース画像
let srcG; // セグメンテーション入力用（CanvasImageSource）
let trailG; // 軌跡レイヤー

let bodySeg = null; // ml5 model
let modelReady = false; // モデル準備完了フラグ

let paneParams = null;
let btnPlay = null;
let btnStop = null;

// 実行状態（PLAYごとに作り直す）
let run = null;
let runToken = 0;
