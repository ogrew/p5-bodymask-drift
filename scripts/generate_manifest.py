#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SAMPLES_DIR = ROOT / "assets" / "samples"
MANIFEST = SAMPLES_DIR / "manifest.json"
EXTS = {".jpg", ".jpeg", ".png"}


def main() -> None:
    if not SAMPLES_DIR.exists():
        raise SystemExit(f"Missing folder: {SAMPLES_DIR}")

    files = []
    for path in SAMPLES_DIR.iterdir():
        if path.name.startswith("."):
            continue
        if path.name == "manifest.json":
            continue
        if path.suffix.lower() not in EXTS:
            continue
        files.append(path.name)

    files.sort(key=lambda name: name.lower())

    data = {
        "samples": [
            {"label": name, "file": f"assets/samples/{name}"} for name in files
        ]
    }

    MANIFEST.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    print(f"Wrote {MANIFEST} with {len(files)} sample(s).")


if __name__ == "__main__":
    main()
