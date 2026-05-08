const SUIT_SYMBOL = { h: "♥", r: "♦", k: "♣", s: "♠" };
const SUIT_COLOR  = { h: "card-red", r: "card-red", k: "card-black", s: "card-black" };
const RANK_LABEL  = { a: "A", j: "J", q: "Q", k: "K" };

function renderCard(code) {
  if (code === "back") {
    return (
      `<div class="card-element card-flip-container">` +
        `<div class="card-flip face-down">` +
          `<div class="card-back"></div>` +
          `<div class="card-front"></div>` +
        `</div>` +
      `</div>`
    );
  }

  const dashIdx = code.lastIndexOf("-");
  const rank = code.slice(0, dashIdx);
  const suit = code.slice(dashIdx + 1);

  const label  = RANK_LABEL[rank] || rank;
  const symbol = SUIT_SYMBOL[suit];
  const color  = SUIT_COLOR[suit];

  const frontContent =
    `<div class="card-corner top-left">` +
      `<span class="corner-rank">${label}</span>` +
      `<span class="corner-suit">${symbol}</span>` +
    `</div>` +
    `<div class="card-center">${symbol}</div>` +
    `<div class="card-corner bottom-right">` +
      `<span class="corner-rank">${label}</span>` +
      `<span class="corner-suit">${symbol}</span>` +
    `</div>`;

  return (
    `<div class="card-element card-flip-container">` +
      `<div class="card-flip">` +
        `<div class="card-back"></div>` +
        `<div class="card-front ${color}">${frontContent}</div>` +
      `</div>` +
    `</div>`
  );
}

const STATUS_TEXT = {
  in_progress:       "Your turn",
  player_blackjack:  "Blackjack! You win",
  dealer_blackjack:  "Dealer has blackjack",
  player_bust:       "Bust! You lose",
  dealer_bust:       "Dealer busts — you win",
  player_wins:       "You win",
  dealer_wins:       "Dealer wins",
  push:              "Push",
};

const WAITING_TEXT = {
  player_card_1:      "Feed player card 1",
  dealer_card_1:      "Feed dealer card 1",
  player_card_2:      "Feed player card 2",
  dealer_card_2:      "Feed dealer hole card (face-down)",
  player_hit:         "Feed hit card",
  player_double_card: "Feed double card",
  dealer_reveal:      "Feed dealer hole card (now revealed)",
  dealer_hit:         "Feed dealer card",
};

function statusMessage(state) {
  if (state.mode === "camera" && state.waiting_for) {
    return WAITING_TEXT[state.waiting_for] || state.waiting_for;
  }
  const status = state.status;
  const payout = state.last_payout;
  const base = STATUS_TEXT[status] || status;
  // Visa payout-info endast när ronden är avgjord och det finns ett netto
  if (status === "in_progress" || payout === null || payout === undefined || payout === 0) {
    return base;
  }
  const sign = payout > 0 ? "+" : "";
  return `${base}  ·  ${sign}${payout} markers`;
}
