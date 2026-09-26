<p><img src="docs/assets/app-icon.svg" width="88" height="88" alt="pureknowledge icon"></p>

# pureknowledge

## What pureknowledge does

A note and wiki workspace for capturing knowledge, organizing pages, and connecting information to other resources. Use it to maintain a living reference that you and the app’s agent can work with.

## App layout

| Area | What you use it for |
| --- | --- |
| **Sidebar** | Browse and select pages and knowledge resources. |
| **Page editor** | Read and edit the current page’s content. |
| **Page context** | Inspect page metadata and related activity or resources. |
| **Review area** | Review proposed content changes before incorporating them into your knowledge. |

The app also uses the shared [puredesktop](https://puredesktop.ai) shell and drawer agent. Panels can vary with the current view and selection.

## Getting started

1. Create a note or page and write the information you want to keep.
2. Organize pages and connect them to relevant resources in the suite.
3. Reopen and update pages as the subject changes; use the app’s navigation to find related material.

Read the [app guide](docs/app-guide.md) for development, loading, and source-layout details.

## Develop and customize

We welcome **developers and vibecoders alike**. You can add features to pureknowledge, develop a fork, or create a new app for [puredesktop](https://puredesktop.ai).

### Use Claude Code, Codex, or your own tools

Open a local source checkout or a purefactory project's folder in your preferred coding tool. Ask it to read this README, `plugin.json`, `package.json`, `agents.md`, and the [development guide](docs/development.md) before making changes. Review the changes, run the app's checks, and test it inside [puredesktop](https://puredesktop.ai). This source may require matching shared platform packages; a browser preview alone does not provide desktop services.

The [development guide](docs/development.md) explains how to start Claude Code or Codex in the project, work on this repository, and load your app into the desktop.

### Use purefactory inside the desktop

Open **purefactory** (Factory) to describe a new app, or select an available app project and request a feature. Use **Open folder** to continue with external tools and **Open app** to test the result. You can also request a local app change through the app's drawer where app-development integration is available; distinguish changing the app from editing its current document.

Use **Share** in purefactory to create a `.pureapp` package. In current builds, install it through **Settings → System → Install an app → Choose package…**. See the [development guide](docs/development.md#load-and-share-your-app) for the full workflow and version differences.

## Developer accounts and the marketplace

We welcome **developers and vibecoders alike**. Go to [puredesktop.ai](https://puredesktop.ai) and [create a developer account](https://puredesktop.ai/developers) to join the developer community and submit your app for review.

Bring improvements to this app, develop a fork, or build something entirely new. We welcome **open-source and proprietary projects alike** to the [puredesktop](https://puredesktop.ai) marketplace. Support for **paid apps is coming soon**, so you will be able to charge for your apps if you choose. Forks and redistributed dependencies must follow their applicable licenses.

For developer access, app submissions, or marketplace questions, contact [info@puredesktop.ai](mailto:info@puredesktop.ai).

## Open source and contributions

Organize and edit knowledge documents in [puredesktop](https://puredesktop.ai).

Anyone may use, study, modify, and share this software under the applicable licenses.
We welcome pull requests, bug reports, documentation improvements, and new ideas.
See [CONTRIBUTING.md](CONTRIBUTING.md) for how to contribute.

### License

Original code by pure.science inc is licensed under the [MIT License](LICENSE).
Copyright (c) 2026 pure.science inc. Third-party code, dependencies, and assets retain their own licenses and copyright notices.

### Major open-source projects

| Project / source | Homepage or documentation | Support the maintainers |
| --- | --- | --- |
| [react/react](https://github.com/react/react) | [Homepage / docs](https://react.dev) | — |
| [styled-components/styled-components](https://github.com/styled-components/styled-components) | [Homepage / docs](https://styled-components.com) | [GitHub Sponsors](https://github.com/sponsors/quantizor) · [Open Collective](https://opencollective.com/styled-components) |

Thank you to these projects and their contributors. Additional direct dependencies,
upstream links, and asset notices are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
