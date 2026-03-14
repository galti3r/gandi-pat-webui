# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2026-03-14

### Added
- Proxy: log real client IP from X-Forwarded-For / X-Real-IP headers
- Proxy: mask container bridge IPs (10.x, 172.16-31.x) as `-` in logs
- Proxy: /tokeninfo endpoint for Gandi ID API (cors-proxy + Vercel edge function)
- Docker: `network_mode: host` for real client IP visibility
- E2E: proxy-logging test suite (6 tests), bugfixes, domain-loading, record-form suites
- Unit tests: expanded helpers and validation coverage

### Changed
- Nameservers: expanded E2E tests and UI improvements
- Domains: enhanced search, filtering, loading states
- Records: improved form handling, record-types i18n lazy getters
- Auth: token info display, no-flash on reload
- History: bulk operations, rollback improvements
- UI: sticky toolbar, modal resize tracking, responsive fixes
- i18n: ~57 new keys per language (EN/FR)

## [1.1.1] - 2026-03-11

### Added
- Koyeb buildpack deployment support (Procfile, runtime.txt, requirements.txt, bin/post_compile)
- Automated screenshot capture via Podman + Chrome (`make screenshots`)
- 10 screenshots in README (7 desktop + 3 mobile), grouped by viewport
- Live demo link in README

### Fixed
- Mobile: checkbox no longer overlaps record name text (uses flexbox order instead of absolute positioning)
- Mobile: record cards use compact padding (reduced from 8px+ to 4px)
- Mobile: header scrolls away, only tab bar stays sticky
- Mobile: nameserver cards show numbered prefix instead of repeating "NAMESERVER" label
- Desktop/Mobile: record values are click-to-copy (removed separate copy icon button)

## [1.1.0] - 2026-03-10

### Added
- Record cloning (duplicate button, clone form with editable name)
- History tab with IndexedDB persistence, timeline UI, diff view, and rollback
- Auto-refresh (30s / 1m / 5m selector in status bar, with modal/pending guards)
- Bulk operations (checkboxes, select-all, batch delete, batch TTL change, batch undo)
- Security CI pipeline (Grype, CodeQL, TruffleHog, Hadolint, dependency-review)
- Container vulnerability scanning (Trivy + Grype SARIF upload)
- SBOM generation (SPDX JSON via Syft)
- Pre-commit hooks (secret detection, ESLint, outdated deps)
- Pre-push hook (block AI attribution references)
- Dependabot configuration (npm + GitHub Actions)
- Docker Compose / Podman Compose support

### Changed
- Container base image: python:3.12-slim → python:3.13-alpine (smaller, fewer CVEs)
- ESLint strict mode: --max-warnings 0 in CI and pre-commit
- GitHub Actions updated to latest versions (checkout@v6, setup-node@v6, etc.)

### Fixed
- i18n: column labels, action buttons, and critical warnings now fully translated in records view
- Vercel Edge Function routing (path prefix handling)
- ESLint warnings (var→let/const, unused catch bindings, strict equality)

## [1.0.0] - 2026-03-07

### Added
- Full CRUD for DNS records (A, AAAA, CNAME, MX, TXT, SRV, CAA and 18 more types)
- Three-tier validation system: full form (Tier 1), basic textarea (Tier 2), raw (Tier 3)
- Cross-record validation: CNAME exclusivity, circular chain detection, SPF uniqueness
- DNSSEC key viewer (KSK/ZSK display)
- Nameserver list with copy-to-clipboard
- Dark and light theme with system preference detection
- Responsive design: sidebar (desktop), icon rail (tablet), tab bar (mobile)
- Token storage modes: memory, session, persistent (localStorage)
- Undo deletion with 5-second toast
- Keyboard shortcuts (?, 1-4, /, r, n)
- ARIA-compliant tabs, combobox, dialogs, and live regions
- Internationalization (English and French) with browser language detection
- Content Security Policy (script-src 'self', no inline scripts)
- Modular build: separate CSS, JS, and i18n files in dist/
- CORS reverse proxy (Python stdlib, zero dependencies)
- Container deployment (Docker/Podman) with nginx reverse proxy
- Vercel deployment via Edge Function proxy
- Koyeb deployment via container registry
- GitHub Actions CI (lint, test, build, E2E) and CD (multi-arch images)
- Container registry publishing (GHCR)
- ESLint with security plugin
- Playwright E2E tests (auth, domains, records, navigation, DNSSEC, nameservers)
