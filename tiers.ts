// Three-tier line matching helpers (SPEC section 5). Self-contained: no imports.

const STRIP_TRAILING = /[ \t]+$/g;
const STRIP_LEADING = /^[ \t]+/;
const BLANK = /^[ \t]*$/;

/** Leading spaces and tabs of a line. */
export function indentOf(line: string): string {
  const m = line.match(/^[ \t]*/);
  return m ? m[0] : "";
}

/**
 * Tier 0: exact equality. Tier 1: equal after trailing spaces/tabs are removed
 * from both. Tier 2: equal after leading and trailing spaces/tabs are removed
 * from both.
 */
export function eqTier(a: string, b: string, tier: number): boolean {
  if (tier === 0) return a === b;
  if (tier === 1) {
    return a.replace(STRIP_TRAILING, "") === b.replace(STRIP_TRAILING, "");
  }
  const na = a.replace(STRIP_LEADING, "").replace(STRIP_TRAILING, "");
  const nb = b.replace(STRIP_LEADING, "").replace(STRIP_TRAILING, "");
  return na === nb;
}

/** True if o matches lines starting at i (lines i, i+1, ...) at the given tier. */
export function matchAt(lines: string[], i: number, o: string[], tier: number): boolean {
  if (i < 0 || i + o.length > lines.length) return false;
  for (let j = 0; j < o.length; j++) {
    if (!eqTier(lines[i + j], o[j], tier)) return false;
  }
  return true;
}

/** Every i where matchAt holds; occurrences may overlap; ascending order. */
export function occurrences(lines: string[], o: string[], tier: number): number[] {
  const out: number[] = [];
  for (let i = 0; i + o.length <= lines.length; i++) {
    if (matchAt(lines, i, o, tier)) out.push(i);
  }
  return out;
}

/** Lowest tier (0,1,2; strict: only 0) with at least one occurrence, else null. */
export function bestTier(lines: string[], o: string[], strict: boolean): number | null {
  const tiers = strict ? [0] : [0, 1, 2];
  for (const tier of tiers) {
    if (occurrences(lines, o, tier).length > 0) return tier;
  }
  return null;
}

/** A document's lines without terminators; br is '\n' or '\r\n'; final: doc ended with br. */
export type Split = { lines: string[]; br: string; final: boolean };

/** Empty doc: lines=[], final=false. CRLF doc iff its first '\n' is preceded by '\r'. */
export function splitDoc(text: string): Split {
  if (text.length === 0) return { lines: [], br: "\n", final: false };
  const nl = text.indexOf("\n");
  const br = nl >= 0 && nl > 0 && text[nl - 1] === "\r" ? "\r\n" : "\n";
  const final = text.endsWith(br);
  const body = final ? text.slice(0, text.length - br.length) : text;
  return { lines: body.split(br), br, final };
}

export function joinDoc(s: Split): string {
  if (s.lines.length === 0) return "";
  let out = s.lines.join(s.br);
  if (s.final) out += s.br;
  return out;
}

/**
 * If line is non-blank and starts with p, replace that leading p with f;
 * otherwise return the line unchanged.
 */
export function reindent(line: string, f: string, p: string): string {
  if (BLANK.test(line)) return line;
  if (!line.startsWith(p)) return line;
  return f + line.slice(p.length);
}

export type Doc = {
  path: string;
  to?: string;
  apply: (current: string | null) => string | null;
};
// Doc contract: apply(null) creates and returns the new content; apply(content) returns the modified content (or null for delete).
// It throws Error('exists') when a create target already exists, Error('missing') when the target file is needed but is null,
// Error('no-match') / Error('ambiguous') for match failures. Handle CRLF internally via splitDoc/joinDoc.
// Context lines are written as the file's own matched lines (never the patch's); tier-2 reindent per the spec text below.

/**
 * Replace lines[at..at+k) with n, honoring tier-2 reindent and doc br/final.
 * F is the indent of the file's first matched line (lines[at]); P is the indent
 * of the first old line (the patch's first line, approximated by n[0]).
 * Context lines are expected to already carry the file's own text in n.
 * Returns the new line array (before joinDoc).
 */
export function docReplacer(
  lines: string[],
  sp: Split,
  at: number,
  k: number,
  n: string[],
  tier: number
): string[] {
  const F = k > 0 ? indentOf(lines[at]) : "";
  const P = n.length > 0 ? indentOf(n[0]) : "";
  const replacement = tier === 2 ? n.map((line) => reindent(line, F, P)) : n.slice();
  return lines.slice(0, at).concat(replacement, lines.slice(at + k));
}
