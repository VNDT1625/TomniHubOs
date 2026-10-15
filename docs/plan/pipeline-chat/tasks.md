# Tasks bàn giao Pipeline Chat

## Quy ước thực hiện

- Tài liệu phụ thuộc `docs/core/chat-pipeline.md`, không thay master plan C0–C6.
- `[x]` chỉ phần source đã có theo bàn giao; không biểu thị release hoặc test revision hiện tại.
- `[ ]` ở task cha được giữ khi còn bất kỳ wiring, acceptance hoặc bằng chứng thiếu.
- Dòng baseline trên là trạng thái lúc soạn bàn giao; tiến độ triển khai và test revision hiện tại ghi tại mục “Tiến độ kiểm chứng” bên dưới.

## Tiến độ kiểm chứng (2026-10-15; working tree chưa commit)

- Baseline lúc bắt đầu: `4cf2b2711`; HEAD hiện tại khi rà soát: `c100fb680` (các agent khác có commit trong lượt). Các sửa đổi Pipeline Chat còn trong working tree, chưa gọi đây là revision release.
- Suite Pipeline Chat + definition store + native conversation cutover + guard persistence integration sau output-guard built-in/retry: **262/262 tests, 23/23 files, exit 0** (chạy cùng trên working tree). `Settings` DOM 9/9 đạt ở lần focused trước; còn cần rerun cùng bộ và qua release gate. Không thay thế IPC/provider live.
- `bunx tsc --noEmit --pretty false`: exit 2; lượt mới nhất còn 3 lỗi ngoài Pipeline Chat (2 TS2345 ở `process/services/social/socialBridge.ts` và 1 TS2552 tại `renderer/pages/social/settings/SocialSettingsView.tsx`). Không còn lỗi tại file Pipeline Chat sau sửa callback.
- Prettier focused (bao gồm code và 2 tài liệu): exit 0; Oxlint scoped: 0 errors, 6 warnings. `bun run lint`: exit 1 (49 errors, 1487 warnings trên repo); `bun run format:check`: fail vì `mockup/home-wireframe-v1.html` parse EOF và 2 file e2eReal không đọc được; `bunx vitest run --silent` full suite timeout sau 120s, đã thấy lỗi ở Workspace/Browser/HubHome/Feedback.
- `tests/integration/nativeConversationCutover.test.ts`: **51/51 đạt**. `tests/integration/chatPipelineGuardPersistence.test.ts`: **5/5 đạt**, gồm guard built-in block/redact qua executor/service/repository thật và reload sau Renderer replace failure. Chưa phải live IPC/provider hay process crash injection.
- P05 Main-only buffered guard cap 256 KiB (cả stream và output processor), chặn interactive payload chưa duyệt; unit + file-backed persistence integration pass nhưng vẫn PARTIAL do chưa có live IPC/provider và process-crash recovery. P06–P07, P08, P13 PARTIAL; cancellation trước persistence chưa có Foundation terminal receipt.
- Không đánh dấu bất kỳ task cha P01–P15 là hoàn tất chỉ từ các kiểm thử này.
- Owner dùng chung tuân theo `docs/execution/mvp-plan.md`; không tạo lịch checkpoint cạnh tranh.

## P01 — Chốt baseline và ownership

- [ ] Chốt acceptance atom triển khai từ baseline PARTIAL.
  - [x] Ghi nhận executor có direction input/output trong source được bàn giao.
  - [x] Ghi nhận service output hook, bridge và snapshot đã có.
  - [x] Ghi nhận non-guard post_model chạy completed assistant text.
  - [x] Ghi nhận assistant text persist trước replace.
  - [x] Gắn baseline Git `4cf2b2711` và phân biệt working tree chưa commit với release.
  - [x] Ghi rõ owner contract `packages/desktop/src/common/types/pipeline.ts` (Integrator giữ quyền sửa shared schema).
  - [x] Ghi rõ owner native service `packages/desktop/src/process/services/database/nativeConversation/service.ts` (lane Pipeline Chat ở working tree này).
  - [x] Xác nhận `chatPipeline/pipelineExecutor.ts`, `nativeConversation/bridge.ts`, `chatPipeline/runTrace.ts` là các seam đã kiểm tra.

## P02 — Direction và thứ tự stage

- [ ] Nghiệm thu direction ở toàn bộ đường chạy thật.
  - [x] Ghi nhận phần executor phân nhánh input/output đã triển khai.
  - [x] Chạy focused executor tests 18/18 trên working tree hiện tại.
  - [x] Direction tests chạy riêng input/output (executor).
  - [x] Output `post_model` được kiểm thử thứ tự và duplicate stage ref.
  - [x] Có assertion disabled stage không được gọi.
  - [x] Assertion `STAGE_NOT_FOUND`/`STAGE_PHASE_MISMATCH` fail closed.
  - [x] Snapshot test sửa definition trong khi first stage đang chờ.
  - [ ] Ghi trace đã redaction cho direction, stage và run identity.

## P03 — Output completed-text hook

- [ ] Hoàn tất acceptance output service end-to-end.
  - [x] Ghi nhận output hook non-guard đã nhận completed assistant text.
  - [x] Ghi nhận bridge/snapshot đã nối theo tiến độ source bàn giao.
  - [x] Owner test được bổ sung tại `tests/unit/chatPipeline/nativeOutput.test.ts`.
  - [ ] Kiểm tra hook chỉ chạy cho message/run đang hoàn thành.
  - [x] Test empty completed assistant output persist/replace chuỗi rỗng và terminal thành công.
  - [ ] Kiểm tra replace không làm mất metadata message hiện hữu.
  - [x] Unit test lỗi processor trả terminal `error`.
  - [ ] Bổ sung integration service–bridge thay vì chỉ dựa mock executor.

## P04 — Persistence và race

- [ ] Chứng minh tính nhất quán persist/replace.
  - [x] Ghi nhận thứ tự hiện tại là persist completed text rồi replace.
  - [x] Assertion invocation order persistence trước replace đã đạt.
    - [x] Real repository reopen test chứng minh approved text vẫn persist nếu Renderer replace thất bại; terminal lúc đó error.
  - [x] Unit test duplicate completion và late delta chỉ replace một lần.
  - [ ] Kiểm tra run cũ không ghi đè message thuộc run mới.
  - [ ] Kiểm tra restart giữa persist và replace bằng integration fixture.
  - [ ] Ghi rõ trong UX/privacy rằng persist-before-replace không phải output guard.
  - [ ] Xác định receipt phản ánh nội dung cuối hay lỗi replace theo canonical lifecycle.

## P05 — Containment output guard

- [ ] Nghiệm thu buffer guard end-to-end (PARTIAL, không release-ready).
  - [x] Bridge yêu cầu authorized guard do Main xác minh và chặn output stage thiếu/sai phase trước dispatch.
  - [x] Service buffer output text tối đa 256 KiB trước verdict; chặn UI/DB raw deltas, overflow, denied guard và late completion.
  - [x] Unit test cho guard allowed, denied, overflow và cancellation không leak raw output.
    - [ ] File-backed native service/repository integration 3/3 pass; cần bridge/provider IPC live proof, chưa đủ đóng task.
    - [ ] Reload repository sau terminal guard deny/allow và replace exception đã pass; cần thêm crash giữa persist/replace và replay IPC proof.
    - [ ] Main chặn cả interactive permission/orchestration payload chưa kiểm duyệt; cần nghiệm thu UX/policy khi output guard làm tool interaction thất bại.
  - [ ] Không tuyên bố production-ready trước khi có bằng chứng đủ acceptance.

## P06 — Cancellation preflight

- [ ] Bổ sung cancellation preflight đang thiếu.
  - [ ] Xác định cancellation contract của native run hiện hữu.
  - [x] Bridge tạo per-conversation AbortController và truyền vào pipeline executor; check trước definition/dispatch (resolve store đồng bộ).
  - [x] Check sau package expansion, projection và persistence; vẫn chưa có receipt cho hủy trước persistence.
  - [ ] Service kiểm tra aborted trước `runtime.start`, nhưng chưa chứng minh check trước credential lease nội bộ runtime.
  - [ ] Trả terminal cancelled theo schema hiện hữu, không dùng lỗi UI tự phát.
  - [x] Native service test pre-aborted không gọi runtime/persistence.
  - [x] Executor abort không chạy stage kế tiếp kể cả stage trước không hợp tác.
  - [ ] Receipt bền vững cho cancellation trước persist/model admission chưa được kiểm chứng.

## P07 — Cancellation output và transport

- [ ] Hoàn tất propagation cancellation sau dispatch.
  - [ ] Nối signal tới adapter transport thay vì chỉ ẩn spinner.
    - [x] Main timeout 2 giây nếu adapter.cancel không trả; chưa chứng minh runtime/lease kết thúc thật.
  - [x] `finish` kiểm tra signal trước persist và trước replace.
  - [x] Test cancel trong output promise và khi saveMessage pending không phát late replace.
  - [ ] Test race cancel với completed model callback.
  - [x] Native output hook test promise không resolve vẫn trả terminal stopped.
  - [ ] Không retry cancelled operation như transient failure.
  - [ ] Chứng minh chỉ có một terminal outcome bền vững.

## P08 — Auto-model advisor

- [ ] Áp dụng advisor đang chưa có đường apply.
  - [x] Main đọc `grounding.modelRouting.recommendedModel`; stage chỉ đưa đề xuất, không tự áp dụng.
  - [x] Native service kiểm tra exact model ID bằng `runtime.listModels` có timeout 1s; chưa xác nhận quota/provider policy đầy đủ.
  - [ ] Kiểm tra account ownership, allowlist và policy trước chấp nhận đề xuất.
  - [x] Áp dụng chỉ theo exact runtime `modelId`, không dùng `config.availableModels` làm quyền truy cập.
  - [ ] Từ chối đề xuất không hợp lệ bằng reason code có thể giải thích.
  - [x] Test explicit model bảo toàn lựa chọn, bỏ qua advisor.
  - [ ] Test unknown candidate bỏ đề xuất và giữ model mặc định (đạt), nhưng chưa test provider offline/account consent.
  - [ ] Ghi resolved model và lý do selection đã redaction trong evidence.

## P09 — Retry và budgets

- [ ] Thực thi retry có ngân sách hữu hạn.
  - [x] Executor cap 30s/run, 5s/stage; chưa đồng bộ deadline transport.
    - [x] Opt-in builtin read-only retry dùng deadline còn lại, không reset run budget; test 21/21 executor.
    - [x] Tối đa 2 attempt với 25 ms backoff hủy được, chỉ khi Main-vetted builtin `retrySafe` ném mã `PIPELINE_TRANSIENT_*`.
    - [x] Chỉ retry mã `PIPELINE_TRANSIENT_*`, không retry guard block/policy denial hoặc lỗi khác; provider-level transient vẫn theo Foundation/runtime contract.
    - [x] Package stage không thể tự nâng quyền `retrySafe`: executor kiểm tra built-in Main registry; guard và stage khác không retry.
  - [x] Executor giới hạn query 128KiB, context mặc định 256KiB (max 4MB) và chặn expansion trước stage sau; test đạt.
  - [ ] Test hết budget dừng chain và không dispatch provider tiếp.
  - [ ] Ghi attempt count và usage từng lần theo contract receipt.

## P10 — Compact Settings

- [ ] Nghiệm thu compact Settings PARTIAL: source đã triển khai, integration/visual còn chờ kiểm chứng.
  - [x] Xác nhận source tại `packages/desktop/src/renderer/pages/settings/PipelineChatSettings.tsx`.
  - [x] Đã có compact summary và native `<details>/<summary>` thu gọn nội dung planned chỉ đọc.
  - [x] Đã nhóm input (khác `post_model`)/output (`post_model`), giữ số thứ tự gốc của stages.
  - [x] Đã có nút tải lại khi load lỗi dùng `common.retry`, gọi `load()` và chặn click khi loading; không phải runtime retry policy.
  - [x] Đã bỏ dummy controls ở phần planned, chỉ giữ mô tả và notice chưa hoạt động.
  - [x] Settings DOM test không còn kỳ vọng planned switches giả.
  - [ ] DOM tests Settings kiểm tra nhóm stage/retry; Modal kiểm tra save, nhưng visual, keyboard và Settings integration end-to-end chưa đóng.
  - [ ] Kiểm chứng visual/integration trên Settings thật trước khi đóng acceptance cha.
  - [ ] Kiểm tra keyboard focus, accessible label và loading/error states.
  - [ ] Không dùng việc sửa test stale để chứng minh runtime đã hoàn tất.

## P11 — I18n và chuẩn UI

- [ ] Hoàn tất text và diện mạo theo owner canonical.
  - [ ] Route mọi text mới qua i18n hiện hữu.
  - [ ] Dịch error description thay vì đưa raw exception ra người dùng.
  - [ ] Đặt styling trong `packages/desktop/src/renderer/styles/tomni-ui.css`.
  - [ ] Đồng bộ `docs/product/tomni-design-system.md` nếu look thay đổi.
  - [ ] Đồng bộ `mockup/home-wireframe-v3.html` trong cùng UI change.
  - [ ] Chạy `bun run i18n:types` khi sửa text/config i18n.
  - [ ] Chạy `node scripts/check-i18n.js` và xử lý missing keys.
  - [ ] Kiểm tra snapshot UI không còn nhãn ngụ ý buffering đã chạy.

## P12 — Trust và snapshot

- [ ] Chứng minh boundary không secret renderer.
  - [ ] Run trace mask evidence và model answers; session-context snapshot sang Renderer chưa được kiểm tra toàn bộ.
  - [ ] Không đưa token/API key vào React state, tooltip hay clipboard.
  - [ ] Kiểm tra sender và payload schema trên IPC hiện hữu.
  - [ ] Giữ authorizedGuard do Main xác nhận, không tin manifest tự khai.
  - [ ] Giữ final outbound inspection dù người dùng tắt mọi UI stage.
    - [x] Pipeline run trace có tổng cap 64 KiB, finalQuery 2048 ký tự, modelCalls 24, nested-answer 16; toàn bộ session-context snapshot vẫn chưa audit.
  - [ ] Test canary trên runTrace đạt; chưa có proof xuyên toàn bộ context và exception renderer.
    - [x] Unit test ngăn package chiếm `builtin:` hoặc ghi đè ID stage package khác; Main guard authorization không đọc từ manifest.

## P13 — Receipts và recovery

- [ ] Hoàn tất durable evidence cho mỗi terminal.
  - [ ] Dùng receipt schema canonical thay vì tạo event store song song.
  - [ ] Ghi stage decision, attempts, duration và error code đã redaction.
  - [ ] Phân biệt provider-reported usage với estimated/unavailable.
  - [ ] Test completed, failed, blocked và cancelled đều có terminal.
  - [ ] Test ghi terminal lặp không làm double-settlement.
  - [ ] Test recovery khi crash sau persist trước output replace.
  - [ ] Không lưu raw secrets trong receipt để debug lựa chọn model.
  - [ ] Chốt cách đọc receipt cũ trước thêm field mới.

## P14 — Migration và rollback

- [ ] Nghiệm thu compatibility definition và kill behavior.
  - [x] Definition store tests 11/11: validator và migration cũ giữ cấu hình/đúng thứ tự.
  - [x] `withRequiredStages` chỉ thêm `builtin:user-hooks`; không tự thêm output guard.
    - [x] Migration tạo `chat-pipelines.json.pre-migration.bak` trước khi ghi và không overwrite khi backup lỗi; unit test xác nhận nguyên bản + reopen.
  - [ ] Test rollback UI vẫn đọc được definition đã lưu.
  - [ ] Tắt advisor apply mới phải giữ security floor nguyên vẹn.
  - [ ] Tắt output branch mới phải có outcome rõ, không làm mất history.
  - [ ] Không xóa conversation hoặc receipts khi rollback.
    - [ ] Migration/read/reopen + backup đạt 12/12; full rollback release và process-crash recovery vẫn chưa nghiệm thu.

## P15 — Cross-spec và verification

- [ ] Đóng acceptance bằng chứng revision triển khai.
  - [ ] Phối hợp `../model-da-phuong-thuc/tasks.md` về refs và runtime capability.
  - [ ] Chặn advisor chọn video/audioGeneration/TTS khi transport chưa có. - [x] Suite cùng lượt mới nhất 262/262 trên 23 files; focused executor 21, simulation 16, nativeOutput 19, output guard built-in 5. - [x] Ghi test exit code/suite và breakdown gần nhất tại Tiến độ kiểm chứng; không cộng gộp lần test khác.
  - [x] Các con số 25 và 28 chỉ là lịch sử, không cộng với test lượt này.
  - [ ] Chạy integration cancellation, IPC, egress và receipts ở seam dùng chung.
  - [ ] Đã thử đầy đủ lint, format:check, tsc và full Vitest, nhưng cổng repo fail/timeout (xem mục Tiến độ kiểm chứng); chưa nghiệm thu.
  - [x] Ghi baseline revision, exit codes, nhóm lỗi và trạng thái PARTIAL/BLOCKED ở đầu handoff.
  - [ ] Review MTUI diff và git status; bảo toàn mọi dirty path ngoài allowlist.
  - [x] `docs/core/chat-pipeline.md` đã cập nhật trạng thái kỹ thuật (PARTIAL/BLOCKED); tài liệu này không thay release gate.
