/**
 * Helpers — Pure utility functions for sorting, pagination, formatting,
 * validation primitives, and DOM-safe string handling.
 *
 * All functions are side-effect-free (except debounce which uses timers).
 * domainPath() reads from the State module.
 */
const Helpers = (function() {
    'use strict';

    // ---------------------------------------------------------------
    // TTL_PRESETS — Common TTL values for dropdown UIs.
    // ---------------------------------------------------------------
    const TTL_PRESETS = [
        { value: 300,   get label() { return I18n.t('records.ttlPreset5m'); } },
        { value: 3600,  get label() { return I18n.t('records.ttlPreset1h'); } },
        { value: 10800, get label() { return I18n.t('records.ttlPreset3h'); } },
        { value: 86400, get label() { return I18n.t('records.ttlPreset1d'); } }
    ];

    // ---------------------------------------------------------------
    // sortData(data, column, direction) — Sort an array of objects by
    // a given key. direction is 'asc' or 'desc'. Returns a new array
    // (does not mutate the original).
    // ---------------------------------------------------------------
    function sortData(data, column, direction) {
        if (!data || !data.length || !column) {
            return data ? data.slice() : [];
        }
        const dir = direction === 'desc' ? -1 : 1;
        return data.slice().sort((a, b) => {
            const va = a[column];
            const vb = b[column];

            // Handle null/undefined — push them to the end
            if (va === null || va === undefined) { if (vb === null || vb === undefined) return 0; return 1; }
            if (vb === null || vb === undefined) return -1;

            // Numeric comparison if both are numbers
            if (typeof va === 'number' && typeof vb === 'number') {
                return (va - vb) * dir;
            }

            // String comparison (case-insensitive)
            const sa = String(va).toLowerCase();
            const sb = String(vb).toLowerCase();
            if (sa < sb) return -1 * dir;
            if (sa > sb) return 1 * dir;
            return 0;
        });
    }

    // ---------------------------------------------------------------
    // paginate(data, page, pageSize) — Return a page slice with
    // metadata: { items, page, pageSize, totalPages, totalItems }.
    // page is 1-based. Out-of-range pages clamp to valid bounds.
    // ---------------------------------------------------------------
    function paginate(data, page, pageSize) {
        const arr = data || [];
        const showAll = pageSize === 0;
        const size = showAll ? Math.max(1, arr.length) : Math.max(1, pageSize || 25);
        const total = arr.length;
        const totalPages = Math.max(1, Math.ceil(total / size));
        const p = Math.max(1, Math.min(page || 1, totalPages));
        const start = (p - 1) * size;
        const items = arr.slice(start, start + size);
        return {
            items: items,
            page: p,
            pageSize: showAll ? 0 : size,
            totalPages: totalPages,
            totalItems: total
        };
    }

    // ---------------------------------------------------------------
    // domainPath(...segments) — Build a Gandi API path relative to
    // the current domain. Throws if no domain is selected.
    // Example: domainPath('records', 'www', 'A')
    //   → '/domains/example.com/records/www/A'
    // ---------------------------------------------------------------
    function domainPath(...segments) {
        const domain = State.get('currentDomain');
        if (!domain) {
            throw new Error('No domain selected');
        }
        const parts = ['/domains', encodeURIComponent(domain)];
        for (let i = 0; i < segments.length; i++) {
            if (segments[i] !== null && segments[i] !== undefined && segments[i] !== '') {
                const segment = String(segments[i]);
                // '@' must remain literal — Gandi API expects /records/@/A,
                // not /records/%40/A (encodeURIComponent encodes @ → %40)
                parts.push(segment === '@' ? '@' : encodeURIComponent(segment));
            }
        }
        return parts.join('/');
    }

    // ---------------------------------------------------------------
    // debounce(fn, ms) — Return a debounced version of fn that waits
    // ms milliseconds after the last call before executing.
    // ---------------------------------------------------------------
    function debounce(fn, ms) {
        let timer = null;
        return function() {
            const ctx = this;
            const args = arguments;
            if (timer) {
                clearTimeout(timer);
            }
            timer = setTimeout(() => {
                timer = null;
                fn.apply(ctx, args);
            }, ms || 300);
        };
    }

    // ---------------------------------------------------------------
    // throttle(fn, ms) — Return a throttled version of fn that executes
    // at most once per ms milliseconds. Uses trailing-edge execution.
    // ---------------------------------------------------------------
    function throttle(fn, ms) {
        let timer = null;
        let lastArgs = null;
        let lastCtx = null;
        return function() {
            lastCtx = this;
            lastArgs = arguments;
            if (!timer) {
                timer = setTimeout(function() {
                    timer = null;
                    fn.apply(lastCtx, lastArgs);
                }, ms || 100);
            }
        };
    }

    // ---------------------------------------------------------------
    // formatTTL(seconds) — Convert seconds to a human-readable string.
    // Examples: 300 → "5m", 3600 → "1h", 86400 → "1d", 7200 → "2h"
    // Falls back to "{n}s" for values that do not divide cleanly.
    // ---------------------------------------------------------------
    function formatTTL(seconds) {
        const n = Number(seconds);
        if (isNaN(n) || n < 0) return String(seconds);

        if (n === 0) return '0s';
        if (n >= 86400 && n % 86400 === 0) return (n / 86400) + 'd';
        if (n >= 3600 && n % 3600 === 0) return (n / 3600) + 'h';
        if (n >= 60 && n % 60 === 0) return (n / 60) + 'm';
        return n + 's';
    }

    // ---------------------------------------------------------------
    // parseTTL(str) — Reverse of formatTTL. Accepts "5m", "1h", "3h",
    // "1d", "300s", or plain numeric string. Returns seconds as number.
    // Throws on invalid input.
    // ---------------------------------------------------------------
    function parseTTL(str) {
        if (typeof str === 'number') return str;
        const s = String(str).trim().toLowerCase();
        if (!s) throw new Error('Empty TTL value');

        const match = s.match(/^(\d+(?:\.\d+)?)\s*(d|h|m|s)?$/); // eslint-disable-line security/detect-unsafe-regex
        if (!match) throw new Error('Invalid TTL format: ' + str);

        const num = parseFloat(match[1]);
        const unit = match[2] || 's';
        switch (unit) {
            case 'd': return Math.round(num * 86400);
            case 'h': return Math.round(num * 3600);
            case 'm': return Math.round(num * 60);
            case 's': return Math.round(num);
            default: return Math.round(num);
        }
    }

    // ---------------------------------------------------------------
    // truncate(str, maxLen) — Truncate a string and append ellipsis
    // if it exceeds maxLen. Default maxLen is 50.
    // ---------------------------------------------------------------
    function truncate(str, maxLen) {
        const max = maxLen || 50;
        const s = String(str || '');
        if (s.length <= max) return s;
        return s.substring(0, max - 1) + '\u2026'; // Unicode ellipsis
    }

    // ---------------------------------------------------------------
    // toASCII(domain) — Convert a unicode domain name to its ASCII
    // (punycode) representation using the browser's URL API.
    // Returns the original string if conversion fails.
    // Example: 'café.fr' → 'xn--caf-dma.fr'
    // ---------------------------------------------------------------
    function toASCII(domain) {
        if (!domain || typeof domain !== 'string') return domain;
        try {
            const url = new URL('http://' + domain);
            return url.hostname;
        } catch {
            return domain;
        }
    }

    // ---------------------------------------------------------------
    // toUnicode(domain) — Convert an ASCII (punycode) domain name
    // back to its unicode representation. Uses a punycode label
    // decoder for 'xn--' prefixed labels (RFC 3492).
    // Returns the original string if no punycode labels are found
    // or if decoding fails.
    // Example: 'xn--caf-dma.fr' → 'café.fr'
    // ---------------------------------------------------------------
    function toUnicode(domain) {
        if (!domain || typeof domain !== 'string') return domain;
        if (domain.indexOf('xn--') === -1) return domain;

        try {
            const labels = domain.split('.');
            const decoded = labels.map(function(label) {
                if (label.toLowerCase().indexOf('xn--') === 0) {
                    return decodePunycodeLabel(label.slice(4));
                }
                return label;
            });
            return decoded.join('.');
        } catch {
            return domain;
        }
    }

    // ---------------------------------------------------------------
    // decodePunycodeLabel(encoded) — Decode a single punycode-encoded
    // label (without the 'xn--' prefix) per RFC 3492 Bootstring.
    // ---------------------------------------------------------------
    function decodePunycodeLabel(encoded) {
        const BASE = 36;
        const TMIN = 1;
        const TMAX = 26;
        const SKEW = 38;
        const DAMP = 700;
        const INITIAL_BIAS = 72;
        const INITIAL_N = 128;

        function adapt(delta, numpoints, first) {
            delta = first ? Math.floor(delta / DAMP) : Math.floor(delta / 2);
            delta += Math.floor(delta / numpoints);
            let k = 0;
            while (delta > Math.floor((BASE - TMIN) * TMAX / 2)) {
                delta = Math.floor(delta / (BASE - TMIN));
                k += BASE;
            }
            return k + Math.floor((BASE - TMIN + 1) * delta / (delta + SKEW));
        }

        function digitToBasic(digit) { // eslint-disable-line no-unused-vars
            // a-z = 0-25, 0-9 = 26-35
            if (digit >= 0 && digit <= 25) return digit + 97; // 'a'
            if (digit >= 26 && digit <= 35) return digit - 26 + 48; // '0'
            throw new Error('Invalid digit');
        }

        function basicToDigit(cp) {
            if (cp >= 48 && cp <= 57) return cp - 48 + 26; // '0'-'9' → 26-35
            if (cp >= 65 && cp <= 90) return cp - 65;       // 'A'-'Z' → 0-25
            if (cp >= 97 && cp <= 122) return cp - 97;      // 'a'-'z' → 0-25
            return BASE; // invalid
        }

        // Split basic vs extended parts at last delimiter
        let basic = '';
        const delimPos = encoded.lastIndexOf('-');
        if (delimPos >= 0) {
            basic = encoded.substring(0, delimPos);
        }

        const output = [];
        for (let j = 0; j < basic.length; j++) {
            output.push(basic.charCodeAt(j));
        }

        let n = INITIAL_N;
        let bias = INITIAL_BIAS;
        let i = 0;
        let inputPos = delimPos >= 0 ? delimPos + 1 : 0;

        while (inputPos < encoded.length) {
            const oldi = i;
            let w = 1;
            let k = BASE;

            while (true) {
                if (inputPos >= encoded.length) throw new Error('Invalid punycode');
                const digit = basicToDigit(encoded.charCodeAt(inputPos++));
                if (digit >= BASE) throw new Error('Invalid punycode digit');

                i += digit * w;
                const t = k <= bias ? TMIN : (k >= bias + TMAX ? TMAX : k - bias);
                if (digit < t) break;
                w *= (BASE - t);
                k += BASE;
            }

            const out = output.length + 1;
            bias = adapt(i - oldi, out, oldi === 0);
            n += Math.floor(i / out);
            i = i % out;

            output.splice(i, 0, n);
            i++;
        }

        return String.fromCodePoint.apply(null, output);
    }

    // ---------------------------------------------------------------
    // isValidFQDN(str) — Validate a hostname/FQDN according to DNS
    // Label-Delivery-Hyphen (LDH) rules plus underscores for SRV/TLSA.
    // Max label length: 63, max total length: 253.
    // Accepts unicode labels (IDN) by converting to ASCII first.
    // ---------------------------------------------------------------
    function isValidFQDN(str) {
        if (!str || typeof str !== 'string') return false;

        // Remove trailing dot if present (fully-qualified form)
        let hostname = str.replace(/\.$/, '');

        if (hostname.length === 0 || hostname.length > 253) return false;

        // If the hostname contains non-ASCII characters, convert to
        // punycode via toASCII for validation. The ASCII form is what
        // the DNS wire format uses, so length/label checks apply to it.
        const hasUnicode = /[^\x00-\x7F]/.test(hostname);
        if (hasUnicode) {
            const ascii = toASCII(hostname);
            // If conversion failed (returned unchanged), reject
            if (ascii === hostname) return false;
            hostname = ascii;
            // Re-check length on the ASCII form
            if (hostname.length > 253) return false;
        }

        const labels = hostname.split('.');
        for (let i = 0; i < labels.length; i++) {
            const label = labels[i];
            // Empty label (double dot or leading dot)
            if (label.length === 0 || label.length > 63) return false;

            // Allow wildcard only as the leftmost label
            if (label === '*') {
                if (i !== 0) return false;
                continue;
            }

            // LDH rule: alphanumeric, hyphens, underscores (for SRV/TLSA prefixes)
            // Cannot start or end with hyphen
            if (!/^[a-zA-Z0-9_]([a-zA-Z0-9_-]*[a-zA-Z0-9_])?$/.test(label)) { // eslint-disable-line security/detect-unsafe-regex
                return false;
            }
        }
        return true;
    }

    // ---------------------------------------------------------------
    // isValidIPv4(str) — Validate an IPv4 address. No leading zeros
    // in octets (RFC strict). Exactly 4 octets 0-255.
    // ---------------------------------------------------------------
    function isValidIPv4(str) {
        if (!str || typeof str !== 'string') return false;

        const parts = str.split('.');
        if (parts.length !== 4) return false;

        for (let i = 0; i < 4; i++) {
            const part = parts[i];
            // No leading zeros (except "0" itself), digits only
            if (!/^(0|[1-9]\d*)$/.test(part)) return false;
            const num = parseInt(part, 10);
            if (num < 0 || num > 255) return false;
        }
        return true;
    }

    // ---------------------------------------------------------------
    // isValidIPv6(str) — Validate an IPv6 address. Supports:
    //   - Full form: 8 groups of 4 hex digits
    //   - Abbreviated form with :: (at most one ::)
    //   - Mixed notation: ::ffff:192.168.1.1
    // ---------------------------------------------------------------
    function isValidIPv6(str) {
        if (!str || typeof str !== 'string') return false;

        const addr = str.trim();
        if (addr.length === 0) return false;

        // Check for mixed IPv4-mapped IPv6 (e.g., ::ffff:192.168.1.1)
        const mixedMatch = addr.match(/^(.+):(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
        if (mixedMatch) {
            // Validate the IPv4 suffix
            if (!isValidIPv4(mixedMatch[2])) return false;
            // Replace IPv4 part with two 16-bit hex groups for validation
            // We just need to validate the prefix part has the right group count
            const prefix = mixedMatch[1];
            // The IPv4 part counts as 2 groups
            return validateIPv6Groups(prefix, 6);
        }

        return validateIPv6Groups(addr, 8);
    }

    /**
     * validateIPv6Groups — Private: validate that the hex groups in an
     * IPv6 string expand to exactly expectedGroups groups.
     */
    function validateIPv6Groups(addr, expectedGroups) {
        // Count occurrences of ::
        const doubleColonCount = (addr.match(/::/g) || []).length;
        if (doubleColonCount > 1) return false;

        if (doubleColonCount === 1) {
            const halves = addr.split('::');
            const left = halves[0] ? halves[0].split(':') : [];
            const right = halves[1] ? halves[1].split(':') : [];

            // Total explicit groups must be less than expectedGroups
            if (left.length + right.length >= expectedGroups) return false;

            // Validate each group
            const allGroups = left.concat(right);
            for (let i = 0; i < allGroups.length; i++) {
                if (!isValidHexGroup(allGroups[i])) return false;
            }
            return true;
        }

        // No :: — must have exactly expectedGroups groups
        const groups = addr.split(':');
        if (groups.length !== expectedGroups) return false;
        for (let j = 0; j < groups.length; j++) {
            if (!isValidHexGroup(groups[j])) return false;
        }
        return true;
    }

    /**
     * isValidHexGroup — Private: validate a single 16-bit hex group (1-4 hex digits).
     */
    function isValidHexGroup(group) {
        return /^[0-9a-fA-F]{1,4}$/.test(group);
    }

    // ---------------------------------------------------------------
    // normalizeRecordName(name) — Handle '@' for apex and trailing dot.
    // '@' becomes empty string (Gandi API convention for apex).
    // Removes trailing dot if present.
    // ---------------------------------------------------------------
    function normalizeRecordName(name) {
        if (!name || name === '@') return '@';

        let normalized = String(name).trim();

        // Remove trailing dot
        if (normalized.endsWith('.')) {
            normalized = normalized.slice(0, -1);
        }

        return normalized || '@';
    }

    // ---------------------------------------------------------------
    // computeLineDiff(oldText, newText, normalize) — LCS-based line diff.
    // Returns array of { type: 'same'|'add'|'del', line: string }
    // Optional normalize(line) function: used for comparison only,
    // the original line text is preserved in the output.
    // ---------------------------------------------------------------
    function computeLineDiff(oldText, newText, normalize) {
        const oldLines = (oldText || '').split('\n');
        const newLines = (newText || '').split('\n');
        const normFn = typeof normalize === 'function' ? normalize : null;
        const m = oldLines.length;
        const n = newLines.length;

        // Build normalized copies for comparison if a normalizer is provided
        const oldNorm = normFn ? oldLines.map(normFn) : oldLines;
        const newNorm = normFn ? newLines.map(normFn) : newLines;

        const dp = [];
        for (let i = 0; i <= m; i++) {
            dp[i] = new Array(n + 1).fill(0);
        }
        for (let i2 = 1; i2 <= m; i2++) {
            for (let j = 1; j <= n; j++) {
                if (oldNorm[i2 - 1] === newNorm[j - 1]) {
                    dp[i2][j] = dp[i2 - 1][j - 1] + 1;
                } else {
                    dp[i2][j] = Math.max(dp[i2 - 1][j], dp[i2][j - 1]);
                }
            }
        }

        const result = [];
        let bi = m;
        let bj = n;
        while (bi > 0 || bj > 0) {
            if (bi > 0 && bj > 0 && oldNorm[bi - 1] === newNorm[bj - 1]) {
                result.unshift({ type: 'same', line: oldLines[bi - 1] });
                bi--;
                bj--;
            } else if (bj > 0 && (bi === 0 || dp[bi][bj - 1] >= dp[bi - 1][bj])) {
                result.unshift({ type: 'add', line: newLines[bj - 1] });
                bj--;
            } else {
                result.unshift({ type: 'del', line: oldLines[bi - 1] });
                bi--;
            }
        }
        return result;
    }

    // ---------------------------------------------------------------
    // normalizeZoneLine(line) — Normalize a zone file line for diff
    // comparison. Replaces the SOA serial number with a placeholder
    // so that auto-incremented serials don't appear as changes.
    // ---------------------------------------------------------------
    const SOA_RE = /^(\S+\s+\d+\s+IN\s+SOA\s+\S+\s+\S+\s+)\d+(\s+.*)$/;
    function normalizeZoneLine(line) {
        return line.replace(SOA_RE, '$1(serial)$2');
    }

    // ---------------------------------------------------------------
    // isValidHex(str) — Check if a string is a valid hexadecimal value.
    // Used by SSHFP, TLSA, DS validators.
    // ---------------------------------------------------------------
    function isValidHex(str) {
        return typeof str === 'string' && str.length > 0 && /^[0-9a-fA-F]+$/.test(str);
    }

    // ---------------------------------------------------------------
    // warnTrailingDot(value, fieldName, specialValues) — Return a
    // warning object if a hostname target is missing a trailing dot.
    // Returns null if the value ends with '.', is empty, or matches
    // a special value (e.g. '@', '.').
    // ---------------------------------------------------------------
    function warnTrailingDot(value, fieldName, specialValues) {
        if (!value) return null;
        const specials = specialValues || [];
        for (let i = 0; i < specials.length; i++) {
            if (value === specials[i]) return null;
        }
        if (!value.endsWith('.')) {
            return { field: fieldName, message: I18n.t('types.validate.missingTrailingDot') };
        }
        return null;
    }

    // ---------------------------------------------------------------
    // validateHostnameTarget(value, typeName, fieldName, options) —
    // Validate that a value is a valid hostname (FQDN), not an IP.
    // Options:
    //   specialValues: array of values to accept without validation
    //   rejectIP: reject IPv4/IPv6 (default true)
    //   returnArray: return [] on success, [err] on failure (for Tier 2)
    // ---------------------------------------------------------------
    function validateHostnameTarget(value, typeName, fieldName, options) {
        const opts = options || {};
        const specials = opts.specialValues || [];
        const rejectIP = opts.rejectIP !== false;
        const returnArray = !!opts.returnArray;

        for (let i = 0; i < specials.length; i++) {
            if (value === specials[i]) return returnArray ? [] : null;
        }
        if (rejectIP && (isValidIPv4(value) || isValidIPv6(value))) {
            const err = { field: fieldName, message: I18n.t('types.validate.targetMustBeHostname', { type: typeName }) };
            return returnArray ? [err] : err;
        }
        if (!isValidFQDN(value)) {
            const hostErr = { field: fieldName, message: I18n.t('types.validate.invalidHostname') };
            return returnArray ? [hostErr] : hostErr;
        }
        return returnArray ? [] : null;
    }

    // ---------------------------------------------------------------
    // Public API
    // ---------------------------------------------------------------
    return {
        sortData: sortData,
        paginate: paginate,
        domainPath: domainPath,
        debounce: debounce,
        throttle: throttle,
        formatTTL: formatTTL,
        parseTTL: parseTTL,
        truncate: truncate,
        computeLineDiff: computeLineDiff,
        normalizeZoneLine: normalizeZoneLine,

        isValidFQDN: isValidFQDN,
        isValidHex: isValidHex,
        isValidIPv4: isValidIPv4,
        isValidIPv6: isValidIPv6,
        normalizeRecordName: normalizeRecordName,
        toASCII: toASCII,
        toUnicode: toUnicode,
        validateHostnameTarget: validateHostnameTarget,
        warnTrailingDot: warnTrailingDot,
        TTL_PRESETS: TTL_PRESETS
    };
})();
