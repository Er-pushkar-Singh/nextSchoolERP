# Notices

> Status: Built · Catalogue: `comms.notices`, `comms.broadcast` (built); `comms.templates`, `comms.calendar`, `comms.messages` (not yet) · Route: `/app/notices`

## Purpose
Circulars for the whole school or one class, shown on every parent page and copyable to WhatsApp groups.

## Screens
`/app/notices` — new notice (title, details, whole school or a class, date) for `comms.notices.create`; list with "Copy for WhatsApp group"; delete (`comms.notices.delete`).

## Server actions
`saveNotice`, `deleteNotice` in `src/app/app/_actions/academics.ts`.

## Database
`notices(title, body, class_id null = whole school, published_on, created_by)`.

## Connects to
Dashboard (latest), parent page (latest 10 for the child's class + whole school).

## Gaps & ideas
School calendar / holidays (`comms.calendar`), message templates (`comms.templates`), two-way parent–teacher messages (`comms.messages`), send via SMS/WhatsApp/email integrations, attachments (Cloudinary), read receipts.
