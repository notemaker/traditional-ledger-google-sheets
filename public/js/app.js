import { DEFAULT_CATEGORIES, categoryStyle, today, monthShift, validateRecord, formatMoney, monthRecords, summarize, filterRecords, escapeHTML, csv, seedDemo } from './core.js';
import { icon, hydrateIcons } from './icons.js';
import { normalizeEndpoint, readCloud, sendCloud, waitForReceipt } from './api.js';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const storage = {
  get(key, fallback) { try { return JSON.parse(localStorage.getItem(`ledger:${key}`)) ?? fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(`ledger:${key}`, JSON.stringify(value)); return true; } catch { return false; } },
  remove(key) { try { localStorage.removeItem(`ledger:${key}`); } catch { /* storage is unavailable */ } }
};
const initialDemo = storage.get('demo', null);
const storedCategories = storage.get('categories', []);
const savedEndpoint = storage.get('endpoint', '');
const state = {
  records: [], month: today().slice(0, 7), filter: 'all', query: '', limit: 30,
  endpoint: '', connected: false, busy: false, loading: false, loadFailed: false,
  demo: Array.isArray(initialDemo) ? initialDemo : seedDemo(),
  customCategories: Array.isArray(storedCategories) ? storedCategories.filter(value => typeof value === 'string' && value.trim() && value.length <= 30 && !DEFAULT_CATEGORIES.includes(value)) : [],
  type: '支出', category: storage.get('lastCategory', '餐飲'), editing: null, deleting: null, pending: storage.get('pending', null), formPayload: null
};
try { if (savedEndpoint) state.endpoint = normalizeEndpoint(savedEndpoint); } catch { storage.remove('endpoint'); }
if (!initialDemo) storage.set('demo', state.demo);
let popover, toastTimer;

function categories() {
  return [...new Set([...DEFAULT_CATEGORIES, ...state.customCategories, ...state.records.map(record => record.category)])];
}
function notify(message) {
  $('#toast').textContent = message; $('#toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 4500);
}
function showError(selector, error) {
  const element = $(selector); element.hidden = !error; element.textContent = error?.message || error || '';
}
function setConnectionStatus(label, className = '') {
  const button = $('#connectionStatus'); button.className = `connection-status ${className}`; button.querySelector('span').textContent = label;
}
function modeUI() {
  const cloud = Boolean(state.endpoint);
  $('#modeBanner').hidden = cloud;
  $('#disconnectBtn').hidden = !cloud;
  $('#formHint').textContent = cloud ? '收到 Google 寫入確認後，這一筆才會顯示在列表。' : '示範模式：這一筆只會保存在目前瀏覽器。';
  if (!cloud) { setConnectionStatus('示範模式'); $('#syncTime').textContent = '示範資料僅保存在這台裝置'; }
  else if (state.loading) setConnectionStatus('正在讀取…');
  else if (state.loadFailed) setConnectionStatus('連線待確認', 'error');
  else if (state.connected) setConnectionStatus('Google 試算表已連線', 'connected');
  else setConnectionStatus('尚未讀取');
  $$('.add-record').forEach(button => { button.disabled = state.busy || state.loading || Boolean(state.pending) || (cloud && !state.connected); });
  $('#refreshBtn').disabled = state.busy || state.loading;
  $('#refreshBtn').classList.toggle('rotating', state.loading);
  $('#exportBtn').disabled = state.loading;
}
function render() {
  const month = monthRecords(state.records, state.month);
  const totals = summarize(month);
  const filtered = filterRecords(month, state.filter, state.query);
  const [year, value] = state.month.split('-');
  $('#monthLabel').textContent = `${year} 年 ${Number(value)} 月`;
  $('#monthInput').value = state.month;
  $('#monthHint').textContent = state.month === today().slice(0, 7) ? '掌握這個月的收支' : '回顧這個月的日常';
  $('#totalExpense').textContent = formatMoney(totals.expense);
  $('#totalIncome').textContent = formatMoney(totals.income);
  $('#totalBalance').textContent = formatMoney(totals.balance);
  $('#expenseCount').textContent = `${totals.expenseCount} 筆支出記錄`;
  $('#incomeCount').textContent = `${totals.incomeCount} 筆收入記錄`;
  $('#recordCount').textContent = `${state.month === today().slice(0, 7) ? '本月' : Number(value) + ' 月'} ${month.length} 筆記錄`;
  $('#donutTotal').textContent = `$${formatMoney(totals.expense)}`;
  let current = 0;
  const stops = totals.categories.map(category => {
    const start = current; current += category.percent;
    return `${categoryStyle(category.name).color} ${start}% ${current}%`;
  });
  $('#donut').style.background = stops.length ? `conic-gradient(${stops.join(',')})` : '#edf0e7';
  $('#donut').setAttribute('aria-label', totals.categories.length ? totals.categories.map(category => `${category.name} ${formatMoney(category.amount)} 元，${category.percent.toFixed(1)}%`).join('；') : '本月尚無支出');
  $('#categoryLegend').innerHTML = totals.categories.length ? totals.categories.map(category => `<div class="legend-row"><span class="legend-dot" style="background:${categoryStyle(category.name).color}"></span><span class="legend-name">${escapeHTML(category.name)}</span><span class="legend-amount">$${formatMoney(category.amount)}</span><span class="legend-percent">${Math.round(category.percent)}%</span></div>`).join('') : '<div class="legend-row">還沒有支出，留一點空白給日常。</div>';
  const visible = filtered.slice(0, state.limit);
  if (state.loading && !state.records.length) $('#recordList').innerHTML = `<div class="empty-state"><div class="empty-icon rotating">${icon('refresh')}</div>正在從 Google 試算表讀取…<p>第一次連線可能需要幾秒鐘。</p></div>`;
  else if (!visible.length) $('#recordList').innerHTML = `<div class="empty-state"><div class="empty-icon">${icon(state.loadFailed ? 'info' : 'ledger')}</div>${state.loadFailed && !state.records.length ? '尚未取得試算表記錄' : month.length ? '沒有符合的記錄' : '這個月，還是一張空白頁'}<p>${state.loadFailed ? '請檢查連線設定，再按重新讀取。' : month.length ? '試試其他分類或關鍵字。' : '從今天的一筆開始，慢慢記下你的日常。'}</p>${!month.length && !state.loadFailed ? '<button class="text-button" data-empty-add>記下第一筆 ' + icon('arrow-right') + '</button>' : ''}</div>`;
  else $('#recordList').innerHTML = visible.map(record => {
    const style = categoryStyle(record.category, record.type);
    const [recordYear, recordMonth, day] = record.date.split('-');
    return `<article class="record-row"><div class="record-main"><span class="category-icon" style="background:${style.background};color:${style.ink}">${icon(style.icon)}</span><div class="record-text"><div class="record-title" title="${escapeHTML(record.note || record.category)}">${escapeHTML(record.note || record.category)}</div><div class="record-sub">${escapeHTML(record.category)}<span> · ${escapeHTML(record.type)}</span></div></div></div><time class="record-date" datetime="${escapeHTML(record.date)}" title="${escapeHTML(recordYear)} 年">${recordMonth} 月 ${day} 日</time><div class="record-amount ${record.type === '收入' ? 'is-income' : ''}">${record.type === '收入' ? '+' : '−'} $${formatMoney(record.amount)}</div><button class="row-menu-button" data-record-menu="${escapeHTML(record.id)}" aria-label="操作 ${escapeHTML(record.note || record.category)} 這筆記錄" aria-haspopup="menu" ${state.busy || state.loading || state.pending ? 'disabled' : ''}>${icon('more')}</button></article>`;
  }).join('');
  const filteredTotal = summarize(filtered);
  const filterActive = state.filter !== 'all' || state.query;
  $('#listFooter').innerHTML = `<span>${filterActive ? `符合 ${filtered.length} 筆 · 收入 $${formatMoney(filteredTotal.income)} / 支出 $${formatMoney(filteredTotal.expense)}` : `共 ${month.length} 筆記錄 · 依日期由新到舊排列`}</span>${filtered.length > state.limit ? '<button class="text-button" id="loadMore">顯示更多</button>' : `<span>${state.endpoint ? '試算表記錄' : '示範記錄'}</span>`}`;
  $('#loadMore')?.addEventListener('click', () => { state.limit += 30; render(); });
  $('[data-empty-add]')?.addEventListener('click', () => openRecord());
  modeUI();
}
function renderPicker() {
  const list = categories();
  if (!list.includes(state.category)) state.category = '餐飲';
  $('#categoryPicker').innerHTML = list.map(category => `<button class="category-choice ${state.category === category ? 'selected' : ''}" type="button" data-category="${escapeHTML(category)}" aria-pressed="${state.category === category}">${icon(categoryStyle(category).icon)}<span>${escapeHTML(category)}</span></button>`).join('');
  $$('#categoryPicker [data-category]').forEach(button => button.addEventListener('click', () => { state.category = button.dataset.category; renderPicker(); }));
}
function renderCategories() {
  $('#manageCategoryList').innerHTML = [...DEFAULT_CATEGORIES, ...state.customCategories].map(category => `<div class="managed-category">${icon(categoryStyle(category).icon)}<span>${escapeHTML(category)}</span>${DEFAULT_CATEGORIES.includes(category) ? '<small>內建</small>' : `<button data-remove-category="${escapeHTML(category)}" aria-label="移除分類 ${escapeHTML(category)}">${icon('x')}</button>`}</div>`).join('');
  $$('[data-remove-category]').forEach(button => button.addEventListener('click', () => {
    state.customCategories = state.customCategories.filter(category => category !== button.dataset.removeCategory);
    storage.set('categories', state.customCategories); renderCategories();
    if ($('#recordDialog').open) renderPicker();
    notify('已從自訂清單移除，既有記錄的分類仍保留。');
  }));
}
function showDialog(id) { removePopover(); $(id).showModal(); }
function openRecord(record = null) {
  if (state.busy || state.loading || state.pending || (state.endpoint && !state.connected)) { notify(state.pending ? '上一筆仍在等待確認，請先重新讀取。' : '請先確認試算表連線。'); return; }
  state.editing = record; state.formPayload = null;
  state.type = record?.type || '支出';
  state.category = record?.category || storage.get('lastCategory', '餐飲');
  $('#recordForm').reset();
  $('#amountInput').value = record ? String(record.amount) : '';
  $('#dateInput').value = record?.date || today();
  $('#noteInput').value = record?.note || '';
  $('#recordDialogTitle').textContent = record ? '調整這一筆' : '記下這一筆';
  $('#saveRecordBtn').innerHTML = icon('check') + `<span>${record ? '儲存修改' : '儲存記錄'}</span>`;
  $$('[data-type]').forEach(button => { button.classList.toggle('selected', button.dataset.type === state.type); button.setAttribute('aria-pressed', String(button.dataset.type === state.type)); });
  showError('#formError', null); renderPicker(); showDialog('#recordDialog');
  requestAnimationFrame(() => { $('#amountInput').focus(); if (record) $('#amountInput').select(); });
}
function removePopover() { popover?.remove(); popover = null; }
function openMenu(id, anchor) {
  removePopover();
  const record = state.records.find(value => value.id === id); if (!record) return;
  popover = document.createElement('div'); popover.className = 'row-popover'; popover.setAttribute('role', 'menu');
  popover.innerHTML = `<button role="menuitem" data-edit>${icon('edit')}編輯記錄</button><button role="menuitem" data-delete>${icon('trash')}刪除記錄</button>`;
  document.body.append(popover);
  const bounds = anchor.getBoundingClientRect();
  popover.style.left = `${Math.max(8, Math.min(window.innerWidth - 144, bounds.right - 132))}px`;
  popover.style.top = `${Math.min(window.innerHeight - 103, bounds.bottom + 4)}px`;
  popover.querySelector('[data-edit]').addEventListener('click', () => openRecord(record));
  popover.querySelector('[data-delete]').addEventListener('click', () => openDelete(record));
  popover.querySelector('button').focus();
}
function openDelete(record) {
  state.deleting = record;
  $('#deleteDescription').textContent = `${record.date} · ${record.category} · $${formatMoney(record.amount)}`;
  showError('#deleteError', null); showDialog('#deleteDialog');
}
function setBusy(busy) {
  state.busy = busy;
  $('#saveRecordBtn').disabled = busy;
  $('#confirmDeleteBtn').disabled = busy;
  $('#connectBtn').disabled = busy;
  $('#disconnectBtn').disabled = busy;
  $$('.sheet-form input,.sheet-form [data-type],.sheet-form .category-choice,.sheet-form #formManageCategories').forEach(element => { element.disabled = busy; });
  $$('[data-close]').forEach(button => { button.disabled = busy; });
  modeUI();
}
function clearPending() { state.pending = null; storage.remove('pending'); }
function applyReceipt(payload, result) {
  if (payload.action === 'delete') state.records = state.records.filter(record => record.id !== (result.deletedId || payload.id));
  else if (result.record) {
    state.records = state.records.filter(record => record.id !== result.record.id);
    state.records.push(result.record);
  }
}
async function mutate(payload) {
  if (!state.endpoint) {
    let nextDemo;
    if (payload.action === 'delete') nextDemo = state.demo.filter(record => record.id !== payload.id);
    else if (payload.action === 'edit') nextDemo = state.demo.map(record => record.id === payload.id ? { ...record, ...payload.record } : record);
    else nextDemo = [...state.demo, { ...payload.record, id: `demo-${Date.now()}-${crypto.randomUUID()}`, revision: 'demo' }];
    if (!storage.set('demo', nextDemo)) throw new Error('瀏覽器無法保存示範資料，請允許網站使用本機儲存空間。');
    state.demo = nextDemo;
    state.records = [...state.demo]; return;
  }
  state.pending = { endpoint: state.endpoint, payload, createdAt: Date.now() };
  if (!storage.set('pending', state.pending)) { state.pending = null; throw new Error('無法保存待確認狀態，請允許本機儲存後再試。'); }
  try {
    const receipt = await sendCloud(state.endpoint, payload);
    applyReceipt(payload, receipt); clearPending();
    state.connected = true; state.loadFailed = false;
    $('#loadMessage').hidden = true;
    $('#syncTime').textContent = `已寫入試算表 · ${new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}`;
  } catch (error) {
    if (!error.pending) clearPending();
    throw error;
  }
}
async function reloadCloud({ recover = true } = {}) {
  if (state.loading || state.busy) return;
  if (!state.endpoint) { state.records = [...state.demo]; render(); notify('已更新示範記錄。'); return; }
  state.loading = true; state.loadFailed = false;
  $('#loadMessage').hidden = true; render();
  try {
    if (recover && state.pending && state.pending.endpoint === state.endpoint) {
      if (Date.now() - state.pending.createdAt > 23 * 60 * 60 * 1000) {
        // Receipt retention is finite. Read the sheet without ever automatically repeating POST.
        clearPending(); notify('待確認記錄已超過一天，請先在試算表核對是否已儲存。');
      } else {
        try {
          const receipt = await waitForReceipt(state.endpoint, state.pending.payload.requestId);
          applyReceipt(state.pending.payload, receipt); clearPending();
          if ($('#recordDialog').open) $('#recordDialog').close();
          if ($('#deleteDialog').open) $('#deleteDialog').close();
          notify('已取得上一筆記錄的 Google 確認。');
        } catch (error) {
          if (!error.pending) clearPending();
          $('#loadMessage').textContent = error.message; $('#loadMessage').hidden = false;
        }
      }
    }
    const data = await readCloud(state.endpoint);
    state.records = data.records; state.connected = true;
    $('#syncTime').textContent = `最近讀取 · ${new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}`;
  } catch (error) {
    state.loadFailed = true;
    $('#loadMessage').textContent = `${error.message}${state.records.length ? ' 目前顯示的是上次成功讀取的記錄。' : ''}`;
    $('#loadMessage').hidden = false;
  } finally { state.loading = false; render(); }
}

hydrateIcons();
state.records = state.endpoint ? [] : [...state.demo];
render();
$('.brand').addEventListener('click', event => { event.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
$$('.add-record').forEach(button => button.addEventListener('click', () => openRecord()));
$$('[data-close]').forEach(button => button.addEventListener('click', () => { if (!state.busy) $(`#${button.dataset.close}`).close(); }));
$$('dialog').forEach(dialog => {
  dialog.addEventListener('cancel', event => { if (state.busy) event.preventDefault(); });
  dialog.addEventListener('click', event => { if (event.target === dialog && !state.busy) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); } });
});
$$('[data-type]').forEach(button => button.addEventListener('click', () => {
  state.type = button.dataset.type;
  $$('[data-type]').forEach(item => { item.classList.toggle('selected', item.dataset.type === state.type); item.setAttribute('aria-pressed', String(item.dataset.type === state.type)); });
}));
$('#recordForm').addEventListener('submit', async event => {
  event.preventDefault(); if (state.busy || state.pending) return;
  showError('#formError', null);
  let record;
  try { record = validateRecord({ amount: $('#amountInput').value, type: state.type, category: state.category, date: $('#dateInput').value, note: $('#noteInput').value }); }
  catch (error) { showError('#formError', error); return; }
  const payload = { action: state.editing ? 'edit' : 'add', requestId: crypto.randomUUID(), record, ...(state.editing ? { id: state.editing.id, revision: state.editing.revision } : {}) };
  setBusy(true); $('#saveRecordBtn').innerHTML = icon('refresh') + '<span>正在儲存…</span>';
  try {
    await mutate(payload);
    storage.set('lastCategory', record.category);
    state.month = record.date.slice(0, 7); state.query = ''; state.filter = 'all'; state.limit = 30;
    $('#searchInput').value = ''; $$('[data-filter]').forEach(button => button.classList.toggle('selected', button.dataset.filter === 'all'));
    $('#recordDialog').close();
    notify(state.endpoint ? '已確認儲存至 Google 試算表。' : '已儲存示範記錄，尚未寫入試算表。');
  } catch (error) { showError('#formError', error); }
  finally { setBusy(false); $('#saveRecordBtn').innerHTML = icon('check') + `<span>${state.pending ? '等待確認，請先重新讀取' : state.editing ? '儲存修改' : '儲存記錄'}</span>`; $('#saveRecordBtn').disabled = Boolean(state.pending); render(); }
});
$('#confirmDeleteBtn').addEventListener('click', async () => {
  if (state.busy || !state.deleting || state.pending) return;
  setBusy(true); showError('#deleteError', null); $('#confirmDeleteBtn').textContent = '正在刪除…';
  try {
    await mutate({ action: 'delete', requestId: crypto.randomUUID(), id: state.deleting.id, revision: state.deleting.revision });
    $('#deleteDialog').close(); notify(state.endpoint ? '已從 Google 試算表刪除此記錄。' : '已刪除示範記錄。');
  } catch (error) { showError('#deleteError', error); }
  finally { setBusy(false); $('#confirmDeleteBtn').textContent = '確定刪除'; render(); }
});
$('#recordList').addEventListener('click', event => { const button = event.target.closest('[data-record-menu]'); if (button) { event.stopPropagation(); openMenu(button.dataset.recordMenu, button); } });
document.addEventListener('click', event => { if (popover && !popover.contains(event.target)) removePopover(); });
window.addEventListener('scroll', removePopover, true);
window.addEventListener('resize', removePopover);
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') removePopover();
  if (event.key.toLowerCase() === 'n' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.repeat && !event.target.closest('input,textarea,[contenteditable="true"]') && !$$('dialog').some(dialog => dialog.open)) { event.preventDefault(); openRecord(); }
});
$$('[data-filter]').forEach(button => button.addEventListener('click', () => { state.filter = button.dataset.filter; state.limit = 30; $$('[data-filter]').forEach(item => item.classList.toggle('selected', item === button)); render(); }));
$('#searchInput').addEventListener('input', event => { state.query = event.target.value; state.limit = 30; render(); });
$('#prevMonth').addEventListener('click', () => { state.month = monthShift(state.month, -1); state.limit = 30; render(); });
$('#nextMonth').addEventListener('click', () => { state.month = monthShift(state.month, 1); state.limit = 30; render(); });
$('#monthInput').addEventListener('change', event => { if (/^\d{4}-\d{2}$/.test(event.target.value)) { state.month = event.target.value; state.limit = 30; render(); } });
$('#refreshBtn').addEventListener('click', () => reloadCloud());
$('#exportBtn').addEventListener('click', () => {
  const records = filterRecords(monthRecords(state.records, state.month), state.filter, state.query);
  if (!records.length) { notify('目前沒有可以匯出的記錄。'); return; }
  const url = URL.createObjectURL(new Blob([csv(records)], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${state.endpoint ? '日常記帳' : '示範記帳'}-${state.month}.csv`; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000); notify(`已匯出目前篩選的 ${records.length} 筆記錄。`);
});
function openCategories() { renderCategories(); showError('#categoryError', null); showDialog('#categoryDialog'); }
$('#formManageCategories').addEventListener('click', openCategories);
$('#categoryForm').addEventListener('submit', event => {
  event.preventDefault(); const name = $('#categoryName').value.trim();
  if (!name || name.length > 30) { showError('#categoryError', '請輸入 1 至 30 個字的分類名稱。'); return; }
  if ([...DEFAULT_CATEGORIES, ...state.customCategories].includes(name)) { showError('#categoryError', '這個分類已經存在。'); return; }
  state.customCategories.push(name);
  if (!storage.set('categories', state.customCategories)) { state.customCategories.pop(); showError('#categoryError', '瀏覽器無法保存分類，請允許本機儲存空間。'); return; }
  $('#categoryForm').reset(); showError('#categoryError', null); renderCategories();
  if ($('#recordDialog').open) { state.category = name; renderPicker(); }
  notify(`已新增「${name}」分類。`);
});
function openSettings() {
  if (state.busy) return;
  $('#endpointInput').value = state.endpoint; showError('#settingsError', null); showDialog('#settingsDialog');
}
$('#connectionStatus').addEventListener('click', openSettings);
$('#bannerConnect').addEventListener('click', openSettings);
$$('[data-nav]').forEach(button => button.addEventListener('click', () => {
  if (button.dataset.nav === 'categories') openCategories();
  else if (button.dataset.nav === 'settings') openSettings();
  else $(button.dataset.nav === 'analysis' ? '#analysisPanel' : '#recordsPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}));
$('#settingsForm').addEventListener('submit', async event => {
  event.preventDefault(); if (state.busy) return;
  showError('#settingsError', null);
  if (state.loading) { showError('#settingsError', '目前正在讀取資料，請完成後再測試或更換連線。'); return; }
  let endpoint;
  try { endpoint = normalizeEndpoint($('#endpointInput').value); } catch (error) { showError('#settingsError', error); return; }
  if (state.pending && endpoint !== state.pending.endpoint) { showError('#settingsError', '尚有一筆等待確認，請先重新讀取原試算表再更換連線。'); return; }
  setBusy(true); $('#connectBtn').innerHTML = icon('refresh') + '<span>正在測試連線…</span>';
  try {
    const data = await readCloud(endpoint);
    if (!storage.set('endpoint', endpoint)) throw new Error('瀏覽器無法保存連線網址，請允許本機儲存後再試。');
    state.endpoint = endpoint; state.records = data.records; state.connected = true; state.loadFailed = false;
    state.query = ''; state.filter = 'all'; $('#searchInput').value = ''; $$('[data-filter]').forEach(button => button.classList.toggle('selected', button.dataset.filter === 'all'));
    $('#loadMessage').hidden = true; $('#syncTime').textContent = '已連接你的 Google 試算表'; $('#settingsDialog').close(); notify('連線成功，正在使用試算表的真實記錄。');
  } catch (error) { showError('#settingsError', error); }
  finally { setBusy(false); $('#connectBtn').innerHTML = icon('link') + '<span>測試並連接試算表</span>'; render(); }
});
$('#disconnectBtn').addEventListener('click', () => {
  if (state.busy) return;
  if (state.loading) { showError('#settingsError', '目前正在讀取資料，請完成後再中斷連線。'); return; }
  if (state.pending) { showError('#settingsError', '尚有一筆等待確認，請先重新讀取確認後再中斷連線。'); return; }
  storage.remove('endpoint'); state.endpoint = ''; state.connected = false; state.loadFailed = false; state.records = [...state.demo];
  $('#settingsDialog').close(); $('#loadMessage').hidden = true; render(); notify('已切換至示範模式，試算表資料不會被刪除。');
});
if (state.endpoint) reloadCloud();
