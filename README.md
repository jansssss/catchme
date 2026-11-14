# 캐치미 (CatchMe)

원하는 가격·이평선에 도달하면 휴대폰으로 알려 주는 주가 알림 PWA.
매매 기능은 없고, 알림만 보냅니다.

## 기능

- 종목 검색 후 관심 목록에 추가 (코스피·코스닥, 네이버 금융 시세)
- 160 · 200 · 224일 이동평균선과 현재가를 사다리 형태로 표시
- 알림 4종
  - 🎯 **가격**: 지정가 이상/이하 도달 (1회 울리고 꺼짐)
  - 🚨 **손절**: 매수가 대비 -N% 가격 이하 (1회 울리고 꺼짐)
  - 🔔 **이평선 도달**: 현재가가 이평선 ±1% 이내로 진입하거나 돌파/이탈할 때
  - 🟢 **바닥 신호**: 현재가 < 160일선 < 224일선(역배열) + 두 선의 공백이 기준(3/5/7/10%) 이상 + 최근 20일 횡보
- 웹 푸시 알림 (앱을 닫아 두어도 수신)

## 구성

| 항목 | 사용 |
|---|---|
| 프레임워크 | Next.js (App Router) |
| DB | Neon Postgres — 테이블은 첫 요청 때 자동 생성 (`lib/db.ts`) |
| 푸시 | Web Push (VAPID) + 서비스 워커 (`public/sw.js`) |
| 주기 확인 | GitHub Actions가 장중 5분마다 `/api/cron` 호출 (`.github/workflows/price-check.yml`) |
| 배포 | Vercel (서울 리전 `icn1`) |

## 환경변수

`.env.example` 참고.

| 이름 | 설명 |
|---|---|
| `DATABASE_URL` | Neon 연결 문자열 |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | `npx web-push generate-vapid-keys` |
| `VAPID_SUBJECT` | `mailto:본인이메일` |
| `APP_PIN` | 앱 잠금 비밀번호 (비우면 잠금 없음) |
| `CRON_SECRET` | `/api/cron` 호출용 비밀키 |

GitHub 저장소 Secrets: `APP_URL`(배포 주소, 끝에 `/` 없이), `CRON_SECRET`.

## 로컬 실행

```bash
npm install
npm run dev
```

`DATABASE_URL`이 없으면 개발 모드에서는 내장 Postgres(PGlite, `./.pglite`)를 사용합니다.

## 휴대폰 설치

- **안드로이드(Chrome)**: 배포 주소 접속 → 메뉴 → 홈 화면에 추가 → "알림 켜기"
- **아이폰(Safari, iOS 16.4+)**: 공유 → 홈 화면에 추가 → 홈 화면 아이콘으로 실행 → "알림 켜기"
