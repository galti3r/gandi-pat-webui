# Gandi DNS WebUI — Build System
# Assembles src/ into dist/ (separate CSS, JS, i18n, assets)

COMPOSE := $(shell command -v podman-compose >/dev/null 2>&1 && echo "podman-compose" || \
           (docker compose version >/dev/null 2>&1 && echo "docker compose" || \
           echo "COMPOSE_NOT_FOUND"))

# Source files (build.sh is the single source of truth for file lists)
SRC_FILES = $(shell find src/ -type f 2>/dev/null)

.PHONY: build serve serve-bg stop test lint lint-fix dev up e2e e2e-local screenshots screenshots-commit clean help setup-hooks install-gh _check-compose

build: dist/.build

dist/.build: $(SRC_FILES) build.sh
	@bash build.sh
	@touch dist/.build

serve: build
	@echo "Serving at http://localhost:8000 (CORS proxy -> api.gandi.net)"
	@echo "Press CTRL+C to stop."
	@python3 cors-proxy.py --port 8000

serve-bg: build
	@python3 cors-proxy.py --port 8000 & echo $$! > .server.pid
	@echo "Server started (PID: $$(cat .server.pid)) — run 'make stop' to stop."

stop:
	@if [ -f .server.pid ] && kill -0 $$(cat .server.pid) 2>/dev/null; then \
		kill $$(cat .server.pid) && rm -f .server.pid && echo "Server stopped."; \
	else \
		rm -f .server.pid; echo "Server not running."; \
	fi

test:
	@echo "Running tests..."
	@node --test src/test/test-validation.js src/test/test-state.js src/test/test-helpers.js src/test/test-history.js src/test/test-domains.js
	@echo "All tests passed."

lint:
	@npx eslint src/js/

lint-fix:
	@npx eslint --fix src/js/

dev: build
	@echo "Watching src/ for changes... (CTRL+C to stop)"
	@python3 cors-proxy.py --port 8000 & echo $$! > .server.pid
	@trap 'kill $$(cat .server.pid 2>/dev/null) 2>/dev/null; rm -f .server.pid; exit 0' INT TERM; \
	echo "Server started on http://localhost:8000"; \
	while true; do \
		inotifywait -qre modify,create,delete src/ 2>/dev/null || sleep 2; \
		bash build.sh 2>/dev/null && echo "[rebuilt]"; \
	done

_check-compose:
	@if [ "$(COMPOSE)" = "COMPOSE_NOT_FOUND" ]; then \
		echo "Error: neither podman-compose nor docker compose found."; \
		echo "Install podman-compose or Docker with the compose plugin."; \
		exit 1; \
	fi

up: build _check-compose
	@trap 'echo ""; echo "Stopping containers..."; $(COMPOSE) down 2>/dev/null; echo "Stopped."; exit 0' INT TERM; \
		$(COMPOSE) up --build webserver; \
		$(COMPOSE) down 2>/dev/null

e2e: build _check-compose
	@echo "Running E2E tests in containers..."
	@trap 'echo ""; echo "Stopping containers..."; $(COMPOSE) down 2>/dev/null; echo "Stopped."; exit 0' INT TERM; \
		$(COMPOSE) up --build --abort-on-container-exit --exit-code-from e2e; \
		rc=$$?; $(COMPOSE) down 2>/dev/null; exit $$rc

e2e-local: build
	@echo "Running E2E tests locally (cors-proxy started by Playwright)..."
	@test -f .env || { echo "Error: .env with PAT required"; exit 1; }
	@export TEST_PORT=$$(python3 scripts/find-free-port.py 8001); \
	echo "Using port $$TEST_PORT"; \
	. ./.env && export PAT && cd e2e && npm install && npx playwright install chromium && npx playwright test
	@echo "E2E tests complete."

e2e-mobile: build
	@echo "Running mobile E2E tests..."
	@test -f .env || { echo "Error: .env with PAT required"; exit 1; }
	@export TEST_PORT=$$(python3 scripts/find-free-port.py 8001); \
	echo "Using port $$TEST_PORT"; \
	. ./.env && export PAT && cd e2e && npm install && npx playwright install chromium && npx playwright test --project=mobile
	@echo "Mobile E2E tests complete."

SCREENSHOTS_IMAGE := gandi-screenshots

screenshots: build
	@echo "Capturing screenshots via Podman + Chrome..."
	@test -f .env || { echo "Error: .env with PAT required"; exit 1; }
	@mkdir -p docs/screenshots
	@podman build -q -f scripts/screenshots.Containerfile -t $(SCREENSHOTS_IMAGE) . >/dev/null
	@. ./.env && podman run --rm \
		-v "$$(pwd)/dist:/app/dist:ro,Z" \
		-v "$$(pwd)/cors-proxy.py:/app/cors-proxy.py:ro,Z" \
		-v "$$(pwd)/scripts/screenshots.js:/app/scripts/screenshots.js:ro,Z" \
		-v "$$(pwd)/docs/screenshots:/app/output:Z" \
		-e PAT="$$PAT" \
		-e DOMAIN="$${DOMAIN:-}" \
		-e BASE_URL=http://localhost:8000 \
		-e OUTPUT_DIR=/app/output \
		$(SCREENSHOTS_IMAGE) \
		bash -c "python3 /app/cors-proxy.py --bind 127.0.0.1 --port 8000 & \
		for i in 1 2 3 4 5; do python3 -c \"import urllib.request; urllib.request.urlopen('http://localhost:8000/healthz')\" 2>/dev/null && break || sleep 1; done && \
		node /app/scripts/screenshots.js"
	@echo "Screenshots saved to docs/screenshots/"

screenshots-commit:
	@git stash --keep-index -q 2>/dev/null || true
	@git add docs/screenshots/
	@if git log -1 --format='%s' 2>/dev/null | grep -qx 'docs: update screenshots'; then \
		echo "Amending previous screenshot commit..."; \
		git commit --amend --no-edit; \
	else \
		echo "Creating screenshot commit..."; \
		git commit -m "docs: update screenshots"; \
	fi
	@git stash pop -q 2>/dev/null || true

GH_VERSION := 2.67.0
install-gh:
	@if command -v gh >/dev/null 2>&1; then echo "gh already installed: $$(gh --version | head -1)"; exit 0; fi
	@echo "Installing gh $(GH_VERSION) to ~/.local/bin..."
	@mkdir -p ~/.local/bin /tmp/gh-install
	@curl -sL "https://github.com/cli/cli/releases/download/v$(GH_VERSION)/gh_$(GH_VERSION)_linux_amd64.tar.gz" \
		| tar xz -C /tmp/gh-install --strip-components=2 --wildcards '*/bin/gh'
	@mv /tmp/gh-install/gh ~/.local/bin/gh && rm -rf /tmp/gh-install
	@echo "Installed: $$( ~/.local/bin/gh --version | head -1 )"
	@echo "Add ~/.local/bin to PATH if not already: export PATH=~/.local/bin:\$$PATH"

setup-hooks:
	@git config core.hooksPath .githooks
	@echo "Git hooks configured (.githooks/pre-commit)"

clean:
	@$(MAKE) stop 2>/dev/null || true
	@rm -rf dist e2e/test-results .server.pid
	@echo "Cleaned."

help:
	@echo "Gandi DNS WebUI — available targets:"
	@echo ""
	@echo "  make build      Build dist/ from src/"
	@echo "  make serve      Build + serve on localhost:8000 (CORS proxy)"
	@echo "  make up         Build + serve via container (podman/docker)"
	@echo "  make dev        Build + serve + watch for changes (auto-rebuild)"
	@echo "  make test       Run unit tests (node --test)"
	@echo "  make lint       Run ESLint on src/js/"
	@echo "  make lint-fix   Run ESLint with --fix"
	@echo "  make e2e        Run E2E tests in containers (podman/docker)"
	@echo "  make e2e-local  Run E2E tests locally with Playwright"
	@echo "  make screenshots   Capture screenshots via Podman + Chrome"
	@echo "  make screenshots-commit  Commit screenshots (amends previous)"
	@echo "  make clean      Remove dist/ and temp files"
	@echo "  make setup-hooks Install git pre-commit hook (secret detection)"
	@echo "  make install-gh  Install GitHub CLI (gh) to ~/.local/bin"
	@echo "  make help       Show this help"
