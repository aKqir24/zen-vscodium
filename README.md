# zen-vscodium

![GitHub repo size](https://img.shields.io/github/repo-size/aKqir24/vscodium-config?style=for-the-badge)

It includes the extensions and the `settings.json` config optimized for a zen vscodium programming environment. I recommend, that you fork this repo, if you want to modify the extensions you use. 

|   **Workspace**                   |   **Welcome**                   |
|-----------------------------------|---------------------------------|
| ![wor](screenshots/workspace.png) | ![wel](screenshots/welcome.png) |

# Installation
> [!note]
> You must put it in a dotfiles folder before using it, or you can copy it manually by copying the `.vscode-oss` and `.config` to `$HOME`. 

For a quick and reliable setup, you can use stow like this:
```bash
    # When it is a submodule in your dotfiles
    stow -d [where you put the repo] -t ~ --adopt vscodium

    # When using my dotfiles
    stow -d configs/split -t ~ --adopt vscodium
```
