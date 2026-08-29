# pi-deepseek-pet-extension

Pi Package that forwards safe Pi lifecycle phases to the local Pi DeepSeek Pet desktop app. It registers no LLM tools and is non-blocking when the desktop app is unavailable. The published `dist/index.js` bundles its protocol runtime, so no workspace package is required after installation.

The companion Windows app displays the pet. [Download the latest Pi DeepSeek Pet desktop installer from GitHub Releases](https://github.com/SchneeHertz/pi-deepseek-pet/releases/latest), install it, and start it before using the extension.

Install with `pi install npm:pi-deepseek-pet-extension`, update with `pi update npm:pi-deepseek-pet-extension`, and remove with `pi remove npm:pi-deepseek-pet-extension`.

See the [full extension guide](https://github.com/SchneeHertz/pi-deepseek-pet/blob/main/docs/PI_EXTENSION.md).

Pi DeepSeek Pet is maintained by [SchneeHertz](https://github.com/SchneeHertz) and derives from the original [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet) project, with thanks to its author and contributors.
