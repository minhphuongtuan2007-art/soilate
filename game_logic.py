"""
Xon Game Logic Engine v2.0
Updated with:
- Dynamic suits & Jokers scaling with player count (4 to 8 suits, 1 to 4 Jokers)
- 8 Suits: Bích ♠, Chuồn ♣, Rô ♦, Cơ ♥, Sao ⭐, Trăng 🌙, Vương miện 👑, Tia sét ⚡
- 7 Tools randomly assigned (1 per player per round, reset after call/round)
- Special Mystery Cards spawned by percentage per match:
  * SKIP (70%)
  * ATTACK (50%) - next player draws 2
  * OPEN_ALL (5%) - reveals all face-down cards on table
  * CHAOS (0.05%) - everyone draws 10 cards
  * WINNER (0.0000001%) - instant win
- New Call & Penalty rules:
  * Call đúng: bluffer receives 1 card from caller AND draws (cards_played - 1) from discard pile.
  * Bluff out (0 cards) caught: draws 10 cards from discard pile!
"""

import random
from typing import List, Dict, Any, Optional, Tuple

ALL_SUITS = ['S', 'C', 'D', 'H', 'X', 'M', 'K', 'L']

SUIT_NAMES = {
    'S': 'Bích ♠',
    'C': 'Chuồn ♣',
    'D': 'Rô ♦',
    'H': 'Cơ ♥',
    'X': 'Sao ⭐',
    'M': 'Trăng 🌙',
    'K': 'Vương miện 👑',
    'L': 'Tia sét ⚡',
    'W': 'Joker 🃏',
    'SPEC': 'Đặc biệt ✨'
}

SUIT_COLORS = {
    'S': '#94a3b8',
    'C': '#10b981',
    'D': '#f97316',
    'H': '#ef4444',
    'X': '#fbbf24',
    'M': '#a855f7',
    'K': '#ec4899',
    'L': '#06b6d4',
    'W': '#d946ef',
    'SPEC': '#f59e0b'
}

RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]
RANK_NAMES = {
    2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10',
    11: 'J', 12: 'Q', 13: 'K', 14: 'A', 99: 'Joker'
}

HAND_TYPES = [
    'pair',
    'three',
    'four',
    'five',
    'full_house',
    'straight',
    'straight_flush'
]

HAND_TYPE_NAMES = {
    'pair': 'Đôi',
    'three': 'Ba lá (Sám)',
    'four': 'Tứ quý',
    'five': 'Năm lá (Ngũ quý)',
    'full_house': 'Cù lũ (Full House)',
    'straight': 'Sảnh (Straight)',
    'straight_flush': 'Thùng phá sảnh'
}

HAND_TYPE_CARD_COUNT = {
    'pair': 2,
    'three': 3,
    'four': 4,
    'five': 5,
    'full_house': 5,
    'straight': 5,
    'straight_flush': 5
}

# 7 Tools Metadata
TOOL_DEFINITIONS = {
    'DRAW_RANDOM': {
        'name': 'Bốc 1 lá',
        'desc': 'Bốc 1 lá ngẫu nhiên từ nọc bài (trong lượt mình).',
        'timing': 'own_turn',
        'icon': '📥'
    },
    'SWAP_RANDOM': {
        'name': 'Đổi 1 lá',
        'desc': 'Đổi 1 lá trên tay lấy 1 lá mới từ nọc (trong lượt mình).',
        'timing': 'own_turn',
        'icon': '🔄'
    },
    'SWAP_DECK': {
        'name': 'Đổi Deck!',
        'desc': 'Đổi toàn bộ bài trên tay với 1 người tùy chọn (trong lượt mình).',
        'timing': 'own_turn',
        'icon': '🔀'
    },
    'CHANGE_SUIT': {
        'name': 'Đổi chất',
        'desc': 'Đổi chất 1 lá bài trên tay sang chất bất kỳ (trong lượt mình).',
        'timing': 'own_turn',
        'icon': '🎨'
    },
    'DISABLE_TOOL': {
        'name': 'Khóa đối thủ',
        'desc': 'Vô hiệu hóa tính năng của đối thủ (bất kì lúc nào khi đối thủ kích hoạt).',
        'timing': 'anytime',
        'icon': '🚫'
    },
    'PEEK_CARD': {
        'name': 'Soi bài úp',
        'desc': 'Lén xem 1 lá bài úp của đối thủ trên bàn (bất kì lúc nào).',
        'timing': 'anytime',
        'icon': '👁️'
    },
    'FORCE_REVEAL': {
        'name': 'Bắt lật lá',
        'desc': 'Bắt đối thủ lật ngửa 1 lá úp cho cả bàn xem (bất kì lúc nào).',
        'timing': 'anytime',
        'icon': '💥'
    }
}

ALL_TOOL_KEYS = list(TOOL_DEFINITIONS.keys())

# Special Cards Configuration with Spawn Rates per Game
SPECIAL_CARDS_SPAWN = [
    {
        'id_prefix': 'SPEC_SKIP',
        'name': 'Skip Card ⏭️',
        'desc': 'Bỏ qua lượt của người chơi tiếp theo. (Đánh xong kết thúc lượt)',
        'type': 'SKIP',
        'rate': 0.70 # 70%
    },
    {
        'id_prefix': 'SPEC_ATTACK',
        'name': 'Attack Card ⚔️',
        'desc': 'Bắt đối thủ tiếp theo phải bốc 2 lá từ nọc/bài bỏ! (Đánh độc lập, vẫn phải đánh bài chính)',
        'type': 'ATTACK',
        'rate': 0.50 # 50%
    },
    {
        'id_prefix': 'SPEC_OPEN_ALL',
        'name': 'Open All Card 👁️‍🗨️',
        'desc': 'Lật ngửa toàn bộ các lá bài úp trên bàn của đối thủ! (Đánh độc lập)',
        'type': 'OPEN_ALL',
        'rate': 0.05 # 5%
    },
    {
        'id_prefix': 'SPEC_CHAOS',
        'name': 'Chaos Card 🌀',
        'desc': 'TOÀN BỘ NGƯỜI CHƠI bốc thêm 10 lá ngẫu nhiên! (Đánh độc lập)',
        'type': 'CHAOS',
        'rate': 0.0005 # 0.05%
    },
    {
        'id_prefix': 'SPEC_WINNER',
        'name': 'Winner Card 👑',
        'desc': 'NGAY LẬP TỨC THẮNG GAME! (Thần thoại - Tỉ lệ 0.0000001%)',
        'type': 'WINNER',
        'rate': 0.000000001 # 0.0000001%
    }
]

class Card:
    def __init__(self, card_id: str, suit: str, rank: int, is_special: bool = False, special_type: Optional[str] = None, special_name: Optional[str] = None, special_desc: Optional[str] = None):
        self.id = card_id
        self.suit = suit          # 'S', 'C', 'D', 'H', 'X', 'M', 'K', 'L', 'W', or 'SPEC'
        self.rank = rank          # 2..14, 99 for Joker, 0 for Special
        self.altered_suit = None  # from CHANGE_SUIT tool
        self.is_wildcard = (suit == 'W' or rank == 99)
        self.is_special = is_special
        self.special_type = special_type
        self.special_name = special_name
        self.special_desc = special_desc

    def effective_suit(self) -> str:
        if self.altered_suit:
            return self.altered_suit
        return self.suit

    def to_dict(self, face_up: bool = True) -> Dict[str, Any]:
        if not face_up:
            return {
                'id': self.id,
                'face_up': False,
                'is_hidden': True
            }
        return {
            'id': self.id,
            'suit': self.effective_suit(),
            'original_suit': self.suit,
            'altered_suit': self.altered_suit,
            'rank': self.rank,
            'rank_name': RANK_NAMES.get(self.rank, str(self.rank)),
            'suit_name': SUIT_NAMES.get(self.effective_suit(), self.suit),
            'is_wildcard': self.is_wildcard,
            'is_special': self.is_special,
            'special_type': self.special_type,
            'special_name': self.special_name,
            'special_desc': self.special_desc,
            'face_up': True
        }


def get_active_suits_and_jokers(player_count: int) -> Tuple[List[str], int]:
    """
    Scale suits and jokers based on player count:
    - 2 players: 4 suits + 1 Joker
    - 3 players: 5 suits + 1 Joker
    - 4 players: 6 suits + 2 Jokers (Standard)
    - 5 players: 7 suits + 3 Jokers
    - 6+ players: 8 suits + 4 Jokers
    """
    if player_count <= 2:
        num_suits = 4
        num_jokers = 1
    elif player_count == 3:
        num_suits = 5
        num_jokers = 1
    elif player_count == 4:
        num_suits = 6
        num_jokers = 2
    elif player_count == 5:
        num_suits = 7
        num_jokers = 3
    else:
        num_suits = 8
        num_jokers = 4

    suits = ALL_SUITS[:num_suits]
    return suits, num_jokers


def create_dynamic_deck(player_count: int = 4) -> Tuple[List[Card], List[str]]:
    """
    Build deck scaled for player_count, with random spawn of special mystery cards.
    Returns (deck, spawned_specials_info).
    """
    suits, num_jokers = get_active_suits_and_jokers(player_count)
    deck: List[Card] = []

    # Regular cards
    for suit in suits:
        for rank in RANKS:
            deck.append(Card(f"{suit}_{rank}", suit, rank))

    # Jokers
    for i in range(1, num_jokers + 1):
        deck.append(Card(f"JOKER_{i}", "W", 99))

    # Roll for Special Cards
    spawned_info = []
    for spec in SPECIAL_CARDS_SPAWN:
        if random.random() < spec['rate']:
            card_id = f"{spec['id_prefix']}_{random.randint(100, 999)}"
            card = Card(
                card_id=card_id,
                suit='SPEC',
                rank=0,
                is_special=True,
                special_type=spec['type'],
                special_name=spec['name'],
                special_desc=spec['desc']
            )
            deck.append(card)
            spawned_info.append(spec['name'])

    random.shuffle(deck)
    return deck, spawned_info


class HandEvaluator:
    @staticmethod
    def verify_claim(actual_cards: List[Card], claim: Dict[str, Any]) -> bool:
        """
        Verify if actual_cards can form the claimed hand.
        Special cards cannot be used in rank combinations!
        """
        hand_type = claim.get('type')
        expected_count = HAND_TYPE_CARD_COUNT.get(hand_type, 0)
        if len(actual_cards) != expected_count:
            return False

        # Any special card used in a claim is invalid
        if any(c.is_special for c in actual_cards):
            return False

        wildcards = [c for c in actual_cards if c.is_wildcard]
        naturals = [c for c in actual_cards if not c.is_wildcard]
        num_wild = len(wildcards)

        if hand_type == 'pair':
            rank = claim.get('rank')
            if not rank:
                return False
            for c in naturals:
                if c.rank != rank:
                    return False
            return True

        elif hand_type == 'three':
            rank = claim.get('rank')
            if not rank:
                return False
            for c in naturals:
                if c.rank != rank:
                    return False
            return True

        elif hand_type == 'four':
            rank = claim.get('rank')
            if not rank:
                return False
            for c in naturals:
                if c.rank != rank:
                    return False
            return True

        elif hand_type == 'five':
            rank = claim.get('rank')
            if not rank:
                return False
            for c in naturals:
                if c.rank != rank:
                    return False
            return True

        elif hand_type == 'full_house':
            r_triple = claim.get('triple_rank')
            r_pair = claim.get('pair_rank')
            if not r_triple or not r_pair or r_triple == r_pair:
                return False

            count_triple = 0
            count_pair = 0
            for c in naturals:
                if c.rank == r_triple:
                    count_triple += 1
                elif c.rank == r_pair:
                    count_pair += 1
                else:
                    return False

            needed_triple = max(0, 3 - count_triple)
            needed_pair = max(0, 2 - count_pair)
            return (needed_triple + needed_pair) <= num_wild

        elif hand_type == 'straight':
            high_rank = claim.get('high_rank')
            if not high_rank:
                return False

            if high_rank == 5:
                target_ranks = {14, 2, 3, 4, 5}
            else:
                target_ranks = {high_rank - 4, high_rank - 3, high_rank - 2, high_rank - 1, high_rank}

            seen_ranks = set()
            for c in naturals:
                if c.rank not in target_ranks or c.rank in seen_ranks:
                    return False
                seen_ranks.add(c.rank)

            needed_wilds = len(target_ranks - seen_ranks)
            return needed_wilds <= num_wild

        elif hand_type == 'straight_flush':
            high_rank = claim.get('high_rank')
            suit = claim.get('suit')
            if not high_rank or not suit:
                return False

            if high_rank == 5:
                target_ranks = {14, 2, 3, 4, 5}
            else:
                target_ranks = {high_rank - 4, high_rank - 3, high_rank - 2, high_rank - 1, high_rank}

            seen_ranks = set()
            for c in naturals:
                if c.effective_suit() != suit:
                    return False
                if c.rank not in target_ranks or c.rank in seen_ranks:
                    return False
                seen_ranks.add(c.rank)

            needed_wilds = len(target_ranks - seen_ranks)
            return needed_wilds <= num_wild

        return False

    @staticmethod
    def compare_claims(new_claim: Dict[str, Any], current_claim: Optional[Dict[str, Any]]) -> bool:
        if not current_claim:
            return True

        new_type = new_claim.get('type')
        curr_type = current_claim.get('type')

        if new_type != curr_type:
            return False

        if new_type in ['pair', 'three', 'four', 'five']:
            return new_claim.get('rank', 0) > current_claim.get('rank', 0)

        elif new_type == 'full_house':
            new_triple = new_claim.get('triple_rank', 0)
            curr_triple = current_claim.get('triple_rank', 0)
            if new_triple != curr_triple:
                return new_triple > curr_triple
            return new_claim.get('pair_rank', 0) > current_claim.get('pair_rank', 0)

        elif new_type == 'straight':
            return new_claim.get('high_rank', 0) > current_claim.get('high_rank', 0)

        elif new_type == 'straight_flush':
            new_high = new_claim.get('high_rank', 0)
            curr_high = current_claim.get('high_rank', 0)
            if new_high != curr_high:
                return new_high > curr_high
            suit_order = {'L': 8, 'K': 7, 'M': 6, 'X': 5, 'H': 4, 'D': 3, 'C': 2, 'S': 1}
            return suit_order.get(new_claim.get('suit', ''), 0) > suit_order.get(current_claim.get('suit', ''), 0)

        return False

    @staticmethod
    def describe_claim(claim: Dict[str, Any]) -> str:
        t = claim.get('type', '')
        t_name = HAND_TYPE_NAMES.get(t, t)
        if t in ['pair', 'three', 'four', 'five']:
            r = claim.get('rank', 0)
            return f"{t_name} {RANK_NAMES.get(r, str(r))}"
        elif t == 'full_house':
            tr = claim.get('triple_rank', 0)
            pr = claim.get('pair_rank', 0)
            return f"Cù lũ {RANK_NAMES.get(tr, str(tr))} qua đôi {RANK_NAMES.get(pr, str(pr))}"
        elif t == 'straight':
            h = claim.get('high_rank', 0)
            return f"Sảnh tới {RANK_NAMES.get(h, str(h))}"
        elif t == 'straight_flush':
            h = claim.get('high_rank', 0)
            s = claim.get('suit', '')
            return f"Thùng phá sảnh tới {RANK_NAMES.get(h, str(h))} chất {SUIT_NAMES.get(s, s)}"
        return "Thế bài bí ẩn"
