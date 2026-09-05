# Pi DeepSeek Pet 🐾

[简体中文](README.md) | English

<p align="center">
  <img src="assets/preview/hero-qiaoji-zhuomian.gif" width="280" alt="Pi DeepSeek Pet knocking on the desktop">
</p>

Pi DeepSeek Pet is a standalone Windows desktop pet that visualizes the runtime status of [Pi](https://pi.dev) through a secure loopback HTTP bridge.

- Transparent, frameless, always-on-top Electron window
- 97 640×360 VP9-alpha WebM animations
- Idle random chains, turning, roaming, click feedback, drag, and speech bubbles
- Pi state mapping for `thinking`, `responding`, `tool`, `waiting`, `compacting`, and more
- Versioned `/api/v1` listening on `127.0.0.1` only, with a random token on every launch and strict schemas
- Settings page configures the Pi integration script and **Linked start and stop with Pi** independently
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

Open "Settings…" from the tray menu to configure the two Pi integration behaviors independently:

- **Automatically configure the Pi integration script** adds the bundled extension to Pi's global settings so the pet can receive Pi status. It does not change how the desktop app starts. Run `/reload` in an existing Pi process to load it immediately, or restart Pi.
- **Linked start and stop with Pi** lets the loaded extension launch the pet and close a Pi-launched pet after the final Pi process exits. It requires the integration script to be loaded through the first option or a Pi Package, and it is mutually exclusive with launch at login.

You can therefore configure only the integration script and start the pet manually or at login.

### Pi extension

The settings page can configure the bundled extension automatically; you can also install the standalone Pi Package manually. Development install (run `pnpm build` first):

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

The bridge descriptor lives in `~/.pi-deepseek-pet/bridge-v1.json` and contains a short-lived connection token; do not share it. The local launcher descriptor for "Linked start and stop with Pi" lives in `~/.pi-deepseek-pet/pi-lifecycle-v1.json` and stores only the app and extension install paths plus launch arguments. Desktop records its managed script path separately in `~/.pi-deepseek-pet/pi-extension-registration-v1.json`, allowing it to undo only its own Pi setting. The control API is not exposed to the LAN, returns no CORS permission, and rejects browser `Origin` requests.

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
