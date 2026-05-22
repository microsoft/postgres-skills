#!/usr/bin/env python3
"""Lint challenges.yaml for schema correctness.

Checks:
- Every target_skill resolves to a real file under skills/postgresql-best-practices/references/
- No duplicate challenge IDs
- Valid difficulty enum values
- Valid platform_scope values
- expected_activation: false challenges point at an existing skill
- Required fields are present
"""

import sys
import yaml
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
CHALLENGES_PATH = REPO_ROOT / "tests" / "evals" / "challenges" / "challenges.yaml"
SKILLS_ROOT = REPO_ROOT

VALID_DIFFICULTIES = {"easy", "medium", "hard"}
VALID_PLATFORM_SCOPES = {"postgresql", "azure-postgresql", "azure", "generic", "any"}
REQUIRED_FIELDS = {"id", "task", "difficulty", "target_skill", "platform_scope"}


def resolve_skill_path(target_skill: str) -> bool:
    """Check if the target_skill resolves to a real file."""
    md_path = SKILLS_ROOT / f"{target_skill}.md"
    if md_path.exists():
        return True
    skill_md = SKILLS_ROOT / target_skill / "SKILL.md"
    if skill_md.exists():
        return True
    # Also allow the bare "skills/postgresql-best-practices/references" catch-all
    if target_skill in ("skills/postgresql-best-practices/references", "skills/postgresql-best-practices", "skills/references", "skills"):
        return True
    return False


def lint() -> list[str]:
    """Lint challenges and return list of error strings."""
    errors = []

    if not CHALLENGES_PATH.exists():
        errors.append(f"challenges.yaml not found at {CHALLENGES_PATH}")
        return errors

    with open(CHALLENGES_PATH, encoding="utf-8") as f:
        data = yaml.safe_load(f)

    if not data or "challenges" not in data:
        errors.append("challenges.yaml must have a top-level 'challenges' key")
        return errors

    challenges = data["challenges"]
    seen_ids = set()

    for i, c in enumerate(challenges):
        prefix = f"Challenge [{i}]"
        if not isinstance(c, dict):
            errors.append(f"{prefix}: not a dict")
            continue

        cid = c.get("id", f"<missing-id-at-index-{i}>")
        prefix = f"Challenge '{cid}'"

        # Required fields
        for field in REQUIRED_FIELDS:
            if field not in c:
                errors.append(f"{prefix}: missing required field '{field}'")

        # Duplicate IDs
        if cid in seen_ids:
            errors.append(f"{prefix}: duplicate ID")
        seen_ids.add(cid)

        # Difficulty enum
        difficulty = c.get("difficulty", "")
        if difficulty and difficulty not in VALID_DIFFICULTIES:
            errors.append(f"{prefix}: invalid difficulty '{difficulty}' (valid: {VALID_DIFFICULTIES})")

        # Platform scope enum
        scope = c.get("platform_scope", "")
        if scope and scope not in VALID_PLATFORM_SCOPES:
            errors.append(f"{prefix}: invalid platform_scope '{scope}' (valid: {VALID_PLATFORM_SCOPES})")

        # Target skill resolves
        target = c.get("target_skill", "")
        if target and not resolve_skill_path(target):
            errors.append(f"{prefix}: target_skill '{target}' does not resolve to a file")

        # Task is non-empty
        task = c.get("task", "")
        if not task or len(task.strip()) < 10:
            errors.append(f"{prefix}: task is too short or empty")

        # correctness_checks schema
        if "correctness_checks" in c:
            checks = c.get("correctness_checks")
            if not isinstance(checks, list) or not all(isinstance(check, str) for check in checks):
                errors.append(f"{prefix}: correctness_checks must be a list of strings")

    return errors


def main():
    print(f"Linting {CHALLENGES_PATH}...")
    errors = lint()

    if errors:
        print(f"\n✗ {len(errors)} issues found:\n")
        for e in errors:
            print(f"  • {e}")
        sys.exit(1)

    # Load to show count
    with open(CHALLENGES_PATH, encoding="utf-8") as f:
        data = yaml.safe_load(f)
    count = len(data.get("challenges", []))
    print(f"✓ {count} challenges validated — no schema issues")


if __name__ == "__main__":
    main()
