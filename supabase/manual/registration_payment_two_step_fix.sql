-- Evently: registration and payment in one server-side transaction
-- Run manually in the Supabase SQL Editor. This migration does not execute automatically.
-- Rollback: drop only complete_event_registration_with_payment; no existing columns or tables are changed.

begin;

do $$
begin
  if to_regclass('public.events') is null
    or to_regclass('public.event_registrations') is null
    or to_regclass('public.event_guest_settings') is null
    or to_regclass('public.event_registration_guests') is null
    or to_regclass('public.event_payment_submissions') is null
  then
    raise exception 'Required Evently registration/payment tables are missing.';
  end if;
$$;

alter table public.event_registrations
  add column if not exists main_fee_snapshot numeric(12,2),
  add column if not exists guest_fee_total numeric(12,2) not null default 0,
  add column if not exists fee_amount numeric(12,2);

create or replace function public.complete_event_registration_with_payment(
  p_event_id bigint,
  p_full_name text,
  p_email text,
  p_phone text,
  p_participant_type text,
  p_institution_id bigint,
  p_department_id bigint,
  p_identity_number text,
  p_form_answers jsonb,
  p_guests jsonb,
  p_payment_method text,
  p_transaction_id text,
  p_sender_phone text,
  p_payment_note text,
  p_screenshot_path text,
  p_idempotency_key text
)
returns table (
  registration_id bigint,
  registration_fee_amount numeric,
  payment_id uuid,
  full_name text
)
language plpgsql
security invoker
set search_path = public
as $function$
declare
  v_user uuid := auth.uid();
  v_event public.events%rowtype;
  v_registration public.event_registrations%rowtype;
  v_payment public.event_payment_submissions%rowtype;
  v_main_fee numeric(12,2) := 0;
  v_guest_fee numeric(12,2) := 0;
  v_guest_fee_total numeric(12,2) := 0;
  v_guest_count integer := 0;
  v_existing_guest_count integer := 0;
  v_max_guests integer;
  v_total_guest_limit integer;
  v_guest jsonb;
  v_guest_name text;
  v_relationship text;
  v_age_category text;
  v_guest_fee numeric(12,2);
  v_existing_payment_count integer;
begin
  if v_user is null then
    raise exception 'Sign in to continue.';
  end if;
  if p_full_name is null or btrim(p_full_name) = '' then
    raise exception 'Full name is required.';
  end if;
  if p_event_id is null then
    raise exception 'Event is required.';
  end if;

  select * into v_event from public.events where id = p_event_id for update;
  if v_event.id is null then raise exception 'Event was not found.'; end if;
  if lower(v_event.status) <> 'published' then raise exception 'Event is no longer accepting registrations.'; end if;
  if v_event.registration_deadline is not null and now() > v_event.registration_deadline then
    raise exception 'The registration deadline has passed.';
  end if;

  if lower(p_participant_type) = 'student' then
    v_main_fee := coalesce(v_event.student_fee, 0);
  elsif lower(p_participant_type) = 'teacher' then
    v_main_fee := coalesce(v_event.teacher_fee, 0);
  elsif lower(p_participant_type) = 'alumni' then
    v_main_fee := coalesce(v_event.alumni_fee, 0);
  else
    raise exception 'Invalid participant type.';
  end if;

  select coalesce(count(*), 0) into v_existing_payment_count
  from public.event_payment_submissions payment
  where payment.registration_id in (
    select registration.id
    from public.event_registrations registration
    where registration.event_id = p_event_id and registration.user_id = v_user
  );

  select * into v_registration
  from public.event_registrations
  where event_id = p_event_id and user_id = v_user
  order by registered_at desc
  limit 1;

  if v_registration.id is not null and v_existing_payment_count > 0 then
    select * into v_payment
    from public.event_payment_submissions
    where registration_id = v_registration.id
    order by submitted_at desc
    limit 1;
    return query select v_registration.id,
      coalesce(v_registration.fee_amount, 0),
      v_payment.id,
      v_registration.full_name;
    return;
  end if;

  select coalesce(count(*), 0) into v_existing_guest_count
  from public.event_registration_guests guest
  join public.event_registrations registration on registration.id = guest.registration_id
  where registration.event_id = p_event_id
    and registration.registration_status = 'registered';

  if v_event.seat_limit is not null
    and (select count(*) from public.event_registrations
         where event_id = p_event_id and registration_status = 'registered') >= v_event.seat_limit
  then
    raise exception 'This event has reached its seat limit.';
  end if;

  if p_guests is not null and jsonb_typeof(p_guests) = 'array' then
    select count(*) into v_guest_count
    from jsonb_array_elements(p_guests);
  else
    v_guest_count := 0;
  end if;

  for v_guest in select * from jsonb_array_elements(coalesce(p_guests, '[]'::jsonb)) loop
    v_guest_name := btrim(coalesce(v_guest->>'full_name', v_guest->>'name', ''));
    v_relationship := lower(coalesce(v_guest->>'relationship', ''));
    v_age_category := lower(coalesce(v_guest->>'child_age_category', ''));
    if v_guest_name = '' then raise exception 'Guest full name is required.'; end if;

    v_guest_fee := 0;
    if v_relationship in ('father','mother','sister','brother','husband','wife') then
      select coalesce(common_guest_fee, 0) into v_guest_fee
      from public.event_guest_settings
      where event_id = p_event_id and is_enabled
      limit 1;
    elsif v_relationship = 'child' and v_age_category = 'under_6' then
      select coalesce(child_under_6_fee, 0) into v_guest_fee
      from public.event_guest_settings
      where event_id = p_event_id and is_enabled
      limit 1;
    elsif v_relationship = 'child' and v_age_category = 'above_6' then
      select coalesce(child_above_6_fee, 0) into v_guest_fee
      from public.event_guest_settings
      where event_id = p_event_id and is_enabled
      limit 1;
    else
      raise exception 'Invalid guest relationship or age category.';
    end if;
    v_guest_fee := coalesce(v_guest_fee, 0);
    v_guest_fee_total := v_guest_fee_total + v_guest_fee;
  end loop;

  select coalesce(max_guests_per_participant, 0),
         coalesce(total_guest_limit, 0)
    into v_max_guests, v_total_guest_limit
  from public.event_guest_settings
  where event_id = p_event_id and is_enabled
  limit 1;
  if v_guest_count > 0 and coalesce(v_max_guests, 0) = 0 then
    raise exception 'Guest registration is disabled for this event.';
  end if;
  if v_guest_count > coalesce(v_max_guests, 0) then
    raise exception 'Maximum guests per participant exceeded.';
  end if;
  if v_existing_guest_count + v_guest_count > coalesce(v_total_guest_limit, 2147483647) then
    raise exception 'The event guest admission limit has been reached.';
  end if;

  if v_registration.id is null then
    insert into public.event_registrations (
      event_id, user_id, full_name, email, phone, participant_type,
      institution_id, department_id, identity_number, form_answers,
      main_fee_snapshot, guest_fee_total, fee_amount, registration_status, registered_at
    ) values (
      p_event_id, v_user, btrim(p_full_name), lower(btrim(p_email)), btrim(p_phone),
      lower(p_participant_type), p_institution_id, p_department_id, btrim(p_identity_number),
      coalesce(p_form_answers, '{}'::jsonb),
      v_main_fee, v_guest_fee_total,
      v_main_fee + v_guest_fee_total, 'registered', now()
    )
    returning * into v_registration;
  else
    update public.event_registrations
      set full_name = btrim(p_full_name),
          email = lower(btrim(p_email)),
          phone = btrim(p_phone),
          participant_type = lower(p_participant_type),
          institution_id = p_institution_id,
          department_id = p_department_id,
          identity_number = btrim(p_identity_number),
          form_answers = coalesce(p_form_answers, '{}'::jsonb),
          main_fee_snapshot = v_main_fee,
          guest_fee_total = v_guest_fee_total,
          fee_amount = v_main_fee + v_guest_fee_total,
          registration_status = 'registered',
          registered_at = now()
      where id = v_registration.id
    returning * into v_registration;
  end if;

  delete from public.event_registration_guests where registration_id = v_registration.id;
  v_guest_fee_total := 0;
  for v_guest in select * from jsonb_array_elements(coalesce(p_guests, '[]'::jsonb)) loop
    v_guest_name := btrim(coalesce(v_guest->>'full_name', v_guest->>'name', ''));
    v_relationship := lower(coalesce(v_guest->>'relationship', ''));
    v_age_category := lower(coalesce(v_guest->>'child_age_category', ''));
    if v_relationship in ('father','mother','sister','brother','husband','wife') then
      select coalesce(common_guest_fee, 0) into v_guest_fee
      from public.event_guest_settings where event_id = p_event_id and is_enabled limit 1;
    elsif v_relationship = 'child' and v_age_category = 'under_6' then
      select coalesce(child_under_6_fee, 0) into v_guest_fee
      from public.event_guest_settings where event_id = p_event_id and is_enabled limit 1;
    elsif v_relationship = 'child' and v_age_category = 'above_6' then
      select coalesce(child_above_6_fee, 0) into v_guest_fee
      from public.event_guest_settings where event_id = p_event_id and is_enabled limit 1;
    else v_guest_fee := 0;
    end if;
    v_guest_fee_total := v_guest_fee_total + coalesce(v_guest_fee, 0);
    insert into public.event_registration_guests (
      registration_id, guest_name, relationship, child_age_category, guest_fee_snapshot
    ) values (
      v_registration.id, v_guest_name, v_relationship,
      case when v_relationship = 'child' then v_age_category else null end,
      coalesce(v_guest_fee, 0)
    );
  end loop;

  update public.event_registrations
    set guest_fee_total = v_guest_fee_total,
        fee_amount = v_main_fee + v_guest_fee_total
    where id = v_registration.id;

  if v_main_fee + v_guest_fee_total > 0 then
    if p_transaction_id is null or btrim(p_transaction_id) = '' then
      raise exception 'Transaction ID is required.';
    end if;
    if p_screenshot_path is null or btrim(p_screenshot_path) = '' then
      raise exception 'Payment screenshot is required.';
    end if;
    insert into public.event_payment_submissions (
      registration_id, payment_provider, payment_method, transaction_id,
      sender_phone, payment_note, payment_amount, screenshot_path,
      payment_status, submitted_at
    ) values (
      v_registration.id, 'manual', lower(coalesce(p_payment_method, 'other')),
      btrim(p_transaction_id), nullif(btrim(coalesce(p_sender_phone, '')), ''),
      nullif(btrim(coalesce(p_payment_note, '')), ''),
      v_main_fee + v_guest_fee_total, p_screenshot_path, 'pending', now()
    )
    returning * into v_payment;
  end if;

  return query select v_registration.id,
    v_main_fee + v_guest_fee_total,
    v_payment.id,
    v_registration.full_name;
end;
$function$;

revoke all on function public.complete_event_registration_with_payment(
  bigint,text,text,text,text,bigint,bigint,text,jsonb,jsonb,text,text,text,text,text,text
) from public;
grant execute on function public.complete_event_registration_with_payment(
  bigint,text,text,text,text,bigint,bigint,text,jsonb,jsonb,text,text,text,text,text,text
) to authenticated;

commit;
