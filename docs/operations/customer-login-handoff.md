# Customer login handoff

## Purpose

Give Canary reviewers and customers a repeatable access workflow without storing, forwarding, or displaying reusable passwords.

## Roles

- **Canary administrator / Lesley:** Reviews district configuration and dashboard output through the authenticated admin dashboard. Admin review does not require the customer's password.
- **Customer:** Controls the password for their own confirmed login email.
- **Operator:** Provisions the protected Auth account, verifies tenant scope, and confirms account/trial state before handoff.

## New trial workflow

1. Finish district configuration, clean-results QA, and tenant-isolation checks.
2. Provision the customer's confirmed email with protected district and access metadata.
3. Verify that authentication succeeds without putting a password in ClickUp, email, Google Sheets, or another shared tracker.
4. Lesley reviews the district through the authenticated Canary admin dashboard.
5. After Lesley accepts the account, send the customer only:
   - Login URL: `https://www.canarydata.media/login`
   - Their confirmed login email
   - Instruction to choose **Forgot Password** and request the 8-digit recovery code
6. The recovery code goes directly to the customer's confirmed login email. The customer sets a password known only to them.
7. Confirm the first customer login, district scope, and trial end date. Do not ask the customer to send the password back.

## Existing customer who cannot sign in

1. Confirm the exact account email and district before initiating recovery.
2. Direct the customer to **Forgot Password** on the Canary login page.
3. The customer enters the 8-digit code delivered to their email and sets a new password.
4. Verify access state and district scope after the customer confirms success.
5. Never retrieve or disclose an existing password. Supabase Auth passwords are not recoverable.

## Internal QA

- Use the admin district selector for content review.
- Use a short-lived, one-time QA session only when exact customer authorization or tenant behavior must be verified.
- Never share the one-time session URL. Delete local session artifacts immediately after QA.
- Do not reset a customer's password merely to perform internal review.

## ClickUp record

The onboarding task may contain the login URL, login email, district, access status, trial dates, and verified QA evidence. It must not contain a reusable password or one-time recovery/session token.

## Fairfax application

For Fairfax County Public Schools, Lesley can review the district from her authenticated admin view. After acceptance, send Delaina McCormack the Canary login URL and confirmed FCPS email, then have Delaina use **Forgot Password** to receive the 8-digit code directly and establish her own password.
