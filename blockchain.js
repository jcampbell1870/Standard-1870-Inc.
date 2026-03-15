/**
 * Proof-of-Work Blockchain
 * Max Supply: 21,000,000 coins
 * Halving every 210,000 blocks (Bitcoin-style)
 * Initial block reward: 50 coins
 */

'use strict';

// ─── SHA-256 (pure JS, no external deps) ────────────────────────────────────
const SHA256 = (() => {
  const K = [
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,
    0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,
    0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,
    0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,
    0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,
    0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,
    0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,
    0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,
    0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
  ];

  function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }

  return function sha256(msg) {
    const bytes = new TextEncoder().encode(msg);
    const bitLen = bytes.length * 8;
    const padLen = (bytes.length % 64 < 56) ? 56 - (bytes.length % 64) : 120 - (bytes.length % 64);
    const padded = new Uint8Array(bytes.length + padLen + 8);
    padded.set(bytes);
    padded[bytes.length] = 0x80;
    const dv = new DataView(padded.buffer);
    dv.setUint32(padded.length - 4, bitLen >>> 0, false);
    dv.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000), false);

    let h = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,
             0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];

    for (let i = 0; i < padded.length; i += 64) {
      const w = new Array(64);
      for (let j = 0; j < 16; j++) w[j] = dv.getUint32(i + j * 4, false);
      for (let j = 16; j < 64; j++) {
        const s0 = rotr(w[j-15],7) ^ rotr(w[j-15],18) ^ (w[j-15] >>> 3);
        const s1 = rotr(w[j-2],17) ^ rotr(w[j-2],19) ^ (w[j-2] >>> 10);
        w[j] = (w[j-16] + s0 + w[j-7] + s1) >>> 0;
      }
      let [a,b,c,d,e,f,g,hh] = h;
      for (let j = 0; j < 64; j++) {
        const S1 = rotr(e,6) ^ rotr(e,11) ^ rotr(e,25);
        const ch = (e & f) ^ (~e & g);
        const tmp1 = (hh + S1 + ch + K[j] + w[j]) >>> 0;
        const S0 = rotr(a,2) ^ rotr(a,13) ^ rotr(a,22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const tmp2 = (S0 + maj) >>> 0;
        hh=g; g=f; f=e; e=(d+tmp1)>>>0;
        d=c; c=b; b=a; a=(tmp1+tmp2)>>>0;
      }
      h[0]=(h[0]+a)>>>0; h[1]=(h[1]+b)>>>0; h[2]=(h[2]+c)>>>0; h[3]=(h[3]+d)>>>0;
      h[4]=(h[4]+e)>>>0; h[5]=(h[5]+f)>>>0; h[6]=(h[6]+g)>>>0; h[7]=(h[7]+hh)>>>0;
    }
    return h.map(v => v.toString(16).padStart(8,'0')).join('');
  };
})();

// ─── Constants ───────────────────────────────────────────────────────────────
const BLOCKCHAIN_CONSTANTS = {
  MAX_SUPPLY:         21_000_000,
  INITIAL_REWARD:     50,
  HALVING_INTERVAL:   210_000,    // blocks between halvings
  DIFFICULTY_WINDOW:  10,         // blocks to look back for difficulty adjustment
  TARGET_BLOCK_TIME:  10,         // seconds (simulated)
  INITIAL_DIFFICULTY: 3,          // leading zeros required
  MAX_TRANSACTIONS:   100,        // per block
  COINBASE_MATURITY:  100,        // blocks before coinbase can be spent
};

// ─── Transaction ─────────────────────────────────────────────────────────────
class Transaction {
  constructor({ from, to, amount, fee = 0, timestamp = Date.now(), signature = 'GENESIS' }) {
    this.from      = from;
    this.to        = to;
    this.amount    = amount;
    this.fee       = fee;
    this.timestamp = timestamp;
    this.signature = signature;
    this.txId      = this._computeId();
  }

  _computeId() {
    return SHA256(`${this.from}${this.to}${this.amount}${this.fee}${this.timestamp}`);
  }

  isValid() {
    if (this.from === 'COINBASE') return true;
    if (!this.from || !this.to)  return false;
    if (this.amount <= 0)        return false;
    if (this.fee < 0)            return false;
    return true;
  }

  toJSON() {
    return {
      txId:      this.txId,
      from:      this.from,
      to:        this.to,
      amount:    this.amount,
      fee:       this.fee,
      timestamp: this.timestamp,
      signature: this.signature,
    };
  }
}

// ─── Block ───────────────────────────────────────────────────────────────────
class Block {
  constructor({ index, previousHash, transactions, difficulty, miner, timestamp = Date.now() }) {
    this.index        = index;
    this.previousHash = previousHash;
    this.transactions = transactions;
    this.difficulty   = difficulty;
    this.miner        = miner;
    this.timestamp    = timestamp;
    this.nonce        = 0;
    this.merkleRoot   = this._merkleRoot();
    this.hash         = '';
  }

  _merkleRoot() {
    const ids = this.transactions.map(t => t.txId);
    if (ids.length === 0) return SHA256('empty');
    let level = ids;
    while (level.length > 1) {
      const next = [];
      for (let i = 0; i < level.length; i += 2) {
        next.push(SHA256(level[i] + (level[i + 1] || level[i])));
      }
      level = next;
    }
    return level[0];
  }

  computeHash() {
    return SHA256(
      `${this.index}${this.previousHash}${this.merkleRoot}${this.timestamp}${this.nonce}${this.difficulty}`
    );
  }

  mine() {
    const target = '0'.repeat(this.difficulty);
    let attempts = 0;
    while (true) {
      this.hash = this.computeHash();
      attempts++;
      if (this.hash.startsWith(target)) break;
      this.nonce++;
    }
    return attempts;
  }

  isValidHash() {
    return this.hash === this.computeHash() &&
           this.hash.startsWith('0'.repeat(this.difficulty));
  }

  toJSON() {
    return {
      index:        this.index,
      hash:         this.hash,
      previousHash: this.previousHash,
      merkleRoot:   this.merkleRoot,
      timestamp:    this.timestamp,
      nonce:        this.nonce,
      difficulty:   this.difficulty,
      miner:        this.miner,
      transactions: this.transactions.map(t => t.toJSON()),
    };
  }
}

// ─── Wallet ───────────────────────────────────────────────────────────────────
class Wallet {
  constructor(label = 'Wallet') {
    this.label   = label;
    this.address = SHA256(`${label}-${Date.now()}-${Math.random()}`).slice(0, 40);
  }

  toJSON() {
    return { label: this.label, address: this.address };
  }
}

// ─── Blockchain ───────────────────────────────────────────────────────────────
class Blockchain {
  constructor() {
    this.chain          = [];
    this.mempool        = [];      // pending transactions
    this.utxoSet        = new Map(); // address -> balance
    this.totalMined     = 0;
    this.difficulty     = BLOCKCHAIN_CONSTANTS.INITIAL_DIFFICULTY;
    this.miningLog      = [];      // event log for UI
    this._createGenesis();
  }

  // ── Genesis block ──
  _createGenesis() {
    const genesisTx = new Transaction({
      from:      'COINBASE',
      to:        'GENESIS',
      amount:    0,
      fee:       0,
      timestamp: new Date('2009-01-03T18:15:05Z').getTime(),
      signature: 'GENESIS_BLOCK',
    });
    const genesis = new Block({
      index:        0,
      previousHash: '0'.repeat(64),
      transactions: [genesisTx],
      difficulty:   1,
      miner:        'GENESIS',
      timestamp:    new Date('2009-01-03T18:15:05Z').getTime(),
    });
    genesis.hash = genesis.computeHash();
    this.chain.push(genesis);
    this._log('info', 'Genesis block created', genesis.hash);
  }

  // ── Supply & reward helpers ──
  getBlockReward(blockIndex) {
    const { INITIAL_REWARD, HALVING_INTERVAL, MAX_SUPPLY } = BLOCKCHAIN_CONSTANTS;
    if (this.totalMined >= MAX_SUPPLY) return 0;
    const halvings = Math.floor(blockIndex / HALVING_INTERVAL);
    if (halvings >= 64) return 0;
    const reward = INITIAL_REWARD / Math.pow(2, halvings);
    return Math.min(reward, MAX_SUPPLY - this.totalMined);
  }

  getHalvingEpoch(blockIndex) {
    return Math.floor(blockIndex / BLOCKCHAIN_CONSTANTS.HALVING_INTERVAL);
  }

  getNextHalvingBlock(blockIndex) {
    const { HALVING_INTERVAL } = BLOCKCHAIN_CONSTANTS;
    return (Math.floor(blockIndex / HALVING_INTERVAL) + 1) * HALVING_INTERVAL;
  }

  getCirculatingSupply() {
    let total = 0;
    for (const v of this.utxoSet.values()) total += v;
    return total;
  }

  // ── Difficulty adjustment ──
  _adjustDifficulty() {
    const { DIFFICULTY_WINDOW, TARGET_BLOCK_TIME, INITIAL_DIFFICULTY } = BLOCKCHAIN_CONSTANTS;
    if (this.chain.length < DIFFICULTY_WINDOW + 1) return this.difficulty;

    const recent = this.chain.slice(-DIFFICULTY_WINDOW);
    const elapsed = (recent[recent.length - 1].timestamp - recent[0].timestamp) / 1000; // ms->s
    const avgTime = elapsed / (DIFFICULTY_WINDOW - 1);

    if (avgTime < TARGET_BLOCK_TIME * 0.5) {
      this.difficulty = Math.min(this.difficulty + 1, 8);
    } else if (avgTime > TARGET_BLOCK_TIME * 2) {
      this.difficulty = Math.max(this.difficulty - 1, INITIAL_DIFFICULTY);
    }
    return this.difficulty;
  }

  // ── Add a pending transaction ──
  addTransaction(tx) {
    if (!tx.isValid()) throw new Error('Invalid transaction');
    if (tx.from !== 'COINBASE') {
      const balance = this.getBalance(tx.from);
      if (balance < tx.amount + tx.fee) {
        throw new Error(`Insufficient balance: have ${balance}, need ${tx.amount + tx.fee}`);
      }
    }
    this.mempool.push(tx);
    this._log('tx', `Tx added to mempool: ${tx.amount} coins ${tx.from} → ${tx.to}`, tx.txId);
    return tx;
  }

  // ── Mine a new block ──
  mineBlock(minerAddress) {
    if (this.totalMined >= BLOCKCHAIN_CONSTANTS.MAX_SUPPLY) {
      this._log('warn', 'Max supply reached. No more block rewards.');
    }

    const prevBlock = this.chain[this.chain.length - 1];
    this._adjustDifficulty();

    // Select up to MAX_TRANSACTIONS from mempool (highest fee first)
    const selected = [...this.mempool]
      .filter(tx => tx.isValid())
      .sort((a, b) => b.fee - a.fee)
      .slice(0, BLOCKCHAIN_CONSTANTS.MAX_TRANSACTIONS);

    // Coinbase transaction
    const reward    = this.getBlockReward(this.chain.length);
    const totalFees = selected.reduce((s, t) => s + t.fee, 0);
    const coinbase  = new Transaction({
      from:      'COINBASE',
      to:        minerAddress,
      amount:    reward + totalFees,
      fee:       0,
      timestamp: Date.now(),
      signature: `COINBASE_${this.chain.length}`,
    });

    const block = new Block({
      index:        this.chain.length,
      previousHash: prevBlock.hash,
      transactions: [coinbase, ...selected],
      difficulty:   this.difficulty,
      miner:        minerAddress,
    });

    const startTime = Date.now();
    const attempts  = block.mine();
    const elapsed   = ((Date.now() - startTime) / 1000).toFixed(2);

    // Apply block to state
    this._applyBlock(block);

    // Remove mined txs from mempool
    const minedIds = new Set(selected.map(t => t.txId));
    this.mempool   = this.mempool.filter(t => !minedIds.has(t.txId));

    this._log('block',
      `Block #${block.index} mined | reward: ${reward} | difficulty: ${this.difficulty} | nonce: ${block.nonce} | attempts: ${attempts} | time: ${elapsed}s`,
      block.hash
    );

    return { block, attempts, elapsed: parseFloat(elapsed) };
  }

  _applyBlock(block) {
    this.chain.push(block);
    for (const tx of block.transactions) {
      if (tx.from !== 'COINBASE') {
        const fromBal = this.utxoSet.get(tx.from) || 0;
        this.utxoSet.set(tx.from, fromBal - tx.amount - tx.fee);
      }
      const toBal = this.utxoSet.get(tx.to) || 0;
      this.utxoSet.set(tx.to, toBal + tx.amount);

      if (tx.from === 'COINBASE') this.totalMined += tx.amount;
    }
  }

  // ── Balances ──
  getBalance(address) {
    return this.utxoSet.get(address) || 0;
  }

  // ── Validation ──
  isChainValid() {
    for (let i = 1; i < this.chain.length; i++) {
      const curr = this.chain[i];
      const prev = this.chain[i - 1];
      if (!curr.isValidHash())            return { valid: false, reason: `Block ${i} invalid hash` };
      if (curr.previousHash !== prev.hash) return { valid: false, reason: `Block ${i} broken link` };
    }
    return { valid: true, reason: 'Chain is valid' };
  }

  // ── Stats ──
  getStats() {
    const { MAX_SUPPLY, HALVING_INTERVAL, INITIAL_REWARD } = BLOCKCHAIN_CONSTANTS;
    const height       = this.chain.length - 1;
    const epoch        = this.getHalvingEpoch(height);
    const nextHalving  = this.getNextHalvingBlock(height);
    const reward       = this.getBlockReward(height);
    const circulating  = this.getCirculatingSupply();
    return {
      height,
      difficulty:       this.difficulty,
      totalMined:       this.totalMined,
      circulatingSupply: circulating,
      maxSupply:        MAX_SUPPLY,
      supplyPercent:    ((this.totalMined / MAX_SUPPLY) * 100).toFixed(6),
      halvingEpoch:     epoch,
      nextHalvingBlock: nextHalving,
      blocksUntilHalving: nextHalving - height,
      currentReward:    reward,
      mempoolSize:      this.mempool.length,
    };
  }

  _log(type, message, ref = '') {
    this.miningLog.unshift({ type, message, ref, time: new Date().toISOString() });
    if (this.miningLog.length > 200) this.miningLog.pop();
  }

  toJSON() {
    return {
      stats: this.getStats(),
      chain: this.chain.map(b => b.toJSON()),
    };
  }
}

// Export for browser + Node
if (typeof module !== 'undefined') {
  module.exports = { Blockchain, Block, Transaction, Wallet, SHA256, BLOCKCHAIN_CONSTANTS };
} else {
  window.Blockchain           = Blockchain;
  window.Block                = Block;
  window.Transaction          = Transaction;
  window.Wallet               = Wallet;
  window.SHA256               = SHA256;
  window.BLOCKCHAIN_CONSTANTS = BLOCKCHAIN_CONSTANTS;
}
