# Marketplace changelog

Notable changes to the `postgres-skills` marketplace setup are documented here.
The canonical manifest is `marketplace.json` in this directory; Claude Code and
Codex discovery entrypoints live in `.claude-plugin/marketplace.json` and
`.agents/plugins/marketplace.json` at the repository root.
Plugin content and version updates are tracked only in the
[plugin changelog](../../plugin/CHANGELOG.md).
Versions with no marketplace setup changes are omitted.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Historical entries are reconstructed from Git history. Version dates use the
existing release tag where available, or the commit that introduced the
marketplace metadata version otherwise; they do not imply a published GitHub
Release.

## [Unreleased]

## [0.1.1] - 2026-09-16

### Fixed
- Store Claude Code and Codex marketplace entrypoints as regular JSON files instead of symlinks for Windows compatibility

## [0.1.0] - 2026-07-15

### Changed
- Rename the marketplace and plugin listing to `postgres-skills`

[Unreleased]: https://github.com/microsoft/postgres-skills/compare/postgres-skills--v0.1.1...HEAD
[0.1.1]: https://github.com/microsoft/postgres-skills/compare/0a4a57e1b5e3118793413efa6b5263dd7c80e5f8...postgres-skills--v0.1.1
[0.1.0]: https://github.com/microsoft/postgres-skills/compare/c4f1d197d1f2ed675c5e2b05df42c79efef702c5...0a4a57e1b5e3118793413efa6b5263dd7c80e5f8
