export const DEFAULT_CATEGORIES = ['餐飲', '交通', '購物', '居住', '娛樂', '醫療', '其他'];
export const CATEGORY_STYLES = {
  餐飲: { icon: 'food', color: '#a4b58e', background: '#f4f1e7', ink: '#ab9569' },
  交通: { icon: 'transport', color: '#c4d0b5', background: '#edf2f3', ink: '#88a0a8' },
  購物: { icon: 'shopping', color: '#d9c8ad', background: '#f6ede9', ink: '#c69f85' },
  居住: { icon: 'home', color: '#71906b', background: '#eef2e8', ink: '#90a275' },
  娛樂: { icon: 'entertainment', color: '#b3b89b', background: '#f1eef5', ink: '#a798b5' },
  醫療: { icon: 'health', color: '#d3b9b0', background: '#faefed', ink: '#c99890' },
  其他: { icon: 'other', color: '#d9dfcc', background: '#f1f3ec', ink: '#a0af8d' }
};
export function categoryStyle(name, type = '支出') {
  if (type === '收入') return { icon: 'income', color: '#93b582', background: '#edf4e9', ink: '#829d73' };
  return CATEGORY_STYLES[name] || CATEGORY_STYLES.其他;
}
export function today() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = name => parts.find(part => part.type === name).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function monthShift(month, delta) {
  const [year, value] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, value - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}
export function validDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [year, month, day] = date.split('-').map(Number);
  if (year < 1900 || year > 9999) return false;
  const value = new Date(Date.UTC(year, month - 1, day));
  return value.getUTCFullYear() === year && value.getUTCMonth() === month - 1 && value.getUTCDate() === day;
}
export function validateRecord(record) {
  const amountText = String(record.amount).trim();
  if (!/^(?:\d+)(?:\.\d{1,2})?$/.test(amountText) || !Number.isFinite(Number(amountText)) || Number(amountText) <= 0 || Number(amountText) > 1e9) throw new Error('請輸入大於 0 的金額，最多兩位小數，上限為 10 億。');
  if (!validDate(record.date)) throw new Error('請選擇有效日期。');
  if (!['支出', '收入'].includes(record.type)) throw new Error('請選擇支出或收入。');
  const category = String(record.category || '').trim();
  const note = String(record.note || '').trim();
  if (!category || category.length > 30) throw new Error('分類名稱需為 1 至 30 個字。');
  if (note.length > 500) throw new Error('備註最多 500 個字。');
  return { date: record.date, type: record.type, category, amount: Number(amountText), note };
}
export function cents(amount) { return Math.round(Number(amount) * 100); }
export function formatMoney(amount) {
  return new Intl.NumberFormat('zh-TW', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(amount);
}
export function monthRecords(records, month) {
  return records.filter(record => record.date.startsWith(`${month}-`)).sort((a, b) => b.date.localeCompare(a.date) || String(b.id).localeCompare(String(a.id)));
}
export function summarize(records) {
  let expense = 0, income = 0, expenseCount = 0, incomeCount = 0;
  const categories = new Map();
  for (const record of records) {
    const value = cents(record.amount);
    if (record.type === '支出') { expense += value; expenseCount++; categories.set(record.category, (categories.get(record.category) || 0) + value); }
    else if (record.type === '收入') { income += value; incomeCount++; }
  }
  return { expense: expense / 100, income: income / 100, balance: (income - expense) / 100, expenseCount, incomeCount,
    categories: [...categories.entries()].map(([name, value]) => ({ name, amount: value / 100, percent: expense ? value / expense * 100 : 0 })).sort((a, b) => b.amount - a.amount) };
}
export function filterRecords(records, type, keyword) {
  const query = keyword.trim().toLocaleLowerCase();
  return records.filter(record => (type === 'all' || record.type === type) && (!query || `${record.category} ${record.note} ${record.amount} ${record.date} ${record.type}`.toLocaleLowerCase().includes(query)));
}
export function escapeHTML(value) { return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]); }
export function csv(records) {
  const text = value => {
    let cell = String(value ?? '');
    if (/^[\s\u0000-\u001f]*[=+\-@]/.test(cell)) cell = `'${cell}`;
    return `"${cell.replace(/"/g, '""')}"`;
  };
  return '\uFEFF' + [['日期', '類型', '分類', '金額', '備註'], ...records.map(record => [record.date, record.type, record.category, record.amount, record.note])].map(row => row.map(text).join(',')).join('\r\n');
}
export function seedDemo() {
  const now = today(), month = now.slice(0, 7), day = Number(now.slice(-2));
  const entries = [
    ['餐飲', 165, '巷口的午餐', '支出'], ['交通', 40, '搭捷運去上班', '支出'], ['餐飲', 85, '一杯拿鐵，開啟今天', '支出'],
    ['購物', 690, '換一本喜歡的筆記本', '支出'], ['娛樂', 320, '週末看一場電影', '支出'], ['餐飲', 480, '和朋友的晚餐', '支出'],
    ['居住', 12000, '這個月的房租', '支出'], ['其他', 42000, '十月薪資', '收入'], ['醫療', 200, '日常藥品', '支出'],
    ['交通', 120, '回家的車票', '支出'], ['餐飲', 135, '早餐與午餐', '支出'], ['其他', 1500, '接案收入', '收入']
  ];
  return entries.map(([category, amount, note, type], index) => ({ id: `demo-${String(entries.length - index).padStart(3, '0')}`, revision: 'demo', date: `${month}-${String(Math.max(1, day - Math.floor(index / 2))).padStart(2, '0')}`, type, category, amount, note: note === '十月薪資' ? `${Number(month.slice(-2))}月薪資` : note }));
}
