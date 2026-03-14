# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| latest  | Yes       |

## Reporting a Vulnerability

If you discover a security vulnerability in this project, please report it responsibly:

1. **Do NOT open a public issue.** Security vulnerabilities must be reported privately.
2. Use [GitHub Security Advisories](../../security/advisories/new) to report the vulnerability.
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

## Response Timeline

- **Acknowledgment**: Within 72 hours
- **Assessment**: Within 1 week
- **Fix release**: Within 2 weeks for critical issues

## Scope

Security issues we care about:
- Token exfiltration or leakage (XSS, logging, referrer)
- Unauthorized API calls via the CORS proxy (SSRF, path traversal)
- DNS record manipulation without authorization
- Cross-site scripting via DNS record values

## Security Design

- Tokens stored client-side only (memory, sessionStorage, or localStorage)
- No `innerHTML` with dynamic data -- all DOM via `textContent` / `createElement`
- `<meta name="referrer" content="no-referrer">` prevents token leakage via referrer
- Content Security Policy restricts script/style sources to `'self'`
- CORS proxy validates paths (only `/v5/*` is proxied)
- Authorization headers are never logged

## CI Security Pipeline

- **ESLint** with `eslint-plugin-security` — static pattern detection
- **CodeQL** — semantic SAST analysis (JavaScript)
- **TruffleHog** — secret detection in commits
- **Grype** (anchore/scan-action) — container image vulnerability scanning
- **Trivy** — container image vulnerability scanning (dual engine coverage)
- **Hadolint** — Dockerfile/Containerfile best practices
- **Dependency Review** — blocks PRs adding vulnerable dependencies
- **Dependabot** — automated updates for npm, GitHub Actions, and Docker base images
