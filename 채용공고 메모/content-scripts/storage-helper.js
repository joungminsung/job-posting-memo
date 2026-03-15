/**
 * storage-helper.js
 * 하이브리드 저장소 — Local(주) + Google Drive appData(동기화)
 *
 * Local: 개별 키 "jm:{siteId}:{jobId}" (빠른 읽기/쓰기)
 * Drive: gzip 압축 JSON → appData 폴더 (기기 간 동기화, 사실상 무제한)
 *
 * 동기화 전략:
 * - 쓰기 → local 즉시 반영 → 5초 디바운스 → Drive 푸시
 * - 시작 / 포커스 복귀 → 메모별 병합 (newer wins per memo)
 * - 충돌 시 각 메모의 updatedAt 비교 → 최신 데이터 보존
 * - 삭제된 메모 추적 → tombstone으로 삭제도 동기화
 * - 읽음 표시 → 합집합 병합 (추가만, 삭제 없음)
 */

const MEMO_PREFIX = 'jm:';
const LOCAL_META_KEY = '_local_meta';
const TOMBSTONE_KEY = '_tombstones';
const READ_STORAGE_KEY = 'read_jobs';
const DRIVE_FILE_NAME = 'job-memo-sync.json.gz';

const OLD_STORAGE_KEY = 'wanted_memos';
const OLD_JOB_MEMOS_KEY = 'job_memos';
const MIGRATION_FLAG = '_migrated_v4';

const DEFAULT_MEMO = {
  memo: '',
  priority: 0,
  applied: false,
  appliedAt: null,
  positionName: '',
  companyName: '',
  employmentType: '',
  site: '',
  siteName: '',
  siteUrl: '',
  createdAt: '',
  updatedAt: '',
};

function makeKey(siteId, jobId) {
  return `${MEMO_PREFIX}${siteId}:${jobId}`;
}

function parseKey(storageKey) {
  const raw = storageKey.startsWith(MEMO_PREFIX)
    ? storageKey.slice(MEMO_PREFIX.length)
    : storageKey;
  const idx = raw.indexOf(':');
  if (idx === -1) return { siteId: 'wanted', jobId: raw };
  return { siteId: raw.slice(0, idx), jobId: raw.slice(idx + 1) };
}

function isMemoKey(key) {
  return key.startsWith(MEMO_PREFIX);
}

function normalizeMemo(raw) {
  return { ...DEFAULT_MEMO, ...raw };
}

function isExtensionContextValid() {
  try {
    return !!chrome.runtime?.id;
  } catch {
    return false;
  }
}

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

// ── 압축/해제 (Chrome 내장 CompressionStream) ──

async function compressToBytes(str) {
  const blob = new Blob([str]);
  const stream = blob.stream().pipeThrough(new CompressionStream('gzip'));
  return await new Response(stream).arrayBuffer();
}

async function decompressFromBytes(buffer) {
  const blob = new Blob([buffer]);
  const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'));
  return await new Response(stream).text();
}

// ── Google Drive Auth (Chrome + Edge 호환) ──

const OAUTH_TOKEN_KEY = '_oauth_token';
const DRIVE_SCOPES = 'https://www.googleapis.com/auth/drive.appdata';

let cachedToken = null;

/**
 * 저장된 토큰이 유효하면 반환, 만료됐으면 null
 */
async function getStoredToken() {
  const result = await safeStorageCall(() => chrome.storage.local.get(OAUTH_TOKEN_KEY));
  const data = result?.[OAUTH_TOKEN_KEY];
  if (data && Date.now() < data.expiresAt - 60000) {
    return data.token;
  }
  return null;
}

/**
 * launchWebAuthFlow — Chrome/Edge 모두 동작
 */
function launchAuthFlow(interactive) {
  const clientId = chrome.runtime.getManifest().oauth2?.client_id;
  const redirectUrl = chrome.identity.getRedirectURL();
  const authUrl =
    'https://accounts.google.com/o/oauth2/v2/auth' +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUrl)}` +
    `&response_type=token` +
    `&scope=${encodeURIComponent(DRIVE_SCOPES)}`;

  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url: authUrl, interactive }, (responseUrl) => {
      if (chrome.runtime.lastError || !responseUrl) {
        reject(new Error(chrome.runtime.lastError?.message || 'Auth failed'));
        return;
      }
      const hash = new URL(responseUrl).hash.slice(1);
      const params = new URLSearchParams(hash);
      const token = params.get('access_token');
      const expiresIn = parseInt(params.get('expires_in') || '3600');

      if (!token) {
        reject(new Error('No access token'));
        return;
      }

      cachedToken = token;
      safeStorageCall(() =>
        chrome.storage.local.set({ [OAUTH_TOKEN_KEY]: { token, expiresAt: Date.now() + expiresIn * 1000 } })
      );
      resolve(token);
    });
  });
}

async function getAuthToken(interactive = false) {
  const stored = await getStoredToken();
  if (stored) {
    cachedToken = stored;
    return stored;
  }
  return launchAuthFlow(interactive);
}

async function revokeToken() {
  cachedToken = null;
  await safeStorageCall(() => chrome.storage.local.remove(OAUTH_TOKEN_KEY));
}

/**
 * 토큰 갱신이 필요할 때 자동 재시도
 */
async function driveRequest(url, options = {}, retry = true) {
  let token = cachedToken || await getAuthToken(false);
  const res = await fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${token}`,
    },
  });

  if (res.status === 401 && retry) {
    await revokeToken();
    token = await getAuthToken(false);
    return driveRequest(url, options, false);
  }

  return res;
}

// ── Google Drive appData CRUD ──

/**
 * appData 폴더에서 동기화 파일의 fileId 조회
 */
async function findDriveFile() {
  const query = encodeURIComponent(`name='${DRIVE_FILE_NAME}' and trashed=false`);
  const res = await driveRequest(
    `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${query}&fields=files(id,modifiedTime)`
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data.files?.[0] || null;
}

/**
 * Drive에서 동기화 파일 다운로드 → 해제 → JSON 파싱
 */
async function downloadDriveFile(fileId) {
  const res = await driveRequest(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`
  );
  if (!res.ok) return null;
  const buffer = await res.arrayBuffer();
  const json = await decompressFromBytes(buffer);
  return JSON.parse(json);
}

/**
 * Drive에 동기화 파일 업로드 (생성 또는 덮어쓰기)
 */
async function uploadDriveFile(payload, existingFileId) {
  const json = JSON.stringify(payload);
  const compressed = await compressToBytes(json);

  if (existingFileId) {
    // 기존 파일 덮어쓰기 (PATCH)
    const res = await driveRequest(
      `https://www.googleapis.com/upload/drive/v3/files/${existingFileId}?uploadType=media`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/gzip' },
        body: compressed,
      }
    );
    return res.ok;
  } else {
    // 새 파일 생성 (multipart)
    const metadata = {
      name: DRIVE_FILE_NAME,
      parents: ['appDataFolder'],
    };

    const boundary = '---job_memo_boundary_' + Date.now();
    const metaPart =
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(metadata)}\r\n`;
    const endPart = `\r\n--${boundary}--`;

    const metaBytes = new TextEncoder().encode(metaPart);
    const mediaHeader = new TextEncoder().encode(
      `--${boundary}\r\nContent-Type: application/gzip\r\n\r\n`
    );
    const endBytes = new TextEncoder().encode(endPart);

    const body = new Blob([metaBytes, mediaHeader, compressed, endBytes]);

    const res = await driveRequest(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
      {
        method: 'POST',
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        body,
      }
    );
    return res.ok;
  }
}

// ── Tombstone (삭제 추적) ──

async function getTombstones() {
  const result = await safeStorageCall(() =>
    chrome.storage.local.get(TOMBSTONE_KEY)
  );
  return result?.[TOMBSTONE_KEY] || {};
}

async function addTombstone(compositeKey) {
  const tombstones = await getTombstones();
  tombstones[compositeKey] = new Date().toISOString();
  // 30일 지난 tombstone 정리
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  for (const [k, ts] of Object.entries(tombstones)) {
    if (ts < cutoff) delete tombstones[k];
  }
  await safeStorageCall(() =>
    chrome.storage.local.set({ [TOMBSTONE_KEY]: tombstones })
  );
}

// ── Sync 상태 관리 ──

let pushTimer = null;
let isPushing = false;
let isPulling = false;
let syncStatus = 'idle'; // idle | syncing | done | error | not_connected

function getSyncStatus() {
  return syncStatus;
}

function setSyncStatus(status) {
  syncStatus = status;
  // popup 등에서 감지할 수 있도록 local에 상태 저장
  safeStorageCall(() =>
    chrome.storage.local.set({ _sync_status: status })
  );
}

// ── Sync 브릿지 (Google Drive) ──

function schedulePush() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushToSync().catch((e) => console.warn('[wanted-memo] Drive push failed:', e));
  }, 5000);
}

async function pushToSync() {
  if (isPushing || isPulling) return;
  isPushing = true;
  setSyncStatus('syncing');

  try {
    // 토큰이 없으면 (아직 동의 안 한 상태) 조용히 스킵
    try {
      await getAuthToken(false);
    } catch {
      setSyncStatus('not_connected');
      return;
    }

    const memos = await getAllMemos();
    const tombstones = await getTombstones();
    const readResult = await safeStorageCall(() => chrome.storage.local.get(READ_STORAGE_KEY));
    const readJobs = readResult?.[READ_STORAGE_KEY] || {};

    const now = new Date().toISOString();
    const syncPayload = { version: 3, updatedAt: now, memos, tombstones, readJobs };

    const file = await findDriveFile();
    const success = await uploadDriveFile(syncPayload, file?.id);

    if (success) {
      await safeStorageCall(() =>
        chrome.storage.local.set({ [LOCAL_META_KEY]: { updatedAt: now } })
      );
      setSyncStatus('done');
    } else {
      setSyncStatus('error');
    }
  } catch (e) {
    console.warn('[wanted-memo] Drive push error:', e);
    setSyncStatus('error');
  } finally {
    isPushing = false;
  }
}

async function pullFromSync() {
  if (isPulling || isPushing) return false;
  isPulling = true;
  setSyncStatus('syncing');

  try {
    // 토큰 없으면 스킵
    try {
      await getAuthToken(false);
    } catch {
      setSyncStatus('not_connected');
      return false;
    }

    const file = await findDriveFile();
    if (!file) {
      setSyncStatus('done');
      return false;
    }

    // 로컬 메타와 비교
    const localResult = await safeStorageCall(() => chrome.storage.local.get(LOCAL_META_KEY));
    const localUpdatedAt = localResult?.[LOCAL_META_KEY]?.updatedAt || '';
    if (localUpdatedAt >= file.modifiedTime) {
      setSyncStatus('done');
      return false;
    }

    // Drive에서 다운로드
    let syncPayload;
    try {
      syncPayload = await downloadDriveFile(file.id);
    } catch (e) {
      console.warn('[wanted-memo] Drive 데이터 해제 실패 — 로컬 데이터 유지:', e);
      setSyncStatus('error');
      return false;
    }

    if (!syncPayload) {
      setSyncStatus('error');
      return false;
    }

    const syncMemos = syncPayload.memos || {};
    const syncTombstones = syncPayload.tombstones || {};
    const syncReadJobs = syncPayload.readJobs || {};

    // ── 메모별 병합 (newer wins per memo) ──

    const localAll = await safeStorageCall(() => chrome.storage.local.get(null));
    if (!localAll) {
      setSyncStatus('error');
      return false;
    }

    const localTombstones = await getTombstones();
    const toSet = {};
    const toRemove = [];
    const mergedTombstones = { ...localTombstones };

    // 1) sync에 있는 메모 처리
    for (const [compositeKey, syncData] of Object.entries(syncMemos)) {
      const localKey = MEMO_PREFIX + compositeKey;
      const localData = localAll[localKey];

      if (localTombstones[compositeKey] && localTombstones[compositeKey] >= (syncData.updatedAt || '')) {
        continue;
      }

      if (!localData) {
        toSet[localKey] = normalizeMemo(syncData);
      } else {
        const syncTime = syncData.updatedAt || '';
        const localTime = localData.updatedAt || '';
        if (syncTime > localTime) {
          toSet[localKey] = normalizeMemo(syncData);
        }
      }
    }

    // 2) sync tombstone 처리
    for (const [compositeKey, deletedAt] of Object.entries(syncTombstones)) {
      const localKey = MEMO_PREFIX + compositeKey;
      const localData = localAll[localKey];

      if (localData) {
        const localTime = localData.updatedAt || '';
        if (deletedAt >= localTime) {
          toRemove.push(localKey);
        }
      }

      if (!mergedTombstones[compositeKey] || mergedTombstones[compositeKey] < deletedAt) {
        mergedTombstones[compositeKey] = deletedAt;
      }
    }

    // 3) 읽음 표시 병합 (합집합)
    if (Object.keys(syncReadJobs).length > 0) {
      const localReadJobs = localAll[READ_STORAGE_KEY] || {};
      const mergedReadJobs = { ...localReadJobs };
      for (const [key, ts] of Object.entries(syncReadJobs)) {
        if (!mergedReadJobs[key] || mergedReadJobs[key] < ts) {
          mergedReadJobs[key] = ts;
        }
      }
      toSet[READ_STORAGE_KEY] = mergedReadJobs;
    }

    // 4) 병합 결과 저장
    toSet[LOCAL_META_KEY] = { updatedAt: syncPayload.updatedAt || file.modifiedTime };
    toSet[TOMBSTONE_KEY] = mergedTombstones;

    if (Object.keys(toSet).length > 0) {
      await safeStorageCall(() => chrome.storage.local.set(toSet));
    }
    if (toRemove.length > 0) {
      await safeStorageCall(() => chrome.storage.local.remove(toRemove));
    }

    // 병합 후 로컬에 sync에 없던 데이터가 있을 수 있으므로 재푸시
    schedulePush();
    setSyncStatus('done');
    return true;
  } catch (e) {
    console.warn('[wanted-memo] Drive pull error:', e);
    setSyncStatus('error');
    return false;
  } finally {
    isPulling = false;
  }
}

/**
 * 사용자가 동기화 버튼을 눌렀을 때 — interactive 모드로 토큰 요청
 * (첫 동의 팝업이 여기서 뜸)
 */
async function enableSync() {
  try {
    await getAuthToken(true); // interactive: true → 동의 팝업
    setSyncStatus('syncing');
    await pullFromSync();
    schedulePush();
    return true;
  } catch (e) {
    console.warn('[wanted-memo] Sync enable failed:', e);
    setSyncStatus('error');
    return false;
  }
}

/**
 * 동기화 연결 해제
 */
async function disableSync() {
  await revokeToken();
  setSyncStatus('not_connected');
  await safeStorageCall(() =>
    chrome.storage.local.remove([LOCAL_META_KEY, '_sync_status'])
  );
}

// ── 마이그레이션 ──

async function migrateIfNeeded() {
  const flagResult = await safeStorageCall(() =>
    chrome.storage.local.get(MIGRATION_FLAG)
  );
  if (!flagResult || flagResult[MIGRATION_FLAG]) return;

  const localResult = await safeStorageCall(() =>
    chrome.storage.local.get([OLD_STORAGE_KEY, OLD_JOB_MEMOS_KEY])
  );
  if (!localResult) return;

  const toSet = {};
  let hasData = false;

  // 1) wanted_memos (v1)
  if (localResult[OLD_STORAGE_KEY]) {
    for (const [jobId, data] of Object.entries(localResult[OLD_STORAGE_KEY])) {
      const key = makeKey('wanted', jobId);
      toSet[key] = normalizeMemo({
        ...data,
        site: 'wanted',
        siteName: '원티드',
        siteUrl: `https://www.wanted.co.kr/wd/${jobId}`,
      });
      hasData = true;
    }
  }

  // 2) job_memos (v2)
  if (localResult[OLD_JOB_MEMOS_KEY]) {
    for (const [compositeKey, data] of Object.entries(localResult[OLD_JOB_MEMOS_KEY])) {
      const idx = compositeKey.indexOf(':');
      const siteId = idx === -1 ? 'wanted' : compositeKey.slice(0, idx);
      const jobId = idx === -1 ? compositeKey : compositeKey.slice(idx + 1);
      const key = makeKey(siteId, jobId);
      if (!toSet[key]) {
        toSet[key] = normalizeMemo(data);
        hasData = true;
      }
    }
  }

  // 3) chrome.storage.sync 개별 키 (v2.5) or 청크(v3) — 이전 sync 데이터 정리
  try {
    const syncResult = await chrome.storage.sync.get(null);
    if (syncResult) {
      // 개별 키 방식
      for (const [key, data] of Object.entries(syncResult)) {
        if (key.startsWith(MEMO_PREFIX) && !toSet[key]) {
          toSet[key] = normalizeMemo(data);
          hasData = true;
        }
      }
      // 청크 방식 (v3) — _sm, _sd_* 키 디코딩
      if (syncResult['_sm']?.chunkCount) {
        try {
          const { chunkCount } = syncResult['_sm'];
          let compressed = '';
          for (let i = 0; i < chunkCount; i++) {
            compressed += syncResult['_sd_' + i] || '';
          }
          if (compressed) {
            const binary = atob(compressed);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            const blob = new Blob([bytes]);
            const decompStream = blob.stream().pipeThrough(new DecompressionStream('gzip'));
            const json = await new Response(decompStream).text();
            const oldPayload = JSON.parse(json);
            const oldMemos = oldPayload.memos || oldPayload;
            for (const [ck, d] of Object.entries(oldMemos)) {
              const k = ck.startsWith(MEMO_PREFIX) ? ck : MEMO_PREFIX + ck;
              if (!toSet[k]) {
                toSet[k] = normalizeMemo(d);
                hasData = true;
              }
            }
            // readJobs 병합
            if (oldPayload.readJobs) {
              const existingRead = (await safeStorageCall(() => chrome.storage.local.get(READ_STORAGE_KEY)))?.[READ_STORAGE_KEY] || {};
              const merged = { ...existingRead };
              for (const [rk, ts] of Object.entries(oldPayload.readJobs)) {
                if (!merged[rk] || merged[rk] < ts) merged[rk] = ts;
              }
              toSet[READ_STORAGE_KEY] = merged;
            }
          }
        } catch (e) {
          console.warn('[wanted-memo] v3 sync migration failed (non-critical):', e);
        }
      }
      // 이전 sync 데이터 전부 정리
      const allSyncKeys = Object.keys(syncResult);
      if (allSyncKeys.length > 0) {
        await chrome.storage.sync.clear();
      }
    }
  } catch {
    // sync 접근 실패 무시
  }

  if (hasData) {
    await safeStorageCall(() => chrome.storage.local.set(toSet));
  }

  await safeStorageCall(() =>
    chrome.storage.local.set({ [MIGRATION_FLAG]: true })
  );
  await safeStorageCall(() =>
    chrome.storage.local.remove([OLD_STORAGE_KEY, OLD_JOB_MEMOS_KEY])
  );

  if (hasData) {
    schedulePush();
  }
}

// ── CRUD ──

async function getAllMemos() {
  const result = await safeStorageCall(() => chrome.storage.local.get(null));
  if (!result) return {};

  const memos = {};
  for (const [key, data] of Object.entries(result)) {
    if (!isMemoKey(key)) continue;
    const compositeKey = key.slice(MEMO_PREFIX.length);
    memos[compositeKey] = normalizeMemo(data);
  }
  return memos;
}

async function getMemo(siteId, jobId) {
  const key = makeKey(siteId, jobId);
  const result = await safeStorageCall(() => chrome.storage.local.get(key));
  if (!result || !result[key]) return null;
  return normalizeMemo(result[key]);
}

async function saveMemo(siteId, jobId, data) {
  const key = makeKey(siteId, jobId);
  const existing = await getMemo(siteId, jobId);
  const site = window.__wtdSites?.[siteId];

  const merged = {
    ...(existing || {
      ...DEFAULT_MEMO,
      site: siteId,
      siteName: site?.name || siteId,
      siteUrl: site?.getJobUrl(jobId) || '',
      createdAt: new Date().toISOString(),
    }),
    ...data,
    site: siteId,
    siteName: site?.name || existing?.siteName || siteId,
    siteUrl: site?.getJobUrl(jobId) || existing?.siteUrl || '',
    updatedAt: new Date().toISOString(),
  };

  await safeStorageCall(() =>
    chrome.storage.local.set({ [key]: merged })
  );

  schedulePush();
  return merged;
}

async function deleteMemo(siteId, jobId) {
  const key = makeKey(siteId, jobId);
  const compositeKey = `${siteId}:${jobId}`;

  await safeStorageCall(() => chrome.storage.local.remove(key));
  await addTombstone(compositeKey);

  schedulePush();
}

// ── 초기화 ──

async function init() {
  await migrateIfNeeded();
  // 비대화형으로 토큰 시도 → 이미 동의한 상태면 자동 pull
  try {
    await getAuthToken(false);
    const pulled = await pullFromSync();
    // Drive가 비어있거나 pull 후에도 로컬에 데이터가 있으면 푸시
    if (!pulled) {
      const memos = await getAllMemos();
      if (Object.keys(memos).length > 0) {
        schedulePush();
      }
    }
  } catch {
    setSyncStatus('not_connected');
  }
}

init();

// 전역 노출
window.__wtdMemo = {
  getAllMemos,
  getMemo,
  saveMemo,
  deleteMemo,
  makeKey,
  parseKey,
  isMemoKey,
  MEMO_PREFIX,
  pushToSync,
  schedulePush,
  pullFromSync,
  enableSync,
  disableSync,
  getSyncStatus,
};
