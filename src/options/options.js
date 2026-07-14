import {

  DEFAULT_SETTINGS,

  getSettings,

  normalizeLangs,

  resetSettings,

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



const UPDATE_LABEL = 'Update';

const UPDATED_LABEL = 'Updated!';

const RESET_LABEL = 'Reset';

const RESET_DONE_LABEL = 'Reset!';

const FEEDBACK_MS = 1500;



function showButtonFeedback(button, doneLabel, defaultLabel) {

  button.textContent = doneLabel;

  button.classList.add('updated');

  window.clearTimeout(button.feedbackTimeoutId);

  button.feedbackTimeoutId = window.setTimeout(() => {

    button.textContent = defaultLabel;

    button.classList.remove('updated');

  }, FEEDBACK_MS);

}



function showUpdated() {

  showButtonFeedback(saveButton, UPDATED_LABEL, UPDATE_LABEL);

}



function preloadOcrFromLanguage({ langs, autoDetectLang }) {

  chrome.runtime.sendMessage({

    type: 'PARROT_PRELOAD_LANGS',

    payload: {

      langs: autoDetectLang ? ['eng'] : langs,

      autoDetectLang,

    },

  });

}



function initThemeSelect() {

  themeSelect = createCustomSelect({

    container: themeContainer,

    options: THEME_OPTIONS,

    value: 'system',

  });

}



async function initLanguagePanel() {

  languagePanel = await mountLanguageSettingsPanel({

    container: languageMount,

    closeRoot: document,

    showSaveButton: false,

  });

}



function applySettingsToForm(settings) {

  themeSelect.setValue(settings.theme || DEFAULT_SETTINGS.theme);

  applyTheme(settings.theme);

  languagePanel.applyFromSettings(settings);

  autoCopyCheckbox.checked = settings.autoCopy;

}



async function loadSettings() {

  const settings = await getSettings();

  applySettingsToForm(settings);

}



resetButton.addEventListener('click', async () => {

  const settings = await resetSettings();

  applySettingsToForm(settings);

  const { langs, autoDetectLang } = languagePanel.getLanguageValues();

  preloadOcrFromLanguage({ langs, autoDetectLang });

  showButtonFeedback(resetButton, RESET_DONE_LABEL, RESET_LABEL);

});



form.addEventListener('submit', async (event) => {

  event.preventDefault();



  const { langs, autoDetectLang } = languagePanel.getLanguageValues();

  if (langs.length === 0) {

    return;

  }



  const theme = themeSelect.value;



  await saveSettings({

    langs,

    autoDetectLang,

    autoCopy: autoCopyCheckbox.checked,

    theme,

  });



  preloadOcrFromLanguage({ langs, autoDetectLang });



  applyTheme(theme);

  showUpdated();

});



chrome.storage.onChanged.addListener((changes, area) => {

  if (area !== 'sync' || !languagePanel) {

    return;

  }



  if (changes.langs || changes.autoDetectLang) {

    getSettings().then((settings) => {

      languagePanel.applyFromSettings(settings);

    });

  }

});



initThemeSelect();

watchTheme(applyTheme);

initLanguagePanel().then(loadSettings);


