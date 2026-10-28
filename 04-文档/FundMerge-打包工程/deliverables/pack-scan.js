#!/usr/bin/env node
/**
 * 打包物静态扫描 — FundMerge 发版前必跑
 *
 * 用法:
 *   node deliverables/pack-scan.js [distDir]        # 扫描指定产物目录
 *   node deliverables/pack-scan.js                  # 自动选 dist* 中最新目录
 *   node deliverables/pack-scan.js --self-test      # 门禁自检（验证能正确 FAIL/PASS）
 *   node deliverables/pack-scan.js --quarantine     # 失败时把安装包改名隔离（构建用）
 *
 * 退出码: 0 = PASS, 1 = FAIL
 *
 * ⚠ 退出码陷阱（务必注意）:
 *   写成 `node pack-scan.js dist18 | tail -30` 时，$? 是 tail 的退出码，恒为 0，
 *   CI 里这样写会导致「扫描 FAIL 但构建通过」，门禁静默失效。
 *   正确做法：① 不接管道；② 用 deliverables/pack-gate.sh（已封装，无管道）；
 *   ③ 或 `set -o pipefail` / 取 ${PIPESTATUS[0]}。
 *
 * 设计约束（与 security-officer 约定）:
 *  - 只扫【打包产物】(win-unpacked + asar 解包目录)，不扫源码仓库，避免误报
 *  - 二进制 grep 不可靠 -> 版本断言必须解包 asar 后比对
 *  - 任何豁免必须写进 pack-scan.rules.json 的 B_text.exemptions，禁止脚本内忽略
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const RULES_FILE = path.join(__dirname, 'pack-scan.rules.json');
const rules = JSON.parse(fs.readFileSync(RULES_FILE, 'utf8')).rules;

let results = [];
let textHits = [];             // 结构化文本命中，用于跨副本去重（手册同时存在于 extraFiles 与 asar）
let failedLines = new Set();   // 已判 FAIL 的行，同行 WARN 不再追加，避免噪声淹没真信号

const add = (level, rule, msg) => results.push({ level, rule, msg });
const fail = (rule, msg) => add('FAIL', rule, msg);
const warn = (rule, msg) => add('WARN', rule, msg);
const pass = (rule, msg) => add('PASS', rule, msg);

let DIST = null;
let UNPACKED = null;

function setTarget(dir) {
  DIST = dir;
  UNPACKED = path.join(dir, 'win-unpacked');
}

function resetState() {
  results = [];
  textHits = [];
  failedLines = new Set();
}

/* ---------------------------- 定位产物目录 ---------------------------- */

function pickDist() {
  const cands = fs.readdirSync(ROOT)
    .filter(d => /^dist\d*$/.test(d) && fs.existsSync(path.join(ROOT, d, 'win-unpacked')))
    .map(d => ({ d, m: fs.statSync(path.join(ROOT, d, 'win-unpacked')).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  if (!cands.length) throw new Error('未找到含 win-unpacked 的 dist 目录');
  return path.join(ROOT, cands[0].d);
}

/* --------------------------- A. 产物结构断言 --------------------------- */

function checkStructure() {
  const cfg = rules.A_structure;
  const top = fs.readdirSync(UNPACKED);
  const already = new Set();

  for (const name of top) {
    if (cfg.denyNames.some(d => d.toLowerCase() === name.toLowerCase())) {
      fail('A', `禁止条目出现在产物根目录: ${name}`);
      already.add(name);
      continue;
    }
    for (const g of cfg.denyGlobs) {
      const re = new RegExp('^' + g.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$', 'i');
      if (re.test(name)) { fail('A', `禁止条目（glob ${g}）: ${name}`); already.add(name); break; }
    }
  }

  const allowRes = cfg.allowTopLevel.map(r => new RegExp(r, 'i'));
  const unlisted = top.filter(n => !already.has(n) && !allowRes.some(re => re.test(n)));
  for (const n of unlisted) fail('A', `顶层条目不在白名单: ${n}`);

  const exes = top.filter(n => /\.exe$/i.test(n));
  if (exes.length > 1) warn('A', `产物根目录有 ${exes.length} 个 exe，请确认哪个是应用主程序: ${exes.join(', ')}`);

  /* 深层禁止项（避免 data/ 藏在子目录） */
  const deep = fs.readdirSync(UNPACKED, { recursive: true })
    .map(p => String(p).split(path.sep).join('/'))
    .filter(p => !p.startsWith('locales/'));
  for (const p of deep) {
    const base = p.split('/').pop();
    if (['data.json', 'data.bak.json', 'data-location.txt'].includes(base)) fail('A', `深层禁止文件: ${p}`);
    if (/^data\.conflict-.*\.json$/.test(base)) fail('A', `冲突副本泄露: ${p}`);
  }

  if (!results.some(r => r.rule === 'A' && r.level === 'FAIL')) {
    pass('A', `结构断言通过（${top.length} 个顶层条目）`);
  }
}

/* ----------------------------- B. 文本扫描 ----------------------------- */

function walkText(dir, out, base) {
  const exts = rules.B_text.scanExtensions;
  const skip = rules.B_text.skipPaths || [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    const rel = path.relative(base, full).split(path.sep).join('/');
    if (skip.some(s => rel.startsWith(s))) continue;
    if (e.isDirectory()) {
      if (e.name === 'node_modules') continue;
      walkText(full, out, base);
    } else if (e.isFile()) {
      if (!exts.includes(path.extname(e.name).toLowerCase())) continue;
      let st;
      try { st = fs.statSync(full); } catch { continue; }
      if (st.size > (rules.B_text.maxFileSizeKB || 4096) * 1024) continue;
      out.push({ full, rel });
    }
  }
  return out;
}

function scanText(files, tag) {
  const pats = rules.B_text.patterns;
  const ex = rules.B_text.exemptions || [];
  for (const f of files) {
    const ext = path.extname(f.rel).toLowerCase();
    let txt;
    try { txt = fs.readFileSync(f.full, 'utf8'); } catch { continue; }
    const lines = txt.split(/\r?\n/);
    for (const p of pats) {
      if (p.exts && !p.exts.includes(ext)) continue;
      const re = new RegExp(p.re);
      for (let i = 0; i < lines.length; i++) {
        if (!re.test(lines[i])) continue;
        const lineKey = `${f.rel}:${i + 1}`;
        /* 同一行已被 fail 规则命中时，不再追加 warn —— 否则一个真问题会被两条告警稀释 */
        if (p.severity !== 'fail' && failedLines.has(lineKey)) continue;
        if (p.severity === 'fail') failedLines.add(lineKey);

        const content = lines[i].trim();
        const key = `${p.id}|${p.severity}|${content}`;
        const prev = textHits.find(h => h.key === key);
        if (prev) { prev.locs.push(`${tag}/${lineKey}`); continue; } /* 跨副本去重 */
        textHits.push({
          key,
          ruleId: p.id,
          severity: p.severity,
          note: p.note || '',
          content,
          locs: [`${tag}/${lineKey}`],
          exempt: ex.find(x => x.file === f.rel && x.ruleId === p.id) || null,
        });
      }
    }
  }
}

/* 豁免是门禁唯一的"合法放行"通道，必须四要素齐全才算有效；
   缺 reason/reviewer/date 的豁免视为无效，仍然判 FAIL —— 否则门禁自己开洞。 */
function isValidExemption(x) {
  if (!x) return false;
  return !!(x.file && x.ruleId && String(x.reason || '').trim()
    && String(x.reviewer || '').trim() && String(x.date || '').trim());
}

/* 扫描结束后统一出报告：一处问题只报一次，多副本合并成一行 */
function flushTextHits(asarScanned) {
  let nFail = 0;
  let nWarn = 0;
  for (const h of textHits) {
    const where = h.locs.join(' + ');
    if (h.exempt) {
      if (!isValidExemption(h.exempt)) {
        const miss = ['reason', 'reviewer', 'date'].filter(k => !String(h.exempt[k] || '').trim());
        fail('B', `豁免无效（缺 ${miss.join('/')}），仍判失败: ${where} (${h.ruleId}) :: ${h.content.slice(0, 120)}`);
        nFail++;
        continue;
      }
      warn('B', `[已豁免] ${where} (${h.ruleId}) reason=${h.exempt.reason} reviewer=${h.exempt.reviewer}`);
      nWarn++;
      continue;
    }
    const body = `${where} (${h.ruleId}) ${h.note} :: ${h.content.slice(0, 120)}`;
    if (h.severity === 'fail') { fail('B', body); nFail++; } else { warn('B', body); nWarn++; }
  }
  if (!nFail) {
    /* asar 没扫到就不能报"通过"—— 否则会给出"已覆盖应用代码"的假象，
       和「测的不是要发的包」是同一类错误。 */
    if (asarScanned) pass('B', `文本扫描通过（unpacked + asar），告警 ${nWarn} 项须在发版记录里逐条签字`);
    else warn('B', `文本扫描未覆盖 asar 内应用代码（asar 缺失或解包失败），本次仅扫 unpacked，告警 ${nWarn} 项`);
  }
}

function checkText() {
  /* A 规则已判死的文件不再重复报 B（避免同一问题被计两次、淹没真正信号） */
  const denied = new Set((rules.A_structure.denyNames || []).map(s => s.toLowerCase()));
  const inPack = walkText(UNPACKED, [], UNPACKED)
    .filter(f => !f.rel.endsWith('resources/app.asar'))
    .filter(f => !denied.has(f.rel.split('/')[0].toLowerCase()));
  scanText(inPack, 'unpacked');

  const asarPath = path.join(UNPACKED, 'resources', 'app.asar');
  if (!fs.existsSync(asarPath)) { warn('B', '未找到 resources/app.asar，跳过 asar 内文本扫描'); return null; }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fmscan-'));
  try {
    require('@electron/asar').extractAll(asarPath, tmp);
  } catch (e) {
    warn('B', `asar 解包失败（可尝试 npm i @electron/asar）: ${e.message}`);
    return null;
  }
  scanText(walkText(tmp, [], tmp), 'asar');
  return tmp;
}

/* --------------------------- C. 版本一致性断言 --------------------------- */

function checkVersion() {
  if (!rules.C_version.enabled) return;
  const asarPath = path.join(UNPACKED, 'resources', 'app.asar');
  if (!fs.existsSync(asarPath)) { fail('C', '产物缺少 resources/app.asar（应用无法启动）'); return; }
  let asarVer = null;
  try {
    asarVer = JSON.parse(require('@electron/asar').extractFile(asarPath, 'package.json')).version;
  } catch (e) {
    fail('C', `无法读取 asar 内 package.json: ${e.message}`);
    return;
  }
  const exe = fs.readdirSync(DIST).find(f => /^FundMerge-Setup-([\d.]+)\.exe$/.test(f));
  if (!exe) { warn('C', '同目录未找到 FundMerge-Setup-<version>.exe，无法比对安装包版本'); return; }
  const exeVer = exe.match(/^FundMerge-Setup-([\d.]+)\.exe$/)[1];
  if (asarVer === exeVer) pass('C', `版本一致: asar=${asarVer} exe=${exeVer}`);
  else fail('C', `版本不一致: asar=${asarVer} 但安装包=${exeVer}（产物目录混版，禁止发布）`);
}

/* -------------------------------- 执行 -------------------------------- */

function runScan(targetDir) {
  resetState();
  setTarget(targetDir);
  checkStructure();
  const asarTmp = checkText();
  flushTextHits(!!asarTmp);
  checkVersion();
  return {
    fails: results.filter(r => r.level === 'FAIL'),
    warns: results.filter(r => r.level === 'WARN'),
  };
}

function report(targetDir, { fails, warns }) {
  console.log(`\n打包物扫描: ${path.relative(ROOT, targetDir) || targetDir}`);
  console.log('='.repeat(72));
  for (const r of results) {
    const icon = r.level === 'FAIL' ? '✗' : r.level === 'WARN' ? '!' : '✓';
    console.log(`${icon} [${r.rule}] ${r.msg}`);
  }
  console.log('='.repeat(72));
  console.log(`结果: ${fails.length ? 'FAIL' : 'PASS'}  |  失败 ${fails.length} 项，告警 ${warns.length} 项`);
}

/* ------------------------------ 失败即隔离 ------------------------------ */

/* 只让退出码非 0 不够：产物已经落在 dist/ 里，谁手快谁就发了。
   --quarantine 时把可发布的 exe 与 blockmap 改名，并留下失败记录，
   使「扫不过」等于「拿不到可发的安装包」。
   注意：只对当前扫描目录生效，回归扫描历史产物时不要带这个参数。 */
function quarantine(targetDir, { fails }) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const moved = [];
  for (const f of fs.readdirSync(targetDir)) {
    if (!/^FundMerge-Setup-[\d.]+\.exe(\.blockmap)?$/.test(f)) continue;
    const to = `${f}.BLOCKED-${ts}`;
    try {
      fs.renameSync(path.join(targetDir, f), path.join(targetDir, to));
      moved.push(to);
    } catch (e) {
      console.log(`! 隔离失败（请手动移出 dist）: ${f} —— ${e.message}`);
    }
  }
  const note = path.join(targetDir, 'SCAN-FAILED.txt');
  const lines = [
    `扫描失败时间: ${new Date().toISOString()}`,
    `失败项: ${fails.length}`,
    '',
    ...fails.map(f => `[${f.rule}] ${f.msg}`),
    '',
    '本目录产物不可发布。修复后重新出包，门禁通过会自动生成新的安装包。',
  ];
  try { fs.writeFileSync(note, lines.join('\n'), 'utf8'); } catch { /* 忽略 */ }
  if (moved.length) {
    console.log('');
    console.log('⛔ 已隔离不可发布产物（修复后重新出包）:');
    for (const m of moved) console.log(`   · ${m}`);
    console.log(`   · ${path.basename(note)}`);
  }
  return moved;
}

/* ------------------------------ 门禁自检 ------------------------------ */

/* 造两个临时产物目录：一个含违规项（必须 FAIL），一个干净（必须 PASS）。
   用于证明「门禁能真的拦住」，也用于防止有人把检查逻辑改坏后仍然显示通过。 */
function selfTest() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-selftest-'));
  const asar = require('@electron/asar');

  /* 造一个最小 asar，用于验证规则 C 的正反两个方向（createPackage 在 v3+ 返回 Promise） */
  const mkAsar = async (ver) => {
    const src = fs.mkdtempSync(path.join(base, 'src-'));
    fs.writeFileSync(path.join(src, 'package.json'), JSON.stringify({ name: 'x', version: ver }), 'utf8');
    const out = path.join(base, `app-${ver}-${Math.random().toString(36).slice(2)}.asar`);
    await asar.createPackage(src, out);
    if (!fs.existsSync(out)) throw new Error('自检失败：无法生成 asar 夹具');
    return out;
  };

  const mk = async (name, files, { asarVer = '9.9.9', exeVer = '9.9.9' } = {}) => {
    const dir = path.join(base, name);
    const unpacked = path.join(dir, 'win-unpacked');
    fs.mkdirSync(path.join(unpacked, 'resources'), { recursive: true });
    for (const [rel, content] of Object.entries(files)) {
      const full = path.join(unpacked, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, 'utf8');
    }
    fs.copyFileSync(await mkAsar(asarVer), path.join(unpacked, 'resources', 'app.asar'));
    fs.writeFileSync(path.join(dir, `FundMerge-Setup-${exeVer}.exe`), '', 'utf8');
    return dir;
  };

  (async () => {
    /* ① 含违规项 → 必须 FAIL */
    const dirty = await mk('dirty', { '合资金账.exe': '', 'data.json': '{"users":[]}', 'debug.log': 'log' });
    /* ② 干净产物 → 必须 PASS */
    const clean = await mk('clean', { '合资金账.exe': '' });
    /* ③ 版本混用（asar 9.9.9 / exe 9.9.8）→ 必须 FAIL，验证规则 C */
    const mismatch = await mk('mismatch', { '合资金账.exe': '' }, { asarVer: '9.9.9', exeVer: '9.9.8' });
    /* ④ 明文凭据 → 必须 FAIL，验证 cred-literal 规则本身没被改松 */
    const cred = await mk('cred', {
      '合资金账.exe': '',
      'resources/payload/core.js': "const X = { password: 'abcdefg' };\n",
    });

    const rDirty = runScan(dirty);
    const rClean = runScan(clean);
    const rMix = runScan(mismatch);
    const rCred = runScan(cred);

    /* ⑤ 合法豁免 → 该条不报（PASS）
       ⑥ 豁免缺 reviewer → 仍须 FAIL（门禁不能自己开洞） */
    const savedEx = rules.B_text.exemptions;
    rules.B_text.exemptions = [{
      file: 'resources/payload/core.js', ruleId: 'cred-literal',
      reason: '自检夹具，非真实凭据', reviewer: 'qa-self-test', date: '2026-10-28',
    }];
    const rExValid = runScan(cred);

    rules.B_text.exemptions = [{
      file: 'resources/payload/core.js', ruleId: 'cred-literal',
      reason: '自检夹具，非真实凭据', date: '2026-10-28',
    }];
    const rExInvalid = runScan(cred);
    rules.B_text.exemptions = savedEx;

    const ok1 = rDirty.fails.length > 0;
    const ok2 = rClean.fails.length === 0;
    const ok3 = rMix.fails.some(f => f.rule === 'C');
    const ok4 = rCred.fails.some(f => /cred-literal/.test(f.msg));
    const ok5 = rExValid.fails.length === 0;
    const ok6 = rExInvalid.fails.some(f => /豁免无效/.test(f.msg));

    console.log('门禁自检');
    console.log('='.repeat(72));
    console.log(`${ok1 ? '✓' : '✗'} ① 含违规项的产物必须 FAIL —— 实际 ${rDirty.fails.length} 项失败`);
    for (const f of rDirty.fails) console.log(`    · [${f.rule}] ${f.msg}`);
    console.log(`${ok2 ? '✓' : '✗'} ② 干净产物必须 PASS —— 实际 ${rClean.fails.length} 项失败`);
    for (const f of rClean.fails) console.log(`    · [${f.rule}] ${f.msg}`);
    console.log(`${ok3 ? '✓' : '✗'} ③ 版本混用必须被 C 规则拦住 —— 实际 ${rMix.fails.length} 项失败`);
    for (const f of rMix.fails) console.log(`    · [${f.rule}] ${f.msg}`);
    console.log(`${ok4 ? '✓' : '✗'} ④ 明文凭据必须被 cred-literal 拦住 —— 实际 ${rCred.fails.length} 项失败`);
    for (const f of rCred.fails) console.log(`    · [${f.rule}] ${f.msg}`);
    console.log(`${ok5 ? '✓' : '✗'} ⑤ 合法豁免（四要素齐全）必须放行 —— 实际 ${rExValid.fails.length} 项失败`);
    for (const f of rExValid.fails) console.log(`    · [${f.rule}] ${f.msg}`);
    console.log(`${ok6 ? '✓' : '✗'} ⑥ 豁免缺 reviewer 必须仍判失败 —— 实际 ${rExInvalid.fails.length} 项失败`);
    for (const f of rExInvalid.fails) console.log(`    · [${f.rule}] ${f.msg}`);
    console.log('='.repeat(72));

    fs.rmSync(base, { recursive: true, force: true });

    const ok = ok1 && ok2 && ok3 && ok4 && ok5 && ok6;
    console.log(`自检结果: ${ok ? 'PASS（门禁可拦住违规产物，且豁免通道受控）' : 'FAIL（门禁失效，禁止用于发布）'}`);
    process.exit(ok ? 0 : 1);
  })().catch(e => {
    console.error('自检异常:', e.message);
    process.exit(1);
  });
}

/* ------------------------------ 扫描凭证 sidecar ------------------------------ */

/* 指纹只绑定"规则"，不绑定"产物" —— 它能证明规则没被改，证明不了这个包是被这套规则扫过的。
   --sidecar 生成 FundMerge-Setup-<ver>.scan.json，把【产物哈希 + 规则指纹 + 结果】绑在一起，
   事后拿到任何一个已发出的包，都能回答"它当时过没过、用哪版规则扫的"。
   注意：失败详情里的原始行内容必须脱敏，否则 sidecar 自己会变成新的口令泄露源。 */
function writeSidecar(targetDir, { fails, warns }) {
  const exe = fs.readdirSync(targetDir).find(f => /^FundMerge-Setup-[\d.]+\.exe$/.test(f));
  if (!exe) { console.log('! 未找到 FundMerge-Setup-<ver>.exe，跳过 sidecar'); return null; }

  let pkgSha = 'unknown';
  try {
    pkgSha = require('crypto').createHash('sha256')
      .update(fs.readFileSync(path.join(targetDir, exe))).digest('hex');
  } catch (e) { console.log(`! 计算产物哈希失败: ${e.message}`); }

  let rulesFingerprint = 'unknown';
  let rulesVersion = '?';
  try {
    rulesFingerprint = fs.readFileSync(path.join(__dirname, 'pack-gate.expected'), 'utf8').trim();
    rulesVersion = String(JSON.parse(fs.readFileSync(RULES_FILE, 'utf8')).version);
  } catch { /* 忽略 */ }

  /* 失败项只保留规则 id 与位置，丢弃 '::' 之后的原始行内容 */
  const redact = m => String(m).split('::')[0].trim();

  const payload = {
    package: exe,
    packageSha256: pkgSha,
    rulesFingerprint,
    rulesVersion,
    result: fails.length ? `FAIL-${fails.length}` : 'PASS',
    warnCount: warns.length,
    failures: fails.map(f => ({ rule: f.rule, detail: redact(f.msg) })),
    scannedAt: new Date().toISOString(),
    scanner: 'deliverables/pack-scan.js',
    note: '本文件由发版门禁生成，绑定产物哈希与规则指纹。详情已脱敏，不含凭据原文。',
  };

  const out = path.join(targetDir, exe.replace(/\.exe$/, '.scan.json'));
  fs.writeFileSync(out, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`\n📄 扫描凭证: ${path.basename(out)}`);
  console.log(`   产物 sha256: ${pkgSha.slice(0, 16)}…  规则指纹: ${rulesFingerprint}  结果: ${payload.result}`);
  return out;
}

/* -------------------------------- 入口 -------------------------------- */

const argv = process.argv.slice(2);
const flags = argv.filter(a => a.startsWith('--'));
const positional = argv.filter(a => !a.startsWith('--'));

if (flags.includes('--self-test')) {
  selfTest();
} else {
  const target = positional[0] ? path.resolve(ROOT, positional[0]) : pickDist();
  const res = runScan(target);
  report(target, res);
  if (flags.includes('--sidecar')) writeSidecar(target, res);
  if (res.fails.length && flags.includes('--quarantine')) quarantine(target, res);
  process.exit(res.fails.length ? 1 : 0);
}
