# Meril One

Two mobile apps (Expo / React Native) and the backend they use:

| Folder | What it is |
|---|---|
| `meril-one/apps/customer-app` | **Meril One** — customer app: book service, My Products, Store (get quote), track the engineer |
| `meril-one/apps/engineer-app` | **Meril One Partner** — service engineer app: receive jobs, start with OTP, complete with photos |
| `meril-one/packages/shared` | Code both apps share (API, login, UI) |
| `backend` | Node.js + Express + MySQL API (the apps use `/api/m1/...`; it is the B2G portal backend) |

> This public copy uses **sample data** in place of company-internal files
> (price list, staff names, signatures, delivery lists). Everything runs; the
> numbers and names are just examples.

---

## 1. What you need

- **Node.js 20 or 22** — <https://nodejs.org>
- **MySQL 8** — e.g. WampServer, XAMPP or MySQL Community Server
- **Expo Go** app on your phone (Play Store / App Store)
- Phone and computer on the **same Wi-Fi**

## 2. Database

Create an empty database (phpMyAdmin or MySQL command line):

```sql
CREATE DATABASE merilone CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

You don't need to import anything — the backend creates all tables itself.

## 3. Backend

```bash
cd backend
copy .env.example .env        # Mac/Linux: cp .env.example .env
```

Open `backend/.env` and set `DB_USER`, `DB_PASSWORD`, `DB_NAME=merilone` and a long random `JWT_SECRET`.

```bash
npm install
npm run dev
```

Wait for `🚀 Server running on http://localhost:5012` (the first start takes a
little longer while it creates the tables). Leave this window open.

In a **second** window, add the demo data (once):

```bash
cd backend
node scripts/setup_meril_one_demo.js
```

## 4. The apps

```bash
cd meril-one
npm install
```

Then start each app in its own window:

```bash
# Customer app
cd meril-one/apps/customer-app
npx expo start -c --port 8081

# Engineer app
cd meril-one/apps/engineer-app
npx expo start -c --port 8082
```

Scan the QR code with **Expo Go** (Android) or the **Camera** app (iPhone).
The apps reach the backend through the Expo server, so the backend must be
running on the same computer (port 5012).

**Phone can't connect?** Some routers block phones from reaching the computer.
Use a phone hotspot for both, or start with `npx expo start --tunnel`.

## 5. Logging in

| App | Login |
|---|---|
| Customer app | Any 10-digit mobile starting 6–9 (e.g. `9876543210`). The OTP fills in automatically in development and is also printed in the backend window. |
| Engineer app | `9000000001` or `9000000002` (demo service engineers). Then tap **Go online** to receive requests. |
| B2G portal (optional) | `demo@merilone.test` / `Demo@123` |

Try it: in the Customer app book a service in **Chennai** (pincode `600001`) →
the engineer (online) gets the request → accept → on the way → start with the
customer's OTP → complete with a photo → the customer sees the service report.

## Notes

- Never commit `backend/.env`.
- Optional features need their own keys in `.env`: emails (`EMAIL_*`), AI chat (`OLLAMA_*`), payments (`RAZORPAY_*`, `CASHFREE_*`).
- More about the apps: [`meril-one/README.md`](meril-one/README.md).
