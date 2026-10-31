/* ============================================================================
   合资金账 · 集团资金看板实时刷新（v5.5）

   设计取舍：
   1. 不做「整页 renderView」——那会重放入场动画、把用户正在看的表格滚回顶部。
      这里只替换四个数据区域（KPI / 关系图 / 排行 / 明细），骨架与筛选器保持不动。
   2. 只有数据签名变化才替换 DOM。真实场景里 5 秒内账本绝大多数时候没有变化，
      无条件 innerHTML 会让悬停中的丝带每 5 秒闪一下，看起来像"抖动"。
   3. 三条触发源：
        - 定时器 5s（兜底，保证"实时"这件事在没有事件时也成立）
        - fm:db-saved（本窗口写库，300ms 防抖后立刻刷新，点击保存即见结果）
        - storage（另一个窗口/标签页改了账本，浏览器只在其它窗口写入时派发该事件）
   4. 页面隐藏时停表，恢复可见立即补一次——后台标签页不该每 5 秒跑一次全量聚合。
   ========================================================================== */

'use strict';

(function () {
  const TICK = 5000;
  let timer = 0;
  let lastSig = '';
  let running = false;
  let dbTimer = 0;

  const sig = d => JSON.stringify([
    d.from, d.to, d.totalFlow, d.transferTotal, d.payTotal, d.totalCount,
    d.nodes.map(n => [n.id, n.balance, n.inflow, n.outflow]),
    d.edges.map(e => [e.from, e.to, e.amount, e.count, e.lastDate])
  ]);

  const live = () => UI.fbLive !== false && localStorage.getItem('fm-fb-live') !== 'off';

  function stamp() {
    const el = document.getElementById('fb-stamp');
    if (!el) return;
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    el.textContent = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  function flash(el) {
    if (!el || !motionOn() || perfLow()) return;
    el.classList.remove('is-fb-flash');
    void el.offsetWidth;          /* 强制重排，保证连续两次变化也能重放动画 */
    el.classList.add('is-fb-flash');
    clearTimeout(el.__fbT);
    el.__fbT = setTimeout(() => el.classList.remove('is-fb-flash'), 720);
  }

  function paint(force) {
    if (UI.view !== 'flowboard') return;
    let d;
    try { d = fbData(); } catch (e) { return; }   /* 数据半更新（导入中）时跳过本轮，下一轮自愈 */
    const s = sig(d);
    stamp();
    if (!force && s === lastSig) return;

    const targets = [
      ['fb-kpis', fbKPIs(d)],
      ['fb-trend', fbTrend(d)],
      ['fb-donut', fbDonut(d)],
      ['fb-graph', fbGraph(d)],
      ['fb-rank', fbRank(d)],
      ['fb-table', fbTable(d)]
    ];
    let painted = 0;
    targets.forEach(([id, html]) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.innerHTML = html;
      flash(el);
      painted++;
    });
    /* 区域不在（用户刚切走）时不更新签名，回来后必然重画一次 */
    if (!painted) return;

    const note = document.getElementById('fb-range-note');
    if (note) {
      note.innerHTML = d.missing.length
        ? `<span class="fb-warn">${icon('alert', 13)} ${d.missing.join('、')} 缺汇率，相关流水未计入</span>`
        : `<span>${d.pairCount} 组流向 · ${d.totalCount} 笔</span>`;
    }
    /* KPI 数字滚动：只在真正变化时播，和整页入场那套一致 */
    const kp = document.getElementById('fb-kpis');
    if (kp && typeof runCounters === 'function') runCounters(kp);

    lastSig = s;
  }

  function schedule() {
    clearInterval(timer);
    timer = setInterval(() => paint(false), TICK);
  }

  const api = {
    start() {
      /* 已经跑着又调 start，说明页面被重绘了（切主题、改设置、切公司都会走 renderView）。
         此时 DOM 是新的、lastSig 还是旧的，必须强制重画一次，否则时间戳停在占位符、
         数据要等下一个 5 秒才会出现。 */
      if (running) { lastSig = ''; paint(true); return; }
      running = true;
      lastSig = '';                 /* 重新进入页面必须重画一次（DOM 是新的） */
      paint(true);
      /* 只有开启状态才起定时器；暂停状态进来只画一次静态快照 */
      if (live()) { UI.fbLive = true; schedule(); } else { UI.fbLive = false; }
      document.addEventListener('visibilitychange', onVis);
      window.addEventListener('fm:db-saved', onDbSaved);
      window.addEventListener('storage', onStorage);
    },

    stop() {
      running = false;
      clearInterval(timer);
      clearTimeout(dbTimer);
      timer = 0;
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('fm:db-saved', onDbSaved);
      window.removeEventListener('storage', onStorage);
    },

    /* 手动刷新 / 切区间后调用 */
    refresh() { lastSig = ''; paint(true); },

    toggle() {
      UI.fbLive = !live();
      localStorage.setItem('fm-fb-live', UI.fbLive ? 'on' : 'off');
      const dot = document.getElementById('fb-live-dot');
      const word = document.getElementById('fb-live-word');
      const btn = document.getElementById('fb-live-btn');
      if (dot) dot.classList.toggle('is-on', UI.fbLive);
      if (word) word.textContent = UI.fbLive ? '实时更新中' : '已暂停更新';
      if (btn) btn.textContent = UI.fbLive ? '暂停' : '继续';
      if (UI.fbLive) { lastSig = ''; schedule(); paint(true); }
      else clearInterval(timer);
      if (typeof toast === 'function') toast(UI.fbLive ? '已恢复实时刷新（每 5 秒）' : '已暂停实时刷新，可手动点「刷新」', 'ok');
    },

    running: () => running
  };

  function onVis() {
    if (document.hidden) { clearInterval(timer); }
    else if (running) { paint(false); schedule(); }
  }

  function onDbSaved() {
    clearTimeout(dbTimer);
    dbTimer = setTimeout(() => paint(false), 300);
  }

  function onStorage(e) {
    /* 只认账本键，主题/动效这类偏好变化不触发重算 */
    if (!e || (e.key && e.key !== STORE_KEY)) return;
    onDbSaved();
  }

  window.FlowBoard = api;
})();
