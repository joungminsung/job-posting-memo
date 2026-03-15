/**
 * read-marker.js
 * 이미 열어본(읽은) 공고를 목록 페이지에서 시각적으로 표시
 *
 * - 상세 페이지 방문 시 → 해당 공고를 "읽음"으로 저장
 * - 목록 페이지에서 → 읽은 공고 썸네일에 어둡게 + "읽음" 오버레이
 * - 호버 시 → 오버레이 숨김 (CSS transition)
 */

(function () {
  const site = window.__wtdSite;
  if (!site) return;

  const READ_STORAGE_KEY = 'read_jobs';
  const OVERLAY_CLASS = 'wtd-read-overlay';
  const THUMB_CLASS = 'wtd-read-thumb';

  // ── Storage helpers ──

  async function getReadJobs() {
    try {
      if (!chrome.runtime?.id) return {};
      const result = await chrome.storage.local.get(READ_STORAGE_KEY);
      return result[READ_STORAGE_KEY] || {};
    } catch {
      return {};
    }
  }

  async function markAsRead(siteId, jobId) {
    try {
      if (!chrome.runtime?.id) return;
      const readJobs = await getReadJobs();
      const key = `${siteId}:${jobId}`;
      if (readJobs[key]) return; // 이미 읽음
      readJobs[key] = Date.now();
      await chrome.storage.local.set({ [READ_STORAGE_KEY]: readJobs });
      // 읽음 표시도 다른 기기에 동기화
      window.__wtdMemo?.schedulePush?.();
    } catch {
      // 무시
    }
  }

  // ── 상세 페이지: 읽음 기록 ──

  function recordDetailVisit(url) {
    if (!site.isJobDetailPage(url)) return;
    const jobId = site.getJobId(url);
    if (jobId) {
      markAsRead(site.id, jobId);
    }
  }

  // ── 목록 페이지: 읽음 오버레이 삽입 ──

  function createOverlay() {
    const overlay = document.createElement('div');
    overlay.className = OVERLAY_CLASS;
    overlay.innerHTML = `<span class="${OVERLAY_CLASS}__label"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>읽음</span>`;
    return overlay;
  }

  /**
   * 카드에서 썸네일 영역을 찾아 오버레이 삽입
   */
  function getThumbContainer(cardLink) {
    // img가 있는 첫 번째 부모 div, 없으면 첫 번째 div
    const img = cardLink.querySelector('img');
    if (img?.parentElement) return img.parentElement;
    return cardLink.querySelector('div:first-child');
  }

  async function processListCards() {
    const readJobs = await getReadJobs();
    if (Object.keys(readJobs).length === 0) return;

    // 사이트 어댑터를 통해 카드 탐색
    const cards = site.getJobCards();
    cards.forEach((link) => {
      const jobId = site.getJobIdFromCard(link);
      if (!jobId) return;

      const key = `${site.id}:${jobId}`;
      if (!readJobs[key]) return;

      const thumb = getThumbContainer(link);
      if (!thumb || thumb.querySelector(`.${OVERLAY_CLASS}`)) return;

      // position: relative 확보
      const pos = getComputedStyle(thumb).position;
      if (pos === 'static') thumb.style.position = 'relative';

      thumb.classList.add(THUMB_CLASS);
      thumb.appendChild(createOverlay());
    });
  }

  // ── MutationObserver: 동적 로드 카드 감지 ──

  let listObserver = null;

  let debounceTimer = null;

  function observeList() {
    if (listObserver) listObserver.disconnect();

    listObserver = new MutationObserver(() => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(processListCards, 300);
    });

    listObserver.observe(document.body, { childList: true, subtree: true });
  }

  function cleanupList() {
    if (listObserver) {
      listObserver.disconnect();
      listObserver = null;
    }
  }

  // ── 라우트 변경 감지 ──

  function isListPage(url) {
    // 상세 페이지가 아닌 모든 페이지에서 카드가 표시될 수 있음
    if (site.isJobDetailPage(url)) return false;
    return true;
  }

  function handleRoute(url) {
    // 상세 페이지 방문 기록
    recordDetailVisit(url);

    // 목록 페이지에서 읽음 표시
    if (isListPage(url)) {
      // 약간의 지연 후 처리 (DOM 렌더링 대기)
      setTimeout(() => {
        processListCards();
        observeList();
      }, 500);
    } else {
      cleanupList();
    }
  }

  // ── 초기화 ──

  if (window.__wtdRouter) {
    window.__wtdRouter.onRouteChange(handleRoute);
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      if (window.__wtdRouter) {
        window.__wtdRouter.onRouteChange(handleRoute);
      }
    });
  }
})();
