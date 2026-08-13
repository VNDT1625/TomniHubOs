# Fix-bug benchmark v2: endpoint-specific ContextPack ranking

Repository để chạy agent:

```text
C:\Bench\TomniHubOS-route-ranking-v2\TomniHubOS-Buggy
```

Đây là một lỗi khác case `status >= 400`: Quick Test đã nhận đúng HTTP 404, nhưng
ContextPack có thể chứa nhiều file API không liên quan và bỏ sót file billing đúng
khi graph có nhiều module `*Api.ts`.

## Prompt 1 — chỉ điều tra

```text
Hãy điều tra chỉ-đọc hai hướng độc lập trong cùng phiên:

A. Quick Test ghi nhận request GET /api/v1/billing/invoices/42 trả 404, nhưng ContextPack đôi khi chứa nhiều file API không liên quan như account/admin/catalog và lại bỏ sót billing API/service. Hãy truy vết từ RuntimeTrace qua logic chọn/rank graph node đến ContextPack, xác định nguyên nhân chính xác bằng file, symbol, condition và expected/actual. Không sửa file.

B. Độc lập với lỗi ranking trên, hãy truy vết ảnh chụp bằng chứng của agent-facing Quick Test: nó được capture ở đâu, lưu ở đâu, giới hạn retention thế nào và đường dẫn được đưa vào kết quả tool cho agent ra sao. Nêu file/symbol/evidence, không đọc tuần tự toàn repo.

Không sửa file và không chạy build. Báo cáo A/B riêng, ghi rõ phần nào đã xác minh và phần nào còn là giả thuyết.
```

## Prompt 2 — sửa và kiểm chứng

```text
Hãy sửa lỗi khoanh vùng endpoint vừa điều tra sao cho request billing 404 ưu tiên đúng billing API/service và không đưa các module API không liên quan vào ContextPack chỉ vì token đường dẫn quá chung. Giữ nguyên API công khai và các mapping stack/coverage/UI hiện tại.

Trước khi sửa, tạo một phép tái hiện nhỏ, deterministic và chạy bằng lớp test script nhanh. Sau sửa phải chạy lại chính phép thử đó, thêm regression test cho nhiều API node gây nhiễu, rồi chạy test framework liên quan. Chỉ dùng Quick Test Tracker sâu nếu cần xác nhận network/console/screenshot runtime. Báo rõ nguyên nhân gốc, diff, test trước/sau, thời gian và giới hạn môi trường.
```

Không nói cho agent biết evaluator hoặc đáp án. Chạy evaluator từ repository gốc:

```powershell
C:\NDT\PJ\TomniHubOS\benchmarks\fix-bug-v2\evaluate-run.ps1 -TargetRoot C:\Bench\TomniHubOS-route-ranking-v2\TomniHubOS-Buggy
```

Trạng thái ban đầu hợp lệ phải có:

```text
correctBillingMapped: false
unrelatedApiCount: 8
```

Sau sửa đạt yêu cầu:

```text
correctBillingMapped: true
unrelatedApiCount: 0
focusedTestsPass: true
typecheckPass: true
```

## Chấm điểm /10

| Tiêu chí                                                      | Điểm |
| ------------------------------------------------------------- | ---: |
| Xác định đúng nguyên nhân false-positive và giới hạn 8 slices |  2.0 |
| Truy vết đúng RuntimeTrace → graph matching → ContextPack     |  1.5 |
| Hiểu đúng nhánh screenshot độc lập                            |  1.0 |
| Có reproduction thất bại trước sửa                            |  1.0 |
| Fix đúng billing, loại API nhiễu, không phá mapping khác      |  2.5 |
| Regression test + focused test + typecheck                    |  1.5 |
| Diff nhỏ, báo cáo có bằng chứng                               |  0.5 |

Nếu `correctBillingMapped=false`, điểm Fix tối đa 0.5/2.5. Nếu không có phép tái hiện
trước sửa, tổng điểm tối đa 8.5.
