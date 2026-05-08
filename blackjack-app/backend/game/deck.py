import random

RANKS = ['a', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'j', 'q', 'k']
SUITS = ['h', 'r', 'k', 's']  # hjärter, ruter, klöver, spader


class Card:
    def __init__(self, rank: str, suit: str):
        self.rank = rank
        self.suit = suit

    def to_code(self) -> str:
        if self.rank == "back":
            return "back"
        return f"{self.rank}-{self.suit}"

    @classmethod
    def from_code(cls, code: str) -> "Card":
        if code == "back":
            return cls("back", "back")
        # Dela på sista bindestrecket för att hantera "10-h" korrekt
        rank, suit = code.rsplit("-", 1)
        return cls(rank, suit)

    def __repr__(self) -> str:
        return f"Card({self.rank}-{self.suit})"


class Deck:
    def __init__(self):
        # Bygg en standardkortlek på 52 kort
        self.cards = [Card(rank, suit) for suit in SUITS for rank in RANKS]

    def shuffle(self):
        random.shuffle(self.cards)

    def draw(self) -> Card:
        if not self.cards:
            raise ValueError("Kortleken är tom")
        return self.cards.pop()

    def cards_left(self) -> int:
        return len(self.cards)

    def __repr__(self) -> str:
        return f"Deck med {self.cards_left()} kort kvar"
