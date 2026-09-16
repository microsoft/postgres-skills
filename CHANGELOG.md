# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial repository structure with 21 P0 skills
- 8 generic PostgreSQL foundational skills
- 13 Azure Database for PostgreSQL skills
- Plugin manifests for Claude Code, Copilot CLI, Codex CLI, Cursor
- Eval framework scaffolding
- Beginner installation guidance for Claude Code, Copilot CLI, and Codex CLI
- Plugin setup, permissions, data-access, and privacy documentation

### Changed
- Disable optional postgres-mcp telemetry in the bundled plugin configuration
- Require confirmation before database, graph, file-import, and Azure resource changes
- Store marketplace entrypoints as regular JSON files for Windows compatibility
