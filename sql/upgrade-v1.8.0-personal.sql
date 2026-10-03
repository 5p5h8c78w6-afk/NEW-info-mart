-- Infomart 発注ナビ v1.8.0: additive upgrade for the existing v1.7.1 project.
-- Run in Supabase SQL Editor. No existing tables, policies or data are replaced.
begin;
create table if not exists public.personal_settings (
  user_id uuid not null references auth.users(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  version bigint not null check(version > 0),
  master_version bigint not null,
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  primary key(user_id, org_id)
);
alter table public.personal_settings enable row level security;
revoke all on public.personal_settings from public, anon, authenticated;
grant select on public.personal_settings to authenticated;
drop policy if exists personal_select_self on public.personal_settings;
create policy personal_select_self on public.personal_settings for select to authenticated
using(user_id=(select auth.uid()) and private.is_org_member(org_id));

-- No direct insert/update/delete permission. The sole write entry point derives
-- identity from auth.uid(), checks membership, validates scope and atomically CASes.
create or replace function public.save_personal_settings(
  p_org uuid, p_expected_version bigint, p_master_version bigint, p_payload jsonb
) returns public.personal_settings
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_master public.shared_master;
  v_result public.personal_settings;
  v_item jsonb; v_preset jsonb; v_ref jsonb; v_product jsonb;
  v_seen text[]; v_ids text[] := '{}';
  v_qty numeric; v_date date;
begin
  if v_uid is null or not exists(select 1 from public.org_members where user_id=v_uid and org_id=p_org) then
    raise exception 'personal_not_authorized';
  end if;
  if p_expected_version is null or p_expected_version<0 or p_master_version is null then raise exception 'personal_invalid'; end if;
  -- Serialize against master updates while references are validated.
  select * into v_master from public.shared_master where org_id=p_org for share;
  if not found or v_master.master_version<>p_master_version then raise exception 'personal_master_conflict'; end if;
  if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'personal_invalid'; end if;
  if p_payload->'schema' is distinct from '1'::jsonb
    or jsonb_typeof(p_payload->'products') is distinct from 'array'
    or jsonb_typeof(p_payload->'presets') is distinct from 'array'
    or exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('schema','products','presets'))
    or octet_length(p_payload::text)>2000000 then raise exception 'personal_invalid'; end if;
  -- Reject ambiguous master identities even when supplied through another client.
  if jsonb_typeof(v_master.payload->'products') is distinct from 'array'
    or exists(select 1 from jsonb_array_elements(v_master.payload->'products') p group by p->>'id' having count(*)>1)
    or exists(select 1 from jsonb_array_elements(v_master.payload->'products') p group by p->>'code' having count(*)>1) then raise exception 'personal_invalid_master'; end if;
  v_seen := '{}';
  for v_item in select value from jsonb_array_elements(p_payload->'products') loop
    if jsonb_typeof(v_item) is distinct from 'object' then raise exception 'personal_invalid'; end if;
    if exists(select 1 from jsonb_object_keys(v_item) k where k not in ('productId','code','defaultQty','intervalMode','intervalDays','firstOrderDate'))
      or jsonb_typeof(v_item->'productId') is distinct from 'string' or jsonb_typeof(v_item->'code') is distinct from 'string'
      or (v_item->>'productId')=any(v_seen) then raise exception 'personal_invalid'; end if;
    v_seen := array_append(v_seen,v_item->>'productId');
    select p into v_product from jsonb_array_elements(v_master.payload->'products') p where p->>'id'=v_item->>'productId' and p->>'code'=v_item->>'code';
    if not found then raise exception 'personal_unknown_product'; end if;
    if jsonb_typeof(v_item->'defaultQty') is distinct from 'number' or jsonb_typeof(v_item->'intervalDays') is distinct from 'number'
      or coalesce(v_item->>'intervalMode','') not in ('daily','n') or jsonb_typeof(v_item->'firstOrderDate') is distinct from 'string' then raise exception 'personal_invalid'; end if;
    v_qty := (v_item->>'defaultQty')::numeric;
    if v_qty<0 or v_qty>1000000000 or (coalesce(v_product->'allowDecimalQty','false'::jsonb)<>'true'::jsonb and trunc(v_qty)<>v_qty)
      or (v_item->>'intervalDays')::numeric<1 or (v_item->>'intervalDays')::numeric>60
      or trunc((v_item->>'intervalDays')::numeric)<>(v_item->>'intervalDays')::numeric
      or (v_item->>'intervalMode'='daily' and (v_item->>'intervalDays')::numeric<>1)
      or (v_item->>'firstOrderDate')!~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'personal_invalid'; end if;
    v_date := (v_item->>'firstOrderDate')::date;
    if to_char(v_date,'YYYY-MM-DD')<>v_item->>'firstOrderDate' then raise exception 'personal_invalid'; end if;
  end loop;
  for v_preset in select value from jsonb_array_elements(p_payload->'presets') loop
    if jsonb_typeof(v_preset) is distinct from 'object' then raise exception 'personal_invalid'; end if;
    if exists(select 1 from jsonb_object_keys(v_preset) k where k not in ('id','name','items'))
      or jsonb_typeof(v_preset->'id') is distinct from 'string' or coalesce(v_preset->>'id','')=''
      or (v_preset->>'id')=any(v_ids) or jsonb_typeof(v_preset->'name') is distinct from 'string'
      or char_length(btrim(v_preset->>'name')) not between 1 and 200
      or jsonb_typeof(v_preset->'items') is distinct from 'array' then raise exception 'personal_invalid'; end if;
    if jsonb_array_length(v_preset->'items')=0 then raise exception 'personal_invalid'; end if;
    v_ids := array_append(v_ids,v_preset->>'id'); v_seen := '{}';
    for v_ref in select value from jsonb_array_elements(v_preset->'items') loop
      if jsonb_typeof(v_ref) is distinct from 'object' then raise exception 'personal_invalid'; end if;
      if exists(select 1 from jsonb_object_keys(v_ref) k where k not in ('productId','code','qty'))
        or jsonb_typeof(v_ref->'productId') is distinct from 'string' or jsonb_typeof(v_ref->'code') is distinct from 'string'
        or (v_ref->>'productId')=any(v_seen) or jsonb_typeof(v_ref->'qty') is distinct from 'number' then raise exception 'personal_invalid'; end if;
      v_seen := array_append(v_seen,v_ref->>'productId');
      select p into v_product from jsonb_array_elements(v_master.payload->'products') p where p->>'id'=v_ref->>'productId' and p->>'code'=v_ref->>'code';
      if not found then raise exception 'personal_unknown_product'; end if;
      v_qty := (v_ref->>'qty')::numeric;
      if v_qty<0 or v_qty>1000000000 or (coalesce(v_product->'allowDecimalQty','false'::jsonb)<>'true'::jsonb and trunc(v_qty)<>v_qty) then raise exception 'personal_invalid'; end if;
    end loop;
  end loop;
  if p_expected_version=0 then
    insert into public.personal_settings(user_id,org_id,version,master_version,payload)
    values(v_uid,p_org,1,p_master_version,p_payload) on conflict do nothing returning * into v_result;
  else
    update public.personal_settings set version=version+1,master_version=p_master_version,payload=p_payload,updated_at=clock_timestamp()
    where user_id=v_uid and org_id=p_org and version=p_expected_version returning * into v_result;
  end if;
  if v_result.user_id is null then raise exception 'personal_version_conflict'; end if;
  return v_result;
end;
$$;
revoke all on function public.save_personal_settings(uuid,bigint,bigint,jsonb) from public, anon;
grant execute on function public.save_personal_settings(uuid,bigint,bigint,jsonb) to authenticated;
notify pgrst, 'reload schema';
commit;
