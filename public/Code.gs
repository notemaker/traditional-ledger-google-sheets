/*
 * Daily Ledger - Google Apps Script Web App
 *
 * 試算表固定五欄：日期 | 類型 | 分類 | 金額 | 備註
 * 只會讀寫 CONFIG.SHEET_NAME，不會碰其他工作表。
 */

var CONFIG = {
  SPREADSHEET_ID: '', // 私用部署設定；不要同步到 public/Code.gs 或前端
  SHEET_NAME: '記帳紀錄',
  TIMEZONE: 'Asia/Taipei',
  HEADER: ['日期', '類型', '分類', '金額', '備註'],
  ID_PREFIX: 'ledger-id:',
  STATUS_PREFIX: 'ledger-status:',
  STATUS_TTL_MS: 24 * 60 * 60 * 1000,
  STATUS_MAX: 200,
  LOCK_TIMEOUT_MS: 30000
};

var CALLBACK_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
var ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{7,99}$/;
var REQUEST_ID_RE = /^[^\s]{1,120}$/;
var MAX_AMOUNT = 1000000000;

/**
 * GET 只提供 list/status 讀取；list 例外地會在鎖內替舊列補穩定 ID。
 * JSONP 僅在 callback 通過嚴格名稱檢查時啟用。
 */
function doGet(e) {
  var params = (e && e.parameter) || {};
  var action = String(params.action || 'list').toLowerCase();
  var callback = params.callback ? String(params.callback) : '';

  if (callback && !CALLBACK_RE.test(callback)) {
    return respond_({
      ok: false,
      error: 'callback 名稱格式不合法；僅允許 JavaScript 識別字。'
    }, '');
  }

  try {
    if (action === 'list') {
      return respond_(listPayload_(), callback);
    }
    if (action === 'status') {
      return respond_(statusPayload_(params.requestId), callback);
    }
    return respond_({
      ok: false,
      error: '不支援的 GET action；只允許 list 或 status。'
    }, callback);
  } catch (err) {
    return respond_({ ok: false, error: errorMessage_(err) }, callback);
  }
}

/**
 * POST body 必須是 text/plain JSON。瀏覽器可用 no-cors 發送，再用 JSONP
 * status 輪詢結果；因此 doPost 的回應不依賴瀏覽器能否讀取 response body。
 */
function doPost(e) {
  var request;
  try {
    var body = e && e.postData && e.postData.contents;
    if (!body) {
      return respond_({ ok: false, error: 'POST 缺少 text/plain JSON body。' }, '');
    }
    request = JSON.parse(body);
  } catch (err) {
    return respond_({ ok: false, error: 'POST body 不是有效 JSON。' }, '');
  }

  var requestId;
  try {
    requestId = normalizeRequestId_(request && request.requestId);
  } catch (err2) {
    return respond_({ ok: false, error: errorMessage_(err2) }, '');
  }

  try {
    return withMutationLock_(function () {
      cleanupStatuses_(Date.now());

      var previous = loadStatus_(requestId);
      if (previous) {
        // 同一 requestId 永遠重用第一次的結果，不會再次 appendRow。
        return postStatusResponse_(previous);
      }

      var now = Date.now();
      var pending = {
        requestId: requestId,
        action: request.action,
        status: 'pending',
        createdAt: now,
        updatedAt: now,
        result: null
      };
      saveStatus_(requestId, pending);

      var mutationState = { started: false };
      var result;
      try {
        result = applyMutation_(request, mutationState);
      } catch (mutationError) {
        if (mutationState.started) {
          // Once a sheet mutator has started, a later note/read/ack failure cannot
          // prove that the write did not happen. Keep the receipt pending so the
          // client will not interpret the error as a safe-to-repeat failure.
          var uncertainPending = {
            requestId: requestId,
            action: request.action,
            status: 'pending',
            createdAt: now,
            updatedAt: Date.now(),
            result: null,
            uncertain: true
          };
          try {
            saveStatus_(requestId, uncertainPending);
          } catch (statusError) {
            // The original pending property was written before mutation. If this
            // best-effort update fails, do not replace it with a done/error value.
          }
          return postStatusResponse_(uncertainPending);
        }
        result = { ok: false, error: errorMessage_(mutationError) };
      }

      var done = {
        requestId: requestId,
        action: request.action,
        status: 'done',
        createdAt: now,
        updatedAt: Date.now(),
        result: result
      };
      // 先前已將 pending 寫入 ScriptProperties；這裡保存 done，讓 no-cors
      // 的 opaque 回應遺失時，重試仍能看到既有結果而不重複寫入。
      saveStatus_(requestId, done);
      return postStatusResponse_(done);
    });
  } catch (err3) {
    // requestId 已知但鎖/儲存服務本身失敗時，盡量讓呼叫端拿到可見錯誤。
    return respond_({ ok: false, error: errorMessage_(err3) }, '');
  }
}

/** 手動執行一次：建立指定工作表與標題，但不覆蓋既有標題或資料。 */
function setup() {
  return withMutationLock_(function () {
    var spreadsheet = openSpreadsheet_();
    var sheet = spreadsheet.getSheetByName(CONFIG.SHEET_NAME);
    if (!sheet) {
      sheet = spreadsheet.insertSheet(CONFIG.SHEET_NAME);
    }
    ensureHeader_(sheet, true);
    return {
      ok: true,
      sheetName: CONFIG.SHEET_NAME,
      header: CONFIG.HEADER.slice()
    };
  });
}

function listPayload_() {
  return withMutationLock_(function () {
    var sheet = getSheet_();
    var records = readRecordsAndAssignIds_(sheet);
    return {
      ok: true,
      records: records.map(publicRecord_),
      updatedAt: nowIso_()
    };
  });
}

function statusPayload_(requestIdValue) {
  var requestId = normalizeRequestId_(requestIdValue);
  var stored = loadStatus_(requestId);
  if (!stored) {
    return {
      ok: true,
      status: 'pending',
      result: null
    };
  }
  return {
    ok: true,
    status: stored.status,
    result: stored.status === 'done' ? stored.result : null
  };
}

function applyMutation_(request, mutationState) {
  mutationState = mutationState || { started: false };
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw new Error('POST JSON 必須是物件。');
  }

  var action = String(request.action || '').toLowerCase();
  if (action !== 'add' && action !== 'edit' && action !== 'delete') {
    throw new Error('action 必須是 add、edit 或 delete。');
  }

  var sheet = getSheet_();
  if (action === 'add') {
    var addInput = validateRecordInput_(request.record, null, false);
    var newId = newRecordId_();
    // appendRow 永遠只傳五欄；日期欄保持純 YYYY-MM-DD，ID 寫在日期欄 Note。
    mutationState.started = true;
    sheet.appendRow([
      addInput.date,
      safeCellText_(addInput.type),
      safeCellText_(addInput.category),
      addInput.amount,
      safeCellText_(addInput.note)
    ]);
    var appendedRow = sheet.getLastRow();
    sheet.getRange(appendedRow, 1).setNote(appendLedgerIdToNote_('', newId));
    var added = readRecordAtRow_(sheet, appendedRow, newId);
    return { ok: true, record: publicRecord_(added) };
  }

  var id = validateId_(request.id);
  var revision = validateRevision_(request.revision);
  // 重新掃描目前資料，以 ID 找列；絕不信任前端或先前 list 的 row number。
  var records = readRecordsAndAssignIds_(sheet);
  var current = null;
  for (var i = 0; i < records.length; i += 1) {
    if (records[i].id === id) {
      if (current) {
        throw new Error('資料中有重複的穩定 ID；請先人工修正日期欄的 ledger-id。');
      }
      current = records[i];
    }
  }
  if (!current) {
    throw new Error('找不到指定記錄；請先重新整理清單。');
  }
  if (current.revision !== revision) {
    throw new Error('記錄已被其他人修改；請重新整理後再操作。');
  }

  if (action === 'delete') {
    mutationState.started = true;
    sheet.deleteRow(current._row);
    return { ok: true, deletedId: id };
  }

  var editInput = validateRecordInput_(request.record, current, true);
  mutationState.started = true;
  sheet.getRange(current._row, 1, 1, 5).setValues([[
    editInput.date,
    safeCellText_(editInput.type),
    safeCellText_(editInput.category),
    editInput.amount,
    safeCellText_(editInput.note)
  ]]);
  var edited = readRecordAtRow_(sheet, current._row, id);
  return { ok: true, record: publicRecord_(edited) };
}

function validateRecordInput_(record, existing, isEdit) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new Error('record 必須是物件。');
  }

  var date = validateIsoDate_(record.date);
  var type = String(record.type == null ? '' : record.type).trim();
  if (type !== '支出' && type !== '收入') {
    throw new Error('type 必須是「支出」或「收入」。');
  }

  var category = String(record.category == null ? '' : record.category).trim();
  if (!category) {
    throw new Error('category 不可為空白。');
  }
  if (category.length > 30) {
    throw new Error('category 最多 30 個字元。');
  }

  var amount = validateAmount_(record.amount);
  var note;
  if (Object.prototype.hasOwnProperty.call(record, 'note')) {
    note = normalizeNote_(record.note);
  } else if (isEdit && existing) {
    note = existing.note;
  } else {
    note = '';
  }

  return {
    date: date,
    type: type,
    category: category,
    amount: amount,
    note: note
  };
}

function validateIsoDate_(value) {
  var text = String(value == null ? '' : value).trim();
  var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) {
    throw new Error('date 必須是 YYYY-MM-DD 格式。');
  }
  var year = Number(match[1]);
  var month = Number(match[2]);
  var day = Number(match[3]);
  var date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error('date 不是有效日期。');
  }
  return text;
}

function validateAmount_(value) {
  var text = String(value == null ? '' : value).trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) {
    throw new Error('amount 必須是正數，最多兩位小數。');
  }
  var number = Number(text);
  if (!isFinite(number) || number <= 0 || number > MAX_AMOUNT) {
    throw new Error('amount 必須大於 0 且不可超過 1,000,000,000。');
  }
  return number;
}

function normalizeNote_(value) {
  if (value == null) {
    return '';
  }
  var note = String(value).trim();
  if (note.length > 500) {
    throw new Error('note 最多 500 個字元。');
  }
  return note;
}

function normalizeRequestId_(value) {
  if (typeof value !== 'string') {
    throw new Error('requestId 必須是非空字串。');
  }
  var requestId = value.trim();
  if (!REQUEST_ID_RE.test(requestId)) {
    throw new Error('requestId 必須是 1 至 120 個不可含空白的字元。');
  }
  return requestId;
}

function validateId_(value) {
  if (typeof value !== 'string' || !ID_RE.test(value)) {
    throw new Error('id 格式不合法。');
  }
  return value;
}

function validateRevision_(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{16,200}$/.test(value)) {
    throw new Error('revision 缺少或格式不合法；請從最新 list 結果取得。');
  }
  return value;
}

function readRecordsAndAssignIds_(sheet) {
  ensureHeader_(sheet, false);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return [];
  }

  var values = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
  var dateNotes = sheet.getRange(2, 1, lastRow - 1, 1).getNotes();
  var records = [];
  var writes = [];
  for (var i = 0; i < values.length; i += 1) {
    var row = values[i];
    if (isBlankRow_(row)) {
      continue;
    }
    var rowNumber = i + 2;
    var dateNote = dateNotes[i] && dateNotes[i][0] != null ? dateNotes[i][0] : '';
    var parsed = parseRecordRow_(row, rowNumber, dateNote);
    if (!parsed.id) {
      parsed.id = newRecordId_();
    }
    if (parsed._legacyDate || !parsed._noteId) {
      writes.push({
        row: rowNumber,
        date: parsed.date,
        note: appendLedgerIdToNote_(dateNote, parsed.id),
        stripLegacyDate: parsed._legacyDate
      });
    }
    parsed.revision = makeRevision_(parsed);
    records.push(parsed);
  }

  // 先完成所有驗證，再逐一遷移 legacy 日期值及/或補日期欄 Note；不改動
  // 日期欄 Note 既有文字、備註或其他欄位。真 Date 沒有 ID 時也不重寫日期值。
  for (var w = 0; w < writes.length; w += 1) {
    var writeRange = sheet.getRange(writes[w].row, 1);
    if (writes[w].stripLegacyDate) {
      writeRange.setValue(writes[w].date);
    }
    writeRange.setNote(writes[w].note);
  }
  return records;
}

function parseRecordRow_(row, rowNumber, dateNote) {
  var dateInfo = parseDateCell_(row[0]);
  var noteId = extractIdFromNote_(dateNote);
  if (dateInfo.id && noteId && dateInfo.id !== noteId) {
    throw new Error('第 ' + rowNumber + ' 列的日期欄 Note 與 legacy 日期文字含有不同的穩定 ID。');
  }
  var type = readStoredText_(row[1]).trim();
  if (type !== '支出' && type !== '收入') {
    throw new Error('第 ' + rowNumber + ' 列的類型必須是「支出」或「收入」。');
  }

  var category = readStoredText_(row[2]).trim();
  if (!category || category.length > 30) {
    throw new Error('第 ' + rowNumber + ' 列的分類不可空白且最多 30 個字元。');
  }

  var amount = validateAmount_(row[3]);
  var note = normalizeNote_(readStoredText_(row[4]));
  return {
    _row: rowNumber,
    id: noteId || dateInfo.id,
    _noteId: noteId,
    _legacyDate: dateInfo.legacy,
    date: dateInfo.date,
    type: type,
    category: category,
    amount: amount,
    note: note
  };
}

function readRecordAtRow_(sheet, rowNumber, expectedId) {
  var row = sheet.getRange(rowNumber, 1, 1, 5).getValues()[0];
  var dateNote = sheet.getRange(rowNumber, 1).getNote();
  var parsed = parseRecordRow_(row, rowNumber, dateNote);
  if (expectedId && parsed.id !== expectedId) {
    throw new Error('寫入後無法確認穩定 ID；請重新整理。');
  }
  parsed.revision = makeRevision_(parsed);
  return parsed;
}

function parseDateCell_(value) {
  var id = '';
  var legacy = false;
  var text;
  if (Object.prototype.toString.call(value) === '[object Date]') {
    if (isNaN(value.getTime())) {
      throw new Error('日期欄含有無效日期。');
    }
    text = Utilities.formatDate(value, CONFIG.TIMEZONE, 'yyyy-MM-dd');
  } else {
    text = readStoredText_(value).trim();
    var idMatch = new RegExp('(?:^|\r?\n)' + escapeRegExp_(CONFIG.ID_PREFIX) + '([A-Za-z0-9][A-Za-z0-9_-]{7,99})\\s*$').exec(text);
    if (idMatch) {
      id = idMatch[1];
      legacy = true;
      text = text.slice(0, idMatch.index).trim();
    }
  }
  return { date: validateIsoDate_(text), id: id, legacy: legacy };
}

function extractId_(value) {
  var parsed = parseDateCell_(value);
  return parsed.id;
}

function extractIdFromNote_(note) {
  var text = note == null ? '' : String(note);
  var found = '';
  var lines = text.split(/\r?\n/);
  var idPattern = new RegExp('^\\s*' + escapeRegExp_(CONFIG.ID_PREFIX) + '([A-Za-z0-9][A-Za-z0-9_-]{7,99})\\s*$');
  for (var i = 0; i < lines.length; i += 1) {
    var match = idPattern.exec(lines[i]);
    if (!match) {
      continue;
    }
    if (found && found !== match[1]) {
      throw new Error('日期欄 Note 含有重複且不同的穩定 ID。');
    }
    found = match[1];
  }
  return found;
}

function appendLedgerIdToNote_(note, id) {
  var text = note == null ? '' : String(note);
  var existing = extractIdFromNote_(text);
  if (existing) {
    if (existing !== id) {
      throw new Error('日期欄 Note 已有不同的穩定 ID。');
    }
    return text;
  }
  return text ? text + '\n' + CONFIG.ID_PREFIX + id : CONFIG.ID_PREFIX + id;
}

function findRowById_(sheet, id) {
  var records = readRecordsAndAssignIds_(sheet);
  for (var i = 0; i < records.length; i += 1) {
    if (records[i].id === id) {
      return records[i]._row;
    }
  }
  return null;
}

function newRecordId_() {
  var id = String(Utilities.getUuid());
  if (!ID_RE.test(id)) {
    throw new Error('無法產生合法穩定 ID。');
  }
  return id;
}

function makeRevision_(record) {
  var canonical = JSON.stringify([
    record.id,
    record.date,
    record.type,
    record.category,
    Number(record.amount).toFixed(2),
    record.note
  ]);
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    canonical,
    Utilities.Charset.UTF_8
  );
  var hex = '';
  for (var i = 0; i < bytes.length; i += 1) {
    var byte = bytes[i];
    if (byte < 0) {
      byte += 256;
    }
    hex += ('0' + byte.toString(16)).slice(-2);
  }
  return hex;
}

function publicRecord_(record) {
  return {
    id: record.id,
    date: record.date,
    type: record.type,
    category: record.category,
    amount: Number(record.amount),
    note: record.note,
    revision: record.revision
  };
}

function ensureHeader_(sheet, allowCreate) {
  var lastRow = sheet.getLastRow();
  var lastColumn = sheet.getLastColumn();
  if (!lastRow && !lastColumn) {
    if (allowCreate) {
      sheet.getRange(1, 1, 1, 5).setValues([CONFIG.HEADER.slice()]);
      return;
    }
    throw new Error('找不到標題列；請先手動執行 setup() 建立「日期 | 類型 | 分類 | 金額 | 備註」。');
  }

  var width = Math.max(5, lastColumn || 0);
  var firstRow = sheet.getRange(1, 1, 1, width).getValues()[0];
  var valid = String(firstRow[0] == null ? '' : firstRow[0]).trim() === '日期';
  valid = valid && (String(firstRow[1] == null ? '' : firstRow[1]).trim() === '類型' ||
    String(firstRow[1] == null ? '' : firstRow[1]).trim() === '類型（支出/收入）');
  for (var i = 2; i < CONFIG.HEADER.length; i += 1) {
    valid = valid && String(firstRow[i] == null ? '' : firstRow[i]).trim() === CONFIG.HEADER[i];
  }
  for (var extra = 5; extra < firstRow.length; extra += 1) {
    if (!isBlank_(firstRow[extra])) {
      valid = false;
    }
  }

  if (!valid) {
    var shown = firstRow.map(function (cell) { return String(cell == null ? '' : cell); }).join(' | ');
    throw new Error('試算表標題列不符合。請將第一列設為「日期 | 類型 | 分類 | 金額 | 備註」；程式不會覆蓋既有標題。目前為「' + shown + '」。');
  }

  // 若資料列在第六欄以後有內容，拒絕處理，避免破壞使用者的非五欄資料。
  if (lastRow > 1 && lastColumn > 5) {
    var extraValues = sheet.getRange(2, 6, lastRow - 1, lastColumn - 5).getValues();
    for (var r = 0; r < extraValues.length; r += 1) {
      for (var c = 0; c < extraValues[r].length; c += 1) {
        if (!isBlank_(extraValues[r][c])) {
          throw new Error('試算表必須只有五欄；第 ' + (r + 2) + ' 列含有第六欄以後的內容，程式未修改它。');
        }
      }
    }
  }
}

function isBlankRow_(row) {
  for (var i = 0; i < row.length; i += 1) {
    if (!isBlank_(row[i])) {
      return false;
    }
  }
  return true;
}

function isBlank_(value) {
  return value == null || String(value).trim() === '';
}

function readStoredText_(value) {
  var text = value == null ? '' : String(value);
  // Apps Script 讀取以單引號保護的公式文字時，去掉保護用的單引號再回傳原文字。
  if (text.length > 1 && text.charAt(0) === "'" && /^[=+\-@]/.test(text.charAt(1))) {
    return text.slice(1);
  }
  return text;
}

function safeCellText_(value) {
  var text = String(value == null ? '' : value);
  // 防止 Sheets 把使用者文字當公式；單引號是儲存層的保護，不是資料內容。
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function escapeRegExp_(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function openSpreadsheet_() {
  if (!CONFIG.SPREADSHEET_ID || !String(CONFIG.SPREADSHEET_ID).trim()) {
    throw new Error('請先在 CONFIG.SPREADSHEET_ID 填入 Google 試算表 ID。');
  }
  try {
    return SpreadsheetApp.openById(String(CONFIG.SPREADSHEET_ID).trim());
  } catch (err) {
    throw new Error('無法開啟指定試算表；請確認 SPREADSHEET_ID、權限與部署執行身分。');
  }
}

function getSheet_() {
  var sheet = openSpreadsheet_().getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) {
    throw new Error('找不到工作表「' + CONFIG.SHEET_NAME + '」；請先手動執行 setup()。');
  }
  return sheet;
}

function withMutationLock_(fn) {
  var lock = LockService.getScriptLock();
  var acquired = false;
  try {
    lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
    acquired = true;
    return fn();
  } finally {
    if (acquired) {
      lock.releaseLock();
    }
  }
}

function statusKey_(requestId) {
  return CONFIG.STATUS_PREFIX + encodeURIComponent(requestId);
}

function loadStatus_(requestId) {
  var raw = PropertiesService.getScriptProperties().getProperty(statusKey_(requestId));
  if (!raw) {
    return null;
  }
  try {
    var parsed = JSON.parse(raw);
    if (parsed && (parsed.status === 'pending' || parsed.status === 'done')) {
      return parsed;
    }
  } catch (err) {
    // 破損狀態視為不存在；下一次 mutation 會以相同 requestId 建立新狀態。
  }
  return null;
}

function saveStatus_(requestId, status) {
  PropertiesService.getScriptProperties().setProperty(statusKey_(requestId), JSON.stringify(status));
}

function cleanupStatuses_(now) {
  var properties = PropertiesService.getScriptProperties();
  var all = properties.getProperties();
  var entries = [];
  var keys = Object.keys(all);
  for (var i = 0; i < keys.length; i += 1) {
    var key = keys[i];
    if (key.indexOf(CONFIG.STATUS_PREFIX) !== 0) {
      continue;
    }
    var value;
    try {
      value = JSON.parse(all[key]);
    } catch (err) {
      properties.deleteProperty(key);
      continue;
    }
    var timestamp = Number(value.updatedAt || value.createdAt || 0);
    if (!timestamp || now - timestamp > CONFIG.STATUS_TTL_MS) {
      properties.deleteProperty(key);
      continue;
    }
    entries.push({ key: key, timestamp: timestamp });
  }
  entries.sort(function (a, b) { return a.timestamp - b.timestamp; });
  while (entries.length >= CONFIG.STATUS_MAX) {
    properties.deleteProperty(entries.shift().key);
  }
}

function postStatusResponse_(status) {
  return respond_({
    ok: true,
    status: status.status,
    result: status.status === 'done' ? status.result : null
  }, '');
}

function respond_(payload, callback) {
  var json = JSON.stringify(payload);
  var text = callback ? callback + '(' + json + ');' : json;
  var mime = callback ? ContentService.MimeType.JAVASCRIPT : ContentService.MimeType.JSON;
  return ContentService.createTextOutput(text).setMimeType(mime);
}

function nowIso_() {
  return new Date().toISOString();
}

function errorMessage_(err) {
  if (err && err.message) {
    return String(err.message);
  }
  return String(err || '未知錯誤');
}
