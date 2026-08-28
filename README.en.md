# Pi DeepSeek Pet 🐾

Pi DeepSeek Pet is a standalone Windows desktop pet that visualizes [Pi](https://pi.dev) lifecycle status through a secure loopback HTTP bridge.

It includes a transparent Electron window, 97 VP9-alpha WebM animations, click/drag/roaming interactions, a host-independent animation controller, a versioned `/api/v1`, and a non-blocking Pi extension.

## Quick start

```sh
corepack enable
corepack prepare pnpm@10.12.1 --activate
pnpm install
pnpm build
pnpm dev
```

In another terminal:

```sh
pi -e ./packages/pi-extension/src/index.ts
```

Build the Windows installer with `pnpm package:win` and the self-contained Pi package with `pnpm package:extension`. Install the extension with `pi install npm:pi-deepseek-pet-extension`, update it with `pi update npm:pi-deepseek-pet-extension`, and remove it with `pi remove npm:pi-deepseek-pet-extension`. Run a newer Windows installer to upgrade Pi DeepSeek Pet; uninstall it from Windows Installed apps (user settings under `~/.pi-deepseek-pet/` are retained).

See [DEVELOPMENT.md](docs/DEVELOPMENT.md), [HTTP_API.md](docs/HTTP_API.md), and [PI_EXTENSION.md](docs/PI_EXTENSION.md).

The bridge sends phase and safe metadata only. It never sends prompts, responses, full working-directory paths, tool arguments, tool results, or file contents.

## Acknowledgements

This project is maintained by [SchneeHertz](https://github.com/SchneeHertz) and was rebuilt from the original desktop-pet plugin, animation assets, and media tooling in [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet). Thanks to the original author and contributors for the initial implementation and asset foundation. The original copyright notice remains in [LICENSE](LICENSE).

Code is MIT licensed. Animation and other visual assets are governed separately by [ASSET_LICENSE.md](ASSET_LICENSE.md) and are non-commercial by default.
