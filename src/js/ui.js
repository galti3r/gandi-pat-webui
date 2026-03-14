/**
 * UI — Shared UI component library for the Gandi DNS WebUI.
 *
 * Provides toast notifications, modal dialogs, loading indicators,
 * table rendering with sort/pagination, confirmation dialogs,
 * clipboard copy, tab initialization, and DOM construction helpers.
 *
 * CRITICAL: All DOM construction uses createElement/textContent.
 * innerHTML is NEVER used with dynamic data.
 */
const UI = (function() {
    'use strict';

    // ---------------------------------------------------------------
    // Private: reference to the element that opened the current modal
    // (for focus restoration).
    // ---------------------------------------------------------------
    let modalTrigger = null;

    // ---------------------------------------------------------------
    // createElement(tag, attrs, children) — Shorthand for building
    // DOM elements safely.
    //
    // tag: string — HTML tag name
    // attrs: object — properties to set on the element:
    //   className, id, textContent, type, value, placeholder, name,
    //   htmlFor, disabled, checked, required, min, max, role,
    //   tabIndex, title, href, target, colSpan, rowSpan,
    //   dataset: { key: value } → data-key="value"
    //   style: { prop: value } or string
    //   events: { click: fn, change: fn, ... }
    //   ...any other attribute set via setAttribute
    // children: array of DOM elements or strings (strings → text nodes)
    //
    // Returns the created element.
    // ---------------------------------------------------------------
    function createElement(tag, attrs, children) {
        const el = document.createElement(tag);
        if (attrs) {
            setElementAttributes(el, attrs);
        }
        if (children) {
            appendChildren(el, children);
        }
        return el;
    }

    /**
     * setElementAttributes — Private: apply an attrs object to an element.
     * Handles special keys (className, dataset, events, style) and
     * falls back to setAttribute for anything else.
     */
    function setElementAttributes(el, attrs) {
        const directProps = [
            'className', 'id', 'textContent', 'type', 'value',
            'placeholder', 'name', 'htmlFor', 'disabled', 'checked',
            'required', 'readOnly', 'tabIndex', 'title', 'href',
            'target', 'colSpan', 'rowSpan', 'selected', 'multiple',
            'rows', 'cols', 'min', 'max', 'step', 'pattern',
            'autocomplete', 'autofocus', 'maxLength'
        ];

        const keys = Object.keys(attrs);
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            const val = attrs[key];

            if (val === undefined || val === null) continue;

            if (key === 'dataset' && typeof val === 'object') {
                const dkeys = Object.keys(val);
                for (let d = 0; d < dkeys.length; d++) {
                    el.dataset[dkeys[d]] = val[dkeys[d]];
                }
            } else if (key === 'events' && typeof val === 'object') {
                const ekeys = Object.keys(val);
                for (let e = 0; e < ekeys.length; e++) {
                    el.addEventListener(ekeys[e], val[ekeys[e]]);
                }
            } else if (key === 'style' && typeof val === 'object') {
                const skeys = Object.keys(val);
                for (let s = 0; s < skeys.length; s++) {
                    el.style[skeys[s]] = val[skeys[s]];
                }
            } else if (key === 'style' && typeof val === 'string') {
                el.style.cssText = val;
            } else if (key === 'role') {
                el.setAttribute('role', val);
            } else if (key === 'ariaLabel') {
                el.setAttribute('aria-label', val);
            } else if (key === 'ariaLive') {
                el.setAttribute('aria-live', val);
            } else if (key === 'ariaHidden') {
                el.setAttribute('aria-hidden', val);
            } else if (key === 'htmlFor') {
                el.setAttribute('for', val);
            } else if (directProps.indexOf(key) !== -1) {
                el[key] = val;
            } else {
                el.setAttribute(key, val);
            }
        }
    }

    /**
     * appendChildren — Private: append an array of children to a parent.
     * Strings become text nodes. Elements are appended directly.
     */
    function appendChildren(el, children) {
        for (let i = 0; i < children.length; i++) {
            const child = children[i];
            if (child === null || child === undefined) continue;
            if (typeof child === 'string' || typeof child === 'number') {
                el.appendChild(document.createTextNode(String(child)));
            } else if (child.nodeType) {
                el.appendChild(child);
            }
        }
    }

    // ---------------------------------------------------------------
    // actionButton(icon, title, handler) — Create a small icon button
    // for table row actions.
    //
    // icon: text character (e.g. pencil, bin emoji, or simple char)
    // title: tooltip text
    // handler: click event handler
    // ---------------------------------------------------------------
    function actionButton(icon, title, handler) {
        return createElement('button', {
            className: 'btn btn--icon',
            title: title,
            textContent: icon,
            ariaLabel: title,
            events: { click: handler }
        });
    }

    // ===============================================================
    // TOAST NOTIFICATIONS
    // ===============================================================

    /**
     * toast(type, message, duration) — Show a toast notification.
     *
     * type: 'success' | 'error' | 'warning' | 'info'
     * message: string — the notification text
     * duration: number — auto-dismiss after ms (default 4000, 0 = sticky)
     */
    function toast(type, message, duration) {
        let container = document.getElementById('toast-container');
        if (!container) {
            // Create container if it does not exist yet
            container = createElement('div', {
                id: 'toast-container',
                className: 'toast-container',
                role: 'status',
                ariaLive: 'polite'
            });
            document.body.appendChild(container);
        }

        const durationByType = {
            success: 4000,
            info: 4000,
            warning: 6000,
            error: 8000
        };
        const dur = (duration !== undefined) ? duration : (durationByType[type] || 4000);

        const iconByType = {
            success: '\u2713',
            error: '\u2717',
            warning: '\u26A0',
            info: '\u2139'
        };

        const closeBtn = createElement('button', {
            className: 'toast__close',
            textContent: '\u00D7', // multiplication sign as close icon
            ariaLabel: I18n.t('ui.closeNotification'),
            type: 'button'
        });

        const iconEl = createElement('span', {
            className: 'toast__icon',
            textContent: iconByType[type] || '',
            ariaHidden: 'true'
        });

        const toastEl = createElement('div', {
            className: 'toast toast--' + type,
            role: 'alert'
        }, [
            iconEl,
            createElement('span', { className: 'toast__message', textContent: message }),
            closeBtn
        ]);

        // Close button handler
        closeBtn.addEventListener('click', () => {
            removeToast(toastEl);
        });

        container.appendChild(toastEl);

        // Trigger enter animation on next frame
        requestAnimationFrame(() => {
            toastEl.classList.add('toast--visible');
        });

        // Auto-dismiss after duration (0 = stay until clicked)
        if (dur > 0) {
            setTimeout(() => {
                removeToast(toastEl);
            }, dur);
        }
    }

    /**
     * removeToast — Private: remove a toast element with exit animation.
     */
    function removeToast(toastEl) {
        if (!toastEl || !toastEl.parentNode) return;
        toastEl.classList.remove('toast--visible');
        toastEl.classList.add('toast--exit');
        setTimeout(() => {
            if (toastEl.parentNode) {
                toastEl.parentNode.removeChild(toastEl);
            }
        }, 300); // Match CSS transition duration
    }

    // ===============================================================
    // MODAL
    // ===============================================================

    /**
     * showModal(config) — Display a modal dialog.
     *
     * config: {
     *   title: string — modal title,
     *   bodyHtml: (NOT USED — security), use bodyEl instead,
     *   bodyEl: Element — DOM element to insert as body,
     *   onClose: function — optional callback when modal closes
     * }
     *
     * Focus is trapped inside the modal. Escape closes it.
     * Click on overlay closes it. Returns focus to trigger on close.
     */
    function showModal(config) {
        let overlay = document.getElementById('modal-overlay');
        if (!overlay) {
            overlay = buildModalStructure();
        }

        // Store the trigger element for focus restoration
        modalTrigger = document.activeElement;

        // Reset modifier classes on the dialog, then apply new one if provided
        const dialog = overlay.querySelector('.modal');
        if (dialog) {
            dialog.className = 'modal';
            if (config.modalClass) {
                dialog.classList.add(config.modalClass);
            }
        }

        const titleEl = overlay.querySelector('[data-modal="title"]');
        const bodyEl = overlay.querySelector('[data-modal="body"]');

        // Set title safely via textContent
        if (titleEl) {
            titleEl.textContent = config.title || '';
        }

        // Set body content
        if (bodyEl) {
            bodyEl.textContent = ''; // Clear previous content
            if (config.bodyEl) {
                bodyEl.appendChild(config.bodyEl);
            }
        }

        // Store callbacks
        overlay._onClose = config.onClose || null;
        overlay._beforeClose = config.beforeClose || null;

        // Show modal
        overlay.classList.add('modal-overlay--visible');
        overlay.setAttribute('aria-hidden', 'false');

        // Focus the first focusable element inside the modal
        const firstFocusable = overlay.querySelector(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (firstFocusable) {
            firstFocusable.focus();
        }
    }

    /**
     * closeModal() — Hide the modal and restore focus.
     */
    function closeModal() {
        const overlay = document.getElementById('modal-overlay');
        if (!overlay) return;

        // beforeClose can prevent closing (return false to block)
        if (typeof overlay._beforeClose === 'function') {
            try {
                if (overlay._beforeClose() === false) return;
            } catch (err) {
                console.error('[UI] Modal beforeClose error:', err);
            }
        }

        overlay.classList.remove('modal-overlay--visible');
        overlay.setAttribute('aria-hidden', 'true');
        overlay._beforeClose = null;

        // Call onClose callback if set
        if (typeof overlay._onClose === 'function') {
            try {
                overlay._onClose();
            } catch (err) {
                console.error('[UI] Modal onClose error:', err);
            }
            overlay._onClose = null;
        }

        // Restore focus to the trigger element
        if (modalTrigger && typeof modalTrigger.focus === 'function') {
            modalTrigger.focus();
            modalTrigger = null;
        }
    }

    /**
     * forceCloseModal() — Close modal bypassing beforeClose guard.
     */
    function forceCloseModal() {
        const overlay = document.getElementById('modal-overlay');
        if (overlay) {
            overlay._beforeClose = null;
        }
        closeModal();
    }

    // ---------------------------------------------------------------
    // Private flag: has initModal() already been called?
    // ---------------------------------------------------------------
    let modalInitialised = false;

    /**
     * initModal() — Private: bind event handlers on the static modal
     * overlay (#modal-overlay) that exists in index.html.
     *
     * Must be called once at startup (via UI.init()). Binds:
     *   - Escape key to close the modal
     *   - Click on overlay (outside dialog) to close
     *   - Click on [data-action="modal-close"] button to close
     *   - Focus trap (Tab / Shift+Tab stay within the modal)
     *
     * If the static element is not yet present, this is a no-op
     * (buildModalStructure will create it later as a fallback).
     */
    function initModal() {
        if (modalInitialised) return;

        const overlay = document.getElementById('modal-overlay');
        if (!overlay) return; // fallback: buildModalStructure will handle it

        // Click on overlay background (outside the dialog) closes modal
        // Track mousedown target to prevent closing when resizing a modal
        // and the mouse drifts onto the overlay during a drag.
        let overlayMouseDownTarget = null;
        overlay.addEventListener('mousedown', e => {
            overlayMouseDownTarget = e.target;
        });
        overlay.addEventListener('click', e => {
            if (e.target === overlay && overlayMouseDownTarget === overlay) {
                closeModal();
            }
            overlayMouseDownTarget = null;
        });

        // Click on the close button [data-action="modal-close"]
        const closeBtn = overlay.querySelector('[data-action="modal-close"]');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                closeModal();
            });
        }

        // Escape key closes the modal (global handler)
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape') {
                const ov = document.getElementById('modal-overlay');
                if (ov && ov.classList.contains('modal-overlay--visible')) {
                    closeModal();
                }
            }
        });

        // Focus trap: Tab / Shift+Tab cycle within the modal
        overlay.addEventListener('keydown', e => {
            if (e.key !== 'Tab') return;
            trapFocus(overlay, e);
        });

        modalInitialised = true;
    }

    /**
     * buildModalStructure — Private: create the modal overlay DOM.
     * Attaches global Escape key and overlay click handlers.
     * Returns the overlay element.
     * NOTE: This is a fallback in case the static HTML modal is absent.
     */
    function buildModalStructure() {
        const closeBtn = createElement('button', {
            className: 'modal__close',
            textContent: '\u00D7',
            ariaLabel: I18n.t('ui.closeModal'),
            type: 'button',
            events: { click: closeModal }
        });

        const header = createElement('div', { className: 'modal__header' }, [
            createElement('h2', { className: 'modal__title', dataset: { modal: 'title' } }),
            closeBtn
        ]);

        const body = createElement('div', {
            className: 'modal__body',
            dataset: { modal: 'body' }
        });

        const dialog = createElement('div', {
            className: 'modal',
            role: 'dialog',
            'aria-modal': 'true'
        }, [header, body]);

        const overlay = createElement('div', {
            id: 'modal-overlay',
            className: 'modal-overlay',
            ariaHidden: 'true'
        }, [dialog]);

        // Click on overlay (outside modal) closes it
        // Track mousedown target to prevent closing when resizing a modal
        // and the mouse drifts onto the overlay during a drag.
        let overlayMouseDownTarget = null;
        overlay.addEventListener('mousedown', e => {
            overlayMouseDownTarget = e.target;
        });
        overlay.addEventListener('click', e => {
            if (e.target === overlay && overlayMouseDownTarget === overlay) {
                closeModal();
            }
            overlayMouseDownTarget = null;
        });

        // Escape key closes modal
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape') {
                const ov = document.getElementById('modal-overlay');
                if (ov && ov.classList.contains('modal-overlay--visible')) {
                    closeModal();
                }
            }
        });

        // Focus trap: Tab/Shift+Tab cycle within modal
        overlay.addEventListener('keydown', e => {
            if (e.key !== 'Tab') return;
            trapFocus(overlay, e);
        });

        document.body.appendChild(overlay);
        return overlay;
    }

    /**
     * trapFocus — Private: keep focus cycling within a container element.
     */
    function trapFocus(container, e) {
        const focusable = container.querySelectorAll(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]):not([disabled])'
        );
        if (focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey) {
            // Shift+Tab — wrap from first to last
            if (document.activeElement === first) {
                e.preventDefault();
                last.focus();
            }
        } else {
            // Tab — wrap from last to first
            if (document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        }
    }

    // ===============================================================
    // LOADING INDICATORS
    // ===============================================================

    /**
     * showLoading(elementId) — Add a loading overlay with spinner
     * to the element identified by elementId. The element gets
     * position:relative so the overlay covers it.
     */
    function showLoading(elementId) {
        const target = document.getElementById(elementId);
        if (!target) return;

        // Avoid adding multiple overlays
        if (target.querySelector('.loading-overlay')) return;

        target.style.position = 'relative';
        const overlay = createElement('div', {
            className: 'loading-overlay'
        }, [
            createElement('div', { className: 'loading-spinner' })
        ]);
        target.appendChild(overlay);
    }

    /**
     * hideLoading(elementId) — Remove the loading overlay from the
     * element identified by elementId.
     */
    function hideLoading(elementId) {
        const target = document.getElementById(elementId);
        if (!target) return;

        const overlay = target.querySelector('.loading-overlay');
        if (overlay) {
            target.removeChild(overlay);
        }
    }

    // ===============================================================
    // SKELETON LOADING
    // ===============================================================

    /**
     * showSkeleton(containerId, rows) — Show skeleton loading placeholders
     * in the specified container. Creates a header skeleton and N row
     * skeletons (default 5).
     */
    function showSkeleton(containerId, rows) {
        const target = document.getElementById(containerId);
        if (!target) return;

        const count = rows || 5;
        const wrapper = createElement('div', { className: 'skeleton-container' });

        wrapper.appendChild(createElement('div', { className: 'skeleton skeleton--header' }));

        for (let i = 0; i < count; i++) {
            wrapper.appendChild(createElement('div', { className: 'skeleton skeleton--row' }));
        }

        target.textContent = '';
        target.appendChild(wrapper);
    }

    // ===============================================================
    // apiAction — THE KEY FACTORED FUNCTION
    // ===============================================================

    /**
     * apiAction(config) — Execute an API call with loading state,
     * state update, toast feedback, and error handling.
     *
     * config: {
     *   loadingTarget: string — element ID for loading overlay,
     *   apiCall: function — returns a Promise (the actual API call),
     *   stateKey: string — optional State key to update on success,
     *   onSuccess: function(result) — optional callback on success,
     *   successMessage: string — optional success toast message,
     *   errorMessage: string — optional prefix for error toast,
     *   onError: function(err) — optional callback on error,
     *   onFinally: function — optional callback always called at the end
     * }
     *
     * Returns the API result on success, undefined on error.
     */
    function apiAction(config) {
        if (config.loadingTarget) {
            showLoading(config.loadingTarget);
        }

        return config.apiCall()
            .then(async result => {
                // Update state if a key is specified
                if (config.stateKey) {
                    State.set(config.stateKey, result);
                }

                // Show success toast
                if (config.successMessage) {
                    toast('success', config.successMessage);
                }

                // Call success callback (may be async)
                if (typeof config.onSuccess === 'function') {
                    await config.onSuccess(result);
                }

                return result;
            })
            .catch(err => {
                // Silently ignore aborted requests (e.g. user switched domain)
                if (err && err.name === 'AbortError') {
                    return undefined;
                }

                // Build error message
                let msg = config.errorMessage || I18n.t('ui.operationFailed');
                if (err && err.message) {
                    msg += ': ' + err.message;
                }

                toast('error', msg);

                // Call error callback
                if (typeof config.onError === 'function') {
                    config.onError(err);
                }

                // Log sanitized error (no token)
                console.error('[API]', msg, {
                    status: err ? err.status : undefined,
                    errors: err ? err.errors : undefined
                });

                return undefined;
            })
            .then(result => {
                // finally-equivalent: always hide loading
                if (config.loadingTarget) {
                    hideLoading(config.loadingTarget);
                }
                if (typeof config.onFinally === 'function') {
                    config.onFinally();
                }
                return result;
            });
    }

    // ===============================================================
    // renderTable — Full table with sort, pagination, actions
    // ===============================================================

    /**
     * renderTable(config) — Render a data table into a container.
     *
     * config: {
     *   containerId: string — target container element ID,
     *   data: array — array of objects to display,
     *   columns: array — column definitions:
     *     [{ key: string, label: string, sortable?: bool, render?: fn(value, item), className?: string }],
     *   actions: function(item) — optional: returns Element or array of Elements for action column,
     *   sortColumn: string — current sort column key,
     *   sortDirection: string — 'asc' or 'desc',
     *   onSort: function(column, direction) — callback when a column header is clicked,
     *   page: number — current page (1-based),
     *   pageSize: number — items per page (default 25),
     *   onPageChange: function(page) — callback when page changes,
     *   emptyMessage: string — message when data is empty,
     *   onRender: function — optional callback after DOM insertion
     * }
     */
    function renderTable(config) {
        const container = document.getElementById(config.containerId);
        if (!container) return;

        // Clear container
        container.textContent = '';

        const data = config.data || [];

        // Empty state
        if (data.length === 0) {
            const emptyEl = createElement('div', {
                className: 'table-empty'
            }, [
                createElement('p', { textContent: config.emptyMessage || I18n.t('ui.noData') })
            ]);
            container.appendChild(emptyEl);
            if (typeof config.onRender === 'function') {
                config.onRender();
            }
            return;
        }

        // Sort data if sort parameters are provided
        let sortedData = data;
        if (config.sortColumn) {
            sortedData = Helpers.sortData(data, config.sortColumn, config.sortDirection || 'asc');
        }

        // Paginate
        const pageSize = config.pageSize !== null && config.pageSize !== undefined ? config.pageSize : 25;
        const paged = Helpers.paginate(sortedData, config.page || 1, pageSize);

        // Build table
        const table = createElement('table', { className: 'table' });

        // --- thead ---
        const thead = createElement('thead');
        const headerRow = createElement('tr');
        const columns = config.columns || [];

        for (let c = 0; c < columns.length; c++) {
            const col = columns[c];
            const th = buildTableHeader(col, config);
            headerRow.appendChild(th);
        }

        // Actions column header
        if (typeof config.actions === 'function') {
            headerRow.appendChild(createElement('th', {
                className: 'table__th table__th--actions',
                textContent: I18n.t('ui.actions')
            }));
        }

        thead.appendChild(headerRow);
        table.appendChild(thead);

        // --- tbody ---
        const tbody = createElement('tbody');
        for (let r = 0; r < paged.items.length; r++) {
            const item = paged.items[r];
            let rowClassName = 'table__row';
            if (typeof config.rowClass === 'function') {
                const extra = config.rowClass(item);
                if (extra) rowClassName += ' ' + extra;
            }
            const row = createElement('tr', { className: rowClassName });

            if (typeof config.onRowClick === 'function') {
                row.style.cursor = 'pointer';
                row.addEventListener('click', (function(rowItem) {
                    return function(e) { config.onRowClick(rowItem, e); };
                })(item));
            }

            for (let j = 0; j < columns.length; j++) {
                const colDef = columns[j];
                const cellValue = item[colDef.key];
                const td = createElement('td', {
                    className: 'table__td' + (colDef.className ? ' ' + colDef.className : ''),
                    dataset: { label: colDef.label || colDef.key }
                });

                // Use custom render function if provided, otherwise textContent
                if (typeof colDef.render === 'function') {
                    const rendered = colDef.render(cellValue, item);
                    if (rendered && rendered.nodeType) {
                        td.appendChild(rendered);
                    } else {
                        td.textContent = String(rendered !== null && rendered !== undefined ? rendered : '');
                    }
                } else {
                    td.textContent = cellValue !== null && cellValue !== undefined ? String(cellValue) : '';
                }

                row.appendChild(td);
            }

            // Actions column
            if (typeof config.actions === 'function') {
                const actionTd = createElement('td', { className: 'table__td table__td--actions', dataset: { label: I18n.t('ui.actions') } });
                const actionResult = config.actions(item);
                if (actionResult) {
                    if (Array.isArray(actionResult)) {
                        for (let a = 0; a < actionResult.length; a++) {
                            if (actionResult[a] && actionResult[a].nodeType) {
                                actionTd.appendChild(actionResult[a]);
                            }
                        }
                    } else if (actionResult.nodeType) {
                        actionTd.appendChild(actionResult);
                    }
                }
                row.appendChild(actionTd);
            }

            tbody.appendChild(row);
        }

        table.appendChild(tbody);

        // Wrap table in scrollable container for responsiveness
        const tableWrap = createElement('div', { className: 'table-wrap' }, [table]);
        container.appendChild(tableWrap);

        // --- Pagination controls ---
        if (paged.totalPages > 1 || config.pageSizeOptions) {
            const pagination = buildPagination(paged, config.onPageChange, config.pageSizeOptions, config.onPageSizeChange);
            container.appendChild(pagination);
        }

        // Callback after render
        if (typeof config.onRender === 'function') {
            config.onRender();
        }
    }

    /**
     * buildTableHeader — Private: build a <th> for a column definition.
     * Sortable columns get click handlers and direction indicators.
     */
    function buildTableHeader(col, config) {
        const thAttrs = {
            className: 'table__th' + (col.className ? ' ' + col.className : '')
        };

        if (col.sortable && typeof config.onSort === 'function') {
            thAttrs.className += ' table__th--sortable';
            thAttrs.style = { cursor: 'pointer' };
            thAttrs.events = {
                click: () => {
                    let newDir = 'asc';
                    if (config.sortColumn === col.key && config.sortDirection === 'asc') {
                        newDir = 'desc';
                    }
                    config.onSort(col.key, newDir);
                }
            };
        }

        const th = createElement('th', thAttrs);

        // Label text (or custom header render)
        if (typeof col.headerRender === 'function') {
            const headerContent = col.headerRender();
            if (headerContent && headerContent.nodeType) {
                th.appendChild(headerContent);
            }
        } else {
            th.appendChild(document.createTextNode(col.label || col.key));
        }

        // Sort indicator
        if (col.sortable && config.sortColumn === col.key) {
            const indicator = config.sortDirection === 'desc' ? ' \u25BC' : ' \u25B2';
            th.appendChild(createElement('span', {
                className: 'table__sort-indicator',
                textContent: indicator,
                ariaLabel: config.sortDirection === 'desc' ? I18n.t('ui.sortedDesc') : I18n.t('ui.sortedAsc')
            }));
        }

        return th;
    }

    /**
     * buildPagination — Private: build pagination controls.
     * Shows: [Prev] Page X of Y [Next] [PageSize selector]
     */
    function buildPagination(paged, onPageChange, pageSizeOptions, onPageSizeChange) {
        const children = [];

        const prevBtn = createElement('button', {
            className: 'btn btn--sm',
            textContent: I18n.t('ui.previous'),
            disabled: paged.page <= 1,
            events: {
                click: () => {
                    if (typeof onPageChange === 'function') {
                        onPageChange(paged.page - 1);
                    }
                }
            }
        });

        const pageInfo = createElement('span', {
            className: 'pagination__info',
            textContent: I18n.t('ui.pageInfo', {page: paged.page, totalPages: paged.totalPages, totalItems: paged.totalItems})
        });

        const nextBtn = createElement('button', {
            className: 'btn btn--sm',
            textContent: I18n.t('ui.next'),
            disabled: paged.page >= paged.totalPages,
            events: {
                click: () => {
                    if (typeof onPageChange === 'function') {
                        onPageChange(paged.page + 1);
                    }
                }
            }
        });

        children.push(prevBtn, pageInfo, nextBtn);

        if (Array.isArray(pageSizeOptions) && typeof onPageSizeChange === 'function') {
            const select = createElement('select', {
                className: 'form__select pagination__page-size',
                ariaLabel: I18n.t('ui.perPage'),
                events: {
                    change: (e) => {
                        onPageSizeChange(parseInt(e.target.value, 10));
                    }
                }
            });

            for (let i = 0; i < pageSizeOptions.length; i++) {
                const val = pageSizeOptions[i];
                const label = val === 0 ? I18n.t('ui.pageSizeAll') : String(val);
                select.appendChild(createElement('option', {
                    value: String(val),
                    textContent: label,
                    selected: val === paged.pageSize
                }));
            }

            const sizeLabel = createElement('span', {
                className: 'pagination__size-label',
                textContent: I18n.t('ui.perPage')
            });

            children.push(select, sizeLabel);
        }

        return createElement('div', { className: 'pagination' }, children);
    }

    // ===============================================================
    // confirmAction — Confirmation dialog before destructive actions
    // ===============================================================

    /**
     * confirmAction(config) — Show a modal confirmation dialog.
     *
     * config: {
     *   title: string — modal title,
     *   message: string — main message,
     *   detail: string — optional secondary detail text,
     *   confirmText: string — confirm button text (default 'Confirm'),
     *   confirmClass: string — CSS class for confirm button (default 'btn--danger'),
     *   onConfirm: function — called when user confirms (can be async),
     *   loadingTarget: string — optional loading target during confirm
     * }
     */
    function confirmAction(config) {
        const body = createElement('div', { className: 'confirm' });

        body.appendChild(createElement('p', {
            className: 'confirm__message',
            textContent: config.message || I18n.t('ui.areYouSure')
        }));

        if (config.detail) {
            body.appendChild(createElement('p', {
                className: 'confirm__detail',
                textContent: config.detail
            }));
        }

        if (config.contentEl) {
            body.appendChild(config.contentEl);
        }

        const btnRow = createElement('div', { className: 'confirm__actions' });

        const cancelBtn = createElement('button', {
            type: 'button',
            className: 'btn',
            textContent: I18n.t('ui.cancel'),
            events: { click: closeModal }
        });

        const confirmBtn = createElement('button', {
            type: 'button',
            className: 'btn ' + (config.confirmClass || 'btn--danger'),
            textContent: config.confirmText || I18n.t('ui.confirm')
        });

        confirmBtn.addEventListener('click', () => {
            if (typeof config.onConfirm !== 'function') {
                closeModal();
                return;
            }

            // Disable button and show loading state
            confirmBtn.disabled = true;
            cancelBtn.disabled = true;
            const originalText = confirmBtn.textContent;
            confirmBtn.textContent = I18n.t('ui.processing');

            let result;
            try {
                result = config.onConfirm();
            } catch (err) {
                confirmBtn.disabled = false;
                cancelBtn.disabled = false;
                confirmBtn.textContent = originalText;
                toast('error', I18n.t('ui.operationFailedDetail', { error: err.message || err }));
                return;
            }

            // Handle async onConfirm
            if (result && typeof result.then === 'function') {
                result
                    .then(() => {
                        closeModal();
                    })
                    .catch(_err => {
                        confirmBtn.disabled = false;
                        cancelBtn.disabled = false;
                        confirmBtn.textContent = originalText;
                        // Error toast is usually handled by apiAction, but
                        // provide fallback in case onConfirm does not use it
                    });
            } else {
                closeModal();
            }
        });

        btnRow.appendChild(cancelBtn);
        btnRow.appendChild(confirmBtn);
        body.appendChild(btnRow);

        showModal({
            title: config.title || I18n.t('ui.confirmAction'),
            bodyEl: body,
            modalClass: config.modalClass
        });
    }

    // ===============================================================
    // copyToClipboard — Copy text with toast feedback
    // ===============================================================

    /**
     * copyToClipboard(text, label) — Copy text to clipboard.
     * Shows a success toast with the label, or a fallback error.
     */
    function copyToClipboard(text, label) {
        const displayLabel = label || 'Value';

        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            navigator.clipboard.writeText(text).then(() => {
                toast('success', I18n.t('ui.copiedToClipboard', {label: displayLabel}));
            }).catch(() => {
                fallbackCopy(text, displayLabel);
            });
        } else {
            fallbackCopy(text, displayLabel);
        }
    }

    /**
     * fallbackCopy — Private: copy via a temporary textarea (for
     * browsers without Clipboard API).
     */
    function fallbackCopy(text, label) {
        const textarea = createElement('textarea', {
            value: text,
            style: {
                position: 'fixed',
                left: '-9999px',
                top: '-9999px'
            }
        });
        document.body.appendChild(textarea);
        textarea.select();
        try {
            const success = document.execCommand('copy');
            if (success) {
                toast('success', I18n.t('ui.copiedToClipboard', {label: label}));
            } else {
                toast('warning', I18n.t('ui.copyFailed'));
            }
        } catch {
            toast('warning', I18n.t('ui.copyFailed'));
        }
        document.body.removeChild(textarea);
    }

    // ===============================================================
    // initTab — Tab initialization helper
    // ===============================================================

    /**
     * initTab(containerId, renderFn, fetchFn, requiresDomain) —
     * Initialize a tab panel. Checks if a domain is selected (when
     * required), shows a placeholder if not, otherwise calls fetchFn
     * then renderFn.
     *
     * containerId: string — the tab content container ID
     * renderFn: function — called to render the tab content
     * fetchFn: function — returns a Promise to fetch data
     * requiresDomain: bool — if true, requires a domain to be selected
     */
    function initTab(containerId, renderFn, fetchFn, requiresDomain) {
        const container = document.getElementById(containerId);
        if (!container) return;

        // Check domain requirement
        if (requiresDomain && !State.get('currentDomain')) {
            container.textContent = '';
            container.appendChild(createElement('div', {
                className: 'tab-placeholder'
            }, [
                createElement('p', {
                    textContent: I18n.t('ui.selectDomainFirst')
                })
            ]));
            return;
        }

        // Fetch data then render
        if (typeof fetchFn === 'function') {
            const fetchResult = fetchFn();
            if (fetchResult && typeof fetchResult.then === 'function') {
                fetchResult.then(() => {
                    if (typeof renderFn === 'function') {
                        renderFn();
                    }
                }).catch(err => {
                    // Error is usually handled by apiAction/toast inside fetchFn
                    console.error('[UI] Tab init fetch error:', err);
                });
            } else {
                // Synchronous fetchFn
                if (typeof renderFn === 'function') {
                    renderFn();
                }
            }
        } else {
            // No fetchFn, just render
            if (typeof renderFn === 'function') {
                renderFn();
            }
        }
    }

    // ===============================================================
    // Public init — call once on DOMContentLoaded
    // ===============================================================

    /**
     * init() — Initialise UI module. Binds event handlers on the
     * static modal overlay present in index.html.
     * Must be called once before any showModal() call.
     */
    function init() {
        initModal();
    }

    // ===============================================================
    // Public API
    // ===============================================================
    return {
        init: init,
        toast: toast,
        showModal: showModal,
        closeModal: closeModal,
        forceCloseModal: forceCloseModal,
        showLoading: showLoading,
        hideLoading: hideLoading,
        showSkeleton: showSkeleton,
        apiAction: apiAction,
        renderTable: renderTable,
        confirmAction: confirmAction,
        copyToClipboard: copyToClipboard,
        initTab: initTab,
        createElement: createElement,
        actionButton: actionButton
    };
})();
