let previousState = null;
let currentSaldo  = 1000;
let currentBet    = 0;
let chipHistory   = [];
let lastKnownBet  = 0;
let currentMode   = "digital";

window.gameState = {
  currentMode     : "digital",
  waitingFor      : null,
  isAnimating     : false,
  consumedClasses : new Set(),
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Knappar och UI-hjälpfunktioner
// ---------------------------------------------------------------------------

function disableAllButtons() {
  ["newRound", "actionHit", "actionStand", "actionDouble"].forEach((id) => {
    document.getElementById(id).disabled = true;
  });
}

function updateButtons(actions) {
  document.getElementById("actionHit").disabled    = !actions.includes("hit");
  document.getElementById("actionStand").disabled  = !actions.includes("stand");
  document.getElementById("actionDouble").disabled = !actions.includes("double");
}

function updateStatusBanner(state) {
  const el = document.getElementById("statusBanner");
  el.textContent = statusMessage(state);
  const isWaiting = state.mode === "camera" && state.waiting_for;
  el.classList.toggle("in-progress", state.status === "in_progress" && !isWaiting);
}

function clearStatusBanner() {
  const el = document.getElementById("statusBanner");
  el.textContent = "";
  el.classList.remove("in-progress");
}

function clearCards() {
  document.getElementById("dealerCards").innerHTML = "";
  document.getElementById("playerCards").innerHTML = "";
}

function hideValueBadges() {
  document.getElementById("playerValue").classList.add("hidden");
  document.getElementById("dealerValue").classList.add("hidden");
}

function updateValueBadges(state) {
  const pvEl = document.getElementById("playerValue");
  if (state.player_hand.cards.length > 0) {
    pvEl.textContent = state.player_hand.value;
    pvEl.classList.remove("hidden");
  } else {
    pvEl.classList.add("hidden");
  }

  const dvEl = document.getElementById("dealerValue");
  const hasBackCard = state.dealer_hand.cards.some((c) => c === "back");
  // Visa dealervärdet under dealer_hit-fasen (hålkortet är avslöjat)
  const inDealerHitPhase = state.waiting_for === "dealer_hit";
  if (hasBackCard || (state.status === "in_progress" && !inDealerHitPhase)) {
    dvEl.classList.add("hidden");
  } else if (state.dealer_hand.cards.length > 0) {
    dvEl.textContent = state.dealer_hand.value;
    dvEl.classList.remove("hidden");
  } else {
    dvEl.classList.add("hidden");
  }
}

function updatePlayerValueDisplay(hand) {
  const el = document.getElementById("playerValue");
  if (hand.cards.length > 0) {
    el.textContent = hand.value;
    el.classList.remove("hidden");
  } else {
    el.classList.add("hidden");
  }
}

function updateDealerValueDisplay(hand) {
  const el = document.getElementById("dealerValue");
  if (hand.cards.some((c) => c === "back")) {
    el.classList.add("hidden");
  } else if (hand.cards.length > 0) {
    el.textContent = hand.value;
    el.classList.remove("hidden");
  } else {
    el.classList.add("hidden");
  }
}

function updateSaldoDisplay() {
  const el = document.getElementById("saldoValue");
  el.textContent = currentSaldo;
  el.classList.remove("saldo-flash");
  void el.offsetWidth;
  el.classList.add("saldo-flash");
  el.addEventListener("animationend", () => el.classList.remove("saldo-flash"), { once: true });
}

function setBetDisplay(amount) {
  const label = document.getElementById("betAmountLabel");
  if (amount === 0) {
    label.setAttribute("hidden", "");
  } else {
    document.getElementById("betAmountDisplay").textContent = amount;
    label.removeAttribute("hidden");
  }
  const circle = document.getElementById("betCircle");
  circle.classList.remove("bet-pulse");
  void circle.offsetWidth;
  circle.classList.add("bet-pulse");
  circle.addEventListener("animationend", () => circle.classList.remove("bet-pulse"), { once: true });
}

// ---------------------------------------------------------------------------
// Mini-chip hjälpfunktioner
// ---------------------------------------------------------------------------

function createMiniChip(value) {
  const colorClass = { 10: "chip-10", 25: "chip-25", 50: "chip-50", 100: "chip-100", 250: "chip-250" }[value] || "";
  const div = document.createElement("div");
  div.className = `chip-mini ${colorClass}`;
  const span = document.createElement("span");
  span.textContent = value;
  div.appendChild(span);
  return div;
}

function renderChipStack() {
  const stack = document.getElementById("chipStack");
  stack.innerHTML = "";
  chipHistory.forEach((val, i) => {
    const chip = createMiniChip(val);
    chip.style.transform = `translateY(${-i * 6}px)`;
    stack.appendChild(chip);
  });
}

function clearChipStack(animated = false) {
  const stack = document.getElementById("chipStack");
  if (!animated || !stack.children.length) {
    stack.innerHTML = "";
    return;
  }
  Array.from(stack.children).forEach((c) => {
    c.style.transition = "opacity 0.2s ease";
    c.style.opacity = "0";
  });
  setTimeout(() => { stack.innerHTML = ""; }, 210);
}

async function animateChipToCircle(chipValue, sourceEl) {
  const flying = document.createElement("div");
  flying.className = `chip-flying chip-${chipValue}`;
  const span = document.createElement("span");
  span.textContent = chipValue;
  flying.appendChild(span);

  const srcRect   = sourceEl.getBoundingClientRect();
  const circleRect = document.getElementById("betCircle").getBoundingClientRect();
  const srcX = srcRect.left  + (srcRect.width  - 44) / 2;
  const srcY = srcRect.top   + (srcRect.height - 44) / 2;
  const dstX = circleRect.left + (circleRect.width  - 44) / 2;
  const dstY = circleRect.top  + (circleRect.height - 44) / 2;

  flying.style.left = `${srcX}px`;
  flying.style.top  = `${srcY}px`;
  document.body.appendChild(flying);
  void flying.offsetWidth;

  flying.style.transition = "transform 0.4s cubic-bezier(0.25,0.46,0.45,0.94), opacity 0.4s ease";
  flying.style.transform  = `translate(${dstX - srcX}px, ${dstY - srcY}px)`;

  await sleep(420);
  flying.remove();
  renderChipStack();
  setBetDisplay(currentBet);
}

function animateChipBackToSelector(chipValue, sourceMiniChip, delay = 0) {
  const targetBtn = document.querySelector(`.chip[data-value="${chipValue}"]`);
  if (!targetBtn) return;

  setTimeout(() => {
    if (!sourceMiniChip.isConnected) return;

    const srcRect = sourceMiniChip.getBoundingClientRect();
    const dstRect = targetBtn.getBoundingClientRect();

    const flying = document.createElement("div");
    flying.className = `chip-flying chip-${chipValue}`;
    const span = document.createElement("span");
    span.textContent = chipValue;
    flying.appendChild(span);

    flying.style.left = `${srcRect.left}px`;
    flying.style.top  = `${srcRect.top}px`;
    sourceMiniChip.remove();
    document.body.appendChild(flying);
    void flying.offsetWidth;

    const dstX = dstRect.left + (dstRect.width  - 44) / 2;
    const dstY = dstRect.top  + (dstRect.height - 44) / 2;

    flying.style.transition = "transform 0.4s cubic-bezier(0.55,0.085,0.68,0.53)";
    flying.style.transform  = `translate(${dstX - srcRect.left}px, ${dstY - srcRect.top}px)`;

    setTimeout(() => {
      flying.remove();
      targetBtn.classList.add("chip-receive-pulse");
      targetBtn.addEventListener("animationend", () => targetBtn.classList.remove("chip-receive-pulse"), { once: true });
    }, 420);
  }, delay);
}

// ---------------------------------------------------------------------------
// Generaliserade chip-flyg-funktioner (rondslutsflöden)
// ---------------------------------------------------------------------------

function breakAmountIntoChips(amount) {
  const denoms  = [250, 100, 50, 25, 10];
  const result  = [];
  let remaining = Math.floor(Math.max(0, amount));
  for (const d of denoms) {
    while (remaining >= d) { result.push(d); remaining -= d; }
  }
  return result;
}

function animateChipFlight(chipValue, sourceRect, targetEl, options = {}) {
  const {
    delay    = 0,
    onLand   = null,
    easing   = "cubic-bezier(0.25,0.46,0.45,0.94)",
    duration = 450,
  } = options;
  const srcX = sourceRect.left + (sourceRect.width  - 44) / 2;
  const srcY = sourceRect.top  + (sourceRect.height - 44) / 2;
  return new Promise((resolve) => {
    setTimeout(() => {
      const dstRect = targetEl.getBoundingClientRect();
      const dstX = dstRect.left + (dstRect.width  - 44) / 2;
      const dstY = dstRect.top  + (dstRect.height - 44) / 2;
      const flying = document.createElement("div");
      flying.className = `chip-flying chip-${chipValue}`;
      const span = document.createElement("span");
      span.textContent = chipValue;
      flying.appendChild(span);
      flying.style.left = `${srcX}px`;
      flying.style.top  = `${srcY}px`;
      document.body.appendChild(flying);
      void flying.offsetWidth;
      flying.style.transition = `transform ${duration}ms ${easing}`;
      flying.style.transform  = `translate(${dstX - srcX}px, ${dstY - srcY}px)`;
      setTimeout(() => { flying.remove(); if (onLand) onLand(); resolve(); }, duration + 20);
    }, delay);
  });
}

async function batchAnimateChips(chipValues, getSourceRect, targetEl, options = {}) {
  const {
    staggerMs   = 120,
    onEachLand  = null,
    onAllLanded = null,
    easing      = "cubic-bezier(0.25,0.46,0.45,0.94)",
    duration    = 450,
  } = options;
  const promises = chipValues.map((val, i) => {
    const srcRect = typeof getSourceRect === "function" ? getSourceRect(val, i) : getSourceRect;
    if (!srcRect) return Promise.resolve();
    return animateChipFlight(val, srcRect, targetEl, {
      delay : i * staggerMs,
      onLand: onEachLand ? () => onEachLand(val, i) : null,
      easing,
      duration,
    });
  });
  await Promise.all(promises);
  if (onAllLanded) onAllLanded();
}

// ---------------------------------------------------------------------------
// Rondslut-animationer
// ---------------------------------------------------------------------------

async function animateWin(state) {
  const betCircleEl    = document.getElementById("betCircle");
  const dealerRackEl   = document.getElementById("dealerRack");
  const dealerRackRect = dealerRackEl.getBoundingClientRect();
  const winChips = breakAmountIntoChips(state.last_payout || 0);

  if (winChips.length > 0) {
    await batchAnimateChips(winChips, dealerRackRect, betCircleEl, {
      staggerMs  : 120,
      onEachLand : (val) => { chipHistory.push(val); renderChipStack(); },
    });
    await sleep(250);
  }

  const stack     = document.getElementById("chipStack");
  const miniChips = Array.from(stack.children);
  const rects     = miniChips.map((c) => c.getBoundingClientRect());
  stack.innerHTML = "";
  const allChips      = [...chipHistory].reverse();
  const rectsReversed = [...rects].reverse();
  const walletEl      = document.getElementById("walletPanel");

  await batchAnimateChips(allChips, (_, i) => rectsReversed[i], walletEl, {
    staggerMs  : 100,
    onEachLand : (val) => { currentSaldo += val; updateSaldoDisplay(); },
    onAllLanded: () => {
      chipHistory = []; currentBet = 0; renderChipStack();
      currentSaldo = state.saldo;
      document.getElementById("saldoValue").textContent = currentSaldo;
    },
  });
}

async function animateLoss(state) {
  const stack     = document.getElementById("chipStack");
  const miniChips = Array.from(stack.children);
  const rects     = miniChips.map((c) => c.getBoundingClientRect());
  stack.innerHTML = "";
  const chips         = [...chipHistory].reverse();
  const rectsReversed = [...rects].reverse();
  const dealerRackEl  = document.getElementById("dealerRack");

  await batchAnimateChips(chips, (_, i) => rectsReversed[i], dealerRackEl, {
    staggerMs  : 100,
    easing     : "cubic-bezier(0.55,0.085,0.68,0.53)",
    onAllLanded: () => {
      chipHistory = []; currentBet = 0; renderChipStack();
      currentSaldo = state.saldo;
      document.getElementById("saldoValue").textContent = currentSaldo;
    },
  });
}

async function animatePush(state) {
  const stack     = document.getElementById("chipStack");
  const miniChips = Array.from(stack.children);
  const rects     = miniChips.map((c) => c.getBoundingClientRect());
  stack.innerHTML = "";
  const chips         = [...chipHistory].reverse();
  const rectsReversed = [...rects].reverse();
  const walletEl      = document.getElementById("walletPanel");

  await batchAnimateChips(chips, (_, i) => rectsReversed[i], walletEl, {
    staggerMs  : 100,
    onEachLand : (val) => { currentSaldo += val; updateSaldoDisplay(); },
    onAllLanded: () => {
      chipHistory = []; currentBet = 0; renderChipStack();
      currentSaldo = state.saldo;
      document.getElementById("saldoValue").textContent = currentSaldo;
    },
  });
}

async function animateDoubleDown(chipsToDouble) {
  const betCircleEl = document.getElementById("betCircle");
  await batchAnimateChips(
    chipsToDouble,
    (val) => {
      const btn = document.querySelector(`.chip[data-value="${val}"]`);
      return btn
        ? btn.getBoundingClientRect()
        : document.getElementById("chipSelector").getBoundingClientRect();
    },
    betCircleEl,
    {
      staggerMs  : 120,
      onEachLand : (val) => {
        chipHistory.push(val); currentBet += val;
        renderChipStack(); setBetDisplay(currentBet);
      },
    }
  );
}

function updateWalletUI(state) {
  currentSaldo = state.saldo;
  updateSaldoDisplay();

  if (currentSaldo === 0) {
    document.getElementById("resetBtn").removeAttribute("hidden");
  } else {
    document.getElementById("resetBtn").setAttribute("hidden", "");
  }
}

function updateNewRoundButton() {
  document.getElementById("newRound").disabled =
    currentBet === 0 || currentSaldo < currentBet;
}

function updateUndoButton() {
  document.getElementById("undoBetBtn").disabled = chipHistory.length === 0;
}

function updateChipControls(state) {
  const inProgress = state.status === "in_progress";
  document.querySelectorAll(".chip").forEach((btn) => { btn.disabled = inProgress; });
  document.getElementById("clearBetBtn").disabled = inProgress;
  document.getElementById("undoBetBtn").disabled = inProgress || chipHistory.length === 0;
}

// ---------------------------------------------------------------------------
// Animationsfunktion — ett kort glider från kortleken och flippar
// ---------------------------------------------------------------------------

async function slideAndFlipCard(cardCode, containerId, stayFaceDown) {
  const container = document.getElementById(containerId);

  const wrapper = document.createElement("div");
  wrapper.innerHTML = renderCard(cardCode);
  const cardEl = wrapper.firstElementChild;
  const flipEl = cardEl.querySelector(".card-flip");
  flipEl.classList.add("face-down");

  const deckEl = document.querySelector(".deck-stack");

  if (!deckEl) {
    console.warn("slideAndFlipCard: .deck-stack not found, using fade-in fallback");
    cardEl.style.opacity = "0";
    container.appendChild(cardEl);
    void cardEl.offsetWidth;
    cardEl.style.transition = "opacity 0.3s ease";
    cardEl.style.opacity = "1";
    await sleep(350);
    if (!stayFaceDown) {
      flipEl.classList.remove("face-down");
      await sleep(480);
    }
    return;
  }

  const deckRect = deckEl.getBoundingClientRect();

  cardEl.style.opacity    = "0";
  cardEl.style.transition = "none";
  container.appendChild(cardEl);

  const finalRect = cardEl.getBoundingClientRect();
  const dx = deckRect.left - finalRect.left;
  const dy = deckRect.top  - finalRect.top;

  cardEl.style.transform = `translate(${dx}px, ${dy}px) scale(0.95)`;
  cardEl.style.opacity   = "1";

  void cardEl.offsetWidth;

  cardEl.style.transition = "transform 0.35s ease-out";
  cardEl.style.transform  = "translate(0, 0) scale(1)";

  await sleep(400);

  cardEl.style.transition = "";
  cardEl.style.transform  = "";

  if (!stayFaceDown) {
    flipEl.classList.remove("face-down");
    await sleep(480);
  }
}

// ---------------------------------------------------------------------------
// Kameraläge — flippa dealer-hålkort när det avslöjas
// ---------------------------------------------------------------------------

async function flipRevealedHoleCard(oldDealerCards, newDealerCards) {
  const backIdx = oldDealerCards.indexOf("back");
  if (backIdx === -1) return;
  if (newDealerCards[backIdx] === "back") return;

  const actualCode = newDealerCards[backIdx];
  const dealerCardEls = document.querySelectorAll("#dealerCards .card-element");
  const holeEl = dealerCardEls[backIdx];
  if (!holeEl) return;

  const flipEl  = holeEl.querySelector(".card-flip");
  const frontEl = holeEl.querySelector(".card-front");
  if (!flipEl || !frontEl) return;

  const dashIdx = actualCode.lastIndexOf("-");
  const rank    = actualCode.slice(0, dashIdx);
  const suit    = actualCode.slice(dashIdx + 1);
  const label   = RANK_LABEL[rank] || rank;
  const symbol  = SUIT_SYMBOL[suit];
  const color   = SUIT_COLOR[suit];

  frontEl.className = `card-front ${color}`;
  frontEl.innerHTML =
    `<div class="card-corner top-left">` +
      `<span class="corner-rank">${label}</span>` +
      `<span class="corner-suit">${symbol}</span>` +
    `</div>` +
    `<div class="card-center">${symbol}</div>` +
    `<div class="card-corner bottom-right">` +
      `<span class="corner-rank">${label}</span>` +
      `<span class="corner-suit">${symbol}</span>` +
    `</div>`;

  flipEl.classList.remove("face-down");
  await sleep(480);
}

// ---------------------------------------------------------------------------
// Huvudfunktion — renderar en round-state sekventiellt
// ---------------------------------------------------------------------------

function isNewRound(oldState, newState) {
  if (!oldState) return true;
  return oldState.status !== "in_progress" && newState.status === "in_progress";
}

async function renderRound(state) {
  window.gameState.isAnimating = true;
  window.gameState.waitingFor  = state.waiting_for;

  try {
    const oldState = previousState;

    if (isNewRound(oldState, state)) {
      clearCards();
      clearStatusBanner();
      hideValueBadges();

      if (state.mode === "camera") {
        window.gameState.consumedClasses.clear();
      } else {
        // Digital: animera alla 4 kort direkt
        const p = state.player_hand.cards;
        const d = state.dealer_hand.cards;
        await slideAndFlipCard(p[0], "playerCards", false);
        await slideAndFlipCard(d[0], "dealerCards", false);
        await slideAndFlipCard(p[1], "playerCards", false);
        await slideAndFlipCard(d[1], "dealerCards", state.status === "in_progress");
        updatePlayerValueDisplay(state.player_hand);
      }
      // Kameraläge: inga kort ännu — de matas in ett i taget via feed_card

    } else {
      // Kameraläge: avslöja hålkort om det byttes från 'back' till verkligt kort
      if (state.mode === "camera") {
        const oldDealerCards = oldState ? oldState.dealer_hand.cards : [];
        await flipRevealedHoleCard(oldDealerCards, state.dealer_hand.cards);
        updateDealerValueDisplay(state.dealer_hand);
      }

      // Animera nya spelarkort
      const oldP = oldState ? oldState.player_hand.cards.length : 0;
      const newP = state.player_hand.cards.length;
      for (let i = oldP; i < newP; i++) {
        await slideAndFlipCard(state.player_hand.cards[i], "playerCards", false);
        updatePlayerValueDisplay(state.player_hand);
      }

      // Digital: flippa hålkort vid rondslut
      if (state.mode !== "camera") {
        const justResolved =
          oldState &&
          oldState.status === "in_progress" &&
          state.status !== "in_progress";

        if (justResolved) {
          const holeFlip = document.querySelector(
            "#dealerCards .card-element:nth-child(2) .card-flip.face-down"
          );
          if (holeFlip) {
            holeFlip.classList.remove("face-down");
            await sleep(480);
          }
          updateDealerValueDisplay(state.dealer_hand);
        }
      }

      // Animera nya dealerkort
      const oldD = oldState ? oldState.dealer_hand.cards.length : 0;
      const newD = state.dealer_hand.cards.length;
      for (let i = oldD; i < newD; i++) {
        const cardCode = state.dealer_hand.cards[i];
        await slideAndFlipCard(cardCode, "dealerCards", cardCode === "back");
        if (cardCode !== "back") updateDealerValueDisplay(state.dealer_hand);
      }
    }

    // Synca lastKnownBet för double-down optimistisk deduktion
    lastKnownBet = state.bet;

    // Chip-animationer vid rondslut (saldo tickar upp via onEachLand-callbacks)
    if (state.status === "in_progress") {
      setBetDisplay(state.bet);
    } else if (["player_wins", "dealer_bust", "player_blackjack"].includes(state.status)) {
      await animateWin(state);
      setBetDisplay(0);
    } else if (state.status === "push") {
      await animatePush(state);
      setBetDisplay(0);
    } else {
      await animateLoss(state);
      setBetDisplay(0);
    }

    // Allt animerat klart — uppdatera status, badges, knappar, plånbok och chips
    updateStatusBanner(state);
    updateValueBadges(state);

    if (state.status === "in_progress") {
      updateWalletUI(state);
    } else {
      if (currentSaldo === 0) document.getElementById("resetBtn").removeAttribute("hidden");
      else document.getElementById("resetBtn").setAttribute("hidden", "");
    }

    updateButtons(state.available_actions);
    updateChipControls(state);
    updateNewRoundButton();
    updateUndoButton();

    previousState = state;

  } finally {
    window.gameState.isAnimating = false;
  }
}

// ---------------------------------------------------------------------------
// Fetch-hantering
// ---------------------------------------------------------------------------

async function postAction(url, fetchOptions = {}, onError) {
  disableAllButtons();
  try {
    const res  = await fetch(url, { method: "POST", ...fetchOptions });
    const data = await res.json();
    if (data.error) {
      if (onError) onError();
      document.getElementById("statusBanner").textContent = `Error: ${data.error}`;
    } else {
      await renderRound(data);
    }
  } catch {
    if (onError) onError();
    document.getElementById("statusBanner").textContent =
      "Network error — is the backend running?";
  }
  updateNewRoundButton();
}

// Exponeras till camera.js för automatisk kortmatning
window.handleStateUpdate = async (state) => {
  if (state.error) {
    document.getElementById("statusBanner").textContent = `Error: ${state.error}`;
    return;
  }
  await renderRound(state);
  updateNewRoundButton();
};

// ---------------------------------------------------------------------------
// Chip-logik
// ---------------------------------------------------------------------------

document.querySelectorAll(".chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    const val = parseInt(chip.dataset.value, 10);
    if (currentBet + val > currentSaldo) {
      chip.classList.add("chip-shake");
      chip.addEventListener("animationend", () => chip.classList.remove("chip-shake"), { once: true });
      return;
    }
    chipHistory.push(val);
    currentBet += val;
    updateNewRoundButton();
    updateUndoButton();
    animateChipToCircle(val, chip);
  });
});

document.getElementById("undoBetBtn").addEventListener("click", () => {
  if (chipHistory.length === 0) return;
  const lastValue = chipHistory[chipHistory.length - 1];
  const stack     = document.getElementById("chipStack");
  const topChip   = stack.lastElementChild;

  chipHistory.pop();
  currentBet -= lastValue;

  if (topChip) {
    animateChipBackToSelector(lastValue, topChip);
  }

  setBetDisplay(currentBet);
  updateNewRoundButton();
  updateUndoButton();
});

document.getElementById("clearBetBtn").addEventListener("click", () => {
  const stack         = document.getElementById("chipStack");
  const miniChips     = Array.from(stack.children);
  const historySnap   = [...chipHistory];

  chipHistory = [];
  currentBet  = 0;
  updateNewRoundButton();
  updateUndoButton();

  // Slide back from top to bottom with stagger
  historySnap.reverse().forEach((val, i) => {
    const miniChip = miniChips[miniChips.length - 1 - i];
    if (miniChip) animateChipBackToSelector(val, miniChip, i * 100);
  });

  const totalDelay = miniChips.length > 0 ? (miniChips.length - 1) * 100 + 450 : 0;
  setTimeout(() => setBetDisplay(0), totalDelay);
});

// ---------------------------------------------------------------------------
// Knapplyssnare
// ---------------------------------------------------------------------------

document.getElementById("newRound").addEventListener("click", () => {
  const betToPlace = currentBet;
  previousState = null;

  // Optimistisk saldo-deduktion — saldo minskar direkt vid klick
  currentSaldo -= betToPlace;
  updateSaldoDisplay();

  postAction(
    "http://localhost:5000/api/round/new",
    {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bet: betToPlace, mode: currentMode }),
    },
    () => {
      // Återställ saldo vid nätverks- eller validieringsfel
      currentSaldo += betToPlace;
      updateSaldoDisplay();
    }
  );
});

document.getElementById("actionHit").addEventListener("click", () =>
  postAction("http://localhost:5000/api/round/hit")
);

document.getElementById("actionStand").addEventListener("click", () =>
  postAction("http://localhost:5000/api/round/stand")
);

document.getElementById("actionDouble").addEventListener("click", async () => {
  const chipsToDouble = [...chipHistory];
  const additionalBet = lastKnownBet;

  // Optimistisk deduktion av tilläggsinsats
  currentSaldo -= additionalBet;
  updateSaldoDisplay();
  disableAllButtons();

  // Starta fetch och chip-animation parallellt
  const fetchPromise = fetch("http://localhost:5000/api/round/double", { method: "POST" })
    .then((r) => r.json())
    .catch(() => ({ error: "Network error — is the backend running?" }));

  await animateDoubleDown(chipsToDouble);

  const data = await fetchPromise;
  if (data.error) {
    currentSaldo += additionalBet;
    updateSaldoDisplay();
    chipHistory = []; currentBet = 0;
    clearChipStack(false);
    setBetDisplay(0);
    document.getElementById("statusBanner").textContent = `Error: ${data.error}`;
  } else {
    await renderRound(data);
  }
  updateNewRoundButton();
});

document.getElementById("resetBtn").addEventListener("click", async () => {
  try {
    const res  = await fetch("http://localhost:5000/api/saldo/reset", { method: "POST" });
    const data = await res.json();
    if (!data.error) {
      currentSaldo = data.saldo;
      updateSaldoDisplay();
      document.getElementById("resetBtn").setAttribute("hidden", "");
      updateNewRoundButton();
    }
  } catch { /* ignorera nätverksfel */ }
});

// ---------------------------------------------------------------------------
// Mode-toggle
// ---------------------------------------------------------------------------

function applyModeUI() {
  const btn         = document.getElementById("modeBtn");
  const feedSection = document.getElementById("manualFeedSection");
  window.gameState.currentMode = currentMode;
  if (currentMode === "camera") {
    btn.textContent = "Camera mode";
    btn.classList.remove("digital-mode");
    feedSection.removeAttribute("hidden");
  } else {
    btn.textContent = "Digital mode";
    btn.classList.add("digital-mode");
    feedSection.setAttribute("hidden", "");
  }
}

document.getElementById("modeBtn").addEventListener("click", () => {
  currentMode = currentMode === "digital" ? "camera" : "digital";
  applyModeUI();
});

// ---------------------------------------------------------------------------
// Manuell kortmatning (kameraläge)
// ---------------------------------------------------------------------------

document.getElementById("manualFeedBtn").addEventListener("click", async () => {
  const input    = document.getElementById("manualFeedInput");
  const cardCode = input.value.trim();
  if (!cardCode) return;
  input.value = "";
  window.gameState.consumedClasses.add(cardCode);
  await postAction(
    "http://localhost:5000/api/round/feed_card",
    {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ card_code: cardCode }),
    }
  );
});

document.getElementById("manualFeedInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("manualFeedBtn").click();
});

// ---------------------------------------------------------------------------
// Hämta saldo vid sidladdning
// ---------------------------------------------------------------------------

fetch("http://localhost:5000/api/saldo")
  .then((res) => res.json())
  .then((data) => {
    currentSaldo = data.saldo;
    document.getElementById("saldoValue").textContent = data.saldo;
    updateNewRoundButton();
    if (data.saldo === 0) {
      document.getElementById("resetBtn").removeAttribute("hidden");
    }
  })
  .catch(() => { /* backend inte igång ännu — saldo visas som 1000 */ });
