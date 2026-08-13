# TomniHubOS — Chiến lược doanh thu, tiếp thị và hào lũy cạnh tranh

> **Trạng thái:** hướng dẫn chiến lược sống; chỉ trở thành cam kết sau khi qua cổng kiểm chứng  
> **Ngày cập nhật:** 2026-07-26  
> **Phạm vi:** định vị, thị trường, doanh thu, cộng đồng, quyền sở hữu, lợi thế phòng thủ và phản ứng đối thủ  
> **Nguyên tắc:** local-first, trung lập mô hình, creator sở hữu sản phẩm, đo kết quả đã xác minh thay vì số tính năng

## 0. Cách đọc tài liệu

Tài liệu tách rõ ba loại phát biểu:

| Nhãn           | Ý nghĩa                                                              |
| -------------- | -------------------------------------------------------------------- |
| **Đã chốt**    | Quyết định sản phẩm/kiến trúc phải được giữ khi triển khai           |
| **Giả thuyết** | Cần thử nghiệm với người dùng; không được trình bày như số liệu thật |
| **Cổng**       | Điều kiện phải đạt trước khi mở rộng, thu phí hoặc quảng bá          |

Mọi mức giá, tỷ lệ chuyển đổi, chi phí và thời hạn không dẫn nguồn trong tài liệu này là **giả thuyết thử nghiệm**, không phải dự báo doanh thu. Số liệu đối thủ được ghi cùng nguồn chính thức và ngày chụp bối cảnh.

### 0.1 Quyết định mới nhất thay thế thiết kế cũ

**Đã chốt:** không tiếp tục một `Studio Suite` khổng lồ tải một lần.

- `com.tomni.ide` là lõi IDE bắt buộc, chỉ giữ Files, Search, Git, Terminal và editor adapter tối thiểu.
- Codebase, Database, Agent Ops, Quality và các năng lực khác là contribution/package chọn lọc, cài và gỡ độc lập.
- Design Studio, Document Studio, Automation Studio, Video Studio và Music Studio là app độc lập.
- Người dùng có thể nhóm các app/tab thành một workspace và đặt tên nhóm là “Studio”; nhóm không biến chúng thành một artifact cài đặt duy nhất.
- Base và IDE lõi không được chứa sẵn mã của package tùy chọn sau khi đã tách vật lý.

Quyết định này theo ledger mới trong [Store và Package Runtime MVP](../prds/feature-packs/tomni-package-backend-mvp.md) và thay thế mô tả Suite App cũ trong một số PRD.

### 0.2 Sự thật sản phẩm không được che bằng tiếp thị

- Store/package runtime hiện còn các khoảng trống production; chỉ quảng bá tải thật khi artifact thật sự vắng khỏi Base, được tải, xác minh, kích hoạt, rollback và gỡ vật lý.
- Bốn mục đích mô hình cục bộ là `security`, `user-understanding`, `orchestrator`, `assistant`, nhưng theo [Local Core Model Runtime](../prds/feature-packs/tomni-local-core-model-runtime-design.md), các adapter hiện là `baseline/rejected`, chưa được phép nhận lưu lượng chính thức.
- Mô hình 0,8B cho bảo mật chỉ là giả thuyết cần benchmark; lớp kiểm soát tất định vẫn là thẩm quyền chính.
- Không được quảng cáo “không thể dịch ngược”, “không thể rò dữ liệu”, “AI vô hạn” hoặc “an toàn 100%”.

## 1. Kết luận điều hành

TomniHubOS không thắng Microsoft bằng cách xây một Windows nhỏ hơn, một Copilot khác, một kho app nhiều hơn hay một mô hình nền mạnh hơn. Tomni thắng nếu trở thành **lớp thực thi cá nhân do người dùng sở hữu**, nơi một mục tiêu được biến thành app/package dùng được, chạy trong vùng cách ly, kết nối được nhiều mô hình/tác nhân và tạo ra kết quả có bằng chứng.

### 1.1 Định vị một câu

> TomniHubOS giúp cá nhân và nhóm nhỏ biến ý tưởng thành phần mềm an toàn, cài đúng năng lực cần dùng, mang theo mô hình/tác nhân của họ và sở hữu sản phẩm có thể xuất ra ngoài Tomni.

### 1.2 Tám quyết định chiến lược

1. **Không đấu mô hình nền.** OpenAI, Anthropic, Google, Microsoft hoặc mô hình local là nguồn lực thay thế được qua adapter.
2. **Không đấu hệ điều hành.** Trên Windows, dùng Windows làm nền phân phối và tích hợp; Tomni sở hữu trải nghiệm goal → verified outcome.
3. **Không khóa sản phẩm của creator.** Project có thể xuất thành `.tomny`, web, executable hoặc backend riêng theo khả năng kỹ thuật và giấy phép.
4. **Không lấy dữ liệu thô làm hào lũy.** Private Work Graph thuộc người dùng; tín hiệu mạng chỉ là projection tối thiểu, tự nguyện và có thể xóa.
5. **Không bán AI không giới hạn.** Local/BYOK/BYO Agent/BYOC là đường mặc định để chi phí thấp; managed cloud có ngân sách và trần rõ.
6. **Không mở chợ trước runtime an toàn.** Sandbox, permission, review, revoke, rollback và receipt là cổng bắt buộc.
7. **Không lấy số package làm thước đo.** Xếp hạng và tăng trưởng dựa trên kết quả hữu ích đã xác minh.
8. **Không tiếp thị rộng trước retention.** Cộng đồng nhỏ, hỗ trợ gần và case study thật đi trước quảng cáo trả phí.

### 1.3 Thứ tự lợi thế

```text
Trải nghiệm tạo/cài app thật
→ an toàn và rollback đáng tin
→ creator có người dùng và doanh thu
→ kết quả có receipt
→ reputation theo package/model/version/context
→ routing ngày càng tốt
→ network effect và hào lũy
```

Một giao diện đẹp, đa mô hình, local model, MCP hoặc Store riêng lẻ đều có thể bị sao chép. Hào lũy chỉ xuất hiện khi vòng lặp trên có lịch sử thật.

## 2. Khách hàng và mũi nhọn ban đầu

### 2.1 Phân khúc ưu tiên

| Ưu tiên | Phân khúc                                          | Nỗi đau chính                                                                    | Giá trị Tomni phải chứng minh                                   |
| ------: | -------------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------- |
|       1 | Nhà phát triển độc lập và người dùng AI chuyên sâu | nhiều agent/tool rời rạc, chi phí khó đo, sản phẩm thử không thành app dùng được | một ý tưởng thành app cục bộ có thể mở, thử, ký, cài và gỡ      |
|       2 | Creator kỹ thuật/thiết kế                          | khó phân phối, kiếm tiền và chứng minh chất lượng                                | SDK/package đơn giản, Store theo outcome, quyền sở hữu rõ       |
|       3 | Nhóm 2–20 người                                    | workflow rời rạc, bí mật nằm ở nhiều dịch vụ                                     | private registry, quyền nhóm, BYOC, audit và package dùng chung |
|       4 | Doanh nghiệp có dữ liệu nhạy cảm                   | yêu cầu quản trị, danh tính, tuân thủ và triển khai riêng                        | control plane, private catalog, policy, BYOC/on-prem và support |

Không bắt đầu bằng “mọi người dùng máy tính”. Cũng không bắt đầu bằng doanh nghiệp lớn khi sandbox, audit và vận hành chưa qua cổng.

### 2.2 Mũi nhọn thu hút

**Giả thuyết mũi nhọn:** “Nói một ý tưởng, nhận một app chạy được an toàn trên máy trong cùng phiên.”

Hành trình demo chuẩn là app báo thức:

```text
“Tạo app báo thức cho tôi”
→ Tomni hiển thị một lần những gì còn thiếu: IDE, model/agent, quyền và dung lượng
→ người dùng chấp thuận
→ tải `com.tomni.ide` nếu thiếu
→ chọn local model, API chính thức hoặc Agent Bridge
→ tạo project
→ chạy thử trong sandbox
→ kiểm thử và tạo receipt
→ dùng riêng hoặc ký `.tomny`
→ chia sẻ/public khi Store đủ cổng
```

Đây là demo mục tiêu, không được mô tả là đã hoàn thiện nếu các bước tải vật lý, sandbox và publish chưa có bằng chứng.

### 2.3 Vì sao mũi nhọn này tốt hơn “chat AI”

- Kết quả là phần mềm có vòng đời, không chỉ là đoạn văn hoặc mã nguồn.
- Người dùng thấy ngay giá trị của IDE/package/sandbox/Store trong một luồng.
- Creator có một đường từ ý tưởng đến phân phối và doanh thu.
- Outcome có tiêu chí pass/fail, phù hợp với Outcome Engine và reputation.
- Demo có thể đo thời gian đến thành công, lỗi, chi phí và tỷ lệ quay lại.

## 3. Kiến trúc sản phẩm gắn với mô hình kinh doanh

### 3.1 Các lớp giá trị

| Lớp                      | Trách nhiệm                                                                     | Kiếm tiền trực tiếp?                                                      |
| ------------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Base OS                  | shell, Home, Store, Chat lõi, Package Manager, quyền, sandbox, secret, recovery | không khóa phí cho an toàn cơ bản                                         |
| IDE lõi                  | editor, file, search, Git, terminal, host contribution                          | gói Pro/Builder có thể tài trợ phát triển nhưng định dạng project phải mở |
| App/UI/Capsule package   | năng lực người dùng chọn                                                        | bán một lần, thuê bao hoặc miễn phí                                       |
| Outcome Engine           | chọn app/model/tool, thực thi, xác minh và receipt                              | giá trị của Pro/Team/control plane                                        |
| Private Work Graph       | ngữ cảnh và lịch sử riêng của người dùng                                        | giữ local; sync là tùy chọn trả phí                                       |
| Outcome Reputation Graph | uy tín theo package/version/context từ tín hiệu tối thiểu                       | hỗ trợ phân phối, routing và Store                                        |
| Continuum                | job bền vững, lịch, webhook, đồng bộ và chuyển local/cloud                      | thuê bao + dùng bao nhiêu trả bấy nhiêu                                   |
| Nexus                    | gọi/bán capability có chữ ký, đo đếm và chia tiền                               | phí giao dịch/thành công                                                  |
| Resource Exchange        | chọn tài nguyên local, BYOC, provider hoặc Tomni                                | phí điều phối tương lai, không phải mũi nhọn năm đầu                      |

### 3.2 `.tomny` và quyền sở hữu

`.tomny` là đơn vị phân phối có manifest, artifact, asset, locale, permission, dependency, hash, chữ ký và metadata. Nó không phải phép mã hóa tuyệt đối và không tự tạo bản quyền.

Creator phải có các quyền sau:

- giữ quyền sở hữu source và tài sản do họ có quyền hợp pháp;
- xuất project và dữ liệu bằng định dạng được tài liệu hóa;
- chọn dùng riêng, chia sẻ riêng tư hoặc public;
- chọn runtime Tomni, cloud Tomni hoặc cloud của chính họ khi package hỗ trợ;
- gỡ listing trong giới hạn nghĩa vụ với người đã mua;
- nhận lịch sử build/sign/publish làm bằng chứng nguồn gốc;
- không cấp quyền huấn luyện trên source/prompt mặc định.

Tomni chỉ nhận giấy phép không độc quyền, có phạm vi, để lưu trữ, kiểm tra, phân phối và chạy package theo lựa chọn của creator.

### 3.3 Tomni Agent Bridge — mang tác nhân đã có vào Tomni

Agent Bridge giảm chi phí gia nhập: người dùng mang API, CLI, agent hoặc thuê bao được nhà cung cấp cho phép tích hợp. Nó phải trung lập nhà cung cấp và chỉ dùng giao diện chính thức.

Hai chiều hợp lệ:

```text
Tác nhân ngoài → Tomni MCP server → tạo nhiệm vụ/xem trạng thái/nhận artifact
Tomni → API/SDK/MCP agent chính thức → nhận kết quả có cấu trúc
```

Cài MCP của Tomni vào ChatGPT không tự biến ChatGPT Web thành API miễn phí hai chiều. Theo tài liệu OpenAI, ChatGPT gọi tool từ MCP app; ChatGPT không mặc nhiên cung cấp model của nó như một MCP server để Electron tự gửi prompt và lấy mọi câu trả lời. Custom MCP còn phụ thuộc gói, quyền quản trị và remote endpoint được hỗ trợ. Xem [OpenAI Apps SDK](https://developers.openai.com/apps-sdk/) và [Developer mode/MCP apps trong ChatGPT](https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt).

**Đã chốt:** không dùng tự động hóa trình duyệt/scrape phiên ChatGPT làm nền sản phẩm. Mọi adapter phải có điều khoản sử dụng hợp lệ, rate limit, timeout, cost receipt và đường fallback.

### 3.4 Ranh giới dữ liệu

```text
Yêu cầu
→ Permission Broker
→ egress gate tất định
→ che secret và giảm dữ liệu
→ xem trước payload khi policy yêu cầu
→ local/BYOC/provider
→ kiểm tra output trong sandbox
→ người dùng duyệt hành động quan trọng
```

Nếu payload được gửi tới một dịch vụ ngoài, dữ liệu đã rời máy; không được nói “không rò rỉ” chỉ vì adapter bảo mật 0,8B đã chạy. Ba chế độ sản phẩm phải rõ:

1. **Chỉ cục bộ:** không egress.
2. **Từ xa đã giảm dữ liệu:** redaction/projection và log receipt.
3. **Từ xa đầy đủ:** hiển thị chính xác phạm vi và xin chấp thuận.

## 4. Microsoft: đối thủ lớn nhất và cũng là nền phân phối

### 4.1 Sự thật phải nhìn thẳng

Các con số sau là tuyên bố chính thức của Microsoft trong FY2026 Q3, không phải số do Tomni đo độc lập:

- hơn 20 triệu ghế Microsoft 365 Copilot trả phí;
- gần 140.000 tổ chức dùng GitHub Copilot và đa số người dùng dùng nhiều mô hình;
- hàng chục nghìn công ty quản lý hàng chục triệu agent qua Agent 365;
- Work IQ chứa hơn 17 exabyte ngữ cảnh tổ chức;
- Windows vượt 1,6 tỷ thiết bị hoạt động hằng tháng;
- Microsoft dự kiến khoảng 190 tỷ USD chi tiêu vốn trong năm lịch 2026.

Nguồn: [Microsoft FY2026 Q3 Earnings Call](https://www.microsoft.com/en-us/investor/events/fy-2026/earnings-fy-2026-q3).

Microsoft cũng đã có:

- [Foundry Local](https://learn.microsoft.com/en-us/windows/ai/foundry-local/get-started) chạy mô hình trực tiếp trên Windows và hỗ trợ mẫu local → cloud;
- [Windows On-device Agent Registry qua MCP](https://learn.microsoft.com/en-us/windows/ai/mcp/overview) với discovery, containment, quyền quản trị và audit;
- [Agent Launchers](https://learn.microsoft.com/en-us/windows/ai/agent-launchers/) để agent được tìm và gọi ở cấp hệ điều hành;
- [Copilot Studio](https://learn.microsoft.com/en-us/microsoft-copilot-studio/whats-new) có đa agent, MCP, workflow, evaluation và theo dõi chi phí;
- [Microsoft 365 Agent Store](https://learn.microsoft.com/en-us/microsoft-365/copilot/copilot-agent-store) nhận cả agent từ nền tảng ngoài và có Entra/governance;
- [GitHub Copilot đa mô hình](https://docs.github.com/en/copilot/reference/ai-models/supported-models) từ nhiều nhà cung cấp;
- [Microsoft Marketplace](https://learn.microsoft.com/en-us/partner-center/marketplace-offers/plan-saas-offer) chỉ thu phí dịch vụ chuẩn 3% trong ví dụ SaaS chính thức hiện tại.

Vì vậy “local AI”, “đa mô hình”, “MCP”, “agent store”, “multi-agent” và “model routing” **không thể là tuyên bố độc quyền hoặc hào lũy riêng** của Tomni.

### 4.2 Nơi Microsoft gần như chắc chắn thắng nếu đối đầu trực diện

| Mặt trận              | Lợi thế Microsoft                                                | Kết luận cho Tomni                                                |
| --------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------- |
| Phân phối đại trà     | Windows, Microsoft 365, GitHub, Edge, Azure và kênh doanh nghiệp | không mua quảng cáo để đấu nhận diện trên diện rộng               |
| Vốn và compute        | hạ tầng, hợp đồng GPU, đội nghiên cứu và trợ giá bundle          | không tự huấn luyện foundation model để “mạnh hơn”                |
| Ngữ cảnh doanh nghiệp | email, tài liệu, cuộc họp, danh tính, SharePoint, Entra          | không tuyên bố Work Graph sẽ thắng Work IQ về quy mô              |
| Quản trị doanh nghiệp | Purview, Intune, Entra, compliance, partner channel              | không vào enterprise trước khi audit/BYOC/private catalog đủ mạnh |
| Lập trình             | GitHub, VS Code, Visual Studio và Copilot                        | không biến IDE thành một bản sao VS Code/Copilot                  |
| Chợ và thanh toán     | Marketplace, hợp đồng doanh nghiệp, thuế và reseller             | Store Tomni phải tạo giá trị lớn hơn một cổng thanh toán          |

### 4.3 Chiến lược bất đối xứng với Microsoft

#### A. Dùng Microsoft làm substrate

Trên Windows, Tomni nên:

- phát hành Electron app qua Microsoft Store bằng MSIX hoặc EXE đã ký; Microsoft xác nhận Store hỗ trợ Electron và cả hai đường phân phối trong [hướng dẫn Win32 chính thức](https://learn.microsoft.com/en-us/windows/apps/distribute-through-store/how-to-distribute-your-win32-app-through-microsoft-store);
- đăng ký Tomni Agent Launcher/App Actions khi API ổn định để người dùng gọi Tomni từ Start/Search và app khác;
- tích hợp Windows ODR thay vì xây registry MCP song song không cần thiết;
- cho Local Inference Broker dùng Foundry Local/Windows ML như một provider khi benchmark tốt hơn runtime riêng;
- hỗ trợ Azure BYOC và, khi đủ trưởng thành, bán control plane doanh nghiệp qua Microsoft Marketplace để tận dụng hợp đồng EA/MCA;
- giữ `.tomny` là lớp package của Tomni, không giả vờ thay thế MSIX: MSIX phân phối app Tomni ở cấp Windows, `.tomny` phân phối năng lực bên trong Tomni.

**Danh mục “ứng dụng liên kết”.** Tomni có thể giới thiệu các ứng dụng Microsoft Store đã qua danh sách cho phép để giảm ma sát phân phối và giải quyết bài toán khởi đầu nguội. Mỗi mục chỉ lưu siêu dữ liệu, phiên bản được duyệt và cách gọi hợp lệ; Tomni mở hoặc điều phối ứng dụng qua URI, App Actions hay MCP do ứng dụng công bố. Tomni không sao chép tệp thực thi, không đóng gói lại và không nhúng tùy ý cửa sổ của ứng dụng khác.

Kênh này phải tôn trọng giấy phép, điều khoản và quyền của nhà phát hành. Mỗi phiên bản mới phải được rà soát lại trước khi tiếp tục nằm trong danh sách cho phép; nếu chưa rà soát thì tạm ngừng liên kết. Chứng nhận của Microsoft Store là một tín hiệu đầu vào, không phải bảo đảm tuyệt đối về an toàn, quyền riêng tư hoặc khả năng tương thích.

#### B. Sở hữu lớp mà Windows không mặc định sở hữu cho người dùng

Tomni phải tập trung vào năm thứ:

1. **Luồng ý tưởng → app/package chạy được** xuyên suốt IDE, sandbox, Home và Store.
2. **Package di động và creator-owned**, có thể dùng riêng, bán, xuất hoặc chạy trên cloud của creator.
3. **Receipt kết quả thống nhất** qua nhiều mô hình, package, agent và môi trường.
4. **Reputation theo hiệu quả thật** thay cho download/star đơn thuần.
5. **Private Work Graph kiểm soát được**, không phụ thuộc một bộ ứng dụng văn phòng hay một cloud.

Microsoft có thể xây từng phần tương tự. Lợi thế của Tomni chỉ tồn tại nếu thực thi tập trung, hình thành cộng đồng creator và tích lũy lịch sử outcome trước khi đối thủ coi ngách này là quan trọng.

#### C. Định vị bổ sung trước, thay thế sau nếu người dùng tự chọn

Thông điệp giai đoạn đầu không phải “bỏ Microsoft”. Thông điệp là:

> Dùng Windows, GitHub Copilot, ChatGPT, Claude, Gemini, local model và cloud bạn đang có; Tomni biến chúng thành một hệ thống tạo, cài, chạy và kiểm chứng sản phẩm do bạn sở hữu.

Điều này giảm phản kháng, giảm chi phí chuyển đổi và biến Agent Bridge/BYOC thành kênh kéo người dùng. Sau khi Tomni chứng minh giá trị, người dùng có thể chuyển nhiều công việc hơn vào Tomni mà không bị ép.

### 4.4 So sánh chiến lược

| Tiêu chí                  | Microsoft mạnh hơn hiện tại     | Cửa thắng khả thi của Tomni                                                         |
| ------------------------- | ------------------------------- | ----------------------------------------------------------------------------------- |
| Mô hình và compute        | rất lớn                         | không cạnh tranh; route sang provider/local/BYOC                                    |
| Office/enterprise context | rất lớn                         | Work Graph cá nhân, cross-app, export được                                          |
| IDE/coding                | rất lớn                         | creator loop từ code đến package/store/runtime trong một sản phẩm                   |
| Local AI                  | đã có nền tảng                  | policy/receipt nhất quán qua nhiều runtime, không phải runtime riêng                |
| Agent marketplace         | đã có phân phối                 | App + UI + Capsule, dùng trực tiếp trong shell và creator có quyền xuất             |
| Uy tín                    | thương hiệu và enterprise trust | reputation chi tiết theo verified outcome/version/context nếu tạo được dữ liệu thật |
| Tốc độ ở ngách            | tổ chức lớn, nhiều ưu tiên      | đội nhỏ tập trung một hành trình và cộng đồng cụ thể                                |
| Quyền sở hữu              | gắn hệ sinh thái Microsoft      | export, local-first, BYOC và không khóa model                                       |

### 4.5 Bốn điều không được làm khi cạnh tranh Microsoft

- Không định giá bằng cách đốt tiền trợ giá token/compute.
- Không tuyên bố “model-neutral” là duy nhất; GitHub Copilot và Foundry đã đa mô hình.
- Không fork hoặc thay thế API Windows nếu có API chuẩn đủ an toàn; hãy trở thành client/provider tốt nhất của chuẩn đó.
- Không phụ thuộc riêng Windows lâu dài: contract `.tomny`, manifest, receipt và cloud API phải có đường sang macOS/Linux khi có nhu cầu thật.

## 5. Kịch bản phản ứng với các đối thủ

| Đối thủ/kịch bản                                      | Điều họ có thể làm                                                                                                                                                   | Phản ứng đã định trước của Tomni                                                                                            | Không làm                                                |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Microsoft bundle builder/agent/store miễn phí         | dùng Windows/M365/GitHub để phân phối tức thì                                                                                                                        | tích hợp như substrate; nhấn mạnh package di động, creator ownership, outcome reputation; list Tomni trên Store/Marketplace | đấu giá token hoặc tuyên bố “đa mô hình hơn”             |
| Microsoft giảm Marketplace về gần 0%                  | làm take rate 15% khó bán                                                                                                                                            | cho creator chọn direct distribution; thử 10%/15% theo dịch vụ; rebate theo outcome và chi phí hỗ trợ                       | che phí hoặc giữ tỷ lệ cố định bất kể giá trị            |
| OpenAI mở rộng Apps SDK/App Directory                 | app chạy ngay trong ChatGPT và được phân phối tới tệp người dùng lớn; [nguồn OpenAI](https://openai.com/index/introducing-apps-in-chatgpt/)                          | xuất Tomni MCP app làm kênh vào; ChatGPT giao nhiệm vụ, Tomni chạy local/sandbox và trả receipt                             | scrape ChatGPT Web hoặc phụ thuộc một gói người dùng     |
| Google mở rộng Agent Engine/Gemini                    | runtime managed, session, memory, evaluation và hạ tầng cloud; [nguồn Google Cloud](https://cloud.google.com/vertex-ai/generative-ai/docs/reasoning-engine/overview) | Gemini/Vertex là provider hoặc BYOC; giữ contract package/outcome độc lập cloud                                             | xây cloud ngang quy mô Google                            |
| Anthropic bundle Claude/Claude Code                   | agent coding mạnh, seat doanh nghiệp, spend control và MCP policy; [nguồn Anthropic](https://www.anthropic.com/news/claude-code-on-team-and-enterprise)              | tích hợp Claude như thợ mạnh; Tomni bán vòng đời sản phẩm, Store và sandbox chứ không bán “coder tốt hơn”                   | dùng output Claude trái điều khoản hoặc quảng cáo vô hạn |
| Apple mở rộng on-device/Foundation Models/App Intents | privacy và tích hợp hệ điều hành rất sâu; [nguồn Apple Developer](https://developer.apple.com/apple-intelligence/)                                                   | giữ schema capability gần chuẩn mở, nghiên cứu host macOS sau khi Windows wedge có retention                                | đấu phần cứng, NPU hoặc privacy marketing khi chưa audit |
| Một chợ khác trả creator 97–100%                      | creator chuyển listing                                                                                                                                               | chứng minh discovery theo outcome, preview local, sandbox, rollback và khách hàng chất lượng; cho export/direct sale        | dùng khóa dữ liệu/package để giữ creator                 |
| Provider khóa API/MCP hoặc tăng giá                   | adapter hỏng, biên lợi nhuận giảm                                                                                                                                    | provider abstraction, circuit breaker, nhiều route, local fallback và thông báo cost trước chạy                             | âm thầm chuyển provider/dữ liệu                          |
| Đối thủ sao chép `.tomny`/UI                          | feature parity nhanh                                                                                                                                                 | đẩy chuẩn mở, conformance, creator relationships và history reputation                                                      | đổi định dạng liên tục để tạo lock-in                    |

## 6. Hào lũy phòng thủ thực tế

### 6.1 Cái có thể sao chép trong 3–12 tháng

- UI Home/Store/IDE;
- app grouping đặt tên “Studio”;
- file package và manifest;
- MCP/Agent Bridge;
- local model hoặc adapter LoRA;
- sandbox cơ bản;
- pricing page và revenue share;
- một demo tạo app bằng prompt.

Không được gọi các mục này là moat.

### 6.2 Cái khó sao chép đồng thời

1. **Lịch sử outcome đã xác minh** gắn với package, phiên bản, model, runtime, permission và context.
2. **Mạng creator có doanh thu thật**, người dùng thật, support history và reputation chống gian lận.
3. **Private Work Graph hữu ích nhưng di động**, khiến người dùng ở lại vì hệ thống hiểu họ chứ không vì không thể rời đi.
4. **Chuẩn `.tomny` được nhiều app/provider sử dụng**, kèm SDK, validator và conformance suite.
5. **Trust history** gồm ký artifact, revoke, rollback, incident response và thời gian không lộ secret.
6. **Tốc độ học ở ngách** từ founder/community feedback, không phải số lượng feature.

Không mục nào bất khả sao chép. Hào lũy là thời gian, quan hệ và dữ liệu kết quả hợp lệ tích lũy cùng nhau.

### 6.3 Bốn vòng lặp mạng

#### Vòng lặp creator

```text
Creator tạo package
→ người dùng cài và có outcome
→ creator nhận phân phối/doanh thu
→ creator cải thiện package
→ thêm creator tham gia
```

#### Vòng lặp outcome

```text
Receipt hợp lệ
→ reputation theo context tốt hơn
→ routing đúng hơn
→ nhiều outcome thành công hơn
→ thêm receipt hợp lệ
```

#### Vòng lặp tiêu chuẩn

```text
SDK/manifest ổn định
→ nhiều provider/app tích hợp
→ creator tiếp cận nhiều runtime
→ tiêu chuẩn hữu ích hơn
→ thêm tích hợp
```

#### Vòng lặp tin cậy

```text
Permission rõ + sandbox + rollback
→ ít sự cố, xử lý minh bạch
→ người dùng giao việc quan trọng hơn
→ có thêm evidence vận hành
→ trust tăng
```

### 6.4 Ranh giới mở và đóng

| Nên mở/portable                                     | Nên bảo vệ như bí mật kinh doanh hoặc dịch vụ                 |
| --------------------------------------------------- | ------------------------------------------------------------- |
| manifest `.tomny`, schema capability, SDK công khai | fraud/risk scoring chi tiết và tín hiệu điều tra              |
| validator, conformance test và sample package       | thuật toán ranking/routing production và tham số chống gaming |
| định dạng export/import Work Graph                  | khóa ký, secret, incident playbook và hạ tầng ký              |
| receipt schema và cách xác minh client-side         | aggregate reputation service và abuse graph                   |
| API Agent Bridge/Continuum/Nexus                    | heuristic bảo mật chưa công bố và vận hành cloud              |
| quyền creator, công thức payout và appeal           | dữ liệu nội bộ tối thiểu cần cho moderation hợp pháp          |

Mở contract giảm nỗi sợ lock-in và tăng adoption. Phần đóng phải là vận hành khó, dữ liệu mạng hợp pháp và know-how; không phải cố giấu file đã giao cho máy người dùng.

### 6.5 Retention không dùng khóa dữ liệu

Người dùng ở lại vì:

- package/workspace của họ chạy tốt và cập nhật an toàn;
- Work Graph local giúp routing cá nhân hóa;
- lịch sử receipt giúp kiểm tra, hoàn tác và học;
- creator họ tin tưởng tiếp tục phát hành;
- nhóm có policy, private registry và automation hữu ích;
- chi phí/tốc độ tốt nhờ local/BYOK/BYOC.

Người dùng vẫn phải có thể export project, receipt, cấu hình provider và dữ liệu có ý nghĩa. “Quyền rời đi” là công cụ tạo trust; không phải điểm yếu.

## 7. Quyền sở hữu, bản quyền và bảo vệ công nghệ

### 7.1 Điều Tomni có thể chứng minh

Mỗi build/publish nên tạo một `Provenance Receipt` gồm:

- creator/publisher ID đã xác minh ở mức phù hợp;
- commit/source tree hash;
- dependency lock và SBOM;
- build recipe/toolchain version;
- artifact hash, manifest hash và chữ ký;
- timestamp từ dịch vụ độc lập khi có;
- kết quả static scan, sandbox test và review;
- license/asset attestation;
- chuỗi version, transfer và takedown.

Receipt là bằng chứng kỹ thuật về chuỗi tạo/phát hành, không tự thay thế đăng ký hoặc phán quyết pháp lý.

### 7.2 Chính sách quyền creator

- Creator giữ IP của source và asset họ sở hữu.
- Tomni không nhận quyền huấn luyện từ việc upload; opt-in huấn luyện phải là thỏa thuận riêng, dễ rút và không gộp vào điều khoản bắt buộc.
- Creator chịu trách nhiệm khai báo thành phần bên thứ ba; Tomni cung cấp SBOM, license scan và cảnh báo public-code similarity.
- Hợp đồng Store quy định rõ refund, update tối thiểu, end-of-life, transfer publisher và quyền của người đã mua.
- Khi package bị gỡ, người dùng được export dữ liệu; runtime có thể revoke bản nguy hiểm nhưng không chiếm source creator.
- Tranh chấp có notice, counter-notice/appeal, bảo toàn evidence và người đánh giá độc lập khi có thể.

### 7.3 Bản quyền không bảo vệ ý tưởng

WIPO nêu phần mềm nhìn chung được bảo hộ bằng copyright, nhưng copyright bảo vệ cách thể hiện chứ không bảo vệ ý tưởng, quy trình, phương thức vận hành hay khái niệm toán học; bảo hộ ở các nước Berne không phụ thuộc thủ tục đăng ký. Xem [WIPO — Copyright Protection of Computer Software](https://www.wipo.int/en/web/copyright/activities/software).

Vì vậy:

- hash/signature giúp chứng minh thời điểm và tính toàn vẹn, không cấm đối thủ tự viết lại ý tưởng;
- đăng ký bản quyền, nhãn hiệu hoặc bằng sáng chế tùy quốc gia cần luật sư chuyên môn;
- bí mật kinh doanh chỉ còn bí mật khi có kiểm soát truy cập và không phân phối công khai;
- binary/obfuscation chỉ tăng chi phí dịch ngược, không bảo vệ tuyệt đối;
- lợi thế bền hơn là cộng đồng, thương hiệu tin cậy, vận hành, dữ liệu outcome hợp pháp và tốc độ cải tiến.

### 7.4 Chương trình bảo vệ IP nội bộ

- đăng ký và thống nhất tên `Tomni`/`Tomny` trước public launch; hiện sự không nhất quán tên là rủi ro thương hiệu;
- IP assignment rõ với nhân viên/nhà thầu;
- repository/production least privilege, hardware key và audit;
- tách signing key khỏi build system, có rotation/revocation;
- reproducible build, SBOM, secret scan và artifact attestation;
- phân loại tài liệu `public`, `partner`, `confidential`, `restricted`;
- không đặt bí mật cốt lõi trong local adapter weights hoặc package giao cho người dùng;
- cloud core tối thiểu chỉ giữ fraud/reputation/routing aggregate cần thiết; không biến raw prompt/source thành tài sản công ty.

## 8. Mô hình doanh thu

### 8.1 Nguyên tắc kiếm tiền

1. Thu tiền cho **điều phối, an toàn, vòng đời package, đồng bộ, phân phối và kết quả**, không giả vờ token là miễn phí.
2. Tách phí phần mềm khỏi compute để người dùng thấy họ đang trả cho gì.
3. Local/BYOK/BYO Agent/BYOC làm giảm giá vốn; managed cloud là lựa chọn, không phải khóa bắt buộc.
4. Không lấy secret, prompt, source hoặc raw Work Graph để đổi lấy giá rẻ.
5. Basic sandbox, permission, ký/xác minh và đường export không bị khóa sau gói đắt.
6. Mọi phí giao dịch dùng cùng một cơ sở tính, hiển thị trước cho creator.
7. Chỉ thu “phí thành công” khi verifier hợp lệ; chi phí compute đã phát sinh vẫn có thể phải trả nếu đã được báo trước.
8. Mỗi gói có trần chi phí, cảnh báo và kill switch; không có chữ “unlimited” cho tài nguyên có giá vốn biến đổi.

### 8.2 Chồng doanh thu

| Nguồn                  | Người trả                       | Đơn vị tính                  | Biên lợi nhuận kỳ vọng                | Giai đoạn       |
| ---------------------- | ------------------------------- | ---------------------------- | ------------------------------------- | --------------- |
| Thuê bao Pro/Builder   | cá nhân/creator                 | người dùng/tháng hoặc năm    | cao nếu BYOK/local là chủ đạo         | beta            |
| Thuê bao Team          | nhóm nhỏ                        | người dùng hoạt động/tháng   | cao-trung bình                        | commercial v1   |
| Store package          | người mua                       | lần mua hoặc thuê bao        | trung bình; có payout/refund/review   | creator beta    |
| Nexus capability       | người gọi capability            | giao dịch hoặc outcome       | trung bình; phụ thuộc compute creator | sau Store       |
| Continuum              | cá nhân/nhóm                    | project hoạt động + mức dùng | trung bình; cần kiểm soát cloud       | sau core loop   |
| Managed cloud          | người dùng không có cloud/model | giá vốn + phí nền tảng       | thấp-trung bình nếu không tối ưu      | tùy chọn        |
| BYOC control plane     | nhóm/doanh nghiệp               | tenant/seat/environment      | cao; compute trả trực tiếp cho cloud  | Team/Enterprise |
| Private Store/registry | doanh nghiệp                    | tenant/năm                   | cao-trung bình                        | Enterprise      |
| Hỗ trợ/audit/tích hợp  | doanh nghiệp/creator            | dự án hoặc SLA               | tùy nhân lực; phải tách khỏi ARR      | Enterprise      |
| Resource Exchange      | bên mua/bán tài nguyên          | phí điều phối                | chưa biết; rủi ro cao                 | tương lai       |

### 8.3 Gói giá thử nghiệm

Đây là dải A/B test, không phải bảng giá công bố.

| Gói           |                Giá giả thuyết | Bao gồm                                                                           | Không bao gồm                                                         |
| ------------- | ----------------------------: | --------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Free          |                         0 USD | Base, local Work Graph, package miễn phí, BYOK/BYO Agent, bảo mật cơ bản, export  | hosted AI không giới hạn, Continuum production, private team registry |
| Pro/Builder A |                  12 USD/tháng | IDE workflow, private development apps, routing/receipt nâng cao, quota relay nhỏ | compute ngoài quota                                                   |
| Pro/Builder B | 19 USD/tháng hoặc 190 USD/năm | như A, thêm Continuum cá nhân giới hạn và creator analytics                       | compute ngoài quota, Team governance                                  |
| Team A        |            24 USD/người/tháng | shared package, role, audit, BYOC, private workspace                              | hỗ trợ chuyên trách                                                   |
| Team B        |            29 USD/người/tháng | như A, thêm private registry và policy nâng cao                                   | custom compliance/SLA                                                 |
| Enterprise    |                       báo giá | tenant floor + active seats + environments + support/SLA tùy chọn                 | không hứa giá cố định trước discovery                                 |

Quy tắc test:

- thử giá với cùng cohort/use case, không thay cả sản phẩm và giá cùng lúc;
- annual discount tối đa tương đương khoảng hai tháng cho đến khi biết churn;
- regional pricing chỉ áp dụng sau khi có chống lạm dụng và không thấp hơn variable cost;
- founder price có thời hạn rõ, không hứa vĩnh viễn;
- trial dùng quota tiền thật nhỏ và hard cap, không tạo thói quen “cloud miễn phí”.

Baseline roadmap cũ đề xuất Pro khoảng 19 USD và Team khoảng 29 USD; các dải trên giữ baseline nhưng buộc kiểm chứng willingness-to-pay.

### 8.4 Cách làm người dùng trả ít nhưng Tomni vẫn có lợi nhuận

Không có phép màu “người dùng gần như không trả mà công ty lời cao”. Cách bền vững là đổi cấu trúc giá vốn:

1. **Local-first:** tác vụ phù hợp chạy trên máy, marginal cloud cost của Tomni gần 0.
2. **BYOK/BYO Agent:** người dùng dùng tài khoản/provider họ đã trả; Tomni bán lớp điều phối và sản phẩm, không bán lại token trái phép.
3. **BYOC:** doanh nghiệp trả Azure/AWS/GCP trực tiếp; Tomni thu control-plane fee có biên cao.
4. **Route theo cost/outcome:** dùng mô hình nhỏ/local cho phân loại, mô hình mạnh chỉ cho bước cần reasoning.
5. **Batch/cache hợp lệ:** tái dùng artifact, index và receipt không nhạy cảm; không cache raw data giữa người dùng.
6. **Phí theo giá trị:** Nexus chỉ thu success fee khi outcome được xác minh; tránh tính phí cho retry do lỗi Tomni.
7. **Creator chịu giá vốn họ kiểm soát:** package cloud của creator có giá đã gồm hạ tầng của họ; Tomni không âm thầm gánh compute.
8. **Thuê bao phần mềm:** doanh thu định kỳ tài trợ shell, sandbox, Store và support; không dùng token làm loss leader vô hạn.

### 8.5 Managed cloud, BYOC và cloud creator

Mỗi package online được chọn một hoặc nhiều deployment profile:

| Profile       | Ai sở hữu hạ tầng       | Ai trả compute           | Tomni thu                         |
| ------------- | ----------------------- | ------------------------ | --------------------------------- |
| Local         | người dùng              | người dùng qua phần cứng | thuê bao/control plane nếu có     |
| Creator cloud | creator                 | nằm trong giá package    | Store/Nexus fee trên net receipts |
| User BYOC     | người dùng/doanh nghiệp | trả trực tiếp provider   | BYOC control-plane fee            |
| Tomni managed | Tomni                   | Tomni trả rồi thu lại    | pass-through + platform margin rõ |

**Giả thuyết Continuum:** 2–5 USD cho mỗi project cloud hoạt động/tháng cộng storage/job/network đo được. Dải này chỉ dùng để test; phải báo estimate/max trước khi bật job.

**Giả thuyết managed cloud:** giá vốn provider chuyển thẳng, cộng platform margin 10–25% hoặc một phí điều phối cố định. Chọn một cách, không thu cả hai nếu không giải thích được giá trị riêng.

### 8.6 Store revenue share

Định nghĩa bắt buộc:

```text
Gross Customer Payment (GCP)
- thuế gián thu phải nộp
- refund/credit
- payment processing/chargeback thực tế
= Net Marketplace Receipts (NMR)

Creator Payout = NMR × creator share - creator-borne infrastructure
Tomni Marketplace Revenue = NMR × Tomni share
Tomni Marketplace Gross Profit
= Tomni Marketplace Revenue
- review/moderation/support/fraud reserve
- Tomni-borne infrastructure
```

Không bao giờ ghi “creator nhận 85%” mà không nói 85% của GCP hay NMR.

Ba thử nghiệm:

| Cohort              |        Creator/Tomni trên NMR | Điều kiện                                                                      |
| ------------------- | ----------------------------: | ------------------------------------------------------------------------------ |
| Closed creator beta |           100/0 sau phí ngoài | tối đa 6 tháng; creator tự support; mục tiêu học, không phải subsidy vĩnh viễn |
| Public baseline     |                         85/15 | Tomni xử lý discovery, review, entitlement, refund, payout và reputation       |
| High-outcome/BYOC   | 90/10 hoặc flat control-plane | success cao, support/refund thấp, creator chịu infra                           |

Microsoft Marketplace hiện công bố phí dịch vụ chuẩn 3% cho SaaS. Vì vậy take rate 15% của Tomni chỉ hợp lý nếu Tomni tạo thêm giá trị đo được từ sandbox, review, runtime, discovery theo outcome, refund/support và user acquisition. Nếu creator chỉ cần checkout, Tomni không nên giả vờ rẻ hơn Microsoft.

#### Ví dụ minh họa Store

Giả định một giao dịch 100 USD:

- thuế: 8 USD;
- refund dự phòng: 2 USD;
- payment/chargeback: 3 USD;
- `NMR = 87 USD`.

Với tỷ lệ 85/15:

- creator payout trước creator-infra: `87 × 85% = 73,95 USD`;
- Tomni revenue: `13,05 USD`;
- nếu review/support/fraud/infra Tomni là 4 USD, gross profit còn `9,05 USD`.

Với tỷ lệ 90/10, Tomni revenue chỉ 8,70 USD và gross profit còn 4,70 USD. Ví dụ cho thấy phải đo chi phí dịch vụ trước khi hạ take rate; đây không phải forecast thuế hoặc phí thật.

### 8.7 Nexus

Nexus là sàn capability, không phải một Store listing khác. Một package có thể bán một hành động có schema, quyền, SLA, evaluator và receipt.

Quy tắc tiền:

- price quote trước call hoặc có maximum cost;
- creator/provider khai báo compute component;
- Tomni thu **5–15% NMR** như giả thuyết success fee;
- nếu verifier fail do creator capability, Tomni success fee hoàn lại; compute thật có thể vẫn tính theo disclosure;
- micropayment phải batch để payment fee không ăn hết giao dịch;
- reputation gắn version và context, không dùng sao đánh giá làm bằng chứng chính;
- creator không thấy raw input của người dùng ngoài scope đã cấp.

### 8.8 Continuum

Continuum tạo doanh thu từ chức năng thật:

- lịch và webhook chạy khi máy tắt;
- durable job có resume/retry;
- state handoff local ↔ cloud;
- sync mã hóa tùy chọn;
- protected backend endpoint;
- notification và audit;
- deploy trên Tomni managed hoặc BYOC.

Không định vị Continuum là “model cloud mạnh hơn”. Nó là mặt phẳng thực thi bền vững cho package.

### 8.9 Resource Exchange

Resource Exchange cho Orchestrator chọn giữa local device, user BYOC, creator cloud, model provider và Tomni cloud theo cost/latency/privacy/quality.

**Chưa phải sản phẩm năm đầu.** Trước khi thu phí 5–10% coordination giả thuyết, phải có:

- attestation tài nguyên và benchmark chống khai gian;
- isolation, quota, malware/mining prevention;
- escrow/dispute và payout compliance;
- region/data residency;
- đo điện/compute chính xác;
- bảo hiểm fraud/chargeback;
- cấm chạy workload không rõ nguồn gốc trên máy cá nhân.

Nếu chi phí trust/safety cao hơn spread, dừng mô hình peer resource và chỉ giữ router giữa local/BYOC/provider.

### 8.10 Enterprise và dịch vụ

Công thức hợp đồng enterprise:

```text
Annual Contract Value
= tenant platform floor
+ active seat fee
+ private environments/registry
+ managed usage
+ SLA/support/compliance modules
- volume/annual commitment discount
```

Onboarding, migration, audit tùy chỉnh và tích hợp nên là phí dự án riêng; không giấu nhân công lớn trong subscription rồi làm gross margin sai lệch.

## 9. Kinh tế đơn vị

### 9.1 Công thức tối thiểu

```text
Net Revenue = gross billings - tax - refund - discount - pass-through payout
Gross Profit = Net Revenue - variable service cost
Gross Margin = Gross Profit / Net Revenue

Monthly Gross Profit per Paid Account = ARPA × Gross Margin
CAC Payback Months = Blended CAC / Monthly Gross Profit per Paid Account
Simple Gross-Profit LTV = ARPA × Gross Margin / Monthly Churn
LTV:CAC = Simple Gross-Profit LTV / Blended CAC

Gross Profit per Verified Outcome
= (Net Revenue attributed to cohort - variable cost) / verified outcomes
```

`Simple Gross-Profit LTV` chỉ là xấp xỉ steady-state. Quyết định thật dùng retention curve theo cohort, expansion/contraction và giới hạn horizon; không dùng công thức đơn giản để thổi phồng định giá.

### 9.2 Ví dụ Pro giả định

Giả định gói 19 USD/tháng:

| Khoản biến đổi        | BYOK/local | Managed AI credit nhỏ |
| --------------------- | ---------: | --------------------: |
| Payment 4%            |       0,76 |                  0,76 |
| Hạ tầng control plane |       1,50 |                  1,50 |
| Support/fraud reserve |       1,00 |                  1,00 |
| AI do Tomni trả       |       0,00 |                  1,50 |
| Tổng variable cost    |       3,26 |                  4,76 |
| Gross profit          |      15,74 |                 14,24 |
| Gross margin          |      82,8% |                 74,9% |

Nếu AI cost tăng thành 7 USD, gross margin giảm còn khoảng 46%. Vì vậy quota credit phải gắn với tiền thật, overage có chấp thuận và không có unlimited.

### 9.3 Ví dụ CAC/LTV giả định

Với `ARPA = 19 USD`, `gross margin = 75%`, churn tháng `3,5%` và blended CAC `60 USD`:

- monthly gross profit/account = `14,25 USD`;
- payback = `60 / 14,25 ≈ 4,2 tháng`;
- simple LTV = `14,25 / 0,035 ≈ 407 USD`;
- LTV:CAC ≈ `6,8`.

Đây chỉ là phép thử mô hình. Nếu churn thực là 8%, simple LTV còn khoảng 178 USD. Không chạy quảng cáo lớn dựa trên một cohort nhỏ hoặc churn chưa ổn định.

### 9.4 Mốc tài chính để mở rộng

| Chỉ số                    |          Cổng beta |             Cổng commercial | Hành động nếu fail                             |
| ------------------------- | -----------------: | --------------------------: | ---------------------------------------------- |
| Gross margin sau AI/cloud |               ≥60% |         ≥65%, hướng tới 70% | giảm included compute, tăng BYOK/BYOC, sửa giá |
| CAC payback               | chưa chạy paid lớn |    <6 tháng với cá nhân/SMB | dừng kênh quảng cáo không hiệu quả             |
| Trial → paid              |   8–12% giả thuyết | ≥10% hoặc expansion bù được | sửa wedge/onboarding/giá                       |
| Refund                    |                <5% |                         <5% | review chất lượng và promise                   |
| Gross profit/VUO          |              dương |            tăng theo cohort | route rẻ hơn hoặc bỏ use case lỗ               |
| Support cost/account      |        có baseline | giảm hoặc ổn định khi scale | sửa UX/docs trước tuyển thêm                   |

Không hạ cổng để tuyên bố thành công. Có thể đổi phân khúc hoặc mô hình giá khi evidence bác bỏ giả thuyết.

## 10. Ngân sách, giới hạn và chống gian lận

### 10.1 Ngân sách người dùng

Mỗi task từ xa phải có:

- estimate và maximum cost;
- loại chi phí: provider, package, Continuum, Nexus, network/storage;
- soft warning ở 50/80% và hard stop ở 100%;
- quyền “chỉ local”, “hỏi trước mỗi lần”, “cho phép trong ngân sách”;
- timeout, retry budget và số vòng agent tối đa;
- receipt estimate/actual và lý do chênh lệch;
- không tự động tăng hạn mức sau khi fail.

### 10.2 Rate limit

Giới hạn theo tổ hợp account, device, package, publisher, provider và IP-risk; không dựa duy nhất fingerprint xâm phạm riêng tư. Tách:

- interactive foreground;
- background Continuum;
- Store download/update;
- Nexus paid calls;
- trial/sponsored credit;
- security scan và emergency revoke.

Security/revoke không bị chặn bởi quota thương mại. Package không được tạo vòng gọi recursive để vượt budget.

### 10.3 Gian lận Store/Nexus

| Gian lận                      | Kiểm soát                                                                              |
| ----------------------------- | -------------------------------------------------------------------------------------- |
| creator tự mua/tự tạo outcome | receipt runtime ký, related-account graph tối thiểu, payout hold và audit              |
| Sybil download/review         | minimum sample, confidence interval, device/account risk và review chỉ là tín hiệu phụ |
| package báo success giả       | verifier độc lập; package không tự xác nhận                                            |
| refund/chargeback abuse       | risk-based limit, delayed entitlement khi cần, rolling reserve                         |
| đổi hành vi sau review        | immutable artifact/version, hash/signature, network allowlist, re-review               |
| stolen source/asset           | provenance, SBOM, similarity scan, notice/appeal, evidence preservation                |
| rating manipulation đối thủ   | anomaly detection, blind review, creator appeal                                        |
| cloud/resource khai gian      | benchmark challenge, attestation, metering độc lập, settlement delay                   |
| rửa tiền qua package          | KYC/payout threshold, transaction monitoring, region restriction, tư vấn pháp lý       |

Chống gian lận phải dùng dữ liệu tối thiểu và retention rõ; không biến trust & safety thành lý do thu raw source/prompt.

## 11. Tiếp thị và đưa sản phẩm ra thị trường

### 11.1 Năm trụ thông điệp

1. **Từ ý tưởng đến app dùng được:** không dừng ở chat hoặc code snippet.
2. **Cài đúng thứ cần:** Base nhẹ, `com.tomni.ide` lõi, contribution/app tải theo nhu cầu; tự nhóm thành “Studio”.
3. **Mang AI bạn đã có:** local model, API, CLI hoặc Agent Bridge chính thức.
4. **Sản phẩm là của bạn:** dùng riêng, `.tomny`, web/executable/backend riêng khi target hỗ trợ.
5. **An toàn có bằng chứng:** sandbox, permission, scan, receipt, rollback; không hứa tuyệt đối.

Thông điệp ngắn đề xuất:

> Tạo phần mềm theo cách của bạn. Chạy trên máy của bạn. Mang theo AI của bạn. Chỉ cài thứ bạn cần.

### 11.2 Demo bằng chứng bắt buộc

Video/case study “app báo thức” chỉ xuất bản khi quay được một mạch:

1. máy sạch không có IDE package;
2. prompt tạo app;
3. màn hình prerequisite tổng hợp, không hỏi luân phiên gây khó chịu;
4. tải IDE/package artifact từ catalog thật;
5. chọn model/agent và xem dữ liệu sắp gửi;
6. build, hot preview trong sandbox;
7. test pass/fail và receipt;
8. ký `.tomny`;
9. cài như người dùng khác;
10. gỡ package và chứng minh app biến mất nhưng Base vẫn chạy.

Kèm evidence kỹ thuật:

- unpacked installer không chứa code optional package;
- signature/hash và permission diff;
- failure injection không crash Base;
- latency, cost, hardware và provider được công bố;
- nếu một bước thủ công, ghi rõ; không cắt video để giả tự động.

### 11.3 Tuyên bố bị cấm

- “Không thể hack/dịch ngược/đánh cắp”.
- “100% dữ liệu không rời máy” khi remote mode đang bật.
- “Dùng ChatGPT/Manus vô hạn hoặc miễn phí”.
- “Creator chắc chắn kiếm tiền”.
- “AI tự làm app production không cần kiểm tra”.
- “Tốt hơn Microsoft/Claude/Copilot” nếu không có benchmark tái lập cùng điều kiện.
- “Đã tải package thật” khi installer vẫn bundle code đó.

### 11.4 Cộng đồng dùng thử có cấu trúc

Closed Alpha tối đa 100 Meaningful WAU, không tuyển người ngẫu nhiên để làm đẹp số.

| Cohort giả thuyết        | Quy mô mời | Mục tiêu                                    |
| ------------------------ | ---------: | ------------------------------------------- |
| Creator developer        |      15–25 | tạo package bằng SDK và publish private     |
| AI power user            |      25–40 | cài package, Agent Bridge, local/BYOK route |
| Designer/no-code builder |      10–20 | đánh giá luồng tạo app và UI package        |
| Nhóm nhỏ                 |  5–10 nhóm | shared workspace, BYOC, permission/audit    |

Chương trình:

- onboarding 1:1 hoặc nhóm nhỏ theo use case;
- weekly build challenge, nhưng thưởng theo package được người khác dùng, không theo số listing;
- office hour và review roadmap hằng tuần;
- changelog và known limitations công khai;
- kênh report bảo mật riêng, safe-harbor/bug bounty khi có pháp lý;
- telemetry outcome opt-in riêng với crash telemetry tối thiểu;
- creator council có quyền phản hồi ranking, payout và moderation;
- không ép NDA cho feedback thông thường; NDA chỉ cho phần restricted thật sự.

### 11.5 Phễu tăng trưởng

```text
Biết đến
→ cài Base
→ cấu hình local/BYOK/BYO Agent
→ outcome đầu tiên
→ outcome thứ ba trong tuần
→ cài/tạo package thứ hai
→ quay lại tuần 4
→ trả phí
→ chia sẻ package/case study
```

| Bước                           | Chỉ số               |                      Cổng giả thuyết |
| ------------------------------ | -------------------- | -----------------------------------: |
| Landing → download             | qualified conversion | đo baseline, không tối ưu click rỗng |
| Download → boot thành công     | install success      |               ≥95% trước public push |
| Boot → provider/local sẵn sàng | setup completion     |                                 ≥70% |
| Setup → verified outcome đầu   | activation           |            ≥50% trong cohort phù hợp |
| Time-to-first-outcome          | median               |              <30 phút cho demo chuẩn |
| Tuần đầu → tuần 4              | W4 retention         |    ≥40% Closed Alpha; ≥35% khi scale |
| Free/trial → paid              | paid conversion      |                          8–12% pilot |
| Paid → referral                | package/share loop   |     đo tỷ lệ, chưa đặt vanity target |

### 11.6 Kênh ưu tiên

1. Founder-led demo và bài phân tích kỹ thuật bằng tiếng Việt/Anh.
2. GitHub sample package, SDK, conformance và issue tracker.
3. Cộng đồng developer, designer, local-AI và automation có use case thật.
4. Creator chia sẻ package/use case; attribution và install page rõ.
5. Microsoft Store cho distribution Windows khi installer đủ production.
6. Tomni MCP app/Agent Bridge trong ChatGPT hoặc agent platform khi chính thức cho phép.
7. Case study nhóm nhỏ có số liệu outcome/cost, không testimonial chung chung.
8. Paid acquisition chỉ sau W4 retention, gross margin và CAC instrumentation qua cổng.

Không phụ thuộc một Discord/Facebook group; email export, docs, changelog và status page là tài sản owned-channel.

### 11.7 Creator Program

Creator Program theo cấp độ evidence:

| Cấp              | Điều kiện                             | Quyền lợi                                 |
| ---------------- | ------------------------------------- | ----------------------------------------- |
| Development      | publisher cơ bản, package private     | SDK, preview, local install               |
| Reviewed         | identity + automated/human review     | listing curated, analytics aggregate      |
| Verified Outcome | đủ sample/confidence, không incident  | ranking lane, take-rate rebate giả thuyết |
| Enterprise Ready | support/SLA/privacy/security evidence | private catalog, enterprise lead          |

Không bán badge. Certification hết hạn theo package version, runtime và thời gian; version mới không tự thừa hưởng toàn bộ uy tín.

### 11.8 Ngân sách tiếp thị

- 0–100 Meaningful WAU: chủ yếu thời gian founder, docs, community và support.
- Chỉ thử paid nhỏ khi W4 retention ≥35–40%, activation đo được và gross margin ≥60%.
- Mỗi kênh có cohort CAC/payback riêng; dừng nếu payback dự kiến >6 tháng cho cá nhân/SMB sau đủ sample.
- Vốn đầu tư chỉ tăng tốc kênh lặp lại, security audit, payout/compliance và hạ tầng đã có nhu cầu; không dùng vốn che product-market fit.

## 12. Retention và tăng trưởng không khóa người dùng

### 12.1 Cơ chế quay lại

| Nhịp       | Giá trị quay lại                                               |
| ---------- | -------------------------------------------------------------- |
| Hằng ngày  | resume task, app đã tạo, quick command, local agent            |
| Hằng tuần  | automation, package update, verified outcomes, creator release |
| Hằng tháng | cost/outcome report, Work Graph review, quyền/secret audit     |
| Theo nhóm  | shared package, policy, receipt, private registry              |

### 12.2 Quyền rời đi

- export project/source/assets theo quyền;
- export receipt/history ở schema công khai;
- export provider config không gồm plaintext secret;
- uninstall giữ/xóa dữ liệu theo lựa chọn;
- Creator có thể ship web/executable hoặc cloud riêng;
- account deletion xóa cloud projection theo retention policy;
- không làm package hỏng chỉ vì subscription hết: downgrade rõ, export vẫn hoạt động, paid cloud feature dừng an toàn.

### 12.3 Tín hiệu dữ liệu được phép

Chỉ khi opt-in:

- intent category đã giảm chi tiết;
- package/model/runtime version;
- verifier pass/fail;
- latency/cost bucket;
- error class không payload;
- accept/reject/revert;
- permission category;
- ổn định sau update.

Không thu raw prompt, source, screenshot, secret hoặc Private Work Graph làm moat. Enterprise có thể giữ reputation trong tenant riêng.

## 13. Lộ trình 30/90/180/365 ngày

Ngày là khung lập kế hoạch; **gate thắng lịch**. Nếu security/runtime fail thì dừng mở rộng.

### 13.1 Ngày 0–30

Mục tiêu: chốt một sự thật sản phẩm và đo baseline.

- khóa package/contribution contract mới, bỏ Studio Suite vật lý;
- inventory Base/optional/internal và dependency graph;
- chọn vertical slice: Sample Notes kỹ thuật + app báo thức marketing sau khi ổn;
- Store tải artifact thật qua URL, hash/signature/staging;
- threat model, egress gate và permission baseline;
- định nghĩa VUO, receipt, cost fields và dashboard tối thiểu;
- phỏng vấn 15–20 design partners, tuyển cohort đầu;
- landing message A/B nhưng chưa quảng cáo lớn;
- benchmark local/BYOK/provider, không claim adapter chưa active;
- chuẩn bị MSIX/Store distribution checklist.

**Cổng 30 ngày:** architecture contract được test; package optional không cần private API; known gaps công khai; không Critical/P0 bỏ ngỏ cho pilot.

### 13.2 Ngày 31–90

Mục tiêu: chứng minh create/install/run/uninstall end-to-end.

- clean Base boot với package root rỗng/hỏng;
- tải/cài/open/disable/update/rollback/uninstall một app vật lý;
- `com.tomni.ide` core và một contribution optional không static-import nhau;
- development app xuất hiện Home, sandbox/hot preview;
- Agent Bridge proof qua một API chính thức và chiều MCP agent → Tomni;
- receipt + cost estimate/actual + user approval;
- 100 vòng lifecycle pilot không mất data;
- 20–30 tester, weekly interviews;
- pricing interview, không thu tiền nếu entitlement/refund chưa đủ.

**Cổng 90 ngày:** outcome đầu tiên median <30 phút cho demo chuẩn; package crash không làm sập Hub; optional bytes vắng khỏi Base; secret không xuất hiện prompt/log/output.

### 13.3 Ngày 91–180

Mục tiêu: Closed Alpha và creator loop nhỏ.

- tăng dần tới tối đa 100 Meaningful WAU;
- curated Store private/free;
- ít nhất 5 creator ngoài team thử SDK;
- ít nhất 3 community package được người khác dùng;
- Work Graph local v0, opt-in projection;
- creator dashboard aggregate và appeal;
- Continuum private prototype với BYOC hoặc quota chặt;
- external security review phạm vi package/egress;
- Microsoft Store private/flight hoặc listing khi installer đạt chuẩn;
- đo W4 retention, VUO/WAU, cost/VUO và support load.

**Cổng 180 ngày:** W4 ≥40%, goal → verified outcome ≥75% trên use case mục tiêu, median ≥3 VUO/user/tuần, không P0, P1 xử lý trong 72 giờ.

### 13.4 Ngày 181–365

Mục tiêu: Creator Beta có trả phí, không phải scale bằng mọi giá.

- 100–500 Meaningful WAU theo gate;
- free/paid listing, entitlement, payout, refund, report/takedown;
- A/B Pro 12/19 USD và Team 24/29 USD với cohort rõ;
- Store revenue share thử nghiệm và creator council review;
- Outcome Reputation v1 chống gaming;
- Continuum pricing pilot; Nexus chỉ pilot capability schema/evaluator rõ;
- BYOC Team/private registry;
- external audit, incident drill và bug bounty phạm vi nhỏ;
- case study creator/user có evidence;
- chuẩn bị partnership/Marketplace enterprise nếu pipeline thật;
- Resource Exchange chỉ research, không public peer compute.

**Cổng 365 ngày:** 500 Meaningful WAU duy trì 6 tuần, W4 ≥35%, community package tạo ≥20% VUO, ≥20 creator hoạt động tháng, trial-to-paid 8–12%, refund <5%, gross margin ≥60%, audit không còn Critical/High.

## 14. Bảng điều khiển KPI

### 14.1 Chỉ số sao Bắc Đẩu

**Verified Useful Outcomes per Meaningful Weekly Active User — VUO/WAU.**

Một outcome chỉ được tính khi:

- có success criteria;
- verifier pass hoặc user accept có evidence;
- không bị revert trong observation window;
- không vi phạm policy;
- receipt hợp lệ.

### 14.2 KPI theo hệ

| Hệ          | KPI                                                                                        |
| ----------- | ------------------------------------------------------------------------------------------ |
| Sản phẩm    | activation, time-to-first-outcome, VUO/WAU, goal→VUO, first-pass success                   |
| Retention   | W1/W4/W12, cohort survival, outcomes/user/week, package breadth                            |
| Package     | install success, crash-free, rollback success, update failure, time-to-first-success       |
| Creator     | active creator, package có user ngoài tác giả, creator revenue, payout time, concentration |
| Tài chính   | paid conversion, ARPA, MRR, GM, cost/VUO, GP/VUO, CAC, payback, refund                     |
| Trust       | secret exposure mục tiêu 0, permission overreach, revoke latency, incident severity        |
| Privacy     | opt-in rate, projection rejection, delete/export success, raw-data incident mục tiêu 0     |
| Agent/model | route mix local/BYOK/BYOC/managed, latency, fallback, benchmark uplift, catastrophic rate  |
| Community   | qualified referral, resolved feedback, support time, creator/user NPS chỉ là tín hiệu phụ  |

Không dùng account đăng ký, prompt count, token count, listing count hoặc download đơn thuần làm north-star.

## 15. Sổ rủi ro

| Rủi ro                      | Xác suất/ảnh hưởng ban đầu | Chỉ báo sớm                          | Kiểm soát                                                      | Chủ sở hữu chức năng |
| --------------------------- | -------------------------- | ------------------------------------ | -------------------------------------------------------------- | -------------------- |
| Microsoft bundle/copy       | cao/cao                    | feature tương tự vào Windows/Copilot | substrate strategy, portable standard, creator/outcome history | chiến lược/sản phẩm  |
| Store chưa tải thật         | cao/cao                    | Base bundle còn optional code        | artifact absence gate, E2E lifecycle                           | package platform     |
| Sandbox escape/package độc  | trung bình/rất cao         | permission bypass/crash              | isolation, review, revoke, bounty                              | security/runtime     |
| Adapter AI kém              | cao/trung bình             | catastrophic benchmark               | deterministic fallback, no active promotion                    | model runtime        |
| Cloud cost vượt giá         | cao/cao                    | cost/VUO tăng, GM giảm               | BYOK/BYOC, cap, route, pricing                                 | finance/orchestrator |
| Creator không có người dùng | cao/cao                    | listing không VUO                    | curated wedge, distribution, stop marketplace expansion        | growth/store         |
| Fraud outcome/payout        | trung bình/cao             | anomaly, refund, collusion           | signed receipt, hold/reserve, audit/appeal                     | trust & safety       |
| Rò dữ liệu remote           | trung bình/rất cao         | egress không receipt                 | deterministic gate, consent, redaction, incident plan          | security/privacy     |
| Provider khóa API/MCP       | cao/trung bình             | policy/price changes                 | official adapters, multi-provider, local fallback              | Agent Bridge         |
| Lock-in phản tác dụng       | trung bình/cao             | export complaints, churn reason      | export/delete contract, creator ownership                      | product/legal        |
| Bản quyền/AI output         | trung bình/cao             | takedown/dispute                     | provenance, SBOM, license scan, counsel                        | legal/store          |
| Tên Tomni/Tomny lẫn lộn     | cao/trung bình             | domain/docs/package ID khác          | naming decision, trademark search, migration guide             | brand/legal          |
| Resource Exchange abuse     | cao/rất cao                | miner/malware/fake compute           | không launch sớm; attestation/compliance                       | future platform      |
| Đội nhỏ quá tải support     | cao/cao                    | response time/cost tăng              | cohort cap, docs, narrow wedge                                 | operations           |

## 16. Điều kiện dừng hoặc đổi hướng

Dừng/tạm dừng giả thuyết cụ thể khi, sau ít nhất ba vòng cải thiện có đo:

- <30% người phù hợp hoàn thành outcome đầu dù onboarding đã sửa;
- goal → verified outcome vẫn <50% trên wedge đã thu hẹp;
- W4 retention <20% và người dùng không mô tả được giá trị lặp lại;
- creator package chủ yếu chỉ do chính creator dùng;
- variable AI/cloud cost khiến gross margin <50% và BYOK/BYOC/pricing không sửa được;
- public package runtime còn P0/Critical hoặc không rollback được;
- Store ranking không chống được self-report/Sybil;
- Agent Bridge chỉ hoạt động bằng browser automation trái điều khoản;
- Tomni phải thu raw source/prompt để routing mới có ích;
- support thủ công tăng tuyến tính với user và không thể productize;
- Resource Exchange spread không trả nổi trust/safety/compliance.

Dừng một giả thuyết không đồng nghĩa đóng dự án. Có thể giữ IDE/package runtime và đổi wedge; giữ local product và bỏ managed cloud; hoặc giữ router mà bỏ peer resource market.

## 17. Nhịp quản trị

| Nhịp          | Quyết định                                                              |
| ------------- | ----------------------------------------------------------------------- |
| Hằng tuần     | outcome review, incident, creator/user feedback, cost spike             |
| Hai tuần      | sprint product; ship một vertical improvement có test                   |
| Hằng tháng    | cohort retention, unit economics, stage gate, kill list                 |
| Hằng quý      | threat model, provider policy, competitor/source refresh, pricing       |
| Trước release | security gate, artifact absence, rollback drill, legal/Store policy     |
| Sau incident  | blameless review, revoke/notify, control update, public summary phù hợp |

Mỗi review trả lời: outcome gì được tạo, vì sao user quay lại/rời đi, package nào tạo giá trị, cost/risk mỗi outcome, điều gì phải dừng.

## 18. Bảng thuật ngữ

| Thuật ngữ          | Giải thích ngắn                                                               |
| ------------------ | ----------------------------------------------------------------------------- |
| Adapter            | lớp nối Tomni với model, CLI, agent hoặc runtime khác                         |
| Agent Bridge       | cầu nối chính thức hai chiều giữa Tomni và tác nhân ngoài                     |
| ARPA               | doanh thu trung bình trên một tài khoản trả phí                               |
| BYO Agent          | người dùng mang tác nhân/dịch vụ họ đã có và được phép tích hợp               |
| BYOC               | dùng cloud của chính khách hàng; khách trả cloud trực tiếp                    |
| BYOK               | dùng khóa API của chính người dùng                                            |
| CAC                | chi phí thu hút một khách hàng trả phí                                        |
| Capability         | năng lực/hành động có input, output, quyền và schema rõ                       |
| Continuum          | mặt phẳng cloud cho job bền vững, lịch, webhook, sync và handoff              |
| Creator            | người tạo/phát hành app, UI package hoặc Agent Capsule                        |
| Egress             | dữ liệu rời khỏi máy/tenant tới dịch vụ khác                                  |
| Gross margin       | phần trăm doanh thu ròng còn lại sau chi phí biến đổi                         |
| Hào lũy/moat       | lợi thế tích lũy làm đối thủ khó sao chép đồng thời, không phải feature riêng |
| LTV                | tổng lợi nhuận gộp kỳ vọng trong vòng đời khách hàng; phải dùng cohort thật   |
| MCP                | giao thức để AI app kết nối tool/data; không phải API model miễn phí          |
| Meaningful WAU     | người dùng tuần có ít nhất một outcome hợp lệ                                 |
| NMR                | tiền chợ ròng sau thuế, refund và payment/chargeback theo định nghĩa          |
| Nexus              | mạng capability có ký, đo đếm, billing, payout và reputation                  |
| Outcome Receipt    | biên nhận có version, cost, verifier và evidence của kết quả                  |
| Private Work Graph | bộ nhớ/ngữ cảnh công việc thuộc người dùng, ưu tiên local                     |
| Provenance         | chuỗi bằng chứng nguồn gốc source/build/artifact/publisher                    |
| Resource Exchange  | router/sàn tài nguyên local, BYOC, provider và Tomni; giai đoạn tương lai     |
| Retention          | tỷ lệ người dùng quay lại và tiếp tục nhận giá trị                            |
| Sandbox            | vùng cách ly hạn chế quyền, tài nguyên và ảnh hưởng của package               |
| SBOM               | danh sách thành phần/phụ thuộc phần mềm trong artifact                        |
| VUO/WAU            | số kết quả hữu ích đã xác minh trên người dùng tuần có ý nghĩa                |
| W4/W12             | tỷ lệ cohort còn hoạt động có ý nghĩa ở tuần 4/12                             |

## 19. Nguồn và tài liệu liên quan

### 19.1 Nguồn nội bộ

- [Defensible Core — Outcome Intelligence Network](../prds/feature-packs/tomni-defensible-core-design.md)
- [Execution and Commercial Roadmap](../prds/feature-packs/tomni-hub-agent-os-execution-roadmap.md)
- [Package Platform Design](../prds/feature-packs/tomni-package-platform-design.md)
- [Store và Package Runtime MVP](../prds/feature-packs/tomni-package-backend-mvp.md)
- [Agentic Store PRD](../prds/feature-packs/tomni-agentic-store.md)
- [Local Core Model Runtime](../prds/feature-packs/tomni-local-core-model-runtime-design.md)

### 19.2 Nguồn chính thức bên ngoài, chụp bối cảnh 2026-07-26

- [Microsoft FY2026 Q3 Earnings Call](https://www.microsoft.com/en-us/investor/events/fy-2026/earnings-fy-2026-q3)
- [Microsoft Foundry Local trên Windows](https://learn.microsoft.com/en-us/windows/ai/foundry-local/get-started)
- [Microsoft MCP/On-device Agent Registry](https://learn.microsoft.com/en-us/windows/ai/mcp/overview)
- [Microsoft Agent Launchers](https://learn.microsoft.com/en-us/windows/ai/agent-launchers/)
- [Microsoft Copilot Studio — What's new](https://learn.microsoft.com/en-us/microsoft-copilot-studio/whats-new)
- [Microsoft 365 Agent Store](https://learn.microsoft.com/en-us/microsoft-365/copilot/copilot-agent-store)
- [GitHub Copilot supported models](https://docs.github.com/en/copilot/reference/ai-models/supported-models)
- [Microsoft Marketplace SaaS fee example](https://learn.microsoft.com/en-us/partner-center/marketplace-offers/plan-saas-offer)
- [Microsoft Store Win32/Electron distribution](https://learn.microsoft.com/en-us/windows/apps/distribute-through-store/how-to-distribute-your-win32-app-through-microsoft-store)
- [OpenAI Apps SDK](https://developers.openai.com/apps-sdk/)
- [OpenAI Developer mode/MCP apps](https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt)
- [Google Vertex AI Agent Engine](https://cloud.google.com/vertex-ai/generative-ai/docs/reasoning-engine/overview)
- [Anthropic Claude Code business controls](https://www.anthropic.com/news/claude-code-on-team-and-enterprise)
- [Apple Intelligence for developers](https://developer.apple.com/apple-intelligence/)
- [WIPO — Copyright Protection of Computer Software](https://www.wipo.int/en/web/copyright/activities/software)

## 20. Quyết định cuối cùng

Chiến lược cạnh tranh Microsoft của Tomni là **hợp tác ở lớp nền, cạnh tranh ở lớp sở hữu và kết quả**:

```text
Windows/MSIX/Store/MCP/Foundry = substrate và kênh
Tomni Base + package runtime = môi trường an toàn, tùy biến
.tomny + creator ownership = nguồn cung và quyền di động
Outcome Receipt + Reputation = chất lượng và routing
Private Work Graph = cá nhân hóa do người dùng sở hữu
Continuum/Nexus = chức năng cloud và kinh tế mạng
```

Tomni không có quyền tự nhận hào lũy trước khi các vòng lặp creator/outcome/trust thật sự hoạt động. Trong 365 ngày đầu, mục tiêu không phải “đánh bại Microsoft”; mục tiêu là sở hữu một ngách có retention, unit economics và trust đủ mạnh để Microsoft không thể xóa Tomni chỉ bằng việc thêm một nút tương tự.
