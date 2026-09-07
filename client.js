// dsh-proxy-card client bundle: settings section "网络代理" — multi-proxy list,
// per-proxy on/off sliders, add/remove, per-proxy exit-IP test.
window.__ModuleLoader__.load({ id: "dsh-proxy-card", factory: (require) => {

	var module = { exports: {} };
	var exports = module.exports;
	Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
	let react = require("react");
	const h = react.createElement;
	const { useState, useEffect, useCallback, useRef } = react;

	const name = "dsh-proxy-card";
	const inject = ["slots"];

	const CSS = `
.dshpc-root { font-size: 13px; color: #1f2328; max-width: 760px; }
.dshpc-card { border: 1px solid #d0d7de; border-radius: 10px; padding: 16px 18px; background: #fff; display: flex; flex-direction: column; gap: 12px; }
.dshpc-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.dshpc-title { font-weight: 600; font-size: 14px; }
.dshpc-sub { color: #656d76; font-size: 12px; margin-top: 2px; }
.dshpc-list { display: flex; flex-direction: column; gap: 8px; }
.dshpc-item { display: flex; align-items: center; gap: 10px; border: 1px solid #e4e8ec; border-radius: 8px; padding: 9px 12px; background: #fafbfc; flex-wrap: wrap; }
.dshpc-item.off { opacity: .72; }
.dshpc-name { min-width: 90px; font-weight: 500; font-size: 13px; }
.dshpc-uri { color: #57606a; font-size: 12px; flex: 1 1 160px; word-break: break-all; }
.dshpc-switch { position: relative; width: 38px; height: 21px; border-radius: 11px; background: #d0d7de; cursor: pointer; border: none; padding: 0; transition: background .15s; flex: none; }
.dshpc-switch.on { background: #1a7f37; }
.dshpc-switch::after { content: ""; position: absolute; top: 2px; left: 2px; width: 17px; height: 17px; border-radius: 50%; background: #fff; transition: left .15s; box-shadow: 0 1px 2px rgba(0,0,0,.2); }
.dshpc-switch.on::after { left: 19px; }
.dshpc-btn { border: 1px solid #d0d7de; background: #f6f8fa; color: #1f2328; border-radius: 6px; padding: 4px 11px; font-size: 12px; cursor: pointer; }
.dshpc-btn:hover { background: #eef1f4; }
.dshpc-btn.primary { background: #0969da; border-color: #0969da; color: #fff; }
.dshpc-btn.primary:hover { background: #0757ba; }
.dshpc-btn.danger { color: #c0392b; border-color: #f0c6c1; background: #fff; }
.dshpc-btn.danger:hover { background: #ffebe9; }
.dshpc-btn:disabled { opacity: .55; cursor: default; }
.dshpc-editor { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; border: 1px dashed #d0d7de; border-radius: 8px; padding: 10px 12px; background: #fff; }
.dshpc-input, .dshpc-select { border: 1px solid #d0d7de; border-radius: 6px; padding: 5px 9px; font-size: 13px; outline: none; background: #fff; color: inherit; }
.dshpc-input:focus, .dshpc-select:focus { border-color: #0969da; }
.dshpc-input.name { width: 110px; }
.dshpc-input.host { flex: 1 1 160px; min-width: 130px; }
.dshpc-input.port { width: 84px; }
.dshpc-msg { font-size: 12px; border-radius: 6px; padding: 7px 10px; }
.dshpc-msg.ok { background: #dafbe1; color: #116329; }
.dshpc-msg.err { background: #ffebe9; color: #c0392b; }
.dshpc-msg.info { background: #ddf4ff; color: #0969da; }
.dshpc-status { font-size: 12px; color: #57606a; display: flex; gap: 14px; flex-wrap: wrap; align-items: center; }
.dshpc-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 5px; vertical-align: middle; }
.dshpc-dot.on { background: #1a7f37; }
.dshpc-dot.off { background: #d0d7de; }
.dshpc-badge { font-size: 11px; border-radius: 10px; padding: 1px 8px; background: #ddf4ff; color: #0969da; }
.dshpc-badge.live { background: #dafbe1; color: #116329; }
.dshpc-empty { color: #8b949e; font-size: 12px; padding: 8px 2px; }
.dshpc-probe { font-size: 11px; color: #454c54; }
`;

	const PROTOCOLS = [
		{ value: "http", label: "HTTP" },
		{ value: "https", label: "HTTPS" },
		{ value: "socks5", label: "SOCKS5" },
	];

	function Root() {
		const [proxies, setProxies] = useState([]);
		const [runtime, setRuntime] = useState(null);
		const [busyId, setBusyId] = useState(null);
		const [msg, setMsg] = useState(null);
		const [draft, setDraft] = useState({
			name: "", protocol: "http", host: "", port: 7890,
		});
		const [probeMap, setProbeMap] = useState({});
		const mounted = useRef(true);
		useEffect(() => () => { mounted.current = false; }, []);

		const refresh = useCallback(() => {
			fetch("/dsh-proxy/status", { cache: "no-store" })
				.then((r) => r.json())
				.then((d) => {
					if (!mounted.current) return;
					if (d.ok) {
						setProxies(d.proxies || []);
						setRuntime(d.runtime);
					}
				})
				.catch(() => {});
		}, []);
		useEffect(() => { refresh(); }, [refresh]);

		const persist = useCallback(async (next, okText) => {
			const res = await fetch("/dsh-proxy/config", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ proxies: next }),
			});
			const d = await res.json();
			if (!d.ok) throw new Error(d.error || "保存失败");
			setProxies(d.proxies);
			setRuntime((prev) => prev);
			refresh();
			setMsg({ kind: "ok", text: okText });
			return d;
		}, [refresh]);

		const toggle = useCallback(async (id) => {
			setBusyId(id);
			try {
				const res = await fetch("/dsh-proxy/toggle", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ id }),
				});
				const d = await res.json();
				if (!d.ok) throw new Error(d.error || "切换失败");
				setProxies(d.proxies);
				refresh();
				setMsg({ kind: "ok", text: d.enabled
					? "已开启：该代理加入生效链（第一个开启的为出口）"
					: "已关闭：全部关闭时走直连" });
			} catch (e) {
				setMsg({ kind: "err", text: `切换失败：${e.message}` });
			} finally {
				if (mounted.current) setBusyId(null);
			}
		}, [refresh]);

		const remove = useCallback(async (id) => {
			setBusyId(id);
			try {
				const res = await fetch("/dsh-proxy/delete", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ id }),
				});
				const d = await res.json();
				if (!d.ok) throw new Error(d.error || "删除失败");
				setProxies(d.proxies);
				refresh();
				setMsg({ kind: "ok", text: "已删除" });
			} catch (e) {
				setMsg({ kind: "err", text: `删除失败：${e.message}` });
			} finally {
				if (mounted.current) setBusyId(null);
			}
		}, [refresh]);

		const testOne = useCallback(async (p) => {
			setBusyId(p.id);
			setProbeMap((prev) => ({ ...prev, [p.id]: { loading: true } }));
			try {
				const res = await fetch("/dsh-proxy/test", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(p.id === "__direct__" ? { id: "__direct__" } : { id: p.id }),
				});
				const d = await res.json();
				if (!d.ok) throw new Error(d.error || "测试失败");
				setProbeMap((prev) => ({ ...prev, [p.id]: d.probe }));
			} catch (e) {
				setProbeMap((prev) => ({ ...prev, [p.id]: { ok: false, error: e.message } }));
			} finally {
				if (mounted.current) setBusyId(null);
			}
		}, []);

		const addProxy = useCallback(async () => {
			if (!draft.host.trim() || !draft.port) {
				setMsg({ kind: "err", text: "地址和端口不能为空" });
				return;
			}
			setBusyId("__add__");
			try {
				const next = [...proxies, {
					...draft,
					name: draft.name.trim() || `代理 ${proxies.length + 1}`,
					enabled: false,
				}];
				await persist(next, "已添加（默认关闭，打开滑块生效）");
				setDraft({ name: "", protocol: "http", host: "", port: 7890 });
			} catch (e) {
				setMsg({ kind: "err", text: `添加失败：${e.message}` });
			} finally {
				if (mounted.current) setBusyId(null);
			}
		}, [draft, proxies, persist]);

		const enabledCount = proxies.filter((p) => p.enabled).length;
		const liveId = runtime?.mode === "proxy" ? runtime.active?.[0] : null;

		return h("div", { className: "dshpc-root" },
			h("style", null, CSS),
			h("div", { className: "dshpc-card" },
				h("div", { className: "dshpc-head" },
					h("div", null,
						h("div", { className: "dshpc-title" }, "网络代理"),
						h("div", { className: "dshpc-sub" },
							"模型 API · 模型拉取 · Web 工具走代理；全部关闭 = 直连。保存即时生效，无需重启。"),
					),
				),
				h("div", { className: "dshpc-status" },
					h("span", null,
						h("span", { className: "dshpc-dot " + (runtime?.mode === "proxy" ? "on" : "off") }),
						runtime?.mode === "proxy"
							? `代理生效中：${(proxies.find((p) => p.id === liveId) ? proxyLabel(proxies.find((p) => p.id === liveId)) : "")}`
							: "当前直连",
					),
					h("span", null, `已启用 ${enabledCount} / ${proxies.length}`),
					h("span", null, `fetch 接管：${runtime?.installed_fetch_override ? "是" : "否"}`),
				),
				h("div", { className: "dshpc-list" },
					proxies.length === 0
						? h("div", { className: "dshpc-empty" }, "还没有代理，在下方添加。")
						: proxies.map((p) => h(ProxyRow, {
							key: p.id, p, liveId, busyId, probeMap,
							onToggle: toggle, onRemove: remove, onTest: testOne,
						})),
				),
				h("div", { className: "dshpc-editor" },
					h("input", {
						className: "dshpc-input name", placeholder: "名称（可选）",
						value: draft.name, spellCheck: false,
						onChange: (e) => setDraft({ ...draft, name: e.target.value }),
					}),
					h("select", {
						className: "dshpc-select", value: draft.protocol,
						onChange: (e) => setDraft({ ...draft, protocol: e.target.value }),
					}, PROTOCOLS.map((x) => h("option", { key: x.value, value: x.value }, x.label))),
					h("input", {
						className: "dshpc-input host", placeholder: "代理地址，如 127.0.0.1",
						value: draft.host, spellCheck: false,
						onChange: (e) => setDraft({ ...draft, host: e.target.value }),
					}),
					h("input", {
						className: "dshpc-input port", type: "number", min: 1, max: 65535,
						placeholder: "端口", value: draft.port,
						onChange: (e) => setDraft({ ...draft, port: Number(e.target.value) || 0 }),
					}),
					h("button", {
						type: "button", className: "dshpc-btn primary",
						disabled: busyId === "__add__", onClick: addProxy,
					}, busyId === "__add__" ? "添加中…" : "＋ 添加代理"),
				),
				msg ? h("div", { className: "dshpc-msg " + msg.kind }, msg.text) : null,
			),
		);
	}

	function proxyLabel(p) {
		return `${p.protocol}://${p.host}:${p.port}`;
	}

	function ProxyRow({ p, liveId, busyId, probeMap, onToggle, onRemove, onTest }) {
		const probe = probeMap[p.id];
		const isLive = p.id === liveId && p.enabled;
		return h("div", { className: "dshpc-item" + (p.enabled ? "" : " off") },
			h("button", {
				type: "button",
				"aria-label": `启用 ${p.name}`,
				className: "dshpc-switch" + (p.enabled ? " on" : ""),
				disabled: busyId === p.id,
				onClick: () => onToggle(p.id),
			}),
			h("div", { className: "dshpc-name" }, p.name),
			h("div", { className: "dshpc-uri" },
				proxyLabel(p),
				p.enabled ? h("span", { className: "dshpc-badge" + (isLive ? " live" : "") },
					isLive ? "　出口" : "　已启用") : null,
			),
			probe ? h("span", { className: "dshpc-probe" },
				probe.loading ? "测试中…"
					: probe.ok ? `IP ${probe.ip} (${probe.ms}ms)`
						: `失败: ${probe.error?.slice(0, 40) || "未知"}`,
			) : null,
			h("div", { style: { display: "flex", gap: "6px", marginLeft: "auto" } },
				h("button", {
					type: "button", className: "dshpc-btn",
					disabled: busyId === p.id, onClick: () => onTest(p),
				}, "测试"),
				h("button", {
					type: "button", className: "dshpc-btn danger",
					disabled: busyId === p.id, onClick: () => onRemove(p.id),
				}, "删除"),
			),
		);
	}

	function apply(ctx) {
		ctx.slots.inject("settings.section", () => ctx.slots.register({
			name: "settings.section",
			id: "dsh-proxy-card",
			order: 45,
			label: () => "网络代理",
		}, Root));
	}

	exports.name = name;
	exports.inject = inject;
	exports.apply = apply;
	return module.exports;
}});
