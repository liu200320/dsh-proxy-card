#Requires -Version 5.1
<#
.SYNOPSIS
  dsh-proxy-card 一键安装脚本（给 DSH AI 会话或人工执行均可）。
.DESCRIPTION
  自动完成：clone/更新仓库 -> npm install（undici 依赖）->
  dsh plugin add 到 desktop/web profile -> 校验 bundles 注册与文件解析。
  幂等：重复执行即更新到最新版（fetch 失败自动重新克隆自愈）。
.EXAMPLE
  irm https://raw.githubusercontent.com/liu200320/dsh-proxy-card/main/install.ps1 | iex
.NOTES
  可选配置（环境变量覆盖默认值，兼容 irm|iex 环境下无 param 块）：
  DPC_PROFILES     profile 列表，逗号分隔，默认 "desktop,web"
  DPC_INSTALL_DIR  安装位置，默认 %USERPROFILE%\.dsh\external\dsh-proxy-card
  DPC_REPO         仓库地址，默认本仓库
#>
# 注意：irm|iex 会把 BOM 粘在首行，#Requires 可能报无害警告；脚本不依赖它执行。

# ===== 可配置参数（环境变量覆盖）=====
$Profiles = if ($env:DPC_PROFILES) { $env:DPC_PROFILES -split "," | ForEach-Object { $_.Trim() } | Where-Object { $_ } } else { @("desktop", "web") }
$InstallDir = if ($env:DPC_INSTALL_DIR) { $env:DPC_INSTALL_DIR } else { Join-Path $env:USERPROFILE ".dsh\external\dsh-proxy-card" }
$Repo = if ($env:DPC_REPO) { $env:DPC_REPO } else { "https://github.com/liu200320/dsh-proxy-card.git" }

$ErrorActionPreference = "Stop"
function Step($m) { Write-Host "[dsh-proxy-card] $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "[dsh-proxy-card] OK - $m" -ForegroundColor Green }
function Die($m)  { Write-Host "[dsh-proxy-card] 错误: $m" -ForegroundColor Red; exit 1 }

# git 把进度写 stderr；PS5.1 + ErrorActionPreference=Stop 会把正常进度当异常。
# 统一经 Invoke-Git 临时降级执行，用 exit code 判断成败。
function Invoke-Git {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$GitArgs)
  $prev = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $output = & git @GitArgs 2>&1 | Out-String
    if ($output.Trim()) { Write-Host $output.TrimEnd() -ForegroundColor DarkGray }
    return $LASTEXITCODE
  } finally { $ErrorActionPreference = $prev }
}

# ── 0. 前置检查 ─────────────────────────────────────────────────────
Step "检查前置条件"
$gitCmd = Get-Command git -ErrorAction SilentlyContinue
if (-not $gitCmd) { Die "未找到 git，请先安装 Git for Windows" }
$npmCmd = Get-Command npm -ErrorAction SilentlyContinue
if (-not $npmCmd) { Die "未找到 npm，请先安装 Node.js" }

# dsh CLI：优先 PATH，其次 DSH Desktop 封装位置
$dshCmd = Get-Command dsh -ErrorAction SilentlyContinue
if (-not $dshCmd) {
  $sealed = Join-Path $env:APPDATA "DSH Desktop\host-commands\desktop\bin\dsh.cmd"
  if (Test-Path $sealed) {
    $env:Path = (Split-Path $sealed) + ";" + $env:Path
    $dshCmd = Get-Command dsh.cmd -ErrorAction SilentlyContinue
  }
}
if (-not $dshCmd) { Die "未找到 dsh CLI（PATH 与 %APPDATA%\DSH Desktop\host-commands 都没有）" }
Ok "git / npm / dsh 就绪"

# ── 1. clone 或更新 ────────────────────────────────────────────────
function Install-Fresh {
  Step "重新克隆仓库到 $InstallDir"
  if (Test-Path $InstallDir) { Remove-Item $InstallDir -Recurse -Force }
  $parent = Split-Path $InstallDir
  if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
  $code = Invoke-Git clone --depth 1 --branch main $Repo $InstallDir
  if ($code -ne 0) { Die "git clone 失败（检查网络/代理后重试）" }
  Ok "克隆完成"
}

if (Test-Path (Join-Path $InstallDir ".git")) {
  Step "已存在，拉取最新版 $InstallDir"
  $code = Invoke-Git -C $InstallDir fetch --force --depth 1 origin main
  if ($code -ne 0) {
    Write-Host "[dsh-proxy-card] fetch 失败（远端分支变更/网络问题），自愈：重新克隆" -ForegroundColor Yellow
    Install-Fresh
  } else {
    $code = Invoke-Git -C $InstallDir reset --hard FETCH_HEAD
    if ($code -ne 0) { Install-Fresh } else { Ok "已更新到最新版" }
  }
} else {
  Install-Fresh
}

# ── 2. 安装运行时依赖（undici）──────────────────────────────────────
Step "安装插件依赖（npm install）"
Push-Location $InstallDir
try {
  npm install --no-audit --no-fund 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { Die "npm install 失败" }
} finally { Pop-Location }
if (-not (Test-Path (Join-Path $InstallDir "node_modules\undici\package.json"))) {
  Die "undici 依赖缺失（npm install 未生效）"
}
Ok "undici 依赖就绪"

# ── 3. 注册到各 profile ────────────────────────────────────────────
foreach ($p in $Profiles) {
  Step "安装到 profile: $p"
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    & dsh plugin --profile $p add $InstallDir 2>&1 | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
    $dshCode = $LASTEXITCODE
  } finally { $ErrorActionPreference = $prevEap }
  if ($dshCode -ne 0) { Die "dsh plugin --profile $p add 失败" }

  # 校验 bundles 注册（dsh plugin add 通常自动写入，缺失时补）
  $pkgFile = Join-Path $env:USERPROFILE ".dsh\profiles\$p\package.json"
  if (Test-Path $pkgFile) {
    $raw = Get-Content $pkgFile -Raw -Encoding UTF8
    if ($raw -notmatch '"dsh-proxy-card"') {
      Step "bundles 缺失，手动补写 dsh-proxy-card"
      $pkg = $raw | ConvertFrom-Json
      if (-not $pkg.dsh.profile.bundles) { $pkg.dsh | Add-Member -NotePropertyName profile -NotePropertyValue ([pscustomobject]@{ bundles = @() }) -Force }
      if ($pkg.dsh.profile.bundles -notcontains "dsh-proxy-card") { $pkg.dsh.profile.bundles += "dsh-proxy-card" }
      $pkg | ConvertTo-Json -Depth 20 | Set-Content $pkgFile -Encoding UTF8
    }
    Ok "profile $p bundles 已注册"
  }

  # 校验插件文件可解析（junction 后 lib/index.js 必须存在）
  $link = Join-Path $env:USERPROFILE ".dsh\profiles\$p\node_modules\dsh-proxy-card\lib\index.js"
  if (-not (Test-Path $link)) { Die "profile $p 中插件文件不可解析：$link" }
  Ok "profile $p 文件解析正常"
}

# ── 4. 完成 ────────────────────────────────────────────────────────
Write-Host ""
Write-Host "=============================================" -ForegroundColor Green
Write-Host " dsh-proxy-card 安装完成！" -ForegroundColor Green
Write-Host " 位置: $InstallDir"
Write-Host " Profile: $($Profiles -join ', ')"
Write-Host ""
Write-Host " 下一步: 完全退出并重启 DSH Desktop，"
Write-Host " 设置页会出现「网络代理」卡片。"
Write-Host "=============================================" -ForegroundColor Green
