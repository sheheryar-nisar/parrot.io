import {
  expandArabicScriptCandidates,
  getLangLabels,
  isArabicScriptCandidateRun,
  mapOsdScriptToLangCandidates,
  normalizeArabicOcr,
  normalizeLangs,
  scoreArabicScriptCandidate,
  scoreOcrCandidate,
  validateOcrResult,
} from '../lib/lang-utils.js';

const TESSERACT_BASE = chrome.runtime.getURL('src/lib/tesseract/');
const olog = (...args) => console.log('[Parrot.io][offscreen]', ...args);

const RTL_SCRIPT_LANGS = new Set(['ara', 'urd']);
const COMPLEX_SCRIPT_LANGS = new Set(['ara', 'urd', 'hin', 'chi_sim', 'jpn', 'kor']);
const MIN_CROP_PX = 280;
const CROP_PADDING_X = 6;
const CROP_PADDING_Y = 4;
const PSM_SINGLE_BLOCK = '6';
const PSM_SINGLE_LINE = '7';
const PSM_AUTO = '3';

let cachedWorker = null;
let cachedLangKey = '';
let cachedOsdWorker = null;
let warmupPromise = null;

function getLangKey(langs) {
  return normalizeLangs(langs).join('+');
}

function usesComplexScript(langs) {
  return normalizeLangs(langs).some((code) => COMPLEX_SCRIPT_LANGS.has(code));
}

function usesRtlScript(langs) {
  return normalizeLangs(langs).some((code) => RTL_SCRIPT_LANGS.has(code));
}

async function assertOsdAsset() {
  const url = chrome.runtime.getURL('src/lib/tesseract/osd.traineddata.gz');
  const response = await fetch(url, { method: 'HEAD' });
  if (!response.ok) {
    throw new Error(
      'OSD language model is not available offline. Re-run setup:tesseract to enable auto-detect.'
    );
  }
}

async function getOsdWorker() {
  if (cachedOsdWorker) {
    return cachedOsdWorker;
  }

  if (typeof Tesseract === 'undefined') {
    throw new Error('Tesseract.js failed to load in the offscreen document.');
  }

  await assertOsdAsset();

  cachedOsdWorker = await Tesseract.createWorker('osd', 0, {
    workerPath: chrome.runtime.getURL('src/lib/tesseract/worker.min.js'),
    corePath: TESSERACT_BASE,
    langPath: TESSERACT_BASE,
    workerBlobURL: false,
    gzip: true,
    cacheMethod: 'none',
  });

  return cachedOsdWorker;
}

async function preloadOsd() {
  olog('preloadOsd');
  await getOsdWorker();
}

async function detectScriptFromImage(imageDataUrl) {
  try {
    const worker = await getOsdWorker();
    const result = await worker.detect(imageDataUrl);
    const data = result?.data || {};
    return {
      script: data.script || null,
      script_confidence: data.script_confidence ?? 0,
    };
  } catch (error) {
    olog('detectScriptFromImage failed', error?.message || error);
    return { script: null, script_confidence: 0 };
  }
}

async function resolveOcrLangs(settings, croppedDataUrl) {
  if (!settings?.autoDetectLang) {
    const candidates = expandArabicScriptCandidates(settings?.langs);
    return {
      candidates,
      autoDetected: false,
      detectedScript: null,
    };
  }

  const detection = await detectScriptFromImage(croppedDataUrl);
  const candidates = mapOsdScriptToLangCandidates(
    detection.script,
    detection.script_confidence
  );

  olog('auto-detect resolved', {
    script: detection.script,
    script_confidence: detection.script_confidence,
    candidates,
  });

  return {
    candidates,
    autoDetected: true,
    detectedScript: detection.script,
  };
}

async function assertLangAssets(langs) {
  const normalized = normalizeLangs(langs);

  for (const lang of normalized) {
    const url = chrome.runtime.getURL(`src/lib/tesseract/${lang}.traineddata.gz`);
    const response = await fetch(url, { method: 'HEAD' });
    if (!response.ok) {
      const label = getLangLabels([lang])[0] || lang;
      throw new Error(
        `${label} is not available offline. Re-run setup:tesseract or choose a bundled language in Settings.`
      );
    }
  }
}

async function cropImage({ dataUrl, rect, dpr }) {
  const scale = Number(dpr) || 1;
  const padX = Math.round(CROP_PADDING_X * scale);
  const padY = Math.round(CROP_PADDING_Y * scale);

  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      try {
        const innerX = Math.round(rect.x * scale);
        const innerY = Math.round(rect.y * scale);
        const innerW = Math.round(rect.width * scale);
        const innerH = Math.round(rect.height * scale);

        const cropX = innerX;
        const cropY = innerY;
        const cropRight = Math.min(image.width, innerX + innerW + padX);
        const cropBottom = Math.min(image.height, innerY + innerH + padY);
        const cropW = cropRight - cropX;
        const cropH = cropBottom - cropY;

        if (cropW <= 0 || cropH <= 0) {
          reject(new Error('Invalid crop dimensions.'));
          return;
        }

        const canvas = document.createElement('canvas');
        canvas.width = cropW;
        canvas.height = cropH;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas is not available.'));
          return;
        }

        ctx.drawImage(image, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

        resolve({
          dataUrl: canvas.toDataURL('image/png'),
          width: cropW,
          height: cropH,
        });
      } catch (error) {
        reject(error);
      }
    };

    image.onerror = () => reject(new Error('Failed to load captured image.'));
    image.src = dataUrl;
  });
}

async function upscaleImageDataUrl(dataUrl, factor) {
  const image = new Image();
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error('Failed to load image for upscaling.'));
    image.src = dataUrl;
  });

  const canvas = document.createElement('canvas');
  canvas.width = image.width * factor;
  canvas.height = image.height * factor;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas is not available.');
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}

function preprocessCanvas(ctx, width, height) {
  const imageData = ctx.getImageData(0, 0, width, height);
  const pixels = imageData.data;
  const pixelCount = pixels.length / 4;

  let sum = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    sum += 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
  }
  const invert = sum / pixelCount < 128;

  for (let i = 0; i < pixels.length; i += 4) {
    let gray = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
    if (invert) {
      gray = 255 - gray;
    }
    const boosted = Math.min(255, Math.max(0, (gray - 20) * (255 / 210)));
    pixels[i] = boosted;
    pixels[i + 1] = boosted;
    pixels[i + 2] = boosted;
  }

  ctx.putImageData(imageData, 0, 0);
}

async function preprocessImageDataUrl(dataUrl) {
  const image = new Image();
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error('Failed to load image for preprocessing.'));
    image.src = dataUrl;
  });

  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas is not available.');
  }

  ctx.drawImage(image, 0, 0);
  preprocessCanvas(ctx, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}

function getPageSegMode(cropWidth, cropHeight) {
  const isSingleLine = cropHeight <= 56 && cropWidth > cropHeight * 2.5;
  return isSingleLine ? PSM_SINGLE_LINE : PSM_SINGLE_BLOCK;
}

async function prepareOcrImage(croppedDataUrl, langs, cropWidth, cropHeight, { preprocess = true } = {}) {
  let image = croppedDataUrl;

  if (preprocess) {
    image = await preprocessImageDataUrl(croppedDataUrl);
  }

  const minDim = Math.min(cropWidth, cropHeight);

  if (usesComplexScript(langs) && minDim < MIN_CROP_PX) {
    const factor = minDim < 140 ? 3 : 2;
    olog('upscaling complex-script crop', { cropWidth, cropHeight, factor });
    image = await upscaleImageDataUrl(image, factor);
  } else if (minDim < 200) {
    olog('upscaling small crop', { cropWidth, cropHeight });
    image = await upscaleImageDataUrl(image, 2);
  }

  return image;
}

function buildOcrParams(psm, langs) {
  const params = { tessedit_pageseg_mode: psm };
  if (usesRtlScript(langs)) {
    params.preserve_interword_spaces = '1';
  }
  if (usesComplexScript(langs)) {
    params.user_defined_dpi = '300';
  }
  return params;
}

function usesArabicScriptLang(lang) {
  return lang === 'ara' || lang === 'urd';
}

function getOcrAttempts(lang, cropWidth, cropHeight) {
  const primaryPsm = getPageSegMode(cropWidth, cropHeight);
  const standard = [
    { preprocess: true, psm: primaryPsm, label: 'preprocessed' },
    { preprocess: false, psm: PSM_SINGLE_BLOCK, label: 'raw-block' },
    { preprocess: true, psm: PSM_SINGLE_BLOCK, label: 'preprocessed-block' },
  ];

  if (!usesArabicScriptLang(lang)) {
    return standard;
  }

  return [
    { preprocess: false, psm: primaryPsm, label: 'raw-primary' },
    ...standard,
    { preprocess: false, psm: PSM_AUTO, label: 'raw-auto' },
  ];
}

function scoreResult(text, confidence, lang, useArabicScoring) {
  if (useArabicScoring && usesArabicScriptLang(lang)) {
    return scoreArabicScriptCandidate(text, confidence, lang);
  }
  return scoreOcrCandidate(text, confidence);
}

async function recognizeImage(worker, image, langs, psm, { skipScriptValidation = false } = {}) {
  await worker.setParameters(buildOcrParams(psm, langs));
  const result = await worker.recognize(image);
  const confidence = result?.data?.confidence ?? 0;
  const text = validateOcrResult(result?.data?.text, confidence, langs, {
    skipScriptValidation,
    ocrLang: normalizeLangs(langs)[0],
  });
  return { text, confidence };
}

function mapWorkerError(error, langs) {
  const message = String(error?.message || error).toLowerCase();
  if (
    message.includes('traineddata') ||
    message.includes('language') ||
    message.includes('failed to fetch') ||
    message.includes('loading language')
  ) {
    const labels = getLangLabels(langs).join(', ');
    return new Error(
      `${labels} is not available offline. Re-run setup:tesseract or choose a bundled language in Settings.`
    );
  }
  return error;
}

async function getTesseractWorker(langs) {
  const normalizedLangs = normalizeLangs(langs);
  const langKey = getLangKey(normalizedLangs);

  if (cachedWorker && cachedLangKey === langKey) {
    return cachedWorker;
  }

  if (cachedWorker) {
    await cachedWorker.terminate();
    cachedWorker = null;
    cachedLangKey = '';
  }

  if (typeof Tesseract === 'undefined') {
    throw new Error('Tesseract.js failed to load in the offscreen document.');
  }

  await assertLangAssets(normalizedLangs);

  try {
    const worker = await Tesseract.createWorker(langKey, 1, {
      workerPath: chrome.runtime.getURL('src/lib/tesseract/worker.min.js'),
      corePath: TESSERACT_BASE,
      langPath: TESSERACT_BASE,
      workerBlobURL: false,
      gzip: true,
      cacheMethod: 'none',
    });

    cachedWorker = worker;
    cachedLangKey = langKey;
    return worker;
  } catch (error) {
    throw mapWorkerError(error, normalizedLangs);
  }
}

async function preloadLangs(langs, { autoDetectLang = false } = {}) {
  const normalized = normalizeLangs(langs);
  olog('preloadLangs', { langs: normalized.join('+'), autoDetectLang });
  const tasks = [getTesseractWorker(normalized)];
  if (autoDetectLang) {
    tasks.push(preloadOsd());
  }
  await Promise.all(tasks);
}

async function warmUpTesseract() {
  if (!warmupPromise) {
    warmupPromise = chrome.storage.sync
      .get({ langs: ['eng'], autoDetectLang: false })
      .then((stored) =>
        preloadLangs(stored.langs, { autoDetectLang: Boolean(stored.autoDetectLang) })
      )
      .catch((error) => {
        warmupPromise = null;
        throw error;
      });
  }

  return warmupPromise;
}

async function runTesseractOcrForLang(
  croppedDataUrl,
  lang,
  cropWidth,
  cropHeight,
  { skipScriptValidation = false, useArabicScoring = false } = {}
) {
  const langs = [lang];
  const worker = await getTesseractWorker(langs);
  const attempts = getOcrAttempts(lang, cropWidth, cropHeight);

  let best = { text: '', confidence: 0 };
  let lastError = null;

  for (const attempt of attempts) {
    try {
      const ocrImage = await prepareOcrImage(
        croppedDataUrl,
        langs,
        cropWidth,
        cropHeight,
        { preprocess: attempt.preprocess }
      );
      const result = await recognizeImage(worker, ocrImage, langs, attempt.psm, {
        skipScriptValidation,
      });

      if (scoreResult(result.text, result.confidence, lang, useArabicScoring) >
          scoreResult(best.text, best.confidence, lang, useArabicScoring)) {
        best = result;
      }

      if (result.text && result.confidence > 60) {
        break;
      }
    } catch (error) {
      lastError = error;
      olog('runTesseractOcrForLang attempt failed', {
        lang,
        attempt: attempt.label,
        error: error?.message || error,
      });
    }
  }

  if (best.text) {
    return { ...best, lang };
  }

  if (lastError) {
    throw lastError;
  }

  return { text: '', confidence: 0, lang };
}

async function runTesseractOcr(croppedDataUrl, langCandidates, cropWidth, cropHeight, autoDetected, preferredLang = null) {
  const startedAt = Date.now();
  const candidates = langCandidates.map((code) => normalizeLangs([code])[0]).filter(Boolean);
  const useArabicScoring = isArabicScriptCandidateRun(candidates);
  const tryAllCandidates = useArabicScoring && candidates.length > 1;
  olog('runTesseractOcr called', { langs: candidates.join('+'), autoDetected, useArabicScoring });

  let best = { text: '', confidence: 0, lang: null, score: 0 };
  let lastError = null;

  for (const lang of candidates) {
    try {
      const result = await runTesseractOcrForLang(
        croppedDataUrl,
        lang,
        cropWidth,
        cropHeight,
        { skipScriptValidation: autoDetected, useArabicScoring }
      );
      let score = scoreResult(result.text, result.confidence, lang, useArabicScoring);
      if (useArabicScoring && preferredLang && lang === preferredLang) {
        score += 10;
      }
      if (score > best.score) {
        best = { ...result, score };
      }
      if (result.text && result.confidence > 60 && !tryAllCandidates) {
        break;
      }
    } catch (error) {
      lastError = error;
      olog('runTesseractOcr candidate failed', {
        lang,
        error: error?.message || error,
      });
    }
  }

  if (best.text) {
    if (best.lang === 'ara') {
      best.text = normalizeArabicOcr(best.text);
    }
    olog('runTesseractOcr complete', {
      chars: best.text.length,
      lang: best.lang,
      confidence: best.confidence,
      elapsedMs: Date.now() - startedAt,
    });
    return { text: best.text, usedLang: best.lang || candidates[0] || 'eng' };
  }

  if (lastError) {
    throw lastError;
  }

  olog('runTesseractOcr complete', {
    chars: 0,
    elapsedMs: Date.now() - startedAt,
  });
  return { text: '', usedLang: candidates[0] || 'eng' };
}

async function runOcr({ dataUrl, rect, dpr, settings }) {
  const startedAt = Date.now();

  const cropped = await cropImage({ dataUrl, rect, dpr });
  const { candidates, autoDetected, detectedScript } = await resolveOcrLangs(
    settings,
    cropped.dataUrl
  );

  olog('runOcr start', {
    langs: candidates.join('+'),
    autoDetected,
    detectedScript,
    crop: { width: cropped.width, height: cropped.height },
  });

  const ocrResult = await runTesseractOcr(
    cropped.dataUrl,
    candidates,
    cropped.width,
    cropped.height,
    autoDetected,
    normalizeLangs(settings?.langs)[0]
  );

  const elapsedMs = Date.now() - startedAt;
  olog('runOcr complete', {
    ocrFn: 'runTesseractOcr',
    chars: ocrResult.text.length,
    usedLang: ocrResult.usedLang,
    autoDetected,
    detectedScript,
    elapsedMs,
  });

  return {
    text: ocrResult.text,
    usedLang: ocrResult.usedLang,
    ocrFn: 'runTesseractOcr',
    elapsedMs,
    autoDetected,
    detectedScript,
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'PARROT_OFFSCREEN_PING') {
    sendResponse({ ready: typeof Tesseract !== 'undefined' });
    return true;
  }

  if (message?.type === 'PARROT_PRELOAD_LANGS') {
    const payload = message.payload || {};
    preloadLangs(payload.langs || ['eng'], {
      autoDetectLang: Boolean(payload.autoDetectLang),
    })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        olog('preloadLangs error', error?.message || error);
        sendResponse({ ok: false, error: error?.message || 'Preload failed.' });
      });
    return true;
  }

  if (message?.target !== 'offscreen' || message?.type !== 'PARROT_RUN_OCR') {
    return false;
  }

  runOcr(message.payload)
    .then((result) => {
      sendResponse({
        ok: true,
        text: result.text || '',
        usedLang: result.usedLang || '',
        ocrFn: result.ocrFn,
        elapsedMs: result.elapsedMs,
      });
    })
    .catch((error) => {
      olog('runOcr error', error?.message || error);
      sendResponse({ ok: false, error: error?.message || 'OCR failed.' });
    });

  return true;
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') {
    return;
  }

  if (changes.langs || changes.autoDetectLang) {
    chrome.storage.sync
      .get({ langs: ['eng'], autoDetectLang: false })
      .then((stored) =>
        preloadLangs(stored.langs, { autoDetectLang: Boolean(stored.autoDetectLang) })
      )
      .catch(() => {});
  }
});

if (typeof Tesseract !== 'undefined') {
  warmUpTesseract().catch(() => {});
}
