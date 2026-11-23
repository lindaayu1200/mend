import { indentOf, joinDoc, reindent, splitDoc, type Doc } from './tiers.ts';

// The V4A patch format (SPEC.md section 8). Parse problems throw Error('parse N').

interface Item {
  kind: 'ctx' | 'old' | 'new';
  text: string;
}
interface Chunk {
  anchor: string;
  body: Item[];
  eof: boolean;
}

function eq(a: string, b: string, tier: number): boolean {
  if (tier === 0) return a === b;
  if (tier === 1) return a.replace(/[ \t]+$/, '') === b.replace(/[ \t]+$/, '');
  return a.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '') === b.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');
}

function applyChunks(text: string, chunks: Chunk[], strict: boolean): string {
  const sp = splitDoc(text);
  const lines = sp.lines.slice();
  let cursor = 0;
  for (const ch of chunks) {
    if (ch.anchor !== '') {
      let found = -1;
      const top = strict ? 1 : 3;
      for (let t = 0; t < top && found < 0; t++) {
        for (let j = cursor; j < lines.length; j++) {
          if (eq(lines[j]!, ch.anchor, t)) {
            found = j;
            break;
          }
        }
      }
      if (found < 0) throw new Error('no-match');
      cursor = found + 1;
    }
    const O = ch.body.filter((it) => it.kind === 'ctx' || it.kind === 'old').map((it) => it.text);
    const N = ch.body.filter((it) => it.kind === 'ctx' || it.kind === 'new').map((it) => it.text);
    if (O.length > 0) {
      let at = -1;
      let tier = 0;
      const top = strict ? 1 : 3;
      for (let t = 0; t < top && at < 0; t++) {
        for (let i = cursor; i + O.length <= lines.length; i++) {
          if (ch.eof && i + O.length !== lines.length) continue;
          let ok = true;
          for (let k = 0; k < O.length; k++) {
            if (!eq(lines[i + k]!, O[k]!, t)) {
              ok = false;
              break;
            }
          }
          if (ok) {
            at = i;
            tier = t;
            break;
          }
        }
      }
      if (at < 0) throw new Error('no-match');
      const out: string[] = [];
      let oi = 0;
      for (const it of ch.body) {
        if (it.kind === 'ctx') {
          out.push(lines[at + oi]!);
          oi += 1;
        } else if (it.kind === 'old') oi += 1;
        else if (it.kind === 'new') {
          if (tier === 2) out.push(reindent(it.text, indentOf(lines[at]!), indentOf(O[0]!)));
          else out.push(it.text);
        }
      }
      lines.splice(at, O.length, ...out);
      cursor = at + out.length;
    } else {
      const ins = ch.eof ? lines.length : Math.min(cursor, lines.length);
      lines.splice(ins, 0, ...N);
      cursor = ins + N.length;
    }
  }
  return joinDoc({ lines, br: sp.br, final: sp.final });
}

const isMarker = (l: string): boolean =>
  l.startsWith('*** Add File: ') || l.startsWith('*** Delete File: ') || l.startsWith('*** Update File: ') || l.trim() === '*** End Patch';

export function parseV4a(text: string, lines: string[], strict = false): Doc[] {
  void text;
  const blank = (l: string): boolean => l.trim() === '';
  const first = lines.findIndex((l) => !blank(l));
  if (first < 0) throw new Error('parse 1');
  if (lines[first]!.trim() !== '*** Begin Patch') throw new Error(`parse ${first + 1}`);
  let last = -1;
  for (let k = lines.length - 1; k >= 0; k--) if (!blank(lines[k]!)) { last = k; break; }
  if (lines[last]!.trim() !== '*** End Patch') throw new Error(`parse ${lines.length + 1}`);
  const docs: Doc[] = [];
  let i = first + 1;
  while (i < last) {
    const l = lines[i]!;
    if (blank(l)) {
      i += 1;
      continue;
    }
    if (l.startsWith('*** Add File: ')) {
      const p = l.slice('*** Add File: '.length).trim();
      const body: string[] = [];
      let j = i + 1;
      let bad = -1;
      while (j < last) {
        const t = lines[j]!;
        if (isMarker(t)) break;
        if (t.startsWith('+')) body.push(t.slice(1));
        else if (blank(t)) body.push('');
        else {
          bad = j;
          break;
        }
        j += 1;
      }
      if (bad >= 0) throw new Error(`parse ${bad + 1}`);
      while (body.length > 0 && body[body.length - 1] === '') body.pop();
      const content = body.length === 0 ? '' : body.join('\n') + '\n';
      docs.push({ path: p, apply: (current) => { if (current !== null) throw new Error('exists'); return content; } });
      i = j;
      continue;
    }
    if (l.startsWith('*** Delete File: ')) {
      const p = l.slice('*** Delete File: '.length).trim();
      let j = i + 1;
      while (j < last && blank(lines[j]!)) j += 1;
      if (j < last && !isMarker(lines[j]!)) throw new Error(`parse ${j + 1}`);
      docs.push({ path: p, apply: (current) => { if (current === null) throw new Error('missing'); return null; } });
      i = j;
      continue;
    }
    if (l.startsWith('*** Update File: ')) {
      const p = l.slice('*** Update File: '.length).trim();
      let moveTo: string | null = null;
      let j = i + 1;
      if (j < last && lines[j]!.startsWith('*** Move to: ')) {
        moveTo = lines[j]!.slice('*** Move to: '.length).trim();
        j += 1;
      }
      const chunks: Chunk[] = [];
      let cur: Chunk | null = null;
      let firstChunk = true;
      let bad = -1;
      while (j < last) {
        const t = lines[j]!;
        if (t.startsWith('@@')) {
          cur = { anchor: t.slice(2).trim(), body: [], eof: false };
          chunks.push(cur);
          firstChunk = false;
          j += 1;
          continue;
        }
        if (t.trim() === '*** End of File') {
          if (cur === null) {
            bad = j;
            break;
          }
          cur.eof = true;
          while (cur.body.length > 0 && cur.body[cur.body.length - 1]!.kind === 'ctx' && cur.body[cur.body.length - 1]!.text === '') cur.body.pop();
          cur = null;
          j += 1;
          continue;
        }
        if (isMarker(t)) break;
        if (cur === null) {
          if (!firstChunk) {
            bad = j;
            break;
          }
          cur = { anchor: '', body: [], eof: false };
          chunks.push(cur);
          firstChunk = false;
        }
        if (t.startsWith(' ') || t.startsWith('-') || t.startsWith('+')) {
          cur.body.push({ kind: t.startsWith(' ') ? 'ctx' : t.startsWith('-') ? 'old' : 'new', text: t.slice(1) });
        } else if (blank(t)) cur.body.push({ kind: 'ctx', text: '' });
        else {
          bad = j;
          break;
        }
        j += 1;
      }
      if (bad >= 0) throw new Error(`parse ${bad + 1}`);
      if (cur !== null) {
        while (cur.body.length > 0 && cur.body[cur.body.length - 1]!.kind === 'ctx' && cur.body[cur.body.length - 1]!.text === '') cur.body.pop();
      }
      if (chunks.length === 0 && moveTo === null) throw new Error(`parse ${i + 1}`);
      const applyBody = (current: string): string => applyChunks(current, chunks, strict);
      docs.push({ path: p, to: moveTo ?? undefined, apply: (current) => { if (current === null) throw new Error('missing'); return applyBody(current); } });
      i = j;
      continue;
    }
    throw new Error(`parse ${i + 1}`);
  }
  return docs;
}
