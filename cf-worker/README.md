# choihanmin-protected-files (Cloudflare Worker)

사이트의 비밀번호 잠금(증명자료 갤러리, 포트폴리오 PDF)은 지금까지 클라이언트
사이드 체크였습니다 — 비밀번호를 몰라도 `images/web/cert01.jpg` 같은 공개
URL을 직접 알면 누구나 파일을 받을 수 있었습니다. 이 Worker는 비밀번호를
**서버에서** 검증하고, 통과해야만 R2에 있는 실제 파일을 내려줍니다. 이걸
쓰려면 보호할 파일들을 공개 리포(`images/web/`, `files/`)에서 빼고 R2로
옮겨야 합니다 — 이 단계는 메인 사이트 쪽 코드를 바꾸는 **2단계**에서 함께
진행합니다. 이 Worker만 먼저 배포해도 사이트 동작은 바뀌지 않습니다.

## 1. R2 버킷 생성

```
wrangler login
wrangler r2 bucket create choihanmin-protected
```

## 2. 비밀(Secret) 등록

두 개의 비밀을 등록합니다 — 리포(`wrangler.toml`)에는 절대 들어가지 않습니다.

```
wrangler secret put SITE_PASSWORD
# 프롬프트에 현재 사이트 비밀번호 입력 (이 파일에는 절대 실제 값을 적지 말 것 —
# 공개 리포에 평문으로 남으면 서버 사이드 인증으로 바꾼 의미가 없어짐)

wrangler secret put TOKEN_SIGNING_KEY
# 아무 긴 무작위 문자열 입력 (토큰 서명 전용, 비밀번호와 다른 값으로)
# 예시로 생성하려면: openssl rand -base64 32
```

## 3. 파일 업로드

로컬에 이 리포를 클론한 상태에서, 저장소 루트에서:

```
bash cf-worker/upload-to-r2.sh
```

`files/portfolio-locked.pdf`와 `images/web/cert01.jpg`~`cert45.jpg`를
R2 버킷에 올립니다.

## 4. Worker 배포

```
cd cf-worker
wrangler deploy
```

## 5. 커스텀 도메인/라우트 연결

Cloudflare 대시보드 → Workers & Pages → `choihanmin-protected-files` →
Settings → Domains & Routes → Add → `api.choihanmin.com` 추가.
(choihanmin.com이 이미 Cloudflare에 연결되어 있어야 합니다. 아니라면
Porkbun에서 `api` 서브도메인을 Cloudflare로 향하도록 DNS를 먼저 설정하거나,
전체 도메인을 Cloudflare 네임서버로 옮겨야 합니다.)

## 6. 동작 확인

```
curl -X POST https://api.choihanmin.com/auth \
  -H 'Content-Type: application/json' \
  -d '{"password":"<실제 사이트 비밀번호>"}'
# {"token":"...","exp":...} 가 나오면 성공

curl "https://api.choihanmin.com/file/cert01.jpg?token=<위에서 받은 token>" -o test.jpg
# test.jpg가 실제 이미지면 성공
```

## 7. 완료되면 알려주세요

위 단계가 모두 끝나면 (R2 업로드 완료, Worker 배포 완료, `api.choihanmin.com`
연결 완료, curl 테스트 통과) 알려주시면, 사이트 쪽 코드(`index.html`)를 이
API를 쓰도록 바꾸고 공개 리포에서 민감 파일들을 제거하는 2단계 PR을
올리겠습니다.

## 참고: 선택적으로 추가하면 좋은 것

- Cloudflare 대시보드 → Security → WAF → Rate limiting rules 에서
  `/auth` 경로에 비밀번호 brute-force 방지용 요청 제한을 걸어두면 더 안전합니다
  (예: 같은 IP에서 1분에 5회 초과 시 차단).

## 비밀번호 교체(로테이션)

비밀번호가 어딘가(커밋, 캡처, 메시지 등)에 노출됐다고 판단되면 아래만 하면 됩니다
— Worker를 다시 배포할 필요는 없습니다, `secret put`은 즉시 반영됩니다.

```
cd cf-worker
wrangler secret put SITE_PASSWORD
# 프롬프트에 새 비밀번호 입력
```

새 비밀번호를 index.html의 비밀번호 입력창에 바로 테스트해보면 됩니다.
