-- ============================================================================
-- 制度マスタ(programs) ＋ 提案書(proposals)
--   * programs: 中小企業支援で実際に効く主要制度のキュレーション・カタログ。
--     提案の母集団。jGrants(live)・予測・予算動向(budget_signals)をこの上に重ねる。
--   * proposals: 事業者ごとの「提案書」ドキュメント(複数カード)。メール/画面表示用。
--   * matches に program_id / kind 'catalog' を追加し、通知エンジンが program 提案を追跡。
--   * businesses に提案の生成状態(proposal_status)を追加。
--   * notification_type に提案書ダイジェスト(proposal_digest)を追加。
-- ============================================================================

-- enum 拡張（0002 と同じく add value if not exists。既存値の使用は別マイグレーションで）
alter type match_kind add value if not exists 'catalog';
alter type notification_type add value if not exists 'proposal_digest';

-- ----------------------------------------------------------------------------
-- programs: 制度マスタ（カタログ）
-- ----------------------------------------------------------------------------
create table if not exists programs (
  id text primary key,                          -- 安定識別子 例: prog:shoryokuka-ippan

  name text not null,
  level text not null default 'national',       -- national / prefecture / municipal
  prefecture text,                              -- 自治体制度の都道府県（国は null）
  area_search text,                             -- 対象地域（全国 / 東京都 等）

  purpose text,                                 -- 何に使えるか
  target_industries jsonb not null default '[]'::jsonb,
  target_size text,                             -- 中小企業者 / 小規模事業者 / 従業員20人以下 等
  subsidy_rate text,                            -- 1/2, 2/3 等
  subsidy_max bigint,                           -- 補助上限額(円)

  key_requirements jsonb not null default '[]'::jsonb,   -- 賃上げ/GビズID/認定支援機関 等
  application_frames jsonb not null default '[]'::jsonb,  -- 通常枠/省力化枠 等
  typical_schedule text,                        -- 例年の公募/締切傾向
  budget_basis text,                            -- 予算動向（概算要求/補正/当初/実施有無）

  official_url text,
  schedule_key text,                            -- jGrants/予測との名寄せキー
  status text not null default 'active',         -- active / watch / ended

  next_open_from timestamptz,                   -- 次回公募の見込み（確定 or 予測）
  next_open_to timestamptz,
  confidence real not null default 0,           -- 情報の確度 0..1

  is_large_amount boolean not null default false,
  is_startup boolean not null default false,
  unified_with text,                            -- 統合/後継の注記
  sources jsonb not null default '[]'::jsonb,   -- 出典URL

  notes text,
  source text not null default 'manual',        -- manual / research / curated
  researched_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists programs_status_idx on programs (status);
create index if not exists programs_level_idx on programs (level);
create index if not exists programs_prefecture_idx on programs (prefecture);
create index if not exists programs_schedule_key_idx on programs (schedule_key);
create trigger programs_set_updated_at before update on programs
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- matches: program 提案(kind=catalog) を追跡できるよう拡張
-- ----------------------------------------------------------------------------
alter table matches
  add column if not exists program_id text references programs (id) on delete cascade;
create unique index if not exists matches_business_program_uq
  on matches (business_id, program_id);

-- ----------------------------------------------------------------------------
-- proposals: 事業者ごとの提案書（最新1件を更新）
-- ----------------------------------------------------------------------------
create table if not exists proposals (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,

  summary text,                                 -- 提案書の総括
  items jsonb not null default '[]'::jsonb,     -- 提案カード配列(program_id+理由+要件チェック+準備物+出典+confidence 等)
  model text,                                   -- 生成に使ったモデル
  research_sources jsonb not null default '[]'::jsonb,

  status text not null default 'ready',          -- ready / error
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists proposals_business_uq on proposals (business_id);
create trigger proposals_set_updated_at before update on proposals
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- businesses: 提案の生成状態
-- ----------------------------------------------------------------------------
alter table businesses
  add column if not exists proposal_status text not null default 'pending',  -- pending/ready/error
  add column if not exists proposal_refreshed_at timestamptz;

-- ----------------------------------------------------------------------------
-- budget_signals: program に紐付け（カタログ調査が投入）
-- ----------------------------------------------------------------------------
alter table budget_signals
  add column if not exists program_id text references programs (id) on delete set null;
create index if not exists budget_signals_program_id_idx on budget_signals (program_id);

-- ============================================================================
-- Row Level Security
-- ============================================================================
alter table programs enable row level security;
alter table proposals enable row level security;

-- programs: 認証済みユーザーは閲覧のみ（書き込みはサービスロール）
create policy programs_select_auth on programs
  for select to authenticated using (true);

-- proposals: 自分の事業のものだけ閲覧（書き込みはサービスロール）
create policy proposals_select_own on proposals
  for select using (
    exists (
      select 1 from businesses b
      where b.id = proposals.business_id and b.user_id = auth.uid()
    )
  );
