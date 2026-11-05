"""
Test script for Soilate v2.0 mechanics:
- Dynamic deck scaling (suits & Jokers)
- Tool assignment & execution
- Penalty for regular bluff (cards - 1) & finish bluff (10 cards)
- Special card activation
"""
import random
import sys
import os

sys.path.insert(0, r"C:\Users\LOQ\.gemini\antigravity\scratch\soilate")
from game_logic import (
    Card, HandEvaluator, create_dynamic_deck, get_active_suits_and_jokers,
    ALL_SUITS, TOOL_DEFINITIONS, ALL_TOOL_KEYS, SPECIAL_CARDS_SPAWN
)
from server import Player, TableCard, GameRoom

def test_deck_scaling():
    print("--- 1. Testing Deck Scaling ---")
    for count in [2, 3, 4, 5, 6]:
        suits, jokers = get_active_suits_and_jokers(count)
        deck, specials = create_dynamic_deck(count)
        reg_count = len(suits) * 13 + jokers
        print(f"Players: {count} -> {len(suits)} suits, {jokers} Jokers -> Base deck size: {reg_count}, actual deck: {len(deck)}")
        assert len(suits) >= 4 and len(suits) <= 8
        assert jokers >= 1 and jokers <= 4
        assert len(deck) >= reg_count
    print("PASS: Deck Scaling verified.")

def test_penalties_and_tools():
    print("\n--- 2. Testing Call Bluff Penalties & Tools ---")
    room = GameRoom("TEST_ROOM", "Test Room")
    p1 = Player("p1", "Player 1")
    p2 = Player("p2", "Player 2")
    p3 = Player("p3", "Player 3")
    room.players = [p1, p2, p3]

    ok, msg = room.start_game()
    assert ok, msg
    assert room.state == 'PLAYING'
    print(f"Initial hand size: {len(p1.hand)} cards each")

    # Verify tool assignment
    for p in room.players:
        assert p.assigned_tool in ALL_TOOL_KEYS, f"Player {p.name} should have an assigned tool"
        print(f"Player {p.name} assigned tool: {p.assigned_tool} ({TOOL_DEFINITIONS[p.assigned_tool]['timing']})")

    # Populate discard pile for testing penalty
    for i in range(15):
        room.discard_pile.append(Card(f"DISCARD_{i}", "S", 2))

    # Test Bluff: p1 plays a hand with bluff
    # p1 plays 4 cards, claims Four of a Kind, but actual cards are different ranks
    c1 = Card("c1", "S", 10)
    c2 = Card("c2", "C", 5)
    c3 = Card("c3", "D", 7)
    c4 = Card("c4", "H", 9)
    p1.hand = [c1, c2, c3, c4]
    claim = {'type': 'four', 'rank': 10}

    # Play hand: 1 face up, 3 face down
    ok, msg = room.handle_play_hand(p1, [c1.id, c2.id, c3.id, c4.id], [c1.id], claim)
    assert ok, msg
    assert len(p1.hand) == 0, "p1 should have 0 cards (bluffing out!)"
    print(f"p1 played 4 cards (bluffing out to 0 cards). Table cards: {len(room.table_cards)}")

    # p2 calls bluff
    initial_discard = len(room.discard_pile)
    ok, msg = room.handle_call_bluff(p2)
    assert ok, msg
    # Because p1 bluffed out with 0 cards, p1 should draw 10 cards!
    print(f"p1 caught bluffing out! Hand size after 10-card penalty: {len(p1.hand)}")
    assert len(p1.hand) == 10, f"Expected 10 cards penalty for bluffing out, got {len(p1.hand)}"
    print("PASS: 10-card penalty for bluffing out verified.")

    # Now test regular bluff penalty (cards_played - 1)
    p2.hand = [Card("d1", "S", 2), Card("d2", "C", 2), Card("d3", "D", 2)]
    # Resolve pending penalty first
    room.finalize_call_resolution(p2, p1, p2.hand[0].id)
    assert room.state == 'PLAYING'

    # p2 is in turn. p2 plays 3 cards as "Three of a kind Ace" (bluff)
    b1 = Card("b1", "S", 2)
    b2 = Card("b2", "C", 3)
    b3 = Card("b3", "D", 4)
    extra_card = Card("extra", "H", 14)
    p2.hand = [b1, b2, b3, extra_card]
    claim_three = {'type': 'three', 'rank': 14}
    ok, msg = room.handle_play_hand(p2, [b1.id, b2.id, b3.id], [b1.id], claim_three)
    assert ok, msg
    # p2 had 4 cards, played 3 -> was down to 1 card, so drew 1 card immediately -> has 2 cards!
    assert len(p2.hand) == 2, f"Expected 2 cards (1 leftover + 1 drawn from single card rule), got {len(p2.hand)}"

    # p3 calls bluff on p2
    ok, msg = room.handle_call_bluff(p3)
    assert ok, msg
    # p2 played 3 cards, so discard penalty is 3 - 1 = 2 cards!
    # Initial hand was 2 + 2 drawn = 4 cards!
    print(f"p2 regular bluff penalty: hand now has {len(p2.hand)} cards (2 before + 2 drawn)")
    assert len(p2.hand) == 4, f"Expected 4 cards (2 + 2), got {len(p2.hand)}"
    print("PASS: Regular bluff penalty (cards - 1) verified.")

def test_single_card_draw_rule():
    print("\n--- 4. Testing Single Card Draw Rule ---")
    room = GameRoom("SINGLE_CARD_ROOM", "Room 1 Card")
    p1 = Player("p1", "Player 1")
    p2 = Player("p2", "Player 2")
    room.players = [p1, p2]
    room.start_game()

    # Manually give p1 3 cards
    c1 = Card("sc1", "S", 10)
    c2 = Card("sc2", "C", 10)
    c3 = Card("sc3", "D", 5)
    p1.hand = [c1, c2, c3]
    room.set_turn_to(p1.id)

    # p1 plays pair 10 (2 cards) -> drops to 1 card!
    ok, msg = room.handle_play_hand(p1, [c1.id, c2.id], [c1.id], {'type': 'pair', 'rank': 10})
    assert ok, msg
    # Because of the 1-card rule, p1 must have drawn 1 card immediately!
    print(f"p1 played pair from 3 cards -> hand size should be 2 (1 leftover + 1 drawn): {len(p1.hand)}")
    assert len(p1.hand) == 2, f"Expected 2 cards after automatic 1-card draw, got {len(p1.hand)}"
    print("PASS: Single Card Draw Rule verified.")

def test_special_cards():
    print("\n--- 3. Testing Special Cards Execution ---")
    room = GameRoom("SPEC_ROOM", "Special Cards Room")
    p1 = Player("p1", "Alice")
    p2 = Player("p2", "Bob")
    room.players = [p1, p2]
    room.start_game()

    # Give p1 an ATTACK card
    atk_card = Card("SPEC_ATTACK_1", "SPEC", 0, is_special=True, special_type='ATTACK', special_name='Attack Card')
    p1.hand.append(atk_card)
    room.set_turn_to(p1.id)

    p2_initial_cards = len(p2.hand)
    ok, msg = room.handle_play_special_card(p1, atk_card.id)
    assert ok, msg
    assert len(p2.hand) == p2_initial_cards + 2, f"Bob should have drawn 2 cards, had {p2_initial_cards}, now {len(p2.hand)}"
    print(f"Attack card verified: Bob drew 2 cards (total: {len(p2.hand)}).")

    # Give p1 a SKIP card
    skip_card = Card("SPEC_SKIP_1", "SPEC", 0, is_special=True, special_type='SKIP', special_name='Skip Card')
    p1.hand.append(skip_card)
    room.set_turn_to(p1.id)
    ok, msg = room.handle_play_special_card(p1, skip_card.id)
    assert ok, msg
    print("Skip card verified: Turn skipped successfully.")

def test_shed_out_and_win():
    print("\n--- 5. Testing Shed Out (0 cards) and Win when Everyone Passes ---")
    room = GameRoom("WIN_TEST_ROOM", "Win Test")
    p1 = Player("p1", "Cao Thủ")
    p2 = Player("p2", "Bob Bot", is_bot=True)
    p3 = Player("p3", "Zack Bot", is_bot=True)
    room.players = [p1, p2, p3]
    room.start_game()

    # Give p1 exactly 2 cards (Pair of Aces)
    c1 = Card("ace1", "S", 14)
    c2 = Card("ace2", "C", 14)
    p1.hand = [c1, c2]
    room.set_turn_to(p1.id)

    # p1 plays Pair of Aces -> 0 cards left!
    ok, msg = room.handle_play_hand(p1, [c1.id, c2.id], [c1.id], {'type': 'pair', 'rank': 14})
    assert ok, msg
    assert len(p1.hand) == 0, "p1 should have 0 cards"

    # Turn moves to p2
    assert room.current_player().id == p2.id
    # p2 passes
    ok, msg = room.handle_pass(p2)
    assert ok, msg

    # Turn moves to p3
    assert room.current_player().id == p3.id
    # p3 passes -> Everyone passed!
    ok, msg = room.handle_pass(p3)
    assert ok, msg

    # p1 MUST be marked as finished with rank 1 (Winner)!
    print(f"p1 finished_rank: {p1.finished_rank}")
    assert p1.finished_rank == 1, f"p1 should be Rank 1 winner, got {p1.finished_rank}"
    assert "p1" in room.finish_order
    # p1 should NOT be the current player!
    assert room.current_player().id != p1.id, "Turn should not be given back to p1 who has 0 cards!"
    print("PASS: Shed Out and Win verified successfully!")

if __name__ == '__main__':
    test_deck_scaling()
    test_penalties_and_tools()
    test_single_card_draw_rule()
    test_special_cards()
    test_shed_out_and_win()
    print("\nALL MECHANICS TESTS PASSED SUCCESSFULLY! 🎯")
