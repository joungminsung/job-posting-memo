/**
 * popup.js
 * 팝업 UI — 멀티사이트 메모 목록, 검색, 필터, 사이트 필터, 내보내기, 삭제
 *           + Google Drive 동기화 상태 표시 / 연결·해제
 */

const MEMO_PREFIX = 'jm:';
const TOMBSTONE_KEY = '_tombstones';

// 사이트 메타 (content script의 site-registry와 동일한 정보)
const SITE_META = {
  wanted:     { name: '원티드',     color: '#3366FF', getUrl: (id) => `https://www.wanted.co.kr/wd/${id}` },
  saramin:    { name: '사람인',     color: '#2B7DE9', getUrl: (id) => `https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=${id}` },
  jobkorea:   { name: '잡코리아',   color: '#00C362', getUrl: (id) => `https://www.jobkorea.co.kr/Recruit/GI_Read/${id}` },
  incruit:    { name: '인크루트',   color: '#EE220C', getUrl: (id) => `https://job.incruit.com/jobdb_info/jobpost.asp?job=${id}` },
  catch:      { name: '캐치',       color: '#FF6B00', getUrl: (id) => `https://www.catch.co.kr/NCS/RecruitInfoDetails/${id}` },
  jasoseol:   { name: '자소설닷컴', color: '#4A90D9', getUrl: (id) => `https://jasoseol.com/recruit/${id}` },
  jumpit:     { name: '점핏',       color: '#00C471', getUrl: (id) => `https://jumpit.saramin.co.kr/position/${id}` },
  rocketpunch:{ name: '로켓펀치',   color: '#FF5A5F', getUrl: (id) => `https://www.rocketpunch.com/jobs/${id}` },
  work24:     { name: '고용24',     color: '#1A6FB5', getUrl: (id) => `https://www.work24.go.kr/wk/a/b/1500/empDetailAuthView.do?wantedAuthNo=${id}` },
  gojobs:     { name: '나라일터',   color: '#2E7D32', getUrl: (id) => `https://www.gojobs.go.kr/apmView.do?annoId=${id}` },
  narailter:  { name: '나라일터',   color: '#2E7D32', getUrl: (id) => `https://www.gojobs.go.kr/apmView.do?annoId=${id}` },
};

let allMemos = {};
let currentFilter = 'all';
let currentSiteFilter = 'all';
let searchQuery = '';

// ── Google Drive 동기화 (popup 컨텍스트) ──

const OAUTH_TOKEN_KEY = '_oauth_token';
const DRIVE_SCOPES = 'https://www.googleapis.com/auth/drive.appdata';

let cachedToken = null;

async function getStoredToken() {
  const result = await chrome.storage.local.get(OAUTH_TOKEN_KEY);
  const data = result?.[OAUTH_TOKEN_KEY];
  if (data && Date.now() < data.expiresAt - 60000) return data.token;
  return null;
}

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
      if (!token) { reject(new Error('No access token')); return; }

      cachedToken = token;
      chrome.storage.local.set({ [OAUTH_TOKEN_KEY]: { token, expiresAt: Date.now() + expiresIn * 1000 } });
      resolve(token);
    });
  });
}

async function getAuthToken(interactive = false) {
  const stored = await getStoredToken();
  if (stored) { cachedToken = stored; return stored; }
  return launchAuthFlow(interactive);
}

async function revokeToken() {
  cachedToken = null;
  await chrome.storage.local.remove(OAUTH_TOKEN_KEY);
}

async function driveRequest(url, options = {}, retry = true) {
  let token = cachedToken || await getAuthToken(false);
  const res = await fetch(url, {
    ...options,
    headers: { ...options.headers, Authorization: `Bearer ${token}` },
  });
  if (res.status === 401 && retry) {
    await revokeToken();
    token = await getAuthToken(false);
    return driveRequest(url, options, false);
  }
  return res;
}

const DRIVE_FILE_NAME = 'job-memo-sync.json.gz';

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
 * Drive에서 pull → 로컬 병합 → UI 갱신
 */
async function pullFromDrive() {
  try {
    await getAuthToken(false);
  } catch {
    return false;
  }

  const file = await findDriveFile();
  if (!file) return false;

  // 로컬 메타와 비교
  const localResult = await chrome.storage.local.get('_local_meta');
  const localUpdatedAt = localResult?.['_local_meta']?.updatedAt || '';
  if (localUpdatedAt >= file.modifiedTime) return false;

  // 다운로드 + 해제
  const res = await driveRequest(
    `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`
  );
  if (!res.ok) return false;

  let syncPayload;
  try {
    const buffer = await res.arrayBuffer();
    const json = await decompressFromBytes(buffer);
    syncPayload = JSON.parse(json);
  } catch {
    return false;
  }

  const syncMemos = syncPayload.memos || {};
  const syncTombstones = syncPayload.tombstones || {};
  const syncReadJobs = syncPayload.readJobs || {};

  // 로컬 전체 데이터
  const localAll = await chrome.storage.local.get(null);
  const localTombstones = localAll[TOMBSTONE_KEY] || {};
  const toSet = {};
  const toRemove = [];
  const mergedTombstones = { ...localTombstones };

  // 1) sync 메모 병합
  for (const [compositeKey, syncData] of Object.entries(syncMemos)) {
    const localKey = MEMO_PREFIX + compositeKey;
    const localData = localAll[localKey];

    if (localTombstones[compositeKey] && localTombstones[compositeKey] >= (syncData.updatedAt || '')) continue;

    if (!localData) {
      toSet[localKey] = syncData;
    } else if ((syncData.updatedAt || '') > (localData.updatedAt || '')) {
      toSet[localKey] = syncData;
    }
  }

  // 2) sync tombstone 처리
  for (const [compositeKey, deletedAt] of Object.entries(syncTombstones)) {
    const localKey = MEMO_PREFIX + compositeKey;
    const localData = localAll[localKey];
    if (localData && deletedAt >= (localData.updatedAt || '')) {
      toRemove.push(localKey);
    }
    if (!mergedTombstones[compositeKey] || mergedTombstones[compositeKey] < deletedAt) {
      mergedTombstones[compositeKey] = deletedAt;
    }
  }

  // 3) 읽음 표시 병합
  if (Object.keys(syncReadJobs).length > 0) {
    const localReadJobs = localAll['read_jobs'] || {};
    const merged = { ...localReadJobs };
    for (const [k, ts] of Object.entries(syncReadJobs)) {
      if (!merged[k] || merged[k] < ts) merged[k] = ts;
    }
    toSet['read_jobs'] = merged;
  }

  toSet['_local_meta'] = { updatedAt: syncPayload.updatedAt || file.modifiedTime };
  toSet[TOMBSTONE_KEY] = mergedTombstones;

  if (Object.keys(toSet).length > 0) await chrome.storage.local.set(toSet);
  if (toRemove.length > 0) await chrome.storage.local.remove(toRemove);

  // 메모 목록 다시 로드
  await loadMemos();
  renderSiteFilters();
  renderList();
  return true;
}

async function pushToDrive() {
  const extraResult = await chrome.storage.local.get([TOMBSTONE_KEY, 'read_jobs']);
  const tombstones = extraResult[TOMBSTONE_KEY] || {};
  const readJobs = extraResult['read_jobs'] || {};
  const now = new Date().toISOString();
  const syncPayload = { version: 3, updatedAt: now, memos: allMemos, tombstones, readJobs };
  const compressed = await compressToBytes(JSON.stringify(syncPayload));

  const file = await findDriveFile();
  let success;

  if (file?.id) {
    const res = await driveRequest(
      `https://www.googleapis.com/upload/drive/v3/files/${file.id}?uploadType=media`,
      { method: 'PATCH', headers: { 'Content-Type': 'application/gzip' }, body: compressed }
    );
    success = res.ok;
  } else {
    const metadata = { name: DRIVE_FILE_NAME, parents: ['appDataFolder'] };
    const boundary = '---jm_' + Date.now();
    const metaPart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`;
    const mediaHeader = `--${boundary}\r\nContent-Type: application/gzip\r\n\r\n`;
    const endPart = `\r\n--${boundary}--`;
    const body = new Blob([metaPart, mediaHeader, compressed, endPart]);
    const res = await driveRequest(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
      { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body }
    );
    success = res.ok;
  }

  if (success) {
    await chrome.storage.local.set({ _local_meta: { updatedAt: now }, _sync_status: 'done' });
  }
  return success;
}

async function addTombstone(compositeKey) {
  const result = await chrome.storage.local.get(TOMBSTONE_KEY);
  const tombstones = result[TOMBSTONE_KEY] || {};
  tombstones[compositeKey] = new Date().toISOString();
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  for (const [k, ts] of Object.entries(tombstones)) {
    if (ts < cutoff) delete tombstones[k];
  }
  await chrome.storage.local.set({ [TOMBSTONE_KEY]: tombstones });
}

let pushTimer = null;
function scheduleDrivePush() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(async () => {
    try {
      await getAuthToken(false);
      await pushToDrive();
      renderSyncBar();
    } catch {
      // 토큰 없음 — 스킵
    }
  }, 5000);
}

// ── 동기화 상태 UI ──

async function getSyncStatus() {
  const result = await chrome.storage.local.get('_sync_status');
  return result['_sync_status'] || 'not_connected';
}

function renderSyncBar() {
  const container = document.getElementById('wtd-sync');
  container.innerHTML = '';

  getSyncStatus().then((status) => {
    // 연결 안 됨 — 연결 유도 배너
    if (status === 'not_connected') {
      container.innerHTML = `
        <div class="wtd-sync-banner">
          <div class="wtd-sync-banner-title">Google Drive 동기화</div>
          <div class="wtd-sync-banner-desc">
            다른 기기에서도 메모를 확인할 수 있습니다.<br>
            Google 계정으로 연결하면 메모·별점·읽음 표시가 자동 동기화됩니다.
          </div>
          <button id="wtd-sync-enable" class="wtd-sync-btn wtd-sync-btn--primary">동기화 연결</button>
          <div class="wtd-sync-banner-note">
            Google Drive의 앱 전용 폴더에 저장되며, 내 드라이브에는 보이지 않습니다.
          </div>
        </div>
      `;
      document.getElementById('wtd-sync-enable').addEventListener('click', async () => {
        const btn = document.getElementById('wtd-sync-enable');
        btn.textContent = '연결 중...';
        btn.disabled = true;
        try {
          await getAuthToken(true);
          await chrome.storage.local.set({ _sync_status: 'syncing' });
          // 즉시 Drive에 현재 데이터 푸시
          await pushToDrive();
          renderSyncBar();
        } catch (e) {
          btn.textContent = '연결 실패 — 다시 시도';
          btn.disabled = false;
        }
      });
      return;
    }

    // 연결됨 — 상태 표시
    const dotClass =
      status === 'syncing' ? 'wtd-sync-dot--syncing' :
      status === 'error' ? 'wtd-sync-dot--error' :
      'wtd-sync-dot--connected';

    const label =
      status === 'syncing' ? '동기화 중...' :
      status === 'error' ? '동기화 오류' :
      'Google Drive 연결됨';

    container.innerHTML = `
      <div class="wtd-sync-info">
        <span class="wtd-sync-dot ${dotClass}"></span>
        <span>${label}</span>
      </div>
      <button id="wtd-sync-disconnect" class="wtd-sync-btn">연결 해제</button>
    `;

    document.getElementById('wtd-sync-disconnect').addEventListener('click', async () => {
      if (!confirm('동기화를 해제하시겠습니까?\n로컬 데이터는 유지됩니다.')) return;
      await revokeToken();
      await chrome.storage.local.remove(['_local_meta', '_sync_status', OAUTH_TOKEN_KEY]);
      renderSyncBar();
    });
  });
}

// ── 메모 목록 ──

function parseKey(compositeKey) {
  const idx = compositeKey.indexOf(':');
  if (idx === -1) return { siteId: 'wanted', jobId: compositeKey };
  return { siteId: compositeKey.slice(0, idx), jobId: compositeKey.slice(idx + 1) };
}

async function loadMemos() {
  const result = await chrome.storage.local.get(null);
  allMemos = {};
  for (const [key, data] of Object.entries(result)) {
    if (!key.startsWith(MEMO_PREFIX)) continue;
    const compositeKey = key.slice(MEMO_PREFIX.length);
    allMemos[compositeKey] = data;
  }
}

function renderStars(priority) {
  let stars = '';
  for (let i = 1; i <= 3; i++) {
    stars += i <= priority ? '★' : '☆';
  }
  return stars;
}

function getActiveSites() {
  const sites = new Set();
  for (const [key, data] of Object.entries(allMemos)) {
    const { siteId } = parseKey(key);
    sites.add(data.site || siteId);
  }
  return sites;
}

function renderSiteFilters() {
  const container = document.getElementById('wtd-sites');
  container.innerHTML = '';

  const activeSites = getActiveSites();
  if (activeSites.size <= 1) {
    container.style.display = 'none';
    return;
  }

  container.style.display = 'flex';

  const allBtn = document.createElement('button');
  allBtn.className = 'wtd-popup-site-btn' + (currentSiteFilter === 'all' ? ' active' : '');
  allBtn.textContent = '전체';
  allBtn.addEventListener('click', () => {
    currentSiteFilter = 'all';
    renderSiteFilters();
    renderList();
  });
  container.appendChild(allBtn);

  for (const siteId of activeSites) {
    const meta = SITE_META[siteId];
    const btn = document.createElement('button');
    btn.className = 'wtd-popup-site-btn' + (currentSiteFilter === siteId ? ' active' : '');
    btn.textContent = meta?.name || siteId;
    if (meta?.color && currentSiteFilter === siteId) {
      btn.style.background = meta.color;
      btn.style.borderColor = meta.color;
      btn.style.color = '#fff';
    }
    btn.addEventListener('click', () => {
      currentSiteFilter = siteId;
      renderSiteFilters();
      renderList();
    });
    container.appendChild(btn);
  }
}

function getFilteredMemos() {
  let entries = Object.entries(allMemos);

  if (currentSiteFilter !== 'all') {
    entries = entries.filter(([key, d]) => {
      const { siteId } = parseKey(key);
      return (d.site || siteId) === currentSiteFilter;
    });
  }

  if (currentFilter === 'important') {
    entries = entries.filter(([, d]) => d.priority > 0);
  } else if (currentFilter === 'applied') {
    entries = entries.filter(([, d]) => d.applied);
  }

  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    entries = entries.filter(([, d]) => {
      return (
        (d.positionName || '').toLowerCase().includes(q) ||
        (d.companyName || '').toLowerCase().includes(q) ||
        (d.memo || '').toLowerCase().includes(q) ||
        (d.siteName || '').toLowerCase().includes(q)
      );
    });
  }

  entries.sort((a, b) => {
    const pa = a[1].priority || 0;
    const pb = b[1].priority || 0;
    if (pb !== pa) return pb - pa;
    const da = a[1].updatedAt || '';
    const db = b[1].updatedAt || '';
    return db.localeCompare(da);
  });

  return entries;
}

function truncate(text, max) {
  if (!text) return '';
  return text.length > max ? text.slice(0, max) + '...' : text;
}

function getJobUrl(key, data) {
  const { siteId, jobId } = parseKey(key);
  if (data.siteUrl) return data.siteUrl;
  const meta = SITE_META[data.site || siteId];
  return meta?.getUrl(jobId) || '#';
}

function renderList() {
  const list = document.getElementById('wtd-list');
  const empty = document.getElementById('wtd-empty');
  const count = document.getElementById('wtd-count');

  const filtered = getFilteredMemos();
  const totalCount = Object.keys(allMemos).length;
  count.textContent = `(${totalCount}개)`;

  list.innerHTML = '';

  if (filtered.length === 0) {
    empty.style.display = 'block';
    list.style.display = 'none';
    return;
  }

  empty.style.display = 'none';
  list.style.display = 'block';

  filtered.forEach(([key, data]) => {
    const { siteId } = parseKey(key);
    const siteMeta = SITE_META[data.site || siteId];

    const li = document.createElement('li');
    li.className = 'wtd-popup-card';

    const siteLabel = document.createElement('span');
    siteLabel.className = 'wtd-popup-card-site';
    siteLabel.textContent = data.siteName || siteMeta?.name || siteId;
    if (siteMeta?.color) {
      siteLabel.style.background = siteMeta.color + '15';
      siteLabel.style.color = siteMeta.color;
    }

    const top = document.createElement('div');
    top.className = 'wtd-popup-card-top';

    const stars = document.createElement('span');
    stars.className = 'wtd-popup-card-stars';
    stars.textContent = data.priority > 0 ? renderStars(data.priority) : '';

    const title = document.createElement('span');
    title.className = 'wtd-popup-card-title';
    title.textContent = truncate(data.positionName || '공고', 28);

    top.appendChild(stars);
    top.appendChild(title);

    const mid = document.createElement('div');
    mid.className = 'wtd-popup-card-mid';
    const parts = [data.companyName || ''];
    if (data.applied) parts.push('✅ 지원완료');
    mid.textContent = parts.filter(Boolean).join(' · ');

    const bottom = document.createElement('div');
    bottom.className = 'wtd-popup-card-memo';
    bottom.textContent = truncate(data.memo, 60) || '(메모 없음)';

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'wtd-popup-card-delete';
    deleteBtn.textContent = '✕';
    deleteBtn.title = '삭제';
    deleteBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(`"${data.positionName || '공고'}" 메모를 삭제하시겠습니까?`)) return;
      delete allMemos[key];
      await chrome.storage.local.remove(MEMO_PREFIX + key);
      await addTombstone(key);
      scheduleDrivePush();
      renderSiteFilters();
      renderList();
    });

    li.appendChild(deleteBtn);
    li.appendChild(siteLabel);
    li.appendChild(top);
    li.appendChild(mid);
    li.appendChild(bottom);

    li.addEventListener('click', () => {
      const url = getJobUrl(key, data);
      chrome.tabs.create({ url });
    });

    list.appendChild(li);
  });
}

// 필터 버튼
document.querySelectorAll('.wtd-popup-filter').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.wtd-popup-filter').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    renderList();
  });
});

// 검색
document.getElementById('wtd-search').addEventListener('input', (e) => {
  searchQuery = e.target.value.trim();
  renderList();
});

// 내보내기
document.getElementById('wtd-export').addEventListener('click', async () => {
  const exportData = {
    version: '3.0',
    exportedAt: new Date().toISOString(),
    memos: allMemos,
  };
  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `job-memos-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

// 초기화
loadMemos().then(async () => {
  renderSiteFilters();
  renderList();
  renderSyncBar();

  // Drive에서 최신 데이터 pull (백그라운드)
  try {
    const pulled = await pullFromDrive();
    if (!pulled && Object.keys(allMemos).length > 0) {
      // Drive가 비어있거나 로컬이 최신 → 푸시
      try { await getAuthToken(false); scheduleDrivePush(); } catch {}
    }
  } catch {}
});
