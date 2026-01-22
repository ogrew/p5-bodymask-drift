// ============================================================
// ml5: model init
// ============================================================

/**
 * BodySegmentationモデルを初期化して返す（Promise/同期どちらでも対応）
 * - callback方式に頼らない（ここが LOADING_MODEL 固定の根治）
 */
async function initBodySegModel() {
  if (typeof ml5 === "undefined") {
    throw new Error("ml5 is undefined (ml5 script not loaded)");
  }

  // タイムアウト（沈黙回避）
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("model load timeout")), MODEL_TIMEOUT_MS)
  );

  // ml5.bodySegmentation が Promise を返す場合も、同期で返す場合も吸収
  const task = (async () => {
    const maybe = ml5.bodySegmentation(MODEL, OPTIONS);
    if (maybe && typeof maybe.then === "function") {
      return await maybe;
    }
    return maybe;
  })();

  return await Promise.race([task, timeout]);
}

// ============================================================
// セグメンテーション（1回だけ＋リトライ）
// ============================================================

/**
 * セグメンテーションを1回だけ実行（失敗したらリトライ）
 */
function runSegmentationOnceWithRetry(runObj, tryIndex) {
  safeDetectOnce(
    bodySeg,
    srcG.elt,
    SEG_TIMEOUT_MS,
    (results) => {
      if (!isRunAlive(runObj, runObj.token)) return;
      runObj.detecting = false;

      try {
        onSegmentationResults(runObj, results);
      } catch (e) {
        logWeirdError(e, "post-process failed");
        failOrRetry(e);
      }
    },
    (err) => {
      if (!isRunAlive(runObj, runObj.token)) return;
      runObj.detecting = false;

      logWeirdError(err, "segmentation failed");
      failOrRetry(err);
    }
  );

  function failOrRetry(err) {
    if (!isRunAlive(runObj, runObj.token)) return;

    if (tryIndex + 1 >= SEG_RETRY_MAX) {
      setRunError("segmentation failed (see console)");
      return;
    }
    setStatus(
      "SEGMENTING",
      `retry... (${tryIndex + 1}/${SEG_RETRY_MAX - 1})`,
      ""
    );
    refreshRunPane();
    setTimeout(() => runSegmentationOnceWithRetry(runObj, tryIndex + 1), 400);
  }
}

/**
 * detect / detectStart のどちらでも「1回だけ」実行して結果を返す
 * - コールバックが来ない場合はタイムアウト
 */
function safeDetectOnce(model, source, timeoutMs, onOk, onError) {
  let done = false;
  let timer = null;

  function finishOk(res) {
    if (done) return;
    done = true;
    cleanup();
    onOk(res);
  }

  function finishErr(err) {
    if (done) return;
    done = true;
    cleanup();
    onError(err ?? new Error("unknown segmentation error"));
  }

  function cleanup() {
    if (timer) clearTimeout(timer);
    timer = null;
    try {
      if (model && typeof model.detectStop === "function") model.detectStop();
    } catch (_) {}
  }

  timer = setTimeout(() => {
    finishErr(new Error("segmentation timeout"));
  }, timeoutMs);

  try {
    // 1-shot detect があれば優先
    if (model && typeof model.detect === "function") {
      model.detect(source, (results) => finishOk(results));
      return;
    }
    // 連続ストリーム形式（detectStart/detectStop）
    if (model && typeof model.detectStart === "function") {
      model.detectStart(source, (results) => finishOk(results));
      return;
    }
    finishErr(new Error("model has no detect/detectStart"));
  } catch (e) {
    finishErr(e);
  }
}