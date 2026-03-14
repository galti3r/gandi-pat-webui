/**
 * Records — DNS Records CRUD module for the Gandi DNS WebUI.
 *
 * The main feature module: fetches, displays, creates, edits, and deletes
 * DNS records via the Gandi LiveDNS API. Supports all record types through
 * a three-tier form system (FULL / BASIC / RAW) defined in RecordTypes.
 *
 * Conventions:
 *   - All DOM construction via UI.createElement() (never innerHTML)
 *   - State via State.get/set
 *   - API calls via API.get/put/del, wrapped by UI.apiAction()
 *   - Validation via Validation.validateRecord/validateField
 *   - Record type metadata via RecordTypes.get/allTypes/byTier/hasDedicatedForm
 *   - Paths via Helpers.domainPath()
 */
const Records = (function() {
    'use strict';

    // ---------------------------------------------------------------
    // Private state
    // ---------------------------------------------------------------
    let sortColumn = 'rrset_name';
    let sortDirection = 'asc';
    let currentPage = 1;
    let searchFilter = '';
    let typeFilter = '';

    /** AbortController for the current fetchRecords() call (race condition guard). */
    let currentAbortController = null;

    /**
     * Pending operations: Map<'name/type', {
     *   opType: 'create' | 'update' | 'delete',
     *   timer,       // setTimeout 5s
     *   record,      // new record (create/update) or null (delete)
     *   oldRecord,   // previous record (update/delete) or null (create)
     *   name, rrset_type
     * }>
     */
    const pendingOperations = new Map();

    /** Set of selected record keys ('name/type') for bulk operations. */
    const selectedRecords = new Set();

    /** Critical record types that require an extra warning on edit/delete. */
    const CRITICAL_TYPES = ['NS', 'MX', 'SOA'];

    /** Common record types shown by default in the type selector. */
    const COMMON_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'SRV', 'CAA'];

    /**
     * getFormSnapshot(form) — Serialize all input/textarea/select values in a form
     * to a single string for dirty-checking.
     */
    function getFormSnapshot(form) {
        if (!form) return '';
        const parts = [];
        const els = form.querySelectorAll('input, textarea, select');
        for (let i = 0; i < els.length; i++) {
            parts.push(els[i].name + '=' + els[i].value);
        }
        return parts.join('&');
    }

    /**
     * makeBeforeClose(bodyEl, initialSnapshot) — Return a beforeClose callback
     * that shows a confirmation bar if the form has been modified.
     */
    function makeBeforeClose(bodyEl, initialSnapshot) {
        return function beforeClose() {
            const form = bodyEl.querySelector('form');
            if (!form) return true;
            const current = getFormSnapshot(form);
            if (current === initialSnapshot) return true;

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
        };
    }

    /** Debounced version of the search handler, created once. */
    const debouncedSearch = Helpers.debounce((value) => {
        searchFilter = value;
        currentPage = 1;
        const oldInput = document.querySelector('.toolbar__search');
        const cursorPos = oldInput ? oldInput.selectionStart : value.length;
        renderRecords();
        const newInput = document.querySelector('.toolbar__search');
        if (newInput) {
            newInput.focus({ preventScroll: true });
            newInput.setSelectionRange(cursorPos, cursorPos);
        }
    }, 300);

    // ---------------------------------------------------------------
    // Page size — Number of records displayed per table page.
    // ---------------------------------------------------------------
    const DEFAULT_PAGE_SIZE = 25;
    const PAGE_SIZE_OPTIONS = [10, 25, 50, 100, 0];

    function getPageSize() {
        const stored = State.get('pageSize');
        return stored !== null && stored !== undefined ? Number(stored) : DEFAULT_PAGE_SIZE;
    }

    // ---------------------------------------------------------------
    // executePendingOperation(pending, key) — Execute ONE pending API call.
    // ---------------------------------------------------------------
    function executePendingOperation(pending, key) {
        pendingOperations.delete(key);
        clearTimeout(pending.timer);

        // Capture full zone text before the operation (graceful: null on failure)
        const beforeZonePromise = API.getText(Helpers.domainPath('records')).catch(function() { return null; });

        return beforeZonePromise.then(function(beforeZone) {
            const afterRecord = pending.opType === 'delete'
                ? null
                : { rrset_ttl: pending.record.rrset_ttl, rrset_values: pending.record.rrset_values };

            const apiCall = pending.opType === 'delete'
                ? function() { return API.del(Helpers.domainPath('records', pending.name, pending.rrset_type)); }
                : function() { return API.put(
                    Helpers.domainPath('records', pending.name, pending.rrset_type),
                    { rrset_ttl: pending.record.rrset_ttl, rrset_values: pending.record.rrset_values }
                ); };

            const successMsg = pending.opType === 'delete'
                ? I18n.t('records.deleted', {type: pending.rrset_type, name: pending.name === '@' ? '@ (apex)' : pending.name})
                : I18n.t('records.saved', {type: pending.rrset_type, action: I18n.t(pending.opType === 'create' ? 'records.created' : 'records.updated')});

            const errorMsg = pending.opType === 'delete'
                ? I18n.t('records.deleteFailed', {type: pending.rrset_type})
                : I18n.t('records.saveFailed', {type: pending.rrset_type});

            return UI.apiAction({
                apiCall: apiCall,
                successMessage: successMsg,
                errorMessage: errorMsg,
                onSuccess: function() {
                    // Capture full zone text after the operation
                    API.getText(Helpers.domainPath('records')).catch(function() { return null; }).then(function(afterZone) {
                        History.log({
                            domain: State.get('currentDomain'),
                            operation: pending.opType,
                            recordName: pending.name,
                            recordType: pending.rrset_type,
                            before: pending.oldRecord ? { rrset_ttl: pending.oldRecord.rrset_ttl, rrset_values: pending.oldRecord.rrset_values } : null,
                            after: afterRecord,
                            beforeZone: beforeZone,
                            afterZone: afterZone
                        });
                    });
                    renderRecords();
                },
                onError: function() {
                    fetchRecords();
                }
            });
        });
    }

    // ---------------------------------------------------------------
    // executeBatchOperations(batchKeys, opType) — Execute a batch of
    // pending operations and log a single history entry.
    // ---------------------------------------------------------------
    function executeBatchOperations(batchKeys, opType) {
        // Collect all pending ops for this batch
        const ops = [];
        for (let i = 0; i < batchKeys.length; i++) {
            const pending = pendingOperations.get(batchKeys[i]);
            if (pending) {
                pendingOperations.delete(batchKeys[i]);
                clearTimeout(pending.timer);
                ops.push({ pending: pending, key: batchKeys[i] });
            }
        }

        if (ops.length === 0) return Promise.resolve();

        // Capture zone text before all operations
        const beforeZonePromise = API.getText(Helpers.domainPath('records')).catch(function() { return null; });

        return beforeZonePromise.then(function(beforeZone) {
            // Execute all API calls sequentially
            let chain = Promise.resolve();
            const historyItems = [];
            let failCount = 0;

            for (let j = 0; j < ops.length; j++) {
                (function(op) {
                    chain = chain.then(function() {
                        const p = op.pending;
                        const apiCall = p.opType === 'delete'
                            ? function() { return API.del(Helpers.domainPath('records', p.name, p.rrset_type)); }
                            : function() { return API.put(
                                Helpers.domainPath('records', p.name, p.rrset_type),
                                { rrset_ttl: p.record.rrset_ttl, rrset_values: p.record.rrset_values }
                            ); };

                        return apiCall().then(function() {
                            const afterRecord = p.opType === 'delete'
                                ? null
                                : { rrset_ttl: p.record.rrset_ttl, rrset_values: p.record.rrset_values };
                            historyItems.push({
                                recordName: p.name,
                                recordType: p.rrset_type,
                                before: p.oldRecord ? { rrset_ttl: p.oldRecord.rrset_ttl, rrset_values: p.oldRecord.rrset_values } : null,
                                after: afterRecord
                            });
                        }).catch(function() {
                            failCount++;
                        });
                    });
                })(ops[j]);
            }

            return chain.then(function() {
                // Show summary toast
                const successCount = historyItems.length;
                if (successCount > 0) {
                    const msgKey = opType === 'delete' ? 'records.bulkDeleteDone' : 'records.bulkUpdateDone';
                    UI.toast('success', I18n.t(msgKey, { count: successCount }));
                }
                if (failCount > 0) {
                    UI.toast('error', I18n.t('records.bulkPartialFail', { count: failCount }));
                }

                // Capture zone text after all operations, then log single history entry
                if (historyItems.length > 0) {
                    API.getText(Helpers.domainPath('records')).catch(function() { return null; }).then(function(afterZone) {
                        History.log({
                            domain: State.get('currentDomain'),
                            operation: opType === 'delete' ? 'bulk-delete' : 'bulk-update',
                            items: historyItems,
                            beforeZone: beforeZone,
                            afterZone: afterZone
                        });
                    });
                }

                fetchRecords();
            });
        });
    }

    // ---------------------------------------------------------------
    // flushPendingOperations() — Execute all pending API calls immediately.
    // ---------------------------------------------------------------
    function flushPendingOperations() {
        pendingOperations.forEach(function(pending, key) {
            executePendingOperation(pending, key);
        });
    }

    // ---------------------------------------------------------------
    // showUndoToast(opType, displayName, type, key) — Display a clickable
    // undo toast for any pending operation.
    // ---------------------------------------------------------------
    function showUndoToast(opType, displayName, type, key) {
        const verb = opType === 'create' ? 'created' : opType === 'update' ? 'updated' : 'deleted';
        UI.toast('info', I18n.t('records.undoToast', {type: type, name: displayName, verb: verb}), 5000);

        // Make the last info toast clickable for undo
        const toasts = document.querySelectorAll('.toast--info');
        const lastToast = toasts[toasts.length - 1];
        if (lastToast) {
            lastToast.style.cursor = 'pointer';
            lastToast.addEventListener('click', function() {
                const pending = pendingOperations.get(key);
                if (!pending) return;
                clearTimeout(pending.timer);
                pendingOperations.delete(key);

                const current = State.get('records') || [];
                if (opType === 'create') {
                    // Undo create: remove the new record from state
                    State.set('records', current.filter(function(r) {
                        return !(r.rrset_name === pending.name && r.rrset_type === pending.rrset_type);
                    }));
                } else if (opType === 'update') {
                    // Undo update: restore oldRecord
                    State.set('records', current.map(function(r) {
                        if (r.rrset_name === pending.name && r.rrset_type === pending.rrset_type) {
                            return pending.oldRecord;
                        }
                        return r;
                    }));
                } else {
                    // Undo delete: restore oldRecord
                    current.push(pending.oldRecord);
                    State.set('records', current);
                }
                renderRecords();
                UI.toast('success', I18n.t('records.restored', {type: type}));
            });
        }
    }

    // ---------------------------------------------------------------
    // showZoneUndoToast(savedText) — Display a clickable undo toast
    // after a zone-level text operation (edit-as-text or import).
    // Clicking restores the previous zone text via API.putText().
    // ---------------------------------------------------------------
    function showZoneUndoToast(savedText) {
        UI.toast('info', I18n.t('records.zone.undoToast'), 8000);

        const toasts = document.querySelectorAll('.toast--info');
        const lastToast = toasts[toasts.length - 1];
        if (lastToast) {
            lastToast.style.cursor = 'pointer';
            let undone = false;
            lastToast.addEventListener('click', function() {
                if (undone) return;
                undone = true;
                lastToast.style.cursor = '';
                lastToast.style.opacity = '0.5';
                API.putText(Helpers.domainPath('records'), savedText).then(function() {
                    UI.toast('success', I18n.t('records.zone.undoSuccess'));
                    fetchRecords();
                }).catch(function(err) {
                    UI.toast('error', (err && err.message) || I18n.t('records.zone.undoFailed'));
                });
            });
        }
    }

    // ---------------------------------------------------------------
    // fetchRecords() — Load DNS records for the current domain.
    //
    // Aborts any in-flight request before starting a new one to
    // prevent stale responses from overwriting current data when the
    // user switches domains rapidly (race condition guard).
    // ---------------------------------------------------------------
    function fetchRecords() {
        // Abort any in-flight request to avoid race conditions
        if (currentAbortController) {
            currentAbortController.abort();
        }
        currentAbortController = new AbortController();
        const signal = currentAbortController.signal;

        return UI.apiAction({
            loadingTarget: 'content-records',
            apiCall: () => API.get(Helpers.domainPath('records'), { signal: signal }),
            stateKey: 'records',
            errorMessage: I18n.t('records.fetchError'),
            onSuccess: () => {
                renderRecords();
            }
        });
    }

    // ---------------------------------------------------------------
    // renderRecords() — Build the toolbar and table for the records
    // tab. Reads data from State, applies search/type filters, and
    // delegates to UI.renderTable().
    // ---------------------------------------------------------------
    function renderRecords() {
        const container = document.getElementById('content-records');
        if (!container) return;

        let records = State.get('records');
        if (!records) {
            container.textContent = '';
            container.appendChild(UI.createElement('p', {
                className: 'content-panel__empty',
                textContent: I18n.t('records.selectDomain')
            }));
            return;
        }

        // Ensure records is an array
        if (!Array.isArray(records)) {
            records = [];
        }

        // Save scroll position for silent re-renders
        const scrollContainer = document.getElementById('content');
        const scrollTop = scrollContainer ? scrollContainer.scrollTop : 0;

        // Clear the panel and rebuild
        container.textContent = '';

        // --- Toolbar ---
        const toolbar = buildToolbar();
        container.appendChild(toolbar);

        // --- Bulk action bar (visible when records are selected) ---
        if (selectedRecords.size > 0) {
            const bulkBar = buildBulkActionBar();
            container.appendChild(bulkBar);
        }

        // --- Filter records ---
        const filtered = applyFilters(records);

        // --- Table container ---
        const tableContainer = UI.createElement('div', {
            id: 'records-table-container'
        });
        container.appendChild(tableContainer);

        // --- Render table ---
        UI.renderTable({
            containerId: 'records-table-container',
            data: filtered,
            rowClass: function(record) {
                const key = (record.rrset_name || '@') + '/' + record.rrset_type;
                const classes = [];
                if (pendingOperations.has(key)) classes.push('table__row--pending');
                if (selectedRecords.has(key)) classes.push('table__row--selected');
                return classes.join(' ');
            },
            onRowClick: function(record, e) {
                const target = e.target;
                if (target.closest('button, a, input, .record-name--copyable, .record-values--copyable')) return;
                if (record.rrset_type === 'SOA') return;
                const key = (record.rrset_name || '@') + '/' + record.rrset_type;
                if (pendingOperations.has(key)) return;
                if (selectedRecords.has(key)) {
                    selectedRecords.delete(key);
                } else {
                    selectedRecords.add(key);
                }
                renderRecords();
            },
            columns: [
                {
                    key: '_select',
                    className: 'table__td--checkbox',
                    headerRender: () => {
                        // Select-all checkbox for visible selectable records
                        const selectable = filtered.filter(r =>
                            r.rrset_type !== 'SOA' &&
                            !pendingOperations.has((r.rrset_name || '@') + '/' + r.rrset_type)
                        );
                        const allSelected = selectable.length > 0 &&
                            selectable.every(r => selectedRecords.has((r.rrset_name || '@') + '/' + r.rrset_type));
                        return UI.createElement('input', {
                            type: 'checkbox',
                            className: 'form__checkbox',
                            checked: allSelected,
                            disabled: selectable.length === 0,
                            ariaLabel: I18n.t('records.selectAll'),
                            events: {
                                change: (e) => {
                                    if (e.target.checked) {
                                        for (let s = 0; s < selectable.length; s++) {
                                            selectedRecords.add((selectable[s].rrset_name || '@') + '/' + selectable[s].rrset_type);
                                        }
                                    } else {
                                        selectedRecords.clear();
                                    }
                                    renderRecords();
                                }
                            }
                        });
                    },
                    render: (value, record) => {
                        if (record.rrset_type === 'SOA') return '';
                        const key = (record.rrset_name || '@') + '/' + record.rrset_type;
                        const hasPending = pendingOperations.has(key);
                        return UI.createElement('input', {
                            type: 'checkbox',
                            className: 'form__checkbox',
                            checked: selectedRecords.has(key),
                            disabled: hasPending,
                            ariaLabel: I18n.t('records.selectRecord', {name: record.rrset_name || '@', type: record.rrset_type}),
                            events: {
                                change: (e) => {
                                    if (e.target.checked) {
                                        selectedRecords.add(key);
                                    } else {
                                        selectedRecords.delete(key);
                                    }
                                    renderRecords();
                                }
                            }
                        });
                    }
                },
                {
                    key: 'rrset_name',
                    label: I18n.t('records.col.name'),
                    sortable: true,
                    render: (value) => {
                        const display = (value === '@' || value === '') ? '@' : value;
                        return UI.createElement('span', {
                            className: 'record-name record-name--copyable',
                            textContent: display,
                            title: I18n.t('records.copyName'),
                            events: {
                                click: (e) => {
                                    e.stopPropagation();
                                    UI.copyToClipboard(display, I18n.t('records.copyNameLabel'));
                                }
                            }
                        });
                    }
                },
                {
                    key: 'rrset_type',
                    label: I18n.t('records.col.type'),
                    sortable: true,
                    render: (value) => UI.createElement('span', {
                            className: 'tag tag--' + String(value).toLowerCase(),
                            textContent: value
                        })
                },
                {
                    key: 'rrset_ttl',
                    label: I18n.t('records.col.ttl'),
                    sortable: true,
                    render: function(value) {
                        const human = Helpers.formatTTL(value);
                        const raw = String(value);
                        // Skip parentheses when human format is just raw + 's'
                        const text = human === raw + 's' ? human : human + ' (' + raw + ')';
                        return UI.createElement('span', { textContent: text });
                    }
                },
                {
                    key: 'rrset_values',
                    label: I18n.t('records.values'),
                    render: (values) => {
                        if (!values || !Array.isArray(values) || values.length === 0) {
                            return UI.createElement('span', {
                                className: 'text-muted',
                                textContent: I18n.t('records.emptyValue')
                            });
                        }
                        const joined = values.join(', ');
                        const fullText = values.join('\n');
                        return UI.createElement('span', {
                            className: 'record-values record-values--copyable',
                            textContent: Helpers.truncate(joined, 80),
                            title: I18n.t('records.copyValue') + '\n' + fullText,
                            events: {
                                click: (e) => {
                                    e.stopPropagation();
                                    UI.copyToClipboard(fullText, I18n.t('records.copyLabel'));
                                }
                            }
                        });
                    }
                }
            ],
            actions: (record) => {
                // SOA records are read-only
                if (record.rrset_type === 'SOA') {
                    return null;
                }

                const recordKey = (record.rrset_name || '@') + '/' + record.rrset_type;
                const hasPending = pendingOperations.has(recordKey);

                const editBtn = UI.actionButton('\u270E', I18n.t('records.editRecord'), (e) => {
                    e.stopPropagation();
                    showEditForm(record);
                });
                const cloneBtn = UI.actionButton('\u29C9', I18n.t('records.cloneRecord'), (e) => {
                    e.stopPropagation();
                    showCloneForm(record);
                });
                const deleteBtn = UI.actionButton('\u2716', I18n.t('records.deleteRecord'), (e) => {
                    e.stopPropagation();
                    deleteRecord(record);
                });

                if (hasPending) {
                    editBtn.disabled = true;
                    cloneBtn.disabled = true;
                    deleteBtn.disabled = true;
                    editBtn.title = I18n.t('records.operationPending');
                    cloneBtn.title = I18n.t('records.operationPending');
                    deleteBtn.title = I18n.t('records.operationPending');
                }

                return [editBtn, cloneBtn, deleteBtn];
            },
            sortColumn: sortColumn,
            sortDirection: sortDirection,
            onSort: (column, direction) => {
                sortColumn = column;
                sortDirection = direction;
                renderRecords();
            },
            page: currentPage,
            pageSize: getPageSize(),
            onPageChange: (page) => {
                currentPage = page;
                renderRecords();
            },
            pageSizeOptions: PAGE_SIZE_OPTIONS,
            onPageSizeChange: (size) => {
                State.set('pageSize', size);
                currentPage = 1;
                renderRecords();
            },
            emptyMessage: searchFilter || typeFilter
                ? I18n.t('records.emptyFiltered')
                : I18n.t('records.empty'),
            onRender: function() {
                if (scrollContainer) scrollContainer.scrollTop = scrollTop;
            }
        });
    }

    // ---------------------------------------------------------------
    // buildToolbar() — Create the search/filter/add toolbar row.
    // ---------------------------------------------------------------
    function buildToolbar() {
        // Search input
        const searchInput = UI.createElement('input', {
            type: 'text',
            className: 'form__input toolbar__search',
            placeholder: I18n.t('records.searchPlaceholder'),
            value: searchFilter,
            ariaLabel: I18n.t('records.filterByNameTypeValue'),
            autocapitalize: 'none',
            autocorrect: 'off',
            spellcheck: false,
            dataset: { action: 'search-records' },
            events: {
                input: (e) => {
                    debouncedSearch(e.target.value);
                }
            }
        });

        // Type filter dropdown
        const typeSelect = UI.createElement('select', {
            className: 'form__select toolbar__filter',
            ariaLabel: I18n.t('records.filterByType'),
            dataset: { action: 'filter-type' },
            events: {
                change: (e) => {
                    typeFilter = e.target.value;
                    currentPage = 1;
                    renderRecords();
                }
            }
        });

        typeSelect.appendChild(UI.createElement('option', {
            value: '',
            textContent: I18n.t('records.allTypes')
        }));

        // Collect unique types from current records
        const records = State.get('records') || [];
        const uniqueTypes = [];
        for (let i = 0; i < records.length; i++) {
            const t = records[i].rrset_type;
            if (uniqueTypes.indexOf(t) === -1) {
                uniqueTypes.push(t);
            }
        }
        uniqueTypes.sort();

        for (let j = 0; j < uniqueTypes.length; j++) {
            typeSelect.appendChild(UI.createElement('option', {
                value: uniqueTypes[j],
                textContent: uniqueTypes[j],
                selected: typeFilter === uniqueTypes[j]
            }));
        }

        // Add Record button
        const addBtn = UI.createElement('button', {
            type: 'button',
            className: 'btn btn--primary',
            textContent: I18n.t('records.addRecord'),
            dataset: { action: 'add-record' },
            events: {
                click: () => {
                    showAddForm();
                }
            }
        });

        // Refresh button (X-11)
        const refreshBtn = UI.createElement('button', {
            type: 'button',
            className: 'btn btn--sm',
            textContent: '\u21BB ' + I18n.t('records.refresh'),
            title: I18n.t('records.refreshTitle'),
            dataset: { action: 'refresh-records' },
            events: {
                click: () => {
                    fetchRecords();
                }
            }
        });

        // Export Zone button
        const exportBtn = UI.createElement('button', {
            type: 'button',
            className: 'btn btn--sm',
            textContent: '\u2913 ' + I18n.t('records.export'),
            title: I18n.t('records.exportTitle'),
            dataset: { action: 'export-zone' },
            events: {
                click: () => {
                    handleExportZone();
                }
            }
        });

        // Import Zone button
        const importBtn = UI.createElement('button', {
            type: 'button',
            className: 'btn btn--sm',
            textContent: '\u2912 ' + I18n.t('records.import'),
            title: I18n.t('records.importTitle'),
            dataset: { action: 'import-zone' },
            events: {
                click: () => {
                    showImportZone();
                }
            }
        });

        // Text editor button
        const textEditBtn = UI.createElement('button', {
            type: 'button',
            className: 'btn btn--sm',
            textContent: '\u270E ' + I18n.t('records.editAsText'),
            title: I18n.t('records.editAsTextTitle'),
            dataset: { action: 'edit-zone-text' },
            events: {
                click: () => {
                    showTextEditor();
                }
            }
        });

        // Record count
        const filteredCount = applyFilters(records).length;
        const countLabel = UI.createElement('span', {
            className: 'toolbar__count',
            textContent: I18n.t('records.filteredCount', {filtered: filteredCount, total: records.length})
        });

        const actions = UI.createElement('div', { className: 'toolbar__actions' }, [
            refreshBtn,
            exportBtn,
            importBtn,
            textEditBtn,
            addBtn
        ]);

        return UI.createElement('div', { className: 'toolbar' }, [
            searchInput,
            typeSelect,
            countLabel,
            actions
        ]);
    }

    // ---------------------------------------------------------------
    // applyFilters(records) — Filter records by search text and type.
    // ---------------------------------------------------------------
    function applyFilters(records) {
        let result = records;
        if (searchFilter) {
            const needle = searchFilter.toLowerCase();
            result = result.filter((r) => {
                const name = (r.rrset_name || '').toLowerCase();
                const type = (r.rrset_type || '').toLowerCase();
                const values = Array.isArray(r.rrset_values)
                    ? r.rrset_values.join(' ').toLowerCase()
                    : '';
                return name.indexOf(needle) !== -1 ||
                       type.indexOf(needle) !== -1 ||
                       values.indexOf(needle) !== -1;
            });
        }
        if (typeFilter) {
            result = result.filter((r) => r.rrset_type === typeFilter);
        }
        return result;
    }

    // ===============================================================
    // ADD / EDIT FORMS
    // ===============================================================

    // ---------------------------------------------------------------
    // showAddForm() — Open a modal with the record creation form.
    // Starts with a type selector; once a type is picked the full
    // form is displayed.
    // ---------------------------------------------------------------
    function showAddForm() {
        const bodyEl = UI.createElement('div', { className: 'record-form' });
        let initialSnapshot = '';

        // Type selector (grouped by tier)
        const typeSection = buildTypeSelector((selectedType) => {
            // Replace body with the full form for this type
            bodyEl.textContent = '';

            // Back arrow to return to type selector
            const backBtn = UI.createElement('button', {
                type: 'button',
                className: 'btn btn--icon record-form__back',
                textContent: '\u2190',
                ariaLabel: I18n.t('records.backToTypeSelection'),
                events: {
                    click: () => {
                        bodyEl.textContent = '';
                        bodyEl.appendChild(typeSection);
                        // Remove beforeClose since we're back to the selector
                        const overlay = document.getElementById('modal-overlay');
                        if (overlay) {
                            overlay._beforeClose = null;
                        }
                    }
                }
            });

            const formEl = buildRecordForm(selectedType, null);
            bodyEl.appendChild(backBtn);
            bodyEl.appendChild(formEl);
            // Capture initial state after form is built
            initialSnapshot = getFormSnapshot(formEl);
            // Set beforeClose now that a form exists
            const overlay = document.getElementById('modal-overlay');
            if (overlay) {
                overlay._beforeClose = makeBeforeClose(bodyEl, initialSnapshot);
            }
        });

        bodyEl.appendChild(typeSection);

        const domain = State.get('currentDomain') || '';
        UI.showModal({
            title: domain ? I18n.t('records.addTitleDomain', {domain: domain}) : I18n.t('records.addTitle'),
            bodyEl: bodyEl
        });
    }

    // ---------------------------------------------------------------
    // showEditForm(record) — Open a modal to edit an existing record.
    // ---------------------------------------------------------------
    function showEditForm(record) {
        const bodyEl = UI.createElement('div', { className: 'record-form' });
        const formEl = buildRecordForm(record.rrset_type, record);
        bodyEl.appendChild(formEl);
        const initialSnapshot = getFormSnapshot(formEl);

        const domain = State.get('currentDomain') || '';
        UI.showModal({
            title: domain ? I18n.t('records.editTitleDomain', {type: record.rrset_type, domain: domain}) : I18n.t('records.editTitle', {type: record.rrset_type}),
            bodyEl: bodyEl,
            beforeClose: makeBeforeClose(bodyEl, initialSnapshot)
        });
    }

    // ---------------------------------------------------------------
    // showCloneForm(record) — Open a modal to duplicate a record.
    // Pre-fills the form with the record's data but keeps the name
    // field editable and submits as a new record (create, not update).
    // ---------------------------------------------------------------
    function showCloneForm(record) {
        const bodyEl = UI.createElement('div', { className: 'record-form' });
        const formEl = buildRecordForm(record.rrset_type, record, true);
        bodyEl.appendChild(formEl);
        const initialSnapshot = getFormSnapshot(formEl);

        const domain = State.get('currentDomain') || '';
        UI.showModal({
            title: domain ? I18n.t('records.cloneTitleDomain', {type: record.rrset_type, domain: domain}) : I18n.t('records.cloneTitle', {type: record.rrset_type}),
            bodyEl: bodyEl,
            beforeClose: makeBeforeClose(bodyEl, initialSnapshot)
        });
    }

    // ---------------------------------------------------------------
    // buildTypeSelector(onSelect) — Build the type picker UI grouped
    // by tier. Calls onSelect(type) when a type button is clicked.
    // ---------------------------------------------------------------
    function buildTypeSelector(onSelect) {
        const wrapper = UI.createElement('div', { className: 'type-selector' });

        // --- Common types section (always visible) ---
        const commonGroup = UI.createElement('div', { className: 'type-selector__group' });
        commonGroup.appendChild(UI.createElement('h3', {
            className: 'type-selector__heading',
            textContent: I18n.t('records.commonTypes')
        }));

        const commonGrid = UI.createElement('div', { className: 'type-selector__grid' });
        for (let i = 0; i < COMMON_TYPES.length; i++) {
            const typeName = COMMON_TYPES[i];
            if (RecordTypes.isReadOnly(typeName)) continue;
            commonGrid.appendChild(buildTypeSelectorButton(typeName, onSelect));
        }
        commonGroup.appendChild(commonGrid);
        wrapper.appendChild(commonGroup);

        // --- Advanced types section (hidden by default) ---
        const advancedContainer = UI.createElement('div', {
            className: 'type-selector__advanced',
            dataset: { state: 'collapsed' }
        });

        const advancedToggle = UI.createElement('button', {
            type: 'button',
            className: 'btn btn--sm type-selector__toggle',
            textContent: I18n.t('records.showAdvanced'),
            events: {
                click: () => {
                    const isCollapsed = advancedContainer.dataset.state === 'collapsed';
                    if (isCollapsed) {
                        advancedContainer.dataset.state = 'expanded';
                        advancedToggle.textContent = I18n.t('records.hideAdvanced');
                        advancedContent.style.display = '';
                    } else {
                        advancedContainer.dataset.state = 'collapsed';
                        advancedToggle.textContent = I18n.t('records.showAdvanced');
                        advancedContent.style.display = 'none';
                    }
                }
            }
        });
        advancedContainer.appendChild(advancedToggle);

        const advancedContent = UI.createElement('div', {
            className: 'type-selector__advanced-content',
            style: { display: 'none' }
        });

        // Collect all non-common types grouped by tier
        const tiers = RecordTypes.byTier();
        const tierLabels = {};
        tierLabels[RecordTypes.TIERS.FULL] = I18n.t('records.tierGroup.full');
        tierLabels[RecordTypes.TIERS.BASIC] = I18n.t('records.tierGroup.basic');
        tierLabels[RecordTypes.TIERS.RAW] = I18n.t('records.tierGroup.raw');

        const tierKeys = [RecordTypes.TIERS.FULL, RecordTypes.TIERS.BASIC, RecordTypes.TIERS.RAW];
        for (let t = 0; t < tierKeys.length; t++) {
            const tierKey = tierKeys[t];
            const types = tiers[tierKey];
            if (!types || types.length === 0) continue;

            // Filter out read-only types and common types (already shown above)
            const addable = types.filter((type) =>
                !RecordTypes.isReadOnly(type) && COMMON_TYPES.indexOf(type) === -1
            );
            if (addable.length === 0) continue;

            addable.sort();

            const group = UI.createElement('div', { className: 'type-selector__group' });
            group.appendChild(UI.createElement('h3', {
                className: 'type-selector__heading',
                textContent: tierLabels[tierKey]
            }));

            const btnGrid = UI.createElement('div', { className: 'type-selector__grid' });
            for (let i = 0; i < addable.length; i++) {
                btnGrid.appendChild(buildTypeSelectorButton(addable[i], onSelect));
            }

            group.appendChild(btnGrid);
            advancedContent.appendChild(group);
        }

        advancedContainer.appendChild(advancedContent);
        wrapper.appendChild(advancedContainer);

        return wrapper;
    }

    /**
     * buildTypeSelectorButton — Build a single type button for the type
     * selector grid.
     */
    function buildTypeSelectorButton(typeName, onSelect) {
        const typeDef = RecordTypes.get(typeName);
        const btnAttrs = {
            type: 'button',
            className: 'btn type-selector__btn',
            title: typeDef ? typeDef.description : typeName,
            events: {
                click: ((tn) => {
                    return () => { onSelect(tn); };
                })(typeName)
            }
        };

        // Mark deprecated types
        if (typeDef && typeDef.deprecated) {
            btnAttrs.className += ' type-selector__btn--deprecated';
        }

        return UI.createElement('button', btnAttrs, [
            UI.createElement('span', {
                className: 'type-selector__type',
                textContent: typeName
            }),
            UI.createElement('span', {
                className: 'type-selector__desc',
                textContent: typeDef ? typeDef.label.replace(/^[A-Z]+ \(/, '(') : ''
            })
        ]);
    }

    // ---------------------------------------------------------------
    // buildRecordForm(type, existingRecord, isClone) — Build the
    // complete form body for adding, editing, or cloning a DNS record.
    //
    // For adds, existingRecord is null and isClone is false.
    // For edits, existingRecord is the full rrset object from the API.
    // For clones, existingRecord provides pre-fill data but isClone
    // is true: the name field stays editable and submit creates a new
    // record instead of updating.
    //
    // Returns a DOM element.
    // ---------------------------------------------------------------
    function buildRecordForm(type, existingRecord, isClone) {
        const isEditing = !!existingRecord && !isClone;
        const typeDef = RecordTypes.get(type);
        const tier = typeDef ? typeDef.tier : RecordTypes.TIERS.RAW;

        const form = UI.createElement('form', {
            className: 'form record-form__form',
            events: {
                submit: (e) => {
                    e.preventDefault();
                    handleRecordSubmit(form, type, isEditing, isEditing ? existingRecord : null);
                }
            }
        });

        // --- Type display ---
        const typeDisplay = UI.createElement('div', { className: 'form__field' }, [
            UI.createElement('label', {
                className: 'form__label',
                textContent: I18n.t('records.type')
            }),
            UI.createElement('div', { className: 'form__readonly' }, [
                UI.createElement('span', {
                    className: 'tag tag--' + type.toLowerCase(),
                    textContent: type
                }),
                typeDef ? UI.createElement('span', {
                    className: 'record-form__type-desc',
                    textContent: ' \u2014 ' + typeDef.description
                }) : null
            ].filter(Boolean))
        ]);
        form.appendChild(typeDisplay);

        // Deprecation warning
        if (typeDef && typeDef.deprecated) {
            form.appendChild(UI.createElement('div', {
                className: 'form__warning',
                textContent: I18n.t('records.deprecated')
            }));
        }

        // --- Name field ---
        let nameHelp = I18n.t('records.nameHelp');
        if (typeDef && typeDef.nameHelp) {
            nameHelp = typeDef.nameHelp + '. ' + nameHelp;
        }

        const nameField = buildFieldWrapper('name', I18n.t('records.nameLabel'), true, nameHelp);
        const hasPreFill = isEditing || isClone;
        const nameInput = UI.createElement('input', {
            type: 'text',
            className: 'form__input',
            id: 'field-name',
            name: 'name',
            placeholder: I18n.t('records.namePlaceholder'),
            required: true,
            value: hasPreFill ? (existingRecord.rrset_name || '@') : '',
            disabled: isEditing,
            autocapitalize: 'none',
            autocorrect: 'off',
            spellcheck: false
        });
        nameField.insertBefore(nameInput, nameField.querySelector('.form__help'));
        form.appendChild(nameField);

        // --- TTL field ---
        const ttlField = buildFieldWrapper(
            'ttl', I18n.t('records.ttlLabel'), false,
            I18n.t('records.ttlHelp', { min: Validation.MIN_TTL, max: Validation.MAX_TTL })
        );
        const ttlRow = UI.createElement('div', { className: 'record-form__ttl-row' });
        const ttlInput = UI.createElement('input', {
            type: 'number',
            className: 'form__input',
            id: 'field-ttl',
            name: 'ttl',
            placeholder: '10800',
            min: String(Validation.MIN_TTL),
            max: String(Validation.MAX_TTL),
            value: hasPreFill ? String(existingRecord.rrset_ttl || 10800) : '10800',
            inputmode: 'numeric'
        });
        ttlRow.appendChild(ttlInput);

        // TTL preset buttons
        const presets = Helpers.TTL_PRESETS;
        const presetRow = UI.createElement('div', { className: 'record-form__ttl-presets' });
        for (let p = 0; p < presets.length; p++) {
            const preset = presets[p];
            presetRow.appendChild(UI.createElement('button', {
                type: 'button',
                className: 'btn btn--sm record-form__ttl-preset',
                textContent: preset.label,
                title: I18n.t('records.ttlPresetTitle', { value: preset.value }),
                dataset: { ttl: String(preset.value) },
                events: {
                    click: ((val) => {
                        return () => {
                            const inp = form.querySelector('#field-ttl');
                            if (inp) inp.value = val;
                        };
                    })(preset.value)
                }
            }));
        }
        ttlRow.appendChild(presetRow);
        ttlField.insertBefore(ttlRow, ttlField.querySelector('.form__help'));
        form.appendChild(ttlField);

        // --- Values section (tier-dependent) ---
        const valuesSection = UI.createElement('div', {
            className: 'record-form__values',
            id: 'record-values-section'
        });

        if (tier === RecordTypes.TIERS.FULL) {
            buildTier1Values(valuesSection, type, typeDef, existingRecord);
        } else if (tier === RecordTypes.TIERS.BASIC) {
            buildTier2Values(valuesSection, type, typeDef, existingRecord);
        } else {
            buildTier3Values(valuesSection, type, typeDef, existingRecord);
        }

        form.appendChild(valuesSection);

        // --- Error display area ---
        form.appendChild(UI.createElement('div', {
            className: 'form__error record-form__global-error',
            id: 'record-form-errors',
            role: 'alert'
        }));

        // --- Submit button ---
        const btnRow = UI.createElement('div', { className: 'form__actions' });
        btnRow.appendChild(UI.createElement('button', {
            type: 'submit',
            className: 'btn btn--primary',
            textContent: I18n.t(isEditing ? 'records.updateRecord' : 'records.createRecord'),
            dataset: { formAction: 'submit' }
        }));
        btnRow.appendChild(UI.createElement('button', {
            type: 'button',
            className: 'btn',
            textContent: I18n.t('records.cancel'),
            events: { click: () => { UI.closeModal(); } }
        }));
        form.appendChild(btnRow);

        return form;
    }

    // ---------------------------------------------------------------
    // buildFieldWrapper(id, label, required, helpText) — Create a
    // form field wrapper with label, help text, and error area.
    // The actual input must be inserted by the caller.
    // ---------------------------------------------------------------
    function buildFieldWrapper(id, label, required, helpText) {
        const wrapper = UI.createElement('div', {
            className: 'form__field',
            dataset: { field: id }
        });

        const labelEl = UI.createElement('label', {
            className: 'form__label',
            htmlFor: 'field-' + id,
            textContent: label
        });
        if (required) {
            labelEl.appendChild(UI.createElement('span', {
                className: 'form__required',
                textContent: ' *',
                ariaLabel: I18n.t('ui.required')
            }));
        }
        wrapper.appendChild(labelEl);

        if (helpText) {
            wrapper.appendChild(UI.createElement('div', {
                className: 'form__help',
                id: 'help-' + id,
                textContent: helpText
            }));
        }

        wrapper.appendChild(UI.createElement('div', {
            className: 'form__error',
            id: 'error-' + id,
            role: 'alert'
        }));

        return wrapper;
    }

    // ===============================================================
    // TIER 1: Full structured forms with per-field inputs
    // ===============================================================

    /**
     * buildTier1Values — Build the values section for Tier 1 (FULL)
     * record types, using the field definitions from RecordTypes.
     *
     * For multiValue types, multiple value rows can be added.
     * For single-value types, one set of fields is shown.
     */
    function buildTier1Values(container, type, typeDef, existingRecord) {
        const existingValues = existingRecord ? (existingRecord.rrset_values || []) : [];

        container.appendChild(UI.createElement('h4', {
            className: 'record-form__section-title',
            textContent: I18n.t('records.values')
        }));

        const valuesList = UI.createElement('div', {
            className: 'record-form__values-list',
            id: 'values-list'
        });
        container.appendChild(valuesList);

        // Parse existing values into field objects
        if (existingValues.length > 0) {
            for (let i = 0; i < existingValues.length; i++) {
                const parsed = parseTier1Value(typeDef, existingValues[i]);
                addTier1ValueRow(valuesList, type, typeDef, parsed, i > 0);
            }
        } else {
            // Start with one empty row
            addTier1ValueRow(valuesList, type, typeDef, null, false);
        }

        // Add Value button (only for multi-value types)
        if (!(typeDef && typeDef.singleValue)) {
            container.appendChild(UI.createElement('button', {
                type: 'button',
                className: 'btn btn--sm record-form__add-value',
                textContent: I18n.t('records.addValue'),
                events: {
                    click: () => addTier1ValueRow(valuesList, type, typeDef, null, true)
                }
            }));
        }
    }

    /**
     * parseTier1Value — Parse an API value string into a field-value
     * map using the RecordType's parseValue function (if defined).
     *
     * Falls back to { value: rawString } for simple types (A, AAAA, etc.).
     */
    function parseTier1Value(typeDef, rawValue) {
        if (typeDef.parseValue) {
            return typeDef.parseValue(rawValue);
        }
        // For simple types that have a single "value" field
        return { value: rawValue };
    }

    /**
     * addTier1ValueRow — Add one set of fields for a record value.
     *
     * valuesList: the container DOM element
     * type: record type string
     * typeDef: RecordTypes definition
     * fieldValues: { fieldId: value } or null for empty
     * showRemove: whether to show a remove button
     */
    function addTier1ValueRow(valuesList, type, typeDef, fieldValues, showRemove) {
        const row = UI.createElement('div', { className: 'record-form__value-row' });
        const fields = typeDef.fields || [];

        const fieldsContainer = UI.createElement('div', { className: 'record-form__value-fields' });

        for (let i = 0; i < fields.length; i++) {
            const field = fields[i];
            const existingVal = fieldValues ? (fieldValues[field.id] || '') : '';
            const fieldEl = buildTier1Field(type, field, existingVal);
            fieldsContainer.appendChild(fieldEl);
        }

        row.appendChild(fieldsContainer);

        // Add compact modifier for types with 3+ fields (SRV, CAA)
        if (fields.length >= 3) {
            row.classList.add('record-form__value-row--compact');
        }

        // Remove button
        if (showRemove) {
            row.appendChild(UI.createElement('button', {
                type: 'button',
                className: 'btn btn--icon record-form__remove-value',
                textContent: '\u2716',
                title: I18n.t('records.removeValue'),
                ariaLabel: I18n.t('records.removeValue'),
                events: {
                    click: () => {
                        row.parentNode.removeChild(row);
                    }
                }
            }));
        }

        valuesList.appendChild(row);
    }

    /**
     * buildTier1Field — Build a single form field from a RecordType
     * field definition. Includes inline validation on blur.
     */
    function buildTier1Field(type, fieldDef, initialValue) {
        const wrapper = UI.createElement('div', {
            className: 'form__field record-form__inline-field',
            dataset: { field: fieldDef.id }
        });

        const labelEl = UI.createElement('label', {
            className: 'form__label',
            htmlFor: 'field-val-' + fieldDef.id + '-' + Date.now() + Math.random(),
            textContent: fieldDef.label
        });
        if (fieldDef.required) {
            labelEl.appendChild(UI.createElement('span', {
                className: 'form__required',
                textContent: ' *',
                ariaLabel: I18n.t('ui.required')
            }));
        }
        wrapper.appendChild(labelEl);

        const inputId = labelEl.htmlFor;
        let input;

        if (fieldDef.type === 'select') {
            input = UI.createElement('select', {
                className: 'form__select',
                id: inputId,
                name: fieldDef.id,
                required: fieldDef.required || false
            });
            const options = fieldDef.options || [];
            for (let i = 0; i < options.length; i++) {
                input.appendChild(UI.createElement('option', {
                    value: options[i].value,
                    textContent: options[i].label || options[i].value,
                    selected: String(initialValue) === String(options[i].value)
                }));
            }
        } else if (fieldDef.type === 'textarea') {
            input = UI.createElement('textarea', {
                className: 'form__textarea',
                id: inputId,
                name: fieldDef.id,
                rows: 3,
                placeholder: fieldDef.placeholder || '',
                required: fieldDef.required || false,
                value: String(initialValue || ''),
                autocapitalize: 'none',
                autocorrect: 'off',
                spellcheck: false
            });
        } else if (fieldDef.type === 'number') {
            const numAttrs = {
                type: 'number',
                className: 'form__input',
                id: inputId,
                name: fieldDef.id,
                placeholder: fieldDef.placeholder || '',
                required: fieldDef.required || false,
                value: initialValue !== '' && initialValue !== null && initialValue !== undefined ? String(initialValue) : '',
                inputmode: 'numeric'
            };
            if (fieldDef.min !== undefined) numAttrs.min = String(fieldDef.min);
            if (fieldDef.max !== undefined) numAttrs.max = String(fieldDef.max);
            input = UI.createElement('input', numAttrs);
        } else {
            input = UI.createElement('input', {
                type: 'text',
                className: 'form__input',
                id: inputId,
                name: fieldDef.id,
                placeholder: fieldDef.placeholder || '',
                required: fieldDef.required || false,
                value: String(initialValue || ''),
                autocapitalize: 'none',
                autocorrect: 'off',
                spellcheck: false
            });
        }

        // Inline validation on blur
        input.addEventListener('blur', () => {
            const err = Validation.validateField(type, fieldDef.id, input.value);
            const errorEl = wrapper.querySelector('.form__error');
            if (err) {
                if (errorEl) errorEl.textContent = err.message;
                wrapper.classList.add('form__field--error');
            } else {
                if (errorEl) errorEl.textContent = '';
                wrapper.classList.remove('form__field--error');
            }

            // Non-blocking warning (e.g. trailing dot) — immediate on blur
            const warnEl = wrapper.querySelector('.form__field-warning');
            if (warnEl && fieldDef.warn) {
                const warning = fieldDef.warn(input.value);
                if (warning) {
                    warnEl.textContent = warning.message;
                    warnEl.classList.add('form__field-warning--active');
                } else {
                    warnEl.classList.remove('form__field-warning--active');
                }
            }
        });

        // Live warning on input (debounced, only when value looks like a hostname)
        if (fieldDef.warn) {
            const updateWarning = Helpers.debounce(() => {
                const val = input.value;
                const warnEl = wrapper.querySelector('.form__field-warning');
                if (!warnEl) return;
                if (val && val.includes('.')) {
                    const warning = fieldDef.warn(val);
                    if (warning) {
                        warnEl.textContent = warning.message;
                        warnEl.classList.add('form__field-warning--active');
                    } else {
                        warnEl.classList.remove('form__field-warning--active');
                    }
                } else {
                    warnEl.classList.remove('form__field-warning--active');
                }
            }, 300);
            input.addEventListener('input', updateWarning);
        }

        wrapper.appendChild(input);

        // Help text
        if (fieldDef.help) {
            wrapper.appendChild(UI.createElement('div', {
                className: 'form__help',
                textContent: fieldDef.help
            }));
        }

        // Warning display (non-blocking) — pre-filled to reserve layout space
        if (fieldDef.warn) {
            const sampleWarn = fieldDef.warn('_');
            wrapper.appendChild(UI.createElement('div', {
                className: 'form__field-warning',
                textContent: sampleWarn ? sampleWarn.message : ''
            }));
        }

        // Error display
        wrapper.appendChild(UI.createElement('div', {
            className: 'form__error',
            role: 'alert'
        }));

        return wrapper;
    }

    // ===============================================================
    // TIER 2: Basic textarea with validation hint
    // ===============================================================

    /**
     * buildTier2Values — Build the values section for Tier 2 (BASIC)
     * types. Provides a textarea per value with a hint from RecordTypes.
     */
    function buildTier2Values(container, type, typeDef, existingRecord) {
        const existingValues = existingRecord ? (existingRecord.rrset_values || []) : [];

        container.appendChild(UI.createElement('h4', {
            className: 'record-form__section-title',
            textContent: I18n.t('records.values')
        }));

        if (typeDef && typeDef.hint) {
            container.appendChild(UI.createElement('p', {
                className: 'form__help record-form__hint',
                textContent: typeDef.hint
            }));
        }

        const valuesList = UI.createElement('div', {
            className: 'record-form__values-list',
            id: 'values-list'
        });
        container.appendChild(valuesList);

        if (existingValues.length > 0) {
            for (let i = 0; i < existingValues.length; i++) {
                addTier2ValueRow(valuesList, existingValues[i], i > 0, typeDef);
            }
        } else {
            addTier2ValueRow(valuesList, '', false, typeDef);
        }

        // Add Value button (only for multi-value types)
        if (!(typeDef && typeDef.singleValue)) {
            container.appendChild(UI.createElement('button', {
                type: 'button',
                className: 'btn btn--sm record-form__add-value',
                textContent: I18n.t('records.addValue'),
                events: {
                    click: () => addTier2ValueRow(valuesList, '', true, typeDef)
                }
            }));
        }
    }

    /**
     * addTier2ValueRow — Add a textarea row for a Tier 2 value.
     */
    function addTier2ValueRow(valuesList, value, showRemove, typeDef) {
        const row = UI.createElement('div', { className: 'record-form__value-row' });

        const textarea = UI.createElement('textarea', {
            className: 'form__textarea',
            name: 'value',
            rows: 2,
            placeholder: I18n.t('records.valuePlaceholder'),
            required: true,
            value: value || '',
            autocapitalize: 'none',
            autocorrect: 'off',
            spellcheck: false
        });

        if (typeDef && typeDef.warn) {
            const fieldWrap = UI.createElement('div', { className: 'form__field' });
            fieldWrap.style.flex = '1';
            fieldWrap.style.minWidth = '0';
            fieldWrap.appendChild(textarea);

            const warnDiv = UI.createElement('div', { className: 'form__field-warning' });
            fieldWrap.appendChild(warnDiv);
            row.appendChild(fieldWrap);

            textarea.addEventListener('blur', function() {
                const warning = typeDef.warn(textarea.value.trim());
                if (warning) {
                    warnDiv.textContent = warning.message;
                    warnDiv.classList.add('form__field-warning--active');
                } else {
                    warnDiv.textContent = '';
                    warnDiv.classList.remove('form__field-warning--active');
                }
            });

            const updateWarning = Helpers.debounce(function() {
                const val = textarea.value.trim();
                if (val && val.includes('.')) {
                    const warning = typeDef.warn(val);
                    if (warning) {
                        warnDiv.textContent = warning.message;
                        warnDiv.classList.add('form__field-warning--active');
                    } else {
                        warnDiv.textContent = '';
                        warnDiv.classList.remove('form__field-warning--active');
                    }
                } else {
                    warnDiv.textContent = '';
                    warnDiv.classList.remove('form__field-warning--active');
                }
            }, 300);
            textarea.addEventListener('input', updateWarning);
        } else {
            row.appendChild(textarea);
        }

        if (showRemove) {
            row.appendChild(UI.createElement('button', {
                type: 'button',
                className: 'btn btn--icon record-form__remove-value',
                textContent: '\u2716',
                title: I18n.t('records.removeValue'),
                ariaLabel: I18n.t('records.removeValue'),
                events: {
                    click: () => {
                        row.parentNode.removeChild(row);
                    }
                }
            }));
        }

        valuesList.appendChild(row);
    }

    // ===============================================================
    // TIER 3: Raw textarea, no validation
    // ===============================================================

    /**
     * buildTier3Values — Build the values section for Tier 3 (RAW)
     * types. Plain textareas with no client-side validation.
     */
    function buildTier3Values(container, type, typeDef, existingRecord) {
        const existingValues = existingRecord ? (existingRecord.rrset_values || []) : [];

        container.appendChild(UI.createElement('h4', {
            className: 'record-form__section-title',
            textContent: I18n.t('records.values')
        }));

        if (typeDef && typeDef.hint) {
            container.appendChild(UI.createElement('p', {
                className: 'form__help record-form__hint',
                textContent: typeDef.hint
            }));
        }

        const valuesList = UI.createElement('div', {
            className: 'record-form__values-list',
            id: 'values-list'
        });
        container.appendChild(valuesList);

        if (existingValues.length > 0) {
            for (let i = 0; i < existingValues.length; i++) {
                addTier3ValueRow(valuesList, existingValues[i], i > 0);
            }
        } else {
            addTier3ValueRow(valuesList, '', false);
        }

        // Add Value button (only for multi-value types)
        if (!(typeDef && typeDef.singleValue)) {
            container.appendChild(UI.createElement('button', {
                type: 'button',
                className: 'btn btn--sm record-form__add-value',
                textContent: I18n.t('records.addValue'),
                events: {
                    click: () => addTier3ValueRow(valuesList, '', true)
                }
            }));
        }
    }

    /**
     * addTier3ValueRow — Add a textarea row for a Tier 3 value.
     */
    function addTier3ValueRow(valuesList, value, showRemove) {
        const row = UI.createElement('div', { className: 'record-form__value-row' });

        const textarea = UI.createElement('textarea', {
            className: 'form__textarea',
            name: 'value',
            rows: 3,
            placeholder: I18n.t('records.rawValuePlaceholder'),
            required: true,
            value: value || '',
            autocapitalize: 'none',
            autocorrect: 'off',
            spellcheck: false
        });
        row.appendChild(textarea);

        if (showRemove) {
            row.appendChild(UI.createElement('button', {
                type: 'button',
                className: 'btn btn--icon record-form__remove-value',
                textContent: '\u2716',
                title: I18n.t('records.removeValue'),
                ariaLabel: I18n.t('records.removeValue'),
                events: {
                    click: () => {
                        row.parentNode.removeChild(row);
                    }
                }
            }));
        }

        valuesList.appendChild(row);
    }

    // ===============================================================
    // FORM SUBMISSION
    // ===============================================================

    /**
     * handleRecordSubmit — Validate and submit the add/edit form.
     *
     * Collects name, TTL, and values from the form; validates through
     * the Validation module; then submits via the Gandi API.
     */
    function handleRecordSubmit(form, type, isEditing, existingRecord) {
        // Clear previous errors
        clearFormErrors(form);

        // Collect name
        const nameInput = form.querySelector('#field-name');
        const rawName = nameInput ? nameInput.value.trim() : '@';
        const name = Helpers.normalizeRecordName(rawName);

        // Collect TTL
        const ttlInput = form.querySelector('#field-ttl');
        const ttl = ttlInput && ttlInput.value !== '' ? parseInt(ttlInput.value, 10) : 10800;

        // Collect values based on tier
        const typeDef = RecordTypes.get(type);
        const tier = typeDef ? typeDef.tier : RecordTypes.TIERS.RAW;
        let values = [];
        let fieldErrors = [];

        if (tier === RecordTypes.TIERS.FULL) {
            const result = collectTier1Values(form, type, typeDef);
            values = result.values;
            fieldErrors = result.errors;
        } else {
            values = collectTextareaValues(form);
        }

        // Show tier-1 field-level errors
        if (fieldErrors.length > 0) {
            showRecordErrors(form, fieldErrors);
            return;
        }

        // Filter out empty values
        values = values.filter((v) => v && v.trim() !== '');

        if (values.length === 0) {
            showRecordErrors(form, [{ field: 'value', message: I18n.t('records.valuesRequired') }]);
            return;
        }

        // Run full validation
        const existingRecords = State.get('records') || [];
        // When editing, exclude the current record from cross-checks
        let recordsForValidation = existingRecords;
        if (isEditing) {
            recordsForValidation = existingRecords.filter((r) => {
                return !(r.rrset_name === existingRecord.rrset_name &&
                         r.rrset_type === existingRecord.rrset_type);
            });
        }

        const validationErrors = Validation.validateRecord(
            { name: name, type: type, ttl: ttl, values: values },
            recordsForValidation,
            State.get('currentDomain')
        );

        if (validationErrors.length > 0) {
            showRecordErrors(form, validationErrors);
            return;
        }

        const displayName = name === '@' ? '@ (apex)' : name;
        const key = name + '/' + type;
        const opType = isEditing ? 'update' : 'create';

        // Build the new record object for optimistic state
        const newRecord = {
            rrset_name: name,
            rrset_type: type,
            rrset_ttl: ttl,
            rrset_values: values
        };

        // Deferred submit with undo support
        function deferredSubmit() {
            UI.forceCloseModal();

            // Cancel any existing pending op for the same key
            const prev = pendingOperations.get(key);
            if (prev) {
                clearTimeout(prev.timer);
                pendingOperations.delete(key);
            }

            // Optimistic state update
            let records = State.get('records') || [];
            let oldRecord = null;
            if (isEditing) {
                // Update: replace existing record in state
                records = records.map(function(r) {
                    if (r.rrset_name === name && r.rrset_type === type) {
                        oldRecord = r;
                        return newRecord;
                    }
                    return r;
                });
            } else {
                // Create: add to state (remove any existing with same key first)
                let replaced = false;
                records = records.map(function(r) {
                    if (r.rrset_name === name && r.rrset_type === type) {
                        oldRecord = r;
                        replaced = true;
                        return newRecord;
                    }
                    return r;
                });
                if (!replaced) {
                    records.push(newRecord);
                }
            }
            State.set('records', records);

            // Set pending BEFORE render so rowClass can detect it
            pendingOperations.set(key, {
                opType: opType,
                timer: null,
                record: newRecord,
                oldRecord: oldRecord,
                name: name,
                rrset_type: type
            });

            renderRecords();

            // Schedule actual API call after 5 seconds
            const timer = setTimeout(function() {
                executePendingOperation(pendingOperations.get(key), key);
            }, 5000);
            pendingOperations.get(key).timer = timer;

            showUndoToast(opType, displayName, type, key);
        }

        // Merge submit: merge new values into existing record (dedup)
        function mergeSubmit(existingRecord) {
            UI.forceCloseModal();

            const merged = (existingRecord.rrset_values || []).slice();
            for (let v = 0; v < newRecord.rrset_values.length; v++) {
                const newVal = newRecord.rrset_values[v];
                const exists = merged.some(function(m) {
                    return m.toLowerCase().trim() === newVal.toLowerCase().trim();
                });
                if (!exists) { merged.push(newVal); }
            }

            const mergedRecord = {
                rrset_name: name,
                rrset_type: type,
                rrset_ttl: existingRecord.rrset_ttl,
                rrset_values: merged
            };

            // Cancel any existing pending op for the same key
            const prev = pendingOperations.get(key);
            if (prev) {
                clearTimeout(prev.timer);
                pendingOperations.delete(key);
            }

            // Optimistic state update
            let records = State.get('records') || [];
            let oldRecord = null;
            records = records.map(function(r) {
                if (r.rrset_name === name && r.rrset_type === type) {
                    oldRecord = r;
                    return mergedRecord;
                }
                return r;
            });
            State.set('records', records);

            // Set pending BEFORE render so rowClass can detect it
            pendingOperations.set(key, {
                opType: 'update',
                timer: null,
                record: mergedRecord,
                oldRecord: oldRecord,
                name: name,
                rrset_type: type
            });

            renderRecords();

            // Schedule actual API call after 5 seconds
            const timer = setTimeout(function() {
                executePendingOperation(pendingOperations.get(key), key);
            }, 5000);
            pendingOperations.get(key).timer = timer;

            showUndoToast('update', displayName, type, key);
        }

        // No-op detection: skip API call if record hasn't changed
        if (isEditing && existingRecord) {
            const sameValues = (
                newRecord.rrset_name === existingRecord.rrset_name &&
                newRecord.rrset_type === existingRecord.rrset_type &&
                newRecord.rrset_ttl === existingRecord.rrset_ttl &&
                newRecord.rrset_values.length === existingRecord.rrset_values.length &&
                JSON.stringify(newRecord.rrset_values.slice().sort()) ===
                    JSON.stringify(existingRecord.rrset_values.slice().sort())
            );
            if (sameValues) {
                UI.toast('info', I18n.t('records.noChanges'));
                return;
            }
        }

        // In creation mode, warn if a record with the same name/type already exists
        if (!isEditing) {
            const existingMatch = (State.get('records') || []).filter((r) => {
                return r.rrset_name === name && r.rrset_type === type;
            });
            if (existingMatch.length > 0) {
                const typeDef2 = RecordTypes.get(type);
                if (typeDef2 && typeDef2.singleValue) {
                    // CNAME/DNAME/ALIAS — Replace dialog
                    UI.confirmAction({
                        title: I18n.t('records.replaceTitle'),
                        message: I18n.t('records.replaceMessage', {type: type, name: displayName}),
                        confirmText: I18n.t('records.replaceConfirm'),
                        confirmClass: 'btn--danger',
                        onConfirm: () => {
                            deferredSubmit();
                        }
                    });
                } else {
                    // A/AAAA/TXT/MX/SRV/NS/etc — Merge dialog
                    UI.confirmAction({
                        title: I18n.t('records.mergeTitle'),
                        message: I18n.t('records.mergeMessage', {type: type, name: displayName}),
                        confirmText: I18n.t('records.mergeConfirm'),
                        onConfirm: () => {
                            mergeSubmit(existingMatch[0]);
                        }
                    });
                }
                return;
            }
        }

        // No conflict — submit with deferred undo
        deferredSubmit();
    }

    /**
     * collectTier1Values — Extract values from Tier 1 form rows.
     *
     * Each value row has multiple fields. We validate each field and
     * use formatValue() to produce the final API value string.
     *
     * Returns { values: string[], errors: { field, message }[] }.
     */
    function collectTier1Values(form, type, typeDef) {
        const rows = form.querySelectorAll('.record-form__value-row');
        const values = [];
        const errors = [];

        for (let r = 0; r < rows.length; r++) {
            const row = rows[r];
            const fieldValues = {};
            const fields = typeDef.fields || [];
            let rowHasError = false;

            for (let f = 0; f < fields.length; f++) {
                const fieldDef = fields[f];
                const input = row.querySelector('[name="' + fieldDef.id + '"]');
                const value = input ? input.value : '';
                fieldValues[fieldDef.id] = value;

                // Validate individual field
                const err = Validation.validateField(type, fieldDef.id, value);
                if (err) {
                    errors.push(err);
                    rowHasError = true;
                    // Show error inline on the field
                    const errorEl = input ? input.parentNode.querySelector('.form__error') : null;
                    if (errorEl) {
                        errorEl.textContent = err.message;
                    }
                    const fieldWrapper = input ? input.closest('.form__field') : null;
                    if (fieldWrapper) {
                        fieldWrapper.classList.add('form__field--error');
                    }
                }
            }

            if (!rowHasError) {
                // Format the field values into a single API value string
                const formatted = typeDef.formatValue(fieldValues);
                values.push(formatted);
            }
        }

        return { values: values, errors: errors };
    }

    /**
     * collectTextareaValues — Collect values from Tier 2/3 textarea rows.
     */
    function collectTextareaValues(form) {
        const textareas = form.querySelectorAll('.record-form__value-row textarea[name="value"]');
        const values = [];
        for (let i = 0; i < textareas.length; i++) {
            const val = textareas[i].value.trim();
            if (val) {
                values.push(val);
            }
        }
        return values;
    }

    /**
     * showRecordErrors — Display validation errors in the form.
     * Maps field names to DOM elements and shows a global summary.
     */
    function showRecordErrors(form, errors) {
        // Show per-field errors where possible
        for (let i = 0; i < errors.length; i++) {
            const err = errors[i];
            const errorEl = form.querySelector('#error-' + err.field);
            if (errorEl) {
                errorEl.textContent = err.message;
            }
            const fieldWrapper = form.querySelector('[data-field="' + err.field + '"]');
            if (fieldWrapper) {
                fieldWrapper.classList.add('form__field--error');
            }
        }

        // Also show all errors in the global error area
        const globalErrors = form.querySelector('#record-form-errors');
        if (globalErrors && errors.length > 0) {
            const messages = errors.map((e) => e.message);
            // De-duplicate
            const unique = [];
            for (let j = 0; j < messages.length; j++) {
                if (unique.indexOf(messages[j]) === -1) {
                    unique.push(messages[j]);
                }
            }
            globalErrors.textContent = unique.join(' \u2022 ');
        }

        // Focus the first field with an error
        if (errors.length > 0) {
            const firstField = form.querySelector('#field-' + errors[0].field);
            if (firstField && typeof firstField.focus === 'function') {
                firstField.focus();
            }
        }
    }

    /**
     * clearFormErrors — Remove all error messages from the form.
     */
    function clearFormErrors(form) {
        const errorEls = form.querySelectorAll('.form__error');
        for (let i = 0; i < errorEls.length; i++) {
            errorEls[i].textContent = '';
        }
        const errorFields = form.querySelectorAll('.form__field--error');
        for (let j = 0; j < errorFields.length; j++) {
            errorFields[j].classList.remove('form__field--error');
        }
    }

    // ===============================================================
    // EXPORT / IMPORT / TEXT EDITOR
    // ===============================================================

    // ---------------------------------------------------------------
    // handleExportZone() — Fetch the zone file as plain text and
    // trigger a download as {domain}-zone.txt.
    // ---------------------------------------------------------------
    function handleExportZone() {
        const domain = State.get('currentDomain');
        if (!domain) {
            UI.toast('error', I18n.t('records.noDomain'));
            return;
        }

        API.getText(Helpers.domainPath('records')).then((text) => {
            const blob = new Blob([text], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = domain + '-zone.txt';
            a.click();
            URL.revokeObjectURL(url);
            UI.toast('success', I18n.t('records.zone.exportSuccess', {domain: domain}));
        }).catch((err) => {
            const msg = (err && err.message) ? err.message : I18n.t('records.exportFailed');
            UI.toast('error', msg);
        });
    }

    // ---------------------------------------------------------------
    // fetchCurrentZoneText() — Fetch the current zone as text.
    // Returns a Promise<string>.
    // ---------------------------------------------------------------
    function fetchCurrentZoneText() {
        return API.getText(Helpers.domainPath('records'));
    }

    // ---------------------------------------------------------------
    // buildDiff(oldText, newText) — Simple line-level diff.
    // Returns a DOM element showing added/removed/unchanged lines.
    // ---------------------------------------------------------------
    function buildDiff(oldText, newText) {
        const diff = Helpers.computeLineDiff(oldText, newText, Helpers.normalizeZoneLine);

        const container = UI.createElement('div', { className: 'zone-diff' });
        let hasChanges = false;
        for (let d = 0; d < diff.length; d++) {
            const entry = diff[d];
            let cls = 'zone-diff__line';
            let prefix = '  ';
            if (entry.type === 'add') {
                cls += ' zone-diff__line--add';
                prefix = '+ ';
                hasChanges = true;
            } else if (entry.type === 'del') {
                cls += ' zone-diff__line--del';
                prefix = '- ';
                hasChanges = true;
            }
            container.appendChild(UI.createElement('div', {
                className: cls,
                textContent: prefix + entry.line
            }));
        }

        if (!hasChanges) {
            container.appendChild(UI.createElement('p', {
                className: 'zone-diff__no-changes',
                textContent: I18n.t('records.zone.noChanges')
            }));
        }

        return { el: container, hasChanges: hasChanges };
    }

    // ---------------------------------------------------------------
    // showImportZone() — Open a modal to import a zone file.
    // User can paste text or upload a file. Shows diff before applying.
    // ---------------------------------------------------------------
    function showImportZone() {
        const domain = State.get('currentDomain');
        if (!domain) {
            UI.toast('error', I18n.t('records.noDomain'));
            return;
        }

        const bodyEl = UI.createElement('div', { className: 'zone-import' });

        // File upload
        const fileInput = UI.createElement('input', {
            type: 'file',
            className: 'form__input',
            accept: '.txt,.zone,text/plain',
            style: { display: 'none' }
        });

        const uploadBtn = UI.createElement('button', {
            type: 'button',
            className: 'btn btn--sm',
            textContent: '\uD83D\uDCC2 ' + I18n.t('records.zone.loadFile'),
            events: {
                click: function() { fileInput.click(); }
            }
        });

        fileInput.addEventListener('change', function() {
            if (fileInput.files && fileInput.files[0]) {
                const reader = new FileReader();
                reader.onload = function(e) {
                    textarea.value = e.target.result;
                };
                reader.readAsText(fileInput.files[0]);
            }
        });

        // Textarea
        const textarea = UI.createElement('textarea', {
            className: 'form__textarea zone-import__textarea',
            placeholder: I18n.t('records.zone.placeholder'),
            rows: 18,
            spellcheck: false,
            autocapitalize: 'none',
            autocorrect: 'off'
        });

        const topRow = UI.createElement('div', { className: 'zone-import__top' }, [
            uploadBtn,
            fileInput
        ]);

        bodyEl.appendChild(topRow);
        bodyEl.appendChild(textarea);

        // Diff container (shown after preview)
        const diffContainer = UI.createElement('div', { className: 'zone-import__diff' });
        bodyEl.appendChild(diffContainer);

        // Status
        const statusEl = UI.createElement('div', { className: 'zone-import__status' });
        bodyEl.appendChild(statusEl);

        // Saved zone text for undo (captured during preview)
        let savedZoneText = '';

        const previewBtn = UI.createElement('button', {
            type: 'button',
            className: 'btn btn--sm',
            textContent: I18n.t('records.zone.preview'),
            dataset: { formAction: 'preview' },
            events: {
                click: function() {
                    const newText = textarea.value.trim();
                    if (!newText) {
                        UI.toast('error', I18n.t('records.zone.empty'));
                        return;
                    }
                    statusEl.textContent = I18n.t('records.zone.loading');
                    diffContainer.textContent = '';

                    fetchCurrentZoneText().then(function(currentText) {
                        savedZoneText = currentText;
                        statusEl.textContent = '';
                        const result = buildDiff(currentText.trim(), newText);
                        diffContainer.textContent = '';
                        diffContainer.appendChild(result.el);
                        if (result.hasChanges) {
                            applyBtn.disabled = false;
                            applyBtn.style.display = '';
                        } else {
                            applyBtn.disabled = true;
                        }
                        textarea.style.display = 'none';
                        topRow.style.display = 'none';
                        previewBtn.style.display = 'none';
                        editBtn.style.display = '';
                    }).catch(function(err) {
                        statusEl.textContent = '';
                        UI.toast('error', (err && err.message) || I18n.t('records.zone.loadFailed'));
                    });
                }
            }
        });

        const editBtn = UI.createElement('button', {
            type: 'button',
            className: 'btn btn--sm',
            textContent: '\u270E ' + I18n.t('records.zone.backToEditor'),
            style: { display: 'none' },
            events: {
                click: function() {
                    textarea.style.display = '';
                    topRow.style.display = '';
                    previewBtn.style.display = '';
                    editBtn.style.display = 'none';
                    applyBtn.style.display = 'none';
                    diffContainer.textContent = '';
                }
            }
        });

        const applyBtn = UI.createElement('button', {
            type: 'button',
            className: 'btn btn--danger',
            textContent: I18n.t('records.zone.apply'),
            disabled: true,
            style: { display: 'none' },
            dataset: { formAction: 'submit' },
            events: {
                click: function() {
                    applyBtn.disabled = true;
                    statusEl.textContent = I18n.t('records.zone.importing');

                    const textForUndo = savedZoneText;
                    const newZoneText = textarea.value.trim();
                    API.putText(Helpers.domainPath('records'), newZoneText).then(function() {
                        UI.forceCloseModal();
                        UI.toast('success', I18n.t('records.zone.importSuccess', {domain: domain}));
                        History.log({
                            domain: domain,
                            operation: 'zone-import',
                            beforeZone: textForUndo || null,
                            afterZone: newZoneText
                        });
                        fetchRecords();
                        if (textForUndo) {
                            showZoneUndoToast(textForUndo);
                        }
                    }).catch(function(err) {
                        statusEl.textContent = '';
                        applyBtn.disabled = false;
                        UI.toast('error', (err && err.message) || I18n.t('records.zone.importFailed'));
                    });
                }
            }
        });

        const footerActions = UI.createElement('div', { className: 'zone-import__actions' }, [
            previewBtn,
            editBtn,
            applyBtn
        ]);
        bodyEl.appendChild(footerActions);

        UI.showModal({
            title: I18n.t('records.zone.importTitle', {domain: domain}),
            bodyEl: bodyEl,
            modalClass: 'modal--resizable',
            beforeClose: function() {
                if (!textarea.value.trim()) return true;
                if (!bodyEl.querySelector('.zone-import__confirm')) {
                    const confirmBar = UI.createElement('div', { className: 'zone-import__confirm' }, [
                        UI.createElement('span', { textContent: I18n.t('records.zone.discardImport') }),
                        UI.createElement('button', {
                            type: 'button',
                            className: 'btn btn--sm btn--danger',
                            textContent: I18n.t('records.discard'),
                            events: { click: function() { UI.forceCloseModal(); } }
                        }),
                        UI.createElement('button', {
                            type: 'button',
                            className: 'btn btn--sm',
                            textContent: I18n.t('records.keepEditing'),
                            events: { click: function() { confirmBar.remove(); } }
                        })
                    ]);
                    bodyEl.appendChild(confirmBar);
                }
                return false;
            }
        });
    }

    // ---------------------------------------------------------------
    // showTextEditor() — Open a modal with the full zone as editable
    // text. Shows diff before applying changes.
    // ---------------------------------------------------------------
    function showTextEditor() {
        const domain = State.get('currentDomain');
        if (!domain) {
            UI.toast('error', I18n.t('records.noDomain'));
            return;
        }

        const bodyEl = UI.createElement('div', { className: 'zone-editor' });
        const statusEl = UI.createElement('div', { className: 'zone-editor__status' });
        statusEl.textContent = I18n.t('records.zone.loadingZone');

        const textarea = UI.createElement('textarea', {
            className: 'form__textarea zone-editor__textarea',
            rows: 22,
            spellcheck: false,
            autocapitalize: 'none',
            autocorrect: 'off',
            disabled: true
        });

        const diffContainer = UI.createElement('div', { className: 'zone-editor__diff' });

        bodyEl.appendChild(statusEl);
        bodyEl.appendChild(textarea);
        bodyEl.appendChild(diffContainer);

        let originalText = '';

        const previewBtn = UI.createElement('button', {
            type: 'button',
            className: 'btn btn--sm',
            textContent: I18n.t('records.zone.preview'),
            disabled: true,
            dataset: { formAction: 'preview' },
            events: {
                click: function() {
                    const newText = textarea.value.trim();
                    if (!newText) {
                        UI.toast('error', I18n.t('records.zone.empty'));
                        return;
                    }
                    const result = buildDiff(originalText.trim(), newText);
                    diffContainer.textContent = '';
                    diffContainer.appendChild(result.el);
                    if (result.hasChanges) {
                        applyBtn.disabled = false;
                        applyBtn.style.display = '';
                    } else {
                        applyBtn.disabled = true;
                    }
                    textarea.style.display = 'none';
                    previewBtn.style.display = 'none';
                    editBtn.style.display = '';
                }
            }
        });

        const editBtn = UI.createElement('button', {
            type: 'button',
            className: 'btn btn--sm',
            textContent: '\u270E ' + I18n.t('records.zone.backToEditor'),
            style: { display: 'none' },
            events: {
                click: function() {
                    textarea.style.display = '';
                    previewBtn.style.display = '';
                    editBtn.style.display = 'none';
                    applyBtn.style.display = 'none';
                    diffContainer.textContent = '';
                }
            }
        });

        const applyBtn = UI.createElement('button', {
            type: 'button',
            className: 'btn btn--danger',
            textContent: I18n.t('records.zone.applyChanges'),
            disabled: true,
            style: { display: 'none' },
            dataset: { formAction: 'submit' },
            events: {
                click: function() {
                    applyBtn.disabled = true;
                    statusEl.textContent = I18n.t('records.zone.saving');

                    const savedText = originalText;
                    const newZoneText = textarea.value.trim();
                    API.putText(Helpers.domainPath('records'), newZoneText).then(function() {
                        UI.forceCloseModal();
                        UI.toast('success', I18n.t('records.zone.updateSuccess', {domain: domain}));
                        History.log({
                            domain: domain,
                            operation: 'zone-edit',
                            beforeZone: savedText || null,
                            afterZone: newZoneText
                        });
                        fetchRecords();
                        showZoneUndoToast(savedText);
                    }).catch(function(err) {
                        statusEl.textContent = '';
                        applyBtn.disabled = false;
                        UI.toast('error', (err && err.message) || I18n.t('records.zone.saveFailed'));
                    });
                }
            }
        });

        const footerActions = UI.createElement('div', { className: 'zone-editor__actions' }, [
            previewBtn,
            editBtn,
            applyBtn
        ]);
        bodyEl.appendChild(footerActions);

        function hasUnsavedChanges() {
            return originalText !== '' && textarea.value.trim() !== originalText.trim();
        }

        UI.showModal({
            title: I18n.t('records.zone.editTitle', {domain: domain}),
            bodyEl: bodyEl,
            modalClass: 'modal--resizable',
            beforeClose: function() {
                if (!hasUnsavedChanges()) return true;
                // Show inline confirmation
                if (!bodyEl.querySelector('.zone-editor__confirm')) {
                    const confirmBar = UI.createElement('div', { className: 'zone-editor__confirm' }, [
                        UI.createElement('span', { textContent: I18n.t('records.zone.discardEdit') }),
                        UI.createElement('button', {
                            type: 'button',
                            className: 'btn btn--sm btn--danger',
                            textContent: I18n.t('records.discard'),
                            events: { click: function() { UI.forceCloseModal(); } }
                        }),
                        UI.createElement('button', {
                            type: 'button',
                            className: 'btn btn--sm',
                            textContent: I18n.t('records.keepEditing'),
                            events: { click: function() { confirmBar.remove(); } }
                        })
                    ]);
                    bodyEl.appendChild(confirmBar);
                }
                return false;
            }
        });

        // Load the current zone
        fetchCurrentZoneText().then(function(text) {
            originalText = text;
            textarea.value = text;
            textarea.disabled = false;
            previewBtn.disabled = false;
            statusEl.textContent = '';
        }).catch(function(err) {
            statusEl.textContent = '';
            UI.toast('error', (err && err.message) || I18n.t('records.zone.loadFailed'));
        });
    }

    // ===============================================================
    // API OPERATIONS
    // ===============================================================

    // ===============================================================
    // BULK OPERATIONS
    // ===============================================================

    // ---------------------------------------------------------------
    // buildBulkActionBar() — Build the bulk action bar displayed above
    // the records table when records are selected.
    // ---------------------------------------------------------------
    function buildBulkActionBar() {
        const count = selectedRecords.size;
        return UI.createElement('div', { className: 'bulk-bar' }, [
            UI.createElement('span', {
                className: 'bulk-bar__count',
                textContent: I18n.t('records.selectedCount', {count: count})
            }),
            UI.createElement('button', {
                type: 'button',
                className: 'btn btn--sm btn--danger',
                textContent: I18n.t('records.bulkDelete'),
                events: { click: handleBulkDelete }
            }),
            UI.createElement('button', {
                type: 'button',
                className: 'btn btn--sm',
                textContent: I18n.t('records.bulkTTL'),
                events: { click: handleBulkTTLChange }
            }),
            UI.createElement('button', {
                type: 'button',
                className: 'btn btn--sm',
                textContent: I18n.t('records.bulkDeselect'),
                events: {
                    click: () => {
                        selectedRecords.clear();
                        renderRecords();
                    }
                }
            })
        ]);
    }

    // ---------------------------------------------------------------
    // handleBulkDelete() — Confirm and delete all selected records.
    // Uses the pending operation system with a batch undo toast.
    // ---------------------------------------------------------------
    function handleBulkDelete() {
        const records = State.get('records') || [];
        const toDelete = records.filter(r => {
            const key = (r.rrset_name || '@') + '/' + r.rrset_type;
            return selectedRecords.has(key);
        });

        if (toDelete.length === 0) return;

        UI.confirmAction({
            title: I18n.t('records.bulkDeleteTitle'),
            message: I18n.t('records.bulkDeleteMessage', {count: toDelete.length}),
            confirmText: I18n.t('records.deleteConfirm'),
            confirmClass: 'btn--danger',
            onConfirm: () => {
                let currentRecords = State.get('records') || [];
                const deletedRecords = [];
                const batchKeys = [];

                // Single timer for the whole batch
                const batchTimer = setTimeout(() => {
                    executeBatchOperations(batchKeys, 'delete');
                }, 5000);

                for (let i = 0; i < toDelete.length; i++) {
                    const record = toDelete[i];
                    const name = record.rrset_name || '@';
                    const type = record.rrset_type;
                    const key = name + '/' + type;
                    batchKeys.push(key);
                    deletedRecords.push(record);

                    // Cancel any existing pending op for the same key
                    const prev = pendingOperations.get(key);
                    if (prev) {
                        clearTimeout(prev.timer);
                        pendingOperations.delete(key);
                    }

                    currentRecords = currentRecords.filter(r =>
                        !(r.rrset_name === record.rrset_name && r.rrset_type === record.rrset_type)
                    );

                    pendingOperations.set(key, {
                        opType: 'delete',
                        timer: batchTimer,
                        record: null,
                        oldRecord: record,
                        name: name,
                        rrset_type: type
                    });
                }

                State.set('records', currentRecords);
                selectedRecords.clear();
                renderRecords();

                // Show batch undo toast
                showBatchUndoToast('delete', deletedRecords, batchKeys);

                return Promise.resolve();
            }
        });
    }

    // ---------------------------------------------------------------
    // handleBulkTTLChange() — Open a modal to change TTL for all
    // selected records.
    // ---------------------------------------------------------------
    function handleBulkTTLChange() {
        const records = State.get('records') || [];
        const toUpdate = records.filter(r => {
            const key = (r.rrset_name || '@') + '/' + r.rrset_type;
            return selectedRecords.has(key) && r.rrset_type !== 'SOA';
        });

        if (toUpdate.length === 0) return;

        // Build TTL input modal
        const bodyEl = UI.createElement('div', { className: 'form' });
        const ttlField = UI.createElement('div', { className: 'form__field' }, [
            UI.createElement('label', {
                className: 'form__label',
                htmlFor: 'bulk-ttl-input',
                textContent: 'TTL (seconds)'
            }),
            UI.createElement('input', {
                type: 'number',
                className: 'form__input',
                id: 'bulk-ttl-input',
                name: 'ttl',
                value: '10800',
                min: '300',
                max: '2592000'
            })
        ]);
        bodyEl.appendChild(ttlField);

        // TTL presets
        const presetRow = UI.createElement('div', { className: 'record-form__ttl-presets' });
        const presets = Helpers.TTL_PRESETS;
        for (let p = 0; p < presets.length; p++) {
            const preset = presets[p];
            presetRow.appendChild(UI.createElement('button', {
                type: 'button',
                className: 'btn btn--sm',
                textContent: preset.label,
                events: {
                    click: ((val) => {
                        return () => {
                            document.getElementById('bulk-ttl-input').value = String(val);
                        };
                    })(preset.value)
                }
            }));
        }
        bodyEl.appendChild(presetRow);

        // Info text
        bodyEl.appendChild(UI.createElement('p', {
            className: 'form__help',
            textContent: I18n.t('records.bulkTTLHelp', {count: toUpdate.length})
        }));

        // Action buttons
        const btnRow = UI.createElement('div', { className: 'confirm__actions' });
        btnRow.appendChild(UI.createElement('button', {
            type: 'button',
            className: 'btn',
            textContent: I18n.t('ui.cancel'),
            events: { click: () => UI.closeModal() }
        }));
        btnRow.appendChild(UI.createElement('button', {
            type: 'button',
            className: 'btn btn--primary',
            textContent: I18n.t('records.bulkTTLApply'),
            events: {
                click: () => {
                    const ttlInput = document.getElementById('bulk-ttl-input');
                    const newTTL = parseInt(ttlInput.value, 10);

                    // Validate TTL
                    const ttlErrors = Validation.validateTTL(newTTL);
                    if (ttlErrors.length > 0) {
                        UI.toast('error', ttlErrors[0].message);
                        return;
                    }

                    UI.forceCloseModal();
                    applyBulkTTL(toUpdate, newTTL);
                }
            }
        }));
        bodyEl.appendChild(btnRow);

        UI.showModal({
            title: I18n.t('records.bulkTTLTitle'),
            bodyEl: bodyEl
        });
    }

    // ---------------------------------------------------------------
    // applyBulkTTL(records, newTTL) — Apply a new TTL to all given
    // records using the pending operation system.
    // ---------------------------------------------------------------
    function applyBulkTTL(records, newTTL) {
        let currentRecords = State.get('records') || [];
        const oldRecords = [];
        const batchKeys = [];

        // Single timer for the whole batch
        const batchTimer = setTimeout(() => {
            executeBatchOperations(batchKeys, 'update');
        }, 5000);

        for (let i = 0; i < records.length; i++) {
            const record = records[i];
            const name = record.rrset_name || '@';
            const type = record.rrset_type;
            const key = name + '/' + type;
            batchKeys.push(key);
            oldRecords.push(record);

            const newRecord = {
                rrset_name: name,
                rrset_type: type,
                rrset_ttl: newTTL,
                rrset_values: record.rrset_values
            };

            currentRecords = currentRecords.map(r => {
                if (r.rrset_name === record.rrset_name && r.rrset_type === record.rrset_type) {
                    return newRecord;
                }
                return r;
            });

            // Cancel existing pending op for the same key
            const prev = pendingOperations.get(key);
            if (prev) {
                clearTimeout(prev.timer);
                pendingOperations.delete(key);
            }

            pendingOperations.set(key, {
                opType: 'update',
                timer: batchTimer,
                record: newRecord,
                oldRecord: record,
                name: name,
                rrset_type: type
            });
        }

        State.set('records', currentRecords);
        selectedRecords.clear();
        renderRecords();

        showBatchUndoToast('update', oldRecords, batchKeys);
    }

    // ---------------------------------------------------------------
    // showBatchUndoToast(opType, oldRecords, batchKeys) — Display a
    // clickable undo toast for a batch operation.
    // ---------------------------------------------------------------
    function showBatchUndoToast(opType, oldRecords, batchKeys) {
        const verb = opType === 'delete' ? I18n.t('records.deleted2') : I18n.t('records.updated');
        UI.toast('info', I18n.t('records.bulkUndoToast', {count: oldRecords.length, verb: verb}), 5000);

        const toasts = document.querySelectorAll('.toast--info');
        const lastToast = toasts[toasts.length - 1];
        if (!lastToast) return;

        lastToast.style.cursor = 'pointer';
        let undone = false;
        lastToast.addEventListener('click', function() {
            if (undone) return;
            undone = true;
            lastToast.style.cursor = '';
            lastToast.style.opacity = '0.5';

            // Undo all operations in the batch
            let current = State.get('records') || [];

            for (let i = 0; i < batchKeys.length; i++) {
                const key = batchKeys[i];
                const pending = pendingOperations.get(key);
                if (!pending) continue;

                clearTimeout(pending.timer);
                pendingOperations.delete(key);

                if (opType === 'delete') {
                    current.push(oldRecords[i]);
                } else {
                    current = current.map(r => {
                        if (r.rrset_name === oldRecords[i].rrset_name && r.rrset_type === oldRecords[i].rrset_type) {
                            return oldRecords[i];
                        }
                        return r;
                    });
                }
            }

            State.set('records', current);
            renderRecords();
            UI.toast('success', I18n.t('records.bulkRestored', {count: oldRecords.length}));
        });
    }

    // ---------------------------------------------------------------
    // deleteRecord(record) — Confirm and delete a DNS record.
    // ---------------------------------------------------------------
    function deleteRecord(record) {
        const name = record.rrset_name || '@';
        const type = record.rrset_type;
        const displayName = name === '@' ? '@ (apex)' : name;
        const valuesPreview = (record.rrset_values || []).join(', ');
        const isCritical = CRITICAL_TYPES.indexOf(type) !== -1;

        let detail = valuesPreview ? I18n.t('records.valuesPreview', {values: Helpers.truncate(valuesPreview, 120)}) : '';
        if (isCritical) {
            detail = I18n.t('records.criticalWarning') + '\n\n' + detail;
        }

        UI.confirmAction({
            title: I18n.t('records.deleteTitle'),
            message: I18n.t('records.deleteMessage', {type: type, name: displayName}),
            detail: detail,
            confirmText: I18n.t('records.deleteConfirm'),
            confirmClass: 'btn--danger',
            onConfirm: () => {
                const key = name + '/' + type;

                // Cancel any existing pending op for the same key
                const prev = pendingOperations.get(key);
                if (prev) {
                    clearTimeout(prev.timer);
                    pendingOperations.delete(key);
                }

                // Remove from local state immediately for instant feedback
                const records = State.get('records') || [];
                const updated = records.filter(r =>
                    !(r.rrset_name === record.rrset_name && r.rrset_type === record.rrset_type)
                );
                State.set('records', updated);

                // Set pending BEFORE render so rowClass can detect it
                pendingOperations.set(key, {
                    opType: 'delete',
                    timer: null,
                    record: null,
                    oldRecord: record,
                    name: name,
                    rrset_type: type
                });

                renderRecords();

                // Schedule actual deletion after 5 seconds
                const timer = setTimeout(() => {
                    executePendingOperation(pendingOperations.get(key), key);
                }, 5000);
                pendingOperations.get(key).timer = timer;

                showUndoToast('delete', displayName, type, key);

                return Promise.resolve();
            }
        });
    }

    // ===============================================================
    // INIT
    // ===============================================================

    // ---------------------------------------------------------------
    // init() — Set up state listeners for domain changes and tab
    // switches. The records tab is the default active tab.
    // ---------------------------------------------------------------
    function init() {
        State.on('currentDomainChanged', () => {
            // Flush any pending operations before switching domains
            flushPendingOperations();

            // Reset filters, pagination, and selection on domain change
            searchFilter = '';
            typeFilter = '';
            currentPage = 1;
            sortColumn = 'rrset_name';
            sortDirection = 'asc';
            selectedRecords.clear();
            fetchRecords();
        });

        State.on('activeTabChanged', (tab) => {
            if (tab === 'records' && State.get('currentDomain')) {
                renderRecords();
            }
        });

        // Re-render when language changes (dynamic content uses I18n.t())
        State.on('languageChanged', () => {
            if (State.get('records') && State.get('activeTab') === 'records') {
                renderRecords();
            }
        });

        // Flush pending operations before page unload
        window.addEventListener('beforeunload', flushPendingOperations);
    }

    // ---------------------------------------------------------------
    // Public API
    // ---------------------------------------------------------------
    return {
        init: init,
        fetchRecords: fetchRecords,
        renderRecords: renderRecords,
        hasPendingOperations: function() { return pendingOperations.size > 0; }
    };
})();
