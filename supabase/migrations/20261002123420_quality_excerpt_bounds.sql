-- Capture groups inside a custom rule must not truncate the retained warning excerpt.
create or replace function public.control_draft_quality() returns trigger language plpgsql security invoker set search_path=public as $$
declare issues jsonb:='[]'; rule jsonb; rules jsonb; excerpt text; copy text:=new.hook||E'\n'||new.body||E'\n'||new.cta; begin
 select data->'rules' into rules from control_entities where kind='brand' and data->>'status'='active' and is_demo=(select is_demo from stories where id=new.story_id);
 rules:=coalesce(rules,'[{"id":"contrast","pattern":"No es .{1,100},? (es|sino) .{1,100}","severity":"medium","remediation":"State the concrete point directly"},{"id":"generic_question","pattern":"¿Por qué importa|¿Qué probarías|¿Qué opinas","severity":"medium","remediation":"Offer a specific useful next action"},{"id":"ai_phrase","pattern":"Hay un matiz importante|en el mundo de hoy|revolucionari[oa]|game.?changer|sin lugar a dudas","severity":"medium","remediation":"Replace canned language with evidence"},{"id":"false_experience","pattern":"yo probé|he probado|mi experiencia demuestra|comprobé personalmente","severity":"high","remediation":"Require evidence of Daniel performing this test"}]'::jsonb);
 for rule in select value from jsonb_array_elements(rules) loop
 begin
 excerpt:=substring(copy from '(?i)('||(rule->>'pattern')||')');
 if excerpt is not null then issues:=issues||jsonb_build_array(jsonb_build_object('rule',rule->>'id','severity',rule->>'severity','excerpt',excerpt,'start',position(excerpt in copy)-1,'end',position(excerpt in copy)-1+length(excerpt),'remediation',rule->>'remediation','review_status','open')); end if;
 exception when invalid_regular_expression then issues:=issues||jsonb_build_array(jsonb_build_object('rule',rule->>'id','severity','high','excerpt','','start',0,'end',0,'remediation','Rule syntax requires repair; draft was not mutated','review_status','open'));
 end;
 end loop;
 insert into control_entities(id,kind,version,story_id,draft_id,is_demo,data) values(new.id,'quality',1,new.story_id,new.id,(select is_demo from stories where id=new.story_id),jsonb_build_object('draft_id',new.id,'draft_revision',new.revision,'algorithm','deterministic-quality/v1','created_at',now(),'issues',issues));
 return new;
end $$;
