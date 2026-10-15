-- Library v2: loan rules, scan-to-issue, reservations, fines into the day book (step 30).
begin;

create or replace function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'email', 'x@test.dev')::text, true);
  execute 'set local role authenticated';
end $$;
create or replace function pg_temp.act_admin() returns void language plpgsql as $$
begin execute 'reset role'; perform set_config('request.jwt.claims', '{}', true); end $$;
create or replace function pg_temp.check(ok boolean, msg text) returns void language plpgsql as $$
begin if not coalesce(ok, false) then raise exception 'FAIL: %', msg; end if; raise notice 'ok  %', msg; end $$;

insert into auth.users (id, email) values
  ('e1e1e1e1-0000-0000-0000-000000000001', 'lb-owner@test.dev'), ('e1e1e1e1-0000-0000-0000-000000000002', 'lb-principal@test.dev'),
  ('e1e1e1e1-0000-0000-0000-000000000003', 'lb-teacher@test.dev'), ('e1e1e1e1-0000-0000-0000-000000000004', 'lb-lib@test.dev')
on conflict do nothing;
insert into public.platform_admins (user_id, role) values ('e1e1e1e1-0000-0000-0000-000000000001', 'owner') on conflict (user_id) do update set role = excluded.role;

do $$
declare ow uuid := 'e1e1e1e1-0000-0000-0000-000000000001'; pr uuid := 'e1e1e1e1-0000-0000-0000-000000000002'; te uuid := 'e1e1e1e1-0000-0000-0000-000000000003'; lb uuid := 'e1e1e1e1-0000-0000-0000-000000000004';
  a uuid; cls uuid; s1 uuid; s2 uuid; w1 uuid; b1 uuid; b2 uuid; b3 uuid; b4 uuid; j jsonb; i1 uuid; i2 uuid; code1 text; d date := public.today_ist(); rw record; n int;
  sfx text := substr(md5(random()::text), 1, 6);
begin
  perform pg_temp.act_as(ow);
  a := public.create_school('LB A', 'lba-' || sfx);
  perform pg_temp.act_admin();
  insert into public.school_members (school_id, user_id, name) values (a, pr, 'Principal'), (a, te, 'Teacher'), (a, lb, 'Librarian');
  insert into public.member_roles (school_id, user_id, role_id)
    select a, x.u, r.id from (values (pr, 'principal'), (te, 'class_teacher'), (lb, 'librarian')) x(u, c) join public.roles r on r.school_id = a and r.code = x.c;
  select id into cls from public.classes where school_id = a and name = '5';
  insert into public.students (school_id, admission_no, first_name, last_name, class_id) values (a, 'L1', 'Aarav', 'Sharma', cls) returning id into s1;
  insert into public.students (school_id, admission_no, first_name, last_name, class_id) values (a, 'L2', 'Diya', 'Verma', cls) returning id into s2;
  insert into public.staff (school_id, emp_code, name, designation) values (a, 'E77', 'Meena Rao', 'Teacher') returning id into w1;
  select att_code into code1 from public.students where id = s1;
  insert into public.library_books (school_id, accession_no, title, author, category, copies, price) values (a, 'B1', 'Wings of Fire', 'Kalam', 'Biography', 1, 250) returning id into b1;
  insert into public.library_books (school_id, accession_no, title, author, category, copies, price) values (a, 'B2', 'Panchatantra', 'Vishnu Sharma', 'Folk', 2, 100) returning id into b2;
  insert into public.library_books (school_id, accession_no, title, copies) values (a, 'B3', 'Atlas', 1) returning id into b3;
  insert into public.library_books (school_id, accession_no, title, copies) values (a, 'B4', 'Dictionary', 1) returning id into b4;

  -- teachers cannot circulate; the librarian can
  perform pg_temp.act_as(te);
  begin perform public.library_issue(a, b1, 'L1'); perform pg_temp.check(false, 'teacher');
  exception when others then perform pg_temp.check(sqlerrm like '%not allowed%', 'a class teacher cannot issue library books'); end;
  perform pg_temp.act_as(lb);
  insert into public.library_settings (school_id, max_books_student, fine_per_day, grace_days, max_renewals) values (a, 2, 2, 1, 1);

  j := public.library_issue(a, b1, code1);           -- the QR code of the student's card
  perform pg_temp.check(j ->> 'member' = 'Aarav Sharma' and (j ->> 'due_on')::date = d + 14, 'issuing by the card QR works and uses the loan days (14)');
  j := public.library_issue(a, b2, 'L1');            -- admission number
  begin perform public.library_issue(a, b3, 'L1'); perform pg_temp.check(false, 'limit');
  exception when others then perform pg_temp.check(sqlerrm like '%limit%', 'the book limit per student is enforced'); end;
  begin perform public.library_issue(a, b1, 'L2'); perform pg_temp.check(false, 'nocopy');
  exception when others then perform pg_temp.check(sqlerrm like '%No copy is free%' or sqlerrm like '%already%', 'a title with no free copy cannot be issued'); end;
  j := public.library_issue(a, b3, 'E77', 30);
  perform pg_temp.check((j ->> 'due_on')::date = d + 30, 'staff can borrow too, with their own loan period');
  begin perform public.library_issue(a, b4, 'nobody'); perform pg_temp.check(false, 'badcode');
  exception when others then perform pg_temp.check(sqlerrm like '%No student or staff%', 'an unknown card code is refused'); end;

  -- overdue blocks further loans, fine = (days late − grace) × rate
  perform pg_temp.act_admin();
  update public.library_issues set issued_on = d - 20, due_on = d - 6 where book_id = b1;
  perform pg_temp.act_as(lb);
  begin perform public.library_issue(a, b4, 'L1'); perform pg_temp.check(false, 'overdue');
  exception when others then perform pg_temp.check(sqlerrm like '%overdue%', 'a member with an overdue book cannot borrow another'); end;
  select * into rw from public.library_issue_list(a, 'overdue') where title = 'Wings of Fire';
  perform pg_temp.check(rw.days_late = 6 and rw.fine_now = 10, 'the list shows 6 days late and a fine of (6 − 1 grace) × 2 = 10');
  select count(*) into n from public.library_issue_list(a, 'out', 'sharma');
  perform pg_temp.check(n = 2, 'search by the borrower finds both loans of the student');

  -- reservation keeps the copy for the waiting member
  perform public.library_reserve(a, b1, 'L2');
  begin perform public.library_renew(a, (select id from public.library_issues where book_id = b1 and returned_on is null)); perform pg_temp.check(false, 'renew reserved');
  exception when others then perform pg_temp.check(sqlerrm like '%reserved%', 'a book someone reserved cannot be renewed'); end;
  i1 := (select id from public.library_issues where book_id = b1 and returned_on is null);
  j := public.library_return(a, i1);
  perform pg_temp.check((j ->> 'fine')::numeric = 10 and (j ->> 'reservation_waiting')::boolean, 'return computes the fine and tells that a reservation is waiting');
  begin perform public.library_issue(a, b1, 'L1'); perform pg_temp.check(false, 'cut line');
  exception when others then perform pg_temp.check(sqlerrm like '%reservation%' or sqlerrm like '%overdue%' or sqlerrm like '%No copy%', 'the reserved copy is not given to someone else'); end;
  perform public.library_issue(a, b1, 'L2');
  perform pg_temp.check((select status = 'fulfilled' from public.library_reservations where book_id = b1 limit 1), 'issuing to the reserving member fulfils the reservation');

  -- a student's fine goes to the fee account (one place to pay); nothing is collected twice
  perform pg_temp.act_admin();
  perform pg_temp.check((select d.amount = 10 and d.student_id = s1 from public.fee_dues d where d.source_key = 'libfine:' || i1), 'a student''s library fine becomes a due on the fee account');
  perform pg_temp.act_as(lb);
  begin perform public.library_collect_fine(a, i1, 'cash'); perform pg_temp.check(false, 'collect student');
  exception when others then perform pg_temp.check(sqlerrm like '%fee account%', 'the librarian is told to collect it at the fee counter'); end;

  -- a staff member has no fee account: the fine is collected at the library and posted to the day book
  perform pg_temp.act_admin();
  update public.library_issues set issued_on = d - 40, due_on = d - 8 where staff_id = w1 and returned_on is null;
  perform pg_temp.act_as(lb);
  i2 := (select id from public.library_issues where staff_id = w1 and returned_on is null);
  perform public.library_return(a, i2);
  perform public.library_collect_fine(a, i2, 'cash');
  perform pg_temp.act_admin();
  perform pg_temp.check((select count(*) from public.vouchers where school_id = a and narration like 'Library fine%' and status = 'posted') = 1, 'a staff fine collected at the library becomes a posted receipt voucher');
  perform pg_temp.act_as(lb);
  begin perform public.library_collect_fine(a, i2, 'cash'); perform pg_temp.check(false, 'twice');
  exception when others then perform pg_temp.check(sqlerrm like '%no fine to collect%', 'a fine cannot be collected twice'); end;
  -- lost book charges its price and removes a copy
  i2 := (select id from public.library_issues where book_id = b2 and returned_on is null);
  j := public.library_return(a, i2, true);
  perform pg_temp.check((j ->> 'fine')::numeric >= 100 and (select copies = 1 from public.library_books where id = b2), 'a lost book charges its price and reduces the copies');

  j := public.library_dashboard(a);
  perform pg_temp.check((j ->> 'titles')::int = 4 and (j ->> 'out')::int >= 1 and jsonb_array_length(j -> 'per_month') = 6, 'the dashboard reports titles, books out and six months of issues');
end $$;

rollback;
