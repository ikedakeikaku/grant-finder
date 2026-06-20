-- ============================================================================
-- grant-finder 初期スキーマ
--
-- 中核フロー:
--   auth.users ─ businesses(事業者プロフィール) ─ matches(提案) ─ notifications(通知)
--
-- 補助金データの源泉:
--   subsidies           … jGrants API から取得した「現在/過去の公募」キャッシュ
--   subsidy_schedules   … 制度ごとの公募履歴(回次)。例年パターン学習の元データ
--   subsidy_predictions … 上記から算出した「公募開始前の予測」
--   budget_signals      … 概算要求/補正/当初予算の動向シグナル(公募前把握の源泉)
--
-- セキュリティ方針:
--   * 全テーブルで RLS 有効。
--   * ユーザーは自分の businesses / matches / notifications のみ参照可。
--   * 補助金参照データ(subsidies/schedules/predictions)は認証済みユーザーが閲覧可。
--   * 書き込み(取込・マッチ生成・通知)とbudget_signalsはサービスロール経由(RLSをバイパス)。
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Enums
-- ----------------------------------------------------------------------------
create type subsidy_status as enum (
  'upcoming',     -- 公募開始前(予定)
  'open',         -- 受付中
  'closing_soon', -- 締切間近
  'closed'        -- 終了
);

create type match_kind as enum ('open', 'predicted');

create type notification_type as enum (
  'new_match',     -- 新しくマッチした補助金
  'pre_announce',  -- 例年そろそろ公募が始まる(公募前予測)
  'opened',        -- 公募が始まった
  'deadline_30d',  -- 締切30日前(主軸)
  'deadline_14d',  -- 締切14日前
  'deadline_7d'    -- 締切7日前
);

create type notification_channel as enum ('email', 'line');

create type notification_status as enum (
  'scheduled',
  'processing',
  'sent',
  'failed',
  'skipped'
);

create type budget_signal_kind as enum (
  'gaisan_youkyuu', -- 概算要求
  'hosei',          -- 補正予算
  'tousho'          -- 当初予算(成立)
);

-- ----------------------------------------------------------------------------
-- updated_at 自動更新トリガ
-- ----------------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- businesses: 事業者プロフィール(auth.users に紐付く)
-- ----------------------------------------------------------------------------
create table businesses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  name text not null,
  corporate_number text,                       -- 法人番号(任意)
  industry text,                               -- 業種(日本標準産業分類の大分類など)
  prefecture text,                             -- 所在地(都道府県)
  city text,
  employee_count integer,
  annual_revenue integer,                      -- 年商(万円)
  founded_year integer,
  description text,

  -- マッチングに使う関心・目的。例: ["設備投資","IT導入","販路開拓","省力化","事業承継"]
  purposes jsonb not null default '[]'::jsonb,
  interests jsonb not null default '[]'::jsonb,
  planned_investment text,                     -- 予定している投資の自由記述

  notify_email text,
  notify_line_user_id text,
  notifications_enabled boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index businesses_user_id_idx on businesses (user_id);
create trigger businesses_set_updated_at before update on businesses
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- subsidies: jGrants 補助金キャッシュ
-- ----------------------------------------------------------------------------
create table subsidies (
  id text primary key,                         -- jGrants の補助金ID(<=18文字)
  name text,                                   -- 管理番号 (例: S-01100011)
  title text not null,
  catch_phrase text,
  detail text,

  use_purpose text,                            -- 例: "新たな事業を行いたい / 設備整備・IT導入をしたい"
  industry text,
  target_area_search text,
  target_area_detail text,
  target_number_of_employees text,

  subsidy_rate text,
  subsidy_max_limit bigint,

  acceptance_start_datetime timestamptz,
  acceptance_end_datetime timestamptz,
  project_end_deadline timestamptz,

  institution_name text,
  front_subsidy_detail_page_url text,

  status subsidy_status not null default 'open',
  schedule_key text,                           -- 制度名寄せキー(回次・年度を除く)

  raw jsonb,                                   -- API レスポンス全体(将来の項目追加に備える)

  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index subsidies_status_idx on subsidies (status);
create index subsidies_end_idx on subsidies (acceptance_end_datetime);
create index subsidies_schedule_key_idx on subsidies (schedule_key);
create trigger subsidies_set_updated_at before update on subsidies
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- subsidy_schedules: 公募履歴(予測の学習元)
-- ----------------------------------------------------------------------------
create table subsidy_schedules (
  id uuid primary key default gen_random_uuid(),
  schedule_key text not null,
  name text not null,                          -- 制度名(表示用)
  round text,                                  -- 回次 (例: "第54回", "19次")
  fiscal_year integer,                         -- 年度(西暦)

  acceptance_start timestamptz,
  acceptance_end timestamptz,
  project_end_deadline timestamptz,

  subsidy_id text references subsidies (id) on delete set null,
  source text not null default 'jgrants',      -- jgrants / manual / smrj 等

  created_at timestamptz not null default now()
);
create index subsidy_schedules_key_idx on subsidy_schedules (schedule_key);
create unique index subsidy_schedules_key_start_uq
  on subsidy_schedules (schedule_key, acceptance_start);

-- ----------------------------------------------------------------------------
-- subsidy_predictions: 公募開始前の予測
-- ----------------------------------------------------------------------------
create table subsidy_predictions (
  id uuid primary key default gen_random_uuid(),
  schedule_key text not null,
  name text not null,
  fiscal_year integer not null,

  predicted_start_from timestamptz,
  predicted_start_to timestamptz,

  confidence real not null default 0,          -- 0..1
  basis text,                                  -- 根拠の説明(例年◯月に公募 等)
  sample_size integer not null default 0,      -- 学習に使った過去回数

  active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index subsidy_predictions_key_year_uq
  on subsidy_predictions (schedule_key, fiscal_year);
create trigger subsidy_predictions_set_updated_at before update on subsidy_predictions
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- budget_signals: 予算動向シグナル(公募前把握の源泉)
-- ----------------------------------------------------------------------------
create table budget_signals (
  id uuid primary key default gen_random_uuid(),
  schedule_key text,                           -- 制度に紐づく場合
  program_name text not null,                  -- 制度/施策名
  kind budget_signal_kind not null,
  source_url text,
  detected_at timestamptz not null default now(),
  status text not null default 'new',          -- new / reviewed / dismissed
  note text,
  created_at timestamptz not null default now()
);
create index budget_signals_schedule_key_idx on budget_signals (schedule_key);

-- ----------------------------------------------------------------------------
-- matches: 提案(現在公募中 open / 予測 predicted)
-- ----------------------------------------------------------------------------
create table matches (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,

  kind match_kind not null,
  -- open の場合は subsidy_id、predicted の場合は prediction_id が入る
  subsidy_id text references subsidies (id) on delete cascade,
  prediction_id uuid references subsidy_predictions (id) on delete cascade,

  score real not null default 0,               -- 0..1 の適合度
  reasons jsonb not null default '[]'::jsonb,
  dismissed boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index matches_business_idx on matches (business_id);
create unique index matches_business_subsidy_uq on matches (business_id, subsidy_id);
create unique index matches_business_prediction_uq on matches (business_id, prediction_id);
create trigger matches_set_updated_at before update on matches
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- notifications: 通知ログ(二重送信防止つき)
-- ----------------------------------------------------------------------------
create table notifications (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  match_id uuid references matches (id) on delete cascade,

  type notification_type not null,
  channel notification_channel not null default 'email',
  status notification_status not null default 'scheduled',

  scheduled_for timestamptz not null,
  processing_started_at timestamptz,
  sent_at timestamptz,

  payload jsonb,
  error text,

  created_at timestamptz not null default now()
);
create index notifications_due_idx on notifications (status, scheduled_for);
-- 同一マッチ・同一種別・同一チャネルの二重送信を防ぐ
create unique index notifications_dedupe_uq on notifications (match_id, type, channel);

-- ============================================================================
-- Row Level Security
-- ============================================================================
alter table businesses enable row level security;
alter table subsidies enable row level security;
alter table subsidy_schedules enable row level security;
alter table subsidy_predictions enable row level security;
alter table budget_signals enable row level security;
alter table matches enable row level security;
alter table notifications enable row level security;

-- businesses: 本人のみ CRUD
create policy businesses_select_own on businesses
  for select using (auth.uid() = user_id);
create policy businesses_insert_own on businesses
  for insert with check (auth.uid() = user_id);
create policy businesses_update_own on businesses
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy businesses_delete_own on businesses
  for delete using (auth.uid() = user_id);

-- 補助金参照データ: 認証済みユーザーは閲覧のみ(書き込みはサービスロール)
create policy subsidies_select_auth on subsidies
  for select to authenticated using (true);
create policy subsidy_schedules_select_auth on subsidy_schedules
  for select to authenticated using (true);
create policy subsidy_predictions_select_auth on subsidy_predictions
  for select to authenticated using (true);

-- matches: 自分の事業のものだけ閲覧。更新は下の RPC 経由で dismissed のみ許可。
create policy matches_select_own on matches
  for select using (
    exists (
      select 1 from businesses b
      where b.id = matches.business_id and b.user_id = auth.uid()
    )
  );

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

-- notifications: 自分の事業のものだけ閲覧(書き込みはサービスロール)
create policy notifications_select_own on notifications
  for select using (
    exists (
      select 1 from businesses b
      where b.id = notifications.business_id and b.user_id = auth.uid()
    )
  );

-- budget_signals: 通常ユーザーにはポリシーを与えない(= サービスロール/管理のみ)
