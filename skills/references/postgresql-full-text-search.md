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
- tsquery function selection (websearch vs phrase vs plain)
- Multilingual configuration pitfalls
- Phrase proximity operators and version requirements
- GIN index not being used for FTS queries
- Hybrid search combining FTS with trigram/similarity

Avoid explaining basic tsvector/tsquery setup or GIN index creation unless the user asks for a runnable example.

## Response focus

Prioritize function selection, version-gated features (websearch PG11+), and common production mistakes. The base model knows basic FTS well.

## Common Mistakes

1. **[HIGH] `websearch_to_tsquery` not used for user input**: `to_tsquery` throws syntax errors on special chars

   ❌ Wrong:
   ```sql
   -- User types "c++ programming" → syntax error
   SELECT * FROM articles WHERE search_vector @@ to_tsquery('c++ programming');
   ```

   ✅ Right:
   ```sql
   -- Handles special chars, Google-like syntax (PG 11+)
   SELECT * FROM articles WHERE search_vector @@ websearch_to_tsquery('english', 'c++ programming');
   ```

2. **[HIGH] Phrase search proximity**: `phraseto_tsquery` requires adjacent words only

   ❌ Wrong:
   ```sql
   -- Misses "big enterprise data" — requires exactly adjacent
   WHERE search_vector @@ phraseto_tsquery('big data')
   ```

   ✅ Right:
   ```sql
   -- Allow 1 word between
   WHERE search_vector @@ to_tsquery('big <2> data')
   ```

3. **[MEDIUM] No hybrid FTS + trigram for typo tolerance**: FTS needs exact stems. Combine with `pg_trgm`: `WHERE search_vector @@ q OR similarity(title, input) > 0.3`

4. **[HIGH] Multilingual content in single config**: 'english' config on French content strips wrong stop words. Use `'simple'` for mixed-language

5. **[MEDIUM] ts_headline performance**: Rescans full document. For large docs, highlight a stored summary column instead

6. **[MEDIUM] Zero results from wrong language config**: `SELECT to_tsvector('english', 'running')` should stem to `run` — verify config matches content

7. **[MEDIUM] Index not used**: Ensure query uses `@@` against the indexed tsvector column, not a function call

8. **[MEDIUM] Slow on write-heavy tables**: GIN updates are batched. Tune `gin_pending_list_limit`

9. **[MEDIUM] Unsupported PG version for websearch_to_tsquery**: Requires PG 11+. Older versions: use `plainto_tsquery()`
