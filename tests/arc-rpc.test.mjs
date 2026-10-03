import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ARC_CHAIN_ID, ARC_SYSTEM_EMITTER, ARC_USDC_ERC20, TRANSFER_TOPIC, parseArcReceipt, createArcRpc, ArcRpcError } from '../arc-rpc.mjs';
const fixture = JSON.parse(await readFile(new URL('../fixtures/arc-mainnet-receipt.json', import.meta.url), 'utf8'));
const clone = value => JSON.parse(JSON.stringify(value));
const raw = () => clone(fixture.receipt);
const tx = fixture.receipt.transactionHash;
const block = Number(BigInt(fixture.receipt.blockNumber));
const timestamp = fixture.receipt.logs[0].blockTimestamp;
const header = { hash: fixture.receipt.blockHash, number: fixture.receipt.blockNumber, timestamp };
const failCode = code => error => error instanceof ArcRpcError && error.code === code;
function transport(overrides = {}) {
  const calls = [];
  const results = { eth_chainId: '0x13b2', eth_blockNumber: fixture.receipt.blockNumber,
    eth_getTransactionReceipt: raw(), eth_getBlockByHash: header, eth_getLogs: [raw().logs[0]], ...overrides };
  const fetchImpl = async (url, options) => {
    const request = JSON.parse(options.body); calls.push({ ...request, url, credentials: options.credentials });
    const value = results[request.method];
    return { ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: request.id, result: typeof value === 'function' ? value(request.params) : value }) };
  };
  return { fetchImpl, calls };
}

test('real mainnet receipt has one 1 USDC canonical movement, not two', () => {
  const parsed = parseArcReceipt(raw());
  assert.equal(parsed.chainId, 5042); assert.equal(parsed.transfers.length, 1);
  const t = parsed.transfers[0];
  assert.equal(t.emitter, ARC_SYSTEM_EMITTER); assert.equal(t.atomicAmount, '1000000000000000000');
  assert.equal(t.decimals, 18); assert.equal(t.kind, 'payment'); assert.equal(t.logIndex, 0);
  assert.equal(t.eventId, `5042:${tx}:0`); assert.match(t.timestamp, /Z$/);
  assert.equal(raw().logs[1].address, ARC_USDC_ERC20);
  assert.equal(BigInt(raw().logs[1].data), 1000000n);
  assert.equal(BigInt(parsed.gas.atomicAmount), BigInt(raw().gasUsed) * BigInt(raw().effectiveGasPrice));
  assert.equal(parsed.gas.payer, raw().from); assert.equal(parsed.gas.decimals, 18);
});
test('synthetic repeated equal payments remain separate by log index', () => {
  const r = raw(); const second = clone(r.logs[0]); second.logIndex = '0x3'; r.logs.push(second);
  const parsed = parseArcReceipt(r); assert.equal(parsed.transfers.length, 2);
  assert.notEqual(parsed.transfers[0].eventId, parsed.transfers[1].eventId);
  assert.equal(parsed.gas.atomicAmount, parseArcReceipt(raw()).gas.atomicAmount);
});
test('synthetic mint and burn are explicitly classified', () => {
  for (const [index, kind] of [[1, 'mint'], [2, 'burn']]) {
    const r = raw(); r.logs[0].topics[index] = '0x' + '0'.repeat(64);
    assert.equal(parseArcReceipt(r).transfers[0].kind, kind);
  }
});
test('unrelated and mirror logs never create income; reverted receipts keep gas', () => {
  const r = raw(); r.logs = r.logs.slice(1); assert.equal(parseArcReceipt(r).transfers.length, 0);
  r.status = '0x0'; r.logs = []; assert.equal(parseArcReceipt(r).transfers.length, 0);
  assert.ok(BigInt(parseArcReceipt(r).gas.atomicAmount) > 0n);
});
test('receipt parser rejects foreign chain and malformed canonical evidence', () => {
  assert.throws(() => parseArcReceipt(raw(), { chainId: 1 }), failCode('WRONG_CHAIN'));
  const corruptions = [
    r => { r.logs[0].topics[0] = null; },
    r => { r.logs[0].topics.push(TRANSFER_TOPIC); },
    r => { r.logs[0].topics[1] = '0x' + 'f'.repeat(64); },
    r => { r.logs[0].data = '0x1'; },
    r => { r.logs[0].data = '0x' + '0'.repeat(64); },
    r => { r.logs[0].topics[2] = r.logs[0].topics[1]; },
    r => { r.logs[0].removed = true; },
    r => { r.logs[0].transactionHash = '0x' + '1'.repeat(64); },
    r => { r.logs[0].blockNumber = '0x1'; },
    r => { r.logs.push(clone(r.logs[0])); },
    r => { r.status = '0x0'; },
    r => { r.gasUsed = '-1'; },
  ];
  for (const corrupt of corruptions) { const r = raw(); corrupt(r); assert.throws(() => parseArcReceipt(r), failCode('INVALID_DATA')); }
});
test('receipt adapter asserts chain, fetches only public receipt/header and caches header', async () => {
  const t = transport(), rpc = createArcRpc(t);
  const result = await rpc.getReceipt(tx); assert.equal(result.transfers.length, 1);
  assert.equal(result.transfers[0].timestamp, new Date(Number(BigInt(timestamp)) * 1000).toISOString());
  await rpc.getReceipt(tx);
  assert.equal(t.calls.filter(c => c.method === 'eth_chainId').length, 2);
  assert.equal(t.calls.filter(c => c.method === 'eth_getBlockByHash').length, 1);
  assert.ok(t.calls.every(c => c.credentials === 'omit'));
  assert.deepEqual(t.calls[0].params, []);
});
test('explicit range filters canonical emitter and recipient, deduplicates transport repeats', async () => {
  const r = raw(), recipient = '0x' + r.logs[0].topics[2].slice(-40);
  const t = transport({ eth_getLogs: [r.logs[0], clone(r.logs[0])] });
  const out = await createArcRpc(t).getTransfers({ fromBlock: block, toBlock: block, recipient });
  assert.equal(out.transfers.length, 1); assert.equal(out.receipts.length, 1); assert.equal(out.gasByTransaction.length, 1);
  const filter = t.calls.find(c => c.method === 'eth_getLogs').params[0];
  assert.equal(filter.address, ARC_SYSTEM_EMITTER); assert.equal(filter.topics[0], TRANSFER_TOPIC);
  assert.equal(filter.topics[2], r.logs[0].topics[2]);
});
test('range bounds rejected before network access', async () => {
  const t = transport(), rpc = createArcRpc(t);
  for (const range of [{}, { fromBlock: 1, toBlock: 1001 }, { fromBlock: 5, toBlock: 4 }, { fromBlock: 'latest', toBlock: 9 }])
    await assert.rejects(() => rpc.getTransfers(range), failCode('INVALID_DATA'));
  assert.equal(t.calls.length, 0);
});
test('wrong chain stops before querying receipts or logs', async () => {
  const t = transport({ eth_chainId: '0x1' });
  await assert.rejects(() => createArcRpc(t).getReceipt(tx), failCode('WRONG_CHAIN'));
  assert.equal(t.calls.length, 1);
});
test('log-filter lies, receipt mismatch and too many transactions reject', async () => {
  const mirror = raw().logs[1];
  await assert.rejects(() => createArcRpc(transport({ eth_getLogs: [mirror] })).getTransfers({ fromBlock: block, toBlock: block }), failCode('INVALID_DATA'));
  const different = raw().logs[0]; different.data = '0x' + '0'.repeat(63) + '1';
  await assert.rejects(() => createArcRpc(transport({ eth_getLogs: [different] })).getTransfers({ fromBlock: block, toBlock: block }), failCode('INVALID_DATA'));
  const other = raw().logs[0]; other.transactionHash = '0x' + '1'.repeat(64);
  await assert.rejects(() => createArcRpc({ ...transport({ eth_getLogs: [raw().logs[0], other] }), maxReceipts: 1 }).getTransfers({ fromBlock: block, toBlock: block }), failCode('TOO_MANY_RESULTS'));
});
test('null receipts and incorrect block headers are rejected', async () => {
  await assert.rejects(() => createArcRpc(transport({ eth_getTransactionReceipt: null })).getReceipt(tx), failCode('NOT_FOUND'));
  await assert.rejects(() => createArcRpc(transport({ eth_getBlockByHash: { ...header, number: '0x1' } })).getReceipt(tx), failCode('INVALID_DATA'));
});
test('HTTP/RPC/CORS-network/timeout errors are explicit and never empty success', async () => {
  const make = fetchImpl => createArcRpc({ fetchImpl, timeoutMs: 5 });
  await assert.rejects(() => make(async () => ({ ok: false, status: 429 })).getChainId(), failCode('HTTP_ERROR'));
  await assert.rejects(() => make(async (_u, o) => ({ ok: true, json: async () => ({ jsonrpc: '2.0', id: JSON.parse(o.body).id, error: { code: -32005, message: 'range limit' } }) })).getChainId(), failCode('RPC_ERROR'));
  await assert.rejects(() => make(async () => { throw new TypeError('Failed to fetch'); }).getChainId(), failCode('NETWORK_ERROR'));
  await assert.rejects(() => make((_u, o) => new Promise((_resolve, reject) => o.signal.addEventListener('abort', () => reject(new Error('aborted'))))).getChainId(), failCode('TIMEOUT'));
});
test('explicit parser timestamps require actual UTC calendar dates', () => {
  for (const timestamp of ['2026-02-30T12:00:00Z', '2026-10-03T12:00:00', '10/03/2026', '2026-10-03T24:00:00Z'])
    assert.throws(() => parseArcReceipt(raw(), { timestamp }), failCode('INVALID_DATA'));
  assert.equal(parseArcReceipt(raw(), { timestamp: '2026-10-03T12:00:00Z' }).transfers[0].timestamp, '2026-10-03T12:00:00.000Z');
});
test('validated block header is returned for offline timestamp provenance', async () => {
  const receipt = await createArcRpc(transport()).getReceipt(tx);
  assert.deepEqual(receipt.blockHeader, header);
  const range = await createArcRpc(transport()).getTransfers({ fromBlock: block, toBlock: block });
  assert.deepEqual(range.blockHeaders, [header]);
});
test('future block ranges cannot silently report an incomplete scan as complete', async () => {
  const t = transport();
  await assert.rejects(() => createArcRpc(t).getTransfers({ fromBlock: block, toBlock: block + 1 }), failCode('INVALID_DATA'));
  assert.ok(!t.calls.some(c => c.method === 'eth_getLogs'));
});
