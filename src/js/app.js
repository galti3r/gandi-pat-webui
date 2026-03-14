/**
 * App — Application bootstrap module for the Gandi DNS WebUI.
 *
 * Initializes all modules, sets up tab switching, theme toggling,
 * settings panel rendering, and status bar updates. This is the LAST
 * file loaded and the entry point called on DOMContentLoaded.
 *
 * DOM dependencies:
 *   [data-tab]              — sidebar navigation links
 *   [data-panel]            — content panel containers
 *   [data-action="toggle-theme"] — theme toggle button
 *   #content-settings       — settings panel container
 *   #status-connection      — connection status in footer
 *   #status-connection-text — connection text label
 *   #status-dot             — connection indicator dot
 *   #status-api             — API base URL display
 *   #status-refresh         — last refresh timestamp
 *
 * Module dependencies: State, Auth, Domains, Records, DNSSEC, Nameservers, API, UI
 */
const App = (function() {
    'use strict';

    // ---------------------------------------------------------------
    // Application version — displayed in the settings panel.
    // ---------------------------------------------------------------
    const APP_VERSION = '1.1.1';

    // ---------------------------------------------------------------
    // init() — Bootstrap the entire application.
    //
    // Called once on DOMContentLoaded. Initializes all modules in the
    // correct dependency order, sets up global UI behaviors (tabs,
    // theme, settings), and wires up status bar updates.
    // ---------------------------------------------------------------
    async function init() {

        // --- 1. Initialize state with defaults and restore saved token ---
        State.init();

        // --- 1bis. Reveal the correct section synchronously (before the
        //    first await) to prevent a flash of the login screen when a
        //    token is already stored. ---
        if (State.get('token')) {
            document.getElementById('app-section').classList.remove('hidden');
        } else {
            document.getElementById('auth-section').classList.remove('hidden');
        }

        // --- 1a. Initialize i18n (must complete before any UI rendering) ---
        await I18n.init();

        // --- 1b. Initialize UI (bind modal handlers on static DOM) ---
        UI.init();

        // --- 2. Initialize authentication ---
        // The onConnected callback fires after a successful login.
        Auth.init(function onConnected(firstPageResult) {
            // Fetch the domain list, passing first page data from auth
            Domains.fetchDomains(firstPageResult);

            // Update connection indicator to show connected state
            updateConnectionStatus(true);

            // Display the API base URL in the status bar
            const statusApi = document.getElementById('status-api');
            if (statusApi) {
                statusApi.textContent = API.getBaseUrl();
            }
        });

        // --- 3. Initialize feature modules ---
        Domains.init();
        Records.init();
        DNSSEC.init();
        Nameservers.init();
        History.init();

        // --- 4. Set up tab switching and hash routing ---
        setupTabSwitching();

        // --- 4b. Set up ARIA keyboard navigation for tabs ---
        setupTabKeyboardNav();

        // --- 5. Set up theme toggle ---
        setupThemeToggle();

        // --- 5b. Set up language toggle ---
        setupLangToggle();

        // --- 6. Set up settings panel ---
        setupSettingsPanel();

        // --- 7. Update status bar on data changes ---
        setupStatusBarUpdates();

        // --- 7b. Set up auto-refresh controls ---
        setupAutoRefresh();

        // --- 9. Set up global keyboard shortcuts ---
        setupKeyboardShortcuts();

        // --- 10. Set up touch swipe for tab switching on mobile ---
        setupTouchSwipe();

        // --- 8. Domain change: update status bar and auto-switch to records ---
        State.on('currentDomainChanged', domain => {
            updateDomainStatus(domain);

            // Auto-switch to the records tab when a new domain is selected,
            // unless the user is already on a content tab
            const currentTab = State.get('activeTab');
            if (currentTab === 'settings') {
                // Stay on settings — user explicitly navigated there
            } else if (domain) {
                State.set('activeTab', 'records');
            }
        });
    }

    // ===============================================================
    // TAB SWITCHING
    // ===============================================================

    // ---------------------------------------------------------------
    // setupTabSwitching() — Private: bind click handlers on sidebar
    // navigation links and subscribe to activeTabChanged for panel
    // visibility, nav link active state management, and hash sync.
    // ---------------------------------------------------------------
    function setupTabSwitching() {
        // Bind click handlers on all [data-tab] navigation links
        const tabLinks = document.querySelectorAll('[data-tab]');
        for (let i = 0; i < tabLinks.length; i++) {
            tabLinks[i].addEventListener('click', handleTabClick);
        }

        // Listen for state-driven tab changes to update the DOM and hash
        State.on('activeTabChanged', newTab => {
            activateTab(newTab);
            syncHashFromTab(newTab);
        });

        // Listen for browser back/forward navigation via hash changes
        window.addEventListener('hashchange', handleHashChange);

        // Determine initial tab: hash takes priority, then state default
        const initialTab = getTabFromHash() || State.get('activeTab') || 'records';
        State.set('activeTab', initialTab);
        activateTab(initialTab);
    }

    // ---------------------------------------------------------------
    // handleTabClick(event) — Private: click handler for [data-tab]
    // navigation links. Prevents default anchor behavior and updates
    // the activeTab state key, which triggers DOM updates via the
    // activeTabChanged listener.
    // ---------------------------------------------------------------
    function handleTabClick(event) {
        event.preventDefault();
        const tabName = this.getAttribute('data-tab');
        if (tabName) {
            State.set('activeTab', tabName);
        }
    }

    // ===============================================================
    // HASH ROUTING
    // ===============================================================

    // ---------------------------------------------------------------
    // Valid tab names — used to validate hash values and for keyboard
    // navigation ordering.
    // ---------------------------------------------------------------
    const VALID_TABS = ['records', 'dnssec', 'nameservers', 'history', 'settings'];

    // ---------------------------------------------------------------
    // getTabFromHash() — Private: read window.location.hash and return
    // the tab name if it matches a valid tab, or null otherwise.
    // ---------------------------------------------------------------
    function getTabFromHash() {
        const hash = window.location.hash.replace('#', '');
        if (VALID_TABS.indexOf(hash) !== -1) {
            return hash;
        }
        return null;
    }

    // ---------------------------------------------------------------
    // syncHashFromTab(tabName) — Private: update window.location.hash
    // to reflect the active tab, using replaceState to avoid polluting
    // the browser history on every tab click.
    // ---------------------------------------------------------------
    function syncHashFromTab(tabName) {
        if (window.location.hash !== '#' + tabName) {
            history.replaceState(null, '', '#' + tabName);
        }
    }

    // ---------------------------------------------------------------
    // handleHashChange() — Private: respond to browser back/forward
    // navigation (popstate triggers hashchange). Syncs the active tab
    // to match the new hash.
    // ---------------------------------------------------------------
    function handleHashChange() {
        const tabFromHash = getTabFromHash();
        if (tabFromHash && tabFromHash !== State.get('activeTab')) {
            State.set('activeTab', tabFromHash);
        }
    }

    // ---------------------------------------------------------------
    // activateTab(tabName) — Private: show the matching panel and
    // update navigation link active states.
    //
    // - Hides all [data-panel] elements (sets hidden attribute)
    // - Shows the panel matching the tab name
    // - Updates nav__link active class and aria-selected
    // ---------------------------------------------------------------
    function activateTab(tabName) {
        // Hide all content panels
        const panels = document.querySelectorAll('[data-panel]');
        for (let i = 0; i < panels.length; i++) {
            panels[i].hidden = true;
            panels[i].classList.remove('content-panel--active');
        }

        // Show the matching panel
        const activePanel = document.querySelector('[data-panel="' + tabName + '"]');
        if (activePanel) {
            activePanel.hidden = false;
            activePanel.classList.add('content-panel--active');
        }

        // Reset scroll position when switching tabs (important on mobile)
        const contentEl = document.getElementById('content');
        if (contentEl) {
            contentEl.scrollTop = 0;
        }

        // Update navigation link active states and tabindex
        const navLinks = document.querySelectorAll('[data-tab]');
        for (let j = 0; j < navLinks.length; j++) {
            const link = navLinks[j];
            if (link.getAttribute('data-tab') === tabName) {
                link.classList.add('nav__link--active');
                link.setAttribute('aria-selected', 'true');
                link.setAttribute('tabindex', '0');
            } else {
                link.classList.remove('nav__link--active');
                link.setAttribute('aria-selected', 'false');
                link.setAttribute('tabindex', '-1');
            }
        }
    }

    // ===============================================================
    // ARIA TABS KEYBOARD NAVIGATION
    // ===============================================================

    // ---------------------------------------------------------------
    // setupTabKeyboardNav() — Private: add keyboard navigation to the
    // sidebar tab list per WAI-ARIA tabs pattern.
    //
    // Supports:
    //   ArrowDown / ArrowRight — next tab (wraps to first)
    //   ArrowUp / ArrowLeft   — previous tab (wraps to last)
    //   Home                  — first tab
    //   End                   — last tab
    //
    // Uses "focus follows selection" — arrow keys both move focus and
    // activate the tab.
    // ---------------------------------------------------------------
    function setupTabKeyboardNav() {
        const tablist = document.querySelector('[role="tablist"]');
        if (!tablist) {
            return;
        }

        tablist.addEventListener('keydown', handleTabKeydown);
    }

    // ---------------------------------------------------------------
    // handleTabKeydown(event) — Private: keydown handler for the
    // tablist element. Determines the target tab index based on the
    // pressed key and activates it.
    // ---------------------------------------------------------------
    function handleTabKeydown(event) {
        const tabs = document.querySelectorAll('[role="tab"]');
        if (!tabs.length) {
            return;
        }

        // Find the index of the currently focused/active tab
        let currentIndex = -1;
        for (let i = 0; i < tabs.length; i++) {
            if (tabs[i] === document.activeElement) {
                currentIndex = i;
                break;
            }
        }

        // If no tab is focused, do nothing
        if (currentIndex === -1) {
            return;
        }

        let targetIndex = -1;
        const lastIndex = tabs.length - 1;

        switch (event.key) {
            case 'ArrowDown':
            case 'ArrowRight':
                // Next tab, wrap to first
                targetIndex = currentIndex < lastIndex ? currentIndex + 1 : 0;
                break;

            case 'ArrowUp':
            case 'ArrowLeft':
                // Previous tab, wrap to last
                targetIndex = currentIndex > 0 ? currentIndex - 1 : lastIndex;
                break;

            case 'Home':
                targetIndex = 0;
                break;

            case 'End':
                targetIndex = lastIndex;
                break;

            default:
                // Not a navigation key — let the event propagate normally
                return;
        }

        // Prevent default scrolling behavior for arrow/Home/End keys
        event.preventDefault();

        // Focus the target tab and activate it
        const targetTab = tabs[targetIndex];
        targetTab.focus();

        const tabName = targetTab.getAttribute('data-tab');
        if (tabName) {
            State.set('activeTab', tabName);
        }
    }

    // ===============================================================
    // THEME TOGGLE
    // ===============================================================

    // ---------------------------------------------------------------
    // setupThemeToggle() — Private: bind the theme toggle button and
    // subscribe to themeChanged for body class updates.
    // ---------------------------------------------------------------
    function setupThemeToggle() {
        // Bind click handler on the theme toggle button
        const toggleBtns = document.querySelectorAll('[data-action="toggle-theme"]');
        for (let i = 0; i < toggleBtns.length; i++) {
            toggleBtns[i].addEventListener('click', () => {
                const currentTheme = State.get('theme') || 'dark';
                const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
                State.set('theme', newTheme);
            });
        }

        // Listen for theme changes to update the body class
        State.on('themeChanged', newTheme => {
            applyTheme(newTheme);
        });

        // Apply the initial theme from state on startup
        const initialTheme = State.get('theme') || 'dark';
        applyTheme(initialTheme);
    }

    // ---------------------------------------------------------------
    // applyTheme(theme) — Private: toggle body CSS classes to match
    // the given theme ('dark' or 'light').
    // ---------------------------------------------------------------
    function applyTheme(theme) {
        if (theme === 'light') {
            document.body.classList.add('theme-light');
            document.body.classList.remove('theme-dark');
        } else {
            document.body.classList.add('theme-dark');
            document.body.classList.remove('theme-light');
        }
    }

    // ===============================================================
    // LANGUAGE TOGGLE
    // ===============================================================

    function setupLangToggle() {
        const langLabel = document.getElementById('lang-label');
        if (langLabel) {
            langLabel.textContent = I18n.lang().toUpperCase();
        }

        const toggleBtns = document.querySelectorAll('[data-action="toggle-lang"]');
        for (let i = 0; i < toggleBtns.length; i++) {
            toggleBtns[i].addEventListener('click', async () => {
                const newLang = I18n.lang() === 'en' ? 'fr' : 'en';
                await I18n.switchLang(newLang);
                if (langLabel) {
                    langLabel.textContent = newLang.toUpperCase();
                }
            });
        }
    }

    // ===============================================================
    // SETTINGS PANEL
    // ===============================================================

    // ---------------------------------------------------------------
    // setupSettingsPanel() — Private: subscribe to activeTabChanged
    // so the settings panel content is rendered when the user
    // navigates to the settings tab.
    // ---------------------------------------------------------------
    function setupSettingsPanel() {
        State.on('activeTabChanged', newTab => {
            if (newTab === 'settings') {
                renderSettingsPanel();
            }
        });

        // Re-render settings when language changes
        State.on('languageChanged', () => {
            if (State.get('activeTab') === 'settings') {
                renderSettingsPanel();
            }
        });
    }

    // ---------------------------------------------------------------
    // renderSettingsPanel() — Private: render the settings panel
    // content showing version info, storage mode, and API URL.
    // ---------------------------------------------------------------
    function renderSettingsPanel() {
        const container = document.getElementById('content-settings');
        if (!container) {
            return;
        }

        // Clear previous content
        container.textContent = '';

        // Section header
        const header = UI.createElement('div', { className: 'section-header' }, [
            UI.createElement('h2', {
                className: 'section-header__title',
                textContent: I18n.t('settings.title')
            }),
            UI.createElement('p', {
                className: 'section-header__description',
                textContent: I18n.t('settings.description')
            })
        ]);
        container.appendChild(header);

        // Settings card container
        const card = UI.createElement('div', { className: 'settings-card' });

        // --- About section ---
        const aboutSection = UI.createElement('div', { className: 'settings-section' }, [
            UI.createElement('h3', {
                className: 'settings-section__title',
                textContent: I18n.t('settings.about')
            }),
            buildSettingsRow(I18n.t('settings.application'), I18n.t('app.title')),
            buildSettingsRow(I18n.t('settings.version'), APP_VERSION),
            buildSettingsRow(I18n.t('settings.descriptionLabel'), I18n.t('settings.appDescription'))
        ]);
        card.appendChild(aboutSection);

        // --- Storage section ---
        const storageMode = State.get('storageMode') || 'session';
        let storageModeLabel = '';
        switch (storageMode) {
            case 'memory':
                storageModeLabel = I18n.t('settings.storageMemory');
                break;
            case 'session':
                storageModeLabel = I18n.t('settings.storageSession');
                break;
            case 'local':
                storageModeLabel = I18n.t('settings.storageLocal');
                break;
            default:
                storageModeLabel = storageMode;
        }

        const storageSection = UI.createElement('div', { className: 'settings-section' }, [
            UI.createElement('h3', {
                className: 'settings-section__title',
                textContent: I18n.t('settings.tokenStorage')
            }),
            buildSettingsRow(I18n.t('settings.currentMode'), storageModeLabel),
            UI.createElement('p', {
                className: 'settings-section__help',
                textContent: I18n.t('settings.storageHelp')
            })
        ]);
        card.appendChild(storageSection);

        // --- API section ---
        const apiSection = UI.createElement('div', { className: 'settings-section' }, [
            UI.createElement('h3', {
                className: 'settings-section__title',
                textContent: I18n.t('settings.apiConfig')
            }),
            buildSettingsRow(I18n.t('settings.baseUrl'), API.getBaseUrl()),
            UI.createElement('p', {
                className: 'settings-section__help',
                textContent: I18n.t('settings.apiHelp')
            })
        ]);
        card.appendChild(apiSection);

        // --- Domain info section (if a domain is selected) ---
        const currentDomain = State.get('currentDomain');
        if (currentDomain) {
            const domains = State.get('domains') || [];
            const domainSection = UI.createElement('div', { className: 'settings-section' }, [
                UI.createElement('h3', {
                    className: 'settings-section__title',
                    textContent: I18n.t('settings.currentSession')
                }),
                buildSettingsRow(I18n.t('settings.selectedDomain'), currentDomain),
                buildSettingsRow(I18n.t('settings.totalDomains'), String(domains.length))
            ]);
            card.appendChild(domainSection);
        }

        container.appendChild(card);
    }

    // ---------------------------------------------------------------
    // buildSettingsRow(label, value) — Private: create a key-value
    // row for the settings panel.
    // ---------------------------------------------------------------
    function buildSettingsRow(label, value) {
        return UI.createElement('div', { className: 'settings-row' }, [
            UI.createElement('span', {
                className: 'settings-row__label',
                textContent: label
            }),
            UI.createElement('span', {
                className: 'settings-row__value',
                textContent: value
            })
        ]);
    }

    // ===============================================================
    // STATUS BAR UPDATES
    // ===============================================================

    // ---------------------------------------------------------------
    // setupStatusBarUpdates() — Private: subscribe to state events
    // that require status bar updates (records change = refresh time).
    // ---------------------------------------------------------------
    function setupStatusBarUpdates() {
        // Update the "last refresh" timestamp when records change
        State.on('recordsChanged', () => {
            updateRefreshTimestamp();
        });

        // Also update on DNSSEC keys and nameservers refresh
        State.on('dnssecKeysChanged', () => {
            updateRefreshTimestamp();
        });

        State.on('nameserversChanged', () => {
            updateRefreshTimestamp();
        });

        // Re-translate status bar text on language change
        State.on('languageChanged', () => {
            updateRefreshTimestamp();
            const dot = document.getElementById('status-dot');
            const isConnected = dot && dot.classList.contains('status-bar__dot--connected');
            updateConnectionStatus(isConnected);
            updateDomainStatus(State.get('currentDomain'));
        });
    }

    // ---------------------------------------------------------------
    // updateRefreshTimestamp() — Private: display the current time
    // as the last data refresh time in the status bar.
    // ---------------------------------------------------------------
    function updateRefreshTimestamp() {
        const refreshEl = document.getElementById('status-refresh');
        if (!refreshEl) {
            return;
        }

        const now = new Date();
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        refreshEl.textContent = I18n.t('status.lastRefresh', {time: hours + ':' + minutes + ':' + seconds});
    }

    // ---------------------------------------------------------------
    // updateConnectionStatus(connected) — Private: update the status
    // bar connection indicator (dot color and text).
    // ---------------------------------------------------------------
    function updateConnectionStatus(connected) {
        const dot = document.getElementById('status-dot');
        const text = document.getElementById('status-connection-text');

        if (dot) {
            if (connected) {
                dot.classList.add('status-bar__dot--connected');
                dot.classList.remove('status-bar__dot--disconnected');
            } else {
                dot.classList.remove('status-bar__dot--connected');
                dot.classList.add('status-bar__dot--disconnected');
            }
        }

        if (text) {
            text.textContent = connected ? I18n.t('status.connected') : I18n.t('status.disconnected');
        }
    }

    // ---------------------------------------------------------------
    // updateDomainStatus(domain) — Private: update the status bar
    // to reflect the currently selected domain.
    // ---------------------------------------------------------------
    function updateDomainStatus(domain) {
        const statusApi = document.getElementById('status-api');
        if (statusApi) {
            if (domain) {
                statusApi.textContent = API.getBaseUrl() + ' \u2014 ' + domain;
            } else {
                statusApi.textContent = API.getBaseUrl();
            }
        }
    }

    // ===============================================================
    // AUTO-REFRESH
    // ===============================================================

    /** Timer ID for the auto-refresh interval (null when inactive). */
    let autoRefreshTimer = null;

    // ---------------------------------------------------------------
    // setupAutoRefresh() — Private: build the auto-refresh UI in the
    // status bar and wire state listeners to start/stop the timer.
    // ---------------------------------------------------------------
    function setupAutoRefresh() {
        const container = document.getElementById('status-autorefresh');
        if (!container) {
            return;
        }

        // Build UI: label + select dropdown
        const label = UI.createElement('span', {
            textContent: I18n.t('status.autoRefresh') + ':'
        });

        const select = UI.createElement('select', {
            className: 'form__select form__select--sm',
            ariaLabel: I18n.t('status.autoRefresh'),
            events: {
                change: function(e) {
                    State.set('autoRefresh', parseInt(e.target.value, 10));
                }
            }
        });

        // Available intervals: off, 30s, 1min, 5min
        const options = [
            { value: 0, label: I18n.t('status.autoRefreshOff') },
            { value: 30, label: I18n.t('status.autoRefresh30') },
            { value: 60, label: I18n.t('status.autoRefresh60') },
            { value: 300, label: I18n.t('status.autoRefresh300') }
        ];

        for (let i = 0; i < options.length; i++) {
            select.appendChild(UI.createElement('option', {
                value: String(options[i].value),
                textContent: options[i].label
            }));
        }

        container.appendChild(label);
        container.appendChild(select);

        // Respond to state-driven changes (e.g., from other code paths)
        State.on('autoRefreshChanged', function(seconds) {
            startAutoRefresh(seconds);
            // Keep select UI in sync
            select.value = String(seconds);
        });

        // Restart the timer when the active tab changes so we fetch
        // the correct data for the newly visible tab
        State.on('activeTabChanged', function() {
            const seconds = State.get('autoRefresh') || 0;
            if (seconds > 0) {
                startAutoRefresh(seconds);
            }
        });

        // Rebuild auto-refresh UI when language changes
        State.on('languageChanged', function() {
            container.textContent = '';
            const newLabel = UI.createElement('span', {
                textContent: I18n.t('status.autoRefresh') + ':'
            });
            const newSelect = UI.createElement('select', {
                className: 'form__select form__select--sm',
                ariaLabel: I18n.t('status.autoRefresh'),
                events: {
                    change: function(e) {
                        State.set('autoRefresh', parseInt(e.target.value, 10));
                    }
                }
            });
            const newOptions = [
                { value: 0, label: I18n.t('status.autoRefreshOff') },
                { value: 30, label: I18n.t('status.autoRefresh30') },
                { value: 60, label: I18n.t('status.autoRefresh60') },
                { value: 300, label: I18n.t('status.autoRefresh300') }
            ];
            for (let j = 0; j < newOptions.length; j++) {
                newSelect.appendChild(UI.createElement('option', {
                    value: String(newOptions[j].value),
                    textContent: newOptions[j].label
                }));
            }
            newSelect.value = String(State.get('autoRefresh') || 0);
            container.appendChild(newLabel);
            container.appendChild(newSelect);
        });
    }

    // ---------------------------------------------------------------
    // startAutoRefresh(seconds) — Private: (re)start the auto-refresh
    // interval. If seconds is 0 or falsy the timer is cleared.
    //
    // Guards inside the interval callback:
    //   1. Skip if a modal is open (user is interacting with a dialog)
    //   2. Skip if Records has pending optimistic operations
    //   3. Skip if no domain is selected
    // ---------------------------------------------------------------
    function startAutoRefresh(seconds) {
        if (autoRefreshTimer) {
            clearInterval(autoRefreshTimer);
            autoRefreshTimer = null;
        }

        if (!seconds || seconds <= 0) {
            return;
        }

        autoRefreshTimer = setInterval(function() {
            // Guard: skip if modal is open
            const overlay = document.getElementById('modal-overlay');
            if (overlay && overlay.classList.contains('modal-overlay--visible')) {
                return;
            }

            // Guard: skip if pending operations
            if (typeof Records !== 'undefined' && Records.hasPendingOperations()) {
                return;
            }

            // Guard: skip if no domain selected
            if (!State.get('currentDomain')) {
                return;
            }

            // Refresh the active tab's data
            const tab = State.get('activeTab');
            if (tab === 'records' && typeof Records !== 'undefined') {
                Records.fetchRecords();
            } else if (tab === 'dnssec' && typeof DNSSEC !== 'undefined') {
                DNSSEC.fetchKeys();
            } else if (tab === 'nameservers' && typeof Nameservers !== 'undefined') {
                Nameservers.fetchNameservers();
            }
            // history and settings tabs do not need periodic refresh
        }, seconds * 1000);
    }

    // ===============================================================
    // TOUCH SWIPE — Tab switching on mobile
    // ===============================================================

    /** Ordered list of tabs for swipe navigation. */
    const TAB_ORDER = ['records', 'dnssec', 'nameservers', 'history', 'settings'];

    /**
     * setupTouchSwipe() — Private: enable horizontal swipe gestures
     * on the content area to switch between tabs on mobile.
     * Requires a minimum horizontal distance and must be more
     * horizontal than vertical to avoid conflicts with scrolling.
     */
    function setupTouchSwipe() {
        const contentEl = document.getElementById('content');
        if (!contentEl) return;

        let startX = 0;
        let startY = 0;

        contentEl.addEventListener('touchstart', function(e) {
            if (e.touches.length !== 1) return;
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
        }, { passive: true });

        contentEl.addEventListener('touchend', function(e) {
            if (e.changedTouches.length !== 1) return;
            const dx = e.changedTouches[0].clientX - startX;
            const dy = e.changedTouches[0].clientY - startY;

            // Must be a horizontal swipe: |dx| > 80px, |dx| > 2 * |dy|
            if (Math.abs(dx) < 80 || Math.abs(dx) < 2 * Math.abs(dy)) return;

            const currentTab = State.get('activeTab');
            const tabIndex = TAB_ORDER.indexOf(currentTab);
            if (tabIndex === -1) return;

            if (dx < 0 && tabIndex < TAB_ORDER.length - 1) {
                // Swipe left → next tab
                State.set('activeTab', TAB_ORDER[tabIndex + 1]);
            } else if (dx > 0 && tabIndex > 0) {
                // Swipe right → previous tab
                State.set('activeTab', TAB_ORDER[tabIndex - 1]);
            }
        }, { passive: true });
    }

    // ===============================================================
    // KEYBOARD SHORTCUTS
    // ===============================================================

    // ---------------------------------------------------------------
    // Tab shortcut map — maps number keys to tab names.
    // ---------------------------------------------------------------
    const TAB_SHORTCUTS = { '1': 'records', '2': 'dnssec', '3': 'nameservers', '4': 'history', '5': 'settings' };

    // ---------------------------------------------------------------
    // setupKeyboardShortcuts() — Private: bind global keyboard
    // shortcuts (ignored when focus is inside input/textarea/select).
    // ---------------------------------------------------------------
    function setupKeyboardShortcuts() {
        document.addEventListener('keydown', handleGlobalKeydown);
    }

    // ---------------------------------------------------------------
    // handleGlobalKeydown(event) — Private: global keydown handler.
    // Shortcuts: ? (help), 1-4 (tabs), / (search), r (refresh),
    // n (new record).
    // ---------------------------------------------------------------
    function handleGlobalKeydown(event) {
        const tag = document.activeElement ? document.activeElement.tagName : '';
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
            return;
        }

        // Ignore with modifier keys (except Shift for ?)
        if (event.ctrlKey || event.metaKey || event.altKey) {
            return;
        }

        const key = event.key;

        if (key === '?') {
            event.preventDefault();
            showShortcutsHelp();
            return;
        }

        if (TAB_SHORTCUTS[key]) {
            event.preventDefault();
            State.set('activeTab', TAB_SHORTCUTS[key]);
            return;
        }

        if (key === '/') {
            event.preventDefault();
            const searchInput = document.querySelector('[data-action="search-records"]');
            if (searchInput) {
                searchInput.focus();
            }
            return;
        }

        if (key === 'r') {
            event.preventDefault();
            const activeTab = State.get('activeTab');
            if (activeTab === 'records' && typeof Records !== 'undefined') {
                Records.fetchRecords();
            } else if (activeTab === 'dnssec' && typeof DNSSEC !== 'undefined') {
                DNSSEC.fetchKeys();
            } else if (activeTab === 'nameservers' && typeof Nameservers !== 'undefined') {
                Nameservers.fetchNameservers();
            }
            return;
        }

        if (key === 'n') {
            const activeTab = State.get('activeTab');
            if (activeTab === 'records') {
                event.preventDefault();
                const addBtn = document.querySelector('[data-action="add-record"]');
                if (addBtn) {
                    addBtn.click();
                }
            }
            return;
        }
    }

    // ---------------------------------------------------------------
    // showShortcutsHelp() — Private: show a modal listing keyboard
    // shortcuts.
    // ---------------------------------------------------------------
    function showShortcutsHelp() {
        const shortcuts = [
            { key: '?', description: I18n.t('shortcuts.help') },
            { key: '1 / 2 / 3 / 4 / 5', description: I18n.t('shortcuts.tabs') },
            { key: '/', description: I18n.t('shortcuts.search') },
            { key: 'n', description: I18n.t('shortcuts.newRecord') },
            { key: 'r', description: I18n.t('shortcuts.refresh') },
            { key: 'Esc', description: I18n.t('shortcuts.closeModal') },
            { key: '\u2190 \u2191 \u2192 \u2193', description: I18n.t('shortcuts.navigateTabs') }
        ];

        const list = UI.createElement('div', { className: 'shortcuts-list' });

        for (let i = 0; i < shortcuts.length; i++) {
            const row = UI.createElement('div', {
                className: 'shortcuts-list__row',
                style: { display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--color-border-subtle)' }
            }, [
                UI.createElement('kbd', {
                    textContent: shortcuts[i].key,
                    style: { fontFamily: 'var(--font-family-mono)', fontSize: 'var(--font-size-sm)', padding: '2px 8px', background: 'var(--color-bg-elevated)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }
                }),
                UI.createElement('span', {
                    textContent: shortcuts[i].description,
                    style: { color: 'var(--color-text-secondary)' }
                })
            ]);
            list.appendChild(row);
        }

        UI.showModal({
            title: I18n.t('shortcuts.title'),
            bodyEl: list
        });
    }

    // ---------------------------------------------------------------
    // Public API
    // ---------------------------------------------------------------
    return {
        init: init
    };
})();

// ===================================================================
// Application entry point — wait for DOM to be fully parsed.
// ===================================================================
document.addEventListener('DOMContentLoaded', () => {
    App.init().catch(err => console.error('App init failed:', err));
});
