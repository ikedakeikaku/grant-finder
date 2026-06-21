-- ============================================================================
-- リード承認ゲート
--   * 登録直後の事業者は pending_review とし、高コスト処理やメール送信の対象外にする。
--   * lead_status / approved_at は運用状態なので authenticated ユーザーの直接変更から保護する。
--   * private.leads に承認状態を表示する。
-- ============================================================================

alter table businesses
  add column if not exists lead_status text not null default 'pending_review',
  add column if not exists approved_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'businesses_lead_status_check'
      and conrelid = 'businesses'::regclass
  ) then
    alter table businesses
      add constraint businesses_lead_status_check
      check (lead_status in ('pending_review', 'approved', 'suspended'));
  end if;
end;
$$;

create index if not exists businesses_lead_status_idx
  on businesses (lead_status);

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
      new.lead_status = 'pending_review';
      new.approved_at = null;
    else
      new.proposal_status = old.proposal_status;
      new.proposal_refreshed_at = old.proposal_refreshed_at;
      new.lead_status = old.lead_status;
      new.approved_at = old.approved_at;
    end if;
  end if;
  return new;
end;
$$;

create or replace view private.leads as
select
  u.id as user_id,
  u.email as auth_email,
  u.email_confirmed_at,
  u.last_sign_in_at,
  u.created_at as signed_up_at,
  b.id as business_id,
  b.name as business_name,
  b.lead_status,
  b.approved_at,
  b.notify_email,
  b.notifications_enabled,
  b.industry,
  b.prefecture,
  b.city,
  b.employee_count,
  b.annual_revenue,
  b.founded_year,
  b.purposes,
  b.interests,
  b.planned_investment,
  b.proposal_status,
  b.proposal_refreshed_at,
  b.created_at as profile_created_at,
  b.updated_at as profile_updated_at
from auth.users u
left join public.businesses b on b.user_id = u.id;

comment on view private.leads is
  'Admin-only lead list. Keep the private schema out of exposed API schemas.';

revoke all on private.leads from public;
revoke all on private.leads from anon;
revoke all on private.leads from authenticated;
grant select on private.leads to service_role;
