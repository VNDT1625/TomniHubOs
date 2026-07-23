# Fix-bug benchmark: Quick Test 404 context routing

Mục tiêu của benchmark này là so sánh khả năng **hiểu context dài rồi sửa bug** của nhiều agent khi dùng cùng một model, cùng repository và cùng lỗi.

Case này không đo tốc độ grep riêng lẻ. Nó đo toàn bộ chuỗi:

```text
runtime failure → trace → context builder → file/symbol evidence → regression test → fix
```

## Chuẩn bị công bằng: 1 repo gốc + 3 repo benchmark

Dùng năm thư mục độc lập:

```text
C:\Bench\AionUi-GOLDEN   ← repo gốc, không agent nào được sửa
C:\Bench\AionUi-Tomny    ← chỉ Tomny chạy ở đây
C:\Bench\AionUi-Claude   ← chỉ Claude chạy ở đây
C:\Bench\AionUi-ChatGPT  ← chỉ ChatGPT/Codex chạy ở đây
C:\Bench\AionUi-Kiro     ← chỉ Kiro chạy ở đây
```

Quy trình:

1. Đóng app và chụp repo gốc ở trạng thái chuẩn. `GOLDEN` chỉ dùng làm nguồn copy và đối chiếu.
2. Copy `GOLDEN` thành bốn thư mục benchmark.
3. Trong **cả bốn bản copy**, áp dụng cùng một bug fixture. Không áp dụng fixture vào `GOLDEN`.
4. Tạo `.tomni`, log token và log thời gian riêng trong từng bản copy.
5. Chạy đúng hai prompt bên dưới trong cùng một session của từng agent.
6. Không copy patch, Save hoặc lịch sử từ bản này sang bản khác.
7. Khôi phục mỗi bản copy bằng cách copy lại từ `GOLDEN` trước lần chạy lại.

Không cần copy các thư mục sinh ra hoặc có trạng thái máy:

```text
node_modules, out, dist, build, .tomni, .mtui, .git, .env*, temp/logs
```

Giữ nguyên source, `package.json`, lockfile, test và cấu hình build. Nếu dùng chung `node_modules` để tiết kiệm thời gian cài dependency, không tính thời gian cài vào benchmark.

Dùng cùng model, API key/router, permission và prompt. Tắt team/subagent ở track cơ bản; nếu muốn đo khả năng song song, tạo track riêng. Bắt đầu đồng hồ ngay trước Prompt 1 và dừng sau câu trả lời cuối Prompt 2; không tính thời gian khởi động app.

## Hai prompt chuẩn

### Prompt 1 — điều tra, không sửa

```text
Hãy điều tra chỉ-đọc theo hai hướng độc lập nhưng đồng thời:

A. Quick Test ghi nhận đúng lỗi HTTP của một request API, nhưng ContextPack trả về cho agent vẫn thiên về UI và bỏ sót lớp API/service liên quan. Truy vết từ runtime event đến context được dựng và xác định vì sao lỗi client-side 404 không được khoanh vùng đúng.

B. Một luồng khác không phụ thuộc trực tiếp vào lỗi trên: xác định kiến trúc và luồng gửi message chính của desktop từ UI qua bridge/service/runtime đến response UI. Chỉ ra file, symbol và evidence cốt lõi, không đọc tuần tự toàn bộ repository.

Chỉ điều tra, không sửa file và không chạy thao tác ngoài repository. Báo cáo riêng A và B để kiểm tra khả năng giữ hai context cùng lúc.
```

### Prompt 2 — sửa bug, mô tả mơ hồ

```text
Hãy sửa triệt để lỗi Quick Test vừa điều tra: khi request API trả lỗi client-side, agent phải nhận được đúng file/lớp API hoặc service liên quan trong context, đồng thời không làm hỏng các loại lỗi runtime khác. Thêm kiểm chứng hồi quy phù hợp, giữ nguyên API công khai và chỉ thay đổi phần cần thiết. Sau đó dùng Quick Test Tracker hoặc cơ chế trace tương đương để kiểm chứng trước/sau, xác nhận event 404, ContextPack và file API/service liên quan. Chạy test liên quan và báo rõ nguyên nhân, file đã sửa, kết quả test, thời gian và mọi giới hạn còn lại.
```

Không thêm tên file hoặc predicate vào prompt. Nếu thêm manh mối, benchmark sẽ đo khả năng làm theo chỉ dẫn chứ không còn đo khả năng tự tìm nguyên nhân.

## Tiêu chí chấm chất lượng (10 điểm)

| Hạng mục | Điểm | Cách chấm |
|---|---:|---|
| Tìm đúng nguyên nhân gốc | 2.0 | Nhận ra bất nhất giữa việc nhận diện lỗi network và mapping vào ContextPack, bao gồm 4xx |
| Khoanh vùng đúng chuỗi file/symbol | 2.0 | Có bằng chứng từ tracer/buffer, context builder và test |
| Sửa đúng hành vi | 3.0 | Lỗi 404 được map vào API/service; 5xx/transport/exception vẫn hoạt động |
| Regression test | 1.5 | Có test 404 thất bại trước và pass sau |
| Phạm vi thay đổi | 1.0 | Không sửa lan sang UI, provider hoặc file không liên quan |
| Báo cáo cuối | 0.5 | Nêu nguyên nhân, thay đổi, test và giới hạn một cách kiểm chứng được |

## Chỉ số hiệu suất cần ghi lại

Ghi một dòng cho mỗi agent/run:

| Metric | Ý nghĩa |
|---|---|
| `wall_time_s` | Từ lúc gửi Prompt 1 đến câu trả lời cuối Prompt 2 |
| `input_tokens` | Tổng token input của mọi request trong hai prompt |
| `output_tokens` | Tổng token output |
| `tool_calls` | Tổng số tool call |
| `research_calls` | Số lần gọi `ide_research`/tương đương |
| `duplicate_research` | Số query trùng bị gọi lại; mục tiêu là 0 trong cùng action |
| `files_read` | Số file thực sự đọc, không chỉ file được nêu trong kết quả |
| `tests_run` | Số test/test suite đã chạy |
| `quality_score` | Điểm theo bảng 10 điểm |
| `passed` | Test hồi quy cuối cùng có pass hay không |

Nên tính thêm hai chỉ số tổng hợp:

```text
token_efficiency = quality_score / max(1, input_tokens / 1000)
time_efficiency  = quality_score / max(1, wall_time_s / 60)
```

Không dùng token hoặc thời gian một mình để tuyên bố thắng. Một agent nhanh nhưng sửa sai phải bị tính là thất bại.

## Ma trận chạy đề nghị

Chạy mỗi cấu hình ít nhất 3 lần rồi lấy median:

1. Tomny chạy trong `AionUi-Tomny`, Save/dedup bật.
2. Claude chạy trong `AionUi-Claude`, cùng model qua router.
3. ChatGPT/Codex chạy trong `AionUi-ChatGPT`, cùng model qua router.
4. Kiro chạy trong `AionUi-Kiro`, cùng model qua router.
5. Tuỳ chọn: một track Tomny baseline khác với Save/dedup tắt.

Mỗi run phải bắt đầu từ cùng fixture bug. Sau run, lưu patch và log riêng; không để agent sau nhìn thấy patch của agent trước.

## Điều kiện thắng

Tomny chỉ được xem là vượt trội khi đồng thời:

- `passed = true` và `quality_score >= 9`;
- median token thấp hơn baseline đáng kể (mục tiêu tối thiểu 30%);
- median thời gian không tăng quá 10% so với baseline;
- `duplicate_research = 0` hoặc thấp hơn rõ rệt;
- không có thay đổi ngoài scope.

Nếu chỉ giảm token nhưng chất lượng dưới 9/10, kết luận là **tối ưu sai hướng**.

## Fixture và trạng thái repo gốc

`traceContextBuilder.ts` trong repo gốc phải typecheck sạch và xử lý 4xx đúng. Dùng các script trong thư mục này:

```powershell
.\prepare-copies.ps1 -SourceRoot C:\NDT\PJ\AionUi -DestinationRoot C:\Bench\AionUi-fix-bug
.\apply-fixture.ps1 -TargetRoot C:\Bench\AionUi-fix-bug\AionUi-Tomny
.\apply-fixture.ps1 -TargetRoot C:\Bench\AionUi-fix-bug\AionUi-Claude
.\apply-fixture.ps1 -TargetRoot C:\Bench\AionUi-fix-bug\AionUi-ChatGPT
.\apply-fixture.ps1 -TargetRoot C:\Bench\AionUi-fix-bug\AionUi-Kiro
```

`apply-fixture.ps1` chỉ đổi hai predicate `status >= 400` thành `status >= 500` và từ chối sửa `GOLDEN`. Sau mỗi run, copy lại từ `GOLDEN` hoặc dùng `restore-fixture.ps1` khi cần kiểm tra nhanh.

Sau khi một agent hoàn tất, chấm kỹ thuật bằng evaluator nằm ngoài ba repo agent:

```powershell
.\evaluate-run.ps1 -TargetRoot C:\Bench\AionUi-fix-bug\AionUi-Tomny
```

Evaluator chạy probe 404 thực tế, test Quick Test liên quan, typecheck và báo số file đã thay đổi. Trước khi agent sửa, fixture phải cho `maps404ToApiService: false`; sau khi sửa đúng phải thành `true`.
