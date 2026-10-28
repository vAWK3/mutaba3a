#!/usr/bin/env bash
# MUT-441: run the receipt-ocr sidecar locally for the API's local dev and release-QA (no Docker).
#
#   server/ocr/run_local.sh            # http://127.0.0.1:8090
#   then in server/.env:  SERVER_OCR=true  OCR_URL=http://127.0.0.1:8090
#
# Needs Python 3.12 (uv fetches it), and Tesseract 5 on PATH (macOS: brew install tesseract; the ara/heb/eng data
# comes from fetch_models.py, not from brew). OCR_TESSDATA=best switches the Tesseract models; PORT changes the port.
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -x .venv/bin/python ]; then
  uv venv --python 3.12 .venv
  uv pip install --python .venv/bin/python --require-hashes -r requirements.txt
fi
.venv/bin/python fetch_models.py --tessdata "${OCR_TESSDATA:-fast}"
if ! command -v tesseract >/dev/null 2>&1; then
  echo "tesseract is not on PATH (macOS: brew install tesseract)" >&2
  exit 1
fi
exec .venv/bin/python -m uvicorn app.main:app_factory --factory \
  --host 127.0.0.1 --port "${PORT:-8090}" --workers 1 --no-access-log
