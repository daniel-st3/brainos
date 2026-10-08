-- Hosted-only dispatcher: no second timer, no production endpoint fallback.
create function public.dispatch_creator_discovery() returns bigint language plpgsql security definer set search_path=public as $$
declare target text; bearer text; bypass text; headers jsonb;
begin
 select decrypted_secret into target from vault.decrypted_secrets where name='brainos_creator_staging_origin';
 select decrypted_secret into bearer from vault.decrypted_secrets where name='brainos_scheduler_secret';
 select decrypted_secret into bypass from vault.decrypted_secrets where name='brainos_scheduler_bypass';
 if target is null or target !~ '^https://brainos-[a-z0-9]+-daniel-st3s-projects\.vercel\.app$' or length(bearer)<32 then raise exception 'Creator staging runtime not configured'; end if;
 headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||bearer);
 if length(bypass)>0 then headers:=headers||jsonb_build_object('x-vercel-protection-bypass',bypass); end if;
 return net.http_post(url:=target||'/api/creator-discovery',body:='{}'::jsonb,headers:=headers,timeout_milliseconds:=120000);
end $$;
revoke all on function public.dispatch_creator_discovery() from public,anon,authenticated;
