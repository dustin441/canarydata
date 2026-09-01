begin;

-- Post-use rollback is intentionally forward-only: disable new writes while
-- preserving attestation columns, action constraint, and immutable history.
revoke execute on function public.canary_set_story_communications_earned(uuid, uuid, boolean, integer)
  from service_role;

comment on function public.canary_set_story_communications_earned(uuid, uuid, boolean, integer) is
  'DISABLED by post-use forward rollback. Columns and mark/unmark audit events are preserved; direct writes remain blocked by database guards.';

commit;
