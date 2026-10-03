# window-controls-and-session-persistence-fix Bugfix Design

## Overview

In the TomniHubOS desktop application, users on Windows and Linux experience two critical defects:

1. **Window Controls Invisibility**: Frameless windows (`frame: false`) fail to display custom window controls (Minimize, Maximize/Restore, Close, Restart) on the Login screen and Universal Titlebar because desktop platform detection is coupled to backend sidecar port readiness (`window.__backendPort`) rather than direct Electron desktop runtime availability (`Boolean(window.electronAPI)`).
2. **Session Persistence Failure across Restarts**: When restarting the application via `bun run start:fast` or `bun run start`, authenticated sessions fail to restore. Specifically:
   - Expired Supabase access tokens are not refreshed via stored `refresh_token` due to missing refresh logic in `supabaseAuth.ts` and `AuthContext.tsx`.
   - Saved local desktop accounts are rejected upon restart because `register` erroneously attaches `developmentLocalDemo: true` to sovereign local sessions, triggering `ACCOUNT_SESSION_INVALID` during `accountSession.restore()` when demo mode is not enabled.
   - "Remember Me" credentials saved in `localStorage` populate login form fields but fail to auto-authenticate and navigate to the main workspace.

This design specification formalizes the bug conditions, hypothesizes root causes, details the targeted fix implementation across renderer and process boundaries, and defines a comprehensive verification strategy combining unit tests, property-based tests, and integration tests.

## Glossary

- **Bug_Condition (C)**: The condition that triggers the defect:
  - For window controls: Running in an Electron desktop environment on Windows/Linux while backend port readiness is delayed or pending.
  - For session persistence: Restarting the application with an expired Supabase token, a saved local account session, or valid "Remember Me" credentials.
- **Property (P)**: The desired behavior:
  - Window controls are rendered and functional on Windows/Linux whenever running in Electron desktop, decoupled from backend port status.
  - Expired Supabase tokens are automatically refreshed via `refresh_token`.
  - Local desktop sessions persist across restarts without being gated on demo mode.
  - Remembered credentials or restored sessions automatically navigate to the main workspace.
- **Preservation**: Invariant behaviors that must remain unchanged:
  - macOS continues to use native traffic light controls and suppresses custom top-right controls.
  - WebUI / browser environments continue to hide desktop window controls.
  - Explicit user logout clears tokens, session state, and stored credentials.
  - Genuinely revoked/invalid tokens transition to the unauthenticated state.
  - Window control buttons continue to dispatch IPC events to Electron main.
- **isElectronDesktop**: Platform detection utility in `packages/desktop/src/renderer/utils/platform.ts`.
- **WindowControls**: React component in `packages/desktop/src/renderer/components/layout/WindowControls.tsx`.
- **accountSession**: Main process security service in `packages/desktop/src/process/services/security/accountSession/accountSessionService.ts`.
- **supabaseAuth**: Authentication client service in `packages/desktop/src/renderer/services/supabaseAuth.ts`.
- **AuthContext**: React context provider managing user authentication state in `packages/desktop/src/renderer/hooks/context/AuthContext.tsx`.

## Bug Details

### Bug Condition

The bugs manifest under two distinct runtime scenarios:

1. **Window Controls Defect**: When the application runs in a frameless window on Windows or Linux, `isElectronDesktop()` evaluates to `false` if `window.__backendPort` is undefined, `0`, or not yet ready. Consequently, `Titlebar` and `WindowControls` fail to render window control buttons, leaving the user with no means to minimize, maximize, restore, or close the window.
2. **Session Persistence Defect**: When the application restarts:
   - A stored Supabase session with `expires_at <= Date.now()` is skipped by `AuthContext.refresh()` because no call to `supabaseRefreshToken()` is made, treating the user as unauthenticated.
   - A stored local desktop session with `developmentLocalDemo: true` is rejected by `accountSessionService.ts` with `ACCOUNT_SESSION_INVALID` during `restore()` when `developmentLocalDemoEnabled` is false.
   - When credentials exist in `localStorage` with `rememberMe: 'true'`, `login/index.tsx` loads the credentials into state but requires the user to manually click the submit button.

**Formal Specification:**

```
FUNCTION isBugCondition(input)
  INPUT: input of type AppStateInput
  OUTPUT: boolean

  // Window Controls Bug Condition
  isWindowControlsBug := (input.platform IN ['win32', 'linux']
                          AND input.hasElectronAPI = true
                          AND (input.backendPort = undefined OR input.backendPort = 0)
                          AND input.windowControlsRendered = false)

  // Expired Supabase Session Bug Condition
  isSupabaseRefreshBug := (input.authProvider = 'supabase'
                           AND input.storedSession != null
                           AND input.storedSession.expiresAt <= input.currentTime
                           AND input.storedSession.refreshToken != null
                           AND input.authState = 'unauthenticated')

  // Local Session Rejection Bug Condition
  isLocalSessionRejectionBug := (input.authProvider = 'local'
                                 AND input.persistedLocalSession != null
                                 AND input.persistedLocalSession.issuer = 'tomny://local-account'
                                 AND input.developmentLocalDemoEnabled = false
                                 AND input.authState = 'unauthenticated')

  // Remember Me Auto-Navigation Bug Condition
  isRememberMeNavigationBug := (input.rememberMeEnabled = true
                                AND input.storedUsername != null
                                AND input.storedPassword != null
                                AND input.currentRoute = '/login'
                                AND input.userInteractionRequired = true)

  RETURN isWindowControlsBug
         OR isSupabaseRefreshBug
         OR isLocalSessionRejectionBug
         OR isRememberMeNavigationBug
END FUNCTION
```

### Examples

- **Example 1 (Window Controls on Login)**: User launches TomniHubOS on Windows 11 (`frame: false`). The login screen displays, but the backend sidecar is still initializing (`__backendPort` is `0`). `isElectronDesktop()` returns `false`. The top-right window controls (Minimize, Maximize, Close, Restart) are missing.
- **Example 2 (Window Controls in Titlebar)**: In the main workspace on Linux, `Titlebar` checks `isElectronDesktop()`. If `__backendPort` is unpopulated or delayed, `showWindowControls` is `false`, leaving the window without control buttons.
- **Example 3 (Expired Supabase Session on Restart)**: User logs in with Supabase credentials and closes the application. After 1 hour, the access token expires. The user launches the app via `bun run start:fast`. `AuthContext` finds `expiresAtMs <= Date.now()` and ignores the session without calling `refresh_token`. The user is forced to re-enter email and password.
- **Example 4 (Local Desktop Session Invalidation)**: User creates a local account "developer" and restarts via `bun run start`. The local session had `developmentLocalDemo: true` set by `register()`. On restart, `developmentLocalDemoEnabled` is `false`. `accountSession.restore()` throws `ACCOUNT_SESSION_INVALID`, clearing the session vault and forcing the user back to the login screen.
- **Example 5 (Remember Me Stalling on Login Screen)**: User enabled "Remember Me" on previous login. On app restart, username and password fields are populated, but the app remains on `/login` until the user manually clicks "Đăng nhập" (Log in).
- **Edge Case (macOS Invariant)**: On macOS, `isMacOS()` is `true`. Even though `hasElectronAPI` is `true`, custom window controls MUST NOT render because macOS uses native traffic light controls.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**

- Explicit logout (`logout()` in `AuthContext` or `signOut()` in `accountSession`) must continue to invalidate active tokens, remove stored session data, clear remembered credentials (when logging out), and redirect to `/login`.
- Genuinely revoked or invalid tokens (e.g., Supabase refresh token rejected with 400/401, or local session past `expiresAt`) must transition to `unauthenticated` state and display clear error feedback.
- On macOS, native traffic light window controls must continue to be used and custom top-right window controls must remain suppressed.
- In WebUI / browser environments (where `window.electronAPI` is undefined), custom desktop window controls must remain hidden.
- Clicking any window control button (Minimize, Maximize/Restore, Close, Restart) must continue to invoke the corresponding Electron IPC bridge method.

**Scope:**
All environments and inputs that do NOT involve the buggy conditions should be completely unaffected:

- macOS desktop window handling
- Remote WebUI browser access
- Normal active session usage before token expiration
- In-memory state transitions during an active authenticated session

## Hypothesized Root Cause

Based on codebase analysis, four distinct root causes have been identified:

1. **Flawed Platform Detection Helper (`packages/desktop/src/renderer/utils/platform.ts`)**:
   `isElectronDesktop()` was implemented as:

   ```ts
   export const isElectronDesktop = (): boolean => {
     return (
       typeof window !== 'undefined' &&
       Boolean(window.electronAPI) &&
       typeof (window as Window & { __backendPort?: number }).__backendPort === 'number'
     );
   };
   ```

   Checking `__backendPort` couples desktop platform identity to backend sidecar port readiness. Window controls operate over Electron IPC via preload (`window.electronAPI`), completely independent of the backend HTTP port.

2. **Incomplete Supabase Session Restoration (`packages/desktop/src/renderer/services/supabaseAuth.ts` and `AuthContext.tsx`)**:
   - `supabaseAuth.ts` lacks a `supabaseRefreshToken()` function to call `POST /auth/v1/token?grant_type=refresh_token`.
   - `AuthContext.tsx` in `refresh()` checks `if (expiresAtMs > Date.now())`. If false, it drops through without attempting to use `storedSupabase.refresh_token` to obtain a fresh access token.

3. **Erroneous Demo Flag on Local Accounts (`packages/desktop/src/process/bridge/index.ts` & `accountSessionService.ts`)**:
   - The `register` IPC handler in `bridge/index.ts` creates local sessions with `developmentLocalDemo: true as const`.
   - In `accountSessionService.ts`, `recordVerifiedSession()` checks:
     ```ts
     if (session.developmentLocalDemo === true && options.developmentLocalDemoEnabled !== true) {
       throw new AccountSessionError('ACCOUNT_SESSION_INVALID', 'Development local demo sessions are disabled.');
     }
     ```
     Legitimate local accounts (`issuer === 'tomny://local-account'`) are sovereign desktop accounts, not synthetic demo accounts, and must not be marked `developmentLocalDemo: true`.
   - Furthermore, `accountSessionService.ts` should treat `issuer === 'tomny://local-account'` as valid regardless of `developmentLocalDemoEnabled`.

4. **Missing Auto-Authentication for Remembered Credentials (`packages/desktop/src/renderer/pages/login/index.tsx`)**:
   `login/index.tsx` loads credentials from `localStorage` into component state on mount, but does not trigger `login()`. When `status === 'unauthenticated'` and remembered credentials exist, the login screen should automatically invoke `login()` and transition to `/guid` upon success.

## Correctness Properties

## Correctness Properties

Property 1: Bug Condition - Window Controls Desktop Availability

_For any_ runtime environment where the application runs in Electron desktop (`Boolean(window.electronAPI) === true`) on Windows or Linux (`isMacOS() === false`), the system SHALL render and display functional custom window controls (Minimize, Maximize/Restore, Close, Restart) on both the Login screen and Universal Titlebar, regardless of whether `__backendPort` is defined, `0`, or pending.

**Validates: Requirements 2.1**

Property 2: Bug Condition - Supabase Expired Access Token Refresh

_For any_ stored Supabase session where the access token is expired (`expires_at <= Date.now()`) and a valid `refresh_token` is present, the system SHALL call `supabaseRefreshToken()`, update secure storage with the newly issued access token and expiration, and restore the user to the `authenticated` state without requiring manual re-login.

**Validates: Requirements 2.2**

Property 3: Bug Condition - Local Desktop Session Persistence

_For any_ persisted local desktop session (`issuer === 'tomny://local-account'`), the system SHALL restore and validate the session across application restarts regardless of whether `developmentLocalDemoEnabled` is `true` or `false`, maintaining the `authenticated` state.

**Validates: Requirements 2.3**

Property 4: Bug Condition - Remembered Credentials Auto-Navigation

_For any_ application startup where "Remember Me" is enabled with valid stored credentials in `localStorage` and no active session is initially present, the system SHALL automatically authenticate the user and navigate to the main workspace (`/guid`) without requiring manual form submission.

**Validates: Requirements 2.4**

Property 5: Preservation - Explicit Logout and Revocation Handling

_For any_ explicit logout action or genuinely revoked/unrefreshable token, the system SHALL transition to the `unauthenticated` state, clear cached credentials and session tokens, and display the login screen with appropriate feedback.

**Validates: Requirements 3.1, 3.2**

Property 6: Preservation - Non-Desktop and macOS Invariants

_For any_ runtime environment running on macOS (`isMacOS() === true`) or in a browser/WebUI (`Boolean(window.electronAPI) === false`), the system SHALL suppress custom top-right window controls, preserving native macOS traffic light controls and standard web browser behavior.

**Validates: Requirements 3.3, 3.4**

Property 7: Preservation - Window Control Operations Dispatch

_For any_ user interaction with a rendered window control button (Minimize, Maximize/Restore, Close, Restart), the system SHALL invoke the corresponding `ipcBridge.windowControls` IPC provider.

**Validates: Requirements 3.5**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct, the following changes are required across the codebase:

#### 1. Platform Detection Decoupling

**File**: `packages/desktop/src/renderer/utils/platform.ts`
**Function**: `isElectronDesktop`
**Specific Changes**:

- Update `isElectronDesktop` to check strictly:
  ```ts
  export const isElectronDesktop = (): boolean => {
    return typeof window !== 'undefined' && Boolean(window.electronAPI);
  };
  ```
- Keep `__backendPort` validation isolated to backend-specific utilities (e.g., `getBackendPort()` in `httpBridge.ts`).

#### 2. Window Controls Component & Titlebar Consistency

**File**: `packages/desktop/src/renderer/components/layout/WindowControls.tsx`
**Function**: `WindowControls`
**Specific Changes**:

- Simplify `isDesktop` state initialization:
  ```ts
  const [isDesktop, setIsDesktop] = useState(() => isElectronDesktop());
  useEffect(() => {
    if (isElectronDesktop()) {
      setIsDesktop(true);
    }
  }, []);
  ```
- Ensure window controls rendering checks `isDesktop && !isMacOS()` so that macOS never renders custom controls even if called directly.

**File**: `packages/desktop/src/renderer/pages/guid/HubHome/index.tsx`
**Specific Changes**:

- Update window controls rendering to check `desktopRuntime && !isMacOS()`.

**File**: `packages/desktop/src/renderer/components/layout/Titlebar/index.tsx`
**Specific Changes**:

- `showWindowControls` already uses `isDesktopRuntime && !isMacRuntime`. With `isElectronDesktop()` decoupled from `__backendPort`, this will now reliably evaluate to `true` on Windows and Linux.

#### 3. Supabase Refresh Token Implementation

**File**: `packages/desktop/src/renderer/services/supabaseAuth.ts`
**Function**: `supabaseRefreshToken`
**Specific Changes**:

- Implement `supabaseRefreshToken(refreshToken?: string): Promise<SupabaseAuthResult>`:
  - Make `POST ${config.url}/auth/v1/token?grant_type=refresh_token` with `apikey` header and `{ refresh_token: token }` body.
  - On success, normalize `expires_at`, save new session via `saveSupabaseSession(session)`, and return `{ success: true, session, user }`.
  - On failure (400/401), call `clearSupabaseSession()` and return `{ success: false, message, source: 'supabase' }`.
  - On network error, return `{ success: false, message, source: 'network' }` without clearing the session (to allow offline/retry).

#### 4. AuthContext Session Refresh & Auto-Refresh Logic

**File**: `packages/desktop/src/renderer/hooks/context/AuthContext.tsx`
**Function**: `refresh`
**Specific Changes**:

- In `refresh()`:
  - When `isSupabaseConfigured()` and `storedSupabase` exists:
    - If `expiresAtMs > Date.now()`: immediately authenticate.
    - If `expiresAtMs <= Date.now()`: if `storedSupabase.refresh_token` is present, call `await supabaseRefreshToken(storedSupabase.refresh_token)`.
      - If refresh succeeds: update state to `authenticated` with refreshed user and return.
      - If refresh fails due to invalid/revoked token: clear session and proceed.
  - When `isDesktopRuntime`:
    - Query `window.electronAPI?.accountSession?.getStatus()`.
    - If `snapshot?.phase === 'authenticated'` and `snapshot.accountId`: set `authenticated`.

#### 5. Local Desktop Session Registration & Restoration

**File**: `packages/desktop/src/process/bridge/index.ts`
**Function**: `register` handler in `registerAccountAuthBridge`
**Specific Changes**:

- Remove `developmentLocalDemo: true as const` from the `localSession` object. A registered local account is a permanent local account, not a demo account:
  ```ts
  const localSession = {
    schemaVersion: 1 as const,
    accountId,
    subjectId: accountId,
    issuer: 'tomny://local-account',
    clientId: 'tomny-desktop-local',
    displayName: username,
    accessToken: 'local-desktop-token',
    idToken: 'local-desktop-token',
    expiresAt,
    verifiedAt: now.toISOString(),
    offlineLocalOnlyUntil: expiresAt,
  };
  ```

**File**: `packages/desktop/src/process/services/security/accountSession/accountSessionService.ts`
**Function**: `recordVerifiedSession` & `restore`
**Specific Changes**:

- In `recordVerifiedSession`: ensure the check `session.developmentLocalDemo === true && options.developmentLocalDemoEnabled !== true` applies ONLY when `session.developmentLocalDemo === true` AND `session.issuer !== 'tomny://local-account'`.
- In `restore`: for sessions with `session.issuer === 'tomny://local-account'`, ensure they are validated locally via `validateOnline` and restored cleanly without demo mode gating.

#### 6. Remember Me Auto-Authentication on Login Screen

**File**: `packages/desktop/src/renderer/pages/login/index.tsx`
**Function**: `LoginPage`
**Specific Changes**:

- Add auto-login effect:

  ```tsx
  useEffect(() => {
    if (!ready || status !== 'unauthenticated') return;
    const isRememberMe = localStorage.getItem(REMEMBER_ME_KEY) === 'true';
    if (!isRememberMe) return;

    const storedUsername = localStorage.getItem(REMEMBERED_USERNAME_KEY);
    const storedPassword = localStorage.getItem(REMEMBERED_PASSWORD_KEY);
    if (!storedUsername || !storedPassword) return;

    const username = deobfuscate(storedUsername);
    const password = deobfuscate(storedPassword);
    if (username && password) {
      setLoading(true);
      void login({ username, password, remember: true }).then((result) => {
        setLoading(false);
        if (result.success) {
          void navigate('/guid', { replace: true });
        }
      });
    }
  }, [ready, status, login, navigate]);
  ```

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach:

1. **Exploratory Bug Condition Checking**: Surface counterexamples demonstrating the defects on unfixed code (e.g., window controls hidden when `__backendPort` is undefined, expired Supabase token ignored without refresh, local session rejected on restore).
2. **Fix & Preservation Checking**: Verify that for all inputs where the bug condition holds, the fix produces the expected behavior, and for all other inputs, existing behavior is strictly preserved.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bugs BEFORE implementing the fixes to confirm root causes.

**Test Plan**:

- Write test verifying `isElectronDesktop()` returns `false` when `window.electronAPI` is present but `__backendPort` is undefined (reproducing Defect 1).
- Write test verifying `AuthContext.refresh()` transitions to `unauthenticated` when Supabase session access token is expired, even with a valid refresh token (reproducing Defect 2.1).
- Write test verifying `accountSession.restore()` fails when restoring a local session with `developmentLocalDemo: true` while `developmentLocalDemoEnabled` is `false` (reproducing Defect 2.2).
- Write test verifying `LoginPage` stays on `/login` with pre-filled fields when "Remember Me" credentials exist without auto-submitting (reproducing Defect 2.3).

**Expected Counterexamples**:

- `isElectronDesktop()` evaluates to `false` without `__backendPort`.
- `supabaseRefreshToken` is not called, leaving user unauthenticated.
- `accountSession.restore()` throws `ACCOUNT_SESSION_INVALID`.
- `LoginPage` requires manual click.

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed implementation produces the expected behavior.

**Pseudocode:**

```
FOR ALL input WHERE isBugCondition(input) DO
  result := system_fixed(input)
  ASSERT expectedBehavior(result)
END FOR
```

**Expected Results**:

- `isElectronDesktop()` returns `true` whenever `window.electronAPI` exists.
- `WindowControls` renders on Windows and Linux.
- Expired Supabase session calls `supabaseRefreshToken()`, restores session, and transitions to `authenticated`.
- Local desktop sessions restore cleanly across restarts without demo mode gating.
- Remembered credentials auto-authenticate and navigate to `/guid`.

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed implementation produces the exact same behavior as the original.

**Pseudocode:**

```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT system_original(input) = system_fixed(input)
END FOR
```

**Preservation Test Cases**:

1. **macOS Traffic Lights**: Verify `isMacOS() === true` suppresses custom window controls.
2. **WebUI / Browser**: Verify `window.electronAPI === undefined` hides custom window controls.
3. **Explicit Logout**: Verify calling `logout()` clears tokens and redirects to `/login`.
4. **Invalid / Revoked Tokens**: Verify invalid refresh tokens fail gracefully and show login errors.
5. **Window Controls Actions**: Verify clicking Minimize, Maximize, Close, and Restart dispatches IPC events.

### Unit Tests

- `packages/desktop/src/renderer/utils/platform.test.ts`: Test `isElectronDesktop`, `isMacOS`, `isWindows`, `isLinux` with various combinations of `window.electronAPI` and `__backendPort`.
- `packages/desktop/src/renderer/services/supabaseAuth.test.ts`: Test `supabaseRefreshToken` for successful token renewal, 401 invalid refresh token, and network error resilience.
- `packages/desktop/src/process/services/security/accountSession/accountSessionService.test.ts`: Test `restore()` and `recordVerifiedSession()` with `issuer: 'tomny://local-account'` when `developmentLocalDemoEnabled` is `false`.
- `packages/desktop/src/renderer/components/layout/WindowControls.test.tsx`: Test rendering on Windows/Linux vs. macOS, and clicking buttons triggers IPC bridge methods.

### Property-Based Tests

- **Platform Invariant Property**: For random operating system user agents and `electronAPI` configurations, window controls are rendered IF AND ONLY IF `hasElectronAPI === true && !isMacOS`.
- **Token Refresh Property**: For random token expiration timestamps (`expires_at`), if `expires_at <= now` and `refresh_token` is valid, session refresh is always attempted and succeeds.
- **Local Account Issuer Invariant**: For arbitrary local usernames, local sessions are always recognized as sovereign (`tomny://local-account`) and persist across restarts without demo mode dependencies.

### Integration Tests

- Full launch simulation on Windows/Linux: launch app, verify window controls are visible on login screen and universal titlebar before backend port is resolved.
- Full restart cycle with Supabase: sign in, simulate token expiration, restart app, verify automatic refresh and landing on `/guid`.
- Full restart cycle with Local Account: register local user, restart app with `bun run start`, verify automatic session restoration to `/guid`.
- Full restart cycle with Remember Me: save credentials with Remember Me, restart app, verify automatic login and navigation to `/guid`.
