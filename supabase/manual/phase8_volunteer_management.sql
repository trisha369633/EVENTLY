-- Volunteer role administration for the existing Phase 2 profiles, roles, and
-- identities, plus Phase 5/6 event and distribution assignments.
-- This file adds RPCs only; it does not create or alter application tables.

begin;

do $phase8_preflight$
begin
  if to_regclass('public.profiles') is null
    or to_regclass('public.user_roles') is null
    or to_regclass('public.user_identities') is null
    or to_regclass('public.institutions') is null
    or to_regclass('public.departments') is null then
    raise exception 'Volunteer management requires the existing profiles, user_roles, user_identities, institutions, and departments tables.';
  end if;

  if to_regclass('public.event_volunteer_assignments') is null
    or to_regclass('public.event_distribution_item_volunteers') is null then
    raise exception 'Apply and verify the existing Phase 5 and Phase 6 migrations before volunteer role management.';
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.event_volunteer_assignments'::regclass
      and tgname = 'evently_revoke_distribution_item_assignments'
      and not tgisinternal
  ) then
    raise exception 'The Phase 6 assignment-revocation trigger is missing; role revocation cannot safely withdraw item permissions.';
  end if;

  if exists (
    select required.table_name, required.column_name
    from (values
      ('profiles', 'id'),
      ('profiles', 'full_name'),
      ('profiles', 'email'),
      ('user_roles', 'user_id'),
      ('user_roles', 'role'),
      ('user_identities', 'user_id'),
      ('user_identities', 'institution_id'),
      ('user_identities', 'department_id'),
      ('institutions', 'id'),
      ('institutions', 'name'),
      ('departments', 'id'),
      ('departments', 'name')
    ) as required(table_name, column_name)
    where not exists (
      select 1
      from information_schema.columns as c
      where c.table_schema = 'public'
        and c.table_name = required.table_name
        and c.column_name = required.column_name
    )
  ) then
    raise exception 'The Phase 2 profile, role, or identity columns do not match the application contract; inspect the deployed schema before installing volunteer-management RPCs.';
  end if;
end;
$phase8_preflight$;

create or replace function public.admin_search_users(
  p_search text default '',
  p_role_filter text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  user_id uuid,
  full_name text,
  email text,
  institution_name text,
  department_name text,
  roles text[],
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_search text := pg_catalog.lower(pg_catalog.left(pg_catalog.trim(coalesce(p_search, '')), 100));
begin
  if auth.uid() is null or not exists (
    select 1
    from public.user_roles as caller_role
    where caller_role.user_id = auth.uid()
      and caller_role.role::text = 'super_admin'
  ) then
    raise exception 'Only a Super Admin can search registered users.' using errcode = '42501';
  end if;

  if p_role_filter is not null
    and p_role_filter not in ('super_admin', 'participant', 'volunteer') then
    raise exception 'Unsupported platform-role filter.' using errcode = '22023';
  end if;

  return query
    with profile_roles as (
      select ur.user_id,
        pg_catalog.array_agg(distinct ur.role::text order by ur.role::text) as role_names
      from public.user_roles as ur
      group by ur.user_id
    ),
    matching_profiles as (
      select p.id,
        p.full_name::text as name,
        p.email::text as address,
        institution.name::text as university,
        department.name::text as department,
        coalesce(profile_roles.role_names, array[]::text[]) as role_names
      from public.profiles as p
      left join public.user_identities as identity
        on identity.user_id = p.id
      left join public.institutions as institution
        on institution.id = identity.institution_id
      left join public.departments as department
        on department.id = identity.department_id
      left join profile_roles
        on profile_roles.user_id = p.id
      where (
        v_search = ''
        or pg_catalog.strpos(pg_catalog.lower(pg_catalog.concat_ws(' ', p.full_name, p.email)), v_search) > 0
      )
        and (
          p_role_filter is null
          or p_role_filter = any(coalesce(profile_roles.role_names, array[]::text[]))
        )
    )
    select matching_profiles.id,
      matching_profiles.name,
      matching_profiles.address,
      matching_profiles.university,
      matching_profiles.department,
      matching_profiles.role_names,
      pg_catalog.count(*) over ()::bigint
    from matching_profiles
    order by matching_profiles.name nulls last, matching_profiles.address nulls last, matching_profiles.id
    limit greatest(1, least(coalesce(p_limit, 50), 100))
    offset greatest(coalesce(p_offset, 0), 0);
end;
$function$;

revoke all on function public.admin_search_users(text, text, integer, integer)
  from public, anon;
grant execute on function public.admin_search_users(text, text, integer, integer)
  to authenticated;

create or replace function public.admin_set_volunteer_role(
  p_user_id uuid,
  p_is_active boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null or not exists (
    select 1
    from public.user_roles as caller_role
    where caller_role.user_id = auth.uid()
      and caller_role.role::text = 'super_admin'
  ) then
    raise exception 'Only a Super Admin can grant or revoke the volunteer role.' using errcode = '42501';
  end if;

  if p_user_id is null or p_is_active is null then
    raise exception 'A user and role action are required.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.profiles as target_profile where target_profile.id = p_user_id
  ) then
    raise exception 'Registered user not found.' using errcode = 'P0002';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_user_id::text || ':volunteer'));

  if p_is_active then
    if not exists (
      select 1
      from public.user_roles as existing_role
      where existing_role.user_id = p_user_id
        and existing_role.role::text = 'volunteer'
    ) then
      update public.event_volunteer_assignments
        set is_active = false
        where volunteer_user_id = p_user_id
          and is_active;

      insert into public.user_roles (user_id, role)
      values (p_user_id, 'volunteer');
    end if;
    return;
  end if;

  update public.event_volunteer_assignments
    set is_active = false
    where volunteer_user_id = p_user_id
      and is_active;

  delete from public.user_roles as target_role
    where target_role.user_id = p_user_id
      and target_role.role::text = 'volunteer';
end;
$function$;

revoke all on function public.admin_set_volunteer_role(uuid, boolean)
  from public, anon;
grant execute on function public.admin_set_volunteer_role(uuid, boolean)
  to authenticated;

commit;
