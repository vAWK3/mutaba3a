# receipt-ocr (MUT-441): the API's own OCR service. Cloud Run, IAM-only, no outbound network (R9), read-only root
# filesystem friendly: nothing writes outside /tmp at runtime.
#
#   docker build -t receipt-ocr server/ocr                               # the service (fast tessdata)
#   docker build --build-arg TESSDATA_VARIANT=best -t receipt-ocr server/ocr
#   docker build --target test -t receipt-ocr-test server/ocr && \
#     docker run --rm --network none receipt-ocr-test                    # pytest + licence check, AC4 at the network level
#
# Every model is fetched and hash-checked here, at build time (fetch_models.py); the running service never downloads.

ARG PYTHON_IMAGE=python:3.12-slim

# --- models: fetched once, verified against pinned SHA-256s -------------------------------------------------------
FROM ${PYTHON_IMAGE} AS models
ARG TESSDATA_VARIANT=fast
WORKDIR /build
COPY fetch_models.py ./
RUN python fetch_models.py --tessdata "${TESSDATA_VARIANT}"

# --- runtime ------------------------------------------------------------------------------------------------------
FROM ${PYTHON_IMAGE} AS runtime
ARG TESSDATA_VARIANT=fast
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HOME=/tmp \
    OCR_MODELS_DIR=/app/models \
    OCR_TESSDATA=${TESSDATA_VARIANT} \
    OCR_WORKER=process \
    OCR_THREADS=2 \
    OMP_THREAD_LIMIT=1

# Tesseract 5 for the binary only: its packaged language data is removed, and TESSDATA_PREFIX points at our pinned
# ara, heb and eng (models/tessdata/<variant>), so the image holds exactly those three.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tesseract-ocr \
 && rm -f /usr/share/tesseract-ocr/*/tessdata/*.traineddata \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt ./
RUN pip install --require-hashes -r requirements.txt
COPY app ./app
COPY check_licenses.py LICENSES.md ./
COPY --from=models /build/models ./models

RUN useradd --system --uid 10001 --no-create-home --shell /usr/sbin/nologin ocr
USER 10001
EXPOSE 8080
# One process, one read at a time (R3); the read itself runs in a killable child (app/worker.py).
CMD ["sh", "-c", "exec uvicorn app.main:app_factory --factory --host 0.0.0.0 --port ${PORT:-8080} --workers 1 --no-access-log --timeout-graceful-shutdown 10"]

# --- test: the runtime image plus pytest; CI runs it with --network none -------------------------------------------
FROM runtime AS test
USER root
COPY requirements-dev.txt ./
RUN pip install --require-hashes -r requirements-dev.txt
COPY pytest.ini ./
COPY tests ./tests
USER 10001
CMD ["sh", "-c", "python check_licenses.py && python -m pytest -q -p no:cacheprovider"]

# The default target is the service.
FROM runtime
