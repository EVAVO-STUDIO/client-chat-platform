[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[0-9a-f]{40}$')]
    [string]$ExpectedSha
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ExpectedConfirmation = 'DEPLOY_AND_ACTIVATE_REVIEWED_EVAVO'
$SeedConfirmation = 'APPLY_EVAVO_REVIEWED_SEED'
$RepositoryRoot = Split-Path -Parent $PSScriptRoot

function Fail([string]$Code) {
    throw $Code
}

function Require-Env([string]$Name) {
    $Value = [Environment]::GetEnvironmentVariable($Name, 'Process')
    if ([string]::IsNullOrWhiteSpace($Value)) {
        Fail "${Name}_REQUIRED"
    }
    return $Value.Trim()
}

function Invoke-Checked([string]$Label, [string[]]$Arguments) {
    & cmd.exe /d /s /c ($Arguments -join ' ')
    if ($LASTEXITCODE -ne 0) {
        Fail "${Label}_FAILED_$LASTEXITCODE"
    }
}

Push-Location $RepositoryRoot
try {
    $CurrentSha = (& git rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0 -or $CurrentSha -ne $ExpectedSha) {
        Fail 'EVAVO_CHAT_EXPECTED_SHA_MISMATCH'
    }

    $CurrentBranch = (& git branch --show-current).Trim()
    if ($LASTEXITCODE -ne 0 -or $CurrentBranch -ne 'main') {
        Fail 'EVAVO_CHAT_MAIN_BRANCH_REQUIRED'
    }

    $Dirty = & git status --porcelain=v1 --untracked-files=all
    if ($LASTEXITCODE -ne 0 -or $Dirty) {
        Fail 'EVAVO_CHAT_CLEAN_CHECKOUT_REQUIRED'
    }

    $ActivationConfirmation = Require-Env 'EVAVO_CHAT_ACTIVATE_CONFIRM'
    if ($ActivationConfirmation -ne $ExpectedConfirmation) {
        Fail "EVAVO_CHAT_ACTIVATE_CONFIRM_REQUIRED:$ExpectedConfirmation"
    }

    $WorkerUrl = Require-Env 'EVAVO_CHAT_WORKER_URL'
    $AdminToken = Require-Env 'EVAVO_CHAT_ADMIN_TOKEN'
    $AdminTokenBytes = [Text.Encoding]::UTF8.GetByteCount($AdminToken)
    if ($AdminToken -match '\s' -or $AdminTokenBytes -lt 16 -or $AdminTokenBytes -gt 256) {
        Fail 'EVAVO_CHAT_ADMIN_TOKEN_INVALID'
    }

    Write-Host 'EVAVO reviewed Worker activation starting.'
    Write-Host "- exact source: $ExpectedSha"
    Write-Host '- phase 1/3: guarded Worker deploy'
    Invoke-Checked 'EVAVO_CHAT_DEPLOY' @('npm', 'run', 'deploy')

    Write-Host '- phase 2/3: reviewed EVAVO seed and knowledge refresh'
    [Environment]::SetEnvironmentVariable('EVAVO_CHAT_APPLY_SEED_CONFIRM', $SeedConfirmation, 'Process')
    Invoke-Checked 'EVAVO_CHAT_SEED_APPLY' @('npm', 'run', 'apply:evavo-seed')

    Write-Host '- phase 3/3: read-only deployed activation verification'
    Invoke-Checked 'EVAVO_CHAT_ACTIVATION_VERIFY' @('npm', 'run', 'verify:evavo-activation')

    $FinalSha = (& git rev-parse HEAD).Trim()
    $FinalDirty = & git status --porcelain=v1 --untracked-files=all
    if ($LASTEXITCODE -ne 0 -or $FinalSha -ne $ExpectedSha -or $FinalDirty) {
        Fail 'EVAVO_CHAT_CHECKOUT_MUTATED_DURING_ACTIVATION'
    }

    Write-Host 'EVAVO reviewed Worker activation completed.'
    Write-Host '- deployment, reviewed seed/cache and read-only activation verification succeeded'
    Write-Host '- first-party approved-origin chat was verified without a bot-key credential'
    Write-Host '- activation credentials are being cleared from this PowerShell process'
}
finally {
    Remove-Item Env:EVAVO_CHAT_APPLY_SEED_CONFIRM -ErrorAction SilentlyContinue
    Remove-Item Env:EVAVO_CHAT_ACTIVATE_CONFIRM -ErrorAction SilentlyContinue
    Remove-Item Env:EVAVO_CHAT_ADMIN_TOKEN -ErrorAction SilentlyContinue
    Remove-Item Env:EVAVO_CHAT_WORKER_URL -ErrorAction SilentlyContinue
    Pop-Location
}
