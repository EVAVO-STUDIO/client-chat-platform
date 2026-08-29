# Reviewed EVAVO Worker activation on Windows

Use this procedure only after `main` has a green canonical Worker verification and Sentinel run.

The orchestration script is:

```text
scripts/activate-reviewed-evavo-worker.ps1
```

It performs, in order:

1. exact-source and clean-checkout admission;
2. the guarded root `npm run deploy` lifecycle;
3. reviewed EVAVO seed application and complete approved knowledge refresh;
4. read-only deployed activation verification;
5. final Git cleanliness/source verification;
6. process-local activation credential cleanup.

The script does not call Wrangler directly, modify Git, write Vercel configuration, or bypass any existing Worker release gate.

## Prepare the reviewed source

```powershell
Set-Location C:\GitRepos\client-chat-platform
git switch main
git pull --ff-only origin main
$ExpectedSha = (git rev-parse HEAD).Trim()
git status --short
```

Do not continue if `git status --short` prints anything. Record `$ExpectedSha` in the release evidence before activation.

## Authenticate Cloudflare

Use the existing Wrangler authentication flow for the local machine. The activation script deliberately does not log in, create API tokens, or store Cloudflare credentials.

```powershell
Set-Location C:\GitRepos\client-chat-platform\worker
cmd /c "npm run whoami"
Set-Location C:\GitRepos\client-chat-platform
```

Do not continue unless `whoami` resolves the intended Cloudflare account.

## Supply process-local activation values

```powershell
$env:EVAVO_CHAT_WORKER_URL = "https://<reviewed-worker-host>"
$env:EVAVO_CHAT_ADMIN_TOKEN = "<current-admin-token>"
$env:EVAVO_CHAT_ACTIVATE_CONFIRM = "DEPLOY_AND_ACTIVATE_REVIEWED_EVAVO"
```

The Worker URL must be the reviewed bare HTTPS Worker origin. The administrator token must stay process-local. Do not put either value in tracked files, command arguments, URLs, screenshots, logs, or public environment variables.

## Run the guarded activation

```powershell
Set-Location C:\GitRepos\client-chat-platform
.\scripts\activate-reviewed-evavo-worker.ps1 -ExpectedSha $ExpectedSha
```

A successful run means all three release phases completed:

- guarded Worker deployment;
- reviewed `evavo` config plus complete knowledge refresh;
- read-only activation verification against the deployed Worker.

The verifier specifically proves that the approved `https://evavo.com.au` origin can chat without a bot key and that a no-origin direct server request remains `bot_key_required`.

The seed helper reports only whether a historical server bot key is `configured` or `not_configured`; it never prints the key. That historical direct-server key is not required by the first-party EVAVO website when the approved-origin path is used.

## Automatic cleanup

The orchestration script removes these values from the current PowerShell process in `finally`, on success or failure:

```text
EVAVO_CHAT_APPLY_SEED_CONFIRM
EVAVO_CHAT_ACTIVATE_CONFIRM
EVAVO_CHAT_ADMIN_TOKEN
EVAVO_CHAT_WORKER_URL
```

If the script fails, fix the reported stable error code and rerun from a clean, exact `main` checkout. Do not skip a failed phase manually.

## Website activation after Worker verification

Do not enable the EVAVO website upstream before the Worker-side activation verifier succeeds.

The reviewed first-party website configuration is server-only:

```text
CHAT_API_BASE=<reviewed Worker origin>
EVA_CHAT_UPSTREAM_ENABLED=true
```

`CHAT_BOT_KEY` should remain unset for the first-party website after the deployed activation verifier has proved the approved-origin no-key path. The Worker retains its separate bot-key boundary for deliberate no-origin server-to-server callers.
