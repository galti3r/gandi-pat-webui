/**
 * Tests for the Domains module — progressive loading & DOM deduplication.
 * Run with: node --test src/test/test-domains.js
 *
 * Regression tests for:
 * - DOM list cleared on fetchDomains() to prevent duplicate entries
 * - filterByEntities() entity matching logic
 * - updateDomainCount() loading/final badge text
 * - cancelLoading() abort behaviour
 * - appendDomainsToDropdown() incremental add without clearing
 */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// --- Minimal DOM mock ---
function createElementMock(tag) {
    var el = {
        tagName: tag,
        children: [],
        childNodes: [],
        style: {},
        dataset: {},
        classList: {
            _classes: [],
            add: function(c) { if (this._classes.indexOf(c) === -1) this._classes.push(c); },
            remove: function(c) { var idx = this._classes.indexOf(c); if (idx !== -1) this._classes.splice(idx, 1); },
            contains: function(c) { return this._classes.indexOf(c) !== -1; }
        },
        setAttribute: function() {},
        getAttribute: function() { return null; },
        removeAttribute: function() {},
        appendChild: function(child) {
            el.children.push(child);
            el.childNodes.push(child);
            child.parentElement = el;
        },
        removeChild: function(child) {
            var idx = el.children.indexOf(child);
            if (idx !== -1) el.children.splice(idx, 1);
            idx = el.childNodes.indexOf(child);
            if (idx !== -1) el.childNodes.splice(idx, 1);
        },
        querySelectorAll: function() { return []; },
        querySelector: function() { return null; },
        scrollIntoView: function() {},
        addEventListener: function() {},
        textContent: '',
        value: '',
        id: '',
        className: ''
    };
    Object.defineProperty(el, 'firstChild', {
        get: function() { return el.childNodes[0] || null; }
    });
    return el;
}

var domElements = {};

global.document = {
    getElementById: function(id) { return domElements[id] || null; },
    addEventListener: function() {},
    querySelectorAll: function() { return []; },
    querySelector: function() { return null; },
    activeElement: null
};

// --- State mock ---
global.State = {
    _data: {},
    _listeners: {},
    get: function(key) { return this._data[key] !== undefined ? this._data[key] : null; },
    set: function(key, val) {
        this._data[key] = val;
        var listeners = this._listeners[key + 'Changed'] || [];
        for (var i = 0; i < listeners.length; i++) {
            listeners[i](val);
        }
    },
    on: function(event, fn) {
        if (!this._listeners[event]) this._listeners[event] = [];
        this._listeners[event].push(fn);
    },
    _reset: function() { this._data = {}; this._listeners = {}; }
};

// --- I18n mock ---
global.I18n = {
    t: function(key, params) {
        if (params) {
            var result = key;
            for (var p in params) {
                result = result.replace('{' + p + '}', params[p]);
            }
            return result;
        }
        return key;
    }
};

// --- UI mock ---
global.UI = {
    _loading: {},
    showLoading: function(id) { this._loading[id] = true; },
    hideLoading: function(id) { delete this._loading[id]; },
    createElement: function(tag, attrs) {
        var el = createElementMock(tag);
        if (attrs) {
            if (attrs.className) el.className = attrs.className;
            if (attrs.textContent) el.textContent = attrs.textContent;
            if (attrs.role) el.role = attrs.role;
            if (attrs.tabIndex !== undefined) el.tabIndex = attrs.tabIndex;
            if (attrs.dataset) {
                for (var k in attrs.dataset) {
                    el.dataset[k] = attrs.dataset[k];
                }
            }
        }
        return el;
    },
    toast: function() {}
};

// --- Helpers mock ---
global.Helpers = {
    debounce: function(fn) { return fn; }
};

// --- API mock ---
var apiCalls = [];
global.API = {
    _rawGetResult: null,
    _rawGetWithHeadersResult: null,
    _getResults: {},
    rawGet: function(path, options) {
        apiCalls.push({ method: 'rawGet', path: path });
        if (this._rawGetResult instanceof Error) {
            return Promise.reject(this._rawGetResult);
        }
        return Promise.resolve(this._rawGetResult);
    },
    rawGetWithHeaders: function(path, options) {
        apiCalls.push({ method: 'rawGetWithHeaders', path: path });
        if (this._rawGetWithHeadersResult instanceof Error) {
            return Promise.reject(this._rawGetWithHeadersResult);
        }
        return Promise.resolve(this._rawGetWithHeadersResult);
    },
    get: function(path, options) {
        apiCalls.push({ method: 'get', path: path });
        var result = this._getResults[path];
        if (result instanceof Error) return Promise.reject(result);
        return Promise.resolve(result || {});
    },
    _reset: function() {
        this._rawGetResult = null;
        this._rawGetWithHeadersResult = null;
        this._getResults = {};
        apiCalls = [];
    }
};

// --- AbortController polyfill for Node < 16 ---
if (typeof AbortController === 'undefined') {
    global.AbortController = class {
        constructor() {
            this.signal = { aborted: false };
        }
        abort() {
            this.signal.aborted = true;
        }
    };
}

// Load Domains module
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var domainsCode = fs.readFileSync(path.join(__dirname, '..', 'js', 'domains.js'), 'utf8');
vm.runInThisContext(domainsCode, { filename: 'domains.js' });


// ---------------------------------------------------------------
// Regression: DOM list cleared on fetchDomains (duplicate bug)
// ---------------------------------------------------------------
describe('Domains.fetchDomains — DOM list clearing (regression)', function() {

    beforeEach(function() {
        State._reset();
        API._reset();

        // Build mock DOM elements
        domElements = {};
        domElements['domain-dropdown-list'] = createElementMock('ul');
        domElements['domain-count'] = createElementMock('span');
        domElements['domain-search-input'] = createElementMock('input');
        domElements['domain-bar'] = createElementMock('div');
    });

    it('should clear DOM list when fetchDomains is called', function() {
        var listEl = domElements['domain-dropdown-list'];

        // Pre-populate DOM with stale items (simulate previous load)
        var staleItem1 = createElementMock('li');
        staleItem1.dataset.domain = 'old1.com';
        var staleItem2 = createElementMock('li');
        staleItem2.dataset.domain = 'old2.com';
        listEl.appendChild(staleItem1);
        listEl.appendChild(staleItem2);

        assert.equal(listEl.childNodes.length, 2, 'should have 2 stale items before');

        // Call fetchDomains — it should clear the DOM list
        Domains.fetchDomains({ data: [], headers: { totalCount: 0, link: null } });

        assert.equal(listEl.childNodes.length, 0, 'DOM list must be empty after fetchDomains reset');
    });

    it('should not produce duplicate DOM items on successive fetchDomains calls', async function() {
        var listEl = domElements['domain-dropdown-list'];

        // Mock tokeninfo (all domains accessible via sharing_id)
        API._rawGetResult = {
            sharing_id: 'org-123',
            entities: [{ id: 'org-123' }]
        };

        var firstPageResult = {
            data: [
                { fqdn: 'a.com', id: 'dom-1' },
                { fqdn: 'b.com', id: 'dom-2' }
            ],
            headers: { totalCount: 2, link: null }
        };

        // First call
        Domains.fetchDomains(firstPageResult);
        // Wait for async fetchDomainsProgressively to finish
        await new Promise(function(r) { setTimeout(r, 50); });

        assert.equal(listEl.childNodes.length, 2, 'should have 2 items after first load');

        // Second call (e.g. reconnect)
        Domains.fetchDomains(firstPageResult);
        await new Promise(function(r) { setTimeout(r, 50); });

        assert.equal(listEl.childNodes.length, 2, 'should still have 2 items, not 4 (no duplicates)');
    });

    it('should show correct domain count after successive loads', async function() {
        API._rawGetResult = {
            sharing_id: 'org-123',
            entities: [{ id: 'org-123' }]
        };

        var firstPageResult = {
            data: [
                { fqdn: 'x.com', id: 'd1' },
                { fqdn: 'y.com', id: 'd2' },
                { fqdn: 'z.com', id: 'd3' }
            ],
            headers: { totalCount: 3, link: null }
        };

        Domains.fetchDomains(firstPageResult);
        await new Promise(function(r) { setTimeout(r, 50); });

        var domains = State.get('domains');
        assert.equal(domains.length, 3, 'state should have 3 domains');

        var listEl = domElements['domain-dropdown-list'];
        assert.equal(listEl.childNodes.length, 3, 'DOM should have 3 items');
    });
});


// ---------------------------------------------------------------
// filterByEntities — entity matching logic
// ---------------------------------------------------------------
describe('Domains — filterByEntities logic (via fetchDomainsProgressively)', function() {

    beforeEach(function() {
        State._reset();
        API._reset();
        domElements = {};
        domElements['domain-dropdown-list'] = createElementMock('ul');
        domElements['domain-count'] = createElementMock('span');
        domElements['domain-search-input'] = createElementMock('input');
        domElements['domain-bar'] = createElementMock('div');
    });

    it('should include all domains when sharing_id is in entities', async function() {
        API._rawGetResult = {
            sharing_id: 'org-abc',
            entities: [{ id: 'org-abc' }, { id: 'dom-1' }]
        };

        var firstPage = {
            data: [
                { fqdn: 'a.com', id: 'dom-1' },
                { fqdn: 'b.com', id: 'dom-2' },
                { fqdn: 'c.com', id: 'dom-3' }
            ],
            headers: { totalCount: 3, link: null }
        };

        Domains.fetchDomains(firstPage);
        await new Promise(function(r) { setTimeout(r, 50); });

        var domains = State.get('domains');
        assert.equal(domains.length, 3, 'all 3 domains should be accessible (org-level access)');
    });

    it('should filter domains by individual entity ID matching', async function() {
        API._rawGetResult = {
            sharing_id: 'org-abc',
            entities: [{ id: 'dom-1' }, { id: 'dom-3' }]
        };

        var firstPage = {
            data: [
                { fqdn: 'a.com', id: 'dom-1' },
                { fqdn: 'b.com', id: 'dom-2' },
                { fqdn: 'c.com', id: 'dom-3' },
                { fqdn: 'd.com', id: 'dom-4' }
            ],
            headers: { totalCount: 4, link: null }
        };

        Domains.fetchDomains(firstPage);
        await new Promise(function(r) { setTimeout(r, 50); });

        var domains = State.get('domains');
        assert.equal(domains.length, 2, 'only 2 of 4 domains should be accessible');
        assert.equal(domains[0].fqdn, 'a.com');
        assert.equal(domains[1].fqdn, 'c.com');
    });

    it('should fall back to batch check when tokeninfo fails', async function() {
        // Tokeninfo fails
        API._rawGetResult = new Error('tokeninfo unavailable');

        // Batch check: only dom-1 succeeds
        API._getResults = {
            '/domains/a.com': { fqdn: 'a.com' },
            '/domains/b.com': new Error('403')
        };

        var firstPage = {
            data: [
                { fqdn: 'a.com', id: 'dom-1' },
                { fqdn: 'b.com', id: 'dom-2' }
            ],
            headers: { totalCount: 2, link: null }
        };

        Domains.fetchDomains(firstPage);
        await new Promise(function(r) { setTimeout(r, 100); });

        var domains = State.get('domains');
        assert.equal(domains.length, 1, 'fallback should filter to 1 accessible domain');
        assert.equal(domains[0].fqdn, 'a.com');
    });
});


// ---------------------------------------------------------------
// cancelLoading — abort behaviour
// ---------------------------------------------------------------
describe('Domains.cancelLoading', function() {

    beforeEach(function() {
        State._reset();
        API._reset();
        domElements = {};
        domElements['domain-dropdown-list'] = createElementMock('ul');
        domElements['domain-count'] = createElementMock('span');
        domElements['domain-search-input'] = createElementMock('input');
        domElements['domain-bar'] = createElementMock('div');
    });

    it('should stop in-progress loading without error', function() {
        // Start loading (creates AbortController internally)
        Domains.fetchDomains({ data: [], headers: { totalCount: 0, link: null } });

        // Cancel should not throw
        assert.doesNotThrow(function() {
            Domains.cancelLoading();
        });
    });

    it('should be safe to call cancelLoading when nothing is loading', function() {
        assert.doesNotThrow(function() {
            Domains.cancelLoading();
            Domains.cancelLoading();
        });
    });
});


// ---------------------------------------------------------------
// updateDomainCount — badge text
// ---------------------------------------------------------------
describe('Domains — domain count badge', function() {

    beforeEach(function() {
        State._reset();
        API._reset();
        domElements = {};
        domElements['domain-dropdown-list'] = createElementMock('ul');
        domElements['domain-count'] = createElementMock('span');
        domElements['domain-search-input'] = createElementMock('input');
        domElements['domain-bar'] = createElementMock('div');
    });

    it('should show loading text in badge during load', function() {
        Domains.fetchDomains({ data: [], headers: { totalCount: 0, link: null } });

        var countEl = domElements['domain-count'];
        // fetchDomains sets badge to 'domain.loading' key
        assert.equal(countEl.textContent, 'domain.loading');
    });

    it('should show final count after load completes', async function() {
        API._rawGetResult = {
            sharing_id: 'org-1',
            entities: [{ id: 'org-1' }]
        };

        Domains.fetchDomains({
            data: [{ fqdn: 'a.com', id: 'd1' }, { fqdn: 'b.com', id: 'd2' }],
            headers: { totalCount: 2, link: null }
        });
        await new Promise(function(r) { setTimeout(r, 50); });

        var countEl = domElements['domain-count'];
        // After loading, badge should use non-loading key (no "Loading" suffix)
        assert.ok(
            countEl.textContent === 'domain.countPlural' || countEl.textContent === 'domain.count',
            'badge should use final (non-loading) i18n key, got: ' + countEl.textContent
        );
        assert.ok(
            countEl.textContent.indexOf('Loading') === -1,
            'badge should not contain "Loading" suffix'
        );
    });
});


// ---------------------------------------------------------------
// appendDomainsToDropdown — incremental add
// ---------------------------------------------------------------
describe('Domains — appendDomainsToDropdown (via fetchDomains)', function() {

    beforeEach(function() {
        State._reset();
        API._reset();
        domElements = {};
        domElements['domain-dropdown-list'] = createElementMock('ul');
        domElements['domain-count'] = createElementMock('span');
        domElements['domain-search-input'] = createElementMock('input');
        domElements['domain-bar'] = createElementMock('div');
    });

    it('should create correct data-domain attributes on items', async function() {
        API._rawGetResult = {
            sharing_id: 'org-1',
            entities: [{ id: 'org-1' }]
        };

        Domains.fetchDomains({
            data: [{ fqdn: 'example.org', id: 'd1' }],
            headers: { totalCount: 1, link: null }
        });
        await new Promise(function(r) { setTimeout(r, 50); });

        var listEl = domElements['domain-dropdown-list'];
        assert.equal(listEl.childNodes.length, 1);
        assert.equal(listEl.childNodes[0].dataset.domain, 'example.org');
    });

    it('should auto-select first domain', async function() {
        API._rawGetResult = {
            sharing_id: 'org-1',
            entities: [{ id: 'org-1' }]
        };

        Domains.fetchDomains({
            data: [{ fqdn: 'first.com', id: 'd1' }, { fqdn: 'second.com', id: 'd2' }],
            headers: { totalCount: 2, link: null }
        });
        await new Promise(function(r) { setTimeout(r, 50); });

        assert.equal(State.get('currentDomain'), 'first.com', 'first accessible domain should be auto-selected');
    });
});
