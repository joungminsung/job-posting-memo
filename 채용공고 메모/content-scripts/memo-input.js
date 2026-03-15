/**
 * memo-input.js
 * 공고 상세 페이지 — 메모/별점 UI
 *
 * 사이트별 전략:
 * - 어댑터에서 getMemoTarget()이 요소를 반환하면 → 해당 위치에 인라인 삽입
 * - 반환하지 못하면 → 우측 하단 플로팅 패널로 폴백
 */

(function () {
  const site = window.__wtdSite;
  if (!site) return;

  const MEMO_BOX_ID = 'wtd-memo-box';
  const FLOAT_BTN_ID = 'wtd-memo-float-btn';
  const FLOAT_PANEL_ID = 'wtd-memo-float-panel';
  const INLINE_TRIGGER_ID = 'wtd-memo-inline-trigger';
  let currentJobId = null;
  let storageListeners = [];

  // SVG 아이콘
  const SVG = {
    memo: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',
    star: '<svg width="16" height="16" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
    check: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    applied: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    close: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  };

  function getJobId() {
    return site.getJobId(location.href);
  }

  function getMetadata() {
    try {
      return site.getMetadata();
    } catch {
      return { positionName: '', companyName: '', employmentType: '' };
    }
  }

  function createStarRating(container, currentPriority, onChange) {
    container.innerHTML = '';
    for (let i = 1; i <= 3; i++) {
      const star = document.createElement('span');
      star.className = 'wtd-memo-star' + (i <= currentPriority ? ' wtd-memo-star--filled' : '');
      star.dataset.value = i;
      star.innerHTML = SVG.star;
      star.addEventListener('click', () => {
        onChange(currentPriority === i ? 0 : i);
      });
      star.addEventListener('mouseenter', () => {
        container.querySelectorAll('.wtd-memo-star').forEach((s, idx) => {
          s.classList.toggle('wtd-memo-star--filled', idx < i);
        });
      });
      star.addEventListener('mouseleave', () => {
        container.querySelectorAll('.wtd-memo-star').forEach((s, idx) => {
          s.classList.toggle('wtd-memo-star--filled', idx < currentPriority);
        });
      });
      container.appendChild(star);
    }
  }

  function formatDate(isoString) {
    if (!isoString) return '';
    const d = new Date(isoString);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  // ── 메모 패널 내부 콘텐츠 생성 (인라인/플로팅 공용) ──

  function buildMemoContent(jobId, memoData, meta) {
    const { getMemo, saveMemo, deleteMemo } = window.__wtdMemo;
    let data = memoData;

    const box = document.createElement('div');
    box.id = MEMO_BOX_ID;
    box.className = 'wtd-memo-box';

    // 헤더
    const header = document.createElement('div');
    header.className = 'wtd-memo-header';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'wtd-memo-title';
    titleWrap.innerHTML = `${SVG.memo} <span>메모</span>`;

    // 사이트 뱃지 (원티드 이외 사이트에서 표시)
    if (site.id !== 'wanted') {
      const badge = document.createElement('span');
      badge.className = 'wtd-memo-site-badge';
      badge.textContent = site.name;
      badge.style.cssText = `
        font-size: 11px; padding: 2px 6px; border-radius: 4px;
        background: ${site.color}15; color: ${site.color};
        font-weight: 500; margin-left: 6px;
      `;
      titleWrap.appendChild(badge);
    }

    const starContainer = document.createElement('div');
    starContainer.className = 'wtd-memo-stars';

    header.appendChild(titleWrap);
    header.appendChild(starContainer);
    box.appendChild(header);

    // Textarea
    const textarea = document.createElement('textarea');
    textarea.className = 'wtd-memo-textarea';
    textarea.placeholder = '이 공고에 대한 메모...';
    textarea.maxLength = 500;
    textarea.value = data?.memo || '';
    box.appendChild(textarea);

    // 글자 수 카운터
    const counter = document.createElement('div');
    counter.className = 'wtd-memo-counter';
    counter.textContent = `${textarea.value.length}/500`;
    textarea.addEventListener('input', () => {
      counter.textContent = `${textarea.value.length}/500`;
    });
    box.appendChild(counter);

    // 버튼 행
    const actions = document.createElement('div');
    actions.className = 'wtd-memo-actions';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'wtd-memo-btn wtd-memo-btn-save';
    saveBtn.textContent = '저장';

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'wtd-memo-btn wtd-memo-btn-delete';
    deleteBtn.textContent = '삭제';

    actions.appendChild(saveBtn);
    actions.appendChild(deleteBtn);
    box.appendChild(actions);

    // 상태 텍스트
    const status = document.createElement('span');
    status.className = 'wtd-memo-status';
    box.appendChild(status);

    // 지원 상태 표시
    const applyStatus = document.createElement('div');
    applyStatus.className = 'wtd-memo-apply-status';
    box.appendChild(applyStatus);

    function updateApplyUI(d) {
      if (d?.applied) {
        applyStatus.innerHTML = `${SVG.applied} <span>지원 완료 (${formatDate(d.appliedAt)})</span>`;
        applyStatus.style.display = 'flex';
      } else {
        applyStatus.style.display = 'none';
      }
    }

    function updateStars(priority) {
      createStarRating(starContainer, priority, async (newP) => {
        data = await saveMemo(site.id, jobId, { ...meta, memo: textarea.value, priority: newP });
        updateStars(newP);
      });
    }

    // 초기 렌더링
    updateStars(data?.priority || 0);
    updateApplyUI(data);
    if (data?.updatedAt) {
      status.innerHTML = `${SVG.check} 저장됨 (${formatDate(data.updatedAt)})`;
    }

    // 저장
    saveBtn.addEventListener('click', async () => {
      data = await saveMemo(site.id, jobId, { ...meta, memo: textarea.value });
      status.innerHTML = `${SVG.check} 저장됨 (${formatDate(data.updatedAt)})`;
      status.classList.add('wtd-memo-status-flash');
      setTimeout(() => status.classList.remove('wtd-memo-status-flash'), 1500);
    });

    // 삭제
    deleteBtn.addEventListener('click', async () => {
      if (!confirm('이 메모를 삭제하시겠습니까?')) return;
      await deleteMemo(site.id, jobId);
      textarea.value = '';
      counter.textContent = '0/500';
      data = null;
      updateStars(0);
      updateApplyUI(null);
      status.textContent = '';
    });

    // storage 변경 감지 (apply-detector 연동, 다른 기기 sync 포함)
    const storageListener = (changes, areaName) => {
      if (areaName !== 'local') return;
      const key = window.__wtdMemo.makeKey(site.id, jobId);
      if (!changes[key]) return;
      const updated = changes[key].newValue;
      if (updated) {
        data = updated;
        updateApplyUI(updated);
        if (document.activeElement !== textarea && updated.memo !== undefined) {
          textarea.value = updated.memo;
          counter.textContent = `${updated.memo.length}/500`;
        }
        updateStars(updated.priority || 0);
      }
    };
    chrome.storage.onChanged.addListener(storageListener);
    storageListeners.push(storageListener);

    return box;
  }

  // ── 인라인 삽입 (사이트별 타겟에 append) ──

  function injectInline(target, jobId, memoData, meta) {
    const box = buildMemoContent(jobId, memoData, meta);
    target.appendChild(box);
    return true;
  }

  // ── 인라인 트리거 (별 옆 컴팩트 버튼 → 플로팅 패널) ──

  function injectInlineTrigger(target, jobId, memoData, meta) {
    const trigger = document.createElement('button');
    trigger.id = INLINE_TRIGGER_ID;
    trigger.className = 'wtd-inline-trigger';
    trigger.type = 'button';

    // 별점 표시용 작은 별 렌더
    function renderMiniStars(p) {
      let s = '';
      for (let i = 1; i <= 3; i++) {
        s += `<span class="wtd-inline-trigger-star${i <= p ? ' wtd-inline-trigger-star--filled' : ''}">${SVG.star}</span>`;
      }
      return s;
    }

    function updateTrigger(data) {
      let html = SVG.memo + '<span class="wtd-inline-trigger-label">메모</span>';
      const p = data?.priority || 0;
      if (p > 0) {
        html += '<span class="wtd-inline-trigger-stars">' + renderMiniStars(p) + '</span>';
      }
      if (data?.memo) {
        html += '<span class="wtd-inline-trigger-dot"></span>';
      }
      trigger.innerHTML = html;
    }

    updateTrigger(memoData);

    // 별 영역 옆(형제)에 삽입
    target.insertAdjacentElement('afterend', trigger);

    // 클릭 시 플로팅 패널 열기
    trigger.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const panel = document.getElementById(FLOAT_PANEL_ID);
      if (panel) {
        panel.classList.toggle('wtd-float-panel--open');
      }
    });

    // 플로팅 패널도 같이 생성 (버튼 없이, 패널만)
    ensureFloatingPanel(jobId, memoData, meta, false);

    // storage 변경 시 트리거 UI 갱신
    const triggerStorageListener = (changes, areaName) => {
      if (areaName !== 'local') return;
      const key = window.__wtdMemo.makeKey(site.id, jobId);
      if (changes[key]?.newValue) updateTrigger(changes[key].newValue);
    };
    chrome.storage.onChanged.addListener(triggerStorageListener);
    storageListeners.push(triggerStorageListener);

    return true;
  }

  // ── 플로팅 패널 생성 (showButton: 우하단 FAB 표시 여부) ──

  function ensureFloatingPanel(jobId, memoData, meta, showButton) {
    // 플로팅 버튼 (FAB)
    if (showButton) {
      let floatBtn = document.getElementById(FLOAT_BTN_ID);
      if (!floatBtn) {
        floatBtn = document.createElement('button');
        floatBtn.id = FLOAT_BTN_ID;
        floatBtn.className = 'wtd-float-btn';
        floatBtn.innerHTML = SVG.memo;
        floatBtn.title = '채용공고 메모';
        floatBtn.addEventListener('click', () => {
          const panel = document.getElementById(FLOAT_PANEL_ID);
          if (panel) panel.classList.toggle('wtd-float-panel--open');
        });
        document.body.appendChild(floatBtn);
      }

      if (memoData?.memo || (memoData?.priority && memoData.priority > 0)) {
        floatBtn.classList.add('wtd-float-btn--has-memo');
      } else {
        floatBtn.classList.remove('wtd-float-btn--has-memo');
      }
    }

    // 플로팅 패널
    let panel = document.getElementById(FLOAT_PANEL_ID);
    if (panel) panel.remove();

    panel = document.createElement('div');
    panel.id = FLOAT_PANEL_ID;
    panel.className = 'wtd-float-panel';

    const panelHeader = document.createElement('div');
    panelHeader.className = 'wtd-float-panel-header';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'wtd-float-panel-close';
    closeBtn.innerHTML = SVG.close;
    closeBtn.addEventListener('click', () => {
      panel.classList.remove('wtd-float-panel--open');
    });
    panelHeader.appendChild(closeBtn);
    panel.appendChild(panelHeader);

    const box = buildMemoContent(jobId, memoData, meta);
    box.id = '';
    panel.appendChild(box);

    document.body.appendChild(panel);
    return true;
  }

  // ── 메인: UI 삽입 ──

  async function injectMemoUI() {
    const jobId = getJobId();
    if (!jobId) return;

    // 중복 방지
    if (document.getElementById(MEMO_BOX_ID)) {
      if (currentJobId === jobId) return;
      document.getElementById(MEMO_BOX_ID).remove();
    }
    cleanup();
    currentJobId = jobId;

    const memoData = await window.__wtdMemo.getMemo(site.id, jobId);
    const meta = getMetadata();

    // 사이트 어댑터에서 삽입 타겟 결정
    const result = site.getMemoTarget?.();

    if (result?.mode === 'inline-trigger') {
      // 별 옆 컴팩트 트리거 + 플로팅 패널 (사람인 등)
      injectInlineTrigger(result.target, jobId, memoData, meta);
    } else if (result) {
      // 인라인 삽입 (원티드 사이드바 등)
      injectInline(result.target, jobId, memoData, meta);
    } else {
      // 범용 플로팅 패널 (FAB 버튼 + 패널)
      ensureFloatingPanel(jobId, memoData, meta, true);
    }
  }

  // ── 페이지 벗어날 때 정리 ──

  function cleanup() {
    document.getElementById(MEMO_BOX_ID)?.remove();
    document.getElementById(FLOAT_PANEL_ID)?.remove();
    document.getElementById(FLOAT_BTN_ID)?.remove();
    document.getElementById(INLINE_TRIGGER_ID)?.remove();
    // 축적된 storage 리스너 제거 (메모리 누수 방지)
    storageListeners.forEach((fn) => chrome.storage.onChanged.removeListener(fn));
    storageListeners = [];
    currentJobId = null;
  }

  // ── 라우팅 감지 ──

  function init() {
    window.__wtdRouter.onRouteChange((url) => {
      if (site.isJobDetailPage(url)) {
        const selector = site.detailReadySelector || 'main, #content';
        const timeout = site.detailReadyTimeout || 5000;
        window.__wtdRouter
          .waitForElement(selector, timeout)
          .then(() => setTimeout(injectMemoUI, 300))
          .catch(() => {
            // 셀렉터 대기 실패해도 플로팅 패널은 시도
            setTimeout(injectMemoUI, 500);
          });
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
