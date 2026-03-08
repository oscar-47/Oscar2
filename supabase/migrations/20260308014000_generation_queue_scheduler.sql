create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  create extension if not exists vault;
exception
  when others then
    raise notice 'Skipping vault extension setup: %', sqlerrm;
end
$$;

create or replace function public.refresh_generation_queue_schedule()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_url text;
  v_publishable_key text;
  v_worker_secret text;
  v_command text;
begin
  if to_regclass('vault.decrypted_secrets') is null then
    raise notice 'Skipping generation queue cron schedule: vault extension unavailable.';
    return;
  end if;

  select decrypted_secret into v_project_url
  from vault.decrypted_secrets
  where name = 'generation_queue_project_url';

  select decrypted_secret into v_publishable_key
  from vault.decrypted_secrets
  where name = 'generation_queue_publishable_key';

  select decrypted_secret into v_worker_secret
  from vault.decrypted_secrets
  where name = 'generation_queue_worker_secret';

  if coalesce(v_project_url, '') = '' or coalesce(v_publishable_key, '') = '' or coalesce(v_worker_secret, '') = '' then
    raise notice 'Skipping generation queue cron schedule: missing vault secrets.';
    return;
  end if;

  perform cron.unschedule(jobid)
  from cron.job
  where jobname = 'drain-generation-queue-every-minute';

  v_command := format(
    $cmd$
      select net.http_post(
        url := %L,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || %L,
          'x-worker-secret', %L
        ),
        body := jsonb_build_object('source', 'pg_cron')
      ) as request_id;
    $cmd$,
    regexp_replace(v_project_url, '/+$', '') || '/functions/v1/drain-generation-queue',
    v_publishable_key,
    v_worker_secret
  );

  perform cron.schedule(
    'drain-generation-queue-every-minute',
    '* * * * *',
    v_command
  );
end;
$$;

select public.refresh_generation_queue_schedule();
