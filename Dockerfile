# Containerfile — Multi-stage build for Gandi DNS WebUI
# Compatible with both podman build and docker build
#
# Stages:
#   build — assemble dist/ from sources
#   e2e   — Playwright tests (not used in production)
#   serve — Python cors-proxy (default target)

# ---------------------------------------------------------------------------
# Stage: build — assemble the single-file dist/index.html
# ---------------------------------------------------------------------------
FROM alpine:3.23 AS build

# hadolint ignore=DL3018
RUN apk add --no-cache bash make gawk

WORKDIR /app
COPY src/ src/
COPY Makefile ./
COPY build.sh ./

RUN bash build.sh

# ---------------------------------------------------------------------------
# Stage: e2e — Playwright end-to-end tests
# ---------------------------------------------------------------------------
FROM mcr.microsoft.com/playwright:v1.58.2-noble AS e2e

WORKDIR /app/e2e

COPY e2e/package.json e2e/package-lock.json e2e/playwright.config.js /app/e2e/
RUN npm ci

COPY e2e/tests/ /app/e2e/tests/

CMD ["npx", "playwright", "test"]

# ---------------------------------------------------------------------------
# Stage: serve — Python cors-proxy (serves static files + API proxy)
# ---------------------------------------------------------------------------
FROM python:3.13-alpine AS serve

# hadolint ignore=DL3018
RUN apk upgrade --no-cache && adduser -D -s /bin/sh appuser

WORKDIR /app

COPY cors-proxy.py ./
COPY --from=build /app/dist/ /app/dist/

RUN chown -R appuser:appuser /app

ENV PORT=8000

USER appuser

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:${PORT}/healthz')"

EXPOSE 8000

CMD ["python", "cors-proxy.py", "--bind", "0.0.0.0"]
