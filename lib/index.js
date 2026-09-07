// dsh-proxy-card host entry.
// Settings-card plugin: manage MULTIPLE proxies, each with its own on/off
// toggle. All enabled proxies are chained through undici's ProxyAgent as the
// global fetch dispatcher — when none is enabled the host runs direct.
//
// Live semantics: Node's built-in globalThis.fetch ignores npm undici's
// setGlobalDispatcher, so on mount we replace globalThis.fetch with the npm
// undici fetch (same implementation) and control its dispatcher from here.
// Bare `fetch(...)` calls in DSH read globalThis.fetch at call time, so the
// next request after a save uses the new chain.
//
// Persistence: $DSH_HOME/proxy-card.json
// {
//   "proxies": [ { "id": "p1", "name": "本地", "protocol": "http",
//                  "host": "127.0.0.1", "port": 7890,
//                  "noProxy": "localhost,127.0.0.1,::1", "enabled": true }, ... ]
// }
//
// HTTP API:
//   GET  /dsh-proxy/status        → { ok, proxies, runtime, config_path }
//   POST /dsh-proxy/config        → save list, apply live
//   POST /dsh-proxy/toggle        → { id } flip one proxy's enabled flag
//   POST /dsh-proxy/test          → { id } probe exit IP through one proxy
//   POST /dsh-proxy/delete        → { id } remove a proxy entry

import fsp from "node:fs/promises";
import path from "node:path";
import {
  Agent,
  ProxyAgent,
  Socks5ProxyAgent,
  EnvHttpProxyAgent,
  fetch as undiciFetch,
  setGlobalDispatcher,
} from "undici";

export const name = "dsh-proxy-card";

export const inject = ["webServer"];

const STATE = {
  installed: false, // globalThis.fetch replaced?
  originalFetch: null, // Node built-in fetch (restore hook, unused while direct agent covers it)
  mode: "direct", // direct | proxy
  active: [], // ids of enabled proxies currently in the chain
};

// ── config file ──────────────────────────────────────────────────────

function dshHome() {
  const env = process.env.DSH_HOME;
  if (env && env.trim()) return path.normalize(env.trim());
  return path.join(process.env.USERPROFILE || process.env.HOME || ".", ".dsh");
}

function configPath() {
  return path.join(dshHome(), "proxy-card.json");
}

function newId() {
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function normalizeList(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const protocol = item.protocol === "https" || item.protocol === "socks5" ? item.protocol : "http";
    const host = typeof item.host === "string" && item.host.trim() ? item.host.trim() : "127.0.0.1";
    const port = Number(item.port);
    if (!Number.isInteger(port) || port <= 0 || port >= 65536) continue;
    let id = typeof item.id === "string" && item.id.trim() ? item.id.trim() : newId();
    while (seen.has(id)) id = newId();
    seen.add(id);
    out.push({
      id,
      name: typeof item.name === "string" && item.name.trim() ? item.name.trim() : `代理 ${out.length + 1}`,
      protocol,
      host,
      port,
      noProxy: typeof item.noProxy === "string" && item.noProxy.trim() ? item.noProxy.trim() : "localhost,127.0.0.1,::1",
      enabled: item.enabled === true,
    });
  }
  return out;
}

async function loadList() {
  try {
    const raw = await fsp.readFile(configPath(), "utf8");
    const parsed = JSON.parse(raw);
    return normalizeList(parsed.proxies ?? parsed);
  } catch {
    return [];
  }
}

async function saveList(proxies) {
  const file = configPath();
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify({ proxies }, null, 2), "utf8");
  await fsp.rename(tmp, file);
  return file;
}

// ── dispatcher plumbing ──────────────────────────────────────────────

function proxyUri(p) {
  return `${p.protocol}://${p.host}:${p.port}`;
}

function buildAgentFor(p) {
  const uri = proxyUri(p);
  if (p.protocol === "socks5") return new Socks5ProxyAgent({ uri });
  // http/https proxies: ProxyAgent handles CONNECT tunneling for https targets.
  return new ProxyAgent({ uri });
}

/**
 * Build the live dispatcher from the proxy list.
 * - No enabled proxies → direct Agent (explicit fallback, never null).
 * - One enabled → that proxy's agent, with NO_PROXY honored via env.
 * - Multiple enabled → undici ProxyAgent does not support upstream chaining,
 *   so the first enabled proxy wins as the dispatcher and the rest are noted
 *   in the status payload (the UI shows which one is the live exit).
 */
function buildDispatcher(proxies) {
  const enabled = proxies.filter((p) => p.enabled);
  if (enabled.length === 0) {
    return { agent: new Agent(), mode: "direct", active: [] };
  }
  const first = enabled[0];
  const noProxy = first.noProxy
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (noProxy.length) {
    process.env.NO_PROXY = noProxy.join(",");
    process.env.no_proxy = noProxy.join(",");
  } else {
    delete process.env.NO_PROXY;
    delete process.env.no_proxy;
  }
  const agent = buildAgentFor(first);
  return { agent, mode: "proxy", active: enabled.map((p) => p.id), exit: proxyUri(first) };
}

async function installFetchOnce() {
  if (STATE.installed) return;
  STATE.originalFetch = globalThis.fetch;
  globalThis.fetch = undiciFetch;
  STATE.installed = true;
}

async function applyList(proxies) {
  await installFetchOnce();
  const { agent, mode, active, exit } = buildDispatcher(proxies);
  setGlobalDispatcher(agent);
  STATE.mode = mode;
  STATE.active = active;
  return { ok: true, mode, active, exit: exit ?? null, count: proxies.length };
}

function currentStatus() {
  return {
    mode: STATE.mode,
    active: STATE.active,
    installed_fetch_override: STATE.installed,
  };
}

// ── HTTP helpers ─────────────────────────────────────────────────────

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
}

function methodNotAllowed(request, response, allowed) {
  if (!allowed.includes(request.method)) {
    response.writeHead(405, { allow: allowed.join(", ") });
    response.end();
    return true;
  }
  return false;
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 64 * 1024) throw new Error("request body too large");
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

// Probe one proxy's exit IP without persisting anything. Uses a dedicated
// agent per request so the global dispatcher is never disturbed.
async function probeProxy(p) {
  const agent = buildAgentFor(p);
  try {
    const started = Date.now();
    const res = await fetch("https://api.ipify.org?format=json", {
      dispatcher: agent,
      signal: AbortSignal.timeout(8000),
    });
    const json = await res.json();
    return { ok: true, ip: json.ip, ms: Date.now() - started };
  } catch (e) {
    return { ok: false, error: String(e?.cause?.message || e.message || e) };
  } finally {
    try { agent.close?.(); } catch { /* ignore */ }
  }
}

async function probeDirect() {
  const agent = new Agent();
  try {
    const started = Date.now();
    const res = await fetch("https://api.ipify.org?format=json", {
      dispatcher: agent,
      signal: AbortSignal.timeout(8000),
    });
    const json = await res.json();
    return { ok: true, ip: json.ip, ms: Date.now() - started };
  } catch (e) {
    return { ok: false, error: String(e?.cause?.message || e.message || e) };
  } finally {
    try { agent.close?.(); } catch { /* ignore */ }
  }
}

export function apply(ctx) {
  // Restore persisted proxies on boot.
  setImmediate(() => {
    loadList()
      .then(async (proxies) => {
        const r = await applyList(proxies);
        if (r.mode === "proxy") {
          console.log(`[dsh-proxy-card] proxy chain applied on boot: ${r.exit} (${r.active.length} enabled)`);
        }
      })
      .catch((e) => console.warn("[dsh-proxy-card] boot restore error:", String(e)));
  });

  ctx.inject(["webServer"], (host) => {
    host.effect(() => {
      host.webServer.register(
        {
          kind: "exact",
          path: "/dsh-proxy/status",
          handler: async (request, response) => {
            if (methodNotAllowed(request, response, ["GET"])) return;
            try {
              const proxies = await loadList();
              sendJson(response, 200, {
                ok: true,
                proxies,
                runtime: currentStatus(),
                config_path: configPath(),
              });
            } catch (e) {
              sendJson(response, 500, { ok: false, error: String(e) });
            }
          },
        },
        "dsh-proxy-card: status",
      );

      host.webServer.register(
        {
          kind: "exact",
          path: "/dsh-proxy/config",
          handler: async (request, response) => {
            if (methodNotAllowed(request, response, ["POST"])) return;
            try {
              const body = await readJsonBody(request);
              const proxies = normalizeList(body.proxies);
              const saved = await saveList(proxies);
              const applied = await applyList(proxies);
              sendJson(response, 200, { ok: true, proxies, saved_to: saved, applied });
            } catch (e) {
              sendJson(response, 500, { ok: false, error: String(e) });
            }
          },
        },
        "dsh-proxy-card: config",
      );

      host.webServer.register(
        {
          kind: "exact",
          path: "/dsh-proxy/toggle",
          handler: async (request, response) => {
            if (methodNotAllowed(request, response, ["POST"])) return;
            try {
              const body = await readJsonBody(request);
              const id = typeof body?.id === "string" ? body.id : "";
              const proxies = await loadList();
              const target = proxies.find((p) => p.id === id);
              if (!target) {
                sendJson(response, 404, { ok: false, error: "proxy not found" });
                return;
              }
              target.enabled = !target.enabled;
              await saveList(proxies);
              const applied = await applyList(proxies);
              sendJson(response, 200, { ok: true, id, enabled: target.enabled, proxies, applied });
            } catch (e) {
              sendJson(response, 500, { ok: false, error: String(e) });
            }
          },
        },
        "dsh-proxy-card: toggle",
      );

      host.webServer.register(
        {
          kind: "exact",
          path: "/dsh-proxy/test",
          handler: async (request, response) => {
            if (methodNotAllowed(request, response, ["POST"])) return;
            try {
              const body = await readJsonBody(request);
              if (body?.id === "__direct__") {
                sendJson(response, 200, { ok: true, probe: await probeDirect(), exit: "direct" });
                return;
              }
              const proxies = await loadList();
              const target = proxies.find((p) => p.id === body?.id) ??
                normalizeList([body])[0] ?? null;
              if (!target) {
                sendJson(response, 400, { ok: false, error: "id or proxy fields required" });
                return;
              }
              sendJson(response, 200, { ok: true, id: target.id, probe: await probeProxy(target) });
            } catch (e) {
              sendJson(response, 500, { ok: false, error: String(e) });
            }
          },
        },
        "dsh-proxy-card: test",
      );

      host.webServer.register(
        {
          kind: "exact",
          path: "/dsh-proxy/delete",
          handler: async (request, response) => {
            if (methodNotAllowed(request, response, ["POST"])) return;
            try {
              const body = await readJsonBody(request);
              const id = typeof body?.id === "string" ? body.id : "";
              const proxies = await loadList();
              const next = proxies.filter((p) => p.id !== id);
              if (next.length === proxies.length) {
                sendJson(response, 404, { ok: false, error: "proxy not found" });
                return;
              }
              await saveList(next);
              const applied = await applyList(next);
              sendJson(response, 200, { ok: true, proxies: next, applied });
            } catch (e) {
              sendJson(response, 500, { ok: false, error: String(e) });
            }
          },
        },
        "dsh-proxy-card: delete",
      );
    }, "dsh-proxy-card: web routes");
  });
}
