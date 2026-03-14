import globals from 'globals';
import security from 'eslint-plugin-security';

const MODULE_NAMES = [
    'State', 'Helpers', 'API', 'UI', 'I18n', 'Validation', 'Auth',
    'Domains', 'RecordTypes', 'Records', 'DNSSEC', 'Nameservers', 'History', 'App',
];


export default [
    {
        files: ['src/js/**/*.js'],
        languageOptions: {
            ecmaVersion: 2020,
            sourceType: 'script',
            globals: {
                ...globals.browser,
                ...Object.fromEntries(MODULE_NAMES.map(n => [n, 'writable'])),
            },
        },
        plugins: {
            security,
        },
        rules: {
            'security/detect-object-injection': 'off',
            'security/detect-non-literal-fs-filename': 'off',
            'security/detect-unsafe-regex': 'warn',

            'no-var': 'error',
            'prefer-const': 'warn',
            'eqeqeq': ['warn', 'always'],
            'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^(' + MODULE_NAMES.join('|') + ')$' }],
            'no-undef': 'error',
            'no-console': ['warn', { allow: ['warn', 'error'] }],
        },
    },
    {
        files: ['src/test/**/*.js'],
        languageOptions: {
            ecmaVersion: 2020,
            sourceType: 'module',
            globals: {
                ...globals.node,
            },
        },
        rules: {
            'no-unused-vars': 'off',
            'no-console': 'off',
        },
    },
];
