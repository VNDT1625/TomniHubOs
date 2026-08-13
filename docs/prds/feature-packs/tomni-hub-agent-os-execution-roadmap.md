# Tomny Hub Agent OS — Execution and Commercial Roadmap

> **Design conformance:** [Tomny Hub OS Visual Design System](tomni-hub-visual-design.md) là nguồn
> sự thật cho typography, glass, spacing, control, popup và responsive. Mock ASCII bên dưới
> chỉ mô tả information architecture; không được dùng để tạo một visual system khác.


> **Trạng thái:** Roadmap đề xuất  
> **Phạm vi:** từ hiện trạng đến product-market fit, marketplace và nền tảng bền vững  
> **Nguyên tắc:** stage-gated, outcome-driven, không big-bang rewrite

## 1. Mục tiêu cuối

Tomny đạt trạng thái thành công bền vững khi:

- người dùng thường xuyên giao mục tiêu và nhận verified outcome;
- Base OS ổn định, package lỗi không làm hỏng hệ thống;
- creator bên ngoài xây, phân phối và có doanh thu;
- community package tạo phần đáng kể giá trị sử dụng;
- subscription và marketplace có unit economics lành mạnh;
- Trust Layer duy trì lịch sử không lộ credential;
- tăng trưởng đến từ outcome, creator và chia sẻ package, không chỉ quảng cáo.

Roadmap không đo bằng số feature đã hoàn thành hoặc tổng account đăng ký.

## 2. Định nghĩa metrics

### 2.1 Meaningful WAU

Người dùng hoạt động có ý nghĩa trong tuần là người hoàn thành ít nhất một outcome đáp ứng tiêu chí xác minh, không chỉ mở app hoặc gửi một prompt.

### 2.2 North-star metric

**Verified Useful Outcomes / Meaningful WAU — VUO/WAU.**

### 2.3 Metrics chuyển stage

- W4/W12 retention;
- goal → verified outcome rate;
- median outcomes/user/week;
- package activation và crash-free rate;
- creator active và creator revenue;
- paid conversion, MRR và gross margin;
- support load;
- security incidents;
- community share of verified outcomes.

Chỉ chuyển stage khi gate được duy trì 4–8 tuần. Security là hard gate: còn Critical/P0 chưa xử lý thì không release hoặc mở rộng.

Các ngưỡng bên dưới là mục tiêu ban đầu; team được điều chỉnh sau khi có baseline nhưng không được hạ ngưỡng chỉ để tuyên bố hoàn thành.

## 3. Nguyên tắc thực thi

1. Bảo toàn logic mạnh hiện có bằng adapter; không rewrite toàn bộ.
2. Hoàn thành vertical slice end-to-end trước khi mở rộng số app.
3. First-party app phải dùng public package contract.
4. Không marketing lớn trước retention.
5. Không mở marketplace trước sandbox, review, revoke và rollback.
6. Không bán AI unlimited; compute phải có budget rõ.
7. Vốn chỉ dùng để tăng tốc kênh đã chứng minh, không thay thế product discovery.
8. Mỗi stage có go/no-go và chủ sở hữu.
9. Testing/Benchmark không là app/package sản phẩm; validation thuộc IDE/CI/publish gate.
10. Thu thập dữ liệu outcome theo privacy boundary và opt-in.

## 4. Trình tự phụ thuộc

```text
Architecture contract
→ Registry + vertical package slice
→ Security hardening
→ Studio Creator loop
→ First-party dogfood
→ Closed Alpha
→ Creator Beta + paid pilot
→ Commercial v1
→ Platform expansion
```

Không đảo thứ tự bằng cách xây marketplace đẹp khi package runtime chưa an toàn hoặc chạy không ổn định.

## 5. Stage 0 — Alignment và baseline

**Quy mô:** đội sáng lập/nòng cốt, chưa tính user growth  
**Thời lượng gợi ý:** 0–30 ngày

### Mục tiêu

Biến tầm nhìn thành contract và baseline có thể thực thi.

### Deliverables

- chốt ba design: migration, defensible core và roadmap;
- chốt taxonomy App Package, UI Package và Agent Capsule;
- inventory Base/Package/Internal;
- baseline các hành trình Chat, Studio, Browser, Manager, Team/Company;
- manifest v1 và App Registry record;
- threat model cho package, secret và publish;
- dashboard metric schema;
- chọn một vertical slice nhỏ làm pilot;
- xác định 3–5 app first-party mục tiêu, không xây tất cả cùng lúc.

### Gate

- owner cho từng workstream;
- dependency map đủ rõ;
- no-rewrite invariants được chấp nhận;
- success criteria cho pilot;
- có danh sách rủi ro và rollback path.

### No-go

Không bắt đầu tách Studio vật lý hoặc tuyển growth lớn khi contract chưa chốt.

## 6. Stage 1 — Foundation: Hub + IDE + Trust

**Thời lượng gợi ý:** tháng 1–3

### Mục tiêu

Chứng minh Hub Agent OS hoạt động bằng một vertical slice hoàn chỉnh.

### Deliverables

- Home và Store shell đọc App Registry;
- virtual/bundled package adapter cho app hiện tại;
- Package Runtime với install, activate, update, rollback, disable và uninstall;
- manifest cho ba package type;
- Permission Broker và sandbox boundary;
- Secret Broker/opaque handle/audit receipt được harden;
- IDE/App Builder tối thiểu trong Studio;
- development app xuất hiện trực tiếp trên Home;
- telemetry cho activation, outcome, lỗi và AI cost;
- một sample App Package chạy end-to-end;
- một Agent Capsule có verifier rõ.

### Gate

- Base chạy khi optional package directory trống hoặc hỏng;
- 100 vòng install/update/rollback/uninstall pilot không mất data;
- sample package không dùng private API;
- credential plaintext không xuất hiện trong prompt, memory, log hoặc output;
- package community không thể chạy code tùy ý trong Electron Main;
- không có P0/P1 security chưa xử lý;
- rollback package lỗi thành công.

### No-go

Nếu package runtime chỉ chạy được cho code nội bộ hoặc secret còn lọt vào agent context, dừng mở rộng và sửa foundation.

## 7. Stage 2 — Team và first-party dogfooding

**Thời lượng gợi ý:** tháng 3–6

### Mục tiêu

Dùng chính Tomny để xây Tomny, chứng minh public contract đủ mạnh.

### Tổ chức team

- Core Platform;
- Security & Trust;
- Studio & Creator SDK;
- First-party Apps;
- Outcome Intelligence;
- Marketplace/Growth ở mức chuẩn bị.

Ở giai đoạn nhỏ, một người có thể tham gia nhiều workstream nhưng ownership không được mơ hồ.

### Deliverables

- Studio đăng ký trước như built-in Suite;
- sau parity, Studio thành một install unit gồm IDE, Editor, UI Designer, Automation và Media;
- khoảng 3–5 first-party app/capability có giá trị thực;
- package SDK, template và conformance check;
- pipeline ký, phát hành, crash recovery và rollback;
- team xây app mới qua Studio/SDK, không chỉnh Base để thêm app;
- verifier và Outcome Receipt v0;
- loại Testing/Benchmark khỏi navigation/product map; giữ validation nội bộ.

### Gate

- dogfood liên tục tối thiểu 4 tuần;
- outcome success rate mục tiêu ≥ 75%;
- crash-free sessions ≥ 99%;
- 100% first-party package mới dùng public contract;
- ba lần nâng version liên tiếp không mất data;
- hoàn thành luồng tạo → chạy Home → chia sẻ → update;
- team dùng Studio Suite đủ để tìm ra vấn đề thật.

### No-go

Không mời cộng đồng rộng nếu first-party team vẫn phải dùng API đặc quyền hoặc sửa source Base để ship app.

## 8. Stage 3 — Closed Alpha: 0–100 Meaningful WAU

**Thời lượng gợi ý:** tháng 6–9

### Mục tiêu

Xây cộng đồng nhỏ bền vững, kiểm chứng use case và core loop.

### Đối tượng

- developer/AI power user;
- creator muốn xây app/Capsule;
- nhóm có workflow lặp lại và giá trị đo được;
- design partner chấp nhận feedback trực tiếp.

Không tuyển user ngẫu nhiên chỉ để đủ số.

### Deliverables

- onboarding theo use case;
- support gần và feedback loop hằng tuần;
- Store curated, chỉ package đã review;
- dashboard outcome, retention, permission và failure;
- Work Graph local v0;
- routing/manual recommendation v0;
- mời creator ngoài team thử SDK;
- privacy controls và opt-in projection;
- security review nội bộ liên tục.

### Gate

- 100 Meaningful WAU duy trì 4 tuần;
- W4 retention ≥ 40%;
- median ≥ 3 verified outcomes/user/week;
- goal → verified outcome ≥ 75% trên use case mục tiêu;
- ≥ 30% user dùng từ hai package trở lên;
- ít nhất 5 creator ngoài team tạo package;
- ít nhất 3 community package được người khác dùng;
- không có P0; P1 được xử lý trong 72 giờ;
- phỏng vấn cho thấy user nhận ra giá trị lớn hơn chi phí dự kiến.

### Quyết định

Nếu retention thấp, thu hẹp use case và sửa product. Không bơm marketing để che vấn đề.

## 9. Stage 4 — Creator Beta: 100–500 Meaningful WAU

**Thời lượng gợi ý:** tháng 9–12 hoặc theo gate thực tế

### Mục tiêu

Chứng minh creator flywheel và willingness to pay.

### Deliverables

- Creator Program;
- tài liệu, template và SDK ổn định hơn;
- publisher verification;
- automated review và human review khi cần;
- free/paid listing;
- entitlement, payout, refund, report và takedown;
- Outcome Reputation v1;
- creator dashboard aggregate;
- trial Pro;
- marketing bằng case study và creator, không quảng cáo đại trà;
- external security audit đầu tiên.

### Pricing pilot

- Free: Hub OS, free package, BYOK/local model;
- Pro: khoảng `$19/tháng` hoặc `$190/năm`, trial 14 ngày;
- AI usage: credit giới hạn hoặc BYOK, không unlimited;
- marketplace: creator 85%, Tomny 15%;
- chưa thu phí listing ở giai đoạn đầu.

### Gate

- 500 Meaningful WAU duy trì 6 tuần;
- W4 retention ≥ 35%;
- community package tạo ≥ 20% verified outcomes;
- ≥ 20 monthly active creators;
- ≥ 10 package khỏe: ít nhất 5 user ngoài tác giả và success ≥ 70%;
- trial-to-paid ≥ 8–12%;
- refund < 5%;
- gross margin ≥ 60%;
- security audit không còn Critical/High;
- CAC payback dự kiến < 6 tháng trước khi chạy paid acquisition lớn.

### No-go

Nếu creator không có user hoặc package không tạo outcome thật, không mở rộng marketplace bằng số listing rỗng.

## 10. Stage 5 — Commercial v1 và Scale Readiness: 500–1.000 Meaningful WAU

**Thời lượng:** theo gate, không ép lịch

### Mục tiêu

Chuyển từ beta có trả phí thành doanh nghiệp vận hành được.

### Deliverables

- commercial release ổn định;
- Pro và Team billing;
- Team plan khoảng `$29/người/tháng`;
- shared package, team context và private registry;
- SRE/observability;
- support và moderation;
- Trust & Safety;
- external audit, bug bounty và incident drill;
- pháp lý, thuế, payout, bản quyền và refund;
- business dashboard về MRR, margin và outcome;
- chuẩn bị gọi vốn hoặc đối tác chiến lược.

### Gate

- 1.000 Meaningful WAU duy trì 8 tuần;
- W4 retention ≥ 35%; W12 ≥ 25%;
- paid conversion ≥ 10% hoặc MRR tăng ≥ 10%/tháng trong 3 tháng;
- gross margin sau AI/cloud ≥ 65%;
- community package tạo ≥ 25–30% verified outcomes;
- support median response < 24 giờ;
- availability ≥ 99,5%;
- không có P0 security chưa xử lý;
- ít nhất một kênh tăng trưởng có thể lặp lại.

### Vốn và hậu thuẫn

Chỉ gọi vốn khi vốn sẽ tăng tốc:

- kênh creator đã hoạt động;
- enterprise pipeline rõ;
- hạ tầng cần mở rộng;
- international expansion có dữ liệu hỗ trợ.

Không gọi vốn chỉ để kéo dài thời gian tìm product-market fit.

## 11. Stage 6 — Platform Expansion: trên 1.000 Meaningful WAU

### Mục tiêu

Chuyển từ sản phẩm tốt thành nền tảng có network effects.

### Hướng mở rộng

Chọn một trục mỗi lần:

- một ngành dọc có outcome rõ;
- Team/Enterprise;
- quốc tế hóa;
- Agentic Package Standard cho đối tác;
- private enterprise marketplace;
- creator certification;
- global payout;
- regional Store;
- Outcome Reputation/Work Graph intelligence nâng cao.

### Gate thành công bền vững đề xuất

- 10.000 Meaningful WAU;
- W4 retention ≥ 35%, W12 ≥ 25%;
- ≥ 40% verified outcomes đến từ community package;
- ≥ 100 active creators;
- ≥ 30 creator có doanh thu hằng tháng;
- paid conversion ≥ 10%;
- gross margin ≥ 70%;
- ≥ 30% user mới đến từ creator/package/share loop;
- subscription + marketplace đủ trả vận hành, security và support;
- lộ trình rõ để bù chi phí đội ngũ và tiếp tục tăng trưởng.

Đây là mốc tham chiếu, không phải định nghĩa duy nhất của thành công. Một enterprise business nhỏ hơn nhưng doanh thu/retention mạnh vẫn có thể bền vững.

## 12. Workstreams xuyên suốt

### 12.1 Core Platform

Hub, registry, package runtime, compatibility và recovery.

### 12.2 Security & Trust

Sandbox, permission, secret, audit, signing, incident response và privacy boundary.

### 12.3 Studio & Creator SDK

IDE/App Builder, templates, local development, validation và publish.

### 12.4 First-party Apps

Xây app thật bằng public SDK; cung cấp giá trị ban đầu và benchmark chất lượng.

### 12.5 Outcome Intelligence

Work Graph, success criteria, verification, receipt, routing và reputation.

### 12.6 Marketplace & Growth

Store, billing, entitlement, creator, community, marketing và partnerships.

### 12.7 Operations

SRE, support, moderation, legal, finance và compliance.

Không cần lập đủ phòng ban ngay; chỉ mở rộng headcount khi stage trước đạt gate.

## 13. 90 ngày đầu tiên

### Ngày 0–30

- inventory tài sản hiện có;
- phân loại Base/Package/Internal;
- chốt manifest và activation contract;
- thiết lập metric baseline;
- threat model;
- chọn pilot.

### Ngày 31–60

- registry shadow/virtual package;
- vertical slice install → Home → permission → run;
- update/rollback;
- Outcome Receipt tối thiểu;
- kiểm tra secret không lọt context.

### Ngày 61–90

- IDE/App Builder tạo development app record;
- app xuất hiện trên Home;
- first-party pilot xây bằng public contract;
- bắt đầu dogfood;
- review kết quả và quyết định phase tiếp theo.

90 ngày đầu không đặt mục tiêu marketplace công khai hoặc tách toàn bộ Studio.

## 14. Cadence vận hành

- sprint sản phẩm: 2 tuần;
- outcome review: hằng tuần;
- metric/stage gate review: hằng tháng;
- architecture compatibility review: mỗi phase;
- threat model review: mỗi quý và trước public release;
- creator council: bắt đầu từ Closed Alpha;
- incident drill: trước Commercial v1 và định kỳ sau đó.

Mỗi review phải trả lời:

1. Người dùng tạo được outcome gì?
2. Vì sao họ quay lại hoặc rời đi?
3. Package nào thực sự tạo giá trị?
4. Chi phí và rủi ro cho mỗi outcome là bao nhiêu?
5. Điều gì phải dừng thay vì tiếp tục mở rộng?

## 15. Điều kiện dừng hoặc đổi hướng

Cần thu hẹp hoặc pivot nếu sau nhiều vòng cải thiện:

- user không muốn giao goal cho Outcome Engine;
- Work Graph không cải thiện kết quả;
- creator không thu hút user ngoài chính họ;
- security model quá khó hiểu để tạo trust;
- cost/outcome khiến subscription không có margin;
- first-party app luôn cần API đặc quyền;
- retention chỉ đến từ khuyến mãi hoặc support thủ công không thể scale.

Dừng một giả thuyết không đồng nghĩa dừng toàn bộ công ty; có thể giữ Hub/Studio/Store và thay đổi wedge.

## 16. Tài liệu liên quan

- [Hub Agent OS Migration Design](tomni-hub-agent-os-migration-design.md)
- [Defensible Core Design](tomni-defensible-core-design.md)
- [Package Platform Design](tomni-package-platform-design.md)
- [Home Hub PRD](tomni-home-hub.md)
- [Agentic Store PRD](tomni-agentic-store.md)
