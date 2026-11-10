import { mkdir, open, readFile, realpath, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  inspectPath, integrationError, isMain, readLimitedText, requireText, runCli, sha256,
} from "./migration-common.mjs";
import { runProcessCommand } from "./process-command.mjs";

const NOTES_PATH = "results/application_guidance/coding_notes.md";
const MAX_BYTES = 1_000_000;
const MAX_ITEMS = 2000;
const DISPOSITIONS = new Set(["applied", "no-change-needed", "not-applicable", "conflicting", "pending"]);
const EVIDENCE_KINDS = new Set(["source", "diff", "target", "scope", "policy", "limitation"]);
const PRIVATE_TEXT = /[\u0000-\u001f\u007f]|jdbc:|postgres(?:ql)?:\/\/|(?:password|pwd|token|secret|host(?:name)?|profile[-_ ]?id)\s*[:=]|https?:\/\/|[A-Z]:\\|\/(?:Users|home)\/|\b(?:\d{1,3}\.){3}\d{1,3}\b|\b[\w-]+(?:\.[\w-]+)*\.(?:com|net|org|local|internal)\b|[\w.+%-]+@[\w.-]+/i;
const OMITTED = {
  schemaVersion: 1, status: "not-supplied", reason: "optional-input-omitted",
  inputRef: null, provenance: null, sha256: null, items: [],
};

export function omittedCodingNotes() {
  return structuredClone(OMITTED);
}

function safeText(value, label) {
  if (typeof value !== "string" || !value.trim() || value.length > 1000 ||
    PRIVATE_TEXT.test(value)) {
    throw integrationError(`Coding notes ${label} must be concise, sanitized single-line evidence`);
  }
}

function exactKeys(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort());
}

// Inventory all nonempty Markdown blocks, not just guidance the agent considers easy/actionable.
export function inventoryCodingNotes(text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let start = null;
  let fence = null;
  function flush(end) {
    if (start !== null) blocks.push({ startLine: start + 1, endLine: end, text: lines.slice(start, end).join("\n") });
    start = null;
  }
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (fence) {
      if (new RegExp(`^\\s*${fence[0]}{${fence.length},}\\s*$`).test(line)) fence = null;
      continue;
    }
    if (!line.trim()) { flush(index); continue; }
    if (/^\s*(?:#{1,6}\s|[-*+]\s+(?:\[[ xX]\]\s*)?|\d+[.)]\s+|\|)/.test(line)) flush(index);
    if (start === null) start = index;
    const opening = line.match(/^\s*(`{3,}|~{3,})/);
    if (opening) fence = opening[1];
  }
  flush(lines.length);
  if (blocks.length > MAX_ITEMS) throw integrationError("notes-item-budget-exceeded");
  const occurrences = new Map();
  const ids = new Set();
  return blocks.map((block) => {
    const digest = sha256(block.text);
    const first = block.text.split("\n")[0]
      .replace(/^\s*(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|\|\s*)?(?:\[[ xX]\]\s*)?/, "");
    const supplied = first.replace(/^[`*]+/, "").match(/^\[?([A-Za-z0-9][A-Za-z0-9_.-]{0,63})\]?(?=[`*]*\s*[:.)-]\s|[`*]*\s|[`*]*\||$)/)?.[1];
    // Bare words are prose, not IDs. Explicit IDs contain a digit or a hyphen/underscore.
    const explicit = supplied && (/[\d_-]/.test(supplied) ||
      /^[`*\[]/.test(first)) ? supplied : null;
    const count = (occurrences.get(digest) ?? 0) + 1;
    occurrences.set(digest, count);
    const id = explicit ?? `NOTE-${digest.slice(0, 16)}-${count}`;
    if (PRIVATE_TEXT.test(id)) throw integrationError("unsafe-note-id");
    if (ids.has(id)) throw integrationError("duplicate-note-ids");
    ids.add(id);
    return {
      id, sha256: digest, startLine: block.startLine, endLine: block.endLine,
      evaluated: false, disposition: "pending", evidence: [], nextAction: "Read and evaluate this note.",
    };
  });
}

async function privateDirectory(root) {
  const git = runProcessCommand(root, "git", ["rev-parse", "--absolute-git-dir"]);
  if (git.status !== 0) throw integrationError("Coding notes provenance requires an existing Git worktree");
  return path.join(git.stdout.trim(), "migrate-oracle-app", "coding-notes");
}

async function inspectNotes(input) {
  const base = {
    schemaVersion: 1, status: "missing", reason: "input-missing",
    inputRef: sha256(input), provenance: null, sha256: null, items: [],
  };
  try {
    const metadata = await inspectPath(input, { allowMissing: true });
    if (!metadata) return base;
    const kind = metadata.isDirectory() ? "directory" : "file";
    const file = kind === "directory" ? path.join(input, NOTES_PATH) : input;
    base.provenance = { inputKind: kind, resolvedRef: sha256(file), resolution: kind === "directory" ? NOTES_PATH : "explicit-file" };
    const target = await inspectPath(file, { allowMissing: true });
    if (!target) return { ...base, reason: "canonical-file-missing" };
    if (!target.isFile() || target.size > MAX_BYTES) {
      return { ...base, status: "unreadable", reason: "not-a-bounded-regular-file" };
    }
    const { text, sha256: digest } = await readLimitedText(file, MAX_BYTES);
    base.sha256 = digest;
    let items;
    try {
      items = inventoryCodingNotes(text);
    } catch (error) {
      if (!["duplicate-note-ids", "notes-item-budget-exceeded", "unsafe-note-id"].includes(error.message)) throw error;
      return { ...base, status: "ambiguous", reason: error.message };
    }
    return { ...base, status: "processed", reason: "bounded-file-read", items };
  } catch (error) {
    if (["EACCES", "EPERM", "EISDIR", "ENOTDIR", "ELOOP"].includes(error.code) ||
      error.code === "MIGRATION_INVALID_INPUT") {
      return { ...base, status: "unreadable", reason: "unsafe-or-unreadable-input" };
    }
    throw error;
  }
}

export async function ingestCodingNotes(root, input) {
  if (input === undefined) return omittedCodingNotes();
  const absolute = path.resolve(root, requireText(input, "notes input"));
  const notes = await inspectNotes(absolute);
  const directory = await privateDirectory(root);
  await inspectPath(directory, { allowMissing: true });
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await inspectPath(directory);
  const temporary = path.join(directory, `${randomUUID()}.tmp`);
  const handle = await open(temporary, "wx", 0o600);
  try {
    try {
      // Only the private locator contains paths; neither reports nor machine state contain note text.
      await handle.writeFile(JSON.stringify({ root: await realpath(root), input: absolute }));
    } finally {
      await handle.close();
    }
    await rename(temporary, path.join(directory, `${notes.inputRef}.json`));
  } finally {
    await unlink(temporary).catch((error) => { if (error.code !== "ENOENT") throw error; });
  }
  return notes;
}

function inventoryIdentity(notes) {
  return {
    ...notes,
    items: notes.items.map(({ id, sha256: digest, startLine, endLine }) => ({ id, sha256: digest, startLine, endLine })),
  };
}

export function codingNotesInputDigest(notes) {
  validateCodingNotes(notes);
  return sha256(JSON.stringify([
    notes.status, notes.reason, notes.inputRef, notes.sha256,
    notes.provenance && [notes.provenance.inputKind, notes.provenance.resolvedRef, notes.provenance.resolution],
    notes.items.map((item) => [item.id, item.sha256, item.startLine, item.endLine]),
  ]));
}

export async function verifyCodingNotes(root, notes, { phase, status } = {}) {
  validateCodingNotes(notes, { phase, status });
  if (notes.status === "not-supplied") return;
  const directory = await privateDirectory(root);
  const locator = path.join(directory, `${notes.inputRef}.json`);
  await inspectPath(locator);
  let privateInput;
  try {
    privateInput = JSON.parse(await readFile(locator, "utf8"));
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw integrationError("Coding notes private provenance is invalid JSON");
  }
  if (!privateInput || typeof privateInput.input !== "string") throw integrationError("Coding notes private provenance is invalid");
  if (privateInput.root !== await realpath(root) || sha256(privateInput.input) !== notes.inputRef) {
    throw integrationError("Coding notes private provenance does not match this workspace/input");
  }
  const current = await inspectNotes(privateInput.input);
  if (!isDeepStrictEqual(inventoryIdentity(current), inventoryIdentity(notes))) {
    throw integrationError("Coding notes input changed; re-ingest and re-evaluate all notes before reporting");
  }
}

export function validateCodingNotes(notes, { phase, status } = {}) {
  if (!exactKeys(notes, Object.keys(OMITTED)) || notes.schemaVersion !== 1 ||
    !Array.isArray(notes.items) || notes.items.length > MAX_ITEMS) {
    throw integrationError("codingNotes ingestion evidence is required (including not-supplied)");
  }
  if (notes.status === "not-supplied") {
    if (!isDeepStrictEqual(notes, OMITTED)) throw integrationError("Coding notes omitted input cannot claim ingestion");
    return;
  }
  if (!["missing", "unreadable", "ambiguous", "processed"].includes(notes.status) ||
    !/^[a-f0-9]{64}$/.test(notes.inputRef) ||
    !["input-missing", "canonical-file-missing", "not-a-bounded-regular-file",
      "unsafe-or-unreadable-input", "duplicate-note-ids", "notes-item-budget-exceeded",
      "unsafe-note-id", "bounded-file-read"].includes(notes.reason) ||
    (notes.sha256 !== null && !/^[a-f0-9]{64}$/.test(notes.sha256)) ||
    (notes.status === "processed" && !notes.sha256) ||
    (notes.status !== "processed" && notes.items.length !== 0)) {
    throw integrationError("Coding notes input status/provenance is invalid");
  }
  if (notes.provenance !== null &&
    (!exactKeys(notes.provenance, ["inputKind", "resolvedRef", "resolution"]) ||
      !["file", "directory"].includes(notes.provenance.inputKind) ||
      !/^[a-f0-9]{64}$/.test(notes.provenance.resolvedRef) ||
      !["explicit-file", NOTES_PATH].includes(notes.provenance.resolution))) {
    throw integrationError("Coding notes resolved provenance is invalid");
  }
  const ids = new Set();
  for (const item of notes.items) {
    if (!exactKeys(item, ["id", "sha256", "startLine", "endLine", "evaluated", "disposition", "evidence", "nextAction"]) ||
      !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(item.id) || ids.has(item.id) ||
      !/^[a-f0-9]{64}$/.test(item.sha256) || !Number.isInteger(item.startLine) ||
      !Number.isInteger(item.endLine) || item.startLine < 1 || item.endLine < item.startLine ||
      typeof item.evaluated !== "boolean" || !DISPOSITIONS.has(item.disposition) ||
      !Array.isArray(item.evidence)) throw integrationError("Coding notes item identity/disposition is invalid");
    ids.add(item.id);
    safeText(item.id, "ID");
    if (!item.evaluated && (item.disposition !== "pending" || item.evidence.length)) {
      throw integrationError("Unread coding notes cannot claim a disposition or processing evidence");
    }
    if (item.evaluated && item.evidence.length === 0) throw integrationError("Evaluated coding notes require concrete evidence");
    for (const evidence of item.evidence) {
      if (!exactKeys(evidence, ["kind", "reference", "detail"]) ||
        !EVIDENCE_KINDS.has(evidence.kind)) throw integrationError("Coding notes evidence kind is invalid");
      safeText(evidence.reference, "reference");
      safeText(evidence.detail, "detail");
      if (/^(?:read|reviewed|evaluated|done|n\/a|none|pending)$/i.test(evidence.detail.trim())) {
        throw integrationError("Coding notes evidence must explain the actual disposition");
      }
    }
    if (item.disposition === "applied" && !item.evidence.some((entry) => ["source", "diff"].includes(entry.kind))) {
      throw integrationError("Applied coding notes require source/diff evidence, not just a recommendation");
    }
    if (["pending", "conflicting"].includes(item.disposition)) safeText(item.nextAction, "next action");
    else if (item.nextAction !== null) throw integrationError("Resolved coding notes must have a null nextAction");
  }
  if (["assessment", "conversion"].includes(phase) && typeof status === "string" && status.trim().toUpperCase() === "READY" &&
    (notes.status !== "processed" || notes.items.some((item) => !item.evaluated || ["pending", "conflicting"].includes(item.disposition)))) {
    throw integrationError("READY status cannot have unavailable or unresolved coding notes");
  }
}

function markdown(value) {
  return value.replace(/[\\`*_[\]<>|]/g, "\\$&");
}

export function renderCodingNotes(notes) {
  validateCodingNotes(notes);
  const lines = [
    "A checked item means read/evaluated with a recorded disposition, not implementation or runtime validation.",
    "",
    `Input status: **${notes.status}**. Reason: \`${notes.reason}\`.`,
  ];
  if (["missing", "unreadable", "ambiguous"].includes(notes.status)) {
    lines.push("Next action: supply a unique, readable notes file or correct the explicit project input, then re-ingest and evaluate; continue only independent work.");
  }
  if (notes.inputRef) lines.push(`Input reference: \`${notes.inputRef}\`. Resolution: \`${notes.provenance?.resolution ?? "unresolved"}\`.`,
    `Resolved reference: \`${notes.provenance?.resolvedRef ?? "unavailable"}\`. Input kind: \`${notes.provenance?.inputKind ?? "unresolved"}\`.`,
    `Content SHA-256: \`${notes.sha256 ?? "unavailable"}\`.`);
  if (notes.status === "processed" && !notes.items.length) lines.push("", "No nonempty notes were found in the read file.");
  for (const item of notes.items) {
    lines.push("", `- [${item.evaluated ? "x" : " "}] **${item.id}** - ${item.disposition}; notes lines ${item.startLine}-${item.endLine}; SHA-256 \`${item.sha256}\`.`);
    for (const evidence of item.evidence) lines.push(`  Evidence (${evidence.kind}): ${markdown(evidence.reference)} - ${markdown(evidence.detail)}`);
    if (item.nextAction) lines.push(`  Next action: ${markdown(item.nextAction)}`);
  }
  return lines.join("\n");
}

export async function validateCodingNotesReport(root, state, report, phase) {
  await verifyCodingNotes(root, state.codingNotes, { phase, status: state.status });
  report = report.replace(/\r\n/g, "\n");
  const matches = [...report.matchAll(/^## Coding Notes Processing\r?$/gm)];
  if (matches.length !== 1) throw integrationError("Exactly one Coding Notes Processing report section is required");
  const tail = report.slice(matches[0].index + matches[0][0].length);
  const body = tail.split(/^<a id=|^## /m)[0].replace(/^\[Back to Top\]\(#top\)\s*$/gm, "").trim();
  if (body !== renderCodingNotes(state.codingNotes)) {
    throw integrationError("Coding notes checklist does not match current machine evidence");
  }
}

if (isMain(import.meta.url)) {
  await runCli(async () => {
    const [command, root, input, ...extra] = process.argv.slice(2);
    if (!root || extra.length || !["ingest", "render"].includes(command)) {
      throw integrationError("Usage: coding-notes.mjs ingest <codebase> [notes-path] | render <state.json>");
    }
    if (command === "ingest") console.log(JSON.stringify(await ingestCodingNotes(path.resolve(root), input), null, 2));
    else {
      if (input !== undefined) throw integrationError("render accepts only a state JSON path");
      const state = JSON.parse(await readFile(root, "utf8"));
      console.log(renderCodingNotes(state.codingNotes));
    }
  });
}
