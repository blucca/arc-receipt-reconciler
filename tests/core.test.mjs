import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, parseInvoices, toAtomic, formatAtomic, utcTime, deduplicateTransfers, reconcile, exportEvidence } from '../core.mjs';
const recipient = `0x${'1'.repeat(40)}`, sender = `0x${'2'.repeat(40)}`, other = `0x${'3'.repeat(40)}`;
const txHash = `0x${'a'.repeat(64)}`;
const header = 'invoice_id,sender,amount,not_before,not_after';
const line = (id = 'INV-1', amount = '10', payer = sender, start = '2026-10-01T00:00:00Z', end = '2026-10-31T23:59:59Z') => `${id},${payer},${amount},${start},${end}`;
const transfer = (amount = '10000000', logIndex = 0, overrides = {}) => ({ chainId: 5042, txHash, logIndex, from: sender, to: recipient, atomicAmount: amount, decimals: 6, timestamp: '2026-10-03T12:00:00Z', ...overrides });
const run = (transfers, rows = [line()], confirmations = {}) => reconcile({ recipient, chain: 5042, decimals: 6, invoiceCsv: [header, ...rows].join('\n'), transfers, confirmations });

test('CSV supports BOM, CRLF, escaped quotes, commas and embedded newlines', () => {
  assert.deepEqual(parseCsv('\uFEFFa,b\r\n"one, two","line1\r\nline2 ""yes"""\r\n'), [['a', 'b'], ['one, two', 'line1\r\nline2 "yes"']]);
  assert.deepEqual(parseCsv('a,b\nx,'), [['a', 'b'], ['x', '']]);
});
test('CSV rejects malformed quoting, bare CR, extra columns, trailing text', () => {
  for (const csv of ['a,b\na,"unterminated', 'a,b\nfoo"bar,x', 'a,b\n"x"oops,y', 'a,b\r1,2', 'a,b\n1,2,3', 'a,b\n1']) assert.throws(() => parseCsv(csv));
});
test('invoice parser rejects duplicate headers/IDs, zero, negative and scientific values', () => {
  for (const amount of ['0', '-1', '+2', '1e3', 'NaN', '1.0000001']) assert.throws(() => parseInvoices(`${header}\n${line('A', amount)}`, 6));
  assert.throws(() => parseInvoices(`${header}\n${line()}\n${line()}`, 6), /Duplicate invoice_id/);
  assert.throws(() => parseInvoices(`${header},amount\n${line()},10`, 6), /Duplicate CSV/);
});
test('decimal conversion keeps values above JS safe integer exact', () => {
  const amount = '9007199254740993.123456789012345678';
  assert.equal(toAtomic(amount, 18), 9007199254740993123456789012345678n);
  assert.equal(formatAtomic(toAtomic(amount, 18), 18), amount);
  assert.equal(toAtomic('0001.2', 6), 1200000n);
  assert.equal(formatAtomic('1000000000000000000', 18), '1');
  assert.equal(formatAtomic('1', 18), '0.000000000000000001');
  assert.equal(toAtomic('1', 0), 1n);
});
test('UTC timestamps reject nonexistent dates, omitted zones and numeric milliseconds', () => {
  assert.equal(utcTime('2026-10-03T12:00:00Z').iso, '2026-10-03T12:00:00.000Z');
  assert.equal(utcTime(0).iso, '1970-01-01T00:00:00.000Z');
  for (const value of ['2026-02-30T12:00:00Z', '2026-10-03', '2026-10-03T12:00:00', '2026-10-03T24:00:00Z', 1791028800000]) assert.throws(() => utcTime(value));
});
test('duplicate logs removed, distinct logs in same tx preserved', () => {
  const data = [transfer(), transfer(), transfer('5000000', 1)];
  const result = deduplicateTransfers(data);
  assert.equal(result.duplicatesRemoved, 1); assert.equal(result.transfers.length, 2);
  assert.equal(run(data).totals.incomingPaymentAtomic, '15000000');
});
test('conflicting copies of same event fail closed', () => {
  assert.throws(() => deduplicateTransfers([transfer(), transfer('11000000')]), /Conflicting duplicate/);
  assert.throws(() => deduplicateTransfers([transfer(), transfer('10000000', 0, { timestamp: '2026-10-04T00:00:00Z' })]), /Conflicting duplicate/);
});
test('chain identity prevents cross-chain duplicate but reconciliation rejects mixed chain', () => {
  const data = [transfer(), transfer('10000000', 0, { chainId: 1 })];
  assert.equal(deduplicateTransfers(data).transfers.length, 2);
  assert.throws(() => run(data), /Mixed chain/);
  assert.throws(() => run([transfer('10000000', 0, { decimals: 18 })]), /Mixed chain/);
});
test('exact amount is only a candidate until explicit user confirmation', () => {
  const result = run([transfer()]);
  assert.equal(result.invoices[0].status, 'exact_candidate_unconfirmed');
  assert.equal(result.totals.confirmedAtomic, '0');
  assert.equal(result.invoices[0].outstandingAtomic, '10000000');
  const confirmed = run([transfer()], [line()], { 'INV-1': [result.transfers[0].eventId] });
  assert.equal(confirmed.invoices[0].status, 'user_confirmed_paid');
  assert.equal(confirmed.totals.confirmedAtomic, '10000000');
});
test('partial payment is not marked paid, even after confirmation', () => {
  const unconfirmed = run([transfer('4000000')]);
  assert.equal(unconfirmed.invoices[0].status, 'partial_candidates_unconfirmed');
  const result = run([transfer('4000000')], [line()], { 'INV-1': [unconfirmed.transfers[0].eventId] });
  assert.equal(result.invoices[0].status, 'user_confirmed_partial');
  assert.equal(result.invoices[0].outstandingAtomic, '6000000');
});
test('split receipts in the same tx combine only when manually selected', () => {
  const data = [transfer('4000000'), transfer('6000000', 1)], result = run(data);
  assert.equal(result.invoices[0].status, 'combined_exact_candidate_unconfirmed');
  assert.equal(run(data, [line()], { 'INV-1': result.transfers.map(item => item.eventId) }).invoices[0].status, 'user_confirmed_paid');
});
test('overpayment is explicit and outstanding never negative', () => {
  const data = [transfer('12000000')], key = run(data).transfers[0].eventId;
  const result = run(data, [line()], { 'INV-1': [key] });
  assert.equal(result.invoices[0].status, 'user_confirmed_overpaid');
  assert.equal(result.invoices[0].outstandingAtomic, '0');
  assert.equal(result.invoices[0].overpaidAtomic, '2000000');
});
test('sender, recipient and time window all constrain matching, boundaries inclusive', () => {
  for (const overrides of [{ from: other }, { to: other }, { timestamp: '2026-09-30T23:59:59Z' }, { timestamp: '2026-11-01T00:00:00Z' }]) assert.equal(run([transfer('10000000', 0, overrides)]).invoices[0].status, 'no_candidate');
  for (const timestamp of ['2026-10-01T00:00:00Z', '2026-10-31T23:59:59Z']) assert.equal(run([transfer('10000000', 0, { timestamp })]).invoices[0].status, 'exact_candidate_unconfirmed');
});
test('ambiguous invoice candidates are flagged and double allocation rejected', () => {
  const data = [transfer()], rows = [line('A'), line('B')], result = run(data, rows), key = result.transfers[0].eventId;
  assert.deepEqual(result.sharedCandidates[0].invoiceIds, ['A', 'B']);
  assert.throws(() => run(data, rows, { A: [key], B: [key] }), /already assigned/);
  const confirmed = run(data, rows, { A: [key] });
  assert.equal(confirmed.invoices[1].status, 'no_candidate');
  assert.equal(confirmed.totals.confirmedAtomic, '10000000');
});
test('cannot confirm irrelevant, unknown or repeated receipts', () => {
  const key = run([transfer()]).transfers[0].eventId;
  assert.throws(() => run([transfer()], [line()], { X: [key] }), /Unknown/);
  assert.throws(() => run([transfer()], [line()], { 'INV-1': [key, key] }), /Invalid/);
  assert.throws(() => run([transfer('10000000', 0, { from: other })], [line()], { 'INV-1': [key] }), /not eligible/);
});
test('mint/burn and zero-value transfers are evidence, not invoice income', () => {
  const result = run([transfer('10000000', 0, { from: `0x${'0'.repeat(40)}` }), transfer('0', 1)]);
  assert.equal(result.transfers.length, 2); assert.equal(result.totals.incomingPaymentAtomic, '0');
  assert.equal(result.invoices[0].status, 'no_candidate');
});
test('malformed log indexes and atomic numbers reject rounding', () => {
  for (const change of [{ logIndex: -1 }, { logIndex: 0.5 }, { atomicAmount: 10000000 }, { atomicAmount: '1e18' }, { atomicAmount: '-1' }]) assert.throws(() => run([transfer('10000000', 0, change)]));
});
test('JSON export contains exact decimal strings and attribution caveat', () => {
  const evidence = JSON.parse(exportEvidence(run([transfer()]), { source: 'synthetic test' }));
  assert.equal(evidence.transfers[0].atomicAmount, '10000000');
  assert.match(evidence.attributionNotice, /do not prove/);
  assert.equal(evidence.provenance.source, 'synthetic test');
});
test('prototype-like invoice names remain ordinary identifiers', () => {
  const initial = run([transfer()], [line('__proto__')]);
  const confirmations = Object.fromEntries([['__proto__', [initial.transfers[0].eventId]]]);
  assert.equal(run([transfer()], [line('__proto__')], confirmations).invoices[0].status, 'user_confirmed_paid');
});
