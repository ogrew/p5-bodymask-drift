# DriftMask

Bodymask-based mosaic drift visualizer built with p5.js + ml5.js.

URL: https://ogrew.github.io/p5-bodymask-drift/

## Parameters

### Tiles
- Cell Size (px) (1–50): タイルのサイズ。小さいほど密度が上がります。
- Tile Shape: Rectangle / Circle。タイルの形状。
- Tile Opacity (0.0–1.0): タイルの透明度。

### Motion
- Frames (steps): アニメーションのステップ数（描画フレーム数）。
- Max Speed (1.0–10.0): パーティクルの最大速度。

### Flow Field
- Frequency (0.001–0.1): ノイズの周波数（流れの細かさ）。
- Twist (0.1–10.0): 流れの回転量（ねじれ強度）。
- Z Speed (0.001–1.0): 時間方向の進み（流れの変化速度）。

### Behavior
- Force Strength (0.01–5.0): パーティクルにかかる力の強さ。
- Snap to Grid: グリッドに吸着するかどうか。
- Wrap Edges: 端でループさせるかどうか。
- Apply to Person: 人物マスクに限定するかどうか。

### Randomness
- Noise Seed: ノイズのシード（再現性）。

## Controls

- Run / Stop: 実行の開始・停止。
- RESET PARAMS: パラメータを初期値に戻す。
- SAVE PNG: 画像を書き出す（`<元画像名>-DM-<unixTime>.png`）。
- Shortcuts: `p` (panel toggle), `s` (save PNG)

## Input

- Sample images: `assets/samples/manifest.json` で管理
- Local upload: JPG/PNG (max 5MB)

## Local server

```
./serve 8000
```

## Manifest helper

```
python3 generate_manifest.py
```
