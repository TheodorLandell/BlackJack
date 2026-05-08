from game.hand import Hand


class Dealer:
    def __init__(self, stand_on_soft_17: bool = True):
        self.hand = Hand()
        self.stand_on_soft_17 = stand_on_soft_17

    def receive_card(self, card) -> None:
        self.hand.add_card(card)

    def should_hit(self) -> bool:
        val = self.hand.value()
        if val < 17:
            return True
        if val > 17:
            return False
        # Exakt 17: H17-regel slår in om soft och stand_on_soft_17 är False
        if self.hand.is_soft() and not self.stand_on_soft_17:
            return True
        return False

    def play_out(self, deck) -> list:
        # Drar kort tills should_hit() returnerar False, returnerar dragna kort
        drawn = []
        while self.should_hit():
            card = deck.draw()
            self.receive_card(card)
            drawn.append(card)
        return drawn

    def to_dict(self) -> dict:
        return {
            "hand": self.hand.to_dict(),
            "stand_on_soft_17": self.stand_on_soft_17,
        }

    def __repr__(self) -> str:
        return f"Dealer({self.hand!r}, S17={self.stand_on_soft_17})"
