/* =========================================================
   metamask.js — MetaMask wallet + 1870Coin ERC-20 tracking
   =========================================================
   1870Coin contract: 0xcF0A9F89ab34D39C11B5e08e1c6aC33A47e207c8
   - Connects MetaMask and reads the player's 1870Coin balance
   - Tracks tokens earned during the game session
   - Offers to add 1870Coin to the MetaMask wallet
   - Does NOT send transactions autonomously; all reward
     totals are tracked in-game and shown to the player.
   ========================================================= */

'use strict';

const MetaMaskManager = (() => {

  // ── 1870Coin contract ─────────────────────────────────
  const TOKEN_CONTRACT = '0xcF0A9F89ab34D39C11B5e08e1c6aC33A47e207c8';
  const TOKEN_SYMBOL   = '1870';
  const TOKEN_NAME     = '1870Coin';

  // ── Reward constants (in whole token units) ───────────
  const REWARD_HIT  = 1;
  const REWARD_SINK = 5;
  const REWARD_WIN  = 20;

  // ── ABI helpers (no external library) ────────────────
  /** Encode a balanceOf(address) eth_call payload */
  function encodeBalanceOf(addr) {
    // selector: keccak256("balanceOf(address)") = 0x70a08231
    const paddedAddr = addr.replace('0x', '').toLowerCase().padStart(64, '0');
    return '0x70a08231' + paddedAddr;
  }

  /** Encode a decimals() eth_call payload */
  function encodeDecimals() {
    // selector: keccak256("decimals()") = 0x313ce567
    return '0x313ce567';
  }

  /** Encode a symbol() eth_call payload */
  function encodeSymbol() {
    // selector: keccak256("symbol()") = 0x95d89b41
    return '0x95d89b41';
  }

  /** Parse a hex uint256 result, applying decimals to get a display value */
  function parseTokenAmount(hexResult, decimals) {
    if (!hexResult || hexResult === '0x') return '0';
    const raw = BigInt(hexResult);
    if (raw === BigInt(0)) return '0';

    const divisor = BigInt(10) ** BigInt(decimals);
    const whole   = raw / divisor;
    const frac    = raw % divisor;

    if (frac === BigInt(0)) return whole.toString();

    const fracStr  = frac.toString().padStart(decimals, '0');
    const trimmed  = fracStr.replace(/0+$/, '').slice(0, 4);
    return `${whole}.${trimmed}`;
  }

  // ── State ─────────────────────────────────────────────
  let account       = null;
  let provider      = null;
  let tokenDecimals = 18;    // refreshed on connect
  let tokenBalance  = null;  // raw BigInt from contract
  let sessionEarned = 0;     // integer token units earned this session

  // ── DOM refs ──────────────────────────────────────────
  const connectBtn         = document.getElementById('connect-btn');
  const walletInfo         = document.getElementById('wallet-info');
  const walletAddress      = document.getElementById('wallet-address');
  const tokenBalanceEl     = document.getElementById('token-balance-display');
  const rewardTicker       = document.getElementById('reward-ticker');
  const sessionRewardValue = document.getElementById('session-reward-value');
  const rewardFlash        = document.getElementById('reward-flash');
  const startConnectBtn    = document.getElementById('start-connect-btn');
  const addTokenBtn        = document.getElementById('add-token-btn');

  // ── Utilities ─────────────────────────────────────────
  function shortAddr(addr) {
    return addr.slice(0, 6) + '…' + addr.slice(-4);
  }

  function showToast(msg, type = 'info') {
    const c = document.getElementById('toast-container');
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.textContent = msg;
    c.appendChild(t);
    setTimeout(() => t.remove(), 4200);
  }

  // ── Fetch on-chain 1870Coin balance ──────────────────
  async function refreshTokenBalance() {
    if (!account || !provider) return;
    try {
      const balHex = await provider.request({
        method: 'eth_call',
        params: [{ to: TOKEN_CONTRACT, data: encodeBalanceOf(account) }, 'latest']
      });
      tokenBalance = balHex && balHex !== '0x' ? BigInt(balHex) : BigInt(0);
      const display = parseTokenAmount('0x' + tokenBalance.toString(16), tokenDecimals);
      if (tokenBalanceEl) tokenBalanceEl.textContent = `${display} ${TOKEN_SYMBOL}`;
    } catch (_) {
      if (tokenBalanceEl) tokenBalanceEl.textContent = `— ${TOKEN_SYMBOL}`;
    }
  }

  // ── Fetch token decimals ──────────────────────────────
  async function fetchDecimals() {
    try {
      const result = await provider.request({
        method: 'eth_call',
        params: [{ to: TOKEN_CONTRACT, data: encodeDecimals() }, 'latest']
      });
      if (result && result !== '0x') {
        tokenDecimals = parseInt(result, 16);
      }
    } catch (_) { /* default 18 */ }
  }

  // ── Update session reward display ─────────────────────
  function updateSessionDisplay() {
    if (sessionRewardValue) {
      sessionRewardValue.textContent = `${sessionEarned} ${TOKEN_SYMBOL}`;
    }

    // Trigger flash animation
    if (rewardFlash) {
      rewardFlash.classList.remove('hidden');
      rewardFlash.style.animation = 'none';
      void rewardFlash.offsetWidth; // force reflow
      rewardFlash.style.animation  = '';
      setTimeout(() => rewardFlash.classList.add('hidden'), 950);
    }

    // Update in-game earned counter
    const earnedEl = document.getElementById('earned-count');
    if (earnedEl) earnedEl.textContent = sessionEarned;

    // Update game-over screen
    const goTokens = document.getElementById('go-tokens');
    if (goTokens) goTokens.textContent = `${sessionEarned} ${TOKEN_SYMBOL}`;
  }

  // ── Connect wallet ────────────────────────────────────
  async function connect() {
    if (!window.ethereum) {
      showToast('MetaMask not found. Install it from metamask.io', 'error');
      showScreen('screen-wallet');
      return false;
    }

    connectBtn.disabled    = true;
    connectBtn.textContent = 'Connecting…';

    try {
      provider = window.ethereum;
      const accounts = await provider.request({ method: 'eth_requestAccounts' });

      if (!accounts || accounts.length === 0) throw new Error('No accounts returned');

      account = accounts[0];
      walletAddress.textContent = shortAddr(account);
      walletInfo.classList.remove('hidden');
      rewardTicker.classList.remove('hidden');
      connectBtn.textContent    = 'Connected';
      connectBtn.style.background = 'var(--green)';
      connectBtn.style.color      = '#000';

      if (startConnectBtn) startConnectBtn.classList.add('hidden');
      if (addTokenBtn)     addTokenBtn.classList.remove('hidden');

      // Fetch token data
      await fetchDecimals();
      await refreshTokenBalance();

      showToast(`Wallet connected: ${shortAddr(account)}`, 'success');
      showToast(`1870Coin tracking active`, 'reward');

      // Account change listener
      provider.on('accountsChanged', (accs) => {
        if (accs.length === 0) {
          disconnect();
        } else {
          account = accs[0];
          walletAddress.textContent = shortAddr(account);
          refreshTokenBalance();
          showToast('Account switched to ' + shortAddr(account), 'info');
        }
      });

      return true;
    } catch (err) {
      connectBtn.disabled    = false;
      connectBtn.textContent = 'Connect MetaMask';
      connectBtn.style.background = '';
      connectBtn.style.color      = '';
      if (err.code === 4001) {
        showToast('Connection rejected.', 'error');
      } else {
        showToast('Connection failed: ' + (err.message || 'unknown'), 'error');
      }
      return false;
    }
  }

  function disconnect() {
    account = null;
    walletInfo.classList.add('hidden');
    rewardTicker.classList.add('hidden');
    connectBtn.disabled         = false;
    connectBtn.textContent      = 'Connect MetaMask';
    connectBtn.style.background = '';
    connectBtn.style.color      = '';
    if (addTokenBtn) addTokenBtn.classList.add('hidden');
    showToast('Wallet disconnected.', 'info');
  }

  // ── Add 1870Coin to MetaMask ──────────────────────────
  async function addTokenToWallet() {
    if (!provider) {
      showToast('Connect MetaMask first.', 'error');
      return;
    }
    try {
      const wasAdded = await provider.request({
        method: 'wallet_watchAsset',
        params: {
          type: 'ERC20',
          options: {
            address:  TOKEN_CONTRACT,
            symbol:   TOKEN_SYMBOL,
            decimals: tokenDecimals,
          }
        }
      });
      if (wasAdded) {
        showToast(`${TOKEN_NAME} added to MetaMask!`, 'success');
      }
    } catch (err) {
      if (err.code !== 4001) {
        showToast('Could not add token: ' + (err.message || 'unknown'), 'error');
      }
    }
  }

  // ── Reward tracking (called by game.js) ───────────────

  /** Player scored a hit */
  function onHit() {
    if (!account) return;
    sessionEarned += REWARD_HIT;
    updateSessionDisplay();
    showToast(`HIT! +${REWARD_HIT} ${TOKEN_SYMBOL}`, 'reward');
  }

  /** Player sank an enemy ship */
  function onSink(shipName) {
    if (!account) return;
    sessionEarned += REWARD_SINK;
    updateSessionDisplay();
    showToast(`${shipName} SUNK! +${REWARD_SINK} ${TOKEN_SYMBOL}`, 'reward');
  }

  /** Player won the game */
  function onWin() {
    if (!account) return;
    sessionEarned += REWARD_WIN;
    updateSessionDisplay();
    showToast(`VICTORY! +${REWARD_WIN} ${TOKEN_SYMBOL}`, 'reward');
    // Refresh balance from chain after win
    setTimeout(refreshTokenBalance, 1500);
  }

  /** Reset session counters for new game */
  function resetSession() {
    sessionEarned = 0;
    updateSessionDisplay();
    if (rewardFlash) rewardFlash.classList.add('hidden');
  }

  // ── Auto-detect existing MetaMask connection ──────────
  if (window.ethereum) {
    window.ethereum.request({ method: 'eth_accounts' }).then(async (accounts) => {
      if (accounts && accounts.length > 0) {
        provider = window.ethereum;
        account  = accounts[0];
        walletAddress.textContent = shortAddr(account);
        walletInfo.classList.remove('hidden');
        rewardTicker.classList.remove('hidden');
        connectBtn.textContent    = 'Connected';
        connectBtn.style.background = 'var(--green)';
        connectBtn.style.color      = '#000';
        if (startConnectBtn) startConnectBtn.classList.add('hidden');
        if (addTokenBtn)     addTokenBtn.classList.remove('hidden');
        await fetchDecimals();
        await refreshTokenBalance();
      }
    }).catch(() => {});
  }

  // ── Wire buttons ──────────────────────────────────────
  connectBtn.addEventListener('click', connect);

  if (startConnectBtn) {
    startConnectBtn.addEventListener('click', async () => {
      const ok = await connect();
      if (ok) showToast('MetaMask connected! Rewards are now active.', 'success');
    });
  }

  if (addTokenBtn) {
    addTokenBtn.addEventListener('click', addTokenToWallet);
  }

  // ── Public API ────────────────────────────────────────
  return {
    connect,
    disconnect,
    isConnected:     () => !!account,
    getAccount:      () => account,
    getSessionEarned:() => sessionEarned,
    onHit,
    onSink,
    onWin,
    resetSession,
    addTokenToWallet,
    showToast,
    refreshTokenBalance,
  };

})();

/* ── Global screen helpers (used by both scripts) ──── */
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const target = document.getElementById(id);
  if (target) target.classList.add('active');
  const overlay = document.getElementById('overlay');
  if (overlay) overlay.style.display = 'flex';
}

function hideOverlay() {
  const overlay = document.getElementById('overlay');
  if (overlay) overlay.style.display = 'none';
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
}
