"use client";

import { CheckboxControl } from "@/components/ui/checkbox-control";

import { ChangeEvent, useRef, useState } from "react";
import { Check, FileUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type ImportRow = { row: number; name: string; phone: string; email: string; source: string; tags: string; consent: string; consentSource: string; consentWordingVersion: string };
type CheckedRow = ImportRow & { errors: string[]; duplicates: string[] };
type Preview = { rows: CheckedRow[]; summary: { total: number; valid: number; invalid: number; duplicates: number } };

function parseCsv(text: string): ImportRow[] {
  const records: string[][] = [];
  let row: string[] = []; let field = ""; let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field.length === 0) quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field); field = "";
      if (row.some((value) => value.trim())) records.push(row);
      row = [];
    } else field += char;
  }
  row.push(field); if (row.some((value) => value.trim())) records.push(row);
  if (quoted) throw new Error("The CSV has an unclosed quoted field.");
  if (records.length < 2) throw new Error("Add a header row and at least one customer row.");
  const headers = records[0].map((header) => header.trim().toLowerCase().replace(/[\s-]+/g, "_") );
  const find = (...names: string[]) => names.map((name) => headers.indexOf(name)).find((position) => position >= 0) ?? -1;
  const columns = { name: find("name", "full_name", "customer_name", "display_name"), phone: find("phone", "phone_number", "whatsapp_phone", "primary_phone"), email: find("email", "email_address"), source: find("source", "lead_source"), tags: find("tags", "labels"), consent: find("consent", "messaging_consent", "whatsapp_consent"), consentSource: find("consent_source", "consent_evidence", "opt_in_source"), consentWordingVersion: find("consent_wording_version", "wording_version") };
  if (columns.name < 0 || columns.phone < 0) throw new Error("CSV needs name and phone columns. Other supported headers: email, source, tags, consent, consent_source, consent_wording_version.");
  const value = (cells: string[], position: number) => position < 0 ? "" : (cells[position] ?? "").trim();
  const rows = records.slice(1).map((cells, index) => ({ row: index + 2, name: value(cells, columns.name), phone: value(cells, columns.phone), email: value(cells, columns.email), source: value(cells, columns.source), tags: value(cells, columns.tags), consent: value(cells, columns.consent), consentSource: value(cells, columns.consentSource), consentWordingVersion: value(cells, columns.consentWordingVersion) }));
  if (rows.length > 500) throw new Error("Import up to 500 customers per file.");
  return rows;
}

export function ContactImport({ onImported }: { onImported: (count: number) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [filename, setFilename] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file) return;
    setError(""); setNotice(""); setPreview(null); setSelected([]);
    try {
      if (file.size > 1024 * 1024) throw new Error("CSV files must be 1 MB or smaller.");
      const parsed = parseCsv(await file.text()); setRows(parsed); setFilename(file.name); await runPreview(parsed);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not read this CSV."); }
  }

  async function runPreview(nextRows = rows) {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/contacts/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "preview", rows: nextRows }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not preview this import.");
      const result = data as Preview; setPreview(result); setSelected(result.rows.filter((row) => !row.errors.length && !row.duplicates.length).map((row) => row.row));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not preview this import."); }
    finally { setBusy(false); }
  }

  async function commit() {
    if (!preview || !selected.length) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/contacts/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "commit", rows, selectedRows: selected }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not import customers.");
      setNotice(`Imported ${data.imported} customer${data.imported === 1 ? "" : "s"}.`); setPreview(null); setRows([]); setSelected([]); setFilename(""); onImported(Number(data.imported));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not import customers."); }
    finally { setBusy(false); }
  }

  return <section className="rounded-xl border bg-white p-4 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-sm font-semibold">Import customers</h2><p className="mt-1 text-xs text-muted-foreground">Upload CSV to preview validation and duplicates before importing. Up to 500 rows per file.</p></div><input ref={inputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(event) => void loadFile(event)} /><Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => inputRef.current?.click()}><FileUp data-icon="inline-start" />{busy ? "Checking…" : "Choose CSV"}</Button></div>{filename && <p className="mt-2 text-[11px] text-muted-foreground">{filename}</p>}{error && <p role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-800">{error}</p>}{notice && <p role="status" className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-900">{notice}</p>}{preview && <><div className="mt-3 flex flex-wrap gap-2"><Badge variant="secondary">{preview.summary.total} rows</Badge><Badge variant="success">{preview.summary.valid} new and valid</Badge><Badge variant="warning">{preview.summary.duplicates} duplicates</Badge>{preview.summary.invalid > 0 && <Badge variant="outline" className="border-red-300 bg-red-50 text-red-800">{preview.summary.invalid} invalid</Badge>}</div><div className="mt-3 max-h-72 overflow-auto rounded-lg border"><table className="w-full text-left text-xs"><thead className="sticky top-0 bg-slate-50 text-[10px] uppercase text-muted-foreground"><tr><th className="p-2">Import</th><th className="p-2">CSV row</th><th className="p-2">Customer</th><th className="p-2">Phone</th><th className="p-2">Review</th></tr></thead><tbody className="divide-y">{preview.rows.map((row) => { const eligible = !row.errors.length && !row.duplicates.length; return <tr key={row.row}><td className="p-2"><CheckboxControl aria-label={`Import CSV row ${row.row}`} disabled={!eligible || busy} checked={selected.includes(row.row)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, row.row] : current.filter((value) => value !== row.row))} /></td><td className="p-2">{row.row}</td><td className="p-2">{row.name || "—"}</td><td className="p-2">{row.phone || "—"}</td><td className="p-2 text-[10px] text-muted-foreground">{row.errors.concat(row.duplicates).join(" ") || "Ready"}</td></tr>; })}</tbody></table></div><div className="mt-3 flex flex-wrap items-center justify-between gap-2"><p className="text-[11px] text-muted-foreground">Explicit consent rows require consent_source evidence and consent_wording_version. Unknown consent is imported without sending permission.</p><Button type="button" disabled={busy || !selected.length} onClick={() => void commit()}><Check data-icon="inline-start" />Import {selected.length} selected</Button></div></>}</section>;
}
