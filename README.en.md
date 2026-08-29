# Pi DeepSeek Pet 🐾

[简体中文](README.md) | English

<p align="center">
  <img src="assets/preview/hero-xie-daima.gif" width="280" alt="Pi DeepSeek Pet typing on a laptop">
</p>

Pi DeepSeek Pet is a standalone Windows desktop pet that visualizes the runtime status of [Pi](https://pi.dev) through a secure loopback HTTP bridge.

- Transparent, frameless, always-on-top Electron window
- 97 640×360 VP9-alpha WebM animations
- Idle random chains, turning, roaming, click feedback, drag, and speech bubbles
- Pi state mapping for `thinking`, `responding`, `tool`, `waiting`, `compacting`, and more
- Versioned `/api/v1` listening on `127.0.0.1` only, with a random token on every launch and strict schemas
- Settings page can enable **Start and stop with Pi** in one click: registers the bundled extension, launches the pet, and closes it after the last Pi process exits
- When Pi is unreachable or the pet is not running, the extension stays silent and never blocks Pi

## Architecture

```text
Pi
 └─ pi-deepseek-pet-extension（lifecycle normalization, heartbeat, reconnect）
      └─ HTTP/JSON → 127.0.0.1
           └─ pi-deepseek-pet-desktop（auth, source arbitration, Electron）
                └─ IPC → React + @pi-deepseek-pet/core
```

The repository is a pnpm workspace:

- `apps/desktop`: Electron Main / sandboxed Preload / React Renderer
- `packages/protocol`: v1 DTOs, Zod schemas, error codes
- `packages/pet-core`: DOM- and Electron-free animation controller and movement geometry
- `packages/pi-extension`: standard Pi Package, no model tool registered
- `assets`: animation manifest, WebM files, fonts, and images
- `media`: prompts, transparent-asset production scripts, and source video directory

## Development

Requires Node.js 20+ and pnpm 10:

```powershell
corepack enable
corepack prepare pnpm@10.12.1 --activate
pnpm install
pnpm build
pnpm dev
```

In another terminal, load the Pi extension:

```powershell
pi -e ./packages/pi-extension/src/index.ts
```

> Run `pnpm build` before using local `-e`, so publish artifacts for the workspace dependencies are generated.

## Installation

### Desktop app

Build the release:

```powershell
pnpm package:win
```

The installer is written to `apps/desktop/release/`. The app works standalone offline; starting Pi is not required. To upgrade, run the newer installer; to uninstall, use Windows "Settings → Apps → Installed apps → Pi DeepSeek Pet". The uninstaller keeps user settings in `~/.pi-deepseek-pet/`; delete them manually if no longer needed.

To show the pet only while Pi is running: open the tray menu "Settings…", enable **Start and stop with Pi**, and save. Desktop adds the bundled extension to the Pi global settings; after restarting Pi, Pi launches the pet automatically and the pet closes after the last Pi process exits. An already-running Pi can load it immediately with `/reload`. This option is mutually exclusive with launch at login.

### Pi extension

The setting above configures the bundled extension automatically; you can also install the standalone Pi Package manually. Development install (run `pnpm build` first):

```powershell
pi install ./packages/pi-extension
```

Build a self-contained release package, or install from npm:

```powershell
pnpm package:extension
pi install npm:pi-deepseek-pet-extension
```

Upgrade and remove:

```powershell
pi update npm:pi-deepseek-pet-extension
pi remove npm:pi-deepseek-pet-extension
```

Commands: `/pet-status`, `/pet-reconnect`, `/pet-test`, `/pet-enable`, `/pet-disable`.

## Privacy & Security

The default report contains only: the project directory basename, optional session name, model identifier, thinking level, phase, tool name, and active tool count. **It never reports** prompts, replies, the full cwd, tool arguments, tool results, or file contents.

The bridge descriptor lives in `~/.pi-deepseek-pet/bridge-v1.json` and contains a short-lived connection token; do not share it. The local launcher descriptor for "Start and stop with Pi" lives in `~/.pi-deepseek-pet/pi-lifecycle-v1.json` and stores only the app and extension install paths plus launch arguments. The control API is not exposed to the LAN, returns no CORS permission, and rejects browser `Origin` requests.

See also:

- [HTTP API](docs/HTTP_API.md)
- [Pi Extension](docs/PI_EXTENSION.md)
- [Development guide](docs/DEVELOPMENT.md)
- [Design](DESIGN.md)
- [Validation record](docs/VALIDATION.md)

## Testing

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:e2e
```

## Acknowledgements & Attribution

This project is maintained by [SchneeHertz](https://github.com/SchneeHertz) and was rebuilt from the original desktop-pet plugin, animation assets, and media tooling in [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet). Thanks to the original author and contributors for the initial implementation and asset foundation.

The original plugin has been restructured into a standalone Pi desktop application and a Pi TypeScript extension in this repository; the original copyright notice remains in [LICENSE](LICENSE).

## License

The code is licensed under [MIT](LICENSE). Animations, prompts, source videos, and derived visual assets are covered separately by [ASSET_LICENSE.md](ASSET_LICENSE.md) and are non-commercial by default. The settings page and release docs must retain this notice.

The pre-migration implementation is preserved in Git tag `legacy-dsh-plugin`; the current branch contains none of its runtime code or compatibility layers.
