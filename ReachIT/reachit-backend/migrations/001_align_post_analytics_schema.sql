-- 001_align_post_analytics_schema.sql
--
-- Gleicht das Datenbank-Schema an den Code an. Bis hierher lief beides
-- auseinander: connected_accounts wurde befuellt, posts und post_targets
-- blieben leer, weil jeder Insert an einem Constraint scheiterte. Da
-- PostLogService Fehler bewusst nur per console.error meldet (Logging darf
-- den Post-Vorgang nie abbrechen), ist das nie aufgefallen.
--
-- Ausfuehren: Supabase Dashboard -> SQL Editor -> komplett einfuegen -> Run

begin;

-- 1. LinkedIn fehlte in der erlaubten Plattform-Liste. Der OAuth-Callback
--    scheiterte deshalb beim Upsert am CHECK-Constraint und endete in
--    "Verbindung fehlgeschlagen." - das ist der offene LinkedIn-Bug.
alter table public.connected_accounts
  drop constraint connected_accounts_platform_check;
alter table public.connected_accounts
  add constraint connected_accounts_platform_check
  check (platform in ('instagram','tiktok','threads','linkedin','pinterest','x','youtube'));

-- 2. posts.media_url war NOT NULL ohne Default, wird vom Logging aber nie
--    gesetzt. Medien liegen nur temporaer in R2 und werden nach dem Publish
--    geloescht; TikTok und LinkedIn nutzen R2 ueberhaupt nicht.
alter table public.posts
  alter column media_url drop not null;

-- 3. posts.media_type liess nur 'image' und 'video' zu. Threads- und
--    LinkedIn-Textposts protokollieren 'text'.
alter table public.posts
  drop constraint posts_media_type_check;
alter table public.posts
  add constraint posts_media_type_check
  check (media_type in ('text','image','video'));

-- 4. post_targets.platform fehlte komplett, wurde vom Code aber geschrieben.
--    Bleibt zusaetzlich zu connected_account_id erhalten, damit die Auswertung
--    auch dann noch stimmt, wenn ein Konto spaeter getrennt wird.
alter table public.post_targets
  add column platform text;
alter table public.post_targets
  add constraint post_targets_platform_check
  check (platform in ('instagram','tiktok','threads','linkedin','pinterest','x','youtube'));

-- 5. Spaltenname an Code und Uebergabe-Doku angleichen.
alter table public.post_targets
  rename column platform_post_id to external_id;

-- 6. Der Code schreibt 'failed', die DB erlaubte an dieser Stelle nur 'error'.
alter table public.post_targets
  drop constraint post_targets_status_check;
alter table public.post_targets
  add constraint post_targets_status_check
  check (status in ('pending','success','failed'));

-- 7. connected_account_id optional. Im Fehlerpfad ist das verbundene Konto
--    unter Umstaenden nicht bekannt - eine NOT-NULL-Spalte wuerde genau den
--    Fehler zurueckbringen, den diese Migration behebt.
alter table public.post_targets
  alter column connected_account_id drop not null;

commit;
