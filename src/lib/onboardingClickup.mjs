function compact(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function onboardingPayloadFromRow(row = {}) {
  if (row._source === 'onboarding_requests') return row;
  const marker = 'Raw intake:\n';
  const message = String(row.message || '');
  const markerIndex = message.indexOf(marker);
  if (markerIndex < 0) return row;
  try {
    const intake = JSON.parse(message.slice(markerIndex + marker.length));
    return { ...intake, ...row };
  } catch {
    return row;
  }
}

function formatConfirmedProfile(profile = {}) {
  return [
    `Mission / vision / values:\n${profile.mission_vision_values || 'Needs review'}`,
    '',
    `Strategic priorities / focus areas:\n${profile.strategic_priorities || 'Needs review'}`,
    '',
    `Official social handles:\n${profile.social_handles || 'None confirmed'}`,
    '',
    `Keywords / nicknames / mascots:\n${profile.keywords || 'None confirmed'}`,
    '',
    `School names:\n${profile.school_names || 'None confirmed'}`,
    '',
    `Known exclusions / lookalikes:\n${profile.known_exclusions || 'None confirmed'}`,
    '',
    `Public pages reviewed:\n${profile.discovered_source_urls || 'Not captured'}`,
    '',
    `Customer confirmation notes:\n${profile.discovery_notes || 'None'}`,
  ].join('\n');
}

export function buildOnboardingTask(input) {
  const request = onboardingPayloadFromRow(input);
  const organizationName = request.organization_name || request.district_name;
  const configured = process.env.CLICKUP_ONBOARDING_TAGS;
  const tags = configured
    ? configured.split(',').map((tag) => tag.trim()).filter(Boolean)
    : ['trial-onboarding', 'canary-data'];
  return {
    name: `[Trial onboarding] ${compact(organizationName) || 'New district'}`,
    markdown_content: [
      '## 30-day trial onboarding request',
      '',
      '### Contact',
      `Name: ${request.contact_name || 'Unknown'}`,
      `Email: ${request.contact_email || 'Unknown'}`,
      `Title: ${request.contact_title || 'Unknown'}`,
      '',
      '### District / organization',
      `Organization: ${organizationName || 'Unknown'}`,
      `Website: ${request.website || 'Unknown'}`,
      `Location: ${[request.city, request.state, request.zip].filter(Boolean).join(', ') || 'Unknown'}`,
      '',
      '### Setup inputs',
      `Social handles / URLs:\n${request.social_handles || 'None provided'}`,
      '',
      `Keywords / nicknames / mascots:\n${request.keywords || 'None provided'}`,
      '',
      `School names:\n${request.school_names || 'None provided'}`,
      '',
      `Known exclusions / lookalikes:\n${request.known_exclusions || 'None provided'}`,
      '',
      `Current monitoring provider:\n${request.current_monitoring || 'None provided'}`,
      '',
      `Notes:\n${request.notes || 'None provided'}`,
      '',
      '### Customer-confirmed setup draft',
      formatConfirmedProfile(request.confirmed_profile || {}),
      '',
      '---',
      `Onboarding request ID: ${request.id || 'Not stored yet'}`,
      `Submitted: ${request.created_at || new Date().toISOString()}`,
      '',
      '### Intended workflow',
      '1. Auto-discover mission/vision/values, strategic plan language, official handles, schools, additive signals, and lookalike exclusions.',
      '2. Admin reviews/edits discovered setup.',
      '3. Customer confirms strategic language and handles if needed.',
      '4. Canary runs clean-results test/backfill, including an explicit official-domain newsroom coverage check when the district publishes releases. Record a provider limitation rather than representing owned coverage as complete when those releases are not discoverable.',
      '5. Admin creates the protected login, verifies tenant scope, and starts the 30-day trial.',
      '6. For internal QA, Lesley or another authorized administrator should review the district through the authenticated admin dashboard; client credentials are not required for admin review.',
      '7. After acceptance, send the customer the login URL and their confirmed login email. The customer uses Forgot Password to set their own password; the 8-digit recovery code goes directly to the customer’s login email.',
      '8. Do not place a reusable password in ClickUp, email, or a shared tracker.',
      '9. If the signed-in client is approved for card payment, tell them to log in and open: https://www.canarydata.media/payment',
      '10. The payment page derives district/account and billing email from the authenticated login; do not send public/prefilled payment links.',
      '11. Check/ACH can still be handled manually when needed.',
    ].join('\n'),
    tags,
  };
}
