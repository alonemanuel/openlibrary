/**
 * A small, dependency-free RFC 4180 CSV reader/writer.
 *
 * Exports are the product here, not a side feature: they need to open cleanly
 * in Excel, Numbers, Sheets and pandas, round-trip through our own importer,
 * and diff sensibly in git when someone points a sync target at a repo.
 */

export function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str === '') return '';
  // Leading =, +, -, @ are interpreted as formulas by spreadsheet apps; a
  // library full of user text should never execute anything on open.
  const needsFormulaGuard = /^[=+\-@\t\r]/.test(str);
  const guarded = needsFormulaGuard ? `'${str}` : str;
  if (/[",\n\r]/.test(guarded)) return `"${guarded.replace(/"/g, '""')}"`;
  return guarded;
}

export function toCsv(rows: readonly (readonly unknown[])[]): string {
  return rows.map((row) => row.map(escapeCsvValue).join(',')).join('\r\n') + '\r\n';
}

/** Parses CSV text into rows of strings. Tolerates CRLF, LF, BOM and quotes. */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    // Skip rows that are entirely empty (trailing newline at end of file).
    if (row.length > 1 || row[0] !== '') rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const char = text[i]!;
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }
    if (char === '"' && field === '') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (char === ',') {
      pushField();
      i += 1;
      continue;
    }
    if (char === '\r') {
      if (text[i + 1] === '\n') i += 1;
      pushRow();
      i += 1;
      continue;
    }
    if (char === '\n') {
      pushRow();
      i += 1;
      continue;
    }
    field += char;
    i += 1;
  }
  if (field !== '' || row.length > 0) pushRow();
  return rows;
}

/** Parses CSV with a header row into objects keyed by (trimmed) header name. */
export function parseCsvRecords(input: string): Record<string, string>[] {
  const rows = parseCsv(input);
  const header = rows.shift();
  if (!header) return [];
  const keys = header.map((key) => key.trim());
  return rows.map((row) => {
    const record: Record<string, string> = {};
    keys.forEach((key, index) => {
      record[key] = (row[index] ?? '').trim();
    });
    return record;
  });
}
