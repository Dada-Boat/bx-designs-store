# BX Designs template store

The website behind BX Designs' **Store** menu and **Help › Check for Updates**, served by GitHub
Pages at https://dada-boat.github.io/bx-designs-store/.

- `index.html`: the template catalogue (read from `templates/catalogue.json`). "Open in BX
  Designs" uses the `bxdesigns://open?url=<file>` link the BX Designs installer registers.
- `templates/`: the templates (layered PSDs) and their 480 px previews. Rebuild them with
  `python tools/make_templates.py <path to photocraft-cli.exe>`.
- `latest.json`: the release feed (`version`, `url`, `notes`). Raise `version` when a new
  BX Designs is ready, and every installed copy offers the update.
- `updates.html`: where the update notice sends people.

The BX Designs logo in `assets/` is © BuildX Multimedia, all rights reserved
(`assets/LICENSE-brand.txt`); it is not covered by any open-source licence. The templates are
free to use in BX Designs projects.
