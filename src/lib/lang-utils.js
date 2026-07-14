export const MIN_OCR_CONFIDENCE = 25;
export const MIN_OCR_CONFIDENCE_COMPLEX = 10;

const COMPLEX_SCRIPT_LANGS = new Set(['ara', 'urd', 'hin', 'chi_sim', 'jpn', 'kor']);

export const ARABIC_SCRIPT_LANGS = new Set(['ara', 'urd']);

/** Urdu/Persian letter forms that differ from standard Arabic (MSA). */
const URDU_SPECIFIC_REGEX = /[\u06A9\u06BA\u06BE\u06C1\u06CC\u06D2\u06AF\u0679\u067E\u0686\u0688\u0691\u0698]/g;

export const BUNDLED_LANGS = [
  'eng',
  'spa',
  'fra',
  'deu',
  'ita',
  'por',
  'chi_sim',
  'jpn',
  'kor',
  'ara',
  'urd',
  'hin',
];

export const AVAILABLE_LANGS = [
  { code: 'eng', label: 'English' },
  { code: 'spa', label: 'Spanish' },
  { code: 'fra', label: 'French' },
  { code: 'deu', label: 'German' },
  { code: 'ita', label: 'Italian' },
  { code: 'por', label: 'Portuguese' },
  { code: 'chi_sim', label: 'Chinese (Simplified)' },
  { code: 'jpn', label: 'Japanese' },
  { code: 'kor', label: 'Korean' },
  { code: 'ara', label: 'Arabic' },
  { code: 'urd', label: 'Urdu' },
  { code: 'hin', label: 'Hindi' },
];

export const LANG_SCRIPT_MAP = {
  eng: 'Latin',
  spa: 'Latin',
  fra: 'Latin',
  deu: 'Latin',
  ita: 'Latin',
  por: 'Latin',
  ara: 'Arabic',
  urd: 'Arabic',
  hin: 'Devanagari',
  chi_sim: 'Han',
  jpn: 'Japanese',
  kor: 'Korean',
};

const SCRIPT_LANGS = {
  Latin: new Set(['eng', 'spa', 'fra', 'deu', 'ita', 'por']),
  Arabic: new Set(['ara', 'urd']),
  Devanagari: new Set(['hin']),
  Han: new Set(['chi_sim', 'jpn']),
  Japanese: new Set(['jpn', 'chi_sim']),
  Korean: new Set(['kor']),
};

const SCRIPT_PATTERNS = [
  { script: 'Arabic', regex: /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/g },
  { script: 'Devanagari', regex: /[\u0900-\u097F]/g },
  { script: 'Han', regex: /[\u4E00-\u9FFF\u3400-\u4DBF]/g },
  { script: 'Japanese', regex: /[\u3040-\u309F\u30A0-\u30FF]/g },
  { script: 'Korean', regex: /[\uAC00-\uD7AF\u1100-\u11FF]/g },
  { script: 'Latin', regex: /[A-Za-z\u00C0-\u024F]/g },
];

const bundledLangSet = new Set(BUNDLED_LANGS);
const labelByCode = new Map(AVAILABLE_LANGS.map((lang) => [lang.code, lang.label]));

const OSD_SCRIPT_MAP = {
  latin: ['eng'],
  devanagari: ['hin'],
  arabic: ['ara', 'urd'],
  han: ['chi_sim', 'jpn'],
  japanese: ['jpn'],
  korean: ['kor'],
};

const MIN_OSD_SCRIPT_CONFIDENCE = 50;

export function mapOsdScriptToLangCandidates(script, scriptConfidence = 0) {
  if (!script || (scriptConfidence ?? 0) < MIN_OSD_SCRIPT_CONFIDENCE) {
    return ['eng'];
  }

  const key = String(script).trim().toLowerCase();
  const candidates = OSD_SCRIPT_MAP[key];
  if (!candidates) {
    return ['eng'];
  }

  return candidates.filter((code) => bundledLangSet.has(code));
}

export function scoreOcrCandidate(text, confidence) {
  const chars = (text || '').replace(/\s/g, '').length;
  if (chars === 0) {
    return 0;
  }
  return chars * 10 + (confidence ?? 0);
}

export function countUrduSpecificChars(text) {
  const matches = (text || '').match(URDU_SPECIFIC_REGEX);
  return matches ? matches.length : 0;
}

export function expandArabicScriptCandidates(langs) {
  const primary = normalizeLangs(langs)[0];
  if (!ARABIC_SCRIPT_LANGS.has(primary)) {
    return [primary];
  }

  const ordered = [primary];
  for (const code of ['ara', 'urd']) {
    if (code !== primary) {
      ordered.push(code);
    }
  }
  return ordered;
}

export function isArabicScriptCandidateRun(candidates) {
  return Array.isArray(candidates) && candidates.some((code) => ARABIC_SCRIPT_LANGS.has(code));
}

export function scoreArabicScriptCandidate(text, confidence, lang) {
  let score = scoreOcrCandidate(text, confidence);
  const urduCount = countUrduSpecificChars(text);

  score -= urduCount * 15;

  if (lang === 'urd' && urduCount > 0) {
    score += Math.min(urduCount * 4, 48);
  } else if (lang === 'urd') {
    score -= 25;
  }

  return score;
}

export function normalizeArabicOcr(text) {
  if (!text) {
    return '';
  }

  return text
    .replace(/\u06A9/g, '\u0643')
    .replace(/[\u06BE\u06C1]/g, '\u0647')
    .replace(/[\u06CC\u06D2]/g, '\u064A');
}

export function filterBundledLangs(langs) {
  if (!Array.isArray(langs)) {
    return [];
  }
  return langs.filter((code) => bundledLangSet.has(code));
}

export function normalizeLangs(langs) {
  const filtered = filterBundledLangs(langs);
  return filtered.length > 0 ? [filtered[0]] : ['eng'];
}

export function usesComplexScriptLang(langs) {
  return normalizeLangs(langs).some((code) => COMPLEX_SCRIPT_LANGS.has(code));
}

export function getMinOcrConfidence(langs) {
  return usesComplexScriptLang(langs) ? MIN_OCR_CONFIDENCE_COMPLEX : MIN_OCR_CONFIDENCE;
}

export function cleanOcrOutput(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) {
    return '';
  }

  let lines = trimmed.split(/\r?\n/);

  while (lines.length > 1) {
    const first = lines[0].trim();
    const second = (lines[1] || '').trim();
    const looksLikeJunk =
      first.length > 0 &&
      first.length <= 2 &&
      second.length > first.length + 2 &&
      !/^[•\-*]$/.test(first);

    if (looksLikeJunk) {
      lines.shift();
      continue;
    }
    break;
  }

  const firstLine = lines[0] || '';
  const junkPrefix = firstLine.match(/^[^\p{L}\p{N}]{1,2}(?=\p{L})/u);
  if (junkPrefix && firstLine.length > junkPrefix[0].length + 4) {
    lines[0] = firstLine.slice(junkPrefix[0].length);
  }

  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function getLangLabels(codes) {
  return normalizeLangs(codes).map((code) => labelByCode.get(code) || code);
}

export function detectDominantScript(text) {
  if (!text || !text.trim()) {
    return null;
  }

  let bestScript = null;
  let bestCount = 0;

  for (const { script, regex } of SCRIPT_PATTERNS) {
    const matches = text.match(regex);
    const count = matches ? matches.length : 0;
    if (count > bestCount) {
      bestCount = count;
      bestScript = script;
    }
  }

  if (!bestScript || bestCount < 5) {
    return null;
  }

  return bestScript;
}

export function langsMatchScript(langs, script) {
  if (!script) {
    return true;
  }

  const normalized = normalizeLangs(langs);
  const allowed = SCRIPT_LANGS[script];
  if (!allowed) {
    return true;
  }

  return normalized.some((code) => allowed.has(code));
}

export function validateOcrResult(text, confidence, langs, options = {}) {
  const { skipScriptValidation = false, ocrLang = null } = options;
  let trimmed = cleanOcrOutput(text);
  if (!trimmed) {
    return '';
  }

  const minConfidence = getMinOcrConfidence(langs);
  const substantial = trimmed.replace(/\s/g, '').length >= 3;

  if (!substantial && (confidence ?? 0) < minConfidence) {
    throw new Error(
      'Could not read text with the selected language. Check that the correct language is selected in Settings.'
    );
  }

  const script = detectDominantScript(trimmed);
  if (!skipScriptValidation && script && substantial && !langsMatchScript(langs, script)) {
    const labels = getLangLabels(langs).join(', ');
    throw new Error(
      `This text does not match the selected language (${labels}). Choose the correct language in Settings.`
    );
  }

  const resolvedLang = ocrLang || normalizeLangs(langs)[0];
  if (resolvedLang === 'ara') {
    trimmed = normalizeArabicOcr(trimmed);
  }

  return trimmed;
}
