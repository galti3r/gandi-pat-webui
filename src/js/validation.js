/**
 * Validation — DNS record validation engine.
 * Part of Gandi DNS WebUI.
 */
const Validation = (function() {
    'use strict';

    const MIN_TTL = 300;
    const MAX_TTL = 2592000;

    /**
     * Validate a complete record before creation/update.
     * Returns an array of { field, message } errors. Empty array = valid.
     */
    function validateRecord(record, existingRecords, zoneName) {
        let errors = [];

        errors = errors.concat(validateName(record.name, record.type, zoneName));
        errors = errors.concat(validateTTL(record.ttl));
        errors = errors.concat(validateType(record.type, record.name, record.values, existingRecords));

        return errors;
    }

    /**
     * Validate the record name.
     */
    function validateName(name, type, zoneName) {
        const errors = [];

        if (name === undefined || name === null) {
            return [{ field: 'name', message: I18n.t('validation.nameRequired') }];
        }

        const normalizedName = String(name).trim();

        // '@' is valid (apex)
        if (normalizedName === '@' || normalizedName === '') {
            // CNAME at apex is forbidden (RFC 1034)
            if (type === 'CNAME') {
                errors.push({ field: 'name', message: I18n.t('validation.cnameAtApex') });
            }
            return errors;
        }

        // Wildcard validation
        if (normalizedName.indexOf('*') !== -1) {
            if (normalizedName !== '*' && !normalizedName.match(/^\*\./)) {
                errors.push({ field: 'name', message: I18n.t('validation.wildcardLeftmost') });
            }
            if ((normalizedName.match(/\*/g) || []).length > 1) {
                errors.push({ field: 'name', message: I18n.t('validation.wildcardMultiLevel') });
            }
            // DNAME wildcard is prohibited (RFC 6672)
            if (type === 'DNAME') {
                errors.push({ field: 'name', message: I18n.t('validation.wildcardDNAME') });
            }
        }

        // Label validation
        const labels = normalizedName.replace(/\.$/, '').split('.');
        for (let i = 0; i < labels.length; i++) {
            const label = labels[i];
            if (label === '*') continue; // wildcard label OK

            if (label.length === 0) {
                errors.push({ field: 'name', message: I18n.t('validation.emptyLabel') });
                break;
            }
            if (label.length > 63) {
                errors.push({ field: 'name', message: I18n.t('validation.labelTooLong', {label: Helpers.truncate(label, 20)}) });
            }
            // LDH rule: letters, digits, hyphens, underscores (for SRV/TLSA/DKIM etc.)
            if (!/^[a-zA-Z0-9_]([a-zA-Z0-9_-]*[a-zA-Z0-9_])?$/.test(label)) { // eslint-disable-line security/detect-unsafe-regex
                errors.push({ field: 'name', message: I18n.t('validation.labelInvalidChars', {label: label}) });
            }
        }

        // Total FQDN length (name + zone name)
        const fqdn = normalizedName + '.' + (zoneName || '');
        if (fqdn.length > 253) {
            errors.push({ field: 'name', message: I18n.t('validation.fqdnTooLong', {length: fqdn.length}) });
        }

        // Type-specific name validation
        const typeDef = RecordTypes.get(type);
        if (typeDef && typeDef.validateName) {
            const nameError = typeDef.validateName(normalizedName);
            if (nameError) errors.push(nameError);
        }

        return errors;
    }

    /**
     * Validate TTL value.
     */
    function validateTTL(ttl) {
        if (ttl === undefined || ttl === null || ttl === '') {
            return []; // TTL is optional (API uses default)
        }

        const value = Number(ttl);
        if (!Number.isFinite(value) || !Number.isInteger(value)) {
            return [{ field: 'ttl', message: I18n.t('validation.ttlNotInteger') }];
        }
        if (value < MIN_TTL) {
            return [{ field: 'ttl', message: I18n.t('validation.ttlMin', {min: MIN_TTL}) }];
        }
        if (value > MAX_TTL) {
            return [{ field: 'ttl', message: I18n.t('validation.ttlMax', {max: MAX_TTL}) }];
        }
        return [];
    }

    /**
     * Validate record type-specific rules and cross-record checks.
     */
    function validateType(type, name, values, existingRecords) {
        let errors = [];

        if (!values || values.length === 0) {
            return [{ field: 'value', message: I18n.t('validation.valueRequired') }];
        }

        // --- Per-value type validation ---
        const typeDef = RecordTypes.get(type);

        if (typeDef && typeDef.tier === RecordTypes.TIERS.FULL && typeDef.fields) {
            // Tier 1: use field-level validators on each value
            for (let i = 0; i < values.length; i++) {
                const val = values[i];
                if (typeDef.parseValue) {
                    const parts = typeDef.parseValue(val);
                    for (let f = 0; f < typeDef.fields.length; f++) {
                        const field = typeDef.fields[f];
                        const partValue = parts[field.id];
                        if (field.required && (!partValue || String(partValue).trim() === '')) {
                            errors.push({ field: field.id, message: I18n.t('validation.fieldRequired', { label: field.label }) });
                        } else if (field.validate && partValue) {
                            const fieldError = field.validate(partValue);
                            if (fieldError) {
                                errors.push(fieldError);
                            }
                        }
                    }
                } else {
                    // No parseValue: validate directly via field validators
                    if (!val || String(val).trim() === '') {
                        errors.push({ field: 'value', message: I18n.t('validation.valueEmpty') });
                    } else {
                        for (let f2 = 0; f2 < typeDef.fields.length; f2++) {
                            const field2 = typeDef.fields[f2];
                            if (field2.validate) {
                                const fieldError2 = field2.validate(val);
                                if (fieldError2) {
                                    errors.push(fieldError2);
                                }
                            }
                        }
                    }
                }
            }
        } else if (typeDef && typeDef.tier === RecordTypes.TIERS.BASIC && typeDef.validate) {
            // Tier 2: use type-level validator on each value
            for (let i = 0; i < values.length; i++) {
                const valErrors = typeDef.validate(values[i]);
                errors = errors.concat(valErrors);
            }
        }
        // Tier 3: no validation

        // --- Cross-record checks ---
        if (existingRecords && existingRecords.length > 0) {
            errors = errors.concat(checkCNAMEExclusivity(type, name, existingRecords));
            errors = errors.concat(checkALIASExclusivity(type, name, existingRecords));
            errors = errors.concat(checkDNAMEConflicts(type, name, existingRecords));
            errors = errors.concat(checkDuplicates(type, name, values, existingRecords));

            if (type === 'CNAME') {
                errors = errors.concat(checkCNAMECircular(name, values[0], existingRecords));
            }
        }

        // Single-value types: CNAME, ALIAS, DNAME must have exactly one value
        if (values.length > 1) {
            if (type === 'CNAME') {
                errors.push({ field: 'value', message: I18n.t('validation.cnameOneValue') });
            } else if (typeDef && typeDef.singleValue && (type === 'ALIAS' || type === 'DNAME')) {
                errors.push({ field: 'value', message: I18n.t('validation.singleValueOnly', { type: type }) });
            }
        }

        return errors;
    }

    /**
     * CNAME exclusivity check (RFC 1034, RFC 2181).
     * A CNAME cannot coexist with any other record type at the same name.
     */
    function checkCNAMEExclusivity(type, name, existingRecords) {
        const normalizedName = normalizeName(name);

        if (type === 'CNAME') {
            // Creating a CNAME: check no other types exist at this name
            const conflicting = existingRecords.filter((r) => {
                return normalizeName(r.rrset_name) === normalizedName &&
                       r.rrset_type !== 'CNAME' &&
                       r.rrset_type !== 'RRSIG' &&
                       r.rrset_type !== 'NSEC' &&
                       r.rrset_type !== 'NSEC3';
            });
            if (conflicting.length > 0) {
                const types = conflicting.map((r) => r.rrset_type).join(', ');
                return [{ field: 'type', message: I18n.t('validation.cnameConflict', {name: name, types: types}) }];
            }
        } else {
            // Creating a non-CNAME: check no CNAME exists at this name
            const cnameExists = existingRecords.some((r) => {
                return normalizeName(r.rrset_name) === normalizedName &&
                       r.rrset_type === 'CNAME';
            });
            if (cnameExists) {
                return [{ field: 'type', message: I18n.t('validation.cnameExists', {type: type, name: name}) }];
            }
        }

        return [];
    }

    /**
     * ALIAS exclusivity check.
     * ALIAS behaves like CNAME at apex — cannot coexist with other
     * record types at the same name (except DNSSEC types).
     */
    function checkALIASExclusivity(type, name, existingRecords) {
        const normalizedName = normalizeName(name);

        if (type === 'ALIAS') {
            const conflicting = existingRecords.filter((r) => {
                return normalizeName(r.rrset_name) === normalizedName &&
                       r.rrset_type !== 'ALIAS' &&
                       r.rrset_type !== 'RRSIG' &&
                       r.rrset_type !== 'NSEC' &&
                       r.rrset_type !== 'NSEC3';
            });
            if (conflicting.length > 0) {
                const types = conflicting.map((r) => r.rrset_type).join(', ');
                return [{ field: 'type', message: I18n.t('validation.aliasConflict', {name: name, types: types}) }];
            }
        } else if (type !== 'RRSIG' && type !== 'NSEC' && type !== 'NSEC3') {
            const aliasExists = existingRecords.some((r) => {
                return normalizeName(r.rrset_name) === normalizedName &&
                       r.rrset_type === 'ALIAS';
            });
            if (aliasExists) {
                return [{ field: 'type', message: I18n.t('validation.aliasExists', {type: type, name: name}) }];
            }
        }

        return [];
    }

    /**
     * DNAME conflict checks (RFC 6672).
     * DNAME cannot coexist with CNAME at the same name.
     */
    function checkDNAMEConflicts(type, name, existingRecords) {
        const normalizedName = normalizeName(name);

        if (type === 'DNAME') {
            const cnameExists = existingRecords.some((r) => {
                return normalizeName(r.rrset_name) === normalizedName &&
                       r.rrset_type === 'CNAME';
            });
            if (cnameExists) {
                return [{ field: 'type', message: I18n.t('validation.dnameConflictCname') }];
            }

            // Warn about shadowed child records
            const childRecords = existingRecords.filter((r) => {
                const rName = normalizeName(r.rrset_name);
                return rName !== normalizedName &&
                       rName.endsWith('.' + normalizedName);
            });
            if (childRecords.length > 0) {
                return [{ field: 'name', message: I18n.t('validation.dnameShadow', {name: name, count: childRecords.length}) }];
            }
        }

        if (type === 'CNAME') {
            const dnameExists = existingRecords.some((r) => {
                return normalizeName(r.rrset_name) === normalizedName &&
                       r.rrset_type === 'DNAME';
            });
            if (dnameExists) {
                return [{ field: 'type', message: I18n.t('validation.cnameConflictDname') }];
            }
        }

        return [];
    }

    /**
     * Duplicate detection.
     * Warn if an identical name+type+value already exists.
     */
    function checkDuplicates(type, name, values, existingRecords) {
        const normalizedName = normalizeName(name);
        const errors = [];

        const sameNameType = existingRecords.filter((r) => {
            return normalizeName(r.rrset_name) === normalizedName &&
                   r.rrset_type === type;
        });

        if (sameNameType.length > 0) {
            for (let i = 0; i < values.length; i++) {
                const val = values[i].toLowerCase().trim();
                for (let j = 0; j < sameNameType.length; j++) {
                    const existingValues = sameNameType[j].rrset_values || [];
                    for (let k = 0; k < existingValues.length; k++) {
                        if (existingValues[k].toLowerCase().trim() === val) {
                            errors.push({ field: 'name', message: I18n.t('validation.duplicate', {type: type, name: name}) });
                        }
                    }
                }
            }
        }

        // SPF uniqueness check
        if (type === 'TXT') {
            const existingSPF = existingRecords.filter((r) => {
                return normalizeName(r.rrset_name) === normalizedName &&
                       r.rrset_type === 'TXT' &&
                       r.rrset_values &&
                       r.rrset_values.some((v) => v.replace(/^"|"$/g, '').indexOf('v=spf1') === 0);
            });
            const newIsSPF = values.some((v) => v.replace(/^"|"$/g, '').indexOf('v=spf1') === 0);
            if (newIsSPF && existingSPF.length > 0) {
                errors.push({ field: 'value', message: I18n.t('validation.spfDuplicate') });
            }
        }

        return errors;
    }

    /**
     * CNAME circular chain detection.
     * Detects loops in CNAME chains within the current zone.
     */
    function checkCNAMECircular(name, targetValue, existingRecords) {
        if (!targetValue) return [];

        // Build CNAME map: name → target
        const cnameMap = {};
        existingRecords.forEach((r) => {
            if (r.rrset_type === 'CNAME' && r.rrset_values && r.rrset_values.length > 0) {
                cnameMap[normalizeName(r.rrset_name)] = normalizeName(r.rrset_values[0]);
            }
        });

        // Add the proposed record
        const startName = normalizeName(name);
        cnameMap[startName] = normalizeName(targetValue);

        // Follow the chain, detect cycle
        const visited = {};
        let current = startName;
        let depth = 0;
        const maxDepth = 20;

        while (cnameMap[current] && depth < maxDepth) {
            if (visited[current]) {
                return [{ field: 'value', message: I18n.t('validation.cnameCircular') }];
            }
            visited[current] = true;
            current = cnameMap[current];
            depth++;
        }

        if (depth >= 8) {
            return [{ field: 'value', message: I18n.t('validation.cnameChainDeep', {depth: depth}) }];
        }

        return [];
    }

    /**
     * Normalize a record name for comparison.
     */
    function normalizeName(name) {
        if (!name) return '@';
        let n = String(name).toLowerCase().trim();
        // Remove trailing dot
        if (n.charAt(n.length - 1) === '.') {
            n = n.substring(0, n.length - 1);
        }
        if (n === '' || n === '@') return '@';
        return n;
    }

    /**
     * Validate a single field value for a Tier 1 form.
     * Used by the form renderer for inline validation.
     */
    function validateField(type, fieldId, value) {
        const typeDef = RecordTypes.get(type);
        if (!typeDef || !typeDef.fields) return null;

        const field = typeDef.fields.find((f) => f.id === fieldId);
        if (!field) return null;

        if (field.required && (!value || String(value).trim() === '')) {
            return { field: fieldId, message: I18n.t('validation.fieldRequired', {label: field.label}) };
        }

        if (field.type === 'number') {
            const num = Number(value);
            if (!Number.isInteger(num)) {
                return { field: fieldId, message: I18n.t('validation.fieldMustBeNumber', {label: field.label}) };
            }
            if (field.min !== undefined && num < field.min) {
                return { field: fieldId, message: I18n.t('validation.fieldMin', {label: field.label, min: field.min}) };
            }
            if (field.max !== undefined && num > field.max) {
                return { field: fieldId, message: I18n.t('validation.fieldMax', {label: field.label, max: field.max}) };
            }
        }

        if (field.validate) {
            return field.validate(value);
        }

        return null;
    }

    return {
        validateRecord: validateRecord,
        validateName: validateName,
        validateTTL: validateTTL,
        validateType: validateType,
        validateField: validateField,
        checkCNAMEExclusivity: checkCNAMEExclusivity,
        checkALIASExclusivity: checkALIASExclusivity,
        checkCNAMECircular: checkCNAMECircular,
        checkDuplicates: checkDuplicates,
        normalizeName: normalizeName,
        MIN_TTL: MIN_TTL,
        MAX_TTL: MAX_TTL
    };
})();
