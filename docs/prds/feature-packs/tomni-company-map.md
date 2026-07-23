# Tomni Company Map — Live Multi-Agent Organization

> Trạng thái: Đã chốt định hướng UX nền tảng  
> Ngày cập nhật: 2026-07-21  
> Phạm vi: Company Hub, Company Map, quan sát hoạt động agent, message visualization và character system

## 1. Mục tiêu

Company không được thể hiện như một dashboard khô hoặc một cây tổ chức chỉ gồm card và đường nối.

Company phải là một **bản đồ tổ chức sống**, cho phép người dùng nhìn vào và hiểu ngay:

- hiện có những Company nào;
- Company nào đang chạy, tạm dừng, chờ duyệt hoặc gặp lỗi;
- ai là Chủ tịch hoặc Company Lead;
- Company có những phòng ban nào;
- mỗi phòng ban có những nhóm nào;
- agent và subagent đang thuộc nhóm nào;
- mỗi agent đang làm gì;
- agent nào đang giao tiếp với agent nào;
- message đang được truyền theo hướng nào;
- công việc nào đang chờ duyệt, bị lỗi hoặc đã hoàn thành.

Trải nghiệm tham chiếu là một **game quản lý công ty pixel-art nhìn từ trên xuống**, nhưng toàn bộ nhân vật, chuyển động, dây nối, lá thư và trạng thái phải phản ánh dữ liệu runtime thật.

## 2. Quyết định mô hình tổ chức

### 2.1 Chỉ còn Company ở cấp điều hướng

Không đặt `Company` và `Team` thành hai thực thể ngang cấp.

```text
Company
├─ Chủ tịch / Company Lead
├─ Phòng ban
│  ├─ Nhóm
│  │  ├─ Agent
│  │  ├─ Agent
│  │  └─ Subagent
│  └─ Nhóm khác
└─ Phòng ban khác
```

Quy ước:

- **Company** là tổ chức cấp cao nhất.
- **Phòng ban** là một nhánh chuyên môn lớn của Company.
- **Nhóm** là đơn vị nhỏ hơn bên trong phòng ban.
- **Agent** là thành viên có vị trí và danh tính ổn định.
- **Subagent** là agent được tạo hoặc quản lý bên dưới một agent/nhóm để xử lý phần việc cụ thể.
- `Team` có thể tiếp tục tồn tại trong schema hoặc runtime cũ, nhưng không còn là điều hướng top-level trong UI.

### 2.2 Ánh xạ với kiến trúc hiện tại

Repo hiện có role tree:

```text
President
└─ Division Head
   └─ Worker
```

Trong UX Company Map, ánh xạ mặc định:

```text
President       → Chủ tịch / Company Lead
Division Head   → Trưởng phòng ban hoặc trưởng nhóm
Worker          → Agent / Subagent
```

Role tree có thể sâu hơn ba tầng. Giao diện không được giả định cấu trúc luôn cố định.

Runtime Team Mode hiện tại có thể vẫn flatten các role thành Leader và Teammate. Company Map phải dùng cấu trúc role tree và metadata Company để hiển thị đúng phân tầng, không dùng độ phẳng của transport làm cấu trúc UX.

### 2.3 Company nhỏ

Company nhỏ không cần ép người dùng tạo nhiều phòng ban.

```text
Company nhỏ
├─ Chủ tịch
└─ Nhóm mặc định
   ├─ Agent
   └─ Agent
```

Dữ liệu bên dưới vẫn là Company. UI có thể cho phép `Tạo nhanh`, nhưng không tạo một hệ thống Team độc lập song song.

## 3. Điều hướng Company

Trang Company có ba tab cấp cao:

```text
Tạo mới
Công ty của tôi
Hoạt động
```

### Tạo mới

- tạo Company từ mô tả mục tiêu;
- tạo nhanh Company đơn giản;
- thiết kế Company nhiều phòng ban;
- xem trước cấu trúc trước khi khởi chạy;
- chỉnh agent, model, capability, quyền, workspace và policy.

### Công ty của tôi

- hiển thị toàn cảnh các Company dạng bản đồ;
- phân biệt Company đang chạy, tạm dừng, chờ duyệt, hoàn thành hoặc lỗi;
- click một Company để zoom vào cấu trúc bên trong;
- mở lại Company đã dừng hoặc tiếp tục phiên đang chạy.

### Hoạt động

- quan sát hoạt động của nhiều Company cùng lúc;
- lọc theo Company, phòng ban, nhóm, agent, message, tool, duyệt hoặc lỗi;
- xem timeline chính xác thay cho chỉ dựa vào animation.

## 4. Company Map là giao diện trung tâm

### 4.1 Vị trí trong shell Tomni

Company Map nằm trong content chính, bên dưới header và giữa hai panel dùng chung của Hub.

```text
Header
├─ Panel trái
├─ Company Map
└─ Panel trạng thái phải
```

Hai panel trái và phải dùng cơ chế ghim/tự ẩn:

- ghim: chiếm không gian layout;
- bỏ ghim: tự ẩn và mở dạng overlay khi chuột tới mép;
- khi cả hai panel được ẩn, Company Map mở rộng gần toàn màn hình;
- bản đồ không bị reset vị trí hoặc zoom khi panel mở/đóng;
- Company lớn phải xem được bằng kéo, cuộn và zoom.

### 4.2 Cảm giác giống bản đồ

Company Map vận hành giống Google Maps ở cấp tương tác:

- kéo canvas để di chuyển;
- cuộn để zoom;
- click một Company để camera zoom mượt vào Company đó;
- click agent trong danh sách hoặc kết quả tìm kiếm để camera bay tới đúng vị trí;
- nút quay lại để trở về toàn cảnh;
- có minimap khi Company lớn;
- giữ vị trí ổn định giữa các lần mở trong cùng phiên.

Không yêu cầu click phòng ban rồi mới thấy nhóm.

Khi đã click vào Company:

- toàn bộ phòng ban được bố trí trên cùng một bản đồ;
- các nhóm nằm trực tiếp bên trong phòng ban;
- người dùng kéo và cuộn để quan sát dần;
- chi tiết tăng dần theo mức zoom.

## 5. Các mức zoom và Level of Detail

### Zoom 0 — Toàn cảnh hệ sinh thái

Hiển thị:

- các Company;
- tên Company;
- trạng thái;
- số phòng ban;
- số nhóm;
- số agent;
- cảnh báo quan trọng.

Không hiển thị từng agent.

### Zoom 1 — Toàn bộ Company

Sau khi chọn Company, hiển thị ngay:

- khu Chủ tịch;
- tất cả phòng ban;
- các nhóm bên trong phòng ban;
- số agent trong từng nhóm;
- trạng thái tổng quát của từng khu.

Người dùng không cần click phòng ban để thấy tên các nhóm.

### Zoom 2 — Nhóm và agent

Hiển thị:

- avatar từng agent;
- bàn làm việc hoặc vị trí agent;
- chấm trạng thái;
- nhãn task ngắn;
- dây message đang hoạt động.

### Zoom 3 — Hoạt động chi tiết

Hiển thị:

- tool đang dùng;
- màn hình làm việc;
- task và tiến độ;
- bong bóng message;
- lá thư đang truyền;
- yêu cầu duyệt;
- lỗi hoặc kết quả vừa hoàn thành.

### Zoom 4 — Kiểm tra agent

Hiển thị chi tiết đầy đủ khi focus một agent:

- tên;
- vai trò;
- phòng ban và nhóm;
- model;
- task;
- tiến độ;
- tool/capability;
- quyền đang dùng;
- activity gần nhất;
- message đến và đi.

## 6. Quy tắc bố trí bản đồ

Bố trí phải trực quan, có logic và ổn định; không random lại mỗi lần mở.

### 6.1 Thứ tự không gian

```text
Chủ tịch / Company Lead
        ↓
Phòng ban
        ↓
Nhóm
        ↓
Agent / Subagent
```

Gợi ý bố trí mặc định:

- khu Chủ tịch ở trên hoặc trung tâm;
- các phòng ban phân bố xung quanh theo trục rõ ràng;
- nhóm nằm bên trong ranh giới phòng ban;
- agent ngồi hoặc đứng trong khu của nhóm;
- khu Output, Meeting, Approval hoặc Shared Services có thể nằm ở vùng dùng chung.

### 6.2 Layout ổn định

Vị trí được sinh bằng seed ổn định:

```text
companyId + structureVersion → map layout
```

Khi không thay đổi cấu trúc, vị trí không đổi.

Khi thêm agent:

- ưu tiên vị trí trống trong nhóm;
- không đảo toàn bộ layout;
- chỉ mở rộng khu nhóm hoặc phòng ban cần thiết.

Khi thêm nhóm hoặc phòng ban:

- tái bố trí tối thiểu;
- animation chuyển vị trí phải ngắn và dễ theo dõi;
- giữ camera của người dùng ở vị trí hiện tại.

### 6.3 Company lớn

Company lớn có thể dùng nhiều khu hoặc chi nhánh:

```text
Company
├─ Headquarters
│  ├─ Product Department
│  ├─ Development Department
│  └─ Operations Department
├─ Security Branch
└─ Research Branch
```

Branch là một vùng bản đồ hoặc tầng/cơ sở khác, nhưng vẫn thuộc cùng Company.

Có bộ chọn:

```text
[Headquarters ▼] [Khu / tầng ▼]
```

## 7. Mock UI — Toàn cảnh Company

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ◈ TOMNI                    🔍 Tìm app, workspace, company, agent...                              🔔 4        │
├──────────────────────┬─────────────────────────────────────────────────────────────┬─────────────────────────┤
│                  📌  │ Company                                                     │ Trạng thái          📌 │
│ ◉ Home               │                                                             │                         │
│ ◎ Quản lý            │ Tạo mới        Công ty của tôi        Hoạt động             │ ┌─────────────────────┐ │
│ ◫ Runs               │                ─────────────                                │ │ Công việc          │ │
│ ◈ Sản phẩm           │                                                             │ │ 5 đang thực hiện   │ │
│ ◷ Lịch sử            │ ┌─────────────────────────────────────────────────────────┐ │ │ 2 chờ duyệt · 68% →│ │
│ ◇ Company            │ │ 🔍 Tìm Company, phòng ban, nhóm hoặc agent...          │ │ └─────────────────────┘ │
│ ⚙ Cài đặt            │ └─────────────────────────────────────────────────────────┘ │                         │
│                      │                                                             │ ┌─────────────────────┐ │
│ COMPANY            ＋ │  ┌───────────────────────────────────────────────────────┐  │ │ Thông báo          │ │
│ ▾ Aion Company       │  │                    COMPANY MAP                        │  │ │ 4 chưa đọc         │ │
│   Tomni Labs         │  │                                                       │  │ │ Company · Chat    →│ │
│   Security Company   │  │   ┌────────────────┐       ┌────────────────┐         │  │ └─────────────────────┘ │
│                      │  │   │ Tomni Labs     │       │ Security Co.   │         │  │                         │
│ WORKSPACES         ＋ │  │   │ ● Running     │       │ ◐ Waiting      │         │  │ ┌─────────────────────┐ │
│ ▾ AionUi             │  │   │ 4 phòng ban   │       │ 2 phòng ban   │         │  │ │ Models             │ │
│   AI Security        │  │   │ 18 agent      │       │ 7 agent       │         │  │ │ ● OpenAI           │ │
│   Tomni Design       │  │   └────────────────┘       └────────────────┘         │  │ │ ● Anthropic        │ │
│                      │  │                                                       │  │ │ 7 model khả dụng → │ │
│ APPS               ＋ │  │           ┌────────────────┐                          │  │ └─────────────────────┘ │
│ ◇ Chat               │  │           │ Content Studio │                          │  │                         │
│ ◇ IDE                │  │           │ ○ Paused       │                          │  │ ┌─────────────────────┐ │
│ ◇ Browser            │  │           │ 6 agent        │                          │  │ │ Hệ thống          │ │
│ ◇ Studio             │  │           └────────────────┘                          │  │ │ CPU 34% · RAM 58% │ │
│ ◇ Automation         │  │                                                       │  │ │ Core ổn định     →│ │
│                      │  │  [−] [＋] [Về toàn cảnh]                         ◫ Map │  │ └─────────────────────┘ │
│ ◆ Store              │  └───────────────────────────────────────────────────────┘  │                         │
│ ┌──────────────────┐ │                                                             │                         │
│ │ TD Thuận Nguyễn  │ │                                                             │                         │
│ │    Duy · Plus  ⋯ │ │                                                             │                         │
│ └──────────────────┘ │                                                             │                         │
└──────────────────────┴─────────────────────────────────────────────────────────────┴─────────────────────────┘
```

## 8. Mock UI — Bên trong một Company

Khi click `Tomni Labs`, camera zoom vào cùng canvas:

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ← Company Map   TOMNI LABS     ● RUNNING     4 phòng ban · 8 nhóm · 18 agent      [Tạm dừng] [⋯]          │
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                              │
│                          ┌────────────────────────────────────┐                                              │
│                          │ CHỦ TỊCH / COMPANY LEAD            │                                              │
│                          │                                    │                                              │
│                          │        👤 Atlas · President        │                                              │
│                          │        Tổng tiến độ 68%            │                                              │
│                          └────────────────────────────────────┘                                              │
│                                           │                                                                  │
│             ┌─────────────────────────────┼──────────────────────────────┐                                   │
│             │                             │                              │                                   │
│ ┌──────────────────────────────┐ ┌──────────────────────────────┐ ┌──────────────────────────────┐          │
│ │ PRODUCT DEPARTMENT           │ │ DEVELOPMENT DEPARTMENT       │ │ QUALITY DEPARTMENT           │          │
│ │                              │ │                              │ │                              │          │
│ │ ┌────────────┐ ┌───────────┐ │ │ ┌────────────┐ ┌───────────┐ │ │ ┌────────────┐ ┌───────────┐ │          │
│ │ │ Research   │ │ UX        │ │ │ │ Frontend   │ │ Backend   │ │ │ │ Testing    │ │ Security  │ │          │
│ │ │ 👤 👤       │ │ 👤 👤      │ │ │ │ 👤💻 👤💻    │ │ 👤💻 👤💻   │ │ │ │ 👤🧪 👤🧪    │ │ 👤🔒       │ │          │
│ │ │ 2 agent    │ │ 2 agent   │ │ │ │ 3 agent    │ │ 3 agent   │ │ │ │ Build 36%  │ │ Scanning  │ │          │
│ │ └────────────┘ └───────────┘ │ │ └────────────┘ └───────────┘ │ │ └────────────┘ └───────────┘ │          │
│ └──────────────────────────────┘ └──────────────────────────────┘ └──────────────────────────────┘          │
│                                                                                                              │
│  Agent A ─────────────── ✉ ───────────────► Agent B          [−] [＋] [Fit] [Minimap]                       │
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Gửi tới: [Toàn Company ▼]   Nhắn cho Company, phòng ban, nhóm hoặc agent...                         [Gửi ➜] │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

Các nhóm luôn được hiển thị bên trong phòng ban khi Company đã được chọn. Zoom chỉ thay đổi lượng chi tiết, không ẩn toàn bộ nhóm sau một bước click phụ.

## 9. Message visualization

### 9.1 Nguồn sự kiện

Animation giao tiếp phải phát sinh từ message runtime thật, chủ yếu từ luồng `sendMessage`, mailbox hoặc event tương đương của Company/Team runtime.

Không tạo message giả để làm văn phòng trông bận rộn.

### 9.2 Dây nối và lá thư

Mỗi message đang truyền được thể hiện bằng:

- một dây nối giữa sender và receiver;
- màu dây theo loại message;
- mũi tên chỉ hướng;
- một biểu tượng lá thư di chuyển trên dây;
- hiệu ứng nhận message tại agent đích;
- dây mờ dần khi event kết thúc.

```text
Agent A ─────── ✉ ───────► Agent B
Agent A ◄────── ✉ ──────── Agent B
```

### 9.3 Màu message

```text
Xanh dương  → message thông thường
Tím         → giao việc hoặc delegation
Xanh lá     → kết quả hoặc hoàn thành
Vàng        → yêu cầu duyệt / cần phản hồi
Đỏ          → lỗi hoặc cảnh báo
Xám         → message hệ thống
```

Màu không phải dấu hiệu duy nhất. Mỗi loại cần thêm icon hoặc kiểu đường để hỗ trợ accessibility.

### 9.4 Message giữa nhiều tầng

Message có thể đi giữa:

- Chủ tịch và trưởng phòng ban;
- phòng ban với phòng ban;
- nhóm với nhóm;
- agent với agent;
- agent với subagent;
- người dùng với toàn Company;
- người dùng với một phòng ban, nhóm hoặc agent.

Khi sender/receiver đang ở mức zoom chưa hiển thị agent:

- dây nối vào container nhóm hoặc phòng ban;
- số message đang truyền hiển thị dạng badge;
- zoom gần hơn sẽ tách thành từng agent cụ thể.

### 9.5 Click message

Click lá thư hoặc dây nối mở inspector:

- sender;
- receiver;
- thời điểm;
- loại message;
- nội dung tóm tắt;
- task liên quan;
- attachment hoặc artifact liên quan;
- trạng thái gửi/nhận/xử lý;
- correlation id khi có.

Không hiển thị private chain-of-thought. Chỉ hiển thị dữ liệu message, tóm tắt và metadata được phép quan sát.

## 10. Trạng thái agent

Mỗi trạng thái phải thể hiện bằng ba tín hiệu:

```text
Màu + biểu tượng + chuyển động
```

| Trạng thái | Hiển thị |
|---|---|
| Đang làm việc | chấm xanh, icon task/tool, animation làm việc tại bàn |
| Đang giao tiếp | bong bóng message hoặc quay về hướng luồng message |
| Đang dùng tool | icon Browser, IDE, Terminal hoặc capability cạnh agent |
| Đang chờ | chấm vàng, animation chờ nhẹ |
| Chờ duyệt | cảnh báo vàng nổi bật tại agent và nhóm |
| Tạm dừng | chấm xám, ngừng animation công việc |
| Lỗi | cảnh báo đỏ, màn hình lỗi hoặc rung nhẹ một lần |
| Hoàn thành | dấu kiểm, artifact chuyển tới Output Area |
| Offline/đã kết thúc | avatar giảm độ sáng, không còn animation runtime |

Animation chỉ phản ánh event thật.

## 11. Character và avatar system

### 11.1 Character Library

Tomni có một thư viện khoảng 100 nhân vật pixel-art, được bổ sung dần theo phiên bản.

Mỗi character là một bộ asset hoàn chỉnh:

```text
characterId
portrait
sprite sheet
idle animation
working animation
walking animation
talking animation
waiting animation
approval animation
error animation
outfit
accessories
```

### 11.2 Gán avatar ngẫu nhiên nhưng ổn định

Khi agent được tạo:

- hệ thống chọn ngẫu nhiên một character;
- ưu tiên character chưa được dùng trong Company đó;
- lưu kết quả cố định;
- không đổi khi mở lại app;
- không đổi khi agent chuyển nhóm hoặc phòng ban;
- người dùng được khóa, đổi hoặc random lại thủ công.

Seed ổn định:

```text
companyId + agentId → characterId
```

Không suy luận vai trò, giới tính hoặc năng lực dựa trên ngoại hình.

### 11.3 Nhân vật do người dùng thêm

Người dùng có thể thêm nhân vật từ ảnh.

Hai chế độ:

#### Chỉ dùng portrait

- ảnh xuất hiện trong roster và inspector;
- nhân vật trên bản đồ vẫn dùng sprite pixel chuẩn;
- nhanh, ít sai lệch và không cần sinh animation.

#### Tạo character pixel

Quy trình:

```text
Tải ảnh
→ chọn vùng khuôn mặt
→ xóa nền
→ chuyển sang phong cách pixel của Tomni
→ chọn tóc, trang phục, phụ kiện
→ sinh sprite animation chuẩn
→ xem trước
→ xác nhận
→ lưu vào “Nhân vật của tôi”
```

Người dùng phải xem trước các trạng thái Idle, Walk, Work, Talk, Wait và Error trước khi lưu.

### 11.4 Quyền riêng tư

- ảnh người dùng thêm mặc định là private;
- không đưa lên Store hoặc chia sẻ công khai khi chưa xác nhận;
- có thể áp dụng cho một Company hoặc toàn tài khoản;
- xóa character không xóa agent;
- agent quay về character mặc định khi character cá nhân bị xóa;
- ưu tiên xử lý local khi kiến trúc cho phép.

## 12. Tạo Company

Có hai luồng:

```text
Tạo nhanh
→ mô tả mục tiêu, tạo Company nhỏ với Chủ tịch và một nhóm mặc định.

Thiết kế Company
→ cấu hình phòng ban, nhóm, role, agent, model, capability và policy.
```

Mock UI:

```text
┌───────────────────────────────────────────────────────────────────────────────┐
│ Tạo Company                                                                  │
│                                                                               │
│ [Tạo nhanh]   [Thiết kế Company]                                             │
│                                                                               │
│ Tên Company                                                                  │
│ ┌───────────────────────────────────────────────────────────────────────────┐ │
│ │ Tomni Product Company                                                    │ │
│ └───────────────────────────────────────────────────────────────────────────┘ │
│                                                                               │
│ Company này cần hoàn thành điều gì?                                           │
│ ┌───────────────────────────────────────────────────────────────────────────┐ │
│ │ Xây dựng, kiểm thử và phát hành phiên bản mới của Tomni.                 │ │
│ └───────────────────────────────────────────────────────────────────────────┘ │
│                                                                               │
│ Cấu trúc đề xuất                                                              │
│ ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐              │
│ │ Product          │ │ Development      │ │ Quality          │              │
│ │ 2 nhóm · 4 agent │ │ 2 nhóm · 6 agent│ │ 2 nhóm · 4 agent │              │
│ │      [Chỉnh sửa] │ │      [Chỉnh sửa] │ │      [Chỉnh sửa] │              │
│ └──────────────────┘ └──────────────────┘ └──────────────────┘              │
│                                                                               │
│ Chủ tịch: Atlas      Workspace: AionUi      Chế độ: Có giám sát             │
│                                                                               │
│                                        [Lưu bản nháp] [Tạo và khởi chạy]    │
└───────────────────────────────────────────────────────────────────────────────┘
```

Trước khi chạy phải hiển thị rõ:

- cấu trúc;
- agent và role;
- model;
- capability;
- quyền;
- workspace;
- giới hạn tài nguyên;
- policy duyệt;
- ngân sách hoặc quota khi có.

## 13. Tab Hoạt động

Tab Hoạt động dùng để kiểm tra nhiều Company hoặc toàn runtime bằng dữ liệu chính xác.

```text
Hoạt động

● 3 Company đang chạy   28 agent hoạt động   4 chờ duyệt   7 trong queue

┌──────────────────────────────────────────────────────────────────────────────┐
│ Thời gian  Company        Phòng ban      Nhóm         Hoạt động             │
├──────────────────────────────────────────────────────────────────────────────┤
│ 14:32      Tomni Labs     Development    Frontend     Gửi bản review         │
│ 14:31      Security Co.   Analysis       Scan         Phát hiện URL nguy hiểm│
│ 14:29      Tomni Labs     Quality        Testing      Build #128 bắt đầu     │
│ 14:25      Content Studio Writing        Editorial    Hoàn thành bài viết    │
└──────────────────────────────────────────────────────────────────────────────┘
```

Bộ lọc:

```text
Company · Phòng ban · Nhóm · Agent · Message · Tool · Duyệt · Lỗi
```

## 14. Agent inspector

Click agent:

- camera focus đúng vị trí;
- agent có viền sáng;
- bảng chi tiết trượt từ cạnh phải;
- không thay thế panel trạng thái toàn cục nếu panel đó đang ghim;
- inspector có thể đóng bằng `Esc`.

```text
┌──────────────────────── Frontend Agent ────────────────────────┐
│ ● Đang làm việc                                                │
│                                                                │
│ Vai trò        Frontend Developer                              │
│ Phòng ban      Development                                    │
│ Nhóm           Frontend                                       │
│ Model          GPT-5.6                                        │
│ Công việc      Cải tổ GuidPage                                 │
│ Tiến độ        68%                                             │
│                                                                │
│ Hoạt động gần nhất                                             │
│ • Đọc GuidPage.tsx                                             │
│ • Chỉnh sửa HomeComposer.tsx                                   │
│ • Gửi yêu cầu review                                           │
│                                                                │
│ [Nhắn tin] [Xem công việc] [Tạm dừng] [Mở phiên làm việc]     │
└────────────────────────────────────────────────────────────────┘
```

Double-click agent có thể mở phiên làm việc thật như IDE, Browser, task hoặc conversation tương ứng.

## 15. Search và điều hướng nhanh

Company Page Search tìm trong phạm vi Company:

```text
Tìm Company, phòng ban, nhóm hoặc agent...
```

Kết quả:

- click Company → zoom vào Company;
- click phòng ban → focus phòng ban;
- click nhóm → focus nhóm;
- click agent → focus agent và mở inspector;
- click message/task → focus nguồn liên quan.

Global Search vẫn có thể tìm Company và dẫn tới đúng vị trí trên map.

## 16. Hành vi khi panel trái/phải ẩn

- Company Map phải tận dụng toàn bộ vùng trống mới.
- Camera giữ nguyên tâm nội dung đang xem.
- Zoom không tự thay đổi đột ngột.
- Vùng kích hoạt panel ở mép màn hình không được chặn thao tác kéo map.
- Khi đang kéo map sát mép, panel chỉ mở sau delay đủ dài để tránh kích hoạt nhầm.
- Có nút `Focus Mode` để ẩn cả hai panel và header phụ, chỉ giữ map controls tối thiểu.

## 17. Accessibility và giảm chuyển động

Có ba mức:

```text
Đầy đủ
Giảm chuyển động
Tắt hoạt họa
```

Khi giảm hoặc tắt hoạt họa:

- message vẫn hiển thị bằng dây, icon và timestamp;
- lá thư có thể nhảy theo bước thay vì chạy liên tục;
- trạng thái không phụ thuộc vào chuyển động;
- mọi thông tin quan trọng vẫn có trong inspector và timeline.

Hỗ trợ:

- keyboard navigation;
- focus visible;
- tooltip;
- nhãn text;
- màu có độ tương phản phù hợp;
- không dùng màu làm tín hiệu duy nhất.

## 18. Hiệu năng

Company Map phải hỗ trợ Company lớn mà không render toàn bộ chi tiết mọi lúc.

Yêu cầu:

- Level of Detail theo zoom;
- culling phần tử ngoài viewport;
- chỉ chạy animation cho event đang nhìn thấy hoặc event quan trọng;
- gom dây message khi mật độ cao;
- giới hạn số animation đồng thời;
- giảm tần suất cập nhật trạng thái không quan trọng;
- không để animation ảnh hưởng runtime agent;
- map renderer và agent runtime phải tách biệt.

Khi có quá nhiều message:

- gom theo cặp phòng ban/nhóm;
- badge số lượng;
- ưu tiên duyệt, lỗi và message trực tiếp;
- cho phép lọc message theo loại.

## 19. Dữ liệu cần cho Company Map

Tối thiểu:

```text
Company
- id
- name
- status
- structureVersion
- rootRoleId
- branches[]
- departments[]
- groups[]
- agents[]
- rules[]
- workspaceRefs[]

Agent
- id
- parentId
- role
- displayName
- departmentId
- groupId
- characterId
- status
- currentTaskId
- currentTool
- progress
- model
- lastActivityAt

MessageEvent
- id
- companyId
- senderId
- receiverId
- type
- summary
- taskId
- status
- createdAt
- receivedAt
- correlationId
```

Dữ liệu map layout nên lưu riêng với cấu trúc runtime để có thể thay đổi cách bố trí mà không làm thay đổi orchestration.

## 20. Đồng bộ với runtime hiện tại

- `President` là root của Company.
- `RoleNode.children` cung cấp cây phân cấp.
- `division` hiện tại là nguồn ban đầu cho phòng ban.
- `sendMessage` hoặc mailbox event là nguồn cho animation lá thư.
- agent status event là nguồn cho animation làm việc, chờ, lỗi và hoàn thành.
- Company Map không được tự phát sinh trạng thái mà runtime không xác nhận.
- UI có thể tối ưu hoặc nhóm dữ liệu, nhưng không được thay đổi ý nghĩa runtime.

## 21. Quy tắc UX đã chốt

- Company là top-level duy nhất; Team là nhánh nội bộ.
- Khi chọn Company, nhìn thấy phòng ban và nhóm trên cùng canvas.
- Không bắt click phòng ban mới thấy nhóm.
- Zoom điều khiển lượng chi tiết, không thay thế cấu trúc.
- Map hỗ trợ kéo và cuộn như bản đồ.
- Company Map nằm giữa hai panel ghim/tự ẩn của Hub.
- Khi tắt hai panel, map dùng gần toàn màn hình.
- Dây nối và lá thư đại diện cho `sendMessage` thật.
- Animation không được giả lập hoạt động.
- Avatar là danh tính ổn định của agent.
- Character mặc định được random ổn định và ưu tiên không trùng trong cùng Company.
- Người dùng có thể thêm character từ ảnh.
- Timeline và inspector luôn tồn tại để kiểm tra dữ liệu chính xác.
- Office pixel-art là giao diện chính; bảng/cây chỉ là lớp kiểm soát bổ sung.

## 22. Tài liệu liên quan

```text
docs/prds/feature-packs/tomni-home-hub.md
docs/prds/feature-packs/tomni-hub-pages.md
docs/prds/feature-packs/tomni-agentic-store.md
packages/desktop/src/process/company/companyOrchestrator.ts
packages/desktop/src/renderer/pages/company/CompanyPage.tsx
```
