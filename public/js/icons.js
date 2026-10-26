const paths = {
  ledger: '<path d="M6 3h14v18H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Z"/><path d="M7 3v18M11 8h5M11 12h5M11 16h3"/>',
  chart: '<path d="M21 12a9 9 0 1 1-9-9v9Z"/><path d="M16 3.5a9 9 0 0 1 4.5 4.5H16Z"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  settings: '<path d="m9 3-1 3-3 1 1 3-2 2 2 2-1 3 3 1 1 3h4l1-3 3-1-1-3 2-2-2-2 1-3-3-1-1-3Z"/><circle cx="11" cy="12" r="3"/>',
  leaf: '<path d="M19 3c-8 0-14 4-14 9a6 6 0 0 0 6 6c5 0 8-7 8-15Z"/><path d="m4 21 11-12"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  'arrow-right': '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  'arrow-up-right': '<path d="m6 18 12-12M6 6h12v12"/>',
  'arrow-down-left': '<path d="m18 6-12 12M6 6v12h12"/>',
  'chevron-left': '<path d="m15 5-7 7 7 7"/>',
  'chevron-right': '<path d="m9 5 7 7-7 7"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 11h18M8 15h2M14 15h2"/>',
  wallet: '<path d="M20 7V4H5a3 3 0 0 0 0 6h16v11H5a3 3 0 0 1-3-3V7"/><path d="M21 12h-5v5h5"/><path d="M17 14.5h.1"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
  'check-circle': '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  refresh: '<path d="M20 7a8 8 0 0 0-14-2L3 8m0-5v5h5M4 17a8 8 0 0 0 14 2l3-3m0 5v-5h-5"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  sparkle: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5ZM20 2v4M18 4h4"/>',
  x: '<path d="m6 6 12 12M6 18 18 6"/>',
  more: '<circle cx="12" cy="5" r=".7"/><circle cx="12" cy="12" r=".7"/><circle cx="12" cy="19" r=".7"/>',
  edit: '<path d="m15 4 5 5M4 20l5-1L21 7l-4-4L5 15Z"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
  link: '<path d="m10 14 4-4M9 16l-2 2a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0M15 8l2-2a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
  code: '<path d="m8 5-6 7 6 7m8-14 6 7-6 7M14 3l-4 18"/>',
  food: '<path d="M4 3v6a3 3 0 0 0 6 0V3M7 3v18M18 3c-3 3-4 6-4 9h4M18 3v18"/>',
  transport: '<rect x="4" y="3" width="16" height="16" rx="3"/><path d="M4 11h16M8 3v8M16 3v8M7 19l-1 2M17 19l1 2M8 15h.01M16 15h.01"/>',
  shopping: '<path d="M5 8h14l2 13H3Z"/><path d="M8 8V6a4 4 0 0 1 8 0v2"/>',
  home: '<path d="m2 10 10-8 10 8M5 8v13h14V8M9 21v-8h6v8"/>',
  entertainment: '<path d="M8 8h8c4 0 7 11 4 12-2 1-5-3-5-3H9s-3 4-5 3C1 19 4 8 8 8Z"/><path d="M7 11v5M4.5 13.5h5M16 12h.01M18 15h.01"/>',
  health: '<path d="M12 21 3.5 12.5a5.5 5.5 0 0 1 8.5-7 5.5 5.5 0 0 1 8.5 7Z"/><path d="M9 12h6M12 9v6"/>',
  other: '<rect x="4" y="4" width="16" height="16" rx="5"/><path d="M8 12h.01M12 12h.01M16 12h.01"/>',
  income: '<rect x="2" y="5" width="20" height="14" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6 12h.01M18 12h.01"/>'
};
export function icon(name) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.other}</svg>`;
}
export function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach(element => { element.innerHTML = icon(element.dataset.icon); });
}
