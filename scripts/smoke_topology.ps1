# E2E smoke for the multi-server topology feature (FEATURE_SPEC_MULTI_SERVER_TOPOLOGY.md §9.3 / §10 Phase 5).
#
# Scenario: topology ON, l1 -> l3 (4 hops, extended star), topology_latency_ms=2,
# 1 MB payload, per-link loss 5 %, max_retries=20 -> cancel mid-flight -> resume
# -> SHA-256 identical -> partial cleaned -> /api/topology shows final link stats.
#
# Usage:  pwsh scripts/smoke_topology.ps1
# Exit code 0 = PASS, 1 = FAIL. Starts the FastAPI controller itself if it is
# not already running, and restores the default (topology OFF, no loss) config.

$ErrorActionPreference = "Stop"

$Root     = Split-Path -Parent $PSScriptRoot
$Backend  = Join-Path $Root "backend"
$Py       = Join-Path $Backend ".venv\Scripts\python.exe"
if (-not (Test-Path $Py)) { $Py = "python" }
$Base     = "http://127.0.0.1:8000"
$RecvDir  = Join-Path $Root "transfers\received"
$SmokeName = "fastshare_smoke_topology.bin"
$SmokeSize = 1MB
$Route    = @("l1", "ch1", "hub", "ch2", "l3")

$script:StartedBackend = $false
$script:Failures = 0

function Say  ([string]$m) { Write-Host $m }
function Ok   ([string]$m) { Write-Host "  [ok]  $m" -ForegroundColor Green }
function Fail ([string]$m) { Write-Host "  [FAIL] $m" -ForegroundColor Red; $script:Failures++ }
function Assert ([bool]$cond, [string]$m) { if ($cond) { Ok $m } else { Fail $m } }

function Get-Api ([string]$path) { Invoke-RestMethod -Uri "$Base$path" -TimeoutSec 15 }
function Post-Api ([string]$path, $body) {
    if ($null -eq $body) {
        Invoke-RestMethod -Uri "$Base$path" -Method Post -TimeoutSec 30
    } else {
        Invoke-RestMethod -Uri "$Base$path" -Method Post -Body ($body | ConvertTo-Json) `
            -ContentType "application/json" -TimeoutSec 30
    }
}
function Waiting ([int]$seconds, [string]$what, [scriptblock]$probe) {
    $deadline = (Get-Date).AddSeconds($seconds)
    while ((Get-Date) -lt $deadline) {
        $r = & $probe
        if ($r) { return $r }
        Start-Sleep -Milliseconds 250
    }
    throw "timeout after ${seconds}s waiting for: $what"
}

# ---------------------------------------------------------------- backend up
try { Get-Api "/api/status" | Out-Null; Ok "controller already running" }
catch {
    Say "starting controller..."
    Start-Process -FilePath $Py -ArgumentList "main.py" -WorkingDirectory $Backend `
        -WindowStyle Hidden
    $script:StartedBackend = $true
    Waiting 25 "controller /api/status" {
        try { Get-Api "/api/status" | Out-Null; $true } catch { $false }
    } | Out-Null
    Ok "controller started"
}

# ------------------------------------------------------------- clean leftovers
try { Post-Api "/api/server/stop" | Out-Null } catch { }
if (Test-Path $RecvDir) {
    Get-ChildItem -Path $RecvDir -Filter "*$SmokeName*" -File -ErrorAction SilentlyContinue |
        Remove-Item -Force
}
Say "leftovers of '$SmokeName' cleared"

# ------------------------------------------- default preset + scenario graph
try {
    $topo0 = Get-Api "/api/topology"
    if ($script:StartedBackend) {
        Assert ($topo0.preset -eq "tri") "default preset is tri-path (flagship topology)"
    } else {
        Ok "current preset: $($topo0.preset) (controller already running)"
    }
    Post-Api "/api/topology/preset" @{ name = "star" } | Out-Null
    $topoStar = Get-Api "/api/topology"
    Assert ($topoStar.preset -eq "star") "preset switched to star for the 4-hop resume scenario"
} catch { Fail "preset handling: $_" }

# ------------------------------------------------- configure topology + faults
try {
    Post-Api "/api/server/config" @{
        server_ip = "127.0.0.1"; udp_port = 5001; packet_size = 4096
        timeout_ms = 400; window_size = 1; max_retries = 20
        topology_enabled = $true; topology_latency_ms = 2
    } | Out-Null
    Ok "config: topology ON, latency 2 ms, packet 4096, retries 20"
    Post-Api "/api/testing/config" @{
        loss_enabled = $true; loss_probability = 0.05
        corrupt_enabled = $false; corrupt_probability = 0.0
    } | Out-Null
    Ok "testing: 5 % per-link loss (no corruption)"
    Post-Api "/api/server/start" | Out-Null
    Ok "server started (forwarders up, receiver on dest node port)"
} catch { Fail "configuration/start failed: $_" }

# ------------------------------------------------------------ topology shape
try {
    $topo = Get-Api "/api/topology"
    Assert ($topo.enabled -eq $true) "GET /api/topology -> enabled=true"
    Assert ($topo.nodes.Count -eq 7)  "7 nodes reported"
    Assert ($topo.links.Count -eq 6)  "6 links reported"
    Assert (@($topo.nodes | Where-Object { $_.up }).Count -eq 7) "all 7 nodes up"
} catch { Fail "GET /api/topology failed: $_" }

# ----------------------------------------------------------------- source file
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) $SmokeName
$bytes = New-Object byte[] $SmokeSize
[System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
[System.IO.File]::WriteAllBytes($tmp, $bytes)
$srcHash = (Get-FileHash -Path $tmp -Algorithm SHA256).Hash
Ok "1 MB payload generated ($($bytes.Length) bytes, SHA-256 $($srcHash.Substring(0,16))...)"

function Start-SmokeTransfer ([bool]$resume) {
    $q = "resume=$($resume.ToString().ToLower())&source=l1&dest=l3"
    $out = & curl.exe -sS -f -F "file=@$tmp" "$Base/api/transfer/start?$q"
    if ($LASTEXITCODE -ne 0) { throw "transfer start failed: $out" }
    ($out | ConvertFrom-Json)
}
function Get-TransferStatus { Get-Api "/api/transfer/status" }

try {
    $r = Start-SmokeTransfer $false
    Assert ($r.ok -eq $true) "transfer #1 started (l1 -> l3, resume=false)"
} catch { Fail "$_" }

# ------------------------------------------------- cancel mid-flight (phase A)
$cancelled = $false
try {
    Waiting 60 "first ACKs on the 4-hop route" {
        $s = Get-TransferStatus
        if ($s.transfer_status -ne "transferring") { throw "transfer ended early: $($s.transfer_status) $($s.transfer_error)" }
        if ($s.packets_acked -ge 10) { $s } else { $false }
    } | Out-Null
    Ok "route is carrying traffic (>=10 packets ACKed end-to-end)"
    Post-Api "/api/transfer/cancel" | Out-Null
    # cancel returns as soon as the flag is raised; the sender thread flips
    # transfer_status to "cancelled" a moment later -> poll for it.
    $st = Waiting 10 "transfer_status=cancelled" {
        $s = Get-TransferStatus
        if ($s.transfer_status -eq "cancelled") { $s }
        elseif ($s.transfer_status -eq "transferring") { $false }
        else { throw "unexpected status after cancel: $($s.transfer_status)" }
    }
    Assert ($st.transfer_status -eq "cancelled") "cancel accepted mid-flight"
    $cancelled = $true
} catch { Fail "cancel phase: $_" }

if ($cancelled) {
    try {
        $chk = Get-Api "/api/resume/check?name=$SmokeName&size=$SmokeSize"
        Assert ($chk.available -eq $true) "partial exists after cancel (resumable)"
        Assert ($chk.received_bytes -gt 0 -and $chk.received_bytes -lt $SmokeSize) `
            "partial is incomplete ($($chk.received_bytes)/$SmokeSize bytes)"
    } catch { Fail "resume/check failed: $_" }

    # ------------------------------------------- resume to completion (phase B)
    try {
        $r2 = Start-SmokeTransfer $true
        Assert ($r2.ok -eq $true) "transfer #2 started (resume=true)"
        $done = Waiting 420 "completed transfer over 4 hops" {
            $s = Get-TransferStatus
            switch ($s.transfer_status) {
                "completed"   { $s }
                "failed"      { throw "resume run failed: $($s.transfer_error)" }
                "cancelled"   { throw "resume run was cancelled" }
            }
            $false
        }
        Ok "transfer completed over 4 hops (acks=$($done.packets_acked), retransmits=$($done.retransmissions), loss=$($done.loss_percent)%)"
    } catch { Fail "resume phase: $_" }

    # ------------------------------------------------------------- integrity
    try {
        $s = Get-TransferStatus
        $final = $s.received_path
        Assert ($null -ne $final -and (Test-Path $final)) "received file present: $final"
        $dstHash = (Get-FileHash -Path $final -Algorithm SHA256).Hash
        Assert ($dstHash -eq $srcHash) "SHA-256 identical after cancel -> resume"

        $chk = Get-Api "/api/resume/check?name=$SmokeName&size=$SmokeSize"
        Assert ($chk.available -eq $false) "partial cleaned after completion"
    } catch { Fail "integrity check: $_" }
}

# ------------------------------------------------------- final link statistics
try {
    $topo = Get-Api "/api/topology"
    Assert ((@($topo.route) -join ",") -eq ($Route -join ",")) `
        "route is l1 -> ch1 -> hub -> ch2 -> l3"
    $totalData = 0; $totalAck = 0
    # Link ids come from the graph in declaration order (the last route link
    # is "l3-ch2", not "ch2-l3") -> resolve each hop pair instead of guessing.
    $routeLinks = @()
    for ($i = 0; $i -lt $Route.Count - 1; $i++) {
        $a = $Route[$i]; $b = $Route[$i + 1]
        $m = $topo.links | Where-Object {
            ($_.a -eq $a -and $_.b -eq $b) -or ($_.a -eq $b -and $_.b -eq $a)
        }
        if ($null -eq $m) { Fail "no reported link between $a and $b"; continue }
        $routeLinks += $m.id
    }
    Assert ($routeLinks.Count -eq 4) "resolved 4 route link ids: $($routeLinks -join ', ')"

    foreach ($link in $routeLinks) {
        $ls = $topo.link_stats.$link
        if ($null -eq $ls) { Fail "missing link_stats for $link"; continue }
        $totalData += $ls.data_packets; $totalAck += $ls.ack_packets
        Assert ($ls.data_packets -gt 0 -and $ls.ack_packets -gt 0) `
            "link $link counted DATA=$($ls.data_packets) ACK=$($ls.ack_packets) dropped=$($ls.dropped)"
        Assert ($ls.latency_ms -eq 2) "link $link reports the configured latency (2 ms)"
    }
    Assert ($totalData -gt 0 -and $totalAck -gt 0) "route links carried both directions"
} catch { Fail "final topology stats: $_" }

# -------------------------------------------------------------------- cleanup
try {
    Post-Api "/api/server/stop" | Out-Null
    Post-Api "/api/testing/config" @{
        loss_enabled = $false; loss_probability = 0.0
        corrupt_enabled = $false; corrupt_probability = 0.0
    } | Out-Null
    Post-Api "/api/server/config" @{
        server_ip = "127.0.0.1"; udp_port = 5001; packet_size = 1024
        timeout_ms = 500; window_size = 1; max_retries = 5
        topology_enabled = $false; topology_latency_ms = 10
    } | Out-Null
    Post-Api "/api/topology/preset" @{ name = "tri" } | Out-Null
    Ok "restored default config (tri-path preset, topology OFF, loss OFF)"
} catch { Fail "cleanup failed: $_" }

Remove-Item -Path $tmp -Force -ErrorAction SilentlyContinue
if ($script:StartedBackend) {
    try { Stop-Process -Id (Get-NetTCPConnection -LocalPort 8000 -State Listen).OwningProcess -Force } catch { }
    Ok "stopped controller started by this script"
}

Say ""
if ($script:Failures -eq 0) {
    Say "SMOKE PASS — topology E2E (l1 -> l3, cancel -> resume) all checks green." -ForegroundColor Green
    exit 0
} else {
    Say "SMOKE FAIL — $script:Failures check(s) failed." -ForegroundColor Red
    exit 1
}
