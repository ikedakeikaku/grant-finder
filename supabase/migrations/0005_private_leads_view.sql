-- ============================================================================
-- 管理用リードビュー
--   * 登録メール(auth.users)と事業者プロフィール(public.businesses)を
--     private schema の view にまとめる。
--   * anon / authenticated には schema usage も select も与えず、通常ユーザーから
--     リード一覧が見えない状態を維持する。
--   * users は自分のプロフィールを更新できるが、APIから直接削除はできないようにする。
-- ============================================================================

create schema if not exists private;

revoke all on schema private from public;
revoke all on schema private from anon;
revoke all on schema private from authenticated;

drop policy if exists businesses_delete_own on businesses;

create or replace view private.leads as
select
  u.id as user_id,
  u.email as auth_email,
  u.email_confirmed_at,
  u.last_sign_in_at,
  u.created_at as signed_up_at,
  b.id as business_id,
  b.name as business_name,
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
grant usage on schema private to service_role;
grant select on private.leads to service_role;
