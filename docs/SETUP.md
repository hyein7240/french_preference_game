# Binôme 설치·배포 안내

이 프로젝트는 **GitHub Pages에 화면을 배포하고 Supabase에 이름과 답변을 저장**합니다. GitHub Pages 자체는 학생 응답을 저장하는 DB가 아니므로 두 서비스를 연결해야 합니다. 학생은 로그인하지 않고 반 코드로 참여하며, 교사만 이메일과 비밀번호로 로그인합니다.

## 1. 화면부터 확인하기

압축을 푼 폴더의 `DEMO.html`을 더블클릭합니다. 예시 8명이 들어 있는 체험 화면입니다. 이름을 추가하고 다섯 답을 제출해 보거나, 교사 공간의 **체험 반 관리하기**를 눌러 반 생성과 관리를 확인할 수 있습니다.

실제 학생들의 공동 DB와 연결되는 배포용 파일은 `index.html`입니다. `DEMO.html`은 항상 체험 모드로 동작하며 `config.js`를 변경해도 실제 DB에 연결되지 않습니다.

## 2. Supabase 프로젝트 만들기

1. [Supabase](https://supabase.com/)에 로그인하고 새 프로젝트를 만듭니다.
2. DB 비밀번호 등 프로젝트 생성에 필요한 값을 설정하고, 프로젝트 준비가 끝날 때까지 기다립니다.
3. 프로젝트의 **SQL Editor**에서 새 쿼리를 엽니다.
4. `db/schema.sql`의 내용을 전부 붙여 넣고 **Run**을 누릅니다.
5. 오류 없이 완료되는지 확인합니다.

전용 비공개 스키마 `binome_private`에 테이블을 만들고, 공개 스키마 `public`에는 검증된 요청만 처리하는 `binome_...` 함수를 만듭니다. Data API가 활성화되어 있고 **public 스키마가 노출 대상**이어야 합니다. `binome_private`를 노출 대상에 추가하지 마세요. 별도의 Realtime 설정은 필요하지 않습니다.

## 3. 교사 로그인 계정과 권한 준비

1. Supabase의 **Authentication → Users**로 이동합니다.
2. **Add user → Create new user**에서 교사의 이메일과 비밀번호를 입력합니다. 이메일을 즉시 확인 상태로 만드는 **Auto Confirm User** 항목이 있으면 켭니다. 이 프로젝트에는 회원가입 화면이 없습니다.
3. SQL Editor에서 `db/allow-teacher.sql.example`을 엽니다.
4. `teacher@example.com`을 방금 만든 교사 이메일로 바꿔 실행합니다.
5. 마지막 조회 결과에 해당 교사 이메일이 **한 행** 나타나는지 확인합니다.

인증 계정만 만들고 4번 권한 등록을 생략하면 로그인 후 반을 만들 수 없습니다. 여러 교사는 같은 방법으로 각각 등록할 수 있고, 각 교사에게는 자신이 만든 반만 보입니다. 수업용 전용 프로젝트라면 Authentication의 사용자 신규 가입 허용 옵션을 꺼 둘 수 있습니다.

교사 비밀번호를 잊었다면 Supabase 관리자 화면에서 계정을 관리하세요. 이 사이트에는 비밀번호 재설정 메일 기능을 넣지 않았습니다.

## 4. `config.js` 수정

Supabase 프로젝트의 **Connect** 또는 프로젝트 설정의 **API Keys / Data API** 화면에서 프로젝트 URL과 **Publishable key**를 확인합니다. 대시보드 버전에 따라 메뉴 이름이 다를 수 있습니다.

```js
window.BINOME_CONFIG = Object.freeze({
  supabaseUrl: "https://여기에프로젝트ID.supabase.co",
  supabaseKey: "sb_publishable_여기에공개키",
  classCode: "",
  pollIntervalMs: 10000
});
```

| 설정 | 입력값 |
| --- | --- |
| `supabaseUrl` | 프로젝트의 HTTPS URL. `/rest/v1` 등 경로는 붙이지 않습니다. |
| `supabaseKey` | 브라우저용 Publishable key. 기존 프로젝트의 `anon` JWT 키도 지원합니다. |
| `classCode` | 비워 둡니다. 반을 만든 뒤 특정 반 코드를 기본값으로 넣을 수도 있습니다. |
| `pollIntervalMs` | 기본 10000 = 10초. 최소 5000ms로 제한됩니다. |

이 두 설정값은 공개 웹사이트에 포함됩니다. **Secret key, service_role 키, DB 비밀번호, 교사 비밀번호는 여기에 넣지 않습니다.** 공개 키는 프로젝트를 식별하고, 실제 접근은 DB 함수에서 반 코드·교사 권한·응답 편집 토큰으로 제한합니다.

두 값을 모두 비우면 체험 모드입니다. 한 값만 넣으면 설정 오류를 표시합니다. 실제 연결에 실패했을 때 체험 데이터로 바꾸지 않습니다.

## 5. GitHub에 올리기

1. GitHub에서 새 저장소를 만듭니다. 예: `binome-francais`.
2. 압축을 푼 `binome` 폴더의 **내용물**을 저장소 루트에 올립니다.
3. 최상위에 `index.html`, `config.js`, `styles.css`, `js/`, `assets/`가 보이는지 확인합니다.
4. `assets/fonts/`의 폰트 두 파일과 `OFL.txt`도 함께 업로드합니다.
5. 변경 사항을 `main` 브랜치에 커밋합니다.

실제 학생 응답은 Supabase에 저장되므로 저장소에 CSV나 학생 응답 파일을 올릴 필요가 없습니다.

### 방법 A. 브랜치에서 바로 배포

설치 명령 없이 화면 파일을 그대로 배포하는 방법입니다.

1. 자동 배포 워크플로를 사용하지 않을 예정이라면 `.github/workflows/pages.yml`은 올리지 않습니다.
2. 저장소의 **Settings → Pages**로 이동합니다.
3. **Source: Deploy from a branch**를 선택합니다.
4. **Branch: main**, **폴더: /(root)**를 선택하고 저장합니다.
5. 배포가 끝나면 표시되는 `https://사용자이름.github.io/저장소이름/` 주소를 엽니다.

### 방법 B. 테스트 후 자동 배포

권장 방식입니다. `.github/workflows/pages.yml`까지 저장소에 포함하세요. 숨김 폴더가 업로드에서 빠졌다면 GitHub의 **Add file → Create new file**에서 `.github/workflows/pages.yml` 경로를 만들고 제공된 파일 내용을 붙여 넣을 수 있습니다.

1. 저장소의 **Settings → Pages → Source**를 **GitHub Actions**로 설정합니다.
2. **Actions** 탭의 **Deploy Binome to GitHub Pages** 워크플로를 선택합니다.
3. 최초 커밋이 이미 끝났다면 **Run workflow**를 누릅니다. 이후에는 `main`에 커밋할 때 자동 실행됩니다.
4. 테스트 → 정적 파일 준비 → Pages 배포 단계가 모두 성공하는지 확인합니다.
5. Pages에 표시되는 사이트 주소를 엽니다.

웹 배포 결과에는 `index.html`, CSS, JS, 설정 파일, 로고와 폰트만 포함됩니다. 두 배포 방법 중 하나를 사용하세요. 저장소 공개 범위에 따라 GitHub Pages 사용 조건은 GitHub의 현재 안내를 확인하세요.

## 6. 첫 반 만들기

1. 배포된 사이트의 **교사 공간**을 엽니다.
2. 등록한 교사 이메일과 비밀번호로 로그인합니다.
3. 예: **1학년 3반 · 프랑스어**로 반 이름을 정합니다.
4. 참여 기간을 **1일 / 7일 / 30일** 중 고르고 **반 코드 만들기**를 누릅니다.
5. **코드 복사** 또는 **참여 링크 복사**를 눌러 학생들에게 공유합니다.

참여 링크에는 `?classe=반코드`가 들어 있으므로 학생이 코드를 직접 입력하지 않아도 됩니다. 학생 이름·답변은 링크에 들어 있지 않습니다. 반 코드를 아는 사람은 해당 반의 결과를 볼 수 있으므로 학급 안에서 공유하세요.

## 7. 배포 후 두 기기로 점검

1. 교사 기기와 학생용 휴대전화에서 같은 참여 링크를 엽니다.
2. 휴대전화에서 `테스트 학생1`이라는 짝 이름을 등록합니다. 제출 전에는 교사 대시보드의 완료 인원과 그래프가 늘어나지 않아야 합니다.
3. 다섯 답을 고르고 최종 **제출하기**를 누릅니다.
4. 교사 기기에서 **새로고침**을 눌러 같은 응답이 보이는지 확인합니다.
5. 다른 기기에서 `테스트 학생2` 응답도 제출합니다.
6. 대시보드에서 각 이름을 골라 친구가 연결되는지 확인합니다.
7. 첫 기기의 홈에서 **기록한 응답 수정**을 열어 답 하나를 바꾸고 제출합니다. 제출 인원은 그대로이고 그래프만 바뀌어야 합니다.
8. 교사 공간에서 제출을 마감한 뒤 새 제출이 차단되는지 확인합니다. 이미 조회한 결과는 계속 볼 수 있습니다.
9. 교사 대시보드의 **학생 응답 관리**에서 테스트 응답을 지웁니다.
10. 휴대전화 세로 화면과 데스크톱에서 보기·긴 문장이 잘 읽히는지 확인합니다.

DB 함수 자체를 확인하려면 교사 권한 등록 후 SQL Editor에서 `db/verify.sql`을 실행하세요. 검증용 반과 응답을 임시로 만들고 끝에 롤백하므로 기존 반과 응답은 수정하지 않습니다. 이 스크립트가 성공해도 실제 기기와 네트워크를 통한 위 점검은 별도로 진행하세요.

## 문제 해결

| 증상 | 확인할 사항 |
| --- | --- |
| 체험 모드 표시가 계속 나옴 | 배포된 `config.js`에 두 값을 모두 넣었는지 확인하고 강력 새로고침합니다. `DEMO.html`은 항상 체험 모드입니다. |
| 폰트/JS가 로드되지 않음 | `assets/`, `js/` 폴더와 대소문자가 유지됐는지, `index.html`이 루트에 있는지 확인합니다. |
| DB 함수가 준비되지 않았다는 메시지 | `db/schema.sql` 전체 실행, Data API 활성화, public 노출 여부를 확인합니다. 잠시 뒤 다시 조회합니다. |
| 로그인했지만 교사 권한 없음 | Auth 계정과 `binome_private.teachers`에 같은 UUID가 등록되어 있는지 확인합니다. |
| 이메일 미확인으로 로그인 실패 | Supabase Auth의 교사 계정을 확인 상태로 설정합니다. |
| 이미 등록된 이름 | 원래 작성한 기기에서 수정하거나, 동명이인은 이름에 번호를 붙입니다. 잘못 선점한 이름은 교사가 응답 관리에서 지웁니다. |
| 다른 기기에 응답이 안 보임 | 체험 모드인지, 두 기기의 반 코드와 Supabase 프로젝트가 같은지 확인합니다. 최종 제출 후 조회해야 합니다. |
| 제출 실패/인터넷 오류 | 답변을 유지한 상태에서 같은 제출 버튼을 다시 누릅니다. 중복 응답은 생성되지 않습니다. |
| 수정 권한을 잃음 | 브라우저 저장 공간을 지웠거나 다른 기기라면 원래 편집 토큰을 되찾을 수 없습니다. 교사가 기존 응답을 삭제한 뒤 다시 등록합니다. |
| 기간 종료 | 해당 활동은 교사만 확인할 수 있습니다. 새 반을 만들어 새 참여 링크를 공유합니다. |

## 확인한 공식 자료

- [Supabase 공개 키와 비밀 키](https://supabase.com/docs/guides/getting-started/api-keys)
- [Supabase Database Functions와 실행 권한](https://supabase.com/docs/guides/database/functions)
- [Supabase Data API 보안](https://supabase.com/docs/guides/api/securing-your-api)
- [Supabase 비밀번호 로그인](https://supabase.com/docs/guides/auth/passwords)
- [GitHub Pages 배포 소스 설정](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
- [GitHub 공식 정적 사이트 워크플로](https://github.com/actions/starter-workflows/blob/main/pages/static.yml)
- [Pretendard 원본](https://github.com/orioncactus/pretendard/tree/v1.3.9)
