-- Phase 5 QR tickets.
-- Apply phase4_payment_system.sql first. This migration adds new ticket and
-- event-volunteer assignment objects and never changes registration/payment data
-- or the existing registration validation trigger.

begin;

do $phase5_preflight$
begin
  if to_regclass('public.event_registrations') is null
    or to_regclass('public.events') is null
    or to_regclass('public.profiles') is null
    or to_regclass('public.user_roles') is null then
    raise exception 'Phase 5 requires the existing Evently profiles, user_roles, events, and event_registrations tables.';
  end if;

  if to_regclass('public.event_payment_submissions') is null then
    raise exception 'Apply supabase/manual/phase4_payment_system.sql before Phase 5 so paid-ticket eligibility can be verified.';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'event_payment_submissions'
      and column_name = 'registration_id'
  ) or not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'event_payment_submissions'
      and column_name = 'payment_status'
  ) then
    raise exception 'Phase 5 requires the Phase 4 registration_id and payment_status columns.';
  end if;
end;
$phase5_preflight$;

create table if not exists public.event_tickets (
  id uuid primary key default gen_random_uuid(),
  registration_id bigint not null unique
    references public.event_registrations(id) on delete restrict,
  event_id bigint not null
    references public.events(id) on delete restrict,
  participant_user_id uuid not null
    references public.profiles(id) on delete restrict,
  ticket_reference text not null unique,
  ticket_status text not null default 'active'
    check (ticket_status in ('active', 'revoked')),
  issued_at timestamptz not null default clock_timestamp(),
  checked_in_at timestamptz,
  checked_in_by uuid references public.profiles(id) on delete restrict,
  revoked_at timestamptz,
  revoked_by uuid references public.profiles(id) on delete restrict,
  constraint event_tickets_checkin_actor_pair
    check ((checked_in_at is null) = (checked_in_by is null)),
  constraint event_tickets_revocation_columns_pair
    check ((revoked_at is null) = (revoked_by is null)),
  constraint event_tickets_revocation_actor_pair
    check (
      (ticket_status = 'revoked')
      = (revoked_at is not null)
    )
);

create index if not exists idx_event_tickets_event_status
  on public.event_tickets (event_id, ticket_status, checked_in_at);
create index if not exists idx_event_tickets_participant
  on public.event_tickets (participant_user_id, issued_at desc);

-- This table contains the bearer credential. No client role receives table
-- privileges; only narrowly scoped RPCs can return an owner's token.
create table if not exists public.event_ticket_secrets (
  ticket_id uuid primary key
    references public.event_tickets(id) on delete cascade,
  token_secret text not null unique,
  created_at timestamptz not null default clock_timestamp()
);

create table if not exists public.event_volunteer_assignments (
  event_id bigint not null
    references public.events(id) on delete cascade,
  volunteer_user_id uuid not null
    references public.profiles(id) on delete cascade,
  assigned_by uuid not null
    references public.profiles(id) on delete restrict,
  assigned_at timestamptz not null default clock_timestamp(),
  is_active boolean not null default true,
  primary key (event_id, volunteer_user_id)
);

create index if not exists idx_event_volunteer_assignments_active
  on public.event_volunteer_assignments (volunteer_user_id, event_id)
  where is_active;

alter table public.event_tickets enable row level security;
alter table public.event_ticket_secrets enable row level security;
alter table public.event_volunteer_assignments enable row level security;

create or replace function public.evently_ticket_is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select auth.uid() is not null
    and exists (
      select 1
      from public.user_roles as ur
      where ur.user_id = auth.uid()
        and ur.role::text = 'super_admin'
    );
$function$;

revoke all on function public.evently_ticket_is_super_admin() from public, anon;
grant execute on function public.evently_ticket_is_super_admin() to authenticated;

drop policy if exists event_tickets_read_owner_or_admin
  on public.event_tickets;
create policy event_tickets_read_owner_or_admin
  on public.event_tickets
  for select
  to authenticated
  using (
    participant_user_id = auth.uid()
    or public.evently_ticket_is_super_admin()
  );

drop policy if exists event_ticket_assignments_read_assignee_or_admin
  on public.event_volunteer_assignments;
create policy event_ticket_assignments_read_assignee_or_admin
  on public.event_volunteer_assignments
  for select
  to authenticated
  using (
    volunteer_user_id = auth.uid()
    or public.evently_ticket_is_super_admin()
  );

revoke all on table public.event_tickets
  from public, anon, authenticated;
revoke all on table public.event_ticket_secrets
  from public, anon, authenticated;
revoke all on table public.event_volunteer_assignments
  from public, anon, authenticated;

create or replace function public.evently_issue_event_ticket(p_registration_id bigint)
returns table (
  ticket_id uuid,
  ticket_reference text,
  ticket_token text,
  ticket_status text,
  issued_at timestamptz,
  checked_in_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_registration public.event_registrations%rowtype;
  v_event_status text;
  v_payment_status text;
  v_ticket_id uuid;
  v_ticket_reference text;
  v_ticket_token text;
  v_ticket_status text;
  v_issued_at timestamptz;
  v_checked_in_at timestamptz;
begin
  select r.*
    into v_registration
    from public.event_registrations as r
    where r.id = p_registration_id
    for update;

  if not found
    or v_registration.registration_status::text <> 'registered'
    or v_registration.fee_amount is null
    or v_registration.fee_amount < 0 then
    return;
  end if;

  select e.status::text
    into v_event_status
    from public.events as e
    where e.id = v_registration.event_id
    for share;

  if not found or v_event_status in ('cancelled', 'completed') then
    return;
  end if;

  if v_registration.fee_amount > 0 then
    select p.payment_status
      into v_payment_status
      from public.event_payment_submissions as p
      where p.registration_id = v_registration.id
      order by p.submitted_at desc, p.id desc
      limit 1;

    if v_payment_status is distinct from 'approved' then
      return;
    end if;
  end if;

  select t.id, t.ticket_reference, t.ticket_status, t.issued_at, t.checked_in_at
    into v_ticket_id, v_ticket_reference, v_ticket_status, v_issued_at, v_checked_in_at
    from public.event_tickets as t
    where t.registration_id = v_registration.id
    for update;

  if found then
    if v_ticket_status = 'active' then
      select s.token_secret
        into v_ticket_token
        from public.event_ticket_secrets as s
        where s.ticket_id = v_ticket_id;
      if not found then
        raise exception 'Ticket credential is unavailable for ticket %.', v_ticket_reference;
      end if;
    end if;

    return query
      select v_ticket_id, v_ticket_reference, v_ticket_token, v_ticket_status,
        v_issued_at, v_checked_in_at;
    return;
  end if;

  v_ticket_token := lower(
    replace(pg_catalog.gen_random_uuid()::text, '-', '')
    || replace(pg_catalog.gen_random_uuid()::text, '-', '')
  );
  v_ticket_reference := 'EVT-' || upper(replace(pg_catalog.gen_random_uuid()::text, '-', ''));

  insert into public.event_tickets (
    registration_id,
    event_id,
    participant_user_id,
    ticket_reference
  )
  values (
    v_registration.id,
    v_registration.event_id,
    v_registration.user_id,
    v_ticket_reference
  )
  returning id, ticket_status, issued_at, checked_in_at
    into v_ticket_id, v_ticket_status, v_issued_at, v_checked_in_at;

  insert into public.event_ticket_secrets (ticket_id, token_secret)
  values (
    v_ticket_id,
    v_ticket_token
  );

  return query
    select v_ticket_id, v_ticket_reference, v_ticket_token, v_ticket_status,
      v_issued_at, v_checked_in_at;
end;
$function$;

revoke all on function public.evently_issue_event_ticket(bigint)
  from public, anon, authenticated;

create or replace function public.evently_issue_free_ticket_after_registration()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.registration_status::text = 'registered' and new.fee_amount = 0 then
    perform 1
      from public.evently_issue_event_ticket(new.id);
  end if;
  return new;
end;
$function$;

revoke all on function public.evently_issue_free_ticket_after_registration()
  from public, anon, authenticated;

drop trigger if exists evently_issue_free_ticket_after_registration
  on public.event_registrations;
create trigger evently_issue_free_ticket_after_registration
  after insert on public.event_registrations
  for each row
  execute function public.evently_issue_free_ticket_after_registration();

create or replace function public.evently_issue_ticket_after_payment_approval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.payment_status = 'approved'
    and old.payment_status is distinct from new.payment_status then
    perform 1
      from public.evently_issue_event_ticket(new.registration_id);
  end if;
  return new;
end;
$function$;

revoke all on function public.evently_issue_ticket_after_payment_approval()
  from public, anon, authenticated;

drop trigger if exists evently_issue_ticket_after_payment_approval
  on public.event_payment_submissions;
create trigger evently_issue_ticket_after_payment_approval
  after update of payment_status on public.event_payment_submissions
  for each row
  execute function public.evently_issue_ticket_after_payment_approval();

do $phase5_ticket_backfill$
declare
  v_registration_id bigint;
begin
  for v_registration_id in
    select r.id
    from public.event_registrations as r
    where r.registration_status::text = 'registered'
    order by r.id
  loop
    perform 1
      from public.evently_issue_event_ticket(v_registration_id);
  end loop;
end;
$phase5_ticket_backfill$;

create or replace function public.get_my_event_tickets()
returns table (
  registration_id bigint,
  event_id bigint,
  event_title text,
  event_start timestamptz,
  venue text,
  event_mode text,
  participant_name text,
  participant_type text,
  registration_status text,
  fee_amount numeric,
  payment_status text,
  ticket_reference text,
  ticket_token text,
  ticket_status text,
  issued_at timestamptz,
  checked_in_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null then
    raise exception 'Sign in to view your tickets.' using errcode = '28000';
  end if;

  return query
    select
      r.id,
      r.event_id,
      e.title,
      e.event_start,
      e.venue,
      e.event_mode::text,
      r.full_name,
      r.participant_type::text,
      r.registration_status::text,
      r.fee_amount,
      case
        when r.fee_amount <= 0 then 'not_required'
        else coalesce(payment.payment_status, 'not_submitted')
      end,
      t.ticket_reference,
      case
        when t.ticket_status = 'active'
          and r.registration_status::text = 'registered'
          and e.status::text not in ('cancelled', 'completed')
          and (
            r.fee_amount <= 0
            or payment.payment_status = 'approved'
          )
          then secret.token_secret
        else null
      end,
      case
        when t.id is null then null
        when t.ticket_status = 'revoked' then 'revoked'
        when r.registration_status::text <> 'registered'
          or e.status::text in ('cancelled', 'completed')
          or (r.fee_amount > 0 and payment.payment_status is distinct from 'approved')
          then 'not_eligible'
        when t.checked_in_at is not null then 'checked_in'
        else 'active'
      end,
      t.issued_at,
      t.checked_in_at
    from public.event_registrations as r
    join public.events as e on e.id = r.event_id
    left join lateral (
      select p.payment_status
      from public.event_payment_submissions as p
      where p.registration_id = r.id
      order by p.submitted_at desc, p.id desc
      limit 1
    ) as payment on true
    left join public.event_tickets as t on t.registration_id = r.id
    left join public.event_ticket_secrets as secret on secret.ticket_id = t.id
    where r.user_id = auth.uid()
    order by r.registered_at desc;
end;
$function$;

revoke all on function public.get_my_event_tickets() from public, anon;
grant execute on function public.get_my_event_tickets() to authenticated;

create or replace function public.get_ticket_scanner_events()
returns table (
  event_id bigint,
  event_title text,
  event_start timestamptz,
  venue text,
  event_status text
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null then
    raise exception 'Sign in to scan tickets.' using errcode = '28000';
  end if;

  if not public.evently_ticket_is_super_admin()
    and not exists (
      select 1
      from public.user_roles as ur
      where ur.user_id = auth.uid()
        and ur.role::text = 'volunteer'
    ) then
    raise exception 'Ticket scanning is limited to authorized event staff.' using errcode = '42501';
  end if;

  return query
    select e.id, e.title, e.event_start, e.venue, e.status::text
    from public.events as e
    where public.evently_ticket_is_super_admin()
      or exists (
        select 1
        from public.event_volunteer_assignments as a
        where a.event_id = e.id
          and a.volunteer_user_id = auth.uid()
          and a.is_active
      )
    order by e.event_start desc;
end;
$function$;

revoke all on function public.get_ticket_scanner_events() from public, anon;
grant execute on function public.get_ticket_scanner_events() to authenticated;

create or replace function public.check_in_event_ticket(
  p_event_id bigint,
  p_token text
)
returns table (
  result_code text,
  ticket_reference text,
  event_title text,
  participant_name text,
  participant_type text,
  event_start timestamptz,
  venue text,
  checked_in_at timestamptz,
  checked_in_by_name text,
  result_message text
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_scan record;
  v_checkin_time timestamptz;
  v_staff_name text;
begin
  if auth.uid() is null then
    raise exception 'Sign in to validate tickets.' using errcode = '28000';
  end if;
  if not public.evently_ticket_is_super_admin()
    and not exists (
      select 1
      from public.user_roles as ur
      join public.event_volunteer_assignments as a
        on a.volunteer_user_id = ur.user_id
      where ur.user_id = auth.uid()
        and ur.role::text = 'volunteer'
        and a.event_id = p_event_id
        and a.is_active
    ) then
    raise exception 'You are not assigned to validate tickets for this event.'
      using errcode = '42501';
  end if;

  if p_token is null or lower(trim(p_token)) !~ '^[0-9a-f]{64}$' then
    return query
      select 'INVALID'::text, null::text, null::text, null::text, null::text,
        null::timestamptz, null::text, null::timestamptz, null::text,
        'This ticket is invalid.'::text;
    return;
  end if;

  select
    t.id,
    t.ticket_reference,
    t.ticket_status,
    t.checked_in_at,
    r.full_name,
    r.participant_type::text as participant_type,
    r.registration_status::text as registration_status,
    r.fee_amount,
    e.title as event_title,
    e.status::text as event_status,
    e.event_start,
    e.venue,
    payment.payment_status,
    checked_in_by.full_name as checked_in_by_name
    into v_scan
    from public.event_ticket_secrets as secret
    join public.event_tickets as t on t.id = secret.ticket_id
    join public.event_registrations as r on r.id = t.registration_id
    join public.events as e on e.id = t.event_id
    left join lateral (
      select p.payment_status
      from public.event_payment_submissions as p
      where p.registration_id = r.id
      order by p.submitted_at desc, p.id desc
      limit 1
    ) as payment on true
    left join public.profiles as checked_in_by on checked_in_by.id = t.checked_in_by
    where secret.token_secret = lower(trim(p_token))
      and t.event_id = p_event_id
    for update of t;

  if not found then
    return query
      select 'INVALID'::text, null::text, null::text, null::text, null::text,
        null::timestamptz, null::text, null::timestamptz, null::text,
        'This ticket is invalid for the selected event.'::text;
    return;
  end if;

  if v_scan.ticket_status = 'revoked' then
    return query
      select 'INVALID'::text, null::text, null::text, null::text, null::text,
        null::timestamptz, null::text, null::timestamptz, null::text,
        'This ticket has been revoked.'::text;
    return;
  end if;

  if v_scan.checked_in_at is not null then
    return query
      select 'ALREADY_USED'::text, v_scan.ticket_reference, v_scan.event_title,
        v_scan.full_name, v_scan.participant_type, v_scan.event_start, v_scan.venue,
        v_scan.checked_in_at, v_scan.checked_in_by_name,
        'This ticket was already checked in.'::text;
    return;
  end if;

  if v_scan.registration_status <> 'registered'
    or v_scan.fee_amount is null
    or v_scan.fee_amount < 0
    or v_scan.event_status in ('cancelled', 'completed')
    or (v_scan.fee_amount > 0 and v_scan.payment_status is distinct from 'approved') then
    return query
      select 'NOT_ELIGIBLE'::text, v_scan.ticket_reference, v_scan.event_title,
        v_scan.full_name, v_scan.participant_type, v_scan.event_start, v_scan.venue,
        null::timestamptz, null::text,
        'This registration is not eligible for entry.'::text;
    return;
  end if;

  update public.event_tickets as t
    set checked_in_at = clock_timestamp(),
        checked_in_by = auth.uid()
    where t.id = v_scan.id
      and t.ticket_status = 'active'
      and t.checked_in_at is null
    returning t.checked_in_at into v_checkin_time;

  if not found then
    select t.checked_in_at
      into v_checkin_time
      from public.event_tickets as t
      where t.id = v_scan.id;
    return query
      select 'ALREADY_USED'::text, v_scan.ticket_reference, v_scan.event_title,
        v_scan.full_name, v_scan.participant_type, v_scan.event_start, v_scan.venue,
        v_checkin_time, v_scan.checked_in_by_name,
        'This ticket was already checked in.'::text;
    return;
  end if;

  select p.full_name
    into v_staff_name
    from public.profiles as p
    where p.id = auth.uid();

  return query
    select 'VALID'::text, v_scan.ticket_reference, v_scan.event_title,
      v_scan.full_name, v_scan.participant_type, v_scan.event_start, v_scan.venue,
      v_checkin_time, v_staff_name,
      'Ticket valid. Entry accepted.'::text;
end;
$function$;

revoke all on function public.check_in_event_ticket(bigint, text) from public, anon;
grant execute on function public.check_in_event_ticket(bigint, text) to authenticated;

create or replace function public.get_admin_ticket_summary(p_event_id bigint default null)
returns table (
  total_tickets bigint,
  checked_in_count bigint,
  not_checked_in_count bigint,
  revoked_count bigint
)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null or not public.evently_ticket_is_super_admin() then
    raise exception 'Only a super admin can view ticket summaries.' using errcode = '42501';
  end if;

  return query
    select
      count(*)::bigint,
      count(*) filter (where t.checked_in_at is not null)::bigint,
      count(*) filter (
        where t.ticket_status = 'active' and t.checked_in_at is null
      )::bigint,
      count(*) filter (where t.ticket_status = 'revoked')::bigint
    from public.event_tickets as t
    where p_event_id is null or t.event_id = p_event_id;
end;
$function$;

revoke all on function public.get_admin_ticket_summary(bigint) from public, anon;
grant execute on function public.get_admin_ticket_summary(bigint) to authenticated;

create or replace function public.get_admin_event_tickets(
  p_event_id bigint default null,
  p_status text default null,
  p_search text default null,
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  ticket_id uuid,
  ticket_reference text,
  event_id bigint,
  event_title text,
  participant_name text,
  participant_email text,
  participant_type text,
  ticket_status text,
  issued_at timestamptz,
  checked_in_at timestamptz,
  checked_in_by_name text,
  total_count bigint
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_status text := nullif(trim(coalesce(p_status, '')), '');
  v_search text := left(trim(coalesce(p_search, '')), 100);
begin
  if auth.uid() is null or not public.evently_ticket_is_super_admin() then
    raise exception 'Only a super admin can view issued tickets.' using errcode = '42501';
  end if;
  if v_status is not null and v_status not in ('active', 'checked_in', 'revoked') then
    raise exception 'Choose a supported ticket status.' using errcode = '22023';
  end if;

  return query
    with filtered as (
      select
        t.id as ticket_id,
        t.ticket_reference,
        t.event_id,
        e.title as event_title,
        r.full_name as participant_name,
        r.email as participant_email,
        r.participant_type::text as participant_type,
        case
          when t.ticket_status = 'revoked' then 'revoked'
          when t.checked_in_at is not null then 'checked_in'
          else 'active'
        end as ticket_status,
        t.issued_at,
        t.checked_in_at,
        checker.full_name as checked_in_by_name
      from public.event_tickets as t
      join public.events as e on e.id = t.event_id
      join public.event_registrations as r on r.id = t.registration_id
      left join public.profiles as checker on checker.id = t.checked_in_by
      where (p_event_id is null or t.event_id = p_event_id)
        and (
          v_status is null
          or case
            when t.ticket_status = 'revoked' then 'revoked'
            when t.checked_in_at is not null then 'checked_in'
            else 'active'
          end = v_status
        )
        and (
          v_search = ''
          or strpos(lower(e.title), lower(v_search)) > 0
          or strpos(lower(r.full_name), lower(v_search)) > 0
          or strpos(lower(coalesce(r.email, '')), lower(v_search)) > 0
          or strpos(lower(t.ticket_reference), lower(v_search)) > 0
        )
    )
    select
      f.ticket_id,
      f.ticket_reference,
      f.event_id,
      f.event_title,
      f.participant_name,
      f.participant_email,
      f.participant_type,
      f.ticket_status,
      f.issued_at,
      f.checked_in_at,
      f.checked_in_by_name,
      count(*) over ()::bigint
    from filtered as f
    order by f.issued_at desc
    limit greatest(1, least(coalesce(p_limit, 20), 100))
    offset greatest(0, coalesce(p_offset, 0));
end;
$function$;

revoke all on function public.get_admin_event_tickets(bigint, text, text, integer, integer)
  from public, anon;
grant execute on function public.get_admin_event_tickets(bigint, text, text, integer, integer)
  to authenticated;

create or replace function public.list_ticket_volunteer_candidates()
returns table (
  volunteer_user_id uuid,
  volunteer_name text,
  volunteer_email text
)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null or not public.evently_ticket_is_super_admin() then
    raise exception 'Only a super admin can manage event-scoped volunteer access.' using errcode = '42501';
  end if;

  return query
    select distinct p.id, p.full_name, p.email
    from public.user_roles as ur
    join public.profiles as p on p.id = ur.user_id
    where ur.role::text = 'volunteer'
    order by p.full_name, p.email;
end;
$function$;

revoke all on function public.list_ticket_volunteer_candidates() from public, anon;
grant execute on function public.list_ticket_volunteer_candidates() to authenticated;

create or replace function public.get_event_ticket_assignments(p_event_id bigint)
returns table (
  volunteer_user_id uuid,
  volunteer_name text,
  volunteer_email text,
  assigned_at timestamptz,
  is_active boolean
)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null or not public.evently_ticket_is_super_admin() then
    raise exception 'Only a super admin can view event volunteer assignments.' using errcode = '42501';
  end if;

  return query
    select a.volunteer_user_id, p.full_name, p.email, a.assigned_at, a.is_active
    from public.event_volunteer_assignments as a
    join public.profiles as p on p.id = a.volunteer_user_id
    where a.event_id = p_event_id
    order by a.is_active desc, p.full_name, p.email;
end;
$function$;

revoke all on function public.get_event_ticket_assignments(bigint) from public, anon;
grant execute on function public.get_event_ticket_assignments(bigint) to authenticated;

create or replace function public.assign_event_ticket_volunteer(
  p_event_id bigint,
  p_volunteer_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null or not public.evently_ticket_is_super_admin() then
    raise exception 'Only a super admin can assign event ticket volunteers.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.events as e where e.id = p_event_id) then
    raise exception 'Event not found.' using errcode = 'P0002';
  end if;
  if not exists (
    select 1
    from public.user_roles as ur
    where ur.user_id = p_volunteer_user_id
      and ur.role::text = 'volunteer'
  ) then
    raise exception 'Only accounts with the volunteer platform role can be assigned.' using errcode = '22023';
  end if;

  insert into public.event_volunteer_assignments (
    event_id,
    volunteer_user_id,
    assigned_by,
    assigned_at,
    is_active
  )
  values (p_event_id, p_volunteer_user_id, auth.uid(), clock_timestamp(), true)
  on conflict (event_id, volunteer_user_id)
  do update set
    assigned_by = excluded.assigned_by,
    assigned_at = excluded.assigned_at,
    is_active = true;
end;
$function$;

revoke all on function public.assign_event_ticket_volunteer(bigint, uuid)
  from public, anon;
grant execute on function public.assign_event_ticket_volunteer(bigint, uuid)
  to authenticated;

create or replace function public.revoke_event_ticket_volunteer(
  p_event_id bigint,
  p_volunteer_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_rows integer;
begin
  if auth.uid() is null or not public.evently_ticket_is_super_admin() then
    raise exception 'Only a super admin can revoke event ticket volunteers.' using errcode = '42501';
  end if;

  update public.event_volunteer_assignments
    set is_active = false
    where event_id = p_event_id
      and volunteer_user_id = p_volunteer_user_id
      and is_active;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'Active event volunteer assignment not found.' using errcode = 'P0002';
  end if;
end;
$function$;

revoke all on function public.revoke_event_ticket_volunteer(bigint, uuid)
  from public, anon;
grant execute on function public.revoke_event_ticket_volunteer(bigint, uuid)
  to authenticated;

create or replace function public.revoke_event_ticket(p_ticket_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_rows integer;
begin
  if auth.uid() is null or not public.evently_ticket_is_super_admin() then
    raise exception 'Only a super admin can revoke tickets.' using errcode = '42501';
  end if;

  update public.event_tickets
    set ticket_status = 'revoked',
        revoked_at = clock_timestamp(),
        revoked_by = auth.uid()
    where id = p_ticket_id
      and ticket_status = 'active'
      and checked_in_at is null;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'An unchecked active ticket was not found.' using errcode = 'P0002';
  end if;
end;
$function$;

revoke all on function public.revoke_event_ticket(uuid) from public, anon;
grant execute on function public.revoke_event_ticket(uuid) to authenticated;

commit;
