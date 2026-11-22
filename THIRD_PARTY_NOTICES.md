# Third-party components

These libraries are bundled unmodified in `lib/`, except where noted.

| Component | Version | Licence | Files |
|---|---|---|---|
| [tesseract.js](https://github.com/naptha/tesseract.js) | 6.0.1 | Apache-2.0 | `lib/tesseract/tesseract.min.js`, `lib/tesseract/worker.min.js` (patched: language objects are joined by `code` instead of `data` when initialising) |
| [tesseract.js-core](https://github.com/naptha/tesseract.js-core) | 6.x | Apache-2.0 | `lib/tesseract/tesseract-core-*.wasm.js` |
| [Tesseract OCR trained data](https://github.com/tesseract-ocr/tessdata_best) (via `@tesseract.js-data`) | 4.0.0 best_int | Apache-2.0 | `lib/ocr/*.traineddata.b64.txt` (gzip, base64-encoded) |
| [PDF.js](https://github.com/mozilla/pdf.js) | 3.11.174 | Apache-2.0 | `lib/pdfjs/` |
| [jsQR](https://github.com/cozmo/jsQR) | 1.4 | Apache-2.0 | `lib/jsQR.js` |

Licence texts: `lib/tesseract/LICENSE`, `lib/pdfjs/LICENSE`, `lib/jsQR.LICENSE`.
Fonts (IBM Plex Sans, IBM Plex Mono, Schibsted Grotesk) load from Google Fonts under the SIL Open Font License.
