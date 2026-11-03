---
name: update-plugin-release
description: "Maintain Postgres Skills plugin releases in this repository: choose a semantic version, update plugin manifests and marketplace listings, and maintain both changelogs without bumping the marketplace's own version. Use when preparing a plugin release or updating its version."
---

# Update plugin release

This is a repository-maintenance skill, not part of the distributed plugin.
Keep it under `.github/skills/`, outside the installable `plugin/` payload.

## Choose the semantic version

Inspect the current manifests, plugin changelog, Git history, and release tags
before choosing a version. Distinguish a prepared version from a tagged or
published release; do not infer publication from a manifest alone.
If the user specifies a target version, use it unless it conflicts with the
release history or the policy below; explain the conflict before proceeding.

Use Semantic Versioning (`MAJOR.MINOR.PATCH`):

- Patch: backward-compatible fixes and documentation refinements.
- Minor: new backward-compatible capabilities, including new skill reference
  topics that enable additional workflows.
- Major: incompatible changes to an established public interface at `1.0.0`
  or later.
- Before `1.0.0`, use a minor bump for new capabilities or breaking changes,
  and a patch bump for compatible fixes. Describe breaking changes explicitly.
  Do not move to `1.0.0` without a user decision to declare a stable interface.

Choose the highest required bump across the pending changes. Do not bump again
merely because a prepared release is being edited.

## Update the plugin and listing versions

Set the same plugin version in all three host manifests:

- `plugin/plugin.json`
- `plugin/.claude-plugin/plugin.json`
- `plugin/.codex-plugin/plugin.json`

Update the `postgres-skills` entry's `version` in all marketplace entrypoints:

- `.github/plugin/marketplace.json`
- `.claude-plugin/marketplace.json`
- `.agents/plugins/marketplace.json`

Keep the marketplace entrypoints identical. Leave their
`metadata.version` unchanged: it versions the marketplace independently and
is outside this skill's scope. Do not change MCP dependency versions unless
the requested release includes that change.

## Maintain the changelogs

In `plugin/CHANGELOG.md`, group the release's changes under its version and date
using `Added`, `Changed`, `Fixed`, or other applicable Keep a Changelog
categories. Move the included pending changes out of `[Unreleased]`, retaining
that heading for subsequent work. Use the actual preparation date; do not
invent a publication date. Keep version links accurate and use existing
commits rather than links to tags that do not exist.

In root `CHANGELOG.md`, record the plugin listing bump under `[Unreleased]`
and link to the matching plugin release heading. Do not create a new
marketplace version section solely for a plugin release. Keep detailed plugin
changes in the plugin changelog.

## Validate and report

Run the focused repository checks with the available test environment:

```bash
python -m pytest tests/test_repo_structure.py -q
git diff --check
```

Verify the requested version appears in every plugin manifest and listing,
the marketplace metadata versions are unchanged, and changelog links resolve.
Preserve unrelated edits and keep the change limited to release maintenance.

The awesome-copilot listing is a separate registry with a pinned source commit.
A release here does not update it automatically. If distribution through
awesome-copilot is requested, its listing version and `source.sha` must point
to the intended merged release commit; its generated marketplace manifest
must then be regenerated. Do not submit that update, push, open a PR, create
a tag, or publish a release without explicit user authorization.
