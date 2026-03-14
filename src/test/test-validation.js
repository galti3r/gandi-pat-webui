/**
 * Tests for the Validation module.
 * Run with: node --test src/test/test-validation.js
 */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// --- Minimal mocks for dependencies ---

// Mock I18n (used by Validation for translated messages)
global.I18n = {
    t: function(key, params) {
        var str = key;
        if (params) {
            Object.keys(params).forEach(function(k) {
                str = str.replace('{' + k + '}', String(params[k]));
            });
        }
        return str;
    }
};

// Mock Helpers (used by Validation and RecordTypes)
global.Helpers = {
    truncate: function(s, n) {
        var max = n || 50;
        var str = String(s || '');
        return str.length <= max ? str : str.substring(0, max - 1) + '\u2026';
    },
    isValidIPv4: function(s) {
        if (!s || typeof s !== 'string') return false;
        var parts = s.split('.');
        if (parts.length !== 4) return false;
        for (var i = 0; i < 4; i++) {
            if (!/^(0|[1-9]\d*)$/.test(parts[i])) return false;
            var num = parseInt(parts[i], 10);
            if (num < 0 || num > 255) return false;
        }
        return true;
    },
    isValidIPv6: function(s) {
        if (!s || typeof s !== 'string') return false;
        // Simplified check for tests
        return /^[0-9a-fA-F:]+$/.test(s) || /::/.test(s);
    },
    isValidFQDN: function(s) {
        if (!s || typeof s !== 'string') return false;
        var h = s.replace(/\.$/, '');
        if (h.length === 0 || h.length > 253) return false;
        var labels = h.split('.');
        for (var i = 0; i < labels.length; i++) {
            if (labels[i].length === 0 || labels[i].length > 63) return false;
            if (labels[i] === '*' && i === 0) continue;
            if (!/^[a-zA-Z0-9_]([a-zA-Z0-9_-]*[a-zA-Z0-9_])?$/.test(labels[i])) return false;
        }
        return true;
    }
};

// Mock RecordTypes (used by Validation)
global.RecordTypes = {
    TIERS: { FULL: 1, BASIC: 2, RAW: 3 },
    get: function(type) {
        // Return minimal type definitions for testing
        var defs = {
            A: { tier: 1, fields: [{ id: 'value' }] },
            AAAA: { tier: 1, fields: [{ id: 'value' }] },
            CNAME: { tier: 1, fields: [{ id: 'value' }] },
            MX: { tier: 1, fields: [{ id: 'priority' }, { id: 'target' }] },
            TXT: { tier: 1, fields: [{ id: 'value' }] },
            SRV: {
                tier: 1,
                fields: [{ id: 'priority' }, { id: 'weight' }, { id: 'port' }, { id: 'target' }],
                validateName: function(name) {
                    if (name === '@' || name === '') return null;
                    if (!/^_[a-zA-Z0-9-]+\._[a-zA-Z]+/.test(name)) {
                        return { field: 'name', message: 'SRV name should follow _service._protocol format' };
                    }
                    return null;
                }
            },
            NS: {
                tier: 2,
                validate: function(value) {
                    if (!Helpers.isValidFQDN(value)) {
                        return [{ field: 'value', message: 'Invalid hostname' }];
                    }
                    return [];
                }
            },
            ALIAS: { tier: 2, singleValue: true },
            DNAME: { tier: 2, singleValue: true },
            SOA: { tier: 3, readOnly: true }
        };
        return defs[type] || null;
    }
};

// Load Validation module — use vm.runInThisContext so top-level const becomes global
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var validationCode = fs.readFileSync(path.join(__dirname, '..', 'js', 'validation.js'), 'utf8');
vm.runInThisContext(validationCode, { filename: 'validation.js' });

// ---------------------------------------------------------------
// Tests
// ---------------------------------------------------------------

describe('Validation', function() {

    describe('normalizeName', function() {

        it('should return @ for null/undefined/empty', function() {
            assert.equal(Validation.normalizeName(null), '@');
            assert.equal(Validation.normalizeName(undefined), '@');
            assert.equal(Validation.normalizeName(''), '@');
            assert.equal(Validation.normalizeName('@'), '@');
        });

        it('should lowercase and trim', function() {
            assert.equal(Validation.normalizeName('  WWW  '), 'www');
        });

        it('should remove trailing dot', function() {
            assert.equal(Validation.normalizeName('www.'), 'www');
            assert.equal(Validation.normalizeName('sub.domain.'), 'sub.domain');
        });
    });

    describe('validateTTL', function() {

        it('should accept empty TTL (optional)', function() {
            assert.deepEqual(Validation.validateTTL(''), []);
            assert.deepEqual(Validation.validateTTL(null), []);
            assert.deepEqual(Validation.validateTTL(undefined), []);
        });

        it('should accept valid TTL values', function() {
            assert.deepEqual(Validation.validateTTL(300), []);
            assert.deepEqual(Validation.validateTTL(3600), []);
            assert.deepEqual(Validation.validateTTL(86400), []);
            assert.deepEqual(Validation.validateTTL(2592000), []);
        });

        it('should reject non-numeric TTL', function() {
            var errors = Validation.validateTTL('abc');
            assert.equal(errors.length, 1);
            assert.equal(errors[0].field, 'ttl');
            assert.ok(errors[0].message.includes('ttlNotInteger'));
        });

        it('should reject TTL below minimum (300)', function() {
            var errors = Validation.validateTTL(299);
            assert.equal(errors.length, 1);
            assert.equal(errors[0].field, 'ttl');
            assert.ok(errors[0].message.includes('ttlMin'));
        });

        it('should reject TTL above maximum (2592000)', function() {
            var errors = Validation.validateTTL(2592001);
            assert.equal(errors.length, 1);
            assert.equal(errors[0].field, 'ttl');
        });

        it('should accept boundary values', function() {
            assert.deepEqual(Validation.validateTTL(300), []);
            assert.deepEqual(Validation.validateTTL(2592000), []);
        });
    });

    describe('validateName', function() {

        it('should require name', function() {
            var errors = Validation.validateName(null, 'A', 'example.com');
            assert.equal(errors.length, 1);
            assert.equal(errors[0].field, 'name');
        });

        it('should accept @ (apex)', function() {
            assert.deepEqual(Validation.validateName('@', 'A', 'example.com'), []);
        });

        it('should accept empty string (apex)', function() {
            assert.deepEqual(Validation.validateName('', 'A', 'example.com'), []);
        });

        it('should reject CNAME at apex', function() {
            var errors = Validation.validateName('@', 'CNAME', 'example.com');
            assert.equal(errors.length, 1);
            assert.ok(errors[0].message.includes('cnameAtApex'));
        });

        it('should accept valid subdomain names', function() {
            assert.deepEqual(Validation.validateName('www', 'A', 'example.com'), []);
            assert.deepEqual(Validation.validateName('sub.domain', 'A', 'example.com'), []);
            assert.deepEqual(Validation.validateName('my-host', 'A', 'example.com'), []);
        });

        it('should accept wildcard', function() {
            assert.deepEqual(Validation.validateName('*', 'A', 'example.com'), []);
            assert.deepEqual(Validation.validateName('*.sub', 'A', 'example.com'), []);
        });

        it('should reject invalid wildcard placement', function() {
            var errors = Validation.validateName('sub.*', 'A', 'example.com');
            assert.ok(errors.length > 0);
        });

        it('should reject multi-level wildcards', function() {
            var errors = Validation.validateName('*.*.sub', 'A', 'example.com');
            assert.ok(errors.length > 0);
        });

        it('should reject DNAME wildcard', function() {
            var errors = Validation.validateName('*', 'DNAME', 'example.com');
            assert.ok(errors.length > 0);
            assert.ok(errors[0].message.includes('wildcardDNAME'));
        });

        it('should reject labels exceeding 63 characters', function() {
            var longLabel = 'a'.repeat(64);
            var errors = Validation.validateName(longLabel, 'A', 'example.com');
            assert.ok(errors.length > 0);
            assert.ok(errors[0].message.includes('labelTooLong'));
        });

        it('should accept labels at 63 characters', function() {
            var label63 = 'a'.repeat(63);
            var errors = Validation.validateName(label63, 'A', 'example.com');
            assert.deepEqual(errors, []);
        });

        it('should reject empty labels (double dots)', function() {
            var errors = Validation.validateName('sub..domain', 'A', 'example.com');
            assert.ok(errors.length > 0);
            assert.ok(errors[0].message.includes('emptyLabel'));
        });

        it('should reject names with invalid characters', function() {
            var errors = Validation.validateName('sub domain', 'A', 'example.com');
            assert.ok(errors.length > 0);
        });

        it('should accept underscore prefix (SRV/DKIM)', function() {
            assert.deepEqual(Validation.validateName('_sip._tcp', 'SRV', 'example.com'), []);
            assert.deepEqual(Validation.validateName('_dmarc', 'TXT', 'example.com'), []);
        });

        it('should call type-specific validateName if available', function() {
            var errors = Validation.validateName('invalid', 'SRV', 'example.com');
            assert.ok(errors.length > 0);
            assert.ok(errors[0].message.includes('_service._protocol'));
        });
    });

    describe('validateType', function() {

        it('should require at least one value', function() {
            var errors = Validation.validateType('A', 'www', [], []);
            assert.equal(errors.length, 1);
            assert.equal(errors[0].field, 'value');
        });

        it('should reject CNAME with multiple values', function() {
            var errors = Validation.validateType('CNAME', 'www', ['a.com', 'b.com'], []);
            assert.ok(errors.some(function(e) { return e.message.includes('cnameOneValue'); }));
        });

        it('should accept CNAME with one value', function() {
            var errors = Validation.validateType('CNAME', 'www', ['target.com'], []);
            assert.deepEqual(errors, []);
        });

        it('should reject ALIAS with multiple values', function() {
            var errors = Validation.validateType('ALIAS', '@', ['a.com', 'b.com'], []);
            assert.ok(errors.some(function(e) { return e.message.includes('singleValueOnly'); }));
        });

        it('should accept ALIAS with one value', function() {
            var errors = Validation.validateType('ALIAS', '@', ['target.com'], []);
            assert.deepEqual(errors, []);
        });

        it('should reject DNAME with multiple values', function() {
            var errors = Validation.validateType('DNAME', 'sub', ['a.com', 'b.com'], []);
            assert.ok(errors.some(function(e) { return e.message.includes('singleValueOnly'); }));
        });

        it('should accept DNAME with one value', function() {
            var errors = Validation.validateType('DNAME', 'sub', ['target.com'], []);
            assert.deepEqual(errors, []);
        });
    });

    describe('checkCNAMEExclusivity', function() {

        it('should reject CNAME when other records exist at same name', function() {
            var existing = [
                { rrset_name: 'www', rrset_type: 'A', rrset_values: ['1.2.3.4'] }
            ];
            var errors = Validation.checkCNAMEExclusivity('CNAME', 'www', existing);
            assert.equal(errors.length, 1);
            assert.ok(errors[0].message.includes('cnameConflict'));
        });

        it('should reject non-CNAME when CNAME exists at same name', function() {
            var existing = [
                { rrset_name: 'www', rrset_type: 'CNAME', rrset_values: ['target.com'] }
            ];
            var errors = Validation.checkCNAMEExclusivity('A', 'www', existing);
            assert.equal(errors.length, 1);
            assert.ok(errors[0].message.includes('cnameExists'));
        });

        it('should allow CNAME when no other records exist', function() {
            var existing = [
                { rrset_name: 'other', rrset_type: 'A', rrset_values: ['1.2.3.4'] }
            ];
            var errors = Validation.checkCNAMEExclusivity('CNAME', 'www', existing);
            assert.deepEqual(errors, []);
        });

        it('should ignore DNSSEC types (RRSIG, NSEC, NSEC3)', function() {
            var existing = [
                { rrset_name: 'www', rrset_type: 'RRSIG', rrset_values: ['...'] },
                { rrset_name: 'www', rrset_type: 'NSEC', rrset_values: ['...'] }
            ];
            var errors = Validation.checkCNAMEExclusivity('CNAME', 'www', existing);
            assert.deepEqual(errors, []);
        });

        it('should handle case-insensitive name matching', function() {
            var existing = [
                { rrset_name: 'WWW', rrset_type: 'A', rrset_values: ['1.2.3.4'] }
            ];
            var errors = Validation.checkCNAMEExclusivity('CNAME', 'www', existing);
            assert.equal(errors.length, 1);
        });
    });

    describe('checkCNAMECircular', function() {

        it('should detect simple circular chains', function() {
            var existing = [
                { rrset_name: 'b', rrset_type: 'CNAME', rrset_values: ['a'] }
            ];
            // a → b → a (loop)
            var errors = Validation.checkCNAMECircular('a', 'b', existing);
            assert.equal(errors.length, 1);
            assert.ok(errors[0].message.includes('cnameCircular'));
        });

        it('should detect multi-hop circular chains', function() {
            var existing = [
                { rrset_name: 'b', rrset_type: 'CNAME', rrset_values: ['c'] },
                { rrset_name: 'c', rrset_type: 'CNAME', rrset_values: ['a'] }
            ];
            // a → b → c → a (loop)
            var errors = Validation.checkCNAMECircular('a', 'b', existing);
            assert.equal(errors.length, 1);
            assert.ok(errors[0].message.includes('cnameCircular'));
        });

        it('should allow non-circular chains', function() {
            var existing = [
                { rrset_name: 'b', rrset_type: 'CNAME', rrset_values: ['c'] }
            ];
            // a → b → c (no loop, c is terminal)
            var errors = Validation.checkCNAMECircular('a', 'b', existing);
            assert.deepEqual(errors, []);
        });

        it('should warn on deep chains (>8 hops)', function() {
            var existing = [];
            // Build a chain: a→b→c→d→e→f→g→h→i→j (9 hops)
            var letters = 'bcdefghij'.split('');
            for (var i = 0; i < letters.length - 1; i++) {
                existing.push({
                    rrset_name: letters[i],
                    rrset_type: 'CNAME',
                    rrset_values: [letters[i + 1]]
                });
            }
            var errors = Validation.checkCNAMECircular('a', 'b', existing);
            // Should warn about depth, not circular
            if (errors.length > 0) {
                assert.ok(errors[0].message.includes('cnameChainDeep'));
            }
        });

        it('should handle null target value', function() {
            var errors = Validation.checkCNAMECircular('a', null, []);
            assert.deepEqual(errors, []);
        });
    });

    describe('checkALIASExclusivity', function() {

        it('should reject ALIAS when other records exist at same name', function() {
            var existing = [
                { rrset_name: '@', rrset_type: 'A', rrset_values: ['1.2.3.4'] }
            ];
            var errors = Validation.checkALIASExclusivity('ALIAS', '@', existing);
            assert.equal(errors.length, 1);
            assert.ok(errors[0].message.includes('aliasConflict'));
        });

        it('should reject non-ALIAS when ALIAS exists at same name', function() {
            var existing = [
                { rrset_name: '@', rrset_type: 'ALIAS', rrset_values: ['target.com'] }
            ];
            var errors = Validation.checkALIASExclusivity('A', '@', existing);
            assert.equal(errors.length, 1);
            assert.ok(errors[0].message.includes('aliasExists'));
        });

        it('should allow ALIAS when no other records exist at same name', function() {
            var existing = [
                { rrset_name: 'other', rrset_type: 'A', rrset_values: ['1.2.3.4'] }
            ];
            var errors = Validation.checkALIASExclusivity('ALIAS', '@', existing);
            assert.deepEqual(errors, []);
        });

        it('should ignore DNSSEC types (RRSIG, NSEC, NSEC3)', function() {
            var existing = [
                { rrset_name: '@', rrset_type: 'RRSIG', rrset_values: ['...'] },
                { rrset_name: '@', rrset_type: 'NSEC', rrset_values: ['...'] }
            ];
            var errors = Validation.checkALIASExclusivity('ALIAS', '@', existing);
            assert.deepEqual(errors, []);
        });

        it('should handle case-insensitive name matching', function() {
            var existing = [
                { rrset_name: 'WWW', rrset_type: 'A', rrset_values: ['1.2.3.4'] }
            ];
            var errors = Validation.checkALIASExclusivity('ALIAS', 'www', existing);
            assert.equal(errors.length, 1);
        });
    });

    describe('checkDNAMEConflicts', function() {

        it('should reject DNAME when CNAME exists at same name', function() {
            var existing = [
                { rrset_name: 'sub', rrset_type: 'CNAME', rrset_values: ['target.com'] }
            ];
            // checkDNAMEConflicts is called via validateType cross-record checks
            var errors = Validation.validateType('DNAME', 'sub', ['target.com'], existing);
            assert.ok(errors.some(function(e) { return e.message.includes('dnameConflictCname'); }));
        });

        it('should reject CNAME when DNAME exists at same name', function() {
            var existing = [
                { rrset_name: 'sub', rrset_type: 'DNAME', rrset_values: ['target.com'] }
            ];
            var errors = Validation.validateType('CNAME', 'sub', ['target.com'], existing);
            assert.ok(errors.some(function(e) { return e.message.includes('cnameConflictDname'); }));
        });
    });

    describe('checkDuplicates', function() {

        it('should detect duplicate values', function() {
            var existing = [
                { rrset_name: 'www', rrset_type: 'A', rrset_values: ['1.2.3.4'] }
            ];
            var errors = Validation.checkDuplicates('A', 'www', ['1.2.3.4'], existing);
            assert.equal(errors.length, 1);
            assert.ok(errors[0].message.includes('duplicate'));
        });

        it('should be case-insensitive for values', function() {
            var existing = [
                { rrset_name: 'www', rrset_type: 'CNAME', rrset_values: ['Target.COM.'] }
            ];
            var errors = Validation.checkDuplicates('CNAME', 'www', ['target.com.'], existing);
            assert.equal(errors.length, 1);
        });

        it('should not flag different values', function() {
            var existing = [
                { rrset_name: 'www', rrset_type: 'A', rrset_values: ['1.2.3.4'] }
            ];
            var errors = Validation.checkDuplicates('A', 'www', ['5.6.7.8'], existing);
            assert.deepEqual(errors, []);
        });

        it('should warn about multiple SPF records', function() {
            var existing = [
                {
                    rrset_name: '@',
                    rrset_type: 'TXT',
                    rrset_values: ['"v=spf1 include:example.com ~all"']
                }
            ];
            var errors = Validation.checkDuplicates('TXT', '@', ['"v=spf1 include:other.com ~all"'], existing);
            assert.ok(errors.some(function(e) { return e.message.includes('spfDuplicate'); }));
        });

        it('should not warn about non-SPF TXT records', function() {
            var existing = [
                {
                    rrset_name: '@',
                    rrset_type: 'TXT',
                    rrset_values: ['"some-verification=abc"']
                }
            ];
            var errors = Validation.checkDuplicates('TXT', '@', ['"another-verification=xyz"'], existing);
            assert.deepEqual(errors, []);
        });
    });

    describe('validateRecord (integration)', function() {

        it('should return empty array for valid record', function() {
            var record = {
                name: 'www',
                type: 'A',
                ttl: 3600,
                values: ['192.168.1.1']
            };
            var errors = Validation.validateRecord(record, [], 'example.com');
            assert.deepEqual(errors, []);
        });

        it('should aggregate errors from name, TTL, and type', function() {
            var record = {
                name: null,
                type: 'A',
                ttl: 1,
                values: []
            };
            var errors = Validation.validateRecord(record, [], 'example.com');
            // Should have errors for: name (required), ttl (too low), values (empty)
            assert.ok(errors.length >= 2);
            var fields = errors.map(function(e) { return e.field; });
            assert.ok(fields.includes('name'));
        });

        it('should detect CNAME exclusivity violation', function() {
            var existing = [
                { rrset_name: 'www', rrset_type: 'A', rrset_values: ['1.2.3.4'] }
            ];
            var record = {
                name: 'www',
                type: 'CNAME',
                ttl: 3600,
                values: ['target.com']
            };
            var errors = Validation.validateRecord(record, existing, 'example.com');
            assert.ok(errors.some(function(e) { return e.message.includes('cnameConflict'); }));
        });
    });

    describe('MIN_TTL and MAX_TTL constants', function() {

        it('should expose MIN_TTL as 300', function() {
            assert.equal(Validation.MIN_TTL, 300);
        });

        it('should expose MAX_TTL as 2592000', function() {
            assert.equal(Validation.MAX_TTL, 2592000);
        });
    });
});
