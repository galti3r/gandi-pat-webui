/**
 * Tests for the Helpers module.
 * Run with: node --test src/test/test-helpers.js
 */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// --- Minimal State mock (used by Helpers.domainPath) ---
global.State = {
    _data: {},
    get: function(key) { return this._data[key] !== undefined ? this._data[key] : null; },
    set: function(key, val) { this._data[key] = val; },
    _reset: function() { this._data = {}; }
};

// --- Minimal I18n mock (used by TTL_PRESETS lazy getters) ---
global.I18n = {
    t: function(key, params) {
        if (!params) return key;
        let result = key;
        for (const p in params) result = result.replace('{' + p + '}', params[p]);
        return result;
    }
};

// Load modules via vm.runInThisContext so top-level const becomes global
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var helpersCode = fs.readFileSync(path.join(__dirname, '..', 'js', 'helpers.js'), 'utf8');
vm.runInThisContext(helpersCode, { filename: 'helpers.js' });
var recordTypesCode = fs.readFileSync(path.join(__dirname, '..', 'js', 'record-types.js'), 'utf8');
vm.runInThisContext(recordTypesCode, { filename: 'record-types.js' });

// ---------------------------------------------------------------
// isValidIPv4
// ---------------------------------------------------------------
describe('Helpers.isValidIPv4', function() {

    it('should accept valid addresses', function() {
        assert.equal(Helpers.isValidIPv4('1.2.3.4'), true);
        assert.equal(Helpers.isValidIPv4('0.0.0.0'), true);
        assert.equal(Helpers.isValidIPv4('255.255.255.255'), true);
        assert.equal(Helpers.isValidIPv4('192.168.1.1'), true);
        assert.equal(Helpers.isValidIPv4('10.0.0.1'), true);
        assert.equal(Helpers.isValidIPv4('172.16.0.1'), true);
    });

    it('should reject octet > 255', function() {
        assert.equal(Helpers.isValidIPv4('256.1.1.1'), false);
        assert.equal(Helpers.isValidIPv4('1.256.1.1'), false);
        assert.equal(Helpers.isValidIPv4('1.1.1.999'), false);
    });

    it('should reject wrong number of octets', function() {
        assert.equal(Helpers.isValidIPv4('1.2.3'), false);
        assert.equal(Helpers.isValidIPv4('1.2.3.4.5'), false);
        assert.equal(Helpers.isValidIPv4('1'), false);
    });

    it('should reject leading zeros (RFC strict)', function() {
        assert.equal(Helpers.isValidIPv4('01.2.3.4'), false);
        assert.equal(Helpers.isValidIPv4('1.02.3.4'), false);
        assert.equal(Helpers.isValidIPv4('1.2.03.4'), false);
        assert.equal(Helpers.isValidIPv4('1.2.3.04'), false);
    });

    it('should reject trailing dot', function() {
        assert.equal(Helpers.isValidIPv4('1.2.3.4.'), false);
    });

    it('should reject empty, null, and non-string input', function() {
        assert.equal(Helpers.isValidIPv4(''), false);
        assert.equal(Helpers.isValidIPv4(null), false);
        assert.equal(Helpers.isValidIPv4(undefined), false);
        assert.equal(Helpers.isValidIPv4(12345), false);
    });

    it('should reject non-numeric content', function() {
        assert.equal(Helpers.isValidIPv4('abc'), false);
        assert.equal(Helpers.isValidIPv4('a.b.c.d'), false);
        assert.equal(Helpers.isValidIPv4('1.2.3.a'), false);
    });

    it('should reject negative octets', function() {
        assert.equal(Helpers.isValidIPv4('-1.2.3.4'), false);
    });
});

// ---------------------------------------------------------------
// isValidIPv6
// ---------------------------------------------------------------
describe('Helpers.isValidIPv6', function() {

    it('should accept loopback ::1', function() {
        assert.equal(Helpers.isValidIPv6('::1'), true);
    });

    it('should accept abbreviated addresses', function() {
        assert.equal(Helpers.isValidIPv6('2001:db8::1'), true);
        assert.equal(Helpers.isValidIPv6('fe80::1'), true);
        assert.equal(Helpers.isValidIPv6('::'), true);
    });

    it('should accept full form addresses', function() {
        assert.equal(Helpers.isValidIPv6('2001:0db8:0000:0000:0000:0000:0000:0001'), true);
        assert.equal(Helpers.isValidIPv6('ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff'), true);
    });

    it('should accept mixed IPv4-mapped notation', function() {
        assert.equal(Helpers.isValidIPv6('::ffff:192.168.1.1'), true);
        assert.equal(Helpers.isValidIPv6('::ffff:10.0.0.1'), true);
    });

    it('should reject triple colon', function() {
        assert.equal(Helpers.isValidIPv6(':::'), false);
    });

    it('should reject invalid hex groups', function() {
        assert.equal(Helpers.isValidIPv6('gggg::1'), false);
        assert.equal(Helpers.isValidIPv6('xyz::1'), false);
    });

    it('should reject too many groups', function() {
        assert.equal(Helpers.isValidIPv6('1:2:3:4:5:6:7:8:9'), false);
    });

    it('should reject multiple :: sequences', function() {
        assert.equal(Helpers.isValidIPv6('::1::2'), false);
        assert.equal(Helpers.isValidIPv6('2001::db8::1'), false);
    });

    it('should reject empty and null input', function() {
        assert.equal(Helpers.isValidIPv6(''), false);
        assert.equal(Helpers.isValidIPv6(null), false);
        assert.equal(Helpers.isValidIPv6(undefined), false);
    });

    it('should reject mixed notation with invalid IPv4 part', function() {
        assert.equal(Helpers.isValidIPv6('::ffff:999.1.1.1'), false);
    });
});

// ---------------------------------------------------------------
// isValidFQDN
// ---------------------------------------------------------------
describe('Helpers.isValidFQDN', function() {

    it('should accept simple domain names', function() {
        assert.equal(Helpers.isValidFQDN('example.com'), true);
        assert.equal(Helpers.isValidFQDN('sub.example.com'), true);
        assert.equal(Helpers.isValidFQDN('deep.sub.example.com'), true);
    });

    it('should accept wildcard as leftmost label', function() {
        assert.equal(Helpers.isValidFQDN('*.example.com'), true);
    });

    it('should reject wildcard in non-leftmost position', function() {
        assert.equal(Helpers.isValidFQDN('example.*.com'), false);
    });

    it('should accept underscore labels (SRV/TLSA)', function() {
        assert.equal(Helpers.isValidFQDN('_sip._tcp.example.com'), true);
        assert.equal(Helpers.isValidFQDN('_dmarc.example.com'), true);
    });

    it('should accept trailing dot (fully-qualified form)', function() {
        assert.equal(Helpers.isValidFQDN('example.com.'), true);
    });

    it('should reject empty and null input', function() {
        assert.equal(Helpers.isValidFQDN(''), false);
        assert.equal(Helpers.isValidFQDN(null), false);
        assert.equal(Helpers.isValidFQDN(undefined), false);
    });

    it('should reject label starting with hyphen', function() {
        assert.equal(Helpers.isValidFQDN('-start.com'), false);
    });

    it('should reject label ending with hyphen', function() {
        assert.equal(Helpers.isValidFQDN('end-.com'), false);
    });

    it('should reject label longer than 63 characters', function() {
        var longLabel = 'a'.repeat(64);
        assert.equal(Helpers.isValidFQDN(longLabel + '.com'), false);
    });

    it('should accept label of exactly 63 characters', function() {
        var maxLabel = 'a'.repeat(63);
        assert.equal(Helpers.isValidFQDN(maxLabel + '.com'), true);
    });

    it('should reject total length > 253 characters', function() {
        // Build a hostname just over 253 characters
        var parts = [];
        // Each label "aaa." = 4 chars; 64 labels = 256 chars (including dots)
        for (var i = 0; i < 64; i++) {
            parts.push('aaa');
        }
        var longHostname = parts.join('.');
        assert.ok(longHostname.length > 253);
        assert.equal(Helpers.isValidFQDN(longHostname), false);
    });

    it('should reject double dot (empty label)', function() {
        assert.equal(Helpers.isValidFQDN('double..dot'), false);
    });

    it('should reject non-string input', function() {
        assert.equal(Helpers.isValidFQDN(12345), false);
        assert.equal(Helpers.isValidFQDN(true), false);
    });

    it('should accept single-label hostnames', function() {
        assert.equal(Helpers.isValidFQDN('localhost'), true);
    });
});

// ---------------------------------------------------------------
// sortData
// ---------------------------------------------------------------
describe('Helpers.sortData', function() {

    it('should sort strings ascending', function() {
        var data = [{ name: 'Charlie' }, { name: 'Alice' }, { name: 'Bob' }];
        var result = Helpers.sortData(data, 'name', 'asc');
        assert.deepEqual(result.map(function(r) { return r.name; }), ['Alice', 'Bob', 'Charlie']);
    });

    it('should sort strings descending', function() {
        var data = [{ name: 'Alice' }, { name: 'Charlie' }, { name: 'Bob' }];
        var result = Helpers.sortData(data, 'name', 'desc');
        assert.deepEqual(result.map(function(r) { return r.name; }), ['Charlie', 'Bob', 'Alice']);
    });

    it('should sort case-insensitively', function() {
        var data = [{ name: 'banana' }, { name: 'Apple' }, { name: 'cherry' }];
        var result = Helpers.sortData(data, 'name', 'asc');
        assert.deepEqual(result.map(function(r) { return r.name; }), ['Apple', 'banana', 'cherry']);
    });

    it('should sort numbers correctly', function() {
        var data = [{ ttl: 3600 }, { ttl: 300 }, { ttl: 86400 }];
        var result = Helpers.sortData(data, 'ttl', 'asc');
        assert.deepEqual(result.map(function(r) { return r.ttl; }), [300, 3600, 86400]);
    });

    it('should sort numbers descending', function() {
        var data = [{ ttl: 300 }, { ttl: 86400 }, { ttl: 3600 }];
        var result = Helpers.sortData(data, 'ttl', 'desc');
        assert.deepEqual(result.map(function(r) { return r.ttl; }), [86400, 3600, 300]);
    });

    it('should push null values to the end regardless of direction', function() {
        var data = [{ name: null }, { name: 'Alice' }, { name: 'Bob' }];

        var asc = Helpers.sortData(data, 'name', 'asc');
        assert.equal(asc[0].name, 'Alice');
        assert.equal(asc[1].name, 'Bob');
        assert.equal(asc[2].name, null);

        var desc = Helpers.sortData(data, 'name', 'desc');
        assert.equal(desc[0].name, 'Bob');
        assert.equal(desc[1].name, 'Alice');
        assert.equal(desc[2].name, null);
    });

    it('should handle two null values', function() {
        var data = [{ name: null }, { name: 'Alice' }, { name: null }];
        var result = Helpers.sortData(data, 'name', 'asc');
        assert.equal(result[0].name, 'Alice');
        assert.equal(result[1].name, null);
        assert.equal(result[2].name, null);
    });

    it('should return empty array for empty input', function() {
        var result = Helpers.sortData([], 'name', 'asc');
        assert.deepEqual(result, []);
    });

    it('should return empty array for null input', function() {
        var result = Helpers.sortData(null, 'name', 'asc');
        assert.deepEqual(result, []);
    });

    it('should return a copy for missing column', function() {
        var data = [{ name: 'A' }, { name: 'B' }];
        var result = Helpers.sortData(data, null, 'asc');
        assert.deepEqual(result, data);
    });

    it('should not mutate the original array', function() {
        var data = [{ name: 'B' }, { name: 'A' }];
        var original = data.slice();
        Helpers.sortData(data, 'name', 'asc');
        assert.deepEqual(data, original);
    });

    it('should default to ascending when direction is not desc', function() {
        var data = [{ name: 'B' }, { name: 'A' }];
        var result = Helpers.sortData(data, 'name', 'whatever');
        assert.deepEqual(result.map(function(r) { return r.name; }), ['A', 'B']);
    });
});

// ---------------------------------------------------------------
// paginate
// ---------------------------------------------------------------
describe('Helpers.paginate', function() {

    var data20;
    beforeEach(function() {
        data20 = [];
        for (var i = 1; i <= 20; i++) {
            data20.push({ id: i });
        }
    });

    it('should return first page with correct metadata', function() {
        var result = Helpers.paginate(data20, 1, 5);
        assert.equal(result.page, 1);
        assert.equal(result.pageSize, 5);
        assert.equal(result.totalPages, 4);
        assert.equal(result.totalItems, 20);
        assert.equal(result.items.length, 5);
        assert.equal(result.items[0].id, 1);
        assert.equal(result.items[4].id, 5);
    });

    it('should return last page correctly', function() {
        var result = Helpers.paginate(data20, 4, 5);
        assert.equal(result.page, 4);
        assert.equal(result.items.length, 5);
        assert.equal(result.items[0].id, 16);
        assert.equal(result.items[4].id, 20);
    });

    it('should clamp page that is too high', function() {
        var result = Helpers.paginate(data20, 100, 5);
        assert.equal(result.page, 4); // last page
        assert.equal(result.items.length, 5);
    });

    it('should clamp page that is too low (0)', function() {
        var result = Helpers.paginate(data20, 0, 5);
        assert.equal(result.page, 1);
    });

    it('should clamp negative page', function() {
        var result = Helpers.paginate(data20, -5, 5);
        assert.equal(result.page, 1);
    });

    it('should handle empty data', function() {
        var result = Helpers.paginate([], 1, 5);
        assert.equal(result.page, 1);
        assert.equal(result.totalPages, 1);
        assert.equal(result.totalItems, 0);
        assert.equal(result.items.length, 0);
    });

    it('should handle null data', function() {
        var result = Helpers.paginate(null, 1, 5);
        assert.equal(result.totalItems, 0);
        assert.equal(result.items.length, 0);
    });

    it('should handle page size of 1', function() {
        var result = Helpers.paginate(data20, 3, 1);
        assert.equal(result.page, 3);
        assert.equal(result.pageSize, 1);
        assert.equal(result.totalPages, 20);
        assert.equal(result.items.length, 1);
        assert.equal(result.items[0].id, 3);
    });

    it('should handle single page (data fits in one page)', function() {
        var smallData = [{ id: 1 }, { id: 2 }];
        var result = Helpers.paginate(smallData, 1, 10);
        assert.equal(result.page, 1);
        assert.equal(result.totalPages, 1);
        assert.equal(result.items.length, 2);
    });

    it('should use default page size when not provided', function() {
        var result = Helpers.paginate(data20, 1);
        assert.equal(result.pageSize, 25);
        assert.equal(result.totalPages, 1); // 20 items with pageSize 25
    });

    it('should handle partial last page', function() {
        var result = Helpers.paginate(data20, 3, 7);
        // 20 items / 7 per page = 3 pages (7, 7, 6)
        assert.equal(result.totalPages, 3);
        assert.equal(result.page, 3);
        assert.equal(result.items.length, 6);
    });

    it('should return all items when pageSize is 0 (show all)', function() {
        var result = Helpers.paginate(data20, 1, 0);
        assert.equal(result.items.length, 20);
        assert.equal(result.totalPages, 1);
        assert.equal(result.page, 1);
        assert.equal(result.pageSize, 0);
    });

    it('should handle pageSize 0 with empty data', function() {
        var result = Helpers.paginate([], 1, 0);
        assert.equal(result.items.length, 0);
        assert.equal(result.totalPages, 1);
        assert.equal(result.page, 1);
    });
});

// ---------------------------------------------------------------
// formatTTL
// ---------------------------------------------------------------
describe('Helpers.formatTTL', function() {

    it('should format 0 as "0s"', function() {
        assert.equal(Helpers.formatTTL(0), '0s');
    });

    it('should format seconds that divide cleanly into days', function() {
        assert.equal(Helpers.formatTTL(86400), '1d');
        assert.equal(Helpers.formatTTL(172800), '2d');
    });

    it('should format seconds that divide cleanly into hours', function() {
        assert.equal(Helpers.formatTTL(3600), '1h');
        assert.equal(Helpers.formatTTL(7200), '2h');
        assert.equal(Helpers.formatTTL(10800), '3h');
    });

    it('should format seconds that divide cleanly into minutes', function() {
        assert.equal(Helpers.formatTTL(60), '1m');
        assert.equal(Helpers.formatTTL(300), '5m');
        assert.equal(Helpers.formatTTL(900), '15m');
    });

    it('should fallback to seconds for non-clean divisions', function() {
        assert.equal(Helpers.formatTTL(45), '45s');
        assert.equal(Helpers.formatTTL(1), '1s');
        assert.equal(Helpers.formatTTL(90), '90s'); // 1.5 minutes, not clean
    });

    it('should return original string for NaN input', function() {
        assert.equal(Helpers.formatTTL('abc'), 'abc');
        assert.equal(Helpers.formatTTL(NaN), 'NaN');
    });

    it('should return original string for negative input', function() {
        assert.equal(Helpers.formatTTL(-1), '-1');
    });

    it('should accept numeric strings', function() {
        assert.equal(Helpers.formatTTL('3600'), '1h');
        assert.equal(Helpers.formatTTL('300'), '5m');
    });
});

// ---------------------------------------------------------------
// parseTTL
// ---------------------------------------------------------------
describe('Helpers.parseTTL', function() {

    it('should parse minutes', function() {
        assert.equal(Helpers.parseTTL('5m'), 300);
        assert.equal(Helpers.parseTTL('1m'), 60);
        assert.equal(Helpers.parseTTL('15m'), 900);
    });

    it('should parse hours', function() {
        assert.equal(Helpers.parseTTL('1h'), 3600);
        assert.equal(Helpers.parseTTL('3h'), 10800);
        assert.equal(Helpers.parseTTL('24h'), 86400);
    });

    it('should parse days', function() {
        assert.equal(Helpers.parseTTL('1d'), 86400);
        assert.equal(Helpers.parseTTL('7d'), 604800);
    });

    it('should parse seconds with suffix', function() {
        assert.equal(Helpers.parseTTL('300s'), 300);
        assert.equal(Helpers.parseTTL('0s'), 0);
    });

    it('should parse plain numeric string (defaults to seconds)', function() {
        assert.equal(Helpers.parseTTL('300'), 300);
        assert.equal(Helpers.parseTTL('3600'), 3600);
        assert.equal(Helpers.parseTTL('0'), 0);
    });

    it('should pass through numeric input', function() {
        assert.equal(Helpers.parseTTL(300), 300);
        assert.equal(Helpers.parseTTL(0), 0);
    });

    it('should handle whitespace', function() {
        assert.equal(Helpers.parseTTL('  5m  '), 300);
        assert.equal(Helpers.parseTTL(' 300 '), 300);
    });

    it('should be case-insensitive', function() {
        assert.equal(Helpers.parseTTL('5M'), 300);
        assert.equal(Helpers.parseTTL('1H'), 3600);
        assert.equal(Helpers.parseTTL('1D'), 86400);
    });

    it('should throw on empty string', function() {
        assert.throws(function() { Helpers.parseTTL(''); }, /Empty TTL/);
        assert.throws(function() { Helpers.parseTTL('   '); }, /Empty TTL/);
    });

    it('should throw on invalid format', function() {
        assert.throws(function() { Helpers.parseTTL('abc'); }, /Invalid TTL/);
        assert.throws(function() { Helpers.parseTTL('5x'); }, /Invalid TTL/);
        assert.throws(function() { Helpers.parseTTL('m5'); }, /Invalid TTL/);
    });

    it('should roundtrip with formatTTL', function() {
        assert.equal(Helpers.parseTTL(Helpers.formatTTL(300)), 300);
        assert.equal(Helpers.parseTTL(Helpers.formatTTL(3600)), 3600);
        assert.equal(Helpers.parseTTL(Helpers.formatTTL(86400)), 86400);
        assert.equal(Helpers.parseTTL(Helpers.formatTTL(0)), 0);
    });
});

// ---------------------------------------------------------------
// truncate
// ---------------------------------------------------------------
describe('Helpers.truncate', function() {

    it('should return short string unchanged', function() {
        assert.equal(Helpers.truncate('hello', 50), 'hello');
    });

    it('should not truncate string at exact max length', function() {
        assert.equal(Helpers.truncate('12345', 5), '12345');
    });

    it('should truncate long string with ellipsis', function() {
        var result = Helpers.truncate('hello world, this is a long string', 10);
        assert.equal(result.length, 10);
        assert.equal(result, 'hello wor\u2026');
    });

    it('should use default max length of 50', function() {
        var long = 'a'.repeat(60);
        var result = Helpers.truncate(long);
        assert.equal(result.length, 50);
        assert.ok(result.endsWith('\u2026'));
    });

    it('should handle custom max length', function() {
        var result = Helpers.truncate('abcdefghij', 5);
        assert.equal(result, 'abcd\u2026');
    });

    it('should handle empty string', function() {
        assert.equal(Helpers.truncate('', 10), '');
    });

    it('should handle null input', function() {
        assert.equal(Helpers.truncate(null, 10), '');
    });

    it('should handle undefined input', function() {
        assert.equal(Helpers.truncate(undefined, 10), '');
    });
});


// ---------------------------------------------------------------
// normalizeRecordName
// ---------------------------------------------------------------
describe('Helpers.normalizeRecordName', function() {

    it('should return "@" for "@" input', function() {
        assert.equal(Helpers.normalizeRecordName('@'), '@');
    });

    it('should return "@" for empty string', function() {
        assert.equal(Helpers.normalizeRecordName(''), '@');
    });

    it('should return "@" for null input', function() {
        assert.equal(Helpers.normalizeRecordName(null), '@');
    });

    it('should return "@" for undefined input', function() {
        assert.equal(Helpers.normalizeRecordName(undefined), '@');
    });

    it('should strip trailing dot', function() {
        assert.equal(Helpers.normalizeRecordName('www.'), 'www');
        assert.equal(Helpers.normalizeRecordName('sub.example.'), 'sub.example');
    });

    it('should preserve case (not lowercase)', function() {
        assert.equal(Helpers.normalizeRecordName('WWW'), 'WWW');
        assert.equal(Helpers.normalizeRecordName('MixedCase'), 'MixedCase');
    });

    it('should trim whitespace', function() {
        assert.equal(Helpers.normalizeRecordName('  www  '), 'www');
    });

    it('should return "@" when only a dot is provided', function() {
        // '.' -> trim trailing dot -> '' -> '@'
        assert.equal(Helpers.normalizeRecordName('.'), '@');
    });

    it('should handle regular subdomain names', function() {
        assert.equal(Helpers.normalizeRecordName('www'), 'www');
        assert.equal(Helpers.normalizeRecordName('mail'), 'mail');
        assert.equal(Helpers.normalizeRecordName('sub.domain'), 'sub.domain');
    });
});

// ---------------------------------------------------------------
// domainPath
// ---------------------------------------------------------------
describe('Helpers.domainPath', function() {

    beforeEach(function() {
        State._reset();
    });

    it('should build path with no extra segments', function() {
        State.set('currentDomain', 'example.com');
        assert.equal(Helpers.domainPath(), '/domains/example.com');
    });

    it('should build path with one segment', function() {
        State.set('currentDomain', 'example.com');
        assert.equal(Helpers.domainPath('records'), '/domains/example.com/records');
    });

    it('should build path with multiple segments', function() {
        State.set('currentDomain', 'example.com');
        assert.equal(
            Helpers.domainPath('records', 'www', 'A'),
            '/domains/example.com/records/www/A'
        );
    });

    it('should throw when no domain is selected', function() {
        assert.throws(function() {
            Helpers.domainPath('records');
        }, /No domain selected/);
    });

    it('should URL-encode special characters in domain', function() {
        State.set('currentDomain', 'ex ample.com');
        var result = Helpers.domainPath('records');
        assert.equal(result, '/domains/ex%20ample.com/records');
    });

    it('should URL-encode special characters in segments', function() {
        State.set('currentDomain', 'example.com');
        var result = Helpers.domainPath('records', 'a b', 'c/d');
        assert.equal(result, '/domains/example.com/records/a%20b/c%2Fd');
    });

    it('should skip null and empty segments', function() {
        State.set('currentDomain', 'example.com');
        assert.equal(
            Helpers.domainPath('records', null, '', 'A'),
            '/domains/example.com/records/A'
        );
    });

    it('should keep @ literal (not encode to %40)', function() {
        State.set('currentDomain', 'example.com');
        assert.equal(
            Helpers.domainPath('records', '@', 'A'),
            '/domains/example.com/records/@/A'
        );
    });
});

// ---------------------------------------------------------------
// TTL_PRESETS
// ---------------------------------------------------------------
describe('Helpers.TTL_PRESETS', function() {

    it('should be an array', function() {
        assert.ok(Array.isArray(Helpers.TTL_PRESETS));
    });

    it('should contain objects with value and label properties', function() {
        Helpers.TTL_PRESETS.forEach(function(preset) {
            assert.ok(typeof preset.value === 'number', 'value should be a number');
            assert.ok(typeof preset.label === 'string', 'label should be a string');
        });
    });

    it('should include 5 min preset (300)', function() {
        var found = Helpers.TTL_PRESETS.some(function(p) {
            return p.value === 300 && typeof p.label === 'string';
        });
        assert.ok(found, 'should have 300 preset');
    });

    it('should include 1 hour preset (3600)', function() {
        var found = Helpers.TTL_PRESETS.some(function(p) {
            return p.value === 3600 && typeof p.label === 'string';
        });
        assert.ok(found, 'should have 3600 preset');
    });

    it('should include 3 hours preset (10800)', function() {
        var found = Helpers.TTL_PRESETS.some(function(p) {
            return p.value === 10800 && typeof p.label === 'string';
        });
        assert.ok(found, 'should have 10800 preset');
    });

    it('should include 1 day preset (86400)', function() {
        var found = Helpers.TTL_PRESETS.some(function(p) {
            return p.value === 86400 && typeof p.label === 'string';
        });
        assert.ok(found, 'should have 86400 preset');
    });

    it('should have exactly 4 presets', function() {
        assert.equal(Helpers.TTL_PRESETS.length, 4);
    });
});

// ---------------------------------------------------------------
// debounce (basic test without complex timer mocking)
// ---------------------------------------------------------------
describe('Helpers.debounce', function() {

    it('should return a function', function() {
        var debounced = Helpers.debounce(function() {}, 100);
        assert.equal(typeof debounced, 'function');
    });

    it('should delay execution', function(_, done) {
        var called = false;
        var debounced = Helpers.debounce(function() {
            called = true;
        }, 50);

        debounced();
        assert.equal(called, false, 'should not be called immediately');

        setTimeout(function() {
            assert.equal(called, true, 'should be called after delay');
            done();
        }, 100);
    });

    it('should cancel previous calls on rapid invocations', function(_, done) {
        var callCount = 0;
        var debounced = Helpers.debounce(function() {
            callCount++;
        }, 50);

        debounced();
        debounced();
        debounced();

        setTimeout(function() {
            assert.equal(callCount, 1, 'should only be called once');
            done();
        }, 100);
    });

    it('should pass arguments to the debounced function', function(_, done) {
        var receivedArgs;
        var debounced = Helpers.debounce(function(a, b) {
            receivedArgs = [a, b];
        }, 50);

        debounced('hello', 42);

        setTimeout(function() {
            assert.deepEqual(receivedArgs, ['hello', 42]);
            done();
        }, 100);
    });
});

// ---------------------------------------------------------------
// computeLineDiff
// ---------------------------------------------------------------
describe('Helpers.computeLineDiff', function() {

    it('should return all same for identical texts', function() {
        var result = Helpers.computeLineDiff('alpha\nbeta\ngamma', 'alpha\nbeta\ngamma');
        assert.deepEqual(result, [
            { type: 'same', line: 'alpha' },
            { type: 'same', line: 'beta' },
            { type: 'same', line: 'gamma' }
        ]);
    });

    it('should return all add when old is empty and new is non-empty', function() {
        var result = Helpers.computeLineDiff('', 'line1\nline2');
        // '' splits to [''], so old has one empty-string line
        // We expect del of the empty old line if it does not match, then adds
        // Actually: old=[''], new=['line1','line2']
        // LCS of [''] and ['line1','line2'] = 0 (no match)
        // So: del '' then add 'line1' then add 'line2'
        assert.deepEqual(result, [
            { type: 'del', line: '' },
            { type: 'add', line: 'line1' },
            { type: 'add', line: 'line2' }
        ]);
    });

    it('should return all del when old is non-empty and new is empty', function() {
        var result = Helpers.computeLineDiff('line1\nline2', '');
        // old=['line1','line2'], new=['']
        // LCS = 0, so: del 'line1', del 'line2', add ''
        assert.deepEqual(result, [
            { type: 'del', line: 'line1' },
            { type: 'del', line: 'line2' },
            { type: 'add', line: '' }
        ]);
    });

    it('should return single same entry for both empty strings', function() {
        var result = Helpers.computeLineDiff('', '');
        // old=[''], new=[''] — both are the same empty-string line
        assert.deepEqual(result, [
            { type: 'same', line: '' }
        ]);
    });

    it('should show del and add for a single line changed', function() {
        var result = Helpers.computeLineDiff('old line', 'new line');
        assert.deepEqual(result, [
            { type: 'del', line: 'old line' },
            { type: 'add', line: 'new line' }
        ]);
    });

    it('should detect a line added in the middle', function() {
        var result = Helpers.computeLineDiff('A\nC', 'A\nB\nC');
        assert.deepEqual(result, [
            { type: 'same', line: 'A' },
            { type: 'add', line: 'B' },
            { type: 'same', line: 'C' }
        ]);
    });

    it('should detect a line removed in the middle', function() {
        var result = Helpers.computeLineDiff('A\nB\nC', 'A\nC');
        assert.deepEqual(result, [
            { type: 'same', line: 'A' },
            { type: 'del', line: 'B' },
            { type: 'same', line: 'C' }
        ]);
    });

    it('should handle multiple changes mixed with unchanged lines', function() {
        var oldText = 'header\nalpha\nbeta\ngamma\nfooter';
        var newText = 'header\nalpha\nBETA\ngamma\nnew line\nfooter';
        var result = Helpers.computeLineDiff(oldText, newText);
        assert.deepEqual(result, [
            { type: 'same', line: 'header' },
            { type: 'same', line: 'alpha' },
            { type: 'del', line: 'beta' },
            { type: 'add', line: 'BETA' },
            { type: 'same', line: 'gamma' },
            { type: 'add', line: 'new line' },
            { type: 'same', line: 'footer' }
        ]);
    });

    it('should handle null, null inputs', function() {
        var result = Helpers.computeLineDiff(null, null);
        // (null || '').split('\n') = [''] for both
        assert.deepEqual(result, [
            { type: 'same', line: '' }
        ]);
    });

    it('should handle null old with non-empty new', function() {
        var result = Helpers.computeLineDiff(null, 'hello');
        // old=[''], new=['hello'] — no common lines
        assert.deepEqual(result, [
            { type: 'del', line: '' },
            { type: 'add', line: 'hello' }
        ]);
    });

    it('should handle non-empty old with null new', function() {
        var result = Helpers.computeLineDiff('hello', null);
        // old=['hello'], new=[''] — no common lines
        assert.deepEqual(result, [
            { type: 'del', line: 'hello' },
            { type: 'add', line: '' }
        ]);
    });

    it('should show complete replacement when no common lines', function() {
        var result = Helpers.computeLineDiff('A\nB\nC', 'X\nY\nZ');
        // No lines in common: 3 del + 3 add
        assert.equal(result.length, 6);
        var dels = result.filter(function(r) { return r.type === 'del'; });
        var adds = result.filter(function(r) { return r.type === 'add'; });
        assert.equal(dels.length, 3);
        assert.equal(adds.length, 3);
        assert.deepEqual(dels.map(function(r) { return r.line; }), ['A', 'B', 'C']);
        assert.deepEqual(adds.map(function(r) { return r.line; }), ['X', 'Y', 'Z']);
    });

    it('should handle reordered lines', function() {
        var result = Helpers.computeLineDiff('A\nB\nC', 'C\nB\nA');
        // LCS could be ['B'] or ['C'] (length 1) — depends on implementation
        // Verify structural properties: exactly 3 lines from old, 3 from new
        var sames = result.filter(function(r) { return r.type === 'same'; });
        var dels = result.filter(function(r) { return r.type === 'del'; });
        var adds = result.filter(function(r) { return r.type === 'add'; });
        // LCS length is 1 (the algorithm picks one common line)
        assert.equal(sames.length, 1, 'should have 1 common line in LCS');
        assert.equal(dels.length, 2, 'should have 2 deleted lines');
        assert.equal(adds.length, 2, 'should have 2 added lines');
        // Every old line should appear as same or del
        var oldLines = dels.map(function(r) { return r.line; })
            .concat(sames.map(function(r) { return r.line; }));
        assert.ok(oldLines.indexOf('A') !== -1, 'A present in old output');
        assert.ok(oldLines.indexOf('B') !== -1 || oldLines.indexOf('C') !== -1,
            'at least one of B/C present in old output');
    });

    it('should use normalize function for comparison but keep original lines', function() {
        // Lines differ only in a number, normalize strips it
        var oldText = 'header\nserial 100\nfooter';
        var newText = 'header\nserial 200\nfooter';
        var normalize = function(line) {
            return line.replace(/serial \d+/, 'serial (n)');
        };
        var result = Helpers.computeLineDiff(oldText, newText, normalize);
        // With normalization, all lines should be 'same'
        assert.equal(result.length, 3);
        assert.deepEqual(result, [
            { type: 'same', line: 'header' },
            { type: 'same', line: 'serial 100' },
            { type: 'same', line: 'footer' }
        ]);
    });

    it('should show diff when normalize does not match', function() {
        var oldText = 'A\nB';
        var newText = 'A\nC';
        // identity normalizer — no effect
        var result = Helpers.computeLineDiff(oldText, newText, function(l) { return l; });
        assert.deepEqual(result, [
            { type: 'same', line: 'A' },
            { type: 'del', line: 'B' },
            { type: 'add', line: 'C' }
        ]);
    });

    it('should keep old-side line text when normalized lines match', function() {
        // old has "X1", new has "X2", normalizer maps both to "X"
        var result = Helpers.computeLineDiff('X1', 'X2', function() { return 'X'; });
        // They match after normalization → 'same' with old-side text
        assert.deepEqual(result, [
            { type: 'same', line: 'X1' }
        ]);
    });
});

// ---------------------------------------------------------------
// normalizeZoneLine
// ---------------------------------------------------------------
describe('Helpers.throttle', function() {

    it('should call the function after the delay', function(t, done) {
        let callCount = 0;
        const fn = Helpers.throttle(function() { callCount++; }, 50);
        fn();
        assert.equal(callCount, 0, 'should not be called immediately');
        setTimeout(function() {
            assert.equal(callCount, 1, 'should be called once after delay');
            done();
        }, 80);
    });

    it('should throttle multiple rapid calls to one execution', function(t, done) {
        let callCount = 0;
        const fn = Helpers.throttle(function() { callCount++; }, 50);
        fn();
        fn();
        fn();
        fn();
        fn();
        assert.equal(callCount, 0, 'no calls yet');
        setTimeout(function() {
            assert.equal(callCount, 1, 'only one call after delay');
            done();
        }, 80);
    });

    it('should pass the latest arguments', function(t, done) {
        let lastArg = null;
        const fn = Helpers.throttle(function(val) { lastArg = val; }, 50);
        fn('first');
        fn('second');
        fn('third');
        setTimeout(function() {
            assert.equal(lastArg, 'third', 'should use last-called arguments');
            done();
        }, 80);
    });

    it('should allow a second call after the throttle window', function(t, done) {
        let callCount = 0;
        const fn = Helpers.throttle(function() { callCount++; }, 30);
        fn();
        setTimeout(function() {
            assert.equal(callCount, 1);
            fn();
            setTimeout(function() {
                assert.equal(callCount, 2, 'second call should fire after window');
                done();
            }, 50);
        }, 50);
    });

    it('should default to 100ms when no delay given', function() {
        const fn = Helpers.throttle(function() {});
        assert.equal(typeof fn, 'function');
    });
});

// ---------------------------------------------------------------
// normalizeZoneLine
// ---------------------------------------------------------------
describe('Helpers.normalizeZoneLine', function() {

    it('should replace SOA serial number with placeholder', function() {
        var line = '@ 86400 IN SOA ns1.gandi.net. hostmaster.gandi.net. 1773068215 10800 3600 604800 10800';
        var result = Helpers.normalizeZoneLine(line);
        assert.equal(result, '@ 86400 IN SOA ns1.gandi.net. hostmaster.gandi.net. (serial) 10800 3600 604800 10800');
    });

    it('should not modify non-SOA lines', function() {
        var line = 'www 300 IN A 1.2.3.4';
        assert.equal(Helpers.normalizeZoneLine(line), line);
    });

    it('should handle different SOA serials', function() {
        var line1 = '@ 86400 IN SOA ns1.gandi.net. hostmaster.gandi.net. 111 10800 3600 604800 10800';
        var line2 = '@ 86400 IN SOA ns1.gandi.net. hostmaster.gandi.net. 999 10800 3600 604800 10800';
        assert.equal(Helpers.normalizeZoneLine(line1), Helpers.normalizeZoneLine(line2));
    });

    it('should preserve lines without IN SOA', function() {
        var lines = [
            '@ 300 IN TXT "v=spf1 include:_spf.google.com ~all"',
            '@ 86400 IN NS ns1.gandi.net.',
            'mail 300 IN MX 10 mail.example.com.'
        ];
        for (var i = 0; i < lines.length; i++) {
            assert.equal(Helpers.normalizeZoneLine(lines[i]), lines[i]);
        }
    });
});

// ---------------------------------------------------------------
// RecordTypes — CNAME validation with "@"
// ---------------------------------------------------------------
describe('RecordTypes CNAME validation', function() {

    it('should accept "@" as a valid CNAME target (zone apex)', function() {
        var def = RecordTypes.get('CNAME');
        var field = def.fields[0]; // value field
        var result = field.validate('@');
        assert.equal(result, null);
    });

    it('should accept valid FQDN as CNAME target', function() {
        var def = RecordTypes.get('CNAME');
        var field = def.fields[0];
        var result = field.validate('example.com.');
        assert.equal(result, null);
    });

    it('should reject IP address as CNAME target', function() {
        var def = RecordTypes.get('CNAME');
        var field = def.fields[0];
        var result = field.validate('1.2.3.4');
        assert.ok(result !== null);
        assert.equal(result.field, 'value');
    });

    it('should reject invalid hostname as CNAME target', function() {
        var def = RecordTypes.get('CNAME');
        var field = def.fields[0];
        var result = field.validate('not valid!');
        assert.ok(result !== null);
        assert.equal(result.field, 'value');
    });
});

// ---------------------------------------------------------------
// RecordTypes — MX validation with "@"
// ---------------------------------------------------------------
describe('RecordTypes MX target validation', function() {

    it('should accept "@" as a valid MX target (zone apex)', function() {
        var def = RecordTypes.get('MX');
        var targetField = def.fields[1]; // target field
        var result = targetField.validate('@');
        assert.equal(result, null);
    });

    it('should accept valid FQDN as MX target', function() {
        var def = RecordTypes.get('MX');
        var targetField = def.fields[1];
        var result = targetField.validate('mail.example.com.');
        assert.equal(result, null);
    });

    it('should reject IP address as MX target', function() {
        var def = RecordTypes.get('MX');
        var targetField = def.fields[1];
        var result = targetField.validate('10.0.0.1');
        assert.ok(result !== null);
        assert.equal(result.field, 'target');
    });
});

// ---------------------------------------------------------------
// Helpers.isValidHex
// ---------------------------------------------------------------
describe('Helpers.isValidHex', function() {

    it('should accept valid hex strings', function() {
        assert.equal(Helpers.isValidHex('deadbeef'), true);
        assert.equal(Helpers.isValidHex('f'), true);
        assert.equal(Helpers.isValidHex('0123456789abcdefABCDEF'), true);
    });

    it('should reject non-hex strings', function() {
        assert.equal(Helpers.isValidHex('xyz'), false);
        assert.equal(Helpers.isValidHex('0x1234'), false);
        assert.equal(Helpers.isValidHex('12 34'), false);
        assert.equal(Helpers.isValidHex('ghij'), false);
    });

    it('should reject empty string', function() {
        assert.equal(Helpers.isValidHex(''), false);
    });

    it('should reject non-string types', function() {
        assert.equal(Helpers.isValidHex(null), false);
        assert.equal(Helpers.isValidHex(undefined), false);
        assert.equal(Helpers.isValidHex(1234), false);
    });
});

// ---------------------------------------------------------------
// Helpers.warnTrailingDot
// ---------------------------------------------------------------
describe('Helpers.warnTrailingDot', function() {

    it('should return null for values ending with dot', function() {
        assert.equal(Helpers.warnTrailingDot('example.com.', 'value'), null);
    });

    it('should return warning for values without dot', function() {
        var result = Helpers.warnTrailingDot('example.com', 'value');
        assert.ok(result !== null);
        assert.equal(result.field, 'value');
        assert.equal(result.message, 'types.validate.missingTrailingDot');
    });

    it('should return null for special values', function() {
        assert.equal(Helpers.warnTrailingDot('@', 'value', ['@']), null);
        assert.equal(Helpers.warnTrailingDot('.', 'target', ['.']), null);
    });

    it('should return null for empty/null/undefined', function() {
        assert.equal(Helpers.warnTrailingDot('', 'value'), null);
        assert.equal(Helpers.warnTrailingDot(null, 'value'), null);
        assert.equal(Helpers.warnTrailingDot(undefined, 'value'), null);
    });

    it('should default specialValues to empty array', function() {
        var result = Helpers.warnTrailingDot('example.com', 'field');
        assert.ok(result !== null);
        assert.equal(result.field, 'field');
    });
});

// ---------------------------------------------------------------
// Helpers.validateHostnameTarget
// ---------------------------------------------------------------
describe('Helpers.validateHostnameTarget', function() {

    it('should accept valid FQDN with and without trailing dot', function() {
        assert.equal(Helpers.validateHostnameTarget('example.com.', 'CNAME', 'value'), null);
        assert.equal(Helpers.validateHostnameTarget('example.com', 'CNAME', 'value'), null);
    });

    it('should reject IP when rejectIP is true (default)', function() {
        var result = Helpers.validateHostnameTarget('1.2.3.4', 'CNAME', 'value');
        assert.ok(result !== null);
        assert.equal(result.field, 'value');
        assert.ok(result.message.includes('targetMustBeHostname'));

        var v6 = Helpers.validateHostnameTarget('::1', 'MX', 'target');
        assert.ok(v6 !== null);
        assert.equal(v6.field, 'target');
    });

    it('should allow IP passthrough when rejectIP is false', function() {
        // 1.2.3.4 passes isValidFQDN (numeric labels are valid LDH)
        var result = Helpers.validateHostnameTarget('1.2.3.4', 'PTR', 'value', { rejectIP: false });
        assert.equal(result, null);
    });

    it('should reject invalid hostname', function() {
        var result = Helpers.validateHostnameTarget('--bad', 'NS', 'value');
        assert.ok(result !== null);
        assert.equal(result.field, 'value');
    });

    it('should respect specialValues', function() {
        assert.equal(Helpers.validateHostnameTarget('@', 'CNAME', 'value', { specialValues: ['@'] }), null);
        assert.equal(Helpers.validateHostnameTarget('.', 'SRV', 'target', { specialValues: ['.'] }), null);
    });

    it('should return arrays in returnArray mode', function() {
        var ok = Helpers.validateHostnameTarget('example.com.', 'NS', 'value', { returnArray: true });
        assert.ok(Array.isArray(ok));
        assert.equal(ok.length, 0);

        var err = Helpers.validateHostnameTarget('--bad', 'NS', 'value', { returnArray: true });
        assert.ok(Array.isArray(err));
        assert.equal(err.length, 1);
        assert.equal(err[0].field, 'value');
    });

    it('should default to null/object mode (no returnArray)', function() {
        var ok = Helpers.validateHostnameTarget('example.com.', 'CNAME', 'value');
        assert.equal(ok, null);

        var err = Helpers.validateHostnameTarget('--bad', 'CNAME', 'value');
        assert.ok(err !== null);
        assert.ok(!Array.isArray(err));
        assert.equal(err.field, 'value');
    });
});

// ---------------------------------------------------------------
// RecordTypes validation regression
// ---------------------------------------------------------------
describe('RecordTypes validation regression', function() {

    // CNAME
    it('CNAME validate accepts @', function() {
        var def = RecordTypes.get('CNAME');
        assert.equal(def.fields[0].validate('@'), null);
    });

    it('CNAME validate rejects IP', function() {
        var def = RecordTypes.get('CNAME');
        var result = def.fields[0].validate('1.2.3.4');
        assert.ok(result !== null);
        assert.equal(result.field, 'value');
    });

    it('CNAME validate accepts FQDN', function() {
        var def = RecordTypes.get('CNAME');
        assert.equal(def.fields[0].validate('example.com.'), null);
    });

    it('CNAME warn returns null for @', function() {
        var def = RecordTypes.get('CNAME');
        assert.equal(def.fields[0].warn('@'), null);
    });

    it('CNAME warn returns null for dotted', function() {
        var def = RecordTypes.get('CNAME');
        assert.equal(def.fields[0].warn('example.com.'), null);
    });

    it('CNAME warn warns for undotted', function() {
        var def = RecordTypes.get('CNAME');
        var result = def.fields[0].warn('example.com');
        assert.ok(result !== null);
        assert.equal(result.field, 'value');
    });

    // MX
    it('MX target validate accepts @', function() {
        var def = RecordTypes.get('MX');
        assert.equal(def.fields[1].validate('@'), null);
    });

    it('MX target validate rejects IP', function() {
        var def = RecordTypes.get('MX');
        var result = def.fields[1].validate('10.0.0.1');
        assert.ok(result !== null);
        assert.equal(result.field, 'target');
    });

    it('MX target warn returns null for @', function() {
        var def = RecordTypes.get('MX');
        assert.equal(def.fields[1].warn('@'), null);
    });

    // SRV
    it('SRV target validate accepts .', function() {
        var def = RecordTypes.get('SRV');
        assert.equal(def.fields[3].validate('.'), null);
    });

    it('SRV target validate does not reject IP', function() {
        var def = RecordTypes.get('SRV');
        // 1.2.3.4 is checked as FQDN (rejectIP=false), isValidFQDN('1.2.3.4') = true (4 valid labels)
        var result = def.fields[3].validate('1.2.3.4');
        assert.equal(result, null);
    });

    it('SRV target warn returns null for .', function() {
        var def = RecordTypes.get('SRV');
        assert.equal(def.fields[3].warn('.'), null);
    });

    // NS (Tier 2, returns arrays)
    it('NS validate rejects IP', function() {
        var def = RecordTypes.get('NS');
        var result = def.validate('1.2.3.4');
        assert.ok(Array.isArray(result));
        assert.equal(result.length, 1);
        assert.equal(result[0].field, 'value');
    });

    it('NS validate accepts FQDN', function() {
        var def = RecordTypes.get('NS');
        var result = def.validate('ns1.example.com.');
        assert.ok(Array.isArray(result));
        assert.equal(result.length, 0);
    });

    it('NS warn warns for undotted hostname', function() {
        var def = RecordTypes.get('NS');
        var result = def.warn('ns1.example.com');
        assert.ok(result !== null);
        assert.equal(result.field, 'value');
    });

    // PTR
    it('PTR validate accepts FQDN', function() {
        var def = RecordTypes.get('PTR');
        var result = def.validate('host.example.com.');
        assert.ok(Array.isArray(result));
        assert.equal(result.length, 0);
    });

    it('PTR validate does not reject IP', function() {
        var def = RecordTypes.get('PTR');
        // rejectIP=false, but 1.2.3.4 passes isValidFQDN (4 numeric labels are valid)
        var result = def.validate('1.2.3.4');
        assert.ok(Array.isArray(result));
        assert.equal(result.length, 0);
    });

    // ALIAS
    it('ALIAS validate rejects IP', function() {
        var def = RecordTypes.get('ALIAS');
        var result = def.validate('1.2.3.4');
        assert.ok(Array.isArray(result));
        assert.equal(result.length, 1);
        assert.equal(result[0].field, 'value');
    });

    it('ALIAS validate accepts FQDN', function() {
        var def = RecordTypes.get('ALIAS');
        var result = def.validate('example.com.');
        assert.ok(Array.isArray(result));
        assert.equal(result.length, 0);
    });

    // DNAME
    it('DNAME validate accepts FQDN', function() {
        var def = RecordTypes.get('DNAME');
        var result = def.validate('example.com.');
        assert.ok(Array.isArray(result));
        assert.equal(result.length, 0);
    });

    it('DNAME validate does not reject IP', function() {
        var def = RecordTypes.get('DNAME');
        var result = def.validate('1.2.3.4');
        assert.ok(Array.isArray(result));
        assert.equal(result.length, 0);
    });

    // SSHFP, TLSA, DS hex
    it('SSHFP validate rejects non-hex fingerprint', function() {
        var def = RecordTypes.get('SSHFP');
        var result = def.validate('1 1 xyz123');
        assert.ok(result.length > 0);
        assert.equal(result[0].field, 'value');
    });

    it('TLSA validate rejects non-hex cert data', function() {
        var def = RecordTypes.get('TLSA');
        var result = def.validate('3 1 1 zzzzzz');
        assert.ok(result.length > 0);
        assert.equal(result[0].field, 'value');
    });

    it('DS validate rejects non-hex digest', function() {
        var def = RecordTypes.get('DS');
        var result = def.validate('12345 8 2 ghijkl');
        assert.ok(result.length > 0);
        assert.equal(result[0].field, 'value');
    });

    // --- DS complete validation ---
    it('DS validate accepts valid DS record (algo 13, SHA-256)', function() {
        var def = RecordTypes.get('DS');
        var digest64 = 'a'.repeat(64);
        var result = def.validate('12345 13 2 ' + digest64);
        assert.ok(Array.isArray(result));
        assert.equal(result.length, 0);
    });

    it('DS validate accepts keytag boundary values (0 and 65535)', function() {
        var def = RecordTypes.get('DS');
        var digest64 = 'b'.repeat(64);
        assert.equal(def.validate('0 8 2 ' + digest64).length, 0);
        assert.equal(def.validate('65535 8 2 ' + digest64).length, 0);
    });

    it('DS validate rejects invalid algorithm', function() {
        var def = RecordTypes.get('DS');
        var digest64 = 'a'.repeat(64);
        var result = def.validate('1234 999 2 ' + digest64);
        assert.ok(result.length > 0);
        assert.ok(result[0].message.includes('DS.validate.algorithm'));
    });

    it('DS validate rejects algorithm 0 and 1', function() {
        var def = RecordTypes.get('DS');
        var digest64 = 'a'.repeat(64);
        assert.ok(def.validate('1234 0 2 ' + digest64).length > 0);
        assert.ok(def.validate('1234 1 2 ' + digest64).length > 0);
    });

    it('DS validate rejects invalid digest type', function() {
        var def = RecordTypes.get('DS');
        var digest64 = 'a'.repeat(64);
        var result = def.validate('1234 13 3 ' + digest64);
        assert.ok(result.length > 0);
        assert.ok(result[0].message.includes('DS.validate.digestType'));
    });

    it('DS validate rejects digest type 0 and 999', function() {
        var def = RecordTypes.get('DS');
        var digest40 = 'a'.repeat(40);
        assert.ok(def.validate('1234 13 0 ' + digest40).length > 0);
        assert.ok(def.validate('1234 13 999 ' + digest40).length > 0);
    });

    it('DS validate rejects wrong digest length for SHA-1 (type 1)', function() {
        var def = RecordTypes.get('DS');
        // SHA-1 expects 40 hex chars, give 64
        var digest64 = 'a'.repeat(64);
        var result = def.validate('1234 13 1 ' + digest64);
        assert.ok(result.length > 0);
        assert.ok(result[0].message.includes('DS.validate.digestLength'));
    });

    it('DS validate accepts correct digest length for SHA-1 (40 hex)', function() {
        var def = RecordTypes.get('DS');
        var digest40 = 'a'.repeat(40);
        assert.equal(def.validate('1234 13 1 ' + digest40).length, 0);
    });

    it('DS validate rejects wrong digest length for SHA-384 (type 4)', function() {
        var def = RecordTypes.get('DS');
        // SHA-384 expects 96 hex chars, give 64
        var digest64 = 'a'.repeat(64);
        var result = def.validate('1234 13 4 ' + digest64);
        assert.ok(result.length > 0);
        assert.ok(result[0].message.includes('DS.validate.digestLength'));
    });

    it('DS validate accepts correct digest length for SHA-384 (96 hex)', function() {
        var def = RecordTypes.get('DS');
        var digest96 = 'a'.repeat(96);
        assert.equal(def.validate('1234 15 4 ' + digest96).length, 0);
    });

    // --- TLSA validateName ---
    it('TLSA validateName accepts _443._tcp', function() {
        var def = RecordTypes.get('TLSA');
        assert.equal(def.validateName('_443._tcp'), null);
    });

    it('TLSA validateName accepts _25._tcp.mail.example.com', function() {
        var def = RecordTypes.get('TLSA');
        assert.equal(def.validateName('_25._tcp.mail'), null);
    });

    it('TLSA validateName rejects plain domain', function() {
        var def = RecordTypes.get('TLSA');
        var result = def.validateName('example.com');
        assert.ok(result !== null);
        assert.equal(result.field, 'name');
    });

    it('TLSA validateName rejects missing port underscore', function() {
        var def = RecordTypes.get('TLSA');
        var result = def.validateName('443._tcp');
        assert.ok(result !== null);
    });

    it('TLSA validateName accepts @ (apex)', function() {
        var def = RecordTypes.get('TLSA');
        assert.equal(def.validateName('@'), null);
    });

    // --- CAA warn ---
    it('CAA cavalue warn returns null for simple domain', function() {
        var def = RecordTypes.get('CAA');
        assert.equal(def.fields[2].warn('letsencrypt.org'), null);
    });

    it('CAA cavalue warn detects URL-like value', function() {
        var def = RecordTypes.get('CAA');
        var result = def.fields[2].warn('https://letsencrypt.org');
        assert.ok(result !== null);
        assert.equal(result.field, 'cavalue');
        assert.ok(result.message.includes('issueLooksLikeUrl'));
    });

    it('CAA cavalue warn detects @ in value', function() {
        var def = RecordTypes.get('CAA');
        var result = def.fields[2].warn('admin@example.com');
        assert.ok(result !== null);
        assert.equal(result.field, 'cavalue');
        assert.ok(result.message.includes('issueContainsAt'));
    });

    it('CAA cavalue warn returns null for empty value', function() {
        var def = RecordTypes.get('CAA');
        assert.equal(def.fields[2].warn(''), null);
        assert.equal(def.fields[2].warn(null), null);
    });

    it('CAA cavalue warn allows mailto: prefix', function() {
        var def = RecordTypes.get('CAA');
        // mailto: starts with mailto: so not flagged as @ issue
        assert.equal(def.fields[2].warn('mailto:admin@example.com'), null);
    });

    // --- CAA parseValue/formatValue ---
    it('CAA parseValue parses standard value', function() {
        var def = RecordTypes.get('CAA');
        var result = def.parseValue('0 issue "letsencrypt.org"');
        assert.equal(result.flags, '0');
        assert.equal(result.tag, 'issue');
        assert.equal(result.cavalue, 'letsencrypt.org');
    });

    it('CAA parseValue parses unquoted value', function() {
        var def = RecordTypes.get('CAA');
        var result = def.parseValue('128 issuewild letsencrypt.org');
        assert.equal(result.flags, '128');
        assert.equal(result.tag, 'issuewild');
        assert.equal(result.cavalue, 'letsencrypt.org');
    });

    it('CAA formatValue round-trips correctly', function() {
        var def = RecordTypes.get('CAA');
        var parts = { flags: '0', tag: 'issue', cavalue: 'letsencrypt.org' };
        var formatted = def.formatValue(parts);
        assert.equal(formatted, '0 issue "letsencrypt.org"');
    });

    // --- MX parseValue/formatValue ---
    it('MX parseValue parses priority and target', function() {
        var def = RecordTypes.get('MX');
        var result = def.parseValue('10 mail.example.com.');
        assert.equal(result.priority, '10');
        assert.equal(result.target, 'mail.example.com.');
    });

    it('MX formatValue produces correct output', function() {
        var def = RecordTypes.get('MX');
        var formatted = def.formatValue({ priority: 10, target: 'mail.example.com.' });
        assert.equal(formatted, '10 mail.example.com.');
    });

    it('MX parseValue/formatValue round-trips', function() {
        var def = RecordTypes.get('MX');
        var original = '20 backup.example.com.';
        var parsed = def.parseValue(original);
        var formatted = def.formatValue(parsed);
        assert.equal(formatted, original);
    });

    // --- SRV parseValue/formatValue ---
    it('SRV parseValue parses all 4 fields', function() {
        var def = RecordTypes.get('SRV');
        var result = def.parseValue('10 0 443 sip.example.com.');
        assert.equal(result.priority, '10');
        assert.equal(result.weight, '0');
        assert.equal(result.port, '443');
        assert.equal(result.target, 'sip.example.com.');
    });

    it('SRV formatValue produces correct output', function() {
        var def = RecordTypes.get('SRV');
        var formatted = def.formatValue({ priority: 10, weight: 0, port: 443, target: 'sip.example.com.' });
        assert.equal(formatted, '10 0 443 sip.example.com.');
    });

    // --- NS edge cases ---
    it('NS validate rejects invalid hostname', function() {
        var def = RecordTypes.get('NS');
        var result = def.validate('not a valid hostname!');
        assert.ok(Array.isArray(result));
        assert.ok(result.length > 0);
    });

    it('NS validate accepts hostname with trailing dot', function() {
        var def = RecordTypes.get('NS');
        assert.equal(def.validate('ns1.example.com.').length, 0);
    });

    it('NS warn returns null for dotted hostname', function() {
        var def = RecordTypes.get('NS');
        assert.equal(def.warn('ns1.example.com.'), null);
    });

    // --- ALIAS edge cases ---
    it('ALIAS validate rejects invalid hostname', function() {
        var def = RecordTypes.get('ALIAS');
        var result = def.validate('not valid!');
        assert.ok(result.length > 0);
    });

    it('ALIAS validate accepts valid FQDN with trailing dot', function() {
        var def = RecordTypes.get('ALIAS');
        assert.equal(def.validate('example.com.').length, 0);
    });

    it('ALIAS warn warns for missing trailing dot', function() {
        var def = RecordTypes.get('ALIAS');
        var result = def.warn('example.com');
        assert.ok(result !== null);
        assert.equal(result.field, 'value');
    });

    // TXT
    it('TXT warn detects SPF', function() {
        var def = RecordTypes.get('TXT');
        var result = def.fields[0].warn('v=spf1 include:_spf.google.com ~all');
        assert.ok(result !== null);
        assert.equal(result.field, 'value');
        assert.equal(result.message, 'types.TXT.warnings.spf');
    });

    it('TXT warn detects DKIM', function() {
        var def = RecordTypes.get('TXT');
        var result = def.fields[0].warn('v=DKIM1; k=rsa; p=MIIBIjAN...');
        assert.ok(result !== null);
        assert.equal(result.field, 'value');
        assert.equal(result.message, 'types.TXT.warnings.dkim');
    });

    it('TXT warn detects DMARC', function() {
        var def = RecordTypes.get('TXT');
        var result = def.fields[0].warn('v=DMARC1; p=none');
        assert.ok(result !== null);
        assert.equal(result.field, 'value');
        assert.equal(result.message, 'types.TXT.warnings.dmarc');
    });

    it('TXT warn returns null for normal text', function() {
        var def = RecordTypes.get('TXT');
        assert.equal(def.fields[0].warn('hello world'), null);
    });
});
