/**
 * Tests for the State module.
 * Run with: node --test src/test/test-state.js
 */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// Minimal storage mock
function createStorageMock() {
    var data = {};
    return {
        getItem: function(key) { return data[key] || null; },
        setItem: function(key, val) { data[key] = String(val); },
        removeItem: function(key) { delete data[key]; },
        clear: function() { data = {}; },
        _data: function() { return data; }
    };
}

// Mock browser storage globals
global.sessionStorage = createStorageMock();
global.localStorage = createStorageMock();

// Load State module — use vm.runInThisContext so top-level const becomes global
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var stateCode = fs.readFileSync(path.join(__dirname, '..', 'js', 'state.js'), 'utf8');
vm.runInThisContext(stateCode, { filename: 'state.js' });

describe('State', function() {

    beforeEach(function() {
        // Reset storage
        sessionStorage.clear();
        localStorage.clear();
        // Re-initialize state
        State.init();
        // Remove all listeners (brute-force via init re-registration)
    });

    describe('get/set', function() {

        it('should return default values after init', function() {
            assert.equal(State.get('token'), null);
            assert.equal(State.get('storageMode'), 'session');
            assert.equal(State.get('currentDomain'), null);
            assert.deepEqual(State.get('domains'), []);
            assert.deepEqual(State.get('records'), []);
            assert.equal(State.get('activeTab'), 'records');
            assert.equal(State.get('theme'), 'dark');
        });

        it('should store and retrieve values', function() {
            State.set('currentDomain', 'example.com');
            assert.equal(State.get('currentDomain'), 'example.com');
        });

        it('should store arrays', function() {
            var domains = [{ fqdn: 'a.com' }, { fqdn: 'b.com' }];
            State.set('domains', domains);
            assert.deepEqual(State.get('domains'), domains);
        });

        it('should return undefined for unknown keys', function() {
            assert.equal(State.get('nonexistent'), undefined);
        });
    });

    describe('events', function() {

        it('should emit Changed event when value changes', function() {
            var called = false;
            var receivedNew, receivedOld;
            State.on('currentDomainChanged', function(newVal, oldVal) {
                called = true;
                receivedNew = newVal;
                receivedOld = oldVal;
            });
            State.set('currentDomain', 'test.com');
            assert.equal(called, true);
            assert.equal(receivedNew, 'test.com');
            assert.equal(receivedOld, null);
        });

        it('should not emit when primitive value is the same', function() {
            State.set('activeTab', 'records');
            var called = false;
            State.on('activeTabChanged', function() { called = true; });
            State.set('activeTab', 'records'); // same value
            assert.equal(called, false);
        });

        it('should always emit for object/array values', function() {
            var callCount = 0;
            State.on('domainsChanged', function() { callCount++; });
            State.set('domains', []);
            State.set('domains', []);
            assert.equal(callCount, 2);
        });

        it('should support multiple listeners', function() {
            var calls = [];
            State.on('themeChanged', function() { calls.push('a'); });
            State.on('themeChanged', function() { calls.push('b'); });
            State.set('theme', 'light');
            assert.deepEqual(calls, ['a', 'b']);
        });

        it('should support off() to remove a listener', function() {
            var called = false;
            var listener = function() { called = true; };
            State.on('loadingChanged', listener);
            State.off('loadingChanged', listener);
            State.set('loading', true);
            assert.equal(called, false);
        });

        it('should support off() without callback to remove all', function() {
            var called = false;
            State.on('errorChanged', function() { called = true; });
            State.off('errorChanged');
            State.set('error', 'test');
            assert.equal(called, false);
        });

        it('should catch listener errors without breaking other listeners', function() {
            var secondCalled = false;
            State.on('loadingChanged', function() {
                throw new Error('listener error');
            });
            State.on('loadingChanged', function() {
                secondCalled = true;
            });

            // Suppress console.error during this test
            var origError = console.error;
            console.error = function() {};
            State.set('loading', true);
            console.error = origError;

            assert.equal(secondCalled, true);
        });
    });

    describe('token persistence', function() {

        it('should persist token to sessionStorage by default', function() {
            State.set('token', 'test-token-123');
            assert.equal(sessionStorage.getItem('gandi_pat'), 'test-token-123');
            assert.equal(localStorage.getItem('gandi_pat'), null);
        });

        it('should persist token to localStorage when mode is local', function() {
            State.set('storageMode', 'local');
            State.set('token', 'test-token-456');
            assert.equal(localStorage.getItem('gandi_pat'), 'test-token-456');
            assert.equal(sessionStorage.getItem('gandi_pat'), null);
        });

        it('should clear token from storage when set to null', function() {
            State.set('token', 'test-token');
            assert.equal(sessionStorage.getItem('gandi_pat'), 'test-token');
            State.set('token', null);
            assert.equal(sessionStorage.getItem('gandi_pat'), null);
        });

        it('should restore token from sessionStorage on init', function() {
            sessionStorage.setItem('gandi_pat', 'restored-session-token');
            State.init();
            assert.equal(State.get('token'), 'restored-session-token');
            assert.equal(State.get('storageMode'), 'session');
        });

        it('should restore token from localStorage on init', function() {
            localStorage.setItem('gandi_pat', 'restored-local-token');
            State.init();
            assert.equal(State.get('token'), 'restored-local-token');
            assert.equal(State.get('storageMode'), 'local');
        });

        it('should prefer sessionStorage over localStorage', function() {
            sessionStorage.setItem('gandi_pat', 'session-token');
            localStorage.setItem('gandi_pat', 'local-token');
            State.init();
            assert.equal(State.get('token'), 'session-token');
            assert.equal(State.get('storageMode'), 'session');
        });
    });

    describe('theme persistence', function() {

        it('should persist theme to localStorage', function() {
            State.set('theme', 'light');
            assert.equal(localStorage.getItem('gandi_theme'), 'light');
        });

        it('should restore theme from localStorage on init', function() {
            localStorage.setItem('gandi_theme', 'light');
            State.init();
            assert.equal(State.get('theme'), 'light');
        });

        it('should ignore invalid saved theme', function() {
            localStorage.setItem('gandi_theme', 'invalid');
            State.init();
            assert.equal(State.get('theme'), 'dark');
        });
    });
});
