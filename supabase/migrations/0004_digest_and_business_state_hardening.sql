-- ============================================================================
-- 提案書ダイジェストと事業者状態の保護
--   * match_id が null の proposal_digest は既存 dedupe index が効かないため、
--     未送信/送信中の business 単位重複をDB制約で防ぐ。
--   * proposal_status / proposal_refreshed_at は運用状態なので、
--     authenticated ユーザーの直接 insert/update から保護する。
-- ============================================================================

with ranked as (
  select
    id,
    row_number() over (
      partition by business_id, type, channel
      order by created_at asc, id asc
    ) as rn
  from notifications
  where match_id is null
    and type = 'proposal_digest'
    and status in ('scheduled', 'processing')
)
update notifications n
set status = 'skipped',
    processing_started_at = null,
    error = 'duplicate pending proposal digest suppressed'
from ranked r
where n.id = r.id and r.rn > 1;

create unique index if not exists notifications_business_digest_pending_uq
  on notifications (business_id, type, channel)
  where match_id is null
    and type = 'proposal_digest'
    and status in ('scheduled', 'processing');

create or replace function protect_business_server_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null then
    if TG_OP = 'INSERT' then
      new.proposal_status = 'pending';
      new.proposal_refreshed_at = null;
    else
      new.proposal_status = old.proposal_status;
      new.proposal_refreshed_at = old.proposal_refreshed_at;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists businesses_protect_server_fields on businesses;
create trigger businesses_protect_server_fields
  before insert or update on businesses
  for each row execute function protect_business_server_fields();
