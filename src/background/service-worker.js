const OFFSCREEN_URL = 'src/offscreen/offscreen.html';

const MIN_SELECTION_PX = 8;

const USER_INVOCATION_TTL_MS = 5 * 60 * 1000;

const swlog = (...args) => console.log('[Parrot.io][sw]', ...args);



const BUNDLED_LANGS = [

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



const DEFAULT_SETTINGS = {

  langs: ['eng'],

  autoDetectLang: true,

  autoCopy: false,

};



let creatingOffscreen = null;

const userInvokedTabs = new Map();



function normalizeLangs(langs) {

  if (!Array.isArray(langs)) {

    return ['eng'];

  }

  const filtered = langs.filter((code) => BUNDLED_LANGS.includes(code));

  return filtered.length > 0 ? [filtered[0]] : ['eng'];

}



async function getSettings() {

  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);

  return {

    langs: normalizeLangs(

      Array.isArray(stored.langs) && stored.langs.length > 0

        ? stored.langs

        : DEFAULT_SETTINGS.langs

    ),

    autoDetectLang: stored.autoDetectLang ?? DEFAULT_SETTINGS.autoDetectLang,

    autoCopy:

      stored.autoCopy ?? (stored.showResultPopup === false),

  };

}



async function hasOffscreenDocument() {

  if (!chrome.runtime.getContexts) {

    return false;

  }



  try {

    const contexts = await chrome.runtime.getContexts({

      contextTypes: ['OFFSCREEN_DOCUMENT'],

      documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)],

    });

    return contexts.length > 0;

  } catch {

    return false;

  }

}



async function pingOffscreen() {

  return new Promise((resolve) => {

    chrome.runtime.sendMessage({ type: 'PARROT_OFFSCREEN_PING' }, (response) => {

      if (chrome.runtime.lastError) {

        resolve(false);

        return;

      }

      resolve(Boolean(response?.ready));

    });

  });

}



async function waitForOffscreenReady(maxAttempts = 40) {

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {

    if (await pingOffscreen()) {

      return true;

    }

    await new Promise((resolve) => setTimeout(resolve, 50));

  }

  return false;

}



async function ensureOffscreenDocument() {

  if (!(await hasOffscreenDocument())) {

    if (!creatingOffscreen) {

      creatingOffscreen = chrome.offscreen

        .createDocument({

          url: OFFSCREEN_URL,

          reasons: ['WORKERS'],

          justification: 'Run Tesseract.js OCR and canvas image cropping in a DOM context.',

        })

        .catch((error) => {

          const message = String(error?.message || error).toLowerCase();

          if (message.includes('only a single offscreen')) {

            return;

          }

          throw error;

        });

    }



    await creatingOffscreen;

    creatingOffscreen = null;

  }



  const ready = await waitForOffscreenReady();

  if (!ready) {

    throw new Error('OCR engine failed to start. Reload the extension and try again.');

  }

}



async function preloadOcrLangs(langs, { autoDetectLang = false } = {}) {

  try {

    await ensureOffscreenDocument();

    await new Promise((resolve) => {

      chrome.runtime.sendMessage(

        {

          type: 'PARROT_PRELOAD_LANGS',

          payload: {
            langs: normalizeLangs(langs),
            autoDetectLang,
          },

        },

        () => resolve()

      );

    });

  } catch (error) {

    swlog('preloadOcrLangs skipped', error?.message || error);

  }

}



function warmUpOcrEngine() {

  ensureOffscreenDocument()

    .then(() => getSettings())

    .then((settings) =>
      preloadOcrLangs(settings.autoDetectLang ? ['eng'] : settings.langs, {
        autoDetectLang: settings.autoDetectLang,
      })
    )

    .catch(() => {});

}



function isRestrictedUrl(url) {

  if (!url) return true;

  return (

    url.startsWith('chrome://') ||

    url.startsWith('chrome-extension://') ||

    url.startsWith('edge://') ||

    url.startsWith('about:') ||

    url.startsWith('https://chrome.google.com/webstore')

  );

}



function rememberUserInvokedTab(tab) {

  if (!tab?.id) {

    return;

  }



  userInvokedTabs.set(tab.id, Date.now());

}



function wasRecentlyUserInvoked(tab) {

  if (!tab?.id) {

    return false;

  }



  const invokedAt = userInvokedTabs.get(tab.id);

  if (!invokedAt) {

    return false;

  }



  if (Date.now() - invokedAt > USER_INVOCATION_TTL_MS) {

    userInvokedTabs.delete(tab.id);

    return false;

  }



  return true;

}



function isCapturePermissionError(error) {

  const message = String(error?.message || error).toLowerCase();

  return message.includes('<all_urls>') || message.includes('activetab');

}



async function captureTabScreenshot(tab) {

  if (!tab?.id || typeof tab.windowId !== 'number') {

    throw new Error('No active tab found for capture.');

  }



  if (isRestrictedUrl(tab.url)) {

    throw new Error('Cannot capture this page. Try a normal website.');

  }



  try {

    return await chrome.tabs.captureVisibleTab(tab.windowId, {

      format: 'png',

    });

  } catch (error) {

    if (isCapturePermissionError(error)) {

      const invokedHint = wasRecentlyUserInvoked(tab)

        ? 'Reload the extension after approving the updated permissions, then try again.'

        : 'Use the toolbar button, Ctrl+Shift+X, or reload the extension after approving the updated permissions.';

      throw new Error(`Cannot capture this page. ${invokedHint}`);

    }



    throw new Error(error?.message || 'Capture failed.');

  }

}



async function getActiveTab() {

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  return tab;

}



async function injectOverlay(tabId) {

  await chrome.scripting.insertCSS({

    target: { tabId },

    files: ['src/content/overlay.css'],

  });



  await chrome.scripting.executeScript({

    target: { tabId },

    files: ['src/lib/extract-dom-text.js', 'src/content/overlay.js'],

  });

}



async function sendToTab(tabId, message) {

  try {

    return await chrome.tabs.sendMessage(tabId, message);

  } catch {

    return null;

  }

}



async function startSelection(tab) {

  if (!tab?.id) {

    return { ok: false, error: 'No active tab found.' };

  }



  if (isRestrictedUrl(tab.url)) {

    return {

      ok: false,

      error: 'Parrot.io cannot run on this page. Try a normal website.',

    };

  }



  try {

    await injectOverlay(tab.id);

    const response = await sendToTab(tab.id, { type: 'PARROT_START_SELECTION' });

    if (!response?.ok) {

      return { ok: false, error: response?.error || 'Could not start selection overlay.' };

    }

    return { ok: true };

  } catch (error) {

    return { ok: false, error: error?.message || 'Failed to inject selection overlay.' };

  }

}



async function requestSelection(tab) {

  if (!tab?.id) {

    return { ok: false, error: 'No active tab found.' };

  }



  if (isRestrictedUrl(tab.url)) {

    return {

      ok: false,

      error: 'Parrot.io cannot run on this page. Try a normal website.',

    };

  }



  const response = await sendToTab(tab.id, { type: 'PARROT_START_SELECTION' });

  if (response?.ok) {

    return response;

  }



  return startSelection(tab);

}



async function runOcr(payload) {

  await ensureOffscreenDocument();



  for (let attempt = 0; attempt < 3; attempt += 1) {

    const response = await new Promise((resolve) => {

      chrome.runtime.sendMessage(

        {

          type: 'PARROT_RUN_OCR',

          target: 'offscreen',

          payload,

        },

        (result) => {

          if (chrome.runtime.lastError) {

            resolve({ ok: false, error: chrome.runtime.lastError.message, retry: true });

            return;

          }

          resolve(result || { ok: false, error: 'No OCR response.', retry: true });

        }

      );

    });



    if (!response.retry) {

      return response;

    }



    await waitForOffscreenReady(10);

  }



  return { ok: false, error: 'OCR engine is not responding. Reload the extension and try again.' };

}



const OPTIONS_PAGE_URL = chrome.runtime.getURL('src/options/options.html');



async function openOptionsPage() {

  const existingTabs = await chrome.tabs.query({ url: OPTIONS_PAGE_URL });

  if (existingTabs.length > 0) {
    const tab = existingTabs[0];
    await chrome.tabs.update(tab.id, { active: true });
    if (typeof tab.windowId === 'number') {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
    return { ok: true };
  }

  await chrome.tabs.create({ url: OPTIONS_PAGE_URL });

  return { ok: true };

}



chrome.runtime.onInstalled.addListener(() => {

  warmUpOcrEngine();

});



chrome.runtime.onStartup.addListener(() => {

  warmUpOcrEngine();

});



warmUpOcrEngine();



chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  if (message?.type === 'PARROT_START_SELECTION') {

    const tabPromise = sender.tab ? Promise.resolve(sender.tab) : getActiveTab();



    tabPromise

      .then((tab) => {

        if (message.userInvoked) {

          rememberUserInvokedTab(tab);

        }

        return requestSelection(tab);

      })

      .then(sendResponse)

      .catch((error) => {

        sendResponse({ ok: false, error: error?.message || 'Failed to start selection.' });

      });

    return true;

  }



  if (message?.type === 'PARROT_OPEN_OPTIONS') {

    openOptionsPage()

      .then(sendResponse)

      .catch((error) => {

        sendResponse({ ok: false, error: error?.message || 'Could not open Settings.' });

      });

    return true;

  }



  if (message?.type === 'PARROT_PRELOAD_LANGS') {

    const payload = message.payload || {};

    preloadOcrLangs(payload.langs || ['eng'], {
      autoDetectLang: Boolean(payload.autoDetectLang),
    })

      .then(() => sendResponse({ ok: true }))

      .catch((error) => {

        sendResponse({ ok: false, error: error?.message || 'Preload failed.' });

      });

    return true;

  }



  if (message?.type === 'PARROT_SELECTION_COMPLETE') {

    (async () => {

      const tab = sender.tab;

      const { rect, dpr } = message.payload || {};



      if (typeof tab?.windowId !== 'number' || !rect) {

        sendResponse({ ok: false, error: 'Invalid selection.' });

        return;

      }



      if (rect.width < MIN_SELECTION_PX || rect.height < MIN_SELECTION_PX) {

        sendResponse({ ok: false, error: 'Selection is too small. Drag a larger area.' });

        return;

      }



      const flowStartedAt = Date.now();



      try {

        swlog('PARROT_SELECTION_COMPLETE capture start', { rect, dpr });

        const dataUrl = await captureTabScreenshot(tab);

        if (typeof tab.id === 'number') {
          try {
            chrome.tabs.sendMessage(tab.id, { type: 'PARROT_CAPTURE_DONE' }, () => {
              void chrome.runtime.lastError;
            });
          } catch {
            // Ignore notify failures; OCR should still proceed.
          }
        }

        const settings = await getSettings();



        if (settings.langs.length === 0) {

          sendResponse({

            ok: false,

            error: 'No valid language selected. Choose a bundled language in Settings.',

          });

          return;

        }



        swlog('OCR dispatch', {

          langs: settings.langs,

        });



        const ocrResult = await runOcr({ dataUrl, rect, dpr, settings });

        const totalElapsedMs = Date.now() - flowStartedAt;



        if (!ocrResult.ok) {

          swlog('OCR failed', { error: ocrResult.error, elapsedMs: totalElapsedMs });

          sendResponse({ ok: false, error: ocrResult.error || 'OCR failed.' });

          return;

        }



        swlog('OCR success', {

          ocrFn: ocrResult.ocrFn,

          chars: (ocrResult.text || '').length,

          ocrElapsedMs: ocrResult.elapsedMs,

          totalElapsedMs,

        });



        sendResponse({

          ok: true,

          text: ocrResult.text || '',

          autoCopy: settings.autoCopy,

          ocrFn: ocrResult.ocrFn,

          elapsedMs: totalElapsedMs,

        });

      } catch (error) {

        swlog('OCR error', {

          error: error?.message || error,

          elapsedMs: Date.now() - flowStartedAt,

        });

        sendResponse({ ok: false, error: error?.message || 'Capture or OCR failed.' });

      }

    })();



    return true;

  }



  return false;

});



chrome.commands.onCommand.addListener((command) => {

  if (command !== 'start-selection') {

    return;

  }



  getActiveTab()

    .then((tab) => {

      rememberUserInvokedTab(tab);

      return requestSelection(tab);

    })

    .catch(() => {});

});


