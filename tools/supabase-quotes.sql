-- Quote requests in your own Supabase project (choose an EU region, e.g. Stockholm or Frankfurt).
-- Run once in Supabase -> SQL editor. The website uses the PUBLIC "anon" key, which can only INSERT rows
-- (row-level security); nobody on the internet can read, change or delete them. You read them in the dashboard.
create table if not exists public.quote_requests (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  name        text not null check (char_length(name)    between 1 and 200),
  company     text          check (char_length(company) <= 200),
  email       text not null check (char_length(email)   between 3 and 200),
  phone       text          check (char_length(phone)   <= 60),
  message     text not null check (char_length(message) between 1 and 5000),
  consent     boolean not null check (consent),
  lang        text,
  page        text
);

alter table public.quote_requests enable row level security;

drop policy if exists "anyone can submit a quote request" on public.quote_requests;
create policy "anyone can submit a quote request"
  on public.quote_requests for insert to anon
  with check (true);
-- No select/update/delete policy for anon: they are denied by default.

-- Data minimisation: delete requests older than 12 months (adjust to your privacy policy).
-- Needs the pg_cron extension (Database -> Extensions):
-- select cron.schedule('purge-old-quotes', '0 3 * * *', $$ delete from public.quote_requests where created_at < now() - interval '12 months' $$);
