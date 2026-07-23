#!/usr/bin/env node
/** Deterministic Codex app-server JSONL fixture with provider-side thread history. */
const readline = require('node:readline');

let threadCounter = 0;
let turnCounter = 0;
let credentialFailureEmitted = false;
const promptsByThread = new Map();

function sendResponse(id, result) {
  process.stdout.write(`${JSON.stringify({ id, result })}\n`);
}

function sendNotification(method, params) {
  process.stdout.write(`${JSON.stringify({ method, params })}\n`);
}

function promptText(input) {
  if (!Array.isArray(input)) return 'unknown';
  const text = input.find((item) => item && item.type === 'text');
  return typeof text?.text === 'string' ? text.text : 'unknown';
}

function handle(message) {
  const { id, method, params = {} } = message;
  if (method === 'initialize') {
    sendResponse(id, {});
    return;
  }
  if (method === 'model/list') {
    sendResponse(id, { data: [] });
    return;
  }
  if (method === 'thread/start') {
    threadCounter += 1;
    const threadId = `fake-thread-${threadCounter}`;
    promptsByThread.set(threadId, []);
    sendResponse(id, { thread: { id: threadId } });
    return;
  }
  if (method === 'turn/start') {
    turnCounter += 1;
    const threadId = params.threadId || 'unknown-thread';
    const current = promptText(params.input);
    if (current === 'FAIL_ONCE_NO_ACTIVE_CREDENTIALS' && !credentialFailureEmitted) {
      credentialFailureEmitted = true;
      const turnId = `fake-turn-${turnCounter}`;
      sendResponse(id, { turn: { id: turnId } });
      sendNotification('turn/completed', {
        threadId,
        turn: {
          id: turnId,
          status: 'failed',
          error: { message: 'unexpected status 404 Not Found: No active credentials for provider: openai' },
        },
      });
      return;
    }
    const history = [...(promptsByThread.get(threadId) || []), current];
    promptsByThread.set(threadId, history);
    const turnId = `fake-turn-${turnCounter}`;
    sendResponse(id, { turn: { id: turnId } });
    sendNotification('item/agentMessage/delta', {
      threadId,
      turnId,
      delta: `Fake response to ${threadId}: ${history.join(' | ')}`,
    });
    sendNotification('turn/completed', {
      threadId,
      turn: { id: turnId, status: 'completed' },
    });
    return;
  }
  if (method === 'turn/interrupt') {
    sendResponse(id, {});
    return;
  }
  if (id !== undefined) {
    process.stdout.write(
      `${JSON.stringify({ id, error: { code: -32601, message: `Method not found: ${String(method)}` } })}\n`
    );
  }
}

const stdin = readline.createInterface({ input: process.stdin, terminal: false });
stdin.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    handle(JSON.parse(trimmed));
  } catch {
    /* Ignore malformed test input. */
  }
});
process.stdin.resume();
