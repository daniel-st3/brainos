/** Run locally with private env. Never prints bearer secrets or SQL containing them. */
export {};
const project = process.env.SUPABASE_PROJECT_REF,
  token = process.env.SUPABASE_ACCESS_TOKEN,
  secret = process.env.BRAINOS_SCHEDULER_SECRET,
  origin = process.env.CONTENT_OS_ORIGIN,
  bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
if (
  !project ||
  !token ||
  !secret ||
  secret.length < 32 ||
  !origin ||
  new URL(origin).protocol !== "https:"
)
  throw Error("Private scheduler configuration required");
const quote = (s: string) => "'" + s.replaceAll("'", "''") + "'";
async function sql(query: string) {
  const r = await fetch(
    `https://api.supabase.com/v1/projects/${project}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(30000),
    },
  );
  if (!r.ok)
    throw Error(`Scheduler setup failed (${r.status}); no SQL/secret logged`);
  return r.json();
}
await sql(
  "create extension if not exists pg_cron; create extension if not exists pg_net;",
);
for (const [name, value] of [
  ["brainos_scheduler_secret", secret],
  ["brainos_scheduler_origin", origin],
  ["brainos_scheduler_bypass", bypass ?? ""],
] as const)
  await sql(
    `do $$ declare v uuid; begin select id into v from vault.secrets where name=${quote(name)}; if v is null then perform vault.create_secret(${quote(value)},${quote(name)}); else perform vault.update_secret(v,${quote(value)}); end if; end $$;`,
  );
await sql(`create or replace function public.dispatch_brainos_automation(p_lane text,p_event text default 'schedule') returns bigint language plpgsql security definer set search_path=public,net,vault as $$
declare target text; bearer text; bypass text; headers jsonb; begin
 if p_lane not in ('discovery','operations') or p_event not in ('schedule','manual') then raise exception 'Unknown automation'; end if;
 select decrypted_secret into target from vault.decrypted_secrets where name='brainos_scheduler_origin';
 select decrypted_secret into bearer from vault.decrypted_secrets where name='brainos_scheduler_secret';
 select decrypted_secret into bypass from vault.decrypted_secrets where name='brainos_scheduler_bypass';
 headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||bearer);
 if length(bypass)>0 then headers:=headers||jsonb_build_object('x-vercel-protection-bypass',bypass); end if;
 return net.http_post(url:=target||'/api/automation',body:=jsonb_build_object('lane',p_lane,'event',p_event),headers:=headers,timeout_milliseconds:=300000);
end $$;
revoke all on function public.dispatch_brainos_automation(text,text) from public,anon,authenticated;
select cron.schedule('brainos-discovery','30 11 * * *',$job$select public.dispatch_brainos_automation('discovery');$job$);
select cron.schedule('brainos-operations','17 * * * *',$job$select public.dispatch_brainos_automation('operations');$job$);`);
console.log(
  "Supabase Cron installed: daily 11:30 UTC discovery; hourly minute 17 operations. Secret values stored only in Vault.",
);
