/* ============================================================================
   合资金账 · 弹窗与数据操作
   ========================================================================== */

'use strict';

/* --------------------------------- 流水弹窗 -------------------------------- */

function openTxModal(id, opts) {
  if (DB.accounts.length === 0) {
    toast('请先创建一个账户', 'err');
    return openAccountModal();
  }
  const isEdit = !!id;
  const tx = isEdit ? DB.transactions.find(t => t.id === id) : null;
  const usable = DB.accounts.filter(a => a.active !== false || (tx && (a.id === tx.accountId || a.id === tx.toAccountId)));
  if (!usable.length) { toast('没有可用账户，请先启用或新建账户', 'err'); return openAccountModal(); }

  const type = tx ? tx.type : ((opts && opts.type) || 'out');
  const catId = tx ? (tx.categoryId || '') : '';
  const parent = parentCompany();
  const gpAccs = groupPayAccounts();
  const curSel = tx && tx.noCash ? 'gp:' + tx.fundedAccountId : (tx ? tx.accountId : usable[0].id);
  const accOpt = (sel, allowGroup) => {
    const own = usable.map(a =>
      `<option value="${a.id}" ${sel === a.id ? 'selected' : ''}>${esc(a.name)}（${a.type === 'cash' ? '现金' : '银行'}）</option>`
    ).join('');
    if (!gpAccs.length || !allowGroup) return own;
    const gp = gpAccs.map(a =>
      `<option value="gp:${a.id}" ${sel === 'gp:' + a.id ? 'selected' : ''}>${esc(a.name)}（${a.type === 'cash' ? '现金' : '银行'}）</option>`
    ).join('');
    return `<optgroup label="本公司账户">${own}</optgroup><optgroup label="${esc(parent.name)}（集团代付）">${gp}</optgroup>`;
  };

  /* 转入账户：本公司 + 其他公司（公司间转账） */
  const otherCos = DB.companies.filter(c => c.id !== COMPANY.id && c.accounts.some(a => a.active !== false));
  const toAccOpt = sel => {
    let html = '<optgroup label="本公司账户">' + usable.map(a =>
      `<option value="${a.id}" ${sel === a.id ? 'selected' : ''}>${esc(a.name)}（${a.type === 'cash' ? '现金' : '银行'}）</option>`
    ).join('') + '</optgroup>';
    otherCos.forEach(c => {
      html += `<optgroup label="其他公司 · ${esc(c.name)}">` + c.accounts.filter(a => a.active !== false).map(a => {
        const v = 'co:' + c.id + ':' + a.id;
        return `<option value="${v}" ${sel === v ? 'selected' : ''}>${esc(a.name)}（${a.type === 'cash' ? '现金' : '银行'}）</option>`;
      }).join('') + '</optgroup>';
    });
    return html;
  };

  openModal(modalShell({
    title: isEdit ? '编辑流水' : '记一笔',
    sub: isEdit ? '修改后相关账户余额会同步更新' : '记录一笔收入、支出或账户间转账',
    cls: 'wide',
    body: `<form id="tx-form" novalidate>
      <div class="modal-bd">
        <div class="seg" id="tx-type-seg" style="margin-bottom:16px;width:100%">
          ${[['in', '收入'], ['out', '支出'], ['transfer', '内部转账']].map(([k, l]) =>
            `<button type="button" class="seg-btn ${type === k ? 'is-active' : ''}" data-txtype="${k}" style="flex:1">${l}</button>`
          ).join('')}
        </div>
        <div class="form-grid c3">
          <label class="field"><span class="lbl">日期</span><input type="date" name="date" value="${tx ? tx.date : todayISO()}" required></label>
          <label class="field"><span class="lbl" data-role="acc-label">${type === 'in' ? '收款账户' : type === 'out' ? '付款账户' : '转出账户'}</span>
            <select name="accountId" required>${accOpt(curSel, type === 'out')}</select>
          </label>
          <label class="field ${type === 'transfer' ? '' : 'hidden'}" data-role="to-acc"><span class="lbl">转入账户（可跨公司）</span>
            <select name="toAccountId">${toAccOpt(tx ? tx.toAccountId : (usable[1] || usable[0]).id)}</select>
          </label>
          <label class="field"><span class="lbl">金额</span>
            <div class="input-affix"><span class="prefix">${curSymbol()}</span>
              <input type="number" name="amount" min="0.01" step="0.01" inputmode="decimal" value="${tx ? tx.amount : ''}" placeholder="0.00" required>
            </div>
          </label>
          <label class="field hidden" data-role="to-amount"><span class="lbl">到账金额（转入账户币种）</span>
            <div class="input-affix"><span class="prefix" data-role="to-cur"></span>
              <input type="number" name="toAmount" min="0.01" step="0.01" inputmode="decimal"
                     value="${tx && tx.toAmount != null ? tx.toAmount : ''}" placeholder="按汇率自动换算">
            </div>
          </label>
          <div class="field" data-role="cat-field"><span class="lbl">分类</span><div id="cat-holder">${categoryPickerHTML({ value: catId, kind: type === 'transfer' ? 'out' : type })}</div></div>
          <label class="field"><span class="lbl">往来单位 / 对方</span><input type="text" name="counterparty" value="${tx ? esc(tx.counterparty || '') : ''}" placeholder="客户、供应商、员工"></label>
          <label class="field"><span class="lbl">凭证号</span>
            <div class="input-affix">
              <input type="text" name="voucherNo" value="${tx ? esc(tx.voucherNo || '') : ''}" placeholder="留空自动生成">
              <button type="button" class="affix-btn" data-action="gen-voucher" title="按规则自动生成">自动</button>
            </div>
          </label>
          <label class="field span-2"><span class="lbl">摘要</span><input type="text" name="summary" value="${tx ? esc(tx.summary || '') : ''}" placeholder="这笔钱是做什么的"></label>
          <label class="field" data-role="project-field"><span class="lbl">归属项目</span>
            <select name="projectId">
              <option value="">不归属项目</option>
              ${ensureProjectList(COMPANY).filter(p => (p.status || 'active') !== 'done').map(p =>
                `<option value="${p.id}" ${tx && tx.projectId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
            </select>
          </label>
          <label class="field"><span class="lbl">经办人</span><input type="text" name="operator" value="${esc(tx ? (tx.operator || '') : SESSION.displayName)}"></label>
        </div>
      </div>
      <div class="modal-ft">
        <span class="hint" data-role="hint"></span>
        <div class="spacer"></div>
        <button type="button" class="btn secondary" data-action="close-modal">取消</button>
        <button type="submit" class="btn primary">${isEdit ? '保存修改' : '保存'}</button>
      </div>
    </form>`
  }), { noFocus: true });

  const form = $('#tx-form');
  const seg = $('#tx-type-seg');
  const hint = $('[data-role=hint]', form);
  const holder = $('#cat-holder');

  const updateHint = () => {
    const acc = accById(form.elements.accountId.value);
    hint.textContent = acc ? `「${acc.name}」当前余额 ${fmt(balanceOf(acc))}` : '';
  };

  const setType = t => {
    $$('.seg-btn', seg).forEach(b => b.classList.toggle('is-active', b.dataset.txtype === t));
    form.dataset.type = t;
    $('[data-role=to-acc]', form).classList.toggle('hidden', t !== 'transfer');
    $('[data-role=acc-label]', form).textContent = t === 'in' ? '收款账户' : t === 'out' ? '付款账户' : '转出账户';
    $('[data-role=cat-field]', form).classList.toggle('hidden', t === 'transfer');
    const pf = $('[data-role=project-field]', form);
    if (pf) pf.classList.toggle('hidden', t === 'transfer');
    holder.innerHTML = categoryPickerHTML({ value: '', kind: t === 'transfer' ? 'out' : t });
    form.elements.accountId.innerHTML = accOpt(usable[0].id, t === 'out');
    updateHint();
  };

  /* 跨币种转账：转入账户按目标币种入账，金额需单独确认（R-02） */
  const toAmtField = $('[data-role=to-amount]', form);
  const accIdOf = v => String(v || '').indexOf('gp:') === 0 ? String(v).slice(3) : String(v || '');
  const syncToAmount = () => {
    const t = form.dataset.type;
    const fromAcc = accById(accIdOf(form.elements.accountId.value));
    const toRawV = String(form.elements.toAccountId.value || '');
    const toAcc = toRawV.indexOf('co:') === 0 ? null : accById(toRawV);
    const cross = t === 'transfer' && !!fromAcc && !!toAcc && accCurrency(fromAcc) !== accCurrency(toAcc);
    if (!toAmtField) return;
    toAmtField.classList.toggle('hidden', !cross);
    if (!cross) { if (form.elements.toAmount) form.elements.toAmount.value = ''; return; }
    const curEl = $('[data-role=to-cur]', form);
    if (curEl) curEl.textContent = (CURRENCIES[accCurrency(toAcc)] || {}).symbol || '';
    const amt = round2(num(form.elements.amount.value));
    const r1 = baseRate(accCurrency(fromAcc), form.elements.date.value);
    const r2 = baseRate(accCurrency(toAcc), form.elements.date.value);
    if (amt > 0 && r1 != null && r2 != null && form.elements.toAmount) {
      form.elements.toAmount.value = round2(amt * r1 / r2);
    }
  };

  $$('.seg-btn', seg).forEach(b => b.addEventListener('click', () => { setType(b.dataset.txtype); syncToAmount(); }));
  form.elements.accountId.addEventListener('change', () => { updateHint(); syncToAmount(); });
  if (form.elements.toAccountId) form.elements.toAccountId.addEventListener('change', syncToAmount);
  form.elements.amount.addEventListener('input', syncToAmount);
  syncToAmount();
  form.dataset.type = type;
  updateHint();
  setTimeout(() => form.elements.amount.focus(), 60);

  form.addEventListener('submit', e => {
    e.preventDefault();
    const fd = new FormData(form);
    const t = form.dataset.type;
    const amount = round2(num(fd.get('amount')));
    const accRaw = String(fd.get('accountId') || '');
    const isGroupPay = accRaw.indexOf('gp:') === 0;
    const accId = isGroupPay ? accRaw.slice(3) : accRaw;
    const toRaw = String(fd.get('toAccountId') || '');
    const isCross = t === 'transfer' && toRaw.indexOf('co:') === 0;

    /* 需求19/20：统一校验 */
    const txRules = [
      { name: 'date', label: '日期', checks: [{ t: 'required' }, { t: 'date' }] },
      { name: 'amount', label: '金额', checks: [
        { t: 'required' }, { t: 'number', min: 0.01, max: 100000000000, decimals: 2 }
      ] },
      { name: 'accountId', label: '账户', checks: [{ t: 'required', msg: '请选择账户' }] }
    ];
    if (t !== 'transfer') {
      txRules.push(
        { name: 'counterparty', label: '往来单位 / 对方', checks: [{ t: 'required' }, { t: 'len', max: 60 }] },
        { name: 'summary', label: '摘要', checks: [{ t: 'required' }, { t: 'len', max: 120 }] },
        { name: 'operator', label: '经办人', checks: [{ t: 'required' }, { t: 'len', max: 30 }] }
      );
    }
    txRules.push({
      name: 'voucherNo', label: '凭证号',
      checks: [{ t: 'len', max: 40 }, { t: 'unique', unique: v => COMPANY.transactions.some(x => x.voucherNo === v && (!isEdit || x.id !== tx.id)) }]
    });
    if (!showFormErrors(form, validateForm(form, txRules))) return;
    if (t === 'transfer') {
      if (!toRaw) return toast('请选择转入账户', 'err');
      if (toRaw === accRaw) return toast('转出与转入账户不能相同', 'err');
    } else if (!fd.get('categoryId')) {
      return toast('请选择分类', 'err');
    }
    if (isGroupPay && t !== 'out') return toast('集团代付只能用于支出', 'err');
    if (isEdit && tx.peerCompanyId) return toast('公司间转账不支持直接编辑，请删除后重新录入', 'err');

    const base = {
      date: fd.get('date'),
      counterparty: String(fd.get('counterparty') || '').trim(),
      summary: String(fd.get('summary') || '').trim(),
      voucherNo: String(fd.get('voucherNo') || '').trim(),
      projectId: String(fd.get('projectId') || ''),
      operator: String(fd.get('operator') || '').trim(),
      userId: SESSION.id,
      updatedAt: new Date().toISOString()
    };

    /* 公司间转账：双方各记一笔，金额互相对应 */
    if (isCross) {
      const parts = toRaw.split(':');
      const toCo = coById(parts[1]);
      const toAcc = toCo ? toCo.accounts.find(a => a.id === parts[2]) : null;
      if (!toCo || !toAcc) return toast('转入账户不存在', 'err');
      const pairId = uid('p');
      DB.transactions.push(Object.assign({}, base, {
        id: uid('t'), type: 'transfer', direction: 'out',
        accountId: accId, toAccountId: '',
        peerCompanyId: toCo.id, peerAccountId: toAcc.id, peerName: toCo.name,
        amount, categoryId: '', category: '公司间转账', pairId,
        createdAt: new Date().toISOString()
      }));
      toCo.transactions.push(Object.assign({}, base, {
        id: uid('t'), type: 'transfer', direction: 'in',
        accountId: toAcc.id, toAccountId: '',
        peerCompanyId: COMPANY.id, peerAccountId: accId, peerName: COMPANY.name,
        amount, categoryId: '', category: '公司间转账', pairId,
        createdAt: new Date().toISOString()
      }));
      saveDB(); closeModal(); render();
      toast(`已转账 ${fmt(amount)} 至 ${toCo.name}`, 'ok');
      return;
    }

    const data = Object.assign({}, base, {
      type: t,
      toAccountId: t === 'transfer' ? toRaw : '',
      amount,
      toAmount: (t === 'transfer' && num(fd.get('toAmount')) > 0) ? round2(num(fd.get('toAmount'))) : '',
      categoryId: t === 'transfer' ? '' : fd.get('categoryId'),
      category: t === 'transfer' ? '内部转账' : (catById(fd.get('categoryId')) || {}).name || ''
    });

    if (isGroupPay) {
      const p = parentCompany();
      data.accountId = '';
      data.noCash = true;
      data.fundedBy = p ? p.id : '';
      data.fundedAccountId = accId;
      data.fundedByName = p ? p.name : '';
    } else {
      data.accountId = accId;
      data.noCash = false;
      data.fundedBy = '';
      data.fundedAccountId = '';
      data.fundedByName = '';
    }

    const beforeSnapshot = isEdit ? `${tx.date} ${tx.category} ${fmt(tx.amount)} ${tx.summary || ''}` : '';

    /* 编辑保存前必须二次确认（新增不弹） */
    const commit = () => {
      let saved;
      if (isEdit) { Object.assign(tx, data); saved = tx; }
      else {
        saved = Object.assign({ id: uid('t'), createdAt: new Date().toISOString() }, data);
        DB.transactions.push(saved);
      }

      if (!saved.voucherNo) saved.voucherNo = nextVoucherNo(saved.type, saved.date);

      syncGroupMirror(saved, COMPANY);
      logAction(isEdit ? '修改' : '新增', {
        module: '流水',
        target: `${saved.category || saved.type} ${fmt(saved.amount)}`,
        targetId: saved.id,
        before: isEdit ? beforeSnapshot : '',
        after: `${saved.date} ${saved.category} ${fmt(saved.amount)} ${saved.summary || ''}`
      });
      saveDB(); closeModal(); render();
      toast(isEdit ? '已保存修改' : `已记录${txTypeLabel(saved)} ${fmt(amount)}`, 'ok');
    };

    if (!isEdit) return commit();
    guardChange({
      title: '确认修改这笔流水？',
      message: `将把<br><b>${esc(beforeSnapshot)}</b><br>改为<br><b>${esc(`${data.date} ${data.category} ${fmt(amount)} ${data.summary || ''}`)}</b><br><br>相关账户余额会同步重算。`,
      confirmText: '确认修改',
      level: 'code',
      onConfirm: () => { closeModal(); commit(); }
    });
  });
}

/* --------------------------------- 账户弹窗 -------------------------------- */

function openAccountModal(id) {
  const isEdit = !!id;
  const a = isEdit ? accById(id) : null;

  openModal(modalShell({
    title: isEdit ? '编辑账户' : '新增账户',
    sub: '期初余额为「期初日期」当天的账面余额',
    body: `<form id="acc-form">
      <div class="modal-bd">
        <div class="form-grid">
          <label class="field span-2"><span class="lbl">账户名称</span><input type="text" name="name" value="${a ? esc(a.name) : ''}" placeholder="如：Ecobank 基本户 / 库存现金" required></label>
          <label class="field"><span class="lbl">账户类型</span>
            <select name="type">
              <option value="bank" ${a && a.type === 'bank' ? 'selected' : ''}>银行存款</option>
              <option value="cash" ${a && a.type === 'cash' ? 'selected' : ''}>库存现金</option>
            </select>
          </label>
          <label class="field"><span class="lbl">开户行</span><input type="text" name="bankName" value="${a ? esc(a.bankName || '') : ''}" placeholder="如：Ecobank Ghana"></label>
          <label class="field span-2"><span class="lbl">银行账号</span><input type="text" name="accountNo" value="${a ? esc(a.accountNo || '') : ''}" placeholder="可选"></label>
          <label class="field"><span class="lbl">账户币种</span>
            <select name="currency">
              ${Object.keys(CURRENCIES).map(k => `<option value="${k}" ${(a ? accCurrency(a) : baseCurrency()) === k ? 'selected' : ''}>${CURRENCIES[k].name}（${CURRENCIES[k].symbol}）</option>`).join('')}
            </select>
          </label>
          <label class="field"><span class="lbl">期初余额（按账户币种）</span>
            <div class="input-affix"><span class="prefix">${curSymbol()}</span>
              <input type="number" name="openingBalance" step="0.01" inputmode="decimal" value="${a ? a.openingBalance : '0.00'}">
            </div>
          </label>
          <label class="field"><span class="lbl">期初日期</span><input type="date" name="openingDate" value="${a ? a.openingDate : todayISO()}"></label>
          <label class="field span-2"><span class="lbl">备注</span><input type="text" name="note" value="${a ? esc(a.note || '') : ''}" placeholder="用途说明，可选"></label>
          <div class="field span-2">
            <label class="switch"><input type="checkbox" name="active" ${!a || a.active !== false ? 'checked' : ''}><span class="track"></span><span>启用（停用后不出现在记账列表中，历史数据保留）</span></label>
          </div>
        </div>
      </div>
      <div class="modal-ft">
        <div class="spacer"></div>
        <button type="button" class="btn secondary" data-action="close-modal">取消</button>
        <button type="submit" class="btn primary">${isEdit ? '保存' : '创建账户'}</button>
      </div>
    </form>`
  }));

  $('#acc-form').addEventListener('submit', e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const name = String(fd.get('name') || '').trim();
    if (!name) return toast('请填写账户名称', 'err');
    const data = {
      name,
      type: fd.get('type') === 'cash' ? 'cash' : 'bank',
      bankName: String(fd.get('bankName') || '').trim(),
      accountNo: String(fd.get('accountNo') || '').trim(),
      currency: CURRENCIES[fd.get('currency')] ? fd.get('currency') : baseCurrency(),
      openingBalance: round2(num(fd.get('openingBalance'))),
      openingDate: fd.get('openingDate') || todayISO(),
      note: String(fd.get('note') || '').trim(),
      active: fd.get('active') === 'on'
    };
    const commit = () => {
      if (isEdit) Object.assign(a, data);
      else DB.accounts.push(Object.assign({ id: uid('a'), createdAt: new Date().toISOString() }, data));
      saveDB(); closeModal(); render();
      toast(isEdit ? '账户已更新' : '账户已创建', 'ok');
    };
    if (!isEdit) return commit();
    /* 期初余额变动会改变全部历史余额，属高风险修改 */
    guardChange({
      title: '确认修改账户？',
      message: `「${esc(a.name)}」的期初余额将由 <b>${fmt(a.openingBalance)}</b> 改为 <b>${fmt(data.openingBalance)}</b>，<br>该账户所有历史余额都会重算。`,
      confirmText: '确认修改',
      level: data.openingBalance !== a.openingBalance ? 'code' : 'plain',
      onConfirm: () => { closeModal(); commit(); }
    });
  });
}

/* --------------------------------- 对账弹窗 -------------------------------- */

function openReconcileModal(id) {
  const a = accById(id);
  if (!a) return;
  const book = balanceOf(a);

  openModal(modalShell({
    title: '对账调整',
    sub: `${esc(a.name)} · 账面余额 ${fmt(book)}`,
    cls: 'slim',
    body: `<form id="rec-form">
      <div class="modal-bd">
        <div class="alert info" style="margin-bottom:14px">
          ${icon('info', 15)}
          <div>填入银行对账单或现金实盘的实际余额，系统自动生成差额调整流水，不会影响经营收支统计。</div>
        </div>
        <div class="form-grid">
          <label class="field span-2"><span class="lbl">实际余额</span>
            <div class="input-affix"><span class="prefix">${curSymbol()}</span>
              <input type="number" name="actual" step="0.01" inputmode="decimal" value="${book}" required>
            </div>
          </label>
          <label class="field span-2"><span class="lbl">调整日期</span><input type="date" name="date" value="${todayISO()}"></label>
          <div class="field span-2">
            <span class="lbl">差额</span>
            <div id="rec-diff" style="font-size:14px;font-weight:650;color:var(--muted)">—</div>
          </div>
        </div>
      </div>
      <div class="modal-ft">
        <div class="spacer"></div>
        <button type="button" class="btn secondary" data-action="close-modal">取消</button>
        <button type="submit" class="btn primary">生成调整流水</button>
      </div>
    </form>`
  }));

  const form = $('#rec-form');
  const diffEl = $('#rec-diff');
  const upd = () => {
    const d = round2(num(form.elements.actual.value) - book);
    diffEl.textContent = d === 0 ? '账实相符，无需调整' : `${d > 0 ? '+' : ''}${fmt(d)}，将记为${d > 0 ? '收入' : '支出'}`;
    diffEl.style.color = d === 0 ? 'var(--muted)' : d > 0 ? 'var(--in)' : 'var(--out)';
  };
  form.elements.actual.addEventListener('input', upd);
  upd();

  form.addEventListener('submit', e => {
    e.preventDefault();
    const d = round2(num(form.elements.actual.value) - book);
    if (d === 0) { toast('账实相符，无需调整', 'ok'); closeModal(); return; }
    const cat = DB.categories.find(c => c.name === '余额调整' && c.kind === (d > 0 ? 'in' : 'out'))
      || DB.categories.find(c => c.kind === (d > 0 ? 'in' : 'out'));
    DB.transactions.push({
      id: uid('t'),
      date: form.elements.date.value || todayISO(),
      type: d > 0 ? 'in' : 'out',
      accountId: a.id,
      toAccountId: '',
      amount: Math.abs(d),
      categoryId: cat ? cat.id : '',
      category: cat ? cat.name : '余额调整',
      counterparty: '',
      summary: `对账调整：账面 ${fmtPlain(book)} → 实际 ${fmtPlain(num(form.elements.actual.value))}`,
      voucherNo: '', operator: SESSION.displayName, userId: SESSION.id,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    });
    saveDB(); closeModal(); render();
    toast(`已生成调整流水 ${fmt(Math.abs(d))}`, 'ok');
  });
}

/* --------------------------------- 往来弹窗 -------------------------------- */

function openDebtModal(id, presetType) {
  const isEdit = !!id;
  const d = isEdit ? DB.debts.find(x => x.id === id) : null;
  const type = d ? d.type : (presetType || UI.debtTab || 'lend');
  const usable = DB.accounts.filter(a => a.active !== false);

  openModal(modalShell({
    title: isEdit ? '编辑往来款' : '登记往来款',
    sub: '借出款与借入款会同时生成资金流水；员工未报销只在结清时付款',
    body: `<form id="debt-form">
      <div class="modal-bd">
        <div class="seg" id="debt-type-seg" style="margin-bottom:16px;width:100%">
          ${[['lend', '借出款（应收）'], ['borrow', '借入款（应付）'], ['reimburse', '员工未报销']].map(([k, l]) =>
            `<button type="button" class="seg-btn ${type === k ? 'is-active' : ''}" data-debttype="${k}" style="flex:1">${l}</button>`
          ).join('')}
        </div>
        <div class="form-grid">
          <label class="field span-2"><span class="lbl">对方名称</span><input type="text" name="party" value="${d ? esc(d.party) : ''}" placeholder="单位或个人姓名" required></label>
          <label class="field"><span class="lbl">金额</span>
            <div class="input-affix"><span class="prefix">${curSymbol()}</span>
              <input type="number" name="amount" min="0.01" step="0.01" value="${d ? d.amount : ''}" placeholder="0.00" required>
            </div>
          </label>
          <label class="field"><span class="lbl">计价币种</span>
            <select name="currency">
              ${Object.keys(CURRENCIES).map(k => `<option value="${k}" ${(d ? (d.currency || baseCurrency()) : baseCurrency()) === k ? 'selected' : ''}>${CURRENCIES[k].name}（${CURRENCIES[k].symbol}）</option>`).join('')}
            </select>
          </label>
          <label class="field"><span class="lbl">发生日期</span><input type="date" name="date" value="${d ? d.date : todayISO()}"></label>
          <label class="field"><span class="lbl">约定结清日期</span><input type="date" name="dueDate" value="${d ? (d.dueDate || '') : ''}"></label>
          <label class="field" data-role="acct-field"><span class="lbl">资金账户</span>
            <select name="accountId">${usable.map(a => `<option value="${a.id}" ${d && d.accountId === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>
          </label>
          <label class="field span-2"><span class="lbl">备注</span><input type="text" name="note" value="${d ? esc(d.note || '') : ''}" placeholder="用途、约定等"></label>
          <div class="field span-2" data-role="auto-field">
            <label class="switch"><input type="checkbox" name="autoTx" checked><span class="track"></span><span>同时生成资金流水（借出记支出、借入记收入）</span></label>
          </div>
        </div>
      </div>
      <div class="modal-ft">
        <span class="hint" data-role="debt-hint"></span>
        <div class="spacer"></div>
        <button type="button" class="btn secondary" data-action="close-modal">取消</button>
        <button type="submit" class="btn primary">${isEdit ? '保存' : '登记'}</button>
      </div>
    </form>`
  }));

  const form = $('#debt-form');
  const seg = $('#debt-type-seg');
  let curType = type;

  const syncType = t => {
    curType = t;
    $$('.seg-btn', seg).forEach(b => b.classList.toggle('is-active', b.dataset.debttype === t));
    $('[data-role=auto-field]', form).classList.toggle('hidden', t === 'reimburse');
    $('[data-role=acct-field]', form).classList.toggle('hidden', t === 'reimburse');
    $('[data-role=debt-hint]', form).textContent =
      t === 'lend' ? '借出时资金从账户流出，收回时再登记收款'
      : t === 'borrow' ? '借入时资金流入账户，还款时再登记还款'
      : '员工垫付不产生现金流，报销时从账户付款';
  };
  $$('.seg-btn', seg).forEach(b => b.addEventListener('click', () => syncType(b.dataset.debttype)));
  syncType(type);

  form.addEventListener('submit', e => {
    e.preventDefault();
    const fd = new FormData(form);
    const amount = round2(num(fd.get('amount')));
    const party = String(fd.get('party') || '').trim();
    if (!party) return toast('请填写对方名称', 'err');
    if (!(amount > 0)) return toast('金额必须大于 0', 'err');

    const data = {
      type: curType,
      party,
      amount,
      currency: CURRENCIES[fd.get('currency')] ? fd.get('currency') : baseCurrency(),
      date: fd.get('date') || todayISO(),
      dueDate: fd.get('dueDate') || '',
      accountId: curType === 'reimburse' ? '' : (fd.get('accountId') || ''),
      note: String(fd.get('note') || '').trim()
    };

    if (isEdit) {
      const changedAmount = round2(num(d.amount)) !== amount;
      guardChange({
        title: '确认修改往来款？',
        message: `「${esc(d.party)}」的金额将由 <b>${fmt(d.amount)}</b> 改为 <b>${fmt(amount)}</b>。${changedAmount ? '<br>已结清金额不变，未结余额会随之变化。' : ''}`,
        confirmText: '确认修改',
        level: changedAmount ? 'code' : 'plain',
        onConfirm: () => {
          Object.assign(d, data);
          saveDB(); closeModal(); render();
          toast('已保存', 'ok');
        }
      });
      return;
    }

    const debt = Object.assign({ id: uid('d'), createdAt: new Date().toISOString(), userId: SESSION.id }, data);
    DB.debts.push(debt);

    if (curType !== 'reimburse' && fd.get('autoTx') === 'on' && data.accountId) {
      const catName = curType === 'lend' ? '往来款支付' : '借款';
      const cat = DB.categories.find(c => c.name === catName && c.kind === (curType === 'lend' ? 'out' : 'in'));
      DB.transactions.push({
        id: uid('t'),
        date: data.date,
        type: curType === 'lend' ? 'out' : 'in',
        accountId: data.accountId,
        toAccountId: '',
        amount,
        categoryId: cat ? cat.id : '',
        category: cat ? cat.name : catName,
        counterparty: party,
        summary: `${curType === 'lend' ? '借出给' : '向'}${party}${curType === 'lend' ? '' : '借入'}款`,
        voucherNo: '', operator: SESSION.displayName, userId: SESSION.id,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
      });
    }

    saveDB(); closeModal(); render();
    toast('往来款已登记', 'ok');
  });
}

function openSettleModal(debtId) {
  const d = DB.debts.find(x => x.id === debtId);
  if (!d) return;
  const info = debtInfo(d);
  const usable = DB.accounts.filter(a => a.active !== false);
  if (!usable.length) { toast('请先创建账户', 'err'); return openAccountModal(); }

  const t = DEBT_TYPE[d.type];
  const actionLabel = d.type === 'lend' ? '登记收款' : d.type === 'borrow' ? '登记还款' : '登记报销付款';

  openModal(modalShell({
    title: actionLabel,
    sub: `${esc(d.party)} · 未结 ${fmt(info.remaining)}`,
    cls: 'slim',
    body: `<form id="settle-form">
      <div class="modal-bd">
        <div class="summary-strip" style="padding:0 0 14px;gap:22px">
          <div class="item"><span>原始金额</span><strong>${fmt(d.amount)}</strong></div>
          <div class="item"><span>已结</span><strong>${fmt(info.settled)}</strong></div>
          <div class="item"><span>未结</span><strong style="color:${d.type === 'lend' ? 'var(--in)' : 'var(--out)'}">${fmt(info.remaining)}</strong></div>
        </div>
        <div class="form-grid">
          <label class="field"><span class="lbl">本次金额</span>
            <div class="input-affix"><span class="prefix">${curSymbol()}</span>
              <input type="number" name="amount" min="0.01" step="0.01" value="${info.remaining}" required>
            </div>
          </label>
          <label class="field"><span class="lbl">日期</span><input type="date" name="date" value="${todayISO()}"></label>
          <label class="field span-2"><span class="lbl">资金账户</span>
            <select name="accountId">${usable.map(a => `<option value="${a.id}">${esc(a.name)}（余额 ${fmt(balanceOf(a))}）</option>`).join('')}</select>
          </label>
          <label class="field span-2"><span class="lbl">备注</span><input type="text" name="note" placeholder="可选"></label>
        </div>
        <div class="alert info" style="margin-top:12px">
          ${icon('info', 15)}
          <div>提交后将自动生成一笔${d.type === 'lend' ? '收入' : '支出'}流水，分类记为「${d.type === 'lend' ? '往来款收回' : d.type === 'borrow' ? '还款' : '报销付款'}」。</div>
        </div>
      </div>
      <div class="modal-ft">
        <div class="spacer"></div>
        <button type="button" class="btn secondary" data-action="close-modal">取消</button>
        <button type="submit" class="btn primary">确认${t.dir === 'in' ? '收款' : '付款'}</button>
      </div>
    </form>`
  }));

  const form = $('#settle-form');
  form.addEventListener('submit', e => {
    e.preventDefault();
    const fd = new FormData(form);
    const amount = round2(num(fd.get('amount')));
    if (!(amount > 0)) return toast('金额必须大于 0', 'err');
    if (amount > info.remaining + 0.001) return toast('金额不能超过未结余额', 'err');

    /* 往来款按计价币种登记，资金流水按账户币种入账，需折算 */
    const debtCur = d.currency || baseCurrency();
    const accObj = accById(String(fd.get('accountId') || ''));
    const accCur = accObj ? accCurrency(accObj) : baseCurrency();
    let txAmount = amount;
    if (debtCur !== accCur) {
      const r1 = baseRate(debtCur, fd.get('date') || todayISO());
      const r2 = baseRate(accCur, fd.get('date') || todayISO());
      if (r1 == null || r2 == null) return toast(`缺少 ${debtCur} 或 ${accCur} 的汇率，无法折算，请先到设置里录入`, 'err');
      txAmount = round2(amount * r1 / r2);
    }

    const catName = d.type === 'lend' ? '往来款收回' : d.type === 'borrow' ? '还款' : '报销付款';
    const kind = d.type === 'lend' ? 'in' : 'out';
    const cat = DB.categories.find(c => c.name === catName && c.kind === kind) || DB.categories.find(c => c.kind === kind);

    const txId = uid('t');
    DB.transactions.push({
      id: txId,
      date: fd.get('date') || todayISO(),
      type: kind,
      accountId: fd.get('accountId'),
      toAccountId: '',
      amount: txAmount,
      categoryId: cat ? cat.id : '',
      category: cat ? cat.name : catName,
      counterparty: d.party,
      summary: `${d.type === 'lend' ? '收回' : d.type === 'borrow' ? '偿还' : '报销'}：${d.party}${fd.get('note') ? ' · ' + fd.get('note') : ''}`,
      voucherNo: '', operator: SESSION.displayName, userId: SESSION.id,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    });

    DB.settlements.push({
      id: uid('s'),
      debtId: d.id,
      date: fd.get('date') || todayISO(),
      amount,
      accountId: fd.get('accountId'),
      txId,
      note: String(fd.get('note') || '').trim(),
      userId: SESSION.id
    });

    saveDB(); closeModal(); render();
    toast(`已${d.type === 'lend' ? '收款' : '付款'} ${fmt(amount)}`, 'ok');
  });
}

/* --------------------------------- 分类弹窗 -------------------------------- */

const PICK_ICONS = ['cart', 'briefcase', 'layers', 'percent', 'users', 'bank', 'rotate', 'award',
  'sliders', 'tag', 'shield', 'receipt', 'home', 'zap', 'plane', 'clipboard', 'megaphone', 'truck',
  'wallet', 'box', 'transfer', 'calendar', 'file', 'chart'];

function openCategoryModal(id, opts = {}) {
  const isEdit = !!id;
  const c = isEdit ? catById(id) : null;
  const kind = c ? c.kind : (opts.kind || 'out');
  let iconSel = c ? c.icon : 'tag';
  let colorSel = c ? c.color : CAT_COLORS[0];

  const cfOpts = ['<option value="none">不计入现金流量表</option>',
    ...CF_ITEMS.map(i => `<option value="${i.key}" ${c && c.cf === i.key ? 'selected' : ''}>${ACT_LABEL[i.act]} · ${i.label}</option>`)
  ].join('');

  openModal(modalShell({
    title: isEdit ? '编辑分类' : '新建分类',
    sub: '分类决定记账口径与现金流量表的归集方式',
    body: `<form id="cat-form">
      <div class="modal-bd">
        <div class="form-grid">
          <label class="field"><span class="lbl">分类名称</span><input type="text" name="name" value="${c ? esc(c.name) : ''}" placeholder="如：采购付款" required></label>
          <label class="field"><span class="lbl">收支类型</span>
            <select name="kind" ${isEdit ? 'disabled' : ''}>
              <option value="out" ${kind === 'out' ? 'selected' : ''}>支出</option>
              <option value="in" ${kind === 'in' ? 'selected' : ''}>收入</option>
            </select>
          </label>
          <div class="field span-2">
            <span class="lbl">图标</span>
            <div id="icon-grid" style="display:flex;flex-wrap:wrap;gap:6px">
              ${PICK_ICONS.filter(n => ICONS[n]).map(n => `
                <button type="button" class="icon-btn" data-icon-pick="${n}" title="${n}"
                  style="width:32px;height:32px;border:1px solid ${n === iconSel ? 'var(--brand)' : 'var(--line-2)'};background:${n === iconSel ? 'var(--brand-soft)' : '#fff'};color:${n === iconSel ? 'var(--brand)' : 'var(--muted)'}">
                  ${icon(n, 15)}
                </button>`).join('')}
            </div>
            <input type="hidden" name="icon" value="${iconSel}">
          </div>
          <div class="field span-2">
            <span class="lbl">颜色</span>
            <div id="color-grid" style="display:flex;flex-wrap:wrap;gap:7px">
              ${CAT_COLORS.map(col => `
                <button type="button" data-color-pick="${col}" title="${col}"
                  style="width:24px;height:24px;border-radius:7px;background:${col};border:2px solid ${col === colorSel ? 'var(--ink)' : 'transparent'}"></button>`).join('')}
            </div>
            <input type="hidden" name="color" value="${colorSel}">
          </div>
          <label class="field span-2"><span class="lbl">现金流量项目</span><select name="cf">${cfOpts}</select></label>
          <div class="field span-2">
            <label class="switch"><input type="checkbox" name="active" ${!c || c.active !== false ? 'checked' : ''}><span class="track"></span><span>启用</span></label>
          </div>
        </div>
      </div>
      <div class="modal-ft">
        <div class="spacer"></div>
        <button type="button" class="btn secondary" data-action="close-modal">取消</button>
        <button type="submit" class="btn primary">${isEdit ? '保存' : '创建'}</button>
      </div>
    </form>`
  }));

  const form = $('#cat-form');
  const iconInput = form.elements.icon;
  const colorInput = form.elements.color;

  $('#icon-grid').addEventListener('click', e => {
    const b = e.target.closest('[data-icon-pick]');
    if (!b) return;
    iconInput.value = b.dataset.iconPick;
    $$('#icon-grid button').forEach(x => {
      const on = x === b;
      x.style.borderColor = on ? 'var(--brand)' : 'var(--line-2)';
      x.style.background = on ? 'var(--brand-soft)' : '#fff';
      x.style.color = on ? 'var(--brand)' : 'var(--muted)';
    });
  });
  $('#color-grid').addEventListener('click', e => {
    const b = e.target.closest('[data-color-pick]');
    if (!b) return;
    colorInput.value = b.dataset.colorPick;
    $$('#color-grid button').forEach(x => { x.style.borderColor = x === b ? 'var(--ink)' : 'transparent'; });
  });

  form.addEventListener('submit', e => {
    e.preventDefault();
    const fd = new FormData(form);
    const name = String(fd.get('name') || '').trim();
    if (!name) return toast('请填写分类名称', 'err');
    const data = {
      name,
      kind: fd.get('kind') === 'in' ? 'in' : 'out',
      icon: fd.get('icon') || 'tag',
      color: fd.get('color') || CAT_COLORS[0],
      cf: fd.get('cf') || 'none',
      active: fd.get('active') === 'on'
    };

    if (isEdit) {
      Object.assign(c, data);
      saveDB(); closeModal(); render();
      toast('分类已更新', 'ok');
      if (opts.onSave) opts.onSave(c);
    } else {
      const dup = DB.categories.find(x => x.name === name && x.kind === data.kind);
      if (dup) return toast('同类型下已存在同名分类', 'err');
      const cat = Object.assign({ id: uid('c'), system: false }, data);
      DB.categories.push(cat);
      saveDB(); closeModal(); render();
      toast('分类已创建', 'ok');
      if (opts.onSave) opts.onSave(cat);
    }
  });
}

/* --------------------------------- 公司弹窗 -------------------------------- */

function openCompanyModal(id) {
  const isEdit = !!id;
  const c = isEdit ? coById(id) : null;
  let colorSel = c ? c.color : CO_COLORS[DB.companies.length % CO_COLORS.length];

  openModal(modalShell({
    title: isEdit ? '编辑公司' : '新建公司',
    sub: isEdit ? '修改公司信息不会影响账本数据' : '新公司会获得一套独立的账户、分类与账本，与现有公司互不影响',
    cls: 'slim',
    body: `<form id="co-form">
      <div class="modal-bd">
        <div class="form-grid">
          <label class="field span-2"><span class="lbl">公司名称</span><input type="text" name="name" value="${c ? esc(c.name) : ''}" placeholder="如：Accra Trading Ltd" required></label>
          <label class="field"><span class="lbl">简称</span><input type="text" name="shortName" value="${c ? esc(c.shortName || '') : ''}" placeholder="可选"></label>
          <label class="field"><span class="lbl">税号 / 注册号</span><input type="text" name="taxNo" value="${c ? esc(c.taxNo || '') : ''}" placeholder="可选"></label>
          <div class="field span-2">
            <span class="lbl">标识色</span>
            <div id="co-colors" style="display:flex;gap:7px;flex-wrap:wrap">
              ${CO_COLORS.map(col => `<button type="button" data-color="${col}"
                style="width:26px;height:26px;border-radius:8px;background:${col};border:2px solid ${col === colorSel ? 'var(--ink)' : 'transparent'}"></button>`).join('')}
            </div>
            <input type="hidden" name="color" value="${colorSel}">
          </div>
          <label class="field span-2"><span class="lbl">备注</span><input type="text" name="note" value="${c ? esc(c.note || '') : ''}" placeholder="业务说明，可选"></label>
          <div class="field span-2">
            <label class="switch"><input type="checkbox" name="isParent" ${c && c.isParent ? 'checked' : ''}><span class="track"></span><span>设为集团总公司（持有集团资金，可为其他公司代付）</span></label>
          </div>
        </div>
      </div>
      <div class="modal-ft">
        <div class="spacer"></div>
        <button type="button" class="btn secondary" data-action="close-modal">取消</button>
        <button type="submit" class="btn primary">${isEdit ? '保存' : '创建公司'}</button>
      </div>
    </form>`
  }));

  const form = $('#co-form');
  $('#co-colors').addEventListener('click', e => {
    const b = e.target.closest('[data-color]');
    if (!b) return;
    form.elements.color.value = b.dataset.color;
    $$('#co-colors button').forEach(x => { x.style.borderColor = x === b ? 'var(--ink)' : 'transparent'; });
  });

  form.addEventListener('submit', e => {
    e.preventDefault();
    const fd = new FormData(form);
    const name = String(fd.get('name') || '').trim();
    if (!name) return toast('请填写公司名称', 'err');
    const data = {
      name,
      shortName: String(fd.get('shortName') || '').trim(),
      taxNo: String(fd.get('taxNo') || '').trim(),
      color: fd.get('color') || CO_COLORS[0],
      note: String(fd.get('note') || '').trim()
    };

    data.isParent = fd.get('isParent') === 'on';
    if (data.isParent) DB.companies.forEach(x => { if (!c || x.id !== c.id) x.isParent = false; });
    if (isEdit) {
      Object.assign(c, data);
      saveDB(); closeModal(); renderShell();
      toast('公司信息已更新', 'ok');
      return;
    }

    const co = newCompany(name, DB.companies.length);
    Object.assign(co, data);
    DB.companies.push(co);
    logAction('新增', { module: '公司', target: co.name, targetId: co.id, companyId: co.id, companyName: co.name });
    switchCompany(co.id, { silent: true });
    saveDB(); closeModal();
    UI.view = 'dashboard';
    renderShell();
    toast(`已创建并切换到「${co.name}」`, 'ok');
  });
}

/* --------------------------------- 用户弹窗 -------------------------------- */

function openUserModal(id) {
  const isEdit = !!id;
  const u = isEdit ? userById(id) : null;

  openModal(modalShell({
    title: isEdit ? '编辑用户' : '新增用户',
    sub: isEdit ? '修改显示名称、角色与状态' : '为同事创建本地登录账号',
    cls: 'slim',
    body: `<form id="user-form">
      <div class="modal-bd">
        <div class="form-grid">
          <label class="field span-2"><span class="lbl">登录账号</span>
            <input type="text" name="username" value="${u ? esc(u.username) : ''}" placeholder="英文或数字，登录用" ${isEdit ? 'disabled' : ''} required>
          </label>
          <label class="field span-2"><span class="lbl">显示名称</span><input type="text" name="displayName" value="${u ? esc(u.displayName) : ''}" placeholder="姓名" required></label>
          <label class="field"><span class="lbl">角色</span>
            <select name="role">
              <option value="staff" ${u && u.role === 'staff' ? 'selected' : ''}>记账员</option>
              <option value="admin" ${u && u.role === 'admin' ? 'selected' : ''}>管理员</option>
            </select>
          </label>
          <div class="field">
            <span class="lbl">状态</span>
            <label class="switch" style="height:34px"><input type="checkbox" name="active" ${!u || u.active !== false ? 'checked' : ''}><span class="track"></span><span>${u ? '启用' : '创建后启用'}</span></label>
          </div>
          ${!isEdit ? `<label class="field span-2"><span class="lbl">初始密码</span><input type="password" name="password" placeholder="至少 6 位" required></label>` : ''}
          <div class="field span-2">
            <span class="lbl">可操作公司<span style="color:var(--muted-2);font-weight:400">（管理员不受限；记账员不勾选则默认可全部）</span></span>
            <div class="chk-list">
              ${DB.companies.map(co => `<label class="chk-item">
                <input type="checkbox" name="companyIds" value="${co.id}"
                  ${u && (u.companyIds || []).includes(co.id) ? 'checked' : ''}>
                <span>${esc(co.name)}${co.isParent ? ' · 总公司' : ''}</span>
              </label>`).join('')}
            </div>
          </div>
        </div>
      </div>
      <div class="modal-ft">
        <div class="spacer"></div>
        <button type="button" class="btn secondary" data-action="close-modal">取消</button>
        <button type="submit" class="btn primary">${isEdit ? '保存' : '创建用户'}</button>
      </div>
    </form>`
  }));

  const form = $('#user-form');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(form);
    const displayName = String(fd.get('displayName') || '').trim();
    if (!displayName) return toast('请填写显示名称', 'err');

    if (isEdit) {
      /* 审计：先记下变更前的角色与授权范围 */
      const beforeRole = u.role, beforeActive = u.active !== false;
      const beforeCos = (u.companyIds || []).slice();

      u.displayName = displayName;
      u.role = fd.get('role') === 'admin' ? 'admin' : 'staff';
      u.active = fd.get('active') === 'on';
      u.companyIds = fd.getAll('companyIds').filter(Boolean);

      /* 审计：账号与权限变更必须留痕（安全要求，内控前提） */
      {
        const coNames = ids => (ids && ids.length)
          ? ids.map(id => (DB.companies.find(c => c.id === id) || {}).name || id).join('、')
          : '全部公司';
        const diffs = [];
        if (beforeRole !== u.role) diffs.push('角色 ' + beforeRole + ' → ' + u.role);
        if (beforeActive !== (u.active !== false)) diffs.push('状态 ' + (beforeActive ? '启用' : '停用') + ' → ' + (u.active !== false ? '启用' : '停用'));
        if (beforeCos.slice().sort().join() !== (u.companyIds || []).slice().sort().join()) {
          diffs.push('授权公司 ' + coNames(beforeCos) + ' → ' + coNames(u.companyIds));
        }
        if (diffs.length) {
          logAction('修改', {
            module: '用户', target: '账号 ' + u.username, targetId: u.id,
            before: diffs.map(d => d.split(' → ')[0]).join('；'),
            after: diffs.join('；')
          });
        }
      }
      if (u.id === SESSION.id && u.active === false) return toast('不能停用当前登录账号', 'err');
      if (u.id === SESSION.id && u.role !== 'admin') return toast('不能取消自己的管理员权限', 'err');
      saveDB(); closeModal(); render();
      toast('用户已更新', 'ok');
      return;
    }

    const username = String(fd.get('username') || '').trim();
    const password = String(fd.get('password') || '');
    if (!/^[a-zA-Z0-9_.-]{3,20}$/.test(username)) return toast('账号需为 3-20 位字母、数字或 _ . -', 'err');
    if (password.length < 6) return toast('密码至少 6 位', 'err');
    if (DB.users.some(x => x.username.toLowerCase() === username.toLowerCase())) return toast('该账号已存在', 'err');

    const user = await createUser({
      username,
      displayName,
      password,
      role: fd.get('role') === 'admin' ? 'admin' : 'staff'
    });
    user.companyIds = fd.getAll('companyIds').filter(Boolean);
    user.active = fd.get('active') === 'on';
    logAction('新增', { module: '用户', target: user.username, targetId: user.id });
    saveDB(); closeModal(); render();
    toast('用户已创建', 'ok');
  });
}

function openPasswordModal(userId) {
  const isSelf = !userId || userId === SESSION.id;
  const u = isSelf ? userById(SESSION.id) : userById(userId);

  openModal(modalShell({
    title: isSelf ? '修改密码' : '重置密码',
    sub: isSelf ? '修改后下次登录使用新密码' : `为 ${esc(u ? u.displayName : '')} 设置新密码`,
    cls: 'slim',
    body: `<form id="pwd-form">
      <div class="modal-bd">
        <div class="form-grid">
          ${isSelf ? `<label class="field span-2"><span class="lbl">当前密码</span><input type="password" name="oldPwd" required></label>` : ''}
          <label class="field span-2"><span class="lbl">新密码</span><input type="password" name="newPwd" placeholder="至少 6 位" required></label>
          <label class="field span-2"><span class="lbl">确认新密码</span><input type="password" name="newPwd2" required></label>
        </div>
      </div>
      <div class="modal-ft">
        <div class="spacer"></div>
        <button type="button" class="btn secondary" data-action="close-modal">取消</button>
        <button type="submit" class="btn primary">保存</button>
      </div>
    </form>`
  }));

  const form = $('#pwd-form');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(form);
    const np = String(fd.get('newPwd') || '');
    if (np.length < 6) return toast('新密码至少 6 位', 'err');
    if (np !== fd.get('newPwd2')) return toast('两次输入的密码不一致', 'err');

    if (isSelf) {
      const check = await verifyLogin(u.username, String(fd.get('oldPwd') || ''));
      if (!check.ok) return toast('当前密码不正确', 'err');
    }
    u.salt = randomSalt();
    u.hash = await hashPassword(np, u.salt);
    saveDB(); closeModal();
    toast('密码已更新', 'ok');
  });
}

/* -------------------------------- 导入导出 -------------------------------- */

async function exportTxCSV(list, name) {
  if (!list.length) return toast('没有可导出的记录', 'err');
  const head = ['日期', '类型', '分类', '账户', '转入账户', '金额', '往来单位', '摘要', '凭证号', '经办人'];
  const rows = list.map(t => {
    const a = accById(t.accountId), b = accById(t.toAccountId), c = txCat(t);
    return [t.date, txTypeLabel(t), c.name, a ? a.name : '', b ? b.name : '',
      (t.type === 'out' ? '-' : '') + round2(t.amount).toFixed(2),
      t.counterparty || '', t.summary || '', t.voucherNo || '', t.operator || ''];
  });
  const ok = await saveTextFile(`${name}_${todayISO()}.csv`, toCSV(head, rows), 'text/csv;charset=utf-8');
  if (ok) toast(`已导出 ${rows.length} 条记录`, 'ok');
}

async function exportCF() {
  const { from, to } = cfRange();
  const cf = cashFlow(from, to);
  const rows = [];
  [['op', '经营活动'], ['inv', '投资活动'], ['fin', '筹资活动']].forEach(([k, label]) => {
    rows.push([`一、${label}`]);
    cf.rows.filter(r => r.act === k).forEach(r => rows.push([r.label, r.amount.toFixed(2)]));
    rows.push(['现金流入小计', cf.act[k].in.toFixed(2)]);
    rows.push(['现金流出小计', cf.act[k].out.toFixed(2)]);
    rows.push([`${label}产生的现金流量净额`, cf.act[k].net.toFixed(2)]);
    rows.push([]);
  });
  rows.push(['现金及现金等价物净增加额', cf.netTotal.toFixed(2)]);
  rows.push(['期初现金及现金等价物余额', cf.beginCash.toFixed(2)]);
  rows.push(['期末现金及现金等价物余额', cf.endCash.toFixed(2)]);
  const ok = await saveTextFile(`现金流量表_${from}_${to}.csv`, toCSV(['项目', `本期金额（${CUR().code}）`], rows), 'text/csv;charset=utf-8');
  if (ok) toast('现金流量表已导出', 'ok');
}

async function exportStatementCSV() {
  const st = stmtState();
  const acc = accById(st.account);
  if (!acc) return;
  const from = st.month + '-01', to = lastDayOfMonth(st.month);
  const opening = balanceOf(acc, addDays(from, -1));
  const list = DB.transactions
    .filter(t => t.date >= from && t.date <= to && (t.accountId === acc.id || t.toAccountId === acc.id))
    .sort((a, b) => a.date.localeCompare(b.date));
  let running = opening;
  const rows = [[from, '期初余额', '', '', '', opening.toFixed(2)]];
  list.forEach(t => {
    let inflow = 0, outflow = 0, desc = '';
    if (t.type === 'in' && t.accountId === acc.id) { inflow = num(t.amount); desc = t.summary || txCat(t).name; }
    else if (t.type === 'out' && t.accountId === acc.id) { outflow = num(t.amount); desc = t.summary || txCat(t).name; }
    else if (t.type === 'transfer' && t.accountId === acc.id) { outflow = num(t.amount); desc = '转出至 ' + ((accById(t.toAccountId) || {}).name || ''); }
    else if (t.type === 'transfer' && t.toAccountId === acc.id) { inflow = num(t.amount); desc = '转入自 ' + ((accById(t.accountId) || {}).name || ''); }
    running = round2(running + inflow - outflow);
    rows.push([t.date, desc, t.counterparty || '', inflow ? inflow.toFixed(2) : '', outflow ? outflow.toFixed(2) : '', running.toFixed(2)]);
  });
  const ok = await saveTextFile(`月末对账单_${acc.name}_${st.month}.csv`,
    toCSV(['日期', '摘要', '对方', '收入', '支出', '余额'], rows), 'text/csv;charset=utf-8');
  if (ok) toast('对账单已导出', 'ok');
}

async function exportSummaryCSV() {
  const { from, to } = UI.reportRange;
  const st = rangeStats(from, to);
  const opening = totalBalance(addDays(from, -1));
  const rows = [];
  rows.push(['期间汇总', from, to]);
  rows.push(['期初余额', opening.toFixed(2)]);
  rows.push(['本期流入', st.inflow.toFixed(2)]);
  rows.push(['本期流出', st.outflow.toFixed(2)]);
  rows.push(['净流入', st.net.toFixed(2)]);
  rows.push(['期末余额', (opening + st.inflow - st.outflow).toFixed(2)]);
  rows.push([]);
  rows.push(['按月汇总', '期初', '流入', '流出', '期末']);
  monthsBetween(from, to).forEach(k => {
    const s = rangeStats(k + '-01', lastDayOfMonth(k) > to ? to : lastDayOfMonth(k));
    const op = totalBalance(addDays(k + '-01', -1));
    rows.push([monthLabel(k), op.toFixed(2), s.inflow.toFixed(2), s.outflow.toFixed(2), (op + s.inflow - s.outflow).toFixed(2)]);
  });
  const ok = await saveTextFile(`统计汇总_${from}_${to}.csv`, toCSV(['项目', '金额'], rows), 'text/csv;charset=utf-8');
  if (ok) toast('汇总已导出', 'ok');
}

async function exportGroupCSV() {
  const t = todayISO();
  if (!UI.groupRange.from || !UI.groupRange.to) UI.groupRange = { from: `${t.slice(0, 4)}-01-01`, to: t };
  const { from, to } = UI.groupRange;
  const head = ['公司', '期初余额', '本期流入', '本期流出', '期末余额', '库存现金', '银行存款', '应收', '应付', '账户数', '流水笔数'];
  const rows = [];
  const sum = { op: 0, inflow: 0, outflow: 0, close: 0, cash: 0, bank: 0, lend: 0, pay: 0 };
  accountingCompanies().forEach(co => {
    const s = rangeStats(from, to, co);
    /* 与集团报表同源：必须传 to，否则导出的是「今天」口径、页面是区间口径 */
    const tt = companyTotals(co, to);
    const op = companyBalanceAt(co, addDays(from, -1));
    const close = companyBalanceAt(co, to);
    const lend = debtTotals('lend', co).remaining;
    const pay = round2(debtTotals('borrow', co).remaining + debtTotals('reimburse', co).remaining);
    sum.op += op; sum.inflow += s.inflow; sum.outflow += s.outflow; sum.close += close;
    sum.cash += tt.cash; sum.bank += tt.bank; sum.lend += lend; sum.pay += pay;
    rows.push([co.name, op.toFixed(2), s.inflow.toFixed(2), s.outflow.toFixed(2), close.toFixed(2),
      tt.cash.toFixed(2), tt.bank.toFixed(2), lend.toFixed(2), pay.toFixed(2), co.accounts.length, co.transactions.length]);
  });
  rows.push(['集团合计', sum.op.toFixed(2), sum.inflow.toFixed(2), sum.outflow.toFixed(2), sum.close.toFixed(2),
    sum.cash.toFixed(2), sum.bank.toFixed(2), sum.lend.toFixed(2), sum.pay.toFixed(2), '', '']);
  const ok = await saveTextFile(`集团资金汇总_${from}_${to}.csv`, toCSV(head, rows), 'text/csv;charset=utf-8');
  if (ok) toast('集团汇总已导出', 'ok');
}

async function exportJSON() {
  const ok = await saveTextFile(`合资金账备份_${todayISO()}.json`, JSON.stringify(DB, null, 2), 'application/json');
  if (ok) toast('备份文件已导出', 'ok');
}

/* 备份文件的合法结构：v3 多公司格式（companies[]）或旧的单公司扁平格式 */
function importShapeOK(data) {
  if (!data || typeof data !== 'object') return false;
  if (Array.isArray(data.companies)) return true;
  return Array.isArray(data.accounts) && Array.isArray(data.transactions);
}

function applyImport(data) {
  let next;
  try {
    if (!importShapeOK(data)) throw new Error('文件结构不正确（既不是多公司账套，也不是旧版单公司备份）');
    next = normalize(data);
  } catch (err) {
    return toast('导入失败：' + err.message, 'err');
  }
  /* 统计必须按公司取，不能读 next.accounts —— 那是代理属性，此时还指向旧 DB */
  const cos = next.companies || [];
  const cur = cos.find(c => c.id === next.meta.activeCompanyId) || cos[0] || {};
  const accN = (cur.accounts || []).length;
  const txN = (cur.transactions || []).length;

  confirmDialog({
    title: '恢复备份',
    requireCode: true,
    message: `即将用备份覆盖当前账本：<br>公司 <b>${cos.length}</b> 家 · 当前公司账户 <b>${accN}</b> 个、流水 <b>${txN}</b> 笔 · 用户 <b>${next.users.length}</b> 个。<br>当前数据会被替换，建议先导出一份现有备份。`,
    confirmText: '确认覆盖',
    onConfirm: () => {
      DB = next;
      CURRENCY = baseCurrency();
      attachCompanyProxy(DB);
      COMPANY = activeCompany();
      saveDB();
      closeModal();
      if (!DB.users.length) { renderAuth('setup'); return; }
      renderAuth('login');
      toast('备份已恢复，请重新登录', 'ok');
    }
  });
}

function pickJSONFile() {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if (!file) return resolve(null);
      const reader = new FileReader();
      reader.onload = () => {
        try { resolve(JSON.parse(String(reader.result))); }
        catch (e) { toast('导入失败：文件不是有效的 JSON', 'err'); resolve(null); }
      };
      reader.onerror = () => { toast('读取文件失败', 'err'); resolve(null); };
      reader.readAsText(file, 'utf-8');
    });
    input.click();
  });
}

async function importJSON() {
  let data;
  if (DESKTOP) {
    const r = await window.desktop.openJSON();
    if (!r || r.canceled) return;
    if (!r.ok) return toast('导入失败：' + r.error, 'err');
    data = r.data;
  } else {
    data = await pickJSONFile();
  }
  if (data) applyImport(data);
}

/* --------------------------------- 示例数据 -------------------------------- */

function seedData() {
  const t = todayISO();
  const d = n => addDays(t, -n);

  const cash = { id: uid('a'), name: '库存现金', type: 'cash', bankName: '', accountNo: '', openingBalance: 8500, openingDate: d(120), note: '出纳备用金', active: true };
  const eco = { id: uid('a'), name: 'Ecobank 基本户', type: 'bank', bankName: 'Ecobank Ghana · Accra Main', accountNo: 'GH82 3001 **** 4471', openingBalance: 268000, openingDate: d(120), note: '主要收付账户', active: true };
  const gcb = { id: uid('a'), name: 'GCB 一般户', type: 'bank', bankName: 'GCB Bank · Osu Branch', accountNo: 'GH56 1601 **** 2093', openingBalance: 74000, openingDate: d(120), note: '工资与费用', active: true };

  const cat = name => (DB.categories.find(c => c.name === name) || {}).id || '';

  const rows = [
    [d(88), 'in', eco.id, 128000, '销售回款', 'Accra Trading Ltd', '9月订单尾款'],
    [d(85), 'out', eco.id, 46000, '采购付款', 'Kumasi Supplies', '原材料采购 一批'],
    [d(82), 'out', eco.id, 12000, '房租物业', 'Airport City 物业', '第三季度房租'],
    [d(80), 'transfer', eco.id, 50000, '内部转账', '', '基本户转一般户备付工资', gcb.id],
    [d(78), 'out', gcb.id, 68200, '工资薪酬', '员工', '8月工资发放'],
    [d(76), 'out', gcb.id, 14300, '社保公积金', 'SSNIT', '8月社保公积金'],
    [d(70), 'in', cash.id, 3000, '往来款收回', 'Kofi Mensah', '员工借款归还'],
    [d(66), 'out', cash.id, 860, '办公费用', 'Papyrus Stationery', '打印纸与耗材'],
    [d(60), 'in', eco.id, 96500, '销售回款', 'Tema Logistics', '项目一期款'],
    [d(58), 'out', eco.id, 32800, '税费', 'GRA', '增值税及附加'],
    [d(55), 'out', gcb.id, 5200, '差旅费', '员工报销', 'Kumasi 客户拜访'],
    [d(50), 'in', eco.id, 2400, '利息收入', 'Ecobank', '季度存款利息'],
    [d(46), 'out', eco.id, 78000, '采购付款', 'Takoradi Hardware', '设备配件采购'],
    [d(42), 'transfer', eco.id, 60000, '内部转账', '', '补充工资账户', gcb.id],
    [d(40), 'out', gcb.id, 71200, '工资薪酬', '员工', '9月工资发放'],
    [d(38), 'out', gcb.id, 14900, '社保公积金', 'SSNIT', '9月社保公积金'],
    [d(34), 'out', cash.id, 1200, '水电费', 'ECG', '办公水电'],
    [d(30), 'in', eco.id, 156000, '销售回款', 'Accra Trading Ltd', '10月订单预付款'],
    [d(26), 'out', eco.id, 5600, '市场推广', 'Meta Ads', '线上投放'],
    [d(22), 'out', gcb.id, 3600, '利息手续费', 'GCB Bank', '贷款利息及手续费'],
    [d(18), 'in', gcb.id, 22000, '服务收入', 'Volta Consulting', '技术服务费'],
    [d(15), 'out', cash.id, 2400, '备用金', '出纳', '提取备用金'],
    [d(12), 'out', eco.id, 88000, '采购付款', 'Kumasi Supplies', '原材料采购 二批'],
    [d(9), 'in', eco.id, 48000, '其他业务收入', '废料回收', '边角料处置收入'],
    [d(6), 'out', gcb.id, 4280, '办公费用', 'Compughana', '办公设备'],
    [d(4), 'out', eco.id, 15000, '还款', 'Ecobank', '短期借款还款'],
    [d(2), 'in', eco.id, 76000, '销售回款', 'Tema Logistics', '项目二期款']
  ];

  DB.accounts = [cash, eco, gcb];
  DB.transactions = rows.map(r => ({
    id: uid('t'),
    date: r[0], type: r[1], accountId: r[2], amount: r[3],
    categoryId: r[1] === 'transfer' ? '' : cat(r[4]),
    category: r[4], counterparty: r[5], summary: r[6],
    toAccountId: r[7] || '', voucherNo: '', operator: SESSION.displayName, userId: SESSION.id,
    createdAt: new Date(r[0] + 'T09:00:00').toISOString(),
    updatedAt: new Date(r[0] + 'T09:00:00').toISOString()
  }));

  DB.debts = [
    { id: uid('d'), type: 'lend', party: 'Kofi Mensah', amount: 15000, date: d(45), dueDate: addDays(t, 15), accountId: eco.id, note: '员工应急借款', createdAt: new Date().toISOString(), userId: SESSION.id },
    { id: uid('d'), type: 'lend', party: 'Accra Trading Ltd', amount: 32000, date: d(20), dueDate: addDays(t, -3), accountId: eco.id, note: '客户短期周转', createdAt: new Date().toISOString(), userId: SESSION.id },
    { id: uid('d'), type: 'borrow', party: 'Ecobank', amount: 120000, date: d(70), dueDate: addDays(t, 90), accountId: eco.id, note: '流动资金贷款', createdAt: new Date().toISOString(), userId: SESSION.id },
    { id: uid('d'), type: 'reimburse', party: 'Ama Boateng', amount: 3200, date: d(8), dueDate: '', accountId: '', note: '客户拜访交通与餐费', createdAt: new Date().toISOString(), userId: SESSION.id },
    { id: uid('d'), type: 'reimburse', party: 'Yaw Owusu', amount: 1850, date: d(3), dueDate: '', accountId: '', note: '办公用品垫付', createdAt: new Date().toISOString(), userId: SESSION.id }
  ];
  DB.settlements = [];

  const thisM = monthOf(t);
  const budgets = [
    ['采购付款', 200000], ['工资薪酬', 75000], ['房租物业', 15000], ['税费', 40000],
    ['办公费用', 8000], ['市场推广', 12000], ['差旅费', 6000], ['水电费', 3000]
  ];
  DB.budgets = budgets.map(([name, amt]) => ({ id: uid('b'), month: thisM, categoryId: cat(name), amount: amt }))
    .filter(b => b.categoryId);

  if (!COMPANY.name || COMPANY.name === '我的公司') COMPANY.name = '示例贸易有限公司';
  saveDB();
  UI.view = 'dashboard';
  render();
  toast('示例数据已载入', 'ok');
}

/* -------------------------------- 公司档案 -------------------------------- */

function openVaultFieldModal(fieldId, preset) {
  const isEdit = !!fieldId;
  const existing = isEdit ? COMPANY.profile.fields.find(x => x.id === fieldId) : null;
  const data = existing || preset || { group: '其他', label: '', type: 'text', value: '', note: '' };

  openModal(modalShell({
    title: isEdit ? '编辑条目' : '添加条目',
    sub: '密码类条目在列表中默认以圆点显示',
    cls: 'slim',
    body: `<form id="vault-form">
      <div class="modal-bd">
        <div class="form-grid">
          <label class="field span-2"><span class="lbl">名称</span><input type="text" name="label" value="${esc(data.label)}" placeholder="如：网银密码" required></label>
          <label class="field"><span class="lbl">分组</span>
            <select name="group">${FIELD_GROUPS.map(g => `<option ${data.group === g ? 'selected' : ''}>${g}</option>`).join('')}</select>
          </label>
          <label class="field"><span class="lbl">类型</span>
            <select name="type">
              <option value="text" ${data.type === 'text' ? 'selected' : ''}>文本</option>
              <option value="password" ${data.type === 'password' ? 'selected' : ''}>密码（隐藏）</option>
              <option value="url" ${data.type === 'url' ? 'selected' : ''}>网址</option>
            </select>
          </label>
          <label class="field span-2"><span class="lbl">内容</span>
            <input type="text" name="value" value="${esc(data.value)}" placeholder="账号 / 密码 / 链接" autocomplete="off">
          </label>
          <label class="field span-2"><span class="lbl">备注</span>
            <input type="text" name="note" value="${esc(data.note || '')}" placeholder="如：U 盾编号、密码提示，可选">
          </label>
        </div>
      </div>
      <div class="modal-ft">
        <div class="spacer"></div>
        <button type="button" class="btn secondary" data-action="close-modal">取消</button>
        <button type="submit" class="btn primary">${isEdit ? '保存' : '添加'}</button>
      </div>
    </form>`
  }));

  const form = $('#vault-form');
  form.addEventListener('submit', e => {
    e.preventDefault();
    const fd = new FormData(form);
    const label = String(fd.get('label') || '').trim();
    if (!label) return toast('请填写名称', 'err');
    const payload = {
      group: fd.get('group') || '其他',
      label,
      type: fd.get('type') || 'text',
      value: String(fd.get('value') || ''),
      note: String(fd.get('note') || ''),
      updatedAt: new Date().toISOString()
    };
    if (isEdit) Object.assign(existing, payload);
    else COMPANY.profile.fields.push(Object.assign({ id: uid('vf') }, payload));
    saveDB(); closeModal(); renderView();
    toast(isEdit ? '已保存' : '已添加', 'ok');
  });
}

function openVaultTemplatesMenu(anchor) {
  showPopover(anchor, `<div class="menu" style="width:280px">
    <div class="menu-head"><strong>快速添加</strong><span>选一个模板，填内容即可</span></div>
    <div class="menu-sep"></div>
    <div style="max-height:320px;overflow:auto">
      ${FIELD_TEMPLATES.map((t, i) => `<button class="menu-item" data-action="vault-tpl" data-i="${i}">
        ${icon(t.type === 'password' ? 'lock' : groupIcon(t.group), 14)}
        <span style="flex:1">${esc(t.label)}</span>
        <span style="font-size:10.5px;color:var(--muted-2)">${t.group}</span>
      </button>`).join('')}
    </div>
    <div class="menu-sep"></div>
    <button class="menu-item" data-action="vault-add">${icon('plus', 14)} 自定义条目</button>
  </div>`, { width: 280 });
}

async function openFileUploadModal() {
  let picked = [];
  try {
    picked = await FileStore.pick();
  } catch (e) {
    return toast('选择文件失败：' + e.message, 'err');
  }
  if (!picked || !picked.length) return;

  const rows = picked.map((f, i) => ({
    key: i,
    item: f,
    original: f.name,
    ext: extOf(f.name),
    size: num(f.size),
    name: baseName(f.name)
  }));

  openModal(modalShell({
    title: rows.length > 1 ? `上传 ${rows.length} 个文件` : '上传资料',
    sub: '可以给每个文件起一个容易识别的名称',
    body: `<form id="upload-form">
      <div class="modal-bd">
        <div class="upload-list">
          ${rows.map(r => {
            const k = fileKind(r.ext);
            return `<div class="upload-row">
              <span class="file-ext ${k.tone}">${k.label}</span>
              <div class="upload-main">
                <input type="text" name="name-${r.key}" value="${esc(r.name)}" placeholder="资料名称">
                <span>${esc(r.original)} · ${fmtSize(r.size)}</span>
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>
      <div class="modal-ft">
        <span class="hint">文件会复制到本机数据目录，原文件不受影响</span>
        <div class="spacer"></div>
        <button type="button" class="btn secondary" data-action="close-modal">取消</button>
        <button type="submit" class="btn primary">上传</button>
      </div>
    </form>`
  }));

  const form = $('#upload-form');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true; btn.textContent = '上传中…';
    let ok = 0, fail = 0;
    for (const r of rows) {
      const input = form.elements['name-' + r.key];
      const name = String((input && input.value) || '').trim() || baseName(r.original);
      const id = uid('f');
      let res;
      try {
        res = await FileStore.save(COMPANY.id, id, name, r.ext, r.item);
      } catch (err) {
        res = { ok: false, error: err.message };
      }
      if (!res || !res.ok) { fail++; continue; }
      COMPANY.profile.files.push({
        id, name,
        original: r.original,
        ext: r.ext,
        size: res.size || r.size,
        addedAt: new Date().toISOString(),
        mtime: res.mtime || r.item.mtime || '',
        relPath: res.relPath || '',
        userId: SESSION.id,
        note: ''
      });
      ok++;
    }
    saveDB(); closeModal(); renderView();
    if (ok && !fail) toast(`已上传 ${ok} 个文件`, 'ok');
    else if (ok && fail) toast(`成功 ${ok} 个，失败 ${fail} 个`, '');
    else toast('上传失败，请重试', 'err');
  });
}

function openFileRenameModal(fileId) {
  const f = COMPANY.profile.files.find(x => x.id === fileId);
  if (!f) return;
  openModal(modalShell({
    title: '重命名资料',
    sub: `${esc(f.original || '')} · ${fmtSize(f.size)}`,
    cls: 'slim',
    body: `<form id="rename-form">
      <div class="modal-bd">
        <label class="field"><span class="lbl">资料名称</span><input type="text" name="name" value="${esc(f.name)}" required></label>
      </div>
      <div class="modal-ft">
        <div class="spacer"></div>
        <button type="button" class="btn secondary" data-action="close-modal">取消</button>
        <button type="submit" class="btn primary">保存</button>
      </div>
    </form>`
  }));
  const form = $('#rename-form');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const name = String(form.elements.name.value || '').trim();
    if (!name) return toast('请填写名称', 'err');
    const res = await FileStore.rename(f, name);
    if (res && res.ok === false) return toast(res.error || '重命名失败', 'err');
    f.name = name;
    if (res && res.relPath) f.relPath = res.relPath;
    saveDB(); closeModal(); renderView();
    toast('已重命名', 'ok');
  });
}

/* ------------------------------ 预留信息设置 ------------------------------ */

function openSecurityModal() {
  const me = userById(SESSION.id);
  if (!me) return;
  const cur = me.security || [];

  const row = (i) => {
    const sel = cur[i] ? cur[i].q : SECURITY_QUESTIONS[i];
    const idx = Math.max(0, SECURITY_QUESTIONS.indexOf(sel));
    return `<label class="field"><span class="lbl">问题${i + 1}</span>
        <select name="q${i}">${SECURITY_QUESTIONS.map((q, k) => `<option value="${esc(q)}" ${k === idx ? 'selected' : ''}>${esc(q)}</option>`).join('')}</select>
      </label>
      <label class="field"><span class="lbl">答案${i + 1}</span>
        <input type="text" name="a${i}" placeholder="不区分大小写" required autocomplete="off">
      </label>`;
  };

  openModal(modalShell({
    title: cur.length ? '修改预留信息' : '设置预留信息',
    sub: '忘记密码时，通过这两个问题的答案验证身份并重置密码',
    body: `<form id="sec-form">
      <div class="modal-bd">
        <div class="form-grid" style="gap:13px">
          ${row(0)}
          ${row(1)}
        </div>
        ${cur.length ? `<div class="alert info" style="margin-top:14px">${icon('info', 15)}<div>修改后需要用新答案验证，旧答案立即失效。</div></div>` : ''}
      </div>
      <div class="modal-ft">
        <div class="spacer"></div>
        <button type="button" class="btn secondary" data-action="close-modal">取消</button>
        <button type="submit" class="btn primary">保存</button>
      </div>
    </form>`
  }));

  const form = $('#sec-form');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(form);
    const pairs = [0, 1].map(i => ({ q: fd.get('q' + i), a: String(fd.get('a' + i) || '').trim() }));
    if (!pairs[0].a || !pairs[1].a) return toast('请填写两个答案', 'err');
    if (pairs[0].q === pairs[1].q) return toast('两个问题不能相同', 'err');
    await setSecurity(me, pairs);
    saveDB(); closeModal(); renderView();
    toast('预留信息已保存', 'ok');
  });
}

/* --------------------------------- 使用手册 -------------------------------- */

function openManual() {
  openModal(modalShell({
    title: '使用手册',
    sub: '全部功能的说明与操作步骤',
    cls: 'wide manual-modal',
    body: `<div class="manual-body">
      <iframe src="assets/manual.html" title="使用手册"></iframe>
    </div>`,
    footer: `<div class="modal-ft">
      <span class="hint">手册文件也在安装目录下：操作手册.html</span>
      <div class="spacer"></div>
      <button class="btn secondary" data-action="manual-external">在浏览器中打开</button>
      <button class="btn primary" data-action="close-modal">关闭</button>
    </div>`
  }), { noFocus: true });
}

/* -------------------------------- 导入资金明细 -------------------------------- */

const IMPORT_HEADERS = ['日期', '类型', '分类', '账户', '转入账户', '金额', '往来单位', '摘要', '凭证号', '经办人'];

const IMPORT_ALIASES = {
  日期: ['日期', 'date', '交易日期', '时间'],
  类型: ['类型', 'type', '收支', '收支类型'],
  分类: ['分类', 'category', '类别'],
  账户: ['账户', 'account', '账户名称', '付款账户'],
  转入账户: ['转入账户', '对方账户', 'to', '转入'],
  金额: ['金额', 'amount', '发生额'],
  往来单位: ['往来单位', '对方', 'counterparty', '客户', '供应商'],
  摘要: ['摘要', 'summary', '备注', '说明', 'memo'],
  凭证号: ['凭证号', 'voucher', '单据号', '发票号'],
  经办人: ['经办人', 'operator', '操作人']
};

function parseCSVText(text) {
  const clean = String(text || '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (inQ) {
      if (c === '"') {
        if (clean[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',' || c === '\t') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(c => String(c).trim() !== ''));
}

function normalizeImportDate(v) {
  const s = String(v || '').trim().replace(/[./]/g, '-');
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return '';
}

function normalizeImportType(v) {
  const s = String(v || '').trim().toLowerCase();
  if (['收入', 'in', '收', '收款', 'income'].includes(s)) return 'in';
  if (['支出', 'out', '付', '付款', 'expense'].includes(s)) return 'out';
  if (['内部转账', '转账', 'transfer', '互转', '公司间转账'].includes(s)) return 'transfer';
  return '';
}

function normalizeAmount(v) {
  const s = String(v || '').replace(/[^\d.\-]/g, '');
  const n = parseFloat(s);
  return Number.isFinite(n) ? Math.abs(n) : NaN;
}

/* 解析并校验，返回可直接写入的流水 */
function buildImportRows(text) {
  const table = parseCSVText(text);
  if (!table.length) return { rows: [], errors: [{ line: 0, msg: '文件是空的' }], header: [] };

  const header = table[0].map(h => String(h).trim());
  const idx = {};
  Object.keys(IMPORT_ALIASES).forEach(key => {
    const i = header.findIndex(h => IMPORT_ALIASES[key].some(a => h.toLowerCase() === String(a).toLowerCase()));
    if (i >= 0) idx[key] = i;
  });
  if (idx['日期'] === undefined || idx['金额'] === undefined) {
    return { rows: [], errors: [{ line: 1, msg: '表头缺少「日期」或「金额」列，请使用导入模板' }], header };
  }

  const rows = [], errors = [];
  const cell = (r, key) => (idx[key] === undefined ? '' : String(r[idx[key]] || '').trim());

  for (let i = 1; i < table.length; i++) {
    const r = table[i];
    const lineNo = i + 1;
    const date = normalizeImportDate(cell(r, '日期'));
    const type = normalizeImportType(cell(r, '类型')) || 'out';
    const amount = normalizeAmount(cell(r, '金额'));
    const catName = cell(r, '分类');
    const accName = cell(r, '账户');
    const toAccName = cell(r, '转入账户');

    if (!date) { errors.push({ line: lineNo, msg: `日期「${cell(r, '日期')}」无法识别` }); continue; }
    if (!Number.isFinite(amount) || amount <= 0) { errors.push({ line: lineNo, msg: `金额「${cell(r, '金额')}」不正确` }); continue; }

    const acc = DB.accounts.find(a => a.name === accName);
    if (!acc) { errors.push({ line: lineNo, msg: `账户「${accName || '空'}」不存在` }); continue; }

    let toAcc = null;
    if (type === 'transfer') {
      toAcc = DB.accounts.find(a => a.name === toAccName);
      if (!toAcc) { errors.push({ line: lineNo, msg: `转入账户「${toAccName || '空'}」不存在` }); continue; }
      if (toAcc.id === acc.id) { errors.push({ line: lineNo, msg: '转出与转入账户相同' }); continue; }
    } else if (!catName) {
      errors.push({ line: lineNo, msg: '缺少分类' });
      continue;
    }

    rows.push({
      date, type, amount,
      accountId: acc.id,
      toAccountId: toAcc ? toAcc.id : '',
      categoryName: type === 'transfer' ? '内部转账' : catName,
      counterparty: cell(r, '往来单位'),
      summary: cell(r, '摘要'),
      voucherNo: cell(r, '凭证号'),
      operator: cell(r, '经办人') || SESSION.displayName
    });
  }
  return { rows, errors, header };
}

/* 导入：缺失分类自动创建，完全重复的流水默认跳过 */
function commitImportRows(rows, opts = {}) {
  const kindOf = t => (t === 'in' ? 'in' : 'out');
  let created = 0, skipped = 0, newCats = 0;

  rows.forEach(r => {
    if (r.type !== 'transfer') {
      const exist = DB.categories.find(c => c.kind === kindOf(r.type) && c.name === r.categoryName);
      if (!exist) {
        DB.categories.push({
          id: uid('c'), name: r.categoryName, kind: kindOf(r.type),
          cf: r.type === 'in' ? 'op_in_other' : 'op_out_other',
          icon: 'tag', color: '#64748b', active: true, system: false
        });
        newCats++;
      }
    }

    if (opts.skipDup !== false) {
      const dup = DB.transactions.some(t =>
        t.date === r.date && t.type === r.type &&
        Math.abs(num(t.amount) - r.amount) < 0.005 &&
        (t.summary || '') === (r.summary || '') &&
        (t.accountId || '') === (r.accountId || ''));
      if (dup) { skipped++; return; }
    }

    const cat = r.type === 'transfer' ? null : DB.categories.find(c => c.kind === kindOf(r.type) && c.name === r.categoryName);
    DB.transactions.push({
      id: uid('t'),
      date: r.date,
      type: r.type,
      accountId: r.accountId,
      toAccountId: r.toAccountId,
      amount: r.amount,
      categoryId: cat ? cat.id : '',
      category: r.type === 'transfer' ? '内部转账' : r.categoryName,
      counterparty: r.counterparty,
      summary: r.summary,
      voucherNo: r.voucherNo,
      operator: r.operator,
      userId: SESSION.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      imported: true
    });
    created++;
  });

  saveDB();
  return { created, skipped, newCats };
}

function importTemplateCSV() {
  const sample = [
    ['2026-01-05', '收入', '销售回款', (DB.accounts[0] || {}).name || '基本户', '', '12500.00', 'ABC 公司', '1 月货款', 'INV-001', SESSION.displayName],
    ['2026-01-08', '支出', '采购付款', (DB.accounts[0] || {}).name || '基本户', '', '3200.00', 'XYZ 供应商', '原材料采购', '', SESSION.displayName],
    ['2026-01-10', '内部转账', '', (DB.accounts[0] || {}).name || '基本户', (DB.accounts[1] || {}).name || '备用金', '1000.00', '', '提取备用金', '', SESSION.displayName]
  ];
  return toCSV(IMPORT_HEADERS, sample);
}

function openImportModal() {
  if (!DB.accounts.length) { toast('请先创建账户，再导入明细', 'err'); return openAccountModal(); }

  openModal(modalShell({
    title: '导入资金明细',
    sub: '用于补录历史流水；Excel 请先另存为 CSV',
    cls: 'wide',
    body: `<div class="modal-bd">
      <div id="import-body">
        <div class="import-drop" id="import-drop">
          <div class="empty-ico" style="width:44px;height:44px">${icon('upload', 20)}</div>
          <b>选择 CSV 文件</b>
          <span>列：日期、类型、分类、账户、转入账户、金额、往来单位、摘要、凭证号、经办人</span>
          <div style="display:flex;gap:8px;margin-top:6px">
            <button class="btn primary sm" data-action="import-pick">选择文件</button>
            <button class="btn secondary sm" data-action="import-template">下载模板</button>
          </div>
        </div>
      </div>
    </div>
    <div class="modal-ft" id="import-foot">
      <span class="hint">日期支持 2026-01-05 / 2026/1/5 / 20260105</span>
      <div class="spacer"></div>
      <button class="btn secondary" data-action="close-modal">取消</button>
    </div>`
  }), { noFocus: true });

  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.csv,.txt,text/csv';
  input.style.display = 'none';
  document.body.appendChild(input);
  input.addEventListener('change', () => {
    const f = input.files && input.files[0];
    if (!f) return;
    const fr = new FileReader();
    fr.onload = () => renderImportPreview(String(fr.result), f.name);
    fr.onerror = () => toast('读取文件失败', 'err');
    fr.readAsText(f, 'utf-8');
    input.value = '';
  });
  window.__importPick = () => input.click();
}

function renderImportPreview(text, fileName) {
  const { rows, errors } = buildImportRows(text);
  const body = $('#import-body');
  const foot = $('#import-foot');
  if (!body || !foot) return;

  const previewRows = rows.slice(0, 60).map((r, i) => {
    const acc = accById(r.accountId);
    const to = accById(r.toAccountId);
    return `<tr>
      <td class="num nowrap">${r.date}</td>
      <td>${r.type === 'in' ? '<span class="pill in">收入</span>' : r.type === 'out' ? '<span class="pill out">支出</span>' : '<span class="pill move">转账</span>'}</td>
      <td>${esc(r.categoryName)}</td>
      <td class="nowrap">${esc(acc ? acc.name : '')}${to ? ' → ' + esc(to.name) : ''}</td>
      <td class="tr cell-amount ${r.type === 'in' ? 'in' : r.type === 'out' ? 'out' : 'move'}">${fmtPlain(r.amount)}</td>
      <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.summary || r.counterparty || '')}</td>
    </tr>`;
  }).join('');

  body.innerHTML = `
    <div class="import-summary">
      <span class="pill ok">可导入 ${rows.length} 条</span>
      ${errors.length ? `<span class="pill danger">问题 ${errors.length} 条</span>` : ''}
      <span class="muted" style="font-size:12px">${esc(fileName || '')}</span>
    </div>
    ${errors.length ? `<div class="import-errors">
      ${errors.slice(0, 8).map(e => `<div>第 ${e.line} 行：${esc(e.msg)}</div>`).join('')}
      ${errors.length > 8 ? `<div>… 还有 ${errors.length - 8} 条</div>` : ''}
    </div>` : ''}
    ${rows.length ? `<div class="table-wrap" style="max-height:300px">
      <table class="tbl">
        <thead><tr><th style="width:100px">日期</th><th style="width:80px">类型</th><th>分类</th><th>账户</th><th class="tr" style="width:110px">金额</th><th>摘要</th></tr></thead>
        <tbody>${previewRows}</tbody>
      </table>
    </div>
    ${rows.length > 60 ? `<div style="padding:8px 0;font-size:12px;color:var(--muted-2)">仅预览前 60 条，实际导入 ${rows.length} 条</div>` : ''}` : ''}
  `;

  foot.innerHTML = `
    <span class="hint">${errors.length ? '有问题的行会被跳过' : '将写入当前公司账本'}</span>
    <div class="spacer"></div>
    <button class="btn secondary" data-action="import-pick">重新选择</button>
    <button class="btn primary" data-action="import-confirm" ${rows.length ? '' : 'disabled'}>导入 ${rows.length} 条</button>
  `;
  window.__importRows = rows;
  window.__importErrors = errors;
}

function confirmImport() {
  const rows = window.__importRows || [];
  if (!rows.length) return;
  const res = commitImportRows(rows, { skipDup: true });
  closeModal();
  UI.view = 'transactions';
  renderView();
  const parts = [`成功导入 ${res.created} 条`];
  if (res.skipped) parts.push(`跳过重复 ${res.skipped} 条`);
  if (res.newCats) parts.push(`新建分类 ${res.newCats} 个`);
  toast(parts.join('，'), 'ok');
}

/* ============================================================================
   v4.3 业务弹窗：往来单位 / 借支备用金 / 票据未回
   ========================================================================== */

/* ------------------------------ 往来单位 ------------------------------ */
function openPartyModal(id) {
  const isEdit = !!id;
  const p = isEdit ? partyById(id) : null;
  openModal(modalShell({
    title: isEdit ? '编辑往来单位' : '新增往来单位',
    sub: '客户、供应商或合作方',
    cls: 'slim',
    body: `<form id="party-form" novalidate>
      <div class="modal-bd">
        <div class="form-grid">
          <label class="field span-2"><span class="lbl">单位名称</span>
            <input type="text" name="name" value="${p ? esc(p.name) : ''}" placeholder="公司或个人名称" required></label>
          <label class="field"><span class="lbl">类型</span>
            <select name="type">${Object.entries(PARTY_TYPES).map(([k, v]) =>
              `<option value="${k}" ${p && p.type === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
          <label class="field"><span class="lbl">联系人</span>
            <input type="text" name="contact" value="${p ? esc(p.contact || '') : ''}" placeholder="对接人"></label>
          <label class="field"><span class="lbl">电话</span>
            <input type="text" name="phone" value="${p ? esc(p.phone || '') : ''}" placeholder="+233 ..."></label>
          <label class="field"><span class="lbl">税号 / TIN</span>
            <input type="text" name="taxNo" value="${p ? esc(p.taxNo || '') : ''}"></label>
          <label class="field span-2"><span class="lbl">备注</span>
            <input type="text" name="note" value="${p ? esc(p.note || '') : ''}" placeholder="地址、账期等"></label>
        </div>
      </div>
      <div class="modal-ft"><div class="spacer"></div>
        <button type="button" class="btn secondary" data-action="close-modal">取消</button>
        <button type="submit" class="btn primary">${isEdit ? '保存' : '新增'}</button>
      </div>
    </form>`
  }));

  const form = $('#party-form');
  form.addEventListener('submit', e => {
    e.preventDefault();
    const fd = new FormData(form);
    const name = String(fd.get('name') || '').trim();
    const okP = showFormErrors(form, validateForm(form, [
      { name: 'name', label: '单位名称', checks: [
        { t: 'required' }, { t: 'len', min: 2, max: 50 },
        { t: 'unique', unique: v => ensurePartyList(COMPANY).some(x => x.name === v && (!p || x.id !== p.id)), msg: '已存在同名单位' }
      ] },
      { name: 'phone', label: '电话', checks: [{ t: 'phone' }] },
      { name: 'taxNo', label: '税号', checks: [{ t: 'taxNo' }] },
      { name: 'contact', label: '联系人', checks: [{ t: 'len', max: 30 }] }
    ]));
    if (!okP) return;
    const data = {
      name, type: fd.get('type') || 'other',
      contact: String(fd.get('contact') || '').trim(),
      phone: String(fd.get('phone') || '').trim(),
      taxNo: String(fd.get('taxNo') || '').trim(),
      note: String(fd.get('note') || '').trim(),
      active: true
    };
    if (isEdit) { Object.assign(p, data); logAction('修改', { module: '档案', target: '往来单位 ' + name, targetId: p.id }); }
    else {
      const np = Object.assign({ id: uid('pt') }, data);
      ensurePartyList(COMPANY).push(np);
      logAction('新增', { module: '档案', target: '往来单位 ' + name, targetId: np.id });
    }
    saveDB(); closeModal(); render();
    toast(isEdit ? '已保存' : '已新增', 'ok');
  });
}

/* ------------------------------ 借支备用金 ------------------------------ */
function openAdvanceModal() {
  openModal(modalShell({
    title: '申请借支',
    sub: '登记员工预支的备用金',
    cls: 'slim',
    body: `<form id="adv-form" novalidate>
      <div class="modal-bd">
        <div class="form-grid">
          <label class="field span-2"><span class="lbl">员工</span>
            <input type="text" name="userName" placeholder="姓名" required></label>
          <label class="field"><span class="lbl">借支金额</span>
            <div class="input-affix"><span class="prefix">${curSymbol()}</span>
              <input type="number" name="amount" min="0.01" step="0.01" placeholder="0.00" required></div></label>
          <label class="field"><span class="lbl">日期</span>
            <input type="date" name="date" value="${todayISO()}"></label>
          <label class="field span-2"><span class="lbl">事由</span>
            <input type="text" name="reason" placeholder="差旅、采购等"></label>
        </div>
      </div>
      <div class="modal-ft"><div class="spacer"></div>
        <button type="button" class="btn secondary" data-action="close-modal">取消</button>
        <button type="submit" class="btn primary">提交申请</button>
      </div>
    </form>`
  }));

  const form = $('#adv-form');
  form.addEventListener('submit', e => {
    e.preventDefault();
    const fd = new FormData(form);
    const name = String(fd.get('userName') || '').trim();
    const amount = round2(num(fd.get('amount')));
    const okA = showFormErrors(form, validateForm(form, [
      { name: 'userName', label: '员工', checks: [{ t: 'required' }, { t: 'len', max: 30 }] },
      { name: 'amount', label: '借支金额', checks: [{ t: 'required' }, { t: 'number', min: 0.01, max: 10000000, decimals: 2 }] },
      { name: 'date', label: '日期', checks: [{ t: 'date' }] },
      { name: 'reason', label: '事由', checks: [{ t: 'len', max: 100 }] }
    ]));
    if (!okA) return;
    const a = {
      id: uid('adv'), userName: name, amount,
      date: fd.get('date') || todayISO(),
      reason: String(fd.get('reason') || '').trim(),
      status: 'pending', usedAmount: 0, issuedAt: '', closedAt: '',
      accountId: '', note: ''
    };
    ensureAdvanceList(COMPANY).push(a);
    logAction('新增', { module: '档案', target: '借支 ' + name + ' ' + fmt(amount), targetId: a.id });
    saveDB(); closeModal(); render();
    toast('已提交，待发放', 'ok');
  });
}

function issueAdvance(id) {
  const a = ensureAdvanceList(COMPANY).find(x => x.id === id);
  if (!a) return;
  const accs = DB.accounts.filter(x => x.active !== false);
  if (!accs.length) return toast('请先创建账户', 'err');

  openModal(modalShell({
    title: '发放借支',
    sub: `向 ${a.userName} 发放 ${fmt(a.amount)}，将生成一笔支出流水`,
    cls: 'slim',
    body: `<form id="issue-form">
      <div class="modal-bd">
        <div class="form-grid">
          <label class="field span-2"><span class="lbl">付款账户</span>
            <select name="accountId">${accs.map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select></label>
          <label class="field span-2"><span class="lbl">发放日期</span>
            <input type="date" name="date" value="${todayISO()}"></label>
        </div>
      </div>
      <div class="modal-ft"><div class="spacer"></div>
        <button type="button" class="btn secondary" data-action="close-modal">取消</button>
        <button type="submit" class="btn primary">确认发放</button>
      </div>
    </form>`
  }));

  const form = $('#issue-form');
  form.addEventListener('submit', e => {
    e.preventDefault();
    const fd = new FormData(form);
    const cat = ensureGroupCategory(COMPANY, 'advanceOut');
    const tx = {
      id: uid('t'), date: fd.get('date') || todayISO(), type: 'out',
      accountId: fd.get('accountId'), toAccountId: '', amount: a.amount,
      categoryId: cat.id, category: cat.name,
      counterparty: a.userName, summary: '借支发放：' + (a.reason || ''),
      voucherNo: nextVoucherNo('out', fd.get('date') || todayISO()),
      operator: SESSION.displayName, userId: SESSION.id,
      createdAt: new Date().toISOString()
    };
    COMPANY.transactions.push(tx);
    a.status = 'issued'; a.issuedAt = tx.date; a.accountId = tx.accountId;
    logAction('新增', { module: '流水', target: '借支发放 ' + a.userName, targetId: tx.id, after: fmt(a.amount) });
    saveDB(); closeModal(); render();
    toast('已发放，并生成支出流水', 'ok');
  });
}

function closeAdvance(id) {
  const a = ensureAdvanceList(COMPANY).find(x => x.id === id);
  if (!a) return;
  const info = advanceInfo(a);
  const remain = Math.max(0, info.remain);
  if (remain <= 0.005) return toast('这笔借支已经核销完了', 'err');

  openModal(modalShell({
    title: '核销借支',
    sub: `${esc(a.userName || '')} · 借支 ${fmt(a.amount)} · 剩余 ${fmt(remain)}`,
    cls: 'slim',
    body: `<form id="close-adv-form">
      <div class="modal-bd">
        <div class="summary-strip" style="padding:0 0 14px;gap:22px">
          <div class="item"><span>借支金额</span><strong>${fmt(a.amount)}</strong></div>
          <div class="item"><span>已核销</span><strong>${fmt(info.used)}</strong></div>
          <div class="item"><span>剩余</span><strong style="color:var(--warn)">${fmt(remain)}</strong></div>
        </div>
        <div class="form-grid">
          <label class="field span-2"><span class="lbl">本次实际使用金额</span>
            <div class="input-affix"><span class="prefix">${curSymbol()}</span>
              <input type="number" name="used" min="0" step="0.01" value="${remain}" required></div></label>
          <label class="field span-2"><span class="lbl">余额退回账户</span>
            <select name="accountId"><option value="">不退余额</option>
              ${DB.accounts.filter(x => x.active !== false).map(x => `<option value="${x.id}" ${a.accountId === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}
            </select></label>
          <label class="field span-2"><span class="lbl">核销日期</span>
            <input type="date" name="date" value="${todayISO()}"></label>
          <label class="switch span-2"><input type="checkbox" name="closeAll"><span class="track"></span><span>同时把未用完的余额全部退回并结清</span></label>
        </div>
        <div class="alert info" style="margin-top:12px">${icon('info', 15)}
          <div>不勾选时只登记本次使用金额，余额继续挂着，可以以后再核销。</div></div>
      </div>
      <div class="modal-ft"><div class="spacer"></div>
        <button type="button" class="btn secondary" data-action="close-modal">取消</button>
        <button type="submit" class="btn primary">确认核销</button>
      </div>
    </form>`
  }));

  const form = $('#close-adv-form');
  form.addEventListener('submit', e => {
    e.preventDefault();
    const fd = new FormData(form);
    const used = round2(num(fd.get('used')));
    if (used > remain + 0.005) return failField(form, 'used', '本次核销金额不能超过剩余');
    const accId = String(fd.get('accountId') || '');
    const closeAll = fd.get('closeAll') === 'on';
    const back = closeAll ? round2(remain - used) : 0;
    const date = fd.get('date') || todayISO();
    if (back > 0 && !accId) return toast('要退回余额，请选择退回账户', 'err');

    guardChange({
      title: '确认核销这笔借支？',
      message: `本次核销 <b>${fmt(used)}</b>${back > 0 ? `，退回余额 <b>${fmt(back)}</b>` : ''}。${closeAll ? '<br>核销后该笔借支将结清。' : '<br>余额会继续保留，可再次核销。'}`,
      confirmText: '确认核销',
      level: 'code',
      onConfirm: () => {
        let txId = '';
        if (back > 0 && accId) {
          const cat = ensureGroupCategory(COMPANY, 'advanceIn');
          txId = uid('t');
          COMPANY.transactions.push({
            id: txId, date, type: 'in',
            accountId: accId, toAccountId: '', amount: back,
            categoryId: cat.id, category: cat.name,
            counterparty: a.userName, summary: '借支余额退回',
            voucherNo: nextVoucherNo('in', date),
            operator: SESSION.displayName, userId: SESSION.id,
            createdAt: new Date().toISOString()
          });
        }
        if (!Array.isArray(a.draws)) a.draws = [];
        a.draws.push({ id: uid('dr'), date, used, back, accountId: accId, txId, at: new Date().toISOString(), userId: SESSION.id });

        const now = advanceInfo(a);
        a.usedAmount = now.used;
        a.status = now.remain <= 0.005 ? 'closed' : 'issued';
        if (a.status === 'closed') a.closedAt = date;

        logAction('修改', {
          module: '档案',
          target: '核销借支 ' + (a.userName || ''),
          targetId: a.id,
          after: `本次使用 ${fmt(used)}${back > 0 ? '，退回 ' + fmt(back) : ''}，剩余 ${fmt(now.remain)}`
        });
        saveDB(); closeModal(); render();
        toast('已核销' + (back > 0 ? '，余额已退回' : ''), 'ok');
      }
    });
  });
}

/* 撤销最近一次核销：删除核销记录 + 反向删除其退回流水（REQ-16） */
function undoAdvanceDraw(id) {
  const a = ensureAdvanceList(COMPANY).find(x => x.id === id);
  if (!a || !Array.isArray(a.draws) || !a.draws.length) return toast('没有可撤销的核销记录', 'err');
  const last = a.draws[a.draws.length - 1];
  confirmDialog({
    title: '撤销最近一次核销',
    message: `将撤销 <b>${last.date}</b> 的核销记录（使用 ${fmt(last.used)}${last.back ? '，退回 ' + fmt(last.back) : ''}），<br>并删除该次生成的退回流水。`,
    confirmText: '撤销核销',
    requireCode: true,
    onConfirm: () => {
      if (last.txId) {
        const i = COMPANY.transactions.findIndex(t => t.id === last.txId);
        if (i >= 0) COMPANY.transactions.splice(i, 1);
      }
      a.draws.pop();
      const now = advanceInfo(a);
      a.usedAmount = now.used;
      a.status = now.remain <= 0.005 ? 'closed' : 'issued';
      if (a.status !== 'closed') delete a.closedAt;
      logAction('撤销', { module: '档案', target: '撤销核销 ' + (a.userName || ''), targetId: a.id, after: `剩余 ${fmt(now.remain)}` });
      saveDB(); closeModal(); render();
      toast('已撤销最近一次核销', 'ok');
    }
  });
}

function openInvoiceModal(id) {
  const isEdit = !!id;
  const inv = isEdit ? ensureInvoiceList(COMPANY).find(x => x.id === id) : null;
  openModal(modalShell({
    title: isEdit ? '更新票据状态' : '登记未回票据',
    sub: '付款后发票未到，先记下来',
    cls: 'slim',
    body: `<form id="inv-form" novalidate>
      <div class="modal-bd">
        <div class="form-grid">
          <label class="field span-2"><span class="lbl">往来单位</span>
            <input type="text" name="party" value="${inv ? esc(inv.party || '') : ''}" placeholder="供应商名称" required></label>
          <label class="field"><span class="lbl">金额</span>
            <div class="input-affix"><span class="prefix">${curSymbol()}</span>
              <input type="number" name="amount" min="0.01" step="0.01" value="${inv ? inv.amount : ''}" required></div></label>
          <label class="field"><span class="lbl">付款日期</span>
            <input type="date" name="payDate" value="${inv ? inv.payDate : todayISO()}"></label>
          <label class="field"><span class="lbl">预计回票日</span>
            <input type="date" name="expectDate" value="${inv ? inv.expectDate || '' : ''}"></label>
          <label class="field"><span class="lbl">状态</span>
            <select name="status">${Object.entries(INVOICE_STATUS).map(([k, v]) =>
              `<option value="${k}" ${inv && inv.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
          <label class="field"><span class="lbl">实际回票日</span>
            <input type="date" name="actualDate" value="${inv ? inv.actualDate || '' : ''}"></label>
          <label class="field span-2"><span class="lbl">备注</span>
            <input type="text" name="note" value="${inv ? esc(inv.note || '') : ''}" placeholder="发票号、说明"></label>
        </div>
      </div>
      <div class="modal-ft"><div class="spacer"></div>
        <button type="button" class="btn secondary" data-action="close-modal">取消</button>
        <button type="submit" class="btn primary">${isEdit ? '保存' : '登记'}</button>
      </div>
    </form>`
  }));

  const form = $('#inv-form');
  form.addEventListener('submit', e => {
    e.preventDefault();
    const fd = new FormData(form);
    const party = String(fd.get('party') || '').trim();
    const amount = round2(num(fd.get('amount')));
    const okI = showFormErrors(form, validateForm(form, [
      { name: 'party', label: '往来单位', checks: [{ t: 'required' }, { t: 'len', max: 60 }] },
      { name: 'amount', label: '金额', checks: [{ t: 'required' }, { t: 'number', min: 0.01, max: 100000000000, decimals: 2 }] },
      { name: 'payDate', label: '付款日期', checks: [{ t: 'date' }] },
      { name: 'expectDate', label: '预计回票日', checks: [{ t: 'date' }] }
    ]));
    if (!okI) return;
    const data = {
      party, amount,
      payDate: fd.get('payDate') || todayISO(),
      expectDate: fd.get('expectDate') || '',
      status: fd.get('status') || 'none',
      actualDate: fd.get('actualDate') || '',
      note: String(fd.get('note') || '').trim()
    };
    if (isEdit) { Object.assign(inv, data); logAction('修改', { module: '档案', target: '票据 ' + party, targetId: inv.id }); }
    else {
      const ni = Object.assign({ id: uid('inv') }, data);
      ensureInvoiceList(COMPANY).push(ni);
      logAction('新增', { module: '档案', target: '票据 ' + party, targetId: ni.id });
    }
    saveDB(); closeModal(); render();
    toast(isEdit ? '已更新' : '已登记', 'ok');
  });
}


/* ------------------------------ 项目 ------------------------------ */
function openProjectModal(id) {
  const isEdit = !!id;
  const p = isEdit ? projectById(id) : null;
  openModal(modalShell({
    title: isEdit ? '编辑项目' : '新建项目',
    sub: '项目用于按用途归集资金，记账时可选择归属项目',
    cls: 'slim',
    body: `<form id="proj-form" novalidate>
      <div class="modal-bd">
        <div class="form-grid">
          <label class="field span-2"><span class="lbl">项目名称</span>
            <input type="text" name="name" value="${p ? esc(p.name) : ''}" placeholder="如：阿克拉办公楼装修" required></label>
          <label class="field"><span class="lbl">项目编号</span>
            <input type="text" name="code" value="${p ? esc(p.code || '') : ''}" placeholder="可选"></label>
          <label class="field"><span class="lbl">状态</span>
            <select name="status">${Object.entries(PROJECT_STATUS).map(([k, v]) =>
              `<option value="${k}" ${p && (p.status || 'active') === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
          <label class="field"><span class="lbl">预算</span>
            <div class="input-affix"><span class="prefix">${curSymbol()}</span>
              <input type="number" name="budget" min="0" step="0.01" value="${p ? p.budget || '' : ''}" placeholder="可选"></div></label>
          <label class="field"><span class="lbl">开始日期</span>
            <input type="date" name="startDate" value="${p ? p.startDate || '' : todayISO()}"></label>
          <label class="field span-2"><span class="lbl">备注</span>
            <input type="text" name="note" value="${p ? esc(p.note || '') : ''}"></label>
        </div>
      </div>
      <div class="modal-ft"><div class="spacer"></div>
        <button type="button" class="btn secondary" data-action="close-modal">取消</button>
        <button type="submit" class="btn primary">${isEdit ? '保存' : '创建'}</button>
      </div>
    </form>`
  }));

  const form = $('#proj-form');
  form.addEventListener('submit', e => {
    e.preventDefault();
    const fd = new FormData(form);
    const name = String(fd.get('name') || '').trim();
    const okJ = showFormErrors(form, validateForm(form, [
      { name: 'name', label: '项目名称', checks: [
        { t: 'required' }, { t: 'len', min: 2, max: 60 },
        { t: 'unique', unique: v => ensureProjectList(COMPANY).some(x => x.name === v && (!p || x.id !== p.id)), msg: '已存在同名项目' }
      ] },
      { name: 'budget', label: '预算', checks: [{ t: 'number', min: 0, max: 100000000000, decimals: 2 }] },
      { name: 'code', label: '项目编号', checks: [{ t: 'len', max: 30 }] }
    ]));
    if (!okJ) return;
    const data = {
      name,
      code: String(fd.get('code') || '').trim(),
      status: fd.get('status') || 'active',
      budget: round2(num(fd.get('budget'))),
      startDate: fd.get('startDate') || '',
      note: String(fd.get('note') || '').trim()
    };
    if (isEdit) { Object.assign(p, data); logAction('修改', { module: '档案', target: '项目 ' + name, targetId: p.id }); }
    else {
      const np = Object.assign({ id: uid('pj') }, data);
      ensureProjectList(COMPANY).push(np);
      logAction('新增', { module: '档案', target: '项目 ' + name, targetId: np.id });
    }
    saveDB(); closeModal(); render();
    toast(isEdit ? '已保存' : '已创建', 'ok');
  });
}

/* ============================================================================
   v4.6 预算自动生成弹窗
   ========================================================================== */

function openBudgetGenModal(month) {
  const targetMonth = month || monthOf(todayISO());
  const rule = budgetRule();
  let plan = suggestBudget(targetMonth, rule);

  const paramRow = `
    <div class="form-grid" style="margin-bottom:14px">
      <label class="field"><span class="lbl">目标月份</span>
        <select id="bg-month">${(() => {
          const base = monthOf(todayISO());
          const list = [];
          let m = base;
          for (let i = 0; i < 6; i++) { list.push(m); m = monthOf(addDays(m + '-01', 31)); }
          return list.map(x => `<option value="${x}" ${x === targetMonth ? 'selected' : ''}>${monthLabel(x)}</option>`).join('');
        })()}</select></label>
      <label class="field"><span class="lbl">参考周期</span>
        <select id="bg-lookback">${[3, 6, 12].map(n =>
          `<option value="${n}" ${rule.lookback === n ? 'selected' : ''}>近 ${n} 个月</option>`).join('')}</select></label>
      <label class="field"><span class="lbl">算法</span>
        <select id="bg-method">${Object.entries(BUDGET_METHODS).map(([k, v]) =>
          `<option value="${k}" ${rule.method === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label class="field"><span class="lbl">调整幅度 %</span>
        <input type="number" id="bg-growth" step="1" value="${rule.growth}"></label>
      <label class="field"><span class="lbl">取整到</span>
        <select id="bg-round">${[1, 10, 100, 1000].map(n =>
          `<option value="${n}" ${rule.roundTo === n ? 'selected' : ''}>${n === 1 ? '不取整' : n}</option>`).join('')}</select></label>
      <label class="field"><span class="lbl">最低预算</span>
        <input type="number" id="bg-min" min="0" step="1" value="${rule.minAmount}"></label>
    </div>`;

  const previewHTML = p => {
    if (!p.items.length) {
      return `<div class="empty" style="padding:36px">
        <div class="empty-title">没有可参考的支出</div>
        <div class="empty-desc">最近 ${p.rule.lookback} 个月这些分类都没有支出记录，换个周期试试，或先手工设置</div>
      </div>`;
    }
    const rows = p.items.map((it, i) => `<tr>
      <td><div class="b-cat"><span class="cat-ico" style="--c:${it.color || '#64748b'}">${icon(it.icon || 'tag', 13)}</span>
        <span>${esc(it.name)}</span></div></td>
      <td class="tr" style="font-size:11.5px;color:var(--muted-2)">${it.series.map(s => fmtShort(s.spent)).join(' / ')}</td>
      <td class="tr">${fmt(it.historyAvg)}</td>
      <td class="tr" style="color:var(--muted)">${fmt(it.suggested)}</td>
      <td style="width:150px">
        <div class="input-affix"><span class="prefix">${curSymbol()}</span>
          <input type="number" class="bg-amount" data-i="${i}" min="0" step="0.01" value="${it.amount}"></div>
      </td>
    </tr>`).join('');

    return `<div class="table-wrap" style="max-height:340px">
      <table class="tbl">
        <thead><tr><th>分类</th><th class="tr" style="width:200px">近 ${p.rule.lookback} 月</th>
          <th class="tr" style="width:110px">月均</th><th class="tr" style="width:110px">建议</th>
          <th style="width:150px">最终预算</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`;
  };

  openModal(modalShell({
    title: '自动生成预算',
    sub: '根据最近资金使用情况推算，生成后仍可逐项调整',
    cls: 'wide',
    body: `<div class="modal-bd">
      ${paramRow}
      <div id="bg-preview">${previewHTML(plan)}</div>
      <div class="bg-total" id="bg-total">合计 ${fmt(plan.total)} · ${plan.items.length} 个分类</div>
    </div>
    <div class="modal-ft">
      <span class="hint">确认后会写入「${monthLabel(targetMonth)}」，并保留一条版本记录</span>
      <div class="spacer"></div>
      <button type="button" class="btn secondary" data-action="close-modal">取消</button>
      <button type="button" class="btn primary" id="bg-apply">写入预算</button>
    </div>`
  }), { noFocus: true });

  const regen = () => {
    const opts = {
      lookback: num($('#bg-lookback').value) || 3,
      method: $('#bg-method').value,
      growth: num($('#bg-growth').value) || 0,
      roundTo: num($('#bg-round').value) || 1,
      minAmount: num($('#bg-min').value) || 0
    };
    plan = suggestBudget($('#bg-month').value, opts);
    $('#bg-preview').innerHTML = previewHTML(plan);
    updateTotal();
    bindAmounts();
  };

  const updateTotal = () => {
    const inputs = document.querySelectorAll('.bg-amount');
    let total = 0;
    inputs.forEach(inp => { total += num(inp.value); });
    plan.total = round2(total);
    const el = $('#bg-total');
    if (el) el.textContent = `合计 ${fmt(total)} · ${inputs.length} 个分类`;
  };

  const bindAmounts = () => {
    document.querySelectorAll('.bg-amount').forEach(inp => {
      inp.addEventListener('input', () => {
        const i = num(inp.dataset.i);
        if (plan.items[i]) plan.items[i].amount = round2(num(inp.value));
        updateTotal();
      });
    });
  };

  ['#bg-lookback', '#bg-method', '#bg-growth', '#bg-round', '#bg-min', '#bg-month'].forEach(sel => {
    const el = $(sel);
    if (el) el.addEventListener('change', regen);
  });
  bindAmounts();
  updateTotal();

  $('#bg-apply').addEventListener('click', () => {
    const n = applyBudgetPlan(plan, SESSION.id);
    if (!n) return toast('没有可写入的预算', 'err');
    DB.meta.budgetRule = {
      lookback: plan.rule.lookback, method: plan.rule.method,
      growth: plan.rule.growth, roundTo: plan.rule.roundTo, minAmount: plan.rule.minAmount
    };
    logAction('新增', { module: '预算', target: monthLabel(plan.month) + ' 自动生成', after: n + ' 个分类，合计 ' + fmt(plan.total) });
    UI.budgetMonth = plan.month;
    saveDB(); closeModal(); render();
    toast(`已生成 ${n} 个分类的预算，合计 ${fmt(plan.total)}`, 'ok');
  });
}

/* ============================================================================
   需求23：账套包（.flpack）导入导出
   ========================================================================== */

/* 导出账套 */
async function exportPack() {
  if (!DESKTOP || !window.desktop.flpack) return toast('仅桌面版支持账套包', 'err');
  const includeLogs = await askPackOptions();
  if (includeLogs === null) return;
  toast('正在打包…', '');
  const name = '账套_' + (DB.meta.groupName || COMPANY.name || 'FundMerge').replace(/[\\/:*?"<>|]/g, '') + '_' +
    new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.flpack';
  const r = await window.desktop.flpack.export({
    includeLogs: includeLogs.logs,
    includeCloud: includeLogs.cloud,
    password: includeLogs.password,
    version: APP_VERSION,
    fileName: name
  });
  if (r.canceled) return;
  if (!r.ok) return toast('导出失败：' + r.error, 'err');
  logAction('导出', { module: '数据', target: '账套包', after: (r.size / 1024 / 1024).toFixed(1) + ' MB' });
  saveDB();
  toast('账套已导出：' + (r.size / 1024 / 1024).toFixed(1) + ' MB', 'ok');
}

/* 导出选项弹窗 */
function askPackOptions() {
  return new Promise(resolve => {
    openModal(modalShell({
      title: '导出账套',
      sub: '生成单一 .flpack 文件，含全部公司、流水、附件、用户与配置',
      cls: 'slim',
      body: `<div class="modal-bd">
        <div class="form-grid">
          <div class="field span-2">
            <span class="lbl">包含内容</span>
            <div style="display:flex;gap:18px;margin-top:6px;flex-wrap:wrap">
              <label class="switch"><input type="checkbox" id="pk-logs"><span class="track"></span><span>操作日志</span></label>
              <label class="switch"><input type="checkbox" id="pk-cloud"><span class="track"></span><span>云盘凭据（含密码，谨慎）</span></label>
            </div>
          </div>
          <label class="field span-2"><span class="lbl">加密密码（留空则不加密）</span>
            <input type="password" id="pk-pass" placeholder="设置后导入时需要输入" autocomplete="new-password"></label>
        </div>
        <div class="note" style="margin-top:12px;font-size:12px">
          账套包内含用户密码哈希（不可逆）与全部附件。<b>不包含</b>云盘密码（除非勾选）。
        </div>
      </div>
      <div class="modal-ft"><div class="spacer"></div>
        <button type="button" class="btn secondary" data-action="close-modal">取消</button>
        <button type="button" class="btn primary" id="pk-go">开始导出</button>
      </div>`
    }), { noFocus: true });
    $('#pk-go').addEventListener('click', () => {
      const v = {
        logs: $('#pk-logs').checked,
        cloud: $('#pk-cloud').checked,
        password: $('#pk-password') ? $('#pk-password').value : ($('#pk-pass').value || '')
      };
      closeModal();
      resolve(v);
    });
    const cancel = document.querySelector('[data-action="close-modal"]');
    if (cancel) cancel.addEventListener('click', () => resolve(null), { once: true });
  });
}

/* 导入账套 */
async function importPack() {
  if (!DESKTOP || !window.desktop.flpack) return toast('仅桌面版支持账套包', 'err');
  let r = await window.desktop.flpack.inspect({});
  if (r.canceled) return;
  if (!r.ok && !r.needPassword) return toast('无法读取：' + r.error, 'err');

  if (r.needPassword) {
    const pw = await askPackPassword();
    if (!pw) return;
    r = await window.desktop.flpack.inspect({ path: r.path, password: pw });
    if (!r.ok) return toast(r.error || '密码错误', 'err');
  }

  const mf = r.manifest;
  const st = mf.stats || {};
  openModal(modalShell({
    title: '导入账套',
    sub: '请核对账套摘要后再继续',
    cls: 'slim',
    body: `<div class="modal-bd">
      <dl class="kv">
        <dt>账套名称</dt><dd>${esc(mf.packName || '—')}</dd>
        <dt>集团名称</dt><dd>${esc((mf.companyList || []).map(c => c.name).join('、') || '—')}</dd>
        <dt>公司数量</dt><dd>${st.companies || 0}</dd>
        <dt>流水笔数</dt><dd>${st.transactions || 0}</dd>
        <dt>附件数量</dt><dd>${st.files || 0}（${((st.fileBytes || 0) / 1024 / 1024).toFixed(1)} MB）</dd>
        <dt>用户数量</dt><dd>${st.users || 0}</dd>
        <dt>导出时间</dt><dd>${fmtDateTime(mf.exportedAt)}</dd>
        <dt>软件版本</dt><dd>${esc(mf.appVersion || '—')}</dd>
        <dt>完整性</dt><dd>${r.checksumOk ? '<span class="pill ok">校验通过</span>' : '<span class="pill danger">校验失败</span>'}</dd>
      </dl>
      ${mf.partial ? '<div class="warn" style="margin-top:10px">这是<b>按公司导出</b>的部分账套，不是完整账套。</div>' : ''}
      <div class="warn" style="margin-top:10px">
        <b>覆盖导入会替换当前全部数据</b>（公司、流水、附件、用户）。导入前会自动做一次回滚备份，失败可恢复。
      </div>
    </div>
    <div class="modal-ft"><div class="spacer"></div>
      <button type="button" class="btn secondary" data-action="close-modal">取消</button>
      <button type="button" class="btn danger" id="pk-import">覆盖导入</button>
    </div>`
  }), { noFocus: true });

  $('#pk-import').addEventListener('click', () => {
    closeModal();
    confirmDialog({
      title: '确认覆盖导入',
      message: '当前账套将被<b>完全替换</b>。请输入下方数字确认。',
      confirmText: '确认导入',
      requireCode: true,
      onConfirm: async () => {
        closeModal();
        toast('正在导入…', '');
        const res = await window.desktop.flpack.import({ path: r.path, password: r.__pw || '' });
        if (!res.ok) return toast('导入失败：' + res.error, 'err');
        logAction('导入', { module: '数据', target: '账套包', after: res.companies + ' 家公司 / ' + res.files + ' 个附件' });
        saveDB();
        toast('导入成功，正在重新加载…', 'ok');
        setTimeout(() => location.reload(), 900);
      }
    });
  });
}

function askPackPassword() {
  return new Promise(resolve => {
    openModal(modalShell({
      title: '账套包已加密',
      sub: '请输入导出时设置的密码',
      cls: 'slim',
      body: `<div class="modal-bd">
        <label class="field"><span class="lbl">密码</span>
          <input type="password" id="pk-unlock" placeholder="输入密码" autofocus></label>
      </div>
      <div class="modal-ft"><div class="spacer"></div>
        <button type="button" class="btn secondary" data-action="close-modal">取消</button>
        <button type="button" class="btn primary" id="pk-unlock-go">解锁</button>
      </div>`
    }), { noFocus: true });
    $('#pk-unlock-go').addEventListener('click', () => {
      const v = $('#pk-unlock').value;
      closeModal();
      resolve(v);
    });
  });
}

/* ------------------------------ 清空全部数据 ------------------------------ */

/* 高危操作：管理员密码 + 随机数字双重确认，范围可选「仅当前公司」或「全部公司」 */
function openClearAllModal() {
  if (!isAdmin()) return toast('只有管理员可以清空数据', 'err');
  const cos = DB.companies;
  const cur = COMPANY;

  openModal(modalShell({
    title: '清空数据',
    sub: '此操作不可恢复，请先导出账套包备份',
    cls: 'slim',
    body: `<form id="clear-form">
      <div class="modal-bd">
        <div class="alert danger" style="margin-bottom:14px">
          ${icon('alert', 15)}
          <div>将删除账户、流水、往来款、借支、票据、项目与预算。<b>用户账号、公司档案与附件不会删除。</b></div>
        </div>
        <div class="form-grid">
          <div class="field span-2">
            <span class="lbl">清空范围</span>
            <div style="display:flex;flex-direction:column;gap:8px;margin-top:6px">
              <label class="switch"><input type="radio" name="scope" value="current" checked><span class="track"></span><span>仅当前公司：${esc(cur.name)}</span></label>
              <label class="switch"><input type="radio" name="scope" value="all"><span class="track"></span><span>全部 ${cos.length} 家公司（危险）</span></label>
            </div>
          </div>
          <label class="field span-2"><span class="lbl">管理员密码</span>
            <input type="password" name="pwd" autocomplete="off" placeholder="输入当前登录账号的密码" required></label>
        </div>
        <div class="hint" style="margin-top:10px">提交后还需输入一次随机数字，防止误触。</div>
      </div>
      <div class="modal-ft">
        <div class="spacer"></div>
        <button type="button" class="btn secondary" data-action="close-modal">取消</button>
        <button type="submit" class="btn danger">下一步</button>
      </div>
    </form>`
  }));

  $('#clear-form').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const scope = fd.get('scope') === 'all' ? 'all' : 'current';
    const pwd = String(fd.get('pwd') || '');

    const okPwd = await verifyCurrentPassword(pwd);
    if (!okPwd) return toast('密码不正确，未执行任何操作', 'err');

    const targets = scope === 'all' ? DB.companies : [COMPANY];
    const label = scope === 'all' ? `全部 ${targets.length} 家公司` : `「${COMPANY.name}」`;

    closeModal();
    confirmDialog({
      title: '确认清空 ' + label,
      message: `将删除 ${label} 的账户、流水、往来款、借支、票据、项目与预算。<br><br><b>此操作不可恢复。</b>`,
      confirmText: '确认清空',
      requireCode: true,
      onConfirm: () => {
        let txCount = 0;
        targets.forEach(co => {
          txCount += co.transactions.length;
          co.accounts = [];
          co.transactions = [];
          co.debts = [];
          co.settlements = [];
          co.budgets = [];
          co.parties = [];
          co.advances = [];
          co.invoices = [];
          co.projects = [];
          co.budgetVersions = [];
        });
        logAction('清空', {
          module: '数据',
          target: '清空 ' + label,
          after: `删除 ${txCount} 笔流水 / ${targets.length} 家公司`
        });
        saveDB(); closeModal(); render();
        toast('数据已清空', 'ok');
      }
    });
  });
}

/* ------------------------------ 票据快捷回票 ------------------------------ */

/* REQ-17：不再要求打开编辑弹窗，直接「已回 / 部分已回」，改动走随机数字确认 */
function openInvoiceReceiveModal(id) {
  const inv = ensureInvoiceList(COMPANY).find(x => x.id === id);
  if (!inv) return;
  const total = round2(num(inv.amount));
  const got = round2(num(inv.receivedAmount));
  const left = round2(total - got);

  openModal(modalShell({
    title: '登记回票',
    sub: `${esc(inv.party || '')} · 票面 ${fmt(total)}`,
    cls: 'slim',
    body: `<form id="inv-recv-form">
      <div class="modal-bd">
        <div class="summary-strip" style="padding:0 0 14px;gap:22px">
          <div class="item"><span>票面金额</span><strong>${fmt(total)}</strong></div>
          <div class="item"><span>已回</span><strong>${fmt(got)}</strong></div>
          <div class="item"><span>未回</span><strong style="color:var(--out)">${fmt(left)}</strong></div>
        </div>
        <div class="form-grid">
          <div class="field span-2">
            <span class="lbl">回票方式</span>
            <div class="seg" style="width:auto;margin-top:6px">
              <button type="button" class="seg-btn is-active" data-recv="all">全部已回</button>
              <button type="button" class="seg-btn" data-recv="part">部分已回</button>
            </div>
          </div>
          <label class="field span-2" id="recv-amt-field" style="display:none"><span class="lbl">本次回票金额</span>
            <div class="input-affix"><span class="prefix">${curSymbol()}</span>
              <input type="number" name="amount" min="0.01" step="0.01" value="${left}">
            </div>
          </label>
          <label class="field span-2"><span class="lbl">回票日期</span><input type="date" name="date" value="${todayISO()}"></label>
        </div>
        <div class="alert info" style="margin-top:12px">${icon('info', 15)}
          <div>确认后会把状态更新为「已回 / 部分回」，并记录本次回票金额。</div></div>
      </div>
      <div class="modal-ft">
        <div class="spacer"></div>
        <button type="button" class="btn secondary" data-action="close-modal">取消</button>
        <button type="submit" class="btn primary">确认回票</button>
      </div>
    </form>`
  }));

  let mode = 'all';
  $$('[data-recv]').forEach(b => b.addEventListener('click', () => {
    mode = b.dataset.recv;
    $$('[data-recv]').forEach(x => x.classList.toggle('is-active', x === b));
    const f = $('#recv-amt-field');
    if (f) f.style.display = mode === 'part' ? '' : 'none';
  }));

  $('#inv-recv-form').addEventListener('submit', e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const date = fd.get('date') || todayISO();
    const add = mode === 'all' ? left : round2(num(fd.get('amount')));
    if (!(add > 0)) return toast('金额必须大于 0', 'err');
    if (add > left + 0.001) return toast('本次回票金额不能超过未回金额', 'err');

    const nextGot = round2(got + add);
    const nextStatus = nextGot >= total - 0.005 ? 'done' : 'partial';

    guardChange({
      title: '确认登记回票？',
      message: `本次回票 <b>${fmt(add)}</b>，累计 <b>${fmt(nextGot)}</b> / ${fmt(total)}，<br>状态将变为 <b>${INVOICE_STATUS[nextStatus]}</b>。`,
      confirmText: '确认回票',
      level: 'code',
      onConfirm: () => {
        inv.receivedAmount = nextGot;
        inv.status = nextStatus;
        inv.actualDate = date;
        logAction('修改', {
          module: '票据',
          target: `${inv.party || ''} 回票 ${fmt(add)}`,
          targetId: inv.id,
          before: `已回 ${fmt(got)} / ${INVOICE_STATUS[inv.status] || '未回'}`,
          after: `已回 ${fmt(nextGot)} / ${INVOICE_STATUS[nextStatus]}`
        });
        saveDB(); closeModal(); render();
        toast(`已登记回票 ${fmt(add)}`, 'ok');
      }
    });
  });
}

/* 资金对账单导出（REQ-20） */
async function exportFundStatement() {
  const cash = round2(DB.accounts.filter(a => a.type === 'cash').reduce((s, a) => s + balanceOf(a), 0));
  const bank = round2(totalBalance() - cash);
  const invs = ensureInvoiceList(COMPANY).filter(i => i.status !== 'done');
  const invAmt = round2(invs.reduce((s, i) => s + Math.max(0, num(i.amount) - num(i.receivedAmount)), 0));
  const borrow = round2(debtTotals('borrow').remaining + debtTotals('reimburse').remaining);
  const advs = ensureAdvanceList(COMPANY).filter(a => advanceInfo(a).status === 'issued');
  const advAmt = round2(advs.reduce((s, a) => s + advanceInfo(a).remain, 0));
  const total = round2(cash + bank + invAmt + borrow + advAmt);

  const rows = [
    ['库存现金', cash.toFixed(2)],
    ['银行存款', bank.toFixed(2)],
    ['票据未回', invAmt.toFixed(2)],
    ['借款（借入未还 + 员工未报销）', borrow.toFixed(2)],
    ['借支备用金（未核销）', advAmt.toFixed(2)],
    ['总账面金额', total.toFixed(2)]
  ];
  const ok = await saveTextFile(`资金对账单_${COMPANY.name}_${todayISO()}.csv`, toCSV(['构成项', '金额'], rows), 'text/csv;charset=utf-8');
  if (ok) toast('资金对账单已导出', 'ok');
}

/* ------------------------------ 操作日志：备注 / 删除 ------------------------------ */

/* 原始记录不可编辑，只能加备注；备注本身也留痕（REQ-21） */
function openLogNoteModal(id) {
  const log = (DB.auditLogs || []).find(l => l.id === id);
  if (!log) return;
  openModal(modalShell({
    title: '给这条日志加备注',
    sub: `${fmtDateTime(log.at)} · ${log.userName} · ${log.action} ${log.target}`,
    cls: 'slim',
    body: `<form id="log-note-form">
      <div class="modal-bd">
        <div class="alert info" style="margin-bottom:12px">${icon('info', 15)}
          <div>原始记录（时间、用户、对象、变更前后）不可修改，备注只做补充说明。</div></div>
        <label class="field"><span class="lbl">备注</span>
          <textarea name="note" rows="3" placeholder="例如：该笔已与银行流水核对一致">${esc(log.note || '')}</textarea></label>
      </div>
      <div class="modal-ft"><div class="spacer"></div>
        <button type="button" class="btn secondary" data-action="close-modal">取消</button>
        <button type="submit" class="btn primary">保存备注</button>
      </div>
    </form>`
  }));

  $('#log-note-form').addEventListener('submit', e => {
    e.preventDefault();
    const note = String(new FormData(e.target).get('note') || '').trim();
    guardChange({
      title: '确认保存备注？',
      message: `备注将写入这条日志，并记录操作人与时间。`,
      confirmText: '保存备注',
      level: 'plain',
      onConfirm: () => {
        log.note = note;
        log.noteBy = SESSION.displayName;
        log.noteAt = new Date().toISOString();
        saveDB(); closeModal(); render();
        toast('备注已保存', 'ok');
      }
    });
  });
}

/* 逻辑删除：保留原始记录，只打标记，便于审计追溯 */
function deleteLog(id) {
  const log = (DB.auditLogs || []).find(l => l.id === id);
  if (!log) return;
  confirmDialog({
    title: '删除这条日志',
    message: `将把 <b>${fmtDateTime(log.at)} · ${log.userName} · ${log.action}</b> 标记为已删除。<br>记录本身会保留，勾选「显示已删除」仍可查看。`,
    confirmText: '确认删除',
    requireCode: true,
    onConfirm: () => {
      log.deleted = true;
      log.deletedBy = SESSION.displayName;
      log.deletedAt = new Date().toISOString();
      logAction('删除', { module: '日志', target: `日志 ${log.id}`, targetId: log.id, after: '逻辑删除' });
      saveDB(); closeModal(); render();
      toast('日志已标记删除', 'ok');
    }
  });
}

/* ------------------------------ 汇率录入 ------------------------------ */

/* 1 外币 = ? 本位币；只追加不覆盖，历史留痕（REQ-22） */
function openFxModal(cur) {
  if (!CURRENCIES[cur]) return;
  const base = baseCurrency();
  const last = baseRate(cur);

  openModal(modalShell({
    title: `录入 ${CURRENCIES[cur].name} 汇率`,
    sub: `1 ${cur} = ? ${base}`,
    cls: 'slim',
    body: `<form id="fx-form">
      <div class="modal-bd">
        <div class="form-grid">
          <label class="field"><span class="lbl">汇率（1 ${cur} 折合 ${base}）</span>
            <input type="number" name="rate" step="0.0001" min="0.0001" value="${last == null ? '' : last}" placeholder="例如 15.2000" required></label>
          <label class="field"><span class="lbl">生效日期</span>
            <input type="date" name="date" value="${todayISO()}"></label>
          <label class="field span-2"><span class="lbl">备注</span>
            <input type="text" name="note" placeholder="可选，例如：10月结账汇率"></label>
        </div>
        <div class="alert info" style="margin-top:12px">${icon('info', 15)}
          <div>历史报表按各自日期的汇率折算，改汇率不会改写已经发生的历史口径。</div></div>
      </div>
      <div class="modal-ft"><div class="spacer"></div>
        <button type="button" class="btn secondary" data-action="close-modal">取消</button>
        <button type="submit" class="btn primary">保存汇率</button>
      </div>
    </form>`
  }));

  $('#fx-form').addEventListener('submit', e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const rate = num(fd.get('rate'));
    if (!(rate > 0)) return toast('汇率必须大于 0', 'err');
    const date = fd.get('date') || todayISO();
    guardChange({
      title: '确认保存汇率？',
      message: `1 ${cur} = <b>${rate}</b> ${base}，生效日期 ${date}。`,
      confirmText: '保存',
      level: 'plain',
      onConfirm: () => {
        DB.meta.fx = DB.meta.fx || { base: baseCurrency(), rates: {} };
        DB.meta.fx.rates = DB.meta.fx.rates || {};
        const arr = Array.isArray(DB.meta.fx.rates[cur]) ? DB.meta.fx.rates[cur] : [];
        arr.push({ date, rate, by: SESSION.id, byName: SESSION.displayName, at: new Date().toISOString(), note: String(fd.get('note') || '') });
        arr.sort((a, b) => String(a.date).localeCompare(String(b.date)));
        DB.meta.fx.rates[cur] = arr;
        logAction('新增', { module: '设置', target: `汇率 ${cur}→${base}`, after: `${rate}（${date}）` });
        saveDB(); closeModal(); render();
        toast('汇率已保存', 'ok');
      }
    });
  });
}

/* ------------------------------ 账号卡片（同类项合并） ------------------------------ */

/* REQ-18：把「户名 / 账号 / 开户行 / 网银地址 / 网银用户名 / 网银密码」合并成一次录入，
   保存为共享 bundle 的多条字段，档案页按分组聚合展示。 */
function openVaultBundleModal() {
  const p = COMPANY.profile;
  const F = [
    ['holder', '账户户名', 'text'],
    ['accountNo', '银行账号', 'text'],
    ['bankName', '开户行', 'text'],
    ['davUrl', '网银登录地址', 'url'],
    ['davUser', '网银用户名', 'text'],
    ['davPass', '网银密码', 'password']
  ];

  openModal(modalShell({
    title: '添加账号卡片',
    sub: '一次填完一个账号的全部信息，保存后归为一组',
    body: `<form id="vault-bundle-form">
      <div class="modal-bd">
        <div class="form-grid">
          <label class="field span-2"><span class="lbl">卡片名称（用于识别）</span>
            <input type="text" name="title" placeholder="如：Ecobank 对公账户" required></label>
          ${F.map(([k, l, t]) => `<label class="field ${k === 'holder' || k === 'accountNo' || k === 'bankName' || k === 'davUrl' ? 'span-2' : ''}">
            <span class="lbl">${l}${t === 'password' ? '（加密保存）' : ''}</span>
            <input type="${t === 'password' ? 'password' : 'text'}" name="${k}" autocomplete="off" placeholder="可留空"></label>`).join('')}
        </div>
        <div class="alert info" style="margin-top:12px">${icon('info', 15)}
          <div>只保存填写了的项；留空的不会生成空条目。</div></div>
      </div>
      <div class="modal-ft"><div class="spacer"></div>
        <button type="button" class="btn secondary" data-action="close-modal">取消</button>
        <button type="submit" class="btn primary">保存卡片</button>
      </div>
    </form>`
  }));

  $('#vault-bundle-form').addEventListener('submit', e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const title = String(fd.get('title') || '').trim();
    if (!title) return toast('请填写卡片名称', 'err');
    const bundle = uid('vb');
    const created = [];
    F.forEach(([k, l, t]) => {
      const v = String(fd.get(k) || '').trim();
      if (!v) return;
      created.push({ id: uid('f'), group: '银行账户', label: `${title} · ${l}`, value: v, type: t, note: '', bundle, bundleTitle: title, updatedAt: new Date().toISOString() });
    });
    if (!created.length) return toast('至少填写一项', 'err');

    guardChange({
      title: '确认保存账号卡片？',
      message: `将新增 <b>${created.length}</b> 条字段，归入「银行账户」分组。`,
      confirmText: '保存',
      level: 'plain',
      onConfirm: () => {
        p.fields = Array.isArray(p.fields) ? p.fields : [];
        created.forEach(f => p.fields.push(f));
        logAction('新增', { module: '档案', target: '账号卡片 ' + title, after: `${created.length} 条字段` });
        saveDB(); closeModal(); render();
        toast(`已保存 ${created.length} 条`, 'ok');
      }
    });
  });
}
