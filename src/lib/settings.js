import { normalizeLangs } from './lang-utils.js';



export {

  AVAILABLE_LANGS,

  BUNDLED_LANGS,

  normalizeLangs,

} from './lang-utils.js';



const DEFAULT_SETTINGS = {

  langs: ['eng'],

  autoDetectLang: true,

  autoCopy: false,

  theme: 'system',

};



export async function getSettings() {

  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);

  const langs = normalizeLangs(

    Array.isArray(stored.langs) && stored.langs.length > 0

      ? stored.langs

      : DEFAULT_SETTINGS.langs

  );

  return {

    langs,

    autoDetectLang: stored.autoDetectLang ?? DEFAULT_SETTINGS.autoDetectLang,

    autoCopy:

      stored.autoCopy ?? (stored.showResultPopup === false),

    theme: stored.theme ?? DEFAULT_SETTINGS.theme,

  };

}



export async function saveSettings(settings) {

  await chrome.storage.sync.set({

    langs: normalizeLangs(settings.langs),

    autoDetectLang: Boolean(settings.autoDetectLang),

    autoCopy: settings.autoCopy,

    theme: settings.theme,

  });

}



export async function saveLanguageSettings({ langs, autoDetectLang }) {

  const current = await getSettings();

  await saveSettings({

    ...current,

    langs: normalizeLangs(langs),

    autoDetectLang: Boolean(autoDetectLang),

  });

  return getSettings();

}



export async function resetSettings() {

  await saveSettings(DEFAULT_SETTINGS);

  return { ...DEFAULT_SETTINGS, langs: normalizeLangs(DEFAULT_SETTINGS.langs) };

}



export { DEFAULT_SETTINGS };


