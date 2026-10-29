/* ============================================================================
   合资金账 · 应用外壳
   登录 / 初始化 / 导航 / 路由 / 事件
   ========================================================================== */

'use strict';

/* ---------------------------------- 导航 ---------------------------------- */

const NAV = [
  {
    group: '集团', multi: true, items: [
      { view: 'group', label: '集团总览', icon: 'layers' },
      { view: 'group-reports', label: '集团报表', icon: 'report' }
    ]
  },
  { group: '概览', items: [{ view: 'dashboard', label: '公司总览', icon: 'dashboard' }] },
  {
    group: '账务', items: [
      { view: 'transactions', label: '资金流水', icon: 'flow' },
      { view: 'debts', label: '往来款', icon: 'debt', badge: 'debts' },
      { view: 'advances', label: '借支备用金', icon: 'wallet' },
      { view: 'invoices', label: '票据未回', icon: 'receipt' },
      { view: 'projects', label: '项目', icon: 'layers' }
    ]
  },
  {
    group: '管理', items: [
      { view: 'profile', label: '公司档案', icon: 'folder' },
      { view: 'parties', label: '往来单位', icon: 'users' },
      { view: 'accounts', label: '账户管理', icon: 'account' },
      { view: 'budgets', label: '预算管理', icon: 'budget' },
      { view: 'categories', label: '分类管理', icon: 'tag', admin: true }
    ]
  },
  { group: '报表', items: [
    { view: 'reports', label: '资金报表', icon: 'report' },
    { view: 'vouchers', label: '凭证查询', icon: 'file' }
  ] },
  {
    group: '系统', items: [
      { view: 'companies', label: '公司管理', icon: 'briefcase', admin: true },
      { view: 'users', label: '用户管理', icon: 'users', admin: true },
      { view: 'logs', label: '操作日志', icon: 'file', admin: true },
      { view: 'backup', label: '云盘备份', icon: 'upload', admin: true },
      { view: 'settings', label: '设置', icon: 'settings' }
    ]
  }
];

const GROUP_VIEWS = ['group', 'group-reports'];

const VIEW_META = {
  group: ['集团总览', '所有公司资金一览'],
  'group-reports': ['集团报表', '合并现金流量与资金汇总'],
  dashboard: ['公司总览', ''],
  transactions: ['资金流水', ''],
  debts: ['往来款', '借出、借入与员工未报销'],
  budgets: ['预算管理', '按分类控制月度支出'],
  profile: ['公司档案', '基本资料 · 账号凭证 · 归档文件'],
  accounts: ['账户管理', '现金与银行存款'],
  categories: ['分类管理', '自定义收支分类与现金流口径'],
  reports: ['资金报表', '现金流量表 · 月末对账单 · 统计汇总'],
  companies: ['公司管理', '每家公司的独立账本'],
  users: ['用户管理', '账号与权限'],
  backup: ['云盘备份', '自动备份到 WebDAV / Google Drive'],
  projects: ['项目', '按项目归集资金使用'],
  drill: ['指标下钻', '各公司构成'],
  parties: ['往来单位', '客户与供应商档案'],
  vouchers: ['凭证查询', '按凭证号检索单据'],
  advances: ['借支备用金', '员工预支与核销'],
  invoices: ['票据未回', '付款后发票跟踪'],
  logs: ['操作日志', '所有更改操作的审计记录'],
  settings: ['设置', '货币 · 主题 · 安全 · 数据备份']
};

const isGroupView = () => GROUP_VIEWS.includes(UI.view);

/* ---------------------------------- 外壳 ---------------------------------- */

function navHTML() {
  const multi = allowedCompanies().length > 1;
  return NAV.map(g => {
    if (g.multi && !multi) return '';
    const items = g.items.filter(it => !it.admin || isAdmin());
    if (!items.length) return '';
    return `<div class="nav-group">
      <div class="nav-label">${g.group}</div>
      ${items.map(it => {
        let badge = '';
        if (it.badge === 'debts' && !isGroupView()) {
          const n = DB.debts.filter(d => debtInfo(d).status !== 'settled').length;
          if (n) badge = `<span class="nav-badge">${n}</span>`;
        }
        return `<button class="nav-item ${UI.view === it.view ? 'is-active' : ''}" data-action="nav" data-view="${it.view}">
          ${icon(it.icon, 14)}<span>${it.label}</span>${badge}
        </button>`;
      }).join('')}
    </div>`;
  }).join('');
}

function companySwitcherHTML() {
  const g = isGroupView();
  const badge = g ? '集' : initials(COMPANY.name);
  const color = g ? '#4f46e5' : COMPANY.color;
  return `<div class="sb-company-wrap" id="sb-company-slot">
    <button class="sb-company" data-action="company-menu" data-menu-trigger>
      <span class="co-badge" style="--c:${color}">${esc(badge)}</span>
      <span class="co-meta">
        <strong>${g ? esc(groupTitle()) : esc(COMPANY.name)}</strong>
        <span>${g ? `${DB.companies.length} 家公司 · 合并口径` : `${DB.companies.length} 家公司 · 点击切换`}</span>
      </span>
      ${icon('chevronDown', 14)}
    </button>
  </div>`;
}

function renderShell() {
  const meta = VIEW_META[UI.view] || ['', ''];
  document.body.style.overflow = '';
  if (window.Scene3D) Scene3D.dispose();
  $('#root').innerHTML = `
  <div class="app">
    <aside class="sidebar">
      <div class="sb-brand">
        <div class="sb-logo">${icon('wallet', 17)}</div>
        <div class="sb-name"><strong>合资金账</strong><span>FUND MERGE</span></div>
        <button class="sb-toggle" data-action="toggle-sidebar" title="折叠 / 展开侧边栏">${icon('chevronLeft', 15)}</button>
      </div>
      ${companySwitcherHTML()}
      <nav class="sb-nav" id="nav">${navHTML()}</nav>      <div class="sb-foot">
        <div class="sb-status">
          <span class="dot"></span>
          <span>数据保存在<b>本机${DESKTOP ? '文件' : ''}</b></span>
        </div>
      </div>
    </aside>

    <main class="main">
      <header class="topbar">
        <div class="tb-left">
          <h1 class="tb-title" id="page-title">${meta[0]}</h1>
          <span class="tb-sub" id="page-sub">${meta[1]}</span>
        </div>
        <div class="tb-right">
          <button class="btn secondary sm" data-action="nav" data-view="reports">${icon('report', 14)} 报表</button>
          <button class="btn primary" data-action="new-tx">${icon('plus', 15)} 记一笔</button>
          <button class="user-chip" data-action="user-menu" data-menu-trigger>
            ${avatarHTML(SESSION.displayName)}
            <span class="user-meta"><strong>${esc(SESSION.displayName)}</strong><span>${roleLabel(SESSION.role)}</span></span>
            ${icon('chevronDown', 14)}
          </button>
        </div>
      </header>
      <div class="content" id="view-root"></div>
    </main>
  </div>`;

  renderView();
}

function render() { if (SESSION) renderView(); }

function renderView() {
  if (!SESSION) return;
  if (!can('view')) return;
  if ((UI.view === 'users' || UI.view === 'categories') && !isAdmin()) UI.view = 'dashboard';

  const root = $('#view-root');
  if (!root) return renderShell();

  let html = '';
  switch (UI.view) {
    case 'group': html = viewGroupDashboard(); break;
    case 'group-reports': html = viewGroupReports(); break;
    case 'dashboard': html = viewDashboard(); break;
    case 'transactions': html = viewTransactions(); break;
    case 'debts': html = viewDebts(); break;
    case 'budgets': html = viewBudgets(); break;
    case 'profile': html = viewProfile(); break;
    case 'logs': html = viewLogs(); break;
    case 'parties': html = viewParties(); break;
    case 'vouchers': html = viewVouchers(); break;
    case 'advances': html = viewAdvances(); break;
    case 'invoices': html = viewInvoices(); break;
    case 'projects': html = viewProjects(); break;
    case 'backup':
      html = viewBackup();
      loadBackupCfg();
      /* 只取一次版本列表，且只刷新表格、不整页重绘。
         旧写法 versions().then(renderView) 会形成「渲染 → 取数 → 再渲染」的无限循环，
         进页面即把主线程打满，表现就是整页卡死、点哪都没反应。 */
      if (DESKTOP && window.desktop.backup && window.desktop.backup.versions && !UI.backupVerLoading) {
        UI.backupVerLoading = true;
        window.desktop.backup.versions()
          .then(list => { UI.backupVersions = list; })
          .catch(() => { /* 读不到就保持空列表，不阻断页面 */ })
          .finally(() => {
            UI.backupVerLoading = false;
            UI.backupVersionsLoaded = true;
            if (UI.view === 'backup') refreshBackupVersions();
          });
      }
      break;
    case 'drill': html = viewDrill(); break;
    case 'accounts': html = viewAccounts(); break;
    case 'categories': html = viewCategories(); break;
    case 'reports': html = viewReports(); break;
    case 'companies': html = viewCompanies(); break;
    case 'users': html = viewUsers(); break;
    case 'settings': html = viewSettings(); if (DESKTOP && window.desktop.flpack && !UI.packAuto) { window.desktop.flpack.autoStatus().then(s => { UI.packAuto = s; renderView(); }); } break;
    default: html = viewDashboard();
  }
  /* 不在这里销毁 3D：Scene3D.mount 会复用缓存里的 canvas，
     每次销毁重建等于每切一次页面就重编译一遍着色器。 */
  root.innerHTML = html;
  /* 首次使用：内置管理员尚未设置口令 */
  const pending = DB.users.find(u => u.builtin && u.mustSetPassword);
  if (pending) {
    root.innerHTML = firstRunHTML(pending);
    if (window.Scene3D) Scene3D.mount(root);
    bindFirstRun();
    return;
  }

  if (window.Scene3D) Scene3D.mount(root);

  /* 缺汇率提示（REQ-22）：绝不按 1:1 静默折算，必须让用户看见 */
  try {
    const miss = (typeof missingRateCurrencies === 'function') ? missingRateCurrencies() : [];
    if (miss.length) {
      const bar = document.createElement('div');
      bar.className = 'alert warn no-print';
      bar.style.margin = '0 0 12px';
      bar.innerHTML = `${icon('alert', 15)}<div>有 ${miss.length} 种外币缺少汇率（${miss.join('、')}），这些账户的金额<b>未计入</b>汇总。` +
        `<button class="btn sm secondary" data-action="nav" data-view="settings" style="margin-left:10px">去录入汇率</button></div>`;
      root.prepend(bar);
    }
  } catch (e) { /* 提示失败不影响主流程 */ }

  const meta = VIEW_META[UI.view] || ['', ''];
  const titleEl = $('#page-title'), subEl = $('#page-sub');
  if (titleEl) titleEl.textContent = (UI.view === 'drill')
    ? (DRILL_METRICS[UI.drillMetric] || '指标下钻')
    : meta[0];
  if (subEl) {
    let sub = meta[1];
    if (isGroupView()) sub = `${DB.companies.length} 家公司 · 合并口径`;
    else if (UI.view === 'dashboard') sub = `${COMPANY.name} · 资金全景`;
    else if (UI.view === 'transactions') sub = `${COMPANY.name} · 共 ${DB.transactions.length} 笔`;
    else if (UI.view === 'accounts') sub = `${COMPANY.name} · ${DB.accounts.length} 个账户`;
    subEl.textContent = sub;
  }
  $$('#nav .nav-item').forEach(b => b.classList.toggle('is-active', b.dataset.view === UI.view));
  const nav = $('#nav');
  if (nav) nav.innerHTML = navHTML();
  const slot = $('#sb-company-slot');
  if (slot) slot.outerHTML = companySwitcherHTML();
  applySidebar();
  animateView(root);
  runCounters(root);
  initCharts(root);
  if (UI.view === 'profile') setTimeout(() => refreshFileStats(false), 40);
}

/* 刷新附件在磁盘上的最后修改时间（网盘同步后可能需要手动刷新） */
let refreshingStats = false;
async function refreshFileStats(manual) {
  if (!DESKTOP || refreshingStats || !COMPANY) return;
  const files = (COMPANY.profile.files || []).filter(f => f.relPath);
  if (!files.length) { if (manual) toast('还没有归档文件', ''); return; }
  refreshingStats = true;
  try {
    const stats = await FileStore.stats(files);
    let changed = false;
    (stats || []).forEach(s => {
      if (!s || !s.exists) return;
      const f = files.find(x => x.relPath === s.relPath);
      if (!f) return;
      if (s.mtime && s.mtime !== f.mtime) { f.mtime = s.mtime; changed = true; }
      if (s.size && s.size !== f.size) { f.size = s.size; changed = true; }
    });
    if (changed) { saveDB(); renderView(); }
    if (manual) toast(changed ? '已刷新文件时间' : '文件时间已是最新', 'ok');
  } catch (e) {
    if (manual) toast('刷新失败：' + e.message, 'err');
  } finally {
    setTimeout(() => { refreshingStats = false; }, 80);
  }
}

/* 页面切换入场动效：只在「视图/公司」真正变化时触发，数据刷新不重放 */
let lastViewKey = '';
function animateView(root) {
  if (perfLow()) return;                 /* 流畅模式不做入场动画，省掉一次强制重排 */
  const key = UI.view + '|' + (COMPANY ? COMPANY.id : '');
  if (key === lastViewKey) return;
  lastViewKey = key;
  root.classList.remove('is-entering');
  void root.offsetWidth;
  root.classList.add('is-entering');
  clearTimeout(window.__enterTimer);
  window.__enterTimer = setTimeout(() => root.classList.remove('is-entering'), 700);
}

function navigate(view) {
  if ((view === 'users' || view === 'categories') && !isAdmin()) {
    return toast('仅管理员可访问该页面', 'err');
  }
  UI.view = view;
  renderView();
  closePopover();
  closeCatPicker();
}

/* --------------------------------- 登录页 --------------------------------- */

function authBrandHTML() {
  return `<div class="auth-brand">
    <div class="scene-wrap"><canvas class="scene-canvas" data-scene="auth"></canvas></div>
    <div class="auth-logo">
      <div class="mark">${icon('wallet', 19)}</div>
      <div><strong>合资金账</strong><span>FUND MERGE</span></div>
    </div>
    <div class="auth-hero">
      <h1>让每一笔资金的<br>来龙去脉都清楚</h1>
      <p>面向中小企业的现金与银行账户管理：流水、往来、预算、现金流量表与月末对账单，全部离线保存在本机。</p>
      <div class="auth-points">
        <div class="auth-point">
          <div class="ico">${icon('flow', 14)}</div>
          <div><b>收支一目了然</b><span>现金与多银行账户统一记账，余额自动结出</span></div>
        </div>
        <div class="auth-point">
          <div class="ico">${icon('debt', 14)}</div>
          <div><b>往来不遗漏</b><span>借出、借入、员工未报销逐笔跟踪，到期提醒</span></div>
        </div>
        <div class="auth-point">
          <div class="ico">${icon('report', 14)}</div>
          <div><b>报表随时出</b><span>现金流量表与月末对账单，一键打印归档</span></div>
        </div>
      </div>
    </div>
    <div class="auth-foot">© 2026 合资金账 · 数据仅保存在本机，不联网、不上传</div>
  </div>`;
}

function renderAuth(mode) {
  SESSION = null;
  document.body.style.overflow = '';
  const remembered = localStorage.getItem('fund-ledger-user') || '';
  const root = $('#root');
  if (window.Scene3D) Scene3D.dispose();

  if (mode === 'register') return renderAuthRegister();
  if (mode === 'forgot') return renderAuthForgot();

  if (mode === 'setup') {
    /* 统一到「首次使用」页：必须设置账号 + 口令 + 两个预留问题。
       旧实现只收账号与口令，导致唯一管理员忘记口令后无路可走。 */
    const bu = DB.users.find(u => u.builtin) || DB.users[0];
    if (bu) {
      bu.mustSetPassword = true;
      root.innerHTML = firstRunHTML(bu);
      if (window.Scene3D) Scene3D.mount(root);
      bindFirstRun();
      return;
    }
    root.innerHTML = `<div class="auth">
      ${authBrandHTML()}
      <div class="auth-panel">
        <div class="auth-form">
          <h2>初始化系统</h2>
          <p class="lead">第一次使用，请创建管理员账号。账号仅保存在本机，用于区分操作人与权限。</p>
          <form id="setup-form">
            <div class="auth-err" id="auth-err">${icon('alert', 14)}<span></span></div>
            <label class="field"><label>公司名称</label><input type="text" name="company" placeholder="如：Accra Trading Ltd" value="${esc(DB.companies[0] ? DB.companies[0].name : '我的公司')}" required></label>
            <label class="field"><label>管理员账号</label><input type="text" name="username" placeholder="3-20 位字母或数字" required autofocus></label>
            <label class="field"><label>显示名称</label><input type="text" name="displayName" placeholder="你的姓名" required></label>
            <label class="field"><label>登录密码</label><input type="password" name="password" placeholder="至少 6 位" required></label>
            <label class="field"><label>确认密码</label><input type="password" name="password2" placeholder="再次输入" required></label>
            <button class="btn primary block" type="submit">创建并进入</button>
          </form>
          <div class="auth-version">${icon('lock', 12)} 密码使用 PBKDF2-SHA256 加盐哈希存储</div>
        </div>
      </div>
    </div>`;

    if (window.Scene3D) Scene3D.mount(root);
    $('#setup-form').addEventListener('submit', async e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const err = $('#auth-err');
      const showErr = m => { err.classList.add('show'); err.querySelector('span').textContent = m; };
      const username = String(fd.get('username') || '').trim();
      const password = String(fd.get('password') || '');
      const company = String(fd.get('company') || '').trim() || '我的公司';
      const displayName = String(fd.get('displayName') || '').trim() || username;

      if (!/^[a-zA-Z0-9_.-]{3,20}$/.test(username)) return showErr('账号需为 3-20 位字母、数字或 _ . -');
      if (password.length < 6) return showErr('密码至少 6 位');
      if (password !== fd.get('password2')) return showErr('两次输入的密码不一致');
      if (!window.crypto || !crypto.subtle) return showErr('当前环境不支持安全加密，请使用桌面版');

      const btn = e.target.querySelector('button[type=submit]');
      btn.disabled = true; btn.textContent = '正在创建…';

      DB.companies[0].name = company;
      const user = await createUser({ username, displayName, password, role: 'admin' });
      saveDB();
      startSession(user);
      COMPANY = DB.companies[0];
      toast('初始化完成，欢迎使用', 'ok');
      renderShell();
    });
    return;
  }

  root.innerHTML = `<div class="auth">
    ${authBrandHTML()}
    <div class="auth-panel">
      <div class="auth-form">
        <h2>登录</h2>
        <p class="lead">${esc(DB.meta.groupName || (DB.companies.length > 1 ? `${DB.companies.length} 家公司` : DB.companies[0].name))} · 合资金账</p>
        <form id="login-form">
          <div class="auth-err" id="auth-err">${icon('alert', 14)}<span></span></div>
          <label class="field"><label>账号</label><input type="text" name="username" id="login-user" value="${esc(remembered)}" placeholder="请输入账号" required ${remembered ? '' : 'autofocus'}></label>
          <label class="field"><label>登录公司</label>
            <select name="companyId" id="login-company"><option value="">输入账号后选择公司</option></select>
          </label>
          <label class="field"><label>密码</label><input type="password" name="password" id="login-pwd" placeholder="请输入密码" required ${remembered ? 'autofocus' : ''}></label>
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
            <label class="switch"><input type="checkbox" name="remember" ${remembered ? 'checked' : ''}><span class="track"></span><span>记住账号</span></label>
            <label class="switch"><input type="checkbox" name="rememberPwd" ${hasRemember() ? 'checked' : ''}><span class="track"></span><span>记住密码</span></label>
          </div>
          ${hasRemember() ? '<button type="button" class="auth-clear" data-action="clear-remember">清除已记住的密码</button>' : ''}
          <button class="btn primary block" type="submit">登 录</button>
          <div class="auth-links">
            <button type="button" data-auth="register">注册账号</button>
            <span>·</span>
            <button type="button" data-auth="forgot">忘记密码</button>
            <span>·</span>
            <button type="button" data-action="pack-import">导入账套</button>
          </div>
        </form>
        <div class="auth-tip">忘记密码？可以通过注册时设置的预留信息自助重置；也可以让管理员在「用户管理」中重置。</div>
        <div class="auth-version">${icon('shield', 12)} 本地账户 · 密码加盐哈希存储 · v${APP_VERSION}</div>
      </div>
    </div>
  </div>`;

  if (window.Scene3D) Scene3D.mount(root);
  const fillCompanies = () => {
    const box = $('#login-company');
    const nameInput = $('#login-user');
    if (!box || !nameInput) return;
    const u = findUserByName(nameInput.value);
    if (!u) { box.innerHTML = '<option value="">输入账号后选择公司</option>'; return; }
    let list = DB.companies;
    if (u.role !== 'admin' && Array.isArray(u.companyIds) && u.companyIds.length) {
      list = DB.companies.filter(c => u.companyIds.includes(c.id));
    }
    if (!list.length) list = DB.companies;
    const cur = DB.meta.activeCompanyId;
    box.innerHTML = list.map(c =>
      '<option value="' + c.id + '"' + (c.id === cur ? ' selected' : '') + '>' + esc(c.name) + (c.isParent ? ' · 总公司' : '') + '</option>'
    ).join('');
  };
  const userBox = $('#login-user');
  if (userBox) {
    userBox.addEventListener('input', fillCompanies);
    userBox.addEventListener('blur', fillCompanies);
    if (userBox.value) fillCompanies();
  }

  if (hasRemember()) {
    loadRemember(remembered).then(pwd => {
      const box = $('#login-pwd');
      if (pwd && box && !box.value) box.value = pwd;
    });
  }
  $('#login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const err = $('#auth-err');
    const btn = e.target.querySelector('button[type=submit]');
    err.classList.remove('show');
    btn.disabled = true;
    const old = btn.textContent;
    btn.textContent = '验证中…';

    try {
      const r = await verifyLogin(fd.get('username'), fd.get('password'));
      if (!r.ok) {
        err.classList.add('show');
        err.querySelector('span').textContent = r.error;
        btn.disabled = false; btn.textContent = old;
        return;
      }
      if (fd.get('remember') === 'on') localStorage.setItem('fund-ledger-user', r.user.username);
      else localStorage.removeItem('fund-ledger-user');
      if (fd.get('rememberPwd') === 'on') await saveRemember(r.user.username, String(fd.get('password') || ''));
      else localStorage.removeItem(REMEMBER_KEY);
      startSession(r.user);
      lastActivity = Date.now();
      armIdle();
      /* 按登录时选择的公司进入，并校验授权 */
      const wantCo = String(fd.get('companyId') || '');
      const allowed = allowedCompanies();
      if (wantCo && allowed.some(c => c.id === wantCo)) {
        DB.meta.activeCompanyId = wantCo;
        COMPANY = coById(wantCo) || allowed[0];
      } else if (!allowed.some(c => c.id === COMPANY.id)) {
        DB.meta.activeCompanyId = allowed[0].id;
        COMPANY = allowed[0];
      }
      logAction('登录', { module: '登录', target: r.user.username, companyId: COMPANY.id, companyName: COMPANY.name });
      saveDB();
      UI.view = DB.companies.length > 1 ? 'group' : 'dashboard';
      renderShell();
      toast(`欢迎回来，${r.user.displayName}`, 'ok');
    } catch (ex) {
      err.classList.add('show');
      err.querySelector('span').textContent = '登录失败：' + ex.message;
      btn.disabled = false; btn.textContent = old;
    }
  });
}

/* -------------------------------- 注册 / 找回密码 -------------------------------- */

function authShell(inner) {
  return `<div class="auth">${authBrandHTML()}<div class="auth-panel">${inner}</div></div>`;
}
function authErrHTML() {
  return `<div class="auth-err" id="auth-err">${icon('alert', 14)}<span></span></div>`;
}
function showAuthErr(msg) {
  const el = $('#auth-err');
  if (!el) return;
  el.classList.add('show');
  el.querySelector('span').textContent = msg;
}
const questionOptions = (sel, idx) => SECURITY_QUESTIONS
  .map((q, i) => `<option value="${esc(q)}" ${i === idx ? 'selected' : ''}>${esc(q)}</option>`).join('');

function renderAuthRegister() {
  $('#root').innerHTML = authShell(`<div class="auth-form wide-form">
    <h2>注册账号</h2>
    <p class="lead">注册后即可记录与查看公司资金。自助注册的账号默认为「记账员」权限。</p>
    <form id="reg-form">
      ${authErrHTML()}
      <div class="form-grid" style="gap:12px">
        <label class="field"><label>登录账号</label><input type="text" name="username" placeholder="3-20 位字母或数字" required></label>
        <label class="field"><label>显示名称</label><input type="text" name="displayName" placeholder="你的姓名" required></label>
        <label class="field"><label>登录密码</label><input type="password" name="password" placeholder="至少 6 位" required></label>
        <label class="field"><label>确认密码</label><input type="password" name="password2" placeholder="再次输入" required></label>
      </div>
      <div class="auth-sep">预留信息 · 忘记密码时用来验证身份</div>
      <div class="form-grid" style="gap:12px">
        <label class="field"><label>问题一</label><select name="q1">${questionOptions(null, 0)}</select></label>
        <label class="field"><label>答案一</label><input type="text" name="a1" placeholder="不区分大小写" required></label>
        <label class="field"><label>问题二</label><select name="q2">${questionOptions(null, 2)}</select></label>
        <label class="field"><label>答案二</label><input type="text" name="a2" placeholder="不区分大小写" required></label>
      </div>
      <button class="btn primary block" type="submit">注册并登录</button>
      <div class="auth-links"><button type="button" data-auth="login">已有账号？返回登录</button></div>
    </form>
  </div>`);
  if (window.Scene3D) Scene3D.mount($('#root'));

  $('#reg-form').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const username = String(fd.get('username') || '').trim();
    const displayName = String(fd.get('displayName') || '').trim();
    const password = String(fd.get('password') || '');
    const a1 = String(fd.get('a1') || '').trim();
    const a2 = String(fd.get('a2') || '').trim();

    if (!/^[a-zA-Z0-9_.-]{3,20}$/.test(username)) return showAuthErr('账号需为 3-20 位字母、数字或 _ . -');
    if (findUserByName(username)) return showAuthErr('该账号已被注册，请换一个');
    if (password.length < 6) return showAuthErr('密码至少 6 位');
    if (password !== fd.get('password2')) return showAuthErr('两次输入的密码不一致');
    if (!a1 || !a2) return showAuthErr('请填写两个预留问题的答案');
    if (!window.crypto || !crypto.subtle) return showAuthErr('当前环境不支持安全加密');

    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true; btn.textContent = '注册中…';
    try {
      const user = await createUser({ username, displayName: displayName || username, password, role: 'staff' });
      await setSecurity(user, [{ q: fd.get('q1'), a: a1 }, { q: fd.get('q2'), a: a2 }]);
      saveDB();
      startSession(user);
      UI.view = DB.companies.length > 1 ? 'group' : 'dashboard';
      renderShell();
      toast('注册成功，已为你登录', 'ok');
    } catch (ex) {
      btn.disabled = false; btn.textContent = '注册并登录';
      showAuthErr('注册失败：' + ex.message);
    }
  });
}

function renderAuthForgot() {
  $('#root').innerHTML = authShell(`<div class="auth-form wide-form">
    <h2>找回密码</h2>
    <p class="lead">回答注册时设置的预留问题，验证通过后即可设置新密码。</p>
    <div id="forgot-body"></div>
    <div class="auth-links"><button type="button" data-auth="login">返回登录</button></div>
  </div>`);
  if (window.Scene3D) Scene3D.mount($('#root'));
  forgotStep1();
}

function forgotStep1() {
  $('#forgot-body').innerHTML = `<form id="f1">
    ${authErrHTML()}
    <label class="field"><label>登录账号</label><input type="text" name="username" placeholder="请输入账号" required autofocus></label>
    <button class="btn primary block" type="submit">下一步</button>
  </form>`;
  $('#f1').addEventListener('submit', e => {
    e.preventDefault();
    const name = String(new FormData(e.target).get('username') || '').trim();
    const u = findUserByName(name);
    if (!u) return showAuthErr('账号不存在');
    if (u.active === false) return showAuthErr('该账号已被停用，请联系管理员');
    if (!u.security || !u.security.length) return showAuthErr('该账号没有设置预留信息，请联系管理员重置密码');
    forgotStep2(u);
  });
}

function forgotStep2(u) {
  $('#forgot-body').innerHTML = `<form id="f2">
    ${authErrHTML()}
    <p class="lead" style="margin-bottom:4px">账号 <b>${esc(u.username)}</b>，请回答预留问题</p>
    ${u.security.map((s, i) => `<label class="field"><label>${esc(s.q)}</label><input type="text" name="a${i}" placeholder="答案" required></label>`).join('')}
    <button class="btn primary block" type="submit">验证身份</button>
  </form>`;
  $('#f2').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const answers = u.security.map((s, i) => String(fd.get('a' + i) || ''));
    const v = await verifySecurity(u, answers);
    if (!v.ok) return showAuthErr(v.error || '验证失败');
    forgotStep3(u, answers);
  });
}

function forgotStep3(u, answers) {
  $('#forgot-body').innerHTML = `<form id="f3">
    ${authErrHTML()}
    <p class="lead" style="margin-bottom:4px">身份验证通过，请设置新密码</p>
    <label class="field"><label>新密码</label><input type="password" name="p1" placeholder="至少 6 位" required></label>
    <label class="field"><label>确认新密码</label><input type="password" name="p2" placeholder="再次输入" required></label>
    <button class="btn primary block" type="submit">重置密码</button>
  </form>`;
  $('#f3').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const p1 = String(fd.get('p1') || '');
    if (p1.length < 6) return showAuthErr('密码至少 6 位');
    if (p1 !== fd.get('p2')) return showAuthErr('两次输入的密码不一致');
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true; btn.textContent = '提交中…';
    const r = await resetPasswordBySecurity(u.username, answers, p1);
    if (!r.ok) {
      btn.disabled = false; btn.textContent = '重置密码';
      return showAuthErr(r.error || '重置失败');
    }
    toast('密码已重置，请用新密码登录', 'ok');
    renderAuth('login');
  });
}

/* ==================== 主题 / 侧边栏 / 自动退出 / 记住密码 ==================== */

/* ---------- 动效偏好（需求22：全局开关 + 速度档位） ---------- */
const motionOn = () => localStorage.getItem('fm-motion') !== 'off';
const motionSpeed = () => localStorage.getItem('fm-motion-speed') || 'normal';
const motionScale = () => (motionSpeed() === 'slow' ? 1.55 : motionSpeed() === 'fast' ? .6 : 1);

function applyMotion() {
  const html = document.documentElement;
  if (!motionOn()) html.setAttribute('data-motion', 'off');
  else html.setAttribute('data-motion', motionSpeed());
}
function setMotion(on) {
  localStorage.setItem('fm-motion', on ? 'on' : 'off');
  applyMotion();
  renderView();
  toast(on ? '已开启页面动效' : '已关闭页面动效', 'ok');
}
function setMotionSpeed(s) {
  localStorage.setItem('fm-motion-speed', s);
  applyMotion();
  renderView();
  toast('动效速度：' + ({ slow: '慢', normal: '标准', fast: '快' }[s] || '标准'), 'ok');
}

/* ---------- 流畅模式（性能档位） ----------
   背景：装饰性动效（3D 氛围层、入场淡入、悬停阴影）在显卡合成不可用时会被迫走软件渲染，
   表现为「动一下卡一下」。这里做三档：
     auto   跟随系统：显卡合成不可用 → 自动流畅
     smooth 强制流畅：关 3D、关入场动画、关悬停位移
     rich   强制精细：全部开启
   注意与「动效开关」的区别：动效开关是审美选择，流畅模式是性能兜底。 */
const perfMode = () => localStorage.getItem('fm-perf') || 'auto';
const gpuHardware = () => document.documentElement.getAttribute('data-gpu') !== 'soft';
function perfLow() {
  const m = perfMode();
  if (m === 'smooth') return true;
  if (m === 'rich') return false;
  return !gpuHardware();
}
function applyPerf() {
  document.documentElement.setAttribute('data-perf', perfLow() ? 'low' : 'high');
}
function setPerfMode(m) {
  localStorage.setItem('fm-perf', m);
  applyPerf();
  if (window.Scene3D && Scene3D.reset) Scene3D.reset();
  renderView();
  toast('界面档位：' + ({ auto: '自动', smooth: '流畅优先', rich: '效果优先' }[m] || '自动'), 'ok');
}
/* 桌面版问主进程要显卡状态；网页版无从得知，按硬件加速可用处理 */
async function detectGpu() {
  let hw = true;
  if (DESKTOP && window.desktop && window.desktop.gpu) {
    try {
      const r = await window.desktop.gpu();
      hw = !!(r && r.hardware);
    } catch (e) { hw = true; }
  }
  document.documentElement.setAttribute('data-gpu', hw ? 'hw' : 'soft');
  applyPerf();
}

/* 数字滚动：只播一次，不循环 */
function runCounters(root) {
  if (!root || !motionOn() || perfLow()) return;
  const scale = motionScale();
  root.querySelectorAll('[data-count]').forEach(el => {
    const to = num(el.dataset.count);
    if (!Number.isFinite(to) || to === 0) return;
    const dur = Math.min(500, 380 * scale);
    const start = performance.now();
    const frame = now => {
      const p = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(to * eased);
      if (p < 1) requestAnimationFrame(frame);
      else el.textContent = fmt(to);
    };
    requestAnimationFrame(frame);
  });
}

const THEMES = [
  { key: 'light', name: '浅色', colors: ['#ffffff', '#f5f6f8', '#4f46e5'] },
  { key: 'dark',  name: '深色', colors: ['#111a2b', '#0b1220', '#6366f1'] },
  { key: 'blue',  name: '蓝色', colors: ['#ffffff', '#f2f6fd', '#2563eb'] },
  { key: 'green', name: '绿色', colors: ['#ffffff', '#f3faf7', '#059669'] }
];

const themeSetting = () => localStorage.getItem('fm-theme') || 'light';
function resolveTheme(t) {
  if (t === 'auto') {
    return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  }
  return THEMES.some(x => x.key === t) ? t : 'light';
}
function applyTheme(setting) {
  document.documentElement.setAttribute('data-theme', resolveTheme(setting || themeSetting()));
}
function setTheme(setting) {
  localStorage.setItem('fm-theme', setting);
  const html = document.documentElement;
  html.classList.add('theme-anim');
  applyTheme(setting);
  clearTimeout(window.__themeAnimTimer);
  window.__themeAnimTimer = setTimeout(() => html.classList.remove('theme-anim'), 400);
  renderView();
  toast('已切换为「' + (THEMES.find(t => t.key === setting) || {}).name + '」主题', 'ok');
}
function themePickerHTML() {
  const cur = themeSetting();
  return '<div class="theme-grid">' + THEMES.map(t =>
    '<button class="theme-opt ' + (cur === t.key ? 'is-active' : '') + '" data-action="set-theme" data-theme-key="' + t.key + '">' +
      '<span class="theme-swatch">' + t.colors.map(c => '<i style="background:' + c + '"></i>').join('') + '</span>' +
      '<span>' + t.name + '</span>' +
    '</button>').join('') + '</div>';
}

/* ---------- 侧边栏折叠 ---------- */
function applySidebar() {
  const app = document.querySelector('.app');
  if (!app) return;
  app.classList.toggle('is-collapsed', localStorage.getItem('fm-sidebar') === '1');
}
function toggleSidebar() {
  const app = document.querySelector('.app');
  if (!app) return;
  const next = !app.classList.contains('is-collapsed');
  app.classList.toggle('is-collapsed', next);
  localStorage.setItem('fm-sidebar', next ? '1' : '0');
}

/* ---------- 无操作自动退出 ---------- */
const idleMinutes = () => Math.max(1, num(localStorage.getItem('fm-idle-min') || 30));
let idleTimer = null, idleWarnTimer = null, lastActivity = 0;

function clearIdleTimers() {
  clearTimeout(idleTimer); clearTimeout(idleWarnTimer);
  idleTimer = idleWarnTimer = null;
}
function armIdle() {
  clearIdleTimers();
  if (!SESSION) return;
  const ms = idleMinutes() * 60000;
  idleWarnTimer = setTimeout(() => {
    if (SESSION) toast('已 ' + (idleMinutes() - 1) + ' 分钟无操作，1 分钟后将自动退出', 'countdown');
  }, Math.max(5000, ms - 60000));
  idleTimer = setTimeout(() => {
    if (!SESSION) return;
    endSession();
    SESSION = null;
    renderAuth('login');
    toast('长时间无操作，已自动退出登录', '');
  }, ms);
}
function noteActivity() {
  if (!SESSION) return;
  const now = Date.now();
  if (now - lastActivity < 20000) return;   // 20 秒内不重复重置
  lastActivity = now;
  armIdle();
}
['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'].forEach(ev =>
  document.addEventListener(ev, noteActivity, { passive: true })
);

/* ---------- 记住密码（本地 AES-GCM 加密，不明文） ---------- */
const REMEMBER_KEY = 'fm-remember';

async function localSecret() {
  let s = localStorage.getItem('fm-secret');
  if (!s) {
    const rnd = crypto.getRandomValues(new Uint8Array(16));
    s = toB64(rnd);
    localStorage.setItem('fm-secret', s);
  }
  return s;
}
async function localKey() {
  const secret = await localSecret();
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: new TextEncoder().encode('fundmerge-remember'), iterations: 60000, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
}
async function saveRemember(username, password) {
  try {
    const key = await localKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(password));
    localStorage.setItem(REMEMBER_KEY, JSON.stringify({
      u: username, iv: toB64(iv), ct: toB64(new Uint8Array(ct))
    }));
  } catch (e) { /* 忽略 */ }
}
async function loadRemember(username) {
  try {
    const raw = localStorage.getItem(REMEMBER_KEY);
    if (!raw) return '';
    const box = JSON.parse(raw);
    if (username && box.u !== username) return '';
    const key = await localKey();
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromB64(box.iv) }, key, fromB64(box.ct)
    );
    return new TextDecoder().decode(pt);
  } catch (e) { return ''; }
}
function clearRemember() {
  localStorage.removeItem(REMEMBER_KEY);
  localStorage.removeItem('fm-secret');
  toast('已清除记住的账号密码', 'ok');
  renderAuth('login');
}
const hasRemember = () => !!localStorage.getItem(REMEMBER_KEY);

/* -------------------------------- 用户菜单 -------------------------------- */

function openUserMenu(anchor) {
  const pop = showPopover(anchor, `<div class="menu" style="width:200px">
    <div class="menu-head">
      <strong>${esc(SESSION.displayName)}</strong>
      <span>@${esc(SESSION.username)} · ${roleLabel(SESSION.role)}</span>
    </div>
    <div class="menu-sep"></div>
    <button class="menu-item" data-action="open-manual">${icon('file', 14)} 使用手册</button>
    <button class="menu-item" data-action="change-pwd">${icon('lock', 14)} 修改密码</button>
    ${isAdmin() ? `<button class="menu-item" data-action="nav" data-view="users">${icon('users', 14)} 用户管理</button>` : ''}
    <button class="menu-item" data-action="nav" data-view="settings">${icon('settings', 14)} 设置</button>
    <div class="menu-sep"></div>
    <button class="menu-item danger" data-action="logout">${icon('logout', 14)} 退出登录</button>
  </div>`);
  pop.style.width = '200px';
}

function openCompanyMenu(anchor) {
  const items = allowedCompanies().map(c => {
    const t = companyTotals(c);
    const active = !isGroupView() && COMPANY.id === c.id;
    return `<button class="menu-item ${active ? 'is-active' : ''}" data-action="switch-company" data-id="${c.id}" style="height:auto;padding:7px 9px">
      <span class="co-dot" style="--c:${c.color}"></span>
      <span style="flex:1;min-width:0;text-align:left">
        <span style="display:block;font-size:12.5px;font-weight:${active ? 600 : 500};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.name)}</span>
        <span style="display:block;font-size:10.5px;color:var(--muted-2);font-variant-numeric:tabular-nums">${fmtShort(t.total)} · ${c.accounts.length} 账户</span>
      </span>
      ${active ? `<span style="color:var(--brand);display:flex">${icon('check', 14)}</span>` : ''}
    </button>`;
  }).join('');

  showPopover(anchor, `<div class="menu" style="width:290px">
    <div class="menu-head"><strong>切换公司</strong><span>每家公司的账本相互独立</span></div>
    <div class="menu-sep"></div>
    <button class="menu-item ${isGroupView() ? 'is-active' : ''}" data-action="nav" data-view="group">
      ${icon('layers', 14)}<span style="flex:1">集团总览（合并口径）</span>
    </button>
    <div class="menu-sep"></div>
    <div style="max-height:300px;overflow:auto">${items}</div>
    <div class="menu-sep"></div>
    <button class="menu-item" data-action="new-company">${icon('plus', 14)} 新建公司</button>
    <button class="menu-item" data-action="nav" data-view="companies">${icon('briefcase', 14)} 公司管理</button>
  </div>`, { width: 290 });
}

function openCompanyPickerForTx(anchor) {
  const html = `<div class="menu" style="width:270px">
    <div class="menu-head"><strong>记到哪家公司？</strong><span>选择后打开记账表单</span></div>
    <div class="menu-sep"></div>
    ${allowedCompanies().map(c => `<button class="menu-item" data-action="tx-for-company" data-id="${c.id}" style="height:auto;padding:7px 9px">
      <span class="co-dot" style="--c:${c.color}"></span>
      <span style="flex:1;min-width:0;text-align:left">
        <span style="display:block;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.name)}</span>
        <span style="display:block;font-size:10.5px;color:var(--muted-2)">${fmtShort(companyBalanceAt(c))} · ${c.accounts.length} 账户</span>
      </span>
    </button>`).join('')}
  </div>`;
  showPopover(anchor, html, { width: 270 });
}

/* --------------------------------- 事件 ---------------------------------- */

/* 往来单位 / 凭证筛选 */
document.addEventListener('change', e => {
  const pe = e.target.closest('[data-party]');
  if (pe) {
    UI.partyFilter = UI.partyFilter || { keyword: '', type: '', active: '' };
    UI.partyFilter[pe.dataset.party] = pe.value;
    renderView();
    return;
  }
  const ve = e.target.closest('[data-voucher]');
  if (ve) {
    UI.voucherFilter = UI.voucherFilter || { keyword: '', from: '', to: '' };
    UI.voucherFilter[ve.dataset.voucher] = ve.value;
    renderView();
  }
});
document.addEventListener('input', e => {
  const pe = e.target.closest('[data-party][data-party="keyword"]');
  if (pe) { clearTimeout(window.__pfT); window.__pfT = setTimeout(() => { UI.partyFilter.keyword = pe.value; renderView(); }, 200); return; }
  const ve = e.target.closest('[data-voucher][data-voucher="keyword"]');
  if (ve) { clearTimeout(window.__vfT); window.__vfT = setTimeout(() => { UI.voucherFilter.keyword = ve.value; renderView(); }, 200); }
});

/* 操作日志筛选 */
document.addEventListener('change', e => {
  const el = e.target.closest('[data-log]');
  if (!el) return;
  UI.logFilter = UI.logFilter || { from: '', to: '', user: '', module: '', action: '' };
  UI.logFilter[el.dataset.log] = el.value;
  UI.logPage = 1;
  renderView();
});

/* 开关类控件：隐藏的 checkbox 只能靠 change 事件驱动 */
document.addEventListener('change', e => {
  const el = e.target.closest('[data-action]');
  if (!el || el.tagName !== 'INPUT' || el.type !== 'checkbox') return;
  if (el.dataset.action === 'toggle-motion') setMotion(el.checked);
});

/* 登录页的注册 / 找回密码跳转 */
document.addEventListener('click', e => {
  const a = e.target.closest('[data-auth]');
  if (!a) return;
  renderAuth(a.dataset.auth);
});

document.addEventListener('click', async e => {
  const el = e.target.closest('[data-action]');
  if (el && el.tagName === 'INPUT' && el.type === 'checkbox') return;
  if (!el || el.disabled) return;
  const action = el.dataset.action;
  const id = el.dataset.id;

  switch (action) {
    case 'nav': navigate(el.dataset.view); break;
    case 'user-menu': openUserMenu(el); break;
    case 'company-menu': openCompanyMenu(el); break;
    case 'switch-company':
    case 'enter-company': {
      if (switchCompany(id)) {
        UI.view = 'dashboard';
        closePopover();
        renderShell();
        toast(`已切换到「${COMPANY.name}」`, 'ok');
      }
      break;
    }
    case 'new-company': openCompanyModal(); break;
    /* 集团总公司实体（REQ-03 补完）：集团自身也是一家公司 */
    case 'new-group-company': openGroupCompanyModal(); break;
    case 'pick-group-company': openGroupPickModal(); break;
    case 'group-ledger': {
      if (!switchCompany(id)) break;
      UI.view = 'dashboard';
      closePopover();
      renderShell();
      toast('已进入「' + COMPANY.name + '」账本', 'ok');
      break;
    }
    case 'group-profile': {
      if (!switchCompany(id)) break;
      UI.view = 'profile';
      closePopover();
      renderShell();
      toast('这是集团公司的档案，可登记注册信息与银行账号', 'ok');
      break;
    }
    case 'edit-company': openCompanyModal(id); break;
    case 'del-company': {
      const c = coById(id);
      if (!c) break;
      if (DB.companies.length <= 1) return toast('至少保留一家公司', 'err');
      confirmDialog({
        title: '删除公司？',
        requireCode: true,
        message: `将删除「<b>${esc(c.name)}</b>」及其全部账本数据（${c.accounts.length} 个账户、${c.transactions.length} 笔流水、${c.debts.length} 笔往来），此操作不可撤销。`,
        confirmText: '删除公司',
        onConfirm: () => {
          DB.companies = DB.companies.filter(x => x.id !== id);
          if (DB.meta.activeCompanyId === id) {
            DB.meta.activeCompanyId = DB.companies[0].id;
            COMPANY = DB.companies[0];
          }
          if (DESKTOP && window.desktop.files) window.desktop.files.removeCompany(id);
          saveDB(); closeModal(); renderShell();
          toast('公司已删除', 'ok');
        }
      });
      break;
    }
    case 'close-modal': closeModal(); break;
    case 'confirm-ok':
      if (typeof confirmHandler === 'function') { const fn = confirmHandler; confirmHandler = null; fn(); }
      break;

    /* 流水 */
    case 'new-tx':
      if (isGroupView()) openCompanyPickerForTx(el);
      else openTxModal();
      break;
    case 'new-transfer': openTxModal(null, { type: 'transfer' }); break;
    case 'tx-for-company': {
      const co = coById(id);
      if (!co) break;
      switchCompany(id, { silent: true });
      saveDB();
      closePopover();
      UI.view = 'dashboard';
      renderShell();
      openTxModal();
      break;
    }
    case 'edit-tx': openTxModal(id); break;
    case 'del-tx': {
      if (!isAdmin()) return toast('仅管理员可删除流水', 'err');
      const t = DB.transactions.find(x => x.id === id);
      if (!t) break;
      confirmDialog({
        title: '删除这笔流水？',
        requireCode: true,
        message: `${t.date} · ${txTypeLabel(t)} · <b>${fmt(t.amount)}</b><br>${esc(t.summary || txCat(t).name)}<br><br>删除后相关账户余额会同步变化，此操作不可撤销。`,
        confirmText: '删除',
        onConfirm: () => {
          logAction('删除', { module: '流水', target: `${t.category || t.type} ${fmt(t.amount)}`, targetId: id,
            before: `${t.date} ${t.category} ${fmt(t.amount)} ${t.summary || ''}` });
          removeLinkedTx(t);
          DB.transactions = DB.transactions.filter(x => x.id !== id);
          saveDB(); closeModal(); render();
          toast('已删除', 'ok');
        }
      });
      break;
    }
    case 'tx-reset':
      UI.txFilter = { from: '', to: '', account: '', type: '', category: '', keyword: '', page: 1 };
      renderView();
      break;
    case 'tx-export': exportTxCSV(filteredTx(), '资金流水'); break;
    case 'import-tx': openImportModal(); break;
    case 'import-pick': if (window.__importPick) window.__importPick(); break;
    case 'import-template': saveTextFile('资金明细导入模板.csv', importTemplateCSV(), 'text/csv;charset=utf-8'); break;
    case 'import-confirm': confirmImport(); break;
    case 'tx-page':
      UI.txFilter.page = Number(el.dataset.page) || 1;
      $('#tx-area').innerHTML = txAreaHTML();
      break;

    /* 账户 */
    case 'new-acc': openAccountModal(); break;
    case 'edit-acc': openAccountModal(id); break;
    case 'reconcile': openReconcileModal(id); break;
    case 'del-acc': {
      const a = accById(id);
      if (!a) break;
      if (DB.transactions.some(t => t.accountId === a.id || t.toAccountId === a.id)) {
        toast('该账户已有流水，不能删除，可改为停用', 'err');
        break;
      }
      confirmDialog({
        title: '删除账户？',
        requireCode: true,
        message: `将删除账户「<b>${esc(a.name)}</b>」，此操作不可撤销。`,
        confirmText: '删除',
        onConfirm: () => {
          DB.accounts = DB.accounts.filter(x => x.id !== a.id);
          saveDB(); closeModal(); render();
          toast('账户已删除', 'ok');
        }
      });
      break;
    }

    /* 往来款 */
    case 'debt-tab': UI.debtTab = el.dataset.tab; renderView(); break;
    case 'new-debt': openDebtModal(null, el.dataset.type); break;
    case 'edit-debt': openDebtModal(id); break;
    case 'settle-debt': openSettleModal(id); break;
    case 'del-debt': {
      const d = DB.debts.find(x => x.id === id);
      if (!d) break;
      confirmDialog({
        title: '删除这笔往来款？',
        requireCode: true,
        message: `「<b>${esc(d.party)}</b>」${DEBT_TYPE[d.type].label} ${fmt(d.amount)}。<br>已登记的分期结清记录会一并删除，但不会自动删除已生成的历史流水。`,
        confirmText: '删除',
        onConfirm: () => {
          DB.debts = DB.debts.filter(x => x.id !== id);
          DB.settlements = DB.settlements.filter(s => s.debtId !== id);
          saveDB(); closeModal(); render();
          toast('已删除', 'ok');
        }
      });
      break;
    }

    /* 分类 */
    case 'new-cat': openCategoryModal(null, { kind: el.dataset.kind }); break;
    case 'edit-cat': openCategoryModal(id); break;
    case 'del-cat': {
      const c = catById(id);
      if (!c) break;
      const used = DB.transactions.some(t => t.categoryId === c.id);
      if (used) {
        confirmDialog({
          title: '该分类已被使用',
          message: `「<b>${esc(c.name)}</b>」已用于历史流水，不能删除。可以改为<b>停用</b>，停用后不再出现在记账选择器中，历史数据保留。`,
          confirmText: '停用该分类',
          tone: 'primary',
          onConfirm: () => {
            c.active = false;
            saveDB(); closeModal(); render();
            toast('分类已停用', 'ok');
          }
        });
        break;
      }
      confirmDialog({
        title: '删除分类？',
        requireCode: true,
        message: `将删除「<b>${esc(c.name)}</b>」，此操作不可撤销。`,
        confirmText: '删除',
        onConfirm: () => {
          DB.categories = DB.categories.filter(x => x.id !== c.id);
          DB.budgets = DB.budgets.filter(b => b.categoryId !== c.id);
          saveDB(); closeModal(); render();
          toast('分类已删除', 'ok');
        }
      });
      break;
    }

    /* 预算 */
    case 'budget-save':
      saveDB();
      toast('预算已保存', 'ok');
      break;
    case 'budget-toggle':
      UI.budgetShowAll = !UI.budgetShowAll;
      renderView();
      break;
    case 'pack-export': exportPack(); break;
    case 'pack-import': importPack(); break;
    case 'pack-open-folder':
      if (DESKTOP && window.desktop.flpack) window.desktop.flpack.openFolder();
      break;
    case 'budget-gen': openBudgetGenModal(el.dataset.month || UI.budgetMonth); break;
    case 'budget-copy': {
      const from = el.dataset.from, to = UI.budgetMonth || monthOf(todayISO());
      const src = DB.budgets.filter(b => b.month === from);
      if (!src.length) return toast('上月没有预算记录', 'err');
      src.forEach(b => {
        if (!DB.budgets.some(x => x.month === to && x.categoryId === b.categoryId)) {
          DB.budgets.push({ id: uid('b'), month: to, categoryId: b.categoryId, amount: b.amount });
        }
      });
      saveDB(); renderView();
      toast(`已复制 ${src.length} 条预算`, 'ok');
      break;
    }

    /* 公司档案 */
    case 'profile-save': {
      const p = COMPANY.profile;
      $$('[data-profile]').forEach(inp => { p[inp.dataset.profile] = inp.value.trim(); });
      COMPANY.taxNo = p.taxNo;
      saveDB(); renderView();
      toast('公司信息已保存', 'ok');
      break;
    }
    case 'vault-add': closePopover(); openVaultFieldModal(); break;
    case 'vault-templates': openVaultTemplatesMenu(el); break;
    case 'vault-tpl': {
      const t = FIELD_TEMPLATES[Number(el.dataset.i)];
      closePopover();
      if (t) openVaultFieldModal(null, { group: t.group, label: t.label, type: t.type, value: '', note: '' });
      break;
    }
    case 'vault-edit': openVaultFieldModal(id); break;
    case 'vault-del': {
      const f = COMPANY.profile.fields.find(x => x.id === id);
      if (!f) break;
      confirmDialog({
        title: '删除条目？',
        requireCode: true,
        message: `将删除「<b>${esc(f.label)}</b>」，此操作不可撤销。`,
        confirmText: '删除',
        onConfirm: () => {
          COMPANY.profile.fields = COMPANY.profile.fields.filter(x => x.id !== id);
          saveDB(); closeModal(); renderView();
          toast('已删除', 'ok');
        }
      });
      break;
    }
    case 'vault-reveal': {
      const f = COMPANY.profile.fields.find(x => x.id === id);
      const span = document.querySelector(`[data-secret="${id}"]`);
      if (!f || !span) break;
      const shown = span.dataset.shown === '1';
      span.textContent = shown ? '••••••••' : (f.value || '未填写');
      span.dataset.shown = shown ? '0' : '1';
      break;
    }
    case 'vault-copy': {
      const f = COMPANY.profile.fields.find(x => x.id === id);
      if (!f || !f.value) break;
      const done = () => toast('已复制到剪贴板', 'ok');
      const fail = () => toast('复制失败，请手动选择', 'err');
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(f.value).then(done).catch(fail);
      else fail();
      break;
    }
    case 'file-upload': openFileUploadModal(); break;
    case 'file-open': {
      const f = COMPANY.profile.files.find(x => x.id === id);
      if (!f) break;
      FileStore.open(f, COMPANY.id).then(r => { if (!r || !r.ok) toast((r && r.error) || '打开失败', 'err'); });
      break;
    }
    case 'file-reveal': {
      const f = COMPANY.profile.files.find(x => x.id === id);
      if (!f) break;
      FileStore.reveal(f, COMPANY.id).then(r => { if (!r || !r.ok) toast((r && r.error) || '定位失败', 'err'); });
      break;
    }
    case 'file-rename': openFileRenameModal(id); break;
    case 'file-del': {
      const f = COMPANY.profile.files.find(x => x.id === id);
      if (!f) break;
      confirmDialog({
        title: '删除资料？',
        requireCode: true,
        message: `将删除「<b>${esc(f.name)}</b>」及其本机文件，此操作不可撤销。`,
        confirmText: '删除',
        onConfirm: () => {
          FileStore.remove(f, COMPANY.id).then(() => {
            COMPANY.profile.files = COMPANY.profile.files.filter(x => x.id !== id);
            saveDB(); closeModal(); renderView();
            toast('已删除', 'ok');
          });
        }
      });
      break;
    }
    case 'open-files-folder': if (DESKTOP) window.desktop.openFilesFolder(); break;
    case 'open-company-folder': if (DESKTOP) window.desktop.openCompanyFolder(COMPANY.id); break;
    case 'file-refresh': refreshFileStats(true); break;
    case 'set-data-dir': {
      if (!DESKTOP) break;
      window.desktop.setDataDir().then(r => {
        if (!r || r.canceled) return;
        if (!r.ok) return toast(r.error || '切换失败', 'err');
        toast('数据目录已切换，重启后生效', 'ok');
      });
      break;
    }

    /* 报表 */
    case 'report-tab': UI.reportTab = el.dataset.tab; renderView(); break;
    case 'cf-preset': {
      const t = todayISO();
      const y = Number(t.slice(0, 4)), m = Number(t.slice(5, 7));
      const p = el.dataset.preset;
      let from = `${y}-01-01`, to = t;
      if (p === 'month') from = `${y}-${pad2(m)}-01`;
      if (p === 'last') { const s = addDays(`${y}-${pad2(m)}-01`, -1); from = s.slice(0, 7) + '-01'; to = s; }
      if (p === 'quarter') from = `${y}-${pad2(Math.floor((m - 1) / 3) * 3 + 1)}-01`;
      UI.cfRange = { from, to };
      UI.cfPreset = p;
      renderView();
      break;
    }
    case 'cf-export': exportCF(); break;
    case 'stmt-export': exportStatementCSV(); break;
    case 'summary-export': exportSummaryCSV(); break;
    case 'group-export': exportGroupCSV(); break;
    case 'group-preset': {
      const t = todayISO();
      const y = Number(t.slice(0, 4)), m = Number(t.slice(5, 7));
      const p = el.dataset.preset;
      let from = `${y}-01-01`, to = t;
      if (p === 'month') from = `${y}-${pad2(m)}-01`;
      if (p === 'last') { const s = addDays(`${y}-${pad2(m)}-01`, -1); from = s.slice(0, 7) + '-01'; to = s; }
      if (p === 'quarter') from = `${y}-${pad2(Math.floor((m - 1) / 3) * 3 + 1)}-01`;
      UI.groupRange = { from, to };
      UI.groupPreset = p;
      renderView();
      break;
    }
    case 'print': window.print(); break;

    /* 用户 */
    case 'new-user': openUserModal(); break;
    case 'edit-user': openUserModal(id); break;
    case 'reset-pwd': openPasswordModal(id); break;
    case 'change-pwd': openPasswordModal(); break;
    case 'security-set': openSecurityModal(); break;
    case 'set-theme': setTheme(el.dataset.themeKey); break;
    case 'save-currency': {
      const cur = $('#currency-select').value;
      if (!CURRENCIES[cur]) return toast('不支持的货币', 'err');
      if (cur !== baseCurrency() && (DB.meta.fx && Object.keys(DB.meta.fx.rates || {}).length)) {
        const go = () => {
          DB.meta.fx = DB.meta.fx || { base: cur, rates: {} };
          DB.meta.fx.base = cur;
          DB.meta.currency = cur;
          CURRENCY = cur;
          saveDB(); renderView();
          toast('本位币已切换为 ' + CURRENCIES[cur].name, 'ok');
        };
        return confirmDialog({
          title: '切换本位币',
          message: `本位币将从 <b>${CURRENCIES[baseCurrency()].name}</b> 改为 <b>${CURRENCIES[cur].name}</b>。<br>已有汇率的折算方向会反过来，建议切换后重新核对汇率。`,
          confirmText: '确认切换',
          requireCode: true,
          onConfirm: go
        });
      }
      DB.meta.fx = DB.meta.fx || { base: cur, rates: {} };
      DB.meta.fx.base = cur;
      DB.meta.currency = cur;
      CURRENCY = cur;
      saveDB(); renderView();
      toast('本位币已切换为 ' + CURRENCIES[cur].name, 'ok');
      break;
    }
    case 'fx-add': openFxModal(el.dataset.cur); break;
    case 'toggle-motion': setMotion(el.checked); break;
    case 'drill': UI.drillMetric = el.dataset.metric || 'total'; UI.view = 'drill'; renderView(); break;
    case 'drill-back': UI.view = 'group'; renderView(); break;
    /* 趋势区间：快捷天数（REQ-04/09，此前这个 action 根本没有监听，按钮是死的） */
    case 'trend-range': {
      UI.trendDays = num(el.dataset.days);
      UI.trendRange = {};
      renderView();
      break;
    }
    case 'drill-open': {
      const co = coById(id);
      if (!co) break;
      DB.meta.activeCompanyId = co.id;
      COMPANY = co;
      saveDB();
      /* 按来源指标预置流水筛选，否则进去看到的是全部流水，对不上数 */
      const m = el.dataset.metric || UI.drillMetric || 'total';
      const today = todayISO();
      const thisM = monthOf(today);
      const base = { from: '', to: '', account: '', type: '', category: '', keyword: '', page: 1 };
      if (m === 'monthIn') UI.txFilter = Object.assign(base, { from: thisM + '-01', to: today, type: 'in' });
      else if (m === 'monthOut') UI.txFilter = Object.assign(base, { from: thisM + '-01', to: today, type: 'out' });
      else UI.txFilter = base;
      UI.view = 'transactions';
      renderView();
      toast('已进入 ' + co.name + ' 的资金流水', 'ok');
      break;
    }
    /* 总览指标卡穿透：跳台账/流水并预置筛选（G-01） */
    case 'stat-jump': {
      const to = el.dataset.to;
      if (to === 'debts') {
        if (el.dataset.tab) UI.debtTab = el.dataset.tab;
        UI.view = 'debts';
      } else if (to === 'transactions') {
        const today = todayISO();
        UI.txFilter = { from: `${today.slice(0, 7)}-01`, to: today, account: '', type: '', category: '', keyword: '', page: 1 };
        UI.view = 'transactions';
      }
      renderView();
      break;
    }
    /* 账户穿透：跳到流水并按该账户过滤（REQ-19） */
    case 'acc-detail': {
      const a = accById(id);
      if (!a) break;
      UI.txFilter = { from: '', to: '', account: a.id, type: '', category: '', keyword: '', page: 1 };
      UI.view = 'transactions';
      renderView();
      toast('已按账户「' + a.name + '」筛选流水', 'ok');
      break;
    }
    case 'acc-filter': UI.accType = el.dataset.type || ''; renderView(); break;
    /* 台账筛选：清空 / 卡片快捷筛选 / 翻页（G-04） */
    case 'f-clear': {
      const st = ledgerState(el.dataset.f);
      Object.assign(st, { from: '', to: '', status: '', kw: '', overdue: '', page: 1 });
      renderView();
      break;
    }
    case 'f-quick': {
      const st = ledgerState(el.dataset.f);
      Object.assign(st, { from: '', to: '', status: '', kw: '', overdue: '', page: 1 });
      const k = el.dataset.k, v = el.dataset.v;
      if (k === 'overdue') st.overdue = v;
      else if (k !== '__all') st[k] = v;
      renderView();
      break;
    }
    case 'debt-page': ledgerState('debt').page = num(el.dataset.page); renderView(); break;
    case 'advance-page': ledgerState('advance').page = num(el.dataset.page); renderView(); break;
    case 'invoice-page': ledgerState('invoice').page = num(el.dataset.page); renderView(); break;
    case 'inv-receive': openInvoiceReceiveModal(id); break;
    case 'undo-advance': undoAdvanceDraw(id); break;
    /* 资金对账单的组成项穿透（REQ-20） */
    case 'fundstmt-go': {
      const to = el.dataset.to, status = el.dataset.status || '';
      if (to === 'invoices') {
        Object.assign(ledgerState('invoice'), { from: '', to: '', status, kw: '', overdue: '', page: 1 });
        UI.view = 'invoices';
      } else if (to === 'debts') {
        UI.debtTab = el.dataset.tab || 'borrow';
        Object.assign(ledgerState('debt'), { from: '', to: '', status: '', kw: '', overdue: '', page: 1 });
        UI.view = 'debts';
      } else if (to === 'advances') {
        Object.assign(ledgerState('advance'), { from: '', to: '', status, kw: '', overdue: '', page: 1 });
        UI.view = 'advances';
      }
      renderView();
      break;
    }
    case 'acc-filter-go': UI.accType = el.dataset.type || ''; UI.view = 'accounts'; renderView(); break;
    case 'fundstmt-export': exportFundStatement(); break;
    case 'vault-bundle': openVaultBundleModal(); break;
    case 'log-note': openLogNoteModal(id); break;
    case 'log-del': deleteLog(id); break;
    case 'backup-provider': {
      if (!DESKTOP) return;
      const p = el.dataset.p;
      const cfg = Object.assign({}, UI.backupCfg || {}, { provider: p });
      UI.backupCfg = await window.desktop.backup.save(cfg);
      renderView();
      break;
    }
    case 'backup-save': {
      if (!DESKTOP) return;
      const cfg = Object.assign({}, UI.backupCfg || {});
      cfg.frequency = ($('#bk-freq') || {}).value || 'daily';
      cfg.customHours = num(($('#bk-hours') || {}).value) || 24;
      cfg.scopeData = !!($('#bk-data') || {}).checked;
      cfg.scopeFiles = !!($('#bk-files') || {}).checked;
      cfg.enabled = !!($('#bk-enable') || {}).checked;
      if (cfg.provider === 'webdav') {
        cfg.webdav = Object.assign({}, cfg.webdav, {
          url: (($('#dav-url') || {}).value || '').trim(),
          username: (($('#dav-user') || {}).value || '').trim()
        });
        const pw = ($('#dav-pass') || {}).value || '';
        if (pw) cfg.webdav.password = pw;
      }
      if (cfg.provider === 'gdrive') {
        cfg.gdrive = Object.assign({}, cfg.gdrive, {
          clientId: (($('#gd-id') || {}).value || '').trim(),
          folderId: (($('#gd-folder') || {}).value || '').trim()
        });
        const sc = ($('#gd-secret') || {}).value || '';
        if (sc) cfg.gdrive.clientSecret = sc;
      }
      UI.backupCfg = await window.desktop.backup.save(cfg);
      renderView();
      toast('备份设置已保存', 'ok');
      break;
    }
    case 'backup-test-dav': {
      if (!DESKTOP) return;
      if (UI.backupBusy) return toast('正在测试，请稍候…', '');
      const hint = $('#dav-test-hint');
      const cfg = Object.assign({}, UI.backupCfg || {});
      cfg.webdav = Object.assign({}, cfg.webdav, {
        url: (($('#dav-url') || {}).value || '').trim(),
        username: (($('#dav-user') || {}).value || '').trim()
      });
      const pw = ($('#dav-pass') || {}).value || '';
      if (pw) cfg.webdav.password = pw;
      if (hint) { hint.textContent = '测试中…'; hint.style.color = ''; }
      UI.backupBusy = true;
      try {
        const r = await window.desktop.backup.test(cfg);
        if (hint) {
          hint.textContent = r.ok ? '连接成功' : '失败：' + r.error;
          hint.style.color = r.ok ? 'var(--out)' : 'var(--danger)';
        }
      } catch (e) {
        if (hint) { hint.textContent = '失败：' + (e && e.message ? e.message : e); hint.style.color = 'var(--danger)'; }
      } finally {
        UI.backupBusy = false;
      }
      break;
    }
    case 'backup-gdrive-auth': {
      if (!DESKTOP) return;
      const r = await window.desktop.backup.gdriveAuth({
        clientId: (($('#gd-id') || {}).value || '').trim(),
        clientSecret: (($('#gd-secret') || {}).value || '').trim(),
        folderId: (($('#gd-folder') || {}).value || '').trim()
      });
      if (!r.ok) return toast('授权失败：' + r.error, 'err');
      const box = $('#gd-device');
      if (box) {
        box.style.display = 'block';
        box.innerHTML = '<b>请在浏览器打开：</b><a href="' + esc(r.url) + '" target="_blank" rel="noopener">' + esc(r.url) + '</a><br>' +
          '<b>并输入设备码：</b><span style="font-size:18px;letter-spacing:.2em;font-weight:700">' + esc(r.userCode) + '</span><br>' +
          '<span style="font-size:12px;color:var(--muted-2)">授权窗口 ' + Math.round(r.expiresIn / 60) + ' 分钟内有效，完成后本页会自动更新</span>';
      }
      break;
    }
    case 'cloud-backup-now': {
      if (!DESKTOP) return;
      toast('正在打包并上传…', '');
      const r = await window.desktop.backup.run('manual');
      if (!r.ok) { toast('备份失败：' + r.error, 'err'); break; }
      logAction('备份', { module: '数据', target: '手动备份 v' + r.version.no, after: (r.version.size / 1024 / 1024).toFixed(2) + ' MB' });
      UI.backupVersions = await window.desktop.backup.versions();
      UI.backupCfg = await window.desktop.backup.config();
      renderView();
      toast('已备份 v' + r.version.no + '（' + (r.version.size / 1024 / 1024).toFixed(1) + ' MB）' + (r.removed.length ? '，已删除旧版本 ' + r.removed.join(',') : ''), 'ok');
      break;
    }
    case 'cloud-restore': {
      if (!DESKTOP) return;
      const no = el.dataset.no;
      confirmDialog({
        title: '从云盘恢复 v' + no,
        message: '将下载该版本并<b>覆盖当前账套</b>。失败会自动回滚。',
        confirmText: '下载并恢复',
        requireCode: true,
        onConfirm: async () => {
          closeModal();
          toast('正在下载并恢复…', '');
          const r = await window.desktop.backup.restoreVersion(no);
          if (!r.ok) return toast('恢复失败：' + r.error, 'err');
          logAction('恢复', { module: '数据', target: '云盘版本 v' + no, after: r.companies + ' 家公司' });
          saveDB();
          toast('恢复成功，正在重新加载…', 'ok');
          setTimeout(() => location.reload(), 900);
        }
      });
      break;
    }
    case 'cloud-download': {
      if (!DESKTOP) return;
      const r = await window.desktop.backup.downloadVersion(el.dataset.no);
      if (r.canceled) break;
      if (!r.ok) return toast('下载失败：' + r.error, 'err');
      toast('已保存：' + r.path, 'ok');
      break;
    }
    case 'cloud-verify': {
      if (!DESKTOP) return;
      toast('正在校验…', '');
      const r = await window.desktop.backup.verifyVersion(el.dataset.no);
      if (!r.ok) return toast('校验失败：' + r.error, 'err');
      toast(r.ok ? '校验通过（SHA-256 与账套内校验和均一致）' : '校验不一致', r.ok ? 'ok' : 'err');
      break;
    }
    case 'cloud-del-version': {
      if (!DESKTOP) return;
      const no = el.dataset.no;
      confirmDialog({
        title: '删除云盘版本 v' + no,
        message: '将从云盘和版本池中移除该版本，<b>不可恢复</b>。',
        confirmText: '删除',
        requireCode: true,
        onConfirm: async () => {
          closeModal();
          const r = await window.desktop.backup.deleteVersion(no);
          if (!r.ok) return toast('删除失败：' + r.error, 'err');
          logAction('删除', { module: '数据', target: '云盘版本 v' + no });
          UI.backupVersions = await window.desktop.backup.versions();
          UI.backupVersionsLoaded = true;
          refreshBackupVersions();
          toast('已删除 v' + no, 'ok');
        }
      });
      break;
    }
    case 'backup-run': {
      if (!DESKTOP) return;
      toast('正在备份…', '');
      const r = await window.desktop.backup.run();
      UI.backupCfg = await window.desktop.backup.config();
      renderView();
      if (r.ok) toast('备份成功（' + Math.round(r.entry.size / 1024) + ' KB）', 'ok');
      else toast('备份失败：' + r.error, 'err');
      break;
    }
    case 'new-project': openProjectModal(); break;
    case 'edit-project': openProjectModal(id); break;
    case 'del-project': {
      const pj = projectById(id);
      if (!pj) break;
      const used = projectUsage(pj.id).count;
      if (used) return toast('该项目已有 ' + used + ' 笔流水，不能删除', 'err');
      confirmDialog({
        title: '删除项目？', message: '将删除「<b>' + esc(pj.name) + '</b>」，不可恢复。',
        confirmText: '删除', requireCode: true,
        onConfirm: () => {
          logAction('删除', { module: '档案', target: '项目 ' + pj.name, targetId: pj.id });
          COMPANY.projects = ensureProjectList(COMPANY).filter(x => x.id !== pj.id);
          saveDB(); closeModal(); renderView(); toast('已删除', 'ok');
        }
      });
      break;
    }
    case 'new-party': openPartyModal(); break;
    case 'edit-party': openPartyModal(id); break;
    case 'party-reset': UI.partyFilter = { keyword: '', type: '', active: '' }; renderView(); break;
    case 'toggle-party': {
      const p = partyById(id);
      if (!p) break;
      p.active = p.active === false;
      logAction('修改', { module: '档案', target: '往来单位 ' + p.name + (p.active ? ' 启用' : ' 停用'), targetId: p.id });
      saveDB(); renderView();
      toast(p.active ? '已启用' : '已停用', 'ok');
      break;
    }
    case 'del-party': {
      const p = partyById(id);
      if (!p) break;
      const used = COMPANY.transactions.filter(t => t.partyId === p.id).length;
      if (used) return toast('该单位已有 ' + used + ' 笔流水，只能停用', 'err');
      confirmDialog({
        title: '删除往来单位？', message: '将删除「<b>' + esc(p.name) + '</b>」，不可恢复。',
        confirmText: '删除', requireCode: true,
        onConfirm: () => {
          logAction('删除', { module: '档案', target: '往来单位 ' + p.name, targetId: p.id });
          COMPANY.parties = ensurePartyList(COMPANY).filter(x => x.id !== p.id);
          saveDB(); closeModal(); renderView(); toast('已删除', 'ok');
        }
      });
      break;
    }
    case 'new-advance': openAdvanceModal(); break;
    case 'issue-advance': issueAdvance(id); break;
    case 'close-advance': closeAdvance(id); break;
    case 'del-advance': {
      const adv = ensureAdvanceList(COMPANY).find(x => x.id === id);
      if (!adv) break;
      confirmDialog({
        title: '删除借支记录？', message: '将删除「<b>' + esc(adv.userName) + '</b>」的借支记录，已生成的流水不会自动删除。',
        confirmText: '删除', requireCode: true,
        onConfirm: () => {
          logAction('删除', { module: '档案', target: '借支 ' + adv.userName, targetId: id });
          COMPANY.advances = ensureAdvanceList(COMPANY).filter(x => x.id !== id);
          saveDB(); closeModal(); renderView(); toast('已删除', 'ok');
        }
      });
      break;
    }
    case 'new-invoice': openInvoiceModal(); break;
    case 'edit-invoice': openInvoiceModal(id); break;
    case 'del-invoice': {
      const inv = ensureInvoiceList(COMPANY).find(x => x.id === id);
      if (!inv) break;
      confirmDialog({
        title: '删除票据记录？', message: '将删除「<b>' + esc(inv.party) + '</b>」的票据记录。',
        confirmText: '删除', requireCode: true,
        onConfirm: () => {
          logAction('删除', { module: '档案', target: '票据 ' + inv.party, targetId: id });
          COMPANY.invoices = ensureInvoiceList(COMPANY).filter(x => x.id !== id);
          saveDB(); closeModal(); renderView(); toast('已删除', 'ok');
        }
      });
      break;
    }
    case 'voucher-reset': UI.voucherFilter = { keyword: '', from: '', to: '' }; renderView(); break;
    case 'voucher-export': {
      const rows = allVouchers().map(v => [v.t.voucherNo, v.t.date, txTypeLabel(v.t), v.t.category, v.t.summary || '', v.t.counterparty || '', v.t.amount, v.co.name]);
      saveTextFile('凭证清单_' + todayISO() + '.csv',
        toCSV(['凭证号', '日期', '类型', '分类', '摘要', '往来单位', '金额', '公司'], rows), 'text/csv;charset=utf-8');
      break;
    }
    case 'log-reset': UI.logFilter = { from: '', to: '', user: '', module: '', action: '' }; UI.logPage = 1; renderView(); break;
    case 'log-page': UI.logPage = num(el.dataset.page) || 1; renderView(); break;
    case 'log-export': {
      const rows = filteredLogs().map(l => [l.at, l.userName, l.module, l.action, l.target, l.before, l.after, l.result === 'fail' ? '失败' : '成功']);
      saveTextFile('操作日志_' + todayISO() + '.csv',
        toCSV(['时间', '用户', '模块', '操作', '对象', '变更前', '变更后', '结果'], rows), 'text/csv;charset=utf-8');
      break;
    }
    case 'log-clear': {
      confirmDialog({
        title: '清理操作日志',
        message: '将清空全部 ' + (DB.auditLogs || []).length + ' 条日志，<b>不可恢复</b>。',
        confirmText: '清空日志',
        requireCode: true,
        onConfirm: () => {
          const cnt = (DB.auditLogs || []).length;
          DB.auditLogs = [];
          logAction('清空', { module: '数据', target: '操作日志', before: cnt + ' 条' });
          saveDB(); closeModal(); renderView();
          toast('日志已清空', 'ok');
        }
      });
      break;
    }
    case 'gen-voucher': {
      const form = el.closest('form');
      if (!form) break;
      const t = form.dataset.type || 'out';
      const d = (form.elements.date && form.elements.date.value) || todayISO();
      form.elements.voucherNo.value = nextVoucherNo(t, d);
      toast('已按规则生成凭证号', 'ok');
      break;
    }
    case 'set-motion-speed': setMotionSpeed(el.dataset.speed); break;
    case 'set-perf': setPerfMode(el.dataset.mode || 'auto'); break;
    case 'set-parent-mode': {
      const mode = el.dataset.mode === 'registry' ? 'registry' : 'company';
      if (DB.meta.parentMode === mode) break;
      confirmDialog({
        title: '更改总公司登记方式',
        message: mode === 'registry'
          ? '总公司将<b>不再作为独立公司参与集团合并</b>，其资金与往来不计入集团总额与集团报表。已有数据不会删除，切换回来即可恢复。'
          : '总公司将<b>作为独立公司参与集团合并</b>，其资金与往来计入集团总额与集团报表。',
        confirmText: '确认切换',
        tone: 'primary',
        onConfirm: () => {
          DB.meta.parentMode = mode;
          logAction('修改', { module: '设置', target: '总公司登记方式', after: mode === 'registry' ? '仅登记主体' : '独立公司' });
          saveDB(); closeModal(); renderView();
          toast('已切换为「' + (mode === 'registry' ? '仅集团登记主体' : '作为独立公司') + '」', 'ok');
        }
      });
      break;
    }
    case 'save-idle': {
      const m = Math.max(1, Math.min(240, num($('#idle-min').value) || 30));
      localStorage.setItem('fm-idle-min', String(m));
      armIdle();
      renderView();
      toast('已设置 ' + m + ' 分钟无操作自动退出', 'ok');
      break;
    }
    case 'toggle-sidebar': toggleSidebar(); break;
    case 'clear-remember': clearRemember(); break;
    case 'open-manual': closePopover(); openManual(); break;
    case 'manual-external': if (DESKTOP) window.desktop.openManual(); break;
    case 'del-user': {
      {
        const target = DB.users.find(u => u.id === id);
        if (target && target.builtin) return toast('内置管理员账号不可删除', 'err');
      }
      const u = userById(id);
      if (!u) break;
      if (u.id === SESSION.id) return toast('不能删除当前登录账号', 'err');
      if (u.role === 'admin' && DB.users.filter(x => x.role === 'admin' && x.active !== false).length <= 1) {
        return toast('至少要保留一个管理员', 'err');
      }
      confirmDialog({
        title: '删除用户？',
        requireCode: true,
        message: `将删除用户「<b>${esc(u.displayName)}</b>」（@${esc(u.username)}）。其录入的流水会保留，但不再关联到具体操作人。`,
        confirmText: '删除',
        onConfirm: () => {
          DB.users = DB.users.filter(x => x.id !== u.id);
          saveDB(); closeModal(); render();
          toast('用户已删除', 'ok');
        }
      });
      break;
    }
    case 'logout':
      confirmDialog({
        title: '退出登录',
        message: '退出后需要重新输入账号密码。未保存的内容会丢失。',
        confirmText: '退出',
        onConfirm: () => {
          closeModal();
          endSession();
          renderAuth('login');
        }
      });
      break;

    /* 设置与数据 */
    case 'save-company': {
      const name = $('#company-input').value.trim();
      const cur = $('#currency-select').value;
      if (!CURRENCIES[cur]) return toast('不支持的货币', 'err');
      if (name) COMPANY.name = name;
      DB.meta.currency = cur;
      CURRENCY = cur;
      saveDB(); renderShell();
      toast('设置已保存', 'ok');
      break;
    }
    case 'save-group': {
      DB.meta.groupName = ($('#group-input').value || '').trim();
      saveDB(); renderShell();
      toast(DB.meta.groupName ? `集团名称已设为「${DB.meta.groupName}」` : '已清除集团名称', 'ok');
      break;
    }
    case 'export-json': exportJSON(); break;
    case 'import-json': importJSON(); break;
    case 'export-all-csv': exportTxCSV(sortedTx(), '资金流水全部'); break;
    case 'open-data-folder': if (DESKTOP) window.desktop.openDataFolder(); break;
    case 'seed':
      if (DB.accounts.length || DB.transactions.length) {
        confirmDialog({
          title: '载入示例数据',
        requireCode: true,
          message: '示例数据会<b>覆盖当前账本</b>（账户、流水、往来款、预算）。如果已有正式数据，请先导出备份。<br><br>用户账号会保留。',
          confirmText: '覆盖并载入',
          onConfirm: () => { closeModal(); seedData(); }
        });
      } else {
        seedData();
      }
      break;
    case 'clear-all':
      openClearAllModal();
      break;
  }
});

/* 筛选：局部重绘 + 防抖，保持输入焦点 */
let txFilterTimer = null;
document.addEventListener('input', e => {
  const f = e.target.closest('[data-filter]');
  if (f) {
    /* 日期交给 change 事件统一校验，避免每敲一个数字就弹一次错 */
    if (f.dataset.filter === 'from' || f.dataset.filter === 'to') return;
    UI.txFilter[f.dataset.filter] = f.value;
    UI.txFilter.page = 1;
    clearTimeout(txFilterTimer);
    txFilterTimer = setTimeout(() => {
      const area = $('#tx-area');
      if (area) area.innerHTML = txAreaHTML();
    }, 120);
  }
});

document.addEventListener('change', e => {
  const f = e.target.closest('[data-filter]');
  if (f) {
    const key = f.dataset.filter;
    if (key === 'from' || key === 'to') {
      const nf = key === 'from' ? f.value : UI.txFilter.from;
      const nt = key === 'to' ? f.value : UI.txFilter.to;
      if (!checkDateRange(nf, nt)) { f.value = UI.txFilter[key] || ''; return; }
    }
    UI.txFilter[key] = e.target.value;
    UI.txFilter.page = 1;
    const area = $('#tx-area');
    if (area) area.innerHTML = txAreaHTML();
    return;
  }

  const bm = e.target.closest('[data-budget-month]');
  if (bm) { UI.budgetMonth = bm.value; renderView(); return; }

  const lsd = e.target.closest('[data-log-show-del]');
  if (lsd) { UI.logShowDeleted = !!lsd.checked; UI.logPage = 1; renderView(); return; }

  const b = e.target.closest('[data-budget-cat]');
  if (b) {
    const month = UI.budgetMonth || monthOf(todayISO());
    const catId = b.dataset.budgetCat;
    const val = round2(num(b.value));
    const exist = DB.budgets.find(x => x.month === month && x.categoryId === catId);
    if (val > 0) {
      if (exist) exist.amount = val;
      else DB.budgets.push({ id: uid('b'), month, categoryId: catId, amount: val });
    } else if (exist) {
      DB.budgets = DB.budgets.filter(x => x !== exist);
    }
    saveDB(); renderView();
    return;
  }

  const cf = e.target.closest('[data-cf]');
  if (cf) {
    const key = cf.dataset.cf;
    const nf = key === 'from' ? cf.value : UI.cfRange.from;
    const nt = key === 'to' ? cf.value : UI.cfRange.to;
    if (!checkDateRange(nf, nt)) { cf.value = UI.cfRange[key] || ''; return; }
    UI.cfRange[key] = cf.value; UI.cfPreset = ''; renderView(); return;
  }

  const st = e.target.closest('[data-stmt]');
  if (st) { UI.stmt[st.dataset.stmt] = st.value; renderView(); return; }

  const gr = e.target.closest('[data-group]');
  if (gr) {
    const key = gr.dataset.group;
    const nf = key === 'from' ? gr.value : UI.groupRange.from;
    const nt = key === 'to' ? gr.value : UI.groupRange.to;
    if (!checkDateRange(nf, nt)) { gr.value = UI.groupRange[key] || ''; return; }
    UI.groupRange[key] = gr.value; UI.groupPreset = ''; renderView(); return;
  }

  /* 趋势自定义日期范围 */
  const td = e.target.closest('[data-trend]');
  if (td) {
    const r = UI.trendRange || (UI.trendRange = { from: '', to: '' });
    const k = td.dataset.trend;
    const nf = k === 'from' ? td.value : r.from;
    const nt = k === 'to' ? td.value : r.to;
    if (!checkDateRange(nf, nt)) { td.value = r[k] || ''; return; }
    r[k] = td.value;
    if (!r.from || !r.to) { /* 只填了一头就先存着，等另一头 */ }
    renderView();
    return;
  }

  /* 台账通用筛选（往来款 / 借支 / 票据） */
  const lf = e.target.closest('[data-f]');
  if (lf) {
    const fkey = lf.dataset.f, fk = lf.dataset.k;
    const st = ledgerState(fkey);
    if (fk === 'from' || fk === 'to') {
      const nf = fk === 'from' ? lf.value : st.from;
      const nt = fk === 'to' ? lf.value : st.to;
      if (!checkDateRange(nf, nt)) { lf.value = st[fk] || ''; return; }
    }
    st[fk] = lf.value;
    st.page = 1;
    if (fk === 'status') st.overdue = '';
    renderView();
    return;
  }

  /* 统计汇总页的日期筛选（此前没有监听，输入完全无效） */
  const rp = e.target.closest('[data-report]');
  if (rp) {
    const key = rp.dataset.report;
    const nf = key === 'from' ? rp.value : UI.reportRange.from;
    const nt = key === 'to' ? rp.value : UI.reportRange.to;
    if (!checkDateRange(nf, nt)) { rp.value = UI.reportRange[key] || ''; return; }
    UI.reportRange[key] = rp.value; renderView(); return;
  }
});

/* 环形图悬停：中心文字切换为该扇区的名称/金额/占比（REQ-10） */
function bindDonutHover() {
  document.addEventListener('mouseover', e => {
    const seg = e.target.closest && e.target.closest('.dseg');
    if (!seg) return;
    const box = seg.closest('.donut-wrap');
    if (!box) return;
    const lbl = box.querySelector('.dcenter-label');
    const val = box.querySelector('.dcenter-value');
    if (lbl) lbl.textContent = seg.dataset.label || '';
    if (val) val.textContent = `${seg.dataset.value || ''} · ${seg.dataset.pct || ''}%`;
  });
  document.addEventListener('mouseout', e => {
    const seg = e.target.closest && e.target.closest('.dseg');
    if (!seg) return;
    const box = seg.closest('.donut-wrap');
    if (!box) return;
    const lbl = box.querySelector('.dcenter-label');
    const val = box.querySelector('.dcenter-value');
    if (lbl) lbl.textContent = lbl.dataset.def || '';
    if (val) val.textContent = val.dataset.def || '';
  });
}
bindDonutHover();

/* ---------------------------------- 启动 ---------------------------------- */

(async function boot() {
  applyMotion();
  applyPerf();          /* 先按上次结论定档，避免首屏用错档位闪一下 */
  applyTheme();
  await loadDB();
  await detectGpu();    /* 再问主进程要真实显卡状态，必要时降档 */

  if (DESKTOP) {
    try { APP_INFO = await window.desktop.info(); } catch (e) { console.error(e); }
    if (window.desktop.backup) {
      window.desktop.backup.onDone(entry => {
        if (!SESSION) return;
        if (entry.result === 'ok') toast('云盘备份完成（' + Math.round(entry.size / 1024) + ' KB）', 'ok');
        else toast('云盘备份失败：' + entry.error, 'err');
        if (UI.view === 'backup') loadBackupCfg(true);
      });
      window.desktop.backup.onGdriveOk(() => {
        toast('Google Drive 授权成功', 'ok');
        loadBackupCfg(true);
      });
      window.desktop.backup.onGdriveFail(msg => toast('授权失败：' + msg, 'err'));
    }
    window.desktop.onMenu(action => {
      if (action === 'confirm-close') {
        if (!SESSION) { window.desktop.closeAction('quit'); return; }
        openCloseDialog();
        return;
      }
      if (!SESSION) return;
      if (action === 'export-json') exportJSON();
      else if (action === 'import-json') importJSON();
      else if (action === 'new-tx') openTxModal();
    });
  }

  await ensureMasterAccount();

  /* 首次使用：内置管理员尚未设置口令 → 必须先设账号 + 口令 + 两个预留问题。
     预留问题是唯一的口令找回通道，缺了它等于把唯一管理员锁死。 */
  const freshAdmin = DB.users.find(u => u.builtin && u.mustSetPassword);
  if (freshAdmin) {
    renderFirstRun(freshAdmin);
    return;
  }
  renderAuth('login');
})();


/* ------------------------------ 关闭窗口 ------------------------------ */

function openCloseDialog() {
  openModal(modalShell({
    title: '关闭合资金账',
    sub: '请选择关闭方式',
    cls: 'slim',
    body: `<div class="modal-bd">
      <div class="close-choice" data-action="close-quit">
        <b>${icon('power', 16)} 直接退出</b>
        <span>注销当前登录并结束程序</span>
      </div>
      <div class="close-choice" data-action="close-background">
        <b>${icon('layers', 16)} 挂到后台</b>
        <span>保持登录与后台任务，从托盘图标恢复</span>
      </div>
      <label class="switch" style="margin-top:12px"><input type="checkbox" id="close-never"><span class="track"></span><span>下次不再询问（直接挂到后台）</span></label>
    </div>`
  }), { noFocus: true });

  const never = $('#close-never');
  const act = action => {
    const nv = never && never.checked;
    closeModal();
    if (DESKTOP) window.desktop.closeAction(nv ? 'never-ask' : action);
  };
  document.querySelectorAll('[data-action="close-quit"]').forEach(el => el.addEventListener('click', () => act('quit')));
  document.querySelectorAll('[data-action="close-background"]').forEach(el => el.addEventListener('click', () => act('background')));
}


/* ------------------------------ 首次使用：设置管理员口令 ------------------------------ */

function firstRunHTML(u) {
  const q = SECURITY_QUESTIONS;
  return `
  <div class="auth">
    ${authBrandHTML()}
    <div class="auth-panel">
      <div class="auth-form firstrun">
        <div class="fr-head">
          <div class="fr-badge">首次使用</div>
          <h2>三步完成初始化</h2>
          <p class="lead">为管理员账号设置登录口令与找回方式。全部信息只保存在本机。</p>
        </div>

        <div class="fr-steps">
          <div class="fr-step"><i>1</i><span>管理员账号</span></div>
          <div class="fr-step"><i>2</i><span>登录口令</span></div>
          <div class="fr-step"><i>3</i><span>找回方式</span></div>
        </div>

        <form id="firstrun-form">
          <div class="auth-err" id="auth-err">${icon('alert', 14)}<span></span></div>

          <div class="fr-block">
            <div class="fr-block-hd"><b>管理员账号</b><span>登录时使用，可用手机号或易记账号</span></div>
            <div class="form-grid">
              <label class="field"><span class="lbl">账号</span>
                <input type="text" name="account" value="${esc(u.username)}" placeholder="3–20 位字母、数字或 _ . -" required autofocus></label>
              <label class="field"><span class="lbl">显示名称</span>
                <input type="text" name="nick" value="${esc(u.displayName)}" placeholder="你的姓名" required></label>
            </div>
          </div>

          <div class="fr-block">
            <div class="fr-block-hd"><b>登录口令</b><span>至少 6 位，建议字母 + 数字</span></div>
            <div class="form-grid">
              <label class="field"><span class="lbl">口令</span>
                <input type="password" name="p1" placeholder="至少 6 位" required></label>
              <label class="field"><span class="lbl">确认口令</span>
                <input type="password" name="p2" placeholder="再输入一次" required></label>
            </div>
          </div>

          <div class="fr-block">
            <div class="fr-block-hd"><b>找回方式</b><span>忘记口令时用这两道题自助重置</span></div>
            <div class="form-grid">
              <label class="field"><span class="lbl">问题 1</span>
                <select name="q1">${q.map((x, i) => `<option value="${i}">${x}</option>`).join('')}</select></label>
              <label class="field"><span class="lbl">答案 1</span>
                <input type="text" name="a1" placeholder="不区分大小写" required></label>
              <label class="field"><span class="lbl">问题 2</span>
                <select name="q2">${q.map((x, i) => `<option value="${i}" ${i === 1 ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
              <label class="field"><span class="lbl">答案 2</span>
                <input type="text" name="a2" placeholder="不区分大小写" required></label>
            </div>
            <div class="fr-hint">${icon('info', 12)} 答案请选自己记得住、别人不易猜到的；设置后可在「账号安全」里修改。</div>
          </div>

          <button class="btn primary block fr-submit" type="submit">${icon('check', 15)} 完成初始化，进入系统</button>
          <div class="fr-foot">${icon('lock', 12)} 口令以加盐哈希保存在本机数据文件，程序内不含任何默认口令</div>
        </form>
      </div>
    </div>
  </div>`;
}
function bindFirstRun() {
  const form = $('#firstrun-form');
  if (!form) return;
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(form);
    const p1 = String(fd.get('p1') || ''), p2 = String(fd.get('p2') || '');
    if (p1.length < 6) return failField(form, 'p1', '口令至少 6 位');
    if (p1 !== p2) return failField(form, 'p2', '两次输入不一致');
    const u = DB.users.find(x => x.builtin && x.mustSetPassword);
    if (!u) return;
    const account = String(fd.get('account') || '').trim();
    if (!/^[a-zA-Z0-9_.\-]{3,20}$/.test(account)) return failField(form, 'account', '账号需为 3-20 位字母、数字或 _ . -');
    if (DB.users.some(x => x.username === account && x.id !== u.id)) return failField(form, 'account', '该账号已被占用');
    u.username = account;
    u.displayName = String(fd.get('nick') || '').trim() || '管理员';
    u.salt = randomSalt();
    u.hash = await hashPassword(p1, u.salt);
    u.security = [
      { q: num(fd.get('q1')), salt: randomSalt(), hash: '' },
      { q: num(fd.get('q2')), salt: randomSalt(), hash: '' }
    ];
    u.security[0].hash = await hashPassword(String(fd.get('a1') || '').trim().toLowerCase(), u.security[0].salt);
    u.security[1].hash = await hashPassword(String(fd.get('a2') || '').trim().toLowerCase(), u.security[1].salt);
    u.mustSetPassword = false;
    logAction('修改', { module: '用户', target: '首次设置管理员口令', targetId: u.id });
    saveDB();
    toast('口令已设置，请登录', 'ok');
    renderAuth('login');
  });
}


/* 首次使用：独立渲染，避免与登录页分支互相干扰 */
function renderFirstRun(u) {
  const root = $('#root');
  if (window.Scene3D) Scene3D.dispose();
  root.innerHTML = firstRunHTML(u);
  if (window.Scene3D) Scene3D.mount(root);
  bindFirstRun();
}
