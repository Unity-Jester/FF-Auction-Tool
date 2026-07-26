# Optional strategy saving

The app is browser-first. With no environment variables, incomplete variables, an
invalid URL, a signed-out session, unavailable browser storage, or an unavailable
Supabase project, the draft connection and live companion continue to work without
an account. The optional database stores named strategy configuration records only.
It does not store draft history, live purchases, projections, Sleeper responses, or
analytics.

## Free-tier decision (checked July 26, 2026)

This narrow feature is viable on Supabase's Free Plan. The official billing
documentation currently includes two free projects, 500 MB of database data per
project, 50,000 monthly active users, and 5 GB of egress. Free projects can pause
after a week of inactivity, so cloud saving is a convenience rather than a core
dependency:

- [Supabase billing and Free Plan quotas](https://supabase.com/docs/guides/platform/billing-on-supabase)
- [Supabase pricing and inactivity behavior](https://supabase.com/pricing)
- [Supabase Free Plan cost controls](https://supabase.com/docs/guides/platform/cost-control)

Each strategy is limited to 32 KB and each name to 80 characters in both application
validation and the database migration. Even so, monitor record counts and database
usage; authenticated users can create multiple small records, and row-level security
is authorization rather than rate limiting. The Supabase Auth magic-link endpoint
has project and per-user rate limits, and the built-in email provider is intended
for testing rather than production:

- [Supabase Auth rate limits](https://supabase.com/docs/guides/auth/rate-limits)
- [Supabase custom SMTP limitations](https://supabase.com/docs/guides/auth/auth-smtp)

## Enabling the optional account

1. Create a Supabase project and apply
   `supabase/migrations/202607250001_saved_strategies.sql`.
2. Add the deployed site URL and `/auth/callback` URL to Supabase Auth's redirect
   allowlist.
3. Configure only these public values:

   ```text
   NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-public-anon-key
   ```

Never expose a service-role or secret key to the browser. The migration revokes
anonymous table access, grants only the four required operations to authenticated
users, forces row-level security, and prevents changing a record's owner.
