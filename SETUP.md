# mytime — setup guide (all free, ~20 minutes)

**Live link:** https://rajkumar71234-ui.github.io/mytime/

mytime runs on three free services:

| Service | What it does | Free plan |
|---|---|---|
| **Firebase** (Google) | Login, email verification, password reset, database, live chat | Spark plan — no card needed |
| **Cloudinary** | Stores photos & videos | Free plan — no card needed |
| **GitHub Pages** | Hosts the app at the link above | Free |

> Why Cloudinary? Firebase's own photo storage now needs the paid "Blaze" plan, so media goes to Cloudinary's free plan instead.

---

## 1. Firebase (login + database)

1. Go to **console.firebase.google.com** → **Add project** → name it `mytime` (keep it separate from Minimal Health Tracker). Google Analytics can be off.
2. **Build → Authentication → Get started → Email/Password → Enable → Save.**
3. **Authentication → Settings → Authorized domains → Add domain:** `rajkumar71234-ui.github.io`
4. **Authentication → Templates** (optional): set the sender name to `mytime` for the verification and password-reset emails.
5. **Build → Firestore Database → Create database** → *Production mode* → location **asia-south1 (Mumbai)**.
6. **Firestore → Rules** → delete everything, paste the whole `firestore.rules` file, change `your-email@gmail.com` to **your** email → **Publish**.
7. **Project settings (⚙️) → Your apps → `</>` Web** → register app `mytime` → copy the `firebaseConfig` values.

## 2. Cloudinary (photos & videos)

1. Sign up free at **cloudinary.com**.
2. On the dashboard, copy your **Cloud name**.
3. **Settings (⚙️) → Upload → Upload presets → Add upload preset**
   - Preset name: `mytime_unsigned`
   - Signing mode: **Unsigned**
   - Folder: `mytime`
   - Save.

## 3. Fill in `config.js` (on GitHub)

Open `config.js` in this repository → ✏️ Edit → paste:
- the `firebaseConfig` values from step 1.7,
- `ADMIN_EMAIL` = your email (same as in the rules),
- `cloudName` from Cloudinary.

Commit. The live link updates in about a minute.

## 4. First run — you (admin)

1. Open the link → **Sign up** with your admin email → set username & password.
2. Verify the email from your inbox → tap **I've verified — Continue**.
3. Your account is auto-approved (you're the admin) → fill your basic details.
4. The **🛡 shield icon** at the top opens the Admin panel:
   - **Approvals** — approve / reject new sign-ups.
   - **Users** — who's online now (green dot), last seen, latest action. Tap a user to see profile, all posts, stories, chats and activity — **including deleted items** (marked in red).
   - **Live activity** — every login, post, like, comment, message, friend request and delete, as it happens.

## 5. Install on iPhone

Open the link in **Safari → Share → Add to Home Screen**. It opens full-screen like an app.

## How it works for your friends

1. Sign up with email, username, password → verify email.
2. Screen says **"Your account will be activated within 48 hours."**
3. You approve them in the Admin panel → their screen opens automatically → they fill basic details → in.
4. Search friends → **Add friend** → once accepted they can see each other's posts and **chat (friends only)**.
5. Post photos/videos, ❤️ like, 👎 dislike, 💬 comment; add **stories that disappear after 24 hours**.
6. **Forgot password?** on the login page emails a reset link.

## Changing the logo

Replace `icon.svg`, `icon-180.png`, `icon-192.png` and `icon-512.png` with your Minimal logo (same file names, square images).

## Free-plan limits (plenty for a friend circle)

- Firebase: 50,000 reads + 20,000 writes per day.
- Cloudinary: ~25 GB storage/bandwidth per month. Photos are compressed before upload; videos max 60 MB each.

## Privacy note

Deleted posts, comments, stories and messages are hidden from users but kept for the admin. The sign-up screen tells people the admin can view account activity — keep that line so your friends know.
