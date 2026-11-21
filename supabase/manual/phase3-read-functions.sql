-- Run this file manually in Supabase SQL Editor.
-- These functions return only aggregate counts or display fields for the caller's own registrations.

create or replace function public.get_public_event_registration_counts(p_event_ids bigint[])
returns table (event_id bigint, registration_count bigint)
language sql
stable
security definer
set search_path = ''
as $function$
  select
    e.id as event_id,
    count(r.id)::bigint as registration_count
  from public.events as e
  left join public.event_registrations as r
    on r.event_id = e.id
   and r.registration_status = 'registered'
  where e.status = 'published'
    and e.id = any(coalesce(p_event_ids, array[]::bigint[]))
  group by e.id;
$function$;

revoke all on function public.get_public_event_registration_counts(bigint[]) from public, anon;
grant execute on function public.get_public_event_registration_counts(bigint[]) to anon, authenticated;

create or replace function public.get_my_registered_event_details()
returns table (
  registration_id bigint,
  event_id bigint,
  title text,
  short_description text,
  description text,
  slug text,
  cover_image_url text,
  institution_id uuid,
  department_id uuid,
  event_start timestamp with time zone,
  event_end timestamp with time zone,
  registration_deadline timestamp with time zone,
  venue text,
  event_mode text,
  student_fee numeric,
  teacher_fee numeric,
  alumni_fee numeric,
  seat_limit integer,
  event_status text
)
language sql
stable
security definer
set search_path = ''
as $function$
  select
    r.id as registration_id,
    e.id as event_id,
    e.title,
    e.short_description,
    e.description,
    e.slug,
    e.cover_image_url,
    e.institution_id,
    e.department_id,
    e.event_start,
    e.event_end,
    e.registration_deadline,
    e.venue,
    e.event_mode,
    e.student_fee,
    e.teacher_fee,
    e.alumni_fee,
    e.seat_limit,
    e.status as event_status
  from public.event_registrations as r
  join public.events as e on e.id = r.event_id
  where r.user_id = auth.uid();
$function$;

revoke all on function public.get_my_registered_event_details() from public, anon;
grant execute on function public.get_my_registered_event_details() to authenticated;
