from game.deck import Deck, Card
from game.hand import Hand
from game.dealer import Dealer


class GameRound:
    def __init__(self, bet: int, mode: str = "digital"):
        self.mode = mode
        self.bet = bet
        self.original_bet = bet
        self.doubled = False
        self.status = "in_progress"
        self.waiting_for = None
        self.player_hand = Hand()
        self._dealer = Dealer()

        if mode == "digital":
            self._deck = Deck()
            self._deck.shuffle()
        else:
            self._deck = None

    def start(self):
        if self.mode == "camera":
            self.waiting_for = "player_card_1"
            return

        # Digital mode — dela ut 2 kort alternerande, spelaren först
        for _ in range(2):
            self.player_hand.add_card(self._deck.draw())
            self._dealer.receive_card(self._deck.draw())

        player_bj = self.player_hand.is_blackjack()
        dealer_bj = self._dealer.hand.is_blackjack()

        if player_bj and dealer_bj:
            self.status = "push"
        elif player_bj:
            self.status = "player_blackjack"
        elif dealer_bj:
            self.status = "dealer_blackjack"

    # ---------------------------------------------------------------------------
    # Camera-mode state machine
    # ---------------------------------------------------------------------------

    def feed_card(self, card_code: str):
        """Camera-mode only: mata in nästa fysiskt detekterat kort."""
        if self.mode != "camera":
            raise ValueError("feed_card är endast tillgängligt i kameraläge")

        wf = self.waiting_for

        if wf == "player_card_1":
            self.player_hand.add_card(Card.from_code(card_code))
            self.waiting_for = "dealer_card_1"

        elif wf == "dealer_card_1":
            self._dealer.receive_card(Card.from_code(card_code))
            self.waiting_for = "player_card_2"

        elif wf == "player_card_2":
            self.player_hand.add_card(Card.from_code(card_code))
            self.waiting_for = "dealer_card_2"

        elif wf == "dealer_card_2":
            # Hole card läggs ner med ryggen upp — YOLO kan inte se det
            self._dealer.receive_card(Card("back", "back"))
            if self.player_hand.is_blackjack():
                # Hoppa direkt till reveal för att kontrollera om dealer också har BJ
                self.waiting_for = "dealer_reveal"
            else:
                self.waiting_for = None  # spelarens tur

        elif wf == "player_hit":
            self.player_hand.add_card(Card.from_code(card_code))
            if self.player_hand.is_bust():
                self.status = "player_bust"
                self.waiting_for = None
            elif self.player_hand.value() == 21:
                self.waiting_for = "dealer_reveal"
            else:
                self.waiting_for = None  # spelaren kan agera igen

        elif wf == "player_double_card":
            self.player_hand.add_card(Card.from_code(card_code))
            if self.player_hand.is_bust():
                self.status = "player_bust"
                self.waiting_for = None
            else:
                self.waiting_for = "dealer_reveal"

        elif wf == "dealer_reveal":
            # Ersätt 'back'-kort med det faktiska kortet (YOLO detekterade det nu)
            self._reveal_hole(card_code)
            player_bj = self.player_hand.is_blackjack()
            dealer_bj = self._dealer.hand.is_blackjack()
            if player_bj and dealer_bj:
                self.status = "push"
                self.waiting_for = None
            elif player_bj:
                self.status = "player_blackjack"
                self.waiting_for = None
            elif dealer_bj:
                self.status = "dealer_blackjack"
                self.waiting_for = None
            elif self._dealer.should_hit():
                self.waiting_for = "dealer_hit"
            else:
                self._resolve_winner_camera()

        elif wf == "dealer_hit":
            self._dealer.receive_card(Card.from_code(card_code))
            if self._dealer.should_hit():
                self.waiting_for = "dealer_hit"
            else:
                self._resolve_winner_camera()

    def _reveal_hole(self, actual_code: str):
        cards = self._dealer.hand.cards()
        for i, c in enumerate(cards):
            if c.rank == "back":
                cards[i] = Card.from_code(actual_code)
                return

    def _resolve_winner_camera(self):
        pv = self.player_hand.value()
        dv = self._dealer.hand.value()
        if self._dealer.hand.is_bust():
            self.status = "dealer_bust"
        elif dv > pv:
            self.status = "dealer_wins"
        elif pv > dv:
            self.status = "player_wins"
        else:
            self.status = "push"
        self.waiting_for = None

    # ---------------------------------------------------------------------------
    # Spelaråtgärder
    # ---------------------------------------------------------------------------

    def hit(self):
        if self.status != "in_progress" or self.waiting_for is not None:
            return
        if self.mode == "camera":
            self.waiting_for = "player_hit"
        else:
            self.player_hand.add_card(self._deck.draw())
            if self.player_hand.is_bust():
                self.status = "player_bust"
            elif self.player_hand.value() == 21:
                self._resolve_dealer()

    def stand(self):
        if self.status != "in_progress" or self.waiting_for is not None:
            return
        if self.mode == "camera":
            self.waiting_for = "dealer_reveal"
        else:
            self._resolve_dealer()

    def double_down(self):
        if (self.status != "in_progress"
                or len(self.player_hand.cards()) != 2
                or self.waiting_for is not None):
            return
        self.doubled = True
        self.bet *= 2
        if self.mode == "camera":
            self.waiting_for = "player_double_card"
        else:
            self.player_hand.add_card(self._deck.draw())
            if self.player_hand.is_bust():
                self.status = "player_bust"
            else:
                self._resolve_dealer()

    def _resolve_dealer(self):
        self._dealer.play_out(self._deck)
        pv = self.player_hand.value()
        dv = self._dealer.hand.value()
        if self._dealer.hand.is_bust():
            self.status = "dealer_bust"
        elif dv > pv:
            self.status = "dealer_wins"
        elif pv > dv:
            self.status = "player_wins"
        else:
            self.status = "push"

    # ---------------------------------------------------------------------------
    # Utbetalning och hjälpfunktioner
    # ---------------------------------------------------------------------------

    def calculate_payout(self) -> int:
        """Returnerar saldo-diff för ronden. Positiv = vinst, negativ = förlust."""
        if self.status == "player_blackjack":
            return int(self.original_bet * 1.5)   # 3:2
        if self.status in ("player_wins", "dealer_bust"):
            return self.bet                         # 1:1
        if self.status == "push":
            return 0                                # återbetalas
        if self.status in ("dealer_wins", "dealer_blackjack", "player_bust"):
            return -self.bet
        return 0  # in_progress

    def available_actions(self, saldo: int) -> list:
        if self.status != "in_progress" or self.waiting_for is not None:
            return []
        actions = ["hit", "stand"]
        if (len(self.player_hand.cards()) == 2
                and not self.doubled
                and saldo >= self.bet):
            actions.append("double")
        return actions

    def to_dict(self, saldo: int) -> dict:
        return {
            "status": self.status,
            "mode": self.mode,
            "waiting_for": self.waiting_for,
            "player_hand": self.player_hand.to_dict(),
            "dealer_hand": self._dealer.hand.to_dict(),
            "available_actions": self.available_actions(saldo),
            "player_doubled": self.doubled,
            "bet": self.bet,
            "saldo": saldo,
        }
