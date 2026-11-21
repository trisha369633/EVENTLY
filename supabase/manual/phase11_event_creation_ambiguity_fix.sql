-- Phase 11 event guest settings ambiguity fix.
-- Apply after Phase 10.
-- This migration only recreates the guest-settings RPCs changed by event
-- creation/editing. It preserves both public function signatures and return
-- shapes.

begin;

do $phase11_preflight$
begin
  if to_regclass('public.event_guest_settings') is null
    or to_regclass('public.event_guest_relationship_fees') is null then
    raise exception 'Apply phase10_guest_registration.sql before this migration.';
  end if;
end;
$phase11_preflight$;

create or replace function public.save_event_guest_settings(
  p_event_id bigint,
  p_is_enabled boolean,
  p_max_guests_per_participant integer,
  p_total_guest_limit integer,
  p_guest_distribution_enabled boolean,
  p_relationship_fees jsonb
)
returns table (
  event_id bigint,
  is_enabled boolean,
  max_guests_per_participant integer,
  total_guest_limit integer,
  guest_distribution_enabled boolean
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_fee record;
begin
  if auth.uid() is null or not public.evently_ticket_is_super_admin() then
    raise exception 'Only Super Admins can configure guest registration.'
      using errcode = '42501';
  end if;
  if p_max_guests_per_participant is null or p_max_guests_per_participant < 0
    or p_total_guest_limit is null or p_total_guest_limit < 0 then
    raise exception 'Guest limits must be zero or a positive whole number.'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.event_guest_settings as egs
    where egs.event_id = p_event_id
  ) then
    update public.event_guest_settings as egs
    set is_enabled = coalesce(p_is_enabled, false),
        max_guests_per_participant = p_max_guests_per_participant,
        total_guest_limit = p_total_guest_limit,
        guest_distribution_enabled = coalesce(p_guest_distribution_enabled, true),
        updated_at = clock_timestamp(),
        updated_by = auth.uid()
    where egs.event_id = p_event_id;
  else
    insert into public.event_guest_settings (
      event_id, is_enabled, max_guests_per_participant,
      total_guest_limit, guest_distribution_enabled, updated_at, updated_by
    ) values (
      p_event_id, coalesce(p_is_enabled, false),
      p_max_guests_per_participant, p_total_guest_limit,
      coalesce(p_guest_distribution_enabled, true), clock_timestamp(), auth.uid()
    );
  end if;

  delete from public.event_guest_relationship_fees as egrf
  where egrf.event_id = p_event_id;

  if p_relationship_fees is not null then
    for v_fee in
      select f.*
      from jsonb_to_recordset(p_relationship_fees) as f(
        relationship text,
        guest_fee numeric,
        is_active boolean
      )
    loop
      if v_fee.relationship not in (
        'father','mother','sister','brother','husband','wife','child'
      ) or v_fee.guest_fee is null or v_fee.guest_fee < 0 then
        raise exception 'A guest relationship or fee is invalid.'
          using errcode = '22023';
      end if;
      insert into public.event_guest_relationship_fees (
        event_id, relationship, guest_fee, is_active, updated_at
      ) values (
        p_event_id, v_fee.relationship, v_fee.guest_fee,
        coalesce(v_fee.is_active, false), clock_timestamp()
      );
    end loop;
  end if;

  return query
    select egs.event_id, egs.is_enabled, egs.max_guests_per_participant,
      egs.total_guest_limit, egs.guest_distribution_enabled
    from public.event_guest_settings as egs
    where egs.event_id = p_event_id;
end;
$function$;

revoke all on function public.save_event_guest_settings(bigint,boolean,integer,integer,boolean,jsonb)
  from public, anon;
grant execute on function public.save_event_guest_settings(bigint,boolean,integer,integer,boolean,jsonb)
  to authenticated;

create or replace function public.get_event_guest_settings(p_event_id bigint)
returns table (
  event_id bigint,
  is_enabled boolean,
  max_guests_per_participant integer,
  total_guest_limit integer,
  remaining_guest_capacity bigint,
  guest_distribution_enabled boolean,
  relationship text,
  guest_fee numeric,
  relationship_is_active boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  return query
    select egs.event_id, egs.is_enabled, egs.max_guests_per_participant,
      egs.total_guest_limit,
      greatest(
        egs.total_guest_limit::bigint - coalesce(
          (
            select count(*)::bigint
            from public.event_guests as eg
            where eg.event_id = egs.event_id
              and eg.status = 'registered'
          ),
          0
        ),
        0
      ),
      egs.guest_distribution_enabled,
      egrf.relationship, egrf.guest_fee, egrf.is_active
    from public.event_guest_settings as egs
    left join public.event_guest_relationship_fees as egrf
      on egrf.event_id = egs.event_id
    where egs.event_id = p_event_id;
end;
$function$;

revoke all on function public.get_event_guest_settings(bigint)
  from public, anon;
grant execute on function public.get_event_guest_settings(bigint)
  to authenticated;

commit;
