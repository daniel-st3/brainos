-- A single, explicitly started ten-day editorial experiment. No automatic analytics.
create table public.pilot_config (
 id boolean primary key default true check(id), starts_on date not null,
 created_at timestamptz not null default now(), actor text not null
);
create table public.pilot_days (
 day date primary key,
 brief_minutes numeric not null check(brief_minutes between 0 and 240),
 manual_minutes numeric not null check(manual_minutes between 0 and 240),
 manual_candidates integer not null check(manual_candidates between 0 and 500),
 manual_useful integer not null check(manual_useful between 0 and manual_candidates),
 brief_useful integer not null check(brief_useful between 0 and 500),
 verdict text not null check(verdict in ('system_better','manual_better','about_equal','undecided')),
 notes text not null default '' check(length(notes)<=5000),
 updated_at timestamptz not null default now(), actor text not null
);
alter table public.pilot_config enable row level security;
alter table public.pilot_days enable row level security;
revoke all on public.pilot_config,public.pilot_days from anon,authenticated;
grant all on public.pilot_config,public.pilot_days to service_role;
create function public.start_pilot(p_start date,p_actor text) returns void language plpgsql security invoker set search_path=public as $$
declare chosen date; begin
 if p_start is null then raise exception 'Start date required'; end if;
 insert into public.pilot_config(starts_on,actor) values(p_start,p_actor) on conflict(id) do nothing;
 select starts_on into chosen from public.pilot_config;
 if chosen<>p_start then raise exception 'The pilot already has a start date'; end if;
end $$;
create function public.save_pilot_day(p_day jsonb,p_actor text) returns void language plpgsql security invoker set search_path=public as $$
declare starts date; target date; begin
 select starts_on into starts from public.pilot_config;
 if starts is null then raise exception 'Start the pilot first'; end if;
 target:=(p_day->>'day')::date;
 if target is null or target<starts or target>starts+9 then raise exception 'Day is outside the ten-day pilot'; end if;
 if target > (now() at time zone 'America/Bogota')::date then raise exception 'Future days cannot be logged'; end if;
 insert into public.pilot_days select * from jsonb_populate_record(null::public.pilot_days,p_day || jsonb_build_object('actor',p_actor,'updated_at',now()))
 on conflict(day) do update set brief_minutes=excluded.brief_minutes,manual_minutes=excluded.manual_minutes,
 manual_candidates=excluded.manual_candidates,manual_useful=excluded.manual_useful,brief_useful=excluded.brief_useful,
 verdict=excluded.verdict,notes=excluded.notes,updated_at=excluded.updated_at,actor=excluded.actor;
end $$;
create function public.read_pilot_study() returns jsonb language sql stable security invoker set search_path=public as $$
 select jsonb_build_object('config',(select to_jsonb(c) from public.pilot_config c),'days',coalesce((select jsonb_agg(to_jsonb(d) order by day) from public.pilot_days d),'[]'::jsonb));
$$;
revoke all on function public.start_pilot(date,text),public.save_pilot_day(jsonb,text),public.read_pilot_study() from public,anon,authenticated;
grant execute on function public.start_pilot(date,text),public.save_pilot_day(jsonb,text),public.read_pilot_study() to service_role;
