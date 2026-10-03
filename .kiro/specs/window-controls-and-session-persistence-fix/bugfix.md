# Bugfix Requirements Document

## Introduction

In the TomniHubOS desktop application, two interrelated usability and session defects degrade the desktop experience:

1. **Window Controls Invisibility**: On Windows (and Linux), the application uses a frameless window (`frame: false`), hiding native operating system titlebar controls. In several scenarios—notably on the Login screen and Universal Titlebar—the custom window controls (Minimize, Maximize/Restore, Close, and Restart) fail to appear because rendering is gated on secondary runtime indicators (such as backend port readiness) rather than direct desktop platform availability.
2. **Session Persistence Failure across Restarts**: When restarting the application via `bun run start:fast` or `bun run start`, previously authenticated sessions (both Supabase cloud sessions and local desktop sessions) fail to restore automatically. Expired Supabase access tokens are not refreshed via stored refresh tokens, local desktop sessions are rejected by demo mode validation restrictions, and remembered sessions fail to auto-authenticate, forcing users to log in again on every startup.

This requirements document defines the defect conditions, the required corrected behaviors, and the invariants that must remain unchanged.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN the application runs in a frameless window on Windows or Linux THEN the system fails to display custom window controls (Minimize, Maximize/Restore, Close, Restart) on the Login screen and Universal Titlebar if runtime checks gate visibility on backend sidecar port readiness or secondary markers.

1.2 WHEN the user restarts the application via `bun run start:fast` or `bun run start` with an existing Supabase session whose access token has expired THEN the system fails to refresh the access token using the stored refresh token and treats the user as unauthenticated, forcing a manual re-login.

1.3 WHEN the user restarts the application via `bun run start:fast` or `bun run start` with a saved local desktop session THEN the system rejects the persisted session due to demo mode verification restrictions and forces the user to log in again.

1.4 WHEN the application restarts after credentials were saved with "Remember Me" enabled THEN the system populates the login form fields but fails to automatically restore the active authenticated session, requiring the user to manually submit the login form.

### Expected Behavior (Correct)

2.1 WHEN the application runs in a frameless window on Windows or Linux THEN the system SHALL reliably render and display functional window controls (Minimize, Maximize/Restore, Close, Restart) on both the Login screen and Universal Titlebar based strictly on desktop platform availability, decoupled from backend sidecar port state.

2.2 WHEN the user restarts the application via `bun run start:fast` or `bun run start` with an existing Supabase session whose access token has expired THEN the system SHALL automatically refresh the access token using the stored refresh token and restore the authenticated session without forcing a manual re-login.

2.3 WHEN the user restarts the application via `bun run start:fast` or `bun run start` with a saved local desktop session THEN the system SHALL successfully restore the valid local session from secure storage and maintain authenticated status across restarts.

2.4 WHEN the application restarts after credentials were saved with "Remember Me" enabled or a valid session exists THEN the system SHALL automatically restore the user's authenticated session and navigate directly to the main workspace without requiring manual re-submission.

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a user explicitly performs a logout action THEN the system SHALL CONTINUE TO invalidate active session tokens, clear cached credentials, and redirect to the login screen.

3.2 WHEN a session token is genuinely revoked, invalid, or cannot be refreshed by the authentication provider THEN the system SHALL CONTINUE TO transition the user to unauthenticated state and show the login form with an informative error message.

3.3 WHEN the application runs on macOS in desktop mode THEN the system SHALL CONTINUE TO use native macOS traffic light window controls and suppress rendering custom top-right window controls.

3.4 WHEN the application runs in a browser or WebUI environment without Electron desktop APIs THEN the system SHALL CONTINUE TO hide custom desktop window controls.

3.5 WHEN a user clicks any window control button (Minimize, Maximize/Restore, Close, Restart) THEN the system SHALL CONTINUE TO dispatch the corresponding window operation through the Electron window controls bridge.
