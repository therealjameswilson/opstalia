export function safeCsvCell(value: unknown): string {
  let text = value === undefined || value === null ? "" : String(value);
  // Spreadsheet formulas can be hidden behind whitespace or control prefixes.
  // eslint-disable-next-line no-control-regex
  if (/^[\s\u0000-\u001f\u007f-\u009f]*[=+\-@]/u.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function safeMarkdownText(value: unknown): string {
  return String(value ?? "")
    .replace(/[\r\n\u2028\u2029]+/g, " ")
    // Markdown is rendered by downstream tools; remove non-printing controls.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/([`*_{}[\]()|])/g, "\\$1");
}

export function safeMarkdownUrl(value: unknown): string {
  try {
    const url = new URL(String(value));
    return `<${url.href.replace(/</g, "%3C").replace(/>/g, "%3E")}>`;
  } catch {
    return safeMarkdownText(value);
  }
}
