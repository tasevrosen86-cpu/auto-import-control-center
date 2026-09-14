grant select, insert, update on table public.mobile_bg_publish_jobs to anon, authenticated;
grant select on table public.mobile_bg_draft_fields to anon, authenticated;
grant select on table public.mobile_bg_draft_extras to anon, authenticated;
grant update on table public.mobile_bg_drafts to anon, authenticated;
grant insert on table public.mobile_bg_draft_action_log to anon, authenticated;
grant execute on function public.claim_mobile_bg_publish_job(text) to anon, authenticated;
