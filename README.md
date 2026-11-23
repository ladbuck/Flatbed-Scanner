# Flatbed Scanner

A document scanner that runs entirely in the browser, with the features you'd usually pay for in scanner apps. No server, no account, no build step: it is a static site.

## Features

- **Scan** with the phone camera or from photos: automatic page-edge detection, draggable corners with a zoom loupe, perspective correction with true aspect ratio, batch scanning
- **Scan looks**: Original, Magic Color, No Shadow, Lighten, Grayscale, B&W, plus brightness, contrast and sharpen
- **Special modes**: ID card (front and back on one A4 page), book scan (splits a two-page spread), QR code and barcode reader
- **Text recognition (OCR)** on the device in English, Nepali and Hindi; full-text search across all scans
- **Edit**: pen, highlighter, text, white-out/redact boxes, signatures (drawn or lifted from a photo), rotate, reorder, merge, split, duplicate
- **Export**: PDF (searchable text layer, AES-256 password protection, watermarks, A4/Letter/Legal/fit, margins, quality), JPG, PNG (multi-page as ZIP), Word (.docx), plain text, one long stitched image
- **Import PDFs** (keeps their text), drag-and-drop and paste images
- Folders, stars, sorting, light and dark themes
- **Installable app** (Add to Home Screen) that works offline; text recognition data is saved for offline use the first time you use it

Scans keep full camera resolution while you work (photos above 16 megapixels are scaled to 16 MP to stay within phone memory). The original photo is stored untouched; quality is only reduced at export, where you choose Original, High, Medium or Small.

Scans are stored in the browser (IndexedDB) on the device that made them. Nothing is uploaded unless you export it.

When the same page is opened as a Claude artifact, it also gets private cloud backup and sync, and "Ask Claude" tools (summarize, translate, transcribe handwriting, Q&A). Those features switch off automatically elsewhere.

## Deploy on Vercel

1. Push this repository to GitHub.
2. In Vercel choose **Add New → Project**, import the repository, keep the framework preset as **Other** with no build command, and deploy.

`vercel.json` adds caching for `lib/`, keeps `sw.js` and the manifest fresh, and sets a few security headers. If you change anything in `lib/`, bump `VERSION` in `sw.js` so installed copies pick it up.

## Develop

Edit files in `src/` and rebuild `index.html`:

```sh
python3 build.py
python3 -m http.server 8000   # then open http://localhost:8000
```

Serve over HTTP rather than opening the file directly: workers and the OCR data need a real origin.

| Path | What it holds |
|---|---|
| `src/shell.html`, `src/styles.css` | Page skeleton and styles |
| `src/js/20-imgproc.js` | Edge detection, perspective warp, filters (runs in a Web Worker) |
| `src/js/30-export.js` | PDF writer with AES-256 encryption, ZIP and DOCX writers |
| `src/js/40-libs.js` | OCR, PDF import, QR decoding |
| `src/js/50-cloud.js`, `67-ai.js` | Claude-only backup and AI tools |
| `src/js/6*.js` | Library, scan flow, document view, mark-up, signatures, export UI |
| `lib/` | Bundled third-party libraries and OCR language data |

See `THIRD_PARTY_NOTICES.md` for bundled components and their licences.
