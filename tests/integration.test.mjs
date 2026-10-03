import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseArcReceipt, TRANSFER_TOPIC } from '../arc-rpc.mjs';
import { reconcile, formatAtomic, exportEvidence } from '../core.mjs';
const fixture = JSON.parse(await readFile(new URL('../fixtures/arc-mainnet-receipt.json', import.meta.url), 'utf8'));

test('public mainnet mirror fixture reaches invoice engine once, never auto-attributed', () => {
  const receipt = parseArcReceipt(fixture.receipt);
  assert.equal(receipt.transfers.length, 1);
  const transfer = receipt.transfers[0];
  const invoiceCsv = `invoice_id,sender,amount,not_before,not_after\r\nFIXTURE-ONLY,${transfer.from},1,${transfer.timestamp},${transfer.timestamp}\r\n`;
  const input = { recipient: transfer.to, chain: 5042, decimals: 18, invoiceCsv, transfers: [...receipt.transfers, ...receipt.transfers] };
  const result = reconcile(input);
  assert.equal(result.deduplication.duplicatesRemoved, 1);
  assert.equal(formatAtomic(result.totals.incomingPaymentAtomic, 18), '1');
  assert.equal(result.invoices[0].status, 'exact_candidate_unconfirmed');
  assert.equal(result.totals.confirmedAtomic, '0');
  const explicitlyAttributed = reconcile({ ...input, confirmations: { 'FIXTURE-ONLY': [transfer.eventId] } });
  assert.equal(explicitlyAttributed.invoices[0].status, 'user_confirmed_paid');
  const exported = JSON.parse(exportEvidence(result, { source: fixture.source, receipt: fixture.receipt, note: 'Synthetic invoice against public third-party fixture; not this project revenue.' }));
  assert.equal(exported.transfers.length, 1);
  assert.equal(exported.provenance.receipt.logs.filter(log => log.topics[0] === TRANSFER_TOPIC).length, 2);
});
