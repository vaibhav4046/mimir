# Releasing Mimir (signed Windows installer)

An unsigned installer works, but Windows SmartScreen warns "unknown publisher" until a build is signed and has built up reputation.
Signing needs a certificate that only you can buy; everything else is wired so that supplying one is the only step left.

## Get a certificate (pick one)

| Option | Cost | Notes |
|---|---|---|
| Azure Trusted Signing | about 10 USD/month | Needs an Azure account and identity validation (individuals in some countries, organisations in more). No hardware token. |
| OV code-signing certificate (Sectigo, DigiCert, SSL.com ...) | about 100-300 USD/year | Since 2023 the private key must live on a hardware token or cloud HSM, so use the vendor's cloud-signing service in CI. |
| EV certificate | higher | Removes the SmartScreen warning at once; the OV route builds reputation over downloads. |

## Sign a local build

electron-builder signs automatically when these variables are set (no config change needed):

```powershell
$env:CSC_LINK = "C:\path\to\certificate.pfx"      # or a base64 string / https URL
$env:CSC_KEY_PASSWORD = "the pfx password"
cargo build --release --manifest-path rust/Cargo.toml   # the installer bundles mimir-daemon.exe
npm run dist:win
```

Check the result: right-click `release\Mimir Setup <version>.exe` > Properties > Digital Signatures, or

```powershell
Get-AuthenticodeSignature "release\Mimir Setup 1.0.5.exe" | Format-List Status, SignerCertificate
```

`Status : Valid` means it is signed and trusted. Run `npm run manifest` afterwards if you publish `public/release-manifest.json` (it pins sizes and SHA-256 of release files).

## Build in CI

`.github/workflows/release.yml` builds the installer on a `v*` tag (or by hand) and uploads it as an artifact. Add two repository secrets, `CSC_LINK` (base64 of the .pfx) and `CSC_KEY_PASSWORD`, and the same job produces a signed installer. Without the secrets it still builds, unsigned, and says so in the log. This workflow has not been run yet: expect to adjust it on first use.

## Before you tag

1. `npm test` and `npm run test:e2e` pass.
2. `docs/reports/STATE.md` matches reality (it is the ledger new contributors read first).
3. Install the built installer on a clean Windows user, open it, finish the first-run screen, run one task, uninstall.
