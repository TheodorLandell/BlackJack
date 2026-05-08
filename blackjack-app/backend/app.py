# Minimal Flask-server för blackjack-appen
import base64
import io
from flask import Flask, jsonify, request
from flask_cors import CORS
from PIL import Image
from game.deck import Deck
from game.hand import Hand
from game.dealer import Dealer
from game.game_state import GameRound
from vision.detector import detect

app = Flask(__name__)
CORS(app)  # Tillåt anrop från frontenden

# Global spelrond och spelarens saldo — sparas i serverminnet
current_round: GameRound | None = None
player_saldo: int = 1000
DEFAULT_BET: int = 50


def _apply_return() -> int | None:
    """Applicerar return (insats + payout) vid rondslut. Returnerar P&L för statusmeddelandet."""
    global player_saldo
    if current_round.status != "in_progress":
        payout = current_round.calculate_payout()
        player_saldo += current_round.bet + payout
        return payout
    return None


def _round_response(last_payout) -> dict:
    """Bygger ett komplett svar för en rond med last_payout."""
    result = current_round.to_dict(saldo=player_saldo)
    result["last_payout"] = last_payout
    return result


@app.route("/")
def index():
    # Hälsokontroll — bekräftar att backenden är igång
    return jsonify({"message": "Backend live"})


@app.route("/api/saldo")
def get_saldo():
    return jsonify({"saldo": player_saldo})


@app.route("/api/saldo/reset", methods=["POST"])
def reset_saldo():
    global player_saldo
    if player_saldo != 0:
        return jsonify({"error": "Saldo måste vara 0 för att resetta"}), 400
    player_saldo = 1000
    return jsonify({"saldo": player_saldo})


@app.route("/api/deck/test")
def deck_test():
    # Temporär test-endpoint — verifierar att kortleken fungerar korrekt
    deck = Deck()
    deck.shuffle()
    drawn = [deck.draw().to_code() for _ in range(5)]
    return jsonify({"drawn": drawn, "cards_left": deck.cards_left()})


@app.route("/api/hand/test")
def hand_test():
    # Temporär test-endpoint — verifierar att handvärdering fungerar korrekt
    deck = Deck()
    deck.shuffle()
    hand1, hand2 = Hand(), Hand()
    for _ in range(2):
        hand1.add_card(deck.draw())
        hand2.add_card(deck.draw())
    return jsonify({"hand1": hand1.to_dict(), "hand2": hand2.to_dict()})


@app.route("/api/dealer/test")
def dealer_test():
    # Temporär test-endpoint — verifierar att dealerlogiken fungerar korrekt
    deck = Deck()
    deck.shuffle()
    dealer = Dealer(stand_on_soft_17=True)
    initial = []
    for _ in range(2):
        card = deck.draw()
        dealer.receive_card(card)
        initial.append(card.to_code())
    drawn_during = [c.to_code() for c in dealer.play_out(deck)]
    return jsonify({
        "initial_hand": initial,
        "drawn_during_play": drawn_during,
        "final_hand": dealer.hand.to_dict(),
    })


@app.route("/api/round/new", methods=["POST"])
def round_new():
    global current_round, player_saldo
    data = request.get_json() or {}
    bet = data.get("bet", 0)
    mode = data.get("mode", "digital")
    if mode not in ("digital", "camera"):
        return jsonify({"error": "Ogiltigt läge — 'digital' eller 'camera'"}), 400
    if not isinstance(bet, int) or isinstance(bet, bool) or bet < 1:
        return jsonify({"error": "Bet must be a positive integer"}), 400
    if bet > player_saldo:
        return jsonify({"error": "Insufficient saldo"}), 400
    player_saldo -= bet
    current_round = GameRound(bet=bet, mode=mode)
    current_round.start()
    # Omedelbar avgöring (blackjack/push i digitalläge) — applicera return direkt
    last_payout = _apply_return() if current_round.status != "in_progress" else None
    return jsonify(_round_response(last_payout))


@app.route("/api/round/hit", methods=["POST"])
def round_hit():
    global current_round
    if current_round is None or current_round.status != "in_progress":
        return jsonify({"error": "Ingen aktiv rond"}), 400
    current_round.hit()
    last_payout = _apply_return()
    return jsonify(_round_response(last_payout))


@app.route("/api/round/stand", methods=["POST"])
def round_stand():
    global current_round
    if current_round is None or current_round.status != "in_progress":
        return jsonify({"error": "Ingen aktiv rond"}), 400
    current_round.stand()
    last_payout = _apply_return()
    return jsonify(_round_response(last_payout))


@app.route("/api/round/double", methods=["POST"])
def round_double():
    global current_round, player_saldo
    if current_round is None or current_round.status != "in_progress":
        return jsonify({"error": "Ingen aktiv rond"}), 400
    if "double" not in current_round.available_actions(player_saldo):
        return jsonify({"error": "Double down ej tillåtet just nu"}), 400
    player_saldo -= current_round.bet  # tilläggsinsats för double
    current_round.double_down()
    last_payout = _apply_return()
    return jsonify(_round_response(last_payout))


@app.route("/api/round/feed_card", methods=["POST"])
def round_feed_card():
    global current_round
    if current_round is None or current_round.status != "in_progress":
        return jsonify({"error": "Ingen aktiv rond"}), 400
    data = request.get_json() or {}
    card_code = data.get("card_code", "")
    if not card_code:
        return jsonify({"error": "Fält 'card_code' saknas"}), 400
    try:
        current_round.feed_card(card_code)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    last_payout = _apply_return() if current_round.status != "in_progress" else None
    return jsonify(_round_response(last_payout))


@app.route("/api/vision/detect", methods=["POST"])
def vision_detect():
    data = request.get_json() or {}
    if "image" not in data:
        return jsonify({"error": "Fält 'image' saknas i request-body"}), 400
    try:
        raw = data["image"]
        # Strippa data-URL-prefix om bilden skickas som data:image/...;base64,...
        if "," in raw:
            raw = raw.split(",", 1)[1]
        img_bytes = base64.b64decode(raw)
        image = Image.open(io.BytesIO(img_bytes)).convert("RGB")
        result = detect(image)
        return jsonify(result)
    except FileNotFoundError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        return jsonify({"error": f"Detektionsfel: {e}"}), 400


if __name__ == "__main__":
    app.run(port=5000, debug=True)
