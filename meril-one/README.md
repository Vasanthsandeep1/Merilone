# Meril One — mobile apps

Two Expo (React Native) apps for Android and iOS, sharing one backend — the
B2G backend (`../backend`, routes under `/api/m1`, MySQL database
`new_openprocure`, tables `m1_*`).

| App | Folder | Who uses it |
|---|---|---|
| **Meril One** (Customer) | `apps/customer-app` | Anyone — home users, hospitals, labs, offices, factories — to book repair/service |
| **Meril One Partner** (Service Engineer) | `apps/engineer-app` | Service engineers, to receive and complete jobs |

`packages/shared` holds code both apps use: API client, login (mobile + OTP),
theme and UI components.

## How it works

1. **Sign up** with mobile number + OTP. A customer picks a **background**
   (Home, Hospital / Clinic, Lab / Diagnostics, Office, Industry) which decides
   the services shown (a home user sees TV/AC repair; a hospital sees analyzer
   and medical equipment service).
2. The customer **books** a service: equipment details, problem, address,
   date and time slot.
3. The request goes to every **online** engineer who has that **skill** and
   covers that **area** (same city, or the booking's pincode is in their list).
   The **first to accept** gets the job.
4. Engineer: *On the way* → **Start** with the 4-digit OTP the customer sees in
   their app → **Complete** with service charge, parts and notes.
5. The customer tracks every step live and **rates** the engineer.

## Run it (development, with Expo Go)

1. Install **Expo Go** on your phone (Play Store / App Store).
2. Make sure MySQL (WampServer) is running and start the backend:
   `cd backend` then `npm run dev`. On startup it creates the `m1_*` tables
   and the starter service catalogue.
3. Phone and computer must be on the **same Wi-Fi**. If the app says it can't
   reach the server, allow Node.js through Windows Firewall (private networks).
4. Start an app (from `meril-one`):
   - Customer: `npm run customer`
   - Engineer: `npm run engineer`
5. Scan the QR code with the phone camera (iOS) or the Expo Go app (Android).

The apps find the backend automatically on the computer that runs `expo start`,
port 5012. To use a deployed server instead, start with
`EXPO_PUBLIC_API_URL=https://your-server/api/m1`.

To try both sides on one phone, run one app, then stop it (Ctrl+C) and run the
other — each keeps its own login.

## OTP / SMS

No SMS provider is connected yet. In development the OTP is shown in the app
(yellow "Test mode" box) and printed in the backend console. Before going live,
connect an SMS provider in `backend/controllers/merilOneController.js`
(`sendOtp`) and run the backend with `NODE_ENV=production`, which stops the OTP
being returned to the app.

## Not in this first version

Online payments (customers pay the engineer after service), live map tracking,
push notifications, photo uploads, an admin screen in the portal to manage
services/engineers, and store builds (EAS) — planned next.
