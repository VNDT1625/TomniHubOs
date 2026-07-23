const SECRET_CAPTURE_WORLD_ID = 1002;
const MAX_CAPTURED_SECRET_LENGTH = 32_768;
const MASKED_SECRET = /^[\s*\u2022\u25cf\u25a0\u00b7]+$/u;
const TEXTUAL_MASK = /^\s*(?:\[?(?:redacted|masked|hidden)\]?|<redacted>)\s*$/iu;
const PARTIAL_MASK = /[*\u2022\u25cf\u25a0\u00b7]{3,}/u;
const FORBIDDEN_SELECTORS = new Set(['*', 'html', 'body', ':root', 'html *', 'body *']);

export type SecretBrowserCaptureContents = {
  getURL(): string;
  executeJavaScriptInIsolatedWorld(worldId: number, scripts: Array<{ code: string }>): Promise<unknown>;
};

export type SecretBrowserCaptureRequest = {
  target: string;
  selector: string;
};

const exactHostname = (url: string): string | undefined => {
  try {
    return new URL(url).hostname.toLowerCase() || undefined;
  } catch {
    return undefined;
  }
};

/**
 * Read one browser field in an isolated world while checking the exact hostname
 * in the same renderer invocation. The returned plaintext must stay inside the
 * trusted Main-process capture pipeline and must never be logged or serialized
 * into an MCP response.
 */
export const captureBrowserSecretValue = async (
  contents: SecretBrowserCaptureContents,
  request: SecretBrowserCaptureRequest
): Promise<string> => {
  const target = request.target.trim().toLowerCase();
  const selector = request.selector.trim();
  if (
    !target ||
    !selector ||
    FORBIDDEN_SELECTORS.has(selector.toLowerCase()) ||
    exactHostname(contents.getURL()) !== target
  ) {
    throw new Error('Secret capture failed.');
  }

  const script = `(() => {
    try {
      const expectedTarget = ${JSON.stringify(target)};
      if (location.hostname.toLowerCase() !== expectedTarget) return null;
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) return null;
      const semantic = [
        element.id,
        element.getAttribute('name'),
        element.getAttribute('aria-label'),
        element.getAttribute('autocomplete'),
        element.getAttribute('data-testid'),
        element.getAttribute('data-secret'),
        element.className,
      ].filter((part) => typeof part === 'string').join(' ');
      const explicitSecretElement = /(?:secret|token|password|private[-_ ]?key|credential|api[-_ ]?key)/i.test(semantic);
      let value = null;
      if (element instanceof HTMLInputElement) {
        if (element.type === 'file' || (element.type !== 'password' && !explicitSecretElement)) return null;
        value = element.value;
      } else if (element instanceof HTMLTextAreaElement) {
        if (!explicitSecretElement) return null;
        value = element.value;
      } else if (element instanceof HTMLElement) {
        if (!(element instanceof HTMLPreElement) && !(element instanceof HTMLCodeElement) && !explicitSecretElement) {
          return null;
        }
        if (element.childElementCount > 4) return null;
        value = element.textContent;
      }
      return typeof value === 'string' ? value : null;
    } catch {
      return null;
    }
  })()`;

  let value: unknown;
  try {
    value = await contents.executeJavaScriptInIsolatedWorld(SECRET_CAPTURE_WORLD_ID, [{ code: script }]);
  } catch {
    throw new Error('Secret capture failed.');
  }
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_CAPTURED_SECRET_LENGTH ||
    MASKED_SECRET.test(value) ||
    TEXTUAL_MASK.test(value) ||
    PARTIAL_MASK.test(value)
  ) {
    throw new Error('Secret capture failed.');
  }
  return value;
};
