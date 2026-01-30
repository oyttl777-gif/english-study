
export interface WordEntry {
  word: string;
  meaning: string;
}

export interface DailyRecord {
  date: string; // YYYY-MM-DD
  page: string;
  words: WordEntry[];
  newsContent?: string; // 영자신문 기록 내용
  isCompleted: boolean;
}

export interface TestResult {
  word: string;
  userSpelling: string;
  userMeaning: string;
  isCorrect: boolean;
  feedback: string;
}
