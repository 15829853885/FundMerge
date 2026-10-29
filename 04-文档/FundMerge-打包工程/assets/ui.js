/* ============================================================================
   合资金账 · UI 组件层
   提示条 / 弹窗 / 浮层 / 分类选择器 / 图表
   ========================================================================== */

'use strict';

/* ---------------------------------- 提示条 -------------------------------- */

/* 每条 Toast 带一个自增 generation：退场回调只移除自己那一条，
   避免"上一条的定时器把后一条刚插入的节点删掉"这类竞态。 */
let toastSeq = 0;

function dismissToast(el) {
  if (!el || el.dataset.leaving === '1') return;        /* 幂等：手动与自动同时触发只走一次 */
  el.dataset.leaving = '1';
  if (el.dataset.timer) { clearTimeout(Number(el.dataset.timer)); el.dataset.timer = ''; }
  el.classList.add('is-leaving');                       /* 退场交给 CSS 令牌，慢档才会跟着变慢 */
  const gen = el.dataset.gen;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    if (el.dataset.gen === gen) el.remove();
  };
  el.addEventListener('transitionend', finish, { once: true });
  setTimeout(finish, 300);                              /* 兜底：transitionend 不触发（被移出文档等）也能清理 */
}

function toast(msg, tone = '') {
  const gen = String(++toastSeq);
  const el = document.createElement('div');
  el.className = 'toast ' + tone + (tone === 'countdown' ? ' is-countdown' : '');
  el.dataset.gen = gen;
  const ico = tone === 'ok' ? icon('check', 14) : tone === 'err' ? icon('alert', 14) : icon('info', 14);
  el.innerHTML = ico + '<span>' + esc(msg) + '</span>';
  /* 读屏通告：错误用 alert（assertive，会打断当前朗读），其余用 status（polite）。
     容器 #toast-root 已是 aria-live="polite"，这里按条覆盖，错误才能及时播报。 */
  el.setAttribute('role', tone === 'err' ? 'alert' : 'status');
  el.addEventListener('click', () => dismissToast(el));  /* 手动关闭与自动退场共用同一条幂等路径 */
  $('#toast-root').appendChild(el);
  el.dataset.timer = String(setTimeout(() => dismissToast(el), tone === 'countdown' ? 4000 : 2200));
}

/* ---------------------------------- 弹窗 ---------------------------------- */

/* 栈元素结构：{ backdrop, trigger, closing, removed }
   trigger 记录打开前的焦点元素，**关闭动画结束后**才还原，避免焦点落在正在消失的节点上。 */
const modalStack = [];
const FOCUS_SEL = 'a[href], button:not([disabled]), input:not([type=hidden]):not([disabled]), ' +
                  'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function topModal() { return modalStack[modalStack.length - 1]; }

function modalFocusables(backdrop) {
  return [...backdrop.querySelectorAll(FOCUS_SEL)].filter(el => el.getClientRects().length);
}

function focusInto(backdrop) {
  const target = modalFocusables(backdrop)[0] || backdrop.querySelector('.modal');
  if (!target) return;
  if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
  try { target.focus({ preventScroll: true }); } catch (e) { target.focus(); }
}

/* 背景 inert：弹窗期间 #root 不可聚焦、读屏不读。
   #toast-root 在 #root 之外，因此错误提示仍能播报，不会被一起静音。 */
function setBackgroundInert(on) {
  const app = document.getElementById('root');
  if (!app) return;
  if (on) {
    app.setAttribute('inert', '');
    app.setAttribute('aria-hidden', 'true');
  } else {
    app.removeAttribute('inert');
    app.removeAttribute('aria-hidden');
  }
}

function openModal(html, opts = {}) {
  const root = document.getElementById('modal-root');
  const prevEntry = topModal();
  if (prevEntry) {
    if (prevEntry.closing) finalizeClose(prevEntry);   /* 上一层还在退场：先收干净，避免两层同时可见 */
    else {
      prevEntry.backdrop.style.display = 'none';
      prevEntry.backdrop.setAttribute('inert', '');
      prevEntry.backdrop.setAttribute('aria-hidden', 'true');
    }
  }

  const holder = document.createElement('div');
  holder.innerHTML = `<div class="modal-backdrop">${html}</div>`;
  const backdrop = holder.firstElementChild;
  root.appendChild(backdrop);
  const entry = { backdrop, trigger: document.activeElement, closing: false, removed: false };
  modalStack.push(entry);

  /* 弹窗里的可点选项多为 div（如关闭账套的三选一），同样需要键盘可达 */
  if (typeof enhanceA11y === 'function') enhanceA11y(backdrop);

  if (window.Scene3D && Scene3D.pauseScenes) Scene3D.pauseScenes();
  document.body.style.overflow = 'hidden';
  setBackgroundInert(true);

  backdrop.addEventListener('mousedown', e => { if (e.target === backdrop) closeModal(); });

  /* Tab 循环：只有最上层响应，防止 Tab 跑到底下那层 */
  backdrop.addEventListener('keydown', e => {
    if (e.key !== 'Tab' || topModal() !== entry) return;
    const items = modalFocusables(backdrop);
    if (!items.length) { e.preventDefault(); focusInto(backdrop); return; }
    const first = items[0], last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !backdrop.contains(active))) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && (active === last || !backdrop.contains(active))) {
      e.preventDefault(); first.focus();
    }
  });

  if (!opts.noFocus) requestAnimationFrame(() => focusInto(backdrop));
}

/* 焦点守卫：异步渲染把焦点节点换掉后，焦点会落回 body，这里把它拉回最上层弹窗。
   退场期间不接管，否则会和"关闭后还原焦点"打架。 */
document.addEventListener('focusin', e => {
  const entry = topModal();
  if (!entry || entry.closing) return;
  if (entry.backdrop.contains(e.target)) return;
  focusInto(entry.backdrop);
});

function finalizeClose(entry) {
  if (!entry || entry.removed) return;
  entry.removed = true;
  const { backdrop, trigger } = entry;
  const idx = modalStack.indexOf(entry);
  if (idx >= 0) modalStack.splice(idx, 1);
  backdrop.remove();

  const prevEntry = topModal();
  if (prevEntry) {
    prevEntry.backdrop.style.display = '';
    prevEntry.backdrop.removeAttribute('inert');
    prevEntry.backdrop.removeAttribute('aria-hidden');
    document.body.style.overflow = 'hidden';
    focusInto(prevEntry.backdrop);
    return;
  }
  const root = document.getElementById('modal-root');
  if (root) root.innerHTML = '';
  document.body.style.overflow = '';
  setBackgroundInert(false);
  if (window.Scene3D && Scene3D.resumeScenes) Scene3D.resumeScenes();
  /* 关闭动画结束之后才还原焦点 */
  if (trigger && document.contains(trigger) && typeof trigger.focus === 'function') {
    try { trigger.focus({ preventScroll: true }); } catch (e) { trigger.focus(); }
  }
}

function closeModal() {
  closeCatPicker();
  closePopover();

  const entry = topModal();
  if (!entry) {
    const root = document.getElementById('modal-root');
    if (root) root.innerHTML = '';
    document.body.style.overflow = '';
    setBackgroundInert(false);
    return;
  }
  if (entry.closing) return;                       /* 幂等：连按 Esc 不会重复触发 */
  entry.closing = true;
  entry.backdrop.classList.add('is-closing');
  entry.backdrop.setAttribute('inert', '');        /* 退场期间不可再交互 */

  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    finalizeClose(entry);
  };
  entry.backdrop.addEventListener('animationend', finish, { once: true });
  setTimeout(finish, 240);                         /* 兜底：减少动效/关闭动画被禁用时也能收尾 */
}

function modalShell({ title, sub, body, footer, cls = '' }) {
  return `<div class="modal ${cls}" role="dialog" aria-modal="true">
    <div class="modal-hd">
      <div>
        <h2>${title}</h2>
        ${sub ? `<div class="sub">${sub}</div>` : ''}
      </div>
      <button class="icon-btn" data-action="close-modal" aria-label="关闭">${icon('x', 16)}</button>
    </div>
    ${body}
    ${footer || ''}
  </div>`;
}

let confirmHandler = null;

function confirmDialog({ title, message, confirmText = '确定', tone = 'danger', requireCode = false, onConfirm }) {
  confirmHandler = onConfirm;
  /* 破坏性操作：生成一次性随机数字，输入正确才允许继续 */
  const code = requireCode ? String(Math.floor(1000 + Math.random() * 9000)) : '';

  openModal(modalShell({
    title: esc(title),
    cls: 'slim',
    body: `<div class="modal-bd">
      <p style="font-size:13px;line-height:1.75;color:var(--ink-3)">${message}</p>
      ${requireCode ? `<div class="danger-confirm">
        <div class="dc-tip">为防止误操作，请输入下方 4 位数字后继续</div>
        <div class="dc-code" id="dc-code">${code}</div>
        <input type="text" id="dc-input" class="dc-input" inputmode="numeric" maxlength="4"
               placeholder="输入上方数字" autocomplete="off">
      </div>` : ''}
    </div>`,
    footer: `<div class="modal-ft"><div class="spacer"></div>
      <button class="btn secondary" data-action="close-modal">取消</button>
      <button class="btn ${tone === 'danger' ? 'danger' : 'primary'}" data-action="confirm-ok"
        ${requireCode ? 'disabled' : ''} id="dc-ok">${esc(confirmText)}</button>
    </div>`
  }), { noFocus: true });

  if (requireCode) {
    const input = $('#dc-input'), ok = $('#dc-ok');
    if (input && ok) {
      input.addEventListener('input', () => {
        const v = input.value.replace(/\D/g, '').slice(0, 4);
        input.value = v;
        ok.disabled = v !== code;
        const bad = v.length === 4 && v !== code;
        input.classList.remove('is-bad');
        if (bad) { void input.offsetWidth; input.classList.add('is-bad'); }
      });
      setTimeout(() => input.focus(), 90);
    }
  }
}

/* 分级二次确认（G-02）
   level='code'  → 随机数字确认：改金额、删除、改状态、清空等影响余额或不可逆的操作
   level='plain' → 普通确认：改备注、改设置等低风险修改
   新增操作不调用本函数。 */
function guardChange({ title, message, confirmText = '确认修改', level = 'code', onConfirm }) {
  return confirmDialog({
    title,
    message,
    confirmText,
    tone: level === 'code' ? 'danger' : 'primary',
    requireCode: level === 'code',
    onConfirm
  });
}

/* 管理员密码验证（阶段三 9 / 12）
   敏感改动在真正写库之前，先验证「当前登录者本人」的密码。
   取消或验证失败都不会调用 onConfirm，数据保持原样。
   校验复用 core.js 的 verifyCurrentPassword（PBKDF2，和登录同一套哈希），不另造一套判断。 */
function requireAdminPassword({ title = '需要管理员验证', message = '', confirmText = '验证并继续', onConfirm }) {
  if (!isAdmin()) { toast('只有管理员可以执行此操作', 'err'); return; }
  confirmHandler = null;

  openModal(modalShell({
    title: esc(title),
    cls: 'slim',
    body: `<form id="ap-form">
      <div class="modal-bd">
        <p style="font-size:13px;line-height:1.75;color:var(--ink-3)">${message || '这是会影响账本数据的操作，请输入当前管理员账号的登录密码。'}</p>
        <label class="field" style="margin-top:12px"><span class="lbl">管理员密码</span>
          <input type="password" id="ap-input" autocomplete="current-password" placeholder="请输入登录密码">
        </label>
        <div class="auth-err" id="ap-err" hidden style="margin-top:8px"></div>
      </div>
      <div class="modal-ft"><div class="spacer"></div>
        <button type="button" class="btn secondary" data-action="close-modal">取消</button>
        <button type="submit" class="btn primary" id="ap-ok">${esc(confirmText)}</button>
      </div>
    </form>`
  }), { noFocus: true });

  const form = $('#ap-form'), input = $('#ap-input'), errBox = $('#ap-err'), okBtn = $('#ap-ok');
  if (!form || !input) return;

  const fail = msg => {
    if (errBox) { errBox.hidden = false; errBox.textContent = msg; }
    input.classList.remove('is-bad'); void input.offsetWidth; input.classList.add('is-bad');
    input.value = ''; input.focus();
  };

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const pw = input.value;
    if (!pw) return fail('请输入密码');
    if (okBtn) { okBtn.disabled = true; okBtn.textContent = '验证中…'; }
    let passed = false;
    try { passed = await verifyCurrentPassword(pw); } catch (e2) { passed = false; }
    if (!passed) {
      if (okBtn) { okBtn.disabled = false; okBtn.textContent = confirmText; }
      return fail('密码不正确，请重新输入');
    }
    closeModal();
    if (typeof onConfirm === 'function') onConfirm();
  });

  setTimeout(() => input.focus(), 90);
}

/* 关闭当前所有弹窗（含底层表单弹窗）
   保存类弹窗上再叠一层确认 / 密码弹窗时，只调用一次 closeModal() 关的是最上层，
   底层表单会留在屏幕上（阶段三 8「保存成功后自动关闭」）。 */
function closeAllModals() {
  let guard = 0;
  while (modalStack.length && guard++ < 20) finalizeClose(modalStack[modalStack.length - 1]);
}

/* ---------------------------------- 浮层 ---------------------------------- */
let popAnchor = null;

function showPopover(anchor, html, opts = {}) {
  closePopover();
  const pop = document.createElement('div');
  pop.className = 'popover';
  pop.id = 'ui-pop';
  pop.style.position = 'fixed';
  pop.innerHTML = html;
  document.body.appendChild(pop);

  const r = anchor.getBoundingClientRect();
  const w = opts.width || pop.offsetWidth;
  const h = pop.offsetHeight;
  let left = opts.align === 'left' ? r.left : r.right - w;
  left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
  let top = r.bottom + 6;
  if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
  pop.style.left = left + 'px';
  pop.style.top = top + 'px';
  if (opts.width) pop.style.width = w + 'px';
  popAnchor = anchor;
  return pop;
}

function closePopover() {
  const p = $('#ui-pop');
  if (p) p.remove();
  popAnchor = null;
}

/* ------------------------------ 分类选择器 ------------------------------ */

let activePicker = null;

function catTriggerHTML(cat, placeholder) {
  if (!cat) {
    return `<span class="ph">${esc(placeholder || '选择分类')}</span>`;
  }
  return `<span class="cat-dot" style="--c:${cat.color}"></span><span class="val">${esc(cat.name)}</span>`;
}

function categoryPickerHTML({ value = '', kind = '', placeholder = '选择分类', name = 'categoryId' }) {
  const cat = value ? catById(value) : null;
  return `<div class="cat-picker" data-cat-picker data-kind="${kind}" data-name="${name}">
    <button type="button" class="cat-trigger" data-cat-trigger>
      ${catTriggerHTML(cat, placeholder)}
      <span class="chev">${icon('chevronDown', 14)}</span>
    </button>
    <input type="hidden" name="${name}" value="${value || ''}">
  </div>`;
}

function catOptionsHTML(kind, selected, q) {
  const query = (q || '').trim().toLowerCase();
  const groups = kind ? [kind] : ['out', 'in'];
  let html = '';
  groups.forEach(k => {
    const list = DB.categories.filter(c =>
      c.active !== false && c.kind === k && (!query || c.name.toLowerCase().includes(query))
    ).sort((a, b) => (a.system === b.system ? a.name.localeCompare(b.name, 'zh') : a.system ? -1 : 1));
    if (!list.length) return;
    html += `<div class="cat-group-label">${k === 'in' ? '收入分类' : '支出分类'}</div>`;
    html += list.map(c => `<button type="button" class="cat-opt ${c.id === selected ? 'is-selected' : ''}" data-cat-opt="${c.id}">
      <span class="cat-ico" style="--c:${c.color}">${icon(c.icon, 13)}</span>
      <span class="name">${esc(c.name)}</span>
      ${c.id === selected ? `<span class="check">${icon('check', 14)}</span>` : ''}
    </button>`).join('');
  });
  return html || `<div class="cat-empty">没有匹配的分类</div>`;
}

function openCatPicker(wrap) {
  closeCatPicker();
  closePopover();
  const trigger = wrap.querySelector('[data-cat-trigger]');
  const input = wrap.querySelector('input[type=hidden]');
  const kind = wrap.dataset.kind || '';

  trigger.classList.add('is-open');
  const pop = document.createElement('div');
  pop.className = 'popover cat-pop';
  pop.id = 'cat-pop';
  pop.style.position = 'fixed';
  pop.innerHTML = `
    <div class="cat-search-wrap">
      <input class="cat-search" type="text" placeholder="搜索分类…" autocomplete="off">
    </div>
    <div class="cat-scroll">${catOptionsHTML(kind, input.value, '')}</div>
    <div class="cat-pop-foot">
      <button type="button" data-cat-new>${icon('plus', 13)} 新建分类</button>
      <button type="button" data-cat-manage>管理分类</button>
    </div>`;
  document.body.appendChild(pop);

  const r = trigger.getBoundingClientRect();
  const w = Math.max(r.width, 290);
  let left = Math.min(r.left, window.innerWidth - w - 10);
  let top = r.bottom + 6;
  const h = pop.offsetHeight;
  if (top + h > window.innerHeight - 10) top = Math.max(10, r.top - h - 6);
  pop.style.left = Math.max(10, left) + 'px';
  pop.style.top = top + 'px';
  pop.style.width = w + 'px';

  activePicker = { wrap, trigger, input, pop };
  const search = pop.querySelector('.cat-search');
  setTimeout(() => search.focus(), 30);

  search.addEventListener('input', () => {
    pop.querySelector('.cat-scroll').innerHTML = catOptionsHTML(kind, input.value, search.value);
  });
  search.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const first = pop.querySelector('.cat-opt');
      if (first) first.click();
    }
  });
}

function closeCatPicker() {
  if (!activePicker) return;
  activePicker.trigger.classList.remove('is-open');
  activePicker.pop.remove();
  activePicker = null;
}

function setPickerValue(wrap, catId) {
  const input = wrap.querySelector('input[type=hidden]');
  const trigger = wrap.querySelector('[data-cat-trigger]');
  input.value = catId;
  const cat = catById(catId);
  trigger.innerHTML = catTriggerHTML(cat, '选择分类') + `<span class="chev">${icon('chevronDown', 14)}</span>`;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

/* ---------------------------------- 图表 ---------------------------------- */

function smoothPath(pts) {
  if (!pts.length) return '';
  if (pts.length === 1) return `M${pts[0][0]},${pts[0][1]}`;
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

let chartSeq = 0;

/* 迷你走势线：用于主指标卡内部，白色描边 */
function sparkline(points, opts = {}) {
  if (!points || points.length < 2) return '';
  const w = 300, h = opts.height || 52;
  const vals = points.map(p => p.value);
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = max - min || 1;
  const X = i => (i / (points.length - 1)) * w;
  const Y = v => h - 5 - ((v - min) / span) * (h - 10);
  const pts = points.map((p, i) => [X(i), Y(p.value)]);
  const d = smoothPath(pts);
  const gid = 'spk' + (++chartSeq);
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"
    style="display:block;width:100%;height:${h}px;overflow:visible">
    <defs>
      <linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="rgba(255,255,255,.42)"/>
        <stop offset="100%" stop-color="rgba(255,255,255,0)"/>
      </linearGradient>
    </defs>
    <path d="${d} L${w},${h} L0,${h} Z" fill="url(#${gid})"/>
    <path d="${d}" fill="none" stroke="rgba(255,255,255,.92)" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
  </svg>`;
}

function areaChart(points, opts = {}) {
  if (!points || !points.length) return `<div class="chart-empty" style="height:${opts.height || 220}px">暂无数据</div>`;
  const w = 760, h = opts.height || 240;
  const pad = { l: 54, r: 16, t: 16, b: 26 };
  const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
  const vals = points.map(p => p.value);
  let min = Math.min(...vals), max = Math.max(...vals);
  if (max === min) { const d = Math.max(Math.abs(max) * .05, 100); min -= d; max += d; }
  const span = max - min;
  max += span * .10; min -= span * .06;

  const X = i => pad.l + (points.length === 1 ? iw / 2 : (i * iw) / (points.length - 1));
  const Y = v => pad.t + ih - ((v - min) / (max - min)) * ih;

  let grid = '';
  for (let i = 0; i <= 4; i++) {
    const y = pad.t + (ih * i) / 4;
    const val = max - ((max - min) * i) / 4;
    grid += `<line x1="${pad.l}" y1="${y.toFixed(1)}" x2="${w - pad.r}" y2="${y.toFixed(1)}" stroke="var(--line)"/>`;
    grid += `<text x="${pad.l - 10}" y="${(y + 3.5).toFixed(1)}" text-anchor="end" font-size="10.5" fill="var(--muted-2)">${fmtShort(val)}</text>`;
  }

  const pts = points.map((p, i) => [X(i), Y(p.value)]);
  const line = smoothPath(pts);
  const area = `${line} L${X(points.length - 1).toFixed(1)},${pad.t + ih} L${X(0).toFixed(1)},${pad.t + ih} Z`;

  const ticks = [];
  const count = Math.min(5, points.length);
  for (let i = 0; i < count; i++) ticks.push(Math.round((i * (points.length - 1)) / Math.max(count - 1, 1)));
  const xLabels = [...new Set(ticks)].map(i =>
    `<text x="${X(i).toFixed(1)}" y="${h - 6}" text-anchor="middle" font-size="10.5" fill="var(--muted-2)">${shortDate(points[i].label)}</text>`
  ).join('');

  const last = points[points.length - 1];
  const lx = X(points.length - 1), ly = Y(last.value);

  const hits = points.map((p, i) => {
    const bw = points.length > 1 ? iw / (points.length - 1) : iw;
    return `<rect class="hit" data-i="${i}" data-label="${p.label}" data-value="${p.value}" x="${(X(i) - bw / 2).toFixed(1)}" y="${pad.t}" width="${bw.toFixed(1)}" height="${ih}" fill="transparent"/>`;
  }).join('');

  const gid = 'ag' + (++chartSeq);
  return `<div class="chart-wrap" data-chart>
    <div class="chart-tip"></div>
    <svg viewBox="0 0 ${w} ${h}" role="img">
      <defs>
        <linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#6366f1" stop-opacity=".20"/>
          <stop offset="100%" stop-color="#6366f1" stop-opacity="0"/>
        </linearGradient>
      </defs>
      ${grid}
      <path d="${area}" fill="url(#${gid})"/>
      <path d="${line}" fill="none" stroke="#4f46e5" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>
      <line x1="${lx.toFixed(1)}" y1="${pad.t}" x2="${lx.toFixed(1)}" y2="${pad.t + ih}" stroke="#c7d2fe" stroke-dasharray="3 3"/>
      <circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="4" fill="#fff" stroke="#4f46e5" stroke-width="2.4"/>
      ${xLabels}
      ${hits}
    </svg>
  </div>`;
}

function barChart(rows, opts = {}) {
  if (!rows.length) return `<div class="chart-empty" style="height:${opts.height || 220}px">暂无数据</div>`;
  const w = 760, h = opts.height || 230;
  const pad = { l: 54, r: 16, t: 14, b: 28 };
  const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
  const maxVal = Math.max(1, ...rows.map(r => Math.max(r.in, r.out)));
  const Y = v => pad.t + ih - (v / maxVal) * ih;

  let grid = '';
  for (let i = 0; i <= 4; i++) {
    const y = pad.t + (ih * i) / 4;
    const val = maxVal - (maxVal * i) / 4;
    grid += `<line x1="${pad.l}" y1="${y.toFixed(1)}" x2="${w - pad.r}" y2="${y.toFixed(1)}" stroke="var(--line)"/>`;
    grid += `<text x="${pad.l - 10}" y="${(y + 3.5).toFixed(1)}" text-anchor="end" font-size="10.5" fill="var(--muted-2)">${fmtShort(val)}</text>`;
  }

  const slot = iw / rows.length;
  const bw = Math.max(5, Math.min(16, slot / 3.4));
  let bars = '';
  rows.forEach((r, i) => {
    const cx = pad.l + slot * i + slot / 2;
    const x1 = cx - bw - 1.5, x2 = cx + 1.5;
    bars += `<rect x="${x1.toFixed(1)}" y="${Y(r.in).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, pad.t + ih - Y(r.in)).toFixed(1)}" rx="3" fill="#f87171"><title>${r.label} 流入 ${fmt(r.in)}</title></rect>`;
    bars += `<rect x="${x2.toFixed(1)}" y="${Y(r.out).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, pad.t + ih - Y(r.out)).toFixed(1)}" rx="3" fill="#34d399"><title>${r.label} 流出 ${fmt(r.out)}</title></rect>`;
    if (rows.length <= 14) {
      bars += `<text x="${cx.toFixed(1)}" y="${h - 8}" text-anchor="middle" font-size="10.5" fill="var(--muted-2)">${r.label}</text>`;
    }
  });

  return `<div class="chart-wrap"><svg viewBox="0 0 ${w} ${h}" role="img">${grid}${bars}</svg></div>`;
}

function donutChart(rows, opts = {}) {
  /* 半径要留出「悬停加粗到 27」的余量：r + 27/2 必须小于 size/2，
     否则加粗后的扇区会被 SVG viewBox 裁掉一块（阶段三 4） */
  const size = opts.size || 168, r = size / 2 - 16, cx = size / 2, cy = size / 2;
  const total = rows.reduce((s, x) => s + x.value, 0);
  if (!total) return `<div class="chart-empty" style="height:${size}px">暂无数据</div>`;
  const C = 2 * Math.PI * r;
  let offset = 0;
  const segs = rows.map((x, i) => {
    const len = (x.value / total) * C;
    const pct = ((x.value / total) * 100).toFixed(1);
    const s = `<circle class="dseg" data-i="${i}" data-label="${esc(x.label)}" data-value="${fmt(x.value)}" data-pct="${pct}"
      cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${x.color}" stroke-width="18"
      stroke-dasharray="${Math.max(len - 1.5, 0).toFixed(2)} ${(C - len + 1.5).toFixed(2)}"
      stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 ${cx} ${cy})" stroke-linecap="butt"/>`;
    offset += len;
    return s;
  }).join('');
  const defLabel = opts.centerLabel || '合计';
  const defValue = opts.centerValue || fmtShort(total);
  return `<div style="display:flex;align-items:center;justify-content:center">
    <div class="donut-wrap" style="position:relative;width:${size}px;height:${size}px">
      <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">${segs}</svg>
      <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;pointer-events:none">
        <span class="dcenter-label" data-def="${esc(defLabel)}" style="font-size:10.5px;color:var(--muted-2);max-width:${size - 34}px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(defLabel)}</span>
        <strong class="dcenter-value" data-def="${esc(defValue)}" style="font-size:14.5px;font-weight:650;letter-spacing:-.02em;font-variant-numeric:tabular-nums;max-width:${size - 28}px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(defValue)}</strong>
      </div>
    </div>
  </div>`;
}

/* 悬浮提示定位（阶段三 1）
   原先 tip 固定画在锚点上方 26px，且 .chart-wrap 是 overflow:hidden，
   于是折线最高点、最左/最右点的金额会被容器裁掉一截。
   现在：先写入内容并 show，量到真实尺寸后再定位——横向夹进容器内，纵向放不下就翻到锚点下方。 */
function placeChartTip(wrap, tip, hit) {
  const wr = wrap.getBoundingClientRect();
  const hr = hit.getBoundingClientRect();
  tip.classList.add('show');
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  const gap = 8, edge = 4;

  /* 横向：以命中区中心为锚点，整体夹在容器内，容器再窄也保证两端不出血 */
  const cx = hr.left - wr.left + hr.width / 2;
  const half = tw / 2;
  let left = cx;
  if (wr.width >= tw + edge * 2) left = Math.min(Math.max(cx, half + edge), wr.width - half - edge);
  else left = wr.width / 2;
  tip.style.left = left.toFixed(1) + 'px';

  /* 纵向：优先画在命中区上方，顶到容器上沿就翻到下方；再放不下就贴边显示 */
  let top = hr.top - wr.top - th - gap;
  if (top < edge) {
    const below = hr.top - wr.top + hr.height + gap;
    top = (below + th <= wr.height - edge) ? below : edge;
  }
  if (top + th > wr.height - edge) top = Math.max(edge, wr.height - th - edge);
  tip.style.top = top.toFixed(1) + 'px';
}

function initCharts(scope = document) {
  $$('[data-chart]', scope).forEach(wrap => {
    const tip = wrap.querySelector('.chart-tip');
    if (!tip) return;
    wrap.addEventListener('mouseover', e => {
      const hit = e.target.closest('.hit');
      if (!hit) return;
      tip.innerHTML = `${hit.dataset.label}<br><b>${fmt(Number(hit.dataset.value))}</b>`;
      placeChartTip(wrap, tip, hit);
    });
    wrap.addEventListener('mouseleave', () => tip.classList.remove('show'));
  });
}

/* -------------------------------- 文件导出 -------------------------------- */

async function saveTextFile(filename, content, mime) {
  const payload = /csv/i.test(mime || '') ? '\ufeff' + content : content;
  if (DESKTOP) {
    const r = await window.desktop.saveFile({ defaultName: filename, content: payload });
    if (r && r.ok) return true;
    if (r && r.canceled) return false;
    toast('保存失败：' + ((r && r.error) || '未知错误'), 'err');
    return false;
  }
  try {
    const blob = new Blob([payload], { type: mime || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    return true;
  } catch (e) {
    toast('导出失败：' + e.message, 'err');
    return false;
  }
}

const csvCell = v => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

function toCSV(head, rows) {
  return [head, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n');
}

/* -------------------------------- 全局事件 -------------------------------- */

document.addEventListener('click', e => {
  /* 分类选择器 */
  const trigger = e.target.closest('[data-cat-trigger]');
  if (trigger) {
    const wrap = trigger.closest('[data-cat-picker]');
    if (activePicker && activePicker.wrap === wrap) closeCatPicker();
    else openCatPicker(wrap);
    e.stopPropagation();
    return;
  }

  if (e.target.closest('#cat-pop')) {
    const opt = e.target.closest('[data-cat-opt]');
    if (opt && activePicker) {
      setPickerValue(activePicker.wrap, opt.dataset.catOpt);
      closeCatPicker();
      return;
    }
    if (e.target.closest('[data-cat-new]') && activePicker) {
      const wrap = activePicker.wrap;
      const kind = wrap.dataset.kind || 'out';
      closeCatPicker();
      openCategoryModal(null, {
        kind,
        onSave: cat => { if (cat) setPickerValue(wrap, cat.id); }
      });
      return;
    }
    if (e.target.closest('[data-cat-manage]')) {
      closeCatPicker();
      closeModal();
      navigate('categories');
      return;
    }
    return;
  }

  /* 点击外部关闭浮层 */
  if (!e.target.closest('#ui-pop') && !e.target.closest('[data-menu-trigger]')) closePopover();
  if (!e.target.closest('#cat-pop') && !e.target.closest('[data-cat-trigger]')) closeCatPicker();
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (activePicker) { closeCatPicker(); return; }
    if (popAnchor) { closePopover(); return; }
    closeModal();
  }
});

window.addEventListener('resize', () => { closeCatPicker(); closePopover(); });


/* 字段级校验：高亮 + 抖动 + 定位（需求19/20） */
function failField(form, name, msg) {
  const el = form && form.querySelector('[name="' + name + '"]');
  const field = el ? el.closest('.field') : null;
  if (field) {
    field.classList.remove('is-invalid');
    void field.offsetWidth;
    field.classList.add('is-invalid');
    try { field.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { /* 忽略 */ }
    setTimeout(() => field.classList.remove('is-invalid'), 2400);
  }
  if (el) { try { el.focus(); } catch (e) { /* 忽略 */ } }
  toast(msg, 'err');
  return false;
}

/* ============================================================================
   v4.6 统一数据校验（需求20）
   ========================================================================== */

const V = {
  required: v => String(v == null ? '' : v).trim().length > 0,
  number: v => v !== '' && v != null && Number.isFinite(Number(v)),
  decimals: (v, n) => {
    const s = String(v);
    if (s.indexOf('.') < 0) return true;
    return s.split('.')[1].length <= n;
  },
  date: v => /^\d{4}-\d{2}-\d{2}$/.test(String(v)) && !isNaN(new Date(v).getTime()),
  phone: v => /^[+\d][\d\s\-()]{5,24}$/.test(String(v)),
  taxNo: v => /^[A-Za-z0-9\-]{4,30}$/.test(String(v)),
  len: (v, min, max) => {
    const n = String(v == null ? '' : v).trim().length;
    return n >= min && n <= max;
  }
};

/**
 * 日期范围校验（G-03）：开始日期必须 ≤ 结束日期。
 * 参数可以是 input 元素，也可以直接是 'YYYY-MM-DD' 字符串。
 * 返回 true 表示通过；不通过时会给两个字段加红框并 toast。
 */
function checkDateRange(from, to, opts = {}) {
  const fv = typeof from === 'string' ? from : ((from && from.value) || '');
  const tv = typeof to === 'string' ? to : ((to && to.value) || '');
  if (!fv || !tv || fv <= tv) return true;
  [from, to].forEach(el => {
    if (el && el.closest) {
      const f = el.closest('.field');
      if (!f) return;
      f.classList.add('is-invalid');
      if (!f.querySelector('.field-err')) {
        const d = document.createElement('div');
        d.className = 'field-err';
        d.textContent = opts.msg || '开始日期不能晚于结束日期';
        f.appendChild(d);
      }
    }
  });
  toast(opts.msg || '开始日期不能晚于结束日期', 'err');
  return false;
}

/**
 * 统一校验
 * rules: [{ name, label, checks: [{ t:'required'|'number'|'date'|'phone'|'taxNo', min, max, decimals, unique, msg }] }]
 * 返回 { ok, errors: [{ name, msg }] }
 */
function validateForm(form, rules) {
  const errors = [];
  /* 清掉上一次的错误标记 */
  form.querySelectorAll('.field').forEach(f => {
    f.classList.remove('is-invalid');
    const e = f.querySelector('.field-err');
    if (e) e.remove();
  });

  rules.forEach(rule => {
    const el = form.querySelector('[name="' + rule.name + '"]');
    const raw = el ? (el.type === 'checkbox' ? el.checked : el.value) : '';
    let msg = '';

    for (const c of (rule.checks || [])) {
      const label = rule.label || rule.name;
      if (c.t === 'required' && !V.required(raw)) { msg = c.msg || ('请填写' + label); break; }
      if (c.t === 'number') {
        if (!V.number(raw)) { msg = c.msg || (label + '必须是数字'); break; }
        const n = Number(raw);
        if (c.min != null && n < c.min) { msg = c.msg || (label + '不能小于 ' + c.min); break; }
        if (c.max != null && n > c.max) { msg = c.msg || (label + '不能大于 ' + c.max); break; }
        if (c.decimals != null && !V.decimals(raw, c.decimals)) { msg = c.msg || (label + '最多 ' + c.decimals + ' 位小数'); break; }
      }
      if (c.t === 'date' && String(raw).trim() && !V.date(raw)) { msg = c.msg || (label + '格式不正确'); break; }
      if (c.t === 'phone' && String(raw).trim() && !V.phone(raw)) { msg = c.msg || '电话格式不正确'; break; }
      if (c.t === 'taxNo' && String(raw).trim() && !V.taxNo(raw)) { msg = c.msg || '税号只能包含字母、数字和 -'; break; }
      if (c.t === 'len' && !V.len(raw, c.min || 0, c.max || 999)) {
        msg = c.msg || (label + '长度需在 ' + (c.min || 0) + '–' + (c.max || 999) + ' 之间'); break;
      }
      if (c.t === 'unique' && V.required(raw)) {
        const dup = c.unique(String(raw).trim());
        if (dup) { msg = c.msg || (label + '「' + raw + '」已存在'); break; }
      }
    }

    if (msg) {
      errors.push({ name: rule.name, msg });
      if (el) {
        const field = el.closest('.field');
        if (field) {
          field.classList.add('is-invalid');
          const tip = document.createElement('span');
          tip.className = 'field-err';
          tip.textContent = msg;
          field.appendChild(tip);
        }
      }
    }
  });

  return { ok: errors.length === 0, errors };
}

/* 校验失败后的统一反馈：定位第一个错误 + 抖动 + 提示 */
function showFormErrors(form, result) {
  if (result.ok) return true;
  const first = result.errors[0];
  const el = form.querySelector('[name="' + first.name + '"]');
  const field = el ? el.closest('.field') : null;
  if (field) {
    try { field.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { /* 忽略 */ }
  }
  if (el) { try { el.focus(); } catch (e) { /* 忽略 */ } }
  toast(result.errors.length === 1 ? first.msg : ('有 ' + result.errors.length + ' 处需要修正'), 'err');
  return false;
}
