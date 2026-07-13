-- Approval responses — Blueprint §2.2 / UF-4 evening approval gate.
-- The customer responds to a pending plan; the response is recorded on the
-- approvals row and mirrored to the audit log. Owner-callable (RLS already
-- lets owners update their own approvals via the 0001 "approval respond"
-- policy); this function centralises the state transition + audit.

create or replace function respond_to_approval(
  p_approval_id uuid,
  p_response text  -- 'approved' | 'regenerating' | 'swapped'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business_id uuid;
  v_owner uuid;
begin
  if p_response not in ('approved', 'regenerating', 'swapped') then
    raise exception 'invalid response %', p_response;
  end if;

  select a.business_id, b.owner_id into v_business_id, v_owner
  from approvals a join businesses b on b.id = a.business_id
  where a.id = p_approval_id;

  if v_business_id is null then
    raise exception 'approval not found';
  end if;
  if v_owner is distinct from auth.uid() then
    raise exception 'not your approval';
  end if;

  update approvals
     set status = p_response::approval_status,
         responded_at = now()
   where id = p_approval_id;

  insert into audit_log (business_id, actor, action, detail)
  values (v_business_id, 'user', 'approval_' || p_response,
          jsonb_build_object('approval_id', p_approval_id));
end $$;

revoke all on function respond_to_approval(uuid, text) from public, anon;
grant execute on function respond_to_approval(uuid, text) to authenticated;
