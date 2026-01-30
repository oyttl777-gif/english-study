
import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export const scoreTest = async (
  originalWord: string,
  originalMeaning: string,
  userSpelling: string,
  userMeaning: string
) => {
  const prompt = `
    당신은 중학생의 영어 단어 테스트를 채점하는 친절한 AI 선생님입니다.
    
    [채점 기준]
    1. 영어 스펠링: 대소문자 구분 없이 글자가 정확히 일치해야 합니다. (완벽 일치 필수)
    2. 의미(뜻): 입력된 뜻이 원래의 뜻과 유의어이거나 문맥상 같은 의미라면 정답으로 처리합니다.
       - 예: 원래 뜻이 '뛰다'인데 학생이 '달리다'라고 적으면 정답(isCorrect: true)입니다.
       - 예: 원래 뜻이 '행복한'인데 학생이 '기쁜'이라고 적으면 정답입니다.
       - 예: 원래 뜻과 전혀 상관없는 뜻이면 오답입니다.

    [대상 데이터]
    - 목표 단어: "${originalWord}"
    - 목표 의미: "${originalMeaning}"
    - 학생이 쓴 스펠링: "${userSpelling}"
    - 학생이 쓴 의미: "${userMeaning}"

    결과는 반드시 아래의 JSON 형식으로만 답변하세요.
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            isCorrect: { type: Type.BOOLEAN },
            feedback: { type: Type.STRING, description: "정답 여부에 따른 짧고 격려 섞인 한국어 피드백 (예: '의미가 아주 잘 통하네요! 정답입니다.')" }
          },
          required: ["isCorrect", "feedback"]
        }
      }
    });

    return JSON.parse(response.text);
  } catch (error) {
    console.error("AI Scoring Error:", error);
    const spellingMatch = originalWord.toLowerCase().trim() === userSpelling.toLowerCase().trim();
    const meaningMatch = originalMeaning.trim() === userMeaning.trim();
    return {
      isCorrect: spellingMatch && meaningMatch,
      feedback: spellingMatch && meaningMatch ? "완벽합니다!" : `아쉬워요. 정답은 ${originalWord}: ${originalMeaning} 입니다.`
    };
  }
};
