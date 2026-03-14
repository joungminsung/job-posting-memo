/**
 * apply-detector.js
 * 지원 모달의 "제출하기" / "입사지원" 등 버튼 클릭 감지 → 지원 완료 기록
 * 사이트별 submitButtonText를 사용
 */

(function () {
  const site = window.__wtdSite;
  if (!site || !site.submitButtonText) return; // 지원 감지 불필요한 사이트 스킵

  let detecting = false;
  let modalObserver = null;

  function getJobId() {
    return site.getJobId(location.href);
  }

  function getMetadata() {
    try { return site.getMetadata(); } catch { return {}; }
  }

  function findSubmitButton(root) {
    const text = site.submitButtonText;
    const buttons = root.querySelectorAll('button');
    for (const btn of buttons) {
      const t = btn.textContent.trim();
      if (t === text) return btn;
    }
    // input[type=submit]도 체크
    const inputs = root.querySelectorAll('input[type="submit"]');
    for (const inp of inputs) {
      if (inp.value?.trim() === text) return inp;
    }
    return null;
  }

  function attachSubmitListener(button) {
    if (button.dataset.wtdDetected) return;
    button.dataset.wtdDetected = 'true';

    button.addEventListener('click', async () => {
      const jobId = getJobId();
      if (!jobId) return;
      const meta = getMetadata();
      await window.__wtdMemo.saveMemo(site.id, jobId, {
        ...meta,
        applied: true,
        appliedAt: new Date().toISOString(),
      });
    });
  }

  function startDetection() {
    if (detecting) return;
    detecting = true;

    const existing = findSubmitButton(document.body);
    if (existing) attachSubmitListener(existing);

    modalObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          const btn = findSubmitButton(node);
          if (btn) attachSubmitListener(btn);
        }
      }
    });
    modalObserver.observe(document.body, { childList: true, subtree: true });
  }

  function stopDetection() {
    if (modalObserver) {
      modalObserver.disconnect();
      modalObserver = null;
    }
    detecting = false;
  }

  function init() {
    window.__wtdRouter.onRouteChange((url) => {
      if (site.isJobDetailPage(url)) {
        startDetection();
      } else {
        stopDetection();
      }
    });
  }

  if (window.__wtdRouter) {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', init);
  }
})();
