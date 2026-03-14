/**
 * DNSSEC — DNSSEC key management module for the Gandi DNS WebUI.
 *
 * Fetches and displays DNSSEC keys (DS records, algorithm, flags) for
 * the currently selected domain. Keys are read-only because Gandi
 * manages DNSSEC signing server-side.
 *
 * DOM dependencies:
 *   #content-dnssec  — tab panel container
 *
 * Module dependencies: State, API, UI, Helpers
 */
const DNSSEC = (function() {
    'use strict';

    /** AbortController for the current fetchKeys() call (race condition guard). */
    let currentAbortController = null;

    // ---------------------------------------------------------------
    // fetchKeys() — Load DNSSEC keys from the Gandi API.
    //
    // Uses UI.apiAction for consistent loading state, error handling,
    // and state persistence via the 'dnssecKeys' state key.
    //
    // Gandi API returns an array of key objects:
    //   { id, algorithm, ds, fingerprint, flags, key_href, status, ... }
    // ---------------------------------------------------------------
    function fetchKeys() {
        // Abort any in-flight request to avoid race conditions
        if (currentAbortController) {
            currentAbortController.abort();
        }
        currentAbortController = new AbortController();
        const signal = currentAbortController.signal;

        return UI.apiAction({
            loadingTarget: 'content-dnssec',
            apiCall: () => API.get(Helpers.domainPath('keys'), { signal: signal }),
            stateKey: 'dnssecKeys',
            errorMessage: I18n.t('dnssec.fetchError')
        });
    }

    // ---------------------------------------------------------------
    // renderKeys() — Render the DNSSEC keys table into the tab panel.
    //
    // Reads keys from State and builds a read-only table with columns:
    //   id, algorithm, flags (KSK/ZSK label), status (badge), ds (truncated).
    // No action buttons — keys are managed by Gandi.
    // ---------------------------------------------------------------
    function renderKeys() {
        const container = document.getElementById('content-dnssec');
        if (!container) {
            return;
        }

        // Clear previous content
        container.textContent = '';

        const keys = State.get('dnssecKeys') || [];

        // Section header with description
        const header = UI.createElement('div', { className: 'section-header' }, [
            UI.createElement('h2', {
                className: 'section-header__title',
                textContent: I18n.t('dnssec.title')
            }),
            UI.createElement('p', {
                className: 'section-header__description',
                textContent: I18n.t('dnssec.description')
            })
        ]);
        container.appendChild(header);

        // Empty state
        if (keys.length === 0) {
            const emptyState = UI.createElement('div', { className: 'table-empty' }, [
                UI.createElement('p', {
                    textContent: I18n.t('dnssec.empty')
                })
            ]);
            container.appendChild(emptyState);
            appendManagedNote(container);
            return;
        }

        // Table container for renderTable
        const tableContainer = UI.createElement('div', { id: 'dnssec-keys-table' });
        container.appendChild(tableContainer);

        // Render the keys table
        UI.renderTable({
            containerId: 'dnssec-keys-table',
            data: keys,
            columns: [
                {
                    key: 'id',
                    label: I18n.t('dnssec.col.id'),
                    sortable: false
                },
                {
                    key: 'algorithm',
                    label: I18n.t('dnssec.col.algorithm'),
                    sortable: false
                },
                {
                    key: 'flags',
                    label: I18n.t('dnssec.col.flags'),
                    sortable: false,
                    render: (value) => {
                        // 257 = Key Signing Key (KSK), 256 = Zone Signing Key (ZSK)
                        let label = '';
                        if (value === 257) {
                            label = I18n.t('dnssec.ksk', {value: value});
                        } else if (value === 256) {
                            label = I18n.t('dnssec.zsk', {value: value});
                        } else {
                            label = String(value !== null && value !== undefined ? value : '');
                        }
                        return UI.createElement('span', {
                            className: 'badge badge--info',
                            textContent: label,
                            title: value === 257
                                ? I18n.t('dnssec.kskTitle')
                                : value === 256
                                    ? I18n.t('dnssec.zskTitle')
                                    : I18n.t('dnssec.unknownFlag')
                        });
                    }
                },
                {
                    key: 'status',
                    label: I18n.t('dnssec.col.status'),
                    sortable: false,
                    render: (value) => {
                        let statusClass = 'badge';
                        const statusText = String(value || 'unknown');
                        if (statusText === 'active') {
                            statusClass += ' badge--success';
                        } else if (statusText === 'inactive' || statusText === 'disabled') {
                            statusClass += ' badge--warning';
                        } else {
                            statusClass += ' badge--secondary';
                        }
                        return UI.createElement('span', {
                            className: statusClass,
                            textContent: statusText
                        });
                    }
                },
                {
                    key: 'ds',
                    label: I18n.t('dnssec.col.ds'),
                    sortable: false,
                    render: (value) => {
                        if (!value) {
                            return UI.createElement('span', {
                                className: 'text-muted',
                                textContent: I18n.t('dnssec.na')
                            });
                        }

                        const fullDs = String(value);
                        const truncated = Helpers.truncate(fullDs, 40);

                        return UI.createElement('code', {
                            textContent: truncated,
                            title: fullDs
                        });
                    }
                }
            ],
            emptyMessage: I18n.t('dnssec.empty')
        });

        // Informational note about Gandi management
        appendManagedNote(container);
    }

    // ---------------------------------------------------------------
    // appendManagedNote(container) — Private: append a note explaining
    // that DNSSEC keys are managed by Gandi, not editable here.
    // ---------------------------------------------------------------
    function appendManagedNote(container) {
        const note = UI.createElement('div', { className: 'info-note' }, [
            UI.createElement('p', {
                textContent: I18n.t('dnssec.managedNote')
            })
        ]);
        container.appendChild(note);
    }

    // ---------------------------------------------------------------
    // init() — Subscribe to state events for tab lifecycle.
    //
    // - currentDomainChanged: fetch keys if the DNSSEC tab is active
    // - activeTabChanged: initialize tab when switching to 'dnssec'
    // ---------------------------------------------------------------
    function init() {
        // When the selected domain changes, refresh keys if this tab is visible
        State.on('currentDomainChanged', () => {
            if (State.get('activeTab') === 'dnssec') {
                fetchKeys();
            }
        });

        // When the user switches to the DNSSEC tab, initialize it
        State.on('activeTabChanged', (newTab) => {
            if (newTab === 'dnssec' && State.get('currentDomain')) {
                UI.initTab('content-dnssec', renderKeys, fetchKeys, true);
            }
        });

        // Re-render when language changes
        State.on('languageChanged', () => {
            if (State.get('dnssecKeys') && State.get('activeTab') === 'dnssec') {
                renderKeys();
            }
        });
    }

    // ---------------------------------------------------------------
    // Public API
    // ---------------------------------------------------------------
    return {
        init: init,
        fetchKeys: fetchKeys,
        renderKeys: renderKeys
    };
})();
