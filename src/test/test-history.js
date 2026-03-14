/**
 * Tests for the History module.
 * Run with: node --test src/test/test-history.js
 *
 * Tests bulk operations produce single history entries (items array),
 * and that individual operations still work correctly (non-regression).
 */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ---------------------------------------------------------------
// Minimal IndexedDB mock — in-memory store with cursors and indexes
// ---------------------------------------------------------------
function createIndexedDBMock() {
    let databases = {};

    function IDBKeyRange_only(value) {
        return { type: 'only', value: value };
    }

    function createStore(options) {
        let records = [];
        let autoInc = 1;
        let indexes = {};
        const keyPath = options.keyPath;

        return {
            _records: records,
            add: function(record) {
                if (options.autoIncrement && record[keyPath] === undefined) {
                    record[keyPath] = autoInc++;
                }
                records.push(JSON.parse(JSON.stringify(record)));
                return { onsuccess: null, onerror: null };
            },
            delete: function(id) {
                const idx = records.findIndex(r => r[keyPath] === id);
                if (idx !== -1) records.splice(idx, 1);
                return { onsuccess: null, onerror: null };
            },
            clear: function() {
                records.length = 0;
                return { onsuccess: null, onerror: null };
            },
            createIndex: function(name, indexKeyPath) {
                indexes[name] = indexKeyPath;
            },
            index: function(name) {
                const indexKey = indexes[name];
                return {
                    openCursor: function(range, direction) {
                        let filtered = records;
                        if (range && range.type === 'only') {
                            filtered = records.filter(r => r[indexKey] === range.value);
                        }
                        if (direction === 'prev') {
                            filtered = filtered.slice().sort((a, b) => b.timestamp - a.timestamp);
                        } else {
                            filtered = filtered.slice().sort((a, b) => a.timestamp - b.timestamp);
                        }
                        let pos = 0;
                        const request = { onsuccess: null, onerror: null };

                        // Drive cursor asynchronously via microtask
                        function advance() {
                            if (pos < filtered.length) {
                                const record = filtered[pos];
                                const cursor = {
                                    value: JSON.parse(JSON.stringify(record)),
                                    continue: function() {
                                        pos++;
                                        Promise.resolve().then(advance);
                                    },
                                    delete: function() {
                                        const realIdx = records.findIndex(r => r[keyPath] === record[keyPath]);
                                        if (realIdx !== -1) records.splice(realIdx, 1);
                                    }
                                };
                                if (request.onsuccess) {
                                    request.onsuccess({ target: { result: cursor } });
                                }
                            } else {
                                if (request.onsuccess) {
                                    request.onsuccess({ target: { result: null } });
                                }
                            }
                        }
                        Promise.resolve().then(advance);
                        return request;
                    }
                };
            }
        };
    }

    function createTransaction(database, storeName, mode) {
        const tx = {
            oncomplete: null,
            onerror: null,
            objectStore: function() {
                return database._stores[storeName];
            }
        };
        // Auto-complete transaction on next microtask
        Promise.resolve().then(() => {
            if (tx.oncomplete) tx.oncomplete();
        });
        return tx;
    }

    return {
        open: function(name, version) {
            const request = {
                onupgradeneeded: null,
                onsuccess: null,
                onerror: null
            };

            Promise.resolve().then(() => {
                let database = databases[name];
                if (!database) {
                    database = {
                        _stores: {},
                        objectStoreNames: { contains: function(n) { return !!database._stores[n]; } },
                        createObjectStore: function(storeName, opts) {
                            database._stores[storeName] = createStore(opts);
                            return database._stores[storeName];
                        },
                        transaction: function(storeName, mode) {
                            return createTransaction(database, storeName, mode);
                        }
                    };
                    databases[name] = database;
                    if (request.onupgradeneeded) {
                        request.onupgradeneeded({ target: { result: database } });
                    }
                }
                if (request.onsuccess) {
                    request.onsuccess({ target: { result: database } });
                }
            });

            return request;
        },
        _reset: function() {
            databases = {};
        }
    };
}

// ---------------------------------------------------------------
// Global mocks for History module dependencies
// ---------------------------------------------------------------
global.indexedDB = createIndexedDBMock();
global.IDBKeyRange = { only: function(v) { return { type: 'only', value: v }; } };

global.State = {
    _data: {},
    _listeners: {},
    get: function(key) { return this._data[key] !== undefined ? this._data[key] : null; },
    set: function(key, val) { this._data[key] = val; },
    on: function(event, fn) {
        if (!this._listeners[event]) this._listeners[event] = [];
        this._listeners[event].push(fn);
    },
    _reset: function() { this._data = {}; this._listeners = {}; }
};

global.I18n = {
    t: function(key, params) {
        let result = key;
        if (params) {
            Object.keys(params).forEach(function(k) {
                result = result.replace('{' + k + '}', params[k]);
            });
        }
        return result;
    }
};

global.UI = {
    createElement: function(tag, opts, children) {
        return { tag: tag, opts: opts || {}, children: children || [], _type: 'mock-element',
            appendChild: function(child) { this.children.push(child); },
            textContent: (opts && opts.textContent) || ''
        };
    },
    confirmAction: function() {},
    toast: function() {}
};

global.API = {
    getText: function() { return Promise.resolve('mock zone text'); },
    putText: function() { return Promise.resolve(); },
    put: function() { return Promise.resolve(); },
    del: function() { return Promise.resolve(); }
};

global.Helpers = {
    computeLineDiff: function() { return []; },
    normalizeZoneLine: function(l) { return l; }
};

global.Records = {
    fetchRecords: function() {}
};

// Load History module
const historyCode = fs.readFileSync(path.join(__dirname, '..', 'js', 'history.js'), 'utf8');
vm.runInThisContext(historyCode, { filename: 'history.js' });

// ---------------------------------------------------------------
// Tests
// ---------------------------------------------------------------

describe('History', function() {

    beforeEach(async function() {
        State._reset();
        State.set('currentDomain', 'example.com');
        // Clear all entries through History's own API (preserves DB connection)
        await History.clearAll();
    });

    // =============================================================
    // log() + getEntries() basics
    // =============================================================

    describe('log() and getEntries()', function() {

        it('should store and retrieve a basic entry', async function() {
            await History.log({
                domain: 'example.com',
                operation: 'create',
                recordName: 'www',
                recordType: 'A',
                before: null,
                after: { rrset_ttl: 300, rrset_values: ['1.2.3.4'] }
            });

            const entries = await History.getEntries('example.com');
            assert.equal(entries.length, 1);
            assert.equal(entries[0].operation, 'create');
            assert.equal(entries[0].recordName, 'www');
            assert.equal(entries[0].recordType, 'A');
            assert.equal(entries[0].domain, 'example.com');
            assert.deepEqual(entries[0].after, { rrset_ttl: 300, rrset_values: ['1.2.3.4'] });
            assert.equal(entries[0].before, null);
        });

        it('should store entries without items field for single operations', async function() {
            await History.log({
                domain: 'example.com',
                operation: 'delete',
                recordName: '@',
                recordType: 'TXT',
                before: { rrset_ttl: 10800, rrset_values: ['"old"'] },
                after: null
            });

            const entries = await History.getEntries('example.com');
            assert.equal(entries.length, 1);
            assert.equal(entries[0].items, undefined);
        });
    });

    // =============================================================
    // Bulk operations — items array
    // =============================================================

    describe('bulk operations (items array)', function() {

        it('should store items array for bulk-delete operations', async function() {
            const items = [
                { recordName: 'www', recordType: 'A', before: { rrset_ttl: 300, rrset_values: ['1.2.3.4'] }, after: null },
                { recordName: 'mail', recordType: 'MX', before: { rrset_ttl: 600, rrset_values: ['10 mail.example.com.'] }, after: null },
                { recordName: '@', recordType: 'TXT', before: { rrset_ttl: 10800, rrset_values: ['"v=spf1"'] }, after: null }
            ];

            await History.log({
                domain: 'example.com',
                operation: 'bulk-delete',
                items: items,
                beforeZone: 'zone before',
                afterZone: 'zone after'
            });

            const entries = await History.getEntries('example.com');
            assert.equal(entries.length, 1, 'bulk delete should produce exactly 1 history entry');
            assert.equal(entries[0].operation, 'bulk-delete');
            assert.equal(entries[0].items.length, 3);
            assert.equal(entries[0].items[0].recordName, 'www');
            assert.equal(entries[0].items[1].recordType, 'MX');
            assert.equal(entries[0].items[2].after, null);
            assert.equal(entries[0].beforeZone, 'zone before');
            assert.equal(entries[0].afterZone, 'zone after');
        });

        it('should store items array for bulk-update operations', async function() {
            const items = [
                {
                    recordName: 'www', recordType: 'A',
                    before: { rrset_ttl: 300, rrset_values: ['1.2.3.4'] },
                    after: { rrset_ttl: 3600, rrset_values: ['1.2.3.4'] }
                },
                {
                    recordName: 'api', recordType: 'A',
                    before: { rrset_ttl: 300, rrset_values: ['5.6.7.8'] },
                    after: { rrset_ttl: 3600, rrset_values: ['5.6.7.8'] }
                }
            ];

            await History.log({
                domain: 'example.com',
                operation: 'bulk-update',
                items: items
            });

            const entries = await History.getEntries('example.com');
            assert.equal(entries.length, 1, 'bulk update should produce exactly 1 history entry');
            assert.equal(entries[0].operation, 'bulk-update');
            assert.equal(entries[0].items.length, 2);
            // Verify TTL changed in items
            assert.equal(entries[0].items[0].before.rrset_ttl, 300);
            assert.equal(entries[0].items[0].after.rrset_ttl, 3600);
        });

        it('should NOT add items field for non-bulk operations', async function() {
            await History.log({
                domain: 'example.com',
                operation: 'update',
                recordName: 'www',
                recordType: 'A',
                before: { rrset_ttl: 300, rrset_values: ['1.2.3.4'] },
                after: { rrset_ttl: 3600, rrset_values: ['1.2.3.4'] }
            });

            const entries = await History.getEntries('example.com');
            assert.equal(entries.length, 1);
            assert.equal(entries[0].items, undefined,
                'single operations must NOT have items field');
        });
    });

    // =============================================================
    // Non-regression: multiple individual operations produce
    // multiple entries (the old behavior for non-bulk ops)
    // =============================================================

    describe('non-regression: individual operations', function() {

        it('should create separate entries for individual deletes', async function() {
            await History.log({
                domain: 'example.com',
                operation: 'delete',
                recordName: 'www',
                recordType: 'A',
                before: { rrset_ttl: 300, rrset_values: ['1.2.3.4'] },
                after: null
            });

            await History.log({
                domain: 'example.com',
                operation: 'delete',
                recordName: 'mail',
                recordType: 'MX',
                before: { rrset_ttl: 600, rrset_values: ['10 mail.example.com.'] },
                after: null
            });

            const entries = await History.getEntries('example.com');
            assert.equal(entries.length, 2,
                'individual operations must produce 2 separate entries');
            // Both entries should be present (order depends on timestamp resolution)
            const names = entries.map(e => e.recordName).sort();
            assert.deepEqual(names, ['mail', 'www']);
        });

        it('should create separate entries for individual updates', async function() {
            await History.log({
                domain: 'example.com',
                operation: 'update',
                recordName: '@',
                recordType: 'A',
                before: { rrset_ttl: 300, rrset_values: ['1.1.1.1'] },
                after: { rrset_ttl: 3600, rrset_values: ['1.1.1.1'] }
            });

            await History.log({
                domain: 'example.com',
                operation: 'create',
                recordName: 'new',
                recordType: 'CNAME',
                before: null,
                after: { rrset_ttl: 300, rrset_values: ['target.example.com.'] }
            });

            const entries = await History.getEntries('example.com');
            assert.equal(entries.length, 2);
        });
    });

    // =============================================================
    // Mixed: bulk + individual in same domain
    // =============================================================

    describe('mixed bulk and individual operations', function() {

        it('should keep bulk as 1 entry alongside individual entries', async function() {
            // Individual create
            await History.log({
                domain: 'example.com',
                operation: 'create',
                recordName: 'solo',
                recordType: 'A',
                before: null,
                after: { rrset_ttl: 300, rrset_values: ['9.9.9.9'] }
            });

            // Bulk delete (3 records → 1 entry)
            await History.log({
                domain: 'example.com',
                operation: 'bulk-delete',
                items: [
                    { recordName: 'a', recordType: 'A', before: { rrset_ttl: 300, rrset_values: ['1.1.1.1'] }, after: null },
                    { recordName: 'b', recordType: 'A', before: { rrset_ttl: 300, rrset_values: ['2.2.2.2'] }, after: null },
                    { recordName: 'c', recordType: 'A', before: { rrset_ttl: 300, rrset_values: ['3.3.3.3'] }, after: null }
                ]
            });

            // Individual update
            await History.log({
                domain: 'example.com',
                operation: 'update',
                recordName: 'solo',
                recordType: 'A',
                before: { rrset_ttl: 300, rrset_values: ['9.9.9.9'] },
                after: { rrset_ttl: 600, rrset_values: ['9.9.9.9'] }
            });

            const entries = await History.getEntries('example.com');
            assert.equal(entries.length, 3,
                'should have exactly 3 entries: 1 individual create + 1 bulk delete + 1 individual update');

            // Find the bulk entry
            const bulkEntry = entries.find(e => e.operation === 'bulk-delete');
            assert.ok(bulkEntry, 'bulk-delete entry must exist');
            assert.equal(bulkEntry.items.length, 3);

            // Other entries should not have items
            const nonBulk = entries.filter(e => e.operation !== 'bulk-delete');
            assert.equal(nonBulk.length, 2);
            nonBulk.forEach(function(entry) {
                assert.equal(entry.items, undefined,
                    'non-bulk entries must not have items');
            });
        });
    });

    // =============================================================
    // clearDomain / clearAll
    // =============================================================

    describe('clearDomain and clearAll', function() {

        it('clearDomain should remove entries including bulk entries', async function() {
            await History.log({
                domain: 'example.com',
                operation: 'bulk-delete',
                items: [
                    { recordName: 'a', recordType: 'A', before: { rrset_ttl: 300, rrset_values: ['1.1.1.1'] }, after: null }
                ]
            });

            await History.log({
                domain: 'other.com',
                operation: 'create',
                recordName: 'x',
                recordType: 'A',
                before: null,
                after: { rrset_ttl: 300, rrset_values: ['2.2.2.2'] }
            });

            await History.clearDomain('example.com');

            const exEntries = await History.getEntries('example.com');
            assert.equal(exEntries.length, 0, 'example.com entries should be cleared');

            const otherEntries = await History.getEntries('other.com');
            assert.equal(otherEntries.length, 1, 'other.com entries should remain');
        });

        it('clearAll should remove all entries including bulk entries', async function() {
            await History.log({
                domain: 'example.com',
                operation: 'bulk-update',
                items: [
                    { recordName: 'a', recordType: 'A', before: { rrset_ttl: 300, rrset_values: ['1.1.1.1'] }, after: { rrset_ttl: 600, rrset_values: ['1.1.1.1'] } }
                ]
            });

            await History.clearAll();

            const entries = await History.getEntries('example.com');
            assert.equal(entries.length, 0);
        });
    });
});
