/**
 * Deterministic Tomni extensions for the pinned 9Router source tree.
 *
 * Exact replacements deliberately fail when upstream changes. This prevents a
 * new gateway build from silently losing per-session usage attribution.
 */
const fs = require('node:fs');
const path = require('node:path');

const replaceExact = (root, relativePath, before, after, expectedCount = 1) => {
  const filePath = path.join(root, relativePath);
  // Git may materialize the pinned source with CRLF on Windows. Normalize the
  // build-only checkout so exact semantic guards stay platform-independent.
  const source = fs.readFileSync(filePath, 'utf8').replace(/\r\n/gu, '\n');
  const count = source.split(before).length - 1;
  if (count !== expectedCount) {
    throw new Error(`Tomni gateway overlay expected ${expectedCount} match(es) in ${relativePath}, found ${count}.`);
  }
  fs.writeFileSync(filePath, source.split(before).join(after));
};

const breakdownRoute = `import { NextResponse } from "next/server";
import { getUsageHistory } from "@/lib/usageDb";
import { getApiKeys } from "@/lib/db/repos/apiKeysRepo.js";

export const dynamic = "force-dynamic";

const PERIOD_MS = { "24h": 86400000, "7d": 604800000, "30d": 2592000000, "60d": 5184000000 };
const MEASUREMENTS = new Set(["provider-reported", "gateway-estimated"]);

function maskApiKey(key) {
  if (!key || typeof key !== "string") return null;
  if (key.length <= 8) return key.charAt(0) + "***";
  return key.slice(0, 8) + "***";
}

function startDateFor(period) {
  if (period === "all") return undefined;
  if (period === "today") {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return start.toISOString();
  }
  return new Date(Date.now() - (PERIOD_MS[period] || PERIOD_MS["30d"])).toISOString();
}

export async function GET(request) {
  try {
    const period = new URL(request.url).searchParams.get("period") || "30d";
    const [history, apiKeys] = await Promise.all([
      getUsageHistory({ startDate: startDateFor(period) }),
      getApiKeys(),
    ]);
    const keyNames = new Map(apiKeys.map((entry) => [maskApiKey(entry.key), entry.name || entry.id]));
    const grouped = new Map();

    for (const entry of history) {
      const meta = entry.meta && typeof entry.meta === "object" ? entry.meta : {};
      const consumer = keyNames.get(entry.apiKeyMasked) || entry.apiKeyMasked || "Local (No API Key)";
      const sessionId = typeof meta.sessionId === "string" && meta.sessionId ? meta.sessionId : "unknown";
      const clientTool = typeof meta.clientTool === "string" && meta.clientTool ? meta.clientTool : "unknown";
      const measurement = MEASUREMENTS.has(meta.measurement) ? meta.measurement : "unknown";
      const key = JSON.stringify([consumer, sessionId, clientTool, measurement]);
      const current = grouped.get(key) || {
        consumer, sessionId, clientTool, measurement, requests: 0,
        promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0,
        providers: new Set(), models: new Set(), lastUsed: undefined,
      };
      const tokens = entry.tokens || {};
      current.requests += 1;
      current.promptTokens += tokens.prompt_tokens || tokens.input_tokens || 0;
      current.completionTokens += tokens.completion_tokens || tokens.output_tokens || 0;
      current.cachedTokens += tokens.cached_tokens || tokens.cache_read_input_tokens || 0;
      current.cost += entry.cost || 0;
      if (entry.provider) current.providers.add(entry.provider);
      if (entry.model) current.models.add(entry.model);
      if (!current.lastUsed || entry.timestamp > current.lastUsed) current.lastUsed = entry.timestamp;
      grouped.set(key, current);
    }

    const sessions = [...grouped.values()]
      .map((row) => ({ ...row, providers: [...row.providers], models: [...row.models] }))
      .sort((left, right) => String(right.lastUsed || "").localeCompare(String(left.lastUsed || "")))
      .slice(0, 200);
    return NextResponse.json({ sessions });
  } catch (error) {
    console.error("[TomniUsage] Failed to build session breakdown:", error);
    return NextResponse.json({ error: "Failed to build usage breakdown" }, { status: 500 });
  }
}
`;

const applyTomniOverlay = (sourceDir) => {
  replaceExact(
    sourceDir,
    'src/lib/db/repos/usageRepo.js',
    'stringifyJson(tokens), stringifyJson({}),',
    'stringifyJson(tokens), stringifyJson(entry.meta || {}),'
  );
  replaceExact(
    sourceDir,
    'src/lib/db/repos/usageRepo.js',
    'SELECT timestamp, provider, model, connectionId, apiKey, endpoint, cost, status, tokens FROM usageHistory ${where} ORDER BY id ASC',
    'SELECT timestamp, provider, model, connectionId, apiKey, endpoint, cost, status, tokens, meta FROM usageHistory ${where} ORDER BY id ASC'
  );
  replaceExact(
    sourceDir,
    'src/lib/db/repos/usageRepo.js',
    'cost: r.cost, status: r.status, tokens: parseJson(r.tokens, {}),',
    'cost: r.cost, status: r.status, tokens: parseJson(r.tokens, {}), meta: parseJson(r.meta, {}),'
  );
  replaceExact(
    sourceDir,
    'open-sse/handlers/chatCore/requestDetail.js',
    'export function saveUsageStats({ provider, model, tokens, connectionId, apiKey, endpoint, label = "USAGE", silent = false }) {',
    'export function saveUsageStats({ provider, model, tokens, connectionId, apiKey, endpoint, meta, label = "USAGE", silent = false }) {'
  );
  replaceExact(
    sourceDir,
    'open-sse/handlers/chatCore/requestDetail.js',
    'endpoint: endpoint || null\n  }).catch(() => {});',
    'endpoint: endpoint || null,\n    meta: meta || {}\n  }).catch(() => {});'
  );
  replaceExact(
    sourceDir,
    'open-sse/handlers/chatCore.js',
    'const sharedCtx = { provider, model, body, stream, translatedBody, finalBody, requestStartTime, connectionId, apiKey, clientRawRequest, onRequestSuccess, pxpipe: pxpipeSummary, reqTag, log };',
    'const usageMeta = { sessionId: sessionSeed || null, clientTool: clientTool || null, measurement: ["grok-web", "perplexity-web"].includes(provider) ? "gateway-estimated" : "provider-reported" };\n  const sharedCtx = { provider, model, body, stream, translatedBody, finalBody, requestStartTime, connectionId, apiKey, clientRawRequest, onRequestSuccess, pxpipe: pxpipeSummary, reqTag, log, usageMeta };'
  );

  const handlerFiles = [
    [
      'open-sse/handlers/chatCore/streamingHandler.js',
      'clientRawRequest, pxpipe, reqTag, log }) {',
      'clientRawRequest, pxpipe, reqTag, log, usageMeta }) {',
      1,
    ],
    [
      'open-sse/handlers/chatCore/nonStreamingHandler.js',
      'pxpipe, reqTag, log }) {',
      'pxpipe, reqTag, log, usageMeta }) {',
      1,
    ],
    [
      'open-sse/handlers/chatCore/sseToJsonHandler.js',
      'appendLog, reqTag, log }) {',
      'appendLog, reqTag, log, usageMeta }) {',
      1,
    ],
  ];
  for (const [file, before, after, count] of handlerFiles) replaceExact(sourceDir, file, before, after, count);

  for (const [file, before, after, count] of [
    [
      'open-sse/handlers/chatCore/streamingHandler.js',
      'endpoint: clientRawRequest?.endpoint, label: "STREAM USAGE", silent: true',
      'endpoint: clientRawRequest?.endpoint, meta: usageMeta, label: "STREAM USAGE", silent: true',
      1,
    ],
    [
      'open-sse/handlers/chatCore/nonStreamingHandler.js',
      'endpoint: clientRawRequest?.endpoint, silent: true',
      'endpoint: clientRawRequest?.endpoint, meta: usageMeta, silent: true',
      1,
    ],
    [
      'open-sse/handlers/chatCore/sseToJsonHandler.js',
      'endpoint: clientRawRequest?.endpoint, silent: true',
      'endpoint: clientRawRequest?.endpoint, meta: usageMeta, silent: true',
      2,
    ],
  ]) {
    replaceExact(sourceDir, file, before, after, count);
  }

  const routePath = path.join(sourceDir, 'src/app/api/usage/tomni-breakdown/route.js');
  fs.mkdirSync(path.dirname(routePath), { recursive: true });
  fs.writeFileSync(routePath, breakdownRoute);
};

module.exports = { applyTomniOverlay, breakdownRoute };
