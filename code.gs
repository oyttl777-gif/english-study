
/**
 * 구글 시트의 [확장 프로그램] > [Apps Script]에 이 코드를 복사해서 붙여넣으세요.
 * 배포 시 [새 배포] > [웹 앱] > [액세스 권한: 모든 사용자(Anyone)]로 설정해야 합니다.
 */

function doPost(e) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getActiveSheet();
    
    // 전송된 데이터 파싱
    var data = JSON.parse(e.postData.contents);
    
    if (data.action === 'insert') {
      // 단어 객체 배열을 "단어:뜻, 단어:뜻" 형태의 문자열로 변환
      var wordsStr = data.words.map(function(w) { 
        return w.word + " : " + w.meaning; 
      }).join("\n");
      
      // 시트에 새로운 행 추가
      // 순서: 저장시간, 학습날짜, 페이지, 단어리스트, 뉴스내용, 상태
      sheet.appendRow([
        new Date(),       // A열: 기록 시간
        data.date,       // B열: 학습 날짜
        data.page,       // C열: 페이지 범위
        wordsStr,        // D열: 단어 목록
        data.news,       // E열: 뉴스 요약
        data.status      // F열: 상태 (학습완료)
      ]);
      
      return ContentService.createTextOutput(JSON.stringify({ "result": "success" }))
        .setMimeType(ContentService.MimeType.JSON);
    }
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ "result": "error", "message": error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getActiveSheet();
    var data = sheet.getDataRange().getValues();
    
    // 시트의 모든 데이터를 JSON으로 반환 (앱에서 누적 단어를 불러올 때 사용)
    return ContentService.createTextOutput(JSON.stringify(data))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ "result": "error", "message": error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
