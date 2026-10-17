// Masks secret-looking parts of config strings before they leave the server
// (docs/design/10-config-overview.md §5). Values of env/headers maps are never
// sent at all — see maskMapValue(); this file handles free-form strings such as
// MCP args, hook commands and permission rules.

const MASK = "•••";
const SECRET_NAME = "(?:api[_-]?key|apikey|access[_-]?key|secret|token|passw(?:or)?d|pwd|auth|credential|private[_-]?key|client[_-]?secret)";
const SECRET_NAME_RE = new RegExp(SECRET_NAME, "i");

const RULES = [
  // https://user:pass@host
  [/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, `$1${MASK}@`],
  // ?api_key=...&token=...
  [new RegExp(`([?&][\\w.-]*(?:${SECRET_NAME}|sig|signature)[\\w.-]*=)[^&#\\s"']+`, "gi"), `$1${MASK}`],
  // Authorization: Bearer xxx
  [/\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{8,}/g, `$1 ${MASK}`],
  // "password": "xxx"  /  password: xxx
  [new RegExp(`(["']?[\\w-]*${SECRET_NAME}[\\w-]*["']?\\s*:\\s*)("[^"]*"|'[^']*'|[^\\s,}]+)`, "gi"), `$1${MASK}`],
  // --api-key=xxx  /  GITHUB_TOKEN=xxx
  [new RegExp(`((?:^|[\\s"'(])-{0,2}[\\w-]*${SECRET_NAME}[\\w-]*=)("[^"]*"|'[^']*'|[^\\s"')]+)`, "gi"), `$1${MASK}`],
  // --token xxx (flags only, so `gh auth login` stays readable)
  [new RegExp(`((?:^|[\\s"'(])-{1,2}[\\w-]*${SECRET_NAME}[\\w-]*\\s+)("[^"]*"|'[^']*'|[^\\s"')-][^\\s"')]*)`, "gi"), `$1${MASK}`],
  // Well-known token shapes.
  [/\bsk-(?:ant-)?[A-Za-z0-9_-]{10,}/g, MASK],
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g, MASK],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, MASK],
  [/\bglpat-[A-Za-z0-9_-]{16,}/g, MASK],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, MASK],
  [/\bAKIA[0-9A-Z]{16}\b/g, MASK],
  [/\bAIza[0-9A-Za-z_-]{30,}/g, MASK],
];

// Long random-looking runs (mixed case + digits, 32+ chars) — catches keys with
// no recognizable prefix. Plain words, paths and hex hashes don't qualify.
const LONG_RUN = /[A-Za-z0-9_+/=-]{32,}/g;
function looksRandom(s) {
  return /[a-z]/.test(s) && /[A-Z]/.test(s) && /[0-9]/.test(s) && !s.includes("/");
}

function maskString(value) {
  if (typeof value !== "string" || !value) return value;
  let out = value;
  for (const [re, rep] of RULES) out = out.replace(re, rep);
  return out.replace(LONG_RUN, (m) => (looksRandom(m) ? MASK : m));
}

// Arg arrays: also hide the value that follows a flag like `--token`.
function maskArgs(args) {
  if (!Array.isArray(args)) return [];
  return args.map((a, i) => {
    const prev = i > 0 ? String(args[i - 1]) : "";
    if (/^-{1,2}[\w-]+$/.test(prev) && SECRET_NAME_RE.test(prev)) return MASK;
    return maskString(String(a));
  });
}

// env / headers values: only a plain `${VAR}` reference is shown, since it names
// a variable rather than holding the secret itself.
function maskMapValue(value) {
  return typeof value === "string" && /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(value) ? value : MASK;
}

module.exports = { MASK, maskString, maskArgs, maskMapValue };
