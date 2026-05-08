from __future__ import annotations
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from game.deck import Card

# Poängvärden per valör
RANK_VALUES = {
    '2': 2, '3': 3, '4': 4, '5': 5, '6': 6,
    '7': 7, '8': 8, '9': 9, '10': 10,
    'j': 10, 'q': 10, 'k': 10,
    'a': 11,  # Ess räknas inledningsvis som 11
}


class Hand:
    def __init__(self):
        self._cards: list[Card] = []

    def add_card(self, card: Card) -> None:
        self._cards.append(card)

    def cards(self) -> list[Card]:
        return self._cards

    def value(self) -> int:
        known = [c for c in self._cards if c.rank != "back"]
        total = sum(RANK_VALUES[c.rank] for c in known)
        aces = sum(1 for c in known if c.rank == "a")
        # Räkna ner ess från 11 till 1 så länge vi är över 21
        while total > 21 and aces:
            total -= 10
            aces -= 1
        return total

    def is_soft(self) -> bool:
        # Mjuk hand = minst ett ess räknas som 11
        known = [c for c in self._cards if c.rank != "back"]
        total = sum(RANK_VALUES[c.rank] for c in known)
        aces = sum(1 for c in known if c.rank == "a")
        reductions = 0
        while total > 21 and aces > reductions:
            total -= 10
            reductions += 1
        return (aces - reductions) > 0

    def is_blackjack(self) -> bool:
        if any(c.rank == "back" for c in self._cards):
            return False
        return len(self._cards) == 2 and self.value() == 21

    def is_bust(self) -> bool:
        return self.value() > 21

    def to_dict(self) -> dict:
        return {
            "cards": [c.to_code() for c in self._cards],
            "value": self.value(),
            "is_soft": self.is_soft(),
            "is_blackjack": self.is_blackjack(),
            "is_bust": self.is_bust(),
        }

    def __repr__(self) -> str:
        codes = ", ".join(c.to_code() for c in self._cards)
        return f"Hand([{codes}], värde={self.value()})"
