---
name: full-text-search
description: "PostgreSQL native full-text search with tsvector, tsquery, GIN indexes, and ranking functions"
tags: [postgresql, full-text-search, tsvector, tsquery, gin, ranking]
platform_scope: postgresql
activation:
  user_intent:
    - "how to add text search to PostgreSQL"
    - "replace LIKE/ILIKE with ranked search"
    - "language-aware stemming or stop words"
    - "how to rank search results by relevance"
    - "phrase search in PostgreSQL"
  technical_keywords:
    - tsvector
    - tsquery
    - to_tsvector
    - ts_rank
    - websearch_to_tsquery
    - plainto_tsquery
    - phraseto_tsquery
    - setweight
    - "@@"
    - GIN
    - ts_headline
    - gin_pending_list_limit
  exclusion_conditions:
    - "when exact substring matching is sufficient (LIKE or trigram pg_trgm), do not use this skill"
  adjacent_skills:
    - "`postgresql/advanced-indexing/`"
---

# Full-Text Search

## When to use this skill

Use for production PostgreSQL issues involving:
- user-input query parsing and sanitization
- ranking that matches user expectations
- stale or incorrectly maintained search vectors
- multilingual text, product codes, SKUs, and proper nouns
- GIN usage problems and hybrid FTS + trigram search

Do not spend tokens re-explaining basic `tsvector`, `tsquery`, or GIN setup. Focus on production failure modes.

## Response focus

Prioritize ranking correctness, vector maintenance, language configuration, and cases where PostgreSQL FTS is the wrong tool for exact-token identifiers.

## Design choices that prevent bad advice

- Keep **prose** and **exact-token identifiers** separate. Product names, SKUs, issue IDs, and email-like strings often need `simple`, trigram, or exact matching rather than pure stemming.
- Prefer a **stored/generated vector** over recomputing `to_tsvector(...)` in every query. It prevents stale logic drift and keeps the index path obvious.
- Decide ranking semantics up front: raw frequency, length-normalized relevance, or proximity-aware relevance. Otherwise agents default to whatever ranking function they remember first.
- Treat typo tolerance as a separate requirement. PostgreSQL FTS does not magically become fuzzy search without `pg_trgm` or an external search engine.
- When results look surprising, inspect tokenization directly with `ts_debug` or `to_tsvector(...)` before blaming the index. Many "bad search" incidents are actually parser/config mismatches.

## Useful checks

```sql
-- Verify the config is tokenizing the way you expect
SELECT to_tsvector('english', 'ACME-123 running shoes');

-- Check whether the query is using the stored/indexed vector
EXPLAIN ANALYZE
SELECT id
FROM articles
WHERE search_vector @@ websearch_to_tsquery('english', 'running shoes');
```

## Index pattern

Create a GIN index on the stored `tsvector` column so `@@` queries can use a Bitmap Index Scan:

```sql no-execute
-- GIN index on the stored tsvector column (pairs with the generated column above)
CREATE INDEX idx_articles_search_vector
  ON articles
  USING gin (search_vector);
```

Pair the GIN index with `setweight` for title(A) vs body(B) ranking when you need weighted relevance.

## Common Mistakes / Gotchas

1. **[HIGH] `websearch_to_tsquery` not used for raw user input**: Agents feed arbitrary user text into `to_tsquery`, which breaks on punctuation, quotes, operators, and inputs like `c++`.

   Fix: use `websearch_to_tsquery` for search-box input on PG 11+, and reserve `to_tsquery` for already-sanitized expert syntax.

2. **[HIGH] Ranking normalization confusion**: The agent uses `ts_rank()` without normalization. Raw rank is biased toward longer documents, so large documents often float to the top even when they are a worse semantic match.

   Fix: use `ts_rank(vector, query, 32)` for length normalization, or `ts_rank_cd` when proximity should matter.

3. **[HIGH] `tsvector` not maintained on `UPDATE`**: The agent adds a `tsvector` column, backfills it once, and forgets that future updates silently make search results stale.

   Fix: use a generated stored column on PG 12+:
   ```sql no-execute
   search_vector tsvector
     GENERATED ALWAYS AS (to_tsvector('english', coalesce(title, '') || ' ' || coalesce(body, '')))
     STORED
   ```
   On older versions, use a trigger.

4. **[MEDIUM] Stemming / stop-word surprises**: The agent uses the `english` config for product codes, SKUs, names, or proper nouns. Those tokens may be stemmed, split, or dropped, leading to "search is broken" reports.

   Fix: use `simple` for exact-token fields, or maintain separate vectors/configs for prose vs identifier fields and combine them at query time.

5. **[HIGH] Phrase search assumptions are too strict**: `phraseto_tsquery('big data')` requires adjacent terms. Users expect near matches like `big enterprise data`.

   Fix: for proximity search, use explicit distance operators such as `to_tsquery('big <2> data')` instead of assuming phrase search is fuzzy.

6. **[MEDIUM] Index not used because the query recomputes vectors**: Agents write `to_tsvector(...) @@ ...` in the predicate even though a stored `search_vector` column exists. That bypasses the indexed expression or stored column.

   Fix: query the indexed vector column directly and confirm `EXPLAIN` shows a Bitmap Index Scan / Bitmap Heap Scan or similar index-assisted path.

7. **[MEDIUM] No hybrid FTS + trigram fallback for typos**: Native FTS is good at stemming, not misspellings. A search experience that must tolerate typos usually needs `pg_trgm` for fallback matching.

   Fix: combine them intentionally, for example: `search_vector @@ q OR similarity(title, :input) > 0.3`.

8. **[MEDIUM] `ts_headline` used on large documents in the hot path**: Highlighting rescans document text and can dominate response time.

   Fix: highlight a short summary/snippet field, or only apply `ts_headline` after ranking and limiting candidate rows.

9. **[MEDIUM] Slow write-heavy tables blamed on GIN alone**: GIN maintenance is often acceptable, but pending-list growth can hurt bursty write workloads.

   Fix: inspect write patterns and consider tuning `gin_pending_list_limit` rather than dropping FTS entirely.

10. **[MEDIUM] Unsupported version assumptions**: `websearch_to_tsquery` requires PG 11+. Agents should gate recommendations by version instead of assuming newer syntax is always available.
