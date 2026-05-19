---
name: vector-diskann
description: "Azure Database for PostgreSQL vector search with DiskANN and pgvector: index selection, filtered search, distance operations, and quantization"
tags: [azure, postgresql, vector, diskann, pgvector, hnsw, similarity-search]
platform_scope: azure-postgresql
activation:
  user_intent:
    - vector similarity search on Azure PostgreSQL
    - choose between DiskANN and HNSW indexes
    - filtered vector search with metadata
    - which distance function to use for embeddings
    - create a vector index on my table
  technical_keywords:
    - diskann
    - hnsw
    - pgvector
    - pg_diskann
    - vector_cosine_ops
    - vector_l2_ops
    - "<=>", "<->", "<#>"
    - CREATE INDEX USING diskann
  exclusion_conditions:
    - "when user needs to generate embeddings, use `azure-postgresql/genai-patterns/` instead"
    - "when user needs end-to-end RAG pipeline, use `azure-postgresql/genai-patterns/` instead"
  adjacent_skills:
    - "`azure-postgresql/genai-patterns/`"
---

## Key Facts (what models get wrong)

| Fact | Detail |
|------|--------|
| DiskANN is Azure-only | Requires `pg_diskann` extension on Flexible Server only; not available on community PostgreSQL |
| Streaming DiskANN is Preview | Not GA; do not promise production-ready streaming indexing |
| Requires pgvector 0.7+ | Both `vector` AND `pg_diskann` must be installed; pgvector is a prerequisite |
| CREATE EXTENSION pg_diskann required | Separate from pgvector; must explicitly create both extensions |
| Not available on Burstable tier | DiskANN indexes require General Purpose or Memory Optimized SKUs |
| Operator/ops class must match | `vector_cosine_ops` pairs with `<=>`, `vector_l2_ops` with `<->`, `vector_ip_ops` with `<#>` |
| Both extensions need allowlisting | `azure.extensions` server parameter must include both `vector` and `pg_diskann` |
| HNSW tuning params | `m` (connectivity, default 16), `ef_construction` (build quality, default 64) |

## Decision Matrix

| Factor | DiskANN | HNSW | IVFFlat |
|--------|---------|------|---------|
| Dataset size | > 1M vectors | < 1M vectors | Legacy only |
| Memory usage | Low (disk-based) | High (in-memory) | Medium |
| Build speed | Fast | Slow | Fast |
| Recall | 95-98% | 95-99% | 85-95% |
| Filtered search | Native (efficient) | Post-filter (may under-return) | Post-filter |
| Multi-tenant apps | Preferred | Slower | Not recommended |

## Critical Gotchas

1. **Mismatched ops class is silent**: Index is simply not used; query returns wrong ordering with no error
2. **Allowlist both extensions**: Forgetting `pg_diskann` in `azure.extensions` gives `ERROR: access to library "pg_diskann" is not allowed`
3. **HNSW ef_search default is low**: Default 40; set `SET hnsw.ef_search = 200` for production recall
4. **DiskANN search_list_size**: Default 100; increase with `SET diskann.search_list_size = 200` for higher recall
5. **Index build monitoring**: Use `pg_stat_progress_create_index`; prefer `CREATE INDEX CONCURRENTLY` to avoid blocking
6. **Seq scan fallback**: If index not used, run `ANALYZE` on table or increase `LIMIT` value
7. **HNSW OOM**: Large tables may exhaust `maintenance_work_mem`; switch to DiskANN

## Anti-Hallucination Rules

- Do NOT claim DiskANN works on community PostgreSQL or any non-Azure deployment
- Do NOT claim DiskANN is available on Burstable tier
- Do NOT mix operator and ops class (e.g., `<->` with `vector_cosine_ops`)
- Do NOT omit `CREATE EXTENSION pg_diskann` (it is separate from pgvector)
- Do NOT claim IVFFlat is recommended for new workloads

## References
- [pg_diskann extension for Azure Database for PostgreSQL](https://learn.microsoft.com/azure/postgresql/flexible-server/how-to-use-pgvector)
- [pgvector extension](https://learn.microsoft.com/azure/postgresql/flexible-server/how-to-use-pgvector)
