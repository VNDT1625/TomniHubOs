# Mô hình tiện ích mở rộng (extension)

**Trạng thái:** `PROPOSAL` (hướng đã chốt với người dùng ngày 2026-10-09, chưa cài đặt)  
**Chủ đề:** Plugin, hook và extension không phải các loại gói riêng. Mỗi thứ là một chức năng của app trong Hub; repo của nó khi được thêm vào sẽ mở rộng chức năng đó. Tomny cung cấp ba phần: kho tiện ích (tab ở sidebar), bridge (cầu nối) và điểm kết nối của từng app gói.  
**Tài liệu liên quan:** [Package shell layout](package-shell-layout.md), [Package taxonomy](package-taxonomy.md)

**Quyết định 2026-10-09 thay thế một phần tài liệu này:** extension chạy trong một hồ sơ duyệt web chung `persist:tomny-browser` (không phải mỗi extension một phân vùng); phần bù API Chrome do Tomny tự viết (không dùng thư viện GPL); thêm userscript; nguồn cài và giao diện chi tiết. Xem mục 12 và 14 của [repotopackage-design.md](repotopackage-design.md); chỗ nào khác nhau thì tài liệu đó thắng.

---

## 1. Nguyên lý

1. Plugin, hook và extension **không phải loại gói riêng**. Mỗi thứ là một _chức năng_ của app trong Hub. Một repo như vậy, khi thêm vào, mở rộng chức năng đó.
2. Extension được **thử trên một app gói**. Chạy được thì dùng; không chạy được thì app báo "không phù hợp" kèm lý do. Đây không phải lỗi.
3. Extension **không bao giờ chạm trực tiếp vào app gói**. Mọi lời gọi đi qua bridge của Tomny.
4. Không có gì tự chạy: mọi thứ do người dùng chủ động bật, mặc định tắt.

## 2. Giao diện người dùng

- **Tab "Tiện ích"** nằm dưới tab Store ở sidebar, để quản lý: nhập repo từ GitHub (qua `/repotopackage`), liệt kê, bật theo từng app, khai báo đích, gỡ. Tomny cũng đưa sẵn một số tiện ích để tải.
- **Header** có một vùng hiển thị tối đa 3 tiện ích đã ghim dưới dạng biểu tượng. Bấm một biểu tượng thì mở popup (dựng từ HTML của chính tiện ích nếu có), giống nút tiện ích trên thanh công cụ trình duyệt.
- Chưa kiểm tra: vị trí đặt ở header và ở sidebar trong mã hiện tại.

```text
Tab "Tiện ích" (Store)          người dùng nhập repo, bật theo app, ghim
        │
        ▼
Header: tối đa 3 biểu tượng ghim
        │ bấm
        ▼
Popup (HTML của tiện ích)
        │ gọi API
        ▼
Bridge của Tomny ── kiểm tra quyền đã khai báo và người dùng đã duyệt
        │
        ▼
Điểm kết nối của app gói (Browser, IDE, ...) ── kiểm tra định dạng, capability
```

## 3. Trường đích (target)

Mỗi extension có một trường nói nó nhắm loại app nào (`browser`, `ide`, ...). Trường này phải khớp với điều app gói khai báo.

- Thiếu trường thì giá trị là `none`: có thể thử trên mọi app.
- `none` **không có nghĩa là đã bật ở mọi nơi**. Người dùng vẫn bật theo từng app, và điểm kết nối của app vẫn kiểm tra định dạng và capability.
- Khớp với mục 14 của [Package shell layout](package-shell-layout.md): extension khai báo gói chủ, Hub chỉ nối khi hai bên khớp.

## 4. Điểm kết nối của app gói

Mỗi app gói tự khai báo điểm kết nối của mình:

- Nhận những định dạng extension nào.
- Kết nối bằng cách nào. Với app Browser: nạp một extension định dạng Chrome vào một session riêng.
- Danh sách capability app cung cấp, kèm **phiên bản API** để extension có thể đòi tối thiểu một phiên bản.

## 5. Bridge: đường giao tiếp do Tomny cung cấp

```text
Extension ──gọi──▶ Bridge của Tomny ──kiểm tra quyền──▶ app gói
```

Ba phần của hệ thống:

| Phần                       | Vai trò                                                                                                                    |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Kho tiện ích (tab sidebar) | Nhập, liệt kê, bật theo app, ghim, gỡ                                                                                      |
| Bridge                     | Nhận lời gọi từ extension, đối chiếu quyền đã khai báo mà người dùng đã duyệt, rồi thay mặt extension tác động lên app gói |
| Điểm kết nối của app gói   | Khai báo định dạng nhận, cách nối, danh sách capability và phiên bản API                                                   |

## 6. Hai cách chạy extension

| Định dạng             | Cách chạy                                                                                                  | Dùng cho                               |
| --------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Chrome (`chrome-mv3`) | Electron chạy trực tiếp; Tomny đóng vai chủ nhà, cô lập, và theo thời gian bù các API còn thiếu qua bridge | Gần như mọi repo extension trên GitHub |
| Tomny-native          | HTML popup cộng quyền khai báo, gọi API của Tomny                                                          | Extension do chính chúng ta viết       |

**Quyết định:** repo GitHub đi đường Chrome trước. Đường Tomny-native dành cho extension tự viết.

## 7. Quy tắc khi `/repotopackage` xử lý repo extension

Toàn bộ do backend làm theo quy tắc cố định, không tốn token mô hình:

1. **Nhận diện:** tìm `manifest.json` có `manifest_version`, hoặc `src/manifest.*` kèm script build.
2. **Cần build:** không chạy build. Ghi một mục mở (loại "cần build") để agent hoặc người dùng tự build rồi trỏ vào thư mục output. Cùng ý với quy tắc `WEB_NEEDS_BUILD` đã có.
3. **Đọc manifest:** `name`, `version`, `permissions`, `host_permissions`, `content_scripts`, `background`, `action.default_popup`.
4. **So khớp:** đối chiếu từng permission với danh sách capability của app đích, rồi cho một kết luận:
   - "Dùng được"
   - "Một phần" (liệt kê API còn thiếu)
   - "Không phù hợp" (kèm lý do)
5. **Đóng gói:** cả repo nằm trong `source/`; `adapter/adapter.json` có một kết nối loại mới `extension` gồm: định dạng `chrome-mv3`, thư mục gốc, `target` mặc định `none`, permissions, danh sách không hỗ trợ. Kết nối **tắt theo mặc định**.
6. **Bật:** người dùng bật cho một app; Tomny nạp extension vào một session partition riêng và hiển thị popup.

Mọi vấn đề kết thúc ở một trong ba kết quả: chạy được, chạy một phần kèm lý do, hoặc một mục mở cho agent/người dùng. Không có lỗi âm thầm.

Quyền rộng như `<all_urls>` cần người dùng đồng ý rõ ràng trước khi bật.

**Manifest V2:** chưa kiểm tra Electron 37 có nạp được không. Nếu không, báo "không phù hợp: cần V3".

Ví dụ phần kết nối (hình dạng đề xuất, chưa có schema):

```jsonc
{
  "kind": "extension",
  "id": "example-ext",
  "format": "chrome-mv3",
  "root": "source/dist",
  "target": "none",
  "permissions": ["storage", "alarms"],
  "unsupported": ["webRequest"],
}
```

Thêm loại kết nối này không đổi `schemaVersion`; bản Hub cũ bỏ qua loại không biết (xem mục 12 của [Package shell layout](package-shell-layout.md)).

## 8. Đã đo: nạp extension Chrome trong Electron

Thử nghiệm ngày 2026-10-09: một extension nhỏ viết riêng cho bài thử, nạp bằng `session.extensions.loadExtension` trong Electron 37.10.3 (Chromium 138), trong một partition riêng, qua `WebContentsView` giống tab của Hub Browser.

| Kết quả        | API / tính năng                                                                                                                                                                                                                                                                                           |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chạy được      | Nạp extension Manifest V3; chèn content script; background service worker; nhắn tin content script <-> background; `storage.local`; `alarms`; luật `declarativeNetRequest` (thêm luật được, chưa kiểm tra việc chặn có hiệu lực); badge của `action`; `tabs.query`; `runtime`; `i18n`; `scripting` có mặt |
| Thiếu hoặc lỗi | `windows`, `cookies`, `contextMenus`, `webNavigation`, `webRequest`, `downloads`, `history`, `bookmarks`, `permissions`, `commands`, `notifications`, `offscreen`, `sidePanel`, `identity`, `storage.sync`, và `tabs.create` (hàm không tồn tại)                                                          |

Giới hạn của phép đo: extension tự viết cho bài thử; chỉ một tập con API; chạy một lần; partition riêng, không phải session mặc định của Hub; chưa kiểm tra ảnh hưởng lên web agent runner.

## 9. Hiện trạng Hub Browser (đã thấy trong mã)

Nguồn: `packages/desktop/src/process/browser/browserViewManager.ts`.

- Mỗi tab là một `WebContentsView` của Electron.
- Mặc định **không đặt partition**, nên các tab dùng chung session bền mặc định của app (phiên đăng nhập thật của người dùng). Có partition tùy chọn để cô lập.
- Nội dung web chạy với `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- Chưa có mã nào gọi `loadExtension`.
- Hệ "extension" đã có của Hub (`ExtensionSettingsPage`, `useExtensionSettingsTabs`) thêm tab vào Settings; đó là một thứ khác. Chưa kiểm tra có dùng chung với kho này được không.

**Hệ quả:** extension phải nạp trong partition riêng, không bao giờ nạp vào session mặc định. Nếu không, nó sẽ thấy phiên đăng nhập thật của người dùng và cửa sổ chính.

## 10. An toàn

- Không có gì chạy nếu người dùng không chủ động làm.
- Extension tắt theo mặc định.
- Quyền được hiển thị và được người dùng duyệt.
- Bridge là đường duy nhất tới app gói.
- Trường hoặc loại kết nối mới trong `adapter.json` mà bản cũ không biết thì bị bản cũ bỏ qua (xem phần quy tắc tương thích của [Package shell layout](package-shell-layout.md)).

## 11. Đã kiểm tra và chưa kiểm tra

| Đã kiểm tra (mã hoặc phép đo)                                     | Chưa kiểm tra                                               |
| ----------------------------------------------------------------- | ----------------------------------------------------------- |
| Mỗi tab Browser là `WebContentsView`, mặc định dùng session chung | Header có chỗ cho 3 ô ghim; vị trí tab "Tiện ích" ở sidebar |
| Cờ cô lập của nội dung web (mục 9)                                | Electron 37 có nạp được Manifest V2                         |
| Chưa có mã gọi `loadExtension`                                    | Việc chặn của `declarativeNetRequest` có hiệu lực           |
| Kết quả đo ở mục 8 (một lần, partition riêng)                     | Ảnh hưởng lên web agent runner                              |
|                                                                   | Dùng chung với hệ extension của Settings                    |
|                                                                   | Browser có phơi danh sách capability mà bridge gọi được     |

## 12. Việc còn mở

- Header có chỗ cho 3 ô ghim không (chưa kiểm tra).
- Cách dựng popup an toàn (HTML của extension chạy ở đâu, cờ cô lập nào).
- Browser có phơi danh sách capability mà bridge gọi được không.
- Có dùng chung với hệ extension hiện có của Hub (`ExtensionSettingsPage`) không.
- Cách bridge bù các API còn thiếu (ví dụ `tabs.create`, `contextMenus`).
- Mô hình quyền: hỏi mỗi lần hay duyệt một lần theo khai báo; chưa chốt, nghiêng về duyệt một lần theo khai báo, hiện ra lúc bật.
- Cách trình bày popup: thả xuống dưới biểu tượng ghim hay hộp thoại; chưa chốt.
