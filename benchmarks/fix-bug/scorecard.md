# Phiếu chấm điểm fix-bug benchmark

Tổng điểm: **10**. Chấm theo bằng chứng trong patch, log tool và kết quả test; không chấm theo câu trả lời nghe có vẻ hợp lý.

## 1. Hiểu codebase theo hai hướng — 3 điểm

Agent phải hiểu đồng thời hai nhánh, không chỉ bám một file:

| Tiêu chí                                                                   | Điểm |
| -------------------------------------------------------------------------- | ---: |
| Hướng A: truy vết Quick Test từ runtime event đến `ContextPack`            |  1.0 |
| Hướng B: xác định lớp API/service/file/symbol liên đới và phân biệt với UI |  1.0 |
| Tốc độ, bằng chứng và giữ đúng context giữa hai hướng                      |  1.0 |

Chấm 0 nếu agent chỉ đoán theo tên file; chấm đủ khi nêu được quan hệ gọi/import và evidence hiện tại.

## 2. Fix bug nhanh và tối ưu — 4 điểm

| Tiêu chí                                                                            | Điểm |
| ----------------------------------------------------------------------------------- | ---: |
| Chẩn đoán đúng nguyên nhân gốc                                                      |  1.0 |
| Sửa đúng 404/API-service nhưng không làm hỏng 5xx, transport failure hoặc exception |  1.5 |
| Thêm regression test có giá trị và test pass                                        | 0.75 |
| Diff tối thiểu, không sửa lan; token/thời gian/tool call hợp lý                     | 0.75 |

Nếu patch không chạy hoặc làm test cũ fail, mục 2 tối đa **1/4** dù giải thích đúng.

## 3. Dùng Quick Test Tracker để khoanh vùng và kiểm chứng — 3 điểm

| Tiêu chí                                                                       | Điểm |
| ------------------------------------------------------------------------------ | ---: |
| Chọn đúng Quick Test/Tracker thay vì đọc toàn bộ repository                    | 0.75 |
| Dùng event, network status, file/symbol và `ContextPack` để khoanh vùng        |  1.0 |
| Có run trước/sau hoặc kiểm chứng tương đương, chứng minh 404 đã map đúng       | 0.75 |
| Không lặp tool vô ích, không tạo false positive hoặc báo cáo vượt quá evidence |  0.5 |

Nếu agent không thể chạy Quick Test do môi trường, vẫn có thể đạt tối đa **2/3** khi dùng test/trace fixture đúng và ghi rõ giới hạn.

## Cổng đạt/fail

- **Pass kỹ thuật:** regression test pass, không có lỗi typecheck mới, quality score tối thiểu 8/10.
- **Vượt trội:** quality score tối thiểu 9/10, patch đúng, và median input token thấp hơn baseline ít nhất 30% mà thời gian không tăng quá 10%.
- **Fail:** sửa sai lớp, bỏ qua 404, test không pass, hoặc thay đổi ngoài scope làm hỏng hành vi khác.

## Bảng ghi kết quả

| Agent   | Hiểu A/B /3 | Fix /4 | Quick Test /3 | Tổng /10 | Input token | Thời gian | Research trùng | Test pass | Kết luận |
| ------- | ----------: | -----: | ------------: | -------: | ----------: | --------: | -------------: | --------- | -------- |
| Tomny   |             |        |               |          |             |           |                |           |          |
| Claude  |             |        |               |          |             |           |                |           |          |
| ChatGPT |             |        |               |          |             |           |                |           |          |
| Kiro    |             |        |               |          |             |           |                |           |          |

Mỗi agent nên chạy ít nhất ba lần; dùng **median** cho token và thời gian, còn điểm chất lượng cần xem cả lần thấp nhất để phát hiện độ ổn định kém.
