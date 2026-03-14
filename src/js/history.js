/**
 * History — Local change history module for the Gandi DNS WebUI.
 *
 * Tracks every DNS record mutation (create/update/delete/zone-import/zone-edit)
 * in IndexedDB, providing a timeline UI, inline diff view, and rollback capability.
 *
 * DOM dependencies:
 *   #content-history — history panel container
 *
 * Module dependencies: State, API, UI, I18n, Helpers, Records
 */
const History = (function() {
    'use strict';

    // ---------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------
    const DB_NAME = 'gandi-dns-history';
    const DB_VERSION = 1;
    const STORE_NAME = 'entries';
    const MAX_RECORD_ENTRIES_PER_DOMAIN = 100;
    const MAX_ZONE_ENTRIES_PER_DOMAIN = 50;
    const DEFAULT_LIMIT = 100;

    /** @type {IDBDatabase|null} */
    let db = null;

    // ---------------------------------------------------------------
    // IndexedDB helpers
    // ---------------------------------------------------------------

    /**
     * openDB() — Open (or create) the IndexedDB database.
     * Returns a Promise that resolves with the database instance.
     */
    function openDB() {
        if (db) {
            return Promise.resolve(db);
        }
        return new Promise(function(resolve, reject) {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = function(event) {
                const database = event.target.result;
                if (!database.objectStoreNames.contains(STORE_NAME)) {
                    const store = database.createObjectStore(STORE_NAME, {
                        keyPath: 'id',
                        autoIncrement: true
                    });
                    store.createIndex('domain', 'domain', { unique: false });
                    store.createIndex('timestamp', 'timestamp', { unique: false });
                }
            };

            request.onsuccess = function(event) {
                db = event.target.result;
                resolve(db);
            };

            request.onerror = function(event) {
                console.error('History: IndexedDB open failed', event.target.error);
                reject(event.target.error);
            };
        });
    }

    // ---------------------------------------------------------------
    // log(entry) — Add a history entry and purge old entries (FIFO).
    // ---------------------------------------------------------------
    function log(entry) {
        const record = {
            timestamp: Date.now(),
            domain: entry.domain || State.get('currentDomain') || '',
            operation: entry.operation,
            recordName: entry.recordName || '',
            recordType: entry.recordType || '',
            before: entry.before || null,
            after: entry.after || null,
            beforeZone: entry.beforeZone || null,
            afterZone: entry.afterZone || null
        };

        // Bulk operations include an items array
        if (entry.items && Array.isArray(entry.items)) {
            record.items = entry.items;
        }

        return openDB().then(function(database) {
            return new Promise(function(resolve, reject) {
                const tx = database.transaction(STORE_NAME, 'readwrite');
                const store = tx.objectStore(STORE_NAME);
                store.add(record);

                tx.oncomplete = function() {
                    purgeOldEntries(record.domain).then(resolve).catch(resolve);
                };
                tx.onerror = function(event) {
                    console.error('History: log failed', event.target.error);
                    reject(event.target.error);
                };
            });
        }).catch(function(err) {
            console.error('History: log error', err);
        });
    }

    // ---------------------------------------------------------------
    // purgeOldEntries(domain) — Remove excess entries per domain.
    // Record-level operations are capped at MAX_RECORD_ENTRIES_PER_DOMAIN,
    // zone-level operations are capped at MAX_ZONE_ENTRIES_PER_DOMAIN.
    // ---------------------------------------------------------------
    function purgeOldEntries(domain) {
        return openDB().then(function(database) {
            return new Promise(function(resolve, _reject) {
                const tx = database.transaction(STORE_NAME, 'readwrite');
                const store = tx.objectStore(STORE_NAME);
                const index = store.index('domain');
                const request = index.openCursor(IDBKeyRange.only(domain));

                const recordEntries = [];
                const zoneEntries = [];

                request.onsuccess = function(event) {
                    const cursor = event.target.result;
                    if (cursor) {
                        const val = cursor.value;
                        if (val.operation === 'zone-import' || val.operation === 'zone-edit') {
                            zoneEntries.push({ id: val.id, timestamp: val.timestamp });
                        } else {
                            recordEntries.push({ id: val.id, timestamp: val.timestamp });
                        }
                        cursor.continue();
                    } else {
                        // Sort oldest first
                        recordEntries.sort(function(a, b) { return a.timestamp - b.timestamp; });
                        zoneEntries.sort(function(a, b) { return a.timestamp - b.timestamp; });

                        const toDelete = [];

                        // Purge record entries exceeding the cap
                        while (recordEntries.length > MAX_RECORD_ENTRIES_PER_DOMAIN) {
                            toDelete.push(recordEntries.shift().id);
                        }

                        // Purge zone entries exceeding the cap
                        while (zoneEntries.length > MAX_ZONE_ENTRIES_PER_DOMAIN) {
                            toDelete.push(zoneEntries.shift().id);
                        }

                        if (toDelete.length > 0) {
                            const deleteTx = database.transaction(STORE_NAME, 'readwrite');
                            const deleteStore = deleteTx.objectStore(STORE_NAME);
                            for (let i = 0; i < toDelete.length; i++) {
                                deleteStore.delete(toDelete[i]);
                            }
                            deleteTx.oncomplete = resolve;
                            deleteTx.onerror = function() { resolve(); };
                        } else {
                            resolve();
                        }
                    }
                };

                request.onerror = function() { resolve(); };
            });
        });
    }

    // ---------------------------------------------------------------
    // getEntries(domain, limit) — Get entries for a domain, newest first.
    // If domain is null/undefined, returns entries for all domains.
    // ---------------------------------------------------------------
    function getEntries(domain, limit) {
        const maxEntries = limit || DEFAULT_LIMIT;

        return openDB().then(function(database) {
            return new Promise(function(resolve, _reject) {
                const tx = database.transaction(STORE_NAME, 'readonly');
                const store = tx.objectStore(STORE_NAME);
                const results = [];

                let request;
                if (domain) {
                    const index = store.index('domain');
                    request = index.openCursor(IDBKeyRange.only(domain), 'prev');
                } else {
                    const index = store.index('timestamp');
                    request = index.openCursor(null, 'prev');
                }

                request.onsuccess = function(event) {
                    const cursor = event.target.result;
                    if (cursor && results.length < maxEntries) {
                        results.push(cursor.value);
                        cursor.continue();
                    } else {
                        // Sort newest first by timestamp
                        results.sort(function(a, b) { return b.timestamp - a.timestamp; });
                        resolve(results);
                    }
                };

                request.onerror = function(event) {
                    console.error('History: getEntries failed', event.target.error);
                    resolve([]);
                };
            });
        }).catch(function() {
            return [];
        });
    }

    // ---------------------------------------------------------------
    // clearDomain(domain) — Clear all entries for a specific domain.
    // ---------------------------------------------------------------
    function clearDomain(domain) {
        return openDB().then(function(database) {
            return new Promise(function(resolve, _reject) {
                const tx = database.transaction(STORE_NAME, 'readwrite');
                const store = tx.objectStore(STORE_NAME);
                const index = store.index('domain');
                const request = index.openCursor(IDBKeyRange.only(domain));

                request.onsuccess = function(event) {
                    const cursor = event.target.result;
                    if (cursor) {
                        cursor.delete();
                        cursor.continue();
                    }
                };

                tx.oncomplete = resolve;
                tx.onerror = function(event) {
                    console.error('History: clearDomain failed', event.target.error);
                    resolve();
                };
            });
        });
    }

    // ---------------------------------------------------------------
    // clearAll() — Clear all history entries.
    // ---------------------------------------------------------------
    function clearAll() {
        return openDB().then(function(database) {
            return new Promise(function(resolve, _reject) {
                const tx = database.transaction(STORE_NAME, 'readwrite');
                const store = tx.objectStore(STORE_NAME);
                store.clear();

                tx.oncomplete = resolve;
                tx.onerror = function(event) {
                    console.error('History: clearAll failed', event.target.error);
                    resolve();
                };
            });
        });
    }

    // ===============================================================
    // UI RENDERING
    // ===============================================================

    /** Track the current domain-only filter state */
    let domainFilterEnabled = true;

    // ---------------------------------------------------------------
    // render() — Render the history timeline in #content-history.
    // ---------------------------------------------------------------
    function render() {
        const container = document.getElementById('content-history');
        if (!container) {
            return;
        }

        container.textContent = '';

        // Section header
        const header = UI.createElement('div', { className: 'section-header' }, [
            UI.createElement('h2', {
                className: 'section-header__title',
                textContent: I18n.t('history.title')
            }),
            UI.createElement('p', {
                className: 'section-header__description',
                textContent: I18n.t('history.description')
            })
        ]);
        container.appendChild(header);

        // Filter controls
        const currentDomain = State.get('currentDomain');
        const filterRow = UI.createElement('div', { className: 'history-controls' });

        if (currentDomain) {
            const checkbox = UI.createElement('input', {
                type: 'checkbox',
                id: 'history-domain-filter',
                checked: domainFilterEnabled
            });
            checkbox.addEventListener('change', function() {
                domainFilterEnabled = this.checked;
                render();
            });

            const label = UI.createElement('label', {
                className: 'history-controls__filter',
                htmlFor: 'history-domain-filter'
            }, [
                checkbox,
                UI.createElement('span', {
                    textContent: ' ' + I18n.t('history.thisdomainOnly')
                })
            ]);
            filterRow.appendChild(label);
        }

        container.appendChild(filterRow);

        // Loading placeholder
        const loadingEl = UI.createElement('p', {
            className: 'content-panel__empty',
            textContent: '...'
        });
        container.appendChild(loadingEl);

        // Fetch entries
        const filterDomain = (currentDomain && domainFilterEnabled) ? currentDomain : null;
        getEntries(filterDomain).then(function(entries) {
            // Remove loading placeholder
            if (loadingEl.parentNode) {
                loadingEl.parentNode.removeChild(loadingEl);
            }

            if (entries.length === 0) {
                const emptyKey = (currentDomain && domainFilterEnabled)
                    ? 'history.emptyDomain'
                    : 'history.empty';
                container.appendChild(UI.createElement('p', {
                    className: 'content-panel__empty',
                    textContent: I18n.t(emptyKey)
                }));
            } else {
                // Build timeline
                const timeline = UI.createElement('div', { className: 'history-timeline' });
                for (let i = 0; i < entries.length; i++) {
                    timeline.appendChild(renderEntry(entries[i]));
                }
                container.appendChild(timeline);
            }

            // Action buttons
            const actionsRow = UI.createElement('div', { className: 'history-actions' });

            if (currentDomain) {
                const clearDomainBtn = UI.createElement('button', {
                    type: 'button',
                    className: 'btn btn--sm btn--secondary',
                    textContent: I18n.t('history.clearDomain', { domain: currentDomain }),
                    dataset: { action: 'clear-history-domain' },
                    events: {
                        click: function() {
                            handleClearDomain(currentDomain);
                        }
                    }
                });
                actionsRow.appendChild(clearDomainBtn);
            }

            const clearAllBtn = UI.createElement('button', {
                type: 'button',
                className: 'btn btn--sm btn--danger',
                textContent: I18n.t('history.clearAll'),
                dataset: { action: 'clear-history' },
                events: {
                    click: function() {
                        handleClearAll();
                    }
                }
            });
            actionsRow.appendChild(clearAllBtn);
            container.appendChild(actionsRow);
        });
    }

    // ---------------------------------------------------------------
    // renderEntry(entry) — Build the DOM for a single history entry.
    // ---------------------------------------------------------------
    function renderEntry(entry) {
        const time = formatTime(entry.timestamp);
        const badgeClass = getBadgeClass(entry.operation);
        const badgeText = getOperationLabel(entry.operation);

        const entryEl = UI.createElement('div', { className: 'history-entry' });

        // Time column
        entryEl.appendChild(UI.createElement('span', {
            className: 'history-entry__time',
            textContent: time,
            title: new Date(entry.timestamp).toLocaleString()
        }));

        // Badge column
        entryEl.appendChild(UI.createElement('span', {
            className: 'history-entry__badge ' + badgeClass,
            textContent: badgeText
        }));

        // Details column
        const details = UI.createElement('div', { className: 'history-entry__details' });

        // Bulk operations: show item count + list
        if (entry.items && entry.items.length > 0) {
            details.appendChild(UI.createElement('span', {
                className: 'history-entry__record',
                textContent: I18n.t('history.bulkCount', { count: entry.items.length })
            }));

            // Show domain if viewing all domains
            if (!domainFilterEnabled && entry.domain) {
                details.appendChild(UI.createElement('span', {
                    className: 'history-entry__domain',
                    textContent: ' (' + entry.domain + ')'
                }));
            }

            // List affected records
            const itemsList = UI.createElement('div', { className: 'history-entry__bulk-items' });
            for (let bi = 0; bi < entry.items.length; bi++) {
                const item = entry.items[bi];
                const itemLabel = (item.recordName || '@') + ' ' + (item.recordType || '');
                itemsList.appendChild(UI.createElement('span', {
                    className: 'history-entry__bulk-item',
                    textContent: itemLabel.trim()
                }));
            }
            details.appendChild(itemsList);
        } else if (entry.recordName || entry.recordType) {
            // Record name + type (for record-level operations)
            const recordLabel = (entry.recordName || '@') + ' ' + (entry.recordType || '');
            details.appendChild(UI.createElement('span', {
                className: 'history-entry__record',
                textContent: recordLabel.trim()
            }));

            // Show domain if viewing all domains
            if (!domainFilterEnabled && entry.domain) {
                details.appendChild(UI.createElement('span', {
                    className: 'history-entry__domain',
                    textContent: ' (' + entry.domain + ')'
                }));
            }
        } else if (entry.domain) {
            // Zone-level operations
            details.appendChild(UI.createElement('span', {
                className: 'history-entry__record',
                textContent: entry.domain
            }));
        }

        // Diff view
        const diff = renderDiff(entry);
        if (diff) {
            details.appendChild(diff);
        }

        entryEl.appendChild(details);

        // Action buttons
        const actions = UI.createElement('div', { className: 'history-entry__actions' });

        const exportBtn = UI.createElement('button', {
            type: 'button',
            className: 'btn btn--sm btn--ghost',
            textContent: I18n.t('history.export'),
            title: I18n.t('history.exportTitle'),
            dataset: { action: 'export' },
            events: {
                click: function() {
                    exportEntry(entry);
                }
            }
        });
        actions.appendChild(exportBtn);

        const rollbackBtn = UI.createElement('button', {
            type: 'button',
            className: 'btn btn--sm btn--secondary',
            textContent: I18n.t('history.rollback'),
            dataset: { action: 'rollback' },
            events: {
                click: function() {
                    handleRollback(entry);
                }
            }
        });
        actions.appendChild(rollbackBtn);
        entryEl.appendChild(actions);

        return entryEl;
    }

    // ---------------------------------------------------------------
    // renderZoneDiffCompact(beforeZone, afterZone) — Compact unified
    // diff for the timeline. Shows only changed lines + 1 context line.
    // ---------------------------------------------------------------
    function renderZoneDiffCompact(beforeZone, afterZone) {
        const diff = Helpers.computeLineDiff(beforeZone, afterZone, Helpers.normalizeZoneLine);
        const container = UI.createElement('div', { className: 'zone-diff' });

        // Count changes
        let addCount = 0;
        let delCount = 0;
        for (let c = 0; c < diff.length; c++) {
            if (diff[c].type === 'add') { addCount++; }
            if (diff[c].type === 'del') { delCount++; }
        }

        // Summary line
        const totalLines = (afterZone || '').split('\n').length;
        container.appendChild(UI.createElement('div', {
            className: 'zone-diff__summary',
            textContent: I18n.t('history.diffStats', {
                added: addCount,
                removed: delCount,
                total: totalLines
            })
        }));

        // Determine which indices to show (changed + 1 context)
        const CONTEXT = 1;
        const show = new Array(diff.length).fill(false);
        for (let s = 0; s < diff.length; s++) {
            if (diff[s].type !== 'same') {
                for (let k = Math.max(0, s - CONTEXT); k <= Math.min(diff.length - 1, s + CONTEXT); k++) {
                    show[k] = true;
                }
            }
        }

        // Render visible lines
        let lastShown = -2;
        for (let r = 0; r < diff.length; r++) {
            if (!show[r]) { continue; }
            if (r > lastShown + 1) {
                container.appendChild(UI.createElement('div', {
                    className: 'zone-diff__separator',
                    textContent: '···'
                }));
            }
            const prefix = diff[r].type === 'del' ? '−' : (diff[r].type === 'add' ? '+' : ' ');
            const lineEl = UI.createElement('div', {
                className: 'zone-diff__line zone-diff__line--' + diff[r].type
            }, [
                UI.createElement('span', {
                    className: 'zone-diff__prefix',
                    textContent: prefix
                }),
                UI.createElement('span', {
                    className: 'zone-diff__text',
                    textContent: diff[r].line
                })
            ]);
            container.appendChild(lineEl);
            lastShown = r;
        }

        return container;
    }

    // ---------------------------------------------------------------
    // renderZoneDiffSplit(beforeZone, afterZone) — Side-by-side diff
    // with synchronized scrolling. Used in rollback confirmation.
    // ---------------------------------------------------------------
    function renderZoneDiffSplit(beforeZone, afterZone) {
        const diff = Helpers.computeLineDiff(beforeZone, afterZone, Helpers.normalizeZoneLine);

        // Group consecutive changes for side-by-side alignment
        const groups = [];
        let gi = 0;
        while (gi < diff.length) {
            if (diff[gi].type === 'same') {
                groups.push({ type: 'same', lines: [diff[gi].line] });
                gi++;
            } else {
                const dels = [];
                const adds = [];
                while (gi < diff.length && diff[gi].type === 'del') {
                    dels.push(diff[gi].line);
                    gi++;
                }
                while (gi < diff.length && diff[gi].type === 'add') {
                    adds.push(diff[gi].line);
                    gi++;
                }
                groups.push({ type: 'change', dels: dels, adds: adds });
            }
        }

        const container = UI.createElement('div', { className: 'zone-diff-split' });

        // Headers
        container.appendChild(UI.createElement('div', {
            className: 'zone-diff-split__row zone-diff-split__row--header'
        }, [
            UI.createElement('div', {
                className: 'zone-diff-split__cell zone-diff-split__cell--header',
                textContent: I18n.t('history.diffBefore')
            }),
            UI.createElement('div', {
                className: 'zone-diff-split__cell zone-diff-split__cell--header',
                textContent: I18n.t('history.diffAfter')
            })
        ]));

        // Body (scrollable)
        const body = UI.createElement('div', { className: 'zone-diff-split__body' });

        for (let g = 0; g < groups.length; g++) {
            const group = groups[g];
            if (group.type === 'same') {
                for (let s = 0; s < group.lines.length; s++) {
                    body.appendChild(makeSplitRow(group.lines[s], 'same', group.lines[s], 'same'));
                }
            } else {
                const maxLen = Math.max(group.dels.length, group.adds.length);
                for (let p = 0; p < maxLen; p++) {
                    const leftLine = p < group.dels.length ? group.dels[p] : null;
                    const rightLine = p < group.adds.length ? group.adds[p] : null;
                    body.appendChild(makeSplitRow(
                        leftLine, leftLine !== null ? 'del' : 'empty',
                        rightLine, rightLine !== null ? 'add' : 'empty'
                    ));
                }
            }
        }

        container.appendChild(body);
        return container;
    }

    function makeSplitRow(leftText, leftType, rightText, rightType) {
        const leftPrefix = leftType === 'del' ? '−' : (leftType === 'same' ? ' ' : '');
        const rightPrefix = rightType === 'add' ? '+' : (rightType === 'same' ? ' ' : '');

        return UI.createElement('div', { className: 'zone-diff-split__row' }, [
            UI.createElement('div', {
                className: 'zone-diff-split__cell zone-diff-split__cell--' + leftType,
                dataset: { label: I18n.t('history.diffBefore') }
            }, [
                UI.createElement('span', {
                    className: 'zone-diff__prefix',
                    textContent: leftPrefix
                }),
                UI.createElement('span', {
                    className: 'zone-diff__text',
                    textContent: leftText !== null ? leftText : ''
                })
            ]),
            UI.createElement('div', {
                className: 'zone-diff-split__cell zone-diff-split__cell--' + rightType,
                dataset: { label: I18n.t('history.diffAfter') }
            }, [
                UI.createElement('span', {
                    className: 'zone-diff__prefix',
                    textContent: rightPrefix
                }),
                UI.createElement('span', {
                    className: 'zone-diff__text',
                    textContent: rightText !== null ? rightText : ''
                })
            ])
        ]);
    }

    // ---------------------------------------------------------------
    // renderDiff(entry) — Build inline diff view for an entry.
    // ---------------------------------------------------------------
    function renderDiff(entry) {
        const diff = UI.createElement('div', { className: 'history-entry__diff' });
        let hasDiff = false;

        if (entry.operation === 'ns-update') {
            // Nameserver update: show before/after as NS lists
            if (entry.before && entry.before.nameservers) {
                diff.appendChild(makeDiffLine(
                    I18n.t('history.diffBefore'),
                    entry.before.nameservers.join(', '),
                    'old'
                ));
            }
            if (entry.after && entry.after.nameservers) {
                diff.appendChild(makeDiffLine(
                    I18n.t('history.diffAfter'),
                    entry.after.nameservers.join(', '),
                    'new'
                ));
            }
            hasDiff = !!(entry.before || entry.after);
        } else if (entry.operation === 'zone-import' || entry.operation === 'zone-edit') {
            // Zone-level: show compact unified diff
            if (entry.beforeZone || entry.afterZone) {
                diff.appendChild(renderZoneDiffCompact(entry.beforeZone || '', entry.afterZone || ''));
                hasDiff = true;
            }
        } else if (entry.items && entry.items.length > 0) {
            // Bulk operations: show per-item diffs
            for (let bi = 0; bi < entry.items.length; bi++) {
                const item = entry.items[bi];
                const itemLabel = (item.recordName || '@') + ' ' + (item.recordType || '');
                const itemBlock = UI.createElement('div', { className: 'history-entry__diff-item' });

                itemBlock.appendChild(UI.createElement('span', {
                    className: 'history-entry__diff-item-label',
                    textContent: itemLabel.trim()
                }));

                if (!item.before && item.after) {
                    // CREATE in bulk: only show values
                    itemBlock.appendChild(makeDiffLine(I18n.t('history.diffValues'), formatRecordValues(item.after), 'new'));
                } else if (item.before && !item.after) {
                    // DELETE in bulk: only show values
                    itemBlock.appendChild(makeDiffLine(I18n.t('history.diffValues'), formatRecordValues(item.before), 'old'));
                } else {
                    // UPDATE: show before + after
                    const itemBefore = item.before
                        ? formatRecordValues(item.before)
                        : I18n.t('history.diffNone');
                    const itemAfter = item.after
                        ? formatRecordValues(item.after)
                        : I18n.t('history.diffDeleted');
                    itemBlock.appendChild(makeDiffLine(I18n.t('history.diffBefore'), itemBefore, 'old'));
                    itemBlock.appendChild(makeDiffLine(I18n.t('history.diffAfter'), itemAfter, 'new'));
                }

                diff.appendChild(itemBlock);
            }
            hasDiff = true;
        } else if (entry.operation === 'create' && entry.after) {
            // CREATE: compact — only show values
            diff.appendChild(makeDiffLine(I18n.t('history.diffValues'), formatRecordValues(entry.after), 'new'));
            hasDiff = true;
        } else if (entry.operation === 'delete' && entry.before) {
            // DELETE: compact — only show values
            diff.appendChild(makeDiffLine(I18n.t('history.diffValues'), formatRecordValues(entry.before), 'old'));
            hasDiff = true;
        } else {
            // UPDATE/other: show both before and after
            const beforeText = entry.before
                ? formatRecordValues(entry.before)
                : I18n.t('history.diffNone');
            const afterText = entry.after
                ? formatRecordValues(entry.after)
                : I18n.t('history.diffDeleted');

            if (entry.before || entry.after) {
                diff.appendChild(makeDiffLine(
                    I18n.t('history.diffBefore'),
                    beforeText,
                    'old'
                ));
                diff.appendChild(makeDiffLine(
                    I18n.t('history.diffAfter'),
                    afterText,
                    'new'
                ));
                hasDiff = true;
            }
        }

        if (!hasDiff) {
            diff.appendChild(UI.createElement('span', {
                className: 'history-entry__diff-label',
                textContent: I18n.t('history.noDetails')
            }));
        }

        return diff;
    }

    // ---------------------------------------------------------------
    // makeDiffLine(label, value, type) — Build a single diff line.
    // type: 'old' or 'new'
    // ---------------------------------------------------------------
    function makeDiffLine(label, value, type) {
        const modifierClass = type === 'old'
            ? 'history-entry__diff-value--old'
            : 'history-entry__diff-value--new';

        return UI.createElement('div', { className: 'history-entry__diff-line' }, [
            UI.createElement('span', {
                className: 'history-entry__diff-label',
                textContent: label + ': '
            }),
            UI.createElement('span', {
                className: 'history-entry__diff-value ' + modifierClass,
                textContent: value
            })
        ]);
    }

    // ---------------------------------------------------------------
    // Formatting helpers
    // ---------------------------------------------------------------

    function formatTime(timestamp) {
        const d = new Date(timestamp);
        const hours = String(d.getHours()).padStart(2, '0');
        const minutes = String(d.getMinutes()).padStart(2, '0');
        const seconds = String(d.getSeconds()).padStart(2, '0');
        return hours + ':' + minutes + ':' + seconds;
    }

    function formatRecordValues(record) {
        if (!record) {
            return '';
        }
        const parts = [];
        if (record.rrset_ttl !== undefined) {
            parts.push('TTL=' + record.rrset_ttl);
        }
        if (record.rrset_values && Array.isArray(record.rrset_values)) {
            parts.push(record.rrset_values.join(', '));
        }
        return parts.join(' | ');
    }

    function getBadgeClass(operation) {
        switch (operation) {
            case 'create': return 'history-entry__badge--create';
            case 'update':
            case 'bulk-update':
            case 'ns-update': return 'history-entry__badge--update';
            case 'delete':
            case 'bulk-delete': return 'history-entry__badge--delete';
            case 'zone-import':
            case 'zone-edit': return 'history-entry__badge--zone';
            case 'rollback': return 'history-entry__badge--rollback';
            default: return '';
        }
    }

    function getOperationLabel(operation) {
        switch (operation) {
            case 'create': return I18n.t('history.opCreate');
            case 'update': return I18n.t('history.opUpdate');
            case 'delete': return I18n.t('history.opDelete');
            case 'bulk-delete': return I18n.t('history.opBulkDelete');
            case 'bulk-update': return I18n.t('history.opBulkUpdate');
            case 'ns-update': return I18n.t('history.opNsUpdate');
            case 'zone-import': return I18n.t('history.opZoneImport');
            case 'zone-edit': return I18n.t('history.opZoneEdit');
            case 'rollback': return I18n.t('history.opRollback');
            default: return operation || '';
        }
    }

    // ===============================================================
    // API PATH HELPERS
    // ===============================================================

    // ---------------------------------------------------------------
    // buildApiPath(domain, name, type) — Build an API path relative
    // to baseUrl. API module prepends /v5/livedns automatically.
    //   buildApiPath('example.com')         → '/domains/example.com/records'
    //   buildApiPath('example.com','@','A') → '/domains/example.com/records/@/A'
    // ---------------------------------------------------------------
    function buildApiPath(domain, name, type) {
        let path = '/domains/' + encodeURIComponent(domain) + '/records';
        if (name !== undefined && type !== undefined) {
            path += '/' + (name === '@' ? '@' : encodeURIComponent(name));
            path += '/' + encodeURIComponent(type);
        }
        return path;
    }

    // ===============================================================
    // EXPORT
    // ===============================================================

    // ---------------------------------------------------------------
    // exportEntry(entry) — Download zone state as a .txt file.
    // Uses beforeZone (pre-change state), falls back to afterZone,
    // or fetches current zone text from API as last resort.
    // ---------------------------------------------------------------
    function exportEntry(entry) {
        const zoneText = entry.beforeZone || entry.afterZone || null;

        if (zoneText) {
            downloadZoneFile(entry, zoneText);
            return;
        }

        // No saved zone data — fetch the current zone from API
        if (!entry.domain) {
            UI.toast('error', I18n.t('history.exportNoZone'));
            return;
        }
        API.getText(buildApiPath(entry.domain)).then(function(text) {
            downloadZoneFile(entry, text);
        }).catch(function() {
            UI.toast('error', I18n.t('history.exportNoZone'));
        });
    }

    function downloadZoneFile(entry, text) {
        const blob = new Blob([text], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);

        const ts = new Date(entry.timestamp).toISOString().replace(/[:.]/g, '-');
        const a = document.createElement('a');
        a.href = url;
        a.download = entry.domain + '-zone-' + ts + '.txt';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        UI.toast('success', I18n.t('history.exported'));
    }

    // ===============================================================
    // ROLLBACK
    // ===============================================================

    // ---------------------------------------------------------------
    // handleRollback(entry) — Confirm and execute a rollback.
    // ---------------------------------------------------------------
    function handleRollback(entry) {
        // Show what the rollback will do: current state → reverted state
        // afterZone = current state, beforeZone = target after rollback
        const hasZoneData = entry.beforeZone || entry.afterZone;
        const contentEl = hasZoneData
            ? renderZoneDiffSplit(entry.afterZone || '', entry.beforeZone || '')
            : renderDiff(entry);

        UI.confirmAction({
            title: I18n.t('history.rollback'),
            message: I18n.t('history.rollbackConfirm'),
            contentEl: contentEl,
            confirmText: I18n.t('history.rollback'),
            confirmClass: 'btn--danger',
            modalClass: hasZoneData ? 'modal--large' : undefined,
            onConfirm: function() {
                return rollback(entry);
            }
        });
    }

    // ---------------------------------------------------------------
    // rollbackDone(domain) — Shared success handler for rollback.
    // ---------------------------------------------------------------
    function rollbackDone(domain) {
        UI.toast('success', I18n.t('history.rollbackSuccess'));
        // Refresh records if the rollback domain is the current one
        if (State.get('currentDomain') === domain) {
            Records.fetchRecords();
        }
        render();
    }

    // ---------------------------------------------------------------
    // rollback(entry) — Execute the inverse operation of a history entry.
    // ---------------------------------------------------------------
    function rollback(entry) {
        const domain = entry.domain;

        if (entry.operation === 'zone-import' || entry.operation === 'zone-edit') {
            if (!entry.beforeZone) {
                UI.toast('error', I18n.t('history.rollbackFailed'));
                return Promise.reject(new Error('No beforeZone data'));
            }
            return API.putText(buildApiPath(domain), entry.beforeZone).then(function() {
                return log({
                    domain: domain,
                    operation: 'rollback',
                    beforeZone: entry.afterZone,
                    afterZone: entry.beforeZone
                });
            }).then(function() {
                rollbackDone(domain);
            }).catch(function(err) {
                UI.toast('error', I18n.t('history.rollbackFailed'));
                throw err;
            });
        }

        if (entry.operation === 'ns-update') {
            if (!entry.before || !entry.before.nameservers) {
                UI.toast('error', I18n.t('history.rollbackFailed'));
                return Promise.reject(new Error('No before nameservers data'));
            }
            const nsPath = '/domains/' + encodeURIComponent(domain) + '/nameservers';
            return API.put(nsPath, entry.before.nameservers).then(function() {
                return log({
                    domain: domain,
                    operation: 'rollback',
                    before: entry.after,
                    after: entry.before
                });
            }).then(function() {
                // Refresh nameservers if current domain matches
                if (State.get('currentDomain') === domain) {
                    Nameservers.fetchNameservers();
                }
                rollbackDone(domain);
            }).catch(function(err) {
                UI.toast('error', I18n.t('history.rollbackFailed'));
                throw err;
            });
        }

        const name = entry.recordName || '@';
        const type = entry.recordType;
        const path = buildApiPath(domain, name, type);

        if (entry.operation === 'create') {
            return API.del(path).then(function() {
                return log({
                    domain: domain,
                    operation: 'rollback',
                    recordName: name,
                    recordType: type,
                    before: entry.after,
                    after: null
                });
            }).then(function() {
                rollbackDone(domain);
            }).catch(function(err) {
                UI.toast('error', I18n.t('history.rollbackFailed'));
                throw err;
            });
        }

        if (entry.operation === 'update' || entry.operation === 'delete') {
            if (!entry.before) {
                UI.toast('error', I18n.t('history.rollbackFailed'));
                return Promise.reject(new Error('No before data'));
            }
            const logBefore = entry.operation === 'update' ? entry.after : null;
            return API.put(path, {
                rrset_ttl: entry.before.rrset_ttl,
                rrset_values: entry.before.rrset_values
            }).then(function() {
                return log({
                    domain: domain,
                    operation: 'rollback',
                    recordName: name,
                    recordType: type,
                    before: logBefore,
                    after: entry.before
                });
            }).then(function() {
                rollbackDone(domain);
            }).catch(function(err) {
                UI.toast('error', I18n.t('history.rollbackFailed'));
                throw err;
            });
        }

        // Bulk operations: rollback each item sequentially
        if (entry.operation === 'bulk-delete' || entry.operation === 'bulk-update') {
            if (!entry.items || entry.items.length === 0) {
                UI.toast('error', I18n.t('history.rollbackFailed'));
                return Promise.reject(new Error('No items in bulk entry'));
            }

            const rollbackItems = [];
            let chain = Promise.resolve();

            for (let ri = 0; ri < entry.items.length; ri++) {
                (function(item) {
                    chain = chain.then(function() {
                        if (!item.before) {
                            return Promise.resolve();
                        }
                        const itemPath = buildApiPath(domain, item.recordName || '@', item.recordType);
                        return API.put(itemPath, {
                            rrset_ttl: item.before.rrset_ttl,
                            rrset_values: item.before.rrset_values
                        }).then(function() {
                            rollbackItems.push({
                                recordName: item.recordName,
                                recordType: item.recordType,
                                before: item.after,
                                after: item.before
                            });
                        });
                    });
                })(entry.items[ri]);
            }

            return chain.then(function() {
                return log({
                    domain: domain,
                    operation: 'rollback',
                    items: rollbackItems,
                    beforeZone: entry.afterZone,
                    afterZone: entry.beforeZone
                });
            }).then(function() {
                rollbackDone(domain);
            }).catch(function(err) {
                UI.toast('error', I18n.t('history.rollbackFailed'));
                throw err;
            });
        }

        UI.toast('error', I18n.t('history.rollbackFailed'));
        return Promise.reject(new Error('Cannot rollback operation: ' + entry.operation));
    }

    // ===============================================================
    // CLEAR HANDLERS
    // ===============================================================

    function handleClearDomain(domain) {
        UI.confirmAction({
            title: I18n.t('history.clearDomain', { domain: domain }),
            message: I18n.t('history.clearConfirm'),
            confirmText: I18n.t('history.clearDomain', { domain: domain }),
            confirmClass: 'btn--danger',
            onConfirm: function() {
                return clearDomain(domain).then(function() {
                    UI.toast('success', I18n.t('history.cleared'));
                    render();
                });
            }
        });
    }

    function handleClearAll() {
        UI.confirmAction({
            title: I18n.t('history.clearAll'),
            message: I18n.t('history.clearConfirm'),
            confirmText: I18n.t('history.clearAll'),
            confirmClass: 'btn--danger',
            onConfirm: function() {
                return clearAll().then(function() {
                    UI.toast('success', I18n.t('history.cleared'));
                    render();
                });
            }
        });
    }

    // ===============================================================
    // INIT
    // ===============================================================

    function init() {
        // Pre-open the database
        openDB().catch(function(err) {
            console.error('History: init failed to open DB', err);
        });

        // Re-render when the history tab is activated
        State.on('activeTabChanged', function(tab) {
            if (tab === 'history') {
                render();
            }
        });

        // Re-render when language changes
        State.on('languageChanged', function() {
            if (State.get('activeTab') === 'history') {
                render();
            }
        });
    }

    // ---------------------------------------------------------------
    // Public API
    // ---------------------------------------------------------------
    return {
        init: init,
        log: log,
        getEntries: getEntries,
        clearDomain: clearDomain,
        clearAll: clearAll,
        render: render
    };
})();
