export function csvCell(value: string | number | null | undefined) {
  // Treat source names/narrations as text; preserve genuine numeric negative balances.
  const raw = value == null ? '' : String(value);
  const text =
    typeof value === 'string' && (/^\s*[=+@-]/.test(raw) || /^[\t\r\n]/.test(raw))
      ? `'${raw}`
      : raw;
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function downloadCsv(
  filename: string,
  headers: string[],
  rows: Array<Array<string | number | null | undefined>>,
) {
  const lines = [headers, ...rows].map((row) => row.map(csvCell).join(','));
  const blob = new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
