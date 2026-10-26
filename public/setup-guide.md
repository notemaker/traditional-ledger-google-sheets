# Google Apps Script + Google Sheets 設定指南

本專案的前端是純 HTML/CSS/JavaScript，資料由 Google Apps Script Web App 讀寫 Google Sheets。公開下載的 [`Code.gs`](./Code.gs) 是不含試算表 ID 的模板；正式上傳到 Apps Script 專案時，請使用私用工作區的 `apps-script/Code.gs`，不要把已填入私密 ID 的版本發布到 `public/`。公開 manifest 可下載 [`appsscript.json`](./appsscript.json)；若公開檔案尚未同步，請以 `apps-script/appsscript.json` 為準。

> 目前沒有在本公開指南中放置試算表 ID 或已部署的 `/exec` URL。程式與契約可先用測試完成；線上寫入/讀取整合必須由部署者在自己的 Apps Script 與瀏覽器設定中完成。

## 1. 建立試算表

1. 建立一份新的 Google 試算表，或選擇一份專門給此記帳 App 使用的試算表。
2. 從網址取得試算表 ID。網址通常是：
   `https://docs.google.com/spreadsheets/d/試算表ID/edit`
3. 試算表 ID 只放在私用 Apps Script 的 `CONFIG.SPREADSHEET_ID`；Web App `/exec` URL 只貼在前端本機的「連線設定」或其他未提交的部署設定。不要把 ID、URL 或授權資訊 commit 到公開 repository 或公開原始碼。此 App 不使用額外後端登入。
4. 本程式只使用名稱為 `記帳紀錄` 的工作表。其他工作表不會被讀寫。

## 2. 建立 Apps Script 專案

1. 在試算表開啟「擴充功能 → Apps Script」，或到 Apps Script 建立獨立專案。
2. 私用部署請將工作區的 `apps-script/Code.gs` 全部貼入 `Code.gs`。公開下載的 [`Code.gs`](./Code.gs) 沒有試算表 ID；若只能使用公開模板，請只在 Apps Script 編輯器內填入 ID，切勿把填妥的檔案重新放回公開 source。
3. 在程式最上方確認私用部署的設定（私用工作區版本可能已由部署者預先填妥）：

   ```js
   SPREADSHEET_ID: '貼上你的試算表 ID'
   ```

   `SHEET_NAME` 保持 `記帳紀錄`，`TIMEZONE` 保持 `Asia/Taipei`。不要把這個已填 ID 的檔案同步到 `public/Code.gs` 或前端。
4. 如果使用獨立 Apps Script 專案，將 [`appsscript.json`](./appsscript.json)（或 `apps-script/appsscript.json`）內容放入專案 manifest，確保使用 V8 與台北時區。若編輯器沒有顯示 manifest，請到「專案設定」啟用「在編輯器中顯示 appsscript.json」。
5. 儲存專案。

## 3. 第一次授權與建立標題

1. 在 Apps Script 編輯器的函式選單選 `setup`，按「執行」。
2. 第一次執行會要求授權，請以部署時要使用的 Google 帳戶完成授權。
3. `setup()` 若找不到 `記帳紀錄`，會建立該工作表；若工作表是空的，會建立唯一標題列：

   ```text
   日期 | 類型 | 分類 | 金額 | 備註
   ```

   它不會覆蓋既有標題或資料。既有第二欄標題為 `類型（支出/收入）` 也可通過檢查，但新建標題使用 `類型`。
4. 若標題不符，程式會回傳可操作的錯誤並停止，不會擅自覆蓋。請先人工將第一列修正為上述五欄。
5. 不需要建立觸發器。

## 4. 部署 Web App

1. 在 Apps Script 按右上角「部署 → 新增部署」。
2. 類型選「網頁應用程式」。
3. 「執行身分」選「我」。
4. 「誰可以存取」選「任何人」。
5. 按「部署」，完成授權後複製以 `/exec` 結尾的 Web App URL。前端應使用 `/exec`，不要使用 `/dev`。
6. 每次更新程式後，建立新版本並更新既有部署；不要把測試中的 `/dev` URL 當正式 URL。

官方參考：

- [Google Apps Script Web Apps](https://developers.google.com/apps-script/guides/web)
- [Spreadsheet service](https://developers.google.com/apps-script/reference/spreadsheet)
- [Lock service](https://developers.google.com/apps-script/reference/lock)
- [Properties service](https://developers.google.com/apps-script/reference/properties)

## 5. 網頁連線設定

1. 開啟前端網頁，從側欄選「連線設定」，或按示範模式上方的「連接試算表」。
2. 將剛才部署的正式 Web App `/exec` 網址貼入「Apps Script Web App 網址」欄位。請使用完整的 `https://script.google.com/macros/s/…/exec`，不要貼 `/dev` 網址，也不要貼試算表網址。
3. 按「測試並連接試算表」。前端會先讀取 `action=list`；成功時會顯示「連線成功，正在使用試算表的真實記錄」，上方狀態會顯示「Google 試算表已連線」，且列表會出現試算表資料。
4. 這個測試只讀取，不會新增資料。確認成功後，再用「新增記錄」建立一筆測試資料，回到 Google 試算表確認新增；若要測試編輯與刪除，先確認該筆資料與日期欄 Note 的 stable ID 都存在。
5. `/exec` URL 等同資料存取能力。只留在自己的瀏覽器本機連線設定或未提交的部署設定，不要寫入公開前端原始碼、README、commit 或截圖。示範資料與試算表資料分開保存。

## 6. 連線協定

### GET `action=list`

```text
GET https://script.google.com/macros/s/部署ID/exec?action=list
```

成功回應：

```json
{
  "ok": true,
  "records": [
    {
      "id": "UUID",
      "date": "2026-10-26",
      "type": "支出",
      "category": "餐飲",
      "amount": 120,
      "note": "午餐",
      "revision": "sha256-hex"
    }
  ],
  "updatedAt": "2026-10-26T04:00:00.000Z"
}
```

`date` 一律回傳 `YYYY-MM-DD`；既有 Google Sheets 日期值會依 `Asia/Taipei` 正規化。`amount` 是有效正數，最多兩位小數且不超過 1,000,000,000。

### GET `action=status&requestId=...`

```text
GET https://script.google.com/macros/s/部署ID/exec?action=status&requestId=client-generated-uuid
```

處理中：

```json
{"ok":true,"status":"pending","result":null}
```

requestId 格式有效、但狀態尚未進入 Script Properties（例如 status 輪詢剛好早於 POST 取得鎖）時，也回傳上面的處理中形狀，避免前端誤清除本機 pending。requestId 格式本身不合法仍會回傳錯誤；狀態尚未找到不能推定寫入一定沒有發生。

完成且新增/編輯成功：

```json
{
  "ok": true,
  "status": "done",
  "result": { "ok": true, "record": { "id": "...", "revision": "..." } }
}
```

完成且刪除成功：

```json
{
  "ok": true,
  "status": "done",
  "result": { "ok": true, "deletedId": "..." }
}
```

驗證或衝突失敗仍會保存狀態：

```json
{
  "ok": true,
  "status": "done",
  "result": { "ok": false, "error": "記錄已被其他人修改；請重新整理後再操作。" }
}
```

狀態只保留 24 小時，最多保留 200 筆；舊狀態會在下一次 mutation 前清理。`requestId` 應使用前端產生的唯一 UUID，且不可含空白、最長 120 字元。

### JSONP

GET 的 `list` 與 `status` 可加 `callback`：

```text
GET .../exec?action=list&callback=LedgerCallbacks_receive
```

為避免 JSONP 注入，`callback` 僅接受單一 JavaScript 識別字；`LedgerCallbacks.receive` 這種含點號的 callback 不會通過目前的嚴格規則，請使用 `LedgerCallbacks_receive` 這類安全名稱。JSONP 絕不支援 add/edit/delete，也不會讓 GET 執行 mutation。

### POST mutation

瀏覽器使用 `fetch` 搭配 `mode: 'no-cors'`、`Content-Type: text/plain` 發送 JSON；由於 no-cors response 是 opaque，發送後請用上述 JSONP `status` 輪詢。每次請求都必須帶新的 `requestId`。

新增：

```json
{
  "action": "add",
  "requestId": "client-generated-uuid",
  "record": {
    "date": "2026-10-26",
    "type": "支出",
    "category": "餐飲",
    "amount": 120.5,
    "note": "午餐"
  }
}
```

編輯必須帶最新 `id` 與 `revision`，而且 `record` 至少包含 `date`、`type`、`category`、`amount`；省略 `note` 會保留原備註：

```json
{
  "action": "edit",
  "requestId": "client-generated-uuid",
  "id": "既有記錄的 id",
  "revision": "list 回傳的 revision",
  "record": {
    "date": "2026-10-26",
    "type": "支出",
    "category": "交通",
    "amount": 35,
    "note": "公車"
  }
}
```

刪除必須帶最新 `id` 與 `revision`：

```json
{
  "action": "delete",
  "requestId": "client-generated-uuid",
  "id": "既有記錄的 id",
  "revision": "list 回傳的 revision"
}
```

## 7. 資料與併發安全行為

- 實際欄位永遠只有五欄：日期、類型、分類、金額、備註。`appendRow` 永遠只傳五個值。
- 每列的穩定 `id` 儲存在日期欄儲存格的 Note，以獨立一行 `ledger-id:UUID` 保存；日期欄的值永遠是純 `YYYY-MM-DD`，不把 ID 拼進日期字串。補 ID 時會保留日期欄 Note 原有的使用者文字並在末尾追加 metadata，也不會改既有備註。舊版若曾把 `ledger-id:` 寫在日期值換行中，`list` 只會將這種 legacy 列遷移到 Note 並把日期值還原為純日期；真 Date 值不會被重寫。
- `list` 會在 ScriptLock 內替沒有 ID 的舊列補 ID；這是唯一允許 GET 產生的資料變更。其他 GET 只讀取。
- add/edit/delete 都在 ScriptLock 內執行，並以 ID 重新掃描目前列位置；不依賴前端上一次 list 的舊 row number。
- edit/delete 會比對 `revision`（目前記錄內容的 SHA-256 指紋）。有人先修改同一列時，操作會回傳衝突錯誤，不會覆蓋或刪除新資料。
- requestId 會在 Script Properties 保存 pending/done 結果。同一 requestId 重送會回傳原結果，不會再次 `appendRow`。若 `appendRow`、日期 Note 寫入、`setValues`、`deleteRow` 或其後的讀回確認已開始而發生例外，狀態會保留 `pending`（內部標記 `uncertain`），不會保存明確的 done/error，避免前端誤判可安全重試。
- `pending/uncertain` 不會自動重試。請先人工核對試算表是否已寫入，最多在狀態保留期限前約 23 小時完成核對；確認後才可清除本機 pending 或另行處理。不要在人工核對前再次送出相同業務操作，以免重複新增。
- 日期會檢查真實日曆日期（例如 `2026-02-30` 會拒絕）；分類去除首尾空白後最多 30 字元；備註去除首尾空白後最多 500 字元；金額必須為正的有限數字、最多兩位小數、上限 10 億。
- 以 `=`, `+`, `-`, `@` 開頭的文字會在寫入儲存格前加上單引號，避免被 Google Sheets 當成公式。

## 8. 公開 URL 的重要限制

這個設計**沒有登入，也沒有額外 secret token**。把 Web App 部署成「任何人」後，任何取得 `/exec` URL 的人都能讀取記帳資料，也能送出新增、編輯與刪除請求。請把試算表與 `/exec` URL 視為私密能力連結：

- 試算表 ID 只放在私用 Apps Script；`/exec` URL 只放在你信任的前端本機或未提交部署設定中，不要 commit 或公開分享。
- 試算表本身建議不要對外分享；Web App 是以部署者身分存取它。
- JSONP 只能使用可信任的 HTTPS `script.google.com` `/exec` endpoint；不要把未知來源的 URL 當作 JSONP 腳本載入。
- 若需要真正的使用者登入、細緻權限或防濫用，應改用具備驗證與伺服器端 secret 管理的後端；本專案刻意不提供那些功能。
- Apps Script 的 quota、Google Sheets 併發限制與公開 URL 被濫用的風險仍然存在。
