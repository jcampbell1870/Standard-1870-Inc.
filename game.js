/* =========================================================
   game.js — 1972 Atari Pong, faithful recreation
   =========================================================
   Physics as close to the original cabinet as possible:
   • Segmented paddle collision to add angle variation
   • Ball speeds up slightly after each rally
   • CPU AI with intentional imperfection
   • Winning score: 11 points (original Pong standard)
   ========================================================= */

'use strict';

const PongGame = (() => {

  // ── Config ────────────────────────────────────────────
  const WIN_SCORE    = 11;
  const PADDLE_W     = 12;
  const PADDLE_H     = 60;
  const BALL_SIZE    = 10;
  const BASE_BALL_SPEED = 5.0;
  const MAX_BALL_SPEED  = 14.0;
  const SPEED_INCREMENT = 0.25;   // added after each paddle hit
  const CPU_BASE_SPEED  = 3.8;    // CPU max speed per frame
  const CPU_ERROR_ZONE  = 18;     // px dead-zone for CPU imperfection

  // ── Canvas setup ─────────────────────────────────────
  const canvas = document.getElementById('pong-canvas');
  const ctx    = canvas.getContext('2d');
  const W      = canvas.width;
  const H      = canvas.height;

  // ── Game state ────────────────────────────────────────
  let running       = false;
  let paused        = false;
  let animFrameId   = null;
  let playerScore   = 0;
  let cpuScore      = 0;
  let ralliesPlayed = 0;   // total rally hits this game
  let pointsScored  = 0;   // total points scored this game (player only or both)

  // Paddles
  const player = { x: 20,        y: H / 2 - PADDLE_H / 2, dy: 0 };
  const cpu    = { x: W - 20 - PADDLE_W, y: H / 2 - PADDLE_H / 2, dy: 0 };

  // Ball
  const ball = { x: W / 2, y: H / 2, dx: 0, dy: 0, speed: BASE_BALL_SPEED };

  // ── Input ─────────────────────────────────────────────
  const keys = {};
  document.addEventListener('keydown', e => { keys[e.key] = true; });
  document.addEventListener('keyup',   e => { keys[e.key] = false; });

  // ── DOM refs ──────────────────────────────────────────
  const playerScoreEl = document.getElementById('player-score');
  const cpuScoreEl    = document.getElementById('cpu-score');
  const goRallies     = document.getElementById('go-rallies');
  const goPoints      = document.getElementById('go-points');

  // ── Utilities ─────────────────────────────────────────
  function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
  }

  function randomSign() { return Math.random() < 0.5 ? 1 : -1; }

  /** Serve ball from center with random direction */
  function resetBall(serveDir = 0) {
    ball.x     = W / 2;
    ball.y     = H / 2;
    ball.speed = BASE_BALL_SPEED;

    const angle = (Math.random() * 40 - 20) * (Math.PI / 180);
    const dir   = serveDir !== 0 ? serveDir : randomSign();
    ball.dx = dir * ball.speed * Math.cos(angle);
    ball.dy = ball.speed * Math.sin(angle) * randomSign();
  }

  function resetPaddles() {
    player.y = H / 2 - PADDLE_H / 2;
    cpu.y    = H / 2 - PADDLE_H / 2;
    player.dy = 0;
    cpu.dy    = 0;
  }

  // ── Draw helpers ──────────────────────────────────────
  function drawRect(x, y, w, h, color = '#fff') {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  }

  function drawCenterLine() {
    ctx.setLineDash([10, 14]);
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(W / 2, 0);
    ctx.lineTo(W / 2, H);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawBall() {
    // Original Pong had a square ball
    drawRect(ball.x - BALL_SIZE / 2, ball.y - BALL_SIZE / 2, BALL_SIZE, BALL_SIZE);
  }

  function drawPaddle(p, glowColor = '#fff') {
    ctx.save();
    ctx.shadowBlur  = 12;
    ctx.shadowColor = glowColor;
    drawRect(p.x, p.y, PADDLE_W, PADDLE_H);
    ctx.restore();
  }

  // ── Physics ───────────────────────────────────────────

  /** Calculate deflection angle based on where ball hits paddle */
  function paddleDeflectDy(paddleY, hitY) {
    // Normalise hit position: -1 (top) to +1 (bottom)
    const relativeHit = (hitY - (paddleY + PADDLE_H / 2)) / (PADDLE_H / 2);
    const maxBounceAngle = 60 * (Math.PI / 180);
    return ball.speed * Math.sin(relativeHit * maxBounceAngle);
  }

  function moveBall() {
    ball.x += ball.dx;
    ball.y += ball.dy;

    // Top / bottom wall bounce
    if (ball.y - BALL_SIZE / 2 <= 0) {
      ball.y  = BALL_SIZE / 2;
      ball.dy = Math.abs(ball.dy);
    } else if (ball.y + BALL_SIZE / 2 >= H) {
      ball.y  = H - BALL_SIZE / 2;
      ball.dy = -Math.abs(ball.dy);
    }

    // Player paddle collision
    if (
      ball.dx < 0 &&
      ball.x - BALL_SIZE / 2 <= player.x + PADDLE_W &&
      ball.x + BALL_SIZE / 2 >= player.x &&
      ball.y >= player.y &&
      ball.y <= player.y + PADDLE_H
    ) {
      ball.x  = player.x + PADDLE_W + BALL_SIZE / 2;
      ball.speed = Math.min(ball.speed + SPEED_INCREMENT, MAX_BALL_SPEED);
      ball.dy = paddleDeflectDy(player.y, ball.y);
      ball.dx = ball.speed * Math.cos(Math.atan2(ball.dy, Math.abs(ball.dx)));
      ralliesPlayed++;
      MetaMaskManager.onRally();
    }

    // CPU paddle collision
    if (
      ball.dx > 0 &&
      ball.x + BALL_SIZE / 2 >= cpu.x &&
      ball.x - BALL_SIZE / 2 <= cpu.x + PADDLE_W &&
      ball.y >= cpu.y &&
      ball.y <= cpu.y + PADDLE_H
    ) {
      ball.x  = cpu.x - BALL_SIZE / 2;
      ball.speed = Math.min(ball.speed + SPEED_INCREMENT, MAX_BALL_SPEED);
      ball.dy = paddleDeflectDy(cpu.y, ball.y);
      ball.dx = -ball.speed * Math.cos(Math.atan2(ball.dy, Math.abs(ball.dx)));
      ralliesPlayed++;
      MetaMaskManager.onRally();
    }
  }

  function checkScoring() {
    // CPU scores (ball exits left)
    if (ball.x + BALL_SIZE / 2 < 0) {
      cpuScore++;
      cpuScoreEl.textContent = cpuScore;
      pointsScored++;
      MetaMaskManager.onPoint();
      resetBall(1);    // serve toward player
      resetPaddles();
      checkWin();
      return;
    }

    // Player scores (ball exits right)
    if (ball.x - BALL_SIZE / 2 > W) {
      playerScore++;
      playerScoreEl.textContent = playerScore;
      pointsScored++;
      MetaMaskManager.onPoint();
      resetBall(-1);   // serve toward CPU
      resetPaddles();
      checkWin();
    }
  }

  function checkWin() {
    if (playerScore >= WIN_SCORE || cpuScore >= WIN_SCORE) {
      endGame();
    }
  }

  // ── Player input ──────────────────────────────────────
  function handlePlayerInput() {
    const speed = 7;
    if (keys['w'] || keys['W'] || keys['ArrowUp']) {
      player.dy = -speed;
    } else if (keys['s'] || keys['S'] || keys['ArrowDown']) {
      player.dy = speed;
    } else {
      player.dy = 0;
    }
    player.y = clamp(player.y + player.dy, 0, H - PADDLE_H);
  }

  // ── CPU AI ────────────────────────────────────────────
  function moveCpu() {
    const cpuCenter = cpu.y + PADDLE_H / 2;
    const target    = ball.y;
    const diff      = target - cpuCenter;

    // Only move if outside the error zone (makes CPU beatable)
    if (Math.abs(diff) > CPU_ERROR_ZONE) {
      const dir  = diff > 0 ? 1 : -1;
      // Slow down AI when ball is moving away
      const mult = ball.dx < 0 ? 0.6 : 1.0;
      cpu.y += clamp(dir * CPU_BASE_SPEED * mult, -CPU_BASE_SPEED, CPU_BASE_SPEED);
    }
    cpu.y = clamp(cpu.y, 0, H - PADDLE_H);
  }

  // ── Render ────────────────────────────────────────────
  function render() {
    // Clear
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    drawCenterLine();
    drawPaddle(player, '#37c0ff');
    drawPaddle(cpu,    '#f6851b');
    drawBall();
  }

  // ── Game loop ─────────────────────────────────────────
  function loop() {
    if (!running || paused) return;

    handlePlayerInput();
    moveCpu();
    moveBall();
    checkScoring();
    render();

    animFrameId = requestAnimationFrame(loop);
  }

  // ── Game lifecycle ────────────────────────────────────
  function startGame() {
    playerScore   = 0;
    cpuScore      = 0;
    ralliesPlayed = 0;
    pointsScored  = 0;

    playerScoreEl.textContent = '0';
    cpuScoreEl.textContent    = '0';

    MetaMaskManager.resetSession();
    resetPaddles();
    resetBall();

    running = true;
    paused  = false;

    hideOverlay();
    loop();

    if (!MetaMaskManager.isConnected()) {
      MetaMaskManager.showToast('Play without wallet — connect MetaMask to earn ETH!', 'info');
    }
  }

  function endGame() {
    running = false;
    cancelAnimationFrame(animFrameId);

    // Final render
    render();

    // Populate game-over screen
    const winner = playerScore >= WIN_SCORE ? 'YOU WIN!' : 'CPU WINS';
    document.getElementById('gameover-title').textContent = winner;
    if (goRallies) goRallies.textContent = ralliesPlayed;
    if (goPoints)  goPoints.textContent  = pointsScored;

    setTimeout(() => showScreen('screen-gameover'), 400);
  }

  // ── Wire up buttons ───────────────────────────────────
  document.getElementById('start-btn').addEventListener('click', startGame);
  document.getElementById('play-again-btn').addEventListener('click', startGame);
  document.getElementById('wallet-skip-btn').addEventListener('click', () => {
    showScreen('screen-start');
  });

  // ── Initial render (idle frame) ───────────────────────
  (function idleRender() {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    drawCenterLine();

    // Draw paddles at rest
    ctx.save();
    ctx.shadowBlur = 12;
    ctx.shadowColor = '#37c0ff';
    drawRect(player.x, player.y, PADDLE_W, PADDLE_H);
    ctx.restore();

    ctx.save();
    ctx.shadowBlur = 12;
    ctx.shadowColor = '#f6851b';
    drawRect(cpu.x, cpu.y, PADDLE_W, PADDLE_H);
    ctx.restore();

    // Draw ball at center
    drawRect(W / 2 - BALL_SIZE / 2, H / 2 - BALL_SIZE / 2, BALL_SIZE, BALL_SIZE);
  })();

  return { startGame, endGame };

})();
