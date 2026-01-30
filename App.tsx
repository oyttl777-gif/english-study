
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { WordEntry, DailyRecord, TestResult } from './types';
import { scoreTest } from './services/geminiService';
import { 
  CalendarIcon, 
  PencilSquareIcon, 
  CheckCircleIcon, 
  ArrowPathIcon,
  SpeakerWaveIcon,
  AcademicCapIcon,
  BookOpenIcon,
  SparklesIcon,
  NewspaperIcon,
  MicrophoneIcon,
  StopIcon,
  PlayIcon,
  CloudArrowDownIcon,
  ExclamationCircleIcon,
  Cog6ToothIcon,
  ClockIcon
} from '@heroicons/react/24/outline';

const DEFAULT_GAS_URL = "https://script.google.com/macros/s/AKfycbwqJNte9iEsNvW_5CWwyxkdxYazw7nTQ_cH2W0GYQwqDDWFSReQII1xLXwXNSoxOfuGIA/exec";

const getTodayString = () => {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().split('T')[0];
};

const formatTime = (seconds: number) => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'study' | 'test' | 'record' | 'settings'>('study');
  const [gasUrl, setGasUrl] = useState<string>(DEFAULT_GAS_URL);
  const [testMode, setTestMode] = useState<'none' | 'today' | 'cumulative'>('none');
  const [todayRecord, setTodayRecord] = useState<DailyRecord>({
    date: getTodayString(),
    page: '',
    words: Array(13).fill({ word: '', meaning: '' }),
    newsContent: '',
    isCompleted: false,
  });
  const [history, setHistory] = useState<DailyRecord[]>([]);
  const [sheetWords, setSheetWords] = useState<WordEntry[]>([]);
  const [isLoadingSheet, setIsLoadingSheet] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  
  const [testWords, setTestWords] = useState<WordEntry[]>([]);
  const [testStep, setTestStep] = useState(0);
  const [testResults, setTestResults] = useState<TestResult[]>([]);
  const [currentTestInput, setCurrentTestInput] = useState({ spelling: '', meaning: '' });
  const [isScoring, setIsScoring] = useState(false);

  // Recording states
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerIntervalRef = useRef<number | null>(null);

  const calendarData = useMemo(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const lastDate = new Date(year, month + 1, 0).getDate();
    const days = [];
    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let i = 1; i <= lastDate; i++) {
      days.push({
        day: i,
        dateStr: `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`
      });
    }
    return { days, month: month + 1, year };
  }, []);

  const fetchSheetData = async (targetUrl: string = gasUrl) => {
    if (!targetUrl || !targetUrl.startsWith('https://')) return;
    setIsLoadingSheet(true);
    setLoadError(null);
    try {
      const url = `${targetUrl}?action=read&t=${Date.now()}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Status: ${response.status}`);
      const rawData = await response.json();
      const dataArray = Array.isArray(rawData) ? rawData : (rawData.data || []);

      if (dataArray.length > 0) {
        const parsedWords: WordEntry[] = dataArray
          .slice(1) // 헤더 제외
          .map((item: any) => ({
            word: String(Array.isArray(item) ? item[2] : (item.영어단어 || item.word || "")).trim(),
            meaning: String(Array.isArray(item) ? item[3] : (item.의미 || item.meaning || "")).trim()
          }))
          .filter(w => w.word.length > 0 && w.meaning.length > 0);
        
        const uniqueMap = new Map();
        parsedWords.forEach(w => uniqueMap.set(w.word.toLowerCase(), w));
        setSheetWords(Array.from(uniqueMap.values()));
      }
    } catch (error: any) {
      setLoadError("데이터 동기화 실패. URL을 확인하세요.");
    } finally {
      setIsLoadingSheet(false);
    }
  };

  useEffect(() => {
    const savedUrl = localStorage.getItem('study_gas_url') || DEFAULT_GAS_URL;
    setGasUrl(savedUrl);
    fetchSheetData(savedUrl);

    const savedHistory = localStorage.getItem('study_history');
    if (savedHistory) {
      const parsed = JSON.parse(savedHistory);
      setHistory(parsed);
      loadRecordForDate(todayRecord.date, parsed);
    }
  }, []);

  const loadRecordForDate = (dateStr: string, currentHistory: DailyRecord[]) => {
    const existing = currentHistory.find(r => r.date === dateStr);
    if (existing) {
      const paddedWords = [...existing.words];
      while (paddedWords.length < 13) paddedWords.push({ word: '', meaning: '' });
      setTodayRecord({ ...existing, words: paddedWords });
    } else {
      setTodayRecord({
        date: dateStr,
        page: '',
        words: Array(13).fill({ word: '', meaning: '' }),
        newsContent: '',
        isCompleted: false,
      });
    }
  };

  const handleDateChange = (newDate: string) => {
    loadRecordForDate(newDate, history);
  };

  const handleWordChange = (index: number, field: keyof WordEntry, value: string) => {
    const newWords = [...todayRecord.words];
    newWords[index] = { ...newWords[index], [field]: value };
    setTodayRecord({ ...todayRecord, words: newWords });
  };

  const submitStudy = async () => {
    const filledWords = todayRecord.words.filter(w => w.word.trim() !== "");
    if (filledWords.length === 0) {
      alert("단어를 하나 이상 입력해주세요!");
      return;
    }

    const updatedRecord = { ...todayRecord, isCompleted: true };
    const newHistory = [...history.filter(r => r.date !== todayRecord.date), updatedRecord];
    setHistory(newHistory);
    localStorage.setItem('study_history', JSON.stringify(newHistory));
    
    const payload = {
      action: "insert",
      date: todayRecord.date,
      page: todayRecord.page,
      news: todayRecord.newsContent || "",
      status: "학습완료",
      words: filledWords
    };

    try {
      await fetch(gasUrl, {
        method: "POST",
        mode: "no-cors",
        body: JSON.stringify(payload),
      });
      alert('시트로 저장되었습니다!');
      setTimeout(() => fetchSheetData(gasUrl), 2000);
    } catch (e) {
      alert('시트 전송에 실패했습니다.');
    }
  };

  const startTest = async (mode: 'today' | 'cumulative') => {
    let sourceWords: WordEntry[] = [];
    if (mode === 'today') {
      sourceWords = todayRecord.words.filter(w => w.word.trim() !== "" && w.meaning.trim() !== "");
    } else {
      sourceWords = sheetWords.length > 0 ? sheetWords : history.flatMap(h => h.words).filter(w => w.word.trim() !== "");
    }

    if (sourceWords.length === 0) {
      alert('테스트할 단어가 없습니다.');
      return;
    }

    const shuffled = [...sourceWords].sort(() => 0.5 - Math.random());
    setTestWords(mode === 'today' ? shuffled : shuffled.slice(0, 5));
    setTestStep(0);
    setTestResults([]);
    setCurrentTestInput({ spelling: '', meaning: '' });
    setTestMode(mode);
    setActiveTab('test');
  };

  const handleNextTest = async () => {
    if (isScoring) return;
    setIsScoring(true);
    const target = testWords[testStep];
    const score = await scoreTest(target.word, target.meaning, currentTestInput.spelling, currentTestInput.meaning);
    setTestResults([...testResults, { ...target, userSpelling: currentTestInput.spelling, userMeaning: currentTestInput.meaning, isCorrect: score.isCorrect, feedback: score.feedback }]);
    setIsScoring(false);
    if (testStep < testWords.length - 1) {
      setTestStep(testStep + 1);
      setCurrentTestInput({ spelling: '', meaning: '' });
    }
  };

  // Recording Logic
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      setRecordingTime(0);
      setAudioUrl(null);

      mediaRecorder.ondataavailable = (e) => audioChunksRef.current.push(e.data);
      mediaRecorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: 'audio/wav' });
        setAudioUrl(URL.createObjectURL(blob));
      };
      
      mediaRecorder.start();
      setIsRecording(true);
      
      timerIntervalRef.current = window.setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
    } catch (err) { 
      alert("마이크 권한을 허용해주세요."); 
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      mediaRecorderRef.current.stream.getTracks().forEach(t => t.stop());
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
    }
  };

  return (
    <div className="min-h-screen pb-24 max-w-2xl mx-auto p-4 flex flex-col gap-6">
      <header className="flex flex-col gap-1 items-center py-6 bg-white rounded-3xl shadow-sm border border-slate-100 relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-500 to-purple-500" />
        <div className="absolute top-4 right-4 flex items-center gap-2">
            <div className={`flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full ${loadError ? 'bg-red-50 text-red-500' : 'bg-green-50 text-green-600'}`}>
                {loadError ? <ExclamationCircleIcon className="w-3 h-3" /> : <div className="w-1.5 h-1.5 bg-green-500 rounded-full" />}
                {sheetWords.length}단어 누적
            </div>
            <button onClick={() => fetchSheetData()} className={`p-1.5 rounded-full hover:bg-slate-100 ${isLoadingSheet ? 'animate-spin' : ''}`}>
                <CloudArrowDownIcon className="w-5 h-5 text-indigo-400" />
            </button>
        </div>
        <h1 className="text-2xl font-bold text-indigo-600 flex items-center gap-2">
          <AcademicCapIcon className="w-8 h-8" /> 중학생 영어 기록장
        </h1>
      </header>

      <nav className="flex bg-white p-1 rounded-2xl shadow-sm border border-slate-100 sticky top-4 z-50">
        {[
          { id: 'study', icon: PencilSquareIcon, label: '기록' },
          { id: 'test', icon: ArrowPathIcon, label: '테스트' },
          { id: 'record', icon: MicrophoneIcon, label: '발음' },
          { id: 'settings', icon: Cog6ToothIcon, label: '설정' }
        ].map(tab => (
          <button key={tab.id} onClick={() => { setActiveTab(tab.id as any); setTestMode('none'); }} className={`flex-1 flex flex-col items-center py-3 rounded-xl transition-all ${activeTab === tab.id ? 'bg-indigo-50 text-indigo-600 shadow-inner' : 'text-slate-400'}`}>
            <tab.icon className="w-6 h-6" />
            <span className="text-[10px] mt-1 font-bold">{tab.label}</span>
          </button>
        ))}
      </nav>

      <main className="flex-1">
        {activeTab === 'study' && (
          <div className="flex flex-col gap-6 animate-fadeIn">
            <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100 space-y-4">
               <div className="flex justify-between items-center border-b border-slate-50 pb-4">
                 <h2 className="text-lg font-bold text-slate-800">기본 정보</h2>
                 <span className={`px-4 py-1 rounded-full text-[11px] font-bold ${todayRecord.isCompleted ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                    {todayRecord.isCompleted ? '학습완료' : '기록중'}
                 </span>
               </div>
               <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase">날짜</label>
                    <input type="date" value={todayRecord.date} onChange={(e) => handleDateChange(e.target.value)} className="w-full bg-slate-50 border border-slate-100 rounded-lg px-2 py-2 text-sm font-bold text-slate-700 outline-none" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase">페이지 범위</label>
                    <input type="text" placeholder="예: 10-15" disabled={todayRecord.isCompleted} value={todayRecord.page} onChange={(e) => setTodayRecord({...todayRecord, page: e.target.value})} className="w-full bg-slate-50 border border-slate-100 rounded-lg px-2 py-2 text-sm outline-none" />
                  </div>
               </div>
            </div>

            <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100 space-y-3">
              <h3 className="font-bold text-slate-700 flex items-center gap-2"><NewspaperIcon className="w-5 h-5 text-indigo-500" />영자신문 읽기</h3>
              <textarea placeholder="뉴스 내용을 간단히 적어보세요..." disabled={todayRecord.isCompleted} value={todayRecord.newsContent} onChange={(e) => setTodayRecord({...todayRecord, newsContent: e.target.value})} className="w-full bg-slate-50 border border-slate-100 rounded-xl px-4 py-3 text-sm min-h-[80px] outline-none" />
            </div>

            <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100 space-y-3">
              <h3 className="font-bold text-slate-700">오늘의 단어 (13개)</h3>
              <div className="grid grid-cols-1 gap-2">
                {todayRecord.words.map((w, idx) => (
                  <div key={idx} className="flex gap-2 items-center group">
                    <span className="w-6 text-[10px] font-bold text-slate-300 group-focus-within:text-indigo-400 transition-colors">{idx + 1}</span>
                    <input type="text" placeholder="Word" disabled={todayRecord.isCompleted} value={w.word} onChange={(e) => handleWordChange(idx, 'word', e.target.value)} className="flex-1 bg-slate-50 border border-slate-100 rounded-xl px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-indigo-300 transition-all" />
                    <input type="text" placeholder="뜻" disabled={todayRecord.isCompleted} value={w.meaning} onChange={(e) => handleWordChange(idx, 'meaning', e.target.value)} className="flex-1 bg-slate-50 border border-slate-100 rounded-xl px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-indigo-300 transition-all" />
                  </div>
                ))}
              </div>
              <div className="pt-6">
                {todayRecord.isCompleted ? (
                  <button onClick={() => setTodayRecord({...todayRecord, isCompleted: false})} className="w-full bg-slate-100 text-slate-600 font-bold py-4 rounded-2xl flex items-center justify-center gap-2 border border-slate-200">
                    <PencilSquareIcon className="w-5 h-5" /> 다시 수정하기
                  </button>
                ) : (
                  <button onClick={submitStudy} className="w-full bg-indigo-600 text-white font-bold py-4 rounded-2xl shadow-lg flex items-center justify-center gap-2 active:scale-95 transition-all">
                    <CheckCircleIcon className="w-5 h-5" /> 학습완료 제출 & 시트 저장
                  </button>
                )}
              </div>
            </div>

            <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
              <h2 className="text-lg font-bold mb-4 text-slate-800 flex items-center gap-2"><CalendarIcon className="w-6 h-6 text-indigo-500" />진도 달력</h2>
              <div className="grid grid-cols-7 gap-2 text-center">
                {['일','월','화','수','목','금','토'].map(d => (<div key={d} className="text-[10px] font-bold text-slate-400 py-1">{d}</div>))}
                {calendarData.days.map((dayObj, i) => {
                  if (!dayObj) return <div key={`empty-${i}`} />;
                  const isFinished = history.some(r => r.date === dayObj.dateStr && r.isCompleted);
                  const isSelected = dayObj.dateStr === todayRecord.date;
                  return (
                    <button key={i} onClick={() => handleDateChange(dayObj.dateStr)} className={`aspect-square flex flex-col items-center justify-center rounded-xl border transition-all ${isFinished ? 'bg-green-50 border-green-100' : isSelected ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-slate-50 border-slate-50'}`}>
                      <span className="text-[11px] font-bold">{dayObj.day}</span>
                      {isFinished && !isSelected && <div className="w-1 h-1 bg-green-400 rounded-full mt-0.5" />}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'test' && (
          <div className="animate-fadeIn">
            {testMode === 'none' ? (
              <div className="grid grid-cols-1 gap-6">
                <div className="bg-white p-10 rounded-[2.5rem] shadow-sm border border-slate-100 text-center space-y-5">
                  <BookOpenIcon className="w-12 h-12 text-indigo-600 mx-auto" />
                  <h2 className="text-xl font-bold text-slate-800">오늘 단어 테스트</h2>
                  <button onClick={() => startTest('today')} className="w-full bg-indigo-600 text-white font-bold py-5 rounded-[1.5rem] shadow-lg active:scale-95">시작하기</button>
                </div>
                <div className="bg-white p-10 rounded-[2.5rem] shadow-sm border border-slate-100 text-center space-y-5">
                  <SparklesIcon className="w-12 h-12 text-violet-600 mx-auto" />
                  <h2 className="text-xl font-bold text-slate-800">누적 랜덤 테스트</h2>
                  <p className="text-xs text-slate-400">시트의 모든 단어 중 5개를 뽑습니다.</p>
                  <button onClick={() => startTest('cumulative')} className="w-full bg-violet-600 text-white font-bold py-5 rounded-[1.5rem] shadow-lg active:scale-95 disabled:opacity-50" disabled={sheetWords.length === 0 && history.length === 0}>
                    누적 테스트 시작 ({sheetWords.length}개 발견)
                  </button>
                </div>
              </div>
            ) : (
              <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-slate-100 min-h-[450px] flex flex-col justify-center text-center relative">
                {testResults.length === testWords.length ? (
                  <div className="space-y-6">
                    <h2 className="text-2xl font-bold text-slate-800">결과: {testResults.filter(r => r.isCorrect).length}/{testWords.length}</h2>
                    <div className="space-y-2 text-left max-h-[300px] overflow-y-auto">
                      {testResults.map((r, i) => (
                        <div key={i} className={`p-4 rounded-2xl border ${r.isCorrect ? 'bg-green-50 border-green-100' : 'bg-red-50 border-red-100'}`}>
                          <div className="flex justify-between font-bold text-sm"><span>{r.word}</span><span className={r.isCorrect ? 'text-green-600' : 'text-red-500'}>{r.isCorrect ? '정답' : '오답'}</span></div>
                          <p className="text-[11px] text-slate-500 mt-1">{r.feedback}</p>
                        </div>
                      ))}
                    </div>
                    <button onClick={() => setTestMode('none')} className="w-full bg-slate-800 text-white font-bold py-4 rounded-2xl">닫기</button>
                  </div>
                ) : (
                  <div className="space-y-8">
                    <div className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">Question {testStep + 1} / {testWords.length}</div>
                    <button onClick={() => {
                        const utterance = new SpeechSynthesisUtterance(testWords[testStep].word);
                        utterance.lang = 'en-US';
                        window.speechSynthesis.speak(utterance);
                    }} className="w-24 h-24 bg-indigo-50 rounded-full flex items-center justify-center mx-auto active:scale-90 transition-all">
                      <SpeakerWaveIcon className="w-10 h-10 text-indigo-600" />
                    </button>
                    <div className="space-y-4 max-w-sm mx-auto">
                      <input type="text" placeholder="Spelling" value={currentTestInput.spelling} onChange={(e) => setCurrentTestInput({...currentTestInput, spelling: e.target.value})} className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-6 py-4 text-center text-xl font-bold outline-none focus:ring-2 focus:ring-indigo-500" />
                      <input type="text" placeholder="뜻" value={currentTestInput.meaning} onChange={(e) => setCurrentTestInput({...currentTestInput, meaning: e.target.value})} className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-6 py-4 text-center text-xl font-bold outline-none focus:ring-2 focus:ring-indigo-500" />
                    </div>
                    <button onClick={handleNextTest} disabled={isScoring || !currentTestInput.spelling.trim()} className="w-full max-w-sm mx-auto bg-indigo-600 text-white font-bold py-5 rounded-2xl flex items-center justify-center gap-2 active:scale-95">
                      {isScoring ? 'AI 채점중...' : '제출'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === 'record' && (
          <div className="animate-fadeIn">
            <div className="bg-white p-10 rounded-[2.5rem] shadow-sm border border-slate-100 text-center space-y-8">
              <div className={`w-28 h-28 rounded-full flex items-center justify-center mx-auto transition-all relative ${isRecording ? 'bg-red-50 animate-pulse' : 'bg-indigo-50'}`}>
                <MicrophoneIcon className={`w-12 h-12 ${isRecording ? 'text-red-600' : 'text-indigo-600'}`} />
                {isRecording && (
                   <div className="absolute -bottom-2 bg-red-600 text-white text-[10px] px-2 py-0.5 rounded-full font-bold">REC</div>
                )}
              </div>
              
              <div className="space-y-2">
                <h2 className="text-xl font-bold text-slate-800">영어 발음 연습</h2>
                {isRecording && (
                   <div className="flex items-center justify-center gap-1.5 text-red-600 font-mono font-bold text-lg">
                     <ClockIcon className="w-5 h-5" />
                     {formatTime(recordingTime)}
                   </div>
                )}
              </div>

              <div className="flex gap-4 justify-center">
                {!isRecording ? (
                  <button onClick={startRecording} className="bg-indigo-600 text-white font-bold px-10 py-4 rounded-2xl shadow-lg active:scale-95 transition-all flex items-center gap-2">
                    <MicrophoneIcon className="w-5 h-5" /> 녹음 시작
                  </button>
                ) : (
                  <button onClick={stopRecording} className="bg-red-600 text-white font-bold px-10 py-4 rounded-2xl shadow-lg active:scale-95 transition-all flex items-center gap-2">
                    <StopIcon className="w-5 h-5" /> 녹음 중지
                  </button>
                )}
              </div>

              {audioUrl && !isRecording && (
                <div className="pt-8 border-t border-slate-100 flex flex-col items-center gap-4 animate-fadeIn">
                  <div className="w-full bg-slate-50 p-4 rounded-2xl border border-slate-100 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                       <div className="w-10 h-10 bg-indigo-600 rounded-full flex items-center justify-center">
                          <PlayIcon className="w-5 h-5 text-white" />
                       </div>
                       <div className="text-left">
                         <div className="text-xs font-bold text-slate-700">최근 녹음 파일</div>
                         <div className="text-[10px] text-slate-400">캐시 메모리에 저장됨</div>
                       </div>
                    </div>
                    <button 
                      onClick={() => {
                        const audio = new Audio(audioUrl);
                        audio.play();
                      }} 
                      className="bg-slate-800 text-white font-bold px-4 py-2 rounded-xl text-sm active:scale-95 transition-all"
                    >
                      재생하기
                    </button>
                  </div>
                  <button onClick={() => setAudioUrl(null)} className="text-slate-400 text-xs underline hover:text-red-500 transition-colors">기록 삭제</button>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="animate-fadeIn space-y-6">
            <div className="bg-white p-10 rounded-[2.5rem] shadow-sm border border-slate-100 space-y-6">
               <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2"><Cog6ToothIcon className="w-6 h-6 text-indigo-600" /> 설정</h2>
               <div className="space-y-4">
                 <div className="space-y-2">
                   <label className="text-xs font-bold text-slate-500">GAS 배포 URL</label>
                   <input type="text" value={gasUrl} onChange={(e) => setGasUrl(e.target.value)} className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-5 py-4 text-[10px] font-mono outline-none" />
                 </div>
                 <button onClick={() => { localStorage.setItem('study_gas_url', gasUrl); fetchSheetData(); alert('저장되었습니다.'); }} className="w-full bg-indigo-600 text-white font-bold py-5 rounded-2xl">저장 및 동기화</button>
               </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default App;
