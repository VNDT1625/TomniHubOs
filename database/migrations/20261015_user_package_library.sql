-- Private reinstall list. App payloads, user data, permissions and local-built
-- Repo-to-Package artifacts are NOT stored here.
CREATE TABLE IF NOT EXISTS public.user_package_library (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  package_id text NOT NULL CHECK (length(package_id) BETWEEN 1 AND 160 AND package_id ~ '^[a-zA-Z0-9][a-zA-Z0-9._-]*$'),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, package_id)
);
ALTER TABLE public.user_package_library ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_package_library FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_package_library TO authenticated;
DROP POLICY IF EXISTS "package_library_owner_select" ON public.user_package_library;
CREATE POLICY "package_library_owner_select" ON public.user_package_library
    FOR SELECT TO authenticated USING ((select auth.uid()) = user_id);
DROP POLICY IF EXISTS "package_library_owner_insert" ON public.user_package_library;
CREATE POLICY "package_library_owner_insert" ON public.user_package_library
    FOR INSERT TO authenticated WITH CHECK ((select auth.uid()) = user_id);
DROP POLICY IF EXISTS "package_library_owner_update" ON public.user_package_library;
CREATE POLICY "package_library_owner_update" ON public.user_package_library
    FOR UPDATE TO authenticated USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);
DROP POLICY IF EXISTS "package_library_owner_delete" ON public.user_package_library;
CREATE POLICY "package_library_owner_delete" ON public.user_package_library
    FOR DELETE TO authenticated USING ((select auth.uid()) = user_id);
