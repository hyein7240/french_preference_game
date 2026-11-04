// 보기의 순서와 원문은 수업 자료에 맞춰 유지했습니다. 한 문항당 하나를 고릅니다.
export const QUESTIONS = Object.freeze([
  {
    id: "q1", verb: "adorer", short: "좋아하는 것", title: "Mon/Ma binôme adore…",
    ko: "내 짝은 이걸 좋아해요…", ask: "Qu’est-ce que tu adores ?", answer: "J’adore",
    options: [
      { fr: "le cinéma", ko: "영화" },
      { fr: "les chansons coréennes", ko: "한국 노래" },
      { fr: "le foot", ko: "축구" },
      { fr: "la comédie musicale", ko: "뮤지컬" }
    ]
  },
  {
    id: "q2", verb: "aimer", short: "좋아하는 과목", title: "Comme matière, mon/ma binôme aime…",
    ko: "내 짝은 이 과목을 좋아해요…", ask: "Qu’est-ce que tu aimes comme matière ?",
    answer: "J’aime", suffix: "comme matière.",
    options: [
      { fr: "le français", ko: "프랑스어" },
      { fr: "les maths", ko: "수학" },
      { fr: "l’éducation physique", ko: "체육" },
      { fr: "le coréen", ko: "국어" }
    ]
  },
  {
    id: "q3", verb: "préférer", short: "더 나은 선택", title: "Mon/Ma binôme préfère…",
    ko: "내 짝은 이걸 선호해요…", ask: "Qu’est-ce que tu préfères ?", answer: "Je préfère",
    options: [
      { fr: "Passer un examen tous les lundis", ko: "매주 월요일마다 시험 보기" },
      { fr: "Danser devant toute l’école tous les vendredis", ko: "매주 금요일마다 전교생 앞에서 춤추기" }
    ]
  },
  {
    id: "q4", verb: "ne pas aimer", short: "좋아하지 않는 것", title: "Mon/Ma binôme n’aime pas…",
    ko: "내 짝은 이걸 좋아하지 않아요…", ask: "Qu’est-ce que tu n’aimes pas ?", answer: "Je n’aime pas",
    options: [
      { fr: "Une classe sans climatisation en plein été", ko: "한여름 에어컨 없는 교실" },
      { fr: "Une classe sans chauffage en plein hiver", ko: "한겨울 히터 없는 교실" }
    ]
  },
  {
    id: "q5", verb: "détester", short: "싫어하는 것", title: "Mon/Ma binôme déteste…",
    ko: "내 짝은 이걸 싫어해요…", ask: "Qu’est-ce que tu détestes ?", answer: "Je déteste",
    options: [
      { fr: "Rendre publics tous mes DM", ko: "모든 DM 공개하기" },
      { fr: "Rendre public tout mon historique de recherche", ko: "모든 검색 기록 공개하기" }
    ]
  }
]);
export const LETTERS = ["A", "B", "C", "D"];
