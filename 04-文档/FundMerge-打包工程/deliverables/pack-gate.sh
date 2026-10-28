#!/bin/sh
# 发版门禁包装器 — 规避管道吞掉退出码的陷阱 + 规则指纹自校验
#
# 为什么需要它：
# 1) `node pack-scan.js dist | tail -30` 的 $? 是 tail 的退出码（恒 0），
#    CI 里这样写会出现「扫描 FAIL 但构建通过」的静默失效。
#    本脚本把输出先收进变量（不接管道），再原样透传 node 的退出码。
# 2) 自检 PASS 只证明「当前规则集能拦住已知 6 类违规」，证明不了「规则集没被改松」。
#    因此对【规则 + 匹配逻辑】取指纹，并与 pack-gate.expected 比对；
#    不一致即 FAIL —— 任何改动门禁行为的人都必须显式更新期望值，让改动留在 diff 里。
#
# 指纹覆盖范围：pack-scan.rules.json + pack-scan.js + pack-gate.sh（本脚本）
#   不含 expected 文件本身 —— 期望值独立存放，因此不存在"哈希嵌在被哈希文件里"的自指问题。
#   纳入本脚本的理由：它决定"扫什么"（选哪个目录、是否带 --quarantine、是否执行指纹比对），
#   若被改成扫另一个目录或跳过校验，门禁整套被架空而指纹依然"有效"。
#
# ⚠ 防护等级边界（不要把这套机制当成更强的保证）：
#   它防的是【无意改动】与【夹带改动】，不防【有意绕过】。
#   能改 pack-scan.js 的人同样能改 pack-gate.expected —— 两者同仓同权限。
#   指纹的价值是让"门禁被动过"在 diff 里显形，把决定权交回评审人；
#   它不是密码学意义上的防篡改。真正的防恶意要靠仓库之外的东西：
#   git 历史与签名、分支保护、以及【CI 从干净 checkout 运行】。
#   若 CI 在开发者工作区里跑，本地改过的脚本会直接生效 ——
#   此时指纹比对 FAIL 看着像误报，实际是它工作正常。
#
# 用法:
#   sh deliverables/pack-gate.sh [distDir|--self-test] [--quarantine]
#   sh deliverables/pack-gate.sh --update-expected     # 改动规则后显式更新期望指纹
#
# 退出码: 0 = PASS, 1 = FAIL（含指纹不一致）
#
# 造测试夹具的坑（给后来人）：Git Bash 下 `/dev/null` 是字符设备，
#   `cp -r /dev/null xxx.exe` 得到的东西 rename 会失败。造空文件请用 `: > file`。

set -u

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
RULES="$SCRIPT_DIR/pack-scan.rules.json"
SCANNER="$SCRIPT_DIR/pack-scan.js"
EXPECTED_FILE="$SCRIPT_DIR/pack-gate.expected"

# 指纹 = sha256(rules.json + pack-scan.js + pack-gate.sh)，取前 16 位
FINGERPRINT=$(node -e '
const c=require("crypto"),f=require("fs");
const h=c.createHash("sha256");
for (const p of process.argv.slice(1)) h.update(f.readFileSync(p));
process.stdout.write(h.digest("hex").slice(0,16));
' "$RULES" "$SCANNER" "$SCRIPT_DIR/pack-gate.sh" 2>/dev/null)
[ -z "${FINGERPRINT:-}" ] && FINGERPRINT="unknown"

RULES_VER=$(node -e 'try{process.stdout.write(String(require(process.argv[1]).version))}catch(e){process.stdout.write("?")}' "$RULES" 2>/dev/null)
[ -z "${RULES_VER:-}" ] && RULES_VER="?"

if [ "${1:-}" = "--update-expected" ]; then
  printf '%s\n' "$FINGERPRINT" > "$EXPECTED_FILE"
  printf '[门禁] 已更新期望指纹: %s（规则 v%s）—— 请与规则改动一并提交\n' "$FINGERPRINT" "$RULES_VER"
  exit 0
fi

printf '[门禁] 规则 v%s  指纹 %s\n' "$RULES_VER" "$FINGERPRINT"

if [ ! -f "$EXPECTED_FILE" ]; then
  printf '[门禁] FAIL — 缺少 pack-gate.expected，无法确认门禁未被改动\n' >&2
  printf '        首次使用请执行: sh deliverables/pack-gate.sh --update-expected\n' >&2
  exit 1
fi

EXPECTED=$(tr -d ' \r\n' < "$EXPECTED_FILE")
if [ "$EXPECTED" != "$FINGERPRINT" ]; then
  printf '\n[门禁] FAIL — 门禁指纹不一致，禁止发布\n' >&2
  printf '        期望: %s\n' "$EXPECTED" >&2
  printf '        实际: %s\n' "$FINGERPRINT" >&2
  printf '        说明: rules.json 或 pack-scan.js 被改动过。若属预期改动，\n' >&2
  printf '              请在同一个提交里执行 --update-expected 并说明理由；\n' >&2
  printf '              若不是你改的，说明门禁可能被绕过，须立即排查。\n' >&2
  exit 1
fi

out=$(node "$SCANNER" "$@" 2>&1)
code=$?

printf '%s\n' "$out"

if [ "$code" -ne 0 ]; then
  printf '\n[门禁] FAIL — 禁止发布（规则 v%s / %s）\n' "$RULES_VER" "$FINGERPRINT" >&2
  exit "$code"
fi

printf '\n[门禁] PASS（规则 v%s / %s）\n' "$RULES_VER" "$FINGERPRINT"
exit 0
