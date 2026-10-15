# Cấu trúc gói chuẩn: lớp vỏ `adapter/` + `source/` và plugin của Hub

**Trạng thái:** `PROPOSAL` (chốt hướng với người dùng ngày 2026-10-08, chưa cài đặt)  
**Chủ đề:** Mọi gói tạo từ repo hoặc website dùng một cấu trúc duy nhất. Repo được giữ nguyên trong `source/`, còn `adapter/` khai báo cách nối vào Tomny. Phần Hub chưa biết làm (chạy một loại mã, vẽ một loại giao diện) được bổ sung bằng plugin.  
**Tài liệu liên quan:** [Package taxonomy](package-taxonomy.md), [Packages](packages.md)

**Thiết kế tiếp theo:** bao phủ mọi loại repo, host kết nối, mức tin cậy `local-built`, hook, extension và các bề mặt giao diện nằm ở [repotopackage-design.md](repotopackage-design.md). Chỗ nào khác nhau thì tài liệu đó thắng.

---

## 1. Vấn đề

`/repotopackage` hiện coi một repo là đúng một loại (archetype) rồi bỏ phần còn lại. Repo như `upstash/context7` là cả nền tảng (MCP server, CLI `ctx7`, skill, SDK, plugin) nên chỉ còn một công thức `npx` gắn vào MCP. Không có skill dẫn dắt agent, không có CLI, không có gợi ý API key.

Ngoài ra, nhiều repo (app Python, app native) không có cách hiển thị trong Hub, vì Hub chỉ có hai runtime cố định (`sandboxed-web`, `trusted-react`).

## 2. Nguyên lý

1. Cái gì đóng gói được thì đóng gói lại, nguyên vẹn.
2. Cái không đóng gói thẳng được thì có **một chuẩn kết nối**: agent (hoặc người dùng) viết lớp keo nối vào chuẩn đó, Hub hiển thị và điều khiển.
3. Phần Hub chưa có khả năng thực hiện được bổ sung bằng **plugin** (mục 5), không nhồi vào gói.
4. Mọi thứ do agent sinh ra là mã chưa tin cậy: mặc định tắt, người dùng xem rồi mới bật.

## 3. Cấu trúc gói

```text
<id>-<version>.tomny
├─ tomny-package.json     manifest và chữ ký; chữ ký phủ cả adapter/ lẫn source/
├─ adapter/
│  ├─ adapter.json        danh sách kết nối (mục 4)
│  └─ …                   tệp phụ mà adapter.json tham chiếu (mô tả giao diện, bridge, biểu tượng)
└─ source/                nguyên cấu trúc repo, không sửa; vắng khi nguồn là một URL
```

Quy tắc:

- `source/` là dữ liệu bất động. Chỉ những gì `adapter.json` trỏ tới mới được dùng.
- Mọi gói đều theo cấu trúc này, kể cả gói MCP và gói skill hiện có (mục 8).
- Một repo có thể khai báo nhiều kết nối cùng lúc.
- Không đặt trần kích thước cho `source/`. Bộ lọc an toàn vẫn áp dụng: tệp bí mật, symlink, đường dẫn không an toàn, `.git`.

## 4. `adapter/adapter.json`

Một tệp duy nhất: dễ kiểm tra, dễ ký, dễ so sánh diff, và mở rộng bằng cách thêm loại kết nối.

```jsonc
{
  "schemaVersion": 1,
  "generatedBy": "classifier | agent | user",
  "connections": [
    {
      "kind": "mcp",
      "id": "context7",
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp"],
      "env": [{ "name": "CONTEXT7_API_KEY", "required": false, "hint": "context7.com/dashboard" }],
    },
    { "kind": "skill", "path": "source/skills/find-docs" },
    { "kind": "cli", "id": "ctx7", "command": "npx", "args": ["-y", "ctx7"], "display": "terminal" },
  ],
}
```

| `kind`      | Ý nghĩa                            | Hiển thị / cách dùng                                                          | Cần plugin              |
| ----------- | ---------------------------------- | ----------------------------------------------------------------------------- | ----------------------- |
| `mcp`       | Công thức khởi chạy MCP server     | Thêm vào danh mục MCP, **tắt**; người dùng xem lệnh rồi bật                   | không (đã có)           |
| `skill`     | Thư mục có `SKILL.md`              | Nhập vào kho skill; stage lọc skill của pipeline chọn khi cần                 | không (đã có)           |
| `tool`      | Hàm không có giao diện             | Gọi từ chat bằng `/` hoặc `*` kèm tên và input; kết quả hiện trong chat       | runtime của ngôn ngữ đó |
| `cli`       | Chương trình dòng lệnh             | Nút Terminal ở Home, hiển thị terminal thay thanh chat; không phải app        | không                   |
| `web-embed` | Giao diện web                      | Vùng trung tâm qua gói Browser; nguồn là `url` ngoài hoặc `process` cục bộ    | `process` cần runtime   |
| `launcher`  | App native                         | Hiện trong danh sách app; bấm để mở app thật; nếu app có MCP thì nối vào chat | runtime native          |
| `bridge`    | Giao diện dựng lại cho Hub (mục 6) | Vùng trung tâm: Hub vẽ từ mô tả giao diện, bridge nối vào backend             | hiển thị + runtime      |

`web-embed`:

- `url`: website thành app (ví dụ facebook.com). Không cần `source/`. Có `origins` cho phép điều hướng, `partition` cookie riêng, chế độ agent mặc định tắt, quyền thông báo, camera, mic mặc định tắt.
- `process`: app tự phục vụ web (Gradio, Streamlit). Khai báo lệnh, cổng. Cần runtime chạy tiến trình có giám sát, hiện **chưa có**.

`launcher` có `target` hai dạng: `installed` (app cài sẵn hoặc quá nặng để đưa vào gói; gói chỉ ghi tên tệp chạy như `blender.exe` và link tải, người dùng tự gắn đường dẫn thật trên máy mình nên gói không thể trỏ tới chương trình tùy ý; Hub tự dò app (menu Start, registry, PATH, thư mục cài thông dụng) để người dùng gần như không phải tự tìm tệp; chỉ khi không dò ra thì trung tâm báo "chưa tìm thấy" kèm nút chọn đường dẫn hoặc mở link tải; `installed` là mặc định) và `source` (app nằm trong `source/`, chạy từ đó, cần runtime). `launcher` cho app native có hai lựa chọn do người dùng chọn: (1) mở app thật và nối MCP của nó nếu có (ví dụ Blender có addon MCP); (2) để agent LLM viết kết nối `bridge`.

Không làm trong phiên bản đầu: chạy Python trong WASM, tự dựng form từ schema.

## 5. Plugin của Hub

Package là _nội dung_ từ repo. Plugin là thứ _mở rộng chính Hub_. Hiện Hub chỉ có `sandboxed-web` và `trusted-react`, nên nhiều kết nối ở mục 4 chưa có thứ gì ở phía Hub để thực hiện. Hai điểm mở rộng:

- **Plugin runtime:** biết chạy một loại mã (tiến trình Python, Node, app native); khởi chạy, giám sát, giới hạn cổng và tài nguyên, dọn khi đóng.
- **Plugin hiển thị:** biết vẽ một loại giao diện trong vùng trung tâm (ví dụ bộ vẽ mô tả giao diện của mục 6).

Quy tắc:

- Plugin chạy mã native nên phải được ký bởi nguồn tin cậy. Nó khác với package lấy từ repo bất kỳ.
- Package khai báo plugin nó cần; Hub kiểm tra có plugin đó chưa. Chưa có thì kết nối ở trạng thái tắt kèm lý do, gói không giả vờ chạy được.
- Chưa kiểm tra: hệ extension hiện có của Hub đã có điểm gắn tương ứng chưa.

## 6. Kết nối `bridge`: dựng lại giao diện, giữ nguyên backend

Dành cho repo có giao diện mà Hub không nhúng được. Không chuyển mã sang ngôn ngữ khác; chỉ dựng lại **giao diện** và giữ backend:

```text
Giao diện mới (Hub vẽ được)  →  Bridge (chuyển lệnh, sự kiện)  →  Backend = repo gốc, giữ nguyên
```

- **Mô tả giao diện** là dữ liệu trung lập (cây thành phần, vị trí, nút, ô nhập, sự kiện), không phải mã, nên Hub vẽ an toàn bằng plugin hiển thị.
- **Bridge** nối mỗi sự kiện vào một hàm backend đã khai báo. Backend chạy bằng plugin runtime.
- Agent viết mô tả giao diện và bridge; người dùng xem diff rồi mới bật.
- Mức giữ nguyên bố cục phụ thuộc loại giao diện nguồn (đánh giá, chưa thử): giao diện khai báo sẵn (Qt `.ui`, XML, HTML, Flutter, Gradio Blocks) rút khá chính xác; giao diện viết bằng mã mệnh lệnh (Tkinter) chỉ gần đúng và cần người duyệt; giao diện tự vẽ (game, viewport 3D) không rút được, dùng `launcher` cộng MCP.
- Chuyển tự động mã giữa các ngôn ngữ lập trình không nằm trong phạm vi; một công cụ rút bố cục giao diện từ nhiều framework là hướng phát triển về sau.

## 7. Cách adapter được tạo

1. Backend (classifier) tự nhận mọi kết nối nó nhận ra: MCP (từ `package.json`, `mcp.json`), skill (`SKILL.md`), CLI (trường `bin`), web tĩnh (`index.html`, bản build), URL website.
2. Phần không chắc, hoặc repo không có dấu hiệu rõ, được đánh dấu để agent hoặc người dùng bổ sung. `generatedBy` ghi ai đã viết.
3. Mọi adapter, dù do ai viết, đi qua cùng trình kiểm tra schema và cùng bộ quy tắc quyền hạn.

## 8. An toàn

- Một kết nối chỉ được bật khi Hub có runtime hoặc plugin chạy nó. Kết nối chưa chạy được vẫn nằm trong gói ở trạng thái tắt kèm lý do.
- Mặc định tắt cho `mcp`, `cli`, `launcher`, `process`, `bridge`. Người dùng thấy đúng lệnh trước khi bật.
- Quyền khai báo trong adapter là trần; Hub không cấp thêm. `web-embed` không được gọi IPC của Hub; `process` chỉ mở loopback của chính tiến trình đó.
- Bí mật không đi vào gói. Khóa API là `env` do người dùng điền sau khi cài.
- `source/` không bao giờ được thực thi chỉ vì nằm trong gói.

## 9. Chuyển gói cũ về cấu trúc chuẩn

Gói cũ (không có `adapter/`) được đọc bằng bộ chuyển đổi: manifest cũ sinh ra `adapter.json` tương đương lúc cài. Không có gói nào phải tạo lại. Gói mới luôn dùng cấu trúc chuẩn; sau một thời gian đủ dài thì bỏ nhánh đọc cũ. Loại `agent-skill` đã thêm ngày 2026-10-08 trở thành kết nối `skill`; gói MCP hiện nay là adapter chỉ có một kết nối `mcp` và không có `source/`.

## 10. Các bước cài đặt (đề xuất)

1. Manifest: thêm khai báo `adapter` và schema `adapter.json` (Zod), kèm bộ chuyển đổi từ manifest cũ.
2. Packager: ghi `source/` nguyên vẹn, ghi `adapter/`; ký phủ cả hai. Ghi theo luồng (streaming) để repo lớn không đầy bộ nhớ, vì không đặt trần kích thước.
3. Classifier: trả danh sách kết nối thay vì một archetype.
4. Trình cài: đọc từng kết nối (`mcp`, `skill` trước, vì đã có sẵn).
5. Web-embed từ `url`, rồi nút Terminal ở Home cho `cli`, rồi lệnh `/` `*` cho `tool`.
6. Điểm mở rộng plugin và plugin runtime (chạy tiến trình), rồi `launcher`.
7. Plugin hiển thị và kết nối `bridge`; agent viết adapter.

## 11. Trạng thái cài đặt (2026-10-09)

Đã làm, có test:

- `common/packages/adapter.ts`: schema Zod của `adapter.json` cho cả bảy loại kết nối, đường dẫn an toàn, id không trùng, danh sách loại cài được (`mcp`, `skill`) và `adapterFromManifest` cho gói cũ.
- Classifier trả `connections` (MCP và mọi thư mục `SKILL.md`); một repo vừa có MCP vừa có skill ra cả hai.
- Packager: các archetype `mcp-tool-server` và `agent-skill` ghi nguyên repo vào `source/` và `adapter/adapter.json`; chữ ký phủ cả hai. Skill có `SKILL.md` chứa bí mật bị bỏ khỏi adapter.
- `/repotopackage`: cài các kết nối `skill` (giải nén từ `source/`, bỏ trùng tên theo bản ngoài cùng) và thêm `mcp` vào danh mục MCP ở trạng thái tắt.
- Thử trên repo thật: `diagram-design` (1 skill) và `context7` (1 MCP + 10 skill, 7 bản sao theo từng host).

Đã làm thêm (2026-10-09, backend không dùng token):

- `common/packages/serviceDetector.ts`: nhận các thành phần chạy được từ nhiều thư mục (Next.js, Nuxt, Astro, SvelteKit, Vite, CRA, Angular, Vue CLI, Streamlit, Gradio, Flask, FastAPI), sinh lệnh cài và lệnh chạy từ khuôn mẫu cố định (không đọc lệnh từ README), đoán cổng (kể cả cờ `--port` trong script), chọn npm/pnpm/yarn/bun theo lockfile, chạy backend trước rồi tới giao diện được nhúng.
- Biến môi trường: lấy từ `.env.example` (để trống nghĩa là bắt buộc) và từ mã nguồn (`os.environ["X"]` bắt buộc, `os.getenv("X", mặc định)` tùy chọn, `process.env`, `import.meta.env`, trường `BaseSettings` của pydantic). Tên và mức bắt buộc do backend ghi vào `adapter.json`; giá trị là việc của người dùng hoặc agent.
- Loại `web-service-app` và kết nối `web-embed` với `process.services` + `embed`; chỉ cho phép một danh sách chương trình cố định, đối số không chứa ký tự shell, thư mục chạy nằm trong `source/`.
- Classifier không còn gán `unsupported-native` cho repo có tệp C++ do Flutter/Electron sinh; chỉ khi không có ngôn ngữ nguồn nào khác.
- Thử trên MediSign_AI-legacy: ra `web-service-app` với backend FastAPI (cổng 8000) và web Next.js (cổng 3000).

Hạn chế đã biết của phần này: `env_prefix` của pydantic chưa được tính (tên biến trong mã khác tên thật), `.env.example` ở gốc được gắn cho mọi dịch vụ, `docker-compose.yml` chỉ được ghi chú chứ chưa chạy, và kết nối `web-embed` chưa chạy được vì Hub chưa có runtime tiến trình (gói vẫn được tạo, kết nối nằm trong gói và tắt, báo cáo liệt kê lệnh và biến cần có).

Chưa làm:

- Gói web, theme, IDE viewer vẫn dùng bố cục cũ (nội dung ở gốc gói, vì runtime sandbox mở `entrypoint` từ gốc); chuyển sang bố cục chuẩn cần sửa trình cài của chúng.
- `adapterFromManifest` chưa được trình cài gói (PackageManagerService) gọi; hiện chỉ có test.
- Ghi gói theo luồng: packager vẫn dựng cả gói trong bộ nhớ và còn giới hạn `DEFAULT_LIMITS` (10 000 tệp, 100 MB); chưa bỏ trần như đã chốt. Gói context7 là 20 MB, diagram-design 9 MB.
- Chưa nhận CLI (`bin` trong package.json) thành kết nối `cli`; chưa có `tool`, `web-embed`, `launcher`, `bridge`, plugin.
- Chưa thử trên app Electron chạy thật: bước giải nén và `catalog.import` chỉ được kiểm tra qua test của phần giải nén.

## 12. Quy tắc tương thích (để thêm kết nối mới mà không làm hỏng cái cũ)

Người ghi chặt, người đọc rộng (`common/packages/adapter.ts`):

- **Ghi** (`parseAdapterDocument`, `serializeAdapterDocument`): schema nghiêm, từ chối trường lạ, để lỗi lộ ra ngay lúc tạo gói.
- **Đọc** (`readAdapterDocument`) không bao giờ ném lỗi:
  - Trường không biết thì bỏ qua (không bao giờ được dùng), ở cả cấp tài liệu lẫn cấp kết nối.
  - Loại kết nối không biết thì bỏ qua và ghi vào `issues` (`unknown-kind`); các kết nối còn lại vẫn cài.
  - Một kết nối sai thì chỉ bỏ riêng nó (`invalid`); các trường mà bản này biết vẫn được kiểm tra đúng như lúc ghi nên không có đường vòng qua kiểm tra an toàn.
  - Không có kết nối nào, hoặc thiếu danh sách, không phải lỗi. Gói không có `adapter/` được đọc qua `adapterFromManifest`.
  - `schemaVersion` lớn hơn bản này hiểu thì coi là adapter rỗng kèm lý do `newer-version`; nguồn gốc không đọc được thì coi như do agent viết (ít tin cậy nhất).
- **Thêm trường hoặc loại kết nối mới không đổi `schemaVersion`.** Chỉ tăng khi nghĩa của trường đã có thay đổi.
- Hậu quả: bản Hub cũ mở gói mới vẫn dùng được phần nó hiểu, và hiện phần còn lại là "chưa hỗ trợ".

## 13. Việc còn mở

- Home có chỗ đặt nút Terminal và chế độ terminal thay thanh chat chưa (chưa kiểm tra).
- Gói Browser có cho gói khác gọi `openTab` không, và kho cookie theo `partition` có bền không (chưa kiểm tra).
- Quyền nào trong `capability.ts` cho phép mở tab vào loopback hoặc origin ngoài.
- Hệ extension hiện có có điểm gắn cho plugin runtime và plugin hiển thị chưa.
- Cách gộp skill trùng tên khi hai gói cùng cung cấp.

## 14. Quy các loại repo về nhóm (người dùng chốt hướng 2026-10-09)

1. **Không chạy được, nặng hoặc không thân thiện** (app desktop, game native, workflow, bot, hạ tầng): chỉ là _đại diện_ trong Hub. Hub khởi động ở ngoài và quan sát; trung tâm hiện "đã mở ngoài" cùng trạng thái. Nếu app có MCP thì hiển thị hoặc điều khiển qua agent. Gói không cần `source/`; `launcher` có thể chỉ chứa đường dẫn tới app trên máy (chờ chốt trường `target`).
2. **Dữ liệu** (skill, tài liệu, mẫu khởi tạo): lưu vào đúng kho. Skill vào kho skill. Tài liệu vào một kho tri thức riêng (khác artifact: artifact do agent tạo ra, kho tri thức là tài liệu nhập vào; người đọc được và agent tra cứu được; chờ chốt). Mẫu khởi tạo (khung dự án để chép ra làm dự án mới) là dữ liệu, ưu tiên thấp.
3. **Web embedding:** tích hợp vào trung tâm qua gói Browser.
4. **Tool, CLI, SDK, thư viện:** quy về cơ chế gọi tool (`/` `*`), terminal, hoặc biến thành một app, một tool, một lệnh nhanh.
5. **Mô hình AI:** không phải gói mà là tính năng (người dùng chọn thư mục model theo tác vụ như chuyển giọng nói thành văn bản). Liên quan Local Inference Broker (chưa kiểm tra).
6. **Tiện ích mở rộng:** gói chủ khai báo điểm mở rộng, extension khai báo gói chủ và `contributions.<gói chủ>` kèm phiên bản API, theo mô hình IDE đã có (`com.tomni.ide`). Hub chỉ nối khi hai bên khớp, nên extension IDE không dùng được cho Browser. Plugin của app khác (VS Code, Obsidian) chỉ nhận khi phù hợp, ưu tiên thấp.

Workflow tự động được coi là dữ liệu mô tả bước cần engine riêng, nên thuộc nhóm 1 hoặc 2.
