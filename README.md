# dsh-proxy-card — DSH 设置页「网络代理」卡片

DSH Web 设置页的**网络代理管理卡片**：添加多个代理（HTTP/HTTPS/SOCKS5），
每个代理独立开关滑块，全部关闭即直连。模型 API 请求、模型拉取、
web_search / web_fetch 全部覆盖，**保存即时生效，无需重启 DSH**。

## 🚀 一键安装（把下面命令发给 DSH AI 即可）

在任意 DSH 会话里对 AI 说：

```
请安装 dsh-proxy-card 插件，执行这条命令：
powershell -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/liu200320/dsh-proxy-card/main/install.ps1 | iex"
```

AI 会直接执行安装脚本，自动完成：

1. clone 本仓库到 `%USERPROFILE%\.dsh\external\dsh-proxy-card`（已存在则自动更新到最新版）
2. `npm install` 安装 undici 运行时依赖
3. `dsh plugin add` 注册到 **desktop + web** 两个 profile
4. 校验 bundles 注册与插件文件解析
5. 提示重启 DSH Desktop

也可以手动在 PowerShell 里直接跑同一条命令，效果一致。重复执行 = 更新到最新版（幂等）。

### 卸载

```
dsh plugin --profile desktop remove dsh-proxy-card
dsh plugin --profile web remove dsh-proxy-card
```

再删除 `%USERPROFILE%\.dsh\external\dsh-proxy-card` 与 `%USERPROFILE%\.dsh\proxy-card.json`。

## 🎛️ 功能

| 功能 | 说明 |
|------|------|
| 多代理列表 | 添加任意数量的代理条目（名称 / 协议 / 地址 / 端口） |
| 独立开关滑块 | 每行一个滑块，点击即时切换，无需重启 |
| 全关 = 直连 | 一个都没开时显式直连（`new Agent()` 兜底，永不空 dispatcher） |
| 出口显示 | 多个开启时，列表第一个开启的为出口（绿色「出口」徽章） |
| 单独测试 | 每行「测试」按钮探测该代理出口 IP 与延迟（独立 dispatcher，不干扰全局） |
| 即时生效 | 接管 `globalThis.fetch` → npm undici dispatcher，下一条请求即走代理 |
| 持久化 | `%USERPROFILE%\.dsh\proxy-card.json`，重启自动恢复开关状态 |
| 协议 | http / https / socks5 |
<img width="540" height="238" alt="image" src="https://github.com/user-attachments/assets/3ab4c622-6bc9-44f6-b6f3-70f0def4e147" />

## 📡 覆盖范围

| 流量 | 是否走代理 |
|------|-----------|
| 对话请求（chat/completions） | ✅ 裸 `fetch` 调用时解析 `globalThis.fetch`，即时生效 |
| 附件/文件上传（Files API） | ✅ 懒构造，接管后创建的 client 均走 |
| 模型拉取（discovery） | ✅ |
| web_search / web_fetch | ✅ |
| agent shell 命令（curl 等） | ❌ 子进程自身环境，不受影响 |

## ⚙️ 生效原理

Node 内置 `globalThis.fetch`（内部 undici）不受 npm `undici` 包的
`setGlobalDispatcher` 控制——两者是独立实例。本插件挂载时把
`globalThis.fetch` 替换为 npm undici 的 `fetch`（同一实现），此后
dispatcher 完全由插件控制：

- 有启用的代理 → `setGlobalDispatcher(ProxyAgent / Socks5ProxyAgent)`
- 无启用代理 → `setGlobalDispatcher(Agent)` 直连兜底

DSH 源码中所有裸 `fetch(...)`（`dsh-llm-deepseek` 的 chat/completions 等）
在调用时读取 `globalThis.fetch` 当前值，因此下一次请求即走新 dispatcher。

## 🔌 HTTP API（插件自带）

| 路由 | 方法 | 说明 |
|------|------|------|
| `/dsh-proxy/status` | GET | 代理列表 + 运行时状态（mode/active/出口） |
| `/dsh-proxy/config` | POST | 整表保存并即时应用 `{ proxies: [...] }` |
| `/dsh-proxy/toggle` | POST | `{ id }` 翻转单个代理开关 |
| `/dsh-proxy/test` | POST | `{ id }` 或 `{ id: "__direct__" }` 探测出口 IP |
| `/dsh-proxy/delete` | POST | `{ id }` 删除一个代理 |

## 📄 License

MIT
