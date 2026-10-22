/**
 * korean-nlp.js
 * 브라우저 환경에서 동작하는 한국어 텍스트마이닝 & 형태소 정제 파이프라인
 */

// 1. 한국어 조사 목록 (최장 일치 탐색을 위해 글자 수가 긴 조사부터 정렬)
const KOREAN_JOSA_LIST = [
  '으로부터', '로부터', '에서부터', '에게서', '한테서', '이라도', '라고는', '이라고는',
  '에서는', '에게는', '한테는', '으로는', '로서는', '로서의', '으로써', '로써',
  '이라서', '이라며', '이라든', '이라는', '이라고', '이나마', '이지만', '에서도',
  '에서', '에게', '한테', '으로', '보다', '처럼', '만큼', '같이', '까지', '부터',
  '마저', '조차', '밖에', '대로', '이라', '이고', '이며', '이나', '이든', '마다',
  '은', '는', '이', '가', '을', '를', '의', '에', '로', '와', '과', '도', '만', '랑'
];

// 2. 어미/용언 정규화 패턴
const KOREAN_VERB_ENDINGS = [
  /(하|되)(였|었|았)?(습니다|ㅂ니다|어요|아요|네요|군요|여서|어서|아서|고|며|는데|지만|기|는|던|할|한|면)$/u,
  /(습|ㅂ)니다$/u,
  /(었|았|였)(어요|습니다|네요|군요|다|고|는데|지만)$/u,
  /(어요|아요|해요|네요|군요|여서|어서|아서|기에|하기|하는|했던|할수|할 수|이면|으면|는다)$/u
];

// 3. 기본 불용어 (연수/강의 상투어, 대명사, 의존명사, 부사 등)
export const DEFAULT_STOPWORDS = new Set([
  '것', '수', '등', '점', '부분', '생각', '경우', '정도', '이번', '오늘', '시간',
  '매우', '너무', '정말', '진짜', '아주', '조금', '많이', '약간', '가장', '더욱',
  '통해', '대한', '위한', '관한', '같은', '있어', '있는', '없는', '하는', '되는',
  '같습니다', '있었습니다', '좋겠습니다', '감사합니다', '선생님', '강사님', '연수',
  '강의', '내용', '대해', '어떤', '이런', '저런', '모든', '다시', '직접', '계속', '우리'
]);

// 4. 복합명사 정규화 맵 (띄어쓰기 편차 통일)
const COMPOUND_NOUN_MAP = {
  '인공 지능': '인공지능',
  '생성 형': '생성형',
  '에듀 테크': '에듀테크',
  '수업 실천': '수업실천',
  '역량 강화': '역량강화',
  '학생 참여': '학생참여',
  '질문 중심': '질문중심',
  '교수 학습': '교수학습',
  '의견 수렴': '의견수렴'
};

export class KoreanTextMiner {
  constructor(customStopwords = []) {
    this.stopwords = new Set([...DEFAULT_STOPWORDS, ...customStopwords]);
  }

  addStopword(word) {
    if (word && word.trim()) {
      this.stopwords.add(word.trim());
    }
  }

  removeStopword(word) {
    if (word) {
      this.stopwords.delete(word.trim());
    }
  }

  /**
   * 텍스트 정규화: 특수문자, 초성/자모 반복 제거
   */
  normalizeText(text) {
    if (!text) return '';
    let cleaned = text;

    for (const [pattern, replacement] of Object.entries(COMPOUND_NOUN_MAP)) {
      cleaned = cleaned.replaceAll(pattern, replacement);
    }

    return cleaned
      .replace(/[ㄱ-ㅎㅏ-ㅣ]+/g, ' ')
      .replace(/[^\w\s가-힣]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * 단어 단위 최장일치 조사 및 어미 제거
   */
  stemWord(word) {
    let term = word.trim();
    if (term.length <= 1) return term;

    for (const josa of KOREAN_JOSA_LIST) {
      if (term.length > josa.length + 1 && term.endsWith(josa)) {
        term = term.slice(0, -josa.length);
        break;
      }
    }

    for (const pattern of KOREAN_VERB_ENDINGS) {
      if (pattern.test(term)) {
        term = term.replace(pattern, '$1');
        break;
      }
    }

    return term.trim();
  }

  /**
   * 문장에서 유효 키워드 추출
   */
  extractKeywords(sentence) {
    const normalized = this.normalizeText(sentence);
    const tokens = normalized.split(/\s+/);
    const keywords = [];

    for (const token of tokens) {
      if (!token || token.length <= 1) continue;
      const stemmed = this.stemWord(token);

      if (stemmed.length >= 2 && !this.stopwords.has(stemmed) && !/^\d+$/.test(stemmed)) {
        keywords.push(stemmed);
      }
    }

    return keywords;
  }

  /**
   * 전체 응답 목록을 분석하여 워드클라우드용 데이터 및 역색인 맵 생성
   */
  analyzeResponses(responses) {
    const freqMap = new Map();
    const keywordMap = new Map();
    let totalWords = 0;

    for (const resp of responses) {
      if (!resp.text) continue;
      const keywords = this.extractKeywords(resp.text);
      const uniqueKeywordsInDoc = new Set(keywords);

      for (const kw of keywords) {
        freqMap.set(kw, (freqMap.get(kw) || 0) + 1);
        totalWords++;
      }

      for (const kw of uniqueKeywordsInDoc) {
        if (!keywordMap.has(kw)) {
          keywordMap.set(kw, []);
        }
        keywordMap.get(kw).push(resp.id);
      }
    }

    const sortedFrequencies = Array.from(freqMap.entries())
      .sort((a, b) => b[1] - a[1]);

    return {
      frequencies: sortedFrequencies,
      keywordMap: keywordMap,
      totalWords: totalWords
    };
  }
}
