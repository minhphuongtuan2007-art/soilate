# 🎴 SOILATE - Game Bài Tố & Soi Lật Multiplayer

> Game bài đối kháng chiến thuật kết hợp giữa **Bluffing (Nói dối / Bắt bài)**, **Shedding (Xả bài hết trước để thắng)** và **7 Công cụ Lật kèo tối thượng**.

---

## 🌟 ĐIỂM ĐẶC SẮC CỦA SOILATE

1. **Bộ bài 80 lá đột phá:**
   - **6 Chất bài:** 4 chất cổ điển (Bích ♠, Chuồn ♣, Rô ♦, Cơ ♥) + **2 chất mới** độc quyền: **Sao ⭐ (Vàng kim)** và **Trăng 🌙 (Tím huyền bí)**.
   - **2 lá Joker 🃏:** Đóng vai trò Wildcard vạn năng, có thể thay thế mọi chất và bậc bài!
2. **Cơ chế Úp / Ngửa:**
   - Khi ra bài, bạn được quyền úp các lá bài xuống để lừa đối thủ (Bluff), nhưng **bắt buộc phải có ít nhất 1 lá ngửa** làm manh mối.
3. **Cơ chế Thách Thức (CALL):**
   - Nghi ngờ người trước nói dối? Bấm **CALL!**
   - **Bắt bài ĐÚNG:** Kẻ gian lận bị phạt nhận thêm 1 lá bài từ bạn!
   - **Bắt bài SAI:** Người ta đánh thật, bạn bị phạt nhận thêm 1 lá bài từ họ!
   - Người thắng cuộc Call sẽ mở màn vòng mới với bất kỳ thế bài nào tùy thích.
4. **7 Công cụ Tối Thượng (Mỗi vòng dùng 1 lần):**
   - 📥 **Bốc 1 lá:** Rút thêm 1 lá từ nọc để ghép thế bài mạnh.
   - 🔄 **Đổi 1 lá:** Đổi 1 lá rác trên tay lấy 1 lá mới ngẫu nhiên.
   - 🔀 **Đổi Deck!:** Hoán đổi toàn bộ bài trên tay bạn với 1 người chơi khác (vũ khí lật kèo khi đối thủ sắp thắng!).
   - 🎨 **Đổi chất:** Biến đổi chất của 1 lá bài trên tay sang bất kỳ chất nào trong 6 chất.
   - 🚫 **Khóa đối thủ:** Vô hiệu hoá quyền dùng công cụ của 1 đối thủ trong vòng này.
   - 👁️ **Kính chiếu yêu (Soi bài úp):** Lén nhìn 1 lá úp của đối thủ trên bàn để chắc chắn trước khi Call.
   - 💥 **Bắt lật lá:** Ép đối thủ phải lật ngửa công khai 1 lá úp cho cả bàn cùng nhìn thấy!
5. **Hệ thống AI Bot tự động:**
   - Bạn có thể chơi 1 mình với các Bot thông minh (Alice, Bob, Luna...) hoặc chơi cùng bạn bè qua mạng LAN/Internet.

---

## 🚀 HƯỚNG DẪN KHỞI CHẠY & VÀO CHƠI

Server hiện **đang chạy sẵn** trong nền trên máy tính của bạn!

### 1. Cách truy cập vào game:
* **Chơi trên máy tính này:**
  Mở trình duyệt (Chrome, Edge, Firefox, Brave...) và truy cập:
  👉 **http://localhost:8000**
* **Chơi nhiều người cùng mạng Wi-Fi / LAN (Điện thoại, Laptop khác):**
  Truy cập địa chỉ:
  👉 **http://`<IP_MAY_TINH>`:8000** (Ví dụ: `http://192.168.1.15:8000`)

### 2. Cách khởi động lại server bất kỳ lúc nào:
Mở PowerShell tại thư mục `C:\Users\LOQ\.gemini\antigravity\scratch\soilate` và gõ:
```powershell
python server.py
```

---

## 🎮 CÁCH CHƠI NHANH (QUICK START)

1. Nhập biệt danh của bạn và nhấn **"Vào Bàn Chơi 🚀"**.
2. Tại **Phòng Chờ**, bấm nút **"🤖 + Thêm Bot"** để thêm 1, 2 hoặc 3 Bot vào chơi cùng ngay lập tức (hoặc bảo bạn bè mở trình duyệt vào chung mã phòng).
3. Bấm **"Bắt Đầu Trò Chơi 🎮"**.
4. **Khi đến lượt bạn:**
   - Click chọn các lá bài trên tay muốn đánh (ví dụ: Đôi, Ba lá, Cù lũ, Sảnh...).
   - Click vào lá bài đã chọn để đổi trạng thái **Úp (Đỏ)** hoặc **Ngửa (Xanh)**.
   - Chọn thế bài tuyên bố trên thanh điều khiển (hoặc nhấn nút *"⚡ Gợi ý thế"* để hệ thống tự điền).
   - Nhấn **"🎴 ĐÁNH BÀI"**.
5. **Khi đối thủ đánh ra:**
   - Nếu bạn thấy đối thủ úp nhiều lá và có biểu hiện nói dối, hãy nhấn **"⚡ CALL! (BẮT BÀI)"** hoặc dùng công cụ **"👁️ Soi bài úp"** / **"💥 Bắt lật lá"** trước khi quyết định!
   - Nếu không muốn Call, bạn có thể đánh đè một thế bài cao hơn hoặc chọn **"⏭️ BỎ LƯỢT"**.
6. **Mục tiêu:** Tống khứ hết tất cả các lá bài trên tay bạn để trở thành người **CHIẾN THẮNG**!
