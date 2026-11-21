-- Phase 13: distribution item_id ambiguity fix.
-- Apply after Phase 6, Phase 9, and Phase 10.
-- Recreates the volunteer/admin distribution RPCs with explicit table aliases
-- and PL/pgSQL column-variable conflict directives. Signatures, return types,
-- security settings, and distribution behavior are unchanged.

begin;

create or replace function public.get_admin_distribution_items(
  p_event_id bigint default null
)
returns table (
  item_id bigint,
  event_id bigint,
  event_title text,
  item_name text,
  description text,
  total_quantity integer,
  max_per_participant integer,
  distribution_starts_at timestamptz,
  distribution_ends_at timestamptz,
  distribution_location text,
  is_active boolean,
  created_by uuid,
  created_at timestamptz,
  updated_at timestamptz,
  quantity_distributed bigint,
  remaining_inventory bigint,
  active_volunteer_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
#variable_conflict use_column
begin
  if auth.uid() is null or not public.evently_ticket_is_super_admin() then
    raise exception 'Only a Super Admin can view distribution items.' using errcode = '42501';
  end if;

  return query
    with distribution_totals as (
      select edr.distribution_item_id, sum(edr.quantity)::bigint as quantity
      from public.event_distribution_records as edr
      group by edr.distribution_item_id
    ),
    correction_totals as (
      select edc.distribution_item_id, sum(edc.quantity)::bigint as quantity
      from public.event_distribution_corrections as edc
      group by edc.distribution_item_id
    ),
    volunteer_totals as (
      select ediv.distribution_item_id, count(*)::bigint as volunteer_count
      from public.event_distribution_item_volunteers as ediv
      where ediv.is_active
      group by ediv.distribution_item_id
    )
    select edi.id as item_id,
      edi.event_id,
      e.title as event_title,
      edi.item_name,
      edi.description,
      edi.total_quantity,
      edi.max_per_participant,
      edi.distribution_starts_at,
      edi.distribution_ends_at,
      edi.distribution_location,
      edi.is_active,
      edi.created_by,
      edi.created_at,
      edi.updated_at,
      coalesce(dt.quantity, 0) - coalesce(ct.quantity, 0) as quantity_distributed,
      greatest(
        edi.total_quantity::bigint - coalesce(dt.quantity, 0)
        + coalesce(ct.quantity, 0),
        0
      ) as remaining_inventory,
      coalesce(vt.volunteer_count, 0) as active_volunteer_count
    from public.event_distribution_items as edi
    join public.events as e on e.id = edi.event_id
    left join distribution_totals as dt on dt.distribution_item_id = edi.id
    left join correction_totals as ct on ct.distribution_item_id = edi.id
    left join volunteer_totals as vt on vt.distribution_item_id = edi.id
    where p_event_id is null or edi.event_id = p_event_id
    order by edi.created_at desc, edi.id desc;
end;
$function$;

revoke all on function public.get_admin_distribution_items(bigint) from public, anon;
grant execute on function public.get_admin_distribution_items(bigint) to authenticated;

create or replace function public.get_admin_distribution_history(
  p_event_id bigint default null,
  p_item_id bigint default null,
  p_volunteer_user_id uuid default null,
  p_status text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  activity_id uuid,
  activity_type text,
  event_id bigint,
  event_title text,
  item_id bigint,
  item_name text,
  registration_id bigint,
  participant_name text,
  participant_type text,
  quantity bigint,
  net_quantity bigint,
  actor_user_id uuid,
  actor_name text,
  activity_at timestamptz,
  activity_status text,
  reason text,
  request_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
#variable_conflict use_column
begin
  if auth.uid() is null or not public.evently_ticket_is_super_admin() then
    raise exception 'Only a Super Admin can view distribution history.' using errcode = '42501';
  end if;

  return query
    with corrected as (
      select edc.distribution_record_id, sum(edc.quantity)::bigint as quantity
      from public.event_distribution_corrections as edc
      group by edc.distribution_record_id
    ),
    activities as (
      select edr.id as activity_id,
        'distribution'::text as activity_type,
        edi.event_id,
        edr.event_title_snapshot as event_title,
        edi.id as item_id,
        edr.item_name_snapshot as item_name,
        edr.registration_id,
        er.full_name as participant_name,
        er.participant_type::text as participant_type,
        edr.quantity::bigint as quantity,
        edr.quantity::bigint - coalesce(cr.quantity, 0) as net_quantity,
        edr.distributed_by as actor_user_id,
        ep.full_name as actor_name,
        edr.distributed_at as activity_at,
        case
          when coalesce(cr.quantity, 0) >= edr.quantity then 'corrected'
          when coalesce(cr.quantity, 0) > 0 then 'partially_corrected'
          else 'distributed'
        end::text as activity_status,
        null::text as reason,
        edr.request_id
      from public.event_distribution_records as edr
      join public.event_distribution_items as edi
        on edi.id = edr.distribution_item_id
      join public.events as e on e.id = edr.event_id
      join public.event_registrations as er on er.id = edr.registration_id
      join public.profiles as ep on ep.id = edr.distributed_by
      left join corrected as cr
        on cr.distribution_record_id = edr.id
      where (p_event_id is null or edr.event_id = p_event_id)
        and (p_item_id is null or edr.distribution_item_id = p_item_id)
        and (p_volunteer_user_id is null or edr.distributed_by = p_volunteer_user_id)
        and (
          coalesce(p_status, 'all') in ('', 'all')
          or (p_status = 'distributed' and edr.quantity > coalesce(cr.quantity, 0))
          or (p_status = 'corrected' and coalesce(cr.quantity, 0) > 0)
        )
      union all
      select edc.id,
        'correction'::text,
        edc.event_id,
        edr.event_title_snapshot,
        edi.id,
        edr.item_name_snapshot,
        edr.registration_id,
        er.full_name,
        er.participant_type::text,
        -edc.quantity::bigint,
        edr.quantity::bigint - coalesce(cr.quantity, 0),
        edc.corrected_by,
        ep.full_name,
        edc.corrected_at,
        'corrected'::text,
        edc.reason,
        edc.request_id
      from public.event_distribution_corrections as edc
      join public.event_distribution_records as edr
        on edr.id = edc.distribution_record_id
      join public.event_distribution_items as edi
        on edi.id = edc.distribution_item_id
      join public.events as e on e.id = edc.event_id
      join public.event_registrations as er on er.id = edr.registration_id
      join public.profiles as ep on ep.id = edc.corrected_by
      left join corrected as cr
        on cr.distribution_record_id = edr.id
      where (p_event_id is null or edc.event_id = p_event_id)
        and (p_item_id is null or edc.distribution_item_id = p_item_id)
        and (p_volunteer_user_id is null or edc.corrected_by = p_volunteer_user_id)
        and coalesce(p_status, 'all') in ('', 'all', 'corrected')
    )
    select a.activity_id,
      a.activity_type,
      a.event_id,
      a.event_title,
      a.item_id,
      a.item_name,
      a.registration_id,
      a.participant_name,
      a.participant_type,
      a.quantity,
      a.net_quantity,
      a.actor_user_id,
      a.actor_name,
      a.activity_at,
      a.activity_status,
      a.reason,
      a.request_id
    from activities as a
    order by a.activity_at desc
    limit greatest(1, least(coalesce(p_limit, 50), 100))
    offset greatest(coalesce(p_offset, 0), 0);
end;
$function$;

revoke all on function public.get_admin_distribution_history(bigint,bigint,uuid,text,integer,integer) from public, anon;
grant execute on function public.get_admin_distribution_history(bigint,bigint,uuid,text,integer,integer) to authenticated;

create or replace function public.get_distribution_checklist(
  p_event_id bigint,
  p_token text
)
returns table (
  event_id bigint,
  event_title text,
  participant_name text,
  participant_type text,
  item_id bigint,
  item_name text,
  description text,
  total_quantity integer,
  max_per_participant integer,
  quantity_distributed bigint,
  participant_quantity bigint,
  participant_remaining bigint,
  inventory_remaining bigint,
  distribution_starts_at timestamptz,
  distribution_ends_at timestamptz,
  distribution_location text,
  is_active boolean,
  distribution_status text
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
#variable_conflict use_column
declare
  v_registration record;
begin
  if auth.uid() is null then
    raise exception 'Sign in to view distribution items.' using errcode = '28000';
  end if;
  if not public.evently_ticket_is_super_admin()
    and not exists (
      select 1
      from public.user_roles as ur
      join public.event_volunteer_assignments as eva
        on eva.volunteer_user_id = ur.user_id
        and eva.event_id = p_event_id
        and eva.is_active
      where ur.user_id = auth.uid()
        and ur.role::text = 'volunteer'
    ) then
    raise exception 'You are not assigned to this event.' using errcode = '42501';
  end if;

  select eligible.*
  into v_registration
  from public.evently_eligible_distribution_registration(p_event_id, p_token) as eligible;
  if not found then
    raise exception 'This ticket is not eligible for distribution.' using errcode = '22023';
  end if;

  return query
    with allowed_items as (
      select edi.*
      from public.event_distribution_items as edi
      where edi.event_id = p_event_id
        and (
          public.evently_ticket_is_super_admin()
          or exists (
            select 1
            from public.event_distribution_item_volunteers as ediv
            where ediv.distribution_item_id = edi.id
              and ediv.event_id = edi.event_id
              and ediv.volunteer_user_id = auth.uid()
              and ediv.is_active
          )
        )
    ),
    totals as (
      select edi.id as item_id,
        coalesce(
          (
            select sum(edr.quantity)::bigint
            from public.event_distribution_records as edr
            where edr.distribution_item_id = edi.id
          ),
          0
        )
        - coalesce(
          (
            select sum(edc.quantity)::bigint
            from public.event_distribution_corrections as edc
            where edc.distribution_item_id = edi.id
          ),
          0
        ) as all_quantity,
        coalesce(
          (
            select sum(edr.quantity)::bigint
            from public.event_distribution_records as edr
            where edr.distribution_item_id = edi.id
              and edr.registration_id = v_registration.registration_id
          ),
          0
        )
        - coalesce(
          (
            select sum(edc.quantity)::bigint
            from public.event_distribution_corrections as edc
            join public.event_distribution_records as edr
              on edr.id = edc.distribution_record_id
            where edc.distribution_item_id = edi.id
              and edr.registration_id = v_registration.registration_id
          ),
          0
        ) as participant_quantity
      from allowed_items as edi
    )
    select edi.event_id,
      v_registration.event_title,
      v_registration.participant_name,
      v_registration.participant_type,
      edi.id as item_id,
      edi.item_name,
      edi.description,
      edi.total_quantity,
      edi.max_per_participant,
      tt.all_quantity,
      tt.participant_quantity,
      greatest(edi.max_per_participant::bigint - tt.participant_quantity, 0),
      greatest(edi.total_quantity::bigint - tt.all_quantity, 0),
      edi.distribution_starts_at,
      edi.distribution_ends_at,
      edi.distribution_location,
      edi.is_active,
      case
        when not edi.is_active then 'inactive'
        when tt.participant_quantity >= edi.max_per_participant then 'distributed'
        when edi.total_quantity::bigint - tt.all_quantity <= 0
          or (edi.distribution_starts_at is not null and edi.distribution_starts_at > now())
          or (edi.distribution_ends_at is not null and edi.distribution_ends_at <= now())
          then 'unavailable'
        else 'pending'
      end
    from allowed_items as edi
    join totals as tt on tt.item_id = edi.id
    order by edi.item_name, edi.id;
end;
$function$;

revoke all on function public.get_distribution_checklist(bigint,text) from public, anon;
grant execute on function public.get_distribution_checklist(bigint,text) to authenticated;

create or replace function public.get_my_distribution_items()
returns table (
  event_id bigint,
  event_title text,
  event_start timestamptz,
  event_status text,
  item_id bigint,
  item_name text,
  description text,
  total_quantity integer,
  max_per_participant integer,
  quantity_distributed bigint,
  inventory_remaining bigint,
  distribution_starts_at timestamptz,
  distribution_ends_at timestamptz,
  distribution_location text,
  is_active boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
#variable_conflict use_column
begin
  if auth.uid() is null or not exists (
    select 1
    from public.user_roles as ur
    where ur.user_id = auth.uid()
      and ur.role::text = 'volunteer'
  ) then
    raise exception 'Only volunteers can view assigned distribution items.'
      using errcode = '42501';
  end if;

  return query
    select edi.event_id,
      e.title,
      e.event_start,
      e.status::text,
      edi.id as item_id,
      edi.item_name,
      edi.description,
      edi.total_quantity,
      edi.max_per_participant,
      coalesce(
        (
          select sum(edr.quantity)::bigint
          from public.event_distribution_records as edr
          where edr.distribution_item_id = edi.id
        ),
        0
      )
      - coalesce(
        (
          select sum(edc.quantity)::bigint
          from public.event_distribution_corrections as edc
          where edc.distribution_item_id = edi.id
        ),
        0
      ) as quantity_distributed,
      greatest(
        edi.total_quantity::bigint
        - coalesce(
          (
            select sum(edr.quantity)::bigint
            from public.event_distribution_records as edr
            where edr.distribution_item_id = edi.id
          ),
          0
        )
        + coalesce(
          (
            select sum(edc.quantity)::bigint
            from public.event_distribution_corrections as edc
            where edc.distribution_item_id = edi.id
          ),
          0
        ),
        0
      ) as inventory_remaining,
      edi.distribution_starts_at,
      edi.distribution_ends_at,
      edi.distribution_location,
      edi.is_active
    from public.event_distribution_items as edi
    join public.events as e on e.id = edi.event_id
    join public.event_distribution_item_volunteers as ediv
      on ediv.distribution_item_id = edi.id
      and ediv.event_id = edi.event_id
      and ediv.volunteer_user_id = auth.uid()
      and ediv.is_active
    join public.event_volunteer_assignments as eva
      on eva.event_id = edi.event_id
      and eva.volunteer_user_id = auth.uid()
      and eva.is_active
    order by e.event_start desc, e.title, edi.item_name;
end;
$function$;

revoke all on function public.get_my_distribution_items() from public, anon;
grant execute on function public.get_my_distribution_items() to authenticated;

create or replace function public.get_distribution_item_volunteers(
  p_item_id bigint
)
returns table (
  volunteer_user_id uuid,
  volunteer_name text,
  volunteer_email text,
  is_active boolean,
  assigned_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
#variable_conflict use_column
begin
  if auth.uid() is null or not public.evently_ticket_is_super_admin() then
    raise exception 'Only a Super Admin can manage item-level volunteer access.'
      using errcode = '42501';
  end if;

  return query
    select ediv.volunteer_user_id,
      p.full_name,
      p.email,
      ediv.is_active,
      ediv.assigned_at
    from public.event_distribution_item_volunteers as ediv
    join public.profiles as p on p.id = ediv.volunteer_user_id
    where ediv.distribution_item_id = p_item_id
    order by ediv.is_active desc, p.full_name, p.email;
end;
$function$;

revoke all on function public.get_distribution_item_volunteers(bigint) from public, anon;
grant execute on function public.get_distribution_item_volunteers(bigint) to authenticated;

create or replace function public.set_distribution_item_volunteer(
  p_item_id bigint,
  p_volunteer_user_id uuid,
  p_is_active boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
#variable_conflict use_column
declare
  v_event_id bigint;
begin
  if auth.uid() is null or not public.evently_ticket_is_super_admin() then
    raise exception 'Only a Super Admin can manage item-level volunteer access.'
      using errcode = '42501';
  end if;

  select edi.event_id
  into v_event_id
  from public.event_distribution_items as edi
  where edi.id = p_item_id
  for update;

  if not found then
    raise exception 'Distribution item not found.' using errcode = 'P0002';
  end if;

  if coalesce(p_is_active, false) then
    if not exists (
      select 1
      from public.user_roles as ur
      join public.event_volunteer_assignments as eva
        on eva.volunteer_user_id = ur.user_id
        and eva.event_id = v_event_id
        and eva.is_active
      where ur.user_id = p_volunteer_user_id
        and ur.role::text = 'volunteer'
    ) then
      raise exception 'Assign this volunteer to the event in Ticket Management before granting item access.'
        using errcode = '22023';
    end if;

    insert into public.event_distribution_item_volunteers (
      event_id, distribution_item_id, volunteer_user_id, assigned_by,
      assigned_at, is_active, revoked_by, revoked_at
    )
    values (
      v_event_id, p_item_id, p_volunteer_user_id, auth.uid(),
      clock_timestamp(), true, null, null
    )
    on conflict (distribution_item_id, volunteer_user_id)
    do update set
      event_id = excluded.event_id,
      assigned_by = excluded.assigned_by,
      assigned_at = excluded.assigned_at,
      is_active = true,
      revoked_by = null,
      revoked_at = null;
  else
    update public.event_distribution_item_volunteers as ediv
    set is_active = false,
        revoked_by = auth.uid(),
        revoked_at = clock_timestamp()
    where ediv.distribution_item_id = p_item_id
      and ediv.volunteer_user_id = p_volunteer_user_id
      and ediv.is_active;

    if not found then
      raise exception 'Active item-level volunteer access was not found.'
        using errcode = 'P0002';
    end if;
  end if;
end;
$function$;

revoke all on function public.set_distribution_item_volunteer(bigint,uuid,boolean) from public, anon;
grant execute on function public.set_distribution_item_volunteer(bigint,uuid,boolean) to authenticated;

commit;
