-- Internal worker access for the independent “Публикации” URL importer.
-- Browser users retain read-only, owner-scoped RLS access; only server-side
-- Edge Functions and the worker use service_role.
grant usage on schema public to service_role;
grant select, insert, update on table public.publication_import_jobs to service_role;
grant select, insert, update on table public.publication_url_drafts to service_role;
notify pgrst, 'reload schema';
