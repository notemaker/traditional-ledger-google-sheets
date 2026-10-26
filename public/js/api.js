export function normalizeEndpoint(value) {
  let url;
  try { url = new URL(value.trim()); } catch { throw new Error('請輸入有效的 Apps Script Web App 網址。'); }
  if (url.protocol !== 'https:' || url.hostname !== 'script.google.com' || !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.pathname) || url.username || url.password || url.port) throw new Error('請使用 https://script.google.com/macros/s/…/exec 的正式部署網址。');
  url.search = ''; url.hash = '';
  return url.toString();
}
export function jsonp(endpoint, parameters, timeout = 18000) {
  return new Promise((resolve, reject) => {
    const callback = `ledger_${crypto.randomUUID().replace(/-/g, '')}`;
    const script = document.createElement('script');
    const url = new URL(normalizeEndpoint(endpoint));
    Object.entries({ ...parameters, callback, _: Date.now() }).forEach(([key, value]) => url.searchParams.set(key, String(value)));
    const cleanup = () => {
      clearTimeout(timer); script.remove();
      // Late network responses become harmless no-ops instead of calling a missing function.
      window[callback] = () => {};
      setTimeout(() => { delete window[callback]; }, 60000);
    };
    const timer = setTimeout(() => { cleanup(); reject(new Error('Google 回應逾時。請檢查部署權限，並稍後重新讀取。')); }, timeout);
    window[callback] = data => { cleanup(); resolve(data); };
    script.onerror = () => { cleanup(); reject(new Error('無法讀取 Google 試算表。請確認已部署為「任何人」可存取，並使用 /exec 網址。')); };
    script.src = url.toString();
    script.referrerPolicy = 'no-referrer';
    document.head.append(script);
  });
}
export async function readCloud(endpoint) {
  const data = await jsonp(endpoint, { action: 'list' });
  if (!data?.ok || !Array.isArray(data.records)) throw new Error(data?.error || '回傳格式不正確，請更新 Apps Script 程式並重新部署。');
  return data;
}
export async function waitForReceipt(endpoint, requestId) {
  const deadline = Date.now() + 55000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const status = await jsonp(endpoint, { action: 'status', requestId }, 12000);
      if (!status?.ok) throw new Error(status?.error || '無法確認寫入狀態。');
      if (status.status === 'done') {
        if (status.result?.ok === false) {
          const failure = new Error(status.result?.error || '寫入失敗，請檢查 Apps Script 設定。');
          failure.definitive = true;
          throw failure;
        }
        if (!status.result?.ok) throw new Error('未取得有效寫入收據。');
        return status.result;
      }
    } catch (error) {
      if (error.definitive) throw error;
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 1400));
  }
  const error = new Error('尚未取得 Google 的寫入確認。請先按「重新讀取」確認結果，不要重複新增。' + (lastError ? ' 網路可能不穩定。' : ''));
  error.pending = true;
  throw error;
}
export async function sendCloud(endpoint, payload) {
  try {
    // A simple text/plain POST avoids an unsupported CORS preflight.
    // Opaque response is deliberately not treated as a receipt.
    await fetch(normalizeEndpoint(endpoint), { method: 'POST', mode: 'no-cors', credentials: 'omit', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(18000) });
  } catch {
    // The server may have committed even if the connection or redirect failed.
  }
  return waitForReceipt(endpoint, payload.requestId);
}
