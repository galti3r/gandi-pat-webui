/**
 * API — HTTP client for the Gandi LiveDNS API.
 *
 * Wraps fetch() with Bearer token authentication, JSON handling,
 * and structured error propagation. The base URL is configurable
 * to support proxy mode.
 *
 * SECURITY: The token and Authorization header are NEVER logged.
 */
const API = (function() {
    'use strict';

    // ---------------------------------------------------------------
    // Private configuration
    // ---------------------------------------------------------------
    let baseUrl = '/v5/livedns';

    // ---------------------------------------------------------------
    // setBaseUrl(url) — Override the base URL (e.g. for a local proxy).
    // Removes trailing slash for consistency.
    // ---------------------------------------------------------------
    function setBaseUrl(url) {
        if (!url || typeof url !== 'string') {
            throw new Error('Base URL must be a non-empty string');
        }
        baseUrl = url.replace(/\/+$/, '');
    }

    // ---------------------------------------------------------------
    // getBaseUrl() — Return the current base URL.
    // ---------------------------------------------------------------
    function getBaseUrl() {
        return baseUrl;
    }

    // ---------------------------------------------------------------
    // Constants for 429 retry logic
    // ---------------------------------------------------------------
    const MAX_RETRIES = 2;
    const MAX_RETRY_AFTER = 30; // seconds — do not auto-retry above this

    // ---------------------------------------------------------------
    // sleep(ms) — Private: Promise-based delay for retry logic.
    // ---------------------------------------------------------------
    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // ---------------------------------------------------------------
    // request(method, path, body, fetchOptions, retryCount) — Core fetch wrapper.
    //
    // - Reads the token from State.get('token')
    // - Sets Authorization: Bearer {token}
    // - Sets Content-Type: application/json for POST/PUT/PATCH
    // - 204 responses return null (no body)
    // - Other successful responses are parsed as JSON
    // - Error responses throw { status, message, errors }
    // - 401 → clears token and emits for auth redirect
    // - 429 → auto-retries up to MAX_RETRIES times if Retry-After <= MAX_RETRY_AFTER
    // - fetchOptions.signal — optional AbortController signal for cancellation
    // - retryCount — internal counter, callers should NOT set this
    // ---------------------------------------------------------------
    async function request(method, path, body, fetchOptions, retryCount, returnHeaders, absolutePath) {
        const currentRetry = retryCount || 0;
        const token = State.get('token');
        if (!token) {
            throw {
                status: 0,
                message: I18n.t('api.noToken'),
                errors: []
            };
        }

        const url = absolutePath ? path : baseUrl + path;
        const headers = {
            'Authorization': 'Bearer ' + token
        };

        const options = {
            method: method,
            headers: headers
        };

        // Forward AbortController signal if provided
        if (fetchOptions && fetchOptions.signal) {
            options.signal = fetchOptions.signal;
        }

        // Set Content-Type and body for methods that send data
        if (body !== undefined && body !== null && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
            headers['Content-Type'] = 'application/json';
            options.body = JSON.stringify(body);
        }

        let response;
        try {
            response = await fetch(url, options);
        } catch (err) {
            // Propagate AbortError so callers can distinguish cancellations
            if (err && err.name === 'AbortError') {
                throw {
                    status: 0,
                    name: 'AbortError',
                    message: I18n.t('api.cancelled'),
                    errors: []
                };
            }
            // Network errors, CORS issues, etc.
            notifyProxyDown();
            throw {
                status: 0,
                message: err.message || I18n.t('api.networkError'),
                errors: []
            };
        }

        // 204 No Content — success with no body
        if (response.status === 204) {
            if (returnHeaders) {
                return { data: null, headers: extractHeaders(response) };
            }
            return null;
        }

        // 401 Unauthorized — clear token, redirect to auth
        if (response.status === 401) {
            State.set('token', null);
            throw {
                status: 401,
                message: I18n.t('api.authFailed'),
                errors: []
            };
        }

        // 429 Rate Limited — auto-retry if Retry-After <= MAX_RETRY_AFTER
        if (response.status === 429) {
            const retryAfter = response.headers.get('Retry-After');
            const retrySeconds = retryAfter ? parseInt(retryAfter, 10) : null;

            // Auto-retry when conditions are met
            if (retrySeconds && retrySeconds <= MAX_RETRY_AFTER && currentRetry < MAX_RETRIES) {
                if (typeof UI !== 'undefined' && UI.toast) {
                    UI.toast(I18n.t('api.rateLimited', {seconds: retrySeconds}), 'info');
                }
                await sleep(retrySeconds * 1000);
                return await request(method, path, body, fetchOptions, currentRetry + 1, returnHeaders, absolutePath);
            }

            // No retry: Retry-After missing, too large, or max retries exhausted
            const errData = await parseErrorBody(response);
            let msg = errData.message || I18n.t('api.rateLimitExceeded');
            if (retryAfter) {
                msg += ' ' + I18n.t('api.retryAfter', {seconds: retryAfter});
            }
            throw {
                status: 429,
                message: msg,
                retryAfter: retrySeconds,
                errors: errData.errors || []
            };
        }

        // 403 Forbidden — token lacks required permissions
        if (response.status === 403) {
            throw {
                status: 403,
                message: I18n.t('api.accessDenied'),
                errors: []
            };
        }

        // Other error responses (4xx, 5xx)
        if (!response.ok) {
            const errData = await parseErrorBody(response);
            throw {
                status: response.status,
                message: errData.message || I18n.t('api.requestFailed', {status: response.status}),
                errors: errData.errors || []
            };
        }

        // Success — parse JSON
        try {
            const data = await response.json();
            if (returnHeaders) {
                return { data: data, headers: extractHeaders(response) };
            }
            return data;
        } catch {
            // Some 200/201 responses might have empty or non-JSON bodies
            if (returnHeaders) {
                return { data: null, headers: extractHeaders(response) };
            }
            return null;
        }
    }

    // ---------------------------------------------------------------
    // extractHeaders(response) — Private: extract Total-Count and Link
    // headers from a fetch Response for pagination support.
    // ---------------------------------------------------------------
    function extractHeaders(response) {
        const totalCount = response.headers.get('Total-Count');
        const link = response.headers.get('Link');
        return {
            totalCount: totalCount ? parseInt(totalCount, 10) : null,
            link: link || null
        };
    }

    // ---------------------------------------------------------------
    // parseErrorBody(response) — Private: attempt to parse the error
    // body from a failed response. Returns { message, errors } or
    // defaults if parsing fails.
    // ---------------------------------------------------------------
    async function parseErrorBody(response) {
        try {
            const data = await response.json();
            return {
                message: data.message || data.cause || data.error || '',
                errors: data.errors || []
            };
        } catch {
            return {
                message: I18n.t('api.requestFailed', {status: response.status}),
                errors: []
            };
        }
    }

    // ---------------------------------------------------------------
    // checkProxy() — Test if the local proxy server is reachable by
    // hitting /healthz. Returns: true (up), false (down), null (no proxy).
    // ---------------------------------------------------------------
    async function checkProxy() {
        try {
            const response = await fetch('/healthz', {
                method: 'GET',
                signal: AbortSignal.timeout(3000)
            });
            if (response.status === 404) {
                return null;
            }
            return response.ok;
        } catch {
            return false;
        }
    }

    // ---------------------------------------------------------------
    // notifyProxyDown() — Private: fire-and-forget proxy check after
    // a network error. Shows a specific toast if the proxy is down.
    // ---------------------------------------------------------------
    function notifyProxyDown() {
        checkProxy().then(function(result) {
            if (result === false && typeof UI !== 'undefined' && UI.toast) {
                UI.toast('warning', I18n.t('api.proxyDown'));
            }
        });
    }

    // ---------------------------------------------------------------
    // Convenience methods — delegate to request()
    // ---------------------------------------------------------------

    /** GET with absolute path (no baseUrl prefix). */
    async function rawGet(path, options) {
        return await request('GET', path, undefined, options, 0, false, true);
    }

    /** GET with absolute path + response headers (Total-Count, Link). */
    async function rawGetWithHeaders(path, options) {
        return await request('GET', path, undefined, options, 0, true, true);
    }

    /** GET request — retrieve resource. options.signal for AbortController. */
    async function get(path, options) {
        return await request('GET', path, undefined, options);
    }

    /** POST request — create resource. options.signal for AbortController. */
    async function post(path, body, options) {
        return await request('POST', path, body, options);
    }

    /** PUT request — replace resource. options.signal for AbortController. */
    async function put(path, body, options) {
        return await request('PUT', path, body, options);
    }

    /** PATCH request — partial update. options.signal for AbortController. */
    async function patch(path, body, options) {
        return await request('PATCH', path, body, options);
    }

    /** DELETE request — remove resource. options.signal for AbortController. */
    async function del(path, options) {
        return await request('DELETE', path, undefined, options);
    }

    // ---------------------------------------------------------------
    // getText(path) — GET with Accept: text/plain for zone file export.
    // Returns the response as plain text string.
    // ---------------------------------------------------------------
    async function getText(path) {
        const token = State.get('token');
        if (!token) {
            throw {
                status: 0,
                message: I18n.t('api.noToken'),
                errors: []
            };
        }

        const url = baseUrl + path;
        let response;
        try {
            response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Authorization': 'Bearer ' + token,
                    'Accept': 'text/plain'
                }
            });
        } catch (err) {
            throw {
                status: 0,
                message: err.message || I18n.t('api.networkError'),
                errors: []
            };
        }

        if (response.status === 401) {
            State.set('token', null);
            throw {
                status: 401,
                message: I18n.t('api.authFailed'),
                errors: []
            };
        }
        if (!response.ok) {
            throw {
                status: response.status,
                message: I18n.t('api.requestFailed', {status: response.status}),
                errors: []
            };
        }
        return await response.text();
    }

    // ---------------------------------------------------------------
    // putText(path, text) — PUT with Content-Type: text/plain for
    // zone file import. Returns the response as parsed JSON.
    // ---------------------------------------------------------------
    async function putText(path, text) {
        const token = State.get('token');
        if (!token) {
            throw {
                status: 0,
                message: I18n.t('api.noToken'),
                errors: []
            };
        }

        const url = baseUrl + path;
        let response;
        try {
            response = await fetch(url, {
                method: 'PUT',
                headers: {
                    'Authorization': 'Bearer ' + token,
                    'Content-Type': 'text/plain'
                },
                body: text
            });
        } catch (err) {
            throw {
                status: 0,
                message: err.message || I18n.t('api.networkError'),
                errors: []
            };
        }

        if (response.status === 401) {
            State.set('token', null);
            throw {
                status: 401,
                message: I18n.t('api.authFailed'),
                errors: []
            };
        }
        if (response.status === 204) {
            return null;
        }
        if (!response.ok) {
            let errBody;
            try { errBody = await response.json(); } catch { errBody = {}; }
            throw {
                status: response.status,
                message: (errBody && errBody.message) || I18n.t('api.importFailed', {status: response.status}),
                errors: (errBody && errBody.errors) || []
            };
        }
        return await response.json();
    }

    // ---------------------------------------------------------------
    // testConnection() — Verify the current token by hitting the
    // /domains endpoint. Returns true if successful, false otherwise.
    // NEVER exposes the token in console output.
    // ---------------------------------------------------------------
    async function testConnection() {
        try {
            await get('/domains');
            return true;
        } catch {
            return false;
        }
    }

    // ---------------------------------------------------------------
    // fetchRRTypes() — GET /dns/rrtypes — returns array of supported
    // DNS record types.
    // ---------------------------------------------------------------
    async function fetchRRTypes() {
        return await get('/dns/rrtypes');
    }

    // ---------------------------------------------------------------
    // Public API
    // ---------------------------------------------------------------
    return {
        get: get,
        post: post,
        put: put,
        patch: patch,
        del: del,
        rawGet: rawGet,
        rawGetWithHeaders: rawGetWithHeaders,
        getText: getText,
        putText: putText,
        setBaseUrl: setBaseUrl,
        getBaseUrl: getBaseUrl,
        testConnection: testConnection,
        fetchRRTypes: fetchRRTypes,
        checkProxy: checkProxy
    };
})();
