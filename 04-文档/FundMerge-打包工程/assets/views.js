/* ============================================================================
   合资金账 · 视图层
   ========================================================================== */

'use strict';

/* --------------------------------- 公共片段 -------------------------------- */

function catChip(cat, showIcon = true) {
  if (!cat) return '';
  return `<span class="cat-chip">
    ${showIcon ? `<span class="cat-ico" style="--c:${cat.color}">${icon(cat.icon, 13)}</span>` : `<span class="cat-dot" style="--c:${cat.color}"></span>`}
    <span>${esc(cat.name)}</span>
  </span>`;
}

function emptyState({ ico = 'info', title, desc, actions = '' }) {
  return `<div class="empty">
    <div class="empty-ico">${icon(ico, 20)}</div>
    <h4>${esc(title)}</h4>
    ${desc ? `<p>${desc}</p>` : ''}
    ${actions ? `<div class="empty-actions">${actions}</div>` : ''}
  </div>`;
}

/* 台账通用筛选栏（G-04）
   key 用于 data-f 前缀（debt / advance / invoice），state 为该页的筛选状态对象 */
function filterBar(key, fields, state) {
  return `<div class="toolbar no-print" style="gap:10px;flex-wrap:wrap;margin-bottom:12px">
    ${fields.map(f => {
      const v = state[f.k] == null ? '' : state[f.k];
      if (f.t === 'select') {
        return `<label class="field" style="min-width:132px"><label>${f.label}</label>
          <select data-f="${key}" data-k="${f.k}">${f.opts.map(o => `<option value="${o[0]}" ${String(o[0]) === String(v) ? 'selected' : ''}>${o[1]}</option>`).join('')}</select></label>`;
      }
      const w = f.t === 'date' ? 138 : 168;
      return `<label class="field" style="min-width:${w}px"><label>${f.label}</label>
        <input type="${f.t}" data-f="${key}" data-k="${f.k}" value="${esc(v)}" placeholder="${f.ph || ''}"></label>`;
    }).join('')}
    <div class="spacer"></div>
    <button class="btn secondary sm" data-action="f-clear" data-f="${key}">${icon('rotate', 13)} 清空筛选</button>
  </div>`;
}

/* 三台账的通用过滤：日期范围 + 状态 + 关键字 */
function applyLedgerFilter(list, st, get) {
  const from = st.from || '', to = st.to || '', kw = String(st.kw || '').trim().toLowerCase();
  return list.filter(x => {
    const g = get(x);
    if (from && g.date && g.date < from) return false;
    if (to && g.date && g.date > to) return false;
    if (st.status && g.status !== st.status) return false;
    if (st.overdue && !g.overdue) return false;
    if (kw) {
      const hay = `${g.text || ''}`.toLowerCase();
      if (hay.indexOf(kw) < 0) return false;
    }
    return true;
  });
}

/* 三台账筛选状态（debt / advance / invoice），视图与事件处理共用 */
const LEDGER_FILTER_KEY = { debt: 'debtFilter', advance: 'advanceFilter', invoice: 'invoiceFilter' };
function ledgerState(key) {
  const name = LEDGER_FILTER_KEY[key] || 'debtFilter';
  if (!UI[name]) UI[name] = { from: '', to: '', status: '', kw: '', overdue: '', page: 1 };
  return UI[name];
}

/* 趋势区间（REQ-04/09）：快捷天数或自定义日期范围，两者互斥 */
function trendWindow() {
  const today = todayISO();
  const r = UI.trendRange || {};
  if (r.from && r.to) return { start: r.from, end: r.to, custom: true };
  const d = UI.trendDays == null ? 30 : UI.trendDays;
  return { start: d === 0 ? `${today.slice(0, 4)}-01-01` : addDays(today, -(d - 1)), end: today, custom: false };
}

function trendSegHTML() {
  const r = UI.trendRange || {};
  return [[7, '7天'], [30, '30天'], [90, '90天'], [0, '本年']].map(([n, l]) =>
    `<button class="seg-btn ${!r.from && UI.trendDays === n ? 'is-active' : ''}" data-action="trend-range" data-days="${n}">${l}</button>`).join('');
}

function trendDateHTML() {
  const r = UI.trendRange || {};
  const st = 'width:118px;padding:5px 8px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--ink);font-size:12px';
  return `<input type="date" data-trend="from" value="${esc(r.from || '')}" title="自定义开始日期" style="${st}">
    <span style="color:var(--muted-2);font-size:12px">~</span>
    <input type="date" data-trend="to" value="${esc(r.to || '')}" title="自定义结束日期" style="${st}">`;
}

function pager(total, page, size, action) {  const pages = Math.max(1, Math.ceil(total / size));
  const cur = Math.min(Math.max(1, page), pages);
  const from = total === 0 ? 0 : (cur - 1) * size + 1;
  const to = Math.min(total, cur * size);
  const btn = (p, label, disabled, active) =>
    `<button class="btn sm ${active ? 'primary' : 'secondary'}" ${disabled ? 'disabled' : ''} data-action="${action}" data-page="${p}">${label}</button>`;
  return `<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 18px;border-top:1px solid var(--line)">
    <span style="font-size:12px;color:var(--muted-2)">第 ${from}–${to} 条，共 ${total} 条</span>
    <div style="display:flex;gap:6px">
      ${btn(cur - 1, '上一页', cur <= 1, false)}
      <span style="display:flex;align-items:center;padding:0 6px;font-size:12px;color:var(--muted)">${cur} / ${pages}</span>
      ${btn(cur + 1, '下一页', cur >= pages, false)}
    </div>
  </div>`;
}

/* -------------------------------- 关注提醒 -------------------------------- */

function insightItems(cos) {
  const items = [];
  const list = (cos && cos.length ? cos : DB.companies).filter(Boolean);

  let odCount = 0, odAmt = 0;
  list.forEach(co => co.debts.forEach(d => {
    const info = debtInfo(d, co);
    if (info.overdue) { odCount++; odAmt += info.remaining; }
  }));
  if (odCount) {
    items.push({
      tone: 'danger', icon: 'alert',
      title: `${odCount} 笔往来已逾期`,
      sub: `未结金额 ${fmt(round2(odAmt))}`,
      view: 'debts', label: '去处理'
    });
  }

  const m = monthOf(todayISO());
  const overList = [];
  list.forEach(co => {
    budgetRows(m, co).forEach(r => {
      if (r.budget > 0 && r.pct > 100) overList.push({ co, name: r.cat.name, pct: r.pct, over: round2(r.spent - r.budget) });
    });
  });
  if (overList.length) {
    const total = round2(overList.reduce((s, o) => s + o.over, 0));
    const top = overList.sort((a, b) => b.pct - a.pct)[0];
    items.push({
      tone: 'warn', icon: 'budget',
      title: `${overList.length} 个分类本月超预算`,
      sub: `合计超支 ${fmt(total)} · 最高 ${top.name} ${top.pct.toFixed(0)}%`,
      view: 'budgets', label: '看预算'
    });
  }

  const neg = [];
  list.forEach(co => co.accounts.forEach(a => {
    const b = balanceOf(a, null, co);
    if (b < -0.005) neg.push({ co, a, b });
  }));
  if (neg.length) {
    items.push({
      tone: 'danger', icon: 'wallet',
      title: `${neg.length} 个账户余额为负`,
      sub: `${neg[0].a.name} ${fmt(neg[0].b)}，请核对流水`,
      view: 'accounts', label: '去核对'
    });
  }

  return items.slice(0, 3);
}

function insightsCard(items) {
  if (!items || !items.length) return '';
  return `<div class="insights">
    ${items.map(i => `<button class="insight" data-action="nav" data-view="${i.view}">
      <span class="insight-ico ${i.tone}">${icon(i.icon, 15)}</span>
      <span class="insight-main">
        <b>${esc(i.title)}</b>
        <span>${esc(i.sub)}</span>
      </span>
      <span class="insight-go">${esc(i.label)}${icon('chevronRight', 13)}</span>
    </button>`).join('')}
  </div>`;
}

/* ============================================================================
   总览
   ========================================================================== */

function viewDashboard() {
  if (DB.accounts.length === 0) return onboarding();

  const total = totalBalance();
  const today = todayISO();
  const thisM = monthOf(today);
  const cur = rangeStats(thisM + '-01', today);
  const prevM = monthOf(addDays(thisM + '-01', -1));
  const prev = rangeStats(prevM + '-01', addDays(thisM + '-01', -1));

  const lend = debtTotals('lend');
  const payable = debtTotals('borrow');
  const reimb = debtTotals('reimburse');
  const payableAll = round2(payable.remaining + reimb.remaining);

  const diff = round2(cur.net - prev.net);
  const netFoot = (prev.inflow + prev.outflow) > 0
    ? `较上月 ${diff >= 0 ? '+' : ''}${fmt(diff)}`
    : '上月无对比数据';

  const tw = trendWindow();
  const start = tw.start;
  const end = tw.end;
  const series = balanceSeries(start, end);
  const chg = round2(total - (series[0] ? series[0].value : 0));

  const seg = trendSegHTML();

  /* 支出构成（本月） */
  const outMap = new Map();
  DB.transactions.forEach(t => {
    if (t.type !== 'out' || monthOf(t.date) !== thisM) return;
    const c = txCat(t);
    const k = c.id || c.name;
    if (!outMap.has(k)) outMap.set(k, { name: c.name, color: c.color, icon: c.icon, value: 0 });
    outMap.get(k).value += num(t.amount);
  });
  let outRows = [...outMap.values()].sort((a, b) => b.value - a.value);
  const outTotal = round2(outRows.reduce((s, r) => s + r.value, 0));
  const donutRows = outRows.slice(0, 6);
  const topOut = outRows.slice(0, 5);
  const outMax = Math.max(1, ...topOut.map(r => r.value));

  /* 预算 */
  const bm = budgetSummary(thisM);

  /* 待办往来 */
  const openDebts = DB.debts.map(d => ({ d, info: debtInfo(d) }))
    .filter(x => x.info.status !== 'settled')
    .sort((a, b) => {
      const ad = a.d.dueDate || '9999', bd = b.d.dueDate || '9999';
      return ad.localeCompare(bd);
    }).slice(0, 5);

  const recent = sortedTx().slice(0, 6);
  const acctSorted = [...DB.accounts].sort((a, b) => balanceOf(b) - balanceOf(a));

  const hour = new Date().getHours();
  const greet = hour < 6 ? '夜深了' : hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好';

  return `
  <div class="page-hero">
    <div>
      <h2>${greet}，${esc(SESSION.displayName)}</h2>
      <p>${fmtDateCN(today)} · 全公司资金一览</p>
    </div>
    <div style="display:flex;gap:8px">
      <button class="btn secondary" data-action="new-debt">${icon('debt', 15)} 登记往来</button>
      <button class="btn primary" data-action="new-tx">${icon('plus', 15)} 记一笔</button>
    </div>
  </div>

  <div class="stat-grid mb-14">
    <div class="stat hero is-clickable" data-action="drill" data-metric="total" title="点击查看各公司构成">
      <canvas class="scene-canvas" data-scene="hero"></canvas>
      <div class="stat-top">
        <span class="stat-label">资金总额</span>
        <span class="stat-ico">${icon('wallet', 15)}</span>
      </div>
      <div class="stat-value" data-count="${total}">${fmt(total)}</div>
      <div class="hero-spark">${sparkline(series)}</div>
      <div class="stat-foot">${chg === 0 ? '与区间起点持平' : `较区间起点 ${chg > 0 ? '+' : ''}${fmt(chg)}`}</div>
    </div>

    <div class="stat is-clickable" data-action="stat-jump" data-to="transactions" title="点击查看本月流水明细">
      <div class="stat-top">
        <span class="stat-label">本月净流入</span>
        <span class="stat-ico in">${icon('flow', 15)}</span>
      </div>
      <div class="stat-value sm ${cur.net > 0 ? 'in' : cur.net < 0 ? 'out' : ''}">${cur.net > 0 ? '+' : ''}${fmt(cur.net)}</div>
      <div class="stat-foot">${netFoot}</div>
    </div>

    <div class="stat is-clickable" data-action="stat-jump" data-to="debts" data-tab="lend" title="点击查看借出台账">
      <div class="stat-top">
        <span class="stat-label">应收（借出未收）</span>
        <span class="stat-ico warn">${icon('debt', 15)}</span>
      </div>
      <div class="stat-value sm">${fmt(lend.remaining)}</div>
      <div class="stat-foot">${lend.count} 笔未结清${lend.overdue > 0 ? ` · 逾期 ${fmt(lend.overdue)}` : ''}</div>
    </div>

    <div class="stat is-clickable" data-action="stat-jump" data-to="debts" data-tab="borrow" title="点击查看借入台账">
      <div class="stat-top">
        <span class="stat-label">应付（借入 + 未报销）</span>
        <span class="stat-ico out">${icon('receipt', 15)}</span>
      </div>
      <div class="stat-value sm">${fmt(payableAll)}</div>
      <div class="stat-foot">${payable.count + reimb.count} 笔未结清</div>
    </div>
  </div>

  ${insightsCard(insightItems([COMPANY]))}

  <div class="grid g-main-side mb-14">
    <div class="card">
      <div class="card-hd">
        <div>
          <div class="card-title">资金余额趋势</div>
          <div class="card-sub">${start} 至 ${end} · 全部账户合计</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><div class="seg" style="width:auto">${seg}</div>${trendDateHTML()}</div>
      </div>
      <div class="card-bd">${areaChart(series, { height: 250 })}</div>
    </div>

    <div class="card">
      <div class="card-hd">
        <div>
          <div class="card-title">账户余额</div>
          <div class="card-sub">${DB.accounts.length} 个账户</div>
        </div>
        <button class="btn sm ghost" data-action="nav" data-view="accounts">管理</button>
      </div>
      <div class="card-bd">
        <div class="acct-list">
          ${acctSorted.map(a => {
            const b = balanceOf(a);
            const s = accountStats(a, thisM + '-01', today);
            const delta = round2(s.inflow - s.outflow);
            return `<div class="acct-row">
              <div class="acct-ico ${a.type === 'cash' ? 'cash' : ''}">${icon(a.type === 'cash' ? 'wallet' : 'bank', 16)}</div>
              <div class="acct-meta">
                <strong>${esc(a.name)}</strong>
                <span>${a.type === 'cash' ? '库存现金' : esc(a.bankName || '银行账户')}${a.active === false ? ' · 已停用' : ''}</span>
              </div>
              <div class="acct-amt">${fmt(b)}
                <small style="color:${delta > 0 ? 'var(--in)' : delta < 0 ? 'var(--out)' : 'var(--muted-2)'}">本月 ${delta > 0 ? '+' : ''}${delta === 0 ? '无变动' : fmt(delta)}</small>
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>
    </div>
  </div>

  <div class="grid g-3 mb-14">
    <div class="card">
      <div class="card-hd">
        <div><div class="card-title">本月支出构成</div><div class="card-sub">合计 ${fmt(outTotal)}</div></div>
      </div>
      <div class="card-bd">
        ${donutRows.length ? `
          ${donutChart(donutRows.map(r => ({ label: r.name, value: r.value, color: r.color })), { size: 156, centerLabel: '本月支出', centerValue: fmtShort(outTotal) })}
          <div class="legend" style="justify-content:center;flex-wrap:wrap;gap:10px;margin-top:12px">
            ${donutRows.map(r => `<span><i style="background:${r.color}"></i>${esc(r.name)}</span>`).join('')}
          </div>` : '<div class="chart-empty" style="height:200px">本月暂无支出</div>'}
      </div>
    </div>

    <div class="card">
      <div class="card-hd">
        <div><div class="card-title">预算执行</div><div class="card-sub">${monthLabel(thisM)}</div></div>
        <button class="btn sm ghost" data-action="nav" data-view="budgets">设置</button>
      </div>
      <div class="card-bd">
        ${bm.budget > 0 ? `
          <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:6px">
            <span style="font-size:12px;color:var(--muted)">已用 ${fmtShort(bm.spent)} / ${fmtShort(bm.budget)}</span>
            <strong style="font-size:13px;color:${bm.pct > 100 ? 'var(--danger)' : bm.pct > 80 ? 'var(--warn)' : 'var(--ink)'}">${bm.pct.toFixed(0)}%</strong>
          </div>
          <div class="progress lg"><i class="${bm.pct > 100 ? 'over' : bm.pct > 80 ? 'warn' : 'ok'}" style="width:${Math.min(100, bm.pct).toFixed(1)}%"></i></div>
          <div class="list" style="margin-top:10px">
            ${bm.rows.filter(r => r.spent > 0).sort((a, b) => b.pct - a.pct).slice(0, 4).map(r => `
              <div class="list-row" style="padding:7px 0">
                <div class="lr-main">
                  <div class="lr-title" style="display:flex;justify-content:space-between">
                    <span>${esc(r.cat.name)}</span>
                    <span style="color:${r.pct > 100 ? 'var(--danger)' : 'var(--muted)'};font-size:11.5px">${r.pct.toFixed(0)}%</span>
                  </div>
                  <div class="progress" style="margin-top:5px"><i class="${r.pct > 100 ? 'over' : r.pct > 80 ? 'warn' : 'ok'}" style="width:${Math.min(100, r.pct).toFixed(1)}%"></i></div>
                </div>
              </div>`).join('') || '<div style="padding:14px 0;text-align:center;color:var(--muted-2);font-size:12px">暂无支出</div>'}
          </div>` : `
          <div style="padding:22px 0;text-align:center">
            <div style="color:var(--muted-2);font-size:12.5px;margin-bottom:12px">本月还没有设置预算</div>
            <button class="btn secondary sm" data-action="nav" data-view="budgets">去设置预算</button>
          </div>`}
      </div>
    </div>

    <div class="card">
      <div class="card-hd">
        <div><div class="card-title">待办往来</div><div class="card-sub">未结清款项</div></div>
        <button class="btn sm ghost" data-action="nav" data-view="debts">全部</button>
      </div>
      <div class="card-bd">
        ${openDebts.length ? `<div class="list">
          ${openDebts.map(({ d, info }) => `
            <div class="list-row">
              <div class="lr-main">
                <div class="lr-title">${esc(d.party)}</div>
                <div class="lr-sub">${DEBT_TYPE[d.type].label} · ${info.overdue ? `<span style="color:var(--danger)">已逾期</span>` : (d.dueDate ? `到期 ${d.dueDate}` : '未设到期日')}</div>
              </div>
              <div class="lr-val" style="color:${d.type === 'lend' ? 'var(--in)' : 'var(--out)'}">${fmt(info.remaining)}</div>
            </div>`).join('')}
        </div>` : emptyState({ ico: 'check', title: '暂无未结清款项', desc: '借出、借入和员工未报销都会显示在这里' })}
      </div>
    </div>
  </div>

  <div class="card">
    <div class="card-hd">
      <div><div class="card-title">最近流水</div><div class="card-sub">最新 ${recent.length} 笔</div></div>
      <button class="btn sm secondary" data-action="nav" data-view="transactions">全部流水</button>
    </div>
    <div class="card-bd flush">
      ${recent.length ? `<div class="table-wrap">
        <table class="tbl">
          <thead><tr><th style="width:96px">日期</th><th>分类</th><th>账户</th><th>摘要</th><th class="tr" style="width:130px">金额</th><th style="width:90px">经办人</th></tr></thead>
          <tbody>${recent.map(t => {
            const c = txCat(t), acc = accById(t.accountId);
            const sign = t.type === 'in' ? '+' : t.type === 'out' ? '-' : '';
            const cls = t.type === 'in' ? 'in' : t.type === 'out' ? 'out' : 'move';
            return `<tr>
              <td class="num nowrap" style="color:var(--muted)">${t.date}</td>
              <td>${catChip(c)}</td>
              <td class="nowrap" style="color:var(--ink-3)">${esc(txAccountLabel(t))}${t.noCash ? ' <span class="pill move">集团代付</span>' : ''}</td>
              <td style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted)">${esc(t.summary || t.counterparty || '—')}</td>
              <td class="tr cell-amount ${cls}">${sign}${fmtPlain(t.amount)}</td>
              <td style="color:var(--muted-2);font-size:12px">${esc(t.operator || '—')}</td>
            </tr>`;
          }).join('')}</tbody>
        </table>
      </div>` : emptyState({ ico: 'flow', title: '还没有流水', desc: '点击右上角「记一笔」开始记录公司资金往来' })}
    </div>
  </div>`;
}

function fmtDateCN(iso) {
  const d = new Date(iso + 'T00:00:00');
  const w = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 星期${w}`;
}

function onboarding() {
  return `<div class="card" style="max-width:760px;margin:36px auto">
    <div class="empty" style="padding:56px 32px">
      <div class="empty-ico" style="width:54px;height:54px;border-radius:16px">${icon('account', 24)}</div>
      <h4 style="font-size:16px">先建立公司的资金账户</h4>
      <p>添加库存现金和银行账户，填入截至某一天的期初余额，之后每一笔收支都会自动结出余额。</p>
      <div class="empty-actions">
        <button class="btn primary" data-action="new-acc">${icon('plus', 15)} 新建账户</button>
        <button class="btn secondary" data-action="seed">载入示例数据</button>
      </div>
    </div>
  </div>`;
}

/* ============================================================================
   资金流水
   ========================================================================== */

function filteredTx() {
  const f = UI.txFilter;
  const kw = (f.keyword || '').trim().toLowerCase();
  return sortedTx().filter(t => {
    if (f.from && t.date < f.from) return false;
    if (f.to && t.date > f.to) return false;
    if (f.type && t.type !== f.type) return false;
    if (f.category && t.categoryId !== f.category) return false;
    if (f.account) {
      if (f.account === '__cash' || f.account === '__bank') {
        const a = accById(t.accountId), b = accById(t.toAccountId);
        const types = [a && a.type, b && b.type];
        if (!types.includes(f.account === '__cash' ? 'cash' : 'bank')) return false;
      } else if (t.accountId !== f.account && t.toAccountId !== f.account) return false;
    }
    if (kw) {
      const a = accById(t.accountId), b = accById(t.toAccountId), c = txCat(t);
      const hay = [t.summary, c.name, t.counterparty, t.voucherNo, t.operator, a && a.name, b && b.name]
        .filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(kw)) return false;
    }
    return true;
  });
}

function viewTransactions() {
  if (DB.accounts.length === 0) return onboarding();
  const f = UI.txFilter;

  const accOptions = [
    `<option value="" ${!f.account ? 'selected' : ''}>全部账户</option>`,
    `<option value="__cash" ${f.account === '__cash' ? 'selected' : ''}>— 现金账户 —</option>`,
    `<option value="__bank" ${f.account === '__bank' ? 'selected' : ''}>— 银行账户 —</option>`,
    ...DB.accounts.map(a => `<option value="${a.id}" ${f.account === a.id ? 'selected' : ''}>${esc(a.name)}</option>`)
  ].join('');

  const catOptions = ['<option value="">全部分类</option>', ...DB.categories.map(c =>
    `<option value="${c.id}" ${f.category === c.id ? 'selected' : ''}>${c.kind === 'in' ? '收' : '支'} · ${esc(c.name)}</option>`
  )].join('');

  return `
  <div class="toolbar no-print">
    <div class="tb-filters">
    <label class="field"><label>开始日期</label><input type="date" data-filter="from" value="${f.from}"></label>
    <label class="field"><label>结束日期</label><input type="date" data-filter="to" value="${f.to}"></label>
    <label class="field"><label>账户</label><select data-filter="account">${accOptions}</select></label>
    <label class="field"><label>类型</label>
      <select data-filter="type">
        <option value="">全部类型</option>
        <option value="in" ${f.type === 'in' ? 'selected' : ''}>收入</option>
        <option value="out" ${f.type === 'out' ? 'selected' : ''}>支出</option>
        <option value="transfer" ${f.type === 'transfer' ? 'selected' : ''}>内部转账</option>
      </select>
    </label>
    <label class="field"><label>分类</label><select data-filter="category">${catOptions}</select></label>
    <label class="field grow"><label>关键字</label>
      <div class="search-field">${icon('search', 14)}<input type="search" data-filter="keyword" value="${esc(f.keyword)}" placeholder="摘要 / 往来单位 / 凭证号"></div>
    </label>
    </div>
    <div class="tb-actions">
      <button class="btn secondary" data-action="tx-reset">重置</button>
      <button class="btn secondary" data-action="import-tx">${icon('upload', 14)} 导入</button>
      <button class="btn secondary" data-action="tx-export">${icon('download', 14)} 导出</button>
    </div>
  </div>

  <div id="tx-area">${txAreaHTML()}</div>`;
}

function txAreaHTML() {
  const list = filteredTx();
  const inflow = round2(list.filter(t => t.type === 'in').reduce((s, t) => s + num(t.amount), 0));
  const outflow = round2(list.filter(t => t.type === 'out').reduce((s, t) => s + num(t.amount), 0));

  if (!list.length) {
    return `<div class="card">${emptyState({
      ico: 'flow',
      title: DB.transactions.length ? '没有符合条件的记录' : '还没有任何流水',
      desc: DB.transactions.length ? '试试放宽日期范围，或清空筛选条件。' : '点击「记一笔」录入第一笔收入或支出，余额会自动结出。',
      actions: DB.transactions.length
        ? '<button class="btn secondary" data-action="tx-reset">清空筛选</button>'
        : '<button class="btn primary" data-action="new-tx">记一笔</button>'
    })}</div>`;
  }

  const size = UI.txPageSize;
  const pages = Math.max(1, Math.ceil(list.length / size));
  const page = Math.min(Math.max(1, UI.txFilter.page), pages);
  const rows = list.slice((page - 1) * size, page * size);

  return `<div class="card">
    <div class="summary-strip" style="border-bottom:1px solid var(--line)">
      <div class="item"><span>筛选结果</span><strong>${list.length} 笔</strong></div>
      <div class="item"><span>收入合计</span><strong class="in">${fmt(inflow)}</strong></div>
      <div class="item"><span>支出合计</span><strong class="out">${fmt(outflow)}</strong></div>
      <div class="item"><span>净额</span><strong style="color:${inflow - outflow >= 0 ? 'var(--in)' : 'var(--out)'}">${fmt(inflow - outflow)}</strong></div>
    </div>
    <div class="table-wrap">
      <table class="tbl">
        <thead><tr>
          <th style="width:100px">日期</th><th style="width:150px">分类</th><th>账户</th>
          <th>摘要</th><th class="tr" style="width:130px">金额</th><th style="width:100px">经办人</th><th style="width:76px"></th>
        </tr></thead>
        <tbody>${rows.map(t => {
          const c = txCat(t), acc = accById(t.accountId), to = accById(t.toAccountId);
          const sign = t.type === 'in' ? '+' : t.type === 'out' ? '-' : '';
          const cls = t.type === 'in' ? 'in' : t.type === 'out' ? 'out' : 'move';
          return `<tr>
            <td class="num nowrap" style="color:var(--muted)">${t.date}</td>
            <td>${catChip(c)}</td>
            <td class="nowrap" style="color:var(--ink-3);font-size:12.5px">
              ${esc(txAccountLabel(t))}
              ${t.noCash ? '<span class="pill move">集团代付</span>' : ''}
            </td>
            <td style="max-width:300px">
              <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--ink-3)">${esc(t.summary || '—')}</div>
              ${t.counterparty ? `<div class="cell-sub">${esc(t.counterparty)}</div>` : ''}
            </td>
            <td class="tr cell-amount ${cls}">${sign}${fmtPlain(t.amount)}</td>
            <td style="color:var(--muted-2);font-size:12px">${esc(t.operator || '—')}</td>
            <td>
              <div class="row-actions">
                <button class="icon-btn" title="编辑" data-action="edit-tx" data-id="${t.id}">${icon('edit', 14)}</button>
                <button class="icon-btn danger" title="删除" data-action="del-tx" data-id="${t.id}">${icon('trash', 14)}</button>
              </div>
            </td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>
    ${pager(list.length, page, size, 'tx-page')}
  </div>`;
}

/* ============================================================================
   往来款
   ========================================================================== */

function viewDebts() {
  const tab = UI.debtTab;
  const types = ['lend', 'borrow', 'reimburse'];
  if (!UI.debtFilter) UI.debtFilter = { from: '', to: '', status: '', kw: '', page: 1 };
  const fs = UI.debtFilter;

  const all = DB.debts.filter(d => d.type === tab).map(d => ({ d, info: debtInfo(d) }))
    .sort((a, b) => {
      if (a.info.status === 'settled' && b.info.status !== 'settled') return 1;
      if (b.info.status === 'settled' && a.info.status !== 'settled') return -1;
      return (a.d.dueDate || '9999').localeCompare(b.d.dueDate || '9999');
    });
  const filtered = applyLedgerFilter(all, fs, r => ({
    date: r.d.date,
    status: r.info.status,
    overdue: r.info.overdue,
    text: `${r.d.party} ${r.d.note || ''}`
  }));
  const PAGE = 15;
  const page = Math.min(Math.max(1, fs.page || 1), Math.max(1, Math.ceil(filtered.length / PAGE)));
  const list = filtered.slice((page - 1) * PAGE, page * PAGE);

  const t = DEBT_TYPE[tab];
  const tot = debtTotals(tab);
  const lendAll = debtTotals('lend');
  const payAll = round2(debtTotals('borrow').remaining + debtTotals('reimburse').remaining);

  const tabsHTML = types.map(k => {
    const info = debtTotals(k);
    return `<button class="tab ${tab === k ? 'is-active' : ''}" data-action="debt-tab" data-tab="${k}">
      ${DEBT_TYPE[k].label}${info.count ? ` <span class="pill muted" style="height:18px;font-size:10px">${info.count}</span>` : ''}
    </button>`;
  }).join('');

  return `
  <div class="tabs">${tabsHTML}</div>

  ${filterBar('debt', [
    { k: 'from', t: 'date', label: '发生日期起' },
    { k: 'to', t: 'date', label: '发生日期止' },
    { k: 'status', t: 'select', label: '状态', opts: [['', '全部'], ['open', '未结清'], ['partial', '部分结清'], ['settled', '已结清']] },
    { k: 'kw', t: 'text', label: '对方 / 备注', ph: '输入关键字' }
  ], fs)}

  <div class="stat-grid mb-14" style="grid-template-columns:repeat(3,minmax(0,1fr))">
    <div class="stat is-clickable" data-action="f-quick" data-f="debt" data-k="status" data-v="open" title="只看未结清">
      <div class="stat-top"><span class="stat-label">${t.label} · 未结清</span><span class="stat-ico warn">${icon('debt', 15)}</span></div>
      <div class="stat-value sm">${fmt(tot.remaining)}</div>
      <div class="stat-foot">${tot.count} 笔 · 原始金额 ${fmtShort(tot.total)}</div>
    </div>
    <div class="stat is-clickable" data-action="f-quick" data-f="debt" data-k="overdue" data-v="1" title="只看逾期未结">
      <div class="stat-top"><span class="stat-label">逾期未结</span><span class="stat-ico in">${icon('alert', 15)}</span></div>
      <div class="stat-value sm" style="color:${tot.overdue > 0 ? 'var(--danger)' : ''}">${fmt(tot.overdue)}</div>
      <div class="stat-foot">超过约定结清日期的金额</div>
    </div>
    <div class="stat is-clickable" data-action="f-quick" data-f="debt" data-k="__all" data-v="1" title="清空筛选，显示全部">
      <div class="stat-top"><span class="stat-label">全部往来净额</span><span class="stat-ico">${icon('flow', 15)}</span></div>
      <div class="stat-value sm">${fmt(round2(lendAll.remaining - payAll))}</div>
      <div class="stat-foot">应收 − 应付</div>
    </div>
  </div>

  <div class="card">
    <div class="card-hd">
      <div><div class="card-title">${t.label}台账</div><div class="card-sub">${t.desc}</div></div>
      <div class="card-actions">
        <button class="btn primary sm" data-action="new-debt" data-type="${tab}">${icon('plus', 14)} 新增${t.label}</button>
      </div>
    </div>
    <div class="card-bd flush">
      ${list.length ? `<div class="table-wrap">
        <table class="tbl">
          <thead><tr>
            <th>对方</th><th class="tr" style="width:120px">金额</th><th class="tr" style="width:120px">已结</th>
            <th class="tr" style="width:120px">未结</th><th style="width:110px">发生日期</th><th style="width:120px">约定结清</th>
            <th style="width:100px">状态</th><th style="width:110px"></th>
          </tr></thead>
          <tbody>${list.map(({ d, info }) => `<tr>
            <td>
              <div class="cell-main">${esc(d.party)}</div>
              <div class="cell-sub">${esc(d.note || '—')}</div>
            </td>
            <td class="tr num">${fmtPlain(d.amount)}</td>
            <td class="tr num" style="color:var(--muted)">${info.settled ? fmtPlain(info.settled) : '—'}</td>
            <td class="tr cell-amount ${d.type === 'lend' ? 'in' : 'out'}">${info.remaining ? fmtPlain(info.remaining) : '—'}</td>
            <td class="num nowrap" style="color:var(--muted)">${d.date}</td>
            <td class="num nowrap" style="color:${info.overdue ? 'var(--danger)' : 'var(--muted)'}">${d.dueDate || '—'}</td>
            <td>${statusPill(info.status)}${info.overdue ? ' <span class="pill danger">逾期</span>' : ''}</td>
            <td>
              <div class="row-actions">
                ${info.remaining > 0 ? `<button class="btn sm secondary" data-action="settle-debt" data-id="${d.id}">${d.type === 'lend' ? '收款' : d.type === 'borrow' ? '还款' : '报销'}</button>` : ''}
                <button class="icon-btn" title="编辑" data-action="edit-debt" data-id="${d.id}">${icon('edit', 14)}</button>
                <button class="icon-btn danger" title="删除" data-action="del-debt" data-id="${d.id}">${icon('trash', 14)}</button>
              </div>
            </td>
          </tr>`).join('')}</tbody>
        </table>
      </div>` : emptyState({
        ico: 'debt',
        title: `还没有${t.label}记录`,
        desc: tab === 'lend' ? '公司借给其他单位或个人的款项，记在这里跟踪回收。'
          : tab === 'borrow' ? '公司向外部借入的款项，记在这里跟踪还款。'
          : '员工垫付但尚未报销的款项，记在这里，报销时自动生成支出。',
        actions: `<button class="btn primary" data-action="new-debt" data-type="${tab}">新增${t.label}</button>`
      })}
      ${filtered.length > PAGE ? pager(filtered.length, page, PAGE, 'debt-page') : ''}
    </div>
  </div>`;
}

/* ============================================================================
   预算
   ========================================================================== */

function viewBudgets() {
  const month = UI.budgetMonth || monthOf(todayISO());
  const rows = budgetRows(month);
  const sum = budgetSummary(month);
  const prevMonth = monthOf(addDays(month + '-01', -1));

  const monthOpts = (() => {
    const list = monthsBetween(addDays(todayISO(), -400).slice(0, 7) + '-01', addDays(todayISO(), 400).slice(0, 7) + '-01');
    return list.slice().reverse().map(m => `<option value="${m}" ${m === month ? 'selected' : ''}>${monthLabel(m)}</option>`).join('');
  })();

  const pct = sum.pct;
  const tone = pct > 100 ? 'var(--danger)' : pct > 80 ? 'var(--warn)' : 'var(--out)';

  return `
  <div class="toolbar no-print">
    <label class="field" style="min-width:150px"><label>预算月份</label><select data-budget-month>${monthOpts}</select></label>
    <div class="spacer"></div>
    <button class="btn secondary" data-action="budget-gen" data-month="${month}">${icon('chart', 14)} 自动生成</button>
    <button class="btn secondary" data-action="budget-copy" data-from="${prevMonth}">${icon('refresh', 14)} 复制上月预算</button>
    <button class="btn primary" data-action="budget-save">${icon('check', 15)} 保存预算</button>
  </div>

  <div class="grid g-main-side mb-14">
    <div class="card">
      <div class="card-hd">
        <div><div class="card-title">${monthLabel(month)} 预算执行</div><div class="card-sub">按支出分类设置月度预算，超支会自动预警</div>
          ${(() => {
            const vs = (COMPANY.budgetVersions || []).filter(x => x.month === month);
            if (!vs.length) return '';
            const last = vs[0];
            return '<div style="margin-top:6px;font-size:11.5px;color:var(--muted-2)">最近一次由「' + (BUDGET_METHODS[last.method] || last.method) + '」生成于 ' + fmtDateTime(last.at) + '，共 ' + last.count + ' 项</div>';
          })()}</div>
      </div>
      <div class="card-bd">
        <div style="display:flex;align-items:flex-end;gap:26px;margin-bottom:14px">
          <div>
            <div style="font-size:11.5px;color:var(--muted)">预算总额</div>
            <div style="font-size:24px;font-weight:650;letter-spacing:-.02em;font-variant-numeric:tabular-nums">${fmt(sum.budget)}</div>
          </div>
          <div>
            <div style="font-size:11.5px;color:var(--muted)">已使用</div>
            <div style="font-size:18px;font-weight:650;color:${tone};font-variant-numeric:tabular-nums">${fmt(sum.spent)}</div>
          </div>
          <div>
            <div style="font-size:11.5px;color:var(--muted)">剩余</div>
            <div style="font-size:18px;font-weight:650;font-variant-numeric:tabular-nums">${fmt(sum.remaining)}</div>
          </div>
        </div>
        <div class="progress lg"><i class="${pct > 100 ? 'over' : pct > 80 ? 'warn' : 'ok'}" style="width:${Math.min(100, pct).toFixed(1)}%"></i></div>
        <div style="display:flex;justify-content:space-between;margin-top:7px;font-size:11.5px;color:var(--muted-2)">
          <span>使用率 ${pct.toFixed(1)}%</span>
          <span>${sum.budget > 0 ? (pct > 100 ? '已超支 ' + fmt(sum.spent - sum.budget) : '剩余 ' + fmt(sum.remaining)) : '尚未设置预算'}</span>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-hd"><div><div class="card-title">预算提示</div><div class="card-sub">按使用率排序</div></div></div>
      <div class="card-bd">
        ${sum.rows.length ? `<div class="list">
          ${sum.rows.filter(r => r.spent > 0).sort((a, b) => b.pct - a.pct).slice(0, 5).map(r => `
            <div class="list-row">
              <div class="lr-main">
                <div class="lr-title" style="display:flex;justify-content:space-between">
                  <span>${esc(r.cat.name)}</span>
                  <span style="color:${r.pct > 100 ? 'var(--danger)' : r.pct > 80 ? 'var(--warn)' : 'var(--muted)'};font-weight:600">${r.pct.toFixed(0)}%</span>
                </div>
                <div class="lr-sub">已用 ${fmtShort(r.spent)} / ${fmtShort(r.budget)}</div>
              </div>
            </div>`).join('')}
        </div>` : `<div style="padding:26px 0;text-align:center;color:var(--muted-2);font-size:12.5px">设置预算后这里会显示使用进度</div>`}
      </div>
    </div>
  </div>

  <div class="card">
    <div class="card-hd">
      <div><div class="card-title">分类预算</div><div class="card-sub">填写每月上限，留空表示不限制</div></div>
      <div class="card-actions">
        <button class="btn ghost sm" data-action="budget-toggle">
          ${UI.budgetShowAll ? '只看已设预算' : `显示全部 ${rows.length} 个分类`}
        </button>
      </div>
    </div>
    <div class="card-bd">
      <div class="budget-row" style="border-bottom:1px solid var(--line-2);padding-bottom:9px">
        <div style="font-size:11.5px;color:var(--muted-2);font-weight:600">分类</div>
        <div style="font-size:11.5px;color:var(--muted-2);font-weight:600">执行进度</div>
        <div class="b-num" style="font-size:11.5px;color:var(--muted-2);font-weight:600">已用 / 预算</div>
        <div class="b-num" style="font-size:11.5px;color:var(--muted-2);font-weight:600">剩余</div>
        <div style="font-size:11.5px;color:var(--muted-2);font-weight:600;text-align:right">预算金额</div>
      </div>
      ${(UI.budgetShowAll ? rows : rows.filter(r => r.budget > 0 || r.spent > 0)).map(r => {
        const tone2 = r.pct > 100 ? 'over' : r.pct > 80 ? 'warn' : 'ok';
        return `<div class="budget-row">
          <div class="b-cat">
            <span class="cat-ico" style="--c:${r.cat.color}">${icon(r.cat.icon, 13)}</span>
            <span>${esc(r.cat.name)}</span>
          </div>
          <div class="b-bar">
            <div class="progress"><i class="${tone2}" style="width:${Math.min(100, r.pct).toFixed(1)}%"></i></div>
          </div>
          <div class="b-num">${fmtShort(r.spent)} / ${r.budget ? fmtShort(r.budget) : '—'}</div>
          <div class="b-num" style="color:${r.budget && r.remaining < 0 ? 'var(--danger)' : 'var(--muted)'}">${r.budget ? fmtShort(r.remaining) : '—'}</div>
          <div class="b-input">
            <input type="number" min="0" step="0.01" data-budget-cat="${r.cat.id}" value="${r.budget || ''}" placeholder="0.00">
          </div>
        </div>`;
      }).join('')}
    </div>
  </div>`;
}

/* ============================================================================
   报表
   ========================================================================== */

function viewReports() {
  const tab = UI.reportTab;
  const tabs = [
    ['cashflow', '现金流量表'],
    ['fundstmt', '资金对账单'],
    ['statement', '月末对账单'],
    ['summary', '统计汇总']
  ].map(([k, l]) => `<button class="tab ${tab === k ? 'is-active' : ''}" data-action="report-tab" data-tab="${k}">${l}</button>`).join('');

  let body = '';
  if (tab === 'cashflow') body = reportCashflow();
  if (tab === 'fundstmt') body = reportFundStatement();
  if (tab === 'statement') body = reportStatement();
  if (tab === 'summary') body = reportSummary();

  return `<div class="tabs no-print">${tabs}</div>${body}`;
}

/* 资金对账单（REQ-20）
   总账面金额 = 现金 + 银行 + 票据未回金额 + 借款（借入未还 + 员工未报销） + 借支备用金未核销
   注意：借支发放时已生成支出流水、现金/银行里已经扣过，所以本表是「资金构成」而不是相加可花的钱。 */
function reportFundStatement() {
  const today = todayISO();
  const cash = round2(DB.accounts.filter(a => a.type === 'cash').reduce((s, a) => s + balanceOf(a), 0));
  const bank = round2(totalBalance() - cash);

  const invs = ensureInvoiceList(COMPANY).filter(i => i.status !== 'done');
  const invAmt = round2(invs.reduce((s, i) => s + Math.max(0, num(i.amount) - num(i.receivedAmount)), 0));

  const borrow = round2(debtTotals('borrow').remaining + debtTotals('reimburse').remaining);
  const borrowCnt = debtTotals('borrow').count + debtTotals('reimburse').count;

  const advs = ensureAdvanceList(COMPANY).filter(a => advanceInfo(a).status === 'issued');
  const advAmt = round2(advs.reduce((s, a) => s + advanceInfo(a).remain, 0));

  const total = round2(cash + bank + invAmt + borrow + advAmt);

  const row = (label, sub, amt, tone, action) => `<tr>
    <td>
      <div class="cell-main">${label}</div>
      <div class="cell-sub">${sub}</div>
    </td>
    <td class="tr cell-amount ${tone || ''}">${fmtPlain(amt)}</td>
    <td class="nowrap" style="width:120px">${action ? `<button class="btn sm secondary" ${action}>查看明细</button>` : ''}</td>
  </tr>`;

  return `
  <div class="toolbar no-print">
    <div style="font-size:12.5px;color:var(--muted-2)">截至 ${today} · ${esc(COMPANY.name)} · 单位：${CUR().name}</div>
    <div class="spacer"></div>
    <button class="btn secondary" data-action="fundstmt-export">${icon('download', 14)} 导出 CSV</button>
    <button class="btn secondary" data-action="print">${icon('printer', 14)} 打印</button>
  </div>

  <div class="card mb-14">
    <div class="card-hd">
      <div><div class="card-title">资金对账单</div>
        <div class="card-sub">总账面金额 = 现金 + 银行 + 票据未回 + 借款 + 借支备用金</div></div>
    </div>
    <div class="card-bd">
      <div class="summary-strip" style="border:none;padding:0">
        <div class="item"><span>总账面金额</span><strong style="font-size:19px">${fmt(total)}</strong></div>
      </div>
    </div>
    <div class="table-wrap">
      <table class="tbl">
        <thead><tr><th>构成项</th><th class="tr" style="width:170px">金额</th><th style="width:120px"></th></tr></thead>
        <tbody>
          ${row('库存现金', `${DB.accounts.filter(a => a.type === 'cash').length} 个现金账户`, cash, '', 'data-action="acc-filter-go" data-type="cash"')}
          ${row('银行存款', `${DB.accounts.filter(a => a.type === 'bank').length} 个银行账户`, bank, '', 'data-action="acc-filter-go" data-type="bank"')}
          ${row('票据未回', `${invs.length} 张未回 / 部分回`, invAmt, '', 'data-action="fundstmt-go" data-to="invoices" data-status="none"')}
          ${row('借款（借入未还 + 员工未报销）', `${borrowCnt} 笔未结清`, borrow, '', 'data-action="fundstmt-go" data-to="debts" data-tab="borrow"')}
          ${row('借支备用金（未核销）', `${advs.length} 笔已发放未核销`, advAmt, '', 'data-action="fundstmt-go" data-to="advances" data-status="issued"')}
        </tbody>
        <tfoot><tr>
          <td>总账面金额</td>
          <td class="tr num">${fmtPlain(total)}</td>
          <td></td>
        </tr></tfoot>
      </table>
    </div>
  </div>

  <div class="alert info">
    ${icon('info', 15)}
    <div>「现金 + 银行」是账上真实可动用的钱；票据未回、借款、借支备用金属于往来占用，<b>不是可花余额</b>，四项相加只用于反映资金全貌。</div>
  </div>`;
}

function cfRange() {
  if (!UI.cfRange.from || !UI.cfRange.to) {
    const t = todayISO();
    UI.cfRange = { from: `${t.slice(0, 4)}-01-01`, to: t };
  }
  return UI.cfRange;
}

function reportCashflow() {
  const { from, to } = cfRange();
  const cf = cashFlow(from, to);
  const presets = [['month', '本月'], ['last', '上月'], ['quarter', '本季'], ['year', '本年']]
    .map(([k, l]) => `<button class="seg-btn ${UI.cfPreset === k ? 'is-active' : ''}" data-action="cf-preset" data-preset="${k}">${l}</button>`).join('');
  const rowHTML = r => `<tr>
    <td class="cf-label cf-indent">${esc(r.label)}</td>
    <td class="tr num" style="color:${r.amount ? (r.dir === 'in' ? 'var(--in)' : 'var(--out)') : 'var(--muted-2)'}">${r.amount ? fmtPlain(r.amount) : '—'}</td>
  </tr>`;

  const section = (act, title) => {
    const items = cf.rows.filter(r => r.act === act);
    const ins = items.filter(r => r.dir === 'in');
    const outs = items.filter(r => r.dir === 'out');
    return `<tr class="cf-section"><td>${title}</td><td></td></tr>
      ${ins.map(rowHTML).join('')}
      <tr class="cf-total"><td class="cf-label cf-indent">现金流入小计</td><td class="tr num" style="color:var(--in)">${fmtPlain(cf.act[act].in)}</td></tr>
      ${outs.map(rowHTML).join('')}
      <tr class="cf-total"><td class="cf-label cf-indent">现金流出小计</td><td class="tr num" style="color:var(--out)">${fmtPlain(cf.act[act].out)}</td></tr>
      <tr class="cf-net"><td class="cf-label">${title.replace('产生的现金流量', '产生的现金流量净额')}</td><td class="tr num">${fmtPlain(cf.act[act].net)}</td></tr>`;
  };

  return `
  <div class="toolbar no-print">
    <div class="seg">${presets}</div>
    <label class="field" style="min-width:140px"><label>开始</label><input type="date" data-cf="from" value="${from}"></label>
    <label class="field" style="min-width:140px"><label>结束</label><input type="date" data-cf="to" value="${to}"></label>
    <div class="spacer"></div>
    <button class="btn secondary" data-action="cf-export">${icon('download', 14)} 导出 CSV</button>
    <button class="btn secondary" data-action="print">${icon('printer', 14)} 打印</button>
  </div>

  <div class="card">
    <div class="card-hd">
      <div>
        <div class="card-title">现金流量表（直接法）</div>
        <div class="card-sub">${esc(COMPANY.name)} · ${from} 至 ${to} · 单位：${CUR().name}</div>
      </div>
      <div class="card-actions no-print">
        <div class="legend"><span><i style="background:#f87171"></i>流入</span><span><i style="background:#34d399"></i>流出</span></div>
      </div>
    </div>
    <div class="card-bd flush">
      <div class="table-wrap">
        <table class="tbl cf-table">
          <thead><tr><th>项目</th><th class="tr" style="width:180px">本期金额</th></tr></thead>
          <tbody>
            ${section('op', '一、经营活动产生的现金流量')}
            ${section('inv', '二、投资活动产生的现金流量')}
            ${section('fin', '三、筹资活动产生的现金流量')}
            <tr class="cf-section"><td>四、现金及现金等价物净增加额</td><td class="tr num">${fmtPlain(cf.netTotal)}</td></tr>
            <tr><td class="cf-label cf-indent">加：期初现金及现金等价物余额</td><td class="tr num">${fmtPlain(cf.beginCash)}</td></tr>
            <tr class="cf-net"><td class="cf-label">五、期末现金及现金等价物余额</td><td class="tr num">${fmtPlain(cf.endCash)}</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>

  <div class="card mt-14">
    <div class="card-hd"><div><div class="card-title">构成明细</div><div class="card-sub">按分类归集到现金流量项目</div></div></div>
    <div class="card-bd">
      <div class="grid g-3">
        ${['op', 'inv', 'fin'].map(act => {
          const items = cf.rows.filter(r => r.act === act && r.amount > 0);
          return `<div>
            <div style="font-size:12px;font-weight:650;margin-bottom:10px;color:var(--ink-3)">${ACT_LABEL[act]}</div>
            ${items.length ? items.map(r => `<div class="list-row" style="padding:7px 0">
              <div class="lr-main">
                <div class="lr-title" style="font-size:12px;color:var(--muted)">${esc(r.label)}</div>
                <div class="lr-sub">${r.detail.map(d => esc(d.name)).join('、')}</div>
              </div>
              <div class="lr-val" style="color:${r.dir === 'in' ? 'var(--in)' : 'var(--out)'}">${fmtShort(r.amount)}</div>
            </div>`).join('') : `<div style="font-size:12px;color:var(--muted-2);padding:8px 0">本期无发生额</div>`}
          </div>`;
        }).join('')}
      </div>
    </div>
  </div>`;
}

function stmtState() {
  if (!UI.stmt.account) UI.stmt.account = (DB.accounts[0] || {}).id || '';
  if (!UI.stmt.month) UI.stmt.month = monthOf(todayISO());
  return UI.stmt;
}

function reportStatement() {
  const st = stmtState();
  const acc = accById(st.account);
  const month = st.month;
  const from = month + '-01';
  const to = lastDayOfMonth(month);
  const accOpts = DB.accounts.map(a => `<option value="${a.id}" ${a.id === st.account ? 'selected' : ''}>${esc(a.name)}</option>`).join('');
  const monthOpts = monthsBetween(addDays(todayISO(), -600).slice(0, 7) + '-01', addDays(todayISO(), 400).slice(0, 7) + '-01')
    .reverse().map(m => `<option value="${m}" ${m === month ? 'selected' : ''}>${monthLabel(m)}</option>`).join('');

  if (!acc) {
    return `<div class="card">${emptyState({ ico: 'account', title: '还没有账户', desc: '先创建账户后才能生成对账单', actions: '<button class="btn primary" data-action="new-acc">新建账户</button>' })}</div>`;
  }

  const opening = balanceOf(acc, addDays(from, -1));
  const list = DB.transactions
    .filter(t => t.date >= from && t.date <= to && (t.accountId === acc.id || t.toAccountId === acc.id))
    .sort((a, b) => a.date === b.date ? String(a.createdAt).localeCompare(String(b.createdAt)) : a.date.localeCompare(b.date));

  let running = opening, inSum = 0, outSum = 0;
  const rows = list.map(t => {
    let inflow = 0, outflow = 0, desc = '', party = '';
    const c = txCat(t);
    if (t.type === 'in' && t.accountId === acc.id) { inflow = num(t.amount); desc = t.summary || c.name; party = t.counterparty || ''; }
    else if (t.type === 'out' && t.accountId === acc.id) { outflow = num(t.amount); desc = t.summary || c.name; party = t.counterparty || ''; }
    else if (t.type === 'transfer' && t.accountId === acc.id) {
      if (t.direction === 'in') { inflow = num(t.amount); desc = '公司间转入'; party = (coById(t.peerCompanyId) || {}).name || '集团内'; }
      else if (t.peerCompanyId) { outflow = num(t.amount); desc = '转至 ' + ((coById(t.peerCompanyId) || {}).name || ''); party = '集团内'; }
      else { outflow = num(t.amount); desc = '内部转账至 ' + ((accById(t.toAccountId) || {}).name || ''); party = '内部'; }
    }
    else if (t.type === 'transfer' && t.toAccountId === acc.id) { inflow = num(t.amount); desc = '内部转账自 ' + ((accById(t.accountId) || {}).name || ''); party = '内部'; }
    inSum += inflow; outSum += outflow; running = round2(running + inflow - outflow);
    return { t, c, inflow, outflow, desc, party, running };
  });

  return `
  <div class="toolbar no-print">
    <label class="field" style="min-width:180px"><label>账户</label><select data-stmt="account">${accOpts}</select></label>
    <label class="field" style="min-width:150px"><label>月份</label><select data-stmt="month">${monthOpts}</select></label>
    <div class="spacer"></div>
    <button class="btn secondary" data-action="stmt-export">${icon('download', 14)} 导出 CSV</button>
    <button class="btn secondary" data-action="print">${icon('printer', 14)} 打印对账单</button>
  </div>

  <div class="card">
    <div class="statement">
      <div class="statement-head">
        <div>
          <h3>月末对账单</h3>
          <div class="co">${esc(COMPANY.name)} · ${acc.type === 'cash' ? '库存现金' : esc(acc.bankName || '银行存款')}${acc.accountNo ? ' · ' + esc(acc.accountNo) : ''}</div>
        </div>
        <div style="text-align:right;font-size:12px;color:var(--muted)">
          <div>账户：<b style="color:var(--ink)">${esc(acc.name)}</b></div>
          <div style="margin-top:4px">期间：${from} 至 ${to}</div>
          <div style="margin-top:4px">制表：${esc(SESSION.displayName)} · ${todayISO()}</div>
        </div>
      </div>

      <div class="statement-meta">
        <span>期初余额 <b class="num">${fmt(opening)}</b></span>
        <span>本期收入 <b class="num" style="color:var(--in)">${fmt(inSum)}</b></span>
        <span>本期支出 <b class="num" style="color:var(--out)">${fmt(outSum)}</b></span>
        <span>期末余额 <b class="num">${fmt(running)}</b></span>
        <span>共 ${rows.length} 笔</span>
      </div>

      <div class="table-wrap">
        <table class="tbl">
          <thead><tr>
            <th style="width:92px">日期</th><th style="width:130px">分类</th><th>摘要</th><th style="width:150px">对方</th>
            <th class="tr" style="width:110px">收入</th><th class="tr" style="width:110px">支出</th><th class="tr" style="width:120px">余额</th>
          </tr></thead>
          <tbody>
            <tr style="background:var(--surface-2)">
              <td class="num">${from}</td><td></td>
              <td style="color:var(--muted)">期初余额</td><td></td><td></td><td></td>
              <td class="tr cell-amount">${fmtPlain(opening)}</td>
            </tr>
            ${rows.map(r => `<tr>
              <td class="num nowrap" style="color:var(--muted)">${r.t.date}</td>
              <td style="font-size:12px;color:var(--ink-3)">${esc(r.c.name)}</td>
              <td style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.desc || '—')}</td>
              <td style="color:var(--muted-2);font-size:12px">${esc(r.party || '—')}</td>
              <td class="tr num" style="color:var(--in)">${r.inflow ? fmtPlain(r.inflow) : ''}</td>
              <td class="tr num" style="color:var(--out)">${r.outflow ? fmtPlain(r.outflow) : ''}</td>
              <td class="tr cell-amount">${fmtPlain(r.running)}</td>
            </tr>`).join('')}
            ${rows.length === 0 ? `<tr><td colspan="7" style="text-align:center;color:var(--muted-2);padding:26px">本期无交易</td></tr>` : ''}
          </tbody>
          <tfoot><tr>
            <td colspan="4">本期合计</td>
            <td class="tr num" style="color:var(--in)">${fmtPlain(inSum)}</td>
            <td class="tr num" style="color:var(--out)">${fmtPlain(outSum)}</td>
            <td class="tr num">${fmtPlain(running)}</td>
          </tr></tfoot>
        </table>
      </div>

      <div class="sign-row">
        <span>制表人：______________</span>
        <span>复核人：______________</span>
        <span>财务负责人：______________</span>
        <span>日期：______________</span>
      </div>
    </div>
  </div>`;
}

function reportSummary() {
  const t = todayISO();
  if (!UI.reportRange.from || !UI.reportRange.to) UI.reportRange = { from: `${t.slice(0, 4)}-01-01`, to: t };
  const { from, to } = UI.reportRange;
  const st = rangeStats(from, to);
  const opening = totalBalance(addDays(from, -1));
  /* 期末余额走统一取数：opening+in-out 会漏掉跨公司转账（type='transfer' 不计入 inflow/outflow） */
  const closing = totalBalance(to);

  const months = monthsBetween(from, to).slice(-24);
  const mRows = months.map(k => {
    const start = k + '-01';
    const end = lastDayOfMonth(k) > to ? to : lastDayOfMonth(k);
    const s = rangeStats(start, end);
    const op = totalBalance(addDays(start, -1));
    return { k, op, ...s, close: round2(op + s.inflow - s.outflow) };
  });

  const catIn = new Map(), catOut = new Map();
  DB.transactions.forEach(x => {
    if (x.date < from || x.date > to) return;
    const c = txCat(x);
    if (x.type === 'in') catIn.set(c.name, (catIn.get(c.name) || 0) + num(x.amount));
    if (x.type === 'out') catOut.set(c.name, (catOut.get(c.name) || 0) + num(x.amount));
  });
  const inRows = [...catIn.entries()].sort((a, b) => b[1] - a[1]);
  const outRows = [...catOut.entries()].sort((a, b) => b[1] - a[1]);
  const inTotal = inRows.reduce((s, r) => s + r[1], 0);
  const outTotal = outRows.reduce((s, r) => s + r[1], 0);

  return `
  <div class="toolbar no-print">
    <label class="field" style="min-width:140px"><label>开始</label><input type="date" data-report="from" value="${from}"></label>
    <label class="field" style="min-width:140px"><label>结束</label><input type="date" data-report="to" value="${to}"></label>
    <div class="spacer"></div>
    <button class="btn secondary" data-action="summary-export">${icon('download', 14)} 导出 CSV</button>
    <button class="btn secondary" data-action="print">${icon('printer', 14)} 打印</button>
  </div>

  <div class="card mb-14">
    <div class="summary-strip">
      <div class="item"><span>期初余额</span><strong>${fmt(opening)}</strong></div>
      <div class="item"><span>本期流入</span><strong class="in">+${fmt(st.inflow)}</strong></div>
      <div class="item"><span>本期流出</span><strong class="out">-${fmt(st.outflow)}</strong></div>
      <div class="item"><span>净流入</span><strong style="color:${st.net >= 0 ? 'var(--in)' : 'var(--out)'}">${st.net > 0 ? '+' : ''}${fmt(st.net)}</strong></div>
      <div class="item"><span>期末余额</span><strong>${fmt(closing)}</strong></div>
      <div class="item"><span>业务笔数</span><strong>${st.count}</strong></div>
    </div>
  </div>

  <div class="grid g-2 mb-14">
    <div class="card">
      <div class="card-hd"><div><div class="card-title">收入构成</div><div class="card-sub">合计 ${fmt(inTotal)}</div></div></div>
      <div class="table-wrap">
        <table class="tbl">
          <thead><tr><th>分类</th><th class="tr">金额</th><th class="tr" style="width:70px">占比</th></tr></thead>
          <tbody>${inRows.length ? inRows.map(([k, v]) => `<tr>
            <td>${esc(k)}</td><td class="tr num" style="color:var(--in)">${fmtPlain(v)}</td>
            <td class="tr num" style="color:var(--muted)">${inTotal ? ((v / inTotal) * 100).toFixed(1) : 0}%</td>
          </tr>`).join('') : '<tr><td colspan="3" style="text-align:center;color:var(--muted-2);padding:22px">暂无收入</td></tr>'}</tbody>
        </table>
      </div>
    </div>
    <div class="card">
      <div class="card-hd"><div><div class="card-title">支出构成</div><div class="card-sub">合计 ${fmt(outTotal)}</div></div></div>
      <div class="table-wrap">
        <table class="tbl">
          <thead><tr><th>分类</th><th class="tr">金额</th><th class="tr" style="width:70px">占比</th></tr></thead>
          <tbody>${outRows.length ? outRows.map(([k, v]) => `<tr>
            <td>${esc(k)}</td><td class="tr num" style="color:var(--out)">${fmtPlain(v)}</td>
            <td class="tr num" style="color:var(--muted)">${outTotal ? ((v / outTotal) * 100).toFixed(1) : 0}%</td>
          </tr>`).join('') : '<tr><td colspan="3" style="text-align:center;color:var(--muted-2);padding:22px">暂无支出</td></tr>'}</tbody>
        </table>
      </div>
    </div>
  </div>

  <div class="card">
    <div class="card-hd"><div><div class="card-title">按月汇总</div><div class="card-sub">期初 / 流入 / 流出 / 期末</div></div></div>
    <div class="table-wrap">
      <table class="tbl">
        <thead><tr><th>月份</th><th class="tr">期初余额</th><th class="tr">流入</th><th class="tr">流出</th><th class="tr">净额</th><th class="tr">期末余额</th></tr></thead>
        <tbody>${mRows.map(r => `<tr>
          <td class="nowrap">${monthLabel(r.k)}</td>
          <td class="tr num">${fmtPlain(r.op)}</td>
          <td class="tr num" style="color:var(--in)">${r.inflow ? fmtPlain(r.inflow) : '—'}</td>
          <td class="tr num" style="color:var(--out)">${r.outflow ? fmtPlain(r.outflow) : '—'}</td>
          <td class="tr num" style="color:${r.net >= 0 ? 'var(--in)' : 'var(--out)'}">${r.net ? (r.net > 0 ? '+' : '') + fmtPlain(r.net) : '—'}</td>
          <td class="tr cell-amount">${fmtPlain(r.close)}</td>
        </tr>`).join('')}</tbody>
      </table>
    </div>
  </div>`;
}

/* ============================================================================
   账户
   ========================================================================== */

function viewAccounts() {
  if (DB.accounts.length === 0) return onboarding();
  const today = todayISO();
  const yearStart = `${today.slice(0, 4)}-01-01`;
  const cashTotal = round2(DB.accounts.filter(a => a.type === 'cash').reduce((s, a) => s + balanceOf(a), 0));
  const bankTotal = round2(totalBalance() - cashTotal);
  /* 卡片点击按类型过滤列表（REQ-19） */
  const typeFilter = UI.accType || '';
  const shown = typeFilter ? DB.accounts.filter(a => a.type === typeFilter) : DB.accounts;

  return `
  <div class="stat-grid mb-14" style="grid-template-columns:repeat(3,minmax(0,1fr))">
    <div class="stat hero is-clickable" data-action="acc-filter" data-type="" title="显示全部账户">
      <div class="stat-top"><span class="stat-label">资金总额</span><span class="stat-ico">${icon('wallet', 15)}</span></div>
      <div class="stat-value" data-count="${totalBalance()}">${fmt(totalBalance())}</div>
      <div class="stat-foot">${DB.accounts.length} 个账户${typeFilter ? ' · 点击显示全部' : ''}</div>
    </div>
    <div class="stat is-clickable" data-action="acc-filter" data-type="cash" title="只看现金账户">
      <div class="stat-top"><span class="stat-label">库存现金</span><span class="stat-ico warn">${icon('wallet', 15)}</span></div>
      <div class="stat-value sm" data-count="${cashTotal}">${fmt(cashTotal)}</div>
      <div class="stat-foot">${DB.accounts.filter(a => a.type === 'cash').length} 个现金账户</div>
    </div>
    <div class="stat is-clickable" data-action="acc-filter" data-type="bank" title="只看银行账户">
      <div class="stat-top"><span class="stat-label">银行存款</span><span class="stat-ico">${icon('bank', 15)}</span></div>
      <div class="stat-value sm" data-count="${bankTotal}">${fmt(bankTotal)}</div>
      <div class="stat-foot">${DB.accounts.filter(a => a.type === 'bank').length} 个银行账户</div>
    </div>
  </div>

  <div class="card">
    <div class="card-hd">
      <div><div class="card-title">账户列表</div><div class="card-sub">期初余额 + 收入 − 支出 ± 内部转账 = 当前余额</div></div>
      <div class="card-actions"><button class="btn primary sm" data-action="new-acc">${icon('plus', 14)} 新增账户</button></div>
    </div>
    <div class="table-wrap">
      <table class="tbl">
        <thead><tr>
          <th>账户</th><th style="width:76px">类型</th><th>开户行 / 账号</th>
          <th class="tr" style="width:120px">期初余额</th>
          <th class="tr" style="width:110px">本年流入</th>
          <th class="tr" style="width:110px">本年流出</th>
          <th class="tr" style="width:130px">当前余额</th>
          <th style="width:110px"></th>
        </tr></thead>
        <tbody>${shown.map(a => {
          const s = accountStats(a, yearStart, today);
          const hasTx = DB.transactions.some(t => t.accountId === a.id || t.toAccountId === a.id);
          return `<tr>
            <td>
              <div style="display:flex;align-items:center;gap:9px">
                <span class="acct-ico ${a.type === 'cash' ? 'cash' : ''}" style="width:28px;height:28px;border-radius:8px">${icon(a.type === 'cash' ? 'wallet' : 'bank', 14)}</span>
                <div>
                  <div class="cell-main">${esc(a.name)}${a.active === false ? ' <span class="pill muted">已停用</span>' : ''}</div>
                  <div class="cell-sub">期初日期 ${a.openingDate || '—'}</div>
                </div>
              </div>
            </td>
            <td><span class="pill ${a.type === 'cash' ? 'warn' : 'info'}">${a.type === 'cash' ? '现金' : '银行'}</span>
              ${accCurrency(a) !== baseCurrency() ? `<span class="pill muted">${accCurrency(a)}</span>` : ''}</td>
            <td>
              <div style="font-size:12.5px;color:var(--ink-3)">${esc(a.bankName || '—')}</div>
              <div class="cell-sub mono">${esc(a.accountNo || '')}</div>
            </td>
            <td class="tr num" style="color:var(--muted)">${fmtPlain(a.openingBalance)}</td>
            <td class="tr num" style="color:var(--in)">${s.inflow ? '+' + fmtPlain(s.inflow) : '—'}</td>
            <td class="tr num" style="color:var(--out)">${s.outflow ? '-' + fmtPlain(s.outflow) : '—'}</td>
            <td class="tr cell-amount" data-action="acc-detail" data-id="${a.id}" title="点击查看该账户流水" style="cursor:pointer">
              ${fmtCur(balanceOf(a), accCurrency(a))}
              ${accCurrency(a) !== baseCurrency() ? `<div class="cell-sub">≈ ${fmt(toBase(balanceOf(a), accCurrency(a)) ?? 0)}</div>` : ''}
            </td>
            <td>
              <div class="row-actions">
                <button class="btn sm secondary" data-action="acc-detail" data-id="${a.id}" title="查看该账户流水">明细</button>
                <button class="icon-btn" title="对账调整" data-action="reconcile" data-id="${a.id}">${icon('sliders', 14)}</button>
                <button class="icon-btn" title="编辑" data-action="edit-acc" data-id="${a.id}">${icon('edit', 14)}</button>
                <button class="icon-btn danger" title="${hasTx ? '该账户已有流水，不能删除' : '删除'}" data-action="del-acc" data-id="${a.id}" ${hasTx ? 'disabled' : ''}>${icon('trash', 14)}</button>
              </div>
            </td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>
  </div>

  <div class="alert info mt-14">
    ${icon('info', 15)}
    <div>「对账调整」用于账面余额与银行实际余额不一致时生成一笔调整流水（分类记为「余额调整」），不影响经营收支统计口径。</div>
  </div>`;
}

/* ============================================================================
   分类管理
   ========================================================================== */

function viewCategories() {
  const groups = [
    { kind: 'out', label: '支出分类', desc: '用于付款、费用报销等资金流出' },
    { kind: 'in', label: '收入分类', desc: '用于收款、回款等资金流入' }
  ];

  const usage = new Map();
  DB.transactions.forEach(t => { if (t.categoryId) usage.set(t.categoryId, (usage.get(t.categoryId) || 0) + 1); });

  return `
  <div class="grid g-2">
    ${groups.map(g => {
      const list = DB.categories.filter(c => c.kind === g.kind)
        .sort((a, b) => (a.active === b.active ? 0 : a.active ? -1 : 1) || a.name.localeCompare(b.name, 'zh'));
      return `<div class="card">
        <div class="card-hd">
          <div><div class="card-title">${g.label}</div><div class="card-sub">${g.desc}</div></div>
          <div class="card-actions"><button class="btn secondary sm" data-action="new-cat" data-kind="${g.kind}">${icon('plus', 13)} 新建</button></div>
        </div>
        <div class="card-bd flush">
          <div class="table-wrap">
            <table class="tbl">
              <thead><tr><th>分类</th><th style="width:196px">现金流量项目</th><th class="tr" style="width:70px">笔数</th><th style="width:70px"></th></tr></thead>
              <tbody>${list.map(c => `<tr style="${c.active === false ? 'opacity:.5' : ''}">
                <td>
                  <div style="display:flex;align-items:center;gap:9px">
                    <span class="cat-ico" style="--c:${c.color}">${icon(c.icon, 13)}</span>
                    <div>
                      <div class="cell-main">${esc(c.name)}</div>
                      <div class="cell-sub">${c.active === false ? '已停用' : (c.system ? '系统预置' : '自定义')}</div>
                    </div>
                  </div>
                </td>
                <td style="font-size:11.5px;line-height:1.45;color:var(--muted)">${esc((CF_MAP.get(c.cf) || { label: '不计入现金流量' }).label)}</td>
                <td class="tr num" style="color:var(--muted-2)">${usage.get(c.id) || 0}</td>
                <td>
                  <div class="row-actions">
                    <button class="icon-btn" title="编辑" data-action="edit-cat" data-id="${c.id}">${icon('edit', 14)}</button>
                    <button class="icon-btn danger" title="删除" data-action="del-cat" data-id="${c.id}">${icon('trash', 14)}</button>
                  </div>
                </td>
              </tr>`).join('')}</tbody>
            </table>
          </div>
        </div>
      </div>`;
    }).join('')}
  </div>

  <div class="alert info mt-14">
    ${icon('info', 15)}
    <div>分类决定现金流量表的归集口径：每个分类都映射到一个现金流量项目，调整后报表会自动重算。已被流水使用的分类不能删除，只能停用。</div>
  </div>`;
}

/* ============================================================================
   用户
   ========================================================================== */

function viewUsers() {
  const rows = DB.users.map(u => {
    const txCount = DB.transactions.filter(t => t.userId === u.id).length;
    return `<tr>
      <td>
        <div class="user-cell">
          ${avatarHTML(u.displayName)}
          <div>
            <div class="u-name">${esc(u.displayName)}</div>
            <div class="u-sub">@${esc(u.username)}</div>
          </div>
        </div>
      </td>
      <td><span class="pill ${u.role === 'admin' ? 'move' : 'muted'}">${roleLabel(u.role)}</span></td>
      <td><span class="pill ${u.active === false ? 'danger' : 'ok'}">${u.active === false ? '已停用' : '正常'}</span></td>
      <td class="num" style="color:var(--muted)">${txCount} 笔</td>
      <td class="num" style="color:var(--muted-2);font-size:12px">${u.lastLogin ? u.lastLogin.slice(0, 16).replace('T', ' ') : '从未登录'}</td>
      <td>
        <div class="row-actions">
          <button class="icon-btn" title="编辑" data-action="edit-user" data-id="${u.id}">${icon('edit', 14)}</button>
          <button class="icon-btn" title="重置密码" data-action="reset-pwd" data-id="${u.id}">${icon('lock', 14)}</button>
          <button class="icon-btn danger" title="${u.id === SESSION.id ? '不能删除当前登录账号' : '删除'}"
            data-action="del-user" data-id="${u.id}" ${u.id === SESSION.id ? 'disabled' : ''}>${icon('trash', 14)}</button>
        </div>
      </td>
    </tr>`;
  }).join('');

  return `
  <div class="card">
    <div class="card-hd">
      <div><div class="card-title">用户与权限</div><div class="card-sub">管理员可管理账户、分类与全部数据；记账员只能录入和查看</div></div>
      <div class="card-actions"><button class="btn primary sm" data-action="new-user">${icon('userPlus', 14)} 新增用户</button></div>
    </div>
    <div class="table-wrap">
      <table class="tbl">
        <thead><tr><th>用户</th><th style="width:100px">角色</th><th style="width:90px">状态</th><th style="width:90px">录入流水</th><th style="width:150px">最后登录</th><th style="width:110px"></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </div>

  <div class="grid g-2 mt-14">
    <div class="card">
      <div class="card-hd"><div><div class="card-title">角色权限</div><div class="card-sub">当前版本的两级权限</div></div></div>
      <div class="card-bd">
        <div class="kv" style="grid-template-columns:110px 1fr">
          <dt>管理员</dt><dd>全部功能：记账、删除、账户、分类、预算、用户、设置、导出</dd>
          <dt>记账员</dt><dd>录入与编辑流水、查看报表、导出数据；不能删除流水、不能管理用户与分类</dd>
        </div>
      </div>
    </div>
    <div class="card">
      <div class="card-hd"><div><div class="card-title">安全说明</div><div class="card-sub">本地账户体系</div></div></div>
      <div class="card-bd">
        <div class="alert">
          ${icon('shield', 15)}
          <div>账号与密码保存在本机数据文件中，密码使用 PBKDF2-SHA256 加盐哈希存储。这是本地权限隔离，不是网络级安全——能直接访问数据文件的人仍可读取账目。</div>
        </div>
      </div>
    </div>
  </div>`;
}

/* ============================================================================
   设置
   ========================================================================== */

/* 汇率录入区（REQ-22）：每个外币一条最新汇率，只增不改，历史留痕 */
function fxRatesHTML() {
  const base = baseCurrency();
  const others = Object.keys(CURRENCIES).filter(k => k !== base);
  if (!others.length) return '';
  const rows = others.map(k => {
    const r = baseRate(k);
    const list = fxList(k);
    return `<tr>
      <td><b>${CURRENCIES[k].name}</b> <span class="pill muted">${k}</span></td>
      <td class="tr num">${r == null ? '<span class="pill warn">未录入</span>' : r.toFixed(4)}</td>
      <td style="font-size:11.5px;color:var(--muted-2)">${list.length ? fmtDateTime(list[list.length - 1].at || '') + (list[list.length - 1].byName ? ' · ' + esc(list[list.length - 1].byName) : '') : '—'}</td>
      <td class="nowrap"><button class="btn sm secondary" data-action="fx-add" data-cur="${k}">录入汇率</button></td>
    </tr>`;
  }).join('');
  return `<div style="margin-top:16px;border-top:1px solid var(--line);padding-top:14px">
    <div style="font-size:12.5px;font-weight:600;margin-bottom:8px">外币汇率（1 外币 = ? ${base}）</div>
    <div class="table-wrap"><table class="tbl">
      <thead><tr><th>币种</th><th class="tr" style="width:130px">当前汇率</th><th style="width:220px">最后录入</th><th style="width:120px"></th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <div class="hint" style="margin-top:8px">缺汇率的外币账户不计入汇总，相关页面会提示「未折算」，不会按 1:1 静默折算。</div>
  </div>`;
}

function viewSettings() {
  const sizeKB = (new Blob([JSON.stringify(DB)]).size / 1024).toFixed(1);
  const dates = DB.transactions.map(t => t.date).sort();
  const span = dates.length ? `${dates[0]} 至 ${dates[dates.length - 1]}` : '—';
  const curOpts = Object.values(CURRENCIES).map(c =>
    `<option value="${c.code}" ${DB.meta.currency === c.code ? 'selected' : ''}>${c.name}（${c.symbol} ${c.code}）</option>`
  ).join('');

  return `
  <div class="grid g-2">
    <div class="card">
      <div class="setting-block">
        <h4>集团信息</h4>
        <p>集团名称会显示在集团总览、集团报表与登录页，用于标识多家公司合并后的整体。</p>
        <div class="form-grid">
          <label class="field span-2"><span class="lbl">集团名称</span>
            <input type="text" id="group-input" value="${esc(DB.meta.groupName || '')}" placeholder="如：Mensah Group / 刘氏集团">
          </label>
        </div>
        <div class="setting-actions" style="margin-top:12px">
          <button class="btn primary sm" data-action="save-group">保存集团名称</button>
          <button class="btn ghost sm" data-action="nav" data-view="group">查看集团总览</button>
        </div>
      </div>

      <div class="setting-block">
        <h4>集团总公司登记方式</h4>
        <p>决定总公司是否作为独立公司参与集团合并。切换会影响集团总额、集团报表的口径。</p>
        <div class="seg" style="width:auto;margin-bottom:10px">
          <button class="seg-btn ${parentMode() === 'company' ? 'is-active' : ''}" data-action="set-parent-mode" data-mode="company">作为独立公司</button>
          <button class="seg-btn ${parentMode() === 'registry' ? 'is-active' : ''}" data-action="set-parent-mode" data-mode="registry">仅集团登记主体</button>
        </div>
        <p style="font-size:12px;color:var(--muted-2)">当前：<b>${parentMode() === 'registry' ? '仅作集团登记主体（不参与核算）' : '作为独立公司参与核算'}</b></p>
      </div>

      <div class="setting-block">
        <h4>本位币与汇率</h4>
        <p>本位币是所有汇总与报表的计量单位。账户可以挂不同币种，跨币种汇总时按下面录入的汇率折算，原币金额始终保留。</p>
        <div class="form-grid">
          <label class="field span-2"><span class="lbl">本位币</span><select id="currency-select">${curOpts}</select></label>
        </div>
        <div class="setting-actions" style="margin-top:12px">
          <button class="btn primary sm" data-action="save-currency">保存本位币</button>
          <button class="btn ghost sm" data-action="nav" data-view="companies">去公司管理</button>
        </div>
        ${fxRatesHTML()}
      </div>

      <div class="setting-block">
        <h4>外观主题</h4>
        <p>切换后立即生效，并记住你的选择。</p>
        ${themePickerHTML()}
      </div>

      <div class="setting-block">
        <h4>页面动效</h4>
        <p>统一控制全站动效。关闭后入场动画与过渡立即停用；系统开启「减少动效」时也会自动降级。</p>
        <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
          <label class="switch"><input type="checkbox" ${motionOn() ? 'checked' : ''} data-action="toggle-motion"><span class="track"></span><span>开启动效</span></label>
          <div class="seg" style="width:auto">
            <button class="seg-btn ${motionSpeed() === 'slow' ? 'is-active' : ''}" data-action="set-motion-speed" data-speed="slow">慢</button>
            <button class="seg-btn ${motionSpeed() === 'normal' ? 'is-active' : ''}" data-action="set-motion-speed" data-speed="normal">标准</button>
            <button class="seg-btn ${motionSpeed() === 'fast' ? 'is-active' : ''}" data-action="set-motion-speed" data-speed="fast">快</button>
          </div>
        </div>
      </div>

      <div class="setting-block">
        <h4>安全策略</h4>
        <p>长时间无操作自动退出登录，避免离开工位后账号被他人使用。</p>
        <div class="form-grid">
          <label class="field"><span class="lbl">自动退出（分钟）</span>
            <input type="number" id="idle-min" min="1" max="240" value="${idleMinutes()}">
          </label>
        </div>
        <div class="setting-actions" style="margin-top:12px">
          <button class="btn secondary sm" data-action="save-idle">保存</button>
        </div>
      </div>

      <div class="setting-block">
        <h4>账套管理</h4>
        <p>把整套账本（全部公司、流水、附件、档案、用户、配置）打包成<b>单一 .flpack 文件</b>，
          换电脑后一键导入即可完整恢复，不用手工复制 data 文件夹。</p>
        <div class="setting-actions" style="margin-top:12px;flex-wrap:wrap">
          <button class="btn primary sm" data-action="pack-export">${icon('download', 14)} 导出账套</button>
          <button class="btn secondary sm" data-action="pack-import">${icon('upload', 14)} 导入账套</button>
          <button class="btn ghost sm" data-action="pack-open-folder">打开自动备份目录</button>
        </div>
        <div class="note" style="margin-top:10px;font-size:12px">
          <b>自动备份：</b>每 3 天自动生成一份账套包，只保留最新 3 份。
          ${(() => {
            const a = UI.packAuto;
            if (!a) return '';
            if (!a.count) return '尚未生成自动备份。';
            return '当前 ' + a.count + ' 份，最新：' + (a.newestAt ? fmtDateTime(a.newestAt) : a.newest);
          })()}
        </div>
        <div class="note" style="margin-top:8px;font-size:12px;color:var(--muted-2)">
          JSON 备份仍然保留，但它<b>不含附件</b>，不是完整账套。
        </div>
      </div>

      <div class="setting-block">
        <h4>数据概况</h4>
        <dl class="kv">
          <dt>账户数量</dt><dd>${DB.accounts.length} 个（现金 ${DB.accounts.filter(a => a.type === 'cash').length} · 银行 ${DB.accounts.filter(a => a.type === 'bank').length}）</dd>
          <dt>流水笔数</dt><dd>${DB.transactions.length} 笔</dd>
          <dt>往来款项</dt><dd>${DB.debts.length} 笔</dd>
          <dt>分类数量</dt><dd>${DB.categories.length} 个</dd>
          <dt>数据期间</dt><dd>${span}</dd>
          <dt>占用空间</dt><dd>约 ${sizeKB} KB${DESKTOP ? '（本机数据文件）' : '（浏览器本地存储）'}</dd>
        </dl>
      </div>

      ${DESKTOP && APP_INFO ? `<div class="setting-block">
        <h4>数据目录</h4>
        <p>账本、档案与附件全部保存在这个目录里。把它放进网盘同步文件夹（OneDrive / Google Drive / Dropbox），
          多台设备就能共享同一份数据。</p>
        <dl class="kv">
          <dt>当前目录</dt><dd style="word-break:break-all;font-family:var(--mono);font-size:11.5px">${esc(APP_INFO.dataDir)}</dd>
          <dt>账本文件</dt><dd style="word-break:break-all;font-family:var(--mono);font-size:11.5px">${esc(APP_INFO.dataFile)}</dd>
          <dt>附件目录</dt><dd style="word-break:break-all;font-family:var(--mono);font-size:11.5px">${esc(APP_INFO.filesDir || (APP_INFO.dataDir + '\\files'))}</dd>
          <dt>程序版本</dt><dd>v${esc(APP_INFO.version)} · Electron ${esc(APP_INFO.electron)}</dd>
        </dl>
        <div class="setting-actions" style="margin-top:12px">
          <button class="btn secondary sm" data-action="open-data-folder">打开数据目录</button>
          <button class="btn secondary sm" data-action="set-data-dir">更改数据目录</button>
        </div>
      </div>` : ''}
    </div>

    <div class="card">
      <div class="setting-block">
        <h4>备份与导出</h4>
        <p>账目仅保存在这台电脑上，不联网、不上传。更换电脑或重装系统前，请先导出备份。<br>
          ${DESKTOP ? '注意：导出的 JSON 只包含账目与档案索引，公司档案的附件在数据目录的 <b>files</b> 文件夹里，请与 <b>data.json</b> 一并复制。' : ''}</p>
        <div class="setting-actions">
          <button class="btn primary sm" data-action="export-json">导出备份（JSON）</button>
          <button class="btn secondary sm" data-action="import-json">从备份恢复</button>
          <button class="btn secondary sm" data-action="export-all-csv">导出全部流水</button>
          <button class="btn secondary sm" data-action="print">打印报表</button>
        </div>
      </div>

      <div class="setting-block">
        <h4>示例与重置</h4>
        <p>载入一套演示账户与近三个月的流水，便于熟悉功能。会覆盖当前账本。</p>
        <div class="setting-actions">
          <button class="btn secondary sm" data-action="seed">载入示例数据</button>
          <button class="btn danger-ghost sm" data-action="clear-all">清空全部数据</button>
        </div>
      </div>

      <div class="setting-block">
        <h4>使用说明</h4>
        <dl class="kv" style="grid-template-columns:100px 1fr">
          <dt>余额算法</dt><dd>期初余额 + 收入 − 支出 − 转出 + 转入</dd>
          <dt>内部转账</dt><dd>账户间调拨，不影响资金总额与现金流量</dd>
          <dt>往来款</dt><dd>借出/借入/员工垫付，结清时自动生成对应流水</dd>
          <dt>现金流量表</dt><dd>按分类映射的经营/投资/筹资项目自动归集</dd>
          <dt>月末对账单</dt><dd>按账户生成含逐笔余额的对账单，可直接打印</dd>
          <dt>数据存储</dt><dd>${DESKTOP ? '本机数据文件' : '浏览器本地存储'}，不联网、不上传</dd>
        </dl>
      </div>

      <div class="setting-block">
        <h4>账号安全</h4>
        <p>设置预留信息后，忘记密码可以在登录页自助重置；不设置则只能由管理员重置。</p>
        <div class="setting-actions">
          <button class="btn secondary sm" data-action="security-set">
            ${(userById(SESSION.id) || {}).security && (userById(SESSION.id) || {}).security.length ? '修改预留信息' : '设置预留信息'}
          </button>
          <button class="btn secondary sm" data-action="change-pwd">修改密码</button>
        </div>
      </div>

      <div class="setting-block">
        <h4>关于</h4>
        <p>合资金账 v${APP_VERSION} · ${DB.users.length} 个用户 · 当前登录 ${esc(SESSION.displayName)}（${roleLabel(SESSION.role)}）</p>
        <div class="setting-actions">
          <button class="btn secondary sm" data-action="logout">退出登录</button>
        </div>
      </div>
    </div>
  </div>`;
}

/* ============================================================================
   集团视图（多公司）
   ========================================================================== */

/* 集团下没有任何参与合并的公司：给引导，而不是渲染一屏 0 */
function groupEmptyState() {
  const hq = groupHQ();
  const actions = [
    isAdmin() ? `<button class="btn primary" data-action="new-company">${icon('plus', 15)} 新建公司</button>` : '',
    (isAdmin() && hq) ? `<button class="btn secondary" data-action="set-parent-mode" data-mode="company">把总公司改为参与核算</button>` : ''
  ].filter(Boolean).join('');
  return `
  <div class="page-hero">
    <div><h2>${esc(groupTitle())}</h2><p>集团下还没有参与合并的公司</p></div>
  </div>
  <div class="card"><div class="card-bd">
    ${emptyState({
      ico: 'layers',
      title: '还没有成员公司',
      desc: hq
        ? `「${esc(hq.name)}」被设为集团总公司，且登记方式是「仅作集团登记主体」，因此不参与合并。新建一家分公司，或把总公司改为「作为独立公司参与核算」。`
        : '新建一家公司后，集团总览就会按合并口径显示数据。',
      actions
    })}
  </div></div>`;
}

function viewGroupDashboard() {
  const today = todayISO();
  const thisM = monthOf(today);
  /* 合并口径只在这里取一次，下面全部引用 cos。
     早期版本 8 处各写一遍 DB.companies，导致 registry 模式下「明细列表有、合计没有」。 */
  const cos = accountingCompanies();
  if (!cos.length) return groupEmptyState();
  const g = groupTotals();

  let mIn = 0, mOut = 0;
  cos.forEach(co => {
    const s = rangeStats(thisM + '-01', today, co);
    mIn += s.inflow; mOut += s.outflow;
  });
  mIn = round2(mIn); mOut = round2(mOut);
  const mNet = round2(mIn - mOut);

  const tw = trendWindow();
  const start = tw.start;
  const end = tw.end;
  const series = groupSeries(start, end);
  const chg = round2(g.total - (series[0] ? series[0].value : 0));

  const seg = trendSegHTML();

  const rows = cos.map(co => {
    const t = companyTotals(co);
    const s = rangeStats(thisM + '-01', today, co);
    const lend = debtTotals('lend', co);
    const payB = debtTotals('borrow', co);
    const payR = debtTotals('reimburse', co);
    return {
      co, t, s,
      lend: lend.remaining,
      pay: round2(payB.remaining + payR.remaining),
      net: round2(s.inflow - s.outflow)
    };
  }).sort((a, b) => b.t.total - a.t.total);

  /* 跨公司最近流水 */
  const recent = [];
  cos.forEach(co => {
    co.transactions.forEach(t => recent.push({ t, co }));
  });
  recent.sort((a, b) => a.t.date === b.t.date
    ? String(b.t.createdAt).localeCompare(String(a.t.createdAt))
    : b.t.date.localeCompare(a.t.date));

  const payRows = rows.filter(r => r.lend > 0 || r.pay > 0).sort((a, b) => (b.lend + b.pay) - (a.lend + a.pay));
  const payMax = Math.max(1, ...payRows.map(r => Math.max(r.lend, r.pay)));

  /* 总公司若被排除在合并之外，单独出一张卡放在最上面，
     否则用户切到 registry 模式后会以为「总公司没了」。 */
  const hq = groupHQ();
  const hqExcluded = !!(hq && parentMode() === 'registry');
  const hqRow = hqExcluded ? (() => {
    const t = companyTotals(hq);
    const s = rangeStats(thisM + '-01', today, hq);
    return {
      co: hq, t, s,
      lend: debtTotals('lend', hq).remaining,
      pay: round2(debtTotals('borrow', hq).remaining + debtTotals('reimburse', hq).remaining),
      net: round2(s.inflow - s.outflow)
    };
  })() : null;

  const coCard = r => `
      <div class="co-card" data-action="enter-company" data-id="${r.co.id}" style="--c:${r.co.color}">
        <div class="co-card-top">
          <span class="co-dot" style="--c:${r.co.color}"></span>
          <strong>${esc(r.co.name)}</strong>
          ${r.co.isParent ? '<span class="pill move">总公司</span>' : ''}
          <span class="pill muted">${r.co.accounts.length} 账户</span>
        </div>
        <div class="co-card-bal">${fmt(r.t.total)}</div>
        <div class="co-card-net" style="color:${r.net > 0 ? 'var(--in)' : r.net < 0 ? 'var(--out)' : 'var(--muted-2)'}">
          本月 ${r.net > 0 ? '+' : ''}${fmtShort(r.net)}
        </div>
        <div class="co-card-grid">
          <div><span>现金</span><b>${fmtShort(r.t.cash)}</b></div>
          <div><span>银行</span><b>${fmtShort(r.t.bank)}</b></div>
          <div><span>应收</span><b style="color:var(--in)">${fmtShort(r.lend)}</b></div>
          <div><span>应付</span><b style="color:var(--out)">${fmtShort(r.pay)}</b></div>
        </div>
        <div class="co-card-foot">进入账本 ${icon('chevronRight', 13)}</div>
      </div>`;

  return `
  <div class="page-hero">
    <div>
      <h2>${esc(groupTitle())}</h2>
      <p>${fmtDateCN(today)} · 共 ${cos.length} 家公司合并${hqExcluded ? '（不含总公司自身）' : ''}，账本相互独立</p>
    </div>
    <div style="display:flex;gap:8px">
      ${isAdmin() ? `<button class="btn ghost" data-action="nav" data-view="settings">${icon('edit', 14)} ${DB.meta.groupName ? '改集团名称' : '给集团命名'}</button>` : ''}
      ${isAdmin() ? `<button class="btn secondary" data-action="new-company">${icon('plus', 15)} 新建公司</button>` : ''}
      <button class="btn secondary" data-action="new-transfer">${icon('transfer', 15)} 公司间转账</button>
      <button class="btn primary" data-action="new-tx">${icon('plus', 15)} 记一笔</button>
    </div>
  </div>

  <div class="stat-grid mb-14">
    <div class="stat hero is-clickable" data-action="drill" data-metric="total" title="点击查看各公司构成">
      <canvas class="scene-canvas" data-scene="hero"></canvas>
      <div class="stat-top">
        <span class="stat-label">集团资金总额</span>
        <span class="stat-ico">${icon('layers', 15)}</span>
      </div>
      <div class="stat-value" data-count="${g.total}">${fmt(g.total)}</div>
      <div class="hero-spark">${sparkline(series)}</div>
      <div class="stat-foot">${chg === 0 ? '与区间起点持平' : `较区间起点 ${chg > 0 ? '+' : ''}${fmt(chg)}`}</div>
    </div>

    <div class="stat is-clickable" data-action="drill" data-metric="cash" title="点击查看各公司构成">
      <div class="stat-top">
        <span class="stat-label">集团库存现金</span>
        <span class="stat-ico warn">${icon('wallet', 15)}</span>
      </div>
      <div class="stat-value sm" data-count="${g.cash}">${fmt(g.cash)}</div>
      <div class="stat-foot">占总资金 ${g.total ? ((g.cash / g.total) * 100).toFixed(1) : '0.0'}%</div>
    </div>

    <div class="stat is-clickable" data-action="drill" data-metric="bank" title="点击查看各公司构成">
      <div class="stat-top">
        <span class="stat-label">集团银行存款</span>
        <span class="stat-ico">${icon('bank', 15)}</span>
      </div>
      <div class="stat-value sm">${fmt(g.bank)}</div>
      <div class="stat-foot">占总资金 ${g.total ? ((g.bank / g.total) * 100).toFixed(1) : '0.0'}%</div>
    </div>

    <div class="stat is-clickable" data-action="drill" data-metric="net" title="点击查看各公司构成">
      <div class="stat-top">
        <span class="stat-label">往来账款净额</span>
        <span class="stat-ico out">${icon('debt', 15)}</span>
      </div>
      <div class="stat-value sm">${fmt(round2(g.receivable - g.payable))}</div>
      <div class="stat-foot">应收 ${fmtShort(g.receivable)} · 应付 ${fmtShort(g.payable)}</div>
    </div>
  </div>

  ${insightsCard(insightItems(cos))}

  <div class="grid g-main-side mb-14">
    <div class="card">
      <div class="card-hd">
        <div>
          <div class="card-title">集团资金趋势</div>
          <div class="card-sub">${start} 至 ${end} · ${cos.length} 家公司合计</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><div class="seg" style="width:auto">${seg}</div>${trendDateHTML()}</div>
      </div>
      <div class="card-bd">${areaChart(series, { height: 250 })}</div>
    </div>

    <div class="card">
      <div class="card-hd">
        <div><div class="card-title">本月集团收支</div><div class="card-sub">${monthLabel(thisM)}</div></div>
      </div>
      <div class="card-bd">
        <div style="display:flex;gap:26px;margin-bottom:14px">
          <div data-action="drill" data-metric="monthIn" title="点击查看各公司本月流入" style="cursor:pointer"><div style="font-size:11.5px;color:var(--muted)">流入 ${icon('chevronRight', 11)}</div>
            <div style="font-size:19px;font-weight:650;color:var(--in);font-variant-numeric:tabular-nums">+${fmtShort(mIn)}</div></div>
          <div data-action="drill" data-metric="monthOut" title="点击查看各公司本月流出" style="cursor:pointer"><div style="font-size:11.5px;color:var(--muted)">流出 ${icon('chevronRight', 11)}</div>
            <div style="font-size:19px;font-weight:650;color:var(--out);font-variant-numeric:tabular-nums">-${fmtShort(mOut)}</div></div>
          <div><div style="font-size:11.5px;color:var(--muted)">净额</div>
            <div style="font-size:19px;font-weight:650;color:${mNet >= 0 ? 'var(--in)' : 'var(--out)'};font-variant-numeric:tabular-nums">${mNet > 0 ? '+' : ''}${fmtShort(mNet)}</div></div>
        </div>
        <div style="border-top:1px solid var(--line);padding-top:12px">
          <div style="font-size:11.5px;color:var(--muted-2);margin-bottom:9px;display:flex;justify-content:space-between">
            <span>各公司应收 / 应付</span>
            <span class="legend"><span><i style="background:var(--in)"></i>应收</span><span><i style="background:var(--out)"></i>应付</span></span>
          </div>
          ${payRows.length ? `<div class="rank">
            ${payRows.slice(0, 5).map(r => `<div class="rank-item">
              <div class="rank-name"><span class="co-dot" style="--c:${r.co.color}"></span><span>${esc(r.co.name)}</span></div>
              <div class="rank-val">${fmtShort(r.lend)} / ${fmtShort(r.pay)}</div>
              <div class="rank-bar"><i class="in" style="width:${Math.max(2, (r.lend / payMax) * 100).toFixed(1)}%"></i></div>
              <div class="rank-bar"><i class="out" style="width:${Math.max(2, (r.pay / payMax) * 100).toFixed(1)}%"></i></div>
            </div>`).join('')}
          </div>` : `<div style="font-size:12px;color:var(--muted-2);padding:8px 0">暂无未结清往来款</div>`}
        </div>
      </div>
    </div>
  </div>

  <div class="section-title" style="display:flex;align-items:center;gap:8px;margin:0 0 10px;font-size:13px;font-weight:650;color:var(--ink-2)">
    公司资金一览
    <span style="font-weight:400;color:var(--muted-2);font-size:11.5px">点击卡片进入该公司账本</span>
  </div>

  ${hqRow ? `
  <div class="card mb-14">
    <div class="card-hd">
      <div>
        <div class="card-title">集团总公司 · 自身账本</div>
        <div class="card-sub">${esc(hqRow.co.name)} · 登记方式为「仅作集团登记主体」，<b>不计入下方合并合计</b></div>
      </div>
      ${isAdmin() ? `<div class="card-actions"><button class="btn ghost sm" data-action="set-parent-mode" data-mode="company">改为参与合并</button></div>` : ''}
    </div>
    <div class="card-bd"><div class="co-grid">${coCard(hqRow)}</div></div>
  </div>` : ''}

  <div class="co-grid mb-14">
    ${rows.map(coCard).join('')}
    ${isAdmin() ? `<button class="co-card co-card-add" data-action="new-company">
      <div class="empty-ico" style="width:38px;height:38px">${icon('plus', 18)}</div>
      <span>新建公司</span>
      <small>为另一家公司开设独立账本</small>
    </button>` : ''}
  </div>

  <div class="card">
    <div class="card-hd">
      <div><div class="card-title">跨公司最近流水</div><div class="card-sub">按日期倒序，含公司标签</div></div>
    </div>
    <div class="card-bd flush">
      ${recent.length ? `<div class="table-wrap">
        <table class="tbl">
          <thead><tr><th style="width:100px">日期</th><th style="width:150px">公司</th><th>分类</th><th>摘要</th><th class="tr" style="width:130px">金额</th></tr></thead>
          <tbody>${recent.slice(0, 10).map(({ t, co }) => {
            const c = txCat(t, co);
            const sign = t.type === 'in' ? '+' : t.type === 'out' ? '-' : '';
            const cls = t.type === 'in' ? 'in' : t.type === 'out' ? 'out' : 'move';
            return `<tr>
              <td class="num nowrap" style="color:var(--muted)">${t.date}</td>
              <td><span class="co-tag"><span class="co-dot" style="--c:${co.color}"></span>${esc(co.name)}</span></td>
              <td>${catChip(c)}</td>
              <td style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted)">${esc(t.summary || t.counterparty || '—')}</td>
              <td class="tr cell-amount ${cls}">${sign}${fmtPlain(t.amount)}</td>
            </tr>`;
          }).join('')}</tbody>
        </table>
      </div>` : emptyState({ ico: 'flow', title: '还没有流水', desc: '进入任一家公司，点击「记一笔」开始记录' })}
    </div>
  </div>`;
}

function viewGroupReports() {
  const t = todayISO();
  if (!UI.groupRange.from || !UI.groupRange.to) UI.groupRange = { from: `${t.slice(0, 4)}-01-01`, to: t };
  const { from, to } = UI.groupRange;
  const cos = accountingCompanies();
  const presets = [['month', '本月'], ['last', '上月'], ['quarter', '本季'], ['year', '本年']]
    .map(([k, l]) => `<button class="seg-btn ${UI.groupPreset === k ? 'is-active' : ''}" data-action="group-preset" data-preset="${k}">${l}</button>`).join('');

  const rows = cos.map(co => {
    const s = rangeStats(from, to, co);
    /* 必须传 to：不传就是「今天」口径，会和表体的区间口径打架，同页出现两套基准 */
    const tt = companyTotals(co, to);
    const op = companyBalanceAt(co, addDays(from, -1));
    return {
      co, s, tt, op,
      /* 期末余额走统一取数，避免漏掉跨公司转账（rangeStats.transfer 不在 inflow/outflow 里） */
      close: companyBalanceAt(co, to),
      lend: debtTotals('lend', co).remaining,
      pay: round2(debtTotals('borrow', co).remaining + debtTotals('reimburse', co).remaining)
    };
  });

  const sum = rows.reduce((a, r) => ({
    op: a.op + r.op, inflow: a.inflow + r.s.inflow, outflow: a.outflow + r.s.outflow,
    close: a.close + r.close, lend: a.lend + r.lend, pay: a.pay + r.pay,
    cash: a.cash + r.tt.cash, bank: a.bank + r.tt.bank, total: a.total + r.tt.total
  }), { op: 0, inflow: 0, outflow: 0, close: 0, lend: 0, pay: 0, cash: 0, bank: 0, total: 0 });

  /* 总公司被排除在合并外时，另给一行参考值，方便核对「合计 + 总公司 = 全部」 */
  const hqR = groupHQ();
  const hqExcludedR = !!(hqR && parentMode() === 'registry');
  const hqSum = hqExcludedR ? (() => {
    const s = rangeStats(from, to, hqR);
    return {
      op: companyBalanceAt(hqR, addDays(from, -1)),
      inflow: s.inflow, outflow: s.outflow,
      close: companyBalanceAt(hqR, to),
      lend: debtTotals('lend', hqR).remaining,
      pay: round2(debtTotals('borrow', hqR).remaining + debtTotals('reimburse', hqR).remaining)
    };
  })() : null;

  const cf = groupCashFlow(from, to);
  const cfRow = r => `<tr>
    <td class="cf-label cf-indent">${esc(r.label)}</td>
    <td class="tr num" style="color:${r.amount ? (r.dir === 'in' ? 'var(--in)' : 'var(--out)') : 'var(--muted-2)'}">${r.amount ? fmtPlain(r.amount) : '—'}</td>
  </tr>`;
  const cfSection = (act, title) => {
    const items = cf.rows.filter(r => r.act === act);
    return `<tr class="cf-section"><td>${title}</td><td></td></tr>
      ${items.filter(r => r.dir === 'in').map(cfRow).join('')}
      <tr class="cf-total"><td class="cf-label cf-indent">现金流入小计</td><td class="tr num" style="color:var(--in)">${fmtPlain(cf.act[act].in)}</td></tr>
      ${items.filter(r => r.dir === 'out').map(cfRow).join('')}
      <tr class="cf-total"><td class="cf-label cf-indent">现金流出小计</td><td class="tr num" style="color:var(--out)">${fmtPlain(cf.act[act].out)}</td></tr>
      <tr class="cf-net"><td class="cf-label">${title.replace('产生的现金流量', '产生的现金流量净额')}</td><td class="tr num">${fmtPlain(cf.act[act].net)}</td></tr>`;
  };

  return `
  <div class="toolbar no-print">
    <div class="seg">${presets}</div>
    <label class="field" style="min-width:140px"><label>开始</label><input type="date" data-group="from" value="${from}"></label>
    <label class="field" style="min-width:140px"><label>结束</label><input type="date" data-group="to" value="${to}"></label>
    <div class="spacer"></div>
    <button class="btn secondary" data-action="group-export">${icon('download', 14)} 导出汇总</button>
    <button class="btn secondary" data-action="print">${icon('printer', 14)} 打印</button>
  </div>

  <div class="card mb-14">
    <div class="card-hd">
      <div>
        <div class="card-title">集团资金汇总</div>
        <div class="card-sub">${from} 至 ${to} · 按公司分列，末行为集团合计</div>
      </div>
    </div>
    <div class="card-bd flush">
      <div class="table-wrap">
        <table class="tbl">
          <thead><tr>
            <th>公司</th><th class="tr" style="width:110px">期初余额</th><th class="tr" style="width:110px">本期流入</th>
            <th class="tr" style="width:110px">本期流出</th><th class="tr" style="width:110px">期末余额</th>
            <th class="tr" style="width:100px">应收</th><th class="tr" style="width:100px">应付</th>
          </tr></thead>
          <tbody>${rows.map(r => `<tr>
            <td>
              <div style="display:flex;align-items:center;gap:8px">
                <span class="co-dot" style="--c:${r.co.color}"></span>
                <div>
                  <div class="cell-main">${esc(r.co.name)}</div>
                  <div class="cell-sub">${r.co.accounts.length} 账户 · 现金 ${fmtShort(r.tt.cash)} / 银行 ${fmtShort(r.tt.bank)}</div>
                </div>
              </div>
            </td>
            <td class="tr num">${fmtPlain(r.op)}</td>
            <td class="tr num" style="color:var(--in)">${r.s.inflow ? fmtPlain(r.s.inflow) : '—'}</td>
            <td class="tr num" style="color:var(--out)">${r.s.outflow ? fmtPlain(r.s.outflow) : '—'}</td>
            <td class="tr cell-amount">${fmtPlain(r.close)}</td>
            <td class="tr num" style="color:var(--in)">${r.lend ? fmtPlain(r.lend) : '—'}</td>
            <td class="tr num" style="color:var(--out)">${r.pay ? fmtPlain(r.pay) : '—'}</td>
          </tr>`).join('')}</tbody>
          <tfoot><tr>
            <td>集团合计</td>
            <td class="tr num">${fmtPlain(sum.op)}</td>
            <td class="tr num" style="color:var(--in)">${fmtPlain(sum.inflow)}</td>
            <td class="tr num" style="color:var(--out)">${fmtPlain(sum.outflow)}</td>
            <td class="tr num">${fmtPlain(sum.close)}</td>
            <td class="tr num" style="color:var(--in)">${fmtPlain(sum.lend)}</td>
            <td class="tr num" style="color:var(--out)">${fmtPlain(sum.pay)}</td>
          </tr>
          ${hqSum ? `<tr style="color:var(--muted-2)">
            <td>其中：总公司自身（不计入合计）</td>
            <td class="tr num">${fmtPlain(hqSum.op)}</td>
            <td class="tr num">${fmtPlain(hqSum.inflow)}</td>
            <td class="tr num">${fmtPlain(hqSum.outflow)}</td>
            <td class="tr num">${fmtPlain(hqSum.close)}</td>
            <td class="tr num">${fmtPlain(hqSum.lend)}</td>
            <td class="tr num">${fmtPlain(hqSum.pay)}</td>
          </tr>` : ''}
          </tfoot>
        </table>
      </div>
    </div>
  </div>

  <div class="grid g-3 mb-14">
    <div class="stat is-clickable" data-action="drill" data-metric="total" title="点击查看各公司构成"><div class="stat-top"><span class="stat-label">集团资金总额</span><span class="stat-ico">${icon('layers', 15)}</span></div>
      <div class="stat-value sm">${fmt(sum.total)}</div><div class="stat-foot">现金 ${fmtShort(sum.cash)} · 银行 ${fmtShort(sum.bank)}</div></div>
    <div class="stat is-clickable" data-action="drill" data-metric="lend" title="点击查看各公司构成"><div class="stat-top"><span class="stat-label">集团应收合计</span><span class="stat-ico in">${icon('debt', 15)}</span></div>
      <div class="stat-value sm">${fmt(sum.lend)}</div><div class="stat-foot">借出未收回</div></div>
    <div class="stat is-clickable" data-action="drill" data-metric="pay" title="点击查看各公司构成"><div class="stat-top"><span class="stat-label">集团应付合计</span><span class="stat-ico out">${icon('receipt', 15)}</span></div>
      <div class="stat-value sm">${fmt(sum.pay)}</div><div class="stat-foot">借入 + 员工未报销</div></div>
  </div>

  <div class="card">
    <div class="card-hd">
      <div>
        <div class="card-title">合并现金流量表（直接法）</div>
        <div class="card-sub">${from} 至 ${to} · ${cos.length} 家公司合计${hqExcludedR ? '（不含总公司自身）' : ''} · 单位：${CUR().name}</div>
      </div>
    </div>
    <div class="card-bd flush">
      <div class="table-wrap">
        <table class="tbl cf-table">
          <thead><tr><th>项目</th><th class="tr" style="width:180px">本期金额</th></tr></thead>
          <tbody>
            ${cfSection('op', '一、经营活动产生的现金流量')}
            ${cfSection('inv', '二、投资活动产生的现金流量')}
            ${cfSection('fin', '三、筹资活动产生的现金流量')}
            <tr class="cf-section"><td>四、现金及现金等价物净增加额</td><td class="tr num">${fmtPlain(cf.netTotal)}</td></tr>
            <tr><td class="cf-label cf-indent">加：期初现金及现金等价物余额</td><td class="tr num">${fmtPlain(cf.beginCash)}</td></tr>
            <tr class="cf-net"><td class="cf-label">五、期末现金及现金等价物余额</td><td class="tr num">${fmtPlain(cf.endCash)}</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>`;
}

function viewCompanies() {
  const rows = DB.companies.map(co => {
    const t = companyTotals(co);
    return {
      co, t,
      lend: debtTotals('lend', co).remaining,
      pay: round2(debtTotals('borrow', co).remaining + debtTotals('reimburse', co).remaining)
    };
  });
  /* 合计口径与集团报表保持一致：registry 模式下排除总公司自身 */
  const hqEx = !!(groupHQ() && parentMode() === 'registry');
  const sumRows = hqEx ? rows.filter(r => !r.co.isParent) : rows;
  const sumOf = k => fmtPlain(sumRows.reduce((s, r) => s + (k === 'total' || k === 'cash' || k === 'bank' ? r.t[k] : r[k]), 0));

  return `
  <div class="card">
    <div class="card-hd">
      <div><div class="card-title">公司列表</div><div class="card-sub">每家公司的账户、流水、往来与预算完全独立，集团视图只做合并汇总</div></div>
      <div class="card-actions"><button class="btn primary sm" data-action="new-company">${icon('plus', 14)} 新建公司</button></div>
    </div>
    <div class="table-wrap">
      <table class="tbl">
        <thead><tr>
          <th>公司</th><th class="tr" style="width:120px">资金总额</th><th class="tr" style="width:100px">现金</th>
          <th class="tr" style="width:100px">银行</th><th class="tr" style="width:100px">应收</th><th class="tr" style="width:100px">应付</th>
          <th style="width:110px">账本</th><th style="width:130px"></th>
        </tr></thead>
        <tbody>${rows.map(({ co, t, lend, pay }) => `<tr>
          <td>
            <div style="display:flex;align-items:center;gap:9px">
              <span class="co-badge sm" style="--c:${co.color}">${esc(initials(co.name))}</span>
              <div>
                <div class="cell-main">${esc(co.name)}${co.isParent ? ' <span class="pill move">总公司</span>' : ''}</div>
                <div class="cell-sub">${esc(co.note || co.taxNo || '—')}${hqEx && co.isParent ? ' · 不计入合并' : ''}</div>
              </div>
            </div>
          </td>
          <td class="tr cell-amount">${fmtPlain(t.total)}</td>
          <td class="tr num" style="color:var(--muted)">${fmtPlain(t.cash)}</td>
          <td class="tr num" style="color:var(--muted)">${fmtPlain(t.bank)}</td>
          <td class="tr num" style="color:var(--in)">${lend ? fmtPlain(lend) : '—'}</td>
          <td class="tr num" style="color:var(--out)">${pay ? fmtPlain(pay) : '—'}</td>
          <td style="font-size:12px;color:var(--muted-2)">${co.accounts.length} 账户 · ${co.transactions.length} 笔</td>
          <td>
            <div class="row-actions">
              <button class="btn sm secondary" data-action="enter-company" data-id="${co.id}">进入</button>
              <button class="icon-btn" title="编辑" data-action="edit-company" data-id="${co.id}">${icon('edit', 14)}</button>
              <button class="icon-btn danger" title="${DB.companies.length <= 1 ? '至少保留一家公司' : '删除'}" data-action="del-company" data-id="${co.id}" ${DB.companies.length <= 1 ? 'disabled' : ''}>${icon('trash', 14)}</button>
            </div>
          </td>
        </tr>`).join('')}</tbody>
        <tfoot><tr>
          <td>集团合计${hqEx ? '（不含总公司自身）' : ''}</td>
          <td class="tr num">${sumOf('total')}</td>
          <td class="tr num">${sumOf('cash')}</td>
          <td class="tr num">${sumOf('bank')}</td>
          <td class="tr num">${sumOf('lend')}</td>
          <td class="tr num">${sumOf('pay')}</td>
          <td colspan="2"></td>
        </tr></tfoot>
      </table>
    </div>
  </div>

  <div class="alert info mt-14">
    ${icon('info', 15)}
    <div>切换公司请用左侧顶部的公司切换器；集团总览与集团报表会把所有公司合并计算，不会影响各公司自己的账目。</div>
  </div>`;
}

/* ============================================================================
   公司档案
   ========================================================================== */

const FIELD_GROUPS = ['银行账户', '税务与合规', '系统账号', '其他'];

const FIELD_TEMPLATES = [
  { group: '银行账户', label: '开户行', type: 'text' },
  { group: '银行账户', label: '对公账号', type: 'text' },
  { group: '银行账户', label: '账户户名', type: 'text' },
  { group: '银行账户', label: '网银登录地址', type: 'url' },
  { group: '银行账户', label: '网银用户名', type: 'text' },
  { group: '银行账户', label: '网银密码', type: 'password' },
  { group: '税务与合规', label: 'GRA 纳税人识别号', type: 'text' },
  { group: '税务与合规', label: 'GRA 登录账号', type: 'text' },
  { group: '税务与合规', label: 'GRA 密码', type: 'password' },
  { group: '税务与合规', label: 'SSNIT 账号', type: 'text' },
  { group: '系统账号', label: '企业邮箱', type: 'text' },
  { group: '系统账号', label: '邮箱密码', type: 'password' }
];

const groupIcon = g => (g === '银行账户' ? 'bank' : g === '税务与合规' ? 'receipt' : g === '系统账号' ? 'mail' : 'tag');

function vaultValueHTML(f) {
  if (!f.value) return '<span style="color:var(--muted-2)">未填写</span>';
  if (f.type === 'password') return `<span class="vault-secret" data-secret="${f.id}">••••••••</span>`;
  if (f.type === 'url') {
    const href = /^https?:\/\//i.test(f.value) ? f.value : 'https://' + f.value;
    return `<a href="${esc(href)}" target="_blank" rel="noreferrer">${esc(f.value)}</a>`;
  }
  return `<span class="vault-text">${esc(f.value)}</span>`;
}

function viewProfile() {
  const p = COMPANY.profile;
  const fields = p.fields;
  const files = [...p.files].sort((a, b) => String(b.addedAt).localeCompare(String(a.addedAt)));
  const totalSize = files.reduce((s, f) => s + num(f.size), 0);

  const groups = FIELD_GROUPS.map(g => ({ name: g, items: fields.filter(f => f.group === g) })).filter(g => g.items.length);

  return `
  <div class="page-hero">
    <div>
      <h2>公司档案</h2>
      <p>${esc(COMPANY.name)} 的注册资料、银行与税务账号、归档文件，全部保存在本机</p>
    </div>
    <div style="display:flex;gap:8px">
      <button class="btn secondary" data-action="vault-add">${icon('plus', 15)} 添加账号条目</button>
      <button class="btn primary" data-action="file-upload">${icon('upload', 15)} 上传资料</button>
    </div>
  </div>

  <div class="card mb-14">
    <div class="card-hd">
      <div><div class="card-title">基本信息</div><div class="card-sub">用于合同、报表抬头与对外资料</div></div>
      <div class="card-actions"><button class="btn primary sm" data-action="profile-save">${icon('check', 14)} 保存</button></div>
    </div>
    <div class="card-bd">
      <div class="form-grid c3">
        <label class="field"><span class="lbl">公司法定名称</span><input type="text" data-profile="legalName" value="${esc(p.legalName)}" placeholder="注册证书上的全称"></label>
        <label class="field"><span class="lbl">注册号</span><input type="text" data-profile="regNo" value="${esc(p.regNo)}" placeholder="Company Registration No."></label>
        <label class="field"><span class="lbl">税号 / TIN</span><input type="text" data-profile="taxNo" value="${esc(p.taxNo || COMPANY.taxNo || '')}" placeholder="GRA TIN"></label>
        <label class="field span-2"><span class="lbl">注册地址</span><input type="text" data-profile="address" value="${esc(p.address)}" placeholder="街道、城市、地区"></label>
        <label class="field"><span class="lbl">联系电话</span><input type="text" data-profile="phone" value="${esc(p.phone)}" placeholder="+233 ..."></label>
        <label class="field"><span class="lbl">电子邮箱</span><input type="text" data-profile="email" value="${esc(p.email)}" placeholder="info@company.com"></label>
        <label class="field"><span class="lbl">网站</span><input type="text" data-profile="website" value="${esc(p.website)}" placeholder="https://"></label>
        <label class="field"><span class="lbl">行业 / 备注</span><input type="text" data-profile="note" value="${esc(p.note)}" placeholder="主营业务等"></label>
      </div>
    </div>
  </div>

  <div class="card mb-14">
    <div class="card-hd">
      <div><div class="card-title">账号与凭证</div><div class="card-sub">公户、网银、GRA 等登录信息，默认隐藏密码</div></div>
      <div class="card-actions">
        <button class="btn primary sm" data-action="vault-bundle">${icon('plus', 14)} 账号卡片</button>
        <button class="btn secondary sm" data-action="vault-templates">${icon('plus', 14)} 快速添加</button>
      </div>
    </div>
    <div class="card-bd flush">
      ${groups.length ? groups.map(g => `
        <div class="vault-group">
          <div class="vault-group-hd">${icon(groupIcon(g.name), 13)} ${g.name}<span>${g.items.length}</span></div>
          ${g.items.map(f => `
            <div class="vault-row">
              <span class="vault-ico">${icon(f.type === 'password' ? 'lock' : groupIcon(f.group), 15)}</span>
              <div class="vault-main">
                <div class="vault-label">${esc(f.label)}
                  ${f.type === 'password' ? '<span class="pill muted">密码</span>' : ''}
                  ${f.type === 'url' ? '<span class="pill info">网址</span>' : ''}
                </div>
                <div class="vault-value">${vaultValueHTML(f)}</div>
                ${f.note ? `<div class="vault-note">${esc(f.note)}</div>` : ''}
              </div>
              <div class="vault-actions">
                ${f.type === 'password' ? `<button class="icon-btn" title="显示/隐藏" data-action="vault-reveal" data-id="${f.id}">${icon('eye', 15)}</button>` : ''}
                ${f.value ? `<button class="icon-btn" title="复制" data-action="vault-copy" data-id="${f.id}">${icon('clipboard', 14)}</button>` : ''}
                <button class="icon-btn" title="编辑" data-action="vault-edit" data-id="${f.id}">${icon('edit', 14)}</button>
                <button class="icon-btn danger" title="删除" data-action="vault-del" data-id="${f.id}">${icon('trash', 14)}</button>
              </div>
            </div>`).join('')}
        </div>`).join('') : emptyState({
          ico: 'lock',
          title: '还没有账号条目',
          desc: '把对公账号、网银地址与密码、GRA 账号等记录在这里，随时查得到。',
          actions: `<button class="btn primary" data-action="vault-templates">${icon('plus', 15)} 快速添加</button>
                    <button class="btn secondary" data-action="vault-add">自定义条目</button>`
        })}
    </div>
  </div>

  <div class="card">
    <div class="card-hd">
      <div>
        <div class="card-title">文件资料</div>
        <div class="card-sub">${files.length} 个文件 · 共 ${fmtSize(totalSize)} · 支持 Word / PDF / Excel / 图片</div>
      </div>
      <div class="card-actions">
        ${DESKTOP ? `<button class="btn ghost sm" data-action="file-refresh">${icon('refresh', 14)} 刷新时间</button>` : ''}
        ${DESKTOP ? `<button class="btn ghost sm" data-action="open-company-folder">${icon('folder', 14)} 打开目录</button>` : ''}
        <button class="btn secondary sm" data-action="file-upload">${icon('upload', 14)} 上传</button>
      </div>
    </div>
    <div class="card-bd flush">
      ${files.length ? `<div class="file-list">
        ${files.map(f => {
          const k = fileKind(f.ext);
          return `<div class="file-row" data-file="${f.id}">
            <span class="file-ext ${k.tone}">${k.label}</span>
            <div class="file-main">
              <b>${esc(f.name)}</b>
              <span>${esc(f.original || ('文件.' + f.ext))} · ${fmtSize(f.size)}</span>
              <span class="file-time">上传 ${fmtDateTime(f.addedAt)} · 修改 ${fmtDateTime(f.mtime)}</span>
            </div>
            <div class="file-actions">
              <button class="btn sm secondary" data-action="file-open" data-id="${f.id}">打开</button>
              ${DESKTOP ? `<button class="icon-btn" title="在文件夹中显示" data-action="file-reveal" data-id="${f.id}">${icon('folder', 14)}</button>` : ''}
              <button class="icon-btn" title="重命名" data-action="file-rename" data-id="${f.id}">${icon('edit', 14)}</button>
              <button class="icon-btn danger" title="删除" data-action="file-del" data-id="${f.id}">${icon('trash', 14)}</button>
            </div>
          </div>`;
        }).join('')}
      </div>` : emptyState({
        ico: 'folder',
        title: '还没有上传资料',
        desc: '营业执照、公司章程、税务登记、银行开户许可、合同扫描件……都可以归档到这里。',
        actions: `<button class="btn primary" data-action="file-upload">${icon('upload', 15)} 上传资料</button>`
      })}
    </div>
  </div>

  <div class="alert mt-14">
    ${icon('shield', 15)}
    <div>账号与密码保存在本机数据文件中（不上传、不联网），界面默认隐藏密码。
      文件按「公司 / 年月 / 上传时间_名称」归档在数据目录的 <b>files</b> 子文件夹，
      ${DESKTOP && APP_INFO ? `<span class="mono" style="font-size:11px">${esc(APP_INFO.dataDir)}\\files\\${esc(COMPANY.id)}</span>，` : ''}
      把整个 data 目录放进网盘同步文件夹即可实现跨设备同步。</div>
  </div>`;
}

/* ============================================================================
   操作日志（需求13：仅管理员可见）
   ========================================================================== */

function filteredLogs() {
  const f = UI.logFilter || (UI.logFilter = { from: '', to: '', user: '', module: '', action: '' });
  return (DB.auditLogs || []).filter(l => {
    /* 逻辑删除：默认不显示，勾选「显示已删除」才出现（REQ-21） */
    if (l.deleted && !UI.logShowDeleted) return false;
    if (f.from && l.at.slice(0, 10) < f.from) return false;
    if (f.to && l.at.slice(0, 10) > f.to) return false;
    if (f.user && l.userId !== f.user) return false;
    if (f.module && l.module !== f.module) return false;
    if (f.action && l.action !== f.action) return false;
    return true;
  }).slice().reverse();
}

function viewLogs() {
  if (!isAdmin()) {
    return '<div class="card"><div class="card-bd" style="text-align:center;padding:40px;color:var(--muted)">操作日志仅管理员可见</div></div>';
  }
  const f = UI.logFilter || (UI.logFilter = { from: '', to: '', user: '', module: '', action: '' });
  const list = filteredLogs();
  const page = UI.logPage || 1, size = 30;
  const total = Math.max(1, Math.ceil(list.length / size));
  const rows = list.slice((page - 1) * size, page * size);

  const userOpts = ['<option value="">全部用户</option>'].concat(DB.users.map(u =>
    '<option value="' + u.id + '"' + (f.user === u.id ? ' selected' : '') + '>' + esc(u.displayName) + '</option>')).join('');
  const modOpts = ['<option value="">全部模块</option>'].concat(LOG_MODULES.map(mo =>
    '<option' + (f.module === mo ? ' selected' : '') + '>' + mo + '</option>')).join('');
  const actOpts = ['<option value="">全部操作</option>'].concat(['新增', '修改', '删除', '登录', '退出', '导入', '恢复', '清空', '备份'].map(a =>
    '<option' + (f.action === a ? ' selected' : '') + '>' + a + '</option>')).join('');

  const body = rows.length ? (
    '<div class="table-wrap"><table class="tbl">' +
    '<thead><tr><th style="width:140px">时间</th><th style="width:80px">用户</th><th style="width:80px">模块</th>' +
    '<th style="width:64px">操作</th><th>对象</th><th>变更前</th><th>变更后</th><th style="width:56px">结果</th>' +
    '<th style="width:130px">备注 / 操作</th></tr></thead><tbody>' +
    rows.map(l => '<tr' + (l.deleted ? ' style="opacity:.55"' : '') + '>' +
      '<td class="nowrap" style="font-size:11.5px;color:var(--muted)">' + fmtDateTime(l.at) + '</td>' +
      '<td class="nowrap">' + esc(l.userName) + '</td>' +
      '<td class="nowrap">' + esc(l.module) + '</td>' +
      '<td class="nowrap"><span class="pill ' + (l.action === '删除' || l.action === '清空' ? 'danger' : l.action === '新增' ? 'ok' : 'muted') + '">' + esc(l.action) + '</span></td>' +
      '<td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(l.target) +
        (l.deleted ? ' <span class="pill danger">已删除</span>' : '') + '</td>' +
      '<td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted-2);font-size:11.5px">' + esc(l.before || '—') + '</td>' +
      '<td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted-2);font-size:11.5px">' + esc(l.after || '—') + '</td>' +
      '<td>' + (l.result === 'fail' ? '<span class="pill danger">失败</span>' : '<span class="pill ok">成功</span>') + '</td>' +
      '<td class="nowrap">' +
        (l.note
          ? '<div class="cell-sub" style="max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(l.note) + '">' + esc(l.note) + '</div>'
          : '') +
        (l.deleted ? '' :
          '<button class="icon-btn" title="添加备注" data-action="log-note" data-id="' + l.id + '">' + icon('edit', 13) + '</button>' +
          '<button class="icon-btn danger" title="删除这条日志" data-action="log-del" data-id="' + l.id + '">' + icon('trash', 13) + '</button>') +
      '</td>' +
    '</tr>').join('') + '</tbody></table></div>'
  ) : emptyState({ ico: 'file', title: '暂无日志', desc: '新增、修改、删除等操作会自动记录在这里' });

  const pager = total > 1 ? (
    '<div class="card-ft" style="display:flex;justify-content:center;gap:6px;padding:10px;flex-wrap:wrap">' +
    Array.from({ length: total }, (_, i) =>
      '<button class="btn ' + (i + 1 === page ? 'primary' : 'secondary') + ' sm" data-action="log-page" data-page="' + (i + 1) + '">' + (i + 1) + '</button>'
    ).join('') + '</div>'
  ) : '';

  return `
  <div class="page-hero">
    <div><h2>操作日志</h2><p>记录所有更改数据的操作，仅管理员可查看与清理</p></div>
    <div style="display:flex;gap:8px">
      <button class="btn secondary" data-action="log-export">${icon('download', 14)} 导出</button>
      <button class="btn danger" data-action="log-clear">${icon('trash', 14)} 清理日志</button>
    </div>
  </div>

  <div class="toolbar no-print">
    <div class="tb-filters">
      <label class="field"><label>开始</label><input type="date" data-log="from" value="${f.from}"></label>
      <label class="field"><label>结束</label><input type="date" data-log="to" value="${f.to}"></label>
      <label class="field"><label>用户</label><select data-log="user">${userOpts}</select></label>
      <label class="field"><label>模块</label><select data-log="module">${modOpts}</select></label>
      <label class="field"><label>操作</label><select data-log="action">${actOpts}</select></label>
    </div>
    <div class="tb-actions">
      <label class="switch" style="margin-right:10px"><input type="checkbox" data-log-show-del ${UI.logShowDeleted ? 'checked' : ''}><span class="track"></span><span>显示已删除</span></label>
      <button class="btn secondary" data-action="log-reset">重置</button>
    </div>
  </div>

  <div class="card">
    <div class="card-hd">
      <div><div class="card-title">共 ${list.length} 条</div><div class="card-sub">最多保留最近 5000 条</div></div>
    </div>
    <div class="card-bd flush">${body}</div>
    ${pager}
  </div>`;
}

/* ============================================================================
   v4.3 业务闭环页面
   ========================================================================== */

/* ------------------------------ 往来单位 ------------------------------ */
function viewParties() {
  const f = UI.partyFilter || (UI.partyFilter = { keyword: '', type: '', active: '' });
  const list = ensurePartyList(COMPANY).filter(p => {
    if (f.type && p.type !== f.type) return false;
    if (f.active === '1' && p.active === false) return false;
    if (f.active === '0' && p.active !== false) return false;
    if (f.keyword) {
      const k = f.keyword.toLowerCase();
      const hay = [p.name, p.contact, p.phone, p.taxNo].join(' ').toLowerCase();
      if (!hay.includes(k)) return false;
    }
    return true;
  });

  const rows = list.map(p => {
    const txCount = COMPANY.transactions.filter(t => t.partyId === p.id).length;
    return `<tr>
      <td><div class="cell-main">${esc(p.name)}</div><div class="cell-sub">${esc(p.note || '—')}</div></td>
      <td><span class="pill muted">${PARTY_TYPES[p.type] || '其他'}</span></td>
      <td class="nowrap">${esc(p.contact || '—')}</td>
      <td class="nowrap">${esc(p.phone || '—')}</td>
      <td class="nowrap" style="font-size:11.5px;color:var(--muted-2)">${esc(p.taxNo || '—')}</td>
      <td class="tr">${txCount}</td>
      <td>${p.active === false ? '<span class="pill muted">已停用</span>' : '<span class="pill ok">启用</span>'}</td>
      <td class="nowrap">
        <button class="icon-btn" data-action="edit-party" data-id="${p.id}" title="编辑">${icon('edit', 14)}</button>
        <button class="icon-btn" data-action="toggle-party" data-id="${p.id}" title="${p.active === false ? '启用' : '停用'}">${icon(p.active === false ? 'check' : 'lock', 14)}</button>
        <button class="icon-btn danger" data-action="del-party" data-id="${p.id}" title="删除">${icon('trash', 14)}</button>
      </td>
    </tr>`;
  }).join('');

  return `
  <div class="page-hero">
    <div><h2>往来单位</h2><p>客户、供应商、合作方档案，可关联流水与凭证</p></div>
    <div><button class="btn primary" data-action="new-party">${icon('plus', 15)} 新增单位</button></div>
  </div>
  <div class="toolbar no-print">
    <div class="tb-filters">
      <label class="field grow"><label>关键字</label>
        <div class="search-field">${icon('search', 14)}<input type="search" data-party="keyword" value="${esc(f.keyword)}" placeholder="名称 / 联系人 / 电话 / 税号"></div>
      </label>
      <label class="field"><label>类型</label><select data-party="type">
        <option value="">全部类型</option>
        ${Object.entries(PARTY_TYPES).map(([k, v]) => `<option value="${k}" ${f.type === k ? 'selected' : ''}>${v}</option>`).join('')}
      </select></label>
      <label class="field"><label>状态</label><select data-party="active">
        <option value="" ${f.active === '' ? 'selected' : ''}>全部</option>
        <option value="1" ${f.active === '1' ? 'selected' : ''}>启用</option>
        <option value="0" ${f.active === '0' ? 'selected' : ''}>已停用</option>
      </select></label>
    </div>
    <div class="tb-actions"><button class="btn secondary" data-action="party-reset">重置</button></div>
  </div>
  <div class="card">
    <div class="card-hd"><div><div class="card-title">共 ${list.length} 个单位</div><div class="card-sub">停用不影响历史流水</div></div></div>
    <div class="card-bd flush">
      ${rows ? `<div class="table-wrap"><table class="tbl">
        <thead><tr><th>名称</th><th style="width:80px">类型</th><th style="width:100px">联系人</th>
          <th style="width:130px">电话</th><th style="width:140px">税号</th><th class="tr" style="width:70px">流水</th>
          <th style="width:80px">状态</th><th style="width:110px">操作</th></tr></thead>
        <tbody>${rows}</tbody></table></div>`
      : emptyState({ ico: 'users', title: '还没有往来单位', desc: '把常用客户、供应商建好，记账时可直接选择，也能按单位统计',
          actions: `<button class="btn primary" data-action="new-party">${icon('plus', 15)} 新增单位</button>` })}
    </div>
  </div>`;
}

/* ------------------------------ 凭证查询 ------------------------------ */
function viewVouchers() {
  const f = UI.voucherFilter || (UI.voucherFilter = { keyword: '', from: '', to: '' });
  const all = allVouchers().filter(v => {
    const t = v.t;
    if (f.from && t.date < f.from) return false;
    if (f.to && t.date > f.to) return false;
    if (f.keyword) {
      const k = f.keyword.toLowerCase();
      const hay = [t.voucherNo, t.summary, t.counterparty, t.category, v.co.name].join(' ').toLowerCase();
      if (!hay.includes(k)) return false;
    }
    return true;
  });

  const rows = all.slice(0, 200).map(v => {
    const t = v.t;
    return `<tr>
      <td class="nowrap" style="font-family:var(--mono);font-size:12px">${esc(t.voucherNo)}</td>
      <td class="num nowrap">${t.date}</td>
      <td><span class="pill ${t.type === 'in' ? 'in' : t.type === 'out' ? 'out' : 'move'}">${txTypeLabel(t)}</span></td>
      <td>${esc(t.category || '—')}</td>
      <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.summary || '—')}</td>
      <td class="nowrap">${esc(t.counterparty || '—')}</td>
      <td class="tr cell-amount ${t.type === 'in' ? 'in' : t.type === 'out' ? 'out' : 'move'}">${fmtPlain(t.amount)}</td>
      <td class="nowrap" style="font-size:11.5px;color:var(--muted-2)">${esc(v.co.name)}</td>
    </tr>`;
  }).join('');

  return `
  <div class="page-hero">
    <div><h2>凭证查询</h2><p>按凭证号、日期、摘要、往来单位检索全部单据</p></div>
    <div><button class="btn secondary" data-action="voucher-export">${icon('download', 14)} 导出</button></div>
  </div>
  <div class="toolbar no-print">
    <div class="tb-filters">
      <label class="field"><label>开始</label><input type="date" data-voucher="from" value="${f.from}"></label>
      <label class="field"><label>结束</label><input type="date" data-voucher="to" value="${f.to}"></label>
      <label class="field grow"><label>关键字</label>
        <div class="search-field">${icon('search', 14)}<input type="search" data-voucher="keyword" value="${esc(f.keyword)}" placeholder="凭证号 / 摘要 / 往来单位"></div>
      </label>
    </div>
    <div class="tb-actions"><button class="btn secondary" data-action="voucher-reset">重置</button></div>
  </div>
  <div class="card">
    <div class="card-hd"><div><div class="card-title">共 ${all.length} 张凭证</div><div class="card-sub">${all.length > 200 ? '仅显示最近 200 张，请用筛选缩小范围' : '按日期倒序'}</div></div></div>
    <div class="card-bd flush">
      ${rows ? `<div class="table-wrap"><table class="tbl">
        <thead><tr><th style="width:130px">凭证号</th><th style="width:100px">日期</th><th style="width:80px">类型</th>
          <th style="width:120px">分类</th><th>摘要</th><th style="width:140px">往来单位</th>
          <th class="tr" style="width:110px">金额</th><th style="width:110px">公司</th></tr></thead>
        <tbody>${rows}</tbody></table></div>`
      : emptyState({ ico: 'file', title: '没有匹配的凭证', desc: '记账时留空凭证号会自动生成，也可以手动填写' })}
    </div>
  </div>`;
}

/* ------------------------------ 借支备用金 ------------------------------ */
function viewAdvances() {
  const allList = ensureAdvanceList(COMPANY).slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const fs = ledgerState('advance');
  const filtered = applyLedgerFilter(allList, fs, a => ({
    date: a.date,
    status: advanceInfo(a).status,
    text: `${a.userName || ''} ${a.reason || ''}`
  }));
  const PAGE = 15;
  const page = Math.min(Math.max(1, fs.page || 1), Math.max(1, Math.ceil(filtered.length / PAGE)));
  const list = filtered.slice((page - 1) * PAGE, page * PAGE);

  /* 顶部汇总仍按全量统计，不受筛选影响 */
  const sum = allList.reduce((s, a) => {
    const i = advanceInfo(a);
    if (i.status === 'issued') { s.issued += num(a.amount); s.remain += i.remain; }
    return s;
  }, { issued: 0, remain: 0 });

  const rows = list.map(a => {
    const i = advanceInfo(a);
    return `<tr>
      <td class="nowrap">${esc(a.userName)}</td>
      <td class="num nowrap">${a.date}</td>
      <td class="tr">${fmt(a.amount)}</td>
      <td class="tr" style="color:${i.over ? 'var(--danger)' : 'var(--muted)'}">${fmt(i.used)}</td>
      <td class="tr" style="color:${i.over ? 'var(--danger)' : 'var(--ink)'}">${fmt(i.remain)}</td>
      <td><span class="pill ${i.status === 'closed' ? 'ok' : i.status === 'issued' ? 'warn' : 'muted'}">${ADVANCE_STATUS[i.status]}</span></td>
      <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(a.reason || '—')}</td>
      <td class="nowrap">
        ${i.status === 'pending' ? `<button class="btn sm primary" data-action="issue-advance" data-id="${a.id}">发放</button>` : ''}
        ${i.status === 'issued' ? `<button class="btn sm secondary" data-action="close-advance" data-id="${a.id}">核销</button>` : ''}
        ${i.drawCount ? `<button class="icon-btn" title="撤销最近一次核销" data-action="undo-advance" data-id="${a.id}">${icon('rotate', 14)}</button>` : ''}
        <button class="icon-btn danger" data-action="del-advance" data-id="${a.id}" title="删除">${icon('trash', 14)}</button>
      </td>
    </tr>`;
  }).join('');

  return `
  <div class="page-hero">
    <div><h2>借支备用金</h2><p>员工预支、使用、核销的全流程记录</p></div>
    <div><button class="btn primary" data-action="new-advance">${icon('plus', 15)} 申请借支</button></div>
  </div>
  <div class="stat-grid mb-14">
    <div class="stat hero is-clickable" data-action="f-quick" data-f="advance" data-k="status" data-v="issued" title="只看已发放未核销">
      <div class="stat-top"><span class="stat-label">已发放未核销</span><span class="stat-ico">${icon('wallet', 15)}</span></div>
      <div class="stat-value" data-count="${sum.issued}">${fmt(sum.issued)}</div><div class="stat-foot">共 ${allList.filter(a => a.status === 'issued').length} 笔</div></div>
    <div class="stat is-clickable" data-action="f-quick" data-f="advance" data-k="status" data-v="issued" title="只看待核销">
      <div class="stat-top"><span class="stat-label">待核销余额</span><span class="stat-ico out">${icon('receipt', 15)}</span></div>
      <div class="stat-value sm">${fmt(sum.remain)}</div><div class="stat-foot">核销后清零</div></div>
    <div class="stat is-clickable" data-action="f-quick" data-f="advance" data-k="__all" data-v="1" title="清空筛选，显示全部">
      <div class="stat-top"><span class="stat-label">全部笔数</span><span class="stat-ico">${icon('layers', 15)}</span></div>
      <div class="stat-value sm">${allList.length}</div><div class="stat-foot">含已核销</div></div>
  </div>

  ${filterBar('advance', [
    { k: 'from', t: 'date', label: '借支日期起' },
    { k: 'to', t: 'date', label: '借支日期止' },
    { k: 'status', t: 'select', label: '状态', opts: [['', '全部'], ['pending', '待发放'], ['issued', '已发放未核销'], ['closed', '已核销']] },
    { k: 'kw', t: 'text', label: '员工 / 事由', ph: '输入关键字' }
  ], fs)}
  <div class="card">
    <div class="card-bd flush">
      ${rows ? `<div class="table-wrap"><table class="tbl">
        <thead><tr><th>员工</th><th style="width:100px">日期</th><th class="tr" style="width:110px">借支金额</th>
          <th class="tr" style="width:110px">已用</th><th class="tr" style="width:110px">余额</th><th style="width:90px">状态</th>
          <th>事由</th><th style="width:140px">操作</th></tr></thead>
        <tbody>${rows}</tbody></table></div>`
      : emptyState({ ico: 'wallet', title: '还没有借支记录', desc: '员工预支差旅、采购等费用时在这里登记，发放后自动生成支出流水',
          actions: `<button class="btn primary" data-action="new-advance">${icon('plus', 15)} 申请借支</button>` })}
      ${filtered.length > PAGE ? pager(filtered.length, page, PAGE, 'advance-page') : ''}
    </div>
  </div>`;
}

/* ------------------------------ 票据未回 ------------------------------ */
function viewInvoices() {
  const allList = ensureInvoiceList(COMPANY).slice().sort((a, b) => (b.payDate || '').localeCompare(a.payDate || ''));
  const fs = ledgerState('invoice');
  const filtered = applyLedgerFilter(allList, fs, i => ({
    date: i.payDate,
    status: i.status,
    overdue: invoiceOverdue(i),
    text: `${i.party || ''} ${i.number || ''} ${i.note || ''}`
  }));
  const PAGE = 15;
  const page = Math.min(Math.max(1, fs.page || 1), Math.max(1, Math.ceil(filtered.length / PAGE)));
  const list = filtered.slice((page - 1) * PAGE, page * PAGE);

  const pend = allList.filter(i => i.status !== 'done');
  const pendAmt = round2(pend.reduce((s, i) => s + num(i.amount), 0));
  const over = allList.filter(invoiceOverdue);

  const rows = list.map(i => {
    const od = invoiceOverdue(i);
    return `<tr>
      <td class="num nowrap">${i.payDate || '—'}</td>
      <td>${esc(i.party || '—')}</td>
      <td class="tr">${fmt(i.amount)}</td>
      <td class="num nowrap">${i.expectDate || '—'}</td>
      <td class="num nowrap">${i.actualDate || '—'}</td>
      <td><span class="pill ${i.status === 'done' ? 'ok' : i.status === 'partial' ? 'warn' : 'danger'}">${INVOICE_STATUS[i.status] || '未回'}</span></td>
      <td>${od ? '<span class="pill danger">逾期</span>' : ''}</td>
      <td class="nowrap">
        ${i.status !== 'done' ? `<button class="btn sm primary" data-action="inv-receive" data-id="${i.id}">回票</button> ` : ''}
        <button class="icon-btn" data-action="edit-invoice" data-id="${i.id}" title="编辑">${icon('edit', 14)}</button>
        <button class="icon-btn danger" data-action="del-invoice" data-id="${i.id}" title="删除">${icon('trash', 14)}</button>
      </td>
    </tr>`;
  }).join('');

  return `
  <div class="page-hero">
    <div><h2>票据未回</h2><p>付款后跟踪发票是否收回，避免漏票</p></div>
    <div><button class="btn primary" data-action="new-invoice">${icon('plus', 15)} 登记未回票据</button></div>
  </div>
  <div class="stat-grid mb-14">
    <div class="stat hero is-clickable" data-action="f-quick" data-f="invoice" data-k="status" data-v="none" title="只看未回票据">
      <div class="stat-top"><span class="stat-label">未回票据金额</span><span class="stat-ico">${icon('receipt', 15)}</span></div>
      <div class="stat-value" data-count="${pendAmt}">${fmt(pendAmt)}</div><div class="stat-foot">共 ${pend.length} 张</div></div>
    <div class="stat is-clickable" data-action="f-quick" data-f="invoice" data-k="overdue" data-v="1" title="只看逾期未回">
      <div class="stat-top"><span class="stat-label">逾期未回</span><span class="stat-ico out">${icon('alert', 15)}</span></div>
      <div class="stat-value sm" style="color:${over.length ? 'var(--danger)' : ''}">${over.length}</div><div class="stat-foot">超过预计回票日</div></div>
    <div class="stat is-clickable" data-action="f-quick" data-f="invoice" data-k="status" data-v="done" title="只看已回票据">
      <div class="stat-top"><span class="stat-label">已回</span><span class="stat-ico">${icon('check', 15)}</span></div>
      <div class="stat-value sm">${allList.filter(i => i.status === 'done').length}</div><div class="stat-foot">全部 ${allList.length} 张</div></div>
  </div>

  ${filterBar('invoice', [
    { k: 'from', t: 'date', label: '付款日期起' },
    { k: 'to', t: 'date', label: '付款日期止' },
    { k: 'status', t: 'select', label: '状态', opts: [['', '全部'], ['none', '未回'], ['partial', '部分回'], ['done', '已回']] },
    { k: 'kw', t: 'text', label: '对方 / 票号', ph: '输入关键字' }
  ], fs)}
  <div class="card">
    <div class="card-bd flush">
      ${rows ? `<div class="table-wrap"><table class="tbl">
        <thead><tr><th style="width:110px">付款日期</th><th>往来单位</th><th class="tr" style="width:110px">金额</th>
          <th style="width:110px">预计回票</th><th style="width:110px">实际回票</th><th style="width:90px">状态</th>
          <th style="width:70px">提醒</th><th style="width:90px">操作</th></tr></thead>
        <tbody>${rows}</tbody></table></div>`
      : emptyState({ ico: 'receipt', title: '没有未回票据', desc: '付款后如果发票没到，在这里登记，到期会自动提醒',
          actions: `<button class="btn primary" data-action="new-invoice">${icon('plus', 15)} 登记未回票据</button>` })}
      ${filtered.length > PAGE ? pager(filtered.length, page, PAGE, 'invoice-page') : ''}
    </div>
  </div>`;
}

/* ============================================================================
   v4.4 项目（按资金使用） / 集团指标下钻
   ========================================================================== */

/* ------------------------------ 项目 ------------------------------ */
function viewProjects() {
  const list = ensureProjectList(COMPANY).slice().sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));
  const rows = list.map(p => {
    const u = projectUsage(p.id);
    const budget = num(p.budget);
    const rate = budget > 0 ? Math.min(999, Math.round(u.out / budget * 100)) : 0;
    const over = budget > 0 && u.out > budget;
    return `<tr>
      <td><div class="cell-main">${esc(p.name)}</div><div class="cell-sub">${esc(p.code || '—')}</div></td>
      <td><span class="pill ${p.status === 'done' ? 'muted' : p.status === 'paused' ? 'warn' : 'ok'}">${PROJECT_STATUS[p.status] || '进行中'}</span></td>
      <td class="tr">${budget ? fmt(budget) : '—'}</td>
      <td class="tr">${fmt(u.out)}</td>
      <td class="tr" style="color:${over ? 'var(--danger)' : 'var(--muted)'}">${budget ? fmt(round2(budget - u.out)) : '—'}</td>
      <td style="width:150px">
        <div class="progress" style="height:6px"><i class="${over ? 'danger' : rate > 80 ? 'warn' : 'ok'}" style="width:${Math.min(100, rate)}%"></i></div>
        <div style="font-size:10.5px;color:var(--muted-2);margin-top:3px">${budget ? rate + '%' : '未设预算'}</div>
      </td>
      <td class="tr">${u.count}</td>
      <td class="nowrap">
        <button class="icon-btn" data-action="edit-project" data-id="${p.id}" title="编辑">${icon('edit', 14)}</button>
        <button class="icon-btn danger" data-action="del-project" data-id="${p.id}" title="删除">${icon('trash', 14)}</button>
      </td>
    </tr>`;
  }).join('');

  const totalBudget = list.reduce((s, p) => s + num(p.budget), 0);
  const totalUsed = list.reduce((s, p) => s + projectUsage(p.id).out, 0);

  return `
  <div class="page-hero">
    <div><h2>项目</h2><p>按项目归集资金使用，看清每个项目花了多少</p></div>
    <div><button class="btn primary" data-action="new-project">${icon('plus', 15)} 新建项目</button></div>
  </div>
  <div class="stat-grid mb-14">
    <div class="stat hero"><div class="stat-top"><span class="stat-label">项目总支出</span><span class="stat-ico">${icon('wallet', 15)}</span></div>
      <div class="stat-value" data-count="${totalUsed}">${fmt(totalUsed)}</div><div class="stat-foot">共 ${list.length} 个项目</div></div>
    <div class="stat"><div class="stat-top"><span class="stat-label">预算合计</span><span class="stat-ico">${icon('budget', 15)}</span></div>
      <div class="stat-value sm">${fmt(totalBudget)}</div><div class="stat-foot">${totalBudget ? Math.round(totalUsed / totalBudget * 100) + '% 已使用' : '未设预算'}</div></div>
    <div class="stat"><div class="stat-top"><span class="stat-label">进行中</span><span class="stat-ico">${icon('layers', 15)}</span></div>
      <div class="stat-value sm">${list.filter(p => (p.status || 'active') === 'active').length}</div><div class="stat-foot">含暂停 ${list.filter(p => p.status === 'paused').length}</div></div>
  </div>
  <div class="card">
    <div class="card-bd flush">
      ${rows ? `<div class="table-wrap"><table class="tbl">
        <thead><tr><th>项目</th><th style="width:80px">状态</th><th class="tr" style="width:110px">预算</th>
          <th class="tr" style="width:110px">已支出</th><th class="tr" style="width:110px">剩余</th>
          <th style="width:150px">执行率</th><th class="tr" style="width:60px">笔数</th><th style="width:80px">操作</th></tr></thead>
        <tbody>${rows}</tbody></table></div>`
      : emptyState({ ico: 'layers', title: '还没有项目', desc: '建好项目后，记账时可以选择归属项目，自动统计每个项目的资金使用',
          actions: `<button class="btn primary" data-action="new-project">${icon('plus', 15)} 新建项目</button>` })}
    </div>
  </div>`;
}

/* ------------------------------ 集团指标下钻 ------------------------------ */
function viewDrill() {
  const metric = UI.drillMetric || 'total';
  const name = DRILL_METRICS[metric] || '集团资金总额';
  const rows = drillRows(metric);
  const sum = rows.reduce((s, r) => s + r.value, 0);
  const max = Math.max(1, ...rows.map(r => Math.abs(r.value)));

  const body = rows.map(r => {
    const pct = sum !== 0 ? (r.value / sum * 100) : 0;
    const w = Math.round(Math.abs(r.value) / max * 100);
    return `<tr>
      <td><div class="cell-main">${esc(r.co.name)}${r.co.isParent ? ' <span class="pill move">总公司</span>' : ''}</div>
        <div class="cell-sub">${r.co.accounts.length} 个账户</div></td>
      <td class="tr cell-amount ${r.value >= 0 ? 'in' : 'out'}">${fmt(r.value)}</td>
      <td class="tr" style="color:var(--muted)">${sum !== 0 ? pct.toFixed(1) + '%' : '—'}</td>
      <td style="width:220px">
        <div class="progress" style="height:8px"><i class="${r.value >= 0 ? 'ok' : 'danger'}" style="width:${w}%"></i></div>
      </td>
      <td class="nowrap">
        <button class="btn sm secondary" data-action="drill-open" data-id="${r.co.id}" data-metric="${metric}">查看明细</button>
      </td>
    </tr>`;
  }).join('');

  return `
  <div class="crumb no-print">
    <button class="crumb-link" data-action="drill-back">集团总览</button>
    <span class="crumb-sep">›</span>
    <span class="crumb-cur">${esc(name)}</span>
  </div>
  <div class="page-hero">
    <div><h2>${esc(name)}</h2><p>按公司拆解，点击「查看明细」进入该公司原始流水</p></div>
    <div><button class="btn secondary" data-action="drill-back">${icon('arrowLeft', 14)} 返回集团总览</button></div>
  </div>
  <div class="stat-grid mb-14">
    <div class="stat hero"><div class="stat-top"><span class="stat-label">${esc(name)}</span><span class="stat-ico">${icon('layers', 15)}</span></div>
      <div class="stat-value" data-count="${sum}">${fmt(sum)}</div><div class="stat-foot">${rows.length} 家公司合计</div></div>
  </div>
  <div class="card">
    <div class="card-hd"><div><div class="card-title">各公司构成</div><div class="card-sub">按金额绝对值排序</div></div></div>
    <div class="card-bd flush">
      ${rows.length ? `<div class="table-wrap"><table class="tbl">
        <thead><tr><th>公司</th><th class="tr" style="width:140px">金额</th><th class="tr" style="width:80px">占比</th>
          <th style="width:220px">对比</th><th style="width:110px">操作</th></tr></thead>
        <tbody>${body}</tbody></table></div>`
      : emptyState({ ico: 'layers', title: '暂无数据', desc: '还没有公司或没有可汇总的资金' })}
    </div>
  </div>`;
}

/* ============================================================================
   v4.5 云盘备份（WebDAV / Google Drive）
   ========================================================================== */

const BACKUP_FREQ = {
  hourly: '每小时', '6h': '每 6 小时', daily: '每天', weekly: '每周', custom: '自定义'
};

async function loadBackupCfg(force) {
  if (!DESKTOP) return;
  if (UI.backupCfg && !force) return;
  try {
    UI.backupCfg = await window.desktop.backup.config();
    renderView();
  } catch (e) {
    toast('读取备份配置失败：' + e.message, 'err');
  }
}

function viewBackup() {
  const MAXV = 7;
  if (!DESKTOP) {
    return `<div class="card"><div class="card-bd" style="text-align:center;padding:44px;color:var(--muted)">
      云盘备份仅在桌面版可用。</div></div>`;
  }
  const c = UI.backupCfg;
  if (!c) {
    return `<div class="card"><div class="card-bd" style="text-align:center;padding:44px;color:var(--muted)">正在读取备份配置…</div></div>`;
  }

  const prov = c.provider || 'none';
  const hist = (c.history || []).slice(0, 12);
  const histRows = hist.map(h => `<tr>
      <td class="nowrap" style="font-size:11.5px">${fmtDateTime(h.at)}</td>
      <td>${h.result === 'ok' ? '<span class="pill ok">成功</span>' : '<span class="pill danger">失败</span>'}</td>
      <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11.5px">${esc(h.name || '—')}</td>
      <td class="tr">${h.size ? (h.size / 1024).toFixed(0) + ' KB' : '—'}</td>
      <td style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--danger);font-size:11.5px">${esc(h.error || '')}</td>
    </tr>`).join('');

  return `
  <div class="page-hero">
    <div><h2>云盘备份</h2><p>把账本与附件自动备份到 WebDAV 或 Google Drive</p></div>
    <div style="display:flex;gap:8px">
      <button class="btn primary" data-action="cloud-backup-now" ${prov === 'none' ? 'disabled' : ''}>${icon('upload', 14)} 立即备份到云盘</button>
    </div>
  </div>

  <div class="card mb-14">
    <div class="card-hd"><div><div class="card-title">备份通道</div><div class="card-sub">凭据加密保存在本机，不会明文落盘</div></div></div>
    <div class="card-bd">
      <div class="seg" style="width:auto;margin-bottom:16px">
        <button class="seg-btn ${prov === 'none' ? 'is-active' : ''}" data-action="backup-provider" data-p="none">不启用</button>
        <button class="seg-btn ${prov === 'webdav' ? 'is-active' : ''}" data-action="backup-provider" data-p="webdav">WebDAV</button>
        <button class="seg-btn ${prov === 'gdrive' ? 'is-active' : ''}" data-action="backup-provider" data-p="gdrive">Google Drive</button>
      </div>

      ${prov === 'webdav' ? `
      <div class="form-grid">
        <label class="field span-2"><span class="lbl">WebDAV 地址</span>
          <input type="text" id="dav-url" value="${esc((c.webdav || {}).url || '')}" placeholder="https://dav.example.com/remote.php/dav/files/me/fundmerge"></label>
        <label class="field"><span class="lbl">用户名</span>
          <input type="text" id="dav-user" value="${esc((c.webdav || {}).username || '')}" autocomplete="off"></label>
        <label class="field"><span class="lbl">密码 ${(c.webdav || {}).hasPassword ? '（已保存，留空不修改）' : ''}</span>
          <input type="password" id="dav-pass" placeholder="${(c.webdav || {}).hasPassword ? '••••••••' : '请输入密码'}" autocomplete="new-password"></label>
      </div>
      <div class="note" style="margin-top:10px;font-size:12px">
        <b>坚果云用户注意：</b>这里的密码要填<b>应用密码</b>，不是登录密码。获取方式：
        坚果云网页版 → 右上角账户 → 设置 → 安全选项 → 第三方应用管理 → 添加应用 → 生成密码。
        地址填 <code>https://dav.jianguoyun.com/dav/</code>。
      </div>
      <div class="setting-actions" style="margin-top:12px">
        <button class="btn secondary sm" data-action="backup-test-dav">测试连接</button>
        <span class="hint" id="dav-test-hint"></span>
      </div>` : ''}

      ${prov === 'gdrive' ? `
      <div class="form-grid">
        <label class="field span-2"><span class="lbl">OAuth 客户端 ID</span>
          <input type="text" id="gd-id" value="${esc((c.gdrive || {}).clientId || '')}" placeholder="xxx.apps.googleusercontent.com"></label>
        <label class="field span-2"><span class="lbl">客户端密钥 ${(c.gdrive || {}).authorized ? '（已授权）' : ''}</span>
          <input type="password" id="gd-secret" placeholder="Client Secret" autocomplete="new-password"></label>
        <label class="field span-2"><span class="lbl">目标文件夹 ID（可选）</span>
          <input type="text" id="gd-folder" value="${esc((c.gdrive || {}).folderId || '')}" placeholder="留空则存到「我的云端硬盘」根目录"></label>
      </div>
      <div class="setting-actions" style="margin-top:12px">
        <button class="btn secondary sm" data-action="backup-gdrive-auth">${(c.gdrive || {}).authorized ? '重新授权' : '开始授权'}</button>
        <span class="hint" id="gd-auth-hint">${(c.gdrive || {}).authorized ? '已授权，可直接备份' : '需要自备 Google OAuth 客户端'}</span>
      </div>
      <div id="gd-device" class="note" style="display:none"></div>
      <div class="note" style="margin-top:10px">
        <b>说明：</b>Google Drive 需要你在 Google Cloud Console 建一个「电视和受限输入设备」类型的 OAuth 客户端，
        把 Client ID / Secret 填进来，然后点「开始授权」，按提示在浏览器里输入设备码。
      </div>` : ''}

      ${prov === 'none' ? '<p style="color:var(--muted);font-size:13px">选择一种云盘后即可配置自动备份。不启用时软件完全离线，不会发起任何网络请求。</p>' : ''}
    </div>
  </div>

  ${prov !== 'none' ? `
  <div class="card mb-14">
    <div class="card-hd"><div><div class="card-title">自动备份</div><div class="card-sub">到点自动执行，失败会提示</div></div></div>
    <div class="card-bd">
      <div class="form-grid">
        <label class="field"><span class="lbl">频率</span>
          <select id="bk-freq">${Object.entries(BACKUP_FREQ).map(([k, v]) =>
            `<option value="${k}" ${c.frequency === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label class="field"><span class="lbl">自定义间隔（小时）</span>
          <input type="number" id="bk-hours" min="1" max="720" value="${c.customHours || 24}"></label>
        <div class="field span-2">
          <span class="lbl">备份内容</span>
          <div style="display:flex;gap:18px;margin-top:6px">
            <label class="switch"><input type="checkbox" id="bk-data" ${c.scopeData !== false ? 'checked' : ''}><span class="track"></span><span>账本数据</span></label>
            <label class="switch"><input type="checkbox" id="bk-files" ${c.scopeFiles !== false ? 'checked' : ''}><span class="track"></span><span>附件文件</span></label>
            <label class="switch"><input type="checkbox" id="bk-enable" ${c.enabled ? 'checked' : ''}><span class="track"></span><span>开启自动备份</span></label>
          </div>
        </div>
      </div>
      <div class="setting-actions" style="margin-top:14px">
        <button class="btn primary sm" data-action="backup-save">保存设置</button>
        <span class="hint">${c.lastRun ? '上次：' + fmtDateTime(c.lastRun) + ' · ' + (c.lastResult === 'ok' ? '成功' : '失败') : '尚未执行过备份'}</span>
      </div>
      ${c.lastError ? `<div class="warn" style="margin-top:10px">上次失败原因：${esc(c.lastError)}</div>` : ''}
    </div>
  </div>` : ''}

  <div class="card">
    <div class="card-hd">
      <div><div class="card-title">账套版本池</div>
        <div class="card-sub">手动与自动备份统一计入，最多保留 ${MAXV} 个版本，超出自动删除最旧</div></div>
      <div class="card-sub" style="flex:none" id="bk-ver-count">当前 ${(UI.backupVersions || []).length} / ${MAXV}</div>
    </div>
    <div class="card-bd flush" id="bk-versions">${backupVersionsHTML()}</div>
  </div>`;
}

/* 版本池内容单独抽出来：只刷新这一块，避免整页重绘（整页重绘会重置表单焦点） */
function backupVersionsHTML() {
  const MAXV = 7;
  if (!UI.backupVersionsLoaded) {
    return `<div style="padding:28px;text-align:center;color:var(--muted);font-size:13px">正在读取版本列表…</div>`;
  }
  const list = UI.backupVersions || [];
  if (!list.length) return emptyState({ ico: 'upload', title: '还没有备份版本', desc: '配置云盘后点「立即备份到云盘」，或开启自动备份' });
  return '<div class="table-wrap"><table class="tbl"><thead><tr>' +
    '<th style="width:56px">版本</th><th style="width:70px">类型</th><th style="width:150px">备份时间</th>' +
    '<th class="tr" style="width:100px">大小</th><th>云盘位置</th><th style="width:190px">操作</th></tr></thead><tbody>' +
    list.map(x => '<tr>' +
      '<td class="nowrap"><b>#' + x.no + '</b></td>' +
      '<td>' + (x.type === 'manual' ? '<span class="pill warn">手动</span>' : '<span class="pill muted">自动</span>') + '</td>' +
      '<td class="nowrap" style="font-size:11.5px">' + fmtDateTime(x.at) + '</td>' +
      '<td class="tr">' + (x.size / 1024 / 1024).toFixed(2) + ' MB</td>' +
      '<td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11.5px;color:var(--muted-2)">' + esc(x.cloudPath || x.name) + '</td>' +
      '<td class="nowrap">' +
        '<button class="btn sm primary" data-action="cloud-restore" data-no="' + x.no + '">恢复</button> ' +
        '<button class="btn sm secondary" data-action="cloud-download" data-no="' + x.no + '">下载</button> ' +
        '<button class="icon-btn" data-action="cloud-verify" data-no="' + x.no + '" title="校验">' + icon('check', 14) + '</button>' +
        '<button class="icon-btn danger" data-action="cloud-del-version" data-no="' + x.no + '" title="删除">' + icon('trash', 14) + '</button>' +
      '</td></tr>').join('') +
    '</tbody></table></div>';
}

/* 只更新版本池与计数，不触发整页 renderView（否则会与取数形成循环） */
function refreshBackupVersions() {
  const box = $('#bk-versions');
  if (box) box.innerHTML = backupVersionsHTML();
  const cnt = $('#bk-ver-count');
  if (cnt) cnt.textContent = `当前 ${(UI.backupVersions || []).length} / 7`;
}
