# Tomny Account — Đặc tả đầy đủ chức năng tài khoản sản phẩm

> **Trạng thái:** `DESIGN_ONLY`
>
> **Mức độ tích hợp:** `NONE`
>
> **Hiển thị với người dùng:** Không.
>
> **Quyết định hiện tại:** Chức năng được đặc tả đầy đủ để triển khai trong tương lai, nhưng chưa được nối vào renderer, router, sidebar, settings, core, database, telemetry, WebUI hoặc bất kỳ surface nào của bản demo. Người dùng hiện tại phải xem Tomny như chưa có tài khoản sản phẩm.

---

## 1. Tóm tắt điều hành

Tomny Account là lớp danh tính online tùy chọn dành cho người dùng Tomny trong tương lai. Nó cho phép một người liên kết nhiều thiết bị, sử dụng dịch vụ online, đồng bộ có chọn lọc, quản lý gói và license, tham gia tổ chức, khôi phục quyền truy cập và kiểm soát dữ liệu của mình.

Tomny Account không được dùng để thay thế triết lý local-first. Người dùng vẫn phải có thể cài đặt, mở và sử dụng các chức năng cục bộ cốt lõi mà không cần đăng ký hoặc đăng nhập.

Trong giai đoạn hiện tại, tài liệu này chỉ đóng vai trò contract sản phẩm và kỹ thuật. Không có mã runtime nào được phép import hoặc tham chiếu tới chức năng này. Không có UI ẩn, route ẩn, API giả, tài khoản mẫu hoặc migration chờ sẵn trong bản demo.

## 2. Bối cảnh và vấn đề cần giải quyết

Tomny hiện hướng tới một hệ thống agentic local-first có nhiều surface, nhiều thiết bị, remote access, extension, automation, agent team và khả năng cung cấp dịch vụ online trong tương lai. Khi sản phẩm public hoặc thương mại hóa, cần một lớp danh tính bền vững để giải quyết:

- xác định một người dùng trên nhiều thiết bị;
- quản lý thiết bị tin cậy và thu hồi thiết bị thất lạc;
- đồng bộ cấu hình hoặc dữ liệu mà người dùng chủ động chọn;
- cấp quyền theo gói, license, credit hoặc tổ chức;
- hỗ trợ remote relay, cloud workspace, marketplace và dịch vụ hosted;
- quản lý thành viên, vai trò và quyền của tổ chức;
- xuất dữ liệu, xóa tài khoản và đáp ứng yêu cầu quyền riêng tư;
- khôi phục tài khoản mà không phụ thuộc vào một máy cục bộ.

Nếu nối tài khoản vào app quá sớm, bản demo sẽ phát sinh nhiều câu hỏi chưa thể trả lời tốt về server public, nơi lưu dữ liệu, chính sách quyền riêng tư, email, billing, đồng bộ, bảo mật và vận hành. Vì vậy chức năng được thiết kế trước nhưng hoãn tích hợp hoàn toàn.

## 3. Thuật ngữ và ranh giới bắt buộc

### 3.1 Local Access Auth

Cơ chế bảo vệ một Tomny instance, WebUI, remote gateway hoặc truy cập cục bộ. Danh tính này thuộc về một máy hoặc một installation.

Ví dụ:

- mật khẩu bảo vệ WebUI;
- QR token để điện thoại kết nối;
- session token của gateway;
- quyền truy cập một workspace cục bộ.

### 3.2 Tomny Account

Danh tính online của một con người hoặc service account trên phạm vi hệ sinh thái Tomny.

Ví dụ:

- email đã xác minh;
- hồ sơ cá nhân;
- danh sách thiết bị;
- tổ chức đang tham gia;
- cài đặt đồng bộ;
- quyền dữ liệu và lịch sử bảo mật.

### 3.3 Device Identity

Danh tính riêng của mỗi cài đặt Tomny. Một tài khoản có thể liên kết nhiều device identity. Một thiết bị có thể bị đổi tên, đánh dấu tin cậy, thu hồi hoặc xóa.

### 3.4 Entitlement

Kết quả tính toán quyền sử dụng tại một thời điểm, dựa trên plan, license, purchase, trial, organization policy, seat và feature flag.

### 3.5 Sync Identity

Danh tính và khóa dùng cho đồng bộ. Nó không được mặc định đồng nhất với account session. Đăng nhập không tự động bật đồng bộ.

### 3.6 Quy tắc không được phá vỡ

- Không dùng chung mật khẩu giữa Local Access Auth và Tomny Account.
- Không dùng chung JWT secret hoặc session store.
- Không dùng WebUI user làm cloud account.
- Không lưu refresh token trong `localStorage`.
- Không gửi API key, credential vault, secret hoặc nội dung workspace chỉ vì người dùng đăng nhập.
- Không khóa dữ liệu cục bộ khi subscription hết hạn.
- Không buộc tài khoản cho local-only mode.
- Không dùng account service làm single point of failure cho việc mở app.

## 4. Mục tiêu sản phẩm

1. Cho phép người dùng tạo và quản lý danh tính Tomny online an toàn.
2. Giữ trải nghiệm local-first và tài khoản là tùy chọn.
3. Hỗ trợ nhiều thiết bị với khả năng xem, đổi tên và thu hồi.
4. Tạo nền tảng cho đồng bộ có chọn lọc và mã hóa.
5. Tạo nền tảng cho plan, license, credit và tổ chức.
6. Cho phép người dùng kiểm soát dữ liệu, consent, export và deletion.
7. Tách rõ identity, device, sync, billing và nội dung người dùng.
8. Có thể vận hành ở desktop, WebUI, mobile và các surface tương lai.
9. Có khả năng audit, chống lạm dụng và ứng phó sự cố.
10. Có contract đủ rõ để nhiều agent hoặc đội phát triển triển khai độc lập mà không tự suy đoán.

## 5. Ngoài phạm vi

Trong phiên bản đặc tả này chưa quyết định hoặc chưa triển khai:

- nhà cung cấp email cụ thể;
- nhà cung cấp thanh toán cụ thể;
- quốc gia hoặc loại thuế cụ thể;
- giá plan;
- quota chính xác;
- nội dung nào chắc chắn sẽ được cloud sync;
- cloud storage vendor;
- cơ chế social graph;
- public profile;
- quảng cáo;
- bán dữ liệu;
- bắt buộc đăng nhập để dùng app;
- migration từ WebUI admin user sang Tomny Account;
- tự động upload toàn bộ conversation hoặc repository;
- cơ chế KYC;
- ví tiền hoặc chuyển credit giữa người dùng.

## 6. Đối tượng người dùng

| Persona                     | Nhu cầu                                                          |
| --------------------------- | ---------------------------------------------------------------- |
| Người dùng local-only       | Dùng app không cần tài khoản và không bị nhắc đăng nhập liên tục |
| Người dùng nhiều thiết bị   | Đồng bộ lựa chọn và quản lý thiết bị                             |
| Người dùng remote           | Kết nối an toàn qua relay hoặc dịch vụ online                    |
| Người dùng Pro              | Nhận đúng quyền theo gói hoặc license                            |
| Thành viên tổ chức          | Tham gia workspace chung với vai trò rõ ràng                     |
| Chủ tổ chức                 | Mời thành viên, quản lý seat, policy và billing                  |
| Người dùng nhạy cảm dữ liệu | Kiểm soát loại dữ liệu nào rời khỏi máy                          |
| Support vận hành            | Xác minh sự cố mà không đọc nội dung riêng tư                    |

## 7. Chế độ sử dụng

### 7.1 Local-only

- Không có account session.
- App vẫn khởi động và hoạt động.
- Không xuất hiện trạng thái lỗi vì chưa đăng nhập.
- Dữ liệu nằm cục bộ.
- Các dịch vụ cần account hiển thị yêu cầu đăng nhập chỉ khi người dùng chủ động mở chúng.

### 7.2 Linked personal account

- Một thiết bị được liên kết với một Tomny Account.
- Người dùng chọn bật hoặc tắt từng loại đồng bộ.
- Entitlement được cache có thời hạn để hỗ trợ offline.
- Đăng xuất không xóa dữ liệu local nếu người dùng không yêu cầu.

### 7.3 Organization member

- Tài khoản cá nhân có membership trong một hoặc nhiều tổ chức.
- Mỗi tài nguyên online có owner scope rõ: personal hoặc organization.
- Policy tổ chức không được âm thầm áp dụng lên workspace cá nhân.
- Rời tổ chức phải có quy tắc xử lý dữ liệu rõ ràng.

### 7.4 Service account

- Chỉ dành cho automation hoặc integration được kiểm soát.
- Không dùng chung session với người thật.
- Scope và thời hạn token giới hạn.
- Không xuất hiện trong MVP nếu chưa có nhu cầu vận hành thực tế.

## 8. Nguyên tắc trải nghiệm

1. Không chặn màn hình đầu tiên bằng đăng nhập.
2. Không dùng dark pattern để ép tạo tài khoản.
3. Mọi hành động upload hoặc sync phải mô tả dữ liệu, mục đích và nơi lưu.
4. Nút tiếp tục cục bộ phải rõ ràng, không bị làm mờ.
5. Khi offline, app phải giải thích chức năng online tạm thời không khả dụng nhưng dữ liệu local vẫn dùng được.
6. Không hiển thị giá hoặc plan khi billing chưa sẵn sàng.
7. Không trộn tài khoản Tomny với tài khoản model provider như OpenAI, Anthropic hoặc Google.
8. Không gọi mật khẩu WebUI là mật khẩu Tomny Account.
9. Không hiển thị Account Center trong demo hiện tại.
10. Khi triển khai, mọi text hiển thị phải dùng i18n.

## 9. Danh mục chức năng

| Mã       | Chức năng                          | Ưu tiên tương lai     | Trạng thái |
| -------- | ---------------------------------- | --------------------- | ---------- |
| F-ACC-01 | Điểm vào tài khoản tùy chọn        | P0                    | Chỉ đặc tả |
| F-ACC-02 | Đăng ký bằng email                 | P0                    | Chỉ đặc tả |
| F-ACC-03 | Xác minh email                     | P0                    | Chỉ đặc tả |
| F-ACC-04 | Đăng nhập và session               | P0                    | Chỉ đặc tả |
| F-ACC-05 | Đăng xuất và khóa phiên            | P0                    | Chỉ đặc tả |
| F-ACC-06 | Khôi phục tài khoản                | P0                    | Chỉ đặc tả |
| F-ACC-07 | Hồ sơ cá nhân                      | P1                    | Chỉ đặc tả |
| F-ACC-08 | Quản lý thiết bị                   | P0                    | Chỉ đặc tả |
| F-ACC-09 | Đăng nhập qua nhà cung cấp ngoài   | P1                    | Chỉ đặc tả |
| F-ACC-10 | Consent và phạm vi đồng bộ         | P0                    | Chỉ đặc tả |
| F-ACC-11 | Đồng bộ có chọn lọc                | P1                    | Chỉ đặc tả |
| F-ACC-12 | Tổ chức và thành viên              | P1                    | Chỉ đặc tả |
| F-ACC-13 | Entitlement và license             | P0 khi thương mại hóa | Chỉ đặc tả |
| F-ACC-14 | Billing và hóa đơn                 | P1 khi thương mại hóa | Chỉ đặc tả |
| F-ACC-15 | Bảo mật và lịch sử hoạt động       | P0                    | Chỉ đặc tả |
| F-ACC-16 | Export dữ liệu                     | P0 trước public       | Chỉ đặc tả |
| F-ACC-17 | Xóa tài khoản                      | P0 trước public       | Chỉ đặc tả |
| F-ACC-18 | Offline và degraded mode           | P0                    | Chỉ đặc tả |
| F-ACC-19 | Thông báo bảo mật                  | P1                    | Chỉ đặc tả |
| F-ACC-20 | Support và account recovery review | P1                    | Chỉ đặc tả |

## 10. Yêu cầu chức năng chi tiết

### F-ACC-01 — Điểm vào tài khoản tùy chọn

**User story:** Là người dùng Tomny, tôi muốn tiếp tục dùng cục bộ hoặc chủ động đăng nhập khi cần dịch vụ online.

**Luồng tương lai:**

1. App mở ở local-only mode.
2. Account Center hiển thị trạng thái chưa liên kết.
3. Người dùng có thể chọn đăng nhập, tạo tài khoản hoặc tiếp tục cục bộ.
4. App không lặp lại lời mời đăng nhập trong cùng ngữ cảnh nếu người dùng đã bỏ qua.
5. Khi người dùng mở một chức năng bắt buộc account, hệ thống giải thích lý do trước khi mở auth flow.

**Tiêu chí nghiệm thu:**

- Không bắt buộc account để mở app.
- Local-only mode không có banner cảnh báo dai dẳng.
- Auth flow chỉ mở do hành động rõ ràng của người dùng.
- Đóng auth flow không làm mất trạng thái công việc hiện tại.
- Không có điểm vào này trong bản demo hiện tại.

### F-ACC-02 — Đăng ký bằng email

**Dữ liệu đầu vào tối thiểu:**

- email;
- mật khẩu hoặc passkey tùy chiến lược;
- xác nhận điều khoản;
- xác nhận chính sách quyền riêng tư;
- locale và timezone kỹ thuật;
- anti-abuse challenge khi cần.

**Yêu cầu:**

- Chuẩn hóa email trước khi so sánh nhưng giữ bản hiển thị hợp lý.
- Không tiết lộ rõ một email đã tồn tại trong các luồng dễ bị enumeration.
- Mật khẩu không được log, analytics hoặc gửi tới renderer sau submit.
- Server hash mật khẩu bằng thuật toán memory-hard được duyệt tại thời điểm triển khai.
- Rate limit theo IP, device signal và account signal.
- Tài khoản chưa xác minh có quyền rất hạn chế.
- Không tạo đồng bộ mặc định sau đăng ký.

**Tiêu chí nghiệm thu:**

- Có thông báo thành công không tiết lộ trạng thái tài khoản nhạy cảm.
- Có resend verification với cooldown.
- Có chống spam và giới hạn thử.
- Điều khoản và privacy version được lưu.
- Không gửi newsletter nếu chưa có consent riêng.

### F-ACC-03 — Xác minh email

**Yêu cầu:**

- Token dùng một lần, có thời hạn và lưu dạng hash.
- Token bị vô hiệu sau khi sử dụng, đổi email hoặc yêu cầu token mới tùy policy.
- Link mở được từ browser ngoài và chuyển về app bằng deep link an toàn.
- Deep link chỉ mang authorization code ngắn hạn, không mang refresh token.
- Có fallback nhập mã nếu deep link không hoạt động.
- Trạng thái xác minh được đồng bộ lại từ server.

**Trường hợp lỗi:**

- token hết hạn;
- token đã dùng;
- email đã đổi;
- clock skew;
- app chưa cài;
- deep link bị chặn;
- user mở link trên thiết bị khác.

### F-ACC-04 — Đăng nhập và session

**Phương thức dự kiến:**

- email và mật khẩu;
- passkey;
- OAuth/OIDC nhà cung cấp ngoài;
- device authorization flow cho surface không có browser đầy đủ.

**Yêu cầu session:**

- access token ngắn hạn;
- refresh token xoay vòng;
- phát hiện refresh token reuse;
- session gắn với device record;
- có server-side revocation;
- có thời điểm tạo, lần dùng gần nhất và IP/location ở mức phù hợp;
- token lưu trong OS credential store ở desktop;
- renderer không trực tiếp giữ refresh token;
- core chỉ nhận capability cần thiết, không nhận toàn bộ account secret.

**Tiêu chí nghiệm thu:**

- Đăng nhập thành công không tự bật sync.
- Restart app có thể khôi phục session an toàn.
- Session hết hạn không làm app local bị unusable.
- Thu hồi thiết bị làm refresh thất bại ngay.
- Access token cũ hết hạn trong thời gian ngắn.

### F-ACC-05 — Đăng xuất và khóa phiên

Có ba hành động khác nhau:

| Hành động                    | Kết quả                                                |
| ---------------------------- | ------------------------------------------------------ |
| Đăng xuất thiết bị này       | Thu hồi session hiện tại, giữ dữ liệu local            |
| Gỡ liên kết thiết bị         | Thu hồi session và xóa liên kết device-account         |
| Xóa dữ liệu account khỏi máy | Xóa token, cache cloud và metadata account theo policy |

Yêu cầu người dùng được chọn giữ hoặc xóa cache đồng bộ. Không được xóa repository, conversation hoặc file local chỉ vì đăng xuất.

### F-ACC-06 — Khôi phục tài khoản

**Luồng tối thiểu:**

- yêu cầu reset không tiết lộ email tồn tại;
- email hoặc phương thức recovery nhận token một lần;
- phiên nhạy cảm yêu cầu re-authentication;
- đổi mật khẩu thu hồi các session theo policy;
- người dùng được xem thiết bị và đăng xuất toàn bộ;
- recovery event được audit và gửi thông báo bảo mật.

**Không được:**

- cho support xem mật khẩu;
- reset chỉ dựa trên thông tin công khai dễ đoán;
- vô hiệu 2FA mà không có quy trình nâng mức xác minh;
- log token recovery.

### F-ACC-07 — Hồ sơ cá nhân

Trường dữ liệu dự kiến:

- display name;
- avatar;
- locale;
- timezone;
- email chính;
- email dự phòng nếu có;
- preferences không nhạy cảm;
- trạng thái xác minh;
- ngày tạo;
- account status.

Không tạo public profile mặc định. Avatar và display name chỉ chia sẻ trong phạm vi người dùng đã tham gia như organization.

### F-ACC-08 — Quản lý thiết bị

Mỗi device record gồm:

- `device_id` ngẫu nhiên;
- tên thiết bị do người dùng đặt;
- platform và app version;
- public key của thiết bị nếu dùng;
- thời điểm liên kết;
- lần hoạt động gần nhất;
- trạng thái trusted, active, revoked;
- session count;
- capability hoặc sync scope;
- metadata mạng tối thiểu, có retention.

Người dùng có thể:

- xem thiết bị;
- đổi tên;
- đánh dấu thiết bị hiện tại;
- thu hồi thiết bị khác;
- đăng xuất tất cả thiết bị;
- xem cảnh báo đăng nhập mới.

### F-ACC-09 — Đăng nhập qua nhà cung cấp ngoài

- Dùng Authorization Code với PKCE.
- Không dùng implicit flow.
- State và nonce bắt buộc.
- Callback qua system browser và deep link được allowlist.
- Cho phép liên kết hoặc hủy liên kết provider.
- Không tự động merge hai account chỉ vì email giống nhau nếu assurance không đủ.
- Account luôn có phương thức recovery hợp lệ trước khi hủy provider cuối cùng.

Provider cụ thể là open decision.

### F-ACC-10 — Consent và phạm vi đồng bộ

Đăng nhập không tạo consent đồng bộ.

Mỗi loại dữ liệu có switch và mô tả riêng:

| Loại dữ liệu                               | Mặc định              | Ghi chú                           |
| ------------------------------------------ | --------------------- | --------------------------------- |
| Cài đặt giao diện                          | Tắt                   | Ít nhạy cảm nhưng vẫn cần consent |
| Danh sách model/provider không chứa secret | Tắt                   | Không gửi API key                 |
| Automation metadata                        | Tắt                   | Nội dung node có thể nhạy cảm     |
| Conversation                               | Tắt                   | Chỉ bật sau khi có policy rõ      |
| Workspace metadata                         | Tắt                   | Không gồm source code mặc định    |
| Source code/file                           | Không hỗ trợ mặc định | Cần flow chuyên biệt              |
| Secret/credential                          | Cấm đồng bộ plaintext | Chỉ qua vault thiết kế riêng      |
| License và entitlement                     | Bật theo account      | Không phải nội dung người dùng    |

Consent record phải lưu version, mục đích, thời điểm, source device và trạng thái rút consent.

### F-ACC-11 — Đồng bộ có chọn lọc

**Nguyên tắc:**

- sync theo category;
- schema version rõ;
- mã hóa khi truyền và lưu;
- conflict policy theo loại dữ liệu;
- idempotency;
- tombstone cho xóa;
- retry có backoff;
- không giữ lock làm chậm app;
- có nút pause;
- có trạng thái last sync;
- có export và clear cloud copy.

**Không đồng bộ tự động:**

- API key;
- OAuth token của provider;
- password;
- raw credential vault;
- file repo;
- terminal history;
- nội dung clipboard;
- browser cookie.

### F-ACC-12 — Tổ chức và thành viên

Thực thể chính:

- organization;
- membership;
- role;
- seat;
- invitation;
- organization policy;
- organization-owned resource.

Vai trò nền tảng:

- owner;
- admin;
- member;
- viewer;
- billing admin.

Yêu cầu:

- lời mời có hạn;
- audit thay đổi vai trò;
- owner transfer có xác nhận mạnh;
- không thể xóa owner cuối cùng nếu chưa chuyển quyền;
- rời tổ chức không xóa dữ liệu cá nhân;
- tài nguyên tổ chức có owner rõ;
- policy organization không áp dụng lên personal scope.

### F-ACC-13 — Entitlement và license

Entitlement service trả về snapshot quyền đã tính toán, không để UI tự suy luận từ tên plan.

Ví dụ capability:

- `cloud.sync.settings`;
- `remote.relay`;
- `organization.create`;
- `team.seats.max`;
- `hosted.model.credits`;
- `marketplace.private`;
- `backup.encrypted`.

Snapshot gồm:

- subject;
- scope;
- feature key;
- state;
- limit;
- source;
- issued at;
- expires at;
- grace period;
- signature hoặc integrity proof.

Khi offline:

- dùng cache còn hạn;
- có grace period hợp lý;
- không khóa dữ liệu local;
- tính năng cloud mới có thể tạm dừng;
- hiển thị trạng thái rõ ràng.

### F-ACC-14 — Billing và hóa đơn

Billing là miền riêng, không nhúng logic nhà cung cấp vào renderer.

Yêu cầu tương lai:

- checkout qua browser hoặc hosted page;
- webhook có signature verification;
- event idempotency;
- mapping customer, subscription và organization;
- invoice history;
- cancel, resume và đổi plan;
- trial policy;
- proration policy;
- tax và địa chỉ billing theo yêu cầu pháp lý;
- không lưu full card data trong hệ thống Tomny;
- billing failure không xóa dữ liệu local.

Chưa hiển thị billing trong demo.

### F-ACC-15 — Bảo mật và lịch sử hoạt động

Người dùng xem được:

- đăng nhập thành công và thất bại đáng chú ý;
- thiết bị mới;
- đổi mật khẩu;
- đổi email;
- liên kết provider;
- bật hoặc tắt phương thức bảo mật;
- thu hồi session;
- export dữ liệu;
- yêu cầu xóa tài khoản;
- thay đổi membership quan trọng.

Audit entry không chứa password, token, secret hoặc nội dung workspace.

### F-ACC-16 — Export dữ liệu

Người dùng có thể yêu cầu export dữ liệu account.

Export phải:

- mô tả phạm vi;
- tạo bất đồng bộ;
- có thời hạn tải;
- yêu cầu re-authentication;
- mã hóa hoặc bảo vệ link;
- audit;
- không bao gồm secret không thể xuất an toàn;
- có manifest và schema version;
- tách account data với workspace content.

### F-ACC-17 — Xóa tài khoản

Luồng xóa gồm:

1. giải thích ảnh hưởng;
2. re-authentication;
3. xác nhận mạnh;
4. grace period nếu policy cho phép;
5. khóa đăng nhập;
6. hủy hoặc chuyển ownership tổ chức;
7. xử lý subscription;
8. xóa hoặc anonymize theo retention policy;
9. giữ audit tối thiểu nếu có nghĩa vụ;
10. thông báo hoàn tất.

Không cho phép xóa account nếu còn là owner duy nhất của tổ chức mà chưa xử lý ownership.

### F-ACC-18 — Offline và degraded mode

Khi account service lỗi:

- app local vẫn mở;
- local files, editor, conversation local và tools local vẫn hoạt động;
- account center hiển thị trạng thái tạm thời;
- không lặp toast liên tục;
- refresh retry có backoff;
- entitlement cache được dùng theo expiry;
- cloud-only actions bị chặn với lý do rõ;
- không tự đăng xuất chỉ vì timeout mạng ngắn.

### F-ACC-19 — Thông báo bảo mật

Kênh dự kiến:

- in-app;
- email;
- push khi mobile sẵn sàng.

Sự kiện cần thông báo:

- đăng nhập trên thiết bị mới;
- đổi password hoặc email;
- recovery;
- 2FA thay đổi;
- session bị thu hồi;
- export hoặc deletion request;
- hoạt động rủi ro cao.

### F-ACC-20 — Support và recovery review

Support chỉ được xem metadata tối thiểu và trạng thái quy trình. Mọi hành động nhạy cảm cần:

- lý do;
- operator identity;
- approval nếu cần;
- audit bất biến;
- thông báo người dùng;
- giới hạn thời gian;
- không có khả năng đọc nội dung cá nhân mặc định.

## 11. Kiến trúc thông tin giao diện tương lai

Account Center dự kiến gồm:

1. Tổng quan
2. Hồ sơ
3. Thiết bị và phiên
4. Đồng bộ và dữ liệu
5. Bảo mật
6. Tổ chức
7. Gói và thanh toán
8. Export và xóa tài khoản

Trong giai đoạn demo hiện tại, không tạo bất kỳ mục nào trong sidebar hoặc settings.

## 12. Trạng thái account phía client

| Trạng thái          | Ý nghĩa                                  |
| ------------------- | ---------------------------------------- |
| `local_only`        | Không liên kết account                   |
| `linking`           | Đang mở auth flow                        |
| `authenticated`     | Có session hợp lệ                        |
| `refreshing`        | Access token đang được làm mới           |
| `offline_cached`    | Mất mạng nhưng có cache hợp lệ           |
| `reauth_required`   | Cần đăng nhập lại cho hành động nhạy cảm |
| `suspended`         | Account bị hạn chế                       |
| `deletion_pending`  | Đang trong grace period xóa              |
| `signed_out`        | Đã thu hồi session                       |
| `error_recoverable` | Lỗi có thể retry                         |

State account không được dùng thay cho trạng thái app readiness. App local không phụ thuộc account state.

## 13. Mô hình kiến trúc mục tiêu

```text
Tomny Desktop / Web / Mobile
  |
  +-- Local Access Auth
  |     +-- WebUI password
  |     +-- Gateway session
  |     +-- Local permission
  |
  +-- Account Client
        +-- System browser auth flow
        +-- OS credential store
        +-- Device key
        +-- Account state cache
        +-- Consent manager
        +-- Entitlement cache
        |
        +-- Identity API
        +-- Device API
        +-- Sync API
        +-- Organization API
        +-- Entitlement API
        +-- Billing adapter
        +-- Audit and notification API
```

### 13.1 Phân lớp

| Lớp              | Trách nhiệm                                                  |
| ---------------- | ------------------------------------------------------------ |
| Renderer         | Hiển thị trạng thái, bắt đầu flow, không giữ refresh token   |
| Preload          | IPC có kiểu rõ, giới hạn surface                             |
| Main process     | System browser, deep link, OS credential store, device key   |
| Tomny Core       | Chỉ nhận account capability cần thiết, không sở hữu password |
| Account services | Identity, session, devices, consent, org, entitlement        |
| Sync service     | Dữ liệu đồng bộ đã được consent                              |
| Billing adapter  | Chuyển webhook thành entitlement events                      |
| Audit service    | Security events và operator actions                          |

## 14. Ranh giới với code hiện tại

Các thành phần hiện có liên quan nhưng không được tái sử dụng sai mục đích:

- `packages/desktop/src/renderer/hooks/context/AuthContext.tsx` hiện phục vụ auth WebUI và bypass desktop;
- `packages/desktop/src/renderer/pages/login/` là màn hình login WebUI;
- `packages/desktop/src/process/tomnigateway/webAuth.ts` là local web auth;
- `packages/desktop/src/process/tomnigateway/auth.ts` là gateway token validation;
- các OAuth driver hiện có chủ yếu phục vụ resource hoặc MCP provider.

Khi triển khai account sau này:

- tạo account context riêng;
- giữ WebUI auth context riêng;
- không đổi desktop thành unauthenticated chỉ vì chưa có cloud account;
- không redirect toàn app tới account login;
- không import account module vào Router trước activation gate;
- không reuse local admin user id làm account id;
- không migrate password hash local lên cloud;
- không expose account token qua `window` global.

## 15. Mô hình dữ liệu đề xuất

### 15.1 Identity domain

| Bảng                   | Trường chính                                               |
| ---------------------- | ---------------------------------------------------------- |
| `accounts`             | id, status, created_at, updated_at, deletion_requested_at  |
| `account_emails`       | id, account_id, normalized_email, verified_at, primary     |
| `password_credentials` | account_id, password_hash, algorithm, changed_at           |
| `external_identities`  | account_id, provider, provider_subject, linked_at          |
| `recovery_methods`     | account_id, type, status, added_at                         |
| `terms_acceptances`    | account_id, document_type, version, accepted_at            |
| `consents`             | account_id, purpose, category, version, state, recorded_at |

### 15.2 Session và device domain

| Bảng              | Trường chính                                                     |
| ----------------- | ---------------------------------------------------------------- |
| `devices`         | id, account_id, name, platform, public_key, status, last_seen_at |
| `sessions`        | id, account_id, device_id, created_at, expires_at, revoked_at    |
| `refresh_tokens`  | id, session_id, token_hash, family_id, rotated_at, used_at       |
| `auth_challenges` | id, type, subject, token_hash, expires_at, consumed_at           |
| `security_events` | id, account_id, device_id, event_type, risk, occurred_at         |

### 15.3 Organization domain

| Bảng                    | Trường chính                                                   |
| ----------------------- | -------------------------------------------------------------- |
| `organizations`         | id, name, status, created_at                                   |
| `memberships`           | organization_id, account_id, role, state                       |
| `invitations`           | id, organization_id, email, role, token_hash, expires_at       |
| `organization_policies` | organization_id, policy_key, value, version                    |
| `seats`                 | organization_id, account_id, source, active_from, active_until |

### 15.4 Entitlement và billing domain

| Bảng                    | Trường chính                                          |
| ----------------------- | ----------------------------------------------------- |
| `plans`                 | id, version, status                                   |
| `subscriptions`         | id, owner_type, owner_id, plan_id, status, period_end |
| `purchases`             | id, owner_type, owner_id, sku, status                 |
| `entitlement_sources`   | id, source_type, source_ref, validity                 |
| `entitlement_snapshots` | subject, scope, payload, issued_at, expires_at        |
| `billing_events`        | provider, event_id, type, received_at, processed_at   |

### 15.5 Nguyên tắc dữ liệu

- Email normalized có unique index phù hợp.
- Token chỉ lưu hash.
- PII được phân loại và hạn chế truy cập.
- Billing data tách schema hoặc service.
- Nội dung workspace không nằm trong identity database.
- Audit có retention riêng.
- Xóa mềm chỉ dùng khi có lý do; deletion workflow phải kết thúc bằng purge hoặc anonymization theo policy.
- Mọi bảng có migration version và audit timestamp.

## 16. API contract dự kiến

Base path ví dụ: `/v1/account`.

### 16.1 Public auth

| Method | Path                          | Mục đích               |
| ------ | ----------------------------- | ---------------------- |
| POST   | `/register`                   | Tạo yêu cầu đăng ký    |
| POST   | `/email/verify`               | Xác minh email         |
| POST   | `/email/resend`               | Gửi lại xác minh       |
| POST   | `/sessions`                   | Đăng nhập              |
| POST   | `/sessions/refresh`           | Xoay refresh token     |
| POST   | `/password/recovery`          | Bắt đầu recovery       |
| POST   | `/password/reset`             | Hoàn tất reset         |
| GET    | `/oauth/{provider}/authorize` | Bắt đầu OAuth          |
| POST   | `/oauth/{provider}/callback`  | Đổi authorization code |

### 16.2 Authenticated account

| Method | Path                   | Mục đích                  |
| ------ | ---------------------- | ------------------------- |
| GET    | `/me`                  | Lấy hồ sơ và trạng thái   |
| PATCH  | `/me`                  | Cập nhật hồ sơ            |
| GET    | `/sessions`            | Liệt kê phiên             |
| DELETE | `/sessions/{id}`       | Thu hồi phiên             |
| DELETE | `/sessions`            | Thu hồi tất cả phiên khác |
| GET    | `/devices`             | Liệt kê thiết bị          |
| PATCH  | `/devices/{id}`        | Đổi tên hoặc trust state  |
| DELETE | `/devices/{id}`        | Thu hồi thiết bị          |
| GET    | `/consents`            | Lấy consent               |
| PUT    | `/consents/{category}` | Cập nhật consent          |
| GET    | `/entitlements`        | Lấy snapshot quyền        |
| POST   | `/exports`             | Yêu cầu export            |
| POST   | `/deletion`            | Yêu cầu xóa               |
| DELETE | `/deletion`            | Hủy trong grace period    |

### 16.3 Organization

| Method | Path                                      | Mục đích        |
| ------ | ----------------------------------------- | --------------- |
| GET    | `/organizations`                          | Liệt kê tổ chức |
| POST   | `/organizations`                          | Tạo tổ chức     |
| GET    | `/organizations/{id}/members`             | Thành viên      |
| POST   | `/organizations/{id}/invitations`         | Mời             |
| PATCH  | `/organizations/{id}/members/{accountId}` | Đổi vai trò     |
| DELETE | `/organizations/{id}/members/{accountId}` | Xóa thành viên  |

### 16.4 Quy tắc API

- Versioned.
- Error code ổn định, message localize ở client.
- Idempotency key cho create và billing-sensitive action.
- Correlation id.
- Không trả password hash, raw token hoặc secret.
- Pagination cursor.
- ETag hoặc version cho update cạnh tranh.
- Rate limit header.
- Re-auth token cho hành động nhạy cảm.
- Scope và audience token rõ ràng.

## 17. Token và session

### 17.1 Access token

- thời hạn ngắn;
- audience cụ thể;
- scope tối thiểu;
- không chứa PII không cần thiết;
- ký bằng key có rotation;
- key id rõ;
- server kiểm tra account và session status cho action nhạy cảm.

### 17.2 Refresh token

- opaque random value;
- chỉ lưu hash server-side;
- rotate mỗi lần dùng;
- token family;
- reuse detection;
- gắn device và session;
- lưu OS credential store;
- không truyền tới renderer;
- thu hồi khi đổi password, device revoke hoặc risk event theo policy.

### 17.3 Device key

Mỗi thiết bị có thể tạo key pair cục bộ:

- private key trong OS secure storage;
- public key đăng ký server;
- ký proof cho device-sensitive flow;
- rotate hoặc revoke;
- không dùng cùng key với encryption vault nếu chưa có threat model.

## 18. Đồng bộ và mã hóa

### 18.1 Sync envelope

Mỗi record đồng bộ cần:

- category;
- schema version;
- record id;
- owner scope;
- device id;
- logical version;
- updated at;
- tombstone;
- ciphertext hoặc payload;
- integrity metadata;
- idempotency key.

### 18.2 Conflict policy

| Loại dữ liệu        | Policy gợi ý                                              |
| ------------------- | --------------------------------------------------------- |
| UI preference       | Last-write-wins có timestamp hợp lệ                       |
| Danh sách item      | Merge theo item id                                        |
| Automation          | Versioned document, yêu cầu user resolve khi conflict lớn |
| Conversation        | Append-only hoặc event sequence                           |
| Secret              | Không sync qua pipeline thường                            |
| Organization policy | Server authoritative                                      |

### 18.3 Encryption

- TLS là bắt buộc nhưng không được xem là đủ cho dữ liệu nhạy cảm.
- Cần quyết định server-side encryption hoặc end-to-end encryption theo category.
- Nếu E2EE, thiết kế recovery key và multi-device key distribution trước khi bật.
- Không quảng bá E2EE nếu server vẫn đọc được plaintext.
- Key backup phải có consent riêng.

## 19. Sự kiện miền

Ví dụ event:

- `account.registered`;
- `account.email_verified`;
- `account.profile_updated`;
- `session.created`;
- `session.refreshed`;
- `session.revoked`;
- `device.linked`;
- `device.revoked`;
- `consent.changed`;
- `sync.category_enabled`;
- `organization.created`;
- `organization.member_invited`;
- `organization.role_changed`;
- `entitlement.changed`;
- `billing.subscription_changed`;
- `account.export_requested`;
- `account.deletion_requested`;
- `account.deleted`.

Mỗi event có:

- event id;
- schema version;
- occurred at;
- actor;
- subject;
- causation id;
- correlation id;
- source service;
- data đã lọc PII;
- idempotency metadata.

## 20. Error model

Nhóm error ổn định:

| Nhóm           | Ví dụ                                              |
| -------------- | -------------------------------------------------- |
| Validation     | `invalid_email`, `weak_password`                   |
| Authentication | `invalid_credentials`, `session_expired`           |
| Authorization  | `insufficient_scope`, `organization_policy_denied` |
| Conflict       | `email_in_use`, `version_conflict`                 |
| Rate limit     | `too_many_attempts`                                |
| Risk           | `reauth_required`, `device_not_trusted`            |
| Account state  | `account_suspended`, `deletion_pending`            |
| Dependency     | `email_unavailable`, `billing_unavailable`         |
| Network        | client-generated offline/timeout state             |

UI không hiển thị raw server exception.

## 21. Bảo mật và threat model tối thiểu

Phải xem xét:

- credential stuffing;
- email enumeration;
- brute force;
- token theft;
- refresh reuse;
- session fixation;
- OAuth state injection;
- deep-link hijacking;
- CSRF trên WebUI;
- XSS lấy token;
- malicious local process;
- compromised device;
- account takeover;
- invitation abuse;
- organization privilege escalation;
- billing webhook spoofing;
- support insider abuse;
- sync poisoning;
- rollback attack;
- data exfiltration do consent sai;
- log chứa PII hoặc token.

Biện pháp nền tảng:

- rate limit nhiều lớp;
- password breach screening nếu phù hợp;
- passkey hoặc MFA;
- OS credential store;
- PKCE;
- exact redirect allowlist;
- token rotation;
- audit;
- risk-based reauth;
- least privilege;
- service-to-service identity;
- secret manager;
- security headers;
- dependency scanning;
- penetration test trước public;
- incident response runbook.

## 22. Quyền riêng tư và quản trị dữ liệu

### 22.1 Data classification

| Cấp          | Ví dụ                   | Yêu cầu                           |
| ------------ | ----------------------- | --------------------------------- |
| Public       | Plan name công khai     | Integrity                         |
| Internal     | Feature config          | Access control                    |
| Personal     | Email, display name     | Purpose limitation, retention     |
| Sensitive    | Security events, IP     | Restricted access                 |
| Secret       | Token, key              | Never log, secure storage         |
| User content | Conversation, workspace | Explicit consent, separate domain |

### 22.2 Retention

Retention phải định nghĩa theo category, không dùng một con số chung. Hết retention cần purge hoặc anonymize có kiểm chứng. Backup deletion có SLA riêng.

### 22.3 Analytics

- Không gửi email, token, path repo, prompt hoặc nội dung conversation.
- Account id trong analytics phải pseudonymous nếu cần.
- Consent analytics tách với consent sync.
- Có opt-out theo policy.
- Demo hiện tại không thêm event account giả.

## 23. Khả năng truy cập và i18n

Khi UI được triển khai:

- dùng Arco Design và semantic token theo luật repo;
- mọi text qua i18n;
- keyboard navigation;
- focus management;
- label và error rõ;
- không chỉ dùng màu để báo trạng thái;
- screen reader announcement cho auth progress;
- locale-aware date/time;
- timezone rõ trong security activity;
- không hardcode English error từ backend.

## 24. Kiểm thử bắt buộc

### 24.1 Unit

- state machine;
- token cache policy;
- consent transition;
- entitlement evaluation client;
- error mapping;
- account/local auth separation.

### 24.2 Contract

- API schema;
- error codes;
- refresh rotation;
- event version;
- webhook idempotency;
- export manifest.

### 24.3 Integration

- browser auth callback;
- OS credential store;
- device link;
- revoke;
- offline restart;
- token expiry;
- organization role;
- deletion workflow.

### 24.4 Security

- enumeration;
- brute force;
- replay;
- OAuth CSRF;
- deep-link abuse;
- refresh reuse;
- XSS token exposure;
- webhook spoof;
- privilege escalation;
- sensitive log scan.

### 24.5 Fault injection

- identity service down;
- email delayed;
- clock skew;
- network drop giữa refresh;
- duplicate webhook;
- database failover;
- stale entitlement;
- sync conflict;
- revoke trong khi thiết bị offline.

### 24.6 Demo regression

- app mở không có Account Center;
- không có route account;
- không có request tới account domain;
- không có migration account;
- không có telemetry account;
- login WebUI hiện tại không bị thay đổi.

## 25. Quan sát và vận hành

Metrics không chứa nội dung người dùng:

- auth success/failure rate;
- verification delivery latency;
- refresh success;
- session revoke latency;
- account recovery completion;
- device revoke completion;
- sync error theo category;
- entitlement freshness;
- webhook processing lag;
- export SLA;
- deletion SLA.

Alert:

- spike login failure;
- refresh reuse;
- email delivery outage;
- webhook signature failure;
- export leak risk;
- deletion backlog;
- cross-tenant authorization failure;
- unusual support action.

## 26. Kế hoạch tích hợp hoãn

### Giai đoạn D0 — Chỉ tài liệu

Đây là trạng thái hiện tại.

Được phép:

- cập nhật PRD;
- threat model;
- prototype ngoài runtime;
- contract test trong package cô lập nếu không import;
- nghiên cứu vendor;
- ADR.

Không được phép:

- thêm menu;
- thêm route;
- thêm AccountContext vào app;
- gọi API account;
- tạo database migration;
- thêm env bắt buộc;
- thêm email hoặc billing SDK vào bundle;
- hiển thị placeholder;
- thay đổi WebUI login;
- thay đổi startup.

### Giai đoạn D1 — Domain package cô lập

Chỉ bắt đầu khi được phê duyệt riêng.

- types và state machine thuần;
- không side effect;
- không import từ runtime;
- test độc lập;
- feature flag compile-time mặc định tắt;
- không ship credential.

### Giai đoạn D2 — Staging integration

- identity staging;
- system browser flow;
- secure token storage;
- account center chỉ trong internal build;
- data không production;
- security review.

### Giai đoạn D3 — Personal account beta

- đăng ký, xác minh, login, device;
- chưa sync nội dung nhạy cảm;
- chưa billing hoặc dùng sandbox;
- opt-in cohort.

### Giai đoạn D4 — Sync và entitlement

- category-by-category;
- consent;
- export/deletion;
- offline grace;
- monitoring.

### Giai đoạn D5 — Organization và commerce

- seat;
- org policy;
- billing production;
- support workflow;
- legal readiness.

## 27. Cổng kích hoạt

Không nối vào hệ thống nếu thiếu bất kỳ mục P0 nào:

- [ ] Identity service production-ready
- [ ] Domain và TLS
- [ ] Privacy policy
- [ ] Terms versioning
- [ ] Data map
- [ ] Retention policy
- [ ] Export workflow
- [ ] Deletion workflow
- [ ] Email verification
- [ ] Recovery
- [ ] Rate limiting
- [ ] Token rotation và revocation
- [ ] OS secure storage
- [ ] Device management
- [ ] Audit
- [ ] Incident response
- [ ] Staging contract tests
- [ ] Security review
- [ ] Feature flag mặc định tắt
- [ ] Demo regression pass
- [ ] Rollback plan
- [ ] Người chịu trách nhiệm vận hành

## 28. Quy tắc đảm bảo bản demo không bị ảnh hưởng

Trong repo hiện tại, tài liệu này là artifact duy nhất của chức năng.

Không được có:

- import từ `docs/prds/tomni-account.md`;
- route `/account`, `/register` hoặc `/signup`;
- item Account trong Sider;
- page Account trong settings;
- request nền tới account service;
- account database hoặc migration;
- account env bắt buộc;
- account SDK;
- popup yêu cầu đăng nhập;
- plan card;
- price;
- cloud sync switch;
- mock account giả như đã đăng nhập;
- seed user;
- thay đổi `AuthContext` desktop;
- đổi hành vi login WebUI.

Nếu một PR tương lai thêm bất kỳ mục nào trên, PR phải dẫn tới quyết định activation và cập nhật trạng thái tài liệu từ `DESIGN_ONLY`.

## 29. Tiêu chí hoàn thành của đặc tả

Tài liệu được xem là đủ cho giai đoạn thiết kế khi:

- phân biệt rõ local auth, account, device và entitlement;
- có luồng đăng ký, xác minh, login, recovery và revoke;
- có privacy, export và deletion;
- có device và organization model;
- có entitlement và billing boundary;
- có data model và API surface;
- có token và security model;
- có sync consent;
- có offline behavior;
- có test và operations plan;
- có deferred rollout;
- có demo isolation rule;
- không thay đổi runtime.

## 30. Open decisions

Các quyết định sau phải được khóa bằng ADR trước triển khai:

1. Identity tự xây hay dùng managed provider.
2. Password-only, passkey-first hay hybrid.
3. Provider OAuth nào được hỗ trợ.
4. Email vendor và deliverability ownership.
5. Account service deployment region.
6. Data residency.
7. Database và tenant isolation.
8. E2EE category nào.
9. Recovery key strategy.
10. Billing provider.
11. Plan và entitlement format.
12. Organization ownership transfer.
13. Grace period subscription.
14. Grace period deletion.
15. Retention theo category.
16. Support permission model.
17. Mobile deep-link scheme.
18. WebUI và account có liên kết trải nghiệm hay hoàn toàn tách.
19. Có cho nhiều account trên một desktop profile hay không.
20. Cách xử lý dữ liệu local khi đổi account.
21. Cách xử lý thiết bị dùng chung.
22. Có offline license file hay không.
23. Cơ chế ký entitlement cache.
24. Có self-hosted account server hay không.
25. Phạm vi telemetry được phép.

## 31. Quyết định cuối của giai đoạn hiện tại

Tomny Account là chức năng cần thiết cho tương lai public và thương mại hóa, nhưng chưa phù hợp để xuất hiện trong bản demo hiện tại.

Hành động được chốt:

- giữ app local-first và không account;
- không thêm UI hoặc code runtime;
- lưu đặc tả này làm nguồn chân lý;
- chỉ bắt đầu implementation khi có yêu cầu phê duyệt giai đoạn D1;
- mọi tích hợp phải qua cổng activation và security review.
