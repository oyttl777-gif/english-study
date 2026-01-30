
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
  CodeBracketIcon,
  ChevronRightIcon,
  DocumentDuplicateIcon
} from '@heroicons/react/24/outline';

const DEFAULT_GAS_URL = "https://script.google.com/macros/s/AKfycbwqJNte9iEsNvW_5CWwyxkdxYazw7nTQ_cH2W0GYQwqDDWFSReQII1xLXwXNSoxOfuGIA/exec";

// 구글 시트에 복사해서 넣어야 할 표준 스크립트
const GAS_CODE_TEMPLATE = `function doPost(e) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getActiveSheet();
  var data = JSON.parse(e.postData.contents);
  
  if (data.action === 'insert') {
    // 단어들을 문자열로 합침
    var wordsStr = data.words.map(function(w) { return w.word + ":" + w.meaning; }).join(", ");
    
    sheet.appendRow([
      new Date(), 
      data.date, 
      data.page, 
      wordsStr, 
      data.news, 
      data.status
    ]);
    
    return ContentService.createTextOutput(JSON.stringify({result: "success"}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getActiveSheet();
  var data = sheet.getDataRange().getValues();
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}`;

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
  const [isSubmitting, setIsSubmitting] = useState(false);
  
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
      const response = await fetch(url, { redirect: 'follow' });
      if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
      const rawData = await response.json();
      const dataArray = Array.isArray(rawData) ? rawData : (rawData.data || []);

      if (dataArray.length > 0) {
        const parsedWords: WordEntry[] = dataArray
          .slice(1)
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
      console.error(error);
      setLoadError("데이터 로드 실패. 스크립트 URL을 확인해!");
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
      alert("단어를 하나라도 적어줘!");
      return;
    }

    setIsSubmitting(true);
    
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
        cache: 'no-cache',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const updatedRecord = { ...todayRecord, isCompleted: true };
      const newHistory = [...history.filter(r => r.date !== todayRecord.date), updatedRecord];
      setHistory(newHistory);
      localStorage.setItem('study_history', JSON.stringify(newHistory));
      
      alert('성공적으로 저장됐어! 구글 시트를 확인해봐 ✨');
      setTimeout(() => fetchSheetData(gasUrl), 1500);
    } catch (e) {
      alert('전송 중 오류가 발생했어. 설정에서 URL을 확인해봐!');
    } finally {
      setIsSubmitting(false);
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
      alert('시험 볼 단어가 없어!');
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
    try {
      const target = testWords[testStep];
      const score = await scoreTest(target.word, target.meaning, currentTestInput.spelling, currentTestInput.meaning);
      setTestResults(prev => [...prev, { 
        ...target, 
        userSpelling: currentTestInput.spelling, 
        userMeaning: currentTestInput.meaning, 
        isCorrect: score.isCorrect, 
        feedback: score.feedback 
      }]);
      
      if (testStep < testWords.length - 1) {
        setTestStep(testStep + 1);
        setCurrentTestInput({ spelling: '', meaning: '' });
      }
    } catch (err) {
      alert("AI 선생님과 연결이 안 돼!");
    } finally {
      setIsScoring(false);
    }
  };

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
      alert("마이크 권한을 허용해줘!"); 
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

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    alert('코드가 복사됐어! 구글 시트 스크립트 에디터에 붙여넣어줘.');
  };

  return (
    <div className="min-h-screen pb-24 max-w-xl mx-auto px-4 pt-6 flex flex-col gap-6 font-sans">
      {/* Header */}
      <header className="bg-white rounded-[2.5rem] p-6 shadow-xl shadow-indigo-100 border border-indigo-50 relative overflow-hidden">
        <div className="absolute top-0 right-0 p-4 flex gap-2">
            <div className={`flex items-center gap-1.5 text-[10px] font-bold px-3 py-1.5 rounded-full ${loadError ? 'bg-red-50 text-red-500' : 'bg-indigo-50 text-indigo-600'}`}>
                {isLoadingSheet ? <ArrowPathIcon className="w-3 h-3 animate-spin" /> : (loadError ? <ExclamationCircleIcon className="w-3 h-3" /> : <div className="w-2 h-2 bg-indigo-500 rounded-full animate-pulse" />)}
                {sheetWords.length}단어 마스터
            </div>
            <button onClick={() => fetchSheetData()} className="p-1.5 bg-slate-50 rounded-full hover:bg-slate-100 transition-colors">
                <CloudArrowDownIcon className="w-5 h-5 text-slate-400" />
            </button>
        </div>
        <div className="flex items-center gap-4">
           <div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-200">
             <AcademicCapIcon className="w-7 h-7 text-white" />
           </div>
           <div>
             <h1 className="text-xl font-bold text-slate-800 tracking-tight">영단어 기록장</h1>
             <p className="text-[11px] text-slate-400 font-medium tracking-wide">오늘도 공부 완료! 🚀</p>
           </div>
        </div>
      </header>

      {/* Navigation */}
      <nav className="flex bg-white/90 backdrop-blur-md p-1.5 rounded-[2rem] shadow-lg border border-white sticky top-4 z-50">
        {[
          { id: 'study', icon: PencilSquareIcon, label: '학습기록' },
          { id: 'test', icon: ArrowPathIcon, label: '단어시험' },
          { id: 'record', icon: MicrophoneIcon, label: '발음연습' },
          { id: 'settings', icon: Cog6ToothIcon, label: '설정' }
        ].map(tab => (
          <button 
            key={tab.id} 
            onClick={() => { setActiveTab(tab.id as any); setTestMode('none'); }} 
            className={`flex-1 flex flex-col items-center py-3 rounded-2xl transition-all duration-300 ${activeTab === tab.id ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-100' : 'text-slate-400 hover:text-slate-600'}`}
          >
            <tab.icon className="w-6 h-6" />
            <span className="text-[10px] mt-1 font-bold">{tab.label}</span>
          </button>
        ))}
      </nav>

      <main className="flex-1">
        {activeTab === 'study' && (
          <div className="flex flex-col gap-5 animate-in">
            {/* Info Card */}
            <section className="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-100 space-y-5">
               <div className="flex justify-between items-center">
                 <h2 className="text-sm font-bold text-slate-800 uppercase tracking-widest">General Info</h2>
                 <span className={`px-4 py-1 rounded-full text-[10px] font-black ${todayRecord.isCompleted ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                    {todayRecord.isCompleted ? 'COMPLETED' : 'IN PROGRESS'}
                 </span>
               </div>
               <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-400 ml-1">DATE</label>
                    <input type="date" value={todayRecord.date} onChange={(e) => handleDateChange(e.target.value)} className="w-full bg-slate-50 border border-slate-100 rounded-xl px-4 py-3 text-sm font-bold text-slate-700 focus:ring-2 focus:ring-indigo-500 outline-none transition-all" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-400 ml-1">PAGES</label>
                    <input type="text" placeholder="e.g. 10-25" disabled={todayRecord.isCompleted} value={todayRecord.page} onChange={(e) => setTodayRecord({...todayRecord, page: e.target.value})} className="w-full bg-slate-50 border border-slate-100 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all" />
                  </div>
               </div>
            </section>

            {/* News Card */}
            <section className="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-100 space-y-3">
              <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2 uppercase tracking-widest"><NewspaperIcon className="w-5 h-5 text-indigo-500" /> English News Journal</h3>
              <textarea placeholder="오늘 읽은 기사의 한 줄 요약을 적어봐..." disabled={todayRecord.isCompleted} value={todayRecord.newsContent} onChange={(e) => setTodayRecord({...todayRecord, newsContent: e.target.value})} className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-5 py-4 text-sm min-h-[100px] focus:ring-2 focus:ring-indigo-500 outline-none transition-all resize-none" />
            </section>

            {/* Word List Card */}
            <section className="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-100 space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="text-sm font-bold text-slate-800 uppercase tracking-widest">Daily 13 Words</h3>
                <span className="text-[10px] font-bold text-indigo-500">{todayRecord.words.filter(w => w.word).length} / 13</span>
              </div>
              <div className="grid grid-cols-1 gap-2.5">
                {todayRecord.words.map((w, idx) => (
                  <div key={idx} className="flex gap-2 items-center group">
                    <div className="w-7 h-7 flex-shrink-0 flex items-center justify-center bg-slate-100 rounded-lg text-[10px] font-bold text-slate-400 group-focus-within:bg-indigo-600 group-focus-within:text-white transition-all">
                      {idx + 1}
                    </div>
                    <input type="text" placeholder="Word" disabled={todayRecord.isCompleted} value={w.word} onChange={(e) => handleWordChange(idx, 'word', e.target.value)} className="flex-1 bg-slate-50 border border-slate-100 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-indigo-400 transition-all" />
                    <input type="text" placeholder="뜻" disabled={todayRecord.isCompleted} value={w.meaning} onChange={(e) => handleWordChange(idx, 'meaning', e.target.value)} className="flex-1 bg-slate-50 border border-slate-100 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-indigo-400 transition-all" />
                  </div>
                ))}
              </div>
              <div className="pt-6">
                {todayRecord.isCompleted ? (
                  <button onClick={() => setTodayRecord({...todayRecord, isCompleted: false})} className="w-full bg-slate-100 text-slate-600 font-bold py-4 rounded-2xl flex items-center justify-center gap-2 border border-slate-200 hover:bg-slate-200 transition-colors">
                    <PencilSquareIcon className="w-5 h-5" /> 내용 수정하기
                  </button>
                ) : (
                  <button onClick={submitStudy} disabled={isSubmitting} className="w-full bg-indigo-600 text-white font-bold py-5 rounded-2xl shadow-xl shadow-indigo-100 flex items-center justify-center gap-2 active:scale-95 transition-all disabled:opacity-50">
                    {isSubmitting ? <><ArrowPathIcon className="w-6 h-6 animate-spin" /> 저장 중...</> : <><CheckCircleIcon className="w-6 h-6" /> 학습 완료 & 저장하기</>}
                  </button>
                )}
              </div>
            </section>

            {/* Calendar Card */}
            <section className="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-100">
              <h2 className="text-sm font-bold text-slate-800 mb-6 flex items-center gap-2 uppercase tracking-widest"><CalendarIcon className="w-5 h-5 text-indigo-500" /> Progress Calendar</h2>
              <div className="grid grid-cols-7 gap-3">
                {['S','M','T','W','T','F','S'].map(d => (<div key={d} className="text-[10px] font-black text-slate-300 py-1 text-center">{d}</div>))}
                {calendarData.days.map((dayObj, i) => {
                  if (!dayObj) return <div key={`empty-${i}`} />;
                  const isFinished = history.some(r => r.date === dayObj.dateStr && r.isCompleted);
                  const isSelected = dayObj.dateStr === todayRecord.date;
                  return (
                    <button key={i} onClick={() => handleDateChange(dayObj.dateStr)} className={`aspect-square flex flex-col items-center justify-center rounded-2xl border transition-all ${isFinished ? 'bg-green-50 border-green-100' : isSelected ? 'bg-indigo-600 border-indigo-600 text-white shadow-lg shadow-indigo-100' : 'bg-slate-50 border-slate-50 hover:bg-slate-100'}`}>
                      <span className="text-[11px] font-bold">{dayObj.day}</span>
                      {isFinished && !isSelected && <div className="w-1 h-1 bg-green-500 rounded-full mt-1 animate-pulse" />}
                    </button>
                  );
                })}
              </div>
            </section>
          </div>
        )}

        {activeTab === 'test' && (
             <div className="animate-in">
                {testMode === 'none' ? (
                  <div className="grid grid-cols-1 gap-6">
                    <button onClick={() => startTest('today')} className="group bg-white p-10 rounded-[3rem] shadow-xl shadow-indigo-50 border border-indigo-50 text-left transition-all hover:scale-[1.02] active:scale-95">
                      <div className="w-14 h-14 bg-indigo-100 rounded-3xl flex items-center justify-center mb-6 group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                        <BookOpenIcon className="w-8 h-8 text-indigo-600 group-hover:text-white" />
                      </div>
                      <h2 className="text-xl font-bold text-slate-800">Today's Focus</h2>
                      <p className="text-xs text-slate-400 mt-1">오늘 공부한 단어 바로 테스트!</p>
                      <div className="mt-6 flex items-center gap-2 text-indigo-600 font-bold text-sm">시험 보기 <ChevronRightIcon className="w-4 h-4" /></div>
                    </button>
                    <button onClick={() => startTest('cumulative')} className="group bg-white p-10 rounded-[3rem] shadow-xl shadow-violet-50 border border-violet-50 text-left transition-all hover:scale-[1.02] active:scale-95 disabled:opacity-50" disabled={sheetWords.length === 0}>
                      <div className="w-14 h-14 bg-violet-100 rounded-3xl flex items-center justify-center mb-6 group-hover:bg-violet-600 group-hover:text-white transition-colors">
                        <SparklesIcon className="w-8 h-8 text-violet-600 group-hover:text-white" />
                      </div>
                      <h2 className="text-xl font-bold text-slate-800">Power Mix</h2>
                      <p className="text-xs text-slate-400 mt-1">누적된 단어 중 5개 랜덤 도전!</p>
                      <div className="mt-6 flex items-center gap-2 text-violet-600 font-bold text-sm">도전하기 <ChevronRightIcon className="w-4 h-4" /></div>
                    </button>
                  </div>
                ) : (
                  <div className="bg-white p-8 rounded-[3rem] shadow-2xl border border-slate-100 min-h-[500px] flex flex-col items-center justify-center animate-in">
                    {testResults.length === testWords.length ? (
                      <div className="space-y-8 w-full">
                        <div className="text-center">
                          <CheckCircleIcon className="w-16 h-16 text-green-600 mx-auto mb-4" />
                          <h2 className="text-2xl font-bold text-slate-800">결과: {testResults.filter(r => r.isCorrect).length} / {testWords.length}</h2>
                        </div>
                        <div className="space-y-3 max-h-[300px] overflow-y-auto px-2">
                          {testResults.map((r, i) => (
                            <div key={i} className={`p-4 rounded-2xl border ${r.isCorrect ? 'bg-green-50' : 'bg-red-50'}`}>
                              <div className="flex justify-between font-bold text-sm text-slate-800"><span>{r.word}</span><span>{r.isCorrect ? '⭕' : '❌'}</span></div>
                              <p className="text-[10px] text-slate-500 mt-1">{r.feedback}</p>
                            </div>
                          ))}
                        </div>
                        <button onClick={() => setTestMode('none')} className="w-full bg-slate-800 text-white font-bold py-4 rounded-2xl">닫기</button>
                      </div>
                    ) : (
                      <div className="w-full space-y-8">
                         <div className="text-center space-y-4">
                            <span className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">Question {testStep + 1} of {testWords.length}</span>
                            <button onClick={() => {
                                const utterance = new SpeechSynthesisUtterance(testWords[testStep].word);
                                utterance.lang = 'en-US';
                                window.speechSynthesis.speak(utterance);
                            }} className="w-24 h-24 bg-indigo-50 rounded-[2rem] flex items-center justify-center mx-auto shadow-inner hover:bg-indigo-100 transition-all">
                              <SpeakerWaveIcon className="w-10 h-10 text-indigo-600" />
                            </button>
                         </div>
                         <div className="space-y-4">
                            <input type="text" placeholder="Spelling?" value={currentTestInput.spelling} onChange={(e) => setCurrentTestInput({...currentTestInput, spelling: e.target.value})} className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-6 py-4 text-center text-xl font-bold outline-none focus:border-indigo-500" />
                            <input type="text" placeholder="뜻?" value={currentTestInput.meaning} onChange={(e) => setCurrentTestInput({...currentTestInput, meaning: e.target.value})} className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-6 py-4 text-center text-xl font-bold outline-none focus:border-indigo-500" />
                         </div>
                         <button onClick={handleNextTest} disabled={isScoring} className="w-full bg-indigo-600 text-white font-bold py-5 rounded-3xl shadow-lg shadow-indigo-100 flex justify-center items-center gap-2">
                           {isScoring ? <ArrowPathIcon className="w-5 h-5 animate-spin" /> : '다음 문제'}
                         </button>
                      </div>
                    )}
                  </div>
                )}
             </div>
        )}

        {activeTab === 'record' && (
          <div className="animate-in">
            <div className="bg-white p-12 rounded-[3.5rem] shadow-xl border border-slate-100 text-center space-y-10">
              <h2 className="text-2xl font-bold text-slate-800">English Pronunciation</h2>
              <div className="relative w-40 h-40 mx-auto">
                 {isRecording && <div className="absolute inset-0 bg-red-400/20 rounded-full animate-ping" />}
                 <div className={`w-40 h-40 rounded-full flex items-center justify-center mx-auto relative z-10 ${isRecording ? 'bg-red-500 shadow-2xl shadow-red-200' : 'bg-indigo-50 shadow-inner'}`}>
                  <MicrophoneIcon className={`w-16 h-16 ${isRecording ? 'text-white' : 'text-indigo-600'}`} />
                 </div>
              </div>
              <div className="flex gap-5 justify-center">
                {!isRecording ? (
                  <button onClick={startRecording} className="bg-indigo-600 text-white font-bold px-12 py-5 rounded-[2rem] active:scale-95 transition-all">REC START</button>
                ) : (
                  <button onClick={stopRecording} className="bg-red-600 text-white font-bold px-12 py-5 rounded-[2rem] active:scale-95 transition-all">STOP ({formatTime(recordingTime)})</button>
                )}
              </div>
              {audioUrl && !isRecording && (
                <div className="pt-10 border-t border-slate-100 flex flex-col items-center gap-4">
                  <button onClick={() => new Audio(audioUrl).play()} className="bg-slate-800 text-white font-bold px-8 py-4 rounded-2xl">내 발음 듣기 🎧</button>
                  <button onClick={() => setAudioUrl(null)} className="text-slate-400 text-xs font-bold uppercase tracking-widest">Discard</button>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="animate-in space-y-6">
            <div className="bg-white p-8 rounded-[3rem] shadow-xl border border-slate-100 space-y-6">
               <div className="flex items-center gap-3 mb-2">
                 <div className="w-10 h-10 bg-slate-100 rounded-2xl flex items-center justify-center">
                    <Cog6ToothIcon className="w-6 h-6 text-slate-600" />
                 </div>
                 <h2 className="text-xl font-bold text-slate-800">App Settings</h2>
               </div>
               
               <div className="space-y-4">
                 <div className="space-y-2">
                   <label className="text-[10px] font-bold text-slate-400 ml-1 uppercase tracking-widest">Google Apps Script URL</label>
                   <input type="text" value={gasUrl} onChange={(e) => setGasUrl(e.target.value)} className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-5 py-4 text-[11px] font-mono text-slate-500 focus:border-indigo-500 outline-none" />
                 </div>
                 <button onClick={() => { localStorage.setItem('study_gas_url', gasUrl); fetchSheetData(); alert('설정이 저장됐어! 다시 시트 동기화를 시도할게.'); }} className="w-full bg-indigo-600 text-white font-bold py-5 rounded-[1.5rem] shadow-xl shadow-indigo-100 active:scale-95 transition-all">Save & Sync Now</button>
               </div>
            </div>

            {/* GAS 가이드 카드 */}
            <div className="bg-slate-800 p-8 rounded-[3rem] shadow-xl text-white space-y-6 overflow-hidden">
               <div className="flex items-center gap-3">
                 <div className="w-10 h-10 bg-indigo-500/20 rounded-2xl flex items-center justify-center">
                    <CodeBracketIcon className="w-6 h-6 text-indigo-400" />
                 </div>
                 <h2 className="text-lg font-bold">기록이 안 된다면? (GAS 설정 가이드)</h2>
               </div>
               
               <div className="space-y-4">
                 <p className="text-xs text-slate-400 leading-relaxed">
                   1. 구글 시트 상단 <strong>[확장 프로그램] → [Apps Script]</strong>를 클릭해.<br/>
                   2. 아래 코드를 복사해서 기존 내용을 모두 지우고 붙여넣어.
                 </p>
                 
                 <div className="relative group">
                   <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => copyToClipboard(GAS_CODE_TEMPLATE)} className="p-2 bg-indigo-600 rounded-xl hover:bg-indigo-500 shadow-lg">
                        <DocumentDuplicateIcon className="w-4 h-4 text-white" />
                      </button>
                   </div>
                   <pre className="bg-slate-900 rounded-2xl p-4 text-[10px] font-mono text-indigo-300 overflow-x-auto max-h-[200px] border border-slate-700">
                     {GAS_CODE_TEMPLATE}
                   </pre>
                 </div>

                 <p className="text-xs text-slate-400 leading-relaxed">
                   3. <strong>[배포] → [새 배포]</strong> 클릭!<br/>
                   4. 종류 선택: <strong>'웹 앱'</strong><br/>
                   5. 액세스 권한: <strong>'모든 사용자(Anyone)'</strong>로 설정!<br/>
                   6. 생성된 URL을 복사해서 위의 설정창에 붙여넣으면 끝!
                 </p>
               </div>
            </div>
            
            <footer className="text-center py-4 opacity-50">
               <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.3em]">English Study Log v2.5</p>
            </footer>
          </div>
        )}
      </main>
    </div>
  );
};

export default App;
