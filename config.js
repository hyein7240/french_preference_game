// 공개해도 되는 두 값만 입력합니다. 비밀번호나 secret/service_role 키는 넣지 마세요.
// 둘 다 비워 두면 체험 모드입니다. 자세한 순서는 docs/SETUP.md를 참고하세요.
window.BINOME_CONFIG = Object.freeze({
  supabaseUrl: "",
  supabaseKey: "", // sb_publishable_... 권장. 기존 anon JWT도 지원합니다.
  classCode: "",   // 선택: 특정 반 코드를 기본값으로 지정할 수 있습니다.
  pollIntervalMs: 10000
});
