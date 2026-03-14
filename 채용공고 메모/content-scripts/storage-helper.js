/**
 * storage-helper.js
 * chrome.storage.local 래퍼 — 멀티사이트 메모 CRUD + 마이그레이션
 *
 * 저장 키: job_memos
 * 복합 키: "${siteId}:${jobId}" (사이트 간 ID 충돌 방지)
 */

const STORAGE_KEY = 'job_memos';
const OLD_STORAGE_KEY = 'wanted_memos';

const DEFAULT_MEMO = {
  memo: '',
  priority: 0,
  applied: false,
  appliedAt: null,
  positionName: '',
  companyName: '',
  employmentType: '',
  site: '',      // adapter id (wanted, saramin, ...)
  siteName: '',  // 표시용 사이트 이름
  siteUrl: '',   // 해당 공고 직접 URL
  createdAt: '',
  updatedAt: '',
};

function makeKey(siteId, jobId) {
  return `${siteId}:${jobId}`;
}

function parseKey(compositeKey) {
  const idx = compositeKey.indexOf(':');
  if (idx === -1) return { siteId: 'wanted', jobId: compositeKey };
  return { siteId: compositeKey.slice(0, idx), jobId: compositeKey.slice(idx + 1) };
}

function normalizeMemo(raw) {
  return { ...DEFAULT_MEMO, ...raw };
}

/**
 * chrome.runtime 연결 상태 확인
 * 확장이 리로드/업데이트되면 이전 content script의 context가 무효화됨
 */
function isExtensionContextValid() {
  try {
    return !!chrome.runtime?.id;
  } catch {
    return false;
  }
}

/**
 * context 유효성 검사 후 storage 호출을 감싸는 래퍼
 */
async function safeStorageCall(fn) {
  if (!isExtensionContextValid()) {
    console.warn('[wanted-memo] Extension context invalidated — 페이지를 새로고침하세요.');
    return null;
  }
  try {
    return await fn();
  } catch (e) {
    if (e.message?.includes('Extension context invalidated')) {
      console.warn('[wanted-memo] Extension context invalidated — 페이지를 새로고침하세요.');
      return null;
    }
    throw e;
  }
}

// ── 마이그레이션: wanted_memos → job_memos ──

async function migrateIfNeeded() {
  const result = await safeStorageCall(() =>
    chrome.storage.local.get([OLD_STORAGE_KEY, STORAGE_KEY])
  );
  if (!result) return;

  // 이전 데이터가 없으면 스킵
  if (!result[OLD_STORAGE_KEY]) return;

  const oldMemos = result[OLD_STORAGE_KEY];
  const newMemos = result[STORAGE_KEY] || {};
  let migrated = false;

  for (const [jobId, data] of Object.entries(oldMemos)) {
    const key = makeKey('wanted', jobId);
    if (!newMemos[key]) {
      newMemos[key] = {
        ...normalizeMemo(data),
        site: 'wanted',
        siteName: '원티드',
        siteUrl: `https://www.wanted.co.kr/wd/${jobId}`,
      };
      migrated = true;
    }
  }

  if (migrated) {
    await safeStorageCall(() =>
      chrome.storage.local.set({ [STORAGE_KEY]: newMemos })
    );
  }

  // 마이그레이션 완료 후 이전 키 삭제
  await safeStorageCall(() =>
    chrome.storage.local.remove(OLD_STORAGE_KEY)
  );
}

// ── CRUD ──

async function getAllMemos() {
  const result = await safeStorageCall(() =>
    chrome.storage.local.get(STORAGE_KEY)
  );
  if (!result) return {};
  const memos = result[STORAGE_KEY] || {};
  const normalized = {};
  for (const [key, data] of Object.entries(memos)) {
    normalized[key] = normalizeMemo(data);
  }
  return normalized;
}

async function getMemo(siteId, jobId) {
  const memos = await getAllMemos();
  return memos[makeKey(siteId, jobId)] || null;
}

async function saveMemo(siteId, jobId, data) {
  const key = makeKey(siteId, jobId);
  const memos = await getAllMemos();
  const site = window.__wtdSites?.[siteId];
  const existing = memos[key] || {
    ...DEFAULT_MEMO,
    site: siteId,
    siteName: site?.name || siteId,
    siteUrl: site?.getJobUrl(jobId) || '',
    createdAt: new Date().toISOString(),
  };

  memos[key] = {
    ...existing,
    ...data,
    site: siteId,
    siteName: site?.name || existing.siteName || siteId,
    siteUrl: site?.getJobUrl(jobId) || existing.siteUrl || '',
    updatedAt: new Date().toISOString(),
  };

  await safeStorageCall(() =>
    chrome.storage.local.set({ [STORAGE_KEY]: memos })
  );
  return memos[key];
}

async function deleteMemo(siteId, jobId) {
  const key = makeKey(siteId, jobId);
  const memos = await getAllMemos();
  delete memos[key];
  await safeStorageCall(() =>
    chrome.storage.local.set({ [STORAGE_KEY]: memos })
  );
}

// 마이그레이션 실행
migrateIfNeeded();

// 전역 노출
window.__wtdMemo = {
  getAllMemos,
  getMemo,
  saveMemo,
  deleteMemo,
  makeKey,
  parseKey,
  STORAGE_KEY,
};
