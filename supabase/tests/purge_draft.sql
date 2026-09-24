-- Integration test for purging one «Обяви» draft, run against a real Postgres
-- with the project's migrations applied. It covers what the browser cannot show:
-- that the cascade really removes every child row, that another draft is left
-- alone, that a dangling dedup reference is cleared, that an in-flight job stops
-- the deletion, and that the file queue is written.
--
-- Everything runs inside one transaction that is rolled back, so it can be run
-- on a database that already holds data without changing it.
--
-- Run with: psql -d <db> -f supabase/tests/purge_draft.sql

begin;

do $$
declare
  v_draft uuid;
  v_other uuid;
  v_before integer;
  v_after integer;
  v_other_after integer;
  v_result jsonb;
  v_preview jsonb;
  v_purge_count integer;
  v_matched uuid;
begin
  -- ---- Two drafts, one of them with data of every kind ----
  insert into public.mobile_bg_drafts (title, status, source_type)
  values ('TEST PURGE TARGET', 'ERROR', 'catalog')
  returning id into v_draft;

  insert into public.mobile_bg_drafts (title, status, source_type)
  values ('TEST PURGE BYSTANDER', 'DRAFT', 'catalog')
  returning id into v_other;

  insert into public.mobile_bg_draft_fields (draft_id, field_key, mobile_bg_label, our_db_key, value)
  values (v_draft, 'make', 'Марка', 'make', 'Audi'), (v_draft, 'model', 'Модел', 'model', 'S4');

  insert into public.mobile_bg_draft_extras (draft_id, extra_key, mobile_bg_label, group_name, selected)
  values (v_draft, 'xenon', 'Ксенон', 'safety', true);

  insert into public.mobile_bg_draft_images (draft_id, source_url, is_selected, display_order)
  values (v_draft, 'https://example.test/a.jpg', true, 1),
         (v_draft, 'https://example.test/b.jpg', false, 2);

  insert into public.mobile_bg_draft_action_log (draft_id, action, actor)
  values (v_draft, 'DRAFT_CREATED', 'test');

  insert into public.mobile_bg_dedup_checks (draft_id, check_type, matched_draft_id, is_duplicate)
  values (v_draft, 'owner_phone', null, false),
         -- Held by the *other* draft, pointing at the one being deleted.
         (v_other, 'owner_phone', v_draft, true);

  -- One job per draft: `mobile_bg_publish_jobs` has UNIQUE(draft_id).
  insert into public.mobile_bg_publish_jobs (draft_id, status, transport)
  values (v_draft, 'FAILED', 'OFFICIAL_API');

  -- The bystander must survive with its own data untouched.
  insert into public.mobile_bg_draft_fields (draft_id, field_key, mobile_bg_label, our_db_key, value)
  values (v_other, 'make', 'Марка', 'make', 'BMW');

  -- ---- Count only the rows that belong to the target ----
  select count(*) into v_before from (
    select id from public.mobile_bg_draft_fields where draft_id = v_draft
    union all select id from public.mobile_bg_draft_extras where draft_id = v_draft
    union all select id from public.mobile_bg_draft_images where draft_id = v_draft
    union all select id from public.mobile_bg_draft_action_log where draft_id = v_draft
    union all select id from public.mobile_bg_dedup_checks where draft_id = v_draft
    union all select id from public.mobile_bg_publish_jobs where draft_id = v_draft
  ) rows_before;
  if v_before <> 8 then
    raise exception 'Очаквани 8 свързани реда преди изтриване, намерени %', v_before;
  end if;

  -- ---- Preview reports the real shape and is not blocked ----
  v_preview := public.mobile_bg_draft_purge_preview(v_draft);
  if (v_preview->>'blocked')::boolean then
    raise exception 'Прегледът не трябва да е блокиран за чернова без RUNNING задача.';
  end if;
  if (v_preview->>'images')::int <> 2 then
    raise exception 'Прегледът трябва да види 2 снимки, видя %', v_preview->>'images';
  end if;
  if (v_preview->>'publish_jobs')::int <> 1 then
    raise exception 'Прегледът трябва да види 1 задача, видя %', v_preview->>'publish_jobs';
  end if;
  if (v_preview->>'dedup_links_elsewhere')::int <> 1 then
    raise exception 'Прегледът трябва да види 1 външна връзка, видя %', v_preview->>'dedup_links_elsewhere';
  end if;
  if (v_preview->>'bytes_estimate')::bigint <= 0 then
    raise exception 'Прегледът трябва да оцени размер > 0.';
  end if;

  -- ---- Delete ----
  v_result := public.purge_mobile_bg_draft(v_draft, 'test@example.test');

  if (v_result->>'dedup_links_cleared')::int <> 1 then
    raise exception 'Трябва да е изчистена 1 външна връзка, изчистени %', v_result->>'dedup_links_cleared';
  end if;

  -- ---- The draft and every child row are gone ----
  if exists (select 1 from public.mobile_bg_drafts where id = v_draft) then
    raise exception 'Черновата не е изтрита.';
  end if;

  select count(*) into v_after from (
    select id from public.mobile_bg_draft_fields where draft_id = v_draft
    union all select id from public.mobile_bg_draft_extras where draft_id = v_draft
    union all select id from public.mobile_bg_draft_images where draft_id = v_draft
    union all select id from public.mobile_bg_draft_action_log where draft_id = v_draft
    union all select id from public.mobile_bg_dedup_checks where draft_id = v_draft
    union all select id from public.mobile_bg_publish_jobs where draft_id = v_draft
  ) rows_after;
  if v_after <> 0 then
    raise exception 'Останали са % свързани реда след изтриване.', v_after;
  end if;

  -- ---- The other draft is intact, and its dangling reference is cleared ----
  if not exists (select 1 from public.mobile_bg_drafts where id = v_other) then
    raise exception 'Другата чернова е изтрита.';
  end if;
  select count(*) into v_other_after from public.mobile_bg_draft_fields where draft_id = v_other;
  if v_other_after <> 1 then
    raise exception 'Данните на другата чернова са засегнати: % реда.', v_other_after;
  end if;
  select matched_draft_id into v_matched from public.mobile_bg_dedup_checks
    where draft_id = v_other and check_type = 'owner_phone';
  if v_matched is not null then
    raise exception 'Висящата връзка не е изчистена.';
  end if;

  -- ---- The file cleanup was queued with what the worker needs ----
  select count(*) into v_purge_count from public.mobile_bg_purge_jobs where draft_id = v_draft;
  if v_purge_count <> 1 then
    raise exception 'Очаквана 1 задача за почистване, намерени %', v_purge_count;
  end if;
  if not exists (
    select 1 from public.mobile_bg_purge_jobs
    where draft_id = v_draft
      and status = 'QUEUED'
      -- A uuid contains only hex and dashes, both of which safeSegment keeps.
      and snapshot->>'photo_prefix' = 'mobilebg-pictures/' || v_draft::text
      and jsonb_array_length(snapshot->'job_ids') = 1
  ) then
    raise exception 'Задачата за почистване не съдържа очакваните данни: %',
      (select snapshot from public.mobile_bg_purge_jobs where draft_id = v_draft);
  end if;

  raise notice 'PASS: пълно изтриване, каскада, изчистена връзка и опашка за файлове.';
end $$;

-- ---- The deletion leaves a durable audit record behind ----
-- The draft's own action log is cascade-deleted, so this is the only trace that
-- survives. It must name the actor, the draft and what was removed.
do $$
declare
  v_draft uuid;
  v_entry public.audit_log;
begin
  insert into public.mobile_bg_drafts (title, status) values ('TEST AUDIT', 'DRAFT')
  returning id into v_draft;

  perform public.purge_mobile_bg_draft(v_draft, 'auditor@example.test');

  SELECT * INTO v_entry FROM public.audit_log
    WHERE action = 'PURGE' AND entity = 'mobile_bg_drafts' AND entity_id = v_draft::text;
  IF NOT FOUND THEN
    raise exception 'Липсва одиторски запис за изтриването.';
  END IF;
  IF v_entry.actor <> 'auditor@example.test' THEN
    raise exception 'Одиторският запис не пази кой е изтрил: %', v_entry.actor;
  END IF;
  IF v_entry.before->>'title' <> 'TEST AUDIT' THEN
    raise exception 'Одиторският запис не пази заглавието: %', v_entry.before;
  END IF;
  if exists (select 1 from public.mobile_bg_drafts where id = v_draft) then
    raise exception 'Черновата не е изтрита.';
  end if;

  raise notice 'PASS: одиторски запис остава след изтриването.';
end $$;

-- ---- Who is allowed to do this ----
-- The publisher worker runs with the public key as `anon`. If it could reach the
-- delete function, a compromised worker could wipe drafts, so the grant matters
-- as much as the code.
do $$
begin
  if has_function_privilege('anon', 'public.purge_mobile_bg_draft(uuid,text)', 'EXECUTE') then
    raise exception 'anon (работният ключ) не трябва да може да изтрива чернови.';
  end if;
  if not has_function_privilege('authenticated', 'public.purge_mobile_bg_draft(uuid,text)', 'EXECUTE') then
    raise exception 'authenticated трябва да може да изтрива чернови.';
  end if;
  if has_function_privilege('anon', 'public.mobile_bg_draft_purge_preview(uuid)', 'EXECUTE') then
    raise exception 'anon не трябва да вижда прегледа за изтриване.';
  end if;
  if not has_function_privilege('authenticated', 'public.mobile_bg_draft_purge_preview(uuid)', 'EXECUTE') then
    raise exception 'authenticated трябва да може да вижда прегледа.';
  end if;
  raise notice 'PASS: само вписаният администратор може да изтрива.';
end $$;

-- ---- A RUNNING job must stop the deletion ----
do $$
declare
  v_draft uuid;
  v_error text;
  v_stopped boolean := false;
begin
  insert into public.mobile_bg_drafts (title, status) values ('TEST RUNNING', 'PUBLISHING')
  returning id into v_draft;
  insert into public.mobile_bg_publish_jobs (draft_id, status, transport)
  values (v_draft, 'RUNNING', 'OFFICIAL_API');

  begin
    perform public.purge_mobile_bg_draft(v_draft, 'test@example.test');
  exception when others then
    v_stopped := true;
    v_error := sqlerrm;
  end;

  if not v_stopped then
    raise exception 'Изтриване на чернова с RUNNING задача трябва да бъде отказано.';
  end if;
  if v_error not like '%публикува%' then
    raise exception 'Съобщението за отказ не обяснява причината: %', v_error;
  end if;
  if not exists (select 1 from public.mobile_bg_drafts where id = v_draft) then
    raise exception 'Черновата е изтрита въпреки RUNNING задачата.';
  end if;

  -- Its preview must report the block, so the dialog can explain it.
  if not (public.mobile_bg_draft_purge_preview(v_draft)->>'blocked')::boolean then
    raise exception 'Прегледът трябва да отбележи блокадата.';
  end if;

  raise notice 'PASS: чернова с активна публикация не се изтрива.';
end $$;

-- ---- A missing draft is an error, not a silent success ----
do $$
declare
  v_stopped boolean := false;
begin
  begin
    perform public.purge_mobile_bg_draft(gen_random_uuid(), 'test@example.test');
  exception when others then
    v_stopped := true;
  end;
  if not v_stopped then
    raise exception 'Изтриване на несъществуваща чернова трябва да върне грешка.';
  end if;
  raise notice 'PASS: несъществуваща чернова води до грешка.';
end $$;

rollback;
