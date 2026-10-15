# Sidebar Sessions SDK

For authors of `sandboxed-web` Package Apps that keep live sessions (tabs, documents, chats).

## What it does

Apps that report live sessions appear under the sidebar **Active** section. Each app is a collapsible row with its sessions listed underneath, and each session name is coloured by status. An app with zero sessions disappears from Active.

First-party Browser, Terminal and Chat also appear in Active, but the host reports those itself. They do not use this API.

## Permission

Declare `sidebar.sessions` in the manifest `permissions` array:

```json
{ "permissions": ["sidebar.sessions"] }
```

Without it Hub refuses the lease. The package only sees the generic `PACKAGE_CAPABILITY_SYSCALL_DENIED` answer, so check the manifest first if a report is denied.

## Reporting sessions

The capability is `sessions.report`. It goes through the same capability pipeline as `notifications.post`. From the sandboxed iframe, post to the parent window:

```js
parent.postMessage({
  type: 'tomni.capability.invoke',
  requestId: 'req-1',            // unique string, max 128 chars
  capability: 'sessions.report',
  args: { sessions: [ /* see fields below */ ] },
}, '*');
```

The host answers with:

```js
{ type: 'tomni.capability.result', requestId: 'req-1', result }
```

- On success `result.ok === true`. `result.data.accepted` is `true` if the list was applied, and `false` if it was silently ignored (malformed).
- On failure `result` is `{ ok: false, code }` and `code` is a stable error string. A missing permission, an inactive package and a lease problem all arrive as `PACKAGE_CAPABILITY_SYSCALL_DENIED`.

### Replace semantics

Each report **replaces** the app's whole list.

- An empty array removes the app from Active.
- The app id comes from the package identity, which the host determines. A `packageId` inside the payload is ignored.

## Session fields

| Field | Required | Notes |
| --- | --- | --- |
| `id` | yes | string, unique within the app, max 200 chars. Kept exactly as sent (no trimming), because the same id comes back in the focus request. A blank or longer id drops the session |
| `title` | yes | max 120 chars |
| `status` | yes | `working` \| `idle` \| `attention` \| `error` \| `suspended` |
| `lastActiveAt` | no | epoch milliseconds of the latest activity. Only drives the grey "Inactive" rule below |
| `icon` | no | lowercase letters, digits and hyphen, max 40, not a URL. Reserved: accepted and stored, but Hub does not draw a per-session icon yet |
| `group` | no | sub-group heading, max 80 |
| `detail` | no | short note, max 80 |

Limits and normalisation:

- Only the first 500 entries of a report are read; at most 50 sessions per app are kept. Extra sessions are dropped.
- `title`, `group` and `detail` are whitespace-collapsed and cut to the limits above.
- A session with an unreadable required field (`id`, `title`, or a `status` that is not one of the five values) is dropped on its own; the other sessions in the report are kept.
- Duplicate ids keep the last one.
- A non-empty report in which no session is readable is ignored as a whole: the previous list stays and `accepted` is `false`. Send `[]` to clear the list on purpose.

## Status meanings

| Status | Colour | Meaning |
| --- | --- | --- |
| `working` | blue | doing something, e.g. playing audio |
| `idle` | green | open but doing nothing |
| `attention` | yellow | needs the user to approve or interact |
| `error` | red | something failed |
| `suspended` | grey | the package itself has put the session to sleep to save resources |

Extra display rule: a session reported `idle` whose `lastActiveAt` is more than 5 minutes old is also drawn grey, with the label "Inactive".

Hub never suspends or closes anything. Suspending is entirely the package's job, and Hub only displays the state you report.

## Silent-skip rule

Hub never shows an error to the user for bad input. A malformed report, or a package that stops reporting, is simply ignored, and the previous list stays in place (see the rules above for what counts as unreadable). Check `result.data.accepted` if you want to detect a rejected report.

## Lifecycle

- Sessions are in-memory only. They are not saved across restarts.
- They are removed automatically when the package's last sandbox runtime closes, or when the package is revoked or disabled.
- After the app reopens, report again.

## Focus request

When the user clicks one of your sessions in the sidebar, Hub opens the app at `/apps/<packageId>/<moduleId>` and posts into the iframe once the document has loaded (and again on every later click, even on the same session):

```js
{ type: 'tomni.sessions.focus', sessionId: '<id>' }
```

Switch to that session. Ignoring the message is fine.

## Add and close from the sidebar (optional)

A report may carry an `actions` object next to `sessions` to say what the app can do on request:

```js
args: { sessions: [ /* ... */ ], actions: { create: true, close: true } }
```

- `actions.create === true`: Hub shows a "+" on the app row.
- `actions.close === true`: Hub shows an "x" on each of the app's sessions.
- Only the literal `true` counts. Anything else, or leaving `actions` out, means no button. Like the session list, `actions` is replaced by every report, so repeat it each time.

When the user presses a button, Hub posts a message into the iframe:

```js
{ type: 'tomni.sessions.create' }
{ type: 'tomni.sessions.close', sessionId: '<id>' }
```

React to the message (open a new tab or note, or close that session), then report your new list as usual. Hub never adds or closes anything itself, and the sidebar changes only when your next report arrives. Ignoring a message is fine: nothing happens and no error is shown. Hub only delivers these messages while the app is open in the Hub.

## Rate and size advice

- Report on change, not on a timer.
- Send at most about one message per second.
- Keep payloads small. Titles and details are cut anyway.

## Minimal example

The sandbox has no network access, and the host strips external scripts and applies a strict CSP, so use an inline script.

```html
<script>
  const sessions = new Map(); // id -> { id, title, status, lastActiveAt }
  let seq = 0;
  let docSeq = 1;
  let timer = null;

  function report() {
    timer = null;
    parent.postMessage({
      type: 'tomni.capability.invoke',
      requestId: 'sessions-' + (++seq),
      capability: 'sessions.report',
      args: {
        sessions: Array.from(sessions.values()),
        actions: { create: true, close: true }, // shows "+" on the row and "x" on each session
      },
    }, '*');
  }

  // Call after any change; coalesces bursts to about one message per second.
  function scheduleReport() {
    if (timer === null) timer = setTimeout(report, 1000);
  }

  function setSession(id, title, status) {
    sessions.set(id, { id, title, status, lastActiveAt: Date.now() });
    scheduleReport();
  }

  function closeSession(id) {
    sessions.delete(id);
    scheduleReport(); // an empty list removes the app from Active
  }

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'tomni.capability.result') {
      // msg.result.ok and msg.result.data.accepted tell you whether it applied.
      return;
    }
    if (msg.type === 'tomni.sessions.focus') {
      focusSession(msg.sessionId); // switch your UI to that session
      return;
    }
    if (msg.type === 'tomni.sessions.create') {
      setSession('doc-' + (++docSeq), 'Untitled', 'idle'); // then report (via scheduleReport)
      return;
    }
    if (msg.type === 'tomni.sessions.close' && typeof msg.sessionId === 'string') {
      closeSession(msg.sessionId);
    }
  });

  function focusSession(id) {
    /* your code: select the tab/document/chat with this id */
  }

  // Example usage
  setSession('doc-1', 'Quarterly report', 'idle');
</script>
```
