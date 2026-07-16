# 교대달력 · 급여예측

## GitHub 업로드 구조

```text
index.html
gas_code.gs
README.md
data/
  holidays.json
  insurance.json
scripts/
  update_holidays.py
.github/
  workflows/
    update-holidays.yml
```

## 공휴일 자동 업데이트

설날과 추석은 양력 날짜를 직접 작성하지 않습니다.

GitHub Actions가 한국천문연구원 특일 정보 API에서 매주 공휴일을 조회하여
`data/holidays.json`을 자동 생성합니다. API 응답에 포함된 설날·추석 연휴 중
연속된 날짜의 가운데 날짜를 각각 음력 1월 1일, 음력 8월 15일 당일로 처리합니다.

### 최초 1회 설정

1. 공공데이터포털에서 `한국천문연구원_특일 정보` 활용 신청
2. 발급받은 일반 인증키를 복사
3. GitHub 저장소 → Settings → Secrets and variables → Actions
4. New repository secret
5. 이름: `DATA_GO_KR_SERVICE_KEY`
6. 값: 발급받은 인증키
7. 저장소 Actions → `공휴일 자동 업데이트` → Run workflow

이후 매주 월요일 오전 9시 15분(KST)에 자동 확인하고,
공휴일 데이터가 바뀐 경우에만 GitHub에 커밋합니다.

## 고정 예외 휴일

아래 날짜만 `customHolidays`로 유지됩니다.

- 2월 3일 노동조합 창립기념일
- 8월 2일 회사 창립기념일

앱 설정에서 사용 여부, 휴일수당 적용 여부, 날짜를 수정할 수 있습니다.
사용자 수정값은 localStorage가 우선 적용됩니다.

## GAS 백업

설정 → 구글 스프레드시트 + GAS 백업 → 사용법 보기를 따릅니다.

# 교대달력 PWA

## 저장소 구조

```text
index.html
manifest.webmanifest
service-worker.js
gas_code.gs
icons/
assets/
data/
scripts/
.github/workflows/
```

ZIP을 풀어 GitHub 저장소 루트에 같은 구조로 업로드합니다.

## 설치

- iPhone Safari: 공유 → 홈 화면에 추가
- Android Chrome: 앱 설치 또는 홈 화면에 추가
- 설정 화면의 `홈 화면에 앱 설치` 버튼도 사용할 수 있습니다.

## 공휴일 자동 갱신

Repository secret:

```text
DATA_GO_KR_SERVICE_KEY
```

Actions의 `공휴일 자동 업데이트`가 `data/holidays.json`을 갱신합니다.

## 서비스워커 캐시 변경

앱 구조가 크게 변경될 때는 `service-worker.js`의 `CACHE_VERSION`을
`shiftcalendar-pwa-v2`처럼 변경합니다.
