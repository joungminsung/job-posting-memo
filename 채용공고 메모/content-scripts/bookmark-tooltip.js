/**
 * bookmark-tooltip.js
 * 북마크/관심 목록 페이지 — 뱃지 + 호버 툴팁
 * 사이트 어댑터를 통해 카드 셀렉터/구조를 결정
 */

(function () {
  const site = window.__wtdSite;
  if (!site) return;

  const BADGE_CLASS = 'wtd-memo-badge';
  const TOOLTIP_CLASS = 'wtd-memo-tooltip';
  let memos = {};
  let cardObserver = null;

  const SVG = {
    memo: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',
    star: '<svg width="12" height="12" viewBox="0 0 24 24" fill="#3366FF" stroke="#3366FF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
    starEmpty: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#d5d5d5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
    check: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#3366FF" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
  };

  function renderStarsHTML(priority) {
    let html = '';
    for (let i = 1; i <= 3; i++) {
      html += i <= priority ? SVG.star : SVG.starEmpty;
    }
    return html;
  }

  function createBadge(data) {
    const badge = document.createElement('div');
    badge.className = BADGE_CLASS;

    let html = '';
    if (data.memo) html += SVG.memo;
    if (data.priority > 0) html += (html ? ' ' : '') + renderStarsHTML(data.priority);
    if (data.applied) html += (html ? ' ' : '') + SVG.check;

    badge.innerHTML = html;
    return badge;
  }

  function createTooltip(data) {
    const tooltip = document.createElement('div');
    tooltip.className = TOOLTIP_CLASS;

    const memoText = document.createElement('div');
    memoText.className = 'wtd-memo-tooltip-text';
    memoText.textContent = data.memo || '(메모 없음)';
    tooltip.appendChild(memoText);

    const metaParts = [];
    if (data.priority > 0) metaParts.push('priority');
    if (data.applied) metaParts.push('applied');

    if (metaParts.length > 0) {
      const metaLine = document.createElement('div');
      metaLine.className = 'wtd-memo-tooltip-meta';
      let metaHTML = '';
      if (data.priority > 0) metaHTML += renderStarsHTML(data.priority);
      if (data.priority > 0 && data.applied) metaHTML += ' <span class="wtd-memo-tooltip-sep">·</span> ';
      if (data.applied) metaHTML += '지원 완료';
      metaLine.innerHTML = metaHTML;
      tooltip.appendChild(metaLine);
    }

    return tooltip;
  }

  function processCard(cardLink) {
    const jobId = site.getJobIdFromCard(cardLink);
    if (!jobId) return;

    const key = window.__wtdMemo.makeKey(site.id, jobId);
    const data = memos[key];
    if (!data || (!data.memo && data.priority === 0 && !data.applied)) return;

    const container = site.getCardContainer(cardLink);
    if (!container || container.querySelector(`.${BADGE_CLASS}`)) return;

    container.style.position = 'relative';

    const badge = createBadge(data);
    container.appendChild(badge);

    const tooltip = createTooltip(data);
    container.appendChild(tooltip);

    container.addEventListener('mouseenter', () => {
      tooltip.style.display = 'block';
      tooltip.classList.remove('wtd-memo-tooltip--above');
      // 뷰포트 아래로 넘치면 위로 뒤집기
      const rect = tooltip.getBoundingClientRect();
      if (rect.bottom > window.innerHeight - 8) {
        tooltip.classList.add('wtd-memo-tooltip--above');
      }
    });
    container.addEventListener('mouseleave', () => {
      tooltip.style.display = 'none';
    });
  }

  function processAllCards() {
    const cards = site.getJobCards();
    cards.forEach(processCard);
  }

  async function injectBookmarkTooltips() {
    memos = await window.__wtdMemo.getAllMemos();

    // 기존 뱃지/툴팁 제거
    document.querySelectorAll(`.${BADGE_CLASS}, .${TOOLTIP_CLASS}`).forEach((el) => el.remove());

    processAllCards();

    // 새 카드 로드 감지 (lazy loading / 무한 스크롤) — 디바운스 적용
    if (cardObserver) cardObserver.disconnect();
    let debounceTimer = null;
    cardObserver = new MutationObserver(() => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(processAllCards, 300);
    });

    const listContainer =
      (site.getJobCards()[0] && site.getCardContainer(site.getJobCards()[0])?.parentElement) ||
      document.body;
    cardObserver.observe(listContainer, { childList: true, subtree: true });
  }

  function cleanup() {
    if (cardObserver) {
      cardObserver.disconnect();
      cardObserver = null;
    }
  }

  /**
   * 카드가 표시될 수 있는 페이지인지 판별
   * - 기존 북마크/관심 목록 페이지
   * - 일반 공고 리스트 페이지 (상세 페이지 제외)
   */
  function isPageWithCards(url) {
    // 기존 북마크 페이지
    if (site.isJobListPage(url)) return true;
    // 상세 페이지가 아닌 모든 페이지 (카드가 있을 수 있음)
    if (!site.isJobDetailPage(url)) return true;
    return false;
  }

  function getReadySelector() {
    // 원티드: 일반 리스트에도 job-card가 있으므로 넓은 셀렉터 사용
    if (site.id === 'wanted') {
      return 'a[data-cy="job-card"], a[href*="/wd/"]';
    }
    return site.listReadySelector;
  }

  function init() {
    window.__wtdRouter.onRouteChange((url) => {
      const readySel = getReadySelector();
      if (isPageWithCards(url) && readySel) {
        window.__wtdRouter
          .waitForElement(readySel)
          .then(() => injectBookmarkTooltips())
          .catch(() => {});
      } else {
        cleanup();
      }
    });
  }

  if (window.__wtdRouter) {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', init);
  }
})();
