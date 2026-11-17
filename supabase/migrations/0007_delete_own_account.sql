-- Lets a signed-in user delete their own account (required by Apple for apps with sign-up).
-- Every personal table references auth.users with ON DELETE CASCADE, so all of the user's data goes with it.
-- SECURITY DEFINER is needed to delete from auth.users; the function only ever touches the caller's own row.
create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  delete from auth.users where id = uid;
end;
$$;

revoke all on function public.delete_own_account() from public, anon;
grant execute on function public.delete_own_account() to authenticated;
