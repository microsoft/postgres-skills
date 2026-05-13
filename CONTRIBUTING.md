# Contributing to PostgreSQL Agent Skills

Thank you for your interest in improving these skills! This guide covers how to add new skills or improve existing ones.

## Skill Structure

Every skill lives in its own folder with a `SKILL.md` file:

```
{scope}/{skill-name}/SKILL.md
```

Where `{scope}` is either `postgresql` or `azure-postgresql`.

## SKILL.md Template

```yaml
---
name: skill-name
description: "One-line description"
version: "1.0.0"
tags: [postgresql, topic]
execution_mode: sequential
requires_confirmation: false
platform_scope: postgresql | azure-postgresql
---
```

### Required Sections

1. **When to Use** — Trigger conditions, exclusions, overlaps with other skills
2. **Prerequisites** — Extensions, permissions, or config needed
3. **Instructions** — Step-by-step guidance (the core content)
4. **Common Mistakes** — Pitfalls the agent should avoid
5. **Verification** — How to confirm the skill was applied correctly
6. **Failure Recovery** — What to do when things go wrong

## Quality Standards

- Token budget: 800-1,200 tokens (generic), 1,500-1,800 tokens (Azure AI/RAG)
- Hard cap: 2,000 tokens (tiktoken cl100k_base)
- Use `CREATE EXTENSION vector` (binary name), not `CREATE EXTENSION pgvector`
- Azure skills must use `azure_pg_admin` role, never reference superuser
- Include non-reversible operation warnings BEFORE the command
- No diagnostic loops (no pre-query role checks)

## Testing

Run the eval suite before submitting:

```bash
npm test
```

## Pull Request Process

1. Fork the repository
2. Create a feature branch
3. Add or modify skill(s)
4. Run `npm run lint` to validate token budgets and structure
5. Submit a PR with a clear description of what the skill teaches
