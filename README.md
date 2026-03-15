# 채용공고 메모

<p align="center">
  <img src="채용공고 메모/icons/icon128.png" alt="채용공고 메모 로고" width="128" height="128">
</p>

<p align="center">
  <strong>채용 공고 페이지에서 메모·별점·지원 추적을 한 번에</strong><br>
  10개 주요 채용 플랫폼 지원 · Google Drive 동기화 · Chrome & Edge 호환
</p>

<p align="center">
  <a href="https://chromewebstore.google.com/detail/%EC%B1%84%EC%9A%A9%EA%B3%B5%EA%B3%A0-%EB%A9%94%EB%AA%A8/ipflfipjcghomkpbilgghofenifcllkj">
    <img src="https://img.shields.io/badge/Chrome%20Web%20Store-설치하기-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Chrome Web Store">
  </a>
</p>

---

## 주요 기능

- **메모 & 별점** — 공고 상세 페이지에서 바로 메모 작성 + 3단계 별점
- **지원 추적** — 지원 버튼 클릭 시 자동 감지, 지원 완료 상태 기록
- **읽음 표시** — 열어본 공고를 목록에서 시각적으로 구분
- **북마크 뱃지** — 목록 페이지에서 메모/별점/지원 상태를 뱃지로 표시
- **크로스 디바이스 동기화** — Google Drive appData로 기기 간 자동 동기화
- **팝업 대시보드** — 전체 메모 검색, 필터, 사이트별 분류, JSON 내보내기

## 지원 사이트

| 사이트 | URL |
|--------|-----|
| **원티드** | wanted.co.kr |
| **사람인** | saramin.co.kr |
| **잡코리아** | jobkorea.co.kr |
| **인크루트** | incruit.com |
| **캐치** | catch.co.kr |
| **자소설닷컴** | jasoseol.com |
| **점핏** | jumpit.saramin.co.kr |
| **로켓펀치** | rocketpunch.com |
| **고용24** | work24.go.kr |
| **나라일터** | gojobs.go.kr |

## 설치

### Chrome Web Store (권장)

[Chrome Web Store에서 설치](https://chromewebstore.google.com/detail/%EC%B1%84%EC%9A%A9%EA%B3%B5%EA%B3%A0-%EB%A9%94%EB%AA%A8/ipflfipjcghomkpbilgghofenifcllkj)

### 수동 설치 (개발용)

```bash
git clone https://github.com/joungminsung/job-posting-memo.git
```

1. `chrome://extensions` 접속
2. **개발자 모드** 활성화
3. **압축해제된 확장 프로그램을 로드합니다** 클릭
4. `채용공고 메모` 폴더 선택

## 아키텍처

```
채용공고 메모/
├── manifest.json                    # 확장 프로그램 설정 (Manifest V3)
├── content-scripts/
│   ├── site-registry.js             # 10개 사이트 어댑터 + 자동 감지
│   ├── storage-helper.js            # 하이브리드 저장소 (Local + Google Drive)
│   ├── memo-input.js                # 상세 페이지 메모 UI
│   ├── read-marker.js               # 읽음 표시 추적
│   ├── apply-detector.js            # 지원 버튼 자동 감지
│   ├── bookmark-tooltip.js          # 목록 페이지 뱃지 & 툴팁
│   └── router-observer.js           # SPA/MPA 라우팅 감지
├── popup/
│   ├── popup.html / popup.js / popup.css   # 팝업 대시보드
├── styles/                          # Content script CSS
└── icons/                           # 확장 프로그램 아이콘
```

### 데이터 흐름

```
사이트 접속 → site-registry.js (사이트 감지)
                    │
          ┌─────────┼─────────┐
          ▼         ▼         ▼
     상세 페이지   목록 페이지  공통
          │         │         │
    memo-input.js   │    read-marker.js
    apply-detector  │
          │    bookmark-tooltip
          ▼         ▼
    storage-helper.js (Local 저장)
          │
          ▼ (5초 디바운스)
    Google Drive appData (gzip 압축 동기화)
```

### 저장소 구조

| 계층 | 용도 | 키 패턴 |
|------|------|---------|
| **Local** (주 저장소) | 빠른 읽기/쓰기 | `jm:{siteId}:{jobId}` |
| **Google Drive** (동기화) | 기기 간 백업 | `job-memo-sync.json.gz` |

**충돌 해결**: 메모별 `updatedAt` 타임스탬프 비교 → 최신 데이터 보존

**삭제 동기화**: Tombstone 패턴 — 삭제된 메모를 30일간 추적하여 다른 기기에서도 삭제 반영

## 동기화 설정

Google Drive 동기화를 사용하려면 OAuth 클라이언트 설정이 필요합니다.

### 1. Google Cloud 프로젝트 설정

1. [Google Cloud Console](https://console.cloud.google.com/)에서 프로젝트 생성
2. **API 및 서비스 → 라이브러리** → Google Drive API 활성화
3. **OAuth 동의 화면** 설정 (외부, 테스트 사용자 추가)

### 2. OAuth 클라이언트 생성

1. **사용자 인증 정보 → OAuth 클라이언트 ID 만들기**
2. 애플리케이션 유형: **웹 애플리케이션**
3. 승인된 리디렉션 URI: `https://<확장프로그램ID>.chromiumapp.org/`
4. 발급된 client_id를 `manifest.json`의 `oauth2.client_id`에 입력

### 3. 사용

1. 팝업에서 **동기화 연결** 클릭
2. Google 계정 동의
3. 이후 자동 동기화 (메모 저장 시 5초 후 푸시, 팝업 열 때 자동 pull)

## 기술 스택

- **Manifest V3** — Chrome 최신 확장 프로그램 표준
- **Vanilla JS** — 프레임워크 없이 순수 JavaScript
- **Chrome Storage API** — `chrome.storage.local` (주 저장소)
- **Google Drive API** — appData 폴더 (동기화, 사용자 드라이브에 비노출)
- **CompressionStream API** — 브라우저 내장 gzip 압축/해제
- **MutationObserver** — SPA 라우팅 변경 및 동적 DOM 감지

## 기여

이슈와 PR을 환영합니다.

```bash
# 1. Fork & Clone
git clone https://github.com/<your-username>/job-posting-memo.git

# 2. 브랜치 생성
git checkout -b feature/my-feature

# 3. 변경 후 커밋
git commit -m "feat: 새로운 기능 설명"

# 4. PR 생성
git push origin feature/my-feature
```

### 새 사이트 추가하기

`site-registry.js`에 어댑터를 추가하면 새로운 채용 사이트를 지원할 수 있습니다:

```js
sites.wanted = {
  name: '사이트이름',
  color: '#000000',
  hostPatterns: ['www.example.com'],
  routingType: 'mpa',       // 'spa' | 'mpa'
  isDetailPage: (url) => /* URL이 상세 페이지인지 판별 */,
  extractJobId: (url) => /* URL에서 Job ID 추출 */,
  getJobUrl: (jobId) => /* Job ID로 URL 생성 */,
  getMemoTarget: () => /* 메모 UI를 삽입할 DOM 요소 반환 */,
  getMetadata: () => /* { positionName, companyName, employmentType } */,
  getJobCards: () => /* 목록 페이지의 공고 카드 요소 배열 */,
  extractJobIdFromCard: (card) => /* 카드에서 Job ID 추출 */,
};
```

## 라이선스

MIT License — 자유롭게 사용, 수정, 배포할 수 있습니다.
