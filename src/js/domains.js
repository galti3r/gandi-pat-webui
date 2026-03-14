/**
 * Domains — Domain management module for the Gandi DNS WebUI.
 *
 * Handles fetching the list of domains from the Gandi API with
 * progressive loading, rendering a searchable dropdown for domain
 * selection, and managing the currently selected domain in state.
 *
 * Optimisation: uses /tokeninfo to determine accessible domains
 * locally (entity ID matching) instead of N individual API calls.
 * Falls back to individual checks if /tokeninfo is unavailable.
 *
 * DOM dependencies:
 *   #domain-bar            — loading indicator target
 *   #domain-search-input   — combobox input for search/display
 *   #domain-dropdown-list  — listbox <ul> for domain items
 *   #domain-count          — count badge element
 *
 * Module dependencies: State, API, UI, Helpers
 */
const Domains = (function() {
    'use strict';

    // ---------------------------------------------------------------
    // Private: index of the currently keyboard-focused item in the
    // dropdown list (-1 means no item is focused).
    // ---------------------------------------------------------------
    let activeIndex = -1;

    // ---------------------------------------------------------------
    // Private: debounced filter function, created during init().
    // ---------------------------------------------------------------
    let debouncedFilter = null;

    // ---------------------------------------------------------------
    // Private: when true, the dropdown stays open until the user
    // selects a domain. Set after fetchDomains when multiple domains
    // are available and none is selected yet.
    // ---------------------------------------------------------------
    let pinned = false;

    // ---------------------------------------------------------------
    // Private: AbortController for cancelling in-progress loading.
    // ---------------------------------------------------------------
    let currentAbortController = null;

    // ---------------------------------------------------------------
    // Private: whether a progressive load is currently running.
    // ---------------------------------------------------------------
    let loadingInProgress = false;

    // ---------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------
    const PER_PAGE = 100;

    // ---------------------------------------------------------------
    // fetchDomains(firstPageResult) — Entry point for domain loading.
    //
    // If firstPageResult is provided (from auth), uses it as the
    // first page of data. Otherwise fetches from scratch.
    // ---------------------------------------------------------------
    function fetchDomains(firstPageResult) {
        // Cancel any previous loading
        cancelLoading();

        // Create new AbortController for this load
        currentAbortController = new AbortController();
        const signal = currentAbortController.signal;

        // Reset state and clear DOM list
        State.set('domains', []);
        loadingInProgress = true;
        const listEl = document.getElementById('domain-dropdown-list');
        if (listEl) {
            while (listEl.firstChild) {
                listEl.removeChild(listEl.firstChild);
            }
        }

        // Show loading UI
        UI.showLoading('domain-bar');
        const countEl = document.getElementById('domain-count');
        if (countEl) {
            countEl.textContent = I18n.t('domain.loading');
        }

        if (firstPageResult) {
            // Auth already fetched the first page — use it directly
            fetchDomainsProgressively(firstPageResult, signal);
        } else {
            // No first page — fetch from scratch
            API.rawGetWithHeaders(
                '/v5/domain/domains?nameserver=livedns&per_page=' + PER_PAGE + '&page=1',
                { signal: signal }
            ).then(function(result) {
                if (!signal.aborted) {
                    fetchDomainsProgressively(result, signal);
                }
            }).catch(function(err) {
                if (err && err.name === 'AbortError') {
                    return;
                }
                loadingInProgress = false;
                UI.hideLoading('domain-bar');
                UI.toast('error', I18n.t('domain.fetchError') + (err && err.message ? ': ' + err.message : ''));
            });
        }
    }

    // ---------------------------------------------------------------
    // fetchDomainsProgressively(firstPageResult, signal) — Main
    // progressive loading loop. Fetches tokeninfo in parallel with
    // processing page 1, then loads subsequent pages incrementally.
    // ---------------------------------------------------------------
    async function fetchDomainsProgressively(firstPageResult, signal) {
        try {
            // --- Phase 1: Tokeninfo + process page 1 ---
            let tokenInfo = null;
            try {
                tokenInfo = await API.rawGet('/tokeninfo', { signal: signal });
            } catch {
                // tokeninfo failed — will use fallback (individual checks)
                tokenInfo = null;
            }

            if (signal.aborted) return;

            // --- Phase 2: Process first page ---
            const firstPageDomains = firstPageResult.data || [];
            let firstDomainSelected = false;

            if (firstPageDomains.length > 0) {
                const accessible = await filterByEntities(firstPageDomains, tokenInfo, signal);
                if (signal.aborted) return;
                if (accessible.length > 0) {
                    State.set('domains', accessible);
                    appendDomainsToDropdown(accessible);
                    updateDomainCount();
                    selectDomain(accessible[0].fqdn || accessible[0]);
                    firstDomainSelected = true;
                }
            }

            // --- Phase 3: Subsequent pages ---
            let page = 2;

            while (firstPageDomains.length >= PER_PAGE) {
                if (signal.aborted) return;

                let result;
                try {
                    result = await API.rawGetWithHeaders(
                        '/v5/domain/domains?nameserver=livedns&per_page=' + PER_PAGE + '&page=' + page,
                        { signal: signal }
                    );
                } catch (err) {
                    if (err && err.name === 'AbortError') return;
                    break;
                }

                const pageDomains = result.data || [];
                if (pageDomains.length === 0) break;

                const accessible = await filterByEntities(pageDomains, tokenInfo, signal);
                if (signal.aborted) return;
                if (accessible.length > 0) {
                    const current = State.get('domains') || [];
                    State.set('domains', current.concat(accessible));
                    appendDomainsToDropdown(accessible);
                    updateDomainCount();

                    if (!firstDomainSelected) {
                        selectDomain(accessible[0].fqdn || accessible[0]);
                        firstDomainSelected = true;
                    }
                }

                if (pageDomains.length < PER_PAGE) break;
                page++;
            }

            // --- Done ---
            loadingInProgress = false;
            UI.hideLoading('domain-bar');
            updateDomainCount();

            const domains = State.get('domains') || [];
            if (domains.length > 1 && !State.get('currentDomain')) {
                pinned = true;
                openDropdown();
            }
        } catch (err) {
            if (err && err.name === 'AbortError') return;
            loadingInProgress = false;
            UI.hideLoading('domain-bar');
        }
    }

    // ---------------------------------------------------------------
    // filterByEntities(domains, tokenInfo, signal) — Filter domains
    // by matching entity IDs from tokeninfo. Falls back to individual
    // API checks if tokeninfo is unavailable.
    // ---------------------------------------------------------------
    async function filterByEntities(domains, tokenInfo, signal) {
        // Fallback: no tokeninfo → check individually
        if (!tokenInfo || !tokenInfo.entities) {
            return await checkAccessBatchFallback(domains, signal);
        }

        const entityIds = tokenInfo.entities.map(function(e) { return e.id; });
        const sharingId = tokenInfo.sharing_id;

        // Full organisation access: entity list contains sharing_id
        if (sharingId && entityIds.indexOf(sharingId) !== -1) {
            return domains;
        }

        // Filter by domain ID matching entity IDs
        return domains.filter(function(d) {
            return entityIds.indexOf(d.id) !== -1;
        });
    }

    // ---------------------------------------------------------------
    // checkAccessBatchFallback(domains, signal) — Fallback when
    // /tokeninfo is unavailable. Checks access by hitting
    // GET /v5/livedns/domains/{fqdn} for each domain in batches.
    // ---------------------------------------------------------------
    async function checkAccessBatchFallback(domains, signal) {
        const BATCH_SIZE = 5;
        const accessible = [];
        for (let i = 0; i < domains.length; i += BATCH_SIZE) {
            if (signal.aborted) return accessible;
            const batch = domains.slice(i, i + BATCH_SIZE);
            const results = await Promise.allSettled(
                batch.map(function(d) {
                    return API.get('/domains/' + (d.fqdn || d), { signal: signal });
                })
            );
            for (let j = 0; j < batch.length; j++) {
                if (results[j].status === 'fulfilled') {
                    accessible.push(batch[j]);
                }
            }
        }
        return accessible;
    }

    // ---------------------------------------------------------------
    // appendDomainsToDropdown(newDomains) — Add domain items to the
    // dropdown list without clearing existing items. Reapplies search
    // filter if one is active.
    // ---------------------------------------------------------------
    function appendDomainsToDropdown(newDomains) {
        const listEl = document.getElementById('domain-dropdown-list');
        if (!listEl) return;

        for (let i = 0; i < newDomains.length; i++) {
            const domain = newDomains[i];
            const fqdn = domain.fqdn || domain;

            const li = UI.createElement('li', {
                className: 'dropdown__item',
                role: 'option',
                textContent: fqdn,
                dataset: { domain: fqdn },
                tabIndex: -1
            });

            if (fqdn === State.get('currentDomain')) {
                li.classList.add('dropdown__item--selected');
            }

            listEl.appendChild(li);
        }

        // Reapply search filter if active
        const input = document.getElementById('domain-search-input');
        if (input && input.value && input === document.activeElement) {
            filterDomains(input.value);
        }
    }

    // ---------------------------------------------------------------
    // updateDomainCount() — Update the domain count badge. Shows
    // a loading suffix when loading is still in progress.
    // ---------------------------------------------------------------
    function updateDomainCount() {
        const countEl = document.getElementById('domain-count');
        if (!countEl) return;

        const domains = State.get('domains') || [];
        const count = domains.length;

        if (loadingInProgress) {
            const key = count !== 1 ? 'domain.countPluralLoading' : 'domain.countLoading';
            countEl.textContent = I18n.t(key, { count: count });
        } else {
            const key = count !== 1 ? 'domain.countPlural' : 'domain.count';
            countEl.textContent = I18n.t(key, { count: count });
        }
    }

    // ---------------------------------------------------------------
    // cancelLoading() — Cancel any in-progress domain loading.
    // ---------------------------------------------------------------
    function cancelLoading() {
        if (currentAbortController) {
            currentAbortController.abort();
            currentAbortController = null;
        }
        loadingInProgress = false;
    }

    // ---------------------------------------------------------------
    // renderDomainDropdown() — Build the dropdown list from state.
    //
    // Reads domains from State, updates the count badge, and
    // populates the listbox with clickable items. If only one domain
    // exists, it is automatically selected.
    // Used for full refresh (e.g. language change).
    // ---------------------------------------------------------------
    function renderDomainDropdown() {
        const domains = State.get('domains') || [];
        const countEl = document.getElementById('domain-count');
        const listEl = document.getElementById('domain-dropdown-list');

        // Update the domain count badge
        if (countEl) {
            countEl.textContent = I18n.t(domains.length !== 1 ? 'domain.countPlural' : 'domain.count', {count: domains.length});
        }

        // Clear existing items
        if (listEl) {
            while (listEl.firstChild) {
                listEl.removeChild(listEl.firstChild);
            }

            // Build one <li> per domain
            for (let i = 0; i < domains.length; i++) {
                const domain = domains[i];
                const fqdn = domain.fqdn || domain;

                const li = UI.createElement('li', {
                    className: 'dropdown__item',
                    role: 'option',
                    textContent: fqdn,
                    dataset: { domain: fqdn },
                    tabIndex: -1
                });

                // Mark previously selected domain
                if (fqdn === State.get('currentDomain')) {
                    li.classList.add('dropdown__item--selected');
                }

                listEl.appendChild(li);
            }
        }

        // Auto-select when there is exactly one domain
        if (domains.length === 1) {
            const singleFqdn = domains[0].fqdn || domains[0];
            selectDomain(singleFqdn);
        } else if (domains.length > 1 && !State.get('currentDomain')) {
            pinned = true;
            openDropdown();
        }
    }

    // ---------------------------------------------------------------
    // selectDomain(fqdn) — Select a domain and update all related UI.
    //
    // Sets the currentDomain in state, updates the input value,
    // highlights the selected item, and closes the dropdown.
    // ---------------------------------------------------------------
    function selectDomain(fqdn) {
        pinned = false;
        State.set('currentDomain', fqdn);

        // Update the search input to show the selected domain
        const input = document.getElementById('domain-search-input');
        if (input) {
            input.value = fqdn;
        }

        // Update the selected visual state in the dropdown list
        const listEl = document.getElementById('domain-dropdown-list');
        if (listEl) {
            const items = listEl.querySelectorAll('.dropdown__item');
            for (let i = 0; i < items.length; i++) {
                if (items[i].dataset.domain === fqdn) {
                    items[i].classList.add('dropdown__item--selected');
                } else {
                    items[i].classList.remove('dropdown__item--selected');
                }
            }
        }

        // Close the dropdown after selection
        closeDropdown();
    }

    // ---------------------------------------------------------------
    // filterDomains(query) — Filter the visible dropdown items by
    // matching the query string against each domain fqdn
    // (case-insensitive substring match).
    //
    // Shows an empty-state message when no domains match.
    // ---------------------------------------------------------------
    function filterDomains(query) {
        const listEl = document.getElementById('domain-dropdown-list');
        if (!listEl) {
            return;
        }

        const items = listEl.querySelectorAll('.dropdown__item');
        const normalizedQuery = (query || '').toLowerCase();
        let visibleCount = 0;

        // Show/hide items based on the search query
        for (let i = 0; i < items.length; i++) {
            // Skip the empty-state element if it exists
            if (items[i].dataset.emptyState) {
                continue;
            }

            const fqdn = (items[i].dataset.domain || '').toLowerCase();
            const matches = fqdn.indexOf(normalizedQuery) !== -1;

            items[i].style.display = matches ? '' : 'none';
            if (matches) {
                visibleCount++;
            }
        }

        // Remove any existing empty-state element
        const existingEmpty = listEl.querySelector('[data-empty-state]');
        if (existingEmpty) {
            listEl.removeChild(existingEmpty);
        }

        // Show empty state when nothing matches
        if (visibleCount === 0 && normalizedQuery.length > 0) {
            const emptyLi = UI.createElement('li', {
                className: 'dropdown__item dropdown__item--empty',
                textContent: I18n.t('domain.noMatch', {query: query}),
                dataset: { emptyState: 'true' }
            });
            listEl.appendChild(emptyLi);
        }

        // Reset keyboard navigation index since visible set changed
        activeIndex = -1;
    }

    // ---------------------------------------------------------------
    // openDropdown() — Show the dropdown list and update ARIA state.
    // ---------------------------------------------------------------
    function openDropdown() {
        const input = document.getElementById('domain-search-input');
        const listEl = document.getElementById('domain-dropdown-list');

        if (input) {
            input.setAttribute('aria-expanded', 'true');
        }
        if (listEl) {
            listEl.style.display = 'block';
        }
        activeIndex = -1;
    }

    // ---------------------------------------------------------------
    // closeDropdown() — Hide the dropdown list and reset ARIA state.
    // ---------------------------------------------------------------
    function closeDropdown() {
        if (pinned) {
            return;
        }

        const input = document.getElementById('domain-search-input');
        const listEl = document.getElementById('domain-dropdown-list');

        if (input) {
            input.setAttribute('aria-expanded', 'false');
        }
        if (listEl) {
            listEl.style.display = 'none';
        }
        activeIndex = -1;
    }

    // ---------------------------------------------------------------
    // getVisibleItems() — Return an array of currently visible
    // (non-hidden, non-empty-state) dropdown items.
    // ---------------------------------------------------------------
    function getVisibleItems() {
        const listEl = document.getElementById('domain-dropdown-list');
        if (!listEl) {
            return [];
        }

        const allItems = listEl.querySelectorAll('.dropdown__item');
        const visible = [];
        for (let i = 0; i < allItems.length; i++) {
            if (allItems[i].style.display !== 'none' && !allItems[i].dataset.emptyState) {
                visible.push(allItems[i]);
            }
        }
        return visible;
    }

    // ---------------------------------------------------------------
    // setActiveItem(index) — Highlight the item at the given index
    // in the visible items list, and remove highlight from others.
    // Scrolls the active item into view for long lists.
    // ---------------------------------------------------------------
    function setActiveItem(index) {
        const visible = getVisibleItems();
        if (visible.length === 0) {
            return;
        }

        // Clamp index to valid range
        if (index < 0) {
            index = visible.length - 1;
        } else if (index >= visible.length) {
            index = 0;
        }

        // Remove active state from all items
        for (let i = 0; i < visible.length; i++) {
            visible[i].classList.remove('dropdown__item--active');
            visible[i].removeAttribute('aria-selected');
        }

        // Set active state on the target item
        activeIndex = index;
        visible[activeIndex].classList.add('dropdown__item--active');
        visible[activeIndex].setAttribute('aria-selected', 'true');

        // Scroll into view if needed (non-disruptive)
        if (typeof visible[activeIndex].scrollIntoView === 'function') {
            visible[activeIndex].scrollIntoView({ block: 'nearest' });
        }

        // Update aria-activedescendant on the input for screen readers
        const input = document.getElementById('domain-search-input');
        if (input && visible[activeIndex].id) {
            input.setAttribute('aria-activedescendant', visible[activeIndex].id);
        }
    }

    // ---------------------------------------------------------------
    // handleKeydown(event) — Keyboard navigation handler for the
    // domain search input.
    //
    // ArrowDown: move focus to next visible item (or open dropdown)
    // ArrowUp:   move focus to previous visible item
    // Enter:     select the currently active item
    // Escape:    close the dropdown
    // ---------------------------------------------------------------
    function handleKeydown(event) {
        const input = document.getElementById('domain-search-input');
        const isOpen = input && input.getAttribute('aria-expanded') === 'true';

        switch (event.key) {
            case 'ArrowDown':
                event.preventDefault();
                if (!isOpen) {
                    openDropdown();
                }
                setActiveItem(activeIndex + 1);
                break;

            case 'ArrowUp':
                event.preventDefault();
                if (!isOpen) {
                    openDropdown();
                }
                setActiveItem(activeIndex - 1);
                break;

            case 'Enter':
                event.preventDefault();
                if (isOpen && activeIndex >= 0) {
                    const visible = getVisibleItems();
                    if (visible[activeIndex]) {
                        const fqdn = visible[activeIndex].dataset.domain;
                        if (fqdn) {
                            selectDomain(fqdn);
                        }
                    }
                }
                break;

            case 'Escape':
                event.preventDefault();
                closeDropdown();
                if (input) {
                    input.blur();
                }
                break;

            default:
                // Let other keys pass through for typing
                break;
        }
    }

    // ---------------------------------------------------------------
    // init() — Bind all event listeners for the domain dropdown.
    //
    // Sets up: focus to open/show all, input to filter, mousedown
    // on items to select (before blur fires), keyboard navigation,
    // click-outside-to-close, and token change cancellation.
    // ---------------------------------------------------------------
    function init() {
        const input = document.getElementById('domain-search-input');
        const listEl = document.getElementById('domain-dropdown-list');

        // Create debounced filter (150ms — fast enough to feel responsive)
        debouncedFilter = Helpers.debounce(query => {
            filterDomains(query);
        }, 150);

        if (input) {
            // Focus: clear input, show ALL domains, open dropdown
            input.addEventListener('focus', () => {
                input.value = '';
                filterDomains('');
                openDropdown();
            });

            // Input: filter domains as user types
            input.addEventListener('input', () => {
                if (input.getAttribute('aria-expanded') !== 'true') {
                    openDropdown();
                }
                debouncedFilter(input.value);
            });

            // Blur: restore selected domain name and close dropdown
            input.addEventListener('blur', () => {
                setTimeout(() => {
                    const selected = State.get('currentDomain');
                    if (selected) {
                        input.value = selected;
                    } else if (pinned) {
                        // No domain selected yet — reset filter to show all
                        input.value = '';
                        filterDomains('');
                    }
                    closeDropdown();
                }, 250);
            });

            // Keyboard: navigate and select items
            input.addEventListener('keydown', handleKeydown);
        }

        // Delegate mousedown (not click) on list items so selection
        // fires before the input blur event closes the dropdown
        if (listEl) {
            listEl.addEventListener('mousedown', event => {
                event.preventDefault();
                let target = event.target;

                while (target && target !== listEl) {
                    if (target.classList.contains('dropdown__item') && target.dataset.domain) {
                        selectDomain(target.dataset.domain);
                        return;
                    }
                    target = target.parentElement;
                }
            });
        }

        // Click outside: close the dropdown when clicking elsewhere
        document.addEventListener('click', event => {
            const dropdown = document.getElementById('domain-dropdown');
            if (dropdown && !dropdown.contains(event.target)) {
                closeDropdown();
            }
        });

        // Cancel loading when token is cleared (disconnect)
        State.on('tokenChanged', function(token) {
            if (!token) {
                cancelLoading();
            }
        });

        // Re-render dropdown when language changes (updates count badge text)
        State.on('languageChanged', function() {
            renderDomainDropdown();
        });
    }

    // ---------------------------------------------------------------
    // Public API
    // ---------------------------------------------------------------
    return {
        init: init,
        fetchDomains: fetchDomains,
        selectDomain: selectDomain,
        cancelLoading: cancelLoading
    };
})();
