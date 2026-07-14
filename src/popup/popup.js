import { applyTheme, watchTheme } from '../lib/theme.js';

const selectButton = document.getElementById('select-area');
const settingsLink = document.getElementById('open-settings');

watchTheme(applyTheme);

function setStatus(message) {
  let status = document.querySelector('.status');
  if (!status) {
    status = document.createElement('p');
    status.className = 'status';
    document.querySelector('.popup').appendChild(status);
  }
  status.textContent = message;
}

selectButton.addEventListener('click', () => {
  selectButton.disabled = true;
  setStatus('');

  chrome.runtime.sendMessage(
    { type: 'PARROT_START_SELECTION', userInvoked: true },
    (response) => {
      selectButton.disabled = false;

      if (chrome.runtime.lastError) {
        setStatus(chrome.runtime.lastError.message || 'Could not start selection.');
        return;
      }

      if (!response?.ok) {
        setStatus(response?.error || 'Could not start selection.');
        return;
      }

      window.close();
    }
  );
});

settingsLink.addEventListener('click', (event) => {
  event.preventDefault();
  chrome.runtime.openOptionsPage();
});
