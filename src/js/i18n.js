const I18n = (function() {
    'use strict';

    const SUPPORTED = ['en', 'fr'];
    const DEFAULT_LANG = 'en';
    const STORAGE_KEY = 'gandi_lang';
    const I18N_FILES = { en: 'en.json', fr: 'fr.json' };

    let translations = {};
    let currentLang = DEFAULT_LANG;

    function detect() {
        const lang = navigator.language.slice(0, 2).toLowerCase();
        return SUPPORTED.includes(lang) ? lang : DEFAULT_LANG;
    }

    async function load(lang) {
        if (!SUPPORTED.includes(lang)) {
            lang = DEFAULT_LANG;
        }
        try {
            const resp = await fetch('i18n/' + I18N_FILES[lang]);
            if (!resp.ok) {
                throw new Error('HTTP ' + resp.status);
            }
            const data = await resp.json();
            if (typeof data !== 'object' || data === null || Array.isArray(data)) {
                throw new Error('Invalid translations format');
            }
            translations = data;
            currentLang = lang;
            localStorage.setItem(STORAGE_KEY, lang);
            document.documentElement.lang = lang;
            State.set('language', lang);
        } catch (err) {
            console.warn('Failed to load translations for ' + lang + ':', err.message);
            if (lang !== DEFAULT_LANG) {
                await load(DEFAULT_LANG);
            }
        }
    }

    function t(key, params) {
        let str = translations[key] || key;
        if (params) {
            Object.entries(params).forEach(([k, v]) => {
                str = str.replaceAll('{' + k + '}', String(v));
            });
        }
        return str;
    }

    function lang() {
        return currentLang;
    }

    function supported() {
        return SUPPORTED;
    }

    function translateDOM() {
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            const translated = t(key);
            if (translated !== key) {
                el.textContent = translated;
            }
        });
        document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            const key = el.getAttribute('data-i18n-placeholder');
            const translated = t(key);
            if (translated !== key) {
                el.placeholder = translated;
            }
        });
        document.querySelectorAll('[data-i18n-aria-label]').forEach(el => {
            const key = el.getAttribute('data-i18n-aria-label');
            const translated = t(key);
            if (translated !== key) {
                el.setAttribute('aria-label', translated);
            }
        });
        document.querySelectorAll('[data-i18n-title]').forEach(el => {
            const key = el.getAttribute('data-i18n-title');
            const translated = t(key);
            if (translated !== key) {
                el.title = translated;
            }
        });
    }

    async function switchLang(lang) {
        await load(lang);
        translateDOM();
    }

    async function init() {
        const saved = localStorage.getItem(STORAGE_KEY);
        await load(saved || detect());
        translateDOM();
    }

    return { init, load, t, lang, supported, switchLang, translateDOM };
})();
