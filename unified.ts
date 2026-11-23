import { bestTier, indentOf, joinDoc, occurrences, reindent, splitDoc, type Doc } from './tiers.ts';

// The unified-diff format (SPEC.md section 6). Parse problems throw Error('parse N').

interface Item {
  kind: 'ctx' | 'old' | 'new' | 'bs';
  text: string;
}
interface Hunk {
  a: number;
  body: Item[];
}

function dashPath(line: string): string | null {
  let rest = line.slice(4);
  const tab = rest.indexOf('\t');
  if (tab >= 0) rest = rest.slice(0, tab);
  rest = rest.trim();
  if (rest === '/dev/null') return null;
  if (rest.startsWith('a/') || rest.startsWith('b/')) rest = rest.slice(2);
  return rest;
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

function applyHunks(text: string, hunks: Hunk[], strict: boolean): string {
  const sp = splitDoc(text);
  const lines = sp.lines.slice();
  let ends = sp.final;
  let d = 0;
  for (const h of hunks) {
    const O = h.body.filter((it) => it.kind === 'ctx' || it.kind === 'old').map((it) => it.text);
    const Nitems = h.body.filter((it) => it.kind === 'ctx' || it.kind === 'new');
    const N = Nitems.map((it) => it.text);
    const bs = (() => {
      let last = -1;
      for (let k = 0; k < h.body.length; k++) if (h.body[k]!.kind === 'ctx' || h.body[k]!.kind === 'new') last = k;
      return last >= 0 && h.body[last + 1] !== undefined && h.body[last + 1]!.kind === 'bs';
    })();
    if (O.length > 0) {
      const tier = bestTier(lines, O, strict);
      if (tier === null) throw new Error('no-match');
      const positions = occurrences(lines, O, tier);
      const target = h.a - 1 + d;
      let best = positions[0]!;
      for (const p of positions) if (Math.abs(p - target) < Math.abs(best - target)) best = p;
      const out: string[] = [];
      let oi = 0;
      for (const it of h.body) {
        if (it.kind === 'ctx') {
          out.push(lines[best + oi]!);
          oi += 1;
        } else if (it.kind === 'old') oi += 1;
        else if (it.kind === 'new') {
          if (tier === 2) out.push(reindent(it.text, indentOf(lines[best]!), indentOf(O[0]!)));
          else out.push(it.text);
        }
      }
      const toEnd = best + O.length === lines.length;
      lines.splice(best, O.length, ...out);
      if (toEnd) ends = !bs;
      d += N.length - O.length;
    } else {
      const ins = Math.max(0, Math.min(h.a + d, lines.length));
      const atEnd = ins >= lines.length;
      lines.splice(ins, 0, ...N);
      if (atEnd && N.length > 0) ends = !bs;
      d += N.length;
    }
  }
  return joinDoc({ lines, br: sp.br, final: ends });
}

function parseSection(lines: string[], start: number, diffPaths: [string, string] | null, dashPair: [number, number] | null): { doc: Doc; next: number } {
  let i = start;
  let oldP: string | null = null;
  let newP: string | null = null;
  let haveDash = false;
  let renameOld: string | null = null;
  let renameNew: string | null = null;
  let creating = false;
  let deleting = false;
  if (dashPair !== null) {
    oldP = dashPath(lines[dashPair[0]]!);
    newP = dashPath(lines[dashPair[1]]!);
    haveDash = true;
    i = dashPair[1] + 1;
  } else i = start + 1;
  const hunks: Hunk[] = [];
  let inBody = false;
  let sawHunk = false;
  while (i < lines.length) {
    const l = lines[i]!;
    if (l.startsWith('diff --git ')) break;
    if (l.startsWith('--- ') && i + 1 < lines.length && lines[i + 1]!.startsWith('+++ ')) {
      if (!haveDash && !sawHunk) {
        oldP = dashPath(l);
        newP = dashPath(lines[i + 1]!);
        haveDash = true;
        i += 2;
        continue;
      }
      break;
    }
    if (inBody) {
      if (l.startsWith(' ') || l.startsWith('-') || l.startsWith('+') || l.startsWith('\\') || l === '') {
        const h = hunks[hunks.length - 1]!;
        const kind: Item['kind'] = l.startsWith('\\') ? 'bs' : l.startsWith(' ') ? 'ctx' : l.startsWith('-') ? 'old' : l.startsWith('+') ? 'new' : 'ctx';
        h.body.push({ kind, text: kind === 'ctx' && l.startsWith(' ') ? l.slice(1) : kind === 'ctx' ? '' : l.slice(1) });
        i += 1;
        continue;
      }
      inBody = false;
      continue;
    }
    if (l.startsWith('--- ')) {
      if (!sawHunk) throw new Error(`parse ${i + 2}`);
      i += 1;
      continue;
    }
    if (l.startsWith('rename from ')) {
      if (!sawHunk && renameOld === null) renameOld = l.slice('rename from '.length);
      i += 1;
      continue;
    }
    if (l.startsWith('rename to ')) {
      if (!sawHunk && renameNew === null) renameNew = l.slice('rename to '.length);
      i += 1;
      continue;
    }
    if (l.startsWith('new file mode')) {
      if (!sawHunk) creating = true;
      i += 1;
      continue;
    }
    if (l.startsWith('deleted file mode')) {
      if (!sawHunk) deleting = true;
      i += 1;
      continue;
    }
    const hm = HUNK_RE.exec(l);
    if (hm !== null) {
      hunks.push({ a: parseInt(hm[1]!, 10), body: [] });
      inBody = true;
      sawHunk = true;
      i += 1;
      continue;
    }
    if (l.startsWith('@@')) throw new Error(`parse ${i + 1}`);
    i += 1;
    continue;
  }
  for (const h of hunks) {
    while (h.body.length > 0 && h.body[h.body.length - 1]!.kind === 'ctx' && h.body[h.body.length - 1]!.text === '') h.body.pop();
  }
  const oldSrc = haveDash ? oldP : renameOld ?? diffPaths?.[0] ?? null;
  const newSrc = haveDash ? newP : renameNew ?? diffPaths?.[1] ?? null;
  if (creating || oldSrc === null) {
    const p = newSrc ?? oldSrc ?? '';
    const plus: string[] = [];
    let bs = false;
    for (const h of hunks)
      for (const it of h.body) {
        if (it.kind === 'new') {
          plus.push(it.text);
          bs = false;
        } else if (it.kind === 'bs') bs = true;
      }
    const content = plus.length === 0 ? '' : plus.join('\n') + (bs ? '' : '\n');
    const doc: Doc = { path: p, apply: (current) => { if (current !== null) throw new Error('exists'); return content; } };
    return { doc, next: i };
  }
  if (deleting || newSrc === null) {
    const p = oldSrc ?? newSrc ?? '';
    const doc: Doc = { path: p, apply: (current) => { if (current === null) throw new Error('missing'); return null; } };
    return { doc, next: i };
  }
  const o = oldSrc!;
  const n = newSrc!;
  const doc: Doc = { path: o, to: o !== n ? n : undefined, apply: (current) => { if (current === null) throw new Error('missing'); return applyHunks(current, hunks, strictRef); } };
  return { doc, next: i };
}

let strictRef = false;

export function parseUnified(text: string, lines: string[], strict = false): Doc[] {
  void text;
  strictRef = strict;
  const docs: Doc[] = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i]!;
    if (l.startsWith('diff --git ')) {
      const m = /^diff --git a\/(.*) b\/(.*)$/.exec(l);
      if (m === null) throw new Error(`parse ${i + 1}`);
      const strip = (s: string): string => (s.startsWith('a/') || s.startsWith('b/') ? s.slice(2) : s);
      const sec = parseSection(lines, i, [strip(m[1]!), strip(m[2]!)], null);
      docs.push(sec.doc);
      i = sec.next;
      continue;
    }
    if (l.startsWith('@@')) throw new Error(`parse ${i + 1}`);
    if (l.startsWith('--- ') && i + 1 < lines.length && lines[i + 1]!.startsWith('+++ ')) {
      const sec = parseSection(lines, i, null, [i, i + 1]);
      docs.push(sec.doc);
      i = sec.next;
      continue;
    }
    i += 1;
  }
  if (docs.length === 0) throw new Error('parse 1');
  return docs;
}
