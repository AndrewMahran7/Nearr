# Multi-stage would help cache torch downloads, but a single-stage image
# is simpler to operate and the savings are marginal for our model size.
FROM python:3.11-slim

# ffmpeg is required by both yt-dlp (audio extraction) and whisper
# (input decoding). curl is included for in-container health checks.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install CPU-only torch wheel first so it's a cacheable layer separate
# from the rest of the deps. Override at build time with
# `--build-arg TORCH_INDEX_URL=https://download.pytorch.org/whl/cu121`
# if you want CUDA wheels.
ARG TORCH_INDEX_URL=https://download.pytorch.org/whl/cpu
RUN pip install --no-cache-dir --upgrade pip \
 && pip install --no-cache-dir torch --index-url ${TORCH_INDEX_URL}

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .

# Defaults; override via env / docker-compose / platform secrets.
ENV WHISPER_MODEL=base \
    WHISPER_DEVICE=cpu \
    TRANSCRIPTION_TIMEOUT_SEC=120 \
    YTDLP_TIMEOUT_SEC=45 \
    MAX_TRANSCRIPT_CHARS=8000 \
    LOG_LEVEL=INFO \
    PORT=8080

EXPOSE 8080

# Container-level health check. Platform-level checks (Fly/Render/Railway)
# should hit the same /health endpoint over HTTP.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/health" || exit 1

CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port ${PORT}"]
