import {
  DEFAULT_SETTINGS,
  getSettings,
  normalizeLangs,
  saveSettings,
} from '../lib/settings.js';

import { createCustomSelect } from '../lib/custom-select.js';

import { mountLanguageSettingsPanel } from '../lib/language-settings-panel.js';

import { applyTheme, watchTheme } from '../lib/theme.js';



const THEME_OPTIONS = [
  { value: 'system', label: 'Browser default' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];



const form = document.getElementById('settings-form');

const themeContainer = document.querySelector('[data-select-id="theme"]');

const languageMount = document.getElementById('language-settings-mount');

const autoCopyCheckbox = document.getElementById('auto-copy');

const resetButton = document.getElementById('reset-button');

const saveButton = document.getElementById('save-button');



let themeSelect;

let languagePanel;

let baselineSettings = null;



function preloadOcrFromLanguage({ langs, autoDetectLang }) {
  chrome.runtime.sendMessage({
    type: 'PARROT_PRELOAD_LANGS',
    payload: {
      langs: autoDetectLang ? ['eng'] : langs,
      autoDetectLang,
    },
  });
}



function snapshotSettings(settings) {
  const langs = normalizeLangs(
    Array.isArray(settings.langs) && settings.langs.length > 0
      ? settings.langs
      : DEFAULT_SETTINGS.langs
  );

  return {
    langs,
    autoDetectLang: Boolean(settings.autoDetectLang),
    autoCopy: Boolean(settings.autoCopy),
    theme: settings.theme || DEFAULT_SETTINGS.theme,
  };
}



function getFormSettings() {
  const { langs, autoDetectLang } = languagePanel.getLanguageValues();
  return snapshotSettings({
    langs,
    autoDetectLang,
    autoCopy: autoCopyCheckbox.checked,
    theme: themeSelect.value,
  });
}



function settingsEqual(a, b) {
  if (!a || !b) {
    return false;
  }

  return (
    a.theme === b.theme &&
    a.autoCopy === b.autoCopy &&
    a.autoDetectLang === b.autoDetectLang &&
    a.langs.join(',') === b.langs.join(',')
  );
}



function setSaveEnabled(enabled) {
  saveButton.disabled = !enabled;
}

function setResetEnabled(enabled) {
  resetButton.disabled = !enabled;
}



function syncDirtyState() {
  if (!languagePanel || !themeSelect || !baselineSettings) {
    setSaveEnabled(false);
    setResetEnabled(false);
    return;
  }

  const currentSettings = getFormSettings();
  setSaveEnabled(!settingsEqual(currentSettings, baselineSettings));
  setResetEnabled(!settingsEqual(currentSettings, snapshotSettings(DEFAULT_SETTINGS)));
}



function rememberBaseline(settings) {
  baselineSettings = snapshotSettings(settings);
  syncDirtyState();
}



function initThemeSelect() {
  themeSelect = createCustomSelect({
    container: themeContainer,
    options: THEME_OPTIONS,
    value: 'system',
    onChange: () => {
      syncDirtyState();
    },
  });
}



async function initLanguagePanel() {
  languagePanel = await mountLanguageSettingsPanel({
    container: languageMount,
    closeRoot: document,
    showSaveButton: false,
    onChange: () => {
      syncDirtyState();
    },
  });
}



function applySettingsToForm(settings) {
  themeSelect.setValue(settings.theme || DEFAULT_SETTINGS.theme);
  applyTheme(settings.theme);
  languagePanel.applyFromSettings(settings);
  autoCopyCheckbox.checked = settings.autoCopy;
  rememberBaseline(settings);
}



async function loadSettings() {
  const settings = await getSettings();
  applySettingsToForm(settings);
}



autoCopyCheckbox.addEventListener('change', () => {
  syncDirtyState();
});



resetButton.addEventListener('click', () => {
  themeSelect.setValue(DEFAULT_SETTINGS.theme);
  applyTheme(DEFAULT_SETTINGS.theme);
  languagePanel.applyFromSettings(DEFAULT_SETTINGS);
  autoCopyCheckbox.checked = DEFAULT_SETTINGS.autoCopy;
  syncDirtyState();
});



form.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (saveButton.disabled) {
    return;
  }

  const { langs, autoDetectLang } = languagePanel.getLanguageValues();
  if (langs.length === 0) {
    return;
  }

  const theme = themeSelect.value;
  const nextSettings = snapshotSettings({
    langs,
    autoDetectLang,
    autoCopy: autoCopyCheckbox.checked,
    theme,
  });

  await saveSettings(nextSettings);

  preloadOcrFromLanguage({ langs, autoDetectLang });
  applyTheme(theme);
  rememberBaseline(nextSettings);
});



chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync' || !languagePanel) {
    return;
  }

  if (changes.langs || changes.autoDetectLang || changes.autoCopy || changes.theme) {
    getSettings().then((settings) => {
      if (!settingsEqual(getFormSettings(), baselineSettings)) {
        // Keep local dirty edits; only refresh baseline language panel when clean.
        return;
      }
      applySettingsToForm(settings);
    });
  }
});



setSaveEnabled(false);
setResetEnabled(false);
initThemeSelect();
watchTheme(applyTheme);
initLanguagePanel().then(loadSettings);
