/**
 * Auth — Authentication module for the Gandi DNS WebUI.
 *
 * Handles connecting/disconnecting with a Gandi Personal Access Token,
 * toggling token visibility, and displaying the masked token in the
 * application header.
 *
 * Depends on: State, API, UI
 */
const Auth = (function() {
    'use strict';

    // ---------------------------------------------------------------
    // Private: callback invoked after a successful connection.
    // Stored during init(), called by connect().
    // ---------------------------------------------------------------
    let onConnectedCallback = null;

    // ---------------------------------------------------------------
    // Private: guard to prevent concurrent connect() calls.
    // A second connect() while one is in-flight is silently ignored.
    // ---------------------------------------------------------------
    let connectInProgress = false;

    // ---------------------------------------------------------------
    // connect(token, storageMode) — Authenticate with the Gandi API.
    //
    // - Validates the token is non-empty
    // - Persists the storage mode and token in State
    // - Calls API.testConnection() to verify the token
    // - On success: switches from auth view to app view, notifies
    //   the onConnected callback
    // - On failure: clears the token from State, shows error toast
    // ---------------------------------------------------------------
    function connect(token, storageMode) {
        // Validate that a token was provided
        if (!token || !token.trim()) {
            UI.toast('error', I18n.t('auth.emptyToken'));
            return;
        }

        // Prevent concurrent connections (e.g. auto-connect + manual click)
        if (connectInProgress) return;
        connectInProgress = true;

        const trimmedToken = token.trim();

        // Store token in memory only during verification to avoid
        // persisting an unvalidated token in storage (F-013).
        // Force 'memory' mode so the tokenChanged listener in State
        // does not write to sessionStorage/localStorage.
        State.set('storageMode', 'memory');
        State.set('token', trimmedToken);

        // Verify the token by fetching the first page of domains.
        // Success validates the PAT and returns domain data for immediate use.
        UI.apiAction({
            apiCall: () => API.rawGetWithHeaders(
                '/v5/domain/domains?nameserver=livedns&per_page=100&page=1'
            ),
            loadingTarget: 'auth-card',
            errorMessage: I18n.t('auth.connectionFailed'),
            onSuccess: result => {
                connectInProgress = false;

                // Token verified — now persist with the real storage mode.
                // Setting storageMode triggers migrateToken() which writes
                // the token to the chosen storage backend.
                State.set('storageMode', storageMode);

                // Hide auth screen, show main application
                document.getElementById('auth-section').classList.add('hidden');
                document.getElementById('app-section').classList.remove('hidden');

                // Update the connection indicator in the status bar
                updateConnectionIndicator(true);

                // Notify the application that authentication succeeded,
                // passing the first page of domains for immediate rendering
                if (typeof onConnectedCallback === 'function') {
                    onConnectedCallback(result);
                }
            },
            onError: () => {
                connectInProgress = false;

                // Connection test threw — clear token and restore auth view
                State.set('token', null);
                document.getElementById('app-section').classList.add('hidden');
                document.getElementById('auth-section').classList.remove('hidden');
            }
        });
    }

    // ---------------------------------------------------------------
    // disconnect() — Clear authentication state and return to the
    // login screen.
    //
    // - Clears token and all domain-related state
    // - Switches from app view back to auth view
    // - Resets the token input field
    // - Shows an informational toast
    // ---------------------------------------------------------------
    function disconnect() {
        connectInProgress = false;

        // Clear authentication and domain data from State
        State.set('token', null);
        State.set('currentDomain', null);
        State.set('domains', []);
        State.set('records', []);
        State.set('dnssecKeys', []);
        State.set('nameservers', []);

        // Switch views: hide app, show auth
        document.getElementById('app-section').classList.add('hidden');
        document.getElementById('auth-section').classList.remove('hidden');

        // Update the connection indicator
        updateConnectionIndicator(false);

        // Clear the token input so it does not retain the old value
        const tokenInput = document.getElementById('auth-token-input');
        if (tokenInput) {
            tokenInput.value = '';
        }

        UI.toast('info', I18n.t('auth.disconnected'));
    }

    // ---------------------------------------------------------------
    // toggleTokenVisibility() — Toggle the auth token input between
    // type="password" (masked) and type="text" (visible).
    // ---------------------------------------------------------------
    function toggleTokenVisibility() {
        const tokenInput = document.getElementById('auth-token-input');
        if (!tokenInput) {
            return;
        }

        if (tokenInput.type === 'password') {
            tokenInput.type = 'text';
        } else {
            tokenInput.type = 'password';
        }
    }

    // ---------------------------------------------------------------
    // updateConnectionIndicator(connected) — Private: update the
    // status bar connection state visual indicator.
    // ---------------------------------------------------------------
    function updateConnectionIndicator(connected) {
        const indicator = document.getElementById('status-connection');
        if (!indicator) {
            return;
        }
        indicator.textContent = connected ? I18n.t('status.connected') : I18n.t('status.disconnected');
    }

    // ---------------------------------------------------------------
    // getSelectedStorageMode() — Private: read the currently selected
    // storage mode radio button value. Defaults to 'session'.
    // ---------------------------------------------------------------
    function getSelectedStorageMode() {
        const radios = document.querySelectorAll('input[name="storage-mode"]');
        for (let i = 0; i < radios.length; i++) {
            if (radios[i].checked) {
                return radios[i].value;
            }
        }
        return 'session';
    }

    // ---------------------------------------------------------------
    // init(onConnected) — Initialize the authentication module.
    //
    // - Stores the onConnected callback for later use
    // - Binds event listeners to auth-related UI elements:
    //     [data-action="connect"]                → connect()
    //     [data-action="toggle-token-visibility"] → toggleTokenVisibility()
    //     [data-action="disconnect"]              → disconnect()
    //     Token input Enter key                   → trigger connect
    // - Auto-connects if a token was restored from storage
    // ---------------------------------------------------------------
    function init(onConnected) {
        // Store the callback for use after successful authentication
        onConnectedCallback = onConnected;

        // --- Connect button ---
        const connectBtns = document.querySelectorAll('[data-action="connect"]');
        for (let i = 0; i < connectBtns.length; i++) {
            connectBtns[i].addEventListener('click', () => {
                const tokenInput = document.getElementById('auth-token-input');
                const token = tokenInput ? tokenInput.value : '';
                const storageMode = getSelectedStorageMode();
                connect(token, storageMode);
            });
        }

        // --- Toggle token visibility button ---
        const toggleBtns = document.querySelectorAll('[data-action="toggle-token-visibility"]');
        for (let j = 0; j < toggleBtns.length; j++) {
            toggleBtns[j].addEventListener('click', () => {
                toggleTokenVisibility();
            });
        }

        // --- Token input: Enter key triggers connect ---
        const tokenInput = document.getElementById('auth-token-input');
        if (tokenInput) {
            tokenInput.addEventListener('keydown', e => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    const storageMode = getSelectedStorageMode();
                    connect(tokenInput.value, storageMode);
                }
            });
        }

        // --- Disconnect button ---
        const disconnectBtns = document.querySelectorAll('[data-action="disconnect"]');
        for (let k = 0; k < disconnectBtns.length; k++) {
            disconnectBtns[k].addEventListener('click', () => {
                disconnect();
            });
        }

        // --- Auto-connect if token was restored from storage ---
        const restoredToken = State.get('token');
        if (restoredToken) {
            connect(restoredToken, State.get('storageMode'));
        }
    }

    // ---------------------------------------------------------------
    // Public API
    // ---------------------------------------------------------------
    return {
        init: init,
        connect: connect,
        disconnect: disconnect
    };
})();
