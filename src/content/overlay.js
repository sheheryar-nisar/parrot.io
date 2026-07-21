(() => {
  if (window.__parrotOverlayCleanup) {
    window.__parrotOverlayCleanup();
  }

  const HOST_ID = 'parrot-io-overlay-host';
  const MIN_SELECTION_PX = 8;
  const plog = (...args) => console.log('[Parrot.io][page]', ...args);

  let host = null;
  let shadow = null;
  let root = null;
  let selectionEl = null;
  let startPoint = null;
  let currentRect = null;
  let isSelecting = false;
  let escHandler = null;
  let overlayThemeUnwatch = null;
  let selectionFrameId = 0;
  let pendingSelectionRect = null;
  let loadingStageTimer = null;
  let activeLanguagePanel = null;
  let languageSettingsCssLoaded = false;

  const LOADING_STAGES = [
    'Initializing...',
    'Analyzing...',
    'Extracting...',
    'Finalizing...',
  ];

  function stopLoadingStages() {
    if (loadingStageTimer) {
      window.clearInterval(loadingStageTimer);
      loadingStageTimer = null;
    }
  }

  function hideLoading() {
    stopLoadingStages();
    const loadingEl = root?.querySelector('.parrot-loading');
    if (loadingEl) {
      loadingEl.remove();
    }
  }

  function applyOverlayTheme() {
    chrome.storage.sync.get({ theme: 'system' }, (stored) => {
      if (host) {
        host.setAttribute('data-theme', stored.theme || 'system');
      }
    });
  }

  function startOverlayThemeWatcher() {
    stopOverlayThemeWatcher();

    const onStorageChange = (changes, area) => {
      if (area === 'sync' && changes.theme && host) {
        host.setAttribute('data-theme', changes.theme.newValue ?? 'system');
      }
    };

    const onSystemChange = () => {
      chrome.storage.sync.get({ theme: 'system' }, (stored) => {
        if ((stored.theme || 'system') === 'system' && host) {
          host.setAttribute('data-theme', 'system');
        }
      });
    };

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    chrome.storage.onChanged.addListener(onStorageChange);
    mediaQuery.addEventListener('change', onSystemChange);

    overlayThemeUnwatch = () => {
      chrome.storage.onChanged.removeListener(onStorageChange);
      mediaQuery.removeEventListener('change', onSystemChange);
    };
  }

  function stopOverlayThemeWatcher() {
    if (overlayThemeUnwatch) {
      overlayThemeUnwatch();
      overlayThemeUnwatch = null;
    }
  }


  function cleanup() {
    hideLoading();
    closeLanguagePopup();
    cancelSelectionFrame();
    document.body.style.cursor = '';
    stopOverlayThemeWatcher();
    if (escHandler) {
      document.removeEventListener('keydown', escHandler, true);
      escHandler = null;
    }

    if (host?.parentNode) {
      host.parentNode.removeChild(host);
    }

    host = null;
    shadow = null;
    root = null;
    languageSettingsCssLoaded = false;
    selectionEl = null;
    startPoint = null;
    currentRect = null;
    isSelecting = false;
    window.__parrotOverlayActive = false;
    window.__parrotOverlayCleanup = null;
  }

  window.__parrotOverlayCleanup = cleanup;

  function createHost() {
    host = document.getElementById(HOST_ID) || document.createElement('div');
    host.id = HOST_ID;
    host.className = 'parrot-root';
    host.setAttribute('data-theme', 'system');
    document.documentElement.appendChild(host);
    shadow = host.attachShadow({ mode: 'closed' });

    const themeLink = document.createElement('link');
    themeLink.rel = 'stylesheet';
    themeLink.href = chrome.runtime.getURL('src/lib/theme-vars.css');
    shadow.appendChild(themeLink);

    const style = document.createElement('style');
    style.textContent = `
      :host { all: initial; }
      .parrot-overlay { position: fixed; inset: 0; z-index: 2147483646; cursor: crosshair; background: var(--overlay-scrim); user-select: none; }
      .parrot-selection { position: absolute; border: 2px solid var(--selection-border); background: var(--selection-fill); box-shadow: 0 0 0 9999px var(--overlay-scrim); pointer-events: none; }
      .parrot-hint { position: fixed; top: 16px; left: 50%; transform: translateX(-50%); z-index: 2147483647; padding: 8px 14px; border-radius: 999px; border: 3px solid var(--accent); box-sizing: border-box; background: var(--hint-bg); color: var(--text-on-dark); font: 500 13px/1.4 system-ui, sans-serif; pointer-events: none; }
      .parrot-modal-backdrop { position: fixed; inset: 0; z-index: 2147483646; background: var(--overlay-backdrop); }
      .parrot-modal { position: fixed; width: min(640px, calc(100vw - 48px)); max-height: min(70vh, 560px); display: flex; flex-direction: column; gap: 12px; padding: 16px; border-radius: 14px; background: var(--surface); color: var(--text); border: 1px solid var(--border); box-shadow: var(--modal-shadow); box-sizing: border-box; }
      .parrot-modal-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; cursor: grab; user-select: none; }
      .parrot-modal-header:active { cursor: grabbing; }
      .parrot-modal-header-text { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
      .parrot-modal-title { margin: 0; font: 600 16px/1.3 system-ui, sans-serif; color: var(--accent); }
      .parrot-modal-subtitle { margin: 0; color: var(--text-muted); font: 400 12px/1.4 system-ui, sans-serif; }
      .parrot-modal-actions { flex-shrink: 0; display: flex; align-items: center; gap: 8px; }
      .parrot-action-icon { flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; border: 0; border-radius: 50%; padding: 0; background: var(--border-subtle); color: var(--accent); cursor: pointer; transition: background 0.15s ease, color 0.15s ease; }
      .parrot-action-icon:hover:not(.copied) { background: var(--accent); color: #fff; }
      .parrot-action-icon svg { width: 18px; height: 18px; }
      .parrot-action-icon.copied { background: var(--accent); color: #fff; }
      .parrot-modal-footer { display: flex; justify-content: flex-end; align-items: center; gap: 8px; }
      .parrot-button { border: 0; border-radius: 10px; padding: 10px 14px; font: 600 13px/1 system-ui, sans-serif; cursor: pointer; }
      .parrot-button-primary { border: 1px solid var(--accent); background: var(--button-bg); color: var(--accent); }
      .parrot-button-primary:hover { background: var(--accent); color: #fff; }
      .parrot-button-secondary { background: var(--border-subtle); color: var(--text); }
      .parrot-button-secondary:hover { background: var(--border); }
      .parrot-result-text { width: 100%; min-height: 180px; max-height: 360px; resize: vertical; padding: 12px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface-subtle); color: var(--text); font: 400 14px/1.6 system-ui, sans-serif; unicode-bidi: plaintext; box-sizing: border-box; scrollbar-width: thin; scrollbar-color: var(--scrollbar-thumb) var(--scrollbar-track); }
      .parrot-result-text::-webkit-scrollbar { width: 8px; height: 8px; }
      .parrot-result-text::-webkit-scrollbar-track { background: var(--scrollbar-track); border-radius: 999px; }
      .parrot-result-text::-webkit-scrollbar-thumb { background: var(--scrollbar-thumb); border-radius: 999px; border: 2px solid transparent; background-clip: padding-box; }
      .parrot-result-text::-webkit-scrollbar-thumb:hover { background: var(--scrollbar-thumb-hover); }
      .parrot-toast { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); z-index: 2147483647; padding: 10px 16px; border-radius: 999px; background: var(--toast-bg); color: var(--text-on-dark); font: 500 13px/1.4 system-ui, sans-serif; }
      .parrot-toast-success { top: 16px; bottom: auto; background: var(--accent); color: #fff; }
      .parrot-lang-popup-backdrop { position: fixed; inset: 0; z-index: 2147483647; background: var(--overlay-backdrop); }
      .parrot-lang-popup { position: fixed; width: min(400px, calc(100vw - 48px)); padding: 16px; border-radius: 14px; background: var(--surface); color: var(--text); border: 1px solid var(--border); box-shadow: var(--modal-shadow); font-family: system-ui, sans-serif; box-sizing: border-box; }
      .parrot-lang-popup-header { cursor: grab; user-select: none; }
      .parrot-lang-popup-header:active { cursor: grabbing; }
      .parrot-lang-popup-title { margin: 0 0 12px; font: 600 16px/1.3 system-ui, sans-serif; color: var(--accent); }
      .parrot-lang-popup .custom-select-menu { z-index: 20; }
      .parrot-loading { position: fixed; inset: 0; z-index: 2147483647; display: flex; align-items: center; justify-content: center; background: var(--overlay-scrim-heavy); }
      .parrot-loading-card { display: flex; flex-direction: column; gap: 12px; min-width: 220px; padding: 16px 20px; border-radius: 12px; background: var(--loading-card-bg); backdrop-filter: blur(8px); border: 1px solid var(--loading-card-border); box-shadow: var(--loading-shadow); }
      .parrot-loading-label { margin: 0; font: 500 14px/1.4 system-ui, sans-serif; color: var(--loading-label-color); }
      .parrot-loading-track { height: 3px; border-radius: 999px; background: var(--loading-track); overflow: hidden; }
      .parrot-loading-bar { height: 100%; width: 40%; border-radius: 999px; background: linear-gradient(90deg, var(--accent-hover), var(--accent), var(--accent-hover)); animation: parrot-shimmer 1.2s ease-in-out infinite; }
      @keyframes parrot-shimmer { 0% { transform: translateX(-100%); } 100% { transform: translateX(350%); } }
    `;
    shadow.appendChild(style);
    root = document.createElement('div');
    shadow.appendChild(root);

    applyOverlayTheme();
    startOverlayThemeWatcher();
  }

  function ensureLanguageSettingsCss() {
    if (languageSettingsCssLoaded || !shadow) {
      return;
    }

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = chrome.runtime.getURL('src/lib/language-settings.css');
    shadow.appendChild(link);
    languageSettingsCssLoaded = true;
  }

  function closeLanguagePopup() {
    if (activeLanguagePanel) {
      activeLanguagePanel.destroy();
      activeLanguagePanel = null;
    }

    const popupBackdrop = root?.querySelector('.parrot-lang-popup-backdrop');
    if (popupBackdrop) {
      popupBackdrop.remove();
    }
  }

  async function showLanguagePopup() {
    if (!root || !shadow) {
      return;
    }

    ensureLanguageSettingsCss();

    if (root.querySelector('.parrot-lang-popup-backdrop')) {
      return;
    }

    const popupBackdrop = document.createElement('div');
    popupBackdrop.className = 'parrot-lang-popup-backdrop';

    const popup = document.createElement('div');
    popup.className = 'parrot-lang-popup';
    popup.style.visibility = 'hidden';

    const popupHeader = document.createElement('div');
    popupHeader.className = 'parrot-lang-popup-header';

    const popupTitle = document.createElement('h3');
    popupTitle.className = 'parrot-lang-popup-title';
    popupTitle.textContent = 'Language';

    const mount = document.createElement('div');
    mount.className = 'parrot-lang-popup-mount';

    popupHeader.appendChild(popupTitle);
    popup.appendChild(popupHeader);
    popup.appendChild(mount);
    popupBackdrop.appendChild(popup);
    root.appendChild(popupBackdrop);

    makeModalDraggable(popupHeader, popup);

    const onLangEsc = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        document.removeEventListener('keydown', onLangEsc, true);
        closeLanguagePopup();
      }
    };
    document.addEventListener('keydown', onLangEsc, true);

    popupBackdrop.addEventListener('click', (event) => {
      if (event.target === popupBackdrop) {
        document.removeEventListener('keydown', onLangEsc, true);
        closeLanguagePopup();
      }
    });

    popup.addEventListener('mousedown', (event) => {
      event.stopPropagation();
    });

    try {
      const { mountLanguageSettingsPanel } = await import(
        chrome.runtime.getURL('src/lib/language-settings-panel.js')
      );

      activeLanguagePanel = await mountLanguageSettingsPanel({
        container: mount,
        closeRoot: shadow,
        showSaveButton: true,
        onSaved: (result) => {
          document.removeEventListener('keydown', onLangEsc, true);
          if (result?.cancelled) {
            closeLanguagePopup();
            return;
          }
          closeLanguagePopup();
        },
      });

      requestAnimationFrame(() => {
        centerModal(popup);
        popup.style.visibility = '';
      });
    } catch (error) {
      document.removeEventListener('keydown', onLangEsc, true);
      closeLanguagePopup();
      showToast(error?.message || 'Could not open language settings.');
    }
  }

  function showToast(message, options = {}, durationMs = 2200) {
    hideLoading();
    const toast = document.createElement('div');
    toast.className = 'parrot-toast';
    if (options.variant === 'success') {
      toast.classList.add('parrot-toast-success');
    }
    toast.textContent = message;
    root.appendChild(toast);
    window.setTimeout(() => toast.remove(), durationMs);
  }

  function showLoading() {
    stopLoadingStages();
    root.innerHTML = '';

    const loading = document.createElement('div');
    loading.className = 'parrot-loading';

    const card = document.createElement('div');
    card.className = 'parrot-loading-card';

    const label = document.createElement('p');
    label.className = 'parrot-loading-label';

    const track = document.createElement('div');
    track.className = 'parrot-loading-track';

    const bar = document.createElement('div');
    bar.className = 'parrot-loading-bar';
    track.appendChild(bar);

    let stageIndex = 0;
    label.textContent = LOADING_STAGES[stageIndex];

    loadingStageTimer = window.setInterval(() => {
      if (stageIndex < LOADING_STAGES.length - 1) {
        stageIndex += 1;
        label.textContent = LOADING_STAGES[stageIndex];
      }
    }, 900);

    card.appendChild(label);
    card.appendChild(track);
    loading.appendChild(card);
    root.appendChild(loading);
  }

  function normalizeRect(start, end) {
    const x = Math.min(start.x, end.x);
    const y = Math.min(start.y, end.y);
    const width = Math.abs(end.x - start.x);
    const height = Math.abs(end.y - start.y);
    return { x, y, width, height };
  }

  function updateSelection(rect) {
    if (!selectionEl) return;
    selectionEl.style.left = `${rect.x}px`;
    selectionEl.style.top = `${rect.y}px`;
    selectionEl.style.width = `${rect.width}px`;
    selectionEl.style.height = `${rect.height}px`;
  }

  function scheduleSelectionUpdate(rect) {
    pendingSelectionRect = rect;
    if (selectionFrameId) {
      return;
    }

    selectionFrameId = window.requestAnimationFrame(() => {
      selectionFrameId = 0;
      if (pendingSelectionRect) {
        updateSelection(pendingSelectionRect);
        pendingSelectionRect = null;
      }
    });
  }

  function cancelSelectionFrame() {
    if (selectionFrameId) {
      window.cancelAnimationFrame(selectionFrameId);
      selectionFrameId = 0;
    }
    pendingSelectionRect = null;
  }

  function getTextareaCopyText(textarea) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    if (start !== end) {
      return textarea.value.slice(start, end);
    }
    return textarea.value;
  }

  async function copyText(text) {
    await navigator.clipboard.writeText(text);
  }

  function languageIconSvg() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.innerHTML =
      '<path d="m5 8 6 6"></path><path d="m4 14 6-6 2-3"></path><path d="M2 5h12"></path><path d="M7 2h1"></path><path d="m22 22-5-10-5 10"></path><path d="M14 18h6"></path>';
    return svg;
  }

  function restartIconSvg() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.innerHTML =
      '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"></path><path d="M21 3v5h-5"></path><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"></path><path d="M3 21v-5h5"></path>';
    return svg;
  }

  function clipboardIconSvg() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.innerHTML =
      '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>';
    return svg;
  }

  function makeModalDraggable(header, modal) {
    let dragging = false;
    let offsetX = 0;
    let offsetY = 0;

    const onMouseMove = (event) => {
      if (!dragging) return;
      const maxLeft = Math.max(0, window.innerWidth - modal.offsetWidth);
      const maxTop = Math.max(0, window.innerHeight - modal.offsetHeight);
      const left = Math.min(maxLeft, Math.max(0, event.clientX - offsetX));
      const top = Math.min(maxTop, Math.max(0, event.clientY - offsetY));
      modal.style.left = `${left}px`;
      modal.style.top = `${top}px`;
    };

    const onMouseUp = () => {
      dragging = false;
      document.removeEventListener('mousemove', onMouseMove, true);
      document.removeEventListener('mouseup', onMouseUp, true);
    };

    header.addEventListener('mousedown', (event) => {
      if (event.button !== 0 || event.target.closest('.parrot-action-icon')) {
        return;
      }
      dragging = true;
      const rect = modal.getBoundingClientRect();
      offsetX = event.clientX - rect.left;
      offsetY = event.clientY - rect.top;
      document.addEventListener('mousemove', onMouseMove, true);
      document.addEventListener('mouseup', onMouseUp, true);
      event.preventDefault();
    });
  }

  function centerModal(modal) {
    const rect = modal.getBoundingClientRect();
    modal.style.left = `${Math.max(0, (window.innerWidth - rect.width) / 2)}px`;
    modal.style.top = `${Math.max(0, (window.innerHeight - rect.height) / 2)}px`;
  }

  function showResultModal(text) {
    hideLoading();
    root.innerHTML = '';

    const backdrop = document.createElement('div');
    backdrop.className = 'parrot-modal-backdrop';

    const modal = document.createElement('div');
    modal.className = 'parrot-modal';

    const header = document.createElement('div');
    header.className = 'parrot-modal-header';

    const headerText = document.createElement('div');
    headerText.className = 'parrot-modal-header-text';

    const title = document.createElement('h2');
    title.className = 'parrot-modal-title';
    title.textContent = 'Parrot.io';

    const subtitle = document.createElement('p');
    subtitle.className = 'parrot-modal-subtitle';
    subtitle.textContent = `Extracted ${text.length} characters`;

    headerText.appendChild(title);
    headerText.appendChild(subtitle);

    const textarea = document.createElement('textarea');
    textarea.className = 'parrot-result-text';
    textarea.readOnly = true;
    textarea.dir = 'auto';
    textarea.value = text;

    const actions = document.createElement('div');
    actions.className = 'parrot-modal-actions';

    const languageButton = document.createElement('button');
    languageButton.type = 'button';
    languageButton.className = 'parrot-action-icon parrot-language-icon';
    languageButton.setAttribute('aria-label', 'Change language');
    languageButton.title = 'Change language';
    languageButton.appendChild(languageIconSvg());
    languageButton.addEventListener('click', (event) => {
      event.stopPropagation();
      showLanguagePopup();
    });

    const restartButton = document.createElement('button');
    restartButton.type = 'button';
    restartButton.className = 'parrot-action-icon parrot-restart-icon';
    restartButton.setAttribute('aria-label', 'Re-select');
    restartButton.title = 'Re-select';
    restartButton.appendChild(restartIconSvg());
    restartButton.addEventListener('click', (event) => {
      event.stopPropagation();
      cleanup();
      handleStartSelection();
    });

    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.className = 'parrot-action-icon parrot-copy-icon';
    copyButton.setAttribute('aria-label', 'Copy');
    copyButton.title = 'Copy';
    copyButton.appendChild(clipboardIconSvg());
    copyButton.addEventListener('click', async (event) => {
      event.stopPropagation();
      try {
        await copyText(getTextareaCopyText(textarea));
        copyButton.classList.add('copied');
        showToast('Copied!', { variant: 'success' });
        window.setTimeout(() => {
          copyButton.classList.remove('copied');
        }, 1200);
      } catch {
        showToast('Could not copy text to clipboard.');
      }
    });

    actions.appendChild(languageButton);
    actions.appendChild(restartButton);
    actions.appendChild(copyButton);

    header.appendChild(headerText);
    header.appendChild(actions);

    modal.appendChild(header);
    modal.appendChild(textarea);
    backdrop.appendChild(modal);
    root.appendChild(backdrop);

    centerModal(modal);
    makeModalDraggable(header, modal);

    modal.addEventListener('mousedown', (event) => {
      event.stopPropagation();
    });

    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) {
        cleanup();
      }
    });

    escHandler = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        cleanup();
      }
    };
    document.addEventListener('keydown', escHandler, true);
  }

  function getCaptureRect(rect) {
    return rect;
  }

  function waitForNextPaint() {
    return new Promise((resolve) => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(resolve);
      });
    });
  }

  async function finishSelection(rect) {
    const prevHostVisibility = host?.style.visibility ?? '';
    const prevCursor = document.body.style.cursor;
    let captureDoneListener = null;
    let captureUiRestored = false;

    if (host) {
      host.style.visibility = 'hidden';
    }
    document.body.style.cursor = 'wait';

    const showLoadingAfterCapture = () => {
      if (captureUiRestored || !host) {
        return;
      }
      host.style.visibility = '';
      showLoading();
    };

    const restoreCaptureUi = () => {
      if (captureDoneListener) {
        chrome.runtime.onMessage.removeListener(captureDoneListener);
        captureDoneListener = null;
      }
      document.body.style.cursor = prevCursor || '';
      if (host && !captureUiRestored) {
        host.style.visibility = prevHostVisibility || '';
      }
      captureUiRestored = true;
    };

    captureDoneListener = (message) => {
      if (message?.type !== 'PARROT_CAPTURE_DONE') {
        return false;
      }
      showLoadingAfterCapture();
      if (captureDoneListener) {
        chrome.runtime.onMessage.removeListener(captureDoneListener);
        captureDoneListener = null;
      }
      return false;
    };
    chrome.runtime.onMessage.addListener(captureDoneListener);

    await waitForNextPaint();

    plog('selection complete, sending PARROT_SELECTION_COMPLETE', rect);

    const captureRect = getCaptureRect(rect);

    chrome.runtime.sendMessage(
      {
        type: 'PARROT_SELECTION_COMPLETE',
        payload: {
          rect: captureRect,
          dpr: window.devicePixelRatio || 1,
        },
      },
      (response) => {
        restoreCaptureUi();

        if (chrome.runtime.lastError || !response?.ok) {
          plog('OCR response failed', {
            error: response?.error || chrome.runtime.lastError?.message,
          });
          hideLoading();
          showToast(
            response?.error ||
              chrome.runtime.lastError?.message ||
              'OCR failed. Please try again.'
          );
          window.setTimeout(cleanup, 2200);
          return;
        }

        const ocrText = (response.text || '').trim();
        const text =
          ocrText ||
          window.__parrotExtractListTextInRect?.(rect, HOST_ID)?.trim() ||
          window.__parrotExtractVisibleTextInRect?.(rect, HOST_ID)?.trim() ||
          '';
        plog('OCR response received', {
          ocrFn: response.ocrFn,
          chars: text.length,
          ocrChars: ocrText.length,
          usedListFallback: !ocrText && Boolean(text),
          elapsedMs: response.elapsedMs,
        });

        if (!text) {
          hideLoading();
          showToast('No text found in the selected area.');
          window.setTimeout(cleanup, 2200);
          return;
        }

        const showModal = () => {
          hideLoading();
          showResultModal(text);
        };

        if (response.autoCopy) {
          showModal();
          copyText(text)
            .then(() => showToast('Auto Copied!', { variant: 'success' }))
            .catch(() => showToast('Text extracted, but clipboard copy failed.'));
          return;
        }

        showModal();
      }
    );
  }

  function startSelectionUI() {
    window.__parrotOverlayActive = true;
    window.__parrotOverlayCleanup = cleanup;
    createHost();
    root.innerHTML = '';

    const overlay = document.createElement('div');
    overlay.className = 'parrot-overlay';

    const hint = document.createElement('div');
    hint.className = 'parrot-hint';
    hint.textContent = 'Drag to select an area. Press Esc to cancel.';

    selectionEl = document.createElement('div');
    selectionEl.className = 'parrot-selection';
    selectionEl.style.display = 'none';

    overlay.appendChild(selectionEl);
    root.appendChild(overlay);
    root.appendChild(hint);

    const onMouseDown = (event) => {
      if (event.button !== 0) return;
      isSelecting = true;
      startPoint = { x: event.clientX, y: event.clientY };
      currentRect = { x: startPoint.x, y: startPoint.y, width: 0, height: 0 };
      selectionEl.style.display = 'block';
      updateSelection(currentRect);
      event.preventDefault();
    };

    const onMouseMove = (event) => {
      if (!isSelecting || !startPoint) return;
      currentRect = normalizeRect(startPoint, { x: event.clientX, y: event.clientY });
      scheduleSelectionUpdate(currentRect);
    };

    const onMouseUp = async () => {
      if (!isSelecting || !currentRect) return;
      isSelecting = false;
      cancelSelectionFrame();

      overlay.removeEventListener('mousedown', onMouseDown);
      overlay.removeEventListener('mousemove', onMouseMove);
      overlay.removeEventListener('mouseup', onMouseUp);

      if (
        currentRect.width < MIN_SELECTION_PX ||
        currentRect.height < MIN_SELECTION_PX
      ) {
        showToast('Selection too small. Try again.');
        window.setTimeout(cleanup, 1600);
        return;
      }

      await finishSelection(currentRect);
    };

    overlay.addEventListener('mousedown', onMouseDown);
    overlay.addEventListener('mousemove', onMouseMove);
    overlay.addEventListener('mouseup', onMouseUp);

    escHandler = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        cleanup();
      }
    };
    document.addEventListener('keydown', escHandler, true);
  }

  function handleStartSelection() {
    try {
      if (window.__parrotOverlayActive) {
        cleanup();
      }
      startSelectionUI();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error?.message || 'Failed to start selection.' };
    }
  }

  window.__parrotStartSelection = handleStartSelection;

  if (!window.__parrotShortcutBound) {
    window.__parrotShortcutBound = true;
    const isMac = navigator.platform.toLowerCase().includes('mac');
    document.addEventListener(
      'keydown',
      (event) => {
        const modifier = isMac ? event.metaKey : event.ctrlKey;
        const isX = event.code === 'KeyX' || event.key?.toLowerCase() === 'x';
        if (modifier && event.shiftKey && !event.altKey && isX) {
          event.preventDefault();
          window.__parrotStartSelection?.();
        }
      },
      true
    );
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'PARROT_START_SELECTION') {
      sendResponse(handleStartSelection());
      return true;
    }

    return false;
  });

})();
