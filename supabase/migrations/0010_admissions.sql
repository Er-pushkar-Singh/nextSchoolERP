-- ═══════════════════════════════════════════════════════════════════════════
-- Step 8: end-to-end admissions + the data the UP Board 2027 exam forms ask for.
--   · applications (number, documents, test / interview, decision, waitlist, RTE, fee) → admit
--   · fuller student profile (Hindi names, mobile, street / post office, religion …)
--   · Aadhaar (encrypted by the app, consent required), disability type, prior exams
--   · official UPMSP subject codes (HS 2027 + Intermediate 2027) and per-student board subjects
--   · seats and age limits per class, UPMSP centre IDs on the school
-- Source of the board data: UPMSP Exam Form HS 2027 / Intermediate 2027 (subject codes and combination rules).
-- Safe to run again.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────── Student profile additions ─────────────
alter table public.students
  add column if not exists name_hi              text,
  add column if not exists father_name_hi       text,
  add column if not exists mother_name_hi       text,
  add column if not exists mobile               text check (mobile is null or mobile ~ '^[6-9][0-9]{9}$'),
  add column if not exists street               text,
  add column if not exists post_office          text,
  add column if not exists religion             text,
  add column if not exists caste                text,
  add column if not exists medium               text check (medium is null or medium in ('hindi','english')),
  add column if not exists bpl                  boolean,
  add column if not exists sibling_student_id   uuid references public.students(id) on delete set null,
  add column if not exists previous_year_percent numeric(5,2) check (previous_year_percent is null or previous_year_percent between 0 and 100),
  add column if not exists previous_year_days   int check (previous_year_days is null or previous_year_days between 0 and 400),
  add column if not exists application_id       uuid;

alter table public.classes
  add column if not exists seats         int check (seats is null or seats >= 0),
  add column if not exists min_age_years numeric(3,1) check (min_age_years is null or min_age_years >= 0),
  add column if not exists max_age_years numeric(3,1) check (max_age_years is null or max_age_years >= 0);

-- UPMSP: the user id and centre number the board allots to the school (fields 1 and 2 of every exam form)
alter table public.schools
  add column if not exists upmsp_user_id   text check (upmsp_user_id is null or upmsp_user_id ~ '^[0-9]{6}$'),
  add column if not exists upmsp_center_no text check (upmsp_center_no is null or upmsp_center_no ~ '^[0-9]{4}$');

-- ───────────── Sensitive tier: Aadhaar (ciphertext only), disability ─────────────
alter table public.student_sensitive
  add column if not exists aadhaar_enc     text,     -- AES-256-GCM made by the app; the database never sees the number
  add column if not exists aadhaar_last4   text check (aadhaar_last4 is null or aadhaar_last4 ~ '^[0-9]{4}$'),
  add column if not exists aadhaar_consent boolean not null default false,
  add column if not exists disability_type text check (disability_type is null or disability_type in ('visual','hearing','speech','locomotor','hand','multiple','other')),
  add column if not exists disability_percent numeric(5,2) check (disability_percent is null or disability_percent between 0 and 100);
alter table public.student_sensitive drop constraint if exists student_sensitive_aadhaar_consent;
alter table public.student_sensitive add constraint student_sensitive_aadhaar_consent check (aadhaar_enc is null or aadhaar_consent);

-- ───────────── Earlier examinations / schools (UPMSP form items 29-38) ─────────────
create table if not exists public.student_prior_exams (
  id            uuid primary key default gen_random_uuid(),
  school_id     uuid not null references public.schools(id) on delete cascade,
  student_id    uuid not null references public.students(id) on delete cascade,
  level         text not null check (level in ('class8','class9_registration','class9','high_school','class11_registration','intermediate','iti','other')),
  board_name    text,
  exam_year     int check (exam_year is null or exam_year between 1980 and 2100),
  roll_no       text,                 -- अनुक्रमांक
  registration_no text,
  school_name   text,
  district_code text,
  school_code   text,
  result        text,
  marks_obtained numeric(7,2),
  max_marks     numeric(7,2),
  percentage    numeric(5,2) check (percentage is null or percentage between 0 and 100),
  note          text,
  created_at    timestamptz not null default now(),
  unique (student_id, level)
);
alter table public.student_prior_exams enable row level security;
drop policy if exists "read" on public.student_prior_exams;
create policy "read" on public.student_prior_exams for select to authenticated using (public.can_student(school_id, 'students.profile.view', student_id));
drop policy if exists "write" on public.student_prior_exams;
create policy "write" on public.student_prior_exams for all to authenticated
  using (public.can_student(school_id, 'students.profile.edit', student_id)) with check (public.can_student(school_id, 'students.profile.edit', student_id));

-- ───────────── Official UPMSP subject codes (HS 2027 and Intermediate 2027) ─────────────
create table if not exists public.board_subject_codes (
  level   text not null check (level in ('hs','inter')),
  code    text not null,
  name_en text not null,
  name_hi text,
  sort    int  not null default 0,
  primary key (level, code)
);
alter table public.board_subject_codes enable row level security;
drop policy if exists "read" on public.board_subject_codes;
create policy "read" on public.board_subject_codes for select to authenticated using (true);

insert into public.board_subject_codes (level, code, name_en, name_hi) values
  ('hs','901','Hindi','हिन्दी'), ('hs','902','Elementary Hindi','प्रारम्भिक हिन्दी'), ('hs','903','Gujarati','गुजराती'), ('hs','904','Urdu','उर्दू'),
  ('hs','905','Punjabi','पंजाबी'), ('hs','906','Bengali','बंगला'), ('hs','907','Marathi','मराठी'), ('hs','908','Assamese','आसामी'), ('hs','909','Oriya','उड़िया'),
  ('hs','910','Kannada','कन्नड़'), ('hs','911','Kashmiri','कश्मीरी'), ('hs','912','Sindhi','सिन्धी'), ('hs','913','Tamil','तमिल'), ('hs','914','Telugu','तेलुगू'),
  ('hs','915','Malayalam','मलयालम'), ('hs','916','Nepali','नेपाली'), ('hs','917','English','अंग्रेजी'), ('hs','923','Sanskrit','संस्कृत'), ('hs','924','Pali','पालि'),
  ('hs','925','Arabic','अरबी'), ('hs','926','Persian','फारसी'), ('hs','928','Mathematics','गणित'), ('hs','930','Home Science (female candidates)','गृह विज्ञान'),
  ('hs','931','Science','विज्ञान'), ('hs','932','Social Science','सामाजिक विज्ञान'), ('hs','933','Music Vocal','संगीत गायन'), ('hs','934','Music Instrumental','संगीत वादन'),
  ('hs','935','Commerce','वाणिज्य'), ('hs','936','Drawing','चित्रकला'), ('hs','937','Agriculture','कृषि'), ('hs','938','Home Science (optional)','गृह विज्ञान'),
  ('hs','939','Tailoring','सिलाई'), ('hs','940','Painting','रंजनकला'), ('hs','941','Computer','कम्प्यूटर'), ('hs','942','Anthropology','मानव विज्ञान'),
  ('hs','944','Moral, Yoga, Sports & Physical Education','नैतिक, योग, खेल एवं शारीरिक शिक्षा'),
  ('hs','971','Retail Trading','खुदरा व्यापार'), ('hs','972','Security','सुरक्षा'), ('hs','973','Automobile','ऑटोमोबाइल'), ('hs','974','IT / ITES','आई0टी0/आई0टी0ई0एस'), ('hs','975','Health Care','हेल्थ केयर'),
  ('hs','945','Textile Design (pre-vocational)','टेक्सटाइल डिजाइन'), ('hs','946','Library Science (pre-vocational)','पुस्तकालय विज्ञान'), ('hs','947','Cookery (pre-vocational)','पाक शास्त्र'),
  ('hs','948','Photography (pre-vocational)','फोटोग्राफी'), ('hs','949','Baking & Confectionery (pre-vocational)','बेकिंग तथा कन्फेक्शनरी'), ('hs','950','Bee Keeping (pre-vocational)','मधुमक्खी पालन'),
  ('hs','951','Plant Nursery (pre-vocational)','पौधशाला'), ('hs','952','Automobile (pre-vocational)','ऑटोमोबाइल'), ('hs','953','Laundry & Dyeing (pre-vocational)','धुलाई तथा रंगाई'),
  ('hs','954','Dress Making & Decoration (pre-vocational)','परिधान रचना एवं सज्जा'), ('hs','955','Food Preservation (pre-vocational)','खाद्य संरक्षण'),
  ('hs','956','Accountancy & Auditing (pre-vocational)','एकाउन्टेन्सी एवं अंकेक्षण'), ('hs','957','Shorthand & Typing (pre-vocational)','आशुलिपि एवं टंकण'),
  ('hs','958','Banking (pre-vocational)','बैंकिंग'), ('hs','959','Typing (pre-vocational)','टाइपिंग'), ('hs','960','Fruit Preservation Technology (pre-vocational)','फल संरक्षण तकनीक'),
  ('hs','961','Crop Protection Technology (pre-vocational)','फसल सुरक्षा तकनीक'), ('hs','962','Printing (pre-vocational)','मुद्रण'),
  ('hs','963','Radio & Television Technique (pre-vocational)','रेडियो एवं टेलीविजन तकनीक'), ('hs','964','Weaving Technology (pre-vocational)','बुनाई तकनीक'),
  ('hs','965','Retail Trading (pre-vocational)','खुदरा व्यापार'), ('hs','966','Security (pre-vocational)','सुरक्षा'), ('hs','967','Mobile Repairing (pre-vocational)','मोबाइल रिपेयरिंग'),
  ('hs','968','Tourism & Hospitality (pre-vocational)','पर्यटन एवं आतिथ्य'), ('hs','969','IT / ITES (pre-vocational)','आई0टी0/आई0टी0ई0एस0'),
  ('hs','701','Retail Trading (revised vocational)','खुदरा व्यापार'), ('hs','702','Security (revised vocational)','सुरक्षा'),
  ('hs','703','Automobile (revised vocational)','ऑटोमोबाइल'), ('hs','704','IT / ITES (revised vocational)','आई0टी0/आई0टी0ई0एस0'),

  ('inter','101','Hindi','हिन्दी'), ('inter','102','General Hindi','सामान्य हिन्दी'), ('inter','103','Sanskrit','संस्कृत'), ('inter','104','Urdu','उर्दू'),
  ('inter','105','Gujarati','गुजराती'), ('inter','106','Punjabi','पंजाबी'), ('inter','107','Bengali','बंगाली'), ('inter','108','Marathi','मराठी'), ('inter','109','Assamese','आसामी'),
  ('inter','110','Oriya','उड़िया'), ('inter','111','Kannada','कन्नड़'), ('inter','113','Sindhi','सिन्धी'), ('inter','114','Tamil','तमिल'), ('inter','115','Telugu','तेलुगू'),
  ('inter','116','Malayalam','मलयालम'), ('inter','117','English','अंग्रेजी'), ('inter','121','Nepali','नेपाली'), ('inter','124','Pali','पाली'), ('inter','125','Arabic','अरबी'),
  ('inter','126','Persian','फारसी'), ('inter','128','History','इतिहास'), ('inter','129','Geography','भूगोल'), ('inter','130','Civics','नागरिकशास्त्र'), ('inter','131','Mathematics','गणित'),
  ('inter','132','Military Science','सैन्यविज्ञान'), ('inter','133','Psychology','मनोविज्ञान'), ('inter','134','Education','शिक्षाशास्त्र'), ('inter','135','Home Science','गृहविज्ञान'),
  ('inter','136','Economics','अर्थशास्त्र'), ('inter','137','Logic','तर्कशास्त्र'), ('inter','138','Music Vocal','संगीत (गायन)'), ('inter','139','Music Instrumental','संगीत (वादन)'),
  ('inter','140','Drawing (Design)','चित्रकला (आलेखन)'), ('inter','141','Drawing (Technical)','चित्रकला (प्रावैधिक)'), ('inter','142','Sociology','समाजशास्त्र'),
  ('inter','144','Computer','कम्प्यूटर'), ('inter','145','Wood Craft','काष्ठशिल्प'), ('inter','146','Book Craft','ग्रन्थशिल्प'), ('inter','147','Tailoring','सिलाई'),
  ('inter','149','Painting','रंजनकला'), ('inter','150','Dancing','नृत्यकला'), ('inter','151','Physics','भौतिक विज्ञान'), ('inter','152','Chemistry','रसायन विज्ञान'),
  ('inter','153','Biology','जीव विज्ञान'), ('inter','156','Accountancy','लेखाशास्त्र'), ('inter','157','Business Studies','व्यवसाय अध्ययन'),
  ('inter','163','Agronomy (Ag. Part 1)','शस्यविज्ञान'), ('inter','164','Ag. Botany','कृषि वनस्पतिविज्ञान'), ('inter','165','Ag. Physics & Climatology','कृषि भौतिकविज्ञान एवं जलवायुविज्ञान'),
  ('inter','166','Ag. Engineering','कृषि अभियंत्रण'), ('inter','167','Ag. Mathematics & Elementary Statistics','कृषि गणित तथा प्रारम्भिक सांख्यिकी'),
  ('inter','168','Agronomy (Ag. Part 2)','शस्यविज्ञान'), ('inter','169','Ag. Economics','कृषि अर्थशास्त्र'), ('inter','170','Ag. Zoology','कृषि जन्तुविज्ञान'),
  ('inter','171','Animal Husbandry & Veterinary Science','कृषि पशुपालन एवं पशु चिकित्साविज्ञान'), ('inter','172','Ag. Chemistry','कृषि रसायन विज्ञान'),
  ('inter','173','Moral, Yoga, Sports & Physical Education','नैतिक, योग, खेल एवं शारीरिक शिक्षा'), ('inter','174','Anthropology','मानव विज्ञान'), ('inter','175','NCC','एन0सी0सी0'),
  ('inter','200','Optional Agronomy','वैकल्पिक शस्य विज्ञान'), ('inter','201','Vocational General Foundation','सामान्य आधारिक विषय'),
  ('inter','202','Fruit & Food Preservation','फल एवं खाद्य संरक्षण'), ('inter','203','Cookery','पाकशास्त्र'), ('inter','204','Dress Making & Decoration','परिधान रचना एवं सज्जा'),
  ('inter','205','Laundry & Dyeing','धुलाई तथा रंगाई'), ('inter','206','Baking & Confectionery','बेकिंग तथा कन्फेक्शनरी'), ('inter','207','Textile Design','टेक्सटाइल डिजाइन'),
  ('inter','208','Weaving Technique','बुनाई तकनीक'), ('inter','209','Nursery Teacher Training & Child Management','नर्सरी शिक्षक प्रशिक्षण एवं शिशु प्रबन्ध'),
  ('inter','210','Library Science','पुस्तकालय विज्ञान'), ('inter','211','Multipurpose Health Worker (incl. Laboratory Technique)','बहुउद्देशीय स्वास्थ्य कर्मिक (लेबोरेटरी तकनीक सहित)'),
  ('inter','212','Colour Photography','रंगीन फोटोग्राफी'), ('inter','213','Radio & Colour Television','रेडियो एवं रंगीन टेलीविजन'), ('inter','214','Automobiles','आटोमोबाइल्स'),
  ('inter','215','Bee Keeping','मधुमक्खी पालन'), ('inter','216','Dairy Technology','डेरी प्रौद्योगिकी'), ('inter','217','Sericulture','रेशमकीट पालन'),
  ('inter','218','Seed Production Technology','बीजोत्पादन प्रौद्योगिकी'), ('inter','219','Crop Protection Technology','फसल सुरक्षा प्रौद्योगिकी'), ('inter','220','Plant Nursery','पौधशाला'),
  ('inter','221','Land Conservation & Reclamation','भूमि संरक्षण एवं भूमि सुधार'), ('inter','222','Accountancy & Auditing','एकाउन्टेन्सी एवं अंकेक्षण'), ('inter','223','Banking','बैंकिंग'),
  ('inter','224','Shorthand & Typing (Hindi)','आशुलिपि एवं टंकण (हिन्दी)'), ('inter','225','Shorthand & Typing (English)','आशुलिपि एवं टंकण (अंग्रेजी)'),
  ('inter','226','Marketing & Salesmanship','विपणन एवं विक्रयकला'), ('inter','227','Secretarial Practice','सचिवीय पद्धति'), ('inter','228','Insurance','बीमा'),
  ('inter','229','Co-operation','सहकारिता'), ('inter','230','Typing Hindi & English','टंकण हिन्दी तथा अंग्रेजी'), ('inter','231','Printing','मुद्रण'), ('inter','232','Pottery','कुलालविज्ञान'),
  ('inter','233','Artificial Limbs & Organ Technique','कृत्रिम अंग एवं अवयव तकनीक'), ('inter','234','Embroidery','इम्ब्राइडरी'), ('inter','235','Hand Block Printing','हैण्ड ब्लाक प्रिंटिंग'),
  ('inter','236','Metal Craft (Moulding)','मेटलक्राफ्ट (मोल्डिंग)'), ('inter','237','Metal Craft (Engraving)','मेटलक्राफ्ट (इनग्रेविंग)'),
  ('inter','238','Computer Technique & Maintenance (Data Entry Process)','कम्प्यूटर तकनीक एवं मेन्टेनेन्स (डाटा इन्ट्री प्रोसेस)'),
  ('inter','239','Repair & Maintenance of Domestic Electrical Appliances','घरेलू विद्युत उपकरणों की मरम्मत एवं रख रखाव'), ('inter','240','Retail Trading','रिटेल ट्रेडिंग'),
  ('inter','241','Security','सेक्योरिटी'), ('inter','242','Mobile Repairing','मोबाइल रिपेयरिंग'), ('inter','243','Tourism & Hospitality','टूरिज्म एण्ड हॉस्पिटैलिटी'),
  ('inter','244','IT / ITES','आई0टी0/आई0टी0ई0एस0'), ('inter','245','Health Care','हेल्थ केयर')
on conflict (level, code) do update set name_en = excluded.name_en, name_hi = excluded.name_hi;

-- Subjects chosen for the board form, in the order of the form's boxes (slot '1'…'7'; HS also 'trade')
create table if not exists public.student_board_subjects (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  level      text not null check (level in ('hs','inter')),
  slot       text not null check (slot in ('1','2','3','4','5','6','7','trade')),
  code       text not null,
  unique (student_id, session_id, level, slot),
  foreign key (level, code) references public.board_subject_codes(level, code)
);
alter table public.student_board_subjects enable row level security;
drop policy if exists "read" on public.student_board_subjects;
create policy "read" on public.student_board_subjects for select to authenticated
  using (public.can_student(school_id, 'students.profile.view', student_id) or public.has_perm_school(school_id, 'students.board_reg.view'));
drop policy if exists "write" on public.student_board_subjects;
create policy "write" on public.student_board_subjects for all to authenticated
  using (public.has_perm_school(school_id, 'students.board_reg.edit')) with check (public.has_perm_school(school_id, 'students.board_reg.edit'));

alter table public.board_registrations
  add column if not exists subject_group   text check (subject_group is null or subject_group in ('A','B','C','F1','F2','I')),
  add column if not exists exam_type       text not null default 'full' check (exam_type in ('full','part')),
  add column if not exists board_roll_no   text,
  add column if not exists board_reg_no    text;

-- ───────────── Snapshot: everything the board form carries ─────────────
create or replace function public.build_board_snapshot(stu uuid, sess uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'name', btrim(concat_ws(' ', s.first_name, s.middle_name, s.last_name)),
    'name_hi', s.name_hi, 'father_name', s.father_name, 'father_name_hi', s.father_name_hi,
    'mother_name', s.mother_name, 'mother_name_hi', s.mother_name_hi,
    'admission_no', s.admission_no, 'dob', s.dob, 'gender', s.gender, 'category', s.category, 'medium', s.medium,
    'mobile', s.mobile, 'email', s.email, 'nationality', coalesce(s.nationality, 'Indian'),
    'street', coalesce(s.street, s.address), 'village_town_city', s.city, 'post_office', s.post_office, 'tehsil_block', s.block_tehsil,
    'district', s.district, 'state', s.state, 'pincode', s.pincode,
    'class', c.name, 'section', sec.name,
    'apaar_id', ss.apaar_id, 'pen', ss.pen, 'aadhaar_last4', ss.aadhaar_last4, 'aadhaar_present', ss.aadhaar_enc is not null,
    'disability_type', ss.disability_type,
    'photo', exists (select 1 from public.student_documents d where d.student_id = s.id and d.doc_type = 'photo' and d.file_path is not null and d.status <> 'rejected'),
    'subject_group', (select r.subject_group from public.board_registrations r where r.student_id = s.id and r.session_id = sess limit 1),
    'subjects', coalesce((select jsonb_agg(jsonb_build_object('slot', b.slot, 'code', b.code, 'name_en', k.name_en, 'name_hi', k.name_hi)
                                          order by case when b.slot = 'trade' then 99 else b.slot::int end)
                            from public.student_board_subjects b join public.board_subject_codes k on k.level = b.level and k.code = b.code
                           where b.student_id = s.id and b.session_id = sess), '[]'::jsonb),
    'prior', coalesce((select jsonb_agg(jsonb_build_object('level', p.level, 'board_name', p.board_name, 'exam_year', p.exam_year, 'roll_no', p.roll_no,
                                          'registration_no', p.registration_no, 'school_name', p.school_name, 'district_code', p.district_code, 'school_code', p.school_code))
                         from public.student_prior_exams p where p.student_id = s.id), '[]'::jsonb))
    from public.students s
    left join public.classes c on c.id = s.class_id
    left join public.sections sec on sec.id = s.section_id
    left join public.student_sensitive ss on ss.student_id = s.id
   where s.id = stu;
$$;

-- readiness rules for the principal's check (presence only; combination rules are checked by the app)
create or replace function public.guard_board_registration() returns trigger
language plpgsql security definer set search_path = public as $$
declare snap jsonb; missing text[] := '{}'; actor_checked boolean := auth.uid() is not null and not public.is_service();
        n_sub int; need int; grp text; hs boolean;
begin
  if tg_op = 'INSERT' then
    if not exists (select 1 from public.students where id = new.student_id and school_id = new.school_id) then raise exception 'Student not found.'; end if;
    new.status := 'draft'; new.snapshot := '{}';
    return new;
  end if;
  if new.student_id is distinct from old.student_id or new.session_id is distinct from old.session_id or new.kind is distinct from old.kind then
    raise exception 'A registration cannot be moved to another student, session or form type.';
  end if;
  if new.snapshot is distinct from old.snapshot and new.status = old.status then
    raise exception 'The snapshot is set automatically when the principal checks the record.';
  end if;
  if new.status is distinct from old.status then
    if not ((old.status = 'draft' and new.status = 'checked') or (old.status = 'checked' and new.status in ('draft','submitted'))
         or (old.status = 'submitted' and new.status in ('accepted','correction')) or (old.status = 'correction' and new.status = 'checked')) then
      raise exception 'A registration cannot go from % to %.', old.status, new.status;
    end if;
    if actor_checked and not public.has_perm_school(new.school_id, 'students.board_reg.approve') then
      raise exception 'Only the principal can check, submit or accept a board registration.';
    end if;
    if new.status = 'checked' then
      snap := public.build_board_snapshot(new.student_id, new.session_id);
      hs := new.class_level in (9, 10);
      grp := coalesce(new.subject_group, snap ->> 'subject_group');
      if coalesce(snap ->> 'name', '') = '' then missing := missing || 'student name'::text; end if;
      if coalesce(snap ->> 'name_hi', '') = '' then missing := missing || 'student name in Hindi'::text; end if;
      if coalesce(snap ->> 'father_name', '') = '' and coalesce(snap ->> 'mother_name', '') = '' then missing := missing || 'father''s or mother''s name'::text; end if;
      if coalesce(snap ->> 'father_name', '') <> '' and coalesce(snap ->> 'father_name_hi', '') = '' then missing := missing || 'father''s name in Hindi'::text; end if;
      if coalesce(snap ->> 'mother_name', '') <> '' and coalesce(snap ->> 'mother_name_hi', '') = '' then missing := missing || 'mother''s name in Hindi'::text; end if;
      if snap ->> 'dob' is null then missing := missing || 'date of birth'::text; end if;
      if snap ->> 'gender' is null then missing := missing || 'gender'::text; end if;
      if snap ->> 'category' is null then missing := missing || 'category'::text; end if;
      if snap ->> 'medium' is null then missing := missing || 'medium (Hindi / English)'::text; end if;
      if coalesce(snap ->> 'district', '') = '' or coalesce(snap ->> 'state', '') = '' or coalesce(snap ->> 'pincode', '') = '' then missing := missing || 'address (district, state, PIN)'::text; end if;
      if coalesce(snap ->> 'mobile', '') = '' then missing := missing || 'mobile number'::text; end if;
      if (snap ->> 'photo')::boolean is not true then missing := missing || 'photograph'::text; end if;
      select count(*) into n_sub from jsonb_array_elements(snap -> 'subjects') x where x ->> 'slot' <> '7';
      if hs then
        if not (select bool_and(exists (select 1 from jsonb_array_elements(snap -> 'subjects') x where x ->> 'slot' = s)) from unnest(array['1','2','3','4','5']) s) then
          missing := missing || 'subjects 1 to 5'::text;
        end if;
        if not exists (select 1 from jsonb_array_elements(snap -> 'subjects') x where x ->> 'slot' in ('6','trade')) then
          missing := missing || '6th subject (optional / trade)'::text;
        end if;
      else
        if grp is null then missing := missing || 'subject group (A, B, C, F1, F2, I)'::text;
        else
          need := case grp when 'F1' then 6 when 'F2' then 6 when 'I' then 4 else 5 end;
          if n_sub < need then missing := missing || ('subjects (group ' || grp || ' needs ' || need || ')')::text; end if;
        end if;
      end if;
      if cardinality(missing) > 0 then raise exception 'Cannot check this record. Missing: %.', array_to_string(missing, ', '); end if;
      new.snapshot := snap; new.checked_by := auth.uid(); new.checked_at := now();
      new.correction_note := null;
    elsif new.status = 'submitted' then
      new.submitted_on := coalesce(new.submitted_on, public.today_ist());
    elsif new.status = 'correction' and coalesce(btrim(new.correction_note), '') = '' then
      raise exception 'Write what the board asked to correct.';
    elsif new.status = 'draft' then
      new.snapshot := '{}'; new.checked_by := null; new.checked_at := null; new.checked_by_name := null;
    end if;
  elsif old.status in ('checked','submitted','accepted') and (new.fee_total is distinct from old.fee_total or new.exam_year is distinct from old.exam_year
        or new.class_level is distinct from old.class_level or new.subject_group is distinct from old.subject_group) then
    raise exception 'This registration is locked. Send it back to draft first.';
  end if;
  return new;
end $$;

-- ═════════════════════════ Admission applications ═════════════════════════
create table if not exists public.admission_applications (
  id              uuid primary key default gen_random_uuid(),
  school_id       uuid not null references public.schools(id) on delete cascade,
  application_no  text not null,
  session_id      uuid references public.sessions(id) on delete set null,
  class_id        uuid references public.classes(id) on delete set null,       -- class applied for
  enquiry_id      uuid references public.enquiries(id) on delete set null,
  status          text not null default 'submitted'
                  check (status in ('submitted','under_review','test_scheduled','approved','waitlisted','rejected','admitted','cancelled')),
  applicant_name  text not null check (length(btrim(applicant_name)) > 0),
  father_name     text,
  phone           text,
  form            jsonb not null default '{}',     -- the full student profile (same keys as students) + contacts[] + prior[]
  rte_applicant   boolean not null default false,
  rte_reference   text,
  source          text,
  applied_on      date not null default public.today_ist(),
  test_on         date, test_marks numeric(6,2), test_max numeric(6,2),
  interview_on    date, interview_note text,
  waitlist_no     int,
  decision_note   text,
  decided_by      uuid references auth.users(id) on delete set null,
  decided_by_name text,
  decided_at      timestamptz,
  fee_amount      numeric(10,2) check (fee_amount is null or fee_amount >= 0),
  fee_paid_on     date, fee_mode text, fee_ref text,
  student_id      uuid references public.students(id) on delete set null,
  admitted_on     date,
  created_by      uuid default auth.uid() references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (school_id, application_no),
  check (test_marks is null or test_max is null or test_marks <= test_max)
);
create index if not exists admission_applications_idx on public.admission_applications (school_id, session_id, status);
create index if not exists admission_applications_class_idx on public.admission_applications (school_id, class_id, status);
drop trigger if exists admission_applications_touch on public.admission_applications;
create trigger admission_applications_touch before update on public.admission_applications for each row execute function public.touch_row();
alter table public.students drop constraint if exists students_application_fk;
alter table public.students add constraint students_application_fk foreign key (application_id) references public.admission_applications(id) on delete set null;

create table if not exists public.admission_application_events (
  id             bigint generated always as identity primary key,
  school_id      uuid not null references public.schools(id) on delete cascade,
  application_id uuid not null references public.admission_applications(id) on delete cascade,
  at             timestamptz not null default now(),
  actor          uuid,
  actor_name     text,
  event          text not null,
  details        jsonb not null default '{}'
);
create index if not exists admission_application_events_idx on public.admission_application_events (application_id, at);

create table if not exists public.application_documents (
  id               uuid primary key default gen_random_uuid(),
  school_id        uuid not null references public.schools(id) on delete cascade,
  application_id   uuid not null references public.admission_applications(id) on delete cascade,
  doc_type         text not null check (doc_type in ('birth_certificate','photo','previous_marksheet','transfer_certificate','migration_certificate',
                     'address_proof','caste_certificate','income_certificate','disability_certificate','apaar_consent','medical_declaration','transport_declaration','other')),
  title            text,
  status           text not null default 'pending' check (status in ('pending','uploaded','verified','rejected','not_applicable')),
  file_path        text, file_name text, mime_type text, size_bytes int,
  due_by           date,
  uploaded_by      uuid references auth.users(id) on delete set null, uploaded_by_name text, uploaded_at timestamptz,
  verified_by      uuid references auth.users(id) on delete set null, verified_by_name text, verified_at timestamptz,
  reject_reason    text, remark text,
  created_at       timestamptz not null default now(),
  check (status in ('pending','not_applicable') or file_path is not null)
);
create unique index if not exists application_documents_one on public.application_documents (application_id, doc_type) where doc_type <> 'other';

create or replace function public.guard_application_document() returns trigger
language plpgsql security definer set search_path = public as $$
declare actor_checked boolean := auth.uid() is not null and not public.is_service();
begin
  if not exists (select 1 from public.admission_applications where id = new.application_id and school_id = new.school_id) then raise exception 'Application not found.'; end if;
  if tg_op = 'UPDATE' and new.file_path is distinct from old.file_path and new.file_path is not null then
    new.status := 'uploaded'; new.verified_by := null; new.verified_by_name := null; new.verified_at := null; new.reject_reason := null;
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status and new.status in ('verified','rejected') then
    if actor_checked and not public.has_perm_school(new.school_id, 'frontdesk.admissions.edit') then raise exception 'You cannot verify documents.'; end if;
    if new.status = 'rejected' and coalesce(btrim(new.reject_reason), '') = '' then raise exception 'Write the reason for rejecting the document.'; end if;
    new.verified_by := auth.uid(); new.verified_at := now();
    if new.status = 'verified' then new.reject_reason := null; end if;
  end if;
  return new;
end $$;
drop trigger if exists application_documents_guard on public.application_documents;
create trigger application_documents_guard before insert or update on public.application_documents for each row execute function public.guard_application_document();

-- numbering uses certificate_counters (kind 'application')
create or replace function public.create_application(sid uuid, p_class uuid, p_enquiry uuid, p_form jsonb, p_rte boolean default false,
                                                     p_rte_ref text default null, p_source text default null, p_session uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare sess uuid := coalesce(p_session, (select id from public.sessions where school_id = sid and is_current limit 1));
        sname text; n int; num text; nm text; dup text; aid uuid; f jsonb := coalesce(p_form, '{}'::jsonb);
begin
  if not public.has_perm_school(sid, 'frontdesk.admissions.create') then raise exception 'not allowed'; end if;
  if coalesce(btrim(f ->> 'first_name'), '') = '' then raise exception 'The student''s first name is required.'; end if;
  if p_class is not null and not exists (select 1 from public.classes where id = p_class and school_id = sid) then raise exception 'Class not found.'; end if;
  if p_enquiry is not null and not exists (select 1 from public.enquiries where id = p_enquiry and school_id = sid) then raise exception 'Enquiry not found.'; end if;
  nm := btrim(concat_ws(' ', f ->> 'first_name', f ->> 'middle_name', f ->> 'last_name'));
  select application_no into dup from public.admission_applications
   where school_id = sid and session_id is not distinct from sess and status not in ('cancelled','rejected')
     and lower(applicant_name) = lower(nm) and coalesce(form ->> 'dob', '') = coalesce(f ->> 'dob', '') and coalesce(lower(father_name), '') = coalesce(lower(f ->> 'father_name'), '')
   limit 1;
  if dup is not null and coalesce((f ->> 'allow_duplicate')::boolean, false) is not true then
    raise exception 'An application for the same student already exists (no. %).', dup;
  end if;
  select coalesce((select name from public.sessions where id = sess), 'NA') into sname;
  insert into public.certificate_counters (school_id, kind, session_name, next_no) values (sid, 'application', sname, 2)
  on conflict (school_id, kind, session_name) do update set next_no = public.certificate_counters.next_no + 1 returning next_no - 1 into n;
  num := 'APP/' || sname || '/' || lpad(n::text, 4, '0');
  insert into public.admission_applications (school_id, application_no, session_id, class_id, enquiry_id, applicant_name, father_name, phone, form, rte_applicant, rte_reference, source)
  values (sid, num, sess, p_class, p_enquiry, nm, nullif(btrim(f ->> 'father_name'), ''), nullif(btrim(f ->> 'guardian_phone'), ''), f - 'allow_duplicate', coalesce(p_rte, false), nullif(btrim(coalesce(p_rte_ref, '')), ''), nullif(btrim(coalesce(p_source, '')), ''))
  returning id into aid;
  if p_enquiry is not null then update public.enquiries set status = case when status in ('new','contacted','visited') then 'test' else status end where id = p_enquiry and school_id = sid; end if;
  return aid;
end $$;

-- status workflow
create or replace function public.guard_application() returns trigger
language plpgsql security definer set search_path = public as $$
declare actor_checked boolean := auth.uid() is not null and not public.is_service(); ok boolean; need_approve boolean;
begin
  if tg_op = 'INSERT' then new.status := 'submitted'; return new; end if;
  if new.school_id is distinct from old.school_id or new.application_no is distinct from old.application_no then raise exception 'Application numbers cannot be changed.'; end if;
  if old.status in ('admitted','cancelled') and (new.status is distinct from old.status or new.form is distinct from old.form or new.class_id is distinct from old.class_id) then
    raise exception 'This application is closed (%).', old.status;
  end if;
  if new.status is distinct from old.status then
    ok := case old.status
      when 'submitted'      then new.status in ('under_review','test_scheduled','approved','waitlisted','rejected','cancelled')
      when 'under_review'   then new.status in ('test_scheduled','approved','waitlisted','rejected','cancelled')
      when 'test_scheduled' then new.status in ('under_review','approved','waitlisted','rejected','cancelled')
      when 'approved'       then new.status in ('waitlisted','cancelled','admitted','under_review')
      when 'waitlisted'     then new.status in ('approved','rejected','cancelled','under_review')
      when 'rejected'       then new.status in ('under_review')
      else false end;
    if not ok then raise exception 'An application cannot go from % to %.', old.status, new.status; end if;
    if new.status = 'admitted' and coalesce(current_setting('app.admitting', true), '') <> '1' then
      raise exception 'An application becomes admitted only through "Admit".';
    end if;
    need_approve := new.status in ('approved','waitlisted','rejected') or (old.status = 'rejected');
    if actor_checked and need_approve and not public.has_perm_school(new.school_id, 'frontdesk.admissions.approve') then
      raise exception 'Only the principal (admission approver) can approve, waitlist or reject.';
    end if;
    if new.status = 'rejected' and coalesce(btrim(new.decision_note), '') = '' then raise exception 'Write the reason for rejecting.'; end if;
    if new.status in ('approved','waitlisted','rejected') then new.decided_by := auth.uid(); new.decided_at := now(); end if;
    if new.status = 'waitlisted' then
      select coalesce(max(waitlist_no), 0) + 1 into new.waitlist_no from public.admission_applications
       where school_id = new.school_id and class_id is not distinct from new.class_id and session_id is not distinct from new.session_id and status = 'waitlisted';
    elsif old.status = 'waitlisted' then new.waitlist_no := null;
    end if;
    if new.status = 'test_scheduled' and new.test_on is null and new.interview_on is null then raise exception 'Set the test or interview date first.'; end if;
  end if;
  return new;
end $$;
drop trigger if exists admission_applications_guard on public.admission_applications;
create trigger admission_applications_guard before insert or update on public.admission_applications for each row execute function public.guard_application();

create or replace function public.log_application() returns trigger
language plpgsql security definer set search_path = public as $$
declare ev text; det jsonb := '{}';
begin
  if tg_op = 'INSERT' then ev := 'application received'; det := jsonb_build_object('no', new.application_no);
  elsif new.status is distinct from old.status then ev := 'status ' || old.status || ' → ' || new.status; det := jsonb_build_object('note', new.decision_note, 'waitlist_no', new.waitlist_no);
  elsif new.fee_paid_on is distinct from old.fee_paid_on or new.fee_amount is distinct from old.fee_amount then ev := 'application fee recorded'; det := jsonb_build_object('amount', new.fee_amount, 'mode', new.fee_mode);
  elsif new.test_marks is distinct from old.test_marks or new.test_on is distinct from old.test_on or new.interview_on is distinct from old.interview_on then ev := 'test / interview updated'; det := jsonb_build_object('test_on', new.test_on, 'marks', new.test_marks, 'interview_on', new.interview_on);
  else return null; end if;
  insert into public.admission_application_events (school_id, application_id, actor, actor_name, event, details)
  values (new.school_id, new.id, auth.uid(), coalesce(auth.jwt() ->> 'email', ''), ev, det);
  return null;
end $$;
drop trigger if exists admission_applications_log on public.admission_applications;
create trigger admission_applications_log after insert or update on public.admission_applications for each row execute function public.log_application();

alter table public.admission_applications enable row level security;
alter table public.admission_application_events enable row level security;
alter table public.application_documents enable row level security;
drop policy if exists "read" on public.admission_applications;
create policy "read" on public.admission_applications for select to authenticated using (public.has_perm_school(school_id, 'frontdesk.admissions.view'));
drop policy if exists "edit" on public.admission_applications;
create policy "edit" on public.admission_applications for update to authenticated
  using (public.has_perm_school(school_id, 'frontdesk.admissions.edit') or public.has_perm_school(school_id, 'frontdesk.admissions.approve'))
  with check (public.has_perm_school(school_id, 'frontdesk.admissions.edit') or public.has_perm_school(school_id, 'frontdesk.admissions.approve'));
-- created only through create_application(); never deleted (cancel instead)
drop policy if exists "read" on public.admission_application_events;
create policy "read" on public.admission_application_events for select to authenticated using (public.has_perm_school(school_id, 'frontdesk.admissions.view'));
drop policy if exists "read" on public.application_documents;
create policy "read" on public.application_documents for select to authenticated using (public.has_perm_school(school_id, 'frontdesk.admissions.view'));
drop policy if exists "create" on public.application_documents;
create policy "create" on public.application_documents for insert to authenticated with check (public.has_perm_school(school_id, 'frontdesk.admissions.create'));
drop policy if exists "edit" on public.application_documents;
create policy "edit" on public.application_documents for update to authenticated
  using (public.has_perm_school(school_id, 'frontdesk.admissions.edit')) with check (public.has_perm_school(school_id, 'frontdesk.admissions.edit'));
drop policy if exists "delete" on public.application_documents;
create policy "delete" on public.application_documents for delete to authenticated using (public.has_perm_school(school_id, 'frontdesk.admissions.edit'));

-- ───────────── Admit: application → student ─────────────
-- helper (not callable by users): create one student's dues from the class fee plans
create or replace function public.bill_student_dues(sid uuid, stu uuid) returns int
language plpgsql security definer set search_path = public as $$
declare cnt int; sess uuid;
begin
  select id into sess from public.sessions where school_id = sid and is_current limit 1;
  if sess is null then return 0; end if;
  insert into public.fee_dues (school_id, session_id, student_id, fee_plan_id, fee_head_id, label, due_date, amount, concession)
  select p.school_id, p.session_id, s.id, p.id, p.fee_head_id, h.name || ' · ' || p.label, p.due_date, p.amount,
         least(p.amount, coalesce((select sum(case when c.kind = 'percent' then p.amount * c.value / 100 else c.value end)
                                    from public.student_concessions c where c.student_id = s.id and (c.fee_head_id is null or c.fee_head_id = p.fee_head_id)), 0))
    from public.fee_plans p
    join public.fee_heads h on h.id = p.fee_head_id
    join public.students s on s.class_id = p.class_id and s.school_id = p.school_id and s.id = stu and s.status = 'active'
   where p.school_id = sid and p.session_id = sess
  on conflict (student_id, fee_plan_id) do nothing;
  get diagnostics cnt = row_count;
  return cnt;
end $$;
revoke execute on function public.bill_student_dues(uuid, uuid) from public, anon, authenticated;

create or replace function public.admit_application(app uuid, p_class uuid, p_section uuid, p_admission_no text default null,
                                                    p_admission_date date default null, p_roll int default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare a record; f jsonb; sid uuid; stu uuid; adm text; c jsonb; pr jsonb; d record; today date := public.today_ist(); billed int;
begin
  select * into a from public.admission_applications where id = app for update;
  if a.id is null then raise exception 'Application not found.'; end if;
  sid := a.school_id;
  if not public.has_perm_school(sid, 'frontdesk.admissions.approve') then raise exception 'not allowed'; end if;
  if a.status <> 'approved' then raise exception 'Only an approved application can be admitted (this one is %).', a.status; end if;
  if p_class is null or not exists (select 1 from public.classes where id = p_class and school_id = sid) then raise exception 'Choose the class.'; end if;
  if p_section is not null and not exists (select 1 from public.sections where id = p_section and class_id = p_class) then raise exception 'The section does not belong to that class.'; end if;
  f := a.form;
  adm := nullif(btrim(coalesce(p_admission_no, '')), '');
  if adm is null then adm := public.next_school_number(sid, 'admission'); end if;
  insert into public.students (school_id, admission_no, first_name, middle_name, last_name, gender, dob, class_id, section_id, roll_no,
      father_name, mother_name, guardian_phone, alt_phone, email, address, city, district, block_tehsil, pincode, state, locality_type, mother_tongue, nationality,
      category, blood_group, permanent_address, previous_school, previous_board, previous_class, name_hi, father_name_hi, mother_name_hi, mobile, street, post_office,
      religion, caste, medium, bpl, admission_date, admission_class_id, application_no, application_id,
      admission_category, previous_year_percent, previous_year_days, distance_km)
  values (sid, adm, btrim(f ->> 'first_name'), nullif(f ->> 'middle_name', ''), nullif(f ->> 'last_name', ''), nullif(f ->> 'gender', ''), nullif(f ->> 'dob', '')::date, p_class, p_section, p_roll,
      nullif(f ->> 'father_name', ''), nullif(f ->> 'mother_name', ''), nullif(f ->> 'guardian_phone', ''), nullif(f ->> 'alt_phone', ''), nullif(f ->> 'email', ''),
      nullif(f ->> 'address', ''), nullif(f ->> 'city', ''), nullif(f ->> 'district', ''), nullif(f ->> 'block_tehsil', ''), nullif(f ->> 'pincode', ''), nullif(f ->> 'state', ''),
      nullif(f ->> 'locality_type', ''), nullif(f ->> 'mother_tongue', ''), coalesce(nullif(f ->> 'nationality', ''), 'Indian'),
      nullif(f ->> 'category', ''), nullif(f ->> 'blood_group', ''), nullif(f ->> 'permanent_address', ''), nullif(f ->> 'previous_school', ''), nullif(f ->> 'previous_board', ''),
      nullif(f ->> 'previous_class', ''), nullif(f ->> 'name_hi', ''), nullif(f ->> 'father_name_hi', ''), nullif(f ->> 'mother_name_hi', ''), nullif(f ->> 'mobile', ''),
      nullif(f ->> 'street', ''), nullif(f ->> 'post_office', ''), nullif(f ->> 'religion', ''), nullif(f ->> 'caste', ''), nullif(f ->> 'medium', ''),
      nullif(f ->> 'bpl', '')::boolean, coalesce(p_admission_date, today), p_class, a.application_no, a.id,
      case when a.rte_applicant then 'rte' else nullif(f ->> 'admission_category', '') end,
      nullif(f ->> 'previous_year_percent', '')::numeric, nullif(f ->> 'previous_year_days', '')::int, nullif(f ->> 'distance_km', '')::numeric)
  returning id into stu;

  -- restricted tier
  if f ?| array['pen','apaar_id','aadhaar_enc','allergies','medical_conditions','medication','disability','disability_type','accommodations'] then
    insert into public.student_sensitive (student_id, school_id, pen, apaar_id, apaar_status, apaar_consent, aadhaar_enc, aadhaar_last4, aadhaar_consent,
        allergies, medical_conditions, medication, disability, disability_type, disability_percent, accommodations)
    values (stu, sid, nullif(f ->> 'pen', ''), nullif(f ->> 'apaar_id', ''), coalesce(nullif(f ->> 'apaar_status', ''), 'not_created'),
        coalesce((f ->> 'apaar_consent')::boolean, false), nullif(f ->> 'aadhaar_enc', ''), nullif(f ->> 'aadhaar_last4', ''),
        coalesce((f ->> 'aadhaar_consent')::boolean, false), nullif(f ->> 'allergies', ''), nullif(f ->> 'medical_conditions', ''), nullif(f ->> 'medication', ''),
        nullif(f ->> 'disability', ''), nullif(f ->> 'disability_type', ''), nullif(f ->> 'disability_percent', '')::numeric, nullif(f ->> 'accommodations', ''))
    on conflict (student_id) do nothing;
  end if;

  -- guardians / emergency / pickup
  for c in select * from jsonb_array_elements(coalesce(f -> 'contacts', '[]'::jsonb)) loop
    declare gid uuid; ph text := nullif(regexp_replace(coalesce(c ->> 'phone', ''), '\D', '', 'g'), '');
    begin
      if coalesce(btrim(c ->> 'name'), '') = '' then continue; end if;
      if ph is not null and length(ph) = 12 and ph like '91%' then ph := substr(ph, 3); end if;
      if ph is not null and ph !~ '^[6-9][0-9]{9}$' then ph := null; end if;
      insert into public.guardians (school_id, name, relation, phone, occupation, is_emergency, can_pickup)
      values (sid, btrim(c ->> 'name'), nullif(c ->> 'relation', ''), ph, nullif(c ->> 'occupation', ''),
              coalesce((c ->> 'is_emergency')::boolean, false) and ph is not null, coalesce((c ->> 'can_pickup')::boolean, false) and ph is not null)
      returning id into gid;
      insert into public.student_guardians (school_id, student_id, guardian_id, is_primary)
      values (sid, stu, gid, coalesce((c ->> 'is_primary')::boolean, false) and not exists (select 1 from public.student_guardians where student_id = stu and is_primary));
    end;
  end loop;

  -- earlier examinations
  for pr in select * from jsonb_array_elements(coalesce(f -> 'prior', '[]'::jsonb)) loop
    if (pr ->> 'level') in ('class8','class9_registration','class9','high_school','class11_registration','intermediate','iti','other') then
      insert into public.student_prior_exams (school_id, student_id, level, board_name, exam_year, roll_no, registration_no, school_name, district_code, school_code, result, percentage)
      values (sid, stu, pr ->> 'level', nullif(pr ->> 'board_name', ''), nullif(pr ->> 'exam_year', '')::int, nullif(pr ->> 'roll_no', ''), nullif(pr ->> 'registration_no', ''),
              nullif(pr ->> 'school_name', ''), nullif(pr ->> 'district_code', ''), nullif(pr ->> 'school_code', ''), nullif(pr ->> 'result', ''), nullif(pr ->> 'percentage', '')::numeric)
      on conflict (student_id, level) do nothing;
    end if;
  end loop;

  -- documents (same private files, now attached to the student)
  for d in select * from public.application_documents where application_id = app loop
    insert into public.student_documents (school_id, student_id, doc_type, title, status, file_path, file_name, mime_type, size_bytes, due_by, uploaded_by, uploaded_by_name,
                                          uploaded_at, verified_by, verified_by_name, verified_at, reject_reason, remark)
    values (sid, stu, d.doc_type, d.title, d.status, d.file_path, d.file_name, d.mime_type, d.size_bytes, d.due_by, d.uploaded_by, d.uploaded_by_name,
            d.uploaded_at, d.verified_by, d.verified_by_name, d.verified_at, d.reject_reason, d.remark)
    on conflict (student_id, doc_type) where doc_type <> 'other' do nothing;
  end loop;

  billed := public.bill_student_dues(sid, stu);
  if a.enquiry_id is not null then update public.enquiries set status = 'admitted', student_id = stu where id = a.enquiry_id and school_id = sid; end if;
  perform set_config('app.admitting', '1', true);
  update public.admission_applications set status = 'admitted', student_id = stu, admitted_on = coalesce(p_admission_date, today), class_id = p_class where id = app;
  perform set_config('app.admitting', '', true);
  return stu;
end $$;

-- seats and demand per class
create or replace function public.admission_seats(sid uuid, sess uuid) returns table (class_id uuid, seats int, active_students bigint, approved bigint, waitlisted bigint, applications bigint)
language sql stable set search_path = public as $$
  select c.id, c.seats,
         (select count(*) from public.students s where s.class_id = c.id and s.status = 'active'),
         (select count(*) from public.admission_applications a where a.class_id = c.id and a.session_id = sess and a.status = 'approved'),
         (select count(*) from public.admission_applications a where a.class_id = c.id and a.session_id = sess and a.status = 'waitlisted'),
         (select count(*) from public.admission_applications a where a.class_id = c.id and a.session_id = sess and a.status not in ('cancelled'))
    from public.classes c where c.school_id = sid order by c.sort;
$$;

-- ═════════════════════════ Audit coverage and masking (extends 0008) ═════════════════════════
create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare o jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
        n jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
        diff jsonb := '{}'; k text; sid uuid;
        masked text[] := case tg_table_name
          when 'students' then array['portal_token','notes','address','permanent_address','street','email','alt_phone','guardian_phone','mobile','blood_group']
          when 'guardians' then array['phone','occupation']
          when 'student_sensitive' then array['allergies','medical_conditions','medication','disability','accommodations','doctor_name','doctor_phone','internal_notes','identity_note','aadhaar_enc','aadhaar_last4']
          when 'student_documents' then array['file_path','file_name']
          when 'application_documents' then array['file_path','file_name']
          when 'admission_applications' then array['form','phone']
          when 'staff' then array['pan','uan','bank_account','ifsc','bank_name','address','phone','email']
          else array[]::text[] end;
begin
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(n) loop
      if k not in ('updated_at','marked_at') and (o -> k) is distinct from (n -> k) then
        diff := diff || jsonb_build_object(k, case when k = any(masked) then jsonb_build_array('•', '•') else jsonb_build_array(o -> k, n -> k) end);
      end if;
    end loop;
    if diff = '{}' then return new; end if;
  end if;
  sid := coalesce((coalesce(n, o) ->> 'school_id')::uuid, case when tg_table_name = 'schools' then (coalesce(n, o) ->> 'id')::uuid end);
  perform public.log_event(lower(tg_op), sid, tg_table_name, coalesce(coalesce(n, o) ->> 'id', coalesce(n, o) ->> 'student_id'),
    case when tg_op = 'UPDATE' then jsonb_build_object('changed', diff)
         when tg_op = 'DELETE' then jsonb_build_object('row', o - masked)
         else jsonb_build_object('row', n - masked) end);
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['admission_applications','application_documents','student_prior_exams','student_board_subjects','classes'] loop
    execute format('drop trigger if exists audit_%1$s on public.%1$I', t);
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function public.audit_row()', t);
  end loop;
end $$;

-- new permission keys for schools that already exist (only adds what is missing)
insert into public.role_permissions (role_id, perm_key, scope)
select r.id, t.perm_key, t.scope
  from public.roles r
  join public.role_template_permissions t on t.template_code = r.template_code
 where t.perm_key like 'frontdesk.admissions.%'
on conflict (role_id, perm_key) do nothing;

-- Helpers that only other (security definer) functions and triggers call: not exposed to the API.
-- (A security-definer function with no permission check is callable by anyone with the API key.)
revoke execute on function public.build_board_snapshot(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.open_enrolment(public.students) from public, anon, authenticated;
revoke execute on function public.lwp_days(uuid, date, date) from public, anon, authenticated;
