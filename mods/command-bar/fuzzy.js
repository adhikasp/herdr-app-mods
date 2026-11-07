// Fuzzy matching, a compact take on the fzf scoring model: subsequence matching
// with bonuses for word boundaries, camelCase transitions and runs of adjacent
// characters, and penalties for the gaps between them. A query is space-separated
// terms combined with AND ("tri work" matches text holding both). Positions are
// code point indices. Pure: no host imports, so `node --test` runs it.

export const SCORE_MATCH = 16;
export const BONUS_BOUNDARY = 16;
export const BONUS_CAMEL = 12;
export const BONUS_CONSECUTIVE = 16;
export const BONUS_FIRST_CHAR_MULTIPLIER = 2;
export const PENALTY_GAP_START = -3;
export const PENALTY_GAP_EXTENSION = -1;

const NEG = -1e9;
const DELIMITERS = new Set(" \t/\\-_.:,;|()[]{}<>@#'\"~+*=&%!?".split(""));

const isLower = (c) => c !== c.toUpperCase() && c === c.toLowerCase();
const isUpper = (c) => c !== c.toLowerCase() && c === c.toUpperCase();
const isDigit = (c) => c >= "0" && c <= "9";

/** Split a raw query into AND-ed terms, keeping quoted phrases together. */
export function splitQuery(query) {
  const terms = [];
  let current = "";
  let quote = null;
  for (const c of query) {
    if (quote) {
      if (c === quote) quote = null;
      else current += c;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      continue;
    }
    if (/\s/u.test(c)) {
      if (current) terms.push(current);
      current = "";
      continue;
    }
    current += c;
  }
  if (current) terms.push(current);
  return terms;
}

function bonuses(chars) {
  return chars.map((c, i) => {
    if (i === 0) return BONUS_BOUNDARY;
    const p = chars[i - 1];
    if (DELIMITERS.has(p)) return BONUS_BOUNDARY;
    if ((isLower(p) && isUpper(c)) || isDigit(p) !== isDigit(c)) return BONUS_CAMEL;
    return 0;
  });
}

/** A field ready to match: characters, case-folded characters and per-character bonuses. */
export function prepare(text) {
  const chars = Array.from(String(text ?? ""));
  let folded = chars.map((c) => {
    const l = c.toLowerCase();
    return Array.from(l).length === 1 ? l : c; // keep positions in step with the text
  });
  return { chars, folded, bonus: bonuses(chars) };
}

/** A query term, folded once. Smart case: an all-lowercase term ignores case. */
export function term(query) {
  const fold = query === query.toLowerCase();
  return { fold, needle: Array.from(fold ? query.toLowerCase() : query) };
}

/** Score one term against one prepared field: `{score, positions}` or null. */
export function matchPrepared(t, field) {
  const needle = t.needle;
  const m = needle.length;
  if (m === 0) return { score: 0, positions: [] };
  const hay = t.fold ? field.folded : field.chars;
  const n = hay.length;
  if (n < m) return null;
  // Cheap rejection: every query character must appear in order.
  let cursor = 0;
  for (const c of needle) {
    cursor = hay.indexOf(c, cursor);
    if (cursor < 0) return null;
    cursor++;
  }
  const bonus = field.bonus;
  const H = Array.from({ length: m }, () => new Array(n).fill(NEG));
  const P = Array.from({ length: m }, () => new Array(n).fill(-1));
  for (let i = 0; i < n; i++) {
    if (hay[i] === needle[0]) H[0][i] = SCORE_MATCH + bonus[i] * BONUS_FIRST_CHAR_MULTIPLIER;
  }
  for (let j = 1; j < m; j++) {
    let carry = NEG; // best H[j-1][k] with the gap penalty up to the current i
    let carryFrom = -1;
    for (let i = j; i < n; i++) {
      // Extend an open gap by one more character, or open one after column i-2.
      if (carry > NEG) carry += PENALTY_GAP_EXTENSION;
      if (i >= 2 && H[j - 1][i - 2] > NEG && H[j - 1][i - 2] + PENALTY_GAP_START > carry) {
        carry = H[j - 1][i - 2] + PENALTY_GAP_START;
        carryFrom = i - 2;
      }
      if (hay[i] !== needle[j]) continue;
      let best = NEG;
      let from = -1;
      if (H[j - 1][i - 1] > NEG) {
        best = H[j - 1][i - 1] + SCORE_MATCH + Math.max(bonus[i], BONUS_CONSECUTIVE);
        from = i - 1;
      }
      if (carry > NEG && carry + SCORE_MATCH + bonus[i] > best) {
        best = carry + SCORE_MATCH + bonus[i];
        from = carryFrom;
      }
      if (best > NEG) {
        H[j][i] = best;
        P[j][i] = from;
      }
    }
  }
  let end = -1;
  let top = NEG;
  for (let i = 0; i < n; i++) {
    if (H[m - 1][i] > top) {
      top = H[m - 1][i];
      end = i;
    }
  }
  if (end < 0) return null;
  const positions = new Array(m);
  let at = end;
  for (let j = m - 1; j >= 0; j--) {
    positions[j] = at;
    at = P[j][at];
  }
  return { score: top, positions };
}

/** Score one term against plain text (convenience for tests and one-offs). */
export function matchText(query, text) {
  if (!query) return { score: 0, positions: [] };
  return matchPrepared(term(query), prepare(text));
}

/**
 * Match a whole query against an item's fields. `fields` is an array of
 * `{text|prepared, weight}`; every term must match at least one field. Returns
 * `{score, positions}` where `positions[fieldIndex]` is the union of matched
 * indices in that field (the field the term scored best in), or null.
 */
export function matchFields(terms, fields) {
  let total = 0;
  const positions = fields.map(() => []);
  for (const t of terms) {
    let best = null;
    let bestField = -1;
    fields.forEach((f, i) => {
      if (!f.prepared) return;
      const r = matchPrepared(t, f.prepared);
      if (!r) return;
      const s = r.score * (f.weight ?? 1);
      if (!best || s > best.s) {
        best = { s, r };
        bestField = i;
      }
    });
    if (!best) return null;
    total += best.s;
    positions[bestField].push(...best.r.positions);
  }
  for (const p of positions) {
    p.sort((a, b) => a - b);
  }
  return { score: total, positions: positions.map((p) => [...new Set(p)]) };
}
