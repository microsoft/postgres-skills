# Skill Value Analysis

**Generated**: 2026-05-14  
**Eval Report**: `results/report_20260513_224552.json`  
**Purpose**: Periodic check to identify low-value skills for removal or rework.

---

## Scoring Methodology

Each skill is scored on 4 dimensions:

| Dimension | Weight | Description |
|-----------|--------|-------------|
| **Delta** | 40% | Judge score improvement (test - control). Negative = skill hurts. |
| **Hallucination Safety** | 25% | Does skill introduce hallucinations vs control? |
| **Absolute Quality** | 20% | Raw judge score of test responses. |
| **Challenge Coverage** | 15% | Number of challenges testing this skill. |

**Value Rating**: HIGH (score > 0.7) | MEDIUM (0.4-0.7) | LOW (< 0.4) | NEGATIVE (delta < -0.05)

---

## Current Skill Value Matrix

### Generic PostgreSQL Skills (8)

| Skill | Test Avg | Ctrl Avg | Delta | Halluc (T/C) | Value Rating | Notes |
|-------|----------|----------|-------|--------------|--------------|-------|
| query-performance | 0.935 | 0.940 | -0.005 | 1/1 | MEDIUM | Near-zero delta; model already knows this well |
| connection-management | 0.915 | 0.895 | +0.020 | 1/5 | MEDIUM | Reduces hallucinations (good), small positive delta |
| advanced-indexing | 0.910 | 0.900 | +0.010 | 1/0 | MEDIUM | Marginal improvement, introduces 1 hallucination |
| full-text-search | 0.900 | 0.930 | -0.030 | 0/0 | LOW | Negative delta; skill confuses model |
| row-level-security | 0.875 | 0.870 | +0.005 | 0/2 | MEDIUM | Near-zero delta, but reduces hallucinations |
| logical-replication | 0.845 | 0.840 | +0.005 | 3/3 | LOW | No delta improvement, high hallucination rate |
| jsonb-patterns | 0.825 | 0.830 | -0.005 | 0/0 | LOW | Negative delta; model knows JSON well already |
| table-partitioning | 0.645 | 0.865 | -0.220 | 1/0 | **NEGATIVE** | Worst performer; skill actively harms output |

### Azure-Specific Skills (11)

> **Note (2026-05-14):** Skills were consolidated — `azure-ai-extension`, `embeddings-azure-ai`, and `ai-functions` merged into `azure-ai`; `rag-pipeline` merged into `genai-patterns`. Scores below are pre-consolidation baselines. Re-run evals for current numbers.

| Skill | Test Avg | Ctrl Avg | Delta | Halluc (T/C) | Value Rating | Notes |
|-------|----------|----------|-------|--------------|--------------|-------|
| upgrades-maintenance | 0.955 | 0.820 | +0.135 | 1/2 | **HIGH** | Best delta; clear differentiated knowledge |
| azure-ai *(was azure-ai-extension + ai-functions + embeddings-azure-ai)* | 0.900 | 0.805 | +0.095 | 0/2 | **HIGH** | Consolidated; re-eval needed |
| intelligent-tuning | 0.910 | 0.860 | +0.050 | 0/0 | HIGH | Good delta, clean execution |
| extension-lifecycle | 0.940 | 0.890 | +0.050 | 0/1 | HIGH | Good delta, reduces hallucinations |
| connection-pooling | 0.985 | 0.965 | +0.020 | 0/0 | MEDIUM | High quality but small delta |
| ha-disaster-recovery | 0.992 | 0.976 | +0.016 | 0/0 | MEDIUM | Very high quality, marginal delta |
| provisioning | 0.984 | 0.968 | +0.016 | 1/1 | MEDIUM | High quality, marginal delta |
| networking-ssl | 0.995 | 0.985 | +0.010 | 0/0 | MEDIUM | Near-perfect but model already knows networking |
| entra-id-auth | 0.895 | 0.905 | -0.010 | 0/0 | LOW | Negative delta; model knows auth patterns |
| genai-patterns *(was rag-pipeline)* | 0.865 | 0.870 | -0.005 | 0/0 | LOW | Consolidated; re-eval needed |
| vector-diskann | 0.767 | 0.807 | -0.040 | 0/1 | **NEGATIVE** | Skill hurts; speculative content confuses model |

---

## Summary by Value Tier

| Tier | Count | Skills |
|------|-------|--------|
| **HIGH** | 4 | upgrades-maintenance, azure-ai, intelligent-tuning, extension-lifecycle |
| **MEDIUM** | 7 | connection-pooling, ha-disaster-recovery, provisioning, networking-ssl, query-performance, connection-management, advanced-indexing |
| **LOW** | 5 | full-text-search, jsonb-patterns, entra-id-auth, genai-patterns, row-level-security, logical-replication* |
| **NEGATIVE** | 2 | table-partitioning, vector-diskann |

*logical-replication borderline LOW due to hallucination rate

---

## Recommendations

### Immediate Action (NEGATIVE value)

| Skill | Action | Rationale |
|-------|--------|-----------|
| table-partitioning | **Rework or Remove** | -0.220 delta is catastrophic. Hallucination-prone syntax examples. Fix committed but untested. |
| vector-diskann | **Rework** | -0.040 delta. Speculative parameters removed in latest fix. Re-eval needed. |

### Monitor (LOW value)

| Skill | Action | Rationale |
|-------|--------|-----------|
| full-text-search | Simplify enrichment | -0.030 delta. Model already handles FTS well. |
| jsonb-patterns | Simplify enrichment | -0.005 delta. JSON/JSONB widely known. |
| entra-id-auth | Add more differentiated content | -0.010 delta. Auth patterns generic. |
| genai-patterns *(was rag-pipeline)* | Add Azure-specific RAG details | -0.005 delta. Generic RAG well-known. |

### Keep (HIGH + strong MEDIUM)

Skills with positive delta and no hallucination increase are delivering clear value:
- upgrades-maintenance (+0.135): Best performer, keep as-is
- azure-ai (+0.095): Strong differentiation (consolidated from 3 skills)
- intelligent-tuning (+0.050): Clean high-delta skill
- extension-lifecycle (+0.050): Good delta, reduces false info

---

## Decision Criteria for Removal

Remove a skill if ALL of the following are true after rework attempt:
1. Delta remains negative after 2 rework cycles
2. Absolute test score < 0.800
3. Hallucination count in test > control
4. No unique content that models consistently lack

---

## Re-evaluation Schedule

Run this analysis after each eval pipeline execution. Compare against this baseline to track improvement.

| Date | Overall Delta | Negative Skills | Action Taken |
|------|--------------|-----------------|--------------|
| 2026-05-13 | +0.002 (judge) | 3 | Fix 1-3 committed |
| _next run_ | _pending_ | _pending_ | _compare_ |
