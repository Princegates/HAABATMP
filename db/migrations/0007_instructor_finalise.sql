-- A Super Administrator can give an individual instructor the right to finalise and release results.
-- Off by default. It is only honoured for instructors, and only on programmes they lead or teach.
alter table users add column can_finalise_results boolean not null default false;
