-- ═══════════════════════════════════════════════════════════════════════════
-- Step 30: Library, the modern way — loan rules (days, limits, fine per day, renewals), reservations, issue by scanning the member's
--          card (QR / admission no. / employee code), lost books, fine collection into the day book, paged lists and a dashboard.
-- Safe to run again.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.library_settings (
  school_id         uuid primary key references public.schools(id) on delete cascade,
  loan_days_student int not null default 14 check (loan_days_student between 1 and 90),
  loan_days_staff   int not null default 30 check (loan_days_staff between 1 and 180),
  max_books_student int not null default 3 check (max_books_student between 1 and 20),
  max_books_staff   int not null default 5 check (max_books_staff between 1 and 40),
  fine_per_day      numeric(6,2) not null default 1 check (fine_per_day >= 0),
  grace_days        int not null default 0 check (grace_days between 0 and 14),
  max_renewals      int not null default 2 check (max_renewals between 0 and 10),
  renew_days        int not null default 7 check (renew_days between 1 and 60),
  block_when_overdue boolean not null default true
);
alter table public.library_settings enable row level security;
drop policy if exists "read" on public.library_settings;
create policy "read" on public.library_settings for select to authenticated using (public.has_perm(school_id, 'library.circulation.view') or public.has_perm(school_id, 'library.catalogue.view'));
drop policy if exists "write" on public.library_settings;
create policy "write" on public.library_settings for all to authenticated
  using (public.has_perm_school(school_id, 'library.catalogue.edit')) with check (public.has_perm_school(school_id, 'library.catalogue.edit'));

alter table public.library_issues add column if not exists renewals int not null default 0;
alter table public.library_issues add column if not exists lost boolean not null default false;
alter table public.library_issues add column if not exists fine_paid_on date;
alter table public.library_issues add column if not exists fine_waived boolean not null default false;
alter table public.library_issues add column if not exists returned_by_name text;
alter table public.library_books add column if not exists active boolean not null default true;
alter table public.library_books add column if not exists tags text;

create table if not exists public.library_reservations (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references public.schools(id) on delete cascade,
  book_id     uuid not null references public.library_books(id) on delete cascade,
  student_id  uuid references public.students(id) on delete cascade,
  staff_id    uuid references public.staff(id) on delete cascade,
  status      text not null default 'active' check (status in ('active', 'fulfilled', 'cancelled')),
  created_at  timestamptz not null default now(),
  notified_at timestamptz,
  check (num_nonnulls(student_id, staff_id) = 1)
);
create index if not exists library_reservations_idx on public.library_reservations (school_id, book_id, status);
alter table public.library_reservations enable row level security;
drop policy if exists "read" on public.library_reservations;
create policy "read" on public.library_reservations for select to authenticated using (public.has_perm_school(school_id, 'library.circulation.view'));

-- ───────────── helpers ─────────────
create or replace function public._library_cfg(sid uuid) returns public.library_settings
language plpgsql stable security definer set search_path = public as $$
declare c public.library_settings;
begin
  select * into c from public.library_settings where school_id = sid;
  if c.school_id is null then c.school_id := sid; c.loan_days_student := 14; c.loan_days_staff := 30; c.max_books_student := 3; c.max_books_staff := 5; c.fine_per_day := 1;
    c.grace_days := 0; c.max_renewals := 2; c.renew_days := 7; c.block_when_overdue := true; end if;
  return c;
end $$;
revoke execute on function public._library_cfg(uuid) from public, anon, authenticated;

-- fine of an open loan if returned on p_on
create or replace function public._library_fine(sid uuid, p_due date, p_on date) returns numeric
language plpgsql stable security definer set search_path = public as $$
declare c public.library_settings := public._library_cfg(sid); late int := greatest(p_on - p_due - c.grace_days, 0);
begin
  return round(late * c.fine_per_day, 2);
end $$;
revoke execute on function public._library_fine(uuid, date, date) from public, anon, authenticated;

-- ───────────── issue ─────────────
-- p_code: the member's card QR, admission number or employee code (same codes as attendance)
create or replace function public.library_issue(sid uuid, p_book uuid, p_code text, p_days int default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.library_settings := public._library_cfg(sid); f record; b public.library_books; n int; limit_n int; days int; stu uuid; stf uuid; nm text; me text;
        reserved int; mine int; free_copies int; od int; due date; i uuid; st text;
begin
  if auth.uid() is null or not public.has_perm_school(sid, 'library.circulation.create') then raise exception 'not allowed'; end if;
  select * into b from public.library_books where id = p_book and school_id = sid;
  if b.id is null then raise exception 'Book not found.'; end if;
  if not b.active then raise exception 'This book is withdrawn from circulation.'; end if;
  select * into f from public._find_subject(sid, p_code);
  if f.id is null then raise exception 'No student or staff member has the code “%”.', left(coalesce(p_code, ''), 30); end if;
  if f.kind = 'student' then
    select s.id, s.status, btrim(concat_ws(' ', s.first_name, s.last_name)) into stu, st, nm from public.students s where s.id = f.id;
    if st <> 'active' then raise exception 'That student is no longer on roll.'; end if;
    limit_n := c.max_books_student; days := coalesce(p_days, c.loan_days_student);
  else
    select w.id, w.status, w.name into stf, st, nm from public.staff w where w.id = f.id;
    if st <> 'active' then raise exception 'That staff member is no longer working here.'; end if;
    limit_n := c.max_books_staff; days := coalesce(p_days, c.loan_days_staff);
  end if;
  if c.block_when_overdue then
    select count(*) into od from public.library_issues where school_id = sid and returned_on is null and due_on < public.today_ist() and student_id is not distinct from stu and staff_id is not distinct from stf;
    if od > 0 then raise exception '% has % overdue book(s). Return them first.', nm, od; end if;
  end if;
  select count(*) into n from public.library_issues where school_id = sid and returned_on is null and student_id is not distinct from stu and staff_id is not distinct from stf;
  if n >= limit_n then raise exception '% already has % book(s) — the limit is %.', nm, n, limit_n; end if;
  if exists (select 1 from public.library_issues where book_id = p_book and returned_on is null and student_id is not distinct from stu and staff_id is not distinct from stf) then
    raise exception '% already has this book.', nm; end if;
  -- copies reserved for others keep their place
  select count(*) filter (where student_id is not distinct from stu and staff_id is not distinct from stf), count(*) into mine, reserved
    from public.library_reservations where book_id = p_book and status = 'active';
  select b.copies - count(*) into free_copies from public.library_issues where book_id = p_book and returned_on is null;
  if free_copies - (reserved - mine) < 1 then raise exception 'No copy is free: % reservation(s) are waiting for this title.', reserved - mine; end if;
  days := least(greatest(days, 1), 180);
  due := public.today_ist() + days;
  select name into me from public.school_members where school_id = sid and user_id = auth.uid();
  insert into public.library_issues (school_id, book_id, student_id, staff_id, issued_on, due_on, issued_by_name)
  values (sid, p_book, stu, stf, public.today_ist(), due, coalesce(me, 'User')) returning id into i;
  update public.library_reservations set status = 'fulfilled' where book_id = p_book and status = 'active' and student_id is not distinct from stu and staff_id is not distinct from stf;
  return jsonb_build_object('id', i, 'member', nm, 'book', b.title, 'due_on', due);
end $$;

-- ───────────── return (normal, lost) ─────────────
create or replace function public.library_return(sid uuid, p_issue uuid, p_lost boolean default false, p_fine numeric default null, p_waive boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare it public.library_issues; b public.library_books; v_fine numeric; me text; next_res uuid;
begin
  if auth.uid() is null or not public.has_perm_school(sid, 'library.circulation.edit') then raise exception 'not allowed'; end if;
  select * into it from public.library_issues where id = p_issue and school_id = sid;
  if it.id is null then raise exception 'Issue record not found.'; end if;
  if it.returned_on is not null then raise exception 'This book was already returned.'; end if;
  select * into b from public.library_books where id = it.book_id;
  v_fine := coalesce(p_fine, public._library_fine(sid, it.due_on, public.today_ist()));
  if p_lost then v_fine := v_fine + coalesce(b.price, 0); end if;
  if p_waive then v_fine := 0; end if;
  if v_fine < 0 then raise exception 'The fine cannot be negative.'; end if;
  select name into me from public.school_members where school_id = sid and user_id = auth.uid();
  update public.library_issues set returned_on = public.today_ist(), fine = v_fine, lost = p_lost, fine_waived = p_waive, returned_by_name = coalesce(me, 'User') where id = p_issue;
  if p_lost then update public.library_books set copies = greatest(copies - 1, 0) where id = it.book_id; end if;
  select id into next_res from public.library_reservations where book_id = it.book_id and status = 'active' and notified_at is null order by created_at limit 1;
  if next_res is not null and not p_lost then update public.library_reservations set notified_at = now() where id = next_res; end if;
  return jsonb_build_object('fine', v_fine, 'lost', p_lost, 'reservation_waiting', next_res is not null);
end $$;

create or replace function public.library_renew(sid uuid, p_issue uuid) returns date
language plpgsql security definer set search_path = public as $$
declare c public.library_settings := public._library_cfg(sid); it public.library_issues; nxt date;
begin
  if auth.uid() is null or not public.has_perm_school(sid, 'library.circulation.edit') then raise exception 'not allowed'; end if;
  select * into it from public.library_issues where id = p_issue and school_id = sid;
  if it.id is null or it.returned_on is not null then raise exception 'This book is not out.'; end if;
  if it.renewals >= c.max_renewals then raise exception 'It was already renewed % time(s) — the limit.', it.renewals; end if;
  if exists (select 1 from public.library_reservations where book_id = it.book_id and status = 'active' and (student_id is distinct from it.student_id or staff_id is distinct from it.staff_id)) then
    raise exception 'Another member has reserved this book, so it cannot be renewed.'; end if;
  nxt := greatest(it.due_on, public.today_ist()) + c.renew_days;
  update public.library_issues set due_on = nxt, renewals = renewals + 1 where id = p_issue;
  return nxt;
end $$;

-- ───────────── reservations ─────────────
create or replace function public.library_reserve(sid uuid, p_book uuid, p_code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare f record; i uuid;
begin
  if auth.uid() is null or not public.has_perm_school(sid, 'library.circulation.create') then raise exception 'not allowed'; end if;
  if not exists (select 1 from public.library_books where id = p_book and school_id = sid and active) then raise exception 'Book not found.'; end if;
  select * into f from public._find_subject(sid, p_code);
  if f.id is null then raise exception 'No student or staff member has that code.'; end if;
  if exists (select 1 from public.library_reservations where book_id = p_book and status = 'active' and ((f.kind = 'student' and student_id = f.id) or (f.kind = 'staff' and staff_id = f.id))) then
    raise exception 'Already reserved for this member.'; end if;
  insert into public.library_reservations (school_id, book_id, student_id, staff_id)
  values (sid, p_book, case when f.kind = 'student' then f.id end, case when f.kind = 'staff' then f.id end) returning id into i;
  return i;
end $$;

create or replace function public.library_cancel_reservation(sid uuid, p_res uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.has_perm_school(sid, 'library.circulation.edit') then raise exception 'not allowed'; end if;
  update public.library_reservations set status = 'cancelled' where id = p_res and school_id = sid and status = 'active';
end $$;

-- ───────────── fine collected → day book ─────────────
create or replace function public.library_collect_fine(sid uuid, p_issue uuid, p_mode text default 'cash') returns void
language plpgsql security definer set search_path = public as $$
declare it public.library_issues; head uuid; bk uuid; n int; me text; nm text; ttl text;
begin
  if auth.uid() is null or not public.has_perm_school(sid, 'library.circulation.edit') then raise exception 'not allowed'; end if;
  select * into it from public.library_issues where id = p_issue and school_id = sid;
  if it.id is null or it.returned_on is null then raise exception 'Return the book first.'; end if;
  if it.fine <= 0 or it.fine_paid_on is not null then raise exception 'There is no fine to collect.'; end if;
  perform public._account_defaults(sid);
  select id into head from public.account_heads where school_id = sid and kind = 'income' and lower(name) = 'library fines';
  if head is null then insert into public.account_heads (school_id, name, kind) values (sid, 'Library fines', 'income') returning id into head; end if;
  select id into bk from public.account_books where school_id = sid and active order by (kind = 'cash') desc, created_at limit 1;
  update public.account_settings set next_no = next_no + 1 where school_id = sid returning next_no - 1 into n;
  select name into me from public.school_members where school_id = sid and user_id = auth.uid();
  select coalesce((select btrim(concat_ws(' ', first_name, last_name)) from public.students where id = it.student_id), (select name from public.staff where id = it.staff_id)) into nm;
  select title into ttl from public.library_books where id = it.book_id;
  insert into public.vouchers (school_id, no, date, kind, head_id, book_id, amount, party, mode, narration, status, created_by_name)
  values (sid, 'RV-' || lpad(n::text, 5, '0'), public.today_ist(), 'receipt', head, bk, it.fine, nm, case when p_mode in ('cash', 'upi', 'cheque', 'bank_transfer', 'card') then p_mode else 'cash' end,
          left('Library fine — ' || ttl, 500), 'posted', coalesce(me, 'User'));
  update public.library_issues set fine_paid_on = public.today_ist() where id = p_issue;
end $$;

-- ───────────── lists ─────────────
create or replace function public.library_issue_list(sid uuid, p_state text default 'out', p_q text default null, p_member text default null, p_from date default null, p_to date default null,
                                                     p_limit int default 25, p_offset int default 0)
returns table (id uuid, book_id uuid, title text, accession_no text, author text, member_kind text, member_id uuid, member_name text, member_sub text, phone text,
               issued_on date, due_on date, returned_on date, fine numeric, lost boolean, fine_paid_on date, renewals int, days_late int, fine_now numeric, total bigint)
language sql stable security definer set search_path = public as $$
  select i.id, b.id, b.title, b.accession_no, b.author, case when i.student_id is not null then 'student' else 'staff' end, coalesce(i.student_id, i.staff_id),
         coalesce(btrim(concat_ws(' ', s.first_name, s.last_name)), w.name),
         case when s.id is not null then concat_ws(' · ', s.admission_no, c.name || coalesce('-' || sec.name, '')) else coalesce(w.designation, 'Staff') end,
         coalesce(s.guardian_phone, w.phone), i.issued_on, i.due_on, i.returned_on, i.fine, i.lost, i.fine_paid_on, i.renewals,
         case when i.returned_on is null then greatest(public.today_ist() - i.due_on, 0) else greatest(i.returned_on - i.due_on, 0) end,
         case when i.returned_on is null then public._library_fine(sid, i.due_on, public.today_ist()) else i.fine end, count(*) over ()
    from public.library_issues i
    join public.library_books b on b.id = i.book_id
    left join public.students s on s.id = i.student_id
    left join public.classes c on c.id = s.class_id
    left join public.sections sec on sec.id = s.section_id
    left join public.staff w on w.id = i.staff_id
   where i.school_id = sid and public.has_perm_school(sid, 'library.circulation.view')
     and (p_state = 'all' or (p_state = 'out' and i.returned_on is null) or (p_state = 'overdue' and i.returned_on is null and i.due_on < public.today_ist())
          or (p_state = 'returned' and i.returned_on is not null) or (p_state = 'fines' and i.returned_on is not null and i.fine > 0 and i.fine_paid_on is null))
     and (p_member is null or (p_member = 'student' and i.student_id is not null) or (p_member = 'staff' and i.staff_id is not null))
     and (p_from is null or i.issued_on >= p_from) and (p_to is null or i.issued_on <= p_to)
     and (nullif(btrim(coalesce(p_q, '')), '') is null
          or concat_ws(' ', b.title, b.accession_no, b.author, s.first_name, s.last_name, s.admission_no, w.name) ilike public.like_escape(btrim(p_q)))
   order by case when i.returned_on is null then i.due_on end asc nulls last, i.returned_on desc nulls last
   limit least(greatest(coalesce(p_limit, 25), 1), 200) offset greatest(coalesce(p_offset, 0), 0);
$$;

create or replace function public.library_book_list(sid uuid, p_q text default null, p_category text default null, p_language text default null, p_avail text default null,
                                                    p_limit int default 25, p_offset int default 0)
returns table (id uuid, accession_no text, title text, author text, publisher text, isbn text, category text, language text, shelf text, copies int, price numeric, active boolean,
               out_now bigint, available bigint, reserved bigint, times_issued bigint, total bigint)
language sql stable security definer set search_path = public as $$
  select b.id, b.accession_no, b.title, b.author, b.publisher, b.isbn, b.category, b.language, b.shelf, b.copies, b.price, b.active,
         (select count(*) from public.library_issues i where i.book_id = b.id and i.returned_on is null),
         greatest(b.copies - (select count(*) from public.library_issues i where i.book_id = b.id and i.returned_on is null), 0),
         (select count(*) from public.library_reservations r where r.book_id = b.id and r.status = 'active'),
         (select count(*) from public.library_issues i where i.book_id = b.id), count(*) over ()
    from public.library_books b
   where b.school_id = sid and (public.has_perm(sid, 'library.catalogue.view') or public.has_perm(sid, 'library.circulation.view'))
     and (p_category is null or b.category = p_category) and (p_language is null or b.language = p_language)
     and (p_avail is null or (p_avail = 'yes' and b.active and b.copies > (select count(*) from public.library_issues i where i.book_id = b.id and i.returned_on is null))
          or (p_avail = 'no' and b.copies <= (select count(*) from public.library_issues i where i.book_id = b.id and i.returned_on is null)) or (p_avail = 'withdrawn' and not b.active))
     and (nullif(btrim(coalesce(p_q, '')), '') is null or concat_ws(' ', b.title, b.author, b.accession_no, b.isbn, b.category, b.tags, b.publisher) ilike public.like_escape(btrim(p_q)))
   order by b.title
   limit least(greatest(coalesce(p_limit, 25), 1), 200) offset greatest(coalesce(p_offset, 0), 0);
$$;

-- one query for the dashboard
create or replace function public.library_dashboard(sid uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare d date := public.today_ist();
begin
  if not (public.has_perm_school(sid, 'library.circulation.view') or public.has_perm_school(sid, 'library.catalogue.view')) then raise exception 'not allowed'; end if;
  return jsonb_build_object(
    'titles', (select count(*) from public.library_books where school_id = sid and active),
    'copies', (select coalesce(sum(copies), 0) from public.library_books where school_id = sid and active),
    'out', (select count(*) from public.library_issues where school_id = sid and returned_on is null),
    'overdue', (select count(*) from public.library_issues where school_id = sid and returned_on is null and due_on < d),
    'due_today', (select count(*) from public.library_issues where school_id = sid and returned_on is null and due_on = d),
    'fines_pending', (select coalesce(sum(fine), 0) from public.library_issues where school_id = sid and returned_on is not null and fine > 0 and fine_paid_on is null),
    'fines_collected_30', (select coalesce(sum(fine), 0) from public.library_issues where school_id = sid and fine_paid_on >= d - 30),
    'reservations', (select count(*) from public.library_reservations where school_id = sid and status = 'active'),
    'per_month', coalesce((select jsonb_agg(jsonb_build_object('m', to_char(m, 'Mon'), 'n', n) order by m) from (
        select date_trunc('month', g)::date m, count(i.id) n from generate_series(date_trunc('month', d) - interval '5 months', date_trunc('month', d), interval '1 month') g
          left join public.library_issues i on i.school_id = sid and date_trunc('month', i.issued_on) = date_trunc('month', g) group by 1) x), '[]'::jsonb),
    'top_books', coalesce((select jsonb_agg(jsonb_build_object('title', title, 'n', n)) from (
        select b.title, count(*) n from public.library_issues i join public.library_books b on b.id = i.book_id where i.school_id = sid and i.issued_on >= d - 180
         group by b.title order by n desc limit 5) x), '[]'::jsonb),
    'top_classes', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'n', n)) from (
        select c.name, count(*) n from public.library_issues i join public.students s on s.id = i.student_id join public.classes c on c.id = s.class_id
         where i.school_id = sid and i.issued_on >= d - 180 group by c.name order by n desc limit 5) x), '[]'::jsonb),
    'by_category', coalesce((select jsonb_agg(jsonb_build_object('name', coalesce(category, 'Other'), 'n', n)) from (
        select b.category, count(*) n from public.library_issues i join public.library_books b on b.id = i.book_id where i.school_id = sid and i.issued_on >= d - 180
         group by b.category order by n desc limit 6) x), '[]'::jsonb));
end $$;

do $$
declare t text;
begin
  foreach t in array array['library_settings', 'library_reservations'] loop
    execute format('drop trigger if exists audit_%1$s on public.%1$I', t);
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function public.audit_row()', t);
  end loop;
end $$;
