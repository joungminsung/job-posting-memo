/**
 * router-observer.js
 * SPA/MPA 라우팅 감지 + DOM 대기 유틸
 * SPA 사이트: History API 래핑 + MutationObserver
 * MPA 사이트: 초기 1회 콜백만 실행
 */

(function () {
  const site = window.__wtdSite;
  if (!site) return; // 미지원 사이트

  const callbacks = [];
  let lastUrl = location.href;

  function notifyAll(url) {
    callbacks.forEach((cb) => cb(url));
  }

  if (site.isSPA) {
    // ── SPA: History API 래핑 + MutationObserver ──

    const originalPushState = history.pushState;
    history.pushState = function (...args) {
      originalPushState.apply(this, args);
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        notifyAll(lastUrl);
      }
    };

    const originalReplaceState = history.replaceState;
    history.replaceState = function (...args) {
      originalReplaceState.apply(this, args);
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        notifyAll(lastUrl);
      }
    };

    window.addEventListener('popstate', () => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        notifyAll(lastUrl);
      }
    });

    // MutationObserver 병행 — SPA에서 URL 변경 놓치는 경우 대비
    const urlObserver = new MutationObserver(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        notifyAll(lastUrl);
      }
    });
    if (document.body) {
      urlObserver.observe(document.body, { childList: true, subtree: true });
    }
  }

  // DOM 엘리먼트 렌더링 대기 유틸
  function waitForElement(selector, timeout) {
    timeout = timeout || site.detailReadyTimeout || 5000;
    return new Promise((resolve, reject) => {
      // 쉼표로 구분된 셀렉터 지원 (OR)
      const el = document.querySelector(selector);
      if (el) return resolve(el);

      const observer = new MutationObserver(() => {
        const found = document.querySelector(selector);
        if (found) {
          observer.disconnect();
          resolve(found);
        }
      });
      observer.observe(document.body || document.documentElement, {
        childList: true,
        subtree: true,
      });
      setTimeout(() => {
        observer.disconnect();
        reject(new Error(`waitForElement timeout: ${selector}`));
      }, timeout);
    });
  }

  function onRouteChange(callback) {
    callbacks.push(callback);
    // 최초 실행 (SPA/MPA 모두)
    callback(location.href);
  }

  window.__wtdRouter = { onRouteChange, waitForElement };
})();
