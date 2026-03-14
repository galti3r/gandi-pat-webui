/**
 * Nameservers — Nameserver display and editing module for the Gandi DNS WebUI.
 *
 * Fetches, displays, and allows editing of the nameserver list for the
 * currently selected domain. Click-to-copy on FQDN values.
 *
 * DOM dependencies:
 *   #content-nameservers  — tab panel container
 *
 * Module dependencies: State, API, UI, Helpers, I18n, History
 */
const Nameservers = (function() {
    'use strict';

    /** AbortController for the current fetchNameservers() call (race condition guard). */
    let currentAbortController = null;

    // ---------------------------------------------------------------
    // fetchNameservers() — Load nameservers from the Gandi API.
    //
    // Gandi API returns a flat array of nameserver FQDN strings:
    //   ["ns-123-a.gandi.net", "ns-456-b.gandi.net", ...]
    // ---------------------------------------------------------------
    function fetchNameservers() {
        if (currentAbortController) {
            currentAbortController.abort();
        }
        currentAbortController = new AbortController();
        const signal = currentAbortController.signal;

        return UI.apiAction({
            loadingTarget: 'content-nameservers',
            apiCall: () => API.get(Helpers.domainPath('nameservers'), { signal: signal }),
            stateKey: 'nameservers',
            errorMessage: I18n.t('ns.fetchError')
        });
    }

    // ---------------------------------------------------------------
    // renderNameservers() — Render the nameserver list with
    // click-to-copy FQDN and an Edit button.
    // ---------------------------------------------------------------
    function renderNameservers() {
        const container = document.getElementById('content-nameservers');
        if (!container) {
            return;
        }

        container.textContent = '';

        const nameservers = State.get('nameservers') || [];

        // Section header
        const header = UI.createElement('div', { className: 'section-header' }, [
            UI.createElement('h2', {
                className: 'section-header__title',
                textContent: I18n.t('ns.title')
            }),
            UI.createElement('p', {
                className: 'section-header__description',
                textContent: I18n.t('ns.description')
            })
        ]);
        container.appendChild(header);

        // Empty state
        if (nameservers.length === 0) {
            container.appendChild(UI.createElement('div', { className: 'table-empty' }, [
                UI.createElement('p', { textContent: I18n.t('ns.empty') })
            ]));
            return;
        }

        // Table container
        const tableContainer = UI.createElement('div', { id: 'nameservers-table' });
        container.appendChild(tableContainer);

        // Transform flat array to objects
        const tableData = [];
        for (let i = 0; i < nameservers.length; i++) {
            tableData.push({ index: i + 1, fqdn: nameservers[i] });
        }

        // Render table with click-to-copy FQDN (no separate actions column)
        UI.renderTable({
            containerId: 'nameservers-table',
            data: tableData,
            columns: [
                {
                    key: 'index',
                    label: I18n.t('ns.col.index'),
                    sortable: false,
                    className: 'table__td--narrow table__td--ns-index'
                },
                {
                    key: 'fqdn',
                    label: I18n.t('ns.col.nameserver'),
                    sortable: false,
                    className: 'table__td--ns-fqdn',
                    render: (value, item) => {
                        const code = UI.createElement('code', {
                            textContent: value,
                            className: 'record-values--copyable',
                            title: I18n.t('ns.copyTitle'),
                            events: {
                                click: (e) => {
                                    e.stopPropagation();
                                    UI.copyToClipboard(value, I18n.t('ns.copyLabel'));
                                }
                            }
                        });
                        code.dataset.nsIndex = String(item.index);
                        return code;
                    }
                }
            ],
            emptyMessage: I18n.t('ns.empty')
        });

        // Info note
        const note = UI.createElement('div', { className: 'info-note' }, [
            UI.createElement('p', { textContent: I18n.t('ns.registrarNote') })
        ]);
        container.appendChild(note);

        // Edit button
        const editBtn = UI.createElement('button', {
            type: 'button',
            className: 'btn btn--primary',
            textContent: I18n.t('ns.editButton'),
            style: { marginTop: 'var(--spacing-md)' },
            events: {
                click: () => handleEditNameservers()
            }
        });
        container.appendChild(editBtn);
    }

    // ---------------------------------------------------------------
    // handleEditNameservers() — Show the nameserver editing modal.
    // ---------------------------------------------------------------
    function handleEditNameservers() {
        const domain = State.get('currentDomain');
        if (!domain) return;

        const currentNs = (State.get('nameservers') || []).slice();
        const bodyEl = UI.createElement('div', { className: 'ns-edit' });

        // Warning box
        const warning = UI.createElement('div', { className: 'form__warning form__warning--danger' }, [
            UI.createElement('strong', { textContent: I18n.t('ns.editWarning') }),
            UI.createElement('p', {
                textContent: I18n.t('ns.editWarningDetail'),
                style: { margin: 'var(--spacing-xs) 0 0' }
            })
        ]);
        bodyEl.appendChild(warning);

        // NS inputs container
        const inputsList = UI.createElement('div', {
            className: 'ns-edit__list',
            style: { margin: 'var(--spacing-md) 0' }
        });
        bodyEl.appendChild(inputsList);

        // Pre-fill with current nameservers
        for (let i = 0; i < currentNs.length; i++) {
            addNsInputRow(inputsList, currentNs[i], i > 0);
        }
        // Ensure at least 2 rows
        while (inputsList.children.length < 2) {
            addNsInputRow(inputsList, '', false);
        }

        // Add nameserver button
        const addBtn = UI.createElement('button', {
            type: 'button',
            className: 'btn btn--sm',
            textContent: I18n.t('ns.addNs'),
            events: {
                click: () => addNsInputRow(inputsList, '', true)
            }
        });
        bodyEl.appendChild(addBtn);

        // Error display
        const errorEl = UI.createElement('div', {
            className: 'form__error',
            role: 'alert',
            style: { marginTop: 'var(--spacing-sm)' }
        });
        bodyEl.appendChild(errorEl);

        // Propagation note
        bodyEl.appendChild(UI.createElement('p', {
            className: 'form__help',
            textContent: I18n.t('ns.propagationNote'),
            style: { marginTop: 'var(--spacing-md)' }
        }));

        // Action buttons
        const actions = UI.createElement('div', { className: 'form__actions' });
        actions.appendChild(UI.createElement('button', {
            type: 'button',
            className: 'btn btn--danger',
            textContent: I18n.t('ns.saveButton'),
            events: {
                click: () => {
                    // Validate and save
                    const newNs = collectNsValues(inputsList);
                    const validationError = validateNsList(newNs);
                    if (validationError) {
                        errorEl.textContent = validationError;
                        return;
                    }
                    errorEl.textContent = '';
                    saveNameservers(newNs, currentNs);
                }
            }
        }));
        actions.appendChild(UI.createElement('button', {
            type: 'button',
            className: 'btn',
            textContent: I18n.t('ui.cancel'),
            events: { click: () => UI.closeModal() }
        }));
        bodyEl.appendChild(actions);

        // Snapshot initial state for dirty-checking
        const initialSnapshot = currentNs.join('\n');

        function beforeClose() {
            const currentValues = collectNsValues(inputsList);
            if (currentValues.join('\n') === initialSnapshot) return true;

            // Already showing confirmation bar?
            if (bodyEl.querySelector('.record-form__confirm')) return false;

            const bar = UI.createElement('div', { className: 'record-form__confirm' }, [
                UI.createElement('span', {
                    className: 'record-form__confirm-text',
                    textContent: I18n.t('records.discardChanges')
                }),
                UI.createElement('div', { className: 'record-form__confirm-actions' }, [
                    UI.createElement('button', {
                        type: 'button',
                        className: 'btn btn--danger btn--sm',
                        textContent: I18n.t('records.discard'),
                        events: { click: function() { UI.forceCloseModal(); } }
                    }),
                    UI.createElement('button', {
                        type: 'button',
                        className: 'btn btn--sm',
                        textContent: I18n.t('records.keepEditing'),
                        events: {
                            click: function() {
                                bar.parentNode.removeChild(bar);
                            }
                        }
                    })
                ])
            ]);
            bodyEl.appendChild(bar);
            return false;
        }

        const title = I18n.t('ns.editTitleDomain', { domain: domain });
        UI.showModal({ title: title, bodyEl: bodyEl, beforeClose: beforeClose });
    }

    // ---------------------------------------------------------------
    // addNsInputRow(container, value, showRemove) — Add an input row
    // for a nameserver FQDN.
    // ---------------------------------------------------------------
    function addNsInputRow(container, value, showRemove) {
        const row = UI.createElement('div', {
            className: 'ns-edit__row',
            style: { display: 'flex', gap: 'var(--spacing-sm)', marginBottom: 'var(--spacing-sm)', alignItems: 'center' }
        });

        const input = UI.createElement('input', {
            type: 'text',
            className: 'form__input',
            placeholder: I18n.t('ns.nsPlaceholder'),
            value: value || '',
            autocapitalize: 'none',
            autocorrect: 'off',
            spellcheck: false,
            style: { flex: '1' }
        });
        row.appendChild(input);

        if (showRemove) {
            row.appendChild(UI.createElement('button', {
                type: 'button',
                className: 'btn btn--icon record-form__remove-value',
                textContent: '\u2716',
                title: I18n.t('ns.removeNs'),
                ariaLabel: I18n.t('ns.removeNs'),
                events: {
                    click: () => {
                        row.parentNode.removeChild(row);
                        updateRemoveButtons(container);
                    }
                }
            }));
        }

        container.appendChild(row);
        updateRemoveButtons(container);
    }

    // ---------------------------------------------------------------
    // updateRemoveButtons(container) — Disable remove buttons if
    // fewer than 3 rows remain (minimum 2 NS required).
    // ---------------------------------------------------------------
    function updateRemoveButtons(container) {
        const rows = container.querySelectorAll('.ns-edit__row');
        const removeBtns = container.querySelectorAll('.record-form__remove-value');
        const canRemove = rows.length > 2;
        for (let i = 0; i < removeBtns.length; i++) {
            removeBtns[i].disabled = !canRemove;
            removeBtns[i].title = canRemove ? I18n.t('ns.removeNs') : I18n.t('ns.minRequired');
        }
    }

    // ---------------------------------------------------------------
    // collectNsValues(container) — Collect trimmed non-empty values
    // from all NS input rows.
    // ---------------------------------------------------------------
    function collectNsValues(container) {
        const inputs = container.querySelectorAll('input[type="text"]');
        const values = [];
        for (let i = 0; i < inputs.length; i++) {
            const val = inputs[i].value.trim();
            if (val) {
                values.push(val);
            }
        }
        return values;
    }

    // ---------------------------------------------------------------
    // validateNsList(nsList) — Validate the nameserver list.
    // Returns an error message string, or null if valid.
    // ---------------------------------------------------------------
    function validateNsList(nsList) {
        if (nsList.length < 2) {
            return I18n.t('ns.minRequired');
        }

        // Check each FQDN
        for (let i = 0; i < nsList.length; i++) {
            if (!Helpers.isValidFQDN(nsList[i])) {
                return I18n.t('ns.invalidFqdn') + ': ' + nsList[i];
            }
        }

        // Check for duplicates (case-insensitive)
        const seen = {};
        for (let j = 0; j < nsList.length; j++) {
            const lower = nsList[j].toLowerCase();
            if (seen[lower]) {
                return I18n.t('ns.duplicateNs') + ': ' + nsList[j];
            }
            seen[lower] = true;
        }

        return null;
    }

    // ---------------------------------------------------------------
    // saveNameservers(newNsArray, oldNsArray) — Save nameservers via
    // API and log to history.
    // ---------------------------------------------------------------
    function saveNameservers(newNsArray, oldNsArray) {
        const domain = State.get('currentDomain');

        UI.apiAction({
            apiCall: () => API.put(Helpers.domainPath('nameservers'), newNsArray),
            successMessage: I18n.t('ns.saveSuccess', { domain: domain }),
            errorMessage: I18n.t('ns.saveFailed'),
            onSuccess: () => {
                UI.forceCloseModal();

                // Log to history
                History.log({
                    domain: domain,
                    operation: 'ns-update',
                    before: { nameservers: oldNsArray },
                    after: { nameservers: newNsArray }
                });

                // Re-fetch to update UI
                fetchNameservers();
            }
        });
    }

    // ---------------------------------------------------------------
    // init() — Subscribe to state events for tab lifecycle.
    // ---------------------------------------------------------------
    function init() {
        State.on('currentDomainChanged', () => {
            if (State.get('activeTab') === 'nameservers') {
                fetchNameservers();
            }
        });

        State.on('activeTabChanged', (newTab) => {
            if (newTab === 'nameservers' && State.get('currentDomain')) {
                UI.initTab('content-nameservers', renderNameservers, fetchNameservers, true);
            }
        });

        State.on('languageChanged', () => {
            if (State.get('nameservers') && State.get('activeTab') === 'nameservers') {
                renderNameservers();
            }
        });
    }

    // ---------------------------------------------------------------
    // Public API
    // ---------------------------------------------------------------
    return {
        init: init,
        fetchNameservers: fetchNameservers,
        renderNameservers: renderNameservers
    };
})();
