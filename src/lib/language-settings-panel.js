import {
  AVAILABLE_LANGS,
  BUNDLED_LANGS,
  normalizeLangs,
} from './lang-utils.js';
import { getSettings, saveLanguageSettings } from './settings.js';
import { createCustomSelect } from './custom-select.js';

const bundledLangSet = new Set(BUNDLED_LANGS);

const LANGUAGE_OPTIONS = AVAILABLE_LANGS.filter((lang) => bundledLangSet.has(lang.code)).map(
  (lang) => ({ value: lang.code, label: lang.label })
);

function preloadOcrLangs({ langs, autoDetectLang }) {
  chrome.runtime.sendMessage({
    type: 'PARROT_PRELOAD_LANGS',
    payload: {
      langs: autoDetectLang ? ['eng'] : langs,
      autoDetectLang,
    },
  });
}

export async function mountLanguageSettingsPanel({
  container,
  closeRoot = document,
  showSaveButton = true,
  onSaved,
}) {
  container.innerHTML = '';

  const panel = document.createElement('div');
  panel.className = 'language-settings-panel';

  const autoDetectSection = document.createElement('section');
  autoDetectSection.className = 'field checkbox-field';

  const autoDetectLabel = document.createElement('label');
  autoDetectLabel.className = 'checkbox-row';
  autoDetectLabel.setAttribute('for', 'parrot-auto-detect-lang');

  const autoDetectCheckbox = document.createElement('input');
  autoDetectCheckbox.id = 'parrot-auto-detect-lang';
  autoDetectCheckbox.type = 'checkbox';

  const autoDetectText = document.createElement('span');
  autoDetectText.textContent = 'Auto-detect language';

  autoDetectLabel.appendChild(autoDetectCheckbox);
  autoDetectLabel.appendChild(autoDetectText);

  const autoDetectHelp = document.createElement('p');
  autoDetectHelp.className = 'help';
  autoDetectHelp.textContent =
    'When on, the language is detected automatically for each capture.';

  autoDetectSection.appendChild(autoDetectLabel);
  autoDetectSection.appendChild(autoDetectHelp);

  const languageSection = document.createElement('section');
  languageSection.className = 'field';

  const languageLabel = document.createElement('label');
  languageLabel.setAttribute('for', 'parrot-language');
  languageLabel.className = 'label';
  languageLabel.textContent = 'Language';

  const languageContainer = document.createElement('div');
  languageContainer.className = 'custom-select';
  languageContainer.dataset.selectId = 'language';
  languageContainer.innerHTML = `
    <button type="button" class="custom-select-trigger" aria-haspopup="listbox" aria-expanded="false">
      <span class="custom-select-label"></span>
    </button>
    <ul class="custom-select-menu" role="listbox" hidden></ul>
    <input type="hidden" name="lang" value="eng" />
  `;

  const languageError = document.createElement('p');
  languageError.className = 'help error';
  languageError.hidden = true;

  const languageHelp = document.createElement('p');
  languageHelp.className = 'help';
  languageHelp.id = 'parrot-language-help';

  languageSection.appendChild(languageLabel);
  languageSection.appendChild(languageContainer);
  languageSection.appendChild(languageError);
  languageSection.appendChild(languageHelp);

  panel.appendChild(autoDetectSection);
  panel.appendChild(languageSection);

  let actions = null;
  let cancelButton = null;
  let saveButton = null;

  if (showSaveButton) {
    actions = document.createElement('div');
    actions.className = 'language-settings-actions';

    cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'secondary-button';
    cancelButton.textContent = 'Cancel';

    saveButton = document.createElement('button');
    saveButton.type = 'button';
    saveButton.className = 'primary-button';
    saveButton.textContent = 'Save';

    actions.appendChild(cancelButton);
    actions.appendChild(saveButton);
    panel.appendChild(actions);
  }

  container.appendChild(panel);

  const languageSelect = createCustomSelect({
    container: languageContainer,
    options: LANGUAGE_OPTIONS,
    value: 'eng',
    closeRoot,
  });

  function showLanguageError(message) {
    languageError.textContent = message || '';
    languageError.hidden = !message;
  }

  function syncLanguageFieldState() {
    const autoDetect = autoDetectCheckbox.checked;
    languageSelect.setDisabled(autoDetect);
    if (autoDetect) {
      languageHelp.textContent = 'Language is detected automatically for each capture.';
      languageHelp.hidden = false;
    } else {
      languageHelp.textContent = '';
      languageHelp.hidden = true;
    }
  }

  function getLanguageValues() {
    return {
      langs: normalizeLangs([languageSelect.value]),
      autoDetectLang: autoDetectCheckbox.checked,
    };
  }

  async function applyFromSettings(settings) {
    languageSelect.setValue(normalizeLangs(settings.langs)[0] || 'eng');
    autoDetectCheckbox.checked = Boolean(settings.autoDetectLang);
    syncLanguageFieldState();
  }

  async function saveAndPreload() {
    const { langs, autoDetectLang } = getLanguageValues();
    if (langs.length === 0) {
      showLanguageError('Selected language is not available offline.');
      return false;
    }

    showLanguageError('');
    await saveLanguageSettings({ langs, autoDetectLang });
    preloadOcrLangs({ langs, autoDetectLang });

    if (onSaved) {
      onSaved();
    }

    return true;
  }

  autoDetectCheckbox.addEventListener('change', syncLanguageFieldState);

  const settings = await getSettings();
  await applyFromSettings(settings);

  const destroyCallbacks = [];

  if (showSaveButton && saveButton && cancelButton) {
    const onSaveClick = async (event) => {
      event.preventDefault();
      await saveAndPreload();
    };
    const onCancelClick = (event) => {
      event.preventDefault();
      if (onSaved) {
        onSaved({ cancelled: true });
      }
    };

    saveButton.addEventListener('click', onSaveClick);
    cancelButton.addEventListener('click', onCancelClick);
    destroyCallbacks.push(() => {
      saveButton.removeEventListener('click', onSaveClick);
      cancelButton.removeEventListener('click', onCancelClick);
    });
  }

  return {
    applyFromSettings,
    getLanguageValues,
    saveAndPreload,
    destroy() {
      for (const unbind of destroyCallbacks) {
        unbind();
      }
      languageSelect.destroy();
      container.innerHTML = '';
    },
  };
}
