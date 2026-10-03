// Original implementation, developed with autonomous Codex / GPT-6 Astra.
// All monetary arithmetic is integer BigInt. Exported evidence uses decimal strings.
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const ZERO = `0x${'0'.repeat(40)}`;
function invariant(ok, message) { if (!ok) throw new Error(message); }
export function address(value) {
  invariant(typeof value === 'string' && ADDRESS.test(value), 'Expected a 20-byte 0x address');
  return value.toLowerCase();
}
export function chainId(value) {
  invariant((typeof value === 'string' && /^[1-9]\d*$/.test(value)) || (Number.isSafeInteger(value) && value > 0), 'Invalid chainId');
  return BigInt(value).toString();
}
export function decimalPlaces(value) {
  invariant(Number.isInteger(value) && value >= 0 && value <= 255, 'decimals must be an integer from 0 to 255');
  return value;
}
export function toAtomic(value, decimals) {
  decimalPlaces(decimals);
  invariant(typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value), 'Amount must be an unsigned plain decimal string');
  const [whole, fraction = ''] = value.split('.');
  invariant(fraction.length <= decimals, `Amount exceeds ${decimals} decimal places`);
  invariant(whole.length + fraction.length <= 512, 'Amount is too long');
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0');
}
export function formatAtomic(value, decimals) {
  decimalPlaces(decimals);
  invariant(typeof value === 'bigint' || (typeof value === 'string' && /^\d+$/.test(value)), 'Invalid atomic amount');
  const amount = BigInt(value);
  invariant(amount >= 0n, 'Atomic amount must not be negative');
  if (!decimals) return amount.toString();
  const digits = amount.toString().padStart(decimals + 1, '0');
  const fraction = digits.slice(-decimals).replace(/0+$/, '');
  return digits.slice(0, -decimals) + (fraction ? `.${fraction}` : '');
}
export function utcTime(value) {
  let milliseconds;
  if (typeof value === 'number') {
    invariant(Number.isSafeInteger(value) && value >= 0, 'Unix timestamp must be nonnegative integer seconds');
    milliseconds = value * 1000;
  } else {
    invariant(typeof value === 'string', 'Timestamp must be Unix seconds or UTC ISO text');
    const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/.exec(value);
    invariant(match, 'Use a complete UTC timestamp, e.g. 2026-10-03T12:00:00Z');
    const canonical = `${match[1]}.${(match[2] || '').padEnd(3, '0')}Z`;
    milliseconds = Date.parse(canonical);
    invariant(Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === canonical, 'Invalid calendar timestamp');
  }
  invariant(Number.isSafeInteger(milliseconds) && milliseconds >= 0 && milliseconds <= 253402300799999, 'Timestamp outside supported range');
  return { milliseconds, iso: new Date(milliseconds).toISOString() };
}

// RFC-4180 quoting, CRLF and LF records; reject bare CR, quotes in bare fields,
// text after closing quotes, unterminated quotes, and inconsistent row widths.
export function parseCsv(text) {
  invariant(typeof text === 'string', 'CSV must be text');
  text = text.replace(/^\uFEFF/, '');
  if (!text.length) return [];
  let state = 'start', field = '', row = [], records = [], endedRecord = false;
  const finishField = () => { row.push(field); field = ''; state = 'start'; };
  const finishRow = () => { finishField(); records.push(row); row = []; endedRecord = true; };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (state === 'quoted') {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else state = 'after';
      } else field += char;
      endedRecord = false;
      continue;
    }
    if (char === ',') { finishField(); endedRecord = false; continue; }
    if (char === '\n' || char === '\r') {
      if (char === '\r') { invariant(text[i + 1] === '\n', 'Bare CR outside quoted field'); i++; }
      finishRow(); continue;
    }
    invariant(state !== 'after', 'Unexpected text after a closing CSV quote');
    if (char === '"') {
      invariant(state === 'start', 'Quote inside an unquoted CSV field');
      state = 'quoted';
    } else { field += char; state = 'bare'; }
    endedRecord = false;
  }
  invariant(state !== 'quoted', 'Unterminated quoted CSV field');
  if (!endedRecord) finishRow();
  const width = records[0].length;
  records.forEach((record, i) => invariant(record.length === width, `CSV row ${i + 1} has ${record.length} columns; expected ${width}`));
  return records;
}

export function parseInvoices(csvText, decimals) {
  const records = parseCsv(csvText);
  invariant(records.length >= 2, 'CSV needs a header and at least one invoice');
  const headers = records[0];
  const required = ['invoice_id', 'sender', 'amount', 'not_before', 'not_after'];
  invariant(new Set(headers).size === headers.length, 'Duplicate CSV column');
  invariant(required.every(name => headers.includes(name)) && headers.every(name => [...required, 'memo'].includes(name)), `CSV columns: ${required.join(',')} (optional: memo)`);
  const seen = new Set();
  return records.slice(1).map((row, index) => {
    const item = Object.fromEntries(headers.map((name, i) => [name, row[i]]));
    const id = item.invoice_id.trim();
    invariant(id && id.length <= 100 && !/[\x00-\x1f\x7f]/.test(id), `Invalid invoice_id on row ${index + 2}`);
    invariant(!seen.has(id), `Duplicate invoice_id: ${id}`); seen.add(id);
    const sender = address(item.sender.trim());
    invariant(sender !== ZERO, 'Invoice sender cannot be the mint/burn zero address');
    const expectedAtomic = toAtomic(item.amount.trim(), decimals);
    invariant(expectedAtomic > 0n, `Invoice ${id} amount must be greater than zero`);
    const notBefore = utcTime(item.not_before.trim()), notAfter = utcTime(item.not_after.trim());
    invariant(notBefore.milliseconds <= notAfter.milliseconds, `Invoice ${id} has reversed time window`);
    return { invoiceId: id, sender, expectedAtomic: expectedAtomic.toString(), decimals, notBefore: notBefore.iso, notAfter: notAfter.iso, memo: item.memo || '' };
  });
}

export function normalizeTransfer(input) {
  invariant(input && typeof input === 'object' && !Array.isArray(input), 'Invalid transfer object');
  const id = chainId(input.chainId);
  const txHash = input.txHash ?? input.transactionHash;
  invariant(typeof txHash === 'string' && HASH.test(txHash), 'Invalid transaction hash');
  invariant(Number.isSafeInteger(input.logIndex) && input.logIndex >= 0, 'logIndex must be a nonnegative safe integer');
  invariant(typeof input.atomicAmount === 'string' && /^\d+$/.test(input.atomicAmount) && input.atomicAmount.length <= 512, 'atomicAmount must be a nonnegative integer string');
  const from = address(input.from), to = address(input.to), timestamp = utcTime(input.timestamp).iso;
  const kind = from === ZERO ? 'mint' : to === ZERO ? 'burn' : 'payment';
  const normalized = { chainId: id, txHash: txHash.toLowerCase(), logIndex: input.logIndex, from, to, atomicAmount: BigInt(input.atomicAmount).toString(), decimals: decimalPlaces(input.decimals), timestamp, kind };
  normalized.eventId = `${id}:${normalized.txHash}:${normalized.logIndex}`;
  return normalized;
}
export function deduplicateTransfers(input) {
  invariant(Array.isArray(input), 'Transfers JSON must be an array');
  const seen = new Map(); let duplicatesRemoved = 0;
  for (const raw of input) {
    const transfer = normalizeTransfer(raw), prior = seen.get(transfer.eventId);
    if (prior) {
      invariant(JSON.stringify(prior) === JSON.stringify(transfer), `Conflicting duplicate event: ${transfer.eventId}`);
      duplicatesRemoved++;
    } else seen.set(transfer.eventId, transfer);
  }
  return { transfers: [...seen.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.txHash.localeCompare(b.txHash) || a.logIndex - b.logIndex), duplicatesRemoved };
}

export function reconcile({ recipient, chain, decimals, invoiceCsv, transfers, confirmations = {} }) {
  recipient = address(recipient); chain = chainId(chain); decimalPlaces(decimals);
  invariant(recipient !== ZERO, 'Recipient cannot be the zero address');
  const invoices = parseInvoices(invoiceCsv, decimals);
  const deduped = deduplicateTransfers(transfers);
  deduped.transfers.forEach(transfer => invariant(transfer.chainId === chain && transfer.decimals === decimals, `Mixed chain or decimals for ${transfer.eventId}`));
  const relevant = deduped.transfers.filter(transfer => transfer.to === recipient && transfer.kind === 'payment' && BigInt(transfer.atomicAmount) > 0n);
  const eligible = invoice => relevant.filter(transfer => transfer.from === invoice.sender && transfer.timestamp >= invoice.notBefore && transfer.timestamp <= invoice.notAfter);
  invariant(confirmations && typeof confirmations === 'object' && !Array.isArray(confirmations), 'Invalid confirmations');
  const assigned = new Map(), normalizedConfirmations = Object.create(null);
  for (const [invoiceId, keys] of Object.entries(confirmations)) {
    const invoice = invoices.find(item => item.invoiceId === invoiceId);
    invariant(invoice, `Unknown confirmed invoice: ${invoiceId}`);
    invariant(Array.isArray(keys) && keys.length && new Set(keys).size === keys.length, `Invalid receipt selection for ${invoiceId}`);
    const available = new Set(eligible(invoice).map(item => item.eventId));
    for (const key of keys) {
      invariant(available.has(key), `Receipt is not eligible for invoice ${invoiceId}: ${key}`);
      invariant(!assigned.has(key), `Receipt already assigned to invoice ${assigned.get(key)}: ${key}`);
      assigned.set(key, invoiceId);
    }
    normalizedConfirmations[invoiceId] = [...keys].sort();
  }
  const results = invoices.map(invoice => {
    const candidates = eligible(invoice).filter(transfer => !assigned.has(transfer.eventId) || assigned.get(transfer.eventId) === invoice.invoiceId);
    const expected = BigInt(invoice.expectedAtomic), exact = candidates.filter(transfer => BigInt(transfer.atomicAmount) === expected);
    const selected = new Set(normalizedConfirmations[invoice.invoiceId] || []);
    const confirmed = candidates.filter(transfer => selected.has(transfer.eventId));
    const confirmedTotal = confirmed.reduce((sum, transfer) => sum + BigInt(transfer.atomicAmount), 0n);
    const candidateTotal = candidates.reduce((sum, transfer) => sum + BigInt(transfer.atomicAmount), 0n);
    let status;
    if (confirmed.length) status = confirmedTotal === expected ? 'user_confirmed_paid' : confirmedTotal < expected ? 'user_confirmed_partial' : 'user_confirmed_overpaid';
    else if (!candidates.length) status = 'no_candidate';
    else if (exact.length) status = exact.length === 1 ? 'exact_candidate_unconfirmed' : 'multiple_exact_candidates_unconfirmed';
    else if (candidateTotal < expected) status = 'partial_candidates_unconfirmed';
    else if (candidateTotal === expected) status = 'combined_exact_candidate_unconfirmed';
    else status = 'allocation_required_unconfirmed';
    return { ...invoice, status, candidateReceiptKeys: candidates.map(item => item.eventId), exactReceiptKeys: exact.map(item => item.eventId), confirmedReceiptKeys: [...selected], confirmedAtomic: confirmedTotal.toString(), outstandingAtomic: (confirmedTotal < expected ? expected - confirmedTotal : 0n).toString(), overpaidAtomic: (confirmedTotal > expected ? confirmedTotal - expected : 0n).toString() };
  });
  const candidateOwners = new Map();
  for (const result of results) for (const key of result.candidateReceiptKeys) candidateOwners.set(key, [...(candidateOwners.get(key) || []), result.invoiceId]);
  return {
    schemaVersion: '1.0', recipient, chainId: chain, decimals,
    attributionNotice: 'Candidate matches do not prove business attribution. Confirmed statuses record the user\'s explicit allocation; they are not independent proof of invoice ownership or chain finality.',
    deduplication: { key: 'chainId:txHash:logIndex', inputCount: transfers.length, uniqueCount: deduped.transfers.length, duplicatesRemoved: deduped.duplicatesRemoved },
    totals: { incomingPaymentAtomic: relevant.reduce((sum, item) => sum + BigInt(item.atomicAmount), 0n).toString(), confirmedAtomic: relevant.filter(item => assigned.has(item.eventId)).reduce((sum, item) => sum + BigInt(item.atomicAmount), 0n).toString() },
    invoices: results, transfers: deduped.transfers, confirmations: normalizedConfirmations,
    sharedCandidates: [...candidateOwners].filter(([, owners]) => owners.length > 1).map(([eventId, invoiceIds]) => ({ eventId, invoiceIds })),
    unallocatedIncomingReceiptKeys: relevant.filter(item => !assigned.has(item.eventId)).map(item => item.eventId),
  };
}
export function exportEvidence(result, provenance = {}) {
  return JSON.stringify({ exportedAt: new Date().toISOString(), ...result, provenance }, null, 2);
}
