/* =========================================================
   metamask.js — MetaMask wallet connection & ETH rewards
   =========================================================
   Reward schedule (sent per rally hit and per point scored):
     • Each paddle rally  → RALLY_REWARD  ETH  (tiny micro-payment)
     • Each point scored  → POINT_REWARD  ETH
   Rewards are batched per scoring event to reduce tx count.
   ========================================================= */

'use strict';

const MetaMaskManager = (() => {

  // ── Reward amounts (in ETH, as decimal strings) ──────
  const RALLY_REWARD_ETH = '0.000001';   // 1 microether per rally
  const POINT_REWARD_ETH = '0.000005';   // 5 microether per point

  // ── Convert ETH string → wei BigInt ──────────────────
  function ethToWei(ethStr) {
    // Multiply ETH by 1e18 using integer arithmetic to avoid float errors
    const [whole, frac = ''] = ethStr.split('.');
    const fracPadded = (frac + '000000000000000000').slice(0, 18);
    return BigInt(whole) * BigInt('1000000000000000000') + BigInt(fracPadded);
  }

  // ── Format wei → readable ETH string ─────────────────
  function weiToEthDisplay(weiBigInt) {
    const eth = Number(weiBigInt) / 1e18;
    return eth.toFixed(6) + ' ETH';
  }

  // ── State ─────────────────────────────────────────────
  let account        = null;
  let provider       = null;
  let sessionEarned  = BigInt(0);   // total wei earned this session
  let lastTxHash     = null;
  let rewardQueue    = BigInt(0);   // pending wei to send
  let sendingReward  = false;

  // ── DOM refs ──────────────────────────────────────────
  const connectBtn         = document.getElementById('connect-btn');
  const walletInfo         = document.getElementById('wallet-info');
  const walletAddress      = document.getElementById('wallet-address');
  const walletBalance      = document.getElementById('wallet-balance');
  const rewardTicker       = document.getElementById('reward-ticker');
  const sessionRewardValue = document.getElementById('session-reward-value');
  const rewardFlash        = document.getElementById('reward-flash');
  const goEth              = document.getElementById('go-eth');
  const goTxArea           = document.getElementById('go-tx-area');
  const goTxLink           = document.getElementById('go-tx-link');
  const startConnectBtn    = document.getElementById('start-connect-btn');

  // ── Helpers ───────────────────────────────────────────
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

  function updateBalanceDisplay() {
    if (!account || !provider) return;
    provider.request({ method: 'eth_getBalance', params: [account, 'latest'] })
      .then(hexBal => {
        const wei = BigInt(hexBal);
        walletBalance.textContent = weiToEthDisplay(wei);
      })
      .catch(() => {});
  }

  function updateSessionDisplay() {
    sessionRewardValue.textContent = weiToEthDisplay(sessionEarned);
    if (goEth) goEth.textContent = weiToEthDisplay(sessionEarned);

    // Flash animation
    rewardFlash.classList.remove('hidden');
    rewardFlash.style.animation = 'none';
    void rewardFlash.offsetWidth; // reflow
    rewardFlash.style.animation = '';
    setTimeout(() => rewardFlash.classList.add('hidden'), 900);
  }

  // ── Send reward transaction ───────────────────────────
  async function flushRewardQueue() {
    if (sendingReward || rewardQueue === BigInt(0) || !account) return;
    sendingReward = true;

    const weiToSend = rewardQueue;
    rewardQueue = BigInt(0);

    try {
      const hexValue = '0x' + weiToSend.toString(16);

      const txHash = await provider.request({
        method: 'eth_sendTransaction',
        params: [{
          from:  account,
          to:    account,   // send to self — demonstrates reward flow
          value: hexValue,
          gas:   '0x5208',  // 21000 — standard ETH transfer
        }]
      });

      lastTxHash = txHash;
      sessionEarned += weiToSend;
      updateSessionDisplay();
      updateBalanceDisplay();

      // Show tx link
      if (goTxArea && goTxLink) {
        goTxArea.classList.remove('hidden');
        const shortHash = txHash.slice(0, 10) + '…';
        goTxLink.innerHTML = `<a href="https://etherscan.io/tx/${txHash}" target="_blank" rel="noopener">${shortHash}</a>`;
      }

    } catch (err) {
      // User rejected or tx failed — silently re-queue so game continues
      rewardQueue += weiToSend;
      if (err.code !== 4001) {
        showToast('Reward tx failed: ' + (err.message || 'unknown'), 'error');
      }
    } finally {
      sendingReward = false;
    }
  }

  // ── Connect wallet ────────────────────────────────────
  async function connect() {
    if (!window.ethereum) {
      showToast('MetaMask not found. Install it from metamask.io', 'error');
      showScreen('screen-wallet');
      return false;
    }

    connectBtn.disabled = true;
    connectBtn.textContent = 'Connecting…';

    try {
      provider = window.ethereum;
      const accounts = await provider.request({ method: 'eth_requestAccounts' });

      if (!accounts || accounts.length === 0) throw new Error('No accounts returned');

      account = accounts[0];
      walletAddress.textContent = shortAddr(account);
      walletInfo.classList.remove('hidden');
      rewardTicker.classList.remove('hidden');
      connectBtn.textContent = 'Connected';
      connectBtn.style.background = 'var(--green)';

      // Hide the "Connect First" button on start screen
      if (startConnectBtn) startConnectBtn.classList.add('hidden');

      updateBalanceDisplay();
      showToast('Wallet connected: ' + shortAddr(account), 'success');

      // Listen for account changes
      provider.on('accountsChanged', (accs) => {
        if (accs.length === 0) {
          disconnect();
        } else {
          account = accs[0];
          walletAddress.textContent = shortAddr(account);
          updateBalanceDisplay();
          showToast('Account switched to ' + shortAddr(account), 'info');
        }
      });

      return true;
    } catch (err) {
      connectBtn.disabled = false;
      connectBtn.textContent = 'Connect MetaMask';
      if (err.code === 4001) {
        showToast('Connection rejected by user.', 'error');
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
    connectBtn.disabled = false;
    connectBtn.textContent = 'Connect MetaMask';
    connectBtn.style.background = '';
    showToast('Wallet disconnected.', 'info');
  }

  // ── Public API ────────────────────────────────────────
  function isConnected() { return !!account; }

  function getAccount() { return account; }

  /**
   * Called by game on each paddle rally.
   */
  function onRally() {
    if (!account) return;
    rewardQueue += ethToWei(RALLY_REWARD_ETH);
    // Don't flush immediately — batch with point reward or flush after short delay
    scheduleFlush(800);
  }

  /**
   * Called by game when a point is scored.
   */
  function onPoint() {
    if (!account) return;
    rewardQueue += ethToWei(POINT_REWARD_ETH);
    scheduleFlush(300);
  }

  let flushTimer = null;
  function scheduleFlush(delayMs) {
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flushRewardQueue, delayMs);
  }

  /**
   * Reset session stats (called on new game).
   */
  function resetSession() {
    sessionEarned = BigInt(0);
    rewardQueue   = BigInt(0);
    lastTxHash    = null;
    updateSessionDisplay();
    if (goTxArea) goTxArea.classList.add('hidden');
  }

  function getSessionEarned() { return sessionEarned; }
  function getLastTxHash()    { return lastTxHash; }

  // ── Wire up connect button ────────────────────────────
  connectBtn.addEventListener('click', connect);
  if (startConnectBtn) {
    startConnectBtn.addEventListener('click', async () => {
      const ok = await connect();
      if (ok) showToast('You can now start the game to earn ETH!', 'success');
    });
  }

  // ── Auto-detect if already connected ─────────────────
  if (window.ethereum) {
    window.ethereum.request({ method: 'eth_accounts' }).then(accounts => {
      if (accounts && accounts.length > 0) {
        // Already authorized — connect silently
        provider = window.ethereum;
        account  = accounts[0];
        walletAddress.textContent = shortAddr(account);
        walletInfo.classList.remove('hidden');
        rewardTicker.classList.remove('hidden');
        connectBtn.textContent = 'Connected';
        connectBtn.style.background = 'var(--green)';
        if (startConnectBtn) startConnectBtn.classList.add('hidden');
        updateBalanceDisplay();
      }
    }).catch(() => {});
  }

  return {
    connect,
    disconnect,
    isConnected,
    getAccount,
    onRally,
    onPoint,
    resetSession,
    getSessionEarned,
    getLastTxHash,
    weiToEthDisplay,
    showToast,
  };

})();

// ── Screen switcher (used by both modules) ────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const target = document.getElementById(id);
  if (target) target.classList.add('active');

  const overlay = document.getElementById('overlay');
  if (id) {
    overlay.style.display = 'flex';
  } else {
    overlay.style.display = 'none';
  }
}

function hideOverlay() {
  document.getElementById('overlay').style.display = 'none';
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
}
