-- Phase 12: safe distribution-item event moves.
-- Apply after Phases 4-6 and optionally after Phase 9/10.
-- This replaces save_event_distribution_item with move support while
-- preserving the existing RPC signature and all existing records.

begin;

do $phase12_preflight$
begin
  if to_regprocedure('public.save_event_distribution_item(bigint,bigint,text,text,integer,integer,timestamptz,timestamptz,text,boolean)') is null
    or to_regclass('public.event_distribution_items') is null
    or to_regclass('public.event_distribution_records') is null
    or to_regclass('public.event_distribution_item_volunteers') is null then
    raise exception 'Phase 12 requires the Phase 6 distribution schema.';
  end if;
end;
$phase12_preflight$;

-- Make the item/event foreign-key relationships deferrable so a move can
-- update the item and all dependent rows atomically in one transaction.
alter table public.event_distribution_records
  alter constraint event_distribution_records_item_event_fk deferrable initially deferred;

alter table public.event_distribution_corrections
  alter constraint event_distribution_corrections_item_event_fk deferrable initially deferred;

alter table public.event_distribution_item_volunteers
  alter constraint event_distribution_item_volunteers_item_event_fk deferrable initially deferred;

create or replace function public.save_event_distribution_item(
  p_item_id bigint,
  p_event_id bigint,
  p_item_name text,
  p_description text,
  p_total_quantity integer,
  p_max_per_participant integer,
  p_distribution_starts_at timestamptz,
  p_distribution_ends_at timestamptz,
  p_distribution_location text,
  p_is_active boolean
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_item public.event_distribution_items%rowtype;
  v_item_id bigint;
  v_total_distributed bigint;
  v_max_participant_quantity bigint;
  v_name text := trim(coalesce(p_item_name, ''));
  v_target_event_title text;
  v_moving_event boolean;
begin
  if auth.uid() is null or not public.evently_ticket_is_super_admin() then
    raise exception 'Only a Super Admin can manage distribution items.'
      using errcode = '42501';
  end if;

  if p_event_id is null then
    raise exception 'Choose an existing event.' using errcode = '22023';
  end if;

  select e.title
  into v_target_event_title
  from public.events as e
  where e.id = p_event_id;

  if not found then
    raise exception 'Choose an existing event.' using errcode = '22023';
  end if;

  if length(v_name) not between 1 and 120 then
    raise exception 'Item name must be between 1 and 120 characters.'
      using errcode = '22023';
  end if;
  if p_description is not null and length(p_description) > 2000 then
    raise exception 'Item description is too long.' using errcode = '22023';
  end if;
  if p_distribution_location is not null
    and length(p_distribution_location) > 240 then
    raise exception 'Distribution location is too long.' using errcode = '22023';
  end if;
  if p_total_quantity is null or p_total_quantity < 0
    or p_max_per_participant is null or p_max_per_participant < 1 then
    raise exception 'Inventory must be zero or more and the participant limit must be positive.'
      using errcode = '22023';
  end if;
  if p_distribution_starts_at is not null
    and p_distribution_ends_at is not null
    and p_distribution_starts_at >= p_distribution_ends_at then
    raise exception 'The distribution end must be after its start.'
      using errcode = '22023';
  end if;

  if p_item_id is null then
    insert into public.event_distribution_items (
      event_id, item_name, description, total_quantity,
      max_per_participant, distribution_starts_at, distribution_ends_at,
      distribution_location, is_active, created_by
    )
    values (
      p_event_id, v_name,
      nullif(trim(coalesce(p_description, '')), ''),
      p_total_quantity, p_max_per_participant,
      p_distribution_starts_at, p_distribution_ends_at,
      nullif(trim(coalesce(p_distribution_location, '')), ''),
      coalesce(p_is_active, true), auth.uid()
    )
    returning id into v_item_id;

    return v_item_id;
  end if;

  select edi.*
  into v_item
  from public.event_distribution_items as edi
  where edi.id = p_item_id
  for update;

  if not found then
    raise exception 'Distribution item not found.' using errcode = 'P0002';
  end if;

  v_moving_event := v_item.event_id <> p_event_id;

  select
    coalesce(
      (
        select sum(edr.quantity)
        from public.event_distribution_records as edr
        where edr.distribution_item_id = p_item_id
      ),
      0
    )
    -
    coalesce(
      (
        select sum(edc.quantity)
        from public.event_distribution_corrections as edc
        where edc.distribution_item_id = p_item_id
      ),
      0
    )
  into v_total_distributed;

  with participant_totals as (
    select edr.registration_id, sum(edr.quantity) as issued_quantity
    from public.event_distribution_records as edr
    where edr.distribution_item_id = p_item_id
    group by edr.registration_id
  ),
  participant_corrections as (
    select edr.registration_id, sum(edc.quantity) as corrected_quantity
    from public.event_distribution_records as edr
    join public.event_distribution_corrections as edc
      on edc.distribution_record_id = edr.id
    where edr.distribution_item_id = p_item_id
    group by edr.registration_id
  )
  select coalesce(
    max(
      pt.issued_quantity
      - coalesce(pct.corrected_quantity, 0)
    ),
    0
  )
  into v_max_participant_quantity
  from participant_totals as pt
  left join participant_corrections as pct
    on pct.registration_id = pt.registration_id;

  if p_total_quantity < v_total_distributed then
    raise exception 'Inventory cannot be reduced below the quantity already distributed.'
      using errcode = '22023';
  end if;
  if p_max_per_participant < v_max_participant_quantity then
    raise exception 'The participant limit cannot be lower than an existing participant distribution.'
      using errcode = '22023';
  end if;

  update public.event_distribution_items as edi
  set event_id = p_event_id,
      item_name = v_name,
      description = nullif(trim(coalesce(p_description, '')), ''),
      total_quantity = p_total_quantity,
      max_per_participant = p_max_per_participant,
      distribution_starts_at = p_distribution_starts_at,
      distribution_ends_at = p_distribution_ends_at,
      distribution_location = nullif(trim(coalesce(p_distribution_location, '')), ''),
      is_active = coalesce(p_is_active, false),
      updated_at = clock_timestamp()
  where edi.id = p_item_id
  returning edi.id into v_item_id;

  if v_moving_event then
    -- Existing distribution and correction rows are moved with the item.
    -- Corrections remain linked to their original distribution record.
    update public.event_distribution_records as edr
    set event_id = p_event_id,
        event_title_snapshot = v_target_event_title
    where edr.distribution_item_id = p_item_id;

    update public.event_distribution_corrections as edc
    set event_id = p_event_id
    where edc.distribution_item_id = p_item_id;

    -- Assignments are event-scoped. Deactivate every old assignment, then
    -- re-link only volunteers who are actively assigned to the target event.
    update public.event_distribution_item_volunteers as ediv
    set is_active = false,
        revoked_by = auth.uid(),
        revoked_at = clock_timestamp()
    where ediv.distribution_item_id = p_item_id
      and ediv.is_active;

    insert into public.event_distribution_item_volunteers (
      event_id,
      distribution_item_id,
      volunteer_user_id,
      assigned_by,
      assigned_at,
      is_active,
      revoked_by,
      revoked_at
    )
    select eva.event_id,
      p_item_id,
      eva.volunteer_user_id,
      auth.uid(),
      clock_timestamp(),
      true,
      null,
      null
    from public.event_volunteer_assignments as eva
    where eva.event_id = p_event_id
      and eva.is_active
    on conflict (distribution_item_id, volunteer_user_id) do update
    set event_id = excluded.event_id,
        is_active = true,
        assigned_by = excluded.assigned_by,
        assigned_at = excluded.assigned_at,
        revoked_by = null,
        revoked_at = null;

    -- Keep Phase 9/10 scan-session metadata consistent where it references
    -- the moved item. This is skipped safely when Phase 9 is not installed.
    if to_regclass('public.event_distribution_scan_sessions') is not null
      and to_regclass('public.event_distribution_scan_attempts') is not null
    then
      update public.event_distribution_scan_sessions as edss
      set event_id = p_event_id
      from public.event_distribution_scan_attempts as edsa
      where edsa.scan_session_id = edss.id
        and edsa.distribution_item_id = p_item_id;
    end if;
  end if;

  return v_item_id;
end;
$function$;

revoke all on function public.save_event_distribution_item(
  bigint, bigint, text, text, integer, integer, timestamptz, timestamptz, text, boolean
) from public, anon;

grant execute on function public.save_event_distribution_item(
  bigint, bigint, text, text, integer, integer, timestamptz, timestamptz, text, boolean
) to authenticated;

commit;
