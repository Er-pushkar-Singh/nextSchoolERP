-- Online exams: question bank, scheduling, secured student side, grading, declaration (step 28).
begin;

create or replace function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'email', 'x@test.dev')::text, true);
  execute 'set local role authenticated';
end $$;
create or replace function pg_temp.act_admin() returns void language plpgsql as $$
begin execute 'reset role'; perform set_config('request.jwt.claims', '{}', true); end $$;
create or replace function pg_temp.act_service() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  execute 'set local role service_role';
end $$;
create or replace function pg_temp.check(ok boolean, msg text) returns void language plpgsql as $$
begin if not coalesce(ok, false) then raise exception 'FAIL: %', msg; end if; raise notice 'ok  %', msg; end $$;

insert into auth.users (id, email) values
  ('b8b8b8b8-0000-0000-0000-000000000001', 'oe-owner@test.dev'), ('b8b8b8b8-0000-0000-0000-000000000002', 'oe-principal@test.dev'),
  ('b8b8b8b8-0000-0000-0000-000000000003', 'oe-teacher@test.dev'), ('b8b8b8b8-0000-0000-0000-000000000004', 'oe-other@test.dev')
on conflict do nothing;
insert into public.platform_admins (user_id, role) values ('b8b8b8b8-0000-0000-0000-000000000001', 'owner') on conflict (user_id) do update set role = excluded.role;

do $$
declare ow uuid := 'b8b8b8b8-0000-0000-0000-000000000001'; pr uuid := 'b8b8b8b8-0000-0000-0000-000000000002'; te uuid := 'b8b8b8b8-0000-0000-0000-000000000003';
  ot uuid := 'b8b8b8b8-0000-0000-0000-000000000004';
  a uuid; b uuid; cls uuid; cls2 uuid; sec uuid; sess uuid; sub uuid; ex_off uuid; oe uuid; oe2 uuid; q1 uuid; q2 uuid; q3 uuid; q4 uuid; s1 uuid; s2 uuid; scode text; tok text; tok2 text;
  j jsonb; qs jsonb; n int; rw record; sfx text := substr(md5(random()::text), 1, 6); k int; opt text;
begin
  perform pg_temp.act_as(ow);
  a := public.create_school('OE A', 'oea-' || sfx);
  b := public.create_school('OE B', 'oeb-' || sfx);
  perform pg_temp.act_admin();
  select sc.code into scode from public.schools sc where sc.id = a;
  insert into public.school_members (school_id, user_id, name) values (a, pr, 'Principal'), (a, te, 'Teacher'), (b, ot, 'Other');
  insert into public.member_roles (school_id, user_id, role_id)
    select a, x.u, r.id from (values (pr, 'principal'), (te, 'subject_teacher')) x(u, c) join public.roles r on r.school_id = a and r.code = x.c;
  insert into public.member_roles (school_id, user_id, role_id) select b, ot, id from public.roles where school_id = b and code = 'principal';
  select id into cls from public.classes where school_id = a and name = '5';
  select id into cls2 from public.classes where school_id = a and name = '6';
  select id into sec from public.sections where class_id = cls order by name limit 1;
  select id into sess from public.sessions where school_id = a and is_current;
  select id into sub from public.subjects where school_id = a order by name limit 1;
  insert into public.staff_assignments (school_id, user_id, section_id, subject_id) values (a, te, sec, sub);
  insert into public.students (school_id, admission_no, first_name, last_name, class_id, section_id, dob) values (a, 'OE1', 'Aarav', 'Sharma', cls, sec, date '2015-05-04') returning id into s1;
  insert into public.students (school_id, admission_no, first_name, last_name, class_id, section_id, dob) values (a, 'OE2', 'Diya', 'Verma', cls, sec, date '2015-08-19') returning id into s2;
  insert into public.exams (school_id, session_id, name) values (a, sess, 'Unit Test') returning id into ex_off;
  insert into public.exam_subjects (school_id, exam_id, class_id, subject_id, max_marks) values (a, ex_off, cls, sub, 20);

  -- question bank: an assigned teacher can add for their class + subject only
  perform pg_temp.act_as(te);
  insert into public.question_bank (school_id, class_id, subject_id, kind, text, options, answer, marks, negative_marks, difficulty, chapter)
  values (a, cls, sub, 'single', '2 + 2 = ?', '[{"id":"a","text":"3"},{"id":"b","text":"4"},{"id":"c","text":"5"}]', '["b"]', 2, 0.5, 'easy', 'Numbers') returning id into q1;
  insert into public.question_bank (school_id, class_id, subject_id, kind, text, options, answer, marks, negative_marks, difficulty, chapter)
  values (a, cls, sub, 'multi', 'Prime numbers?', '[{"id":"a","text":"2"},{"id":"b","text":"4"},{"id":"c","text":"7"}]', '["a","c"]', 3, 1, 'medium', 'Numbers') returning id into q2;
  insert into public.question_bank (school_id, class_id, subject_id, kind, text, options, answer, marks, difficulty, chapter)
  values (a, cls, sub, 'truefalse', 'Zero is even.', '[{"id":"t","text":"True"},{"id":"f","text":"False"}]', '["t"]', 1, 'easy', 'Numbers') returning id into q3;
  insert into public.question_bank (school_id, class_id, subject_id, kind, text, options, answer, marks, difficulty, chapter)
  values (a, cls, sub, 'single', 'Largest?', '[{"id":"a","text":"9"},{"id":"b","text":"99"}]', '["b"]', 2, 'hard', 'Place value') returning id into q4;
  perform pg_temp.check(q1 is not null, 'an assigned teacher adds questions to the bank');
  begin insert into public.question_bank (school_id, class_id, subject_id, text, options, answer) values (a, cls2, sub, 'x', '[]', '[]'); perform pg_temp.check(false, 'other class');
  exception when insufficient_privilege then perform pg_temp.check(true, 'a teacher cannot add questions for a class they do not teach'); end;
  perform pg_temp.act_as(ot);
  perform pg_temp.check((select count(*) from public.question_bank) = 0, 'another school cannot read the bank');

  -- exam: fixed paper of three questions, linked to the offline unit test
  perform pg_temp.act_as(te);
  insert into public.online_exams (school_id, session_id, exam_id, class_id, subject_id, title, duration_min, pool_mode, negative_marking, max_tab_switches, access_code, show_result, show_answers)
  values (a, sess, ex_off, cls, sub, 'Maths quiz', 30, 'fixed', true, 2, 'MATH1', 'after_declare', true) returning id into oe;
  insert into public.online_exam_questions (exam_id, question_id, marks, sort) values (oe, q1, 2, 1), (oe, q2, 3, 2), (oe, q3, 1, 3);
  begin perform public.online_exam_schedule(a, oe, now() + interval '1 hour', now() + interval '30 minutes'); perform pg_temp.check(false, 'bad window');
  exception when others then perform pg_temp.check(sqlerrm like '%end after start%', 'the end must be after the start'); end;
  begin perform public.online_exam_schedule(a, oe, now() - interval '1 minute', now() + interval '10 minutes'); perform pg_temp.check(false, 'short window');
  exception when others then perform pg_temp.check(sqlerrm like '%shorter than the exam duration%', 'the window must fit the duration'); end;
  perform public.online_exam_schedule(a, oe, now() - interval '1 minute', now() + interval '2 hours');
  perform pg_temp.check((select status = 'scheduled' and total_marks = 6 from public.online_exams where id = oe), 'scheduling sets the total marks (2 + 3 + 1)');
  -- a random-draw exam asking for more questions than exist is refused
  insert into public.online_exams (school_id, session_id, class_id, subject_id, title, duration_min, pool_mode, random_count, pool_filter)
  values (a, sess, cls, sub, 'Random quiz', 20, 'random', 10, '{"chapter":"Numbers"}') returning id into oe2;
  begin perform public.online_exam_schedule(a, oe2, now(), now() + interval '1 hour'); perform pg_temp.check(false, 'pool');
  exception when others then perform pg_temp.check(sqlerrm like '%match the pool%', 'a random exam needs enough questions in the pool'); end;
  update public.online_exams set random_count = 2 where id = oe2;
  perform public.online_exam_schedule(a, oe2, now(), now() + interval '1 hour');
  perform pg_temp.check((select count(*) from public.question_pool_size(a, cls, sub, 'Numbers', null)) = 1 and public.question_pool_size(a, cls, sub, 'Numbers', null) = 3, 'pool size counts matching questions');

  -- student side
  perform pg_temp.act_as(pr);
  begin perform public.exam_login(scode, 'OE1', date '2015-05-04', '1.1.1.1'); perform pg_temp.check(false, 'user login');
  exception when others then perform pg_temp.check(sqlerrm like '%not allowed%' or sqlerrm like '%permission denied%', 'a signed-in staff user cannot use the student endpoints'); end;
  perform pg_temp.act_service();
  perform pg_temp.check((public.exam_login(scode, 'OE1', date '2000-01-01', '1.1.1.1') ->> 'error') like '%not correct%', 'a wrong date of birth is refused');
  for k in 1..8 loop
    perform public.exam_login(scode, 'OE1', date '2000-01-01', '2.2.2.2');
  end loop;
  perform pg_temp.check((public.exam_login(scode, 'OE1', date '2015-05-04', '3.3.3.3') ->> 'error') like '%Too many%', 'repeated wrong attempts lock the admission number for a while');
  -- (other student is unaffected)
  j := public.exam_login(scode, 'oe2', date '2015-08-19', '4.4.4.4');
  tok2 := j ->> 'token';
  perform pg_temp.check(tok2 is not null and (select token_hash <> tok2 from public.exam_sessions limit 1), 'login works (admission no. is not case-sensitive) and only a hash of the token is stored');
  -- unlock s1 by clearing the failures (test housekeeping), then log in
  perform pg_temp.act_admin(); delete from public.exam_login_failures; perform pg_temp.act_service();
  j := public.exam_login(scode, 'OE1', date '2015-05-04', '1.1.1.1');
  tok := j ->> 'token';
  j := public.exam_login(scode, 'OE1', date '2015-05-04', '1.1.1.9');
  begin perform public.exam_portal(tok); perform pg_temp.check(false, 'old session');
  exception when others then perform pg_temp.check(sqlerrm like '%session has ended%', 'signing in again ends the previous device session'); end;
  tok := j ->> 'token';

  j := public.exam_portal(tok);
  perform pg_temp.check(jsonb_array_length(j -> 'exams') = 2 and (j -> 'exams' -> 0 ->> 'state') = 'open', 'the portal lists the class exams as open');
  begin perform public.exam_start(tok, oe, 'WRONG', '1.1.1.9', 'ua'); perform pg_temp.check(false, 'code');
  exception when others then perform pg_temp.check(sqlerrm like '%code is not correct%', 'a wrong exam code is refused'); end;
  j := public.exam_start(tok, oe, 'math1', '1.1.1.9', 'ua');
  qs := j -> 'questions';
  perform pg_temp.check(jsonb_array_length(qs) = 3 and (j ->> 'remaining_s')::int between 1700 and 1801, 'the paper has 3 questions and the server clock runs 30 minutes');
  perform pg_temp.check(position('answer' in qs::text) = 0 and position('"key"' in j::text) = 0, 'correct answers are never sent to the student');
  -- answer: Q1 correct (b), Q2 only one of two (a) → wrong with negative marks, Q3 left blank
  perform public.exam_answer(tok, oe, q1, '["b"]');
  perform public.exam_answer(tok, oe, q2, '["a"]');
  begin perform public.exam_answer(tok, oe, q4, '["a"]'); perform pg_temp.check(false, 'foreign q');
  exception when others then perform pg_temp.check(sqlerrm like '%Unknown question%', 'a question that is not on the paper is refused'); end;
  perform public.exam_answer(tok, oe, q1, '["zzz"]');
  perform pg_temp.check((select answers ->> (q1::text) from public.online_attempts where exam_id = oe and student_id = s1) = '[]', 'invalid option ids are dropped');
  perform public.exam_answer(tok, oe, q1, '["b"]');
  j := public.exam_event(tok, oe, 'tab_hidden', 'x');
  perform pg_temp.check((j ->> 'tab_switches')::int = 1 and not (j ->> 'terminated')::boolean, 'a tab switch is counted');
  j := public.exam_start(tok, oe, 'math1', '1.1.1.9', 'ua');
  perform pg_temp.check((j -> 'answers' ->> (q1::text)) = '["b"]', 'starting again resumes with the saved answers');

  j := public.exam_submit(tok, oe);
  perform pg_temp.check((j ->> 'submitted')::boolean and not (j ->> 'shown')::boolean and j -> 'score' = 'null'::jsonb, 'after submitting the score stays hidden until the result is declared');
  select * into rw from public.online_attempts where exam_id = oe and student_id = s1;
  perform pg_temp.check(rw.score = 1 and rw.correct = 1 and rw.wrong = 1 and rw.skipped = 1 and rw.max_score = 6, 'graded: +2 correct, −1 wrong (multi-answer), blank skipped = 1 of 6');
  begin perform public.exam_start(tok, oe, 'math1', '1.1.1.9', 'ua'); perform pg_temp.check(false, 'retake');
  exception when others then perform pg_temp.check(sqlerrm like '%already taken%', 'a second attempt is refused'); end;
  begin perform public.exam_answer(tok, oe, q1, '["a"]'); perform pg_temp.check(false, 'late');
  exception when others then perform pg_temp.check(sqlerrm like '%already submitted%', 'answers after submission are refused'); end;

  -- second student: too many tab switches ends the attempt
  j := public.exam_start(tok2, oe, 'MATH1', '4.4.4.4', 'ua');
  perform public.exam_event(tok2, oe, 'tab_hidden'); perform public.exam_event(tok2, oe, 'window_blur');
  j := public.exam_event(tok2, oe, 'fullscreen_exit');
  perform pg_temp.check((j ->> 'terminated')::boolean, 'exceeding the tab-switch limit ends the attempt');
  perform pg_temp.check((select status = 'terminated' from public.online_attempts where exam_id = oe and student_id = s2), 'the attempt is marked terminated');

  -- teacher: results, declaration, push to marks
  perform pg_temp.act_as(te);
  select count(*) into n from public.online_attempt_list(a, oe) ;
  perform pg_temp.check(n = 2, 'the teacher assigned to the class and subject sees the attempts of their exam');
  perform pg_temp.act_as(pr);
  select count(*) into n from public.online_attempt_list(a, oe);
  perform pg_temp.check(n = 2, 'the principal sees both attempts');
  begin perform public.online_exam_declare(a, oe, false); perform pg_temp.check(false, 'open');
  exception when others then perform pg_temp.check(sqlerrm like '%still open%', 'a declaration waits for the window to close'); end;
  perform public.online_exam_close(a, oe);
  j := public.online_exam_declare(a, oe, true);
  perform pg_temp.check((j ->> 'pushed')::int = 2, 'declaring with push writes both scores into the offline exam');
  perform pg_temp.check((select marks = round(20 * 1.0 / 6, 1) from public.marks where exam_id = ex_off and student_id = s1 and subject_id = sub), 'the score is scaled to the offline max marks (1/6 of 20 = 3.3)');
  perform pg_temp.act_service();
  j := public.exam_result(tok, oe);
  perform pg_temp.check((j ->> 'shown')::boolean and (j ->> 'score')::numeric = 1 and jsonb_array_length(j -> 'review') = 3, 'after declaration the student sees the score and the review with answers');
end $$;

rollback;
