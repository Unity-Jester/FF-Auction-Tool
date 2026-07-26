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

Each user can save at most 50 strategies. The database save function serializes
quota checks per user so parallel requests cannot exceed that limit, while updates
to an existing strategy do not consume another slot. Each strategy is limited to
32 KB and each name to 80 characters in both application validation and the
database migration. Application validation conservatively estimates PostgreSQL's
expanded `jsonb::text` representation before sending or storing the record.

The Supabase Auth magic-link endpoint has project and per-user rate limits. The
built-in email provider is explicitly not suitable for a public production
deployment:

- [Supabase Auth rate limits](https://supabase.com/docs/guides/auth/rate-limits)
- [Supabase custom SMTP limitations](https://supabase.com/docs/guides/auth/auth-smtp)

## Enabling the optional account

1. Create a Supabase project and apply
   `supabase/migrations/202607250001_saved_strategies.sql`.
2. In **Authentication → URL Configuration**, set the production site URL and add
   the exact production `/auth/callback` URL to the redirect allowlist. Add separate
   exact localhost and preview URLs only when they are genuinely needed.
3. Configure a custom SMTP provider under **Authentication → Emails → SMTP
   Settings**. Supabase's built-in sender only delivers to project-team addresses,
   is limited to roughly two messages per hour, and is not a production sender.
   SMTP services may offer free tiers, but confirm the chosen provider's current
   terms and keep Supabase's email rate limits conservative.
4. Create an hCaptcha site and copy its public site key. In Supabase, open
   **Authentication → Bot and Abuse Protection**, enable CAPTCHA, choose hCaptcha,
   and enter the hCaptcha secret key. The secret belongs only in hCaptcha and the
   Supabase dashboard; it is never an application environment variable.
5. Configure these public application values:

   ```text
   NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your-public-key
   NEXT_PUBLIC_SUPABASE_CAPTCHA_SITE_KEY=your-public-hcaptcha-site-key
   ```

   `NEXT_PUBLIC_SUPABASE_ANON_KEY` remains a temporary fallback for legacy projects,
   but new deployments should use Supabase's publishable key.

If any required public value or the CAPTCHA site key is missing or invalid, the
account control is hidden and named strategies stay in browser storage. Never
expose a Supabase secret/service-role key or an hCaptcha secret to the browser.
The migration revokes anonymous access and direct authenticated inserts/updates,
forces row-level security for reads/deletes, performs writes through a narrowly
granted database function, and prevents changing record ownership or creation
timestamps.

Monitor Supabase Auth and SMTP logs and keep the dashboard's OTP, verification,
and email-send limits appropriate for expected traffic. CAPTCHA reduces automated
abuse but does not replace rate limits or sender monitoring:

- [Supabase CAPTCHA setup](https://supabase.com/docs/guides/auth/auth-captcha)
- [Supabase production checklist](https://supabase.com/docs/guides/deployment/going-into-prod)
- [Supabase publishable and legacy key guidance](https://supabase.com/docs/guides/getting-started/api-keys)
