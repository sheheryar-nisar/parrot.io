# Parrot.io

**Parrot.io** (Select. Extract. Copy) Turn anything you see in your browser into editable text. Simply select an area to extract and copy text from images, PDFs, videos, diagrams, screenshots, and canvas-based content using fast multilingual OCR.

## Features

- Select a region with a drag overlay (popup **Select Area** or **Ctrl+Shift+X** / **Cmd+Shift+X** on macOS)
- Offline OCR via bundled **Tesseract.js**
- Auto-detect language by default (OSD), or choose one bundled language pack
- Theme: browser default, light, or dark
- Result dialog with copy, re-select, and language controls; optional **Auto Copy** to clipboard
- DOM-text fallback when OCR returns little or no text
- Works on images and screenshots embedded in pages

## Install (unpacked)

1. Run `npm install` and `npm run setup:tesseract` (required for OCR language packs and auto-detect)
2. Open `chrome://extensions` or `edge://extensions`
3. Enable **Developer mode**
4. Click **Load unpacked**
5. Select this project folder (`parrot.io`)

## Usage

1. Open any normal `http://` or `https://` page
2. Trigger selection using either:
   - Click the **Parrot.io** toolbar icon, then **Select Area**
   - Press **Ctrl+Shift+X** (**Cmd+Shift+X** on macOS; remap in `chrome://extensions/shortcuts` or `edge://extensions/shortcuts`)
3. Drag a rectangle over the text or image you want to read
4. Wait for OCR to finish
5. Review text in the result dialog; enable **Auto Copy** in settings to also copy automatically

Press **Esc** to cancel selection.

## Settings

Open extension settings from the popup **Settings...** link or `chrome://extensions` → Parrot.io → **Details** → **Extension options**.

- **Theme**: Browser default (follows OS), Light, or Dark
- **Auto-detect language**: on by default; when off, pick one bundled language
- **Language** (when auto-detect is off): English, Spanish, French, German, Italian, Portuguese, Chinese (Simplified), Japanese, Korean, Arabic, Urdu, or Hindi. For non-Latin text, choose the matching language — not English alone — for best results
- **Auto Copy**: off by default; when on, copies extracted text to the clipboard and still shows the result dialog

## Project structure

```
manifest.json
package.json
icons/
scripts/
  setup-tesseract.ps1
  generate-icons.js
src/
  background/service-worker.js
  content/overlay.js
  content/overlay.css
  offscreen/
  popup/
  options/
  lib/
    settings.js
    lang-utils.js
    theme.js
    extract-dom-text.js
    language-settings-panel.js
    tesseract/
```

## Development

Tesseract runtime files are copied from the `tesseract.js` npm package. Language packs (including OSD for auto-detect) are downloaded from the tessdata CDN during setup.

```powershell
npm install
npm run setup:tesseract
```

Optional: regenerate toolbar icons from `icons/icon.svg`:

```powershell
npm run generate:icons
```

After updating `tesseract.js`, re-run `npm run setup:tesseract` to refresh bundled assets.

## Limitations

- Does not run on restricted pages (`chrome://`, `edge://`, `about:`, browser New Tab, Chrome Web Store, extension pages)
- OCR quality depends on image clarity, font size, and contrast
- Keyboard command shortcuts are managed by the browser; remap them in extension shortcuts if the default is unavailable (for example on some Edge setups)

## Privacy

OCR runs locally in your browser. Selected screenshots and extracted text are not sent to any server by this extension.
