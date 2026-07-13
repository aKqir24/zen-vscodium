# zen-vscodium

![GitHub repo size](https://img.shields.io/github/repo-size/aKqir24/vscodium-config?style=for-the-badge)

It includes the extensions and the `settings.json` config optimized for a zen vscodium programming environment. I recommend, that you fork this repo, if you want to modify the extensions you use. 

|   **Workspace**                   |   **Welcome**                   |
|-----------------------------------|---------------------------------|
| <img width="1152" height="864" alt="workspace" src="https://github.com/user-attachments/assets/b1fee379-10e4-4979-ae5d-c99fbdd6c9b0" /> | <img width="1152" height="864" alt="welcome" src="https://github.com/user-attachments/assets/e5d1a31a-9288-412a-b717-39866546f300" /> |

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
