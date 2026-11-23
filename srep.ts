import { reindent, splitDoc, joinDoc, bestTier, type Doc } from './tiers.ts';

const SEARCH = '<<<<<<< SEARCH';
const DIVIDER = '=======';
const REPLACE = '>>>>>>> REPLACE';

export function parseSrep(text: string, lines: string[], strict = false): Doc[] {
  // Parse blocks.
  const docs: Doc[] = [];
  let previousPath: string | null = null;
  let scanFrom = 0;

  while (true) {
    // Find next SEARCH marker at or after scanFrom.
    let searchIdx = -1;
    for (let i = scanFrom; i < lines.length; i++) {
      if (lines[i].trimEnd() === SEARCH) {
        searchIdx = i;
        break;
      }
    }
    if (searchIdx === -1) break;

    // Determine path: nearest line before searchIdx, after previous block's REPLACE (or start),
    // that is not blank and does not start with three backticks (trimmed).
    let path: string | null = null;
    for (let i = searchIdx - 1; i >= scanFrom; i--) {
      const trimmed = lines[i].trim();
      if (trimmed === '') continue;
      if (trimmed.startsWith('```')) continue;
      path = trimmed;
      break;
    }
    if (path === null) {
      if (previousPath === null) {
        throw Error('parse ' + (searchIdx + 1));
      }
      path = previousPath;
    }

    // Find DIVIDER after SEARCH, before any REPLACE.
    let dividerIdx = -1;
    for (let i = searchIdx + 1; i < lines.length; i++) {
      if (lines[i].trimEnd() === DIVIDER) {
        dividerIdx = i;
        break;
      }
      if (lines[i].trimEnd() === REPLACE) {
        throw Error('parse ' + (searchIdx + 1));
      }
    }
    if (dividerIdx === -1) {
      throw Error('parse ' + (searchIdx + 1));
    }

    // Find REPLACE after DIVIDER.
    let replaceIdx = -1;
    for (let i = dividerIdx + 1; i < lines.length; i++) {
      if (lines[i].trimEnd() === REPLACE) {
        replaceIdx = i;
        break;
      }
    }
    if (replaceIdx === -1) {
      throw Error('parse ' + (searchIdx + 1));
    }

    const old = lines.slice(searchIdx + 1, dividerIdx);
    const newLines = lines.slice(dividerIdx + 1, replaceIdx);

    const doc: Doc = makeDoc(path, old, newLines, strict);
    docs.push(doc);

    previousPath = path;
    scanFrom = replaceIdx + 1;
  }

  if (docs.length === 0) {
    throw Error('parse 1');
  }

  return docs;
}

function indentOf(line: string): string {
  let i = 0;
  while (i < line.length && (line[i] === ' ' || line[i] === '\t')) {
    i++;
  }
  return line.slice(0, i);
}

function matches(line: string, oldLine: string, tier: number): boolean {
  if (tier === 0) {
    return line === oldLine;
  }
  if (tier === 1) {
    return line.trimEnd() === oldLine.trimEnd();
  }
  // tier 2
  return line.trim() === oldLine.trim();
}

function makeDoc(path: string, old: string[], newLines: string[], strict: boolean): Doc {
  const newText = () =>
    newLines.join('\n') + (newLines.length > 0 ? '\n' : '');

  return {
    path,
    apply(current: string | null): string {
      if (old.length === 0) {
        if (current !== null) {
          throw Error('exists');
        }
        return newText();
      }
      // Modify.
      if (current === null) {
        throw Error('missing');
      }
      const sp = splitDoc(current);
      const t = bestTier(sp.lines, old, strict);
      if (t === null) {
        throw Error('no-match');
      }
      // Find every position where old matches at tier t.
      const positions: number[] = [];
      for (let i = 0; i + old.length <= sp.lines.length; i++) {
        let ok = true;
        for (let j = 0; j < old.length; j++) {
          if (!matches(sp.lines[i + j], old[j], t)) {
            ok = false;
            break;
          }
        }
        if (ok) {
          positions.push(i);
        }
      }
      if (positions.length > 1) {
        throw Error('ambiguous');
      }
      const at = positions[0];

      let n = newLines.slice();
      if (t === 2) {
        const old0Indent = indentOf(old[0]);
        const spIndent = indentOf(sp.lines[at]);
        n = n.map((nLine) => {
          if (nLine.trim() === '') return nLine;
          return reindent(nLine, spIndent, old0Indent);
        });
      }

      const result = sp.lines.slice(0, at).concat(n, sp.lines.slice(at + old.length));
      return joinDoc({ lines: result, br: sp.br, final: sp.final });
    },
  };
}
