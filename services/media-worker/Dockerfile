# syntax=docker/dockerfile:1
#
# Nearr media worker. Containerizes ffmpeg + ffprobe + yt-dlp so the long-running
# media analysis runs OUTSIDE the mobile app and Supabase Edge Functions.

FROM node:20-slim AS system
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg python3 ca-certificates curl tini \
  && rm -rf /var/lib/apt/lists/*
# yt-dlp standalone (python zipapp; python3 installed above). Pin via
# YT_DLP_VERSION build-arg for reproducibility; defaults to latest.
ARG YT_DLP_VERSION=latest
RUN if [ "$YT_DLP_VERSION" = "latest" ]; then \
      URL="https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp"; \
    else \
      URL="https://github.com/yt-dlp/yt-dlp/releases/download/${YT_DLP_VERSION}/yt-dlp"; \
    fi; \
    curl -fsSL "$URL" -o /usr/local/bin/yt-dlp && chmod a+rx /usr/local/bin/yt-dlp

# ---- build stage: install dev deps + compile TypeScript ----
FROM system AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY tsconfig.json tsconfig.build.json ./
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
RUN mkdir -p /tmp/nearr-media && chown -R node:node /tmp/nearr-media /app
USER node
EXPOSE 8090
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8090)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["tini", "--"]
CMD ["node", "dist/index.js"]
