const DB_NAME = '교대달력 급여 데이터베이스';

function setupDatabase() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('스프레드시트의 확장 프로그램 → Apps Script에서 실행하세요.');

  const props = PropertiesService.getScriptProperties();
  let appKey = props.getProperty('APP_KEY');
  if (!appKey) {
    appKey = Utilities.getUuid() + Utilities.getUuid().replace(/-/g, '');
    props.setProperty('APP_KEY', appKey);
  }
  props.setProperty('SPREADSHEET_ID', ss.getId());

  ensureSheet_(ss, 'config', ['key', 'value', 'description']);
  ensureSheet_(ss, 'appData', ['id', 'json', 'updatedAt']);
  ensureSheet_(ss, 'settings', ['key', 'value']);
  ensureSheet_(ss, 'attendance', ['date', 'override', 'memo']);
  ensureSheet_(ss, 'teamHistory', ['from', 'to', 'teamIndex']);
  ensureSheet_(ss, 'salaryOverrides', ['salaryMonth', 'field', 'value']);
  ensureSheet_(ss, 'companyHolidays', ['id', 'name', 'month', 'day', 'date', 'annual', 'enabled', 'payAsHoliday']);

  const config = ss.getSheetByName('config');
  config.clearContents();
  config.getRange(1,1,3,3).setValues([
    ['key','value','description'],
    ['APP_KEY',appKey,'교대달력 설정창에 입력할 인증키'],
    ['SPREADSHEET_ID',ss.getId(),'데이터베이스 식별자']
  ]);
  config.setFrozenRows(1);
  config.autoResizeColumns(1,3);

  SpreadsheetApp.getUi().alert('양식 생성 완료\\nconfig 시트의 APP_KEY를 앱에 입력하세요.');
  return {ok:true, spreadsheetId:ss.getId(), appKey:appKey};
}

function ensureSheet_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  sh.clearContents();
  sh.getRange(1,1,1,headers.length).setValues([headers]);
  sh.setFrozenRows(1);
  sh.autoResizeColumns(1,headers.length);
}

function jsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function verify_(key) {
  const saved = PropertiesService.getScriptProperties().getProperty('APP_KEY');
  if (!saved || key !== saved) throw new Error('인증키가 올바르지 않습니다.');
}
function getDb_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('setupDatabase를 먼저 실행하세요.');
  return SpreadsheetApp.openById(id);
}
function doGet(e) {
  try {
    const action = (e.parameter.action || 'ping').toLowerCase();
    verify_(e.parameter.key || '');
    if (action === 'ping') return jsonOutput_({ok:true,message:'연결 성공'});
    if (action === 'load') {
      const sh = getDb_().getSheetByName('appData');
      if (sh.getLastRow() < 2) return jsonOutput_({ok:true,data:null,message:'저장된 백업이 없습니다.'});
      return jsonOutput_({ok:true,data:JSON.parse(sh.getRange(2,2).getValue()),updatedAt:sh.getRange(2,3).getValue()});
    }
    return jsonOutput_({ok:false,error:'지원하지 않는 요청'});
  } catch (err) {
    return jsonOutput_({ok:false,error:err.message});
  }
}
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || '{}');
    verify_(body.key || '');
    if (body.action !== 'save') throw new Error('지원하지 않는 요청');
    writeAll_(getDb_(), body.data || {});
    return jsonOutput_({ok:true,message:'백업 완료',updatedAt:new Date().toISOString()});
  } catch (err) {
    return jsonOutput_({ok:false,error:err.message});
  }
}
function writeAll_(ss, data) {
  const updatedAt = new Date().toISOString();
  const appData = ss.getSheetByName('appData');
  appData.clearContents();
  appData.getRange(1,1,2,3).setValues([['id','json','updatedAt'],['latest',JSON.stringify(data),updatedAt]]);
  appData.setFrozenRows(1);

  writeKeyValue_(ss.getSheetByName('settings'), data.salarySettings || {});

  const attendance = ss.getSheetByName('attendance');
  const attRows = [['date','override','memo']];
  const keys = {};
  Object.keys(data.localStorage || {}).forEach(function(k) {
    if (k.indexOf('override-') === 0) keys[k.slice(9)] = true;
    if (k.indexOf('memo-') === 0) keys[k.slice(5)] = true;
  });
  Object.keys(keys).sort().forEach(function(date) {
    attRows.push([date,parseStored_(data.localStorage['override-'+date]),parseStored_(data.localStorage['memo-'+date])]);
  });
  attendance.clearContents();
  attendance.getRange(1,1,attRows.length,3).setValues(attRows);
  attendance.setFrozenRows(1);

  writeRows_(ss.getSheetByName('teamHistory'),['from','to','teamIndex'],data.teamHistory||[],['from','to','teamIndex']);

  const salRows = [['salaryMonth','field','value']];
  Object.keys(data.salaryOverrides || {}).sort().forEach(function(month) {
    Object.keys(data.salaryOverrides[month] || {}).forEach(function(field) {
      salRows.push([month,field,data.salaryOverrides[month][field]]);
    });
  });
  const sal = ss.getSheetByName('salaryOverrides');
  sal.clearContents();
  sal.getRange(1,1,salRows.length,3).setValues(salRows);
  sal.setFrozenRows(1);

  writeRows_(ss.getSheetByName('companyHolidays'),
    ['id','name','month','day','date','annual','enabled','payAsHoliday'],
    data.companyHolidays||[],
    ['id','name','month','day','date','annual','enabled','payAsHoliday']);
}
function parseStored_(v) {
  if (v === undefined || v === null || v === '') return '';
  try { return JSON.parse(v); } catch (_) { return v; }
}
function writeKeyValue_(sheet,obj) {
  const rows=[['key','value']];
  Object.keys(obj).forEach(function(k){rows.push([k,obj[k]]);});
  sheet.clearContents();
  sheet.getRange(1,1,rows.length,2).setValues(rows);
  sheet.setFrozenRows(1);
}
function writeRows_(sheet,headers,list,fields) {
  const rows=[headers];
  (list||[]).forEach(function(item){rows.push(fields.map(function(f){return item[f] == null ? '' : item[f];}));});
  sheet.clearContents();
  sheet.getRange(1,1,rows.length,headers.length).setValues(rows);
  sheet.setFrozenRows(1);
}