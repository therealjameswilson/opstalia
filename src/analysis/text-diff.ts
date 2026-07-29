export type DiffPart = { type: "same" | "added" | "removed"; text: string };

export function diffWords(left: string, right: string): DiffPart[] {
  const a = left.split(/\s+/).filter(Boolean).slice(0, 1500);
  const b = right.split(/\s+/).filter(Boolean).slice(0, 1500);
  const rows = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      rows[i][j] = a[i - 1] === b[j - 1] ? rows[i - 1][j - 1] + 1 : Math.max(rows[i - 1][j], rows[i][j - 1]);
    }
  }
  const parts: DiffPart[] = [];
  let i = a.length;
  let j = b.length;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      parts.unshift({ type: "same", text: a[i - 1] });
      i -= 1;
      j -= 1;
    } else if (j > 0 && (i === 0 || rows[i][j - 1] >= rows[i - 1][j])) {
      parts.unshift({ type: "added", text: b[j - 1] });
      j -= 1;
    } else {
      parts.unshift({ type: "removed", text: a[i - 1] });
      i -= 1;
    }
  }
  return parts.reduce<DiffPart[]>((merged, part) => {
    const previous = merged.at(-1);
    if (previous?.type === part.type) previous.text += ` ${part.text}`;
    else merged.push({ ...part });
    return merged;
  }, []);
}
