export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme || 'system');
}

export function watchTheme(onChange) {
  chrome.storage.sync.get({ theme: 'system' }, (stored) => {
    onChange(stored.theme || 'system');
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.theme) {
      onChange(changes.theme.newValue ?? 'system');
    }
  });

  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  mediaQuery.addEventListener('change', () => {
    chrome.storage.sync.get({ theme: 'system' }, (stored) => {
      if ((stored.theme || 'system') === 'system') {
        onChange('system');
      }
    });
  });
}
