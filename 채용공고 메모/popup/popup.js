/**
 * popup.js
 * 팝업 UI — 멀티사이트 메모 목록, 검색, 필터, 사이트 필터, 내보내기, 삭제
 */

const STORAGE_KEY = 'job_memos';

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
  narailter:  { name: '나라일터',   color: '#2E7D32', getUrl: (id) => `https://www.gojobs.go.kr/apmView.do?annoId=${id}` }, // 하위호환
};

let allMemos = {};
let currentFilter = 'all';
let currentSiteFilter = 'all';
let searchQuery = '';

function parseKey(compositeKey) {
  const idx = compositeKey.indexOf(':');
  if (idx === -1) return { siteId: 'wanted', jobId: compositeKey };
  return { siteId: compositeKey.slice(0, idx), jobId: compositeKey.slice(idx + 1) };
}

async function loadMemos() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  allMemos = result[STORAGE_KEY] || {};
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

  // "전체" 버튼
  const allBtn = document.createElement('button');
  allBtn.className = 'wtd-popup-site-btn' + (currentSiteFilter === 'all' ? ' active' : '');
  allBtn.textContent = '전체';
  allBtn.addEventListener('click', () => {
    currentSiteFilter = 'all';
    renderSiteFilters();
    renderList();
  });
  container.appendChild(allBtn);

  // 사이트별 버튼
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

  // 사이트 필터
  if (currentSiteFilter !== 'all') {
    entries = entries.filter(([key, d]) => {
      const { siteId } = parseKey(key);
      return (d.site || siteId) === currentSiteFilter;
    });
  }

  // 상태 필터
  if (currentFilter === 'important') {
    entries = entries.filter(([, d]) => d.priority > 0);
  } else if (currentFilter === 'applied') {
    entries = entries.filter(([, d]) => d.applied);
  }

  // 검색
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

  // 정렬: 별점 높은 순 → 최근 수정순
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
  // 저장된 siteUrl 우선 사용
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

    // 사이트 뱃지
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
    title.textContent = truncate(data.positionName || `공고`, 28);

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
      await chrome.storage.local.set({ [STORAGE_KEY]: allMemos });
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
    version: '2.0',
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
loadMemos().then(() => {
  renderSiteFilters();
  renderList();
});
