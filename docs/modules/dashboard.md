# Dashboard

> Status: Built · Catalogue: `dashboard.overview` (core) · Route: `/app` (`src/app/app/page.tsx`)

## Purpose
The first screen after login: today's picture of the school.

## What's on it
Greeting, active students, today's attendance % (marked sections / absent count), today's and this month's fee collection, overdue fees and number of students owing, latest receipts, admission follow-ups due today, latest notices. Cards appear only if the user has the matching permission (`fees.collection.view`, `frontdesk.enquiries.view`, …). Shows `?denied=1` message when `requirePerm` bounced the user here.

## Data
SQL functions (run with the user's rights, so RLS applies): `attendance_summary(sid, on_day)`, `class_counts(sid)`, `fee_summary(sid, sess, on_day)` → billed, collected, overdue, overdue_students, today, today_count, month. Aggregates are SQL so numbers stay right beyond PostgREST's 1,000-row limit.

## Gaps & ideas
Widgets for the step-5 modules: staff on leave today, pending leave approvals, books overdue, vehicle papers expiring, homework posted today, salaries unpaid. Birthday list. Per-role dashboards (teacher: my sections' attendance, my homework).
