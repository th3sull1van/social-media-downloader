/**
 * Social Media Downloader — Popup Controller
 * Modular, multi-platform UI for Instagram, Facebook, and Reddit media downloading.
 */

document.addEventListener('DOMContentLoaded', async () => {
  function t(key, substitutions = []) {
    try {
      if (typeof chrome !== 'undefined' && chrome.i18n && typeof chrome.i18n.getMessage === 'function') {
        const subs = Array.isArray(substitutions) ? substitutions : [substitutions];
        const msg = chrome.i18n.getMessage(key, subs);
        if (msg) return msg;
      }
    } catch (e) {}
    return key;
  }

  function applyI18n() {
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      if (key) {
        const translation = t(key);
        if (translation && translation !== key) {
          if (el instanceof HTMLInputElement && (el.type === 'button' || el.type === 'submit')) {
            el.value = translation;
          } else {
            el.textContent = translation;
          }
        }
      }
    });

    document.querySelectorAll('[data-i18n-title]').forEach((el) => {
      const key = el.getAttribute('data-i18n-title');
      if (key) {
        const translation = t(key);
        if (translation && translation !== key) {
          el.setAttribute('title', translation);
        }
      }
    });
  }

  applyI18n();

  // DOM Elements
  const inactiveNotice = document.getElementById('inactive-notice');
  const activeSection = document.getElementById('active-section');
  const platformBadge = document.getElementById('platform-badge');
  const targetTypeLabel = document.getElementById('target-type-label');
  const targetTitle = document.getElementById('target-title');
  const mediaCounter = document.getElementById('media-counter');

  const subredditFilterContainer = document.getElementById('subreddit-filter-container');
  const filterSubreddit = document.getElementById('filter-subreddit');

  const btnScanAll = document.getElementById('btn-scan-all');
  const btnScanPosts = document.getElementById('btn-scan-posts');
  const btnScanStories = document.getElementById('btn-scan-stories');
  const btnScanHighlights = document.getElementById('btn-scan-highlights');
  const btnScanAvatar = document.getElementById('btn-scan-avatar');
  const btnScanGalleries = document.getElementById('btn-scan-galleries');
  const btnScanVideos = document.getElementById('btn-scan-videos');
  const btnScanRedgifs = document.getElementById('btn-scan-redgifs');

  const btnSelectAll = document.getElementById('btn-select-all');
  const btnDeselectAll = document.getElementById('btn-deselect-all');
  const btnDedup = document.getElementById('btn-dedup');
  const selectedSummary = document.getElementById('selected-summary');
  const mediaGrid = document.getElementById('media-grid');
  const emptyState = document.getElementById('empty-state');
  const btnDownload = document.getElementById('btn-download');
  const downloadBtnText = document.getElementById('download-btn-text');

  const progressContainer = document.getElementById('download-progress-container');
  const progressStatusText = document.getElementById('progress-status-text');
  const progressPercentage = document.getElementById('progress-percentage');
  const progressBarFill = document.getElementById('progress-bar-fill');
  const btnCancelDownload = document.getElementById('btn-cancel-download');

  // State
  let currentTabId = null;
  let platform = 'unknown';
  let targetName = 'Media_Collection';
  let allMedia = [];
  let selectedIds = new Set();
  let activeFilter = 'all';
  let currentSubreddit = 'all';
  let dedupActive = true;
  let isScanning = false;
  let subredditFilterEnabled = false;
  let pluginFilters = [];
  let progressHideTimer = null;
  let displayedProgressJob = null;

  const MEDIA_HOST_SUFFIXES = [
    'instagram.com', 'cdninstagram.com', 'fbcdn.net',
    'reddit.com', 'redd.it', 'redditmedia.com', 'redgifs.com', 'imgur.com'
  ];

  function isAllowedMediaUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return false;
    if (!/^https?:\/\//i.test(rawUrl)) return false;
    try {
      const host = new URL(rawUrl).hostname.toLowerCase();
      return MEDIA_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith('.' + suffix));
    } catch (e) {
      return false;
    }
  }

  async function getActiveTab() {
    if (typeof chrome === 'undefined' || !chrome.tabs) return null;
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0] || null;
  }

  async function init() {
    const tab = await getActiveTab();
    if (!tab || !tab.url) {
      showInactiveState();
      return;
    }

    // Resolve the active platform plugin through the background registry instead
    // of hard-coding hostname checks. The plugin owns its detection.
    const infoRes = await getPluginInfo(tab.url);
    if (!infoRes || !infoRes.success || !infoRes.info) {
      showInactiveState();
      return;
    }
    const info = infoRes.info;

    currentTabId = tab.id;
    platform = info.id;
    pluginFilters = info.filters || [];

    applyPluginExtras(info);

    // Check background active job status
    chrome.runtime.sendMessage({ type: 'GET_DOWNLOAD_STATUS' }, (res) => {
      if (chrome.runtime.lastError) return;
      if (res?.activeJob && ['DOWNLOADING', 'DOWNLOADING_BLOBS', 'PACKAGING_ZIP'].includes(res.activeJob.status)) {
        updateProgressUI(res.activeJob);
      }
    });

    // Request state from content script
    try {
      chrome.tabs.sendMessage(currentTabId, { type: 'GET_PAGE_STATE' }, (response) => {
        if (chrome.runtime.lastError || !response) {
          chrome.scripting.executeScript({
            target: { tabId: currentTabId },
            files: ['src/content/content.js']
          }).then(() => {
            setTimeout(refreshState, 300);
          }).catch(() => {
            showInactiveState();
          });
          return;
        }
        renderPageState(response);
      });
    } catch (e) {
      showInactiveState();
    }
  }

  /**
   * Queries the detected plugin's metadata (id, version, capabilities, filters)
   * through the background service worker. This keeps the popup free of
   * platform-identity branching for control visibility (SPEC §57/§58).
   * @param {string} url
   * @returns {Promise<{ success: boolean, info?: any } | null>}
   */
  function getPluginInfo(url) {
    return new Promise((resolve) => {
      let hostname = '';
      try {
        hostname = new URL(url).hostname;
      } catch (e) {}
      chrome.runtime.sendMessage({ type: 'GET_PLUGIN_INFO', url, hostname }, (res) => {
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        resolve(res || null);
      });
    });
  }

  /** @param {string} id @param {boolean} shouldShow */
  function showIf(id, shouldShow) {
    const el = document.getElementById(id);
    if (el) el.style.display = shouldShow ? '' : 'none';
  }

  /**
   * Applies plugin metadata (capabilities / filters) to the popup chrome:
   * platform badge, target label, quick-scanner buttons, filter tabs, and the
   * Reddit-specific subreddit filter / deduplicate control. Visibility is
   * derived from declared capabilities (SPEC §58), never from a platform id.
   * @param {{ id: string, capabilities?: object, filters?: any[] }} info
   */
  function applyPluginExtras(info) {
    const caps = info.capabilities || {};
    const scan = caps.scan || {};
    const media = caps.media || {};
    const processing = caps.processing || {};
    const filters = info.filters || [];
    const filterIds = filters.map((f) => f.id);

    // Platform identity (badge / theme) is display metadata from the plugin.
    const displayNames = { instagram: 'Instagram', facebook: 'Facebook', reddit: 'Reddit' };
    platformBadge.textContent = displayNames[info.id] || info.id;
    platformBadge.className = `platform-badge ${info.id}-badge`;
    document.body.classList.toggle('fb-theme', info.id === 'facebook');
    document.body.classList.toggle('reddit-theme', info.id === 'reddit');

    // Target type label derived from capabilities (generic).
    if (scan.subreddit || scan.collection === 'feed') {
      targetTypeLabel.textContent = t('detectedFeed');
    } else if (scan.album || scan.collection) {
      targetTypeLabel.textContent = t('detectedAlbum');
    } else {
      targetTypeLabel.textContent = t('detectedProfile');
    }

    // Reddit-native state.
    subredditFilterEnabled = Boolean(scan.subreddit);

    // Quick scanner buttons — visibility from capabilities, not a platform id.
    showIf('ig-specific-buttons', Boolean(scan.stories || scan.highlights || media.avatar));
    showIf('reddit-specific-buttons', Boolean(filterIds.includes('redgifs') || (filterIds.includes('gallery') && media.gallery)));
    showIf('btn-scan-posts', Boolean(scan.post));
    showIf('btn-scan-stories', Boolean(scan.stories));
    showIf('btn-scan-highlights', Boolean(scan.highlights));
    showIf('btn-scan-avatar', Boolean(media.avatar));
    showIf('btn-scan-galleries', Boolean(media.gallery));
    showIf('btn-scan-videos', Boolean(media.video));
    showIf('btn-scan-redgifs', Boolean(filterIds.includes('redgifs')));

    // Filter tabs driven by the plugin's declared filters/capabilities.
    document.querySelectorAll('.ig-only.tab').forEach((el) => {
      const dataFilter = el.getAttribute('data-filter');
      const show = dataFilter === 'stories' ? Boolean(scan.stories)
        : dataFilter === 'highlights' ? Boolean(scan.highlights)
        : true;
      el.style.display = show ? '' : 'none';
    });
    document.querySelectorAll('.reddit-only.tab').forEach((el) => {
      const dataFilter = el.getAttribute('data-filter');
      const show = dataFilter === 'gallery' ? Boolean(media.gallery)
        : dataFilter === 'redgifs' ? Boolean(filterIds.includes('redgifs'))
        : true;
      el.style.display = show ? '' : 'none';
    });

    // Subreddit filter row + deduplicate button.
    showIf('subreddit-filter-container', subredditFilterEnabled);
    showIf('btn-dedup', Boolean(processing.deduplication));

    if (!subredditFilterEnabled) currentSubreddit = 'all';
  }

  function showInactiveState() {
    inactiveNotice.style.display = 'flex';
    activeSection.style.display = 'none';
  }

  function refreshState() {
    if (!currentTabId) return;
    chrome.tabs.sendMessage(currentTabId, { type: 'GET_PAGE_STATE' }, (res) => {
      if (!chrome.runtime.lastError && res) renderPageState(res);
    });
  }

  function renderPageState(pageState) {
    inactiveNotice.style.display = 'none';
    activeSection.style.display = 'block';

    targetName = pageState.targetName || pageState.username || 'Media_Collection';
    targetTitle.textContent = targetName;
    targetTitle.title = targetName;

    allMedia = Array.isArray(pageState.media) ? pageState.media : [];
    mediaCounter.textContent = String(allMedia.length);
    isScanning = !!pageState.isScanning;

    const currentIds = new Set(allMedia.map((m) => m?.id).filter(Boolean));
    for (const id of selectedIds) {
      if (!currentIds.has(id)) selectedIds.delete(id);
    }
    allMedia.forEach((m) => {
      if (m?.id) selectedIds.add(m.id);
    });

    updateSubredditDropdown();
    renderGrid();
    updateSelectionSummary();

    if (!window._smdAutoScanned && !isScanning && allMedia.length === 0) {
      window._smdAutoScanned = true;
      triggerScan('TRIGGER_SCAN_ALL');
    }
  }

  function updateSubredditDropdown() {
    if (!filterSubreddit || !subredditFilterContainer || !subredditFilterEnabled) return;

    const subreddits = new Map();
    allMedia.forEach((item) => {
      const sub = (item.metadata?.subreddit || item.collection?.id || '').replace(/^r\//, '').trim();
      if (sub) {
        subreddits.set(sub, (subreddits.get(sub) || 0) + 1);
      }
    });

    if (subreddits.size > 1) {
      subredditFilterContainer.style.display = 'flex';
      const prev = currentSubreddit;
      filterSubreddit.textContent = '';
      const allOpt = document.createElement('option');
      allOpt.value = 'all';
      allOpt.textContent = `${t('filterSubredditAll')} (${allMedia.length})`;
      filterSubreddit.appendChild(allOpt);
      subreddits.forEach((count, sub) => {
        const opt = document.createElement('option');
        opt.value = sub;
        opt.textContent = `r/${sub} (${count})`;
        if (sub === prev) opt.selected = true;
        filterSubreddit.appendChild(opt);
      });
    } else {
      subredditFilterContainer.style.display = 'none';
      currentSubreddit = 'all';
    }
  }

  function matchesFilter(item) {
    if (!item) return false;

    if (currentSubreddit !== 'all' && subredditFilterEnabled) {
      const sub = (item.metadata?.subreddit || item.collection?.id || '').replace(/^r\//, '').trim();
      if (sub.toLowerCase() !== currentSubreddit.toLowerCase()) return false;
    }

    if (activeFilter === 'all') return true;
    if (activeFilter === 'image') return item.type === 'image';
    if (activeFilter === 'video') return item.type === 'video';
    if (activeFilter === 'stories') return item.metadata?.category === 'stories';
    if (activeFilter === 'highlights') return item.metadata?.category === 'highlights';
    if (activeFilter === 'gallery') return item.sourceType === 'reddit_gallery' || item.metadata?.isGallery;
    if (activeFilter === 'redgifs') return item.sourceType === 'redgifs' || item.metadata?.isRedGifs;
    return true;
  }

  function mediaKey(item) {
    const mediaId = item.metadata?.mediaId ||
      (item.downloadUrl || item.url || '').split('/').pop()?.split('?')[0] || '';
    if (mediaId && mediaId !== 'media') return `${item.type || 'media'}_${mediaId}`;
    return item.downloadUrl || item.url || item.id || '';
  }

  function getVisibleMedia() {
    let items = allMedia.filter(matchesFilter);
    if (dedupActive) {
      const seen = new Set();
      items = items.filter((item) => {
        const key = mediaKey(item);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }
    return items;
  }

  function renderGrid() {
    updateTabCounts();

    const filtered = getVisibleMedia();

    if (filtered.length === 0) {
      mediaGrid.style.display = 'none';
      emptyState.style.display = 'flex';
      btnDownload.disabled = true;
      updateSelectionSummary();
      return;
    }

    mediaGrid.style.display = 'grid';
    emptyState.style.display = 'none';
    mediaGrid.textContent = '';

    filtered.forEach((item) => {
      const isSelected = selectedIds.has(item.id);
      const div = document.createElement('div');
      div.className = `grid-item ${isSelected ? 'selected' : ''}`;

      const thumb = item.thumbnailUrl || item.url;
      if (isAllowedMediaUrl(thumb)) {
        const img = document.createElement('img');
        img.src = thumb;
        img.alt = 'Preview';
        img.loading = 'lazy';
        div.appendChild(img);
      }

      const check = document.createElement('div');
      check.className = 'check-overlay';
      if (isSelected) check.textContent = '✓';
      div.appendChild(check);

      if (item.type === 'video') {
        const tag = document.createElement('span');
        tag.className = 'tag-video';
        tag.textContent = 'VIDEO';
        div.appendChild(tag);
      }

      if (item.metadata?.isCarousel) {
        const tag = document.createElement('span');
        tag.className = 'tag-car';
        tag.textContent = `${item.metadata.slideIndex || 1}/${item.metadata.slideTotal || 1}`;
        div.appendChild(tag);
      }

      if (item.width && item.height) {
        const tag = document.createElement('span');
        tag.className = 'tag-res';
        tag.textContent = `${item.width}x${item.height}`;
        div.appendChild(tag);
      }

      div.addEventListener('click', () => {
        if (selectedIds.has(item.id)) {
          selectedIds.delete(item.id);
          div.classList.remove('selected');
          div.querySelector('.check-overlay').textContent = '';
        } else {
          selectedIds.add(item.id);
          div.classList.add('selected');
          div.querySelector('.check-overlay').textContent = '✓';
        }
        updateSelectionSummary();
      });

      mediaGrid.appendChild(div);
    });

    updateSelectionSummary();
  }

  function updateTabCounts() {
    let allCount = 0, imgCount = 0, vidCount = 0, storyCount = 0, hlCount = 0, galCount = 0, rgCount = 0;
    allMedia.forEach((m) => {
      allCount++;
      if (m.type === 'video') vidCount++; else imgCount++;
      if (m.metadata?.category === 'stories') storyCount++;
      if (m.metadata?.category === 'highlights') hlCount++;
      if (m.sourceType === 'reddit_gallery' || m.metadata?.isGallery) galCount++;
      if (m.sourceType === 'redgifs' || m.metadata?.isRedGifs) rgCount++;
    });

    const setEl = (id, count) => {
      const el = document.getElementById(id);
      if (el) el.textContent = `(${count})`;
    };
    setEl('p-tab-all', allCount);
    setEl('p-tab-image', imgCount);
    setEl('p-tab-video', vidCount);
    setEl('p-tab-stories', storyCount);
    setEl('p-tab-highlights', hlCount);
    setEl('p-tab-gallery', galCount);
    setEl('p-tab-redgifs', rgCount);
  }

  function updateSelectionSummary() {
    const selectedCount = selectedIds.size;
    const totalCount = allMedia.length;
    selectedSummary.textContent = t('selectedSummary', [String(selectedCount), String(totalCount)]);

    if (selectedCount > 0) {
      btnDownload.disabled = false;
      downloadBtnText.textContent = t('downloadMediaBtn', [String(selectedCount)]);
    } else {
      btnDownload.disabled = true;
      downloadBtnText.textContent = t('downloadBtnDefault');
    }
  }

  function updateProgressUI(job) {
    if (progressHideTimer) {
      clearTimeout(progressHideTimer);
      progressHideTimer = null;
    }
    displayedProgressJob = job || null;

    if (!job) {
      progressContainer.style.display = 'none';
      return;
    }

    progressContainer.style.display = 'block';
    const isPackaging = job.status === 'PACKAGING_ZIP';
    const percent = isPackaging && typeof job.zipPercent === 'number'
      ? job.zipPercent
      : (job.total > 0 ? Math.round((job.completed / job.total) * 100) : 0);

    progressPercentage.textContent = isPackaging ? `${percent}%` : `${percent}% (${job.completed}/${job.total})`;
    progressBarFill.style.width = `${percent}%`;

    const jobRunning = ['DOWNLOADING', 'DOWNLOADING_BLOBS', 'PACKAGING_ZIP'].includes(job.status);
    btnCancelDownload.style.display = jobRunning ? 'inline-block' : 'none';

    if (isPackaging) {
      progressStatusText.textContent = t('packagingZip');
    } else if (job.status === 'COMPLETED') {
      const parts = [];
      if (job.failed > 0) parts.push(t('itemsFailedLabel', [String(job.failed)]));
      if (typeof job.skippedDuplicates === 'number' && job.skippedDuplicates > 0) {
        parts.push(t('duplicatesSkipped', [String(job.skippedDuplicates)]));
      }
      const suffix = parts.length > 0 ? ` (${parts.join(', ')})` : '';
      progressStatusText.textContent = job.filenameOverridden ? `${t('filenameOverriddenWarning')}${suffix}` : `${t('downloadComplete')}${suffix}`;
      const displayedJob = job;
      progressHideTimer = setTimeout(() => {
        progressHideTimer = null;
        if (displayedProgressJob === displayedJob) progressContainer.style.display = 'none';
      }, job.filenameOverridden ? 10000 : 4000);
    } else if (job.status === 'CANCELLED') {
      progressStatusText.textContent = t('downloadCancelled');
      const displayedJob = job;
      progressHideTimer = setTimeout(() => {
        progressHideTimer = null;
        if (displayedProgressJob === displayedJob) progressContainer.style.display = 'none';
      }, 4000);
    } else if (job.status === 'FAILED_SIZE') {
      progressStatusText.textContent = t('zipTooLarge');
      const displayedJob = job;
      progressHideTimer = setTimeout(() => {
        progressHideTimer = null;
        if (displayedProgressJob === displayedJob) progressContainer.style.display = 'none';
      }, 8000);
    } else if (job.status === 'FAILED') {
      progressStatusText.textContent = job.error === 'opfs_unavailable' || job.error === 'opfs_quota_exceeded'
        ? t('zipStorageUnavailable')
        : t('errorDownloading');
      const displayedJob = job;
      progressHideTimer = setTimeout(() => {
        progressHideTimer = null;
        if (displayedProgressJob === displayedJob) progressContainer.style.display = 'none';
      }, 6000);
    } else {
      progressStatusText.textContent = t('downloading');
    }
  }

  // Deduplication Settings Bindings
  const popupDedupToggle = document.getElementById('popup-dedup-toggle');
  const popupHistoricalDedupToggle = document.getElementById('popup-historical-dedup-toggle');
  const popupHistoricalContainer = document.getElementById('popup-historical-dedup-container');

  chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (res) => {
    if (res && res.success && res.settings) {
      if (popupDedupToggle instanceof HTMLInputElement) {
        popupDedupToggle.checked = !!res.settings.deduplicate;
      }
      if (popupHistoricalDedupToggle instanceof HTMLInputElement) {
        popupHistoricalDedupToggle.checked = !!res.settings.historicalDedup;
      }
      if (popupHistoricalContainer) {
        popupHistoricalContainer.style.display = res.settings.deduplicate ? 'inline-flex' : 'none';
      }
    }
  });

  popupDedupToggle?.addEventListener('change', (e) => {
    const isChecked = /** @type {HTMLInputElement} */ (e.target).checked;
    if (popupHistoricalContainer) {
      popupHistoricalContainer.style.display = isChecked ? 'inline-flex' : 'none';
    }
    chrome.runtime.sendMessage({
      type: 'SAVE_SETTINGS',
      payload: {
        deduplicate: isChecked,
        historicalDedup: isChecked && (popupHistoricalDedupToggle instanceof HTMLInputElement && popupHistoricalDedupToggle.checked)
      }
    });
  });

  popupHistoricalDedupToggle?.addEventListener('change', (e) => {
    const isHistChecked = /** @type {HTMLInputElement} */ (e.target).checked;
    chrome.runtime.sendMessage({
      type: 'SAVE_SETTINGS',
      payload: {
        deduplicate: popupDedupToggle instanceof HTMLInputElement && popupDedupToggle.checked,
        historicalDedup: isHistChecked
      }
    });
  });

  // Filter Tabs
  document.querySelectorAll('.filter-tabs .tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.filter-tabs .tab').forEach(tEl => tEl.classList.remove('active'));
      tab.classList.add('active');
      activeFilter = tab.getAttribute('data-filter') || 'all';
      renderGrid();
    });
  });

  // Subreddit change
  if (filterSubreddit) {
    filterSubreddit.addEventListener('change', (e) => {
      currentSubreddit = /** @type {HTMLSelectElement} */ (e.target).value;
      renderGrid();
    });
  }

  // Selection
  btnSelectAll.addEventListener('click', () => {
    getVisibleMedia().forEach((m) => {
      selectedIds.add(m.id);
    });
    renderGrid();
  });

  btnDeselectAll.addEventListener('click', () => {
    const visible = getVisibleMedia().map((m) => m.id);
    if (visible.length === allMedia.length) {
      selectedIds.clear();
    } else {
      visible.forEach((id) => selectedIds.delete(id));
    }
    renderGrid();
  });

  if (btnDedup) {
    btnDedup.addEventListener('click', () => {
      dedupActive = !dedupActive;
      btnDedup.classList.toggle('active', dedupActive);
      btnDedup.style.color = dedupActive ? 'var(--color-accent)' : 'var(--text-muted)';
      renderGrid();
    });
  }

  // Scanner triggers
  function triggerScan(actionType) {
    if (!currentTabId) return;
    btnScanAll.disabled = true;
    btnScanAll.textContent = t('scanning');

    chrome.tabs.sendMessage(currentTabId, { type: actionType }, () => {
      if (chrome.runtime.lastError) {
        console.warn('[SMD Popup] Scan trigger failed:', chrome.runtime.lastError.message);
      }
      btnScanAll.disabled = false;
      btnScanAll.textContent = t('scanAll');
      refreshState();
    });
  }

  btnScanAll.addEventListener('click', () => triggerScan('TRIGGER_SCAN_ALL'));
  btnScanPosts.addEventListener('click', () => triggerScan('TRIGGER_SCAN_POSTS'));
  btnScanStories.addEventListener('click', () => triggerScan('TRIGGER_SCAN_STORIES'));
  btnScanHighlights.addEventListener('click', () => triggerScan('TRIGGER_SCAN_HIGHLIGHTS'));
  btnScanAvatar.addEventListener('click', () => triggerScan('TRIGGER_SCAN_AVATAR'));
  btnScanGalleries.addEventListener('click', () => triggerScan('TRIGGER_SCAN_GALLERIES'));
  btnScanVideos.addEventListener('click', () => triggerScan('TRIGGER_SCAN_VIDEOS'));
  btnScanRedgifs.addEventListener('click', () => triggerScan('TRIGGER_SCAN_REDGIFS'));

  // Download Trigger
  btnDownload.addEventListener('click', () => {
    const visibleIds = new Set(getVisibleMedia().map((m) => m.id));
    const selectedItems = allMedia.filter(m => selectedIds.has(m.id) && visibleIds.has(m.id));
    if (!selectedItems.length) return;

    const format = /** @type {HTMLInputElement} */ (document.querySelector('input[name="download-format"]:checked'))?.value || 'individual';
    const deduplicate = popupDedupToggle instanceof HTMLInputElement ? popupDedupToggle.checked : false;
    const historicalDedup = deduplicate && (popupHistoricalDedupToggle instanceof HTMLInputElement ? popupHistoricalDedupToggle.checked : false);

    chrome.runtime.sendMessage({
      type: 'START_DOWNLOAD',
      platform,
      targetName,
      items: selectedItems,
      format,
      options: { deduplicate, historicalDedup }
    }, (response) => {
      if (chrome.runtime.lastError || !response?.success) {
        if (chrome.runtime.lastError) {
          console.warn('[SMD Popup] Download failed to start:', chrome.runtime.lastError.message);
        }
        return;
      }
      progressContainer.style.display = 'block';
      progressStatusText.textContent = t('downloadStarting');
      progressBarFill.style.width = '0%';
      progressPercentage.textContent = '0%';
    });
  });

  btnCancelDownload.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'CANCEL_DOWNLOAD' }, () => {
      void chrome.runtime.lastError;
      btnCancelDownload.style.display = 'none';
      progressStatusText.textContent = t('downloadCancelled');
    });
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'DOWNLOAD_PROGRESS_UPDATE' && message.job) {
      updateProgressUI(message.job);
    }
  });

  init();
});
