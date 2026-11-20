/**
 * Social Media Downloader — Incremental Media Grid Renderer
 * Platform-agnostic, DOM-reusing grid with lazy IntersectionObserver thumbnails,
 * dynamic filter-tab counts, and keyboard-accessible selection cards.
 */

const VIDEO_FILE_RE = /\.(?:mp4|webm|m3u8|mpd)(?:[?#]|$)/i;

/**
 * Evaluates whether a media item matches a filter ID.
 * Platform-specific filter IDs are delegated to `customMatcher`.
 * @param {any} item
 * @param {string} filterId
 * @param {(item: any, filterId: string) => boolean} [customMatcher]
 * @returns {boolean}
 */
export function matchesMediaFilter(item, filterId, customMatcher) {
  if (!item) return false;
  if (!filterId || filterId === 'all') return true;
  if (filterId === 'image') return item.type === 'image';
  if (filterId === 'video') return item.type === 'video';
  if (typeof customMatcher === 'function') {
    return Boolean(customMatcher(item, filterId));
  }
  return true;
}

/**
 * Creates a DOM-reusing incremental media grid bound to the overlay modal.
 * @param {{
 *   env?: any,
 *   state: { media: Map<string, any>, selectedIds: Set<string>, activeFilter: string },
 *   uiGetById: (id: string) => any,
 *   isModalVisible: () => boolean,
 *   isAllowedMediaUrl: (url: string, itemPlatform?: string) => boolean,
 *   t: (key: string, subs?: string | string[]) => string,
 *   filterTabs?: { id: string, labelKey?: string }[],
 *   matchesCustomFilter?: (item: any, filterId: string) => boolean,
 *   onSelectionChanged?: () => void
 * }} options
 */
export function createMediaGrid({
  env = /** @type {any} */ (globalThis),
  state,
  uiGetById,
  isModalVisible,
  isAllowedMediaUrl,
  t,
  filterTabs = [{ id: 'all' }, { id: 'image' }, { id: 'video' }],
  matchesCustomFilter,
  onSelectionChanged = () => {}
}) {
  const doc = env.document || document;
  const IO = env.IntersectionObserver || (typeof IntersectionObserver !== 'undefined' ? IntersectionObserver : null);
  const raf = env.requestAnimationFrame || (typeof requestAnimationFrame === 'function' ? requestAnimationFrame : null);
  const setTimer = env.setTimeout || setTimeout;

  /** @type {any} */
  let cardImageObserver = null;
  /** @type {Map<string, { card: any, check: any, tags: Record<string, any>, image: any, placeholder: any, thumb: string | null, label: string | null, selected: boolean | null }>} */
  const gridCards = new Map();
  let renderFrameScheduled = false;

  const extraFilterIds = filterTabs
    .map((tab) => tab.id)
    .filter((id) => id !== 'all' && id !== 'image' && id !== 'video');

  function matchesActive(item) {
    return matchesMediaFilter(item, state.activeFilter, matchesCustomFilter);
  }

  function getCardImageObserver(rootContainer) {
    if (!cardImageObserver && IO) {
      cardImageObserver = new IO((entries, observer) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const img = /** @type {HTMLImageElement} */ (entry.target);
            const src = img.dataset.src;
            if (src) {
              img.src = src;
              img.removeAttribute('data-src');
            }
            observer.unobserve(img);
          }
        });
      }, {
        root: rootContainer,
        rootMargin: '250px 0px 250px 0px'
      });
    }
    return cardImageObserver;
  }

  function updateSelection() {
    for (const [id, record] of gridCards) {
      const selected = state.selectedIds.has(id);
      if (record.selected === selected) continue;
      record.selected = selected;
      record.card.classList.toggle('selected', selected);
      record.card.setAttribute('aria-pressed', String(selected));
      record.check.textContent = selected ? '\u2713' : '';
    }
    onSelectionChanged();
  }

  function updateCard(record, item, observer) {
    const thumb = item.thumbnailUrl || item.url;
    const isVideoFileUrl = item.type === 'video' && typeof thumb === 'string' && VIDEO_FILE_RE.test(thumb);
    const allowedThumb = isAllowedMediaUrl(thumb) && !isVideoFileUrl ? thumb : '';
    const wantsPlaceholder = !allowedThumb && item.type === 'video';

    if (record.thumb !== allowedThumb || Boolean(record.placeholder) !== wantsPlaceholder) {
      record.thumb = allowedThumb;
      if (record.image) {
        observer?.unobserve(record.image);
        record.image.remove();
        record.image = null;
      }
      if (record.placeholder) {
        record.placeholder.remove();
        record.placeholder = null;
      }
      if (allowedThumb) {
        const image = doc.createElement('img');
        image.dataset.src = allowedThumb;
        image.alt = t('mediaItemLabel');
        image.loading = 'lazy';
        image.decoding = 'async';
        image.width = 130;
        image.height = 130;
        record.card.insertBefore(image, record.card.firstChild);
        record.image = image;
        if (observer) observer.observe(image); else image.src = allowedThumb;
      } else if (wantsPlaceholder) {
        const placeholder = doc.createElement('div');
        placeholder.className = 'smd-video-placeholder';
        placeholder.setAttribute('aria-hidden', 'true');
        placeholder.textContent = '\u25b6';
        record.card.insertBefore(placeholder, record.card.firstChild);
        record.placeholder = placeholder;
      }
    }

    const resolution = item.width && item.height ? `${item.width}x${item.height}` : '';
    const label = resolution || t('mediaItemLabel');
    if (record.label !== label) {
      record.label = label;
      record.card.setAttribute('aria-label', label);
    }

    const carousel = item.isCarousel || item.metadata?.isCarousel;
    const videoLabel = t('badgeVideo');
    const tags = {
      video: item.type === 'video' ? (videoLabel && videoLabel !== 'badgeVideo' ? videoLabel : 'VIDEO') : '',
      carousel: carousel ? `${item.slideIndex || item.metadata?.slideIndex || 1}/${item.slideTotal || item.metadata?.slideTotal || 1}` : '',
      resolution
    };
    for (const [kind, text] of Object.entries(tags)) {
      let tag = record.tags[kind];
      if (!text) {
        tag?.remove();
        delete record.tags[kind];
      } else {
        if (!tag) {
          tag = doc.createElement('span');
          tag.className = kind === 'resolution'
            ? 'smd-tag smd-tag-res'
            : (kind === 'carousel' ? 'smd-tag smd-tag-carousel' : 'smd-tag smd-tag-format');
          record.tags[kind] = tag;
          const before = kind === 'video'
            ? (record.tags.carousel || record.tags.resolution)
            : (kind === 'carousel' ? record.tags.resolution : null);
          record.card.insertBefore(tag, before || null);
        }
        if (tag.textContent !== text) tag.textContent = text;
      }
    }
  }

  function render() {
    const showGrid = isModalVisible();
    /** @type {Record<string, number>} */
    const counts = { all: 0, image: 0, video: 0 };
    for (const extraId of extraFilterIds) counts[extraId] = 0;

    const visible = new Set();
    state.media.forEach((m) => {
      counts.all++;
      if (m.type === 'video') counts.video++;
      else counts.image++;
      for (const extraId of extraFilterIds) {
        if (matchesMediaFilter(m, extraId, matchesCustomFilter)) {
          counts[extraId]++;
        }
      }
      if (showGrid && matchesActive(m)) visible.add(m.id);
    });

    for (const [kind, count] of Object.entries(counts)) {
      const el = uiGetById(`smd-t-${kind}`);
      const text = `(${count})`;
      if (el && el.textContent !== text) el.textContent = text;
    }

    const grid = /** @type {HTMLElement | null} */ (uiGetById('smd-grid'));
    const empty = /** @type {HTMLElement | null} */ (uiGetById('smd-empty'));
    if (!grid || !empty) return;

    // Release obsolete cards and image observers even while the modal is closed.
    for (const [id, record] of gridCards) {
      if (!state.media.has(id) || (showGrid && !visible.has(id)) || record.card.parentNode !== grid) {
        if (record.image) cardImageObserver?.unobserve(record.image);
        record.card.remove();
        gridCards.delete(id);
      }
    }

    if (!showGrid) return;

    grid.style.display = visible.size ? 'grid' : 'none';
    empty.style.display = visible.size ? 'none' : 'flex';
    const observer = visible.size ? getCardImageObserver(grid) : null;
    let cursor = grid.firstElementChild;

    for (const id of visible) {
      const item = state.media.get(id);
      let record = gridCards.get(id);
      if (!record) {
        const card = doc.createElement('div');
        card.className = 'smd-grid-item';
        card.setAttribute('role', 'button');
        card.tabIndex = 0;
        const check = doc.createElement('div');
        check.className = 'smd-check-overlay';
        card.appendChild(check);
        record = { card, check, tags: {}, image: null, placeholder: null, thumb: null, label: null, selected: null };
        gridCards.set(id, record);
        card.addEventListener('click', () => {
          const selected = !state.selectedIds.has(id);
          if (selected) state.selectedIds.add(id); else state.selectedIds.delete(id);
          record.selected = selected;
          card.classList.toggle('selected', selected);
          card.setAttribute('aria-pressed', String(selected));
          check.textContent = selected ? '\u2713' : '';
          onSelectionChanged();
        });
        card.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            card.click();
          }
        });
      }
      updateCard(record, item, observer);
      if (record.card === cursor) cursor = cursor.nextElementSibling;
      else grid.insertBefore(record.card, cursor);
    }

    updateSelection();
  }

  function scheduleRender() {
    if (renderFrameScheduled) return;
    renderFrameScheduled = true;
    const flush = () => {
      renderFrameScheduled = false;
      render();
    };
    if (typeof raf === 'function') raf(flush);
    else setTimer(flush, 0);
  }

  return {
    matchesActive,
    render,
    scheduleRender,
    updateSelection,
    destroy() {
      cardImageObserver?.disconnect?.();
      cardImageObserver = null;
      gridCards.clear();
    }
  };
}
