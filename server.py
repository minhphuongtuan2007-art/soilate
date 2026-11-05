"""
Soilate Multiplayer Game Server
Combines an HTTP Static Server (port 8000) and WebSocket Real-time Server (port 8765).
"""

import asyncio
import json
import os
import random
import sys
import threading
import traceback
from http.server import HTTPServer, SimpleHTTPRequestHandler
from typing import Dict, List, Optional, Any

if sys.platform == 'win32':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

import websockets
from websockets.asyncio.server import ServerConnection

from game_logic import (
    Card, HandEvaluator, create_dynamic_deck,
    ALL_SUITS, SUIT_NAMES, SUIT_COLORS, RANKS, RANK_NAMES,
    HAND_TYPES, HAND_TYPE_NAMES, HAND_TYPE_CARD_COUNT,
    TOOL_DEFINITIONS, ALL_TOOL_KEYS, SPECIAL_CARDS_SPAWN
)

STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'static')
HTTP_PORT = int(os.environ.get("HTTP_PORT", 8000))
WS_PORT = int(os.environ.get("PORT", os.environ.get("WS_PORT", 8765)))
IS_CLOUD = bool(os.environ.get("PORT") or os.environ.get("RENDER") or os.environ.get("RAILWAY_STATIC_URL"))

BOT_NAMES = ["Alice Bot 🤖", "Bob Bot 🤖", "Charlie Bot 🤖", "Luna Bot 🤖", "Zack Bot 🤖"]

class Player:
    def __init__(self, player_id: str, name: str, is_bot: bool = False, ws: Optional[ServerConnection] = None):
        self.id = player_id
        self.name = name
        self.is_bot = is_bot
        self.ws = ws
        self.hand: List[Card] = []
        self.is_host = False
        self.tool_used = False
        self.disabled_tools = False
        self.assigned_tool: Optional[str] = None
        self.finished_rank: Optional[int] = None # 1st, 2nd, etc.
        self.peek_cache: Optional[Dict[str, Any]] = None

    def is_connected(self) -> bool:
        if self.is_bot:
            return True
        if self.ws is None:
            return False
        try:
            from websockets.protocol import State
            return self.ws.state == State.OPEN
        except Exception:
            return True

    def sort_hand(self):
        # Sort regular cards by rank then suit; special cards at end
        self.hand.sort(key=lambda c: (1 if c.is_special else 0, c.rank, c.effective_suit()))

    def to_summary(self) -> Dict[str, Any]:
        return {
            'id': self.id,
            'name': self.name,
            'is_bot': self.is_bot,
            'is_host': self.is_host,
            'card_count': len(self.hand),
            'tool_used': self.tool_used,
            'disabled_tools': self.disabled_tools,
            'assigned_tool': self.assigned_tool,
            'finished_rank': self.finished_rank
        }

class TableCard:
    def __init__(self, card: Card, face_up: bool, owner_id: str):
        self.card = card
        self.face_up = face_up
        self.owner_id = owner_id

    def to_dict(self, reveal_all: bool = False) -> Dict[str, Any]:
        if self.face_up or reveal_all:
            d = self.card.to_dict(face_up=True)
            d['face_up'] = True
            d['owner_id'] = self.owner_id
            return d
        else:
            return {
                'id': self.card.id,
                'face_up': False,
                'is_hidden': True,
                'owner_id': self.owner_id
            }

class GameRoom:
    def __init__(self, room_id: str, name: str):
        self.id = room_id
        self.name = name
        self.players: List[Player] = []
        self.state: str = 'LOBBY' # 'LOBBY', 'PLAYING', 'CALL_RESOLVING', 'GAME_OVER'
        self.deck: List[Card] = []
        self.discard_pile: List[Card] = []
        self.current_turn_index: int = 0
        self.table_cards: List[TableCard] = []
        self.table_claim: Optional[Dict[str, Any]] = None
        self.table_claim_desc: Optional[str] = None
        self.last_player_id: Optional[str] = None
        self.pass_count: int = 0
        self.pending_penalty: Optional[Dict[str, Any]] = None
        self.finish_order: List[str] = []
        self.logs: List[str] = []
        self.call_history: Optional[Dict[str, Any]] = None
        self.game_over_countdown: Optional[int] = None
        self.lock = asyncio.Lock()

    def add_log(self, msg: str):
        self.logs.append(msg)
        if len(self.logs) > 60:
            self.logs.pop(0)

    def get_player(self, player_id: str) -> Optional[Player]:
        for p in self.players:
            if p.id == player_id:
                return p
        return None

    def active_players(self) -> List[Player]:
        return [p for p in self.players if p.finished_rank is None]

    def current_player(self) -> Optional[Player]:
        if not self.players:
            return None
        active = self.active_players()
        if not active:
            return None
        idx = self.current_turn_index % len(self.players)
        return self.players[idx]

    def advance_turn(self):
        active = self.active_players()
        if len(active) <= 1:
            self.check_game_over()
            return

        for _ in range(len(self.players)):
            self.current_turn_index = (self.current_turn_index + 1) % len(self.players)
            cand = self.players[self.current_turn_index]
            if cand.finished_rank is None:
                if len(cand.hand) == 0:
                    self.check_player_finished(cand)
                    if self.state == 'GAME_OVER':
                        return
                    continue
                self.check_single_card_draw(cand)
                break

    def set_turn_to(self, player_id: str):
        for idx, p in enumerate(self.players):
            if p.id == player_id:
                self.current_turn_index = idx
                if p.finished_rank is None:
                    if len(p.hand) == 0:
                        self.check_player_finished(p)
                        if self.state != 'GAME_OVER':
                            self.advance_turn()
                        return
                    self.check_single_card_draw(p)
                return

    def reset_round_tools(self):
        for p in self.players:
            p.tool_used = False
            p.disabled_tools = False
            p.peek_cache = None
            p.assigned_tool = random.choice(ALL_TOOL_KEYS)
        self.add_log("🛠️ Công cụ mới đã được phân phát ngẫu nhiên cho mỗi người chơi!")

    def start_game(self):
        if len(self.players) < 2:
            return False, "Cần ít nhất 2 người chơi hoặc Bot để bắt đầu!"

        self.deck, spawned_specials = create_dynamic_deck(len(self.players))
        self.discard_pile = []
        self.table_cards = []
        self.table_claim = None
        self.table_claim_desc = None
        self.last_player_id = None
        self.pass_count = 0
        self.pending_penalty = None
        self.finish_order = []
        self.call_history = None
        self.game_over_countdown = None
        self.state = 'PLAYING'
        self.logs = []
        self.add_log("=== VÁN MỚI BẮT ĐẦU ===")
        if spawned_specials:
            self.add_log(f"✨ Lá bài bí ẩn xuất hiện ván này: {', '.join(spawned_specials)}")

        # Deal cards: 12 cards for <=4 players, 10 for >4
        deal_count = 12 if len(self.players) <= 4 else 10
        for p in self.players:
            p.hand = [self.deck.pop() for _ in range(deal_count)]
            p.sort_hand()
            p.finished_rank = None
            p.tool_used = False
            p.disabled_tools = False

        self.reset_round_tools()
        self.current_turn_index = 0
        self.add_log(f"Lượt đầu tiên thuộc về {self.current_player().name}.")
        return True, "Trò chơi đã bắt đầu!"

    def check_player_finished(self, p: Player):
        if len(p.hand) == 0 and p.finished_rank is None:
            rank = len(self.finish_order) + 1
            p.finished_rank = rank
            self.finish_order.append(p.id)
            self.add_log(f"🎉 Người chơi {p.name} đã XẢ HẾT BÀI và về đích ở Vị trí #{rank}!")
            self.check_game_over()

    def check_single_card_draw(self, p: Player) -> bool:
        """
        Quy tắc Soilate: Nếu người chơi chỉ còn đúng 1 lá bài trên tay,
        bắt buộc phải bốc thêm 1 lá ngẫu nhiên từ nọc bài (hoặc từ chồng bài bỏ nếu nọc hết).
        """
        if len(p.hand) == 1 and p.finished_rank is None:
            drawn = None
            if self.deck:
                drawn = self.deck.pop()
            elif self.discard_pile:
                idx = random.randrange(len(self.discard_pile))
                drawn = self.discard_pile.pop(idx)
            
            if drawn:
                p.hand.append(drawn)
                p.sort_hand()
                self.add_log(f"⚠️ {p.name} chỉ còn đúng 1 lá bài! Theo luật, phải bốc thêm 1 lá ngẫu nhiên từ nọc bài!")
                return True
        return False

    def check_all_single_card_rules(self):
        for p in self.active_players():
            self.check_single_card_draw(p)

    def check_game_over(self):
        active = self.active_players()
        if len(active) <= 1:
            self.state = 'GAME_OVER'
            if len(active) == 1:
                loser = active[0]
                rank = len(self.finish_order) + 1
                loser.finished_rank = rank
                self.finish_order.append(loser.id)
                self.add_log(f"💀 Người chơi {loser.name} là người giữ bài cuối cùng và THUA CUỘC!")
            self.add_log("=== TRÒ CHƠI KẾT THÚC ===")
            self.game_over_countdown = 5
            self.add_log("⏱️ Ván mới sẽ tự động bắt đầu sau 5 giây...")

    def handle_play_hand(self, player: Player, card_ids: List[str], face_up_ids: List[str], claim: Dict[str, Any]) -> Tuple[bool, str]:
        if self.state != 'PLAYING':
            return False, "Trạng thái không thể đánh bài."
        if self.current_player().id != player.id:
            return False, "Chưa tới lượt của bạn!"

        # Verify player owns these cards
        hand_map = {c.id: c for c in player.hand}
        chosen_cards: List[Card] = []
        for cid in card_ids:
            if cid not in hand_map:
                return False, f"Bạn không sở hữu lá bài {cid}!"
            chosen_cards.append(hand_map[cid])

        hand_type = claim.get('type')
        if hand_type not in HAND_TYPES:
            return False, "Thế bài tuyên bố không hợp lệ!"

        req_count = HAND_TYPE_CARD_COUNT.get(hand_type, 0)
        if len(chosen_cards) != req_count:
            return False, f"Thế bài '{HAND_TYPE_NAMES.get(hand_type)}' yêu cầu đúng {req_count} lá bài!"

        # Verify at least 1 card is face-up
        if not face_up_ids:
            return False, "Luật Soilate bắt buộc phải lật ngửa ít nhất 1 lá bài!"

        for fid in face_up_ids:
            if fid not in card_ids:
                return False, "Lá bài ngửa phải nằm trong số các lá bài được đánh ra!"

        # Check beat current claim
        if self.table_claim:
            if not HandEvaluator.compare_claims(claim, self.table_claim):
                return False, f"Thế bài đánh ra phải cùng loại và cao hơn '{self.table_claim_desc}'!"

        # Remove cards from player's hand
        player.hand = [c for c in player.hand if c.id not in card_ids]
        player.sort_hand()

        # Archive old table cards to discard pile if this is following
        if self.table_cards:
            for tc in self.table_cards:
                self.discard_pile.append(tc.card)

        # If previous player had 0 cards and was not called (current player followed with higher combo),
        # then previous player successfully finished!
        if self.last_player_id and self.last_player_id != player.id:
            prev_p = self.get_player(self.last_player_id)
            if prev_p and len(prev_p.hand) == 0 and prev_p.finished_rank is None:
                self.check_player_finished(prev_p)

        # Place new table cards
        self.table_cards = []
        for c in chosen_cards:
            is_up = c.id in face_up_ids
            self.table_cards.append(TableCard(c, is_up, player.id))

        self.table_claim = claim
        claim_desc = HandEvaluator.describe_claim(claim)
        self.table_claim_desc = claim_desc
        self.last_player_id = player.id
        self.pass_count = 0
        self.call_history = None

        up_count = len(face_up_ids)
        down_count = len(chosen_cards) - up_count
        self.add_log(f"{player.name} đánh: {claim_desc} ({up_count} lá ngửa, {down_count} lá úp).")

        # Check single card draw rule
        self.check_single_card_draw(player)

        # Move turn to next active player
        self.advance_turn()
        return True, "Đánh bài thành công!"

    def handle_call_bluff(self, caller: Player) -> Tuple[bool, str]:
        if self.state != 'PLAYING':
            return False, "Không thể Call lúc này."
        if self.current_player().id != caller.id:
            return False, "Chưa tới lượt của bạn để Call!"
        if not self.table_claim or not self.table_cards or not self.last_player_id:
            return False, "Bàn chơi chưa có bài để Call!"

        accused = self.get_player(self.last_player_id)
        if not accused:
            return False, "Không tìm thấy người bị bắt bài!"

        actual_cards = [tc.card for tc in self.table_cards]
        is_honest = HandEvaluator.verify_claim(actual_cards, self.table_claim)

        # Reveal all table cards
        for tc in self.table_cards:
            tc.face_up = True

        revealed_details = [tc.card.to_dict(face_up=True) for tc in self.table_cards]

        if not is_honest:
            # BLUFF CAUGHT! Caller wins!
            self.add_log(f"⚡ {caller.name} đã CALL bắt bài {accused.name}!")
            self.add_log(f"💥 BẮT BÀI ĐÚNG! {accused.name} ĐÃ NÓI DỐI!")
            winner = caller
            loser = accused
            was_bluff = True

            # Discard pile draw penalty on bluffer (người đánh sai)
            if len(accused.hand) == 0:
                # Bluffing out (đánh hết bài nhưng gian lận)
                discard_draw_count = 10
                self.add_log(f"🚨 {accused.name} CỐ TÌNH XẢ HẾT BÀI BẰNG CÁCH NÓI DỐI VÀ BỊ PHÁT HIỆN! Bị phạt bốc 10 LÁ từ chồng bài bỏ/nọc!")
            else:
                cards_played = len(self.table_cards)
                discard_draw_count = max(0, cards_played - 1)
                self.add_log(f"💥 {accused.name} ĐÁNH SAI: Bị phạt lấy {discard_draw_count} lá ({cards_played} - 1) từ chồng bài bỏ!")

            # Execute discard pile draw into accused hand
            drawn_from_discard = []
            for _ in range(discard_draw_count):
                if self.discard_pile:
                    idx = random.randrange(len(self.discard_pile))
                    drawn_from_discard.append(self.discard_pile.pop(idx))
                elif self.deck:
                    drawn_from_discard.append(self.deck.pop())

            if drawn_from_discard:
                accused.hand.extend(drawn_from_discard)
                accused.sort_hand()
                self.add_log(f"⚠️ {accused.name} đã phải nhận phạt {len(drawn_from_discard)} lá vào tay!")
        else:
            # HONEST! Accused wins!
            self.add_log(f"⚡ {caller.name} đã CALL bắt bài {accused.name}!")
            self.add_log(f"🛡️ CALL SAI! {accused.name} ĐÁNH THẬT và hoàn toàn trung thực!")
            winner = accused
            loser = caller
            was_bluff = False

        self.call_history = {
            'caller_id': caller.id,
            'caller_name': caller.name,
            'accused_id': accused.id,
            'accused_name': accused.name,
            'was_bluff': was_bluff,
            'revealed_cards': revealed_details,
            'winner_id': winner.id,
            'winner_name': winner.name,
            'loser_id': loser.id,
            'loser_name': loser.name
        }

        # Winner penalizes loser by giving 1 card of choice from winner's hand!
        if len(winner.hand) > 0:
            self.state = 'CALL_RESOLVING'
            self.pending_penalty = {
                'winner_id': winner.id,
                'loser_id': loser.id,
                'winner_name': winner.name,
                'loser_name': loser.name
            }
            self.add_log(f"👉 {winner.name} giành chiến thắng Call và được chọn 1 lá bài trên tay tống cho {loser.name}!")
        else:
            # Winner already has 0 cards, wins immediately!
            self.finalize_call_resolution(winner, loser, None)

        return True, "Call đã được thực hiện."

    def finalize_call_resolution(self, winner: Player, loser: Player, given_card_id: Optional[str]):
        if given_card_id:
            c = next((x for x in winner.hand if x.id == given_card_id), None)
            if c:
                winner.hand.remove(c)
                loser.hand.append(c)
                loser.sort_hand()
                self.add_log(f"📦 {winner.name} đã đưa lá {c.to_dict(face_up=True)['rank_name']} {c.to_dict(face_up=True)['suit_name']} cho {loser.name}.")

        # Check single card draw rule if either player is down to 1 card
        self.check_single_card_draw(winner)
        self.check_single_card_draw(loser)

        # Check if winner is now out of cards
        self.check_player_finished(winner)
        self.check_player_finished(loser)

        # Clear table cards into discard pile
        for tc in self.table_cards:
            self.discard_pile.append(tc.card)
        self.table_cards = []
        self.table_claim = None
        self.table_claim_desc = None
        self.last_player_id = None
        self.pass_count = 0
        self.pending_penalty = None
        self.reset_round_tools()

        if self.state != 'GAME_OVER':
            self.state = 'PLAYING'
            # Winner starts the new round with any hand they like!
            if winner.finished_rank is None:
                self.set_turn_to(winner.id)
                self.add_log(f"🔥 {winner.name} mở màn vòng mới với bất kỳ thế bài nào tùy thích!")
            else:
                self.advance_turn()
                self.add_log(f"🔥 Lượt mở màn vòng mới chuyển sang {self.current_player().name}!")

    def handle_pass(self, player: Player) -> Tuple[bool, str]:
        if self.state != 'PLAYING':
            return False, "Không thể bỏ lượt lúc này."
        if self.current_player().id != player.id:
            return False, "Chưa tới lượt của bạn!"
        if not self.table_claim:
            return False, "Bạn là người bắt đầu vòng mới, bắt buộc phải đánh bài!"

        self.add_log(f"{player.name} Bỏ lượt (Pass).")
        self.pass_count += 1
        active = self.active_players()

        # If all other players passed, last player who played gets a fresh table
        if self.pass_count >= len(active) - 1:
            last_p = self.get_player(self.last_player_id) if self.last_player_id else active[0]
            self.add_log(f"🌟 Tất cả mọi người đã bỏ qua! {last_p.name} thắng bàn bài này!")
            for tc in self.table_cards:
                self.discard_pile.append(tc.card)
            self.table_cards = []
            self.table_claim = None
            self.table_claim_desc = None
            self.last_player_id = None
            self.pass_count = 0
            self.reset_round_tools()

            # Check if last_p finished their cards without being called
            if last_p and len(last_p.hand) == 0:
                self.check_player_finished(last_p)

            if self.state != 'GAME_OVER':
                if last_p and last_p.finished_rank is None:
                    self.set_turn_to(last_p.id)
                    self.add_log(f"🔥 {last_p.name} mở màn vòng mới với bất kỳ thế bài nào tùy thích!")
                else:
                    self.advance_turn()
                    curr = self.current_player()
                    if curr:
                        self.add_log(f"🔥 Lượt mở màn vòng mới chuyển sang {curr.name}!")
        else:
            self.advance_turn()

        return True, "Đã bỏ lượt."

    def handle_use_tool(self, player: Player, tool_id: str, payload: Dict[str, Any]) -> Tuple[bool, str]:
        if self.state != 'PLAYING':
            return False, "Không thể dùng công cụ lúc này."
        if player.disabled_tools:
            return False, "Bạn đã bị đối thủ vô hiệu hoá công cụ trong vòng này!"
        if player.tool_used:
            return False, "Bạn đã sử dụng công cụ của vòng này rồi!"
        if player.assigned_tool != tool_id:
            return False, "Bạn không sở hữu công cụ này trong vòng này!"

        # Check timing: own_turn vs anytime
        tool_info = TOOL_DEFINITIONS.get(tool_id, {})
        timing = tool_info.get('timing', 'own_turn')
        if timing == 'own_turn' and self.current_player().id != player.id:
            return False, "Công cụ này chỉ được dùng trong lượt đánh của bạn!"

        # Tools:
        # 1. DRAW_RANDOM
        if tool_id == 'DRAW_RANDOM':
            if not self.deck:
                return False, "Nọc bài đã hết!"
            card = self.deck.pop()
            player.hand.append(card)
            player.sort_hand()
            player.tool_used = True
            self.add_log(f"🛠️ {player.name} dùng công cụ: Bốc 1 lá ngẫu nhiên từ nọc bài.")
            return True, "Đã bốc 1 lá bài."

        # 2. SWAP_RANDOM
        elif tool_id == 'SWAP_RANDOM':
            card_id = payload.get('card_id')
            c = next((x for x in player.hand if x.id == card_id), None)
            if not c:
                return False, "Lá bài cần đổi không có trong tay!"
            if not self.deck:
                return False, "Nọc bài đã hết!"
            player.hand.remove(c)
            self.discard_pile.append(c)
            new_card = self.deck.pop()
            player.hand.append(new_card)
            player.sort_hand()
            player.tool_used = True
            self.add_log(f"🛠️ {player.name} dùng công cụ: Đổi 1 lá trên tay lấy 1 lá mới ngẫu nhiên.")
            return True, "Đã đổi lá bài thành công."

        # 3. SWAP_DECK
        elif tool_id == 'SWAP_DECK':
            target_id = payload.get('target_player_id')
            target = self.get_player(target_id)
            if not target or target.id == player.id:
                return False, "Mục tiêu đổi Deck không hợp lệ!"
            if target.finished_rank is not None:
                return False, "Không thể đổi deck với người đã hết bài!"
            player.hand, target.hand = target.hand, player.hand
            player.sort_hand()
            target.sort_hand()
            self.check_single_card_draw(player)
            self.check_single_card_draw(target)
            player.tool_used = True
            self.add_log(f"⚡⚡ ĐẢO NGƯỢC THẾ CỜ: {player.name} ĐỔI TOÀN BỘ BỘ BÀI VỚI {target.name}!")
            return True, f"Đã hoán đổi toàn bộ bài với {target.name}!"

        # 4. CHANGE_SUIT
        elif tool_id == 'CHANGE_SUIT':
            card_id = payload.get('card_id')
            new_suit = payload.get('new_suit')
            if new_suit not in ALL_SUITS:
                return False, "Chất mới không hợp lệ!"
            c = next((x for x in player.hand if x.id == card_id), None)
            if not c:
                return False, "Lá bài không có trong tay!"
            c.altered_suit = new_suit
            player.tool_used = True
            self.add_log(f"🛠️ {player.name} dùng công cụ: Biến đổi chất 1 lá bài thành {SUIT_NAMES.get(new_suit)}.")
            return True, f"Đã đổi chất lá bài sang {SUIT_NAMES.get(new_suit)}."

        # 5. DISABLE_TOOL
        elif tool_id == 'DISABLE_TOOL':
            target_id = payload.get('target_player_id')
            target = self.get_player(target_id)
            if not target or target.id == player.id:
                return False, "Đối thủ được chọn không hợp lệ!"
            target.disabled_tools = True
            player.tool_used = True
            self.add_log(f"🚫 {player.name} vô hiệu hoá tính năng công cụ của {target.name} trong vòng này!")
            return True, f"Đã khóa công cụ của {target.name}."

        # 6. PEEK_CARD
        elif tool_id == 'PEEK_CARD':
            hidden_cards = [tc for tc in self.table_cards if not tc.face_up]
            if not hidden_cards:
                return False, "Trên bàn không có lá bài úp nào để soi!"
            target_card = random.choice(hidden_cards)
            player.peek_cache = target_card.card.to_dict(face_up=True)
            player.tool_used = True
            self.add_log(f"👁️ {player.name} dùng kính chiếu yêu soi 1 lá bài úp của đối thủ!")
            return True, "Đã soi thành công lá bài úp."

        # 7. FORCE_REVEAL
        elif tool_id == 'FORCE_REVEAL':
            hidden_cards = [tc for tc in self.table_cards if not tc.face_up]
            if not hidden_cards:
                return False, "Trên bàn không có lá bài úp nào để bắt lật!"
            target_card = random.choice(hidden_cards)
            target_card.face_up = True
            player.tool_used = True
            c_info = target_card.card.to_dict(face_up=True)
            self.add_log(f"💥 {player.name} BẮT BUỘC ĐỐI THỦ LẬT NGỬA 1 LÁ ÚP: Đó là lá {c_info['rank_name']} {c_info['suit_name']}!")
            return True, "Đã bắt đối thủ lật ngửa 1 lá úp."

        return False, "Công cụ không được hỗ trợ."

    def handle_play_special_card(self, player: Player, card_id: str) -> Tuple[bool, str]:
        if self.state != 'PLAYING':
            return False, "Trạng thái không thể kích hoạt lá đặc biệt."
        if self.current_player().id != player.id:
            return False, "Chỉ được kích hoạt lá đặc biệt trong lượt của bạn!"

        card = next((c for c in player.hand if c.id == card_id and c.is_special), None)
        if not card:
            return False, "Không tìm thấy lá bài đặc biệt trên tay!"

        player.hand.remove(card)
        self.discard_pile.append(card)
        self.check_single_card_draw(player)

        stype = card.special_type
        if stype == 'SKIP':
            self.add_log(f"⏭️ {player.name} kích hoạt lá SKIP CARD! Kết thúc lượt và bỏ qua người kế tiếp!")
            self.advance_turn()
            if self.state != 'GAME_OVER':
                skipped = self.current_player()
                if skipped:
                    self.add_log(f"🚫 {skipped.name} BỊ SKIP MẤT LƯỢT!")
                    self.advance_turn()
            return True, "Đã kích hoạt Skip Card!"

        elif stype == 'ATTACK':
            # Next player draws 2 cards
            idx = (self.current_turn_index + 1) % len(self.players)
            next_p = None
            for _ in range(len(self.players)):
                cand = self.players[idx]
                if cand.finished_rank is None and cand.id != player.id:
                    next_p = cand
                    break
                idx = (idx + 1) % len(self.players)

            if next_p:
                drawn = []
                for _ in range(2):
                    if self.deck:
                        drawn.append(self.deck.pop())
                    elif self.discard_pile:
                        drawn.append(self.discard_pile.pop())
                next_p.hand.extend(drawn)
                next_p.sort_hand()
                self.add_log(f"⚔️ {player.name} kích hoạt ATTACK CARD! Ép {next_p.name} phải bốc phạt 2 lá!")
            return True, "Đã kích hoạt Attack Card! Bạn vẫn phải đánh bài tiếp."

        elif stype == 'OPEN_ALL':
            for tc in self.table_cards:
                tc.face_up = True
            self.add_log(f"👁️‍🗨️ {player.name} kích hoạt OPEN ALL CARD! Lật ngửa toang toàn bộ bài úp trên bàn!")
            return True, "Đã lật ngửa toàn bộ bài trên bàn!"

        elif stype == 'CHAOS':
            for p in self.active_players():
                drawn = []
                for _ in range(10):
                    if self.deck:
                        drawn.append(self.deck.pop())
                    elif self.discard_pile:
                        drawn.append(self.discard_pile.pop())
                p.hand.extend(drawn)
                p.sort_hand()
            self.add_log(f"🌀 {player.name} KÍCH HOẠT CHAOS CARD! Cơn lốc hỗn mang: TẤT CẢ NGƯỜI CHƠI BỐC 10 LÁ!")
            return True, "Đã kích hoạt Chaos Card!"

        elif stype == 'WINNER':
            player.hand = []
            self.check_player_finished(player)
            self.add_log(f"👑 {player.name} KÍCH HOẠT LÁ BÀI THẦN THOẠI WINNER CARD! CHIẾN THẮNG TRẬN ĐẤU NGAY LẬP TỨC!")
            return True, "Chiến thắng game!"

        return False, "Lá đặc biệt không hợp lệ."

    def bot_action_tick(self):
        """
        AI Bot autonomous decision maker for current game state.
        """
        # 1. Handle pending penalty when winner is a bot
        if self.state == 'CALL_RESOLVING' and self.pending_penalty:
            winner_id = self.pending_penalty['winner_id']
            winner = self.get_player(winner_id)
            loser = self.get_player(self.pending_penalty['loser_id'])
            if winner and winner.is_bot and len(winner.hand) > 0:
                # Bot picks worst card to give away
                worst_card = max(winner.hand, key=lambda c: c.rank)
                self.finalize_call_resolution(winner, loser, worst_card.id)
            return

        if self.state != 'PLAYING':
            return

        curr = self.current_player()
        if not curr or not curr.is_bot:
            return

        # 0. Check if Bot has Special Cards to play
        specials = [c for c in curr.hand if c.is_special]
        for sp in specials:
            if sp.special_type == 'WINNER':
                self.handle_play_special_card(curr, sp.id)
                return
            elif sp.special_type == 'OPEN_ALL' and self.table_cards and any(not tc.face_up for tc in self.table_cards):
                if random.random() < 0.8:
                    self.handle_play_special_card(curr, sp.id)
                    break
            elif sp.special_type == 'ATTACK':
                if random.random() < 0.6:
                    self.handle_play_special_card(curr, sp.id)
                    break
            elif sp.special_type == 'CHAOS':
                if len(curr.hand) > 3 and random.random() < 0.4:
                    self.handle_play_special_card(curr, sp.id)
                    break
            elif sp.special_type == 'SKIP':
                if self.table_claim and random.random() < 0.4:
                    self.handle_play_special_card(curr, sp.id)
                    return

        # 1. Check if Bot can use its assigned tool
        if not curr.tool_used and not curr.disabled_tools and curr.assigned_tool:
            t = curr.assigned_tool
            if t == 'DRAW_RANDOM' and len(curr.hand) < 4:
                self.handle_use_tool(curr, 'DRAW_RANDOM', {})
            elif t == 'SWAP_RANDOM' and curr.hand:
                worst = max(curr.hand, key=lambda c: c.rank)
                self.handle_use_tool(curr, 'SWAP_RANDOM', {'card_id': worst.id})
            elif t == 'SWAP_DECK':
                for other in self.active_players():
                    if other.id != curr.id and len(other.hand) <= 2 and len(curr.hand) >= 5:
                        self.handle_use_tool(curr, 'SWAP_DECK', {'target_player_id': other.id})
                        break
            elif t == 'FORCE_REVEAL' and self.table_cards and any(not tc.face_up for tc in self.table_cards):
                if random.random() < 0.6:
                    self.handle_use_tool(curr, 'FORCE_REVEAL', {})
            elif t == 'PEEK_CARD' and self.table_cards and any(not tc.face_up for tc in self.table_cards):
                if random.random() < 0.6:
                    self.handle_use_tool(curr, 'PEEK_CARD', {})

        # 2. Decide Call, Play, or Pass
        if self.table_claim:
            # Facing an existing play
            # Decide if CALL
            should_call = False
            hidden_count = sum(1 for tc in self.table_cards if not tc.face_up)
            
            # If claim is huge (Straight Flush / 5-of-a-kind) and multiple face down
            if self.table_claim.get('type') in ['five', 'straight_flush'] and hidden_count >= 2:
                should_call = random.random() < 0.65
            elif hidden_count >= 3:
                should_call = random.random() < 0.45
            else:
                should_call = random.random() < 0.15

            if should_call:
                self.handle_call_bluff(curr)
                return

            # Try to beat table claim
            play_decision = self.bot_find_beating_play(curr, self.table_claim)
            if play_decision:
                c_ids, f_ids, claim = play_decision
                self.handle_play_hand(curr, c_ids, f_ids, claim)
                return
            else:
                # If can't beat legitimately, decide to bluff or pass
                if random.random() < 0.35 and len(curr.hand) >= HAND_TYPE_CARD_COUNT.get(self.table_claim.get('type', ''), 99):
                    bluff_decision = self.bot_construct_bluff(curr, self.table_claim)
                    if bluff_decision:
                        c_ids, f_ids, claim = bluff_decision
                        self.handle_play_hand(curr, c_ids, f_ids, claim)
                        return
                self.handle_pass(curr)
                return
        else:
            # Lead a new round!
            lead_decision = self.bot_find_best_lead(curr)
            if lead_decision:
                c_ids, f_ids, claim = lead_decision
                self.handle_play_hand(curr, c_ids, f_ids, claim)
            else:
                # Fallback bluff pair
                bluff_decision = self.bot_construct_bluff(curr, None)
                if bluff_decision:
                    c_ids, f_ids, claim = bluff_decision
                    self.handle_play_hand(curr, c_ids, f_ids, claim)

    def bot_find_best_lead(self, bot: Player) -> Optional[Tuple[List[str], List[str], Dict[str, Any]]]:
        # Group by rank
        from collections import defaultdict
        rank_groups = defaultdict(list)
        for c in bot.hand:
            rank_groups[c.rank].append(c)

        # 1. Five of a kind
        for r, cards in rank_groups.items():
            if len(cards) >= 5:
                chosen = cards[:5]
                return [c.id for c in chosen], [chosen[0].id], {'type': 'five', 'rank': r}
        # 2. Four of a kind
        for r, cards in rank_groups.items():
            if len(cards) >= 4:
                chosen = cards[:4]
                return [c.id for c in chosen], [chosen[0].id], {'type': 'four', 'rank': r}
        # 3. Full house (3 of r1 + 2 of r2)
        triples = [r for r, cards in rank_groups.items() if len(cards) >= 3]
        pairs = [r for r, cards in rank_groups.items() if len(cards) >= 2]
        for tr in triples:
            for pr in pairs:
                if tr != pr:
                    chosen = rank_groups[tr][:3] + rank_groups[pr][:2]
                    return [c.id for c in chosen], [chosen[0].id], {'type': 'full_house', 'triple_rank': tr, 'pair_rank': pr}
        # 4. Three of a kind
        for r, cards in rank_groups.items():
            if len(cards) >= 3:
                chosen = cards[:3]
                return [c.id for c in chosen], [chosen[0].id], {'type': 'three', 'rank': r}
        # 5. Pair
        for r, cards in rank_groups.items():
            if len(cards) >= 2:
                chosen = cards[:2]
                return [c.id for c in chosen], [chosen[0].id], {'type': 'pair', 'rank': r}

        return None

    def bot_find_beating_play(self, bot: Player, current_claim: Dict[str, Any]) -> Optional[Tuple[List[str], List[str], Dict[str, Any]]]:
        from collections import defaultdict
        hand_type = current_claim.get('type')
        rank_groups = defaultdict(list)
        for c in bot.hand:
            rank_groups[c.rank].append(c)

        if hand_type == 'pair':
            min_r = current_claim.get('rank', 0)
            for r in sorted(rank_groups.keys()):
                if r > min_r and len(rank_groups[r]) >= 2:
                    chosen = rank_groups[r][:2]
                    return [c.id for c in chosen], [chosen[0].id], {'type': 'pair', 'rank': r}
        elif hand_type == 'three':
            min_r = current_claim.get('rank', 0)
            for r in sorted(rank_groups.keys()):
                if r > min_r and len(rank_groups[r]) >= 3:
                    chosen = rank_groups[r][:3]
                    return [c.id for c in chosen], [chosen[0].id], {'type': 'three', 'rank': r}
        elif hand_type == 'four':
            min_r = current_claim.get('rank', 0)
            for r in sorted(rank_groups.keys()):
                if r > min_r and len(rank_groups[r]) >= 4:
                    chosen = rank_groups[r][:4]
                    return [c.id for c in chosen], [chosen[0].id], {'type': 'four', 'rank': r}
        elif hand_type == 'five':
            min_r = current_claim.get('rank', 0)
            for r in sorted(rank_groups.keys()):
                if r > min_r and len(rank_groups[r]) >= 5:
                    chosen = rank_groups[r][:5]
                    return [c.id for c in chosen], [chosen[0].id], {'type': 'five', 'rank': r}
        return None

    def bot_construct_bluff(self, bot: Player, current_claim: Optional[Dict[str, Any]]) -> Optional[Tuple[List[str], List[str], Dict[str, Any]]]:
        if len(bot.hand) < 2:
            return None
        # Choose 1 real card as face up, and bluff the rest
        if current_claim:
            hand_type = current_claim.get('type', 'pair')
            req_count = HAND_TYPE_CARD_COUNT.get(hand_type, 2)
            if len(bot.hand) < req_count:
                return None
            chosen = bot.hand[:req_count]
            # Must declare a claim higher than current
            if hand_type in ['pair', 'three', 'four', 'five']:
                target_rank = min(14, current_claim.get('rank', 2) + random.randint(1, 3))
                if target_rank <= current_claim.get('rank', 2):
                    return None
                claim = {'type': hand_type, 'rank': target_rank}
                return [c.id for c in chosen], [chosen[0].id], claim
        else:
            # Lead bluff
            chosen = bot.hand[:2]
            target_rank = chosen[0].rank
            return [c.id for c in chosen], [chosen[0].id], {'type': 'pair', 'rank': target_rank}
        return None

    def to_client_state(self, viewer_id: str) -> Dict[str, Any]:
        viewer = self.get_player(viewer_id)
        active_list = self.active_players()
        curr = self.current_player()

        return {
            'room_id': self.id,
            'room_name': self.name,
            'state': self.state,
            'players': [p.to_summary() for p in self.players],
            'your_id': viewer_id,
            'your_name': viewer.name if viewer else '',
            'is_host': viewer.is_host if viewer else False,
            'your_hand': [c.to_dict(face_up=True) for c in (viewer.hand if viewer else [])],
            'your_tool_used': viewer.tool_used if viewer else False,
            'your_tools_disabled': viewer.disabled_tools if viewer else False,
            'your_assigned_tool': viewer.assigned_tool if viewer else None,
            'assigned_tool_info': TOOL_DEFINITIONS.get(viewer.assigned_tool) if (viewer and viewer.assigned_tool) else None,
            'current_turn_id': curr.id if curr else None,
            'current_turn_name': curr.name if curr else None,
            'is_your_turn': (curr.id == viewer_id) if curr else False,
            'table_cards': [tc.to_dict(reveal_all=(self.state == 'CALL_RESOLVING' or self.state == 'GAME_OVER')) for tc in self.table_cards],
            'table_claim': self.table_claim,
            'table_claim_desc': self.table_claim_desc,
            'last_player_id': self.last_player_id,
            'deck_count': len(self.deck),
            'discard_count': len(self.discard_pile),
            'pending_penalty': self.pending_penalty,
            'call_history': self.call_history,
            'logs': self.logs[-25:],
            'peek_card': viewer.peek_cache if viewer else None,
            'finish_order': self.finish_order,
            'your_finished_rank': viewer.finished_rank if viewer else None,
            'game_over_countdown': self.game_over_countdown,
            'rankings': [
                {
                    'id': p.id,
                    'name': p.name,
                    'is_bot': p.is_bot,
                    'rank': p.finished_rank,
                    'card_count': len(p.hand)
                }
                for p in sorted(self.players, key=lambda x: (x.finished_rank or 99, len(x.hand)))
            ]
        }


class ServerManager:
    def __init__(self):
        self.rooms: Dict[str, GameRoom] = {}
        self.connections: Dict[ServerConnection, Tuple[str, str]] = {} # ws -> (room_id, player_id)

    def get_or_create_room(self, room_id: str, room_name: str = "") -> GameRoom:
        if room_id not in self.rooms:
            self.rooms[room_id] = GameRoom(room_id, room_name or f"Phòng {room_id}")
        return self.rooms[room_id]

    def get_public_rooms_summary(self) -> List[Dict[str, Any]]:
        # Always maintain DEFAULT room
        if 'DEFAULT' not in self.rooms:
            self.rooms['DEFAULT'] = GameRoom('DEFAULT', 'Phòng Chung')
        
        res = []
        for r_id, r in list(self.rooms.items()):
            active_humans = [p for p in r.players if not p.is_bot and p.is_connected()]
            res.append({
                'id': r.id,
                'name': r.name,
                'player_count': len(r.players),
                'human_count': len(active_humans),
                'max_players': 6,
                'state': r.state,
                'is_default': (r.id == 'DEFAULT')
            })
        return res

    async def broadcast_room(self, room: GameRoom):
        for p in room.players:
            if p.ws and not p.is_bot:
                try:
                    state = room.to_client_state(p.id)
                    await p.ws.send(json.dumps({'type': 'STATE_UPDATE', 'data': state}))
                except Exception as e:
                    pass

    async def run_bot_ticks(self):
        """Periodic background ticker for bot actions and room state auto-progression"""
        while True:
            await asyncio.sleep(1.2)
            for room in list(self.rooms.values()):
                # Auto-restart countdown ticker when GAME_OVER
                if room.state == 'GAME_OVER':
                    if room.game_over_countdown is not None:
                        async with room.lock:
                            room.game_over_countdown -= 1
                            if room.game_over_countdown <= 0:
                                room.game_over_countdown = None
                                room.players = [pl for pl in room.players if pl.is_connected()]
                                if len(room.players) >= 2:
                                    room.start_game()
                                    room.add_log("🚀 VÁN ĐẤU MỚI TỰ ĐỘNG BẮT ĐẦU!")
                                else:
                                    room.state = 'LOBBY'
                                    room.add_log("⚠️ Không đủ người chơi để tự động bắt đầu ván mới, chuyển về Phòng Chờ.")
                        await self.broadcast_room(room)
                    continue

                if room.state in ['PLAYING', 'CALL_RESOLVING']:
                    curr = room.current_player()
                    is_bot_turn = (curr and curr.is_bot)
                    is_bot_penalty = (room.state == 'CALL_RESOLVING' and room.pending_penalty and room.get_player(room.pending_penalty['winner_id']).is_bot)
                    if is_bot_turn or is_bot_penalty:
                        async with room.lock:
                            room.bot_action_tick()
                        await self.broadcast_room(room)

manager = ServerManager()

async def ws_handler(websocket: ServerConnection):
    current_room_id: Optional[str] = None
    current_player_id: Optional[str] = None

    try:
        async for message in websocket:
            data = json.loads(message)
            action = data.get('action')
            payload = data.get('payload', {})

            if action == 'GET_ROOMS':
                rooms_summary = manager.get_public_rooms_summary()
                await websocket.send(json.dumps({'type': 'ROOM_LIST', 'rooms': rooms_summary}))
                continue

            elif action == 'CREATE_ROOM':
                custom_code = payload.get('room_id', '').strip().upper()
                player_name = payload.get('player_name', 'Người chơi').strip()
                if not player_name:
                    player_name = 'Người chơi'

                # Auto-generate room code if empty or whitespace
                if not custom_code:
                    for _ in range(50):
                        cand = f"SOL-{random.randint(1000, 9999)}"
                        if cand not in manager.rooms:
                            custom_code = cand
                            break
                    if not custom_code:
                        custom_code = f"SOL-{random.randint(1000, 9999)}"

                # Check if custom code already taken by active game
                if custom_code in manager.rooms and custom_code != 'DEFAULT':
                    ex = manager.rooms[custom_code]
                    active_h = [p for p in ex.players if not p.is_bot and p.is_connected()]
                    if len(active_h) > 0 and ex.state != 'LOBBY':
                        await websocket.send(json.dumps({'type': 'ERROR', 'message': f'Phòng "{custom_code}" đang trong trận đấu! Vui lòng chọn mã khác.'}))
                        continue

                room = manager.get_or_create_room(custom_code, f"Phòng {custom_code}")
                async with room.lock:
                    room.players = [pl for pl in room.players if pl.is_connected()]
                    player_id = f"P_{random.randint(1000, 9999)}"
                    player = Player(player_id, player_name, is_bot=False, ws=websocket)
                    player.is_host = True
                    room.players.append(player)
                    current_room_id = room.id
                    current_player_id = player.id
                    manager.connections[websocket] = (room.id, player.id)
                    room.add_log(f"👑 {player.name} đã tạo phòng {room.id} và làm Chủ phòng.")

                await manager.broadcast_room(room)

            elif action == 'JOIN_ROOM':
                room_id = payload.get('room_id', 'DEFAULT').strip().upper()
                player_name = payload.get('player_name', 'Người chơi').strip()
                if not room_id:
                    room_id = 'DEFAULT'
                if not player_name:
                    player_name = 'Người chơi'

                if room_id not in manager.rooms and room_id != 'DEFAULT':
                    await websocket.send(json.dumps({'type': 'ERROR', 'message': f'Không tìm thấy phòng "{room_id}"! Vui lòng kiểm tra lại mã hoặc bấm Tạo Phòng mới.'}))
                    continue

                room = manager.get_or_create_room(room_id)
                async with room.lock:
                    if room.state == 'LOBBY':
                        room.players = [pl for pl in room.players if pl.is_connected()]

                    if len(room.players) >= 6:
                        await websocket.send(json.dumps({'type': 'ERROR', 'message': f'Phòng {room_id} đã đủ 6 người tối đa!'}))
                        continue

                    player_id = f"P_{random.randint(1000, 9999)}"
                    player = Player(player_id, player_name, is_bot=False, ws=websocket)
                    
                    active_humans = [pl for pl in room.players if not pl.is_bot and pl.ws is not None]
                    if len(active_humans) == 0 or not any(pl.is_host for pl in active_humans):
                        player.is_host = True
                    
                    room.players.append(player)
                    current_room_id = room.id
                    current_player_id = player.id
                    manager.connections[websocket] = (room.id, player.id)
                    room.add_log(f"👋 {player.name} đã tham gia phòng.")

                await manager.broadcast_room(room)

            elif action == 'LEAVE_ROOM':
                if current_room_id:
                    room = manager.rooms.get(current_room_id)
                    if room:
                        async with room.lock:
                            p = room.get_player(current_player_id)
                            if p:
                                if room.state == 'LOBBY':
                                    room.players = [pl for pl in room.players if pl.id != p.id]
                                    room.add_log(f"👋 {p.name} đã rời phòng.")
                                else:
                                    p.ws = None
                                    room.add_log(f"👋 {p.name} đã ngắt kết nối.")
                                
                                # Assign next host if current host left
                                active_hosts = [pl for pl in room.players if pl.is_host and not pl.is_bot and pl.ws is not None]
                                if not active_hosts:
                                    for pl in room.players:
                                        if not pl.is_bot and pl.ws is not None:
                                            pl.is_host = True
                                            room.add_log(f"👑 Quyền Chủ phòng chuyển sang {pl.name}.")
                                            break
                        await manager.broadcast_room(room)

                    if websocket in manager.connections:
                        del manager.connections[websocket]
                    current_room_id = None
                    current_player_id = None
                    await websocket.send(json.dumps({'type': 'ROOM_LEFT'}))
                continue

            elif action == 'ADD_BOT':
                if not current_room_id:
                    continue
                room = manager.rooms.get(current_room_id)
                if not room or room.state != 'LOBBY':
                    continue
                async with room.lock:
                    if len(room.players) >= 6:
                        await websocket.send(json.dumps({'type': 'ERROR', 'message': 'Phòng đã đủ 6 người tối đa!'}))
                        continue
                    bot_name = random.choice(BOT_NAMES)
                    existing = [p.name for p in room.players]
                    if bot_name in existing:
                        bot_name = f"{bot_name.split()[0]} Bot #{random.randint(2, 9)} 🤖"
                    bot_id = f"BOT_{random.randint(1000, 9999)}"
                    bot_player = Player(bot_id, bot_name, is_bot=True)
                    room.players.append(bot_player)
                    room.add_log(f"🤖 Đã thêm {bot_player.name} vào phòng.")
                await manager.broadcast_room(room)

            elif action == 'REMOVE_BOT':
                if not current_room_id:
                    continue
                room = manager.rooms.get(current_room_id)
                if not room or room.state != 'LOBBY':
                    continue
                async with room.lock:
                    target_id = payload.get('bot_id')
                    if target_id:
                        b = next((pl for pl in room.players if pl.id == target_id and pl.is_bot), None)
                    else:
                        b = next((pl for pl in reversed(room.players) if pl.is_bot), None)
                    if b:
                        room.players.remove(b)
                        room.add_log(f"🗑️ Đã xóa {b.name} khỏi phòng.")
                await manager.broadcast_room(room)

            elif action == 'CLAIM_HOST':
                if not current_room_id:
                    continue
                room = manager.rooms.get(current_room_id)
                if not room or room.state != 'LOBBY':
                    continue
                async with room.lock:
                    for pl in room.players:
                        pl.is_host = (pl.id == current_player_id)
                    p = room.get_player(current_player_id)
                    room.add_log(f"👑 {p.name if p else 'Người chơi'} đã nhận quyền Chủ phòng.")
                await manager.broadcast_room(room)

            elif action == 'START_GAME':
                if not current_room_id:
                    continue
                room = manager.rooms.get(current_room_id)
                if not room:
                    continue
                async with room.lock:
                    # Clean out disconnected humans before starting
                    room.players = [pl for pl in room.players if pl.is_connected()]
                    p = room.get_player(current_player_id)
                    active_humans = [pl for pl in room.players if not pl.is_bot and pl.ws is not None]
                    can_start = p and (p.is_host or len(active_humans) <= 1 or room.state == 'GAME_OVER')
                    if can_start:
                        room.game_over_countdown = None
                        ok, msg = room.start_game()
                        if not ok:
                            await websocket.send(json.dumps({'type': 'ERROR', 'message': msg}))
                    else:
                        await websocket.send(json.dumps({'type': 'ERROR', 'message': 'Chỉ có Chủ phòng mới được quyền Bắt đầu game!'}))
                await manager.broadcast_room(room)

            elif action == 'PLAY_HAND':
                if not current_room_id:
                    continue
                room = manager.rooms.get(current_room_id)
                if not room:
                    continue
                card_ids = payload.get('card_ids', [])
                face_up_ids = payload.get('face_up_ids', [])
                claim = payload.get('claim', {})
                async with room.lock:
                    p = room.get_player(current_player_id)
                    if p:
                        ok, msg = room.handle_play_hand(p, card_ids, face_up_ids, claim)
                        if not ok:
                            await websocket.send(json.dumps({'type': 'ERROR', 'message': msg}))
                await manager.broadcast_room(room)

            elif action == 'PLAY_SPECIAL_CARD':
                if not current_room_id:
                    continue
                room = manager.rooms.get(current_room_id)
                if not room:
                    continue
                card_id = payload.get('card_id')
                async with room.lock:
                    p = room.get_player(current_player_id)
                    if p:
                        ok, msg = room.handle_play_special_card(p, card_id)
                        if not ok:
                            await websocket.send(json.dumps({'type': 'ERROR', 'message': msg}))
                await manager.broadcast_room(room)

            elif action == 'CALL_BLUFF':
                if not current_room_id:
                    continue
                room = manager.rooms.get(current_room_id)
                if not room:
                    continue
                async with room.lock:
                    p = room.get_player(current_player_id)
                    if p:
                        ok, msg = room.handle_call_bluff(p)
                        if not ok:
                            await websocket.send(json.dumps({'type': 'ERROR', 'message': msg}))
                await manager.broadcast_room(room)

            elif action == 'PASS_TURN':
                if not current_room_id:
                    continue
                room = manager.rooms.get(current_room_id)
                if not room:
                    continue
                async with room.lock:
                    p = room.get_player(current_player_id)
                    if p:
                        ok, msg = room.handle_pass(p)
                        if not ok:
                            await websocket.send(json.dumps({'type': 'ERROR', 'message': msg}))
                await manager.broadcast_room(room)

            elif action == 'SELECT_PENALTY_CARD':
                if not current_room_id:
                    continue
                room = manager.rooms.get(current_room_id)
                if not room or room.state != 'CALL_RESOLVING' or not room.pending_penalty:
                    continue
                card_id = payload.get('card_id')
                async with room.lock:
                    winner_id = room.pending_penalty['winner_id']
                    loser_id = room.pending_penalty['loser_id']
                    if current_player_id == winner_id:
                        winner = room.get_player(winner_id)
                        loser = room.get_player(loser_id)
                        if winner and loser:
                            room.finalize_call_resolution(winner, loser, card_id)
                await manager.broadcast_room(room)

            elif action == 'USE_TOOL':
                if not current_room_id:
                    continue
                room = manager.rooms.get(current_room_id)
                if not room:
                    continue
                tool_id = payload.get('tool_id')
                async with room.lock:
                    p = room.get_player(current_player_id)
                    if p:
                        ok, msg = room.handle_use_tool(p, tool_id, payload)
                        if not ok:
                            await websocket.send(json.dumps({'type': 'ERROR', 'message': msg}))
                await manager.broadcast_room(room)

            elif action == 'RESTART_GAME':
                if not current_room_id:
                    continue
                room = manager.rooms.get(current_room_id)
                if not room:
                    continue
                async with room.lock:
                    p = room.get_player(current_player_id)
                    human_count = len([x for x in room.players if not x.is_bot])
                    if p and (p.is_host or human_count <= 1 or room.state == 'GAME_OVER'):
                        room.state = 'LOBBY'
                        room.finish_order = []
                        room.table_cards = []
                        room.table_claim = None
                        room.table_claim_desc = None
                        room.last_player_id = None
                        room.pass_count = 0
                        for pl in room.players:
                            pl.hand = []
                            pl.finished_rank = None
                        room.logs = []
                        room.add_log("🔄 Đã đưa trò chơi về Phòng chờ để chuẩn bị ván mới.")
                await manager.broadcast_room(room)

    except websockets.exceptions.ConnectionClosed:
        pass
    except Exception as e:
        traceback.print_exc()
    finally:
        if current_room_id and current_player_id:
            room = manager.rooms.get(current_room_id)
            if room:
                async with room.lock:
                    p = room.get_player(current_player_id)
                    if p:
                        if room.state == 'LOBBY':
                            # Remove player entirely when disconnecting in lobby!
                            if p in room.players:
                                room.players.remove(p)
                            room.add_log(f"🔌 {p.name} đã rời phòng.")
                        else:
                            p.ws = None
                            room.add_log(f"🔌 {p.name} đã ngắt kết nối.")

                        # If no active host left, assign host to first active human
                        active_hosts = [pl for pl in room.players if pl.is_host and not pl.is_bot and pl.ws is not None]
                        if not active_hosts:
                            first_human = next((pl for pl in room.players if not pl.is_bot and pl.ws is not None), None)
                            if first_human:
                                first_human.is_host = True
                                room.add_log(f"👑 {first_human.name} trở thành Chủ phòng mới.")
                await manager.broadcast_room(room)


import webbrowser

def free_ports():
    if sys.platform != 'win32':
        return
    import subprocess
    my_pid = str(os.getpid())
    for port in [HTTP_PORT, WS_PORT]:
        try:
            res = subprocess.run(f'netstat -ano | findstr :{port}', shell=True, capture_output=True, text=True)
            for line in res.stdout.strip().splitlines():
                if 'LISTENING' in line:
                    parts = line.split()
                    if len(parts) >= 5:
                        pid = parts[-1]
                        if pid != my_pid and pid != '0':
                            subprocess.run(f'taskkill /F /PID {pid}', shell=True, capture_output=True)
        except Exception:
            pass

class ReusableHTTPServer(HTTPServer):
    allow_reuse_address = True

def run_http_server():
    os.chdir(STATIC_DIR)
    try:
        server_address = ('0.0.0.0', HTTP_PORT)
        httpd = ReusableHTTPServer(server_address, SimpleHTTPRequestHandler)
        print(f"[*] HTTP Server is running at http://localhost:{HTTP_PORT}")
        httpd.serve_forever()
    except OSError as e:
        if getattr(e, 'winerror', None) == 10048 or getattr(e, 'errno', None) == 98 or '10048' in str(e):
            print(f"\n[!] CẢNH BÁO: Cổng HTTP {HTTP_PORT} đang được sử dụng bởi một tiến trình khác.")
        else:
            print(f"\n[!] Lỗi HTTP Server: {e}")

async def main():
    if not IS_CLOUD:
        # Automatically free lingering ports if any when running locally
        free_ports()

        # Start HTTP static server in daemon thread
        http_thread = threading.Thread(target=run_http_server, daemon=True)
        http_thread.start()

    # Start bot runner
    asyncio.create_task(manager.run_bot_ticks())

    print(f"[*] WebSocket Server is running on port {WS_PORT}")
    print(f"============================================================")
    print(f" 🎴 SOILATE MULTIPLAYER GAME SERVER ONLINE")
    if not IS_CLOUD:
        print(f" 👉 Đang tự động mở trình duyệt: http://localhost:{HTTP_PORT}")
    else:
        print(f" 🌐 Đang chạy ở chế độ Cloud (Port: {WS_PORT})")
    print(f" 👉 Nhấn Ctrl+C để dừng server khi muốn thoát")
    print(f"============================================================")

    if not IS_CLOUD:
        # Automatically open browser after 1 second locally
        def open_browser():
            import time
            time.sleep(1)
            webbrowser.open(f"http://localhost:{HTTP_PORT}")

        threading.Thread(target=open_browser, daemon=True).start()

    try:
        async with websockets.asyncio.server.serve(ws_handler, '0.0.0.0', WS_PORT):
            await asyncio.Future() # keep running
    except OSError as e:
        if getattr(e, 'winerror', None) == 10048 or '10048' in str(e):
            print(f"\n[!] LỖI: Cổng {WS_PORT} đang bị chiếm dụng bởi một tiến trình server cũ đang chạy ngầm!")
            print(f"👉 Hãy đóng cửa sổ server cũ hoặc mở Task Manager để đóng python.exe.")
        else:
            raise

if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nĐã dừng server Soilate an toàn.")
    except Exception as e:
        print(f"\n[!] LỖI KHỞI CHẠY SERVER: {e}")
        traceback.print_exc()
        input("\nNhấn Enter để đóng cửa sổ...")
