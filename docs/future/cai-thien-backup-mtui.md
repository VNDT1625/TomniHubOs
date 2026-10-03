# Thiết kế cải tiến toàn diện MTUI (Memory Terminal UI)

## Phân hệ Backup, Context & Compass Slicing

- **Trạng thái:** TARGET / Đề xuất nâng cấp kiến trúc chuẩn mực
- **Mục tiêu:** Giải quyết triệt để 3 điểm nghẽn lớn nhất trong hệ thống MTUI hiện tại:
  1. Phình to dung lượng đĩa cứng và phân mảnh I/O do cơ chế Auto-Backup thô sơ.
  2. Hiện tượng đội thêm token (overhead) khi xử lý các file log nhỏ trong phân hệ Context.
  3. Hiện tượng mất dấu từ khóa ở cuối file lớn (Anchor Loss) trong phân hệ cắt lát code Compass.

---

## 1. Tổng quan hiện trạng & Bằng chứng thực tế (Evidence Baseline)

MTUI đóng vai trò là tầng gác cổng an toàn (Safe File Operations Gateway) và bộ định hướng tri thức mã nguồn cho AI Agent. Tuy nhiên, qua kiểm tra mã nguồn Rust và benchmark thực tế, hệ thống đang tồn tại 3 điểm nghẽn:

### 1.1. Thực trạng phân hệ Backup ([`packages/mtui/src/backup/mod.rs`](file:///c:/NDT/PJ/TomniHubOS/packages/mtui/src/backup/mod.rs))

- **Dữ liệu thực tế đo được:** Thư mục `.mtui/backups` tích tụ **17.477 files**, chiếm gần **900 MB (~885 MB)** trên ổ đĩa.
- **Nguyên nhân:**
  - Cơ chế `Full-file Snapshot`: Mỗi lần sửa 1 dòng code, MTUI copy toàn bộ file 100% (`std::fs::write(&backup_path, content)`).
  - Hoàn toàn không có cơ chế dọn dẹp (No Retention Policy / No Garbage Collection). Các bản backup từ tháng 07/2026 vẫn tồn tại vĩnh viễn đến nay.
  - Không có Deduplication (khử trùng lặp nội dung) hay dung lượng trần (Storage Quota).

### 1.2. Thực trạng phân hệ Context & Log Compactor ([`packages/mtui/src/compact/mod.rs`](file:///c:/NDT/PJ/TomniHubOS/packages/mtui/src/compact/mod.rs))

- Theo tài liệu benchmark tại [`token-efficiency/results/latest.md`](file:///c:/NDT/PJ/TomniHubOS/packages/mtui/benchmarks/token-efficiency/results/latest.md):
  - Với log lớn (> 1.000 tokens): Nén cực tốt, giảm **76.8% tokens** với **100% recall** tín hiệu lỗi quan trọng.
  - Với log nhỏ (< 200 tokens): Việc đóng gói vào JSON envelope tốn cố định ~100 tokens, khiến tổng lượng token trả về bị âm **-46% đến -50%** (càng nén càng tốn token hơn xuất thô).

### 1.3. Thực trạng phân hệ Compass Slicing ([`packages/mtui/src/ops/mod.rs`](file:///c:/NDT/PJ/TomniHubOS/packages/mtui/src/ops/mod.rs))

- Theo benchmark: **9/10 trường hợp** Compass bị hụt từ khóa (Anchor Loss) trong các file lớn.
- **Nguyên nhân trong code:** Hàm `compass_read_file` duyệt tuần tự từ dòng 1 đến dòng cuối. Khi tổng ký tự chạm trần `max_chars`, code lập tức `break;`. Các dòng `import`, `type` ở đầu file ngốn hết ngân sách, khiến các từ khóa tìm kiếm nằm ở nửa sau file (ví dụ dòng 1.500 / 3.000) bị vứt bỏ hoàn toàn.

---

## 2. Phân hệ 1: Cải tiến Backup — Nhẹ, Tự động & Không mất mát

### 2.1. Lưu trữ chênh lệch (Delta Reverse Patch)

Tận dụng thư viện `similar = "2"` có sẵn trong `Cargo.toml`:

- **File văn bản / mã nguồn:**
  - Thay vì lưu toàn bộ file, MTUI tính toán **Reverse Unified Diff** giữa phiên bản mới và cũ.
  - Lưu vào tệp `.patch`. Một file 2 MB khi sửa 3 dòng chỉ tốn khoảng **300 bytes** lưu trữ thay vì 2 MB.
  - Khi gọi `mtui undo <operation_id>`, hệ thống chỉ việc áp ngược patch lại (reverse apply) để khôi phục chính xác từng byte ban đầu.
- **File nhị phân (Binary):**
  - Sử dụng cơ chế Content-Addressed Blob (băm `blake3`). Các file nhị phân giống nhau chỉ lưu 1 bản duy nhất.

### 2.2. Hạn mức trần & Tự động dọn dẹp (Storage Quota & Retention Policy)

Bổ sung cấu hình vào file cấu hình MTUI (`MtuiConfig`):

```toml
[backup]
enabled = true
storage_mode = "delta"     # "delta" (mặc định) hoặc "full"
max_storage_mb = 100       # Trần dung lượng tối đa cho .mtui/backups
retention_days = 7         # Tự động xóa backup cũ hơn 7 ngày
max_operations = 200       # Giữ tối đa 200 operations gần nhất
auto_gc_on_run = true      # Chạy kiểm tra dọn dẹp nhẹ khi khởi động MTUI
```

- **Thuật toán xoay vòng (FIFO Eviction):**
  - Khi tổng dung lượng `.mtui/backups` vượt quá 100 MB hoặc có thư mục ngày cũ hơn 7 ngày:
  - Tự động xóa các thư mục ngày cũ nhất trước, đồng thời cập nhật lại bảng lịch sử SQLite để giữ dữ liệu toàn vẹn.

### 2.3. Lệnh bảo trì thủ công (`mtui gc`)

Cung cấp công cụ cho người dùng và CI dọn dẹp chủ động:

```bash
# Xem trước dung lượng có thể giải phóng
mtui gc --dry-run

# Dọn dẹp các backup cũ hơn N ngày
mtui gc --days 3

# Dọn sạch toàn bộ rác backup lịch sử (> 800 MB hiện tại)
mtui gc --force
```

---

## 3. Phân hệ 2: Cải tiến Context & Log Compaction — Fast-path Threshold

### 3.1. Cơ chế Ngưỡng bypass nhanh (Bypass Threshold)

Khắc phục triệt để hiện tượng file nhỏ bị tăng dung lượng do vỏ bọc JSON:

- **Ngưỡng kiểm tra:** `< 500 ký tự` hoặc ước tính `< 150 tokens`.
- **Quy tắc xử lý:**
  - Nếu input `< 150 tokens`: Xuất thẳng nội dung nguyên bản (raw/plain text), bỏ qua toàn bộ việc bọc JSON metadata phức tạp.
  - Nếu input `>= 150 tokens`: Kích hoạt bộ nén thông minh `compact` để giảm 76.8% token như thiết kế chuẩn.

---

## 4. Phân hệ 3: Cơ chế Knowledge Cache & Graceful Fallback

- Khi có cache tri thức từ IDE Understanding (`SummaryCache`): MTUI sử dụng bản đồ đồ thị kiến trúc và thuật toán xếp hạng `ranking.rs` để định vị file và module liên quan nhất.
- Khi chưa có cache: Hệ thống thực hiện **Graceful Degradation** — tự động giáng cấp xuống tìm kiếm văn bản thô (Ripgrep/Text scan) mà không gây gián đoạn công việc của Agent.

---

## 5. Phân hệ 4: Cải tiến Compass Slicing — Ranking & Stateless Pagination

### 5.1. Thuật toán xếp hạng từ khóa theo cú pháp (Relevance Ranking)

Thay vì gom dòng tuyến tính từ đầu file đến cuối file, phân loại và gán điểm trọng số (Relevance Score) cho từng dòng khớp từ khóa:

|           Trọng số           | Loại dòng code match từ khóa                    | Mô tả & Ví dụ                                          |
| :--------------------------: | :---------------------------------------------- | :----------------------------------------------------- |
| **Điểm 10 (Định nghĩa gốc)** | Khai báo hàm, class, type, interface, component | `pub fn compass_read_file(...)`, `export class Store`  |
| **Điểm 7 (Thực thi logic)**  | Gán biến, gọi hàm, xử lý kết quả                | `let result = compass_read_file(...)`, `apply_patch()` |
| **Điểm 3 (Import / Export)** | Câu lệnh import hoặc export re-export           | `import { compass_read_file } from ...`                |
| **Điểm 1 (Chú thích / Log)** | Comment ghi chú, console log                    | `// TODO: fix compass`, `println!(...)`                |

### 5.2. Cơ chế nạp ngân sách ưu tiên (Priority Budget Filling)

1. Dành ngân sách ký tự đầu tiên để nạp **100% các dòng Điểm 10 (kèm 2 dòng context)**. Đảm bảo dù định nghĩa hàm nằm ở dòng 1 hay dòng 3.000, nó luôn được chọn.
2. Ngân sách còn lại mới dành cho Điểm 7, Điểm 3 và Điểm 1.
3. Khi in kết quả, các dòng được sắp xếp lại theo đúng thứ tự dòng tự nhiên trong file kèm dấu lược dòng: `... lines 120-1450 omitted ...`.

### 5.3. Phân trang phi trạng thái (Stateless Page-based Pagination)

Thay vì dùng con trỏ cursor phức tạp, hỗ trợ trực tiếp tham số `--page`:

- **Mặc định:** `page = 1` gom toàn bộ các kết quả có Rank cao nhất vào trong ngân sách token an toàn (~1.000 tokens/page).
- **Khi Agent cần xem tiếp:** Chỉ cần truyền thêm `page: 2` trong tool call tiếp theo. Không cần lưu state trên đĩa, lệnh hoàn toàn bất biến (idempotent).

#### Giao thức phản hồi JSON cho AI Agent:

```json
{
  "file": "src/ops/mod.rs",
  "query": "compass_read",
  "page": 1,
  "total_pages": 3,
  "has_more": true,
  "matched_anchors_in_this_page": 3,
  "remaining_anchors": 5,
  "text": "1: // Cấu trúc chính\n2598: pub fn compass_read_file(...) {\n..."
}
```

Khi Agent đọc xong Page 1 mà vẫn muốn tìm kiếm thêm, nó chỉ việc gọi:

```bash
mtui --json compass read src/ops/mod.rs --query "compass_read" --page 2
```

---

## 6. Lộ trình triển khai kỹ thuật (Implementation Roadmap)

1. **Giai đoạn 1 (Khẩn cấp — Dọn dẹp & Giải phóng đĩa):**
   - Viết module `packages/mtui/src/backup/gc.rs`.
   - Bổ sung lệnh `mtui gc` vào `src/cli/mod.rs` để dọn sạch ngay gần 900 MB rác lịch sử trong `.mtui/backups`.
2. **Giai đoạn 2 (Tối ưu hóa dung lượng & Fast-path):**
   - Chuyển `create_backup` và `undo_operation` sang dùng Delta Reverse Patch (`similar`).
   - Thêm kiểm tra Fast-path Threshold (< 150 tokens) trong `src/compact/mod.rs`.
3. **Giai đoạn 3 (Nâng cấp thuật toán Compass Slicing):**
   - Triển khai hàm tính điểm `rank_code_line` trong `src/ops/mod.rs`.
   - Hỗ trợ tham số `--page` trong `CompassReadArgs` và phân bổ ngân sách theo rank.
4. **Giai đoạn 4 (Đo kiểm & Xác nhận):**
   - Cập nhật và chạy lại bộ test `benchmarks/token-efficiency` để xác nhận:
     - Tỷ lệ Anchor Recall tăng từ 13.8% lên **100%**.
     - Tỷ lệ Wire Token Reduction cho file nhỏ chuyển từ số âm sang **dương tối ưu**.
     - Dung lượng thư mục `.mtui/backups` duy trì ổn định dưới **100 MB**.
