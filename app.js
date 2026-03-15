/**
 * app.js — StandardChain frontend controller
 * Wires blockchain.js to the HTML UI
 */
'use strict';

// ─── State ────────────────────────────────────────────────────────────────────
const bc      = new Blockchain();
const wallets = [];

// Pre-create 3 starter wallets
['Miner Alice', 'Miner Bob', 'Satoshi'].forEach(name => addWallet(name));

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const els = {
  hdrHeight:    $('hdr-height'),
  hdrSupply:    $('hdr-supply'),
  hdrDiff:      $('hdr-diff'),
  hdrReward:    $('hdr-reward'),

  mTotal:       $('m-total'),
  mPct:         $('m-pct'),
  mReward:      $('m-reward'),
  mEpoch:       $('m-epoch'),
  mHalving:     $('m-halving'),
  supplyBar:    $('supply-bar'),

  halvingTbody: $('halving-tbody'),
  walletList:   $('wallet-list'),

  selMiner:     $('sel-miner'),
  inpDiff:      $('inp-difficulty'),
  diffBadge:    $('diff-badge'),
  btnMine:      $('btn-mine'),
  btnMine5:     $('btn-mine-5'),
  mineResult:   $('mine-result'),

  selFrom:      $('sel-from'),
  selTo:        $('sel-to'),
  inpAmount:    $('inp-amount'),
  inpFee:       $('inp-fee'),
  btnSend:      $('btn-send'),
  txResult:     $('tx-result'),

  mempoolBadge: $('mempool-badge'),
  mempoolList:  $('mempool-list'),

  btnValidate:  $('btn-validate'),
  validateRes:  $('validate-result'),

  eventLog:     $('event-log'),
  chainExplorer:$('chain-explorer'),
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmt(n) {
  if (n === undefined || n === null) return '—';
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: 8 });
}

function shortAddr(addr) {
  return addr ? `${addr.slice(0,6)}…${addr.slice(-4)}` : '—';
}

function shortHash(h) {
  return h ? `${h.slice(0,10)}…${h.slice(-6)}` : '—';
}

function showMsg(el, text, type = 'info') {
  el.textContent = text;
  el.className = `result-msg ${type}`;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 6000);
}

// ─── Wallet management ────────────────────────────────────────────────────────
function addWallet(name) {
  const w = new Wallet(name || `Wallet ${wallets.length + 1}`);
  wallets.push(w);
  refreshWallets();
  refreshSelects();
}

function refreshWallets() {
  els.walletList.innerHTML = '';
  wallets.forEach(w => {
    const bal = bc.getBalance(w.address);
    const div = document.createElement('div');
    div.className = 'wallet-item';
    div.innerHTML = `
      <div class="wallet-label">${w.label}</div>
      <div class="wallet-addr">${w.address}</div>
      <div class="wallet-balance">${fmt(bal)} SC</div>
    `;
    els.walletList.appendChild(div);
  });
}

function refreshSelects() {
  [els.selMiner, els.selFrom, els.selTo].forEach(sel => {
    const prev = sel.value;
    sel.innerHTML = wallets.map(w =>
      `<option value="${w.address}">${w.label} (${shortAddr(w.address)})</option>`
    ).join('');
    if (prev) sel.value = prev;
  });
}

// ─── Halving schedule ─────────────────────────────────────────────────────────
function buildHalvingTable() {
  const { HALVING_INTERVAL, INITIAL_REWARD } = BLOCKCHAIN_CONSTANTS;
  const currentHeight = bc.chain.length - 1;
  const currentEpoch  = bc.getHalvingEpoch(currentHeight);
  let rows = '';
  for (let epoch = 0; epoch <= 10; epoch++) {
    const block  = epoch * HALVING_INTERVAL;
    const reward = epoch < 64 ? INITIAL_REWARD / Math.pow(2, epoch) : 0;
    const cls    = epoch < currentEpoch ? 'future'
                 : epoch === currentEpoch ? 'current'
                 : '';
    rows += `<tr class="${cls}"><td>${epoch}</td><td>${fmt(block)}</td><td>${fmt(reward)}</td></tr>`;
  }
  els.halvingTbody.innerHTML = rows;
}

// ─── Stats refresh ────────────────────────────────────────────────────────────
function refreshStats() {
  const s = bc.getStats();

  els.hdrHeight.textContent = `Block #${s.height}`;
  els.hdrSupply.textContent = `${fmt(s.totalMined)} / 21,000,000 mined`;
  els.hdrDiff.textContent   = `Difficulty: ${s.difficulty}`;
  els.hdrReward.textContent = `Reward: ${fmt(s.currentReward)}`;

  els.mTotal.textContent   = fmt(s.totalMined);
  els.mPct.textContent     = `${s.supplyPercent}%`;
  els.mReward.textContent  = fmt(s.currentReward);
  els.mEpoch.textContent   = s.halvingEpoch;
  els.mHalving.textContent = `${fmt(s.nextHalvingBlock)} (−${fmt(s.blocksUntilHalving)})`;

  const pct = Math.min((s.totalMined / 21_000_000) * 100, 100);
  els.supplyBar.style.width = `${pct}%`;

  els.mempoolBadge.textContent = s.mempoolSize;

  buildHalvingTable();
  refreshWallets();
  refreshExplorer();
  refreshLog();
  refreshMempool();
}

// ─── Block explorer ───────────────────────────────────────────────────────────
let selectedBlock = null;

function refreshExplorer() {
  const blocks = [...bc.chain].reverse().slice(0, 20); // newest first, max 20
  els.chainExplorer.innerHTML = '';

  if (selectedBlock !== null) {
    const b = bc.chain[selectedBlock];
    if (b) {
      els.chainExplorer.appendChild(renderBlockDetail(b));
      return;
    }
  }

  blocks.forEach((b, i) => {
    const card = document.createElement('div');
    card.className = 'block-card' + (i === 0 ? ' latest' : '');
    card.innerHTML = `
      <div class="block-header">
        <span class="block-index">Block #${b.index}</span>
        <span class="block-txcount">${b.transactions.length} tx</span>
      </div>
      <div class="block-hash">${b.hash}</div>
      <div class="block-meta">
        <span>Diff: <strong>${b.difficulty}</strong></span>
        <span>Nonce: <strong>${fmt(b.nonce)}</strong></span>
        <span>Miner: <strong>${shortAddr(b.miner)}</strong></span>
      </div>
    `;
    card.addEventListener('click', () => {
      selectedBlock = b.index;
      refreshExplorer();
    });
    els.chainExplorer.appendChild(card);
  });
}

function renderBlockDetail(b) {
  const div = document.createElement('div');
  div.className = 'block-detail';

  const rows = [
    ['Index',       b.index],
    ['Hash',        b.hash],
    ['Prev Hash',   b.previousHash],
    ['Merkle Root', b.merkleRoot],
    ['Nonce',       fmt(b.nonce)],
    ['Difficulty',  b.difficulty],
    ['Miner',       b.miner],
    ['Timestamp',   new Date(b.timestamp).toISOString()],
  ];

  const txRows = b.transactions.map(t => {
    const isCoinbase = t.from === 'COINBASE';
    return `<div class="block-tx-row">
      <span class="${isCoinbase ? 'coinbase' : ''}">${isCoinbase ? '[COINBASE]' : shortAddr(t.from)}</span>
      → ${shortAddr(t.to)} · <strong>${fmt(t.amount)} SC</strong>
      ${t.fee > 0 ? `· fee:${fmt(t.fee)}` : ''}
    </div>`;
  }).join('');

  div.innerHTML = `
    <div class="block-detail-title">Block #${b.index} Details</div>
    ${rows.map(([k,v]) => `
      <div class="block-detail-row">
        <span class="dk">${k}</span>
        <span class="dv">${v}</span>
      </div>`).join('')}
    <div class="block-txs-title">Transactions (${b.transactions.length})</div>
    ${txRows}
    <button class="btn btn-ghost btn-close-detail">← Back to Explorer</button>
  `;

  div.querySelector('.btn-close-detail').addEventListener('click', () => {
    selectedBlock = null;
    refreshExplorer();
  });

  return div;
}

// ─── Mempool ──────────────────────────────────────────────────────────────────
function refreshMempool() {
  if (bc.mempool.length === 0) {
    els.mempoolList.innerHTML = '<span class="dim">No pending transactions</span>';
    return;
  }
  els.mempoolList.innerHTML = '';
  bc.mempool.slice().reverse().forEach(tx => {
    const div = document.createElement('div');
    div.className = 'tx-item';
    div.innerHTML = `
      <div class="tx-row">
        <span class="tx-label">From</span>
        <span class="tx-val">${shortAddr(tx.from)}</span>
      </div>
      <div class="tx-row">
        <span class="tx-label">To</span>
        <span class="tx-val">${shortAddr(tx.to)}</span>
      </div>
      <div class="tx-row">
        <span class="tx-label">Amount</span>
        <span class="tx-val">${fmt(tx.amount)} SC</span>
      </div>
      <div class="tx-row">
        <span class="tx-label">Fee</span>
        <span class="tx-val">${fmt(tx.fee)} SC</span>
      </div>
      <div class="tx-id">${tx.txId}</div>
    `;
    els.mempoolList.appendChild(div);
  });
}

// ─── Event log ────────────────────────────────────────────────────────────────
function refreshLog() {
  els.eventLog.innerHTML = '';
  bc.miningLog.slice(0, 40).forEach(entry => {
    const div = document.createElement('div');
    div.className = `log-entry type-${entry.type}`;
    const t = new Date(entry.time);
    const ts = `${t.getHours().toString().padStart(2,'0')}:${t.getMinutes().toString().padStart(2,'0')}:${t.getSeconds().toString().padStart(2,'0')}`;
    div.innerHTML = `<span class="log-time">${ts}</span>${entry.message}${entry.ref ? `<span class="log-ref">${shortHash(entry.ref)}</span>` : ''}`;
    els.eventLog.appendChild(div);
  });
}

// ─── Mining ───────────────────────────────────────────────────────────────────
async function mineBlocks(count) {
  const minerAddr = els.selMiner.value;
  if (!minerAddr) return showMsg(els.mineResult, 'Select a miner first', 'error');

  els.btnMine.disabled  = true;
  els.btnMine5.disabled = true;
  els.btnMine.innerHTML = '<span class="spinner">⛏</span> Mining…';

  // yield to browser before heavy work
  await new Promise(r => setTimeout(r, 10));

  try {
    const results = [];
    for (let i = 0; i < count; i++) {
      const { block, attempts, elapsed } = bc.mineBlock(minerAddr);
      results.push({ block, attempts, elapsed });
      if (count > 1) await new Promise(r => setTimeout(r, 0)); // keep UI responsive
    }

    const last = results[results.length - 1];
    const reward = bc.chain[last.block.index].transactions[0].amount;
    showMsg(
      els.mineResult,
      `✓ Mined ${count} block(s)! Last: #${last.block.index} | nonce: ${last.block.nonce} | attempts: ${fmt(last.attempts)} | time: ${last.elapsed}s | reward: ${fmt(reward)} SC`,
      'success'
    );
  } catch (e) {
    showMsg(els.mineResult, `Error: ${e.message}`, 'error');
  }

  els.btnMine.innerHTML  = '⛏ Mine Block';
  els.btnMine.disabled   = false;
  els.btnMine5.disabled  = false;
  refreshStats();
}

// ─── Send transaction ─────────────────────────────────────────────────────────
function sendTransaction() {
  const from   = els.selFrom.value;
  const to     = els.selTo.value;
  const amount = parseFloat(els.inpAmount.value);
  const fee    = parseFloat(els.inpFee.value) || 0;

  if (!from || !to)       return showMsg(els.txResult, 'Select from/to wallets', 'error');
  if (from === to)        return showMsg(els.txResult, 'From and To must differ', 'error');
  if (!amount || amount <= 0) return showMsg(els.txResult, 'Enter a valid amount', 'error');

  try {
    const tx = new Transaction({ from, to, amount, fee, timestamp: Date.now(), signature: `SIG_${Date.now()}` });
    bc.addTransaction(tx);
    showMsg(els.txResult, `Tx added! ${fmt(amount)} SC queued for next block.`, 'success');
    els.inpAmount.value = '';
    refreshStats();
  } catch (e) {
    showMsg(els.txResult, `Error: ${e.message}`, 'error');
  }
}

// ─── Validate chain ───────────────────────────────────────────────────────────
function validateChain() {
  const result = bc.isChainValid();
  showMsg(
    els.validateRes,
    result.valid ? `✓ ${result.reason} (${bc.chain.length} blocks)` : `✗ ${result.reason}`,
    result.valid ? 'success' : 'error'
  );
}

// ─── Event listeners ──────────────────────────────────────────────────────────
els.btnMine.addEventListener('click', () => mineBlocks(1));
els.btnMine5.addEventListener('click', () => mineBlocks(5));
els.btnSend.addEventListener('click', sendTransaction);
els.btnValidate.addEventListener('click', validateChain);

$('btn-new-wallet').addEventListener('click', () => {
  const name = prompt('Wallet name:') || `Wallet ${wallets.length + 1}`;
  addWallet(name);
});

els.inpDiff.addEventListener('input', () => {
  const v = parseInt(els.inpDiff.value, 10);
  bc.difficulty = v;
  els.diffBadge.textContent = v;
});

// ─── Init ─────────────────────────────────────────────────────────────────────
refreshStats();

// Mine the very first block automatically so balances are non-zero
(async () => {
  await new Promise(r => setTimeout(r, 200));
  bc.mineBlock(wallets[0].address); // silent first block
  refreshStats();
})();
