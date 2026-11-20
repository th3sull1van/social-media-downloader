/**
 * Social Media Downloader — Platform-Agnostic In-Page Overlay & Floating Widget
 * Renders a closed Shadow DOM floating launcher + modal overlay driven purely
 * by platform controller descriptors (`uiConfig`) and Core runtime callbacks.
 */
import { createMediaGrid } from './MediaGrid.js';

/**
 * Escapes HTML special characters for safe template insertion of static labels.
 * @param {any} str
 * @returns {string}
 */
export function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, (m) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[m]);
}

/**
 * @typedef {Object} OverlayUIConfig
 * @property {string} id
 * @property {string} label
 * @property {string} [fabThemeClass]
 * @property {string} [modalThemeClass]
 * @property {string} [chipClass]
 * @property {{ id: string, labelKey: string, action: string }[]} scanActions
 * @property {{ id: string, labelKey: string }[]} filterTabs
 * @property {(state: any) => string} [formatTitle]
 * @property {(item: any, filterId: string) => boolean} [matchesCustomFilter]
 */

/**
 * @param {{
 *   env?: any,
 *   runtime: any,
 *   fallbackIconUrl: string,
 *   uiConfig: OverlayUIConfig,
 *   callbacks: {
 *     onScanAll: () => void,
 *     onScanAction: (action: string) => void,
 *     onCancelScan: () => void,
 *     onModalOpen?: () => void,
 *     resolveAvatarUrl: () => string
 *   }
 * }} options
 */
export function createOverlayModal({
  env = /** @type {any} */ (globalThis),
  runtime,
  fallbackIconUrl,
  uiConfig,
  callbacks
}) {
  const doc = env.document || document;
  const chromeApi = env.chrome || (typeof chrome !== 'undefined' ? chrome : undefined);
  const setTimer = env.setTimeout || setTimeout;
  const { state, t, isAllowedMediaUrl, safeSendRuntimeMessage } = runtime;

  /** @type {any} */
  let uiRoot = null;
  /** @type {any} */
  let uiShadow = null;
  /** @type {any} */
  let floatingWidget = null;
  /** @type {any} */
  let floatingModal = null;

  function uiGetById(id) {
    return uiShadow?.querySelector(`#${id}`) || null;
  }

  const grid = createMediaGrid({
    env,
    state,
    uiGetById,
    isModalVisible: () => Boolean(floatingModal && floatingModal.style.display !== 'none'),
    isAllowedMediaUrl,
    t,
    filterTabs: uiConfig.filterTabs,
    matchesCustomFilter: uiConfig.matchesCustomFilter,
    onSelectionChanged: () => updateSelectionSummary()
  });

  function setScanStatusError(isError) {
    const statusBox = /** @type {HTMLElement | null} */ (uiGetById('smd-status-box'));
    const spinner = /** @type {HTMLElement | null} */ (statusBox?.querySelector('.smd-spinner') || null);
    const dot = /** @type {HTMLElement | null} */ (statusBox?.querySelector('.smd-status-dot') || null);
    const stopBtn = /** @type {HTMLElement | null} */ (uiGetById('smd-cancel-scan'));
    if (statusBox) statusBox.classList.toggle('smd-status-box--error', isError);
    if (spinner) spinner.style.display = isError ? 'none' : '';
    if (dot) dot.style.display = isError ? 'inline-block' : 'none';
    if (stopBtn) stopBtn.style.display = isError ? 'none' : '';
  }

  function setScanActionButtonsDisabled(disabled) {
    const actionButtons = uiShadow?.querySelectorAll('.smd-btn-action') || [];
    actionButtons.forEach((btn) => {
      /** @type {HTMLButtonElement} */ (btn).disabled = disabled;
    });
  }

  function updateScanStatusUI(isScanning, statusText = '', isError = false) {
    const statusBox = /** @type {HTMLElement | null} */ (uiGetById('smd-status-box'));
    const textEl = uiGetById('smd-status-text');
    if (statusBox) statusBox.style.display = isScanning ? 'flex' : 'none';
    if (textEl && statusText) textEl.textContent = statusText;
    setScanStatusError(isError && isScanning);
    setScanActionButtonsDisabled(isScanning && !isError);
  }

  function updateModalTitle() {
    const titleEl = uiGetById('smd-target-title');
    if (titleEl) {
      titleEl.textContent = '';
      titleEl.textContent = typeof uiConfig.formatTitle === 'function'
        ? uiConfig.formatTitle(state)
        : state.targetName;
    }
  }

  function updateAvatarUI() {
    const avatarEl = /** @type {HTMLImageElement | null} */ (uiGetById('smd-target-avatar'));
    if (avatarEl) {
      avatarEl.src = callbacks.resolveAvatarUrl() || fallbackIconUrl;
      avatarEl.onerror = function () {
        this.onerror = null;
        this.src = fallbackIconUrl;
      };
    }
  }

  function updateFloatingWidgetBadge() {
    if (!floatingWidget) mount();
    const badge = floatingWidget?.querySelector('.smd-badge');
    if (badge) badge.textContent = String(state.media.size);
  }

  function updateSelectionSummary() {
    let selectedCount = 0;
    let totalCount = 0;
    state.media.forEach((item) => {
      if (grid.matchesActive(item)) {
        totalCount++;
        if (state.selectedIds.has(item.id)) selectedCount++;
      }
    });
    const summary = uiGetById('smd-selection-summary');
    const btnDownload = /** @type {HTMLButtonElement | null} */ (uiGetById('smd-btn-start-download'));
    const downloadText = uiGetById('smd-download-text');

    if (summary) {
      summary.textContent = t('selectedSummary', [String(selectedCount), String(totalCount)])
        || `${selectedCount} of ${totalCount} selected`;
    }
    if (btnDownload && downloadText) {
      if (selectedCount > 0) {
        btnDownload.disabled = false;
        downloadText.textContent = selectedCount === 1
          ? t('downloadMediaSingle')
          : (t('downloadMediaBtn', [String(selectedCount)]) || `Download (${selectedCount})`);
      } else {
        btnDownload.disabled = true;
        downloadText.textContent = t('downloadBtnDefault');
      }
    }
  }

  function setModalActiveFilter(filterId) {
    state.activeFilter = filterId || 'all';
    if (!floatingModal) return;
    floatingModal.querySelectorAll('.smd-tab').forEach((tEl) => {
      const isMatch = tEl.getAttribute('data-filter') === state.activeFilter;
      tEl.classList.toggle('active', isMatch);
      tEl.setAttribute('aria-selected', String(isMatch));
    });
    grid.render();
  }

  function syncModalSettings() {
    if (!floatingModal) return;
    safeSendRuntimeMessage({ type: 'GET_SETTINGS' }, (res) => {
      if (res && res.success && res.settings) {
        const dedupEl = /** @type {HTMLInputElement | null} */ (uiGetById('smd-dedup-toggle'));
        const histEl = /** @type {HTMLInputElement | null} */ (uiGetById('smd-historical-dedup-toggle'));
        const histContainer = /** @type {HTMLElement | null} */ (uiGetById('smd-historical-dedup-container'));
        if (dedupEl) dedupEl.checked = !!res.settings.deduplicate;
        if (histEl) histEl.checked = !!res.settings.historicalDedup;
        if (histContainer) histContainer.style.display = res.settings.deduplicate ? 'inline-flex' : 'none';
        const preferredFormat = res.settings.defaultFormat === 'zip' ? 'zip' : 'individual';
        const formatRadio = /** @type {HTMLInputElement | null} */ (floatingModal?.querySelector(`input[name="smd-modal-format"][value="${preferredFormat}"]`));
        if (formatRadio) formatRadio.checked = true;
      }
    });
  }

  function updateDownloadProgressUI(job) {
    const box = /** @type {HTMLElement | null} */ (uiGetById('smd-download-progress-box'));
    const statusText = uiGetById('smd-progress-status-text');
    const percentage = uiGetById('smd-progress-percentage');
    const fill = /** @type {HTMLElement | null} */ (uiGetById('smd-progress-bar-fill'));
    const btnCancel = /** @type {HTMLElement | null} */ (uiGetById('smd-btn-cancel-download'));
    const btnRetry = /** @type {HTMLElement | null} */ (uiGetById('smd-btn-retry-download'));
    const receiptActions = /** @type {HTMLElement | null} */ (uiGetById('smd-receipt-actions'));

    if (!job) {
      if (box) box.style.display = 'none';
      state.isDownloading = false;
      if (btnRetry) btnRetry.style.display = 'none';
      if (receiptActions) receiptActions.style.display = 'none';
      return;
    }

    if (typeof job.receiptDownloadId === 'number') {
      state.lastReceiptDownloadId = job.receiptDownloadId;
    }

    if (!box || !statusText || !percentage || !fill) return;

    box.style.display = 'flex';
    const isPackaging = job.status === 'PACKAGING_ZIP';
    const handled = (job.completed || 0) + (job.skippedDuplicates || 0);
    const pct = isPackaging && typeof job.zipPercent === 'number'
      ? job.zipPercent
      : (job.total > 0 ? Math.min(100, Math.round((handled / job.total) * 100)) : 0);

    percentage.textContent = isPackaging ? `${pct}%` : `${pct}% (${handled}/${job.total})`;
    fill.style.width = `${pct}%`;

    const isRunning = ['QUEUED', 'DOWNLOADING', 'DOWNLOADING_BLOBS', 'PACKAGING_ZIP'].includes(job.status);
    const isFailed = job.status === 'FAILED' || job.status === 'FAILED_SIZE';
    const isTerminal = !isRunning && !isFailed;

    if (btnCancel) btnCancel.style.display = isRunning ? 'inline-block' : 'none';
    if (btnRetry) btnRetry.style.display = isFailed ? 'inline-block' : 'none';

    const btnStart = /** @type {HTMLButtonElement | null} */ (uiGetById('smd-btn-start-download'));
    if (btnStart) btnStart.disabled = isRunning;

    if (receiptActions) {
      const canShow = isTerminal && typeof job.receiptDownloadId === 'number';
      receiptActions.style.display = canShow ? 'flex' : 'none';
    }

    if (isFailed) {
      state.isDownloading = false;
      statusText.textContent = job.status === 'FAILED_SIZE'
        ? t('zipTooLarge')
        : (job.error === 'opfs_unavailable' || job.error === 'opfs_quota_exceeded'
          ? t('zipStorageUnavailable')
          : t('errorDownloading'));
      return;
    }

    if (isRunning) {
      statusText.textContent = isPackaging ? t('packagingZip') : t('downloading');
      return;
    }

    state.isDownloading = false;
    if (job.status === 'COMPLETED') {
      const parts = [];
      if (job.failed > 0) parts.push(t('itemsFailedLabel', [String(job.failed)]));
      if (typeof job.skippedDuplicates === 'number' && job.skippedDuplicates > 0) {
        parts.push(t('duplicatesSkipped', [String(job.skippedDuplicates)]));
      }
      const suffix = parts.length > 0 ? ` (${parts.join(', ')})` : '';
      statusText.textContent = job.filenameOverridden
        ? `${t('filenameOverriddenWarning')}${suffix}`
        : `${t('downloadComplete')}${suffix}`;
    } else {
      statusText.textContent = t('downloadCancelled');
    }
  }

  function toggleModal() {
    if (!floatingModal) mount();
    if (!floatingModal) return;
    const isVisible = floatingModal.style.display !== 'none';
    floatingModal.style.display = isVisible ? 'none' : 'flex';
    if (!isVisible) {
      callbacks.onModalOpen?.();
      updateModalTitle();
      updateAvatarUI();
      grid.render();
      syncModalSettings();
      safeSendRuntimeMessage({ type: 'GET_DOWNLOAD_STATUS' }, (res) => {
        if (res?.activeJob &&
            (!res.activeJob.platform || res.activeJob.platform === state.platform) &&
            ['QUEUED', 'DOWNLOADING', 'DOWNLOADING_BLOBS', 'PACKAGING_ZIP'].includes(res.activeJob.status)) {
          updateDownloadProgressUI(res.activeJob);
        }
      });
      /** @type {HTMLElement | null} */ (uiGetById('smd-modal-close'))?.focus?.();
    } else {
      /** @type {HTMLElement | null} */ (floatingWidget?.querySelector('.smd-fab'))?.focus?.();
    }
  }

  function mount() {
    if (floatingWidget && floatingModal) return;
    const mountParent = doc.body || doc.documentElement;
    if (!mountParent) return;

    doc.getElementById('smd-ui-root')?.remove();

    uiRoot = doc.createElement('div');
    uiRoot.id = 'smd-ui-root';
    uiShadow = uiRoot.attachShadow({ mode: 'closed' });
    const stylesheet = doc.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = chromeApi.runtime.getURL('src/content/inpage_overlay.css');
    uiShadow.appendChild(stylesheet);
    mountParent.appendChild(uiRoot);

    // A. Floating FAB Launch Button
    floatingWidget = doc.createElement('div');
    floatingWidget.id = 'smd-floating-widget';
    const fabTheme = uiConfig.fabThemeClass || '';
    floatingWidget.innerHTML = `
      <button class="smd-fab ${escapeHtml(fabTheme)}">
        <span>${escapeHtml(t('downloadFloating'))}</span>
        <span class="smd-badge">0</span>
      </button>
    `;
    floatingWidget.querySelector('button')?.addEventListener('click', toggleModal);
    uiShadow.appendChild(floatingWidget);

    // B. Embedded Modal Overlay
    floatingModal = doc.createElement('div');
    floatingModal.id = 'smd-modal-overlay';
    floatingModal.className = `smd-modal-overlay ${uiConfig.modalThemeClass || ''}`.trim();
    floatingModal.style.display = 'none';
    floatingModal.setAttribute('role', 'dialog');
    floatingModal.setAttribute('aria-modal', 'true');
    floatingModal.setAttribute('aria-labelledby', 'smd-target-title');

    const scanButtonsHtml = (uiConfig.scanActions || [])
      .map((btn) => `<button id="${escapeHtml(btn.id)}" class="smd-btn-action">${escapeHtml(t(btn.labelKey))}</button>`)
      .join('\n        ');

    const filterTabsHtml = (uiConfig.filterTabs || [])
      .map((tab, idx) => `<button class="smd-tab${idx === 0 ? ' active' : ''}" data-filter="${escapeHtml(tab.id)}">${escapeHtml(t(tab.labelKey))} <span id="smd-t-${escapeHtml(tab.id)}">(0)</span></button>`)
      .join('\n            ');

    floatingModal.innerHTML = `
      <div class="smd-modal-content">
        <!-- Header -->
        <div class="smd-modal-header">
          <div class="smd-header-info">
            <img id="smd-target-avatar" class="smd-modal-avatar" alt="">
            <div>
              <h3 id="smd-target-title" class="smd-target-title"></h3>
            </div>
          </div>
          <div class="smd-header-right">
            <span class="smd-platform-chip ${escapeHtml(uiConfig.chipClass || '')}">${escapeHtml(uiConfig.label)}</span>
            <button id="smd-modal-close" class="smd-close-btn" aria-label="${escapeHtml(t('closeModal'))}">&times;</button>
          </div>
        </div>

        <!-- Scanner Bar -->
        <div class="smd-scanner-bar">
          <button id="smd-scan-all" class="smd-btn-action smd-btn-primary">${escapeHtml(t('scanAll'))}</button>
          ${scanButtonsHtml}
        </div>

        <!-- Scan Status Box -->
        <div id="smd-status-box" class="smd-status-box" style="display: none;">
          <div>
            <span class="smd-spinner"></span><span class="smd-status-dot" style="display: none;"></span><span id="smd-status-text" aria-live="polite">${escapeHtml(t('scanning'))}</span>
          </div>
          <button id="smd-cancel-scan" class="smd-cancel-btn">${escapeHtml(t('stopScan'))}</button>
        </div>

        <!-- Filter Tabs -->
        <div class="smd-filter-bar">
          <div class="smd-filter-tabs smd-segmented" role="tablist" aria-label="${escapeHtml(t('filterLabel'))}">
            ${filterTabsHtml}
          </div>
        </div>

        <!-- Selection Bar -->
        <div class="smd-selection-bar">
          <div>
            <button id="smd-select-all" class="smd-link-btn">${escapeHtml(t('selectAll'))}</button>
            <span style="margin: 0 4px;">•</span>
            <button id="smd-deselect-all" class="smd-link-btn">${escapeHtml(t('deselectAll'))}</button>
          </div>
          <span id="smd-selection-summary">${escapeHtml(t('selectedSummary', ['0', '0']))}</span>
        </div>

        <!-- Media Grid -->
        <div id="smd-grid" class="smd-grid"></div>

        <!-- Empty State -->
        <div id="smd-empty" class="smd-empty-state" style="display: none;">
          <p>${escapeHtml(t('emptyStateTitle'))}</p>
          <small>${escapeHtml(t('emptyStateDesc'))}</small>
        </div>

        <!-- Progress Box -->
        <div id="smd-download-progress-box" class="smd-progress-card" style="display: none;">
          <div class="smd-progress-header">
            <span id="smd-progress-status-text">${escapeHtml(t('downloading'))}</span>
            <span id="smd-progress-percentage">0%</span>
          </div>
          <div class="smd-progress-track">
            <div id="smd-progress-bar-fill" class="smd-progress-fill" style="width: 0%;"></div>
          </div>
          <button id="smd-btn-retry-download" class="smd-cancel-btn" style="display: none; align-self: flex-end; margin-top: 4px; border-color: #9e9ea7; color: #9e9ea7;">${escapeHtml(t('retryBtn'))}</button>
          <button id="smd-btn-cancel-download" class="smd-cancel-btn" style="align-self: flex-end; margin-top: 4px;">${escapeHtml(t('cancelBtn'))}</button>
          <div id="smd-receipt-actions" class="smd-receipt-actions" style="display: none;">
            <button id="smd-btn-show-folder" class="smd-cancel-btn" style="border-color: #9e9ea7; color: #9e9ea7;">${escapeHtml(t('showInFolder'))}</button>
          </div>
        </div>

        <!-- Footer -->
        <div class="smd-modal-footer">
          <div class="smd-footer-options">
            <div class="smd-segmented" role="radiogroup" aria-label="${escapeHtml(t('formatLabel'))}">
              <label class="smd-segment">
                <input type="radio" name="smd-modal-format" value="individual" checked>
                <span class="smd-segment-face">${escapeHtml(t('formatFolders'))}</span>
              </label>
              <label class="smd-segment">
                <input type="radio" name="smd-modal-format" value="zip">
                <span class="smd-segment-face">${escapeHtml(t('formatZip'))}</span>
              </label>
            </div>
            <div class="smd-dedup-options">
              <label class="smd-checkbox-label" title="${escapeHtml(t('dedupExactTooltip'))}">
                <input type="checkbox" id="smd-dedup-toggle">
                <span>${escapeHtml(t('dedupExactLabel'))}</span>
              </label>
              <div id="smd-historical-dedup-container" class="smd-nested-option" style="display: none;">
                <label class="smd-checkbox-label" title="${escapeHtml(t('dedupHistoricalDesc'))}">
                  <input type="checkbox" id="smd-historical-dedup-toggle">
                  <span>${escapeHtml(t('dedupHistoricalLabel'))}</span>
                </label>
                <button type="button" id="smd-clear-history-btn" class="smd-clear-history-btn">${escapeHtml(t('clearHistoryBtn'))}</button>
              </div>
            </div>
          </div>
          <button id="smd-btn-start-download" class="smd-btn-download" disabled>
            <span id="smd-download-text">${escapeHtml(t('downloadBtnDefault'))}</span>
          </button>
        </div>
      </div>
    `;

    uiShadow.appendChild(floatingModal);
    updateModalTitle();
    updateAvatarUI();
    syncModalSettings();

    // Format + Deduplication persistence bindings (isTrusted-guarded)
    floatingModal.querySelectorAll('input[name="smd-modal-format"]').forEach((input) => {
      input.addEventListener('change', (e) => {
        if (e.isTrusted === false) return;
        const formatVal = /** @type {HTMLInputElement} */ (e.target).value === 'zip' ? 'zip' : 'individual';
        safeSendRuntimeMessage({ type: 'SAVE_SETTINGS', payload: { defaultFormat: formatVal } });
      });
    });

    uiGetById('smd-clear-history-btn')?.addEventListener('click', (e) => {
      if (e.isTrusted === false) return;
      const btn = /** @type {HTMLButtonElement | null} */ (e.currentTarget || uiGetById('smd-clear-history-btn'));
      if (btn) btn.disabled = true;
      safeSendRuntimeMessage({ type: 'CLEAR_DEDUP_HISTORY' }, (res) => {
        if (btn && res?.success) {
          const prev = btn.textContent;
          btn.textContent = '\u2713';
          setTimer(() => {
            btn.textContent = prev || t('clearHistoryBtn');
            btn.disabled = false;
          }, 1500);
        } else if (btn) {
          btn.disabled = false;
        }
      });
    });

    uiGetById('smd-dedup-toggle')?.addEventListener('change', (e) => {
      if (e.isTrusted === false) return;
      const isChecked = /** @type {HTMLInputElement} */ (e.target).checked;
      const histContainer = /** @type {HTMLElement | null} */ (uiGetById('smd-historical-dedup-container'));
      if (histContainer) histContainer.style.display = isChecked ? 'inline-flex' : 'none';
      const histEl = /** @type {HTMLInputElement | null} */ (uiGetById('smd-historical-dedup-toggle'));
      safeSendRuntimeMessage({
        type: 'SAVE_SETTINGS',
        payload: {
          deduplicate: isChecked,
          historicalDedup: isChecked && (histEl?.checked || false)
        }
      });
    });

    uiGetById('smd-historical-dedup-toggle')?.addEventListener('change', (e) => {
      if (e.isTrusted === false) return;
      const isHistChecked = /** @type {HTMLInputElement} */ (e.target).checked;
      const dedupEl = /** @type {HTMLInputElement | null} */ (uiGetById('smd-dedup-toggle'));
      safeSendRuntimeMessage({
        type: 'SAVE_SETTINGS',
        payload: {
          deduplicate: dedupEl?.checked || false,
          historicalDedup: isHistChecked
        }
      });
    });

    // Modal action bindings
    uiGetById('smd-modal-close')?.addEventListener('click', toggleModal);
    uiGetById('smd-scan-all')?.addEventListener('click', (event) => {
      if (event.isTrusted === false) return;
      callbacks.onScanAll();
    });

    for (const btn of uiConfig.scanActions || []) {
      uiGetById(btn.id)?.addEventListener('click', (event) => {
        if (event.isTrusted === false) return;
        callbacks.onScanAction(btn.action);
      });
    }

    uiGetById('smd-cancel-scan')?.addEventListener('click', (event) => {
      if (event.isTrusted === false) return;
      callbacks.onCancelScan();
    });

    const startSelectedDownload = () => {
      if (state.isDownloading) return;
      const format = /** @type {HTMLInputElement | null} */ (floatingModal.querySelector('input[name="smd-modal-format"]:checked'))?.value || 'individual';
      const deduplicate = /** @type {HTMLInputElement | null} */ (uiGetById('smd-dedup-toggle'))?.checked || false;
      const historicalDedup = deduplicate && (/** @type {HTMLInputElement | null} */ (uiGetById('smd-historical-dedup-toggle'))?.checked || false);
      const selected = Array.from(state.media.values()).filter((m) => grid.matchesActive(m) && state.selectedIds.has(m.id));
      if (!selected.length) return;
      state.isDownloading = true;
      safeSendRuntimeMessage({
        type: 'START_DOWNLOAD',
        platform: state.platform,
        targetName: state.username || state.targetName,
        items: selected,
        format,
        options: { deduplicate, historicalDedup }
      }, (res) => {
        if (chromeApi?.runtime?.lastError || !res?.success) {
          state.isDownloading = false;
          updateDownloadProgressUI(null);
          updateScanStatusUI(true, t('errorDownloading'), true);
        }
      });
    };

    uiGetById('smd-btn-retry-download')?.addEventListener('click', (event) => {
      if (event.isTrusted === false) return;
      startSelectedDownload();
    });

    uiGetById('smd-btn-show-folder')?.addEventListener('click', (event) => {
      if (event.isTrusted === false) return;
      const receiptId = state.lastReceiptDownloadId;
      if (typeof receiptId === 'number') {
        safeSendRuntimeMessage({ type: 'SHOW_DOWNLOAD_IN_FOLDER', downloadId: receiptId });
      }
    });

    // Esc closes the modal; Tab cycles inside the Shadow DOM while open.
    floatingModal.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        ev.stopPropagation();
        toggleModal();
        return;
      }
      if (ev.key === 'Tab') {
        const focusables = uiShadow.querySelectorAll('.smd-modal-overlay button:not([style*="display: none"]):not([disabled]), .smd-modal-overlay [role="button"][tabindex="0"], .smd-modal-overlay input');
        if (!focusables.length) return;
        const activeEl = uiShadow.activeElement || doc.activeElement;
        const list = Array.from(focusables)
          .filter((el) => /** @type {HTMLElement} */ (el).offsetParent !== null || el === activeEl);
        if (!list.length) return;
        const first = /** @type {HTMLElement} */ (list[0]);
        const last = /** @type {HTMLElement} */ (list[list.length - 1]);
        if (ev.shiftKey && activeEl === first) {
          ev.preventDefault();
          last.focus();
        } else if (!ev.shiftKey && activeEl === last) {
          ev.preventDefault();
          first.focus();
        }
      }
    });

    uiGetById('smd-btn-cancel-download')?.addEventListener('click', (event) => {
      if (event.isTrusted === false) return;
      safeSendRuntimeMessage({ type: 'CANCEL_DOWNLOAD' });
    });

    uiGetById('smd-select-all')?.addEventListener('click', () => {
      state.autoSelectAll = true;
      state.media.forEach((item) => {
        if (grid.matchesActive(item)) state.selectedIds.add(item.id);
      });
      grid.updateSelection();
    });

    uiGetById('smd-deselect-all')?.addEventListener('click', () => {
      state.autoSelectAll = false;
      if (state.activeFilter === 'all') {
        state.selectedIds.clear();
      } else {
        state.media.forEach((item) => {
          if (grid.matchesActive(item)) state.selectedIds.delete(item.id);
        });
      }
      grid.updateSelection();
    });

    floatingModal.querySelectorAll('.smd-tab').forEach((tab) => {
      tab.setAttribute('role', 'tab');
      tab.addEventListener('click', () => {
        setModalActiveFilter(tab.getAttribute('data-filter') || 'all');
      });
    });

    uiGetById('smd-btn-start-download')?.addEventListener('click', (event) => {
      if (event.isTrusted === false) return;
      startSelectedDownload();
    });
  }

  return {
    mount,
    toggleModal,
    updateModalTitle,
    updateAvatarUI,
    updateFloatingWidgetBadge,
    updateScanStatusUI,
    setScanActionButtonsDisabled,
    setModalActiveFilter,
    renderGrid: grid.render,
    scheduleGridRender: grid.scheduleRender,
    updateSelectionSummary,
    updateDownloadProgressUI,
    syncModalSettings
  };
}
