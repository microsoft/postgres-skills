# Marketplace changelog

Notable changes to the `postgres-skills` marketplace setup and plugin listing
versions are documented here.
The canonical manifest is `.github/plugin/marketplace.json`; Claude Code and
Codex discovery entrypoints live in `.claude-plugin/marketplace.json` and
`.agents/plugins/marketplace.json` at the repository root.
Detailed plugin content changes are tracked in the
[plugin changelog](plugin/CHANGELOG.md).

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.3] - 2026-11-02

### Changed
- Update marketplace metadata and the listed plugin version to `0.1.3`, including the deleted-server recovery reference described in the [plugin changelog](plugin/CHANGELOG.md#013---2026-11-02)

## [0.1.2] - 2026-09-17

### Changed
- Update marketplace metadata and the listed plugin version to `0.1.2` for Agent Plugins v1.0 compatibility

## [0.1.1] - 2026-09-16

### Changed
- Update the listed plugin version to `0.1.1` and subsequently align marketplace metadata at the same version

### Fixed
- Store Claude Code and Codex marketplace entrypoints as regular JSON files instead of symlinks for Windows compatibility

## [0.1.0] - 2026-07-15

### Changed
- Rename the marketplace and plugin listing to `postgres-skills`
- Update marketplace metadata and the listed plugin version to `0.1.0` for the postgres-mcp migration

[Unreleased]: https://github.com/microsoft/postgres-skills/compare/main...HEAD
[0.1.3]: https://github.com/microsoft/postgres-skills/compare/3ea7816fd1e449916b9277cc2671bc1c4c34f8c9...964c3b1
[0.1.2]: https://github.com/microsoft/postgres-skills/compare/postgres-skills--v0.1.1...3ea7816fd1e449916b9277cc2671bc1c4c34f8c9
[0.1.1]: https://github.com/microsoft/postgres-skills/compare/0a4a57e1b5e3118793413efa6b5263dd7c80e5f8...postgres-skills--v0.1.1
[0.1.0]: https://github.com/microsoft/postgres-skills/compare/c4f1d197d1f2ed675c5e2b05df42c79efef702c5...0a4a57e1b5e3118793413efa6b5263dd7c80e5f8
