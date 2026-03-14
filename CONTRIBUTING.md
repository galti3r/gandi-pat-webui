# Contributing to Gandi DNS WebUI

Thank you for your interest in contributing! This guide will help you get started.

## Getting Started

### Prerequisites

- **make** (GNU Make)
- **bash**
- **Node.js** >= 18
- **python3** (for local dev server)

### Development Setup

```bash
git clone https://github.com/<your-fork>/gandi-personal-access-tokens.git
cd gandi-personal-access-tokens
npm install
make dev
```

This starts a local server and opens the app in your browser.

## Project Structure

```
src/
  js/         # JavaScript modules (IIFE pattern)
  css/        # Stylesheets (BEM, CSS variables)
  i18n/       # Translation files (en.json, fr.json)
build.sh      # Build script
Makefile      # Build targets
dist/         # Build output (single index.html)
```

## Module Pattern

Every JS module uses the revealing module IIFE pattern:

```javascript
const MyModule = (function() {
    'use strict';

    function init() {
        // setup logic
    }

    function render() {
        // DOM rendering
    }

    return { init, render };
})();
```

The Makefile wraps all concatenated JS in an outer IIFE automatically.

## Critical Security Rule: No innerHTML

**NEVER** use `innerHTML`, `outerHTML`, or `insertAdjacentHTML` with dynamic data (API responses, user input). DNS record values can contain arbitrary strings including `<script>` tags.

Instead, use:

- `textContent` for setting text content
- `document.createElement()` / `appendChild()` for building DOM trees

`innerHTML` is only acceptable for static, hardcoded HTML templates with no variable interpolation.

## Internationalization (i18n)

All user-facing strings must use the i18n system:

```javascript
const label = I18n.t('records.delete_confirm');
```

When adding or modifying UI text, update both translation files:

- `src/i18n/en.json` (English)
- `src/i18n/fr.json` (French)

## Testing

```bash
node --test          # Run unit tests (validation, state, pure logic)
make lint            # Run ESLint
```

DOM-dependent code is tested manually. Unit tests target pure logic modules.

## Building

```bash
make build           # Produces dist/index.html (single file)
```

### Container Build

```bash
podman build -t gandi-dns-webui .    # Preferred (rootless)
docker build -t gandi-dns-webui .    # Also supported
```

Both use the `Containerfile` at the project root.

## Code Style

- **4-space indentation** (no tabs)
- **`const`/`let`** only — never `var`
- **Strict equality** (`===` / `!==`) — never `==` / `!=`
- **English** for all code, comments, and commit messages
- See the project documentation for full naming conventions (functions, DOM, CSS, state)

## Commits

Follow [Conventional Commits](https://www.conventionalcommits.org/):

| Prefix     | Purpose                  |
|------------|--------------------------|
| `feat:`    | New feature              |
| `fix:`     | Bug fix                  |
| `docs:`    | Documentation only       |
| `test:`    | Adding/updating tests    |
| `refactor:`| Code restructuring       |
| `perf:`    | Performance improvement  |
| `chore:`   | Maintenance, dependencies|
| `ci:`      | CI/CD changes            |

Keep commits atomic. Never commit broken code or secrets.

## Pull Request Process

1. **Fork** the repository
2. **Branch** from `main` (`feat/my-feature` or `fix/issue-description`)
3. **Code** following the guidelines above
4. **Test** — run `node --test` and `make lint`
5. **Build** — verify `make build` succeeds
6. **Commit** with conventional commit messages
7. **Push** and open a Pull Request against `main`

Describe your changes clearly in the PR body. Reference any related issues.

## Questions?

Open an issue on GitHub for questions about contributing.
