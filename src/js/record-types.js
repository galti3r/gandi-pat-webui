/**
 * RecordTypes — Declarative field definitions for each DNS record type.
 * Part of Gandi DNS WebUI.
 *
 * All user-facing strings use I18n.t() via lazy getters so they resolve
 * after I18n.init() has loaded translations.
 */
const RecordTypes = (function() {
    'use strict';

    // Tier 1: Full validation + dedicated form fields
    // Tier 2: Basic validation + textarea with hint
    // Tier 3: Raw textarea + no client validation

    const TIERS = { FULL: 1, BASIC: 2, RAW: 3 };

    // Field definition format:
    // { id, label (getter), type, required?, placeholder?, help (getter)?, options?, min?, max?, validate? }

    const definitions = {
        A: {
            tier: TIERS.FULL,
            get label() { return I18n.t('types.A.label'); },
            get description() { return I18n.t('types.A.description'); },
            fields: [
                {
                    id: 'value',
                    get label() { return I18n.t('types.A.fields.value.label'); },
                    type: 'text',
                    required: true,
                    placeholder: '203.0.113.1',
                    get help() { return I18n.t('types.A.fields.value.help'); },
                    validate: function(v) {
                        return Helpers.isValidIPv4(v) ? null : { field: 'value', message: I18n.t('types.validate.invalidIPv4') };
                    }
                }
            ],
            multiValue: false,
            formatValue: function(parts) { return parts.value; }
        },

        AAAA: {
            tier: TIERS.FULL,
            get label() { return I18n.t('types.AAAA.label'); },
            get description() { return I18n.t('types.AAAA.description'); },
            fields: [
                {
                    id: 'value',
                    get label() { return I18n.t('types.AAAA.fields.value.label'); },
                    type: 'text',
                    required: true,
                    placeholder: '2001:db8::1',
                    get help() { return I18n.t('types.AAAA.fields.value.help'); },
                    validate: function(v) {
                        return Helpers.isValidIPv6(v) ? null : { field: 'value', message: I18n.t('types.validate.invalidIPv6') };
                    }
                }
            ],
            multiValue: false,
            formatValue: function(parts) { return parts.value; }
        },

        CNAME: {
            tier: TIERS.FULL,
            singleValue: true,
            get label() { return I18n.t('types.CNAME.label'); },
            get description() { return I18n.t('types.CNAME.description'); },
            fields: [
                {
                    id: 'value',
                    get label() { return I18n.t('types.CNAME.fields.value.label'); },
                    type: 'text',
                    required: true,
                    placeholder: 'example.com.',
                    get help() { return I18n.t('types.CNAME.fields.value.help'); },
                    validate: function(v) {
                        return Helpers.validateHostnameTarget(v, 'CNAME', 'value', { specialValues: ['@'] });
                    },
                    warn: function(v) {
                        return Helpers.warnTrailingDot(v, 'value', ['@']);
                    }
                }
            ],
            multiValue: false,
            formatValue: function(parts) { return parts.value; }
        },

        MX: {
            tier: TIERS.FULL,
            get label() { return I18n.t('types.MX.label'); },
            get description() { return I18n.t('types.MX.description'); },
            fields: [
                {
                    id: 'priority',
                    get label() { return I18n.t('types.MX.fields.priority.label'); },
                    type: 'number',
                    required: true,
                    min: 0,
                    max: 65535,
                    placeholder: '10',
                    get help() { return I18n.t('types.MX.fields.priority.help'); }
                },
                {
                    id: 'target',
                    get label() { return I18n.t('types.MX.fields.target.label'); },
                    type: 'text',
                    required: true,
                    placeholder: 'mail.example.com.',
                    get help() { return I18n.t('types.MX.fields.target.help'); },
                    validate: function(v) {
                        return Helpers.validateHostnameTarget(v, 'MX', 'target', { specialValues: ['@'] });
                    },
                    warn: function(v) {
                        return Helpers.warnTrailingDot(v, 'target', ['@']);
                    }
                }
            ],
            multiValue: false,
            formatValue: function(parts) { return parts.priority + ' ' + parts.target; },
            parseValue: function(value) {
                const match = value.match(/^(\d+)\s+(.+)$/);
                if (!match) return { priority: '', target: value };
                return { priority: match[1], target: match[2] };
            }
        },

        TXT: {
            tier: TIERS.FULL,
            get label() { return I18n.t('types.TXT.label'); },
            get description() { return I18n.t('types.TXT.description'); },
            fields: [
                {
                    id: 'value',
                    get label() { return I18n.t('types.TXT.fields.value.label'); },
                    type: 'textarea',
                    required: true,
                    placeholder: '"v=spf1 include:_spf.google.com ~all"',
                    get help() { return I18n.t('types.TXT.fields.value.help'); },
                    validate: function(v) {
                        if (!v || v.trim().length === 0) {
                            return { field: 'value', message: I18n.t('types.TXT.validate.empty') };
                        }
                        if (v.length > 4096) {
                            return { field: 'value', message: I18n.t('types.TXT.validate.tooLong') };
                        }
                        // Reject ASCII control characters 0-8, 14-31 (allow tab=9, newline=10, CR=13)
                        for (let i = 0; i < v.length; i++) {
                            const code = v.charCodeAt(i);
                            if ((code >= 0 && code <= 8) || (code >= 14 && code <= 31)) {
                                return { field: 'value', message: I18n.t('types.TXT.validate.controlChars') };
                            }
                        }
                        return null;
                    },
                    warn: function(v) {
                        if (!v) return null;
                        const unquoted = v.replace(/^"|"$/g, '');
                        if (unquoted.indexOf('v=spf1') === 0) {
                            return { field: 'value', message: I18n.t('types.TXT.warnings.spf') };
                        }
                        if (unquoted.indexOf('v=DKIM1') === 0) {
                            return { field: 'value', message: I18n.t('types.TXT.warnings.dkim') };
                        }
                        if (unquoted.indexOf('v=DMARC1') === 0) {
                            return { field: 'value', message: I18n.t('types.TXT.warnings.dmarc') };
                        }
                        return null;
                    }
                }
            ],
            multiValue: false,
            formatValue: function(parts) {
                let val = parts.value;
                // Already properly quoted: starts and ends with "
                if (val.charAt(0) === '"' && val.charAt(val.length - 1) === '"') {
                    return val;
                }
                // Escape backslashes and quotes, then wrap
                val = val.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
                return '"' + val + '"';
            },
            warnings: function(value) {
                const w = [];
                const unquoted = value.replace(/^"|"$/g, '');
                if (unquoted.indexOf('v=spf1') === 0) {
                    w.push(I18n.t('types.TXT.warnings.spf'));
                }
                if (unquoted.indexOf('v=DKIM1') === 0) {
                    w.push(I18n.t('types.TXT.warnings.dkim'));
                }
                if (unquoted.indexOf('v=DMARC1') === 0) {
                    w.push(I18n.t('types.TXT.warnings.dmarc'));
                }
                return w;
            }
        },

        SRV: {
            tier: TIERS.FULL,
            get label() { return I18n.t('types.SRV.label'); },
            get description() { return I18n.t('types.SRV.description'); },
            get nameHelp() { return I18n.t('types.SRV.nameHelp'); },
            fields: [
                {
                    id: 'priority',
                    get label() { return I18n.t('types.SRV.fields.priority.label'); },
                    type: 'number',
                    required: true,
                    min: 0,
                    max: 65535,
                    placeholder: '10'
                },
                {
                    id: 'weight',
                    get label() { return I18n.t('types.SRV.fields.weight.label'); },
                    type: 'number',
                    required: true,
                    min: 0,
                    max: 65535,
                    placeholder: '0',
                    get help() { return I18n.t('types.SRV.fields.weight.help'); }
                },
                {
                    id: 'port',
                    get label() { return I18n.t('types.SRV.fields.port.label'); },
                    type: 'number',
                    required: true,
                    min: 0,
                    max: 65535,
                    placeholder: '443'
                },
                {
                    id: 'target',
                    get label() { return I18n.t('types.SRV.fields.target.label'); },
                    type: 'text',
                    required: true,
                    placeholder: 'sip.example.com.',
                    get help() { return I18n.t('types.SRV.fields.target.help'); },
                    validate: function(v) {
                        return Helpers.validateHostnameTarget(v, 'SRV', 'target', { specialValues: ['.'], rejectIP: false });
                    },
                    warn: function(v) {
                        return Helpers.warnTrailingDot(v, 'target', ['.']);
                    }
                }
            ],
            multiValue: false,
            formatValue: function(parts) { return parts.priority + ' ' + parts.weight + ' ' + parts.port + ' ' + parts.target; },
            parseValue: function(value) {
                const p = value.split(/\s+/);
                return {
                    priority: p[0] || '',
                    weight: p[1] || '',
                    port: p[2] || '',
                    target: p[3] || ''
                };
            },
            validateName: function(name) {
                if (name === '@' || name === '') return null;
                if (!/^_[a-zA-Z0-9-]+\._[a-zA-Z]+(\..*)?$/.test(name)) { // eslint-disable-line security/detect-unsafe-regex
                    return { field: 'name', message: I18n.t('types.SRV.validate.nameFormat') };
                }
                return null;
            }
        },

        CAA: {
            tier: TIERS.FULL,
            get label() { return I18n.t('types.CAA.label'); },
            get description() { return I18n.t('types.CAA.description'); },
            fields: [
                {
                    id: 'flags',
                    get label() { return I18n.t('types.CAA.fields.flags.label'); },
                    type: 'number',
                    required: true,
                    min: 0,
                    max: 255,
                    placeholder: '0',
                    get help() { return I18n.t('types.CAA.fields.flags.help'); }
                },
                {
                    id: 'tag',
                    get label() { return I18n.t('types.CAA.fields.tag.label'); },
                    type: 'select',
                    required: true,
                    options: [
                        { value: 'issue', get label() { return I18n.t('types.CAA.options.issue'); } },
                        { value: 'issuewild', get label() { return I18n.t('types.CAA.options.issuewild'); } },
                        { value: 'iodef', get label() { return I18n.t('types.CAA.options.iodef'); } },
                        { value: 'contactemail', get label() { return I18n.t('types.CAA.options.contactemail'); } },
                        { value: 'contactphone', get label() { return I18n.t('types.CAA.options.contactphone'); } }
                    ]
                },
                {
                    id: 'cavalue',
                    get label() { return I18n.t('types.CAA.fields.cavalue.label'); },
                    type: 'text',
                    required: true,
                    placeholder: 'letsencrypt.org',
                    get help() { return I18n.t('types.CAA.fields.cavalue.help'); },
                    warn: function(v) {
                        if (!v || !v.trim()) return null;
                        // Tag-specific hints (tag context read from sibling field)
                        // This warn is called with the raw value; tag context
                        // is handled by the form renderer which passes sibling data
                        if (v.indexOf('://') !== -1) {
                            return { field: 'cavalue', message: I18n.t('types.CAA.warn.issueLooksLikeUrl') };
                        }
                        if (v.indexOf('@') !== -1 && v.indexOf('mailto:') !== 0) {
                            return { field: 'cavalue', message: I18n.t('types.CAA.warn.issueContainsAt') };
                        }
                        return null;
                    }
                }
            ],
            multiValue: false,
            formatValue: function(parts) {
                const escaped = parts.cavalue.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
                return parts.flags + ' ' + parts.tag + ' "' + escaped + '"';
            },
            parseValue: function(value) {
                const match = value.match(/^(\d+)\s+(\S+)\s+"?([^"]*)"?$/);
                if (!match) return { flags: '0', tag: 'issue', cavalue: value };
                return { flags: match[1], tag: match[2], cavalue: match[3] };
            }
        },

        // --- Tier 2: Basic validation + textarea ---

        NS: {
            tier: TIERS.BASIC,
            get label() { return I18n.t('types.NS.label'); },
            get description() { return I18n.t('types.NS.description'); },
            get hint() { return I18n.t('types.NS.hint'); },
            validate: function(value) {
                return Helpers.validateHostnameTarget(value, 'NS', 'value', { returnArray: true });
            },
            warn: function(value) {
                return Helpers.warnTrailingDot(value, 'value', []);
            }
        },

        PTR: {
            tier: TIERS.BASIC,
            get label() { return I18n.t('types.PTR.label'); },
            get description() { return I18n.t('types.PTR.description'); },
            get hint() { return I18n.t('types.PTR.hint'); },
            validate: function(value) {
                return Helpers.validateHostnameTarget(value, 'PTR', 'value', { rejectIP: false, returnArray: true });
            },
            warn: function(value) {
                return Helpers.warnTrailingDot(value, 'value', []);
            }
        },

        ALIAS: {
            tier: TIERS.BASIC,
            singleValue: true,
            get label() { return I18n.t('types.ALIAS.label'); },
            get description() { return I18n.t('types.ALIAS.description'); },
            get hint() { return I18n.t('types.ALIAS.hint'); },
            validate: function(value) {
                return Helpers.validateHostnameTarget(value, 'ALIAS', 'value', { returnArray: true });
            },
            warn: function(value) {
                return Helpers.warnTrailingDot(value, 'value', []);
            }
        },

        DNAME: {
            tier: TIERS.BASIC,
            singleValue: true,
            get label() { return I18n.t('types.DNAME.label'); },
            get description() { return I18n.t('types.DNAME.description'); },
            get hint() { return I18n.t('types.DNAME.hint'); },
            validate: function(value) {
                return Helpers.validateHostnameTarget(value, 'DNAME', 'value', { rejectIP: false, returnArray: true });
            },
            warn: function(value) {
                return Helpers.warnTrailingDot(value, 'value', []);
            }
        },

        SSHFP: {
            tier: TIERS.BASIC,
            get label() { return I18n.t('types.SSHFP.label'); },
            get description() { return I18n.t('types.SSHFP.description'); },
            get hint() { return I18n.t('types.SSHFP.hint'); },
            validate: function(value) {
                const parts = value.trim().split(/\s+/);
                if (parts.length !== 3) {
                    return [{ field: 'value', message: I18n.t('types.SSHFP.validate.fieldCount') }];
                }
                const algo = parseInt(parts[0], 10);
                const fptype = parseInt(parts[1], 10);
                const fp = parts[2];
                if (![1, 2, 3, 4, 6].includes(algo)) {
                    return [{ field: 'value', message: I18n.t('types.SSHFP.validate.algorithm') }];
                }
                if (![1, 2].includes(fptype)) {
                    return [{ field: 'value', message: I18n.t('types.SSHFP.validate.fpType') }];
                }
                if (!Helpers.isValidHex(fp)) {
                    return [{ field: 'value', message: I18n.t('types.SSHFP.validate.fpHex') }];
                }
                const expectedLen = fptype === 1 ? 40 : 64;
                if (fp.length !== expectedLen) {
                    return [{ field: 'value', message: I18n.t('types.SSHFP.validate.fpLength', { expected: expectedLen, hash: fptype === 1 ? 'SHA-1' : 'SHA-256' }) }];
                }
                return [];
            }
        },

        TLSA: {
            tier: TIERS.BASIC,
            get label() { return I18n.t('types.TLSA.label'); },
            get description() { return I18n.t('types.TLSA.description'); },
            get hint() { return I18n.t('types.TLSA.hint'); },
            validate: function(value) {
                const parts = value.trim().split(/\s+/);
                if (parts.length !== 4) {
                    return [{ field: 'value', message: I18n.t('types.TLSA.validate.fieldCount') }];
                }
                const usage = parseInt(parts[0], 10);
                const selector = parseInt(parts[1], 10);
                const matching = parseInt(parts[2], 10);
                const data = parts[3];
                if (usage < 0 || usage > 3) {
                    return [{ field: 'value', message: I18n.t('types.TLSA.validate.usage') }];
                }
                if (selector < 0 || selector > 1) {
                    return [{ field: 'value', message: I18n.t('types.TLSA.validate.selector') }];
                }
                if (matching < 0 || matching > 2) {
                    return [{ field: 'value', message: I18n.t('types.TLSA.validate.matching') }];
                }
                if (!Helpers.isValidHex(data)) {
                    return [{ field: 'value', message: I18n.t('types.TLSA.validate.certHex') }];
                }
                if (matching === 1 && data.length !== 64) {
                    return [{ field: 'value', message: I18n.t('types.TLSA.validate.sha256Length') }];
                }
                if (matching === 2 && data.length !== 128) {
                    return [{ field: 'value', message: I18n.t('types.TLSA.validate.sha512Length') }];
                }
                return [];
            },
            validateName: function(name) {
                if (name === '@' || name === '') return null;
                if (!/^_\d+\._[a-zA-Z]+(\..*)?$/.test(name)) { // eslint-disable-line security/detect-unsafe-regex
                    return { field: 'name', message: I18n.t('types.TLSA.validate.nameFormat') };
                }
                return null;
            }
        },

        DS: {
            tier: TIERS.BASIC,
            get label() { return I18n.t('types.DS.label'); },
            get description() { return I18n.t('types.DS.description'); },
            get hint() { return I18n.t('types.DS.hint'); },
            validate: function(value) {
                const parts = value.trim().split(/\s+/);
                if (parts.length !== 4) {
                    return [{ field: 'value', message: I18n.t('types.DS.validate.fieldCount') }];
                }
                const keytag = parseInt(parts[0], 10);
                const algorithm = parseInt(parts[1], 10);
                const digestType = parseInt(parts[2], 10);
                const digest = parts[3];
                if (isNaN(keytag) || keytag < 0 || keytag > 65535) {
                    return [{ field: 'value', message: I18n.t('types.DS.validate.keytagRange') }];
                }
                // IANA DNSSEC Algorithm Numbers
                // https://www.iana.org/assignments/dns-sec-alg-numbers/
                if (isNaN(algorithm) || ![3, 5, 6, 7, 8, 10, 12, 13, 14, 15, 16].includes(algorithm)) {
                    return [{ field: 'value', message: I18n.t('types.DS.validate.algorithm') }];
                }
                // IANA DS Digest Algorithms: 1=SHA-1, 2=SHA-256, 4=SHA-384
                // https://www.iana.org/assignments/ds-rr-types/
                if (isNaN(digestType) || ![1, 2, 4].includes(digestType)) {
                    return [{ field: 'value', message: I18n.t('types.DS.validate.digestType') }];
                }
                if (!Helpers.isValidHex(digest)) {
                    return [{ field: 'value', message: I18n.t('types.DS.validate.digestHex') }];
                }
                // Validate digest length per digest type
                const expectedLengths = { 1: 40, 2: 64, 4: 96 };
                if (digest.length !== expectedLengths[digestType]) {
                    return [{ field: 'value', message: I18n.t('types.DS.validate.digestLength', { expected: expectedLengths[digestType], type: digestType === 1 ? 'SHA-1' : digestType === 2 ? 'SHA-256' : 'SHA-384' }) }];
                }
                return [];
            }
        },

        // --- Tier 3: Raw textarea, no client validation ---

        SOA: {
            tier: TIERS.RAW,
            get label() { return I18n.t('types.SOA.label'); },
            get description() { return I18n.t('types.SOA.description'); },
            get hint() { return I18n.t('types.SOA.hint'); },
            readOnly: true
        },

        CDS: { tier: TIERS.RAW, get label() { return I18n.t('types.CDS.label'); }, get description() { return I18n.t('types.CDS.description'); }, get hint() { return I18n.t('types.CDS.hint'); } },
        HTTPS: { tier: TIERS.RAW, get label() { return I18n.t('types.HTTPS.label'); }, get description() { return I18n.t('types.HTTPS.description'); }, get hint() { return I18n.t('types.HTTPS.hint'); } },
        SVCB: { tier: TIERS.RAW, get label() { return I18n.t('types.SVCB.label'); }, get description() { return I18n.t('types.SVCB.description'); }, get hint() { return I18n.t('types.SVCB.hint'); } },
        KEY: { tier: TIERS.RAW, get label() { return I18n.t('types.KEY.label'); }, get description() { return I18n.t('types.KEY.description'); }, get hint() { return I18n.t('types.KEY.hint'); } },
        OPENPGPKEY: { tier: TIERS.RAW, get label() { return I18n.t('types.OPENPGPKEY.label'); }, get description() { return I18n.t('types.OPENPGPKEY.description'); }, get hint() { return I18n.t('types.OPENPGPKEY.hint'); } },
        RP: { tier: TIERS.RAW, get label() { return I18n.t('types.RP.label'); }, get description() { return I18n.t('types.RP.description'); }, get hint() { return I18n.t('types.RP.hint'); } },
        SPF: { tier: TIERS.RAW, get label() { return I18n.t('types.SPF.label'); }, get description() { return I18n.t('types.SPF.description'); }, get hint() { return I18n.t('types.SPF.hint'); }, deprecated: true },
        WKS: { tier: TIERS.RAW, get label() { return I18n.t('types.WKS.label'); }, get description() { return I18n.t('types.WKS.description'); }, get hint() { return I18n.t('types.WKS.hint'); }, deprecated: true },
        LOC: { tier: TIERS.RAW, get label() { return I18n.t('types.LOC.label'); }, get description() { return I18n.t('types.LOC.description'); }, get hint() { return I18n.t('types.LOC.hint'); } },
        NAPTR: { tier: TIERS.RAW, get label() { return I18n.t('types.NAPTR.label'); }, get description() { return I18n.t('types.NAPTR.description'); }, get hint() { return I18n.t('types.NAPTR.hint'); } }
    };

    /**
     * Get the definition for a record type.
     * Returns null for unknown types.
     */
    function get(type) {
        return definitions[type] || null;
    }

    /**
     * Get all type names grouped by tier.
     */
    function byTier() {
        const result = { 1: [], 2: [], 3: [] };
        Object.keys(definitions).forEach(function(type) {
            result[definitions[type].tier].push(type);
        });
        return result;
    }

    /**
     * Get all known type names sorted alphabetically.
     */
    function allTypes() {
        return Object.keys(definitions).sort();
    }

    /**
     * Check if a type has a dedicated form (Tier 1).
     */
    function hasDedicatedForm(type) {
        const def = definitions[type];
        return def && def.tier === TIERS.FULL;
    }

    /**
     * Check if a type is read-only (e.g., SOA).
     */
    function isReadOnly(type) {
        const def = definitions[type];
        return def && def.readOnly === true;
    }

    /**
     * Check if a type is deprecated.
     */
    function isDeprecated(type) {
        const def = definitions[type];
        return def && def.deprecated === true;
    }

    return { get: get, byTier: byTier, allTypes: allTypes, hasDedicatedForm: hasDedicatedForm, isReadOnly: isReadOnly, isDeprecated: isDeprecated, TIERS: TIERS };
})();
