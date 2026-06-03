# PostgreSQL Agent Skills — Evaluation Pipeline

Measures whether skills improve agent output quality via control vs test group comparison.

## Architecture

```
evals/
├── pipeline.py              # Main orchestrator for quality evals
├── challenges/
│   ├── challenges.yaml      # Quality challenges (positive + negative)
│   └── routing_challenges.yaml
├── host_adapters/           # Host-specific routing simulations
├── matchers/
│   └── __init__.py          # Pattern matchers, hallucination detector, SQL validator
├── judges/
│   └── __init__.py          # LLM-as-judge prompt templates
└── results/                 # Generated reports (gitignored)
```

## Quick Start

```bash
# Dry run (validates pipeline structure with mock agent)
python evals/pipeline.py --dry-run

# Fast routing eval (no LLM calls)
python -m pytest tests/test_routing_eval.py

# Full run (requires configured agent)
python evals/pipeline.py --model gpt-4o
```

## Scoring Rubric

| Metric | Threshold |
|--------|-----------|
| Syntax Accuracy | 100% |
| Tool Selection | >90% |
| Token Efficiency | Pass/fail per tier |
| Hallucination Rate | 0% |
| Activation Precision | <20% false activations |
| Routing Precision / Recall | Track by host via `tests/test_routing_eval.py` |

## Challenge Structure (50 total)

- **20 generic PostgreSQL** challenges across 8 skills
- **30 Azure PostgreSQL** challenges across 13 skills
- Mix of positive (should activate skill) and negative (should NOT activate)
- Difficulty levels: easy, medium, hard
- Each challenge defines `expected_patterns` and `anti_patterns`

## Components

### Pattern Matchers (`matchers/`)
- **PatternMatcher**: Regex evaluation against expected/anti patterns
- **HallucinationDetector**: Flags managed-service violations (ALTER SYSTEM, superuser, etc.)
- **SQLSyntaxValidator**: Basic SQL correctness checks
- **TokenBudgetValidator**: Verifies output fits within tier token limits

### LLM Judges (`judges/`)
- **Skill Quality Judge**: Scores correctness, completeness, safety, best practices
- **Activation Precision Judge**: Validates correct skill routing
- **Hallucination Judge**: Semantic hallucination detection

### Pipeline (`pipeline.py`)
- Loads challenges from YAML
- Runs each challenge in control (no skill) and test (with skill) groups
- Computes per-skill confusion matrix (TP/FP/FN/TN)
- Generates delta report showing skill improvement
- Saves JSON results to `results/`

## Output

Reports include:
- Overall precision, recall, F1 score
- Control vs test score delta (measures skill ROI)
- Per-skill confusion matrix
- Hallucination counts
- False activation rate
