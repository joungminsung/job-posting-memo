/**
 * site-registry.js
 * 채용 사이트 어댑터 정의 + 현재 사이트 자동 감지
 *
 * 지원: 원티드, 사람인, 잡코리아, 인크루트, 캐치, 자소설닷컴, 점핏, 로켓펀치, 고용24, 나라일터
 */

(function () {
  // ── Helpers ──
  function qText(sel) {
    return document.querySelector(sel)?.textContent?.trim() || '';
  }

  function firstTarget(...selectors) {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return { target: el, mode: 'append' };
    }
    return null;
  }

  function paramFromUrl(url, key) {
    try { return new URL(url).searchParams.get(key); } catch { return null; }
  }

  function pathMatch(url, re) {
    try { return new URL(url).pathname.match(re); } catch { return null; }
  }

  // ── Site Adapters ──

  const SITES = {};

  // ────────────────────────────────────────
  // 1. 원티드 (Wanted)
  // ────────────────────────────────────────
  SITES.wanted = {
    id: 'wanted',
    name: '원티드',
    hosts: ['www.wanted.co.kr'],
    isSPA: true,
    color: '#3366FF',

    getJobId(url) {
      return pathMatch(url, /\/wd\/(\d+)/)?.[1] || null;
    },
    isJobDetailPage(url) {
      return !!this.getJobId(url);
    },
    getJobUrl(id) {
      return `https://www.wanted.co.kr/wd/${id}`;
    },

    getMemoTarget() {
      for (const a of document.querySelectorAll('aside')) {
        if (a.querySelector('button[aria-label="북마크"]')) {
          return { target: a.firstElementChild || a, mode: 'append' };
        }
      }
      return null;
    },
    getMetadata() {
      const b = document.querySelector('button[aria-label="북마크"]');
      return {
        positionName: b?.dataset.positionName || qText('h1'),
        companyName: b?.dataset.companyName || '',
        employmentType: b?.dataset.positionEmploymentType || '',
      };
    },
    detailReadySelector: 'button[aria-label="북마크"]',
    detailReadyTimeout: 10000,

    isJobListPage(url) {
      return url.includes('/profile/bookmarks');
    },
    listReadySelector: 'a[data-cy="job-card"], a[href*="/wd/"]',
    getJobCards() {
      // data-cy="job-card" (북마크) + href="/wd/{id}" (일반 리스트) 모두 탐색
      const set = new Set();
      document.querySelectorAll('a[data-cy="job-card"]').forEach((el) => set.add(el));
      document.querySelectorAll('a[href*="/wd/"]').forEach((el) => {
        if (el.getAttribute('href')?.match(/^\/wd\/\d+$/)) set.add(el);
      });
      return set;
    },
    getJobIdFromCard(c) {
      return c.getAttribute('href')?.match(/\/wd\/(\d+)/)?.[1] || null;
    },
    getCardContainer(c) {
      return c.closest('li');
    },

    submitButtonText: '제출하기',
  };

  // ────────────────────────────────────────
  // 2. 사람인 (Saramin)
  // ────────────────────────────────────────
  SITES.saramin = {
    id: 'saramin',
    name: '사람인',
    hosts: ['www.saramin.co.kr'],
    isSPA: false,
    color: '#2B7DE9',

    getJobId(url) {
      return paramFromUrl(url, 'rec_idx')
        || url.match(/rec_idx=(\d+)/)?.[1]
        || null;
    },
    isJobDetailPage(url) {
      return url.includes('/zf_user/jobs/') && !!this.getJobId(url);
    },
    getJobUrl(id) {
      return `https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=${id}`;
    },

    getMemoTarget() {
      // 우측 사이드바 영역에 메모 박스를 직접 삽입
      // 1) .wrap_right_recruit (지원 버튼 포함 우측 패널)
      const rightWrap = document.querySelector('.wrap_right_recruit');
      if (rightWrap) return { target: rightWrap, mode: 'append' };
      // 2) .area_aside 또는 aside 태그
      const aside = document.querySelector('.area_aside') || document.querySelector('#content aside');
      if (aside) return { target: aside, mode: 'append' };
      // 3) 입사지원/홈페이지 지원 버튼의 부모 컨테이너 (우측 영역)
      const applyBtn = Array.from(document.querySelectorAll('button, a')).find(
        (b) => {
          const text = b.textContent.trim();
          return text === '입사지원' || text === '홈페이지 지원';
        }
      );
      if (applyBtn) {
        // 버튼에서 위로 올라가며 우측 래퍼를 찾음
        let parent = applyBtn.parentElement;
        for (let i = 0; i < 5 && parent; i++) {
          // 넓이가 좁은 사이드바 컨테이너를 찾음
          if (parent.offsetWidth && parent.offsetWidth < 400) {
            return { target: parent, mode: 'append' };
          }
          parent = parent.parentElement;
        }
        return { target: applyBtn.parentElement.parentElement || applyBtn.parentElement, mode: 'append' };
      }
      // 4) h1.tit_job 기반 폴백 — 인라인 트리거
      const title = document.querySelector('h1.tit_job');
      if (title) return { target: title.parentElement, mode: 'inline-trigger' };
      return firstTarget('#sri_section', '#content');
    },
    getMetadata() {
      return {
        positionName: qText('h1.tit_job') || qText('h1'),
        companyName: qText('a.company_name') || qText('.company_name a') || qText('.name_company'),
        employmentType: '',
      };
    },
    detailReadySelector: 'h1.tit_job, #sri_section',
    detailReadyTimeout: 5000,

    isJobListPage(url) {
      return url.includes('/zf_user/bookmark') || url.includes('/zf_user/scraps');
    },
    listReadySelector: '.list_recruiting .item_recruit',
    getJobCards() {
      return document.querySelectorAll('.item_recruit a[href*="rec_idx"]');
    },
    getJobIdFromCard(c) {
      return c.getAttribute('href')?.match(/rec_idx=(\d+)/)?.[1] || null;
    },
    getCardContainer(c) {
      return c.closest('.item_recruit') || c.closest('li');
    },

    submitButtonText: '입사지원',
  };

  // ────────────────────────────────────────
  // 3. 잡코리아 (JobKorea)
  // ────────────────────────────────────────
  SITES.jobkorea = {
    id: 'jobkorea',
    name: '잡코리아',
    hosts: ['www.jobkorea.co.kr'],
    isSPA: false,
    color: '#00C362',

    getJobId(url) {
      return pathMatch(url, /\/Recruit\/GI_Read\/(\d+)/i)?.[1] || null;
    },
    isJobDetailPage(url) {
      return !!this.getJobId(url);
    },
    getJobUrl(id) {
      return `https://www.jobkorea.co.kr/Recruit/GI_Read/${id}`;
    },

    getMemoTarget() {
      // CSS Modules+Tailwind 해시 클래스 → 시맨틱 태그 기반 탐색
      // aside (sticky 사이드바) 내 h1 옆에 트리거 삽입
      const mainH1 = document.querySelector('main h1');
      if (mainH1) {
        return { target: mainH1.parentElement, mode: 'inline-trigger' };
      }
      // [role="tab"] 탭바 영역 위에 삽입
      const tabBar = document.querySelector('[role="tab"]')?.closest('[role="tablist"]');
      if (tabBar) return { target: tabBar.parentElement, mode: 'append' };
      return firstTarget('main', '#content');
    },
    getMetadata() {
      return {
        // 해시 클래스 불안정 → 시맨틱 태그 사용
        positionName: qText('main h1') || qText('h1'),
        companyName: qText('main h2') || qText('h2'),
        employmentType: '',
      };
    },
    detailReadySelector: 'main h1',
    detailReadyTimeout: 5000,

    isJobListPage(url) {
      return url.includes('/User/Scrap') || url.includes('/User/BookMark');
    },
    listReadySelector: '.list-post .post-list-info, a[href*="GI_Read"]',
    getJobCards() {
      return document.querySelectorAll('a[href*="GI_Read"]');
    },
    getJobIdFromCard(c) {
      return c.getAttribute('href')?.match(/GI_Read\/(\d+)/)?.[1] || null;
    },
    getCardContainer(c) {
      return c.closest('.post-list-info') || c.closest('tr') || c.closest('li') || c.parentElement;
    },

    submitButtonText: '즉시 지원',
  };

  // ────────────────────────────────────────
  // 4. 인크루트 (Incruit)
  // ────────────────────────────────────────
  SITES.incruit = {
    id: 'incruit',
    name: '인크루트',
    hosts: ['www.incruit.com', 'job.incruit.com'],
    isSPA: false,
    color: '#EE220C',

    getJobId(url) {
      return paramFromUrl(url, 'job')
        || url.match(/job=(\d+)/)?.[1]
        || null;
    },
    isJobDetailPage(url) {
      return url.includes('/jobdb_info/') && !!this.getJobId(url);
    },
    getJobUrl(id) {
      return `https://job.incruit.com/jobdb_info/jobpost.asp?job=${id}`;
    },

    getMemoTarget() {
      // .jobcompany_info 영역 또는 .job_info_detail 상단에 삽입
      // .job_info_detail_head_right (지원 버튼 영역) 옆에 트리거
      const applyArea = document.querySelector('.job_info_detail_head_right');
      if (applyArea) return { target: applyArea, mode: 'inline-trigger' };
      return firstTarget(
        '.jobcompany_info',
        '.job_info_detail',
        '#incruit_contents',
        '#incruit_wrap'
      );
    },
    getMetadata() {
      return {
        // 안정적인 전통 클래스명 사용
        positionName: qText('.job_info_detail h1') || qText('h1'),
        companyName: qText('.jobcompany_info a') || qText('.jobcompany_info'),
        employmentType: '',
      };
    },
    detailReadySelector: '#incruit_contents, .job_info_detail',
    detailReadyTimeout: 5000,

    isJobListPage(url) {
      return url.includes('/mypage/scrap') || url.includes('/mypage/bookmark');
    },
    listReadySelector: '.list-job li, a[href*="job="]',
    getJobCards() {
      return document.querySelectorAll('a[href*="jobpost.asp"][href*="job="]');
    },
    getJobIdFromCard(c) {
      return c.getAttribute('href')?.match(/job=(\d+)/)?.[1] || null;
    },
    getCardContainer(c) {
      return c.closest('li') || c.closest('tr') || c.parentElement;
    },

    submitButtonText: '입사지원',
  };

  // ────────────────────────────────────────
  // 5. 캐치 (CATCH) — Nuxt.js 기반
  // ────────────────────────────────────────
  SITES.catch_ = {
    id: 'catch',
    name: '캐치',
    hosts: ['www.catch.co.kr'],
    isSPA: false,
    color: '#FF6B00',

    getJobId(url) {
      // /NCS/RecruitInfoDetails/{id} 또는 /Comp/.../Recruit/{id}
      return pathMatch(url, /\/RecruitInfoDetails\/(\d+)/)?.[1]
        || pathMatch(url, /\/Recruit\/(\d+)/)?.[1]
        || paramFromUrl(url, 'recruitSeq')
        || null;
    },
    isJobDetailPage(url) {
      return (url.includes('/RecruitInfoDetails/') || url.includes('/Recruit/')) && !!this.getJobId(url);
    },
    getJobUrl(id) {
      return `https://www.catch.co.kr/NCS/RecruitInfoDetails/${id}`;
    },

    getMemoTarget() {
      // Nuxt 기반: .recr_pop3 내 h1.subj 옆에 트리거 삽입
      const title = document.querySelector('h1.subj');
      if (title) return { target: title.parentElement, mode: 'inline-trigger' };
      // .rfix 우측 플로팅 영역에 삽입
      const rfix = document.querySelector('.rfix');
      if (rfix) return { target: rfix, mode: 'append' };
      return firstTarget('.recr_pop3', '.atGongoView3', '#__nuxt');
    },
    getMetadata() {
      return {
        positionName: qText('h1.subj') || qText('h1'),
        companyName: qText('h2.name') || qText('.recr_pop3 h2'),
        employmentType: '',
      };
    },
    detailReadySelector: '.recr_pop3, h1.subj',
    detailReadyTimeout: 5000,

    isJobListPage(url) {
      return url.includes('/MyPage/Scrap') || url.includes('/MyPage/Interest');
    },
    listReadySelector: '.scrap-list li, a[href*="Recruit"]',
    getJobCards() {
      return document.querySelectorAll('a[href*="RecruitInfoDetails"], a[href*="Recruit/"]');
    },
    getJobIdFromCard(c) {
      const href = c.getAttribute('href') || '';
      return href.match(/RecruitInfoDetails\/(\d+)/)?.[1]
        || href.match(/Recruit\/(\d+)/)?.[1]
        || null;
    },
    getCardContainer(c) {
      return c.closest('li') || c.parentElement;
    },

    submitButtonText: '지원하기',
  };

  // ────────────────────────────────────────
  // 6. 자소설닷컴 (Jasoseol) — AngularJS, 모달 팝업 방식
  // ────────────────────────────────────────
  SITES.jasoseol = {
    id: 'jasoseol',
    name: '자소설닷컴',
    hosts: ['jasoseol.com', 'www.jasoseol.com'],
    isSPA: true, // AngularJS SPA — 모달로 공고 표시, URL은 바뀌지만 전체 리로드 없음
    color: '#4A90D9',

    getJobId(url) {
      // /recruit/{id} 또는 /schedule/{id}
      return pathMatch(url, /\/(?:recruit|schedule)\/(\d+)/)?.[1] || null;
    },
    isJobDetailPage(url) {
      return (url.includes('/recruit/') || url.includes('/schedule/')) && !!this.getJobId(url);
    },
    getJobUrl(id) {
      return `https://jasoseol.com/recruit/${id}`;
    },

    getMemoTarget() {
      // 모달 팝업 방식: .modal-dialog > .modal-content 내에 삽입
      // .navigator.fixed 탭 메뉴 영역에 트리거 삽입
      const nav = document.querySelector('.modal-dialog .navigator.fixed');
      if (nav) return { target: nav, mode: 'inline-trigger' };
      // 모달 콘텐츠 상단에 삽입
      const modalContent = document.querySelector('.modal-dialog .modal-content');
      if (modalContent) return { target: modalContent, mode: 'append' };
      // recruit-slide 커스텀 엘리먼트
      const slide = document.querySelector('recruit-slide');
      if (slide) return { target: slide, mode: 'append' };
      return null; // 플로팅 폴백
    },
    getMetadata() {
      // 모달 내부에서 메타데이터 추출
      const modal = document.querySelector('.modal-dialog');
      return {
        positionName: modal?.querySelector('h1')?.textContent?.trim()
          || modal?.querySelector('.recruit-title')?.textContent?.trim()
          || qText('h1'),
        companyName: modal?.querySelector('.company-name')?.textContent?.trim()
          || modal?.querySelector('a[class*="company"]')?.textContent?.trim()
          || '',
        employmentType: '',
      };
    },
    detailReadySelector: '.modal-dialog .modal-content, .modal-dialog .navigator',
    detailReadyTimeout: 8000,

    isJobListPage() {
      return false; // 자소설닷컴은 별도 북마크 페이지가 특수함
    },
    listReadySelector: null,
    getJobCards() { return []; },
    getJobIdFromCard() { return null; },
    getCardContainer() { return null; },

    submitButtonText: null, // 자소설닷컴은 외부 링크로 연결
  };

  // ────────────────────────────────────────
  // 7. 점핏 (Jumpit) — Next.js + Styled Components (사람인 자회사)
  // ────────────────────────────────────────
  SITES.jumpit = {
    id: 'jumpit',
    name: '점핏',
    hosts: ['jumpit.saramin.co.kr', 'www.jumpit.co.kr', 'jumpit.co.kr'],
    isSPA: true,
    color: '#00C471',

    getJobId(url) {
      return pathMatch(url, /\/position\/(\d+)/)?.[1] || null;
    },
    isJobDetailPage(url) {
      return !!this.getJobId(url);
    },
    getJobUrl(id) {
      return `https://jumpit.saramin.co.kr/position/${id}`;
    },

    getMemoTarget() {
      // Styled Components 해시 클래스 → 시맨틱 태그 사용
      // main > h1 (공고 제목) 옆에 트리거 삽입
      const h1 = document.querySelector('main h1');
      if (h1) return { target: h1.parentElement, mode: 'inline-trigger' };
      // h2.title "포지션 상세" 상단에 삽입
      const section = document.querySelector('h2.title');
      if (section) return { target: section.parentElement, mode: 'append' };
      return firstTarget('main', '#__next');
    },
    getMetadata() {
      return {
        // Styled Components → 시맨틱 태그 기반
        positionName: qText('main h1') || qText('h1'),
        companyName: (() => {
          // h1 위에 있는 회사명 링크 (시맨틱 구조 기반)
          const h1 = document.querySelector('main h1');
          const prev = h1?.previousElementSibling;
          return prev?.textContent?.trim() || qText('a[class*="company"]') || '';
        })(),
        employmentType: '',
      };
    },
    detailReadySelector: 'main h1',
    detailReadyTimeout: 8000,

    isJobListPage(url) {
      return url.includes('/my/bookmark') || url.includes('/my/scrap');
    },
    listReadySelector: 'a[href*="/position/"]',
    getJobCards() {
      const links = document.querySelectorAll('a[href*="/position/"]');
      return Array.from(links).filter(
        (a) => a.getAttribute('href')?.match(/^\/position\/\d+$/)
      );
    },
    getJobIdFromCard(c) {
      return c.getAttribute('href')?.match(/\/position\/(\d+)/)?.[1] || null;
    },
    getCardContainer(c) {
      return c.closest('li') || c.parentElement;
    },

    submitButtonText: '지원하기',
  };

  // ────────────────────────────────────────
  // 8. 로켓펀치 (RocketPunch) — CSS-in-JS, heading 없는 div 구조
  // ────────────────────────────────────────
  SITES.rocketpunch = {
    id: 'rocketpunch',
    name: '로켓펀치',
    hosts: ['www.rocketpunch.com', 'rocketpunch.com'],
    isSPA: true,
    color: '#FF5A5F',

    getJobId(url) {
      return pathMatch(url, /\/jobs\/(\d+)/)?.[1] || null;
    },
    isJobDetailPage(url) {
      return url.includes('/jobs/') && !!this.getJobId(url);
    },
    getJobUrl(id) {
      return `https://www.rocketpunch.com/jobs/${id}`;
    },

    getMemoTarget() {
      // CSS-in-JS 유틸리티 기반 → 해시 클래스 매우 불안정
      // #main-content 하위에서 구조적 위치로 탐색
      // 지원하기 버튼 옆에 트리거
      const applyBtn = Array.from(document.querySelectorAll('#main-content button')).find(
        (b) => b.textContent.trim() === '지원하기'
      );
      if (applyBtn) {
        return { target: applyBtn.parentElement, mode: 'inline-trigger' };
      }
      return firstTarget('#main-content', 'main');
    },
    getMetadata() {
      // heading 없이 div 기반 → 구조적 위치 기반 추출
      const main = document.querySelector('#main-content');
      if (!main) return { positionName: '', companyName: '', employmentType: '' };
      // 첫 번째 큰 텍스트를 공고 제목으로, 그 위의 텍스트를 회사명으로 추정
      const allText = main.querySelectorAll('div, span, a');
      let positionName = '';
      let companyName = '';
      for (const el of allText) {
        const fs = window.getComputedStyle(el).fontSize;
        if (parseInt(fs) >= 24 && !positionName) {
          positionName = el.textContent.trim();
        }
        if (parseInt(fs) >= 18 && parseInt(fs) < 24 && !companyName) {
          companyName = el.textContent.trim();
        }
        if (positionName && companyName) break;
      }
      return { positionName, companyName, employmentType: '' };
    },
    detailReadySelector: '#main-content',
    detailReadyTimeout: 5000,

    isJobListPage(url) {
      return url.includes('/my/bookmarks');
    },
    listReadySelector: 'a[href*="/jobs/"]',
    getJobCards() {
      const links = document.querySelectorAll('#main-content a[href*="/jobs/"]');
      return Array.from(links).filter(
        (a) => a.getAttribute('href')?.match(/\/jobs\/\d+/)
      );
    },
    getJobIdFromCard(c) {
      return c.getAttribute('href')?.match(/\/jobs\/(\d+)/)?.[1] || null;
    },
    getCardContainer(c) {
      return c.closest('li') || c.parentElement;
    },

    submitButtonText: '지원하기',
  };

  // ────────────────────────────────────────
  // 9. 고용24 (Work24, 구 워크넷) — 전통 JSP, 안정적 클래스명
  // ────────────────────────────────────────
  SITES.work24 = {
    id: 'work24',
    name: '고용24',
    hosts: ['www.work24.go.kr', 'work24.go.kr'],
    isSPA: false,
    color: '#1A6FB5',

    getJobId(url) {
      return paramFromUrl(url, 'wantedAuthNo')
        || paramFromUrl(url, 'regNo')
        || url.match(/wantedAuthNo=([^&]+)/)?.[1]
        || url.match(/regNo=([^&]+)/)?.[1]
        || null;
    },
    isJobDetailPage(url) {
      return (url.includes('empDetail') || url.includes('RegRecm') || url.includes('empInfoSrch/detail'))
        && !!this.getJobId(url);
    },
    getJobUrl(id) {
      return `https://www.work24.go.kr/wk/a/b/1500/empDetailAuthView.do?wantedAuthNo=${id}`;
    },

    getMemoTarget() {
      // 전통 JSP: .box_btn_wrap (관심등록 + 입사지원 버튼) 옆에 트리거
      const btnWrap = document.querySelector('.box_btn_wrap');
      if (btnWrap) return { target: btnWrap, mode: 'inline-trigger' };
      // .emp_sumup_wrp (공고 요약 영역) 아래에 삽입
      const summary = document.querySelector('.emp_sumup_wrp');
      if (summary) return { target: summary, mode: 'append' };
      // 빈 우측 사이드바에 삽입
      const rightSide = document.querySelector('.box_border_wrap .right');
      if (rightSide) return { target: rightSide, mode: 'append' };
      return firstTarget(
        '.box_border_wrap .left',
        '.cont_wrap_area',
        'section#container',
        '#contents'
      );
    },
    getMetadata() {
      // 안정적인 전통 JSP 클래스명
      const summaryEl = document.querySelector('.emp_sumup_wrp');
      return {
        positionName: summaryEl?.querySelector('h2, h3')?.textContent?.trim()
          || qText('.sub_tl') || qText('h1'),
        companyName: summaryEl?.querySelector('a')?.textContent?.trim()
          || qText('.emp_sumup_wrp .company') || '',
        employmentType: '',
      };
    },
    detailReadySelector: '.emp_sumup_wrp, section#container, #contents',
    detailReadyTimeout: 5000,

    isJobListPage(url) {
      return url.includes('/interest') || url.includes('/scrap') || url.includes('/wishList');
    },
    listReadySelector: '.list-result li, .tbl-list tr',
    getJobCards() {
      return document.querySelectorAll(
        '.list-result a[href*="wantedAuthNo"], .tbl-list a[href*="wantedAuthNo"]'
      );
    },
    getJobIdFromCard(c) {
      return c.getAttribute('href')?.match(/wantedAuthNo=([^&"]+)/)?.[1] || null;
    },
    getCardContainer(c) {
      return c.closest('li') || c.closest('tr');
    },

    submitButtonText: '입사지원',
  };

  // ────────────────────────────────────────
  // 10. 나라일터 (GoJobs) — 전통 JSP, 테이블 기반 레이아웃
  // ────────────────────────────────────────
  SITES.gojobs = {
    id: 'gojobs',
    name: '나라일터',
    hosts: ['www.gojobs.go.kr', 'gojobs.go.kr', 'www.narailter.go.kr', 'narailter.go.kr'],
    isSPA: false,
    color: '#2E7D32',

    getJobId(url) {
      // /apmView.do (폼 기반, GET/POST) — URL 파라미터에서 추출
      return paramFromUrl(url, 'annoId')
        || paramFromUrl(url, 'seq')
        || paramFromUrl(url, 'annoIdx')
        || pathMatch(url, /\/annoDtl\/(\d+)/)?.[1]
        || url.match(/annoId=([^&]+)/)?.[1]
        || null;
    },
    isJobDetailPage(url) {
      return (url.includes('apmView.do') || url.includes('annoDtl') || url.includes('annoDetail'))
        && !!this.getJobId(url);
    },
    getJobUrl(id) {
      return `https://www.gojobs.go.kr/apmView.do?annoId=${id}`;
    },

    getMemoTarget() {
      // 전통 JSP 테이블 기반: form#viewForm 상단에 삽입
      const viewForm = document.querySelector('form#viewForm');
      if (viewForm) return { target: viewForm, mode: 'append' };
      // .sub_table_detail (공고 테이블) 위에 삽입
      const table = document.querySelector('.sub_table_detail');
      if (table) return { target: table.parentElement, mode: 'append' };
      // .sub_title 아래에 삽입
      const subTitle = document.querySelector('.sub_title');
      if (subTitle) return { target: subTitle.parentElement, mode: 'append' };
      return firstTarget('#sub_content', '#contents', '#wrap');
    },
    getMetadata() {
      // 테이블 기반: th/td 구조에서 추출
      const subTitle = document.querySelector('.sub_title');
      const tables = document.querySelectorAll('.sub_table_detail table th, .sub_table_detail table td');
      let positionName = subTitle?.textContent?.trim() || '';
      let companyName = '';
      for (let i = 0; i < tables.length; i++) {
        const text = tables[i]?.textContent?.trim() || '';
        if (text.includes('공고명') || text.includes('모집분야')) {
          companyName = tables[i + 1]?.textContent?.trim() || companyName;
        }
        if (text.includes('기관명') || text.includes('채용기관')) {
          companyName = tables[i + 1]?.textContent?.trim() || companyName;
        }
      }
      return { positionName, companyName, employmentType: '' };
    },
    detailReadySelector: '#sub_content, .sub_table_detail, form#viewForm',
    detailReadyTimeout: 5000,

    isJobListPage(url) {
      return url.includes('/mypage/scrap') || url.includes('/mypage/interest');
    },
    listReadySelector: '.sub_table_detail tr, a[href*="apmView"]',
    getJobCards() {
      return document.querySelectorAll(
        'a[href*="apmView.do"], a[href*="annoId"], a[href*="annoDtl"]'
      );
    },
    getJobIdFromCard(c) {
      const href = c.getAttribute('href') || '';
      return href.match(/(?:annoId=|annoDtl\/)([^&"]+)/)?.[1] || null;
    },
    getCardContainer(c) {
      return c.closest('tr') || c.closest('li') || c.parentElement;
    },

    submitButtonText: '지원하기',
  };

  // ── Detect Current Site ──
  const host = location.hostname;
  let current = null;

  for (const adapter of Object.values(SITES)) {
    if (adapter.hosts.some((h) => host === h || host.endsWith('.' + h))) {
      current = adapter;
      break;
    }
  }

  // 전역 노출
  window.__wtdSite = current;
  window.__wtdSites = SITES;
})();
