/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The small runtime that gives a userscript its `GM_*` functions (docs/platform/repotopackage-design.md section
 * 12.4). It is text: this module builds the content script that wraps the script, and never evaluates anything.
 *
 * The wrapper runs in the extension's isolated world, so the page cannot see or call the runtime. Values live in
 * `chrome.storage.local` of the generated extension (one extension per userscript, so scripts never share values) and
 * are loaded before the script starts, because `GM_getValue` is synchronous. `GM_xmlhttpRequest` sends a message to
 * the generated background worker, which holds the `@connect` allow-list (see gmBackground.ts).
 *
 * The wrapper is NOT a security boundary against the script itself: the script runs in the same world and could call
 * `chrome.*` directly. What bounds it is the manifest (the permissions and host permissions the person approved) and
 * the background worker's own checks. The functions are handed to the script as parameters only when granted.
 */

import { GM_PARAMETER_NAMES, type SupportedGrant } from '@process/integrations/browserExtensions/userscript/gmGrants';

/** Message type shared by the content-script runtime and the background worker. */
export const GM_XHR_MESSAGE = 'tomny-gm-xhr';

const BACKSLASH = String.fromCharCode(92);

/** JSON that is also safe inside any JavaScript source text. */
export const jsLiteral = (value: unknown): string =>
  JSON.stringify(value)
    .replaceAll('<', BACKSLASH + 'u003c')
    .replaceAll(String.fromCharCode(0x2028), BACKSLASH + 'u2028')
    .replaceAll(String.fromCharCode(0x2029), BACKSLASH + 'u2029');

const RUNTIME = String.raw`
var PREFIX = 'gmv:';
var MAX_KEY = 256;
var MAX_VALUE = 262144;
var MAX_KEYS = 1000;
var values = new Map();
var area = null;
try {
  area = chrome.storage && chrome.storage.local ? chrome.storage.local : null;
} catch (error) {
  area = null;
}

function can(name) {
  return GRANTED.indexOf(name) !== -1;
}

function store(operation) {
  try {
    if (area) operation(area);
  } catch (error) {
    console.error('[userscript] storage', error);
  }
}

function copy(value) {
  return value !== null && typeof value === 'object' ? JSON.parse(JSON.stringify(value)) : value;
}

function removeValue(key) {
  values.delete(key);
  store(function (a) {
    a.remove(PREFIX + key);
  });
}

var api = {
  GM_info: INFO,
  GM_getValue: function (name, fallback) {
    var key = String(name);
    return values.has(key) ? copy(values.get(key)) : fallback;
  },
  GM_setValue: function (name, value) {
    var key = String(name);
    if (key.length === 0 || key.length > MAX_KEY) throw new RangeError('GM_setValue: invalid name length');
    var json = JSON.stringify(value);
    if (json === undefined) {
      removeValue(key);
      return;
    }
    if (json.length > MAX_VALUE) throw new RangeError('GM_setValue: value is too large');
    if (!values.has(key) && values.size >= MAX_KEYS) throw new RangeError('GM_setValue: too many values');
    var parsed = JSON.parse(json);
    values.set(key, parsed);
    store(function (a) {
      var item = {};
      item[PREFIX + key] = parsed;
      a.set(item);
    });
  },
  GM_deleteValue: function (name) {
    removeValue(String(name));
  },
  GM_listValues: function () {
    return Array.from(values.keys());
  },
  GM_addStyle: function (css) {
    var element = document.createElement('style');
    element.textContent = String(css);
    (document.head || document.documentElement).appendChild(element);
    return element;
  },
  GM_log: function () {
    var parts = ['[' + INFO.script.name + ']'];
    for (var i = 0; i < arguments.length; i += 1) parts.push(arguments[i]);
    console.log.apply(console, parts);
  },
  GM_setClipboard: function (text) {
    var value = String(text).slice(0, 1048576);
    var fallback = function () {
      var field = document.createElement('textarea');
      field.value = value;
      field.style.cssText = 'position:fixed;top:-1000px;opacity:0';
      (document.body || document.documentElement).appendChild(field);
      field.select();
      try {
        document.execCommand('copy');
      } catch (error) {
        console.error('[userscript] clipboard', error);
      }
      field.remove();
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(value).catch(fallback);
    } else {
      fallback();
    }
  },
  GM_xmlhttpRequest: function (details) {
    if (!details || typeof details !== 'object' || typeof details.url !== 'string') {
      throw new TypeError('GM_xmlhttpRequest: details.url is required');
    }
    var url = new URL(details.url, location.href).href;
    var headers = {};
    if (details.headers && typeof details.headers === 'object') {
      Object.keys(details.headers).forEach(function (name) {
        headers[name] = String(details.headers[name]);
      });
    }
    var finished = false;
    var fire = function (name, payload) {
      if (typeof details[name] !== 'function') return;
      try {
        details[name](payload);
      } catch (error) {
        console.error('[userscript] ' + name, error);
      }
    };
    chrome.runtime.sendMessage(
      {
        type: XHR_TYPE,
        method: String(details.method || 'GET').toUpperCase(),
        url: url,
        headers: headers,
        data: typeof details.data === 'string' ? details.data : null,
        timeout: Number(details.timeout) || 0,
      },
      function (reply) {
        var failed = chrome.runtime.lastError;
        if (finished) return;
        finished = true;
        if (failed || !reply || reply.ok !== true) {
          var code = reply && reply.error ? String(reply.error) : 'failed';
          var problem = { error: code, status: 0, readyState: 4, finalUrl: url, responseText: '' };
          fire(code === 'timeout' ? 'ontimeout' : 'onerror', problem);
          fire('onloadend', problem);
          return;
        }
        var result = {
          status: reply.status,
          statusText: reply.statusText,
          finalUrl: reply.finalUrl,
          responseHeaders: reply.responseHeaders,
          responseText: reply.responseText,
          readyState: 4,
          response: reply.responseText,
        };
        if (details.responseType === 'json') {
          try {
            result.response = JSON.parse(reply.responseText);
          } catch (error) {
            result.response = null;
          }
        }
        fire('onload', result);
        fire('onloadend', result);
      }
    );
    return {
      abort: function () {
        if (finished) return;
        finished = true;
        fire('onabort', {});
      },
    };
  },
};

function load(done) {
  var ready = false;
  var finish = function () {
    if (ready) return;
    ready = true;
    done();
  };
  if (!area) {
    finish();
    return;
  }
  var timer = setTimeout(finish, 3000);
  try {
    area.get(null, function (items) {
      clearTimeout(timer);
      if (!ready && items && typeof items === 'object') {
        Object.keys(items).forEach(function (key) {
          if (key.indexOf(PREFIX) === 0 && values.size < MAX_KEYS) values.set(key.slice(PREFIX.length), items[key]);
        });
      }
      finish();
    });
  } catch (error) {
    clearTimeout(timer);
    finish();
  }
}

function runScript(body) {
  load(function () {
    var args = PARAMETERS.map(function (name) {
      return can(name) ? api[name] : undefined;
    });
    try {
      body.apply(window, args);
    } catch (error) {
      console.error('[' + INFO.script.name + ']', error);
    }
  });
}
`;

export type WrapperInput = Readonly<{
  /** Plain data shown to the script as `GM_info`. */
  info: Readonly<Record<string, unknown>>;
  granted: readonly SupportedGrant[];
  /** Text of the local `@require` files, in order. */
  requires: readonly string[];
  /** The userscript, byte for byte (a leading byte-order mark is dropped). */
  source: string;
}>;

const stripBom = (text: string): string => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

/**
 * The single content-script file for a userscript that uses `GM_*`. The script and its local `@require` files are
 * placed unmodified inside one function whose parameters are the `GM_*` names (the ones not granted are `undefined`),
 * so required libraries see the same functions as the script, as in a userscript manager. The function body is not
 * in strict mode: a userscript is not written for it unless it asks for it itself.
 */
export const buildGmContentScript = (input: WrapperInput): string => {
  const body = [...input.requires, input.source].map((text) => `${stripBom(text)}\n`).join('');
  return [
    '// Generated by Tomny from a userscript. Do not edit.',
    '(function () {',
    `var INFO = ${jsLiteral(input.info)};`,
    `var GRANTED = ${jsLiteral(input.granted)};`,
    `var PARAMETERS = ${jsLiteral(GM_PARAMETER_NAMES)};`,
    `var XHR_TYPE = ${jsLiteral(GM_XHR_MESSAGE)};`,
    RUNTIME.trim(),
    `runScript(function (${GM_PARAMETER_NAMES.join(', ')}) {`,
    body.trimEnd(),
    '});',
    '})();',
    '',
  ].join('\n');
};
