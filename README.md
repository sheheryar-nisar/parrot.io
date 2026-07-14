# Parrot.io

**Parrot.io** is a Chrome extension that lets you select any area on a webpage, run OCR on that region, and copy the extracted text. It works on visible text, images, canvas content, and other pixel-based content.

## Features

- Select a region with a drag overlay (toolbar icon or **Ctrl+Shift+X**)
- Offline OCR via bundled **Tesseract.js** (default)
- Optional experimental **Browser OCR** with automatic Tesseract fallback
- Configurable languages (bundled offline packs)
- Result popup with manual **Copy** (default), or **Auto Copy** to clipboard plus popup
- Works on images and screenshots embedded in pages

## Install (unpacked)

1. Open `chrome://extensions` or `edge://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this project folder (`Parrot.io`)

## Usage

1. Open any normal `http://` or `https://` page
2. Trigger selection using any of these:
   - Click the **Parrot.io** toolbar icon, then **Select area**
   - Press **Ctrl+Shift+X** (**Cmd+Shift+X** on macOS; configure in `chrome://extensions/shortcuts`)
3. Drag a rectangle over the text or image you want to read
4. Wait for OCR to finish
5. Review text in the popup; enable **Auto Copy** in settings to copy automatically as well

Press **Esc** to cancel selection.

## Settings

Open extension settings from the popup link or `chrome://extensions` → Parrot.io → **Details** → **Extension options**.

- **Theme**: Browser default (follows OS), Light, or Dark
- **OCR Engine**: Tesseract.js (offline, default) or Browser OCR (experimental)
- **Languages**: choose one or more bundled language packs (English by default). For non-Latin text (Arabic, Urdu, Hindi, Chinese, Japanese, Korean), select the matching language in settings — not English alone — for best results.
- **Auto Copy**: off by default; when on, copies extracted text to the clipboard and still shows the result dialog

## Project structure

```
manifest.json
src/
  background/service-worker.js
  content/overlay.js
  content/overlay.css
  offscreen/offscreen.html
  offscreen/offscreen.js
  popup/
  options/
  lib/settings.js
  lib/tesseract/
icons/
```

## Development

Tesseract runtime files are copied from `tesseract.js` npm package. Language packs are downloaded from the tessdata CDN during setup.

To refresh Tesseract assets after updating npm packages:

```powershell
npm run setup:tesseract
```

## Limitations

- Does not run on restricted pages (`chrome://`, `edge://`, browser New Tab, Chrome Web Store, extension pages)
- OCR quality depends on image clarity, font size, and contrast
- Browser OCR is experimental and may not be available in all Chrome versions

## Privacy

OCR runs locally in your browser. Selected screenshots and extracted text are not sent to any server by this extension.
