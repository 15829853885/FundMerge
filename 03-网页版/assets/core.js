/* ============================================================================
   合资金账 · 核心层
   数据模型 / 货币 / 分类引擎 / 鉴权 / 统计计算
   ========================================================================== */

'use strict';

const APP_VERSION = '5.0.1';
const APP_NAME = '合资金账';
const APP_NAME_EN = 'FundMerge';
const STORE_KEY = 'fund-ledger-v2';
const LEGACY_KEY = 'fund-ledger-v1';
const DESKTOP = typeof window !== 'undefined' && !!window.desktop;

let APP_INFO = null;

/* ---------------------------------- 工具 ---------------------------------- */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

const uid = (p = 'x') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const pad2 = n => String(n).padStart(2, '0');
const clone = o => JSON.parse(JSON.stringify(o));

const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
const addDays = (iso, n) => {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};
const monthOf = iso => String(iso).slice(0, 7);
const monthLabel = k => `${k.slice(0, 4)}年${Number(k.slice(5, 7))}月`;
const shortDate = iso => String(iso).slice(5);
const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
const lastDayOfMonth = k => addDays(addDays(k + '-01', 32).slice(0, 7) + '-01', -1);

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------------------------------- 货币 ---------------------------------- */

const CURRENCIES = {
  GHS: { code: 'GHS', symbol: '₵', name: '加纳塞地', short: '塞地' },
  CNY: { code: 'CNY', symbol: '¥', name: '人民币', short: '人民币' },
  USD: { code: 'USD', symbol: '$', name: '美元', short: '美元' },
  EUR: { code: 'EUR', symbol: '€', name: '欧元', short: '欧元' }
};

let CURRENCY = 'GHS';
const CUR = () => CURRENCIES[CURRENCY] || CURRENCIES.GHS;
const curSymbol = () => CUR().symbol;

function fmt(n) {
  const v = round2(n);
  return (v < 0 ? '-' : '') + curSymbol() + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtPlain(n) {
  return round2(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
const trimZero = s => (s.indexOf('.') >= 0 ? s.replace(/\.?0+$/, '') : s);
function fmtShort(n) {
  const a = Math.abs(n), s = n < 0 ? '-' : '';
  if (a >= 1e8) return s + curSymbol() + trimZero((a / 1e8).toFixed(2)) + '亿';
  if (a >= 1e4) return s + curSymbol() + trimZero((a / 1e4).toFixed(1)) + '万';
  return s + curSymbol() + Math.round(a).toLocaleString('en-US');
}

/* -------------------------------- 多币种（REQ-22） -------------------------------- */

/* 本位币：meta.fx.base 优先，回落到旧的 meta.currency */
const baseCurrency = () => {
  const m = (DB && DB.meta) || {};
  if (m.fx && CURRENCIES[m.fx.base]) return m.fx.base;
  return CURRENCIES[m.currency] ? m.currency : 'GHS';
};

/* 账户币种：账户自身币种，非法值回落本位币 */
const accCurrency = a => (a && CURRENCIES[a.currency]) ? a.currency : baseCurrency();

/* 汇率表：{ USD: [{date, rate, by, byName, at, note}] }，rate = 1 原币 → N 本位币 */
function fxList(cur) {
  const m = (DB && DB.meta) || {};
  const rates = (m.fx && m.fx.rates) || {};
  return Array.isArray(rates[cur]) ? rates[cur] : [];
}

/* 取 date <= at 的最新一条；没有记录返回 null（表示「缺汇率」，绝不按 1:1 兜底） */
function baseRate(cur, at) {
  const base = baseCurrency();
  if (!cur || cur === base) return 1;
  const list = fxList(cur);
  if (!list.length) return null;
  const d = at || todayISO();
  let best = null;
  for (const r of list) {
    if (r.date && r.date > d) continue;
    if (!best || String(r.date || '') > String(best.date || '')) best = r;
  }
  if (!best) best = list.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)))[0];
  return best && num(best.rate) > 0 ? num(best.rate) : null;
}

const toBase = (n, cur, at) => { const r = baseRate(cur, at); return r == null ? null : round2(num(n) * r); };

function fmtCur(n, cur) {
  const c = CURRENCIES[cur] || CUR();
  const v = round2(n);
  return (v < 0 ? '-' : '') + c.symbol + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* 需要折算但缺汇率的币种清单（用于页面提示） */
function missingRateCurrencies() {
  const set = new Set();
  const base = baseCurrency();
  (DB && DB.companies || []).forEach(co => {
    (co.accounts || []).forEach(a => {
      const cur = accCurrency(a);
      if (cur !== base && baseRate(cur) == null) set.add(cur);
    });
    /* 往来款也可能挂外币（R-01） */
    (co.debts || []).forEach(d => {
      const cur = d.currency || base;
      if (cur !== base && baseRate(cur, d.date) == null) set.add(cur);
    });
  });
  return [...set];
}

/* ---------------------------------- 图标 ---------------------------------- */

const ICONS = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  flow: '<path d="M4 7h13"/><path d="m14 4 3 3-3 3"/><path d="M20 17H7"/><path d="m10 14-3 3 3 3"/>',
  debt: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  budget: '<path d="M12 2a10 10 0 1 0 10 10h-10z"/><path d="M12 2v10h10A10 10 0 0 0 12 2z" opacity=".45"/>',
  report: '<path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M22 20H2"/>',
  account: '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 10h19"/><circle cx="17" cy="14.5" r="1.2"/>',
  tag: '<path d="M20.6 13.4 12 22l-9-9V3h10z"/><circle cx="7.5" cy="7.5" r="1.2"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  chevronRight: '<path d="m9 6 6 6-6 6"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/>',
  download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
  upload: '<path d="M12 21V9"/><path d="m7 14 5-5 5 5"/><path d="M5 3h14"/>',
  printer: '<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 17h12v4H6z"/>',
  lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  wallet: '<path d="M20 12V8H6a2 2 0 0 1 0-4h12v4"/><path d="M4 6v12a2 2 0 0 0 2 2h14v-4"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/>',
  bank: '<path d="M3 9.5 12 4l9 5.5"/><path d="M5 9.5V19h14V9.5"/><path d="M9.5 19v-5h5v5"/>',
  cart: '<circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2 3h3l2.4 11.2a2 2 0 0 0 2 1.6h7.8a2 2 0 0 0 2-1.6L21 7H6"/>',
  briefcase: '<rect x="2.5" y="7" width="19" height="13" rx="2"/><path d="M8.5 7V5a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v2"/><path d="M2.5 12h19"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/><path d="m3 17 9 5 9-5" opacity=".5"/>',
  percent: '<path d="M19 5 5 19"/><circle cx="7.5" cy="7.5" r="2.5"/><circle cx="16.5" cy="16.5" r="2.5"/>',
  rotate: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>',
  award: '<circle cx="12" cy="9" r="5.5"/><path d="m8.5 13.5-1.5 7 5-3 5 3-1.5-7"/>',
  sliders: '<path d="M4 6h10"/><path d="M18 6h2"/><path d="M4 12h4"/><path d="M12 12h8"/><path d="M4 18h10"/><path d="M18 18h2"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="16" cy="18" r="2"/>',
  shield: '<path d="M12 3 5 6v6c0 4.5 3 8 7 9 4-1 7-4.5 7-9V6z"/><path d="m9.5 12 2 2 3.5-3.5"/>',
  receipt: '<path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z"/><path d="M9 8h6"/><path d="M9 12h6"/>',
  home: '<path d="M3 10.5 12 4l9 6.5"/><path d="M5 10.5V20h14v-9.5"/><path d="M9.5 20v-5.5h5V20"/>',
  zap: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  plane: '<path d="M10.5 13.5 3 11V9l7.5 1.5L15 4h2l-2.5 7L21 13v2l-6.5-1L12 21h-2z"/>',
  clipboard: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1"/><path d="M9 10h6"/><path d="M9 14h4"/>',
  megaphone: '<path d="m3 11 14-6v14L3 13z"/><path d="M7 12.5V18a2 2 0 0 0 4 0v-4"/>',
  truck: '<rect x="2" y="6" width="11" height="10" rx="1.5"/><path d="M13 9h4l4 4v3h-8z"/><circle cx="6.5" cy="18.5" r="1.6"/><circle cx="17" cy="18.5" r="1.6"/>',
  box: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z"/><path d="m4 7.5 8 4.5 8-4.5"/><path d="M12 12v9"/>',
  transfer: '<path d="M4 8h13l-3-3"/><path d="M20 16H7l3 3"/>',
  alert: '<path d="M12 3 2.5 20h19z"/><path d="M12 9v5"/><path d="M12 17.5v.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8v.01"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18"/><path d="M8 3v4"/><path d="M16 3v4"/>',
  filter: '<path d="M3 5h18l-7 8v6l-4 2v-8z"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M3 3l18 18"/><path d="M10.6 6.2A9.8 9.8 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-3 3.6"/><path d="M6.2 6.7A16 16 0 0 0 2 12s3.5 6 10 6a9.7 9.7 0 0 0 4.2-.9"/>',
  userPlus: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6"/><path d="M22 11h-6"/>',
  refresh: '<path d="M21 12a9 9 0 0 1-15.5 6.2"/><path d="M3 12a9 9 0 0 1 15.5-6.2"/><path d="M21 4v5h-5"/><path d="M3 20v-5h5"/>',
  more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  mail: '<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>'
};

function icon(name, size = 16, extra = '') {
  const p = ICONS[name] || ICONS.tag;
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"${extra ? ' ' + extra : ''}>${p}</svg>`;
}

/* -------------------------------- 现金流项目 -------------------------------- */

const CF_ITEMS = [
  { key: 'op_in_sales',    label: '销售商品、提供劳务收到的现金', act: 'op',  dir: 'in' },
  { key: 'op_in_other',    label: '收到的其他与经营活动有关的现金', act: 'op',  dir: 'in' },
  { key: 'op_out_purchase',label: '购买商品、接受劳务支付的现金', act: 'op',  dir: 'out' },
  { key: 'op_out_salary',  label: '支付给职工以及为职工支付的现金', act: 'op',  dir: 'out' },
  { key: 'op_out_tax',     label: '支付的各项税费',               act: 'op',  dir: 'out' },
  { key: 'op_out_other',   label: '支付其他与经营活动有关的现金', act: 'op',  dir: 'out' },
  { key: 'inv_in_recover', label: '收回投资收到的现金',           act: 'inv', dir: 'in' },
  { key: 'inv_in_return',  label: '取得投资收益收到的现金',       act: 'inv', dir: 'in' },
  { key: 'inv_in_dispose', label: '处置固定资产等收回的现金净额', act: 'inv', dir: 'in' },
  { key: 'inv_out_capex',  label: '购建固定资产等支付的现金',     act: 'inv', dir: 'out' },
  { key: 'inv_out_invest', label: '投资支付的现金',               act: 'inv', dir: 'out' },
  { key: 'fin_in_capital', label: '吸收投资收到的现金',           act: 'fin', dir: 'in' },
  { key: 'fin_in_loan',    label: '取得借款收到的现金',           act: 'fin', dir: 'in' },
  { key: 'fin_out_repay',  label: '偿还债务支付的现金',           act: 'fin', dir: 'out' },
  { key: 'fin_out_interest', label: '分配股利、利润或偿付利息支付的现金', act: 'fin', dir: 'out' }
];
const CF_MAP = new Map(CF_ITEMS.map(i => [i.key, i]));
const ACT_LABEL = { op: '经营活动', inv: '投资活动', fin: '筹资活动' };

/* -------------------------------- 默认分类 -------------------------------- */

const DEFAULT_CATEGORIES = [
  { name: '销售回款', kind: 'in', cf: 'op_in_sales', icon: 'cart', color: '#2563eb' },
  { name: '服务收入', kind: 'in', cf: 'op_in_sales', icon: 'briefcase', color: '#7c3aed' },
  { name: '其他业务收入', kind: 'in', cf: 'op_in_other', icon: 'layers', color: '#0891b2' },
  { name: '利息收入', kind: 'in', cf: 'inv_in_return', icon: 'percent', color: '#0d9488' },
  { name: '股东投入', kind: 'in', cf: 'fin_in_capital', icon: 'users', color: '#4f46e5' },
  { name: '借款', kind: 'in', cf: 'fin_in_loan', icon: 'bank', color: '#b45309' },
  { name: '往来款收回', kind: 'in', cf: 'inv_in_recover', icon: 'rotate', color: '#0369a1' },
  { name: '政府补贴', kind: 'in', cf: 'op_in_other', icon: 'award', color: '#15803d' },
  { name: '余额调整', kind: 'in', cf: 'none', icon: 'sliders', color: '#64748b' },
  { name: '其他收入', kind: 'in', cf: 'op_in_other', icon: 'tag', color: '#6b7280' },

  { name: '采购付款', kind: 'out', cf: 'op_out_purchase', icon: 'cart', color: '#ea580c' },
  { name: '工资薪酬', kind: 'out', cf: 'op_out_salary', icon: 'users', color: '#db2777' },
  { name: '社保公积金', kind: 'out', cf: 'op_out_salary', icon: 'shield', color: '#be185d' },
  { name: '税费', kind: 'out', cf: 'op_out_tax', icon: 'receipt', color: '#b91c1c' },
  { name: '房租物业', kind: 'out', cf: 'op_out_other', icon: 'home', color: '#7c3aed' },
  { name: '水电费', kind: 'out', cf: 'op_out_other', icon: 'zap', color: '#ca8a04' },
  { name: '差旅费', kind: 'out', cf: 'op_out_other', icon: 'plane', color: '#0891b2' },
  { name: '办公费用', kind: 'out', cf: 'op_out_other', icon: 'clipboard', color: '#4b5563' },
  { name: '市场推广', kind: 'out', cf: 'op_out_other', icon: 'megaphone', color: '#c026d3' },
  { name: '运输物流', kind: 'out', cf: 'op_out_other', icon: 'truck', color: '#0f766e' },
  { name: '利息手续费', kind: 'out', cf: 'fin_out_interest', icon: 'percent', color: '#a16207' },
  { name: '还款', kind: 'out', cf: 'fin_out_repay', icon: 'bank', color: '#9a3412' },
  { name: '报销付款', kind: 'out', cf: 'op_out_other', icon: 'wallet', color: '#0e7490' },
  { name: '备用金', kind: 'out', cf: 'op_out_other', icon: 'wallet', color: '#475569' },
  { name: '固定资产购置', kind: 'out', cf: 'inv_out_capex', icon: 'box', color: '#1d4ed8' },
  { name: '往来款支付', kind: 'out', cf: 'inv_out_invest', icon: 'rotate', color: '#0369a1' },
  { name: '余额调整', kind: 'out', cf: 'none', icon: 'sliders', color: '#64748b' },
  { name: '其他支出', kind: 'out', cf: 'op_out_other', icon: 'tag', color: '#6b7280' }
];

const CAT_COLORS = ['#2563eb', '#4f46e5', '#7c3aed', '#c026d3', '#db2777', '#dc2626',
  '#ea580c', '#d97706', '#ca8a04', '#059669', '#0d9488', '#0891b2', '#0369a1', '#475569'];

/* ---------------------------------- 公司 ---------------------------------- */

const CO_COLORS = ['#4f46e5', '#0891b2', '#059669', '#d97706', '#db2777', '#7c3aed', '#dc2626', '#0d9488'];
const COMPANY_KEYS = ['accounts', 'transactions', 'debts', 'settlements', 'budgets', 'categories'];

function newCompany(name, idx = 0) {
  return {
    id: uid('co'),
    name: name || '新公司',
    shortName: '',
    color: CO_COLORS[idx % CO_COLORS.length],
    taxNo: '',
    note: '',
    active: true,
    isParent: false,
    createdAt: new Date().toISOString(),
    profile: emptyProfile(),
    accounts: [],
    categories: clone(DEFAULT_CATEGORIES).map(c => Object.assign({ id: uid('c'), active: true, system: true }, c)),
    transactions: [],
    debts: [],
    settlements: [],
    budgets: []
  };
}

function emptyProfile() {
  return {
    legalName: '', regNo: '', taxNo: '', address: '', phone: '', email: '', website: '', note: '',
    fields: [],
    files: []
  };
}

function normalizeProfile(p) {
  const o = p && typeof p === 'object' ? p : {};
  ['legalName', 'regNo', 'taxNo', 'address', 'phone', 'email', 'website', 'note'].forEach(k => {
    o[k] = String(o[k] || '');
  });
  o.fields = (Array.isArray(o.fields) ? o.fields : [])
    .filter(f => f && f.id)
    .map(f => ({
      id: f.id,
      group: f.group || '其他',
      label: String(f.label || '').trim() || '未命名条目',
      value: String(f.value ?? ''),
      type: ['text', 'password', 'url'].includes(f.type) ? f.type : 'text',
      note: String(f.note || ''),
      bundle: String(f.bundle || ''),
      bundleTitle: String(f.bundleTitle || ''),
      updatedAt: f.updatedAt || ''
    }));
  o.files = (Array.isArray(o.files) ? o.files : [])
    .filter(f => f && f.id)
    .map(f => ({
      id: f.id,
      name: String(f.name || f.original || '未命名文件'),
      original: String(f.original || ''),
      ext: String(f.ext || '').toLowerCase(),
      size: num(f.size),
      addedAt: f.addedAt || new Date().toISOString(),
      mtime: f.mtime || '',
      relPath: String(f.relPath || ''),
      userId: f.userId || '',
      note: String(f.note || '')
    }));
  return o;
}

/* ---------------------------------- 状态 ---------------------------------- */

let DB = null;
let COMPANY = null;
let SESSION = null;
let UI = {
  view: 'dashboard',
  trendDays: 30,
  txFilter: { from: '', to: '', account: '', type: '', category: '', keyword: '', page: 1 },
  txPageSize: 15,
  debtTab: 'lend',
  reportTab: 'cashflow',
  cfRange: { from: '', to: '' },
  cfPreset: '',
  stmt: { account: '', month: '' },
  budgetMonth: '',
  budgetShowAll: false,
  reportRange: { from: '', to: '' },
  groupRange: { from: '', to: '' },
  groupPreset: ''
};

function defaultDB() {
  const co = newCompany('我的公司');
  return {
    version: 3,
    meta: {
      currency: 'GHS', groupName: '', activeCompanyId: co.id, createdAt: new Date().toISOString(),
      fx: { base: 'GHS', rates: {} },
      voucherRule: { reset: 'month', seqLen: 4 }
    },
    users: [],
    companies: [co],
    auditLogs: []
  };
}

/* ---------------------------------- 存储 ---------------------------------- */

function normalizeCompany(c, idx, base) {
  c.id = c.id || uid('co');
  c.name = String(c.name || '未命名公司').trim() || '未命名公司';
  c.shortName = c.shortName || '';
  c.color = c.color || CO_COLORS[idx % CO_COLORS.length];
  c.taxNo = c.taxNo || '';
  c.note = c.note || '';
  c.active = c.active !== false;
  c.isParent = c.isParent === true;
  c.profile = normalizeProfile(c.profile);

  const objs = a => (Array.isArray(a) ? a : []).filter(x => x && typeof x === 'object');
  c.accounts = objs(c.accounts).filter(a => a.id);
  c.transactions = objs(c.transactions).filter(t => t.id && t.date);
  c.debts = objs(c.debts);
  c.settlements = objs(c.settlements);
  c.budgets = objs(c.budgets);
  const catList = objs(c.categories);
  c.categories = catList.length
    ? catList
    : clone(DEFAULT_CATEGORIES).map(x => Object.assign({ id: uid('c'), active: true, system: true }, x));

  c.categories.forEach(x => {
    x.active = x.active !== false;
    x.kind = x.kind === 'in' ? 'in' : 'out';
    x.color = x.color || '#64748b';
    x.icon = x.icon || 'tag';
    x.cf = x.cf || (x.kind === 'in' ? 'op_in_other' : 'op_out_other');
  });

  c.accounts.forEach(a => {
    a.type = a.type === 'cash' ? 'cash' : 'bank';
    a.currency = CURRENCIES[a.currency] ? a.currency : (base || 'GHS');
    a.openingBalance = num(a.openingBalance);
    a.openingDate = a.openingDate || todayISO();
    a.active = a.active !== false;
  });

  /* 旧版本：分类名 → 分类 id */
  const byName = new Map();
  c.categories.forEach(x => byName.set(x.kind + '|' + x.name, x));

  c.transactions.forEach(t => {
    t.type = ['in', 'out', 'transfer'].includes(t.type) ? t.type : 'out';
    t.amount = Math.abs(num(t.amount));
    t.createdAt = t.createdAt || new Date().toISOString();
    if (t.type === 'transfer') return;
    if (!t.categoryId) {
      const name = (t.category || '').trim() || (t.type === 'in' ? '其他收入' : '其他支出');
      let x = byName.get(t.type + '|' + name);
      if (!x) {
        x = { id: uid('c'), name, kind: t.type, cf: t.type === 'in' ? 'op_in_other' : 'op_out_other', icon: 'tag', color: '#64748b', active: true, system: false };
        c.categories.push(x);
        byName.set(t.type + '|' + name, x);
      }
      t.categoryId = x.id;
      t.category = name;
    }
  });

  c.debts.forEach(x => {
    x.type = ['lend', 'borrow', 'reimburse'].includes(x.type) ? x.type : 'lend';
    x.amount = Math.abs(num(x.amount));
    x.date = x.date || todayISO();
    /* 往来款计价币种（R-01），缺省回落本位币 */
    x.currency = CURRENCIES[x.currency] ? x.currency : (base || 'GHS');
  });
  c.settlements.forEach(s => { s.amount = Math.abs(num(s.amount)); });

  return c;
}

function normalize(raw) {
  const d = raw && typeof raw === 'object' ? raw : {};
  d.version = 3;
  d.meta = Object.assign({ currency: 'GHS', groupName: '' }, d.meta || {});
  if (!CURRENCIES[d.meta.currency]) d.meta.currency = 'GHS';
  /* 多币种（REQ-22）：本位币 + 汇率表，老数据自动补默认值 */
  if (!d.meta.fx || typeof d.meta.fx !== 'object') d.meta.fx = { base: d.meta.currency, rates: {} };
  if (!CURRENCIES[d.meta.fx.base]) d.meta.fx.base = d.meta.currency;
  if (!d.meta.fx.rates || typeof d.meta.fx.rates !== 'object') d.meta.fx.rates = {};
  Object.keys(d.meta.fx.rates).forEach(k => {
    const arr = d.meta.fx.rates[k];
    d.meta.fx.rates[k] = (Array.isArray(arr) ? arr : []).filter(r => r && num(r.rate) > 0).map(r => ({
      date: String(r.date || todayISO()),
      rate: num(r.rate),
      by: r.by || '',
      byName: r.byName || '',
      at: r.at || new Date().toISOString(),
      note: String(r.note || '')
    }));
  });
  d.meta.groupName = String(d.meta.groupName || '').trim();
  d.users = (Array.isArray(d.users) ? d.users : []).filter(u => u && typeof u === 'object');
  d.users.forEach(u => {
    if (!Array.isArray(u.security)) u.security = [];
    if (!Array.isArray(u.companyIds)) u.companyIds = [];   // 空数组 = 全部公司（管理员）
  });
  d.auditLogs = Array.isArray(d.auditLogs) ? d.auditLogs : [];
  d.meta.voucherRule = Object.assign({ reset: 'month', seqLen: 4 }, d.meta.voucherRule || {});

  /* v2 及更早：单公司结构 → 迁移为一家公司 */
  if (!Array.isArray(d.companies) || !d.companies.length) {
    const legacy = {
      id: uid('co'),
      name: d.meta.company || '我的公司',
      color: CO_COLORS[0],
      createdAt: d.meta.createdAt || new Date().toISOString(),
      accounts: d.accounts,
      transactions: d.transactions,
      debts: d.debts,
      settlements: d.settlements,
      budgets: d.budgets,
      categories: d.categories
    };
    d.companies = [legacy];
    d.meta.activeCompanyId = legacy.id;
  }

  d.companies = d.companies
    .filter(c => c && typeof c === 'object')
    .map((c, i) => normalizeCompany(c, i, d.meta.fx.base));

  COMPANY_KEYS.forEach(k => { delete d[k]; });
  delete d.meta.company;

  /* 全部公司都非法（被过滤掉）时兜底建一家，否则下面取 d.companies[0].id 会崩 */
  if (!d.companies.length) {
    const fallback = newCompany('我的公司');
    d.companies = [fallback];
  }
  if (!d.companies.some(c => c.id === d.meta.activeCompanyId)) {
    d.meta.activeCompanyId = d.companies[0].id;
  }
  return d;
}

/* 把 company 内部的账本数组代理到 DB 上，历史代码无需改写 */
function attachCompanyProxy(db) {
  COMPANY_KEYS.forEach(k => {
    Object.defineProperty(db, k, {
      get() { return COMPANY ? COMPANY[k] : []; },
      set(v) { if (COMPANY) COMPANY[k] = v; },
      enumerable: false,
      configurable: true
    });
  });
  return db;
}

function activeCompany() {
  if (!DB || !DB.companies || !DB.companies.length) return null;
  return DB.companies.find(c => c.id === DB.meta.activeCompanyId) || DB.companies[0];
}

function switchCompany(id, opts = {}) {
  const c = DB.companies.find(x => x.id === id);
  if (!c) return false;
  COMPANY = c;
  DB.meta.activeCompanyId = c.id;
  if (!opts.silent) saveDB();
  return true;
}

async function loadDB() {
  let raw = null;
  if (DESKTOP) {
    try { raw = await window.desktop.load(); } catch (e) { console.error(e); }
  } else {
    try {
      const cur = localStorage.getItem(STORE_KEY);
      const old = localStorage.getItem(LEGACY_KEY);
      raw = cur ? JSON.parse(cur) : (old ? JSON.parse(old) : null);
    } catch (e) { console.warn('读取本地数据失败', e); }
  }

  const rawVersion = raw && typeof raw === 'object' ? (raw.version || 1) : 0;
  DB = normalize(raw || defaultDB());
  CURRENCY = baseCurrency();
  attachCompanyProxy(DB);
  COMPANY = activeCompany();

  /* 旧版本数据：立即按新结构回写一次，避免每次启动重复迁移 */
  if (rawVersion && rawVersion !== 3) {
    try { saveDB(); } catch (e) { /* 忽略 */ }
  }
}

let saveWarned = false;
function saveDB() {
  if (DESKTOP) {
    window.desktop.save(DB).then(r => {
      if (r && r.conflict) {
        const name = String(r.conflictCopy || '').split(/[\\/]/).pop();
        toast('检测到数据被其他设备修改，已保留副本 ' + name, '');
      }
      if (!r || r.ok === false) toast('保存失败：' + ((r && r.error) || '未知错误'), 'err');
    }).catch(e => toast('保存失败：' + e.message, 'err'));
    return;
  }
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(DB));
  } catch (e) {
    if (!saveWarned) { saveWarned = true; toast('本地存储不可用，数据无法保存', 'err'); }
  }
}

/* ---------------------------------- 鉴权 ---------------------------------- */

const enc = new TextEncoder();

function toB64(buf) {
  let s = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function fromB64(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hashPassword(password, saltB64) {
  const salt = fromB64(saltB64);
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 120000, hash: 'SHA-256' }, key, 256
  );
  return toB64(bits);
}

function randomSalt() {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return toB64(arr);
}

async function createUser({ username, displayName, password, role }) {
  const salt = randomSalt();
  const hash = await hashPassword(password, salt);
  const user = {
    id: uid('u'),
    username: String(username).trim(),
    displayName: String(displayName || username).trim(),
    role: role === 'admin' ? 'admin' : 'staff',
    salt, hash,
    active: true,
    createdAt: new Date().toISOString(),
    lastLogin: '',
    security: []
  };
  DB.users.push(user);
  return user;
}

/* ------------------------------ 预留信息 / 找回密码 ------------------------------ */

const SECURITY_QUESTIONS = [
  '母亲的姓名',
  '父亲的姓名',
  '出生的城市',
  '第一所就读的小学',
  '第一份工作的单位',
  '最喜欢的宠物名字'
];

const normalizeAnswer = a => String(a || '').trim().toLowerCase().replace(/\s+/g, ' ');

async function setSecurity(user, pairs) {
  const out = [];
  for (const p of pairs) {
    const q = String((p && p.q) || '').trim();
    const a = normalizeAnswer(p && p.a);
    if (!q || !a) continue;
    const salt = randomSalt();
    out.push({ q, salt, hash: await hashPassword(a, salt) });
  }
  user.security = out;
  return out;
}

async function verifySecurity(user, answers) {
  const list = user.security || [];
  if (!list.length) return { ok: false, code: 'NO_SECURITY', error: '该账号没有设置预留信息' };
  if (!Array.isArray(answers) || answers.length !== list.length) return { ok: false, error: '请回答全部预留问题' };
  for (let i = 0; i < list.length; i++) {
    const h = await hashPassword(normalizeAnswer(answers[i]), list[i].salt);
    if (h !== list[i].hash) return { ok: false, error: `第 ${i + 1} 题的答案不正确` };
  }
  return { ok: true };
}

async function resetPasswordBySecurity(username, answers, newPassword) {
  const u = DB.users.find(x => x.username.toLowerCase() === String(username).trim().toLowerCase());
  if (!u) return { ok: false, error: '账号不存在' };
  if (u.active === false) return { ok: false, error: '该账号已被停用' };
  const v = await verifySecurity(u, answers);
  if (!v.ok) return v;
  u.salt = randomSalt();
  u.hash = await hashPassword(newPassword, u.salt);
  saveDB();
  return { ok: true, user: u };
}

const findUserByName = name =>
  DB.users.find(x => x.username.toLowerCase() === String(name || '').trim().toLowerCase());

/* 校验「当前登录用户」的密码（不更新 lastLogin，用于高危操作的二次身份确认） */
async function verifyCurrentPassword(pw) {
  const u = DB.users.find(x => x.id === (SESSION || {}).id);
  if (!u || !u.salt || !u.hash) return false;
  return (await hashPassword(String(pw || ''), u.salt)) === u.hash;
}

async function verifyLogin(username, password) {  const u = DB.users.find(x => x.username.toLowerCase() === String(username).trim().toLowerCase());
  if (!u) return { ok: false, error: '账号不存在' };
  if (u.active === false) return { ok: false, error: '该账号已被停用，请联系管理员' };
  const hash = await hashPassword(password, u.salt);
  if (hash !== u.hash) return { ok: false, error: '密码不正确' };
  u.lastLogin = new Date().toISOString();
  saveDB();
  return { ok: true, user: u };
}

function startSession(user) {
  SESSION = {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role
  };
}

function endSession() { SESSION = null; }

const isAdmin = () => !!SESSION && SESSION.role === 'admin';

function can(perm) {
  if (!SESSION) return false;
  if (SESSION.role === 'admin') return true;
  return ['view', 'tx.add', 'tx.edit', 'export'].includes(perm);
}

/* -------------------------------- 查询辅助 -------------------------------- */

const coById = id => (DB.companies || []).find(c => c.id === id);
const groupTitle = () => (DB && DB.meta && DB.meta.groupName) || '集团总览';
const groupSubtitle = () => (DB.companies.length > 1 ? `${DB.companies.length} 家公司 · 合并口径` : '单公司账本');
const accById = (id, co = COMPANY) => (co ? co.accounts.find(a => a.id === id) : undefined);
const catById = (id, co = COMPANY) => (co ? co.categories.find(c => c.id === id) : undefined);
const userById = id => DB.users.find(u => u.id === id);

function txCat(t, co = COMPANY) {
  if (t.type === 'transfer') return { name: t.peerCompanyId ? '公司间转账' : '内部转账', color: '#6366f1', icon: 'transfer', cf: 'none', kind: 'move' };
  return catById(t.categoryId, co) ||
    { name: t.category || '未分类', color: '#94a3b8', icon: 'tag', cf: t.type === 'in' ? 'op_in_other' : 'op_out_other', kind: t.type };
}

const txTypeLabel = t => (t.type === 'in' ? '收入' : t.type === 'out' ? '支出' : (t.peerCompanyId ? '公司间转账' : '内部转账'));

const sortedTx = (co = COMPANY) => [...(co ? co.transactions : [])].sort((a, b) =>
  a.date === b.date ? String(b.createdAt).localeCompare(String(a.createdAt)) : b.date.localeCompare(a.date));

/* -------------------------------- 余额计算 -------------------------------- */

function balanceOf(acc, upto, co = COMPANY) {
  const list = co ? co.transactions : [];
  let b = num(acc.openingBalance);
  for (const t of list) {
    if (upto && t.date > upto) continue;
    if (t.accountId === acc.id) {
      if (t.type === 'in') b += num(t.amount);
      else if (t.type === 'out') b -= num(t.amount);
      else if (t.type === 'transfer') {
        if (t.direction === 'in') b += num(t.amount);
        else b -= num(t.amount);
      }
    }
    /* 跨币种转账：目标账户按「到账金额」入账，缺失时回落到 amount */
    if (t.type === 'transfer' && t.toAccountId === acc.id) b += num(t.toAmount != null ? t.toAmount : t.amount);
  }
  return round2(b);
}

const totalBalance = (upto, co = COMPANY) =>
  round2((co ? co.accounts : []).reduce((s, a) => {
    const v = toBase(balanceOf(a, upto, co), accCurrency(a), upto);
    return s + (v == null ? 0 : v);
  }, 0));

/* 单笔流水的本位币金额（多币种）：按发生日汇率折算，缺汇率按 0 计并已由页面提示 */
function txBase(t, co = COMPANY) {
  const acc = accById(t.accountId, co) || (t.fundedAccountId ? accById(t.fundedAccountId, co) : null);
  const cur = acc ? accCurrency(acc) : baseCurrency();
  const v = toBase(t.amount, cur, t.date);
  return v == null ? 0 : v;
}

function rangeStats(from, to, co = COMPANY) {
  const r = { inflow: 0, outflow: 0, transfer: 0, count: 0 };
  for (const t of (co ? co.transactions : [])) {
    if (from && t.date < from) continue;
    if (to && t.date > to) continue;
    if (t.noCash) continue;
    r.count++;
    const amt = txBase(t, co);
    if (t.type === 'in') r.inflow += amt;
    else if (t.type === 'out') r.outflow += amt;
    else r.transfer += amt;
  }
  r.inflow = round2(r.inflow);
  r.outflow = round2(r.outflow);
  r.transfer = round2(r.transfer);
  r.net = round2(r.inflow - r.outflow);
  return r;
}

function accountStats(acc, from, to, co = COMPANY) {
  const s = { inflow: 0, outflow: 0, transferIn: 0, transferOut: 0, opening: 0, closing: 0 };
  s.opening = from ? balanceOf(acc, addDays(from, -1), co) : round2(num(acc.openingBalance));
  for (const t of (co ? co.transactions : [])) {
    if (from && t.date < from) continue;
    if (to && t.date > to) continue;
    if (t.type === 'in' && t.accountId === acc.id) s.inflow += num(t.amount);
    else if (t.type === 'out' && t.accountId === acc.id) s.outflow += num(t.amount);
    else if (t.type === 'transfer') {
      if (t.accountId === acc.id) {
        if (t.direction === 'in') s.transferIn += num(t.amount);
        else s.transferOut += num(t.amount);
      }
      if (t.toAccountId === acc.id) s.transferIn += num(t.toAmount != null ? t.toAmount : t.amount);
    }
  }
  Object.keys(s).forEach(k => { s[k] = round2(s[k]); });
  s.closing = round2(s.opening + s.inflow - s.outflow - s.transferOut + s.transferIn);
  return s;
}

/* -------------------------------- 现金流量表 -------------------------------- */

function cashFlow(from, to, co = COMPANY) {
  const rows = CF_ITEMS.map(i => ({ ...i, amount: 0, detail: [] }));
  const byKey = new Map(rows.map(r => [r.key, r]));
  const catAgg = new Map();

  for (const t of (co ? co.transactions : [])) {
    if (t.type === 'transfer' || t.noCash) continue;
    if (from && t.date < from) continue;
    if (to && t.date > to) continue;
    const c = txCat(t, co);
    if (!c.cf || c.cf === 'none') continue;
    const row = byKey.get(c.cf);
    if (!row) continue;
    row.amount += txBase(t, co);
    const k = c.id || c.name;
    if (!catAgg.has(k)) catAgg.set(k, { name: c.name, color: c.color, icon: c.icon, cf: c.cf, amount: 0 });
    catAgg.get(k).amount += txBase(t, co);
  }
  rows.forEach(r => { r.amount = round2(r.amount); });
  [...catAgg.values()].forEach(d => {
    d.amount = round2(d.amount);
    const row = byKey.get(d.cf);
    if (row) row.detail.push(d);
  });

  const act = { op: { in: 0, out: 0, net: 0 }, inv: { in: 0, out: 0, net: 0 }, fin: { in: 0, out: 0, net: 0 } };
  rows.forEach(r => {
    if (r.dir === 'in') act[r.act].in += r.amount;
    else act[r.act].out += r.amount;
  });
  Object.keys(act).forEach(k => {
    act[k].in = round2(act[k].in);
    act[k].out = round2(act[k].out);
    act[k].net = round2(act[k].in - act[k].out);
  });

  const netTotal = round2(act.op.net + act.inv.net + act.fin.net);
  const beginCash = totalBalance(addDays(from, -1), co);
  const endCash = round2(beginCash + netTotal);

  return { rows, act, netTotal, beginCash, endCash, from, to };
}

/* -------------------------------- 往来款 -------------------------------- */

const DEBT_TYPE = {
  lend: { label: '借出款', short: '应收', dir: 'in', tone: 'in', desc: '公司借给外部单位或个人的款项' },
  borrow: { label: '借入款', short: '应付', dir: 'out', tone: 'out', desc: '公司向外部单位或个人借入的款项' },
  reimburse: { label: '未报销', short: '应付', dir: 'out', tone: 'warn', desc: '员工垫付、尚未报销的款项' }
};

function debtInfo(d, co = COMPANY) {
  const list = co ? co.settlements : [];
  const settled = round2(list.filter(s => s.debtId === d.id).reduce((a, s) => a + num(s.amount), 0));
  const remaining = round2(num(d.amount) - settled);
  const status = remaining <= 0.005 ? 'settled' : settled > 0 ? 'partial' : 'open';
  const overdue = remaining > 0.005 && !!d.dueDate && d.dueDate < todayISO();
  return { settled, remaining, status, overdue };
}

function debtTotals(type, co = COMPANY) {
  let total = 0, remaining = 0, overdue = 0, count = 0, missing = [];
  (co ? co.debts : []).forEach(d => {
    if (type && d.type !== type) return;
    const info = debtInfo(d, co);
    if (info.status === 'settled') return;
    /* 往来款按各自计价币种折算成本位币；缺汇率不计入并在页面提示 */
    const cur = d.currency || baseCurrency();
    const f = baseRate(cur, d.date);
    if (f == null) { if (!missing.includes(cur)) missing.push(cur); return; }
    count++;
    total += num(d.amount) * f;
    remaining += info.remaining * f;
    if (info.overdue) overdue += info.remaining * f;
  });
  return { total: round2(total), remaining: round2(remaining), overdue: round2(overdue), count, missing };
}

/* ---------------------------------- 预算 ---------------------------------- */

function budgetRows(month, co = COMPANY) {
  const cats = (co ? co.categories : []).filter(c => c.kind === 'out' && c.active !== false && c.cf !== 'none');
  const used = new Map();
  (co ? co.transactions : []).forEach(t => {
    if (t.type !== 'out' || monthOf(t.date) !== month) return;
    used.set(t.categoryId, (used.get(t.categoryId) || 0) + txBase(t, co));
  });
  return cats.map(c => {
    const b = (co ? co.budgets : []).find(x => x.month === month && x.categoryId === c.id);
    const budget = b ? num(b.amount) : 0;
    const spent = round2(used.get(c.id) || 0);
    return {
      cat: c,
      budget,
      spent,
      remaining: round2(budget - spent),
      pct: budget > 0 ? (spent / budget) * 100 : 0
    };
  });
}

function budgetSummary(month, co = COMPANY) {
  const rows = budgetRows(month, co).filter(r => r.budget > 0);
  const budget = round2(rows.reduce((s, r) => s + r.budget, 0));
  const spent = round2(rows.reduce((s, r) => s + r.spent, 0));
  return { rows, budget, spent, remaining: round2(budget - spent), pct: budget > 0 ? (spent / budget) * 100 : 0 };
}

/* -------------------------------- 集团汇总 -------------------------------- */

/* 某公司在某日期的资金合计（转账不改变总额，可单循环计算）
   noCash 流水代表「这笔钱不是本公司出的」（集团代付的镜像分录，accountId 为空），
   它不进任何账户余额，也不该进公司资金合计，否则集团合并会凭空少掉一倍代付额。 */
function companyBalanceAt(co, upto) {
  /* 单遍扫描 + 按账户币种分桶，再统一折本位币。
     不能逐账户调 balanceOf：那是 O(流水 × 账户)，趋势图跑 200 个点会卡死。
     noCash 流水（accountId 为空）天然不入桶，顺带解决集团代付多扣一倍的问题。 */
  const base = baseCurrency();
  const buckets = {};
  (co.accounts || []).forEach(a => {
    const cur = accCurrency(a);
    buckets[cur] = (buckets[cur] || 0) + num(a.openingBalance);
  });
  const accCur = new Map((co.accounts || []).map(a => [a.id, accCurrency(a)]));
  for (const t of (co.transactions || [])) {
    if (upto && t.date > upto) continue;
    if (t.noCash) continue;
    if (t.type !== 'in' && t.type !== 'out') continue;
    const cur = accCur.get(t.accountId) || base;
    buckets[cur] = (buckets[cur] || 0) + (t.type === 'in' ? num(t.amount) : -num(t.amount));
  }
  let total = 0;
  Object.keys(buckets).forEach(cur => {
    const r = baseRate(cur, upto);
    if (r == null) return;            // 缺汇率：不计入，由调用方提示
    total += buckets[cur] * r;
  });
  return round2(total);
}

function companyTotals(co, upto) {
  const total = companyBalanceAt(co, upto);
  const byCurrency = {};
  let missing = [];
  (co.accounts || []).forEach(a => {
    const cur = accCurrency(a);
    const v = balanceOf(a, upto, co);
    byCurrency[cur] = round2((byCurrency[cur] || 0) + v);
    if (cur !== baseCurrency() && baseRate(cur, upto) == null && !missing.includes(cur)) missing.push(cur);
  });
  const cash = round2((co.accounts || []).filter(a => a.type === 'cash').reduce((s, a) => {
    const v = toBase(balanceOf(a, upto, co), accCurrency(a), upto);
    return s + (v == null ? 0 : v);
  }, 0));
  /* 往来口径：借出未收 = 应收；借入未还 + 员工未报销 = 应付。
     早期版本漏了这两个字段，导致「往来账款净额」下钻恒为 NaN。 */
  const receivable = debtTotals('lend', co).remaining;
  const payable = round2(debtTotals('borrow', co).remaining + debtTotals('reimburse', co).remaining);
  return { total, cash, bank: round2(total - cash), receivable, payable, byCurrency, missing };
}

function groupTotals(upto) {
  const list = (typeof accountingCompanies === 'function') ? accountingCompanies() : DB.companies;
  const r = { total: 0, cash: 0, bank: 0, receivable: 0, payable: 0, count: list.length };
  list.forEach(co => {
    const t = companyTotals(co, upto);
    r.total += t.total; r.cash += t.cash; r.bank += t.bank;
    r.receivable += debtTotals('lend', co).remaining;
    r.payable += debtTotals('borrow', co).remaining + debtTotals('reimburse', co).remaining;
  });
  return {
    total: round2(r.total), cash: round2(r.cash), bank: round2(r.bank),
    receivable: round2(r.receivable), payable: round2(r.payable), count: r.count
  };
}

function groupSeries(from, to) {
  const total = daysBetween(from, to);
  const step = total > 400 ? Math.ceil(total / 200) : 1;
  const pts = [];
  let d = from;
  const at = date => round2(accountingCompanies().reduce((s, co) => s + companyBalanceAt(co, date), 0));
  while (d <= to) {
    pts.push({ label: d, value: at(d) });
    d = addDays(d, step);
  }
  if (pts.length && pts[pts.length - 1].label !== to) pts.push({ label: to, value: at(to) });
  return pts;
}

function groupCashFlow(from, to) {
  const rows = CF_ITEMS.map(i => ({ ...i, amount: 0, detail: [] }));
  const byKey = new Map(rows.map(r => [r.key, r]));
  accountingCompanies().forEach(co => {
    const one = cashFlow(from, to, co);
    one.rows.forEach(r => {
      const target = byKey.get(r.key);
      target.amount += r.amount;
      r.detail.forEach(d => target.detail.push(Object.assign({ company: co.name, color: d.color }, d)));
    });
  });
  rows.forEach(r => { r.amount = round2(r.amount); });

  const act = { op: { in: 0, out: 0, net: 0 }, inv: { in: 0, out: 0, net: 0 }, fin: { in: 0, out: 0, net: 0 } };
  rows.forEach(r => {
    if (r.dir === 'in') act[r.act].in += r.amount;
    else act[r.act].out += r.amount;
  });
  Object.keys(act).forEach(k => {
    act[k].in = round2(act[k].in);
    act[k].out = round2(act[k].out);
    act[k].net = round2(act[k].in - act[k].out);
  });
  const netTotal = round2(act.op.net + act.inv.net + act.fin.net);
  const beginCash = round2(accountingCompanies().reduce((s, co) => s + companyBalanceAt(co, addDays(from, -1)), 0));
  return { rows, act, netTotal, beginCash, endCash: round2(beginCash + netTotal), from, to };
}

/* -------------------------------- 时间工具 -------------------------------- */

function monthsBetween(from, to) {
  const out = [];
  let y = Number(from.slice(0, 4)), m = Number(from.slice(5, 7));
  const ey = Number(to.slice(0, 4)), em = Number(to.slice(5, 7));
  let guard = 0;
  while ((y < ey || (y === ey && m <= em)) && guard++ < 600) {
    out.push(`${y}-${pad2(m)}`);
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

function balanceSeries(from, to) {
  const total = daysBetween(from, to);
  const step = total > 400 ? Math.ceil(total / 200) : 1;
  const pts = [];
  let d = from;
  while (d <= to) {
    pts.push({ label: d, value: totalBalance(d) });
    d = addDays(d, step);
  }
  if (pts.length && pts[pts.length - 1].label !== to) pts.push({ label: to, value: totalBalance(to) });
  return pts;
}

/* -------------------------------- 格式化补充 -------------------------------- */

const roleLabel = r => (r === 'admin' ? '管理员' : '记账员');

function initials(name) {
  const s = String(name || '?').trim();
  return s ? s.slice(0, 1).toUpperCase() : '?';
}

function avatarHTML(name, cls = '') {
  return `<div class="avatar ${cls}">${esc(initials(name))}</div>`;
}

function statusPill(status) {
  if (status === 'settled') return '<span class="pill ok">已结清</span>';
  if (status === 'partial') return '<span class="pill warn">部分结清</span>';
  return '<span class="pill muted">未结清</span>';
}

/* -------------------------------- 文件存储 -------------------------------- */

function fileKind(ext) {
  const e = String(ext || '').toLowerCase();
  if (e === 'pdf') return { label: 'PDF', tone: 'pdf' };
  if (['doc', 'docx'].includes(e)) return { label: 'DOC', tone: 'doc' };
  if (['xls', 'xlsx', 'csv'].includes(e)) return { label: 'XLS', tone: 'xls' };
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(e)) return { label: 'IMG', tone: 'img' };
  if (['txt', 'md'].includes(e)) return { label: 'TXT', tone: 'txt' };
  return { label: (e || 'FILE').toUpperCase().slice(0, 4), tone: 'other' };
}

function fmtSize(b) {
  const n = num(b);
  if (!n) return '0 B';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

const extOf = name => { const m = String(name || '').match(/\.([a-zA-Z0-9]{1,8})$/); return m ? m[1].toLowerCase() : ''; };
const baseName = name => String(name || '').replace(/\.[^.]+$/, '');

/* 网页版用 IndexedDB 存二进制 */
function idbOpen() {
  return new Promise((res, rej) => {
    const req = indexedDB.open('fundledger-files', 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains('files')) req.result.createObjectStore('files');
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
async function idbPut(key, blob) {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction('files', 'readwrite');
    tx.objectStore('files').put(blob, key);
    tx.oncomplete = () => res(true);
    tx.onerror = () => rej(tx.error);
  });
}
async function idbGet(key) {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction('files', 'readonly');
    const rq = tx.objectStore('files').get(key);
    rq.onsuccess = () => res(rq.result || null);
    rq.onerror = () => rej(rq.error);
  });
}
async function idbDel(key) {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction('files', 'readwrite');
    tx.objectStore('files').delete(key);
    tx.oncomplete = () => res(true);
    tx.onerror = () => rej(tx.error);
  });
}

const FileStore = {
  async pick() {
    if (DESKTOP) {
      const r = await window.desktop.files.pick();
      if (!r || !r.ok) return [];
      return (r.files || []).map(f => ({ path: f.path, name: f.name, size: f.size, mtime: f.mtime }));
    }
    return new Promise(resolve => {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.accept = '.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,image/*';
      input.onchange = () => resolve([...input.files].map(f => ({
        file: f, name: f.name, size: f.size, mtime: new Date(f.lastModified).toISOString()
      })));
      input.click();
    });
  },

  /* 归档到 <数据目录>/files/<公司>/<年-月>/<时间戳>_<名称>.<ext> */
  async save(companyId, id, name, ext, item) {
    if (DESKTOP) {
      return window.desktop.files.import({ companyId, id, name, ext, srcPath: item.path });
    }
    try {
      await idbPut(`${companyId}/${id}`, item.file);
      return { ok: true, size: item.size, mtime: new Date().toISOString(), relPath: `${companyId}/${id}` };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },

  async stats(files) {
    if (!DESKTOP) return [];
    const rels = files.filter(f => f.relPath).map(f => f.relPath);
    if (!rels.length) return [];
    try { return await window.desktop.files.stats(rels); } catch (e) { return []; }
  },

  async rename(file, name) {
    if (DESKTOP && file.relPath) {
      return window.desktop.files.rename({ relPath: file.relPath, name });
    }
    return { ok: true, relPath: file.relPath };
  },

  async open(file, companyId) {
    if (DESKTOP) return window.desktop.files.open({ relPath: file.relPath });
    const blob = await idbGet(`${companyId}/${file.id}`);
    if (!blob) return { ok: false, error: '文件不存在（可能已被清理）' };
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${file.name}.${file.ext}`;
    a.target = '_blank';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return { ok: true };
  },

  async reveal(file, companyId) {
    if (DESKTOP) return window.desktop.files.reveal({ relPath: file.relPath });
    return { ok: false, error: '网页版不支持定位文件' };
  },

  async remove(file, companyId) {
    if (DESKTOP) return window.desktop.files.remove({ relPath: file.relPath });
    try { await idbDel(`${companyId}/${file.id}`); return { ok: true }; }
    catch (e) { return { ok: false, error: e.message }; }
  },

  async preview(file, companyId) {
    if (DESKTOP) return window.desktop.files.read({ relPath: file.relPath, ext: file.ext });
    const blob = await idbGet(`${companyId}/${file.id}`);
    if (!blob) return { ok: false, error: '文件不存在' };
    return new Promise(resolve => {
      const fr = new FileReader();
      fr.onload = () => resolve({ ok: true, dataUrl: String(fr.result) });
      fr.onerror = () => resolve({ ok: false, error: '读取失败' });
      fr.readAsDataURL(blob);
    });
  }
};

function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/* ------------------------------ 集团总公司 / 代付 ------------------------------ */

const GROUP_CATS = {
  grantIn:  { name: '集团拨款',     kind: 'in',  cf: 'none',        icon: 'layers',   color: '#4f46e5' },
  grantOut: { name: '拨款给子公司', kind: 'out', cf: 'none',        icon: 'transfer', color: '#6366f1' },
  paidOut:  { name: '对子公司代付', kind: 'out', cf: 'op_out_other', icon: 'wallet',   color: '#0e7490' },
  advanceOut: { name: '借支发放', kind: 'out', cf: 'op_out_other', icon: 'wallet', color: '#0e7490' },
  advanceIn:  { name: '借支退回', kind: 'in',  cf: 'op_in_other',  icon: 'wallet', color: '#0e7490' }
};

/* 需要时才创建，避免给每家公司塞一堆用不到的分类 */
function ensureGroupCategory(co, key) {
  const def = GROUP_CATS[key];
  let c = co.categories.find(x => x.name === def.name && x.kind === def.kind);
  if (!c) {
    c = Object.assign({ id: uid('c'), active: true, system: false }, def);
    co.categories.push(c);
  }
  return c;
}

const parentCompany = () => (DB.companies || []).find(c => c.isParent) || null;
const subsidiaries = () => (DB.companies || []).filter(c => !c.isParent);
const isParentCompany = co => !!(co && co.isParent);

/* 该账户是否可用于"集团代付"（总公司账户，且当前不是总公司本身） */
function groupPayAccounts() {
  const p = parentCompany();
  if (!p || !COMPANY || p.id === COMPANY.id) return [];
  return p.accounts.filter(a => a.active !== false);
}

/* 集团代付：在总公司账上生成一条对应支出（同 id 关联，编辑/删除时同步） */
function syncGroupMirror(tx, company) {
  DB.companies.forEach(c => {
    if (Array.isArray(c.transactions)) {
      c.transactions = c.transactions.filter(t => t.mirrorOf !== tx.id);
    }
  });
  if (!tx || !tx.noCash || !tx.fundedBy) return;
  const p = coById(tx.fundedBy);
  if (!p) return;
  const acc = p.accounts.find(a => a.id === tx.fundedAccountId);
  if (!acc) return;
  const cat = ensureGroupCategory(p, 'paidOut');
  p.transactions.push({
    id: uid('t'),
    date: tx.date,
    type: 'out',
    accountId: acc.id,
    toAccountId: '',
    amount: num(tx.amount),
    categoryId: cat.id,
    category: cat.name,
    counterparty: company ? company.name : '',
    summary: '代 ' + (company ? company.name : '子公司') + ' 支付：' + (tx.summary || tx.counterparty || ''),
    voucherNo: tx.voucherNo || '',
    operator: tx.operator || (SESSION ? SESSION.displayName : ''),
    userId: (SESSION ? SESSION.id : ''),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    mirrorOf: tx.id
  });
}

/* 删除流水时，连带删除配对记录（公司间转账）与代付镜像 */
function removeLinkedTx(tx) {
  if (!tx) return;
  DB.companies.forEach(c => {
    if (!Array.isArray(c.transactions)) return;
    c.transactions = c.transactions.filter(t =>
      t.mirrorOf !== tx.id &&
      !(tx.pairId && t.pairId === tx.pairId && t.id !== tx.id)
    );
  });
}

/* 流水里账户的显示文案（含集团代付 / 公司间转账） */
function txAccountLabel(t, co = COMPANY) {
  if (t.noCash) {
    const p = coById(t.fundedBy) || parentCompany();
    const a = p ? p.accounts.find(x => x.id === t.fundedAccountId) : null;
    return (p ? p.name : '集团') + ' · ' + (a ? a.name : '代付');
  }
  if (t.type === 'transfer' && t.peerCompanyId) {
    const peer = coById(t.peerCompanyId);
    const a = peer ? peer.accounts.find(x => x.id === t.peerAccountId) : null;
    return (t.direction === 'in' ? '来自 ' : '转至 ') + (peer ? peer.name : '') + (a ? ' · ' + a.name : '');
  }
  const a = accById(t.accountId, co);
  return a ? a.name : '—';
}

/* ------------------------------ 内置最高管理员 ------------------------------ */

/* 内置管理员：通用占位账号。口令与手机号都不进入产物——首次启动由用户自己设置。 */
const MASTER_ACCOUNT = { username: 'owner', displayName: '管理员' };

async function ensureMasterAccount() {
  /* 先按 builtin 标记找人。首启页允许把账号从 owner 改成自定义名，
     旧逻辑只按 username 找，改名后下次启动就找不到 → 又建一个 builtin → 首启页反复弹。 */
  const exist = DB.users.find(u => u.builtin) || DB.users.find(u => u.username === MASTER_ACCOUNT.username);
  if (exist) {
    let dirty = false;
    if (exist.role !== 'admin') { exist.role = 'admin'; dirty = true; }
    if (!Array.isArray(exist.companyIds)) { exist.companyIds = []; dirty = true; }
    if (!Array.isArray(exist.security)) { exist.security = []; dirty = true; }
    if (typeof exist.mustSetPassword !== 'boolean') exist.mustSetPassword = false;
    if (dirty) saveDB();
    return exist;
  }
  /* 用不可知的随机口令占位，账号在首启设置口令前不可登录 */
  const rnd = toB64(crypto.getRandomValues(new Uint8Array(24)));
  const u = await createUser({
    username: MASTER_ACCOUNT.username,
    displayName: MASTER_ACCOUNT.displayName,
    password: rnd,
    role: 'admin'
  });
  u.builtin = true;
  u.mustSetPassword = true;
  if (!Array.isArray(u.companyIds)) u.companyIds = [];
  saveDB();
  return u;
}


/* ------------------------------ 公司权限 ------------------------------ */

/* 管理员不受限；记账员只能看被授权的公司（companyIds 为空也视为全部，兼容老数据） */
function allowedCompanies() {
  if (!SESSION) return [];
  if (SESSION.role === 'admin') return DB.companies;
  const me = DB.users.find(u => u.id === SESSION.id);
  const ids = (me && me.companyIds) || [];
  if (!ids.length) return DB.companies;
  const list = DB.companies.filter(c => ids.includes(c.id));
  /* 已配置授权但对不上（公司被删/越权）时返回空，绝不回退到全部 */
  return list;
}
const canAccessCompany = id => allowedCompanies().some(c => c.id === id);

/* ------------------------------ 操作日志 ------------------------------ */

const LOG_MODULES = ['登录', '流水', '账户', '往来款', '预算', '分类', '公司', '用户', '档案', '数据', '设置'];

function logAction(action, opts = {}) {
  if (!DB || !Array.isArray(DB.auditLogs)) return;
  const me = SESSION || {};
  DB.auditLogs.push({
    id: uid('log'),
    at: new Date().toISOString(),
    userId: me.id || '',
    userName: me.displayName || '未登录',
    companyId: (opts.companyId || (COMPANY && COMPANY.id)) || '',
    companyName: (opts.companyName || (COMPANY && COMPANY.name)) || '',
    module: opts.module || '其他',
    action: action,                       // 新增 / 修改 / 删除 / 登录 / 退出 / 导入 / 备份 / 清空
    target: opts.target || '',
    targetId: opts.targetId || '',
    before: opts.before || '',
    after: opts.after || '',
    result: opts.result === 'fail' ? 'fail' : 'ok',
    reason: opts.reason || ''
  });
  /* 上限保护，避免日志无限增长拖慢保存 */
  if (DB.auditLogs.length > 5000) DB.auditLogs = DB.auditLogs.slice(-4000);
}

/* ------------------------------ 凭证号 ------------------------------ */

const VOUCHER_PREFIX = { in: '收', out: '付', transfer: '转', other: '记' };

function nextVoucherNo(type, date) {
  const prefix = VOUCHER_PREFIX[type] || '记';
  const d = String(date || todayISO());
  const period = DB.meta.voucherRule.reset === 'year' ? d.slice(0, 4) : d.slice(0, 7).replace('-', '');
  const head = prefix + '-' + period + '-';
  let max = 0;
  DB.companies.forEach(co => (co.transactions || []).forEach(t => {
    const v = String(t.voucherNo || '');
    if (v.indexOf(head) === 0) {
      const seq = parseInt(v.slice(head.length), 10);
      if (Number.isFinite(seq) && seq > max) max = seq;
    }
  }));
  const len = Math.max(2, num(DB.meta.voucherRule.seqLen) || 4);
  return head + String(max + 1).padStart(len, '0');
}

/* 凭证号查询用的扁平列表（仅当前可访问公司） */
function allVouchers() {
  const out = [];
  allowedCompanies().forEach(co => (co.transactions || []).forEach(t => {
    if (!t.voucherNo) return;
    out.push({ t, co });
  }));
  return out.sort((a, b) => (b.t.date || '').localeCompare(a.t.date || ''));
}

/* ============================================================================
   v4.3 业务闭环：往来单位 / 借支备用金 / 票据未回
   ========================================================================== */

/* ---------- 往来单位 ---------- */
const PARTY_TYPES = { customer: '客户', supplier: '供应商', other: '其他' };

function ensurePartyList(co) {
  if (!Array.isArray(co.parties)) co.parties = [];
  return co.parties;
}
function partyById(id, co = COMPANY) {
  return ensurePartyList(co).find(p => p.id === id) || null;
}
function activeParties(co = COMPANY) {
  return ensurePartyList(co).filter(p => p.active !== false);
}

/* ---------- 借支备用金 ---------- */
const ADVANCE_STATUS = { pending: '待发放', issued: '已发放', closed: '已核销' };

function ensureAdvanceList(co) {
  if (!Array.isArray(co.advances)) co.advances = [];
  return co.advances;
}
function advanceInfo(a) {
  const total = num(a.amount);
  const draws = Array.isArray(a.draws) ? a.draws : [];
  /* 已用 = 各次核销的实际使用额；退回的部分同样占用借支额度，否则余额会永远挂着 */
  const used = draws.length ? round2(draws.reduce((s, d) => s + num(d.used), 0)) : num(a.usedAmount);
  const back = draws.length ? round2(draws.reduce((s, d) => s + num(d.back), 0)) : 0;
  const remain = round2(total - used - back);
  const over = used + back > total + 0.005;
  let status = a.status || 'pending';
  if (status !== 'pending') status = remain <= 0.005 ? 'closed' : 'issued';
  return { used, back, remain, over, status, drawCount: draws.length };
}

/* ---------- 票据未回 ---------- */
const INVOICE_STATUS = { none: '未回', partial: '部分回', done: '已回' };

function ensureInvoiceList(co) {
  if (!Array.isArray(co.invoices)) co.invoices = [];
  return co.invoices;
}
function invoiceOverdue(inv) {
  if (inv.status === 'done') return false;
  if (!inv.expectDate) return false;
  return inv.expectDate < todayISO();
}

/* ============================================================================
   v4.4 项目（按资金使用）/ 总公司登记方式 / 下钻
   ========================================================================== */

const PROJECT_STATUS = { active: '进行中', paused: '暂停', done: '已结束' };

function ensureProjectList(co) {
  if (!Array.isArray(co.projects)) co.projects = [];
  return co.projects;
}
function projectById(id, co = COMPANY) {
  return ensureProjectList(co).find(p => p.id === id) || null;
}

/* 项目资金使用情况：按流水的 projectId 汇总支出/收入 */
function projectUsage(projectId, co = COMPANY) {
  let out = 0, inn = 0, count = 0;
  (co.transactions || []).forEach(t => {
    if (t.projectId !== projectId) return;
    /* 只有收入/支出算项目业务，内部转账与跨公司调拨不计笔数（R-03） */
    if (t.type === 'out') { out += txBase(t, co); count++; }
    else if (t.type === 'in') { inn += txBase(t, co); count++; }
  });
  return { out: round2(out), in: round2(inn), count };
}

/* 总公司登记方式：company=作为独立公司参与核算；registry=仅作集团登记主体 */
const parentMode = () => (DB.meta.parentMode === 'registry' ? 'registry' : 'company');

/* 参与核算的公司（registry 模式下排除总公司）
   注意：没有成员公司时返回空集，不再回落成"全部公司"。
   旧写法 `list.length ? list : DB.companies` 会把「集团下没有成员」伪装成
   「全部参与合并」，用户看到的合计是错的，且没有任何提示。 */
function accountingCompanies() {
  if (parentMode() === 'registry') return DB.companies.filter(c => !c.isParent);
  return DB.companies;
}

/* 集团总公司（全库唯一，可能为空） */
const groupHQ = () => (DB.companies || []).find(c => c.isParent) || null;

/* 下钻：某个集团指标在各公司的构成 */
const DRILL_METRICS = {
  total: '集团资金总额',
  cash: '集团库存现金',
  bank: '集团银行存款',
  net: '往来账款净额',
  lend: '集团应收合计',
  pay: '集团应付合计',
  monthIn: '本月集团流入',
  monthOut: '本月集团流出'
};

function drillRows(metric) {
  const today = todayISO();
  const thisM = monthOf(today);
  return accountingCompanies().map(co => {
    const t = companyTotals(co);
    let value = t.total;
    if (metric === 'cash') value = t.cash;
    else if (metric === 'bank') value = t.bank;
    else if (metric === 'net') value = round2(t.receivable - t.payable);
    else if (metric === 'lend') value = t.receivable;
    else if (metric === 'pay') value = t.payable;
    else if (metric === 'monthIn') value = rangeStats(thisM + '-01', today, co).inflow;
    else if (metric === 'monthOut') value = rangeStats(thisM + '-01', today, co).outflow;
    return { co, value, totals: t };
  }).sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
}

/* ============================================================================
   v4.6 预算自动生成
   ========================================================================== */

const BUDGET_METHODS = {
  avg: '历史平均',
  median: '历史中位数',
  weighted: '近期加权',
  trend: '趋势外推'
};

function budgetRule() {
  return Object.assign({ lookback: 3, method: 'weighted', growth: 0, roundTo: 100, minAmount: 0, skipEmpty: true },
    DB.meta.budgetRule || {});
}

/* 某分类在最近 N 个月（不含本月）的月度支出序列 */
function budgetHistory(categoryId, lookback, endMonth) {
  const out = [];
  let m = endMonth || monthOf(todayISO());
  for (let i = 1; i <= lookback; i++) {
    m = monthOf(addDays(m + '-01', -1));
    const spent = round2(COMPANY.transactions
      .filter(t => t.type === 'out' && t.categoryId === categoryId && monthOf(t.date) === m)
      .reduce((s, t) => s + txBase(t, COMPANY), 0));
    out.unshift({ month: m, spent });
  }
  return out;
}

function pickValue(series, method) {
  const vals = series.map(s => s.spent);
  const n = vals.length;
  if (!n) return 0;
  if (method === 'avg') return vals.reduce((a, b) => a + b, 0) / n;
  if (method === 'median') {
    const s = vals.slice().sort((a, b) => a - b);
    return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  }
  if (method === 'weighted') {
    /* 越近权重越大：1,2,3… */
    let ws = 0, sum = 0;
    vals.forEach((v, i) => { const w = i + 1; ws += w; sum += v * w; });
    return ws ? sum / ws : 0;
  }
  if (method === 'trend') {
    if (n < 2) return vals[0] || 0;
    /* 最小二乘，预测下一个月 */
    const xs = vals.map((_, i) => i + 1);
    const mx = xs.reduce((a, b) => a + b, 0) / n;
    const my = vals.reduce((a, b) => a + b, 0) / n;
    let num = 0, den = 0;
    xs.forEach((x, i) => { num += (x - mx) * (vals[i] - my); den += (x - mx) * (x - mx); });
    const slope = den ? num / den : 0;
    const next = my + slope * (n + 1 - mx);
    return Math.max(0, next);
  }
  return vals.reduce((a, b) => a + b, 0) / n;
}

/* 生成预算建议（不写库） */
function suggestBudget(targetMonth, opts) {
  const rule = Object.assign({}, budgetRule(), opts || {});
  const cats = COMPANY.categories.filter(c => c.kind === 'out' && c.active !== false);
  const items = [];
  cats.forEach(c => {
    const series = budgetHistory(c.id, rule.lookback, targetMonth);
    const total = series.reduce((s, x) => s + x.spent, 0);
    if (rule.skipEmpty && total <= 0) return;
    let v = pickValue(series, rule.method);
    v = v * (1 + num(rule.growth) / 100);
    if (rule.roundTo > 1) v = Math.round(v / rule.roundTo) * rule.roundTo;
    if (v < num(rule.minAmount)) v = num(rule.minAmount);
    items.push({
      categoryId: c.id, name: c.name, color: c.color, icon: c.icon,
      series, historyTotal: round2(total),
      historyAvg: round2(total / Math.max(1, series.length)),
      suggested: round2(v),
      amount: round2(v)
    });
  });
  items.sort((a, b) => b.suggested - a.suggested);
  return { month: targetMonth, rule, items, total: round2(items.reduce((s, x) => s + x.amount, 0)) };
}

/* 写入预算 + 版本记录 */
function applyBudgetPlan(plan, userId) {
  let written = 0;
  plan.items.forEach(it => {
    if (!(it.amount > 0)) return;
    const exist = COMPANY.budgets.find(b => b.month === plan.month && b.categoryId === it.categoryId);
    if (exist) exist.amount = round2(it.amount);
    else COMPANY.budgets.push({ month: plan.month, categoryId: it.categoryId, amount: round2(it.amount) });
    written++;
  });
  if (!Array.isArray(COMPANY.budgetVersions)) COMPANY.budgetVersions = [];
  COMPANY.budgetVersions.unshift({
    id: uid('bv'),
    at: new Date().toISOString(),
    month: plan.month,
    lookback: plan.rule.lookback,
    method: plan.rule.method,
    growth: plan.rule.growth,
    total: plan.total,
    count: written,
    userId: userId || '',
    items: plan.items.map(x => ({ categoryId: x.categoryId, name: x.name, amount: x.amount, suggested: x.suggested }))
  });
  COMPANY.budgetVersions = COMPANY.budgetVersions.slice(0, 30);
  return written;
}
