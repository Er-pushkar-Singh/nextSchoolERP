# Help & support desk

> Status: Built · Catalogue: `support.tickets` (core) · Migration: `0005_platform.sql`

## Purpose
Schools raise tickets to CodersDuniya from inside the ERP; the platform team answers from `/platform/support`.

## Screens
| Route | Who | What |
|---|---|---|
| `/app/support`, `/app/support/[id]` | school staff (`support.tickets.view/create`; own scope for most roles) | Raise a ticket, conversation thread |
| `/platform/support`, `/platform/support/[id]` | platform `support` area | Queue, reply, internal notes, status & priority |

## Server actions
School: `createTicket, replyTicketSchool` (`src/app/app/_actions/support.ts`). Platform: `replyTicket, updateTicket` (`src/app/platform/_actions/ops.ts`).

## Database
`tickets(number, school_id, subject, category question|bug|billing|feature|data|other, priority low…urgent, status open|pending|resolved|closed, assigned_to)`, `ticket_messages(ticket_id, author_name, from_platform, internal, body)`, trigger `touch_ticket`. Internal notes are hidden from schools.

## Gaps & ideas
Email / WhatsApp notification on reply, SLA timers, attachments, canned replies, link a ticket to a support session.
