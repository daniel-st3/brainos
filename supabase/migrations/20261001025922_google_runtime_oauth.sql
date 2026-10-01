-- Runtime OAuth credentials are encrypted by the application before persistence.
-- The encryption key remains in runtime secret storage, never in this database.
create table public.runtime_connections (
 provider text primary key check(provider='google'),
 encrypted_refresh_token text not null check(length(encrypted_refresh_token) between 40 and 20000),
 scopes text[] not null, authorized_by text not null,
 authorized_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.runtime_connections enable row level security;
revoke all on public.runtime_connections from public,anon,authenticated;
grant all on public.runtime_connections to service_role;
create function public.save_google_connection(p_ciphertext text,p_scopes jsonb,p_actor text) returns void
language plpgsql security invoker set search_path=public as $$
begin
 if coalesce(length(p_actor),0)=0 then raise exception 'Authenticated editor required'; end if;
 insert into runtime_connections(provider,encrypted_refresh_token,scopes,authorized_by)
 values('google',p_ciphertext,array(select jsonb_array_elements_text(p_scopes)),p_actor)
 on conflict(provider) do update set encrypted_refresh_token=excluded.encrypted_refresh_token,
 scopes=excluded.scopes,authorized_by=excluded.authorized_by,authorized_at=now(),updated_at=now();
end $$;
create function public.read_google_connection() returns jsonb language sql stable security invoker set search_path=public as $$
 select to_jsonb(c) from runtime_connections c where provider='google';
$$;
revoke all on function public.save_google_connection(text,jsonb,text),public.read_google_connection() from public,anon,authenticated;
grant execute on function public.save_google_connection(text,jsonb,text),public.read_google_connection() to service_role;
