# Yoga Website

Pre-recorded online yoga classes with monthly membership (Stripe cards + PayPal), user accounts, and access-controlled video. Runs entirely on Cloudflare: one Worker serves the site and API, D1 stores data, R2 stores videos, KV rate-limits sign-in.

```
public/          Front-end (plain HTML/CSS/JS, no build step)
src/index.ts     Worker API (Hono): auth, classes, protected video, Stripe, PayPal
db/schema.sql    D1 tables      db/seed.sql  sample classes
.github/         CI: typecheck, then deploy to Cloudflare on push to main
docs/DESIGN.md   Design tokens, accessibility checklist, download-protection notes
```

## 1. Push to GitHub
```bash
cd yoga-website
git init -b main && git add . && git commit -m "Initial commit"
gh repo create yoga-website --private --source=. --push     # or create the repo on github.com and `git remote add origin ...`
```
In the repo's Settings > Secrets and variables > Actions add `CLOUDFLARE_API_TOKEN` (template "Edit Cloudflare Workers") and `CLOUDFLARE_ACCOUNT_ID`.

## 2. Create Cloudflare resources
```bash
npm install
npx wrangler login
# (D1 database "yoga-db" and KV namespace already created and wired into wrangler.toml)

npx wrangler r2 bucket create yoga-videos # keep it PRIVATE (no public access, no custom domain)

npx wrangler d1 execute yoga-db --remote --file=db/seed.sql   # optional sample classes
```

## 3. Payments
**Stripe:** create a recurring Price, put its id in `STRIPE_PRICE_ID`. Add a webhook endpoint `https://YOUR-DOMAIN/api/webhooks/stripe` for `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`. Enable the Customer Portal in the Stripe dashboard.
**PayPal:** create a Product and a monthly Billing Plan, put the plan id in `PAYPAL_PLAN_ID` and your REST app client id in `PAYPAL_CLIENT_ID`. Add a webhook to `https://YOUR-DOMAIN/api/webhooks/paypal` for `BILLING.SUBSCRIPTION.*` events and `PAYMENT.SALE.COMPLETED`. Start with `PAYPAL_ENV = "sandbox"`.

```bash
npx wrangler secret put STRIPE_SECRET_KEY
npx wrangler secret put STRIPE_WEBHOOK_SECRET
npx wrangler secret put PAYPAL_CLIENT_SECRET
npx wrangler secret put PAYPAL_WEBHOOK_ID
```
Also set `APP_URL`, `BRAND` and `PRICE_LABEL` in `wrangler.toml`. For local work copy `.dev.vars.example` to `.dev.vars`.

## 4. Upload classes
```bash
npx wrangler r2 object put yoga-videos/videos/gentle-morning-flow.mp4 --file ./gentle-morning-flow.mp4 --remote
npx wrangler r2 object put yoga-videos/thumbs/gentle-morning-flow.jpg --file ./thumb.jpg --remote
```
Then add the class row (the `r2_key` must match the object key), either with SQL or `POST /api/admin/classes` while signed in as an admin. Make yourself admin:
```bash
npx wrangler d1 execute yoga-db --remote --command "UPDATE users SET role='admin' WHERE email='you@example.com'"
```
Use MP4 (H.264/AAC, "fast start" / moov atom first) so seeking works well.

## 5. Deploy
`git push` to `main` (GitHub Actions deploys), or `npm run deploy`. Add your domain under Workers > Settings > Domains.

## How access control works
- The R2 bucket is private. The only route to a file is `GET /api/video/:id`, which checks the sign-in cookie and an active subscription on every request, including seeks.
- Subscription state comes from Stripe/PayPal webhooks, verified server-side. Cancelled members keep access until the paid period ends.
- Passwords are PBKDF2-hashed; sessions are random tokens stored hashed in D1 in an HttpOnly, Secure cookie; sign-in is rate limited.

## Known limits
- **No site can fully stop a paying viewer from recording or saving a video.** This build removes the download button and context menu and blocks direct file URLs, which stops casual sharing. For stronger protection use Cloudflare Stream with signed URLs and HLS (no single downloadable file), and add per-user watermarks if piracy becomes a problem.
- Not yet included: email verification, password reset, an admin UI, terms/privacy pages, and a cookie/consent notice. Add these before launch (password reset needs an email provider such as Resend or MailChannels).
- Test with Stripe test mode and PayPal sandbox first. The code has not been run against live accounts or type-checked in this environment, so run `npm run typecheck` and walk through each flow once.
