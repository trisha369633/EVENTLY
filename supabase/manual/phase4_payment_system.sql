-- Phase 4 manual-payment schema.
-- Review this file and run it manually in Supabase SQL Editor as a database owner.
-- It does not alter event_registrations, events, their triggers, or existing policies.

begin;

create table if not exists public.event_payment_submissions (
  id uuid primary key default gen_random_uuid(),
  registration_id bigint not null
    references public.event_registrations(id) on delete restrict,
  supersedes_payment_id uuid
    references public.event_payment_submissions(id) on delete restrict,
  payment_provider text not null default 'manual'
    check (length(payment_provider) between 1 and 64),
  payment_method text not null
    check (length(payment_method) between 1 and 40),
  transaction_id text not null
    check (length(transaction_id) between 1 and 128),
  sender_phone text
    check (sender_phone is null or length(sender_phone) <= 40),
  payment_note text
    check (payment_note is null or length(payment_note) <= 1000),
  payment_amount numeric not null
    check (payment_amount > 0),
  screenshot_path text not null unique,
  payment_status text not null default 'pending'
    check (payment_status in ('pending', 'approved', 'rejected')),
  rejection_reason text,
  receipt_number text unique,
  reviewed_by uuid references public.profiles(id) on delete restrict,
  reviewed_at timestamptz,
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (
    (payment_status = 'pending'
      and rejection_reason is null
      and receipt_number is null
      and reviewed_by is null
      and reviewed_at is null)
    or
    (payment_status = 'approved'
      and rejection_reason is null
      and receipt_number is not null
      and reviewed_by is not null
      and reviewed_at is not null)
    or
    (payment_status = 'rejected'
      and rejection_reason is not null
      and length(trim(rejection_reason)) > 0
      and receipt_number is null
      and reviewed_by is not null
      and reviewed_at is not null)
  )
);

create index if not exists idx_event_payment_submissions_registration
  on public.event_payment_submissions (registration_id, submitted_at desc);
create index if not exists idx_event_payment_submissions_status
  on public.event_payment_submissions (payment_status, submitted_at desc);
create unique index if not exists idx_event_payment_one_active_per_registration
  on public.event_payment_submissions (registration_id)
  where payment_status in ('pending', 'approved');
create unique index if not exists idx_event_payment_one_active_transaction
  on public.event_payment_submissions (payment_method, lower(transaction_id))
  where payment_status in ('pending', 'approved');

alter table public.event_payment_submissions enable row level security;

create or replace function public.evently_payment_is_super_admin()
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

revoke all on function public.evently_payment_is_super_admin() from public, anon;
grant execute on function public.evently_payment_is_super_admin() to authenticated;

drop policy if exists event_payment_submissions_read_owner_or_admin
  on public.event_payment_submissions;
create policy event_payment_submissions_read_owner_or_admin
  on public.event_payment_submissions
  for select
  to authenticated
  using (
    public.evently_payment_is_super_admin()
    or exists (
      select 1
      from public.event_registrations as r
      where r.id = event_payment_submissions.registration_id
        and r.user_id = auth.uid()
    )
  );

revoke all on table public.event_payment_submissions from public, anon, authenticated;
grant select on table public.event_payment_submissions to authenticated;

create sequence if not exists public.evently_payment_receipt_seq;

create or replace function public.submit_event_payment(
  p_registration_id bigint,
  p_payment_method text,
  p_transaction_id text,
  p_screenshot_path text,
  p_sender_phone text default null,
  p_payment_note text default null
)
returns public.event_payment_submissions
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_registration public.event_registrations%rowtype;
  v_event_status text;
  v_submission public.event_payment_submissions%rowtype;
  v_method text := lower(trim(coalesce(p_payment_method, '')));
  v_transaction_id text := trim(coalesce(p_transaction_id, ''));
  v_screenshot_path text := trim(coalesce(p_screenshot_path, ''));
  v_sender_phone text := nullif(trim(coalesce(p_sender_phone, '')), '');
  v_payment_note text := nullif(trim(coalesce(p_payment_note, '')), '');
  v_supersedes_id uuid;
begin
  if v_user_id is null then
    raise exception 'Sign in to submit payment.' using errcode = '28000';
  end if;
  if v_method !~ '^[a-z][a-z0-9_-]{1,39}$' then
    raise exception 'Choose a valid payment method.' using errcode = '22023';
  end if;
  if length(v_transaction_id) < 1 or length(v_transaction_id) > 128 then
    raise exception 'Enter a valid transaction ID.' using errcode = '22023';
  end if;
  if v_sender_phone is not null and length(v_sender_phone) > 40 then
    raise exception 'Sender phone number is too long.' using errcode = '22023';
  end if;
  if v_payment_note is not null and length(v_payment_note) > 1000 then
    raise exception 'Payment note is too long.' using errcode = '22023';
  end if;
  if split_part(v_screenshot_path, '/', 1) <> v_user_id::text
    or split_part(v_screenshot_path, '/', 2) <> p_registration_id::text
    or split_part(v_screenshot_path, '/', 3) = ''
    or split_part(v_screenshot_path, '/', 4) <> '' then
    raise exception 'The payment screenshot path is invalid.' using errcode = '22023';
  end if;

  select r, e.status::text
    into v_registration, v_event_status
    from public.event_registrations as r
    join public.events as e on e.id = r.event_id
    where r.id = p_registration_id
      and r.user_id = v_user_id
    for update of r, e;

  if not found then
    raise exception 'Registration not found.' using errcode = 'P0002';
  end if;
  if v_registration.registration_status <> 'registered' then
    raise exception 'Payment can only be submitted for an active registration.' using errcode = '22023';
  end if;
  if v_event_status in ('cancelled', 'completed') then
    raise exception 'Payment is unavailable for cancelled or completed events.' using errcode = '22023';
  end if;
  if v_registration.fee_amount <= 0 then
    raise exception 'This registration does not require payment.' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from storage.objects as o
    where o.bucket_id = 'evently-payment-proofs'
      and o.name = v_screenshot_path
  ) then
    raise exception 'Upload the payment screenshot before submitting.' using errcode = '22023';
  end if;
  if exists (
    select 1
    from public.event_payment_submissions as p
    where p.registration_id = p_registration_id
      and p.payment_status in ('pending', 'approved')
  ) then
    raise exception 'An active payment submission already exists for this registration.' using errcode = '23505';
  end if;
  if exists (
    select 1
    from public.event_payment_submissions as p
    where p.payment_method = v_method
      and lower(p.transaction_id) = lower(v_transaction_id)
      and p.registration_id <> p_registration_id
  ) then
    raise exception 'This transaction ID has already been submitted for another registration.' using errcode = '23505';
  end if;

  select p.id
    into v_supersedes_id
    from public.event_payment_submissions as p
    where p.registration_id = p_registration_id
      and p.payment_status = 'rejected'
    order by p.submitted_at desc, p.id desc
    limit 1;

  insert into public.event_payment_submissions (
    registration_id,
    supersedes_payment_id,
    payment_provider,
    payment_method,
    transaction_id,
    sender_phone,
    payment_note,
    payment_amount,
    screenshot_path
  )
  values (
    p_registration_id,
    v_supersedes_id,
    'manual',
    v_method,
    v_transaction_id,
    v_sender_phone,
    v_payment_note,
    v_registration.fee_amount,
    v_screenshot_path
  )
  returning * into v_submission;

  return v_submission;
exception
  when unique_violation then
    raise exception 'An active payment submission or transaction ID already exists.'
      using errcode = '23505';
end;
$function$;

revoke all on function public.submit_event_payment(bigint, text, text, text, text, text)
  from public, anon;
grant execute on function public.submit_event_payment(bigint, text, text, text, text, text)
  to authenticated;

create or replace function public.review_event_payment(
  p_payment_id uuid,
  p_decision text,
  p_rejection_reason text default null
)
returns public.event_payment_submissions
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_payment public.event_payment_submissions%rowtype;
  v_now timestamptz := clock_timestamp();
  v_sequence_value text;
  v_receipt_number text;
  v_reason text := nullif(trim(coalesce(p_rejection_reason, '')), '');
begin
  if auth.uid() is null or not public.evently_payment_is_super_admin() then
    raise exception 'Only a super admin can review payments.' using errcode = '42501';
  end if;
  if p_decision is null or p_decision not in ('approved', 'rejected') then
    raise exception 'Choose approved or rejected.' using errcode = '22023';
  end if;
  if p_decision = 'rejected' and (v_reason is null or length(v_reason) > 1000) then
    raise exception 'A rejection reason of 1,000 characters or fewer is required.' using errcode = '22023';
  end if;
  if p_decision = 'approved' and v_reason is not null then
    raise exception 'A rejection reason is not accepted for an approval.' using errcode = '22023';
  end if;

  select p.*
    into v_payment
    from public.event_payment_submissions as p
    where p.id = p_payment_id
    for update;

  if not found then
    raise exception 'Payment submission not found.' using errcode = 'P0002';
  end if;
  if v_payment.payment_status <> 'pending' then
    raise exception 'Only pending payments can be reviewed.' using errcode = '22023';
  end if;

  if p_decision = 'approved' then
    v_sequence_value := pg_catalog.nextval('public.evently_payment_receipt_seq'::regclass)::text;
    if length(v_sequence_value) < 8 then
      v_sequence_value := pg_catalog.lpad(v_sequence_value, 8, '0');
    end if;
    v_receipt_number := 'EVT-' || pg_catalog.to_char(v_now at time zone 'UTC', 'YYYYMMDD')
      || '-' || v_sequence_value;

    update public.event_payment_submissions
      set payment_status = 'approved',
          receipt_number = v_receipt_number,
          reviewed_by = auth.uid(),
          reviewed_at = v_now
      where id = p_payment_id
      returning * into v_payment;
  else
    update public.event_payment_submissions
      set payment_status = 'rejected',
          rejection_reason = v_reason,
          reviewed_by = auth.uid(),
          reviewed_at = v_now
      where id = p_payment_id
      returning * into v_payment;
  end if;

  return v_payment;
end;
$function$;

revoke all on function public.review_event_payment(uuid, text, text) from public, anon;
grant execute on function public.review_event_payment(uuid, text, text) to authenticated;

create or replace function public.get_admin_payment_summary()
returns table (
  total_submissions bigint,
  pending_count bigint,
  approved_count bigint,
  rejected_count bigint,
  approved_amount numeric
)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null or not public.evently_payment_is_super_admin() then
    raise exception 'Only a super admin can view payment summaries.' using errcode = '42501';
  end if;

  return query
    select
      count(*)::bigint,
      count(*) filter (where p.payment_status = 'pending')::bigint,
      count(*) filter (where p.payment_status = 'approved')::bigint,
      count(*) filter (where p.payment_status = 'rejected')::bigint,
      coalesce(sum(p.payment_amount) filter (where p.payment_status = 'approved'), 0)::numeric
    from public.event_payment_submissions as p;
end;
$function$;

revoke all on function public.get_admin_payment_summary() from public, anon;
grant execute on function public.get_admin_payment_summary() to authenticated;

create or replace function public.get_my_payment_context(p_registration_id bigint)
returns table (
  registration_id bigint,
  event_id bigint,
  registration_status text,
  participant_name text,
  email text,
  phone text,
  participant_type text,
  fee_amount numeric,
  registered_at timestamptz,
  event_title text,
  event_slug text,
  event_status text,
  event_start timestamptz,
  registration_deadline timestamptz,
  venue text,
  institution_name text,
  department_name text,
  payment_id uuid,
  payment_status text,
  payment_method text,
  transaction_id text,
  sender_phone text,
  payment_note text,
  payment_amount numeric,
  screenshot_path text,
  submitted_at timestamptz,
  rejection_reason text,
  receipt_number text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  reviewer_name text
)
language sql
stable
security definer
set search_path = ''
as $function$
  select
    r.id,
    r.event_id,
    r.registration_status,
    r.full_name,
    r.email,
    r.phone,
    r.participant_type,
    r.fee_amount,
    r.registered_at,
    e.title,
    e.slug,
    e.status::text,
    e.event_start,
    e.registration_deadline,
    e.venue,
    i.name,
    d.name,
    p.id,
    p.payment_status,
    p.payment_method,
    p.transaction_id,
    p.sender_phone,
    p.payment_note,
    p.payment_amount,
    p.screenshot_path,
    p.submitted_at,
    p.rejection_reason,
    p.receipt_number,
    p.reviewed_by,
    p.reviewed_at,
    reviewer.full_name
  from public.event_registrations as r
  join public.events as e on e.id = r.event_id
  left join public.institutions as i on i.id = r.institution_id
  left join public.departments as d on d.id = r.department_id
  left join lateral (
    select ps.*
    from public.event_payment_submissions as ps
    where ps.registration_id = r.id
    order by ps.submitted_at desc, ps.id desc
    limit 1
  ) as p on true
  left join public.profiles as reviewer on reviewer.id = p.reviewed_by
  where r.id = p_registration_id
    and r.user_id = auth.uid();
$function$;

revoke all on function public.get_my_payment_context(bigint) from public, anon;
grant execute on function public.get_my_payment_context(bigint) to authenticated;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'evently-payment-proofs',
  'evently-payment-proofs',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do nothing;

do $bucket_check$
begin
  if not exists (
    select 1
    from storage.buckets as b
    where b.id = 'evently-payment-proofs'
      and b.name = 'evently-payment-proofs'
      and b.public = false
      and b.file_size_limit = 5242880
      and b.allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']::text[]
  ) then
    raise exception 'The evently-payment-proofs bucket is missing or has incompatible settings. Inspect it before rerunning this migration.';
  end if;
end;
$bucket_check$;

drop policy if exists evently_payment_proofs_read_owner_or_admin
  on storage.objects;
create policy evently_payment_proofs_read_owner_or_admin
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'evently-payment-proofs'
    and (
      public.evently_payment_is_super_admin()
      or exists (
        select 1
        from public.event_payment_submissions as p
        join public.event_registrations as r on r.id = p.registration_id
        where p.screenshot_path = storage.objects.name
          and r.user_id = auth.uid()
      )
    )
  );

drop policy if exists evently_payment_proofs_upload_owner
  on storage.objects;
create policy evently_payment_proofs_upload_owner
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'evently-payment-proofs'
    and split_part(name, '/', 1) = auth.uid()::text
    and split_part(name, '/', 2) ~ '^[0-9]+$'
    and split_part(name, '/', 3) <> ''
    and split_part(name, '/', 4) = ''
    and exists (
      select 1
      from public.event_registrations as r
      where r.id::text = split_part(name, '/', 2)
        and r.user_id = auth.uid()
        and r.registration_status = 'registered'
        and r.fee_amount > 0
    )
    and not exists (
      select 1
      from public.event_payment_submissions as p
      where p.registration_id::text = split_part(name, '/', 2)
        and p.payment_status in ('pending', 'approved')
    )
  );

drop policy if exists evently_payment_proofs_delete_unlinked_owner
  on storage.objects;
create policy evently_payment_proofs_delete_unlinked_owner
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'evently-payment-proofs'
    and split_part(name, '/', 1) = auth.uid()::text
    and not exists (
      select 1
      from public.event_payment_submissions as p
      where p.screenshot_path = storage.objects.name
    )
  );

commit;
