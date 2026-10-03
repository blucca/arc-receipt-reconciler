/** Read-only Arc mainnet adapter. No signer, wallet connection or transactions.
 * Canonical event/decimals: https://docs.arc.io/arc/references/usdc-system-events.md
 * Network: https://docs.arc.io/arc/references/connect-to-arc.md
 * Gas fees are per transaction, never deducted from every receipt allocation.
 * Mainnet has used the EIP-7708 system emitter since genesis. ERC20 mirrors
 * at 0x3600... use 6 decimals and MUST NOT be added to the canonical stream.
 */
export const ARC_CHAIN_ID = 5042;
export const ARC_SYSTEM_EMITTER = '0xfffffffffffffffffffffffffffffffffffffffe';
export const ARC_USDC_ERC20 = '0x3600000000000000000000000000000000000000';
export const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
export const DEFAULT_RPC_URL = 'https://rpc.blockdaemon.mainnet.arc.io';
const ZERO = '0x' + '0'.repeat(40);
const HASH = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const QUANTITY = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/;

export class ArcRpcError extends Error {
  constructor(code, message, details) {
    super(message); this.name = 'ArcRpcError'; this.code = code;
    if (details !== undefined) this.details = details;
  }
}
function fail(message) { throw new ArcRpcError('INVALID_DATA', message); }
function hash(value, label) {
  if (typeof value !== 'string' || !HASH.test(value)) fail(`Invalid ${label}`);
  return value.toLowerCase();
}
function address(value, label) {
  if (typeof value !== 'string' || !ADDRESS.test(value)) fail(`Invalid ${label}`);
  return value.toLowerCase();
}
function quantity(value, label) {
  if (typeof value !== 'string' || !QUANTITY.test(value)) fail(`Invalid ${label}`);
  return BigInt(value);
}
function numberQuantity(value, label) {
  const n = quantity(value, label);
  if (n > BigInt(Number.MAX_SAFE_INTEGER)) fail(`${label} exceeds safe integer range`);
  return Number(n);
}
function blockInput(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) fail(`${label} must be an explicit nonnegative integer`);
  return value;
}
function topicAddress(value) {
  if (typeof value !== 'string' || !/^0x0{24}[0-9a-fA-F]{40}$/.test(value)) fail('Invalid indexed address topic');
  return '0x' + value.slice(-40).toLowerCase();
}
function isoTimestamp(seconds) {
  const n = typeof seconds === 'string' ? numberQuantity(seconds, 'block timestamp') : seconds;
  if (!Number.isSafeInteger(n) || n < 0 || n > 8640000000000) fail('Invalid block timestamp');
  return new Date(n * 1000).toISOString();
}

/** Parses a receipt supplied as Arc data. A raw receipt alone cannot prove its
 * chain; use createArcRpc() for live chain-ID verification. Unknown emitters and
 * ERC20 mirrors are excluded. Failed receipts have no credited transfers. */
export function parseArcReceipt(receipt, { chainId = ARC_CHAIN_ID, timestamp } = {}) {
  if (Number(chainId) !== ARC_CHAIN_ID) throw new ArcRpcError('WRONG_CHAIN', 'Arc mainnet chain ID must be 5042');
  if (!receipt || typeof receipt !== 'object') fail('Receipt is missing');
  const txHash = hash(receipt.transactionHash, 'transaction hash');
  const blockHash = hash(receipt.blockHash, 'block hash');
  const blockNumber = numberQuantity(receipt.blockNumber, 'block number');
  const txIndex = numberQuantity(receipt.transactionIndex, 'transaction index');
  const status = numberQuantity(receipt.status, 'receipt status');
  if (status !== 0 && status !== 1) fail('Receipt status must be 0 or 1');
  if (!Array.isArray(receipt.logs)) fail('Receipt logs must be an array');
  const payer = address(receipt.from, 'transaction sender');
  const gasUsed = quantity(receipt.gasUsed, 'gasUsed');
  const effectiveGasPrice = quantity(receipt.effectiveGasPrice, 'effectiveGasPrice');
  const gas = { chainId: ARC_CHAIN_ID, txHash, payer, gasUsed: gasUsed.toString(),
    effectiveGasPrice: effectiveGasPrice.toString(), atomicAmount: (gasUsed * effectiveGasPrice).toString(), decimals: 18 };
  const transfers = [];
  const seen = new Set();
  for (const log of receipt.logs) {
    if (typeof log?.address !== 'string' || log.address.toLowerCase() !== ARC_SYSTEM_EMITTER) continue;
    if (status === 0) fail('Failed receipt contains canonical transfer logs');
    if (!Array.isArray(log.topics) || log.topics.length !== 3 || typeof log.topics[0] !== 'string' || log.topics[0].toLowerCase() !== TRANSFER_TOPIC) fail('Invalid canonical Transfer topics');
    if (log.removed !== false) fail('Removed or unconfirmed canonical log');
    if (hash(log.transactionHash, 'log transaction hash') !== txHash || hash(log.blockHash, 'log block hash') !== blockHash ||
        numberQuantity(log.blockNumber, 'log block number') !== blockNumber || numberQuantity(log.transactionIndex, 'log transaction index') !== txIndex) fail('Log does not belong to this receipt');
    if (typeof log.data !== 'string' || !HASH.test(log.data)) fail('Transfer amount must be a 32-byte uint256');
    const from = topicAddress(log.topics[1]), to = topicAddress(log.topics[2]);
    const amount = BigInt(log.data);
    if (amount === 0n || from === to) fail('Arc system stream cannot contain zero-value or self transfers');
    const logIndex = numberQuantity(log.logIndex, 'log index');
    const eventId = `${ARC_CHAIN_ID}:${txHash}:${logIndex}`;
    if (seen.has(eventId)) fail('Duplicate canonical event in receipt');
    seen.add(eventId);
    const item = { chainId: ARC_CHAIN_ID, eventId, txHash, transactionHash: txHash,
      logIndex, blockNumber, blockHash, transactionIndex: txIndex, emitter: ARC_SYSTEM_EMITTER,
      from, to, atomicAmount: amount.toString(), decimals: 18,
      kind: from === ZERO ? 'mint' : to === ZERO ? 'burn' : 'payment' };
    if (timestamp !== undefined) {
      if (typeof timestamp !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(timestamp) || !Number.isFinite(Date.parse(timestamp))) fail('Timestamp must be a real UTC ISO date');
      const normalized = new Date(timestamp).toISOString();
      if ((timestamp.includes('.') ? normalized : normalized.replace('.000Z', 'Z')) !== timestamp) fail('Timestamp contains an invalid calendar date');
      item.timestamp = normalized;
    } else if (log.blockTimestamp !== undefined) item.timestamp = isoTimestamp(log.blockTimestamp);
    transfers.push(item);
  }
  transfers.sort((a, b) => a.logIndex - b.logIndex);
  return { chainId: ARC_CHAIN_ID, txHash, transactionHash: txHash, blockHash, blockNumber,
    status, transfers, gas, rawReceipt: receipt };
}

/** Browser fetch sees only public hashes, addresses and block ranges. Invoice
 * content is never passed here. Fetch errors can be CORS, network or URL errors;
 * browsers do not expose enough detail to distinguish these reliably. */
export function createArcRpc({ url = DEFAULT_RPC_URL, fetchImpl = globalThis.fetch,
  timeoutMs = 15000, maxBlockSpan = 1000, maxReceipts = 100 } = {}) {
  const endpoint = new URL(url);
  if (!['https:', 'http:'].includes(endpoint.protocol) || endpoint.username || endpoint.password) fail('RPC URL must be HTTP(S) without embedded credentials');
  if (typeof fetchImpl !== 'function') fail('fetch is unavailable');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || !Number.isSafeInteger(maxBlockSpan) || maxBlockSpan < 1 || maxBlockSpan > 1000 || !Number.isSafeInteger(maxReceipts) || maxReceipts < 1 || maxReceipts > 100) fail('Invalid RPC bounds');
  let requestId = 0;
  const blocks = new Map();
  async function call(method, params) {
    const id = ++requestId, controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(endpoint.href, { method: 'POST', credentials: 'omit',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }), signal: controller.signal });
      if (!response.ok) throw new ArcRpcError('HTTP_ERROR', `RPC returned HTTP ${response.status}`);
      const body = await response.json();
      if (!body || body.jsonrpc !== '2.0' || body.id !== id) fail('Invalid JSON-RPC response envelope');
      if (body.error) throw new ArcRpcError('RPC_ERROR', String(body.error.message || 'RPC request failed'), { rpcCode: body.error.code });
      if (!Object.hasOwn(body, 'result')) fail('RPC response has no result');
      return body.result;
    } catch (error) {
      if (error instanceof ArcRpcError) throw error;
      throw new ArcRpcError(controller.signal.aborted ? 'TIMEOUT' : 'NETWORK_ERROR', controller.signal.aborted ? 'RPC request timed out' : 'RPC fetch failed; check network, URL and browser CORS policy');
    } finally { clearTimeout(timer); }
  }
  async function getChainId() {
    const id = numberQuantity(await call('eth_chainId', []), 'chain ID');
    if (id !== ARC_CHAIN_ID) throw new ArcRpcError('WRONG_CHAIN', `Expected Arc mainnet 5042; RPC returned ${id}`);
    return id;
  }
  async function timestampFor(receipt) {
    const key = hash(receipt.blockHash, 'block hash');
    if (!blocks.has(key)) {
      const block = await call('eth_getBlockByHash', [key, false]);
      if (!block || hash(block.hash, 'returned block hash') !== key || numberQuantity(block.number, 'returned block number') !== numberQuantity(receipt.blockNumber, 'receipt block number')) fail('Block header does not match receipt');
      const timestamp = isoTimestamp(block.timestamp);
      if (blocks.size >= 200) blocks.delete(blocks.keys().next().value);
      blocks.set(key, { timestamp, blockNumber: numberQuantity(block.number, 'block number'), blockHeader: { hash: block.hash, number: block.number, timestamp: block.timestamp } });
    }
    const cached = blocks.get(key);
    if (cached.blockNumber !== numberQuantity(receipt.blockNumber, 'receipt block number')) fail('Cached block header does not match receipt');
    return cached;
  }
  async function readReceipt(txHash) {
    const raw = await call('eth_getTransactionReceipt', [txHash]);
    if (raw === null) throw new ArcRpcError('NOT_FOUND', 'Receipt is unavailable or transaction is pending');
    if (hash(raw.transactionHash, 'receipt transaction hash') !== txHash) fail('RPC returned a different transaction');
    const parsed = parseArcReceipt(raw);
    const validatedBlock = await timestampFor(raw);
    for (const transfer of parsed.transfers) transfer.timestamp = validatedBlock.timestamp;
    parsed.blockHeader = { ...validatedBlock.blockHeader };
    return parsed;
  }
  async function getReceipt(txHash) { txHash = hash(txHash, 'transaction hash'); await getChainId(); return readReceipt(txHash); }
  async function getBlockNumber() { await getChainId(); return numberQuantity(await call('eth_blockNumber', []), 'head block number'); }
  async function getTransfers({ fromBlock, toBlock, recipient } = {}) {
    blockInput(fromBlock, 'fromBlock'); blockInput(toBlock, 'toBlock');
    if (toBlock < fromBlock || toBlock - fromBlock + 1 > maxBlockSpan) fail(`Use an ordered explicit range of at most ${maxBlockSpan} blocks`);
    const to = recipient === undefined || recipient === '' ? undefined : address(recipient, 'recipient');
    await getChainId();
    const observedHeadBlock = numberQuantity(await call('eth_blockNumber', []), 'head block number');
    if (toBlock > observedHeadBlock) fail('toBlock exceeds the observed mainnet head');
    const topics = to ? [TRANSFER_TOPIC, null, '0x' + to.slice(2).padStart(64, '0')] : [TRANSFER_TOPIC];
    const logs = await call('eth_getLogs', [{ address: ARC_SYSTEM_EMITTER, fromBlock: '0x' + fromBlock.toString(16), toBlock: '0x' + toBlock.toString(16), topics }]);
    if (!Array.isArray(logs)) fail('RPC log result must be an array');
    if (logs.length > 10000) throw new ArcRpcError('TOO_MANY_RESULTS', 'More than 10,000 logs; use a narrower range or recipient');
    const unique = new Map();
    for (const log of logs) {
      if (typeof log?.address !== 'string' || log.address.toLowerCase() !== ARC_SYSTEM_EMITTER) fail('RPC returned logs outside the canonical emitter filter');
      const block = numberQuantity(log.blockNumber, 'log block number');
      if (block < fromBlock || block > toBlock) fail('RPC returned a log outside the requested range');
      const tx = hash(log.transactionHash, 'transaction hash'), index = numberQuantity(log.logIndex, 'log index');
      const key = `${tx}:${index}`;
      if (unique.has(key) && JSON.stringify(unique.get(key)) !== JSON.stringify(log)) fail('Conflicting duplicate log in RPC response');
      unique.set(key, log);
    }
    const txs = [...new Set([...unique.values()].map(log => log.transactionHash.toLowerCase()))];
    if (txs.length > maxReceipts) throw new ArcRpcError('TOO_MANY_RESULTS', `More than ${maxReceipts} transactions; narrow the range or recipient`);
    const transfers = [], receipts = [], gasByTransaction = [], blockHeaders = new Map();
    for (const tx of txs) {
      const parsed = await readReceipt(tx);
      receipts.push(parsed.rawReceipt); gasByTransaction.push(parsed.gas);
      blockHeaders.set(parsed.blockHash, parsed.blockHeader);
      for (const log of unique.values()) if (log.transactionHash.toLowerCase() === tx) {
        const item = parsed.transfers.find(t => t.logIndex === numberQuantity(log.logIndex, 'log index'));
        if (!item || item.blockHash !== hash(log.blockHash, 'log block hash') || item.blockNumber !== numberQuantity(log.blockNumber, 'log block number') || item.transactionIndex !== numberQuantity(log.transactionIndex, 'log transaction index') ||
            !Array.isArray(log.topics) || log.topics.length !== 3 || log.topics[0]?.toLowerCase() !== TRANSFER_TOPIC || item.from !== topicAddress(log.topics[1]) || item.to !== topicAddress(log.topics[2]) ||
            typeof log.data !== 'string' || !HASH.test(log.data) || item.atomicAmount !== BigInt(log.data).toString() || log.removed !== false || (to && item.to !== to)) fail('getLogs item does not match its receipt or requested recipient');
        transfers.push(item);
      }
    }
    transfers.sort((a, b) => a.blockNumber - b.blockNumber || a.transactionIndex - b.transactionIndex || a.logIndex - b.logIndex);
    return { chainId: ARC_CHAIN_ID, fromBlock, toBlock, observedHeadBlock, transfers, receipts, gasByTransaction, blockHeaders: [...blockHeaders.values()] };
  }
  return { getChainId, getBlockNumber, getReceipt, getTransfers };
}
