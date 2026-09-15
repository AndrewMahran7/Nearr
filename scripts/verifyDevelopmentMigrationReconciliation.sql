-- Read-only structural proof for Development migrations 20260910000001-000007.
-- Returns no user rows, token balances, purchase events, or secrets.
with checks(check_name, passed, detail) as (
  values
    (
      'registry_exact_canonical_statements',
      (
        select count(*) = 7 and bool_and(actual_md5 = expected_md5 and actual_count = expected_count)
        from (
          select
            m.version,
            md5(replace(array_to_string(m.statements, E'\n--statement-boundary--\n'), E'\r\n', E'\n')) actual_md5,
            cardinality(m.statements) actual_count,
            e.expected_md5,
            e.expected_count
          from supabase_migrations.schema_migrations m
          join (values
            ('20260910000001','b4e870db18311dc15af66a972318d0f8',56),
            ('20260910000002','17b0f1aeb724957109421a48766ecab8',61),
            ('20260910000003','c92f1e3d8e31381df9afd229044d28fb',1),
            ('20260910000004','d6fec1ed75942172248b1a55475cbb8b',3),
            ('20260910000005','580d9a08a59dde0ff6f56e47997d1d0e',7),
            ('20260910000006','a25daa32d6fb1d754e76161d6b71ffc3',30),
            ('20260910000007','b3c64d3bb10c2a321837d3a49000d9c5',3)
          ) e(version,expected_md5,expected_count) using(version)
        ) fingerprints
      ),
      'all seven registry statement arrays match normalized canonical fingerprints'
    ),
    (
      '000001_tables_and_rls',
      (
        select count(*) = 3 and bool_and(c.relrowsecurity)
        from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='public' and c.relname in (
          'token_monetization_config','token_qualifying_save_events','revenuecat_webhook_events'
        ) and c.relkind='r'
      ),
      'three V1 monetization tables exist with RLS enabled'
    ),
    (
      '000001_columns_indexes_policy',
      (select
        (select count(*)=4 from information_schema.columns where table_schema='public' and (
          (table_name='place_find_reservations' and column_name='source_identity') or
          (table_name='place_find_purchase_transactions' and column_name in ('revenuecat_event_id','store','refunded_at'))
        ))
        and (select count(*)=3 from pg_indexes where schemaname='public' and indexname in (
          'place_find_reservation_source_idx','token_qualifying_save_user_month_idx','revenuecat_webhook_transaction_idx'
        ))
        and exists(select 1 from pg_policies where schemaname='public' and policyname='token_activity_owner_read')
      ),
      'V1 reservation/purchase columns, three indexes, and owner-read policy exist'
    ),
    (
      '000001_functions_and_trigger',
      (select count(distinct p.proname)=14 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and p.proname in (
         'grant_place_find_lot','expire_place_find_lots','ensure_place_find_wallet','reserve_place_find_use',
         'settle_metered_share_job_transition','release_stale_place_find_reservations','settle_place_find_use',
         'resume_place_find_job','record_manual_save_activity','capture_manual_save_activity',
         'credit_back_place_find_use','process_revenuecat_token_event','grant_due_monthly_allowances',
         'grant_initial_token_allocations'
       )) and exists(select 1 from pg_trigger where tgname='saved_places_capture_manual_token_activity' and not tgisinternal),
      'V1 wallet/ledger/RevenueCat functions and manual-save trigger remain present'
    ),
    (
      '000002_tables_rls_and_policies',
      (select count(*)=5 and bool_and(c.relrowsecurity)
       from pg_class c join pg_namespace n on n.oid=c.relnamespace
       where n.nspname='public' and c.relname in (
         'nearr_pro_products','nearr_pro_access','token_reward_definitions','token_reward_claims','monetization_offer_exposures'
       ) and c.relkind='r')
      and (select count(*)=4 from pg_policies where schemaname='public' and policyname in (
        'nearr_pro_product_read','nearr_pro_owner_read','token_reward_definition_read','token_reward_claim_owner_read'
      )),
      'five V2 tables have RLS and all four owner/catalog policies exist'
    ),
    (
      '000002_contracts_and_trigger',
      exists(select 1 from pg_constraint where conname='share_jobs_billing_mode_check'
        and pg_get_constraintdef(oid) like '%normal_free%'
        and pg_get_constraintdef(oid) like '%source_replay_free%'
        and pg_get_constraintdef(oid) like '%onboarding_practice_free%')
      and exists(select 1 from pg_constraint where conname='share_jobs_submission_path_check')
      and exists(select 1 from pg_trigger where tgname='share_jobs_settle_monetized_access' and not tgisinternal)
      and exists(select 1 from pg_indexes where schemaname='public' and indexname='nearr_pro_access_active_idx'),
      'V2 billing/submission checks survive with later onboarding-safe superset; settlement trigger/index exist'
    ),
    (
      '000002_functions',
      (select count(distinct p.proname)=12 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and p.proname in (
         'has_active_nearr_pro','ensure_monthly_allowance_v2','token_reward_progress_count','get_token_reward_status',
         'claim_token_reward','record_share_job_submission_path','settle_monetized_share_job_transition',
         'resume_pending_place_find_jobs','convert_pending_token_jobs_to_pro','process_revenuecat_subscription_event',
         'grant_place_find_lot','ensure_place_find_wallet'
       )),
      'V2 Pro/reward/submission/settlement functions exist'
    ),
    (
      '000003_revenuecat_binding_preserved_but_disabled',
      exists(select 1 from public.token_monetization_config
        where environment_name='development'
          and revenuecat_project_id='proj7d727ef6'
          and revenuecat_app_id='app26505bdf1c'
          and revenuecat_allowed_stores=array['TEST_STORE']::text[]),
      'public catalog binding remains intact; runtime suspension is verified separately at all three Edge secrets'
    ),
    (
      '000004_qualified_subscription_function',
      exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.proname='process_revenuecat_subscription_event'
          and pg_get_function_identity_arguments(p.oid)=
            'p_event_id text, p_event_type text, p_project_id text, p_app_id text, p_purchase_environment text, p_store text, p_user_id uuid, p_product_id text, p_transaction_id text, p_original_transaction_id text, p_event_at timestamp with time zone, p_purchased_at timestamp with time zone, p_expiration_at timestamp with time zone, p_entitlement_ids jsonb, p_reason text, p_payload_sha256 text'
          and pg_get_functiondef(p.oid) ~* 'select c\.\*.*token_monetization_config c'
          and pg_get_functiondef(p.oid) ~* 'select p\.\*.*nearr_pro_products p'
          and pg_get_functiondef(p.oid) ~* 'select a\.\*.*nearr_pro_access a'
          and has_function_privilege('service_role',p.oid,'EXECUTE')
          and not has_function_privilege('authenticated',p.oid,'EXECUTE')),
      'qualified 16-argument subscription RPC is service-role only'
    ),
    (
      '000005_unambiguous_token_rpc',
      exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.proname='create_share_job_for_user'
          and pg_get_function_identity_arguments(p.oid)=
            'p_user_id uuid, p_source_url text, p_canonical_url text, p_source_platform text, p_idempotency_key text, p_dedupe_window_seconds integer, p_is_anonymous boolean, p_force_rerun boolean, p_enforce_tokens boolean'
          and p.pronargdefaults=0
          and pg_get_functiondef(p.oid) ilike '%from public.token_monetization_config as config%'
          and pg_get_functiondef(p.oid) ilike '%from public.place_find_wallets as wallet%'
          and has_function_privilege('service_role',p.oid,'EXECUTE')
          and not has_function_privilege('authenticated',p.oid,'EXECUTE')),
      'nine-argument overload has zero defaults, qualified aliases, and service-role-only grant'
    ),
    (
      '000006_practice_tables_rls_indexes',
      (select count(*)=2 and bool_and(c.relrowsecurity)
       from pg_class c join pg_namespace n on n.oid=c.relnamespace
       where n.nspname='public' and c.relname in (
         'onboarding_practice_entitlements','onboarding_practice_entitlement_events'
       ) and c.relkind='r')
      and (select count(*)=2 from pg_indexes where schemaname='public' and indexname in (
        'onboarding_practice_entitlements_user_idx','onboarding_practice_entitlement_events_session_idx'
      )),
      'practice entitlement/event tables exist with RLS and indexes'
    ),
    (
      '000006_practice_contracts',
      exists(select 1 from information_schema.columns where table_schema='public'
        and table_name='onboarding_tutorial_fixtures' and column_name='tutorial_use'
        and is_nullable='NO' and column_default like '%demo%')
      and exists(select 1 from pg_constraint where conname='onboarding_tutorial_fixtures_tutorial_use_check')
      and (select count(distinct p.proname)=4 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.proname in (
          'select_onboarding_practice_fixture','authorize_onboarding_practice_share_job',
          'settle_onboarding_practice_entitlement','sync_onboarding_practice_entitlement_owner'
        ))
      and exists(select 1 from pg_trigger where tgname='settle_onboarding_practice_entitlement' and not tgisinternal)
      and exists(select 1 from pg_trigger where tgname='sync_onboarding_practice_entitlement_owner' and not tgisinternal),
      'practice fixture column/check, four RPC/helpers, and both triggers exist'
    ),
    (
      '000007_transfer_owner_function',
      exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.proname='sync_onboarding_practice_entitlement_owner'
          and pg_get_functiondef(p.oid) ilike '%update public.share_media_tasks%'
          and pg_get_functiondef(p.oid) ilike '%update public.share_job_place_results%'
          and pg_get_functiondef(p.oid) ilike '%update public.share_media_runs%'
          and obj_description(p.oid,'pg_proc') like 'Transfers only the server-audited bounded practice jobs/save%'),
      'owner-transfer helper contains the canonical audited job/media/save rewiring contract'
    ),
    (
      '14000002_registry',
      exists(select 1 from supabase_migrations.schema_migrations
        where version='20260914000002'
          and name='recognition_entity_role_latency_state'),
      'new recognition migration is registered under the exact version and name'
    ),
    (
      '14000002_source_geography_contract',
      exists(select 1 from information_schema.columns
        where table_schema='public' and table_name='share_media_tasks'
          and column_name='source_geography' and data_type='jsonb' and is_nullable='YES')
      and exists(select 1 from pg_constraint
        where conname='share_media_tasks_source_geography_check'
          and pg_get_constraintdef(oid) ilike '%jsonb_typeof(source_geography) = ''object''%'
          and pg_get_constraintdef(oid) ilike '%octet_length((source_geography)::text) <= 4000%')
      and col_description('public.share_media_tasks'::regclass,
        (select attnum from pg_attribute
         where attrelid='public.share_media_tasks'::regclass and attname='source_geography')) =
        'Bounded source-location evidence for recognition; never candidate geography or AI-note evidence.',
      'nullable bounded object column, check, and semantic comment are exact'
    ),
    (
      'service_role_table_grants',
      (select count(*)=10 from information_schema.role_table_grants
       where grantee='service_role' and table_schema='public' and privilege_type='SELECT'
         and table_name in (
           'token_monetization_config','token_qualifying_save_events','revenuecat_webhook_events',
           'nearr_pro_products','nearr_pro_access','token_reward_definitions','token_reward_claims',
           'monetization_offer_exposures','onboarding_practice_entitlements','onboarding_practice_entitlement_events'
         )),
      'service_role retains access to all ten historical tables'
    )
)
select check_name, passed, detail from checks order by check_name;
