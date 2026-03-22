/* =========================================================
   game.js — Classic Battleship engine
   =========================================================
   Rules faithful to the 1967/1990 Milton Bradley standard:
   • 10×10 grid, column labels A-J, row labels 1-10
   • Fleet: Carrier(5), Battleship(4), Cruiser(3),
            Submarine(3), Destroyer(2) — 17 total cells
   • Players alternate turns; first to sink all 5 enemy
     ships wins.
   • AI uses Hunt→Target→Direction strategy.
   ========================================================= */

'use strict';

const Battleship = (() => {

  // ── Constants ─────────────────────────────────────────
  const GRID   = 10;
  const COLS   = ['A','B','C','D','E','F','G','H','I','J'];
  const ROWS   = ['1','2','3','4','5','6','7','8','9','10'];

  const SHIPS_DEF = [
    { id: 'carrier',    name: 'Carrier',    size: 5 },
    { id: 'battleship', name: 'Battleship', size: 4 },
    { id: 'cruiser',    name: 'Cruiser',    size: 3 },
    { id: 'submarine',  name: 'Submarine',  size: 3 },
    { id: 'destroyer',  name: 'Destroyer',  size: 2 },
  ];

  const TOTAL_CELLS = SHIPS_DEF.reduce((s, sh) => s + sh.size, 0); // 17

  // AI delay (ms) to feel natural
  const AI_DELAY_MIN = 800;
  const AI_DELAY_MAX = 1600;

  // ── Game state ────────────────────────────────────────
  let phase        = 'start';   // 'start'|'setup'|'battle'|'gameover'
  let playerTurn   = true;
  let playerHits   = 0;
  let playerShots  = 0;
  let playerSunk   = 0;
  let aiHitsOnPlayer = 0;
  let aiProcessing   = false;

  // Boards: [row][col] = { shipId: string|null, hit: false }
  let playerBoard = [];
  let aiBoard     = [];

  // Ships: id -> { cells:[{r,c}], hits:0, sunk:false }
  let playerShips = {};
  let aiShips     = {};

  // Setup state
  let selectedShipId = null;
  let isHorizontal   = true;
  let placedIds      = new Set();

  // AI targeting
  const ai = {
    mode:        'hunt',   // 'hunt' | 'target'
    tried:       null,     // Set of "r,c" strings already shot
    queue:       [],       // cells to try in target mode
    firstHit:    null,     // {r,c} of first hit on current ship
    lastHit:     null,
    direction:   null,     // 'h' | 'v' | null
    triedReverse:false,
  };

  // Checkerboard hunt cells (shoot every other cell for efficiency)
  let huntPool = [];

  // ── Board helpers ─────────────────────────────────────
  function makeBoard() {
    return Array.from({ length: GRID }, () =>
      Array.from({ length: GRID }, () => ({ shipId: null, hit: false }))
    );
  }

  function inBounds(r, c) {
    return r >= 0 && r < GRID && c >= 0 && c < GRID;
  }

  function shipCells(r, c, size, horiz) {
    const cells = [];
    for (let i = 0; i < size; i++) {
      cells.push(horiz ? { r, c: c + i } : { r: r + i, c });
    }
    return cells;
  }

  function canPlace(board, r, c, size, horiz) {
    const cells = shipCells(r, c, size, horiz);
    for (const { r: pr, c: pc } of cells) {
      if (!inBounds(pr, pc))       return false;
      if (board[pr][pc].shipId)    return false;
    }
    return true;
  }

  function placeShip(board, ships, id, r, c, size, horiz) {
    const cells = shipCells(r, c, size, horiz);
    for (const { r: pr, c: pc } of cells) {
      board[pr][pc].shipId = id;
    }
    ships[id] = { cells, hits: 0, sunk: false };
  }

  // ── Random ship placement ─────────────────────────────
  function randomPlaceAll(board, ships) {
    for (const def of SHIPS_DEF) {
      let placed = false;
      let tries  = 0;
      while (!placed && tries < 1000) {
        tries++;
        const horiz = Math.random() < 0.5;
        const r = Math.floor(Math.random() * GRID);
        const c = Math.floor(Math.random() * GRID);
        if (canPlace(board, r, c, def.size, horiz)) {
          placeShip(board, ships, def.id, r, c, def.size, horiz);
          placed = true;
        }
      }
    }
  }

  // ── Hunt pool (checkerboard pattern) ─────────────────
  function buildHuntPool() {
    huntPool = [];
    for (let r = 0; r < GRID; r++) {
      for (let c = 0; c < GRID; c++) {
        // Checkerboard: skip (r+c) % 2 === 1 cells initially
        if ((r + c) % 2 === 0) huntPool.push({ r, c });
      }
    }
    // Shuffle
    for (let i = huntPool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [huntPool[i], huntPool[j]] = [huntPool[j], huntPool[i]];
    }
  }

  // ── DOM grid builders ─────────────────────────────────
  function buildCoordLabels(colId, rowId) {
    const colEl = document.getElementById(colId);
    const rowEl = document.getElementById(rowId);
    if (colEl) {
      colEl.innerHTML = '';
      COLS.forEach(c => {
        const d = document.createElement('div');
        d.className = 'col-label';
        d.textContent = c;
        colEl.appendChild(d);
      });
    }
    if (rowEl) {
      rowEl.innerHTML = '';
      ROWS.forEach(r => {
        const d = document.createElement('div');
        d.className = 'row-label';
        d.textContent = r;
        rowEl.appendChild(d);
      });
    }
  }

  function buildGrid(containerId, clickHandler, hoverHandler, leaveHandler) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = '';
    for (let r = 0; r < GRID; r++) {
      for (let c = 0; c < GRID; c++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.dataset.r  = r;
        cell.dataset.c  = c;
        if (clickHandler) cell.addEventListener('click',      () => clickHandler(r, c));
        if (hoverHandler) cell.addEventListener('mouseenter', () => hoverHandler(r, c));
        if (leaveHandler) cell.addEventListener('mouseleave', leaveHandler);
        el.appendChild(cell);
      }
    }
  }

  function getCell(containerId, r, c) {
    const el = document.getElementById(containerId);
    if (!el) return null;
    return el.querySelector(`[data-r="${r}"][data-c="${c}"]`);
  }

  function setCellClass(containerId, r, c, ...classes) {
    const cell = getCell(containerId, r, c);
    if (cell) classes.forEach(cls => cell.classList.add(cls));
  }

  function clearCellClass(containerId, r, c, ...classes) {
    const cell = getCell(containerId, r, c);
    if (cell) classes.forEach(cls => cell.classList.remove(cls));
  }

  // ── Setup phase rendering ─────────────────────────────
  function renderSetupBoard() {
    for (let r = 0; r < GRID; r++) {
      for (let c = 0; c < GRID; c++) {
        const cell = getCell('player-setup-grid', r, c);
        if (!cell) continue;
        cell.className = 'cell';
        if (playerBoard[r][c].shipId) cell.classList.add('ship');
      }
    }
  }

  function clearPreview() {
    for (let r = 0; r < GRID; r++) {
      for (let c = 0; c < GRID; c++) {
        clearCellClass('player-setup-grid', r, c, 'preview-valid', 'preview-invalid');
      }
    }
  }

  function onSetupHover(r, c) {
    if (!selectedShipId) return;
    const def = SHIPS_DEF.find(s => s.id === selectedShipId);
    if (!def) return;
    clearPreview();
    const valid = canPlace(playerBoard, r, c, def.size, isHorizontal);
    const cells = shipCells(r, c, def.size, isHorizontal);
    cells.forEach(({ r: pr, c: pc }) => {
      if (!inBounds(pr, pc)) return;
      setCellClass('player-setup-grid', pr, pc, valid ? 'preview-valid' : 'preview-invalid');
    });
  }

  function onSetupLeave() {
    clearPreview();
  }

  function onSetupClick(r, c) {
    if (!selectedShipId) return;
    const def = SHIPS_DEF.find(s => s.id === selectedShipId);
    if (!def) return;
    if (!canPlace(playerBoard, r, c, def.size, isHorizontal)) {
      MetaMaskManager.showToast('Cannot place ship there.', 'error');
      return;
    }
    placeShip(playerBoard, playerShips, def.id, r, c, def.size, isHorizontal);
    placedIds.add(def.id);
    clearPreview();
    renderSetupBoard();
    markShipPlaced(def.id);

    // Auto-select next unplaced ship
    const next = SHIPS_DEF.find(s => !placedIds.has(s.id));
    if (next) {
      selectShip(next.id);
    } else {
      selectedShipId = null;
      document.getElementById('battle-btn').disabled = false;
      document.getElementById('placement-hint').textContent = 'All ships placed! Ready to battle.';
      MetaMaskManager.showToast('Fleet deployed! Press BATTLE!', 'success');
    }
  }

  function selectShip(id) {
    selectedShipId = id;
    document.querySelectorAll('.ship-item').forEach(el => {
      el.classList.toggle('selected', el.dataset.shipId === id);
    });
    const def = SHIPS_DEF.find(s => s.id === id);
    document.getElementById('placement-hint').textContent =
      `Placing: ${def.name} (${def.size})`;
  }

  function markShipPlaced(id) {
    const el = document.querySelector(`.ship-item[data-ship-id="${id}"]`);
    if (el) {
      el.classList.remove('selected');
      el.classList.add('placed');
    }
  }

  function buildShipList() {
    const list = document.getElementById('ship-list');
    if (!list) return;
    list.innerHTML = '';
    SHIPS_DEF.forEach(def => {
      const item = document.createElement('div');
      item.className   = 'ship-item';
      item.dataset.shipId = def.id;

      const nameEl = document.createElement('div');
      nameEl.className = 'ship-name';
      nameEl.textContent = `${def.name} (${def.size})`;

      const bar = document.createElement('div');
      bar.className = 'ship-size-bar';
      for (let i = 0; i < def.size; i++) {
        const pip = document.createElement('div');
        pip.className = 'ship-cell-pip';
        bar.appendChild(pip);
      }

      item.appendChild(nameEl);
      item.appendChild(bar);
      item.addEventListener('click', () => {
        if (!item.classList.contains('placed')) selectShip(def.id);
      });
      list.appendChild(item);
    });
  }

  // ── Battle phase rendering ─────────────────────────────
  function renderBattleBoard(containerId, board, hideShips = false) {
    for (let r = 0; r < GRID; r++) {
      for (let c = 0; c < GRID; c++) {
        const cell = getCell(containerId, r, c);
        if (!cell) continue;
        cell.className = 'cell';
        const bCell = board[r][c];
        if (bCell.hit) {
          cell.classList.add(bCell.shipId ? 'hit' : 'miss');
        } else if (!hideShips && bCell.shipId) {
          cell.classList.add('ship');
        }
      }
    }
  }

  function markSunkOnBoard(containerId, ships, shipId) {
    const ship = ships[shipId];
    if (!ship) return;
    ship.cells.forEach(({ r, c }) => {
      const cell = getCell(containerId, r, c);
      if (cell) {
        cell.className = 'cell sunk';
      }
    });
  }

  // ── Fleet status bars ─────────────────────────────────
  function buildFleetStatus(containerId, ships) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = '';
    SHIPS_DEF.forEach(def => {
      const ship = ships[def.id];
      if (!ship) return;
      const row = document.createElement('div');
      row.className = 'fleet-ship';
      row.id = `${containerId}-ship-${def.id}`;
      for (let i = 0; i < def.size; i++) {
        const pip = document.createElement('div');
        pip.className = 'fleet-pip';
        row.appendChild(pip);
      }
      el.appendChild(row);
    });
  }

  function updateFleetStatus(containerId, ships, shipId) {
    const el = document.getElementById(`${containerId}-ship-${shipId}`);
    if (!el) return;
    el.querySelectorAll('.fleet-pip').forEach(p => p.classList.add('sunk-pip'));
  }

  // ── Fire a shot ───────────────────────────────────────
  function fireShot(containerId, board, ships, r, c) {
    // Returns: { hit: bool, sunkShipName: string|null }
    const bCell = board[r][c];
    bCell.hit = true;

    const cell = getCell(containerId, r, c);
    const result = { hit: false, sunk: null };

    if (bCell.shipId) {
      result.hit = true;
      const ship = ships[bCell.shipId];
      ship.hits++;

      // Check if sunk
      if (ship.hits === ship.cells.length) {
        ship.sunk = true;
        result.sunk = SHIPS_DEF.find(d => d.id === bCell.shipId).name;
        markSunkOnBoard(containerId, ships, bCell.shipId);
        if (cell) {
          cell.className = 'cell sunk hit-anim';
          setTimeout(() => cell.classList.remove('hit-anim'), 700);
        }
      } else {
        if (cell) {
          cell.className = 'cell hit hit-anim';
          setTimeout(() => cell.classList.remove('hit-anim'), 700);
        }
      }
    } else {
      if (cell) {
        cell.className = 'cell miss miss-anim';
        setTimeout(() => cell.classList.remove('miss-anim'), 500);
      }
    }

    return result;
  }

  // ── Player shoots ─────────────────────────────────────
  function onEnemyClick(r, c) {
    if (phase !== 'battle' || !playerTurn || aiProcessing) return;

    const bCell = aiBoard[r][c];
    if (bCell.hit) return; // already shot

    playerShots++;
    const result = fireShot('enemy-grid', aiBoard, aiShips, r, c);

    // Update HUD
    document.getElementById('shots-count').textContent = playerShots;

    if (result.hit) {
      playerHits++;
      document.getElementById('hits-count').textContent = playerHits;
      playerHits <= TOTAL_CELLS &&
        (document.getElementById('enemy-hits-label').textContent =
          `${playerHits} / ${TOTAL_CELLS} HIT`);

      // Reward
      MetaMaskManager.onHit();

      if (result.sunk) {
        playerSunk++;
        const def = SHIPS_DEF.find(d => d.name === result.sunk);
        if (def) updateFleetStatus('enemy-fleet-status', aiShips, def.id);
        MetaMaskManager.onSink(result.sunk);
        setLastMsg(`${result.sunk} SUNK!`, true);

        // Check win
        if (Object.values(aiShips).every(s => s.sunk)) {
          endGame(true);
          return;
        }
      } else {
        setLastMsg('HIT!', true);
      }
    } else {
      setLastMsg('MISS', false);
    }

    // AI's turn
    playerTurn = false;
    setTurnDisplay(false);
    aiProcessing = true;

    const delay = AI_DELAY_MIN + Math.random() * (AI_DELAY_MAX - AI_DELAY_MIN);
    setTimeout(aiTakeTurn, delay);
  }

  // ── AI shoots ─────────────────────────────────────────
  function aiTakeTurn() {
    const { r, c } = aiChooseTarget();
    ai.tried.add(`${r},${c}`);

    const result = fireShot('player-battle-grid', playerBoard, playerShips, r, c);

    // Update player-hit counter
    if (result.hit) {
      aiHitsOnPlayer++;
      document.getElementById('player-hits-label').textContent =
        `${aiHitsOnPlayer} / ${TOTAL_CELLS} HIT`;
    }

    // Update AI targeting
    if (result.sunk) {
      const def = SHIPS_DEF.find(d => d.name === result.sunk);
      if (def) updateFleetStatus('player-fleet-status', playerShips, def.id);

      // Reset targeting after sinking
      ai.mode         = 'hunt';
      ai.queue        = [];
      ai.firstHit     = null;
      ai.lastHit      = null;
      ai.direction    = null;
      ai.triedReverse = false;

      // Check if AI wins
      if (Object.values(playerShips).every(s => s.sunk)) {
        aiProcessing = false;
        endGame(false);
        return;
      }
    } else if (result.hit) {
      aiOnHit(r, c);
    } else {
      aiOnMiss();
    }

    aiProcessing = false;
    playerTurn   = true;
    setTurnDisplay(true);
  }

  function aiChooseTarget() {
    // Drain target queue first
    while (ai.queue.length > 0) {
      const next = ai.queue.shift();
      if (!ai.tried.has(`${next.r},${next.c}`) && inBounds(next.r, next.c)) {
        return next;
      }
    }

    // Hunt mode: pop from hunt pool, skipping already tried
    if (ai.mode === 'hunt') {
      // If hunt pool exhausted, fall back to full grid
      while (huntPool.length > 0) {
        const candidate = huntPool.pop();
        if (!ai.tried.has(`${candidate.r},${candidate.c}`)) {
          return candidate;
        }
      }
      // Full grid fallback
      for (let r = 0; r < GRID; r++) {
        for (let c = 0; c < GRID; c++) {
          if (!ai.tried.has(`${r},${c}`)) return { r, c };
        }
      }
    }

    // Should not reach here in a valid game
    return { r: 0, c: 0 };
  }

  function aiAdjacentCells(r, c) {
    return [
      { r: r - 1, c },
      { r: r + 1, c },
      { r,        c: c - 1 },
      { r,        c: c + 1 },
    ].filter(p => inBounds(p.r, p.c) && !ai.tried.has(`${p.r},${p.c}`));
  }

  function aiDirectionalCells(r, c, dr, dc) {
    const cells = [];
    let nr = r + dr, nc = c + dc;
    while (inBounds(nr, nc) && !ai.tried.has(`${nr},${nc}`)) {
      cells.push({ r: nr, c: nc });
      nr += dr;
      nc += dc;
    }
    return cells;
  }

  function aiOnHit(r, c) {
    if (ai.mode === 'hunt') {
      // Enter target mode
      ai.mode     = 'target';
      ai.firstHit = { r, c };
      ai.lastHit  = { r, c };
      ai.queue    = aiAdjacentCells(r, c);
    } else {
      // Determine / confirm direction
      if (!ai.direction) {
        if (r === ai.firstHit.r) {
          ai.direction = 'h';
        } else {
          ai.direction = 'v';
        }
      }
      ai.lastHit = { r, c };

      // Prioritise continuing in same direction
      const { dr, dc } = dirDelta(ai.direction);
      ai.queue = [
        ...aiDirectionalCells(r, c, dr, dc),
        ...aiDirectionalCells(ai.firstHit.r, ai.firstHit.c, -dr, -dc)
      ].filter(p => !ai.tried.has(`${p.r},${p.c}`));
    }
  }

  function aiOnMiss() {
    if (ai.mode === 'target' && ai.direction && ai.queue.length === 0 && !ai.triedReverse) {
      // Reverse direction from firstHit
      const { dr, dc } = dirDelta(ai.direction);
      ai.queue = aiDirectionalCells(ai.firstHit.r, ai.firstHit.c, -dr, -dc);
      ai.triedReverse = true;
    }
    if (ai.queue.length === 0 && ai.mode === 'target') {
      // Give up target mode (partial info – rare edge case)
      ai.mode      = 'hunt';
      ai.firstHit  = null;
      ai.direction = null;
    }
  }

  function dirDelta(dir) {
    return dir === 'h' ? { dr: 0, dc: 1 } : { dr: 1, dc: 0 };
  }

  // ── HUD helpers ───────────────────────────────────────
  function setTurnDisplay(isPlayer) {
    const el = document.getElementById('turn-display');
    if (!el) return;
    if (isPlayer) {
      el.textContent = 'YOUR TURN';
      el.classList.remove('enemy-turn');
    } else {
      el.textContent = 'ENEMY TURN';
      el.classList.add('enemy-turn');
    }
  }

  function setLastMsg(msg, isHit) {
    const el = document.getElementById('last-shot-msg');
    if (!el) return;
    el.textContent  = msg;
    el.style.color  = isHit ? 'var(--hit-glow)' : 'var(--miss-mark)';
  }

  // ── Game lifecycle ────────────────────────────────────
  function initSetup() {
    phase = 'setup';

    playerBoard  = makeBoard();
    playerShips  = {};
    placedIds    = new Set();
    selectedShipId = null;
    isHorizontal   = true;

    buildShipList();

    buildCoordLabels('setup-col-labels', 'setup-row-labels');
    buildGrid('player-setup-grid', onSetupClick, onSetupHover, onSetupLeave);
    renderSetupBoard();

    document.getElementById('battle-btn').disabled = true;
    document.getElementById('placement-hint').textContent = 'Select a ship, then click the grid.';

    // Select first ship
    selectShip(SHIPS_DEF[0].id);

    showPhase('phase-setup');
    hideOverlay();
  }

  function startBattle() {
    if (placedIds.size < SHIPS_DEF.length) {
      MetaMaskManager.showToast('Place all ships first!', 'error');
      return;
    }

    phase          = 'battle';
    playerTurn     = true;
    playerHits     = 0;
    playerShots    = 0;
    playerSunk     = 0;
    aiHitsOnPlayer = 0;
    aiProcessing   = false;

    // Set up AI board
    aiBoard  = makeBoard();
    aiShips  = {};
    randomPlaceAll(aiBoard, aiShips);

    // Set up AI targeting
    buildHuntPool();
    ai.mode         = 'hunt';
    ai.tried        = new Set();
    ai.queue        = [];
    ai.firstHit     = null;
    ai.lastHit      = null;
    ai.direction    = null;
    ai.triedReverse = false;

    // Reset MetaMask session
    MetaMaskManager.resetSession();

    // Build battle grids
    buildCoordLabels('battle-enemy-col-labels', 'battle-enemy-row-labels');
    buildCoordLabels('battle-player-col-labels', 'battle-player-row-labels');

    buildGrid('enemy-grid',          onEnemyClick, null, null);
    buildGrid('player-battle-grid',  null,         null, null);

    renderBattleBoard('enemy-grid',         aiBoard,     true);
    renderBattleBoard('player-battle-grid', playerBoard, false);

    buildFleetStatus('enemy-fleet-status',  aiShips);
    buildFleetStatus('player-fleet-status', playerShips);

    // Reset HUD
    document.getElementById('hits-count').textContent          = '0';
    document.getElementById('shots-count').textContent         = '0';
    document.getElementById('enemy-hits-label').textContent    = `0 / ${TOTAL_CELLS} HIT`;
    document.getElementById('player-hits-label').textContent   = `0 / ${TOTAL_CELLS} HIT`;
    document.getElementById('earned-count').textContent        = '0';
    setLastMsg('', false);
    setTurnDisplay(true);

    showPhase('phase-battle');
    hideOverlay();

    if (!MetaMaskManager.isConnected()) {
      MetaMaskManager.showToast('Connect MetaMask to earn 1870COIN rewards!', 'info');
    }
  }

  function endGame(playerWon) {
    phase = 'gameover';

    document.getElementById('gameover-title').textContent = playerWon ? 'YOU WIN!' : 'DEFEATED';

    const accuracy = playerShots > 0
      ? Math.round((playerHits / playerShots) * 100) + '%'
      : '0%';

    document.getElementById('go-shots').textContent    = playerShots;
    document.getElementById('go-accuracy').textContent = accuracy;
    document.getElementById('go-sunk').textContent     = playerSunk;
    document.getElementById('go-tokens').textContent   =
      `${MetaMaskManager.getSessionEarned()} 1870`;

    if (playerWon) {
      MetaMaskManager.onWin();
    }

    setTimeout(() => showScreen('screen-gameover'), 600);
  }

  // ── Phase display ─────────────────────────────────────
  function showPhase(id) {
    document.querySelectorAll('.phase').forEach(p => p.classList.remove('active'));
    const el = document.getElementById(id);
    if (el) el.classList.add('active');
  }

  // ── Wire up buttons ───────────────────────────────────
  document.getElementById('start-btn').addEventListener('click', initSetup);

  document.getElementById('rotate-btn').addEventListener('click', () => {
    isHorizontal = !isHorizontal;
    document.getElementById('rotate-btn').textContent =
      isHorizontal ? '↻ ROTATE' : '↺ ROTATE (V)';
  });

  document.getElementById('random-btn').addEventListener('click', () => {
    // Clear board and re-place randomly
    playerBoard = makeBoard();
    playerShips = {};
    placedIds   = new Set();
    randomPlaceAll(playerBoard, playerShips);
    SHIPS_DEF.forEach(d => placedIds.add(d.id));

    buildShipList();
    SHIPS_DEF.forEach(d => markShipPlaced(d.id));
    renderSetupBoard();

    selectedShipId = null;
    document.getElementById('battle-btn').disabled = false;
    document.getElementById('placement-hint').textContent = 'All ships placed! Ready to battle.';
    MetaMaskManager.showToast('Fleet randomly deployed!', 'success');
  });

  document.getElementById('clear-btn').addEventListener('click', () => {
    playerBoard    = makeBoard();
    playerShips    = {};
    placedIds      = new Set();
    isHorizontal   = true;
    selectedShipId = null;

    buildShipList();
    renderSetupBoard();
    clearPreview();

    document.getElementById('battle-btn').disabled = true;
    document.getElementById('rotate-btn').textContent = '↻ ROTATE';
    document.getElementById('placement-hint').textContent = 'Select a ship, then click the grid.';
    selectShip(SHIPS_DEF[0].id);
  });

  document.getElementById('battle-btn').addEventListener('click', startBattle);

  document.getElementById('play-again-btn').addEventListener('click', initSetup);

  document.getElementById('wallet-skip-btn').addEventListener('click', () => {
    showScreen('screen-start');
  });

  // ── Show start screen ─────────────────────────────────
  showScreen('screen-start');

  return { initSetup, startBattle, endGame };

})();
