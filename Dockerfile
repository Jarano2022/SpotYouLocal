FROM node:22-slim AS base

# Install system dependencies: ffmpeg, python3, curl, ca-certificates, and build tools for better-sqlite3
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    python3 \
    curl \
    ca-certificates \
    python3-minimal \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install yt-dlp binary for universal playlist extraction (YouTube, SoundCloud, Bandcamp, Mixcloud, etc.)
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp

WORKDIR /app

# Install Node dependencies
COPY package*.json ./
RUN npm install

# Copy application source
COPY . .

# Build frontend bundle
RUN npm run build

# Persistent volumes for downloaded audio files and SQLite database
RUN mkdir -p /app/downloads /app/data
VOLUME ["/app/downloads", "/app/data"]

ENV NODE_ENV=production
ENV PORT=3000
ENV DOWNLOAD_DIR=/app/downloads
ENV DATA_DIR=/app/data

EXPOSE 3000

CMD ["npx", "tsx", "server.ts"]
