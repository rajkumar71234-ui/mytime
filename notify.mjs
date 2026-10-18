// mytime — background notifications (run by GitHub Actions every ~5 minutes)
// Finds new friend requests, messages, posts and stories since the last run and
// sends Web Push notifications to the people they're for.
// Needs one GitHub secret: FIREBASE_SA = the Firebase service-account JSON.
import admin from 'firebase-admin';
import webpush from 'web-push';

const sa = JSON.parse(process.env.FIREBASE_SA || '{}');
if (!sa.project_id) { console.log('FIREBASE_SA secret missing — skipping.'); process.exit(0); }
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();
const { Timestamp } = admin.firestore;

const vapid = (await db.doc('config/vapidPrivate').get()).data();
if (!vapid?.privateKey) { console.log('VAPID keys missing in config/vapidPrivate — skipping.'); process.exit(0); }
webpush.setVapidDetails('mailto:noreply@mytime.app', vapid.publicKey, vapid.privateKey);

const stateRef = db.doc('config/notifyState');
const now = Timestamp.now();
const state = (await stateRef.get()).data() || {};
// first run: look back 10 minutes; never look back more than 2 hours
let since = state.last || Timestamp.fromMillis(Date.now() - 10 * 60 * 1000);
if (now.toMillis() - since.toMillis() > 2 * 3600 * 1000) since = Timestamp.fromMillis(now.toMillis() - 2 * 3600 * 1000);

const users = new Map((await db.collection('users').get()).docs.map(d => [d.id, d.data()]));
const name = id => '@' + (users.get(id)?.username || 'someone');
const out = new Map();                       // uid -> notifications
const add = (uid, n) => { if (!out.has(uid)) out.set(uid, []); out.get(uid).push(n); };
const between = q => q.where('createdAt', '>', since).where('createdAt', '<=', now);

// 1) friend requests
for (const d of (await between(db.collection('friendRequests')).get()).docs) {
  const r = d.data();
  if (r.status === 'pending') add(r.to, { title: 'New friend request', body: `${name(r.from)} wants to be your friend`, tag: 'req-' + r.from });
}

// 2) messages (grouped per chat)
for (const c of (await db.collection('chats').where('updatedAt', '>', since).get()).docs) {
  const ms = (await between(c.ref.collection('messages')).get()).docs.map(m => m.data()).filter(m => !m.deleted && m.to);
  const byTo = {};
  ms.forEach(m => (byTo[m.to] = byTo[m.to] || []).push(m));
  for (const [to, list] of Object.entries(byTo)) {
    list.sort((a, b) => a.createdAt.toMillis() - b.createdAt.toMillis());
    const last = list[list.length - 1];
    add(to, { title: name(last.from), body: list.length > 1 ? `${list.length} new messages · ${last.text}` : last.text, tag: 'chat-' + c.id });
  }
}

// 3) activity notifications (comments, replies, likes, friends' posts/stories, photo changes, accepted requests)
for (const [id] of users) {
  for (const d of (await between(db.collection('notifs').doc(id).collection('items')).get()).docs) {
    const x = d.data();
    add(id, { title: '@' + (x.fromName || users.get(x.from)?.username || 'someone'), body: x.text || 'New activity', tag: 'n-' + d.id });
  }
}

// send
let sent = 0, removed = 0;
for (const [uid, list] of out) {
  if (users.get(uid)?.status !== 'approved') continue;
  const subs = await db.collection('pushSubs').doc(uid).collection('subs').get();
  for (const n of list) for (const s of subs.docs) {
    try {
      await webpush.sendNotification(s.data().sub, JSON.stringify({ ...n, url: './' }), { TTL: 6 * 3600, urgency: 'high' });
      sent++;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) { await s.ref.delete(); removed++; }
      else console.log('push error', e.statusCode, e.body);
    }
  }
}
await stateRef.set({ last: now, ranAt: now, sent, removed }, { merge: true });
console.log(`since ${since.toDate().toISOString()} → ${out.size} people, ${sent} sent, ${removed} expired removed`);
process.exit(0);
