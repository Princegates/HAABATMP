-- Recomputes the audit hash chain. Used by GET /audit/verify and by operations (select * from audit_verify()).
create or replace function audit_verify()
returns table (checked bigint, first_bad_seq bigint, bad_rows bigint, missing_entries bigint)
language sql stable as $$
  with chain as (
    select seq, hash, prev_hash,
           lag(hash) over (order by seq) as expected_prev,
           lag(seq) over (order by seq) as prev_seq,
           encode(sha256(convert_to(prev_hash || '|' || seq::text || '|' || to_char(at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || '|' ||
             coalesce(actor_id::text, '') || '|' || action || '|' || entity_type || '|' || coalesce(entity_id, '') || '|' ||
             coalesce(before_data::text, '') || '|' || coalesce(after_data::text, ''), 'UTF8')), 'hex') as expected_hash
      from audit_logs
  ), flagged as (
    select seq,
           (prev_hash is distinct from coalesce(expected_prev, '')) or (hash is distinct from expected_hash) as bad,
           (prev_seq is not null and seq <> prev_seq + 1) as gap
      from chain
  )
  select count(*)::bigint, min(seq) filter (where bad or gap), count(*) filter (where bad)::bigint, count(*) filter (where gap)::bigint from flagged;
$$;
