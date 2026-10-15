/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Service worker of a generated userscript extension that was granted `GM_xmlhttpRequest` (docs/platform/
 * repotopackage-design.md section 12.4). Built as text; nothing runs here.
 *
 * It is the only place a request leaves the extension, and it checks everything itself because the content script is
 * the userscript's own world:
 * - the sender must be this extension's own content script (`sender.id` and a tab);
 * - the URL must be http or https, carry no credentials, and name a host from `@connect` (a name also covers its
 *   subdomains; an IP must match exactly). The same hosts are the manifest `host_permissions`, which the person
 *   approved, so the browser enforces them a second time;
 * - cookies and other credentials are never sent, redirects are not followed (a redirect could leave the allow-list),
 *   forbidden headers are dropped, and the body, the time and the response size are capped.
 */

import { GM_XHR_MESSAGE, jsLiteral } from '@process/integrations/browserExtensions/userscript/gmRuntime';

const WORKER =
  String.raw`
var MAX_BODY = 1048576;
var MAX_RESPONSE = 5242880;
var MAX_HEADERS = 50;
var DEFAULT_TIMEOUT = 30000;
var MAX_TIMEOUT = 120000;
var METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'PATCH'];
var FORBIDDEN = /^(host|origin|referer|cookie|cookie2|set-cookie|content-length|connection|keep-alive|transfer-encoding|upgrade|via|proxy-.*|sec-.*)$/i;
var TOKEN = /^[!#$%&'*+.^_` +
  '`' +
  String.raw`|~0-9A-Za-z-]+$/;

function hostAllowed(host) {
  return HOSTS.some(function (allowed) {
    if (/^[0-9.]+$/.test(allowed)) return host === allowed;
    return host === allowed || host.endsWith('.' + allowed);
  });
}

async function readLimited(response) {
  if (!response.body) return '';
  var reader = response.body.getReader();
  var decoder = new TextDecoder();
  var total = 0;
  var text = '';
  for (;;) {
    var step = await reader.read();
    if (step.done) break;
    total += step.value.byteLength;
    if (total > MAX_RESPONSE) {
      await reader.cancel();
      throw new Error('too-large');
    }
    text += decoder.decode(step.value, { stream: true });
  }
  return text + decoder.decode();
}

async function perform(message) {
  var url;
  try {
    url = new URL(String(message.url));
  } catch (error) {
    return { ok: false, error: 'invalid-url' };
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username !== '' || url.password !== '') {
    return { ok: false, error: 'blocked-url' };
  }
  if (!hostAllowed(url.hostname.toLowerCase())) return { ok: false, error: 'blocked-host' };
  var method = String(message.method || 'GET').toUpperCase();
  if (METHODS.indexOf(method) === -1) return { ok: false, error: 'blocked-method' };
  var headers = {};
  var names = message.headers && typeof message.headers === 'object' ? Object.keys(message.headers) : [];
  if (names.length > MAX_HEADERS) return { ok: false, error: 'too-many-headers' };
  for (var i = 0; i < names.length; i += 1) {
    var name = names[i];
    var value = message.headers[name];
    if (!TOKEN.test(name) || typeof value !== 'string' || value.length > 8192) return { ok: false, error: 'invalid-header' };
    if (!FORBIDDEN.test(name)) headers[name] = value;
  }
  var body = method === 'GET' || method === 'HEAD' || typeof message.data !== 'string' ? undefined : message.data;
  if (body !== undefined && body.length > MAX_BODY) return { ok: false, error: 'body-too-large' };
  var limit = Number(message.timeout) > 0 ? Math.min(Number(message.timeout), MAX_TIMEOUT) : DEFAULT_TIMEOUT;
  var controller = new AbortController();
  var timedOut = false;
  var timer = setTimeout(function () {
    timedOut = true;
    controller.abort();
  }, limit);
  try {
    var response = await fetch(url.href, {
      method: method,
      headers: headers,
      body: body,
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      signal: controller.signal,
    });
    var text = await readLimited(response);
    var lines = [];
    response.headers.forEach(function (headerValue, headerName) {
      lines.push(headerName + ': ' + headerValue);
    });
    return {
      ok: true,
      status: response.status,
      statusText: response.statusText,
      finalUrl: response.url,
      responseHeaders: lines.join('\r\n'),
      responseText: text,
    };
  } catch (error) {
    if (timedOut) return { ok: false, error: 'timeout' };
    return { ok: false, error: error && error.message === 'too-large' ? 'too-large' : 'failed' };
  } finally {
    clearTimeout(timer);
  }
}

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (!sender || sender.id !== chrome.runtime.id || !sender.tab) return false;
  if (!message || typeof message !== 'object' || message.type !== XHR_TYPE) return false;
  perform(message).then(sendResponse, function () {
    sendResponse({ ok: false, error: 'failed' });
  });
  return true;
});
`;

/** The worker file for the given `@connect` hosts (already validated by `resolveConnects`). */
export const buildGmBackground = (hosts: readonly string[]): string =>
  [
    '// Generated by Tomny from a userscript. Do not edit.',
    `var HOSTS = ${jsLiteral(hosts)};`,
    `var XHR_TYPE = ${jsLiteral(GM_XHR_MESSAGE)};`,
    WORKER.trim(),
    '',
  ].join('\n');
