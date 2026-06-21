-- ============================================================================
-- セキュリティ強化
--   * matches の直接 update policy を廃止し、dismissed のみ RPC 経由で更新。
--   * 通知送信の多重実行に備え、送信中ステータスと開始時刻を追加。
-- ============================================================================

alter type notification_status add value if not exists 'processing';

alter table notifications
  add column if not exists processing_started_at timestamptz;

drop policy if exists matches_update_own on matches;

create or replace function dismiss_match(p_match_id uuid, p_dismissed boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update matches m
  set dismissed = p_dismissed
  where m.id = p_match_id
    and exists (
      select 1 from businesses b
      where b.id = m.business_id and b.user_id = auth.uid()
    );
end;
$$;

revoke all on function dismiss_match(uuid, boolean) from public;
grant execute on function dismiss_match(uuid, boolean) to authenticated;
