# syntax=docker/dockerfile:1
#
# Nearr media worker. Containerizes ffmpeg + ffprobe + yt-dlp so the long-running
# media analysis runs OUTSIDE the mobile app and Supabase Edge Functions.

# Node 22 (LTS): @supabase/supabase-js's realtime client requires a native
# global WebSocket, which only exists from Node 22 onward.
FROM node:22-slim AS system
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg python3 ca-certificates curl tini \
  && rm -rf /var/lib/apt/lists/*
# yt-dlp standalone (python zipapp; python3 installed above). This version and
# checksum are an intentional release pair. Update both only after completing
# the media regression and development verification sequence in README.md.
ARG YT_DLP_VERSION=2026.08.19
ARG YT_DLP_SHA256=1fa6733c37ea6fb51c99ad8fe785e7b7e5f3246c9b980230329d4fb72ed8d4d6
RUN set -eu; \
    printf '%s' "$YT_DLP_VERSION" | grep -Eq '^[0-9]{4}\.[0-9]{2}\.[0-9]{2}$' || { \
      echo "YT_DLP_VERSION must be an explicit YYYY.MM.DD release" >&2; \
      exit 1; \
    }; \
    URL="https://github.com/yt-dlp/yt-dlp/releases/download/${YT_DLP_VERSION}/yt-dlp"; \
    curl -fsSL "$URL" -o /usr/local/bin/yt-dlp; \
    printf '%s  %s\n' "$YT_DLP_SHA256" /usr/local/bin/yt-dlp | sha256sum -c -; \
    chmod a+rx /usr/local/bin/yt-dlp

# ---- build stage: install dev deps + compile TypeScript ----
FROM system AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY tsconfig.json tsconfig.build.json ./
COPY VOICE.md ./VOICE.md
COPY src ./src
RUN npm run build

# ---- runtime stage: production deps + compiled output only ----
FROM system AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8090 \
    MEDIA_TEMP_DIR=/tmp/nearr-media
COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/VOICE.md ./VOICE.md
RUN mkdir -p /tmp/nearr-media && chown -R node:node /tmp/nearr-media /app
USER node
EXPOSE 8090
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8090)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["tini", "--"]
CMD ["node", "dist/index.js"]
