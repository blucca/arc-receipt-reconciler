import { reconcile, exportEvidence, formatAtomic, toAtomic, address } from './core.mjs';
const CHAIN = 5042, DECIMALS = 18;
const $ = id => document.getElementById(id);
let result = null, confirmations = Object.create(null), busy = false, inputVersion = 0;
let provenance = { source: 'unverified-local-json', warning: 'No RPC verification or canonical-emitter provenance is established by pasted JSON.' };
const statusNames = {
  no_candidate: 'No candidate', exact_candidate_unconfirmed: 'Exact candidate · unconfirmed',
  multiple_exact_candidates_unconfirmed: 'Multiple exact candidates · review needed', partial_candidates_unconfirmed: 'Partial candidate(s) · unconfirmed',
  combined_exact_candidate_unconfirmed: 'Combined exact candidate · unconfirmed', allocation_required_unconfirmed: 'Select an allocation · unconfirmed',
  user_confirmed_paid: 'Paid · user-confirmed allocation', user_confirmed_partial: 'Partial · user-confirmed allocation', user_confirmed_overpaid: 'Overpaid · user-confirmed allocation',
};
function node(tag, text, className) { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; }
function message(text, error = false) { $('message').textContent = text; $('message').className = error ? 'error' : 'success'; }
function invalidate() { inputVersion++; result = null; confirmations = Object.create(null); $('results').hidden = true; $('export').disabled = true; message('Inputs changed. Reconcile again; prior allocations have been cleared.'); }
function describeSource() {
  $('provenance').textContent = provenance.source === 'synthetic-example' ? 'SYNTHETIC EXAMPLE — fabricated receipts, addresses, and invoices. Not mainnet payments or income.' : provenance.source === 'arc-mainnet-rpc' ? `Read from Arc mainnet through ${provenance.rpcUrl}. Only canonical 18-decimal system events are used. Chain data does not prove invoice ownership or finality.` : 'Imported JSON is unverified input. Only canonical system events belong in Arc input; JSON alone cannot establish token provenance.';
}
function compute(nextConfirmations = confirmations) {
  const parsed = JSON.parse($('transfers').value);
  const next = reconcile({ recipient: $('recipient').value.trim(), chain: CHAIN, decimals: DECIMALS, invoiceCsv: $('invoices').value, transfers: parsed, confirmations: nextConfirmations });
  confirmations = nextConfirmations; result = next; render(); $('export').disabled = false; return next;
}
function render() {
  $('results').hidden = false; $('totals').replaceChildren(); $('invoice-results').replaceChildren();
  for (const [label, value] of [['Incoming payments in evidence', `${formatAtomic(result.totals.incomingPaymentAtomic, DECIMALS)} USDC`], ['Explicitly allocated by you', `${formatAtomic(result.totals.confirmedAtomic, DECIMALS)} USDC`], ['Duplicate log copies removed', String(result.deduplication.duplicatesRemoved)]]) {
    const stat = node('div', undefined, 'stat'); stat.append(node('strong', value), node('span', label)); $('totals').append(stat);
  }
  $('ambiguity').hidden = !result.sharedCandidates.length;
  $('ambiguity').textContent = `${result.sharedCandidates.length} receipt(s) are candidates for more than one invoice. Confirm business attribution before allocating; the same receipt cannot be counted twice.`;
  const byId = new Map(result.transfers.map(item => [item.eventId, item]));
  for (const invoice of result.invoices) {
    const card = node('article', undefined, 'invoice'), head = node('div', undefined, 'invoice-head');
    head.append(node('h3', `${invoice.invoiceId} · ${formatAtomic(invoice.expectedAtomic, DECIMALS)} USDC`), node('span', statusNames[invoice.status], `badge${invoice.confirmedReceiptKeys.length ? ' confirmed' : ''}`)); card.append(head);
    card.append(node('p', `Sender: ${invoice.sender}`, 'mono'), node('p', `${invoice.notBefore} → ${invoice.notAfter} (inclusive)`, 'small'));
    if (invoice.memo) card.append(node('p', invoice.memo, 'small'));
    const inputs = [];
    for (const key of invoice.candidateReceiptKeys) {
      const transfer = byId.get(key), label = node('label', undefined, 'receipt'), checkbox = node('input');
      checkbox.type = 'checkbox'; checkbox.checked = invoice.confirmedReceiptKeys.includes(key); checkbox.setAttribute('aria-label', `Allocate log ${transfer.logIndex} from ${transfer.txHash} to ${invoice.invoiceId}`);
      const detail = node('div'); detail.append(node('div', `${formatAtomic(transfer.atomicAmount, DECIMALS)} USDC · log ${transfer.logIndex}`, 'amount'), node('div', transfer.timestamp, 'small'), node('code', transfer.eventId));
      label.append(checkbox, detail); card.append(label); inputs.push({ checkbox, key });
    }
    if (!invoice.candidateReceiptKeys.length) card.append(node('p', 'No unallocated receipt matches this sender, recipient, and time window.', 'small'));
    card.append(node('p', `User-confirmed: ${formatAtomic(invoice.confirmedAtomic, DECIMALS)} · Outstanding: ${formatAtomic(invoice.outstandingAtomic, DECIMALS)} · Excess: ${formatAtomic(invoice.overpaidAtomic, DECIMALS)} USDC`, 'small'));
    const actions = node('div', undefined, 'actions');
    if (inputs.length) {
      const confirm = node('button', 'Confirm selected business attribution'); confirm.type = 'button';
      confirm.addEventListener('click', () => {
        const selected = inputs.filter(item => item.checkbox.checked).map(item => item.key);
        if (!selected.length) return message('Select at least one receipt you recognize, or use Undo allocation.', true);
        try { const next = Object.assign(Object.create(null), confirmations, { [invoice.invoiceId]: selected }); compute(next); message('Allocation recorded from your explicit selection. This is your attribution, not independent proof.'); } catch (error) { message(error.message, true); }
      }); actions.append(confirm);
    }
    if (invoice.confirmedReceiptKeys.length) {
      const undo = node('button', 'Undo allocation', 'secondary'); undo.type = 'button';
      undo.addEventListener('click', () => { try { const next = Object.assign(Object.create(null), confirmations); delete next[invoice.invoiceId]; compute(next); message('Allocation removed.'); } catch (error) { message(error.message, true); } }); actions.append(undo);
    }
    card.append(actions); $('invoice-results').append(card);
  }
  $('audit').textContent = JSON.stringify({ deduplication: result.deduplication, unallocatedIncomingReceiptKeys: result.unallocatedIncomingReceiptKeys, excludedFromInvoiceIncome: result.transfers.filter(item => item.to !== result.recipient || item.kind !== 'payment' || item.atomicAmount === '0').map(item => ({ eventId: item.eventId, reason: item.to !== result.recipient ? 'different recipient' : item.kind !== 'payment' ? item.kind : 'zero value' })), gasByTransaction: provenance.gasByTransaction || [], gasNote: 'Gas is a separate transaction expense; never subtracted from Transfer amounts or counted once per log. A fetched transaction may have been paid by another sender.' }, null, 2);
}
function loadSample() {
  const recipient = `0x${'1'.repeat(40)}`, senders = ['2', '3', '4'].map(char => `0x${char.repeat(40)}`);
  $('recipient').value = recipient;
  $('invoices').value = 'invoice_id,sender,amount,not_before,not_after,memo\r\n' + [['INV-001', senders[0], '30', 'Split payment; two logs in one transaction'], ['INV-002', senders[1], '40', 'Only 15 received; remains partial'], ['INV-003', senders[2], '7.5', 'Exact candidate; needs your attribution']].map(([id, sender, amount, memo]) => `${id},${sender},${amount},2026-10-01T00:00:00Z,2026-10-31T23:59:59Z,"${memo}"`).join('\r\n');
  const transfer = (from, amount, tx, logIndex, to = recipient) => ({ chainId: CHAIN, txHash: `0x${tx.repeat(64)}`, logIndex, from, to, atomicAmount: toAtomic(amount, DECIMALS).toString(), decimals: DECIMALS, timestamp: '2026-10-03T12:00:00Z' });
  const first = transfer(senders[0], '12', 'a', 10);
  $('transfers').value = JSON.stringify([first, first, transfer(senders[0], '18', 'a', 11), transfer(senders[0], '99', 'a', 12, `0x${'5'.repeat(40)}`), transfer(senders[1], '15', 'b', 0), transfer(senders[2], '7.5', 'c', 3)], null, 2);
  provenance = { source: 'synthetic-example', warning: 'Fabricated data for testing. No real transaction, earned revenue, or mainnet deployment is implied.' };
  invalidate(); describeSource(); compute(); message('Synthetic example loaded: one duplicate copy, two distinct payment logs in one transaction, and a partial invoice. Nothing is auto-confirmed.');
}
async function fetchEvidence(mode) {
  if (busy) return; const startingVersion = inputVersion; busy = true; $('fetch-tx').disabled = true; $('fetch-range').disabled = true;
  try {
    const recipient = address($('recipient').value.trim()), rpcUrl = $('rpc').value;
    const { createArcRpc } = await import('./arc-rpc.mjs');
    const rpc = createArcRpc({ url: rpcUrl });
    message('Reading public Arc data… Your invoice CSV stays local.');
    let transfers, rawReceipts, blockHeaders, gasByTransaction, request;
    if (mode === 'transaction') {
      const txHash = $('tx-hash').value.trim();
      const receipt = await rpc.getReceipt(txHash);
      transfers = receipt.transfers; rawReceipts = [receipt.rawReceipt]; blockHeaders = [receipt.blockHeader]; gasByTransaction = [receipt.gas]; request = { txHash };
    } else {
      const rawFrom = $('from-block').value.trim(), rawTo = $('to-block').value.trim();
      if (!/^\d+$/.test(rawFrom) || !/^\d+$/.test(rawTo)) throw new Error('Enter explicit nonnegative integer block numbers.');
      const fromBlock = Number(rawFrom), toBlock = Number(rawTo);
      const fetched = await rpc.getTransfers({ fromBlock, toBlock, recipient });
      transfers = fetched.transfers; rawReceipts = fetched.receipts; blockHeaders = fetched.blockHeaders; gasByTransaction = fetched.gasByTransaction; request = { fromBlock, toBlock, recipient };
    }
    if (startingVersion !== inputVersion) { message('Inputs changed while reading; stale RPC response discarded.'); return; }
    $('transfers').value = JSON.stringify(transfers, null, 2);
    provenance = { source: 'arc-mainnet-rpc', rpcUrl, fetchedAt: new Date().toISOString(), request, canonicalEmitter: '0xfffffffffffffffffffffffffffffffffffffffe', canonicalDecimals: DECIMALS, rawReceipts, blockHeaders, gasByTransaction, finality: 'Not independently verified; RPC observation only.' };
    invalidate(); describeSource(); message(`Fetched ${transfers.length} canonical transfer log(s). Click Reconcile locally to match invoices.`);
  } catch (error) { message(`RPC read failed: ${error.message}. No prior evidence was replaced.`, true); }
  finally { busy = false; $('fetch-tx').disabled = false; $('fetch-range').disabled = false; }
}

async function loadPublicSample() {
  if (busy) return;
  const version = inputVersion;
  try {
    const response = await fetch('./fixtures/arc-mainnet-receipt.json');
    if (!response.ok) throw new Error('Public fixture could not be read');
    const fixture = await response.json();
    if (version !== inputVersion) return;
    const log = fixture.receipt.logs.find(item => item.address.toLowerCase() === '0xfffffffffffffffffffffffffffffffffffffffe');
    if (!log) throw new Error('Public fixture has no canonical event');
    const sender = '0x' + log.topics[1].slice(-40), recipient = '0x' + log.topics[2].slice(-40);
    const time = Number(BigInt(log.blockTimestamp)) * 1000;
    const start = new Date(time - 86400000).toISOString(), end = new Date(time + 86400000).toISOString();
    $('recipient').value = recipient;
    $('invoices').value = `invoice_id,sender,amount,not_before,not_after,memo\nPUBLIC-REPLAY,${sender},${formatAtomic(log.data ? BigInt(log.data) : 0n, DECIMALS)},${start},${end},Illustrative invoice for a real third-party payment - NOT project revenue`;
    $('transfers').value = '[]';
    $('tx-hash').value = fixture.receipt.transactionHash;
    $('rpc').value = fixture.source;
    $('rpc-options').open = true;
    provenance = { source: 'unverified-local-json', warning: 'Illustrative invoice for a public third-party payment, not project income.' };
    invalidate(); describeSource();
    await fetchEvidence('transaction');
    if (provenance.source === 'arc-mainnet-rpc' && provenance.request.txHash === fixture.receipt.transactionHash) {
      provenance.example = 'Real third-party mainnet receipt; illustrative invoice; NOT project revenue.';
      compute();
      message('Public mainnet replay: one real third-party USDC payment, one excluded mirror. The illustrative invoice remains unconfirmed; this is NOT project revenue.');
    }
  } catch (error) { message(`Public replay failed: ${error.message}`, true); }
}
$('public-sample').addEventListener('click', loadPublicSample);

$('sample').addEventListener('click', () => { try { loadSample(); } catch (error) { message(error.message, true); } });
$('reconcile').addEventListener('click', () => { try { compute(); message('Reconciled locally. Candidate matches remain unconfirmed until you explicitly allocate receipts.'); } catch (error) { result = null; $('results').hidden = true; $('export').disabled = true; message(error.message, true); } });
for (const id of ['recipient', 'invoices', 'transfers']) $(id).addEventListener('input', () => { invalidate(); if (id === 'transfers') { provenance = { source: 'unverified-local-json', warning: 'Manually edited JSON; no verified emitter provenance.' }; describeSource(); } });
$('invoice-file').addEventListener('change', async event => { const file = event.target.files[0]; if (!file) return; const startingVersion = ++inputVersion; try { if (file.size > 2_000_000) throw new Error('CSV limit is 2 MB for this prototype.'); const text = await file.text(); if (startingVersion !== inputVersion) { message('Inputs changed while reading the file; stale CSV discarded.'); return; } $('invoices').value = text; invalidate(); message('CSV read locally. No upload was made.'); } catch (error) { message(error.message, true); } });
for (const id of ['rpc', 'tx-hash', 'from-block', 'to-block']) $(id).addEventListener('input', () => { inputVersion++; });
$('fetch-tx').addEventListener('click', () => fetchEvidence('transaction'));
$('fetch-range').addEventListener('click', () => fetchEvidence('range'));
$('export').addEventListener('click', () => { if (!result) return; const blob = new Blob([exportEvidence(result, provenance)], { type: 'application/json' }); const url = URL.createObjectURL(blob), link = node('a'); link.href = url; link.download = 'arc-reconciliation-evidence.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); message('Evidence exported. It includes invoice data and public receipt evidence; store or share it deliberately.'); });
$('clear').addEventListener('click', () => { for (const id of ['recipient', 'invoices', 'transfers', 'tx-hash', 'from-block', 'to-block', 'invoice-file']) $(id).value = ''; provenance = { source: 'unverified-local-json' }; invalidate(); describeSource(); message('All current inputs and allocations cleared. Nothing was persisted in browser storage.'); });
