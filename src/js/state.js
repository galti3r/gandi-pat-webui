/**
 * State — Centralized state management with event-driven notifications.
 *
 * Keys: token, storageMode, currentDomain, domains, records, dnssecKeys,
 *       nameservers, activeTab, theme
 *
 * Every set() that changes a value emits a '{key}Changed' event to all
 * registered listeners. Subscribers receive (newValue, oldValue).
 */
const State = (function() {
    'use strict';

    // ---------------------------------------------------------------
    // Private store — flat object, keys listed in module doc above
    // ---------------------------------------------------------------
    let store = {};

    // ---------------------------------------------------------------
    // Private listeners — { eventName: [callback, ...] }
    // ---------------------------------------------------------------
    const listeners = {};

    // ---------------------------------------------------------------
    // Default values applied during init()
    // ---------------------------------------------------------------
    const defaults = {
        token: null,
        storageMode: 'session', // 'memory' | 'session' | 'local'
        currentDomain: null,
        domains: [],
        records: [],
        dnssecKeys: [],
        nameservers: [],
        activeTab: 'records',
        theme: 'dark',
        autoRefresh: 0
    };

    // ---------------------------------------------------------------
    // get(key) — Return the current value for a state key.
    // ---------------------------------------------------------------
    function get(key) {
        return store[key];
    }

    // ---------------------------------------------------------------
    // set(key, value) — Update the store. If the value is different
    // from the current one (strict equality for primitives, always
    // fire for objects/arrays), emit a '{key}Changed' event.
    // ---------------------------------------------------------------
    function set(key, value) {
        const oldValue = store[key];

        // For primitives, skip if identical.
        // For objects/arrays we always fire because deep-equal is expensive
        // and callers expect the event after every set with a reference type.
        const changed = (typeof value === 'object' && value !== null)
            ? true
            : (oldValue !== value);

        store[key] = value;

        if (changed) {
            emit(key + 'Changed', value, oldValue);
        }
    }

    // ---------------------------------------------------------------
    // on(event, callback) — Subscribe to a named event.
    // ---------------------------------------------------------------
    function on(event, callback) {
        if (typeof callback !== 'function') {
            return;
        }
        if (!listeners[event]) {
            listeners[event] = [];
        }
        listeners[event].push(callback);
    }

    // ---------------------------------------------------------------
    // off(event, callback) — Unsubscribe a specific callback.
    // If callback is omitted, remove all listeners for the event.
    // ---------------------------------------------------------------
    function off(event, callback) {
        if (!listeners[event]) {
            return;
        }
        if (!callback) {
            delete listeners[event];
            return;
        }
        listeners[event] = listeners[event].filter(cb => cb !== callback);
    }

    // ---------------------------------------------------------------
    // emit(event, ...args) — Private: notify all listeners for event.
    // Errors in individual callbacks are caught so one failing listener
    // does not block subsequent ones.
    // ---------------------------------------------------------------
    function emit(event, ...args) {
        if (!listeners[event]) {
            return;
        }
        const cbs = listeners[event].slice(); // snapshot to avoid mutation issues
        for (let i = 0; i < cbs.length; i++) {
            try {
                cbs[i].apply(null, args);
            } catch (err) {
                // Never swallow silently — log without sensitive data
                console.error('[State] Listener error on "' + event + '":', err);
            }
        }
    }

    // ---------------------------------------------------------------
    // init() — Restore persisted token from storage (if any) and
    // apply default values for all state keys.
    // ---------------------------------------------------------------
    function init() {
        // Clear any previously registered listeners to prevent accumulation
        off('tokenChanged');
        off('storageModeChanged');
        off('themeChanged');

        // Reset store to a clean slate, then apply defaults
        store = {};
        const keys = Object.keys(defaults);
        for (let i = 0; i < keys.length; i++) {
            store[keys[i]] = defaults[keys[i]];
        }

        // Attempt to restore token from sessionStorage or localStorage.
        // We check sessionStorage first (default), then localStorage.
        let restored = null;
        try {
            restored = sessionStorage.getItem('gandi_pat');
            if (restored) {
                store.storageMode = 'session';
            } else {
                restored = localStorage.getItem('gandi_pat');
                if (restored) {
                    store.storageMode = 'local';
                }
            }
        } catch {
            // Storage may be unavailable (private browsing, etc.)
        }

        if (restored) {
            store.token = restored;
        }

        // Restore theme preference
        try {
            const savedTheme = localStorage.getItem('gandi_theme');
            if (savedTheme === 'light' || savedTheme === 'dark') {
                store.theme = savedTheme;
            }
        } catch {
            // Ignore storage errors
        }

        // Listen for token changes to persist/clear storage
        on('tokenChanged', (newToken) => {
            syncTokenToStorage(newToken, store.storageMode);
        });

        // Listen for storageMode changes to migrate token
        on('storageModeChanged', (newMode) => {
            syncTokenToStorage(store.token, newMode);
        });

        // Listen for theme changes to persist preference
        on('themeChanged', (newTheme) => {
            try {
                localStorage.setItem('gandi_theme', newTheme);
            } catch {
                // Ignore storage errors
            }
        });
    }

    // ---------------------------------------------------------------
    // syncTokenToStorage(token, mode) — Private: clear both storages
    // and write the token to the correct one based on mode.
    // Used by both tokenChanged and storageModeChanged listeners.
    // ---------------------------------------------------------------
    function syncTokenToStorage(token, mode) {
        try {
            // Clear both storages first
            sessionStorage.removeItem('gandi_pat');
            localStorage.removeItem('gandi_pat');

            if (token && mode === 'session') {
                sessionStorage.setItem('gandi_pat', token);
            } else if (token && mode === 'local') {
                localStorage.setItem('gandi_pat', token);
            }
            // mode === 'memory' — nothing persisted
        } catch {
            // Storage unavailable
        }
    }

    // ---------------------------------------------------------------
    // Public API
    // ---------------------------------------------------------------
    return {
        get: get,
        set: set,
        on: on,
        off: off,
        init: init
    };
})();
