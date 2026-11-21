-- Phase 9 continuous QR-based item distribution.
-- Apply Phase 4, Phase 5, and Phase 6 manually before this file.
-- This migration adds scan-session audit records and atomic multi-item
-- distribution without replacing the existing Phase 5 check-in workflow.

begin;

do $phase9_preflight$
begin
  if to_regclass('public.event_distribution_items') is null
    or to_regclass('public.event_distribution_item_volunteers') is null
    or to_regclass('public.event_distribution_records') is null
    or to_regclass('public.event_distribution_corrections') is null
    or to_regprocedure('public.evently_eligible_distribution_registration(bigint,text)') is null
    or to_regprocedure('public.record_event_distribution(bigint,bigint,text,integer,uuid)') is null then
    raise exception 'Phase 9 requires the installed Phase 4, Phase 5, and Phase 6 distribution schema. Apply phases 4-6 before Phase 9.';
  end if;
end;
$phase9_preflight$;

comment on column public.event_distribution_records.request_id is
  'Stable request identifier for idempotent distribution operations.';

create table if not exists public.event_distribution_scan_sessions (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  event_id bigint not null references public.events(id) on delete restrict,
  registration_id bigint references public.event_registrations(id) on delete restrict,
  participant_user_id uuid references public.profiles(id) on delete restrict,
  participant_name_snapshot text,
  distributed_by uuid not null references public.profiles(id) on delete restrict,
  selected_item_ids bigint[] not null default '{}'::bigint[],
  result_code text not null,
  scanned_at timestamptz not null default clock_timestamp()
);

create index if not exists idx_event_distribution_scan_sessions_event
  on public.event_distribution_scan_sessions (event_id, scanned_at desc);
create index if not exists idx_event_distribution_scan_sessions_participant
  on public.event_distribution_scan_sessions (registration_id, scanned_at desc);
create index if not exists idx_event_distribution_scan_sessions_staff
  on public.event_distribution_scan_sessions (distributed_by, scanned_at desc);

create table if not exists public.event_distribution_scan_attempts (
  id uuid primary key default gen_random_uuid(),
  scan_session_id uuid not null
    references public.event_distribution_scan_sessions(id) on delete cascade,
  distribution_item_id bigint references public.event_distribution_items(id) on delete restrict,
  item_name_snapshot text,
  status text not null
    check (status in (
      'distributed', 'already_received', 'inactive', 'unavailable',
      'unauthorized', 'invalid_ticket', 'inventory_error'
    )),
  quantity_distributed integer not null default 0
    check (quantity_distributed >= 0),
  attempted_at timestamptz not null default clock_timestamp()
);

create index if not exists idx_event_distribution_scan_attempts_session
  on public.event_distribution_scan_attempts (scan_session_id, attempted_at);
create index if not exists idx_event_distribution_scan_attempts_item
  on public.event_distribution_scan_attempts (distribution_item_id, attempted_at desc);

alter table public.event_distribution_scan_sessions enable row level security;
alter table public.event_distribution_scan_attempts enable row level security;

drop policy if exists event_distribution_scan_sessions_authorized_read
  on public.event_distribution_scan_sessions;
create policy event_distribution_scan_sessions_authorized_read
  on public.event_distribution_scan_sessions
  for select
  to authenticated
  using (
    public.evently_ticket_is_super_admin()
    or distributed_by = auth.uid()
  );

drop policy if exists event_distribution_scan_attempts_authorized_read
  on public.event_distribution_scan_attempts;
create policy event_distribution_scan_attempts_authorized_read
  on public.event_distribution_scan_attempts
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.event_distribution_scan_sessions as s
      where s.id = scan_session_id
        and (
          public.evently_ticket_is_super_admin()
          or s.distributed_by = auth.uid()
        )
    )
  );

revoke all on table public.event_distribution_scan_sessions
  from public, anon, authenticated;
revoke all on table public.event_distribution_scan_attempts
  from public, anon, authenticated;
grant select on table public.event_distribution_scan_sessions to authenticated;
grant select on table public.event_distribution_scan_attempts to authenticated;

create or replace function public.evently_enforce_one_per_participant_distribution()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_item public.event_distribution_items%rowtype;
  v_quantity bigint;
  v_corrections bigint;
begin
  select i.* into v_item
  from public.event_distribution_items as i
  where i.id = new.distribution_item_id
  for update;

  if v_item.max_per_participant = 1 then
    select coalesce(sum(r.quantity), 0) into v_quantity
    from public.event_distribution_records as r
    where r.registration_id = new.registration_id
      and r.distribution_item_id = new.distribution_item_id;

    select coalesce(sum(c.quantity), 0) into v_corrections
    from public.event_distribution_corrections as c
    join public.event_distribution_records as r on r.id = c.distribution_record_id
    where r.registration_id = new.registration_id
      and r.distribution_item_id = new.distribution_item_id;

    if v_quantity - v_corrections + new.quantity > 1 then
      raise exception 'This participant has already received this item.'
        using errcode = '23505';
    end if;
  end if;
  return new;
end;
$function$;

revoke all on function public.evently_enforce_one_per_participant_distribution()
  from public, anon, authenticated;

drop trigger if exists evently_enforce_one_per_participant_distribution
  on public.event_distribution_records;
create trigger evently_enforce_one_per_participant_distribution
  before insert on public.event_distribution_records
  for each row execute function public.evently_enforce_one_per_participant_distribution();

create or replace function public.record_continuous_event_distribution(
  p_event_id bigint,
  p_token text,
  p_item_ids bigint[],
  p_request_id uuid
)
returns table (
  scan_session_id uuid,
  result_code text,
  participant_name text,
  participant_type text,
  item_id bigint,
  item_name text,
  item_status text,
  quantity_distributed integer
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_existing public.event_distribution_scan_sessions%rowtype;
  v_session public.event_distribution_scan_sessions%rowtype;
  v_eligible record;
  v_item public.event_distribution_items%rowtype;
  v_participant_quantity bigint;
  v_item_quantity bigint;
  v_selected bigint[];
  v_selected_item_id bigint;
  v_status text;
  v_distributed integer := 0;
  v_attempt_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Sign in to distribute items.' using errcode = '28000';
  end if;
  if p_request_id is null then
    raise exception 'A unique scan request identifier is required.' using errcode = '22023';
  end if;

  v_selected := coalesce(p_item_ids, '{}'::bigint[]);
  select s.* into v_existing
  from public.event_distribution_scan_sessions as s
  where s.request_id = p_request_id;
  if found then
    if v_existing.event_id <> p_event_id
      or v_existing.distributed_by <> auth.uid()
      or v_existing.selected_item_ids <> v_selected
    then
      raise exception 'This scan request identifier was already used for a different request.'
        using errcode = '23505';
    end if;

    return query
      select s.id, s.result_code, s.participant_name_snapshot,
        null::text,
        a.distribution_item_id, a.item_name_snapshot,
        a.status, a.quantity_distributed
      from public.event_distribution_scan_sessions as s
      join public.event_distribution_scan_attempts as a on a.scan_session_id = s.id
      where s.id = v_existing.id
      order by a.attempted_at, a.id;
    return;
  end if;

  if cardinality(v_selected) = 0 then
    raise exception 'Select at least one distribution item.' using errcode = '22023';
  end if;
  select array_agg(distinct item_id order by item_id) into v_selected
  from unnest(v_selected) as item_id;

  select eligible.* into v_eligible
  from public.evently_eligible_distribution_registration(p_event_id, p_token) as eligible;

  if not found then
    insert into public.event_distribution_scan_sessions (
      request_id, event_id, distributed_by, selected_item_ids,
      result_code, participant_name_snapshot
    ) values (
      p_request_id, p_event_id, auth.uid(), v_selected,
      'invalid_ticket', null
    )
    returning * into v_session;

    insert into public.event_distribution_scan_attempts (
      scan_session_id, status
    ) values (v_session.id, 'invalid_ticket');

    return query
      select v_session.id, v_session.result_code, null::text, null::text,
        null::bigint, null::text, 'invalid_ticket'::text, 0;
    return;
  end if;

  insert into public.event_distribution_scan_sessions (
    request_id, event_id, registration_id, participant_user_id,
    participant_name_snapshot, distributed_by, selected_item_ids,
    result_code
  ) values (
    p_request_id, p_event_id, v_eligible.registration_id,
    v_eligible.participant_user_id, v_eligible.participant_name,
    auth.uid(), v_selected, 'processing'
  )
  returning * into v_session;

  foreach v_selected_item_id in array v_selected
  loop
    v_attempt_count := v_attempt_count + 1;
    v_status := 'unavailable';

    select i.* into v_item
    from public.event_distribution_items as i
    where i.id = v_selected_item_id
      and i.event_id = p_event_id
    for update;

    if not found then
      v_status := 'unauthorized';
      insert into public.event_distribution_scan_attempts (
        scan_session_id, distribution_item_id, item_name_snapshot, status
      ) values (v_session.id, v_selected_item_id, null, v_status);
    elsif not public.evently_ticket_is_super_admin()
      and not exists (
        select 1
        from public.user_roles as ur
        join public.event_volunteer_assignments as ev
          on ev.volunteer_user_id = ur.user_id
          and ev.event_id = p_event_id
          and ev.is_active
        join public.event_distribution_item_volunteers as iv
          on iv.event_id = ev.event_id
          and iv.volunteer_user_id = ev.volunteer_user_id
          and iv.distribution_item_id = v_item.id
          and iv.is_active
        where ur.user_id = auth.uid()
          and ur.role::text = 'volunteer'
      )
    then
      v_status := 'unauthorized';
      insert into public.event_distribution_scan_attempts (
        scan_session_id, distribution_item_id, item_name_snapshot, status
      ) values (v_session.id, v_item.id, v_item.item_name, v_status);
    else
      select
        coalesce((select sum(r.quantity)::bigint
          from public.event_distribution_records as r
          where r.distribution_item_id = v_item.id
            and r.registration_id = v_eligible.registration_id), 0)
        - coalesce((select sum(c.quantity)::bigint
          from public.event_distribution_corrections as c
          join public.event_distribution_records as r on r.id = c.distribution_record_id
          where c.distribution_item_id = v_item.id
            and r.registration_id = v_eligible.registration_id), 0),
        coalesce((select sum(r.quantity)::bigint
          from public.event_distribution_records as r
          where r.distribution_item_id = v_item.id), 0)
        - coalesce((select sum(c.quantity)::bigint
          from public.event_distribution_corrections as c
          where c.distribution_item_id = v_item.id), 0)
      into v_participant_quantity, v_item_quantity;

      if not v_item.is_active then
        v_status := 'inactive';
      elsif v_item.distribution_starts_at is not null
        and v_item.distribution_starts_at > clock_timestamp()
      then
        v_status := 'unavailable';
      elsif v_item.distribution_ends_at is not null
        and v_item.distribution_ends_at <= clock_timestamp()
      then
        v_status := 'unavailable';
      elsif v_participant_quantity >= v_item.max_per_participant then
        v_status := 'already_received';
      elsif v_item_quantity >= v_item.total_quantity then
        v_status := 'inventory_error';
      else
        insert into public.event_distribution_records (
          request_id, event_id, distribution_item_id,
          event_title_snapshot, item_name_snapshot, registration_id,
          participant_user_id, quantity, distributed_by
        ) values (
          gen_random_uuid(), p_event_id, v_item.id,
          v_eligible.event_title, v_item.item_name,
          v_eligible.registration_id, v_eligible.participant_user_id,
          1, auth.uid()
        );
        v_status := 'distributed';
        v_distributed := v_distributed + 1;
      end if;

      insert into public.event_distribution_scan_attempts (
        scan_session_id, distribution_item_id, item_name_snapshot,
        status, quantity_distributed
      ) values (
        v_session.id, v_item.id, v_item.item_name,
        v_status, case when v_status = 'distributed' then 1 else 0 end
      );
    end if;
  end loop;

  update public.event_distribution_scan_sessions
  set result_code = case
    when v_distributed > 0 then 'distributed'
    when exists (
      select 1 from public.event_distribution_scan_attempts
      where scan_session_id = v_session.id
        and status = 'already_received'
    ) then 'already_received'
    else 'not_distributed'
  end
  where id = v_session.id;

  return query
    select s.id, s.result_code, s.participant_name_snapshot,
      v_eligible.participant_type,
      a.distribution_item_id, a.item_name_snapshot,
      a.status, a.quantity_distributed
    from public.event_distribution_scan_sessions as s
    join public.event_distribution_scan_attempts as a on a.scan_session_id = s.id
    where s.id = v_session.id
    order by a.attempted_at, a.id;
end;
$function$;

revoke all on function public.record_continuous_event_distribution(bigint,text,bigint[],uuid)
  from public, anon;
grant execute on function public.record_continuous_event_distribution(bigint,text,bigint[],uuid)
  to authenticated;

create or replace function public.get_my_event_distribution_benefits(
  p_event_id bigint default null
)
returns table (
  event_id bigint,
  event_title text,
  item_id bigint,
  item_name text,
  description text,
  status text,
  quantity_received bigint,
  distributed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null then
    raise exception 'Sign in to view event benefits.' using errcode = '28000';
  end if;

  return query
    select i.event_id, e.title, i.id, i.item_name, i.description,
      case when coalesce(received.quantity_received, 0) > 0
        then 'received' else 'not_received' end::text,
      coalesce(received.quantity_received, 0)::bigint,
      received.last_distributed_at
    from public.event_registrations as rg
    join public.events as e on e.id = rg.event_id
    join public.event_distribution_items as i on i.event_id = rg.event_id
    left join lateral (
      select
        greatest(
          coalesce(sum(r.quantity), 0)
          - coalesce((select sum(c.quantity)
              from public.event_distribution_corrections as c
              join public.event_distribution_records as rr on rr.id = c.distribution_record_id
              where rr.registration_id = rg.id
                and rr.distribution_item_id = i.id), 0),
          0
        )::bigint as quantity_received,
        max(r.distributed_at) as last_distributed_at
      from public.event_distribution_records as r
      where r.registration_id = rg.id
        and r.distribution_item_id = i.id
    ) as received on true
    where rg.user_id = auth.uid()
      and rg.registration_status::text = 'registered'
      and (p_event_id is null or rg.event_id = p_event_id)
      and i.is_active
    order by e.title, i.item_name;
end;
$function$;

revoke all on function public.get_my_event_distribution_benefits(bigint)
  from public, anon;
grant execute on function public.get_my_event_distribution_benefits(bigint)
  to authenticated;

create or replace function public.get_admin_continuous_distribution_summary(
  p_event_id bigint default null
)
returns table (
  event_id bigint,
  scan_sessions bigint,
  successful_operations bigint,
  total_items_distributed bigint,
  already_received_attempts bigint,
  failed_attempts bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if not public.evently_ticket_is_super_admin() then
    raise exception 'Only Super Admins can view distribution scan summaries.'
      using errcode = '42501';
  end if;

  return query
    select s.event_id,
      count(distinct s.id)::bigint,
      count(distinct s.id) filter (
        where exists (
          select 1 from public.event_distribution_scan_attempts as a
          where a.scan_session_id = s.id and a.status = 'distributed'
        )
      )::bigint,
      coalesce(sum(a.quantity_distributed) filter (where a.status = 'distributed'), 0)::bigint,
      count(*) filter (where a.status = 'already_received')::bigint,
      count(*) filter (where a.status in (
        'inactive', 'unavailable', 'unauthorized',
        'invalid_ticket', 'inventory_error'
      ))::bigint
    from public.event_distribution_scan_sessions as s
    left join public.event_distribution_scan_attempts as a on a.scan_session_id = s.id
    where p_event_id is null or s.event_id = p_event_id
    group by s.event_id
    order by s.event_id;
end;
$function$;

revoke all on function public.get_admin_continuous_distribution_summary(bigint)
  from public, anon;
grant execute on function public.get_admin_continuous_distribution_summary(bigint)
  to authenticated;

do $phase9_realtime$
declare
  v_table text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach v_table in array array[
      'event_distribution_scan_sessions',
      'event_distribution_scan_attempts'
    ] loop
      if not exists (
        select 1
        from pg_publication_tables as pt
        where pt.pubname = 'supabase_realtime'
          and pt.schemaname = 'public'
          and pt.tablename = v_table
      ) then
        execute format(
          'alter publication supabase_realtime add table public.%I',
          v_table
        );
      end if;
    end loop;
  end if;
end;
$phase9_realtime$;

commit;
