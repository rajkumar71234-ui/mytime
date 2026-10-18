// ============================================================
//  mytime — private friend-circle social app
//  Firebase Auth + Firestore (free Spark plan) + Cloudinary (free) for media
// ============================================================
import { firebaseConfig, ADMIN_EMAIL, CLOUDINARY } from './config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  sendEmailVerification, sendPasswordResetEmail, signOut, reload
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore, doc, getDoc, getDocs, setDoc, updateDoc, addDoc, deleteDoc, collection, query, where,
  orderBy, limit, limitToLast, onSnapshot, serverTimestamp, arrayUnion, arrayRemove, increment,
  writeBatch, runTransaction, Timestamp
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const NEEDS_SETUP = firebaseConfig.apiKey.startsWith('PASTE') || CLOUDINARY.cloudName.startsWith('PASTE');
const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
const db = getFirestore(fbApp);

// ---------------- state ----------------
const S = {
  user: null, me: null, stage: null, tab: 'home',
  friends: new Set(), inReq: new Map(), outReq: new Set(),
  users: {}, postIndex: new Map(), storyGroups: new Map(),
  rootUnsubs: [], appUnsubs: [], tabUnsubs: [], tabRefresh: null,
  social: new Set(), heartbeat: null, signingUp: false, justLoggedIn: false
};
const ONLINE_MS = 2 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------- helpers ----------------
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pairId = (a, b) => [a, b].sort().join('_');
const isAdminEmail = e => !!e && e.toLowerCase() === ADMIN_EMAIL.toLowerCase();
const isAdmin = () => !!S.user && S.user.emailVerified && isAdminEmail(S.user.email);
const uid = () => S.user?.uid;
const tsMs = t => t?.toMillis ? t.toMillis() : (t?.seconds ? t.seconds * 1000 : (typeof t === 'number' ? t : Date.now()));
const dataOf = d => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) });
const visible = u => u === uid() || S.friends.has(u);
const unsubAll = arr => { arr.forEach(f => { try { f(); } catch (e) {} }); arr.length = 0; };

function timeAgo(t) {
  const s = Math.max(1, Math.floor((Date.now() - tsMs(t)) / 1000));
  if (s < 60) return s + 's'; const m = Math.floor(s / 60); if (m < 60) return m + 'm';
  const h = Math.floor(m / 60); if (h < 24) return h + 'h'; const d = Math.floor(h / 24); if (d < 7) return d + 'd';
  return new Date(tsMs(t)).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
const fullTime = t => t ? new Date(tsMs(t)).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—';
const clock = t => new Date(tsMs(t)).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const isOnline = u => u?.lastSeen && Date.now() - tsMs(u.lastSeen) < ONLINE_MS;
const lastSeenText = u => isOnline(u) ? 'Online now' : (u?.lastSeen ? 'Last seen ' + timeAgo(u.lastSeen) + ' ago' : 'Never online');

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2600);
}
function friendly(e) {
  const c = e?.code || '';
  const map = {
    'auth/invalid-email': 'That email address looks wrong.',
    'auth/email-already-in-use': 'An account already exists with this email. Try logging in.',
    'auth/weak-password': 'Password must be at least 6 characters.',
    'auth/invalid-credential': 'Wrong email or password.',
    'auth/wrong-password': 'Wrong email or password.',
    'auth/user-not-found': 'No account with this email.',
    'auth/too-many-requests': 'Too many attempts. Please wait a few minutes.',
    'auth/network-request-failed': 'No internet connection.',
    'permission-denied': 'Not allowed.',
    'unavailable': 'You seem to be offline.'
  };
  return map[c] || e?.message || String(e);
}
const errH = e => { console.error(e); toast(friendly(e)); };

const I = {
  home: '<svg viewBox="0 0 24 24"><path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="5"/><path d="M12 8v8M8 12h8"/></svg>',
  chat: '<svg viewBox="0 0 24 24"><path d="M21 11.5a8.4 8.4 0 0 1-12.4 7.4L3 20.5l1.6-5.2A8.5 8.5 0 1 1 21 11.5z"/></svg>',
  heart: '<svg viewBox="0 0 24 24"><path d="M12 20.5s-8-4.9-8-11A4.5 4.5 0 0 1 12 6.6 4.5 4.5 0 0 1 20 9.5c0 6.1-8 11-8 11z"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.7a2 2 0 0 0-2 1.7l-1.4 9A2 2 0 0 0 4.3 15H10zM17 2h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3"/></svg>',
  comment: '<svg viewBox="0 0 24 24"><path d="M20.5 12a8.5 8.5 0 0 1-12.6 7.4L3 21l1.6-4.9A8.5 8.5 0 1 1 20.5 12z"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  more: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/></svg>',
  shield: '<svg viewBox="0 0 24 24"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="m9 12 2 2 4-4"/></svg>',
  clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  mail: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M7 4v16l13-8z"/></svg>',
  users: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 3-6 7-6s7 2 7 6M16 4a4 4 0 0 1 0 8M22 21c0-3-1.5-5-4-6"/></svg>',
  block: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/></svg>'
};
const LOGO_BIG = `<div class="logo"><img src="icon.svg" alt=""><span>mytime</span></div>`;
const LOGO_SM = `<div class="logo-sm"><img src="icon.svg" alt=""><span>mytime</span></div>`;

function avatar(u, size = 32) {
  const st = `width:${size}px;height:${size}px`;
  if (u?.avatarUrl) return `<img class="av" style="${st}" src="${esc(u.avatarUrl)}" alt="">`;
  return `<div class="av av-ph" style="${st};font-size:${Math.round(size * 0.42)}px">${esc((u?.username || '?')[0].toUpperCase())}</div>`;
}
function mediaHtml(m, opts = '') {
  if (!m?.mediaUrl) return '';
  return m.mediaType === 'video'
    ? `<video src="${esc(m.mediaUrl)}#t=0.1" controls playsinline preload="metadata" ${opts}></video>`
    : `<img src="${esc(m.mediaUrl)}" alt="" loading="lazy">`;
}
function thumb(m) {
  return m.mediaType === 'video'
    ? `<video src="${esc(m.mediaUrl)}#t=0.1" muted playsinline preload="metadata"></video><span class="vi">${I.play}</span>`
    : `<img src="${esc(m.mediaUrl)}" alt="" loading="lazy">`;
}

// keyed list patching — keeps unchanged DOM nodes (videos don't restart)
function patchList(box, items, keyFn, htmlFn, after) {
  box.querySelectorAll(':scope > :not([data-k])').forEach(n => n.remove());
  const old = new Map([...box.children].map(c => [c.dataset.k, c]));
  const ordered = [];
  for (const it of items) {
    const k = keyFn(it), h = htmlFn(it);
    let el = old.get(k);
    if (!el || el._h !== h) {
      const t = document.createElement('div'); t.innerHTML = h.trim();
      const n = t.firstElementChild; n.dataset.k = k; n._h = h;
      if (el) el.replaceWith(n); el = n;
    }
    old.delete(k); ordered.push(el); after?.(el, it);
  }
  old.forEach(el => el.remove());
  ordered.forEach((el, i) => { if (box.children[i] !== el) box.insertBefore(el, box.children[i] || null); });
}

async function getUser(id, fresh = false) {
  if (!fresh && S.users[id]) return S.users[id];
  try {
    const s = await getDoc(doc(db, 'users', id));
    if (s.exists()) S.users[id] = dataOf(s);
  } catch (e) { console.warn(e); }
  return S.users[id] || { id, username: 'user' };
}

async function logAct(type, text, extra = {}) {
  if (!S.user) return;
  try {
    await addDoc(collection(db, 'logs'), {
      uid: S.user.uid, username: S.me?.username || S.pendingUsername || '', email: S.user.email,
      type, text: String(text || '').slice(0, 300), createdAt: serverTimestamp(), ...extra
    });
  } catch (e) { console.warn('log failed', e); }
}

// Cloudinary upload (images compressed in-browser first)
async function compressImage(file, max = 1280, q = 0.82) {
  try {
    const bmp = await createImageBitmap(file);
    const r = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * r); c.height = Math.round(bmp.height * r);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise(res => c.toBlob(b => res(b || file), 'image/jpeg', q));
  } catch { return file; }
}
function uploadMedia(file, onProgress) {
  return new Promise(async (resolve, reject) => {
    const isVid = file.type.startsWith('video');
    if (isVid && file.size > 60 * 1024 * 1024) return reject(new Error('Video is too large (max 60 MB).'));
    const body = isVid ? file : await compressImage(file);
    const fd = new FormData();
    fd.append('file', body); fd.append('upload_preset', CLOUDINARY.uploadPreset); fd.append('folder', 'mytime');
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `https://api.cloudinary.com/v1_1/${CLOUDINARY.cloudName}/${isVid ? 'video' : 'image'}/upload`);
    xhr.upload.onprogress = e => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      let j = {}; try { j = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status >= 200 && xhr.status < 300) resolve({ url: j.secure_url, type: isVid ? 'video' : 'image' });
      else reject(new Error(j.error?.message || 'Upload failed'));
    };
    xhr.onerror = () => reject(new Error('Upload failed — check your connection.'));
    xhr.send(fd);
  });
}

// ---------------- rendering primitives ----------------
const render = html => { $('#app').innerHTML = html; };
const ACT = {};
document.addEventListener('click', e => {
  const t = e.target.closest('[data-act]');
  if (t && ACT[t.dataset.act]) { ACT[t.dataset.act](t, e); }
});

function openSheet(html, cls = '') {
  const el = document.createElement('div');
  el.className = 'sheet ' + cls;
  el.innerHTML = `<div class="inner">${html}</div>`;
  el.unsubs = []; el.cleanup = [];
  document.body.appendChild(el);
  return el;
}
function closeSheet(el) {
  if (!el) return;
  unsubAll(el.unsubs); el.cleanup.forEach(f => f()); el.remove();
}
const closeAllSheets = () => document.querySelectorAll('.sheet').forEach(closeSheet);
ACT.close = el => closeSheet(el.closest('.sheet'));

function actionSheet(options) {
  return new Promise(res => {
    const d = document.createElement('div'); d.className = 'dim';
    d.innerHTML = `<div class="asheet">${options.map((o, i) => `<button data-i="${i}" class="${o.red ? 'red' : ''}">${esc(o.label)}</button>`).join('')}<button data-i="-1">Cancel</button></div>`;
    d.onclick = e => { const b = e.target.closest('button'); if (!b && e.target !== d) return; d.remove(); res(b ? +b.dataset.i : -1); };
    document.body.appendChild(d);
  });
}

function bindForm(form, fn) {
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]'), err = form.querySelector('.err');
    if (err) err.textContent = '';
    if (btn) btn.disabled = true;
    try { await fn(form); } catch (ex) { console.error(ex); if (err) err.textContent = friendly(ex); else toast(friendly(ex)); }
    finally { if (btn && document.body.contains(btn)) btn.disabled = false; }
  });
}
const authShell = inner => `<div class="auth"><div class="auth-card">${LOGO_BIG}${inner}</div></div>`;

// ================= AUTH SCREENS =================
function showLogin(msg = '') {
  S.stage = 'login';
  render(authShell(`
    <form class="form" id="f-login">
      <input name="email" type="email" placeholder="Email" autocomplete="email" required>
      <input name="pw" type="password" placeholder="Password" autocomplete="current-password" required>
      <button class="btn primary" type="submit">Log in</button>
      <p class="err">${esc(msg)}</p>
      <a class="link" data-act="go-forgot">Forgot password?</a>
    </form>
    <div class="auth-alt">Don't have an account? <a class="link b" style="display:inline" data-act="go-signup">Sign up</a></div>`));
  bindForm($('#f-login'), async f => {
    S.justLoggedIn = true;
    await signInWithEmailAndPassword(auth, f.email.value.trim(), f.pw.value);
  });
}
ACT['go-login'] = () => showLogin();

function showSignup() {
  S.stage = 'signup';
  render(authShell(`
    <form class="form" id="f-signup">
      <input name="email" type="email" placeholder="Email" autocomplete="email" required>
      <input name="username" placeholder="Username (e.g. raj_kumar)" autocapitalize="none" autocomplete="off" required>
      <input name="pw" type="password" placeholder="Password (min 6 characters)" autocomplete="new-password" required>
      <input name="pw2" type="password" placeholder="Confirm password" autocomplete="new-password" required>
      <button class="btn primary" type="submit">Sign up</button>
      <p class="err"></p>
      <div class="note">We'll email you a verification link. After you verify, the admin reviews new accounts — your account will be activated within <b>48 hours</b>. mytime is a private friend-circle app; the admin can view account activity.</div>
    </form>
    <div class="auth-alt">Have an account? <a class="link b" style="display:inline" data-act="go-login">Log in</a></div>`));
  bindForm($('#f-signup'), async f => {
    const email = f.email.value.trim(), un = f.username.value.trim().toLowerCase();
    if (!/^[a-z0-9._]{3,20}$/.test(un)) throw new Error('Username: 3–20 characters, letters, numbers, . or _ only.');
    if (f.pw.value.length < 6) throw new Error('Password must be at least 6 characters.');
    if (f.pw.value !== f.pw2.value) throw new Error('Passwords do not match.');
    const taken = await getDoc(doc(db, 'usernames', un));
    if (taken.exists()) throw new Error('That username is taken. Try another.');
    S.signingUp = true; S.pendingUsername = un;
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, f.pw.value);
      S.user = cred.user;
      await claimUsername(cred.user, un);
      await sendEmailVerification(cred.user);
      await logAct('signup', `Created account @${un}`);
      S.signingUp = false;
      showVerify(true);
    } catch (e) {
      S.signingUp = false;
      if (auth.currentUser) routeAuth(auth.currentUser);
      throw e;
    }
  });
}
ACT['go-signup'] = () => showSignup();

async function claimUsername(user, un) {
  await runTransaction(db, async tx => {
    const ref = doc(db, 'usernames', un);
    if ((await tx.get(ref)).exists()) throw new Error('That username is taken. Try another.');
    tx.set(ref, { uid: user.uid });
    tx.set(doc(db, 'users', user.uid), {
      uid: user.uid, email: user.email, username: un, status: 'pending', profileComplete: false,
      emailVerified: false, name: '', bio: '', avatarUrl: '', city: '', dob: '', gender: '',
      createdAt: serverTimestamp(), lastSeen: serverTimestamp()
    });
  });
}

function showForgot() {
  S.stage = 'forgot';
  render(authShell(`
    <h2>Reset password</h2>
    <p class="muted">Enter your email and we'll send you a link to set a new password.</p>
    <form class="form" id="f-forgot">
      <input name="email" type="email" placeholder="Email" required>
      <button class="btn primary" type="submit">Send reset link</button>
      <p class="err"></p>
    </form>
    <a class="link" data-act="go-login">Back to log in</a>`));
  bindForm($('#f-forgot'), async f => {
    await sendPasswordResetEmail(auth, f.email.value.trim());
    f.innerHTML = `<div class="note">If an account exists for <b>${esc(f.email.value)}</b>, a reset link is on its way. Check your inbox (and spam).</div>`;
  });
}
ACT['go-forgot'] = () => showForgot();

function showVerify(justSent) {
  S.stage = 'verify';
  render(authShell(`
    <div class="big-ico">${I.mail}</div>
    <h2>Verify your email</h2>
    <p class="muted">${justSent ? 'We sent' : 'Open the link we sent'} a verification link to <b>${esc(S.user.email)}</b>. Open it, then tap continue. Check your spam folder too.</p>
    <div class="note">✅ Password set. Your account will be activated within <b>48 hours</b> after the admin approves it.</div>
    <button class="btn primary" data-act="verified">I've verified — Continue</button>
    <button class="btn" data-act="resend">Resend email</button>
    <a class="link" data-act="logout">Log out</a>`));
}
ACT.verified = async el => {
  el.disabled = true;
  try {
    await reload(auth.currentUser);
    if (auth.currentUser.emailVerified) { await auth.currentUser.getIdToken(true); routeAuth(auth.currentUser); }
    else toast('Not verified yet — open the link in your email first.');
  } catch (e) { errH(e); } finally { el.disabled = false; }
};
ACT.resend = async el => {
  el.disabled = true;
  try { await sendEmailVerification(auth.currentUser); toast('Verification email sent'); } catch (e) { errH(e); }
  finally { setTimeout(() => (el.disabled = false), 20000); }
};
ACT.logout = async () => {
  if (S.stage === 'app') await logAct('logout', 'Logged out');
  S.tab = 'home'; await signOut(auth);
};

function showChooseUsername() {
  render(authShell(`
    <h2>Choose a username</h2>
    <form class="form" id="f-un">
      <input name="username" placeholder="Username" autocapitalize="none" required>
      <button class="btn primary" type="submit">Continue</button><p class="err"></p>
    </form><a class="link" data-act="logout">Log out</a>`));
  bindForm($('#f-un'), async f => {
    const un = f.username.value.trim().toLowerCase();
    if (!/^[a-z0-9._]{3,20}$/.test(un)) throw new Error('Username: 3–20 characters, letters, numbers, . or _ only.');
    S.pendingUsername = un;
    await claimUsername(S.user, un);
  });
}

function showPending() {
  render(authShell(`
    <div class="big-ico">${I.clock}</div>
    <h2>Almost there, @${esc(S.me.username)}!</h2>
    <p class="muted">Your email is verified.</p>
    <div class="note">Your account will be activated within <b>48 hours</b>, once the admin approves it. This page opens automatically after approval — or just log in again later.</div>
    <a class="link" data-act="logout">Log out</a>`));
}
function showBlocked(kind) {
  render(authShell(`
    <div class="big-ico">${I.block}</div>
    <h2>${kind === 'rejected' ? 'Account not approved' : 'Account suspended'}</h2>
    <p class="muted">${kind === 'rejected' ? 'The admin did not approve this account.' : 'This account has been suspended by the admin.'} Please contact the admin.</p>
    <a class="link" data-act="logout">Log out</a>`));
}

function profileFormHtml(me, submitLabel) {
  return `
    <label class="pf-pick" id="pf-pick">${avatar(me, 90)}<span class="link">Change profile photo</span>
      <input type="file" accept="image/*" hidden name="photo"></label>
    <label>Full name *</label><input name="name" required maxlength="40" value="${esc(me.name)}">
    <label>Date of birth</label><input name="dob" type="date" value="${esc(me.dob)}">
    <label>Gender</label><select name="gender">${['', 'Male', 'Female', 'Other', 'Prefer not to say'].map(g => `<option ${g === me.gender ? 'selected' : ''} value="${g}">${g || 'Select'}</option>`).join('')}</select>
    <label>City</label><input name="city" maxlength="40" value="${esc(me.city)}">
    <label>Bio</label><textarea name="bio" maxlength="150" placeholder="A little about you">${esc(me.bio)}</textarea>
    <div class="prog" hidden><i></i></div>
    <button class="btn primary" type="submit">${submitLabel}</button><p class="err"></p>`;
}
function wireProfileForm(f, onDone) {
  let file = null;
  f.photo.addEventListener('change', () => {
    file = f.photo.files[0]; if (!file) return;
    const old = $('#pf-pick .av', f), img = document.createElement('img');
    img.className = 'av'; img.style.cssText = 'width:90px;height:90px'; img.src = URL.createObjectURL(file); old.replaceWith(img);
  });
  bindForm(f, async () => {
    if (!f.name.value.trim()) throw new Error('Please enter your name.');
    const upd = { name: f.name.value.trim(), dob: f.dob.value, gender: f.gender.value, city: f.city.value.trim(), bio: f.bio.value.trim() };
    if (file) {
      const pg = $('.prog', f); pg.hidden = false;
      const r = await uploadMedia(file, p => ($('i', pg).style.width = (p * 100) + '%'));
      upd.avatarUrl = r.url;
    }
    await onDone(upd);
  });
}
function showDetails() {
  render(authShell(`
    <h2>Welcome! 🎉</h2>
    <p class="muted">Your account is approved. Add a few basic details to open your account.</p>
    <form class="form" id="f-det">${profileFormHtml(S.me, 'Open my account')}</form>
    <a class="link" data-act="logout">Log out</a>`));
  wireProfileForm($('#f-det'), async upd => {
    await updateDoc(doc(db, 'users', uid()), { ...upd, profileComplete: true });
    logAct('profile', 'Completed basic details & opened account');
  });
}

// ================= ROUTING =================
function stopApp() {
  unsubAll(S.tabUnsubs); unsubAll(S.appUnsubs); S.tabRefresh = null; S.social.clear();
  clearInterval(S.heartbeat); S.heartbeat = null; closeAllSheets();
  document.removeEventListener('visibilitychange', beat);
}
function stopAll() { stopApp(); unsubAll(S.rootUnsubs); }

async function routeAuth(user) {
  stopAll();
  S.user = user; S.me = null; S.stage = null;
  S.friends = new Set(); S.inReq = new Map(); S.outReq = new Set(); S.users = {};
  if (!user) return showLogin();
  if (S.signingUp) return;
  if (!user.emailVerified) return showVerify(false);
  try { await user.getIdToken(true); } catch {}
  S.rootUnsubs.push(onSnapshot(doc(db, 'users', user.uid), snap => {
    S.me = snap.exists() ? dataOf(snap) : null;
    if (S.me) S.users[user.uid] = S.me;
    onMe();
  }, e => { console.error(e); showLogin('Could not load your account: ' + friendly(e)); }));
}
onAuthStateChanged(auth, user => { if (!S.signingUp && !NEEDS_SETUP) routeAuth(user); });

function stageOf(me) {
  if (!me) return 'username';
  if (me.status === 'pending') return 'pending';
  if (me.status === 'rejected') return 'rejected';
  if (me.status === 'suspended') return 'suspended';
  if (!me.profileComplete) return 'details';
  return 'app';
}
async function onMe() {
  const me = S.me;
  if (me && isAdmin() && me.status !== 'approved') {
    try { await updateDoc(doc(db, 'users', uid()), { status: 'approved', approvedAt: serverTimestamp() }); return; }
    catch (e) { console.error('Admin self-approve failed — check ADMIN email in firestore.rules', e); }
  }
  if (me && S.user.emailVerified && !me.emailVerified) updateDoc(doc(db, 'users', uid()), { emailVerified: true }).catch(() => {});
  const st = stageOf(me);
  if (st === S.stage) { if (st === 'app') refreshMeBits(); return; }
  const prev = S.stage; S.stage = st;
  if (prev === 'app') stopApp();
  if (prev === 'pending' && st === 'details') toast('Your account has been approved!');
  ({
    username: showChooseUsername, pending: showPending, details: showDetails, app: startApp,
    rejected: () => showBlocked('rejected'), suspended: () => showBlocked('suspended')
  })[st]();
}

// ================= MAIN APP =================
function beat() {
  if (document.visibilityState === 'visible' && S.stage === 'app')
    updateDoc(doc(db, 'users', uid()), { lastSeen: serverTimestamp() }).catch(() => {});
}
function notifySocial() { S.tabRefresh?.(); S.social.forEach(f => f()); updateReqBadge(); }
function updateReqBadge() {
  const b = $('#req-badge'); if (!b) return;
  b.hidden = !S.inReq.size; b.textContent = S.inReq.size;
}
function refreshMeBits() {
  const n = $('.bnav [data-tab=profile]'); if (n) n.innerHTML = avatar(S.me, 26);
}

function startApp() {
  render(`<div class="shell">
    <header class="top">${LOGO_SM}<div class="top-r">
      ${isAdmin() ? `<button class="ib" data-act="admin" title="Admin">${I.shield}</button>` : ''}
      <button class="ib rel" data-act="requests" title="Friend requests">${I.heart}<span class="badge" id="req-badge" hidden></span></button>
    </div></header>
    <main id="view"></main>
    <nav class="bnav">
      <button class="ib" data-act="tab" data-tab="home">${I.home}</button>
      <button class="ib" data-act="tab" data-tab="search">${I.search}</button>
      <button class="ib" data-act="create">${I.plus}</button>
      <button class="ib" data-act="tab" data-tab="chats">${I.chat}</button>
      <button class="ib" data-act="tab" data-tab="profile">${avatar(S.me, 26)}</button>
    </nav></div>`);

  const me = uid();
  S.appUnsubs.push(onSnapshot(query(collection(db, 'friendships'), where('members', 'array-contains', me)), s => {
    S.friends = new Set(); s.forEach(d => { const o = d.data().members.find(m => m !== me); if (o) S.friends.add(o); });
    notifySocial();
  }, errH));
  S.appUnsubs.push(onSnapshot(query(collection(db, 'friendRequests'), where('to', '==', me), where('status', '==', 'pending')), s => {
    S.inReq = new Map(); s.forEach(d => S.inReq.set(d.data().from, d.id)); notifySocial();
  }, errH));
  S.appUnsubs.push(onSnapshot(query(collection(db, 'friendRequests'), where('from', '==', me), where('status', '==', 'pending')), s => {
    S.outReq = new Set(); s.forEach(d => S.outReq.add(d.data().to)); notifySocial();
  }, errH));

  beat(); S.heartbeat = setInterval(beat, 60000);
  document.addEventListener('visibilitychange', beat);
  if (S.justLoggedIn) { logAct('login', 'Logged in'); S.justLoggedIn = false; }
  go(S.tab || 'home');
}

function go(tab) {
  unsubAll(S.tabUnsubs); S.tabRefresh = null; S.tab = tab;
  document.querySelectorAll('.bnav [data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  window.scrollTo(0, 0);
  ({ home: tabHome, search: tabSearch, chats: tabChats, profile: tabProfile })[tab]();
}
ACT.tab = el => { closeAllSheets(); go(el.dataset.tab); };

// ---------------- HOME: stories + feed ----------------
function tabHome() {
  const v = $('#view');
  v.innerHTML = `<div class="stories" id="stories"></div><div id="feed"><div class="loading">Loading…</div></div>`;
  let posts = null, stories = [];
  const draw = () => { drawStories(stories); if (posts) drawFeed($('#feed'), posts); };
  S.tabRefresh = draw;
  S.tabUnsubs.push(onSnapshot(query(collection(db, 'posts'), orderBy('createdAt', 'desc'), limit(100)), s => {
    posts = s.docs.map(dataOf); draw();
  }, errH));
  S.tabUnsubs.push(onSnapshot(query(collection(db, 'stories'), where('createdAt', '>=', Timestamp.fromMillis(Date.now() - DAY_MS))), s => {
    stories = s.docs.map(dataOf); draw();
  }, errH));
}

function drawStories(stories) {
  const box = $('#stories'); if (!box) return;
  const now = Date.now(), me = uid();
  const live = stories.filter(s => !s.deleted && visible(s.uid) && now - tsMs(s.createdAt) < DAY_MS)
    .sort((a, b) => tsMs(a.createdAt) - tsMs(b.createdAt));
  S.storyGroups = new Map();
  live.forEach(s => { if (!S.storyGroups.has(s.uid)) S.storyGroups.set(s.uid, []); S.storyGroups.get(s.uid).push(s); });
  const mine = S.storyGroups.get(me);
  let html = `<div class="st" data-act="${mine ? 'story' : 'create-story'}" data-uid="${me}">
      <div class="ring ${mine ? '' : 'none'}">${avatar(S.me, 62)}${mine ? '' : '<span class="plus">+</span>'}</div><span>Your story</span></div>`;
  const others = [...S.storyGroups.entries()].filter(([u]) => u !== me)
    .map(([u, list]) => ({ u, list, seen: list.every(x => (x.viewers || []).includes(me)), last: tsMs(list[list.length - 1].createdAt) }))
    .sort((a, b) => (a.seen - b.seen) || (b.last - a.last));
  for (const g of others) {
    const s = g.list[0];
    html += `<div class="st" data-act="story" data-uid="${g.u}"><div class="ring ${g.seen ? 'seen' : ''}">${avatar(s, 62)}</div><span>${esc(s.username)}</span></div>`;
  }
  box.innerHTML = html;
}

function drawFeed(box, posts) {
  const list = posts.filter(p => !p.deleted && visible(p.uid));
  list.forEach(p => S.postIndex.set(p.id, p));
  if (!list.length) {
    box.innerHTML = `<div class="empty"><b>Welcome to mytime</b>Search for your friends and send a friend request. Their posts will show up here.<br><br><button class="btn sm primary" data-act="tab" data-tab="search">Find friends</button></div>`;
    return;
  }
  box.querySelector('.empty')?.remove();
  patchList(box, list, p => p.id, postHtml, fillActions);
}

function postHtml(p) {
  const mine = p.uid === uid();
  return `<article class="post">
    <div class="ph-head">
      <div class="who" data-act="profile" data-uid="${p.uid}">${avatar(p, 32)}<b>${esc(p.username)}</b><span class="muted sm">· ${timeAgo(p.createdAt)}</span></div>
      ${mine ? `<button class="ib" data-act="post-menu" data-id="${p.id}">${I.more}</button>` : ''}
    </div>
    <div class="media" data-act="dbl" data-id="${p.id}">${mediaHtml(p)}</div>
    <div class="acts">
      <button class="ib a-like" data-act="like" data-id="${p.id}">${I.heart}</button>
      <button class="ib a-dis" data-act="dislike" data-id="${p.id}">${I.down}</button>
      <button class="ib" data-act="comments" data-id="${p.id}">${I.comment}</button>
    </div>
    <div class="counts"></div>
    ${p.caption ? `<p class="cap"><b data-act="profile" data-uid="${p.uid}">${esc(p.username)}</b> ${esc(p.caption)}</p>` : ''}
    <a class="muted sm view-c" data-act="comments" data-id="${p.id}"></a>
  </article>`;
}
function fillActions(el, p) {
  const me = uid(), L = p.likes || [], D = p.dislikes || [], c = p.commentCount || 0;
  el.querySelector('.a-like').classList.toggle('on-like', L.includes(me));
  el.querySelector('.a-dis').classList.toggle('on-dis', D.includes(me));
  const parts = [];
  if (L.length) parts.push(`${L.length} like${L.length > 1 ? 's' : ''}`);
  if (D.length) parts.push(`${D.length} dislike${D.length > 1 ? 's' : ''}`);
  el.querySelector('.counts').textContent = parts.join(' · ');
  el.querySelector('.view-c').textContent = c ? `View ${c > 1 ? 'all ' + c + ' comments' : '1 comment'}` : 'Add a comment…';
}

async function react(id, field) {
  const p = S.postIndex.get(id); if (!p) return;
  const me = uid(), other = field === 'likes' ? 'dislikes' : 'likes';
  const has = (p[field] || []).includes(me);
  try {
    await updateDoc(doc(db, 'posts', id), has ? { [field]: arrayRemove(me) } : { [field]: arrayUnion(me), [other]: arrayRemove(me) });
    if (!has) logAct(field === 'likes' ? 'like' : 'dislike', `${field === 'likes' ? 'Liked' : 'Disliked'} @${p.username}'s post`, { refId: id });
  } catch (e) { errH(e); }
}
ACT.like = el => react(el.dataset.id, 'likes');
ACT.dislike = el => react(el.dataset.id, 'dislikes');
const lastTap = {};
ACT.dbl = (el, e) => {
  if (e.target.tagName === 'VIDEO') return;
  const id = el.dataset.id, now = Date.now();
  if (now - (lastTap[id] || 0) < 320) {
    const p = S.postIndex.get(id);
    if (p && !(p.likes || []).includes(uid())) react(id, 'likes');
    const pop = document.createElement('div'); pop.className = 'pop'; pop.innerHTML = I.heart; el.appendChild(pop);
    setTimeout(() => pop.remove(), 850); lastTap[id] = 0;
  } else lastTap[id] = now;
};
ACT['post-menu'] = async el => {
  const p = S.postIndex.get(el.dataset.id); if (!p) return;
  const i = await actionSheet([{ label: 'Edit caption' }, { label: 'Delete post', red: true }]);
  if (i === 0) {
    const cap = prompt('Edit caption', p.caption || ''); if (cap === null) return;
    await updateDoc(doc(db, 'posts', p.id), { caption: cap.slice(0, 2200) }).catch(errH);
    logAct('edit-post', `Edited caption: ${cap}`, { refId: p.id });
  } else if (i === 1) {
    if (!confirm('Delete this post?')) return;
    await updateDoc(doc(db, 'posts', p.id), { deleted: true, deletedAt: serverTimestamp() }).catch(errH);
    logAct('delete-post', `Deleted a post${p.caption ? ': ' + p.caption : ''}`, { refId: p.id });
    toast('Post deleted'); document.querySelectorAll('.sheet.post-detail').forEach(closeSheet);
  }
};

// ---------------- comments ----------------
ACT.comments = el => openComments(el.dataset.id);
function openComments(pid) {
  const sh = openSheet(`
    <div class="sh-head"><button class="ib" data-act="close">${I.back}</button><span class="t">Comments</span></div>
    <div class="sh-body" id="c-list"><div class="loading">Loading…</div></div>
    <form class="composer" id="c-form">${avatar(S.me, 30)}<input name="t" placeholder="Add a comment…" maxlength="500" autocomplete="off"><button type="submit">Post</button></form>`);
  const list = $('#c-list', sh);
  sh.unsubs.push(onSnapshot(query(collection(db, 'posts', pid, 'comments'), orderBy('createdAt')), s => {
    const cs = s.docs.map(dataOf).filter(c => !c.deleted);
    list.innerHTML = cs.length ? cs.map(c => `<div class="cm">
        <span data-act="profile" data-uid="${c.uid}">${avatar(c, 32)}</span>
        <div class="txt"><b data-act="profile" data-uid="${c.uid}">${esc(c.username)}</b> ${esc(c.text)}<div class="muted">${timeAgo(c.createdAt)}</div></div>
        ${c.uid === uid() ? `<button class="ib" data-act="del-comment" data-pid="${pid}" data-cid="${c.id}" data-text="${esc(c.text)}">${I.close}</button>` : ''}
      </div>`).join('') : `<div class="empty"><b>No comments yet</b>Start the conversation.</div>`;
    list.scrollTop = list.scrollHeight;
  }, errH));
  const f = $('#c-form', sh);
  f.addEventListener('submit', async e => {
    e.preventDefault(); const text = f.t.value.trim(); if (!text) return; f.t.value = '';
    try {
      await addDoc(collection(db, 'posts', pid, 'comments'), { uid: uid(), username: S.me.username, avatarUrl: S.me.avatarUrl || '', text, deleted: false, createdAt: serverTimestamp() });
      await updateDoc(doc(db, 'posts', pid), { commentCount: increment(1) });
      const p = S.postIndex.get(pid);
      logAct('comment', `Commented on @${p?.username || 'post'}: ${text}`, { refId: pid });
    } catch (ex) { errH(ex); }
  });
}
ACT['del-comment'] = async el => {
  if (!confirm('Delete this comment?')) return;
  const { pid, cid, text } = el.dataset;
  try {
    await updateDoc(doc(db, 'posts', pid, 'comments', cid), { deleted: true, deletedAt: serverTimestamp() });
    await updateDoc(doc(db, 'posts', pid), { commentCount: increment(-1) });
    logAct('delete-comment', `Deleted comment: ${text}`, { refId: pid });
  } catch (e) { errH(e); }
};

// ---------------- create post / story ----------------
ACT.create = () => openCreate('post');
ACT['create-story'] = () => openCreate('story');
function openCreate(kind) {
  const sh = openSheet(`
    <div class="sh-head"><button class="ib" data-act="close">${I.close}</button><span class="t">New</span></div>
    <div class="sh-body"><form class="create" id="cr">
      <div class="seg"><button type="button" data-k="post">Post</button><button type="button" data-k="story">Story · 24h</button></div>
      <label class="drop" id="drop"><div>${I.plus}<br>Tap to choose a photo or video</div><input type="file" name="file" accept="image/*,video/*" hidden></label>
      <textarea name="cap" class="inp" rows="3" maxlength="2200" placeholder="Write a caption…"></textarea>
      <div class="prog" hidden><i></i></div>
      <button class="btn primary" type="submit">Share</button><p class="err"></p>
    </form></div>`);
  const f = $('#cr', sh); let file = null;
  const setKind = k => {
    kind = k; f.querySelectorAll('.seg button').forEach(b => b.classList.toggle('on', b.dataset.k === k));
    f.cap.hidden = k === 'story'; $('.t', sh).textContent = k === 'story' ? 'New story' : 'New post';
  };
  f.querySelectorAll('.seg button').forEach(b => b.onclick = () => setKind(b.dataset.k));
  setKind(kind);
  f.file.addEventListener('change', () => {
    file = f.file.files[0]; if (!file) return;
    const url = URL.createObjectURL(file), drop = $('#drop', sh);
    drop.querySelector(':scope > div')?.remove(); drop.querySelector('img,video')?.remove();
    drop.insertAdjacentHTML('afterbegin', file.type.startsWith('video') ? `<video src="${url}" controls playsinline></video>` : `<img src="${url}">`);
  });
  bindForm(f, async () => {
    if (!file) throw new Error('Choose a photo or video first.');
    const pg = $('.prog', sh); pg.hidden = false;
    const up = await uploadMedia(file, p => ($('i', pg).style.width = (p * 100) + '%'));
    const base = { uid: uid(), username: S.me.username, avatarUrl: S.me.avatarUrl || '', mediaUrl: up.url, mediaType: up.type, deleted: false, createdAt: serverTimestamp() };
    if (kind === 'post') {
      const ref = await addDoc(collection(db, 'posts'), { ...base, caption: f.cap.value.trim(), likes: [], dislikes: [], commentCount: 0 });
      logAct('post', `Posted a ${up.type}${f.cap.value ? ': ' + f.cap.value.trim() : ''}`, { refId: ref.id, mediaUrl: up.url });
    } else {
      const ref = await addDoc(collection(db, 'stories'), { ...base, viewers: [], expiresAt: Timestamp.fromMillis(Date.now() + DAY_MS) });
      logAct('story', `Added a ${up.type} story`, { refId: ref.id, mediaUrl: up.url });
    }
    closeSheet(sh); toast(kind === 'post' ? 'Posted!' : 'Story added — visible for 24 hours');
    if (S.tab !== 'home') go('home');
  });
}

// ---------------- story viewer ----------------
ACT.story = el => openStory(el.dataset.uid);
function openStory(owner) {
  const list = S.storyGroups.get(owner); if (!list?.length) return;
  const me = uid(), mine = owner === me;
  let i = mine ? 0 : Math.max(0, list.findIndex(s => !(s.viewers || []).includes(me)));
  const sh = openSheet(`<div class="sv">
      <div class="bars">${list.map(() => '<i><b></b></i>').join('')}</div>
      <div class="sv-head"><span data-act="profile" data-uid="${owner}" style="display:flex;gap:10px;align-items:center">${avatar(list[0], 34)}<b>${esc(list[0].username)}</b></span><span class="sm t-ago" style="opacity:.7"></span><button class="ib" data-act="close">${I.close}</button></div>
      <div class="sv-media"></div>
      <div class="tapL"></div><div class="tapR"></div>
      <div class="sv-foot"></div></div>`, 'dark');
  let timer;
  const bars = [...sh.querySelectorAll('.bars i')];
  sh.cleanup.push(() => clearTimeout(timer));
  const show = () => {
    clearTimeout(timer);
    if (i < 0) i = 0;
    if (i >= list.length) return closeSheet(sh);
    const s = list[i];
    bars.forEach((b, k) => { b.className = k < i ? 'done' : ''; b.querySelector('b').style.animationDuration = ''; });
    $('.t-ago', sh).textContent = timeAgo(s.createdAt);
    const box = $('.sv-media', sh);
    box.innerHTML = s.mediaType === 'video' ? `<video src="${esc(s.mediaUrl)}" autoplay playsinline ${S.storyMuted === false ? '' : 'muted'}></video>` : `<img src="${esc(s.mediaUrl)}">`;
    const run = ms => { const b = bars[i]; b.className = 'run'; b.querySelector('b').style.animationDuration = ms + 'ms'; timer = setTimeout(() => { i++; show(); }, ms); };
    if (s.mediaType === 'video') {
      const vd = box.querySelector('video');
      vd.onloadedmetadata = () => run(Math.min(60, vd.duration || 15) * 1000);
      vd.onerror = () => run(5000);
    } else run(5000);
    if (mine) {
      $('.sv-foot', sh).innerHTML = `<button data-act="story-viewers">👁 ${(s.viewers || []).length} viewer${(s.viewers || []).length === 1 ? '' : 's'}</button><button data-act="story-del">Delete</button>`;
    } else {
      $('.sv-foot', sh).innerHTML = s.mediaType === 'video' ? `<button data-act="story-sound">${S.storyMuted === false ? '🔊 Sound on' : '🔇 Tap for sound'}</button><span></span>` : '';
      if (!(s.viewers || []).includes(me)) {
        updateDoc(doc(db, 'stories', s.id), { viewers: arrayUnion(me) }).catch(() => {});
        (s.viewers = s.viewers || []).push(me);
      }
    }
  };
  $('.tapL', sh).onclick = () => { i--; show(); };
  $('.tapR', sh).onclick = () => { i++; show(); };
  ACT['story-sound'] = btn => {
    const vd = $('.sv-media video', sh); if (!vd) return;
    S.storyMuted = !vd.muted; vd.muted = S.storyMuted;
    btn.textContent = vd.muted ? '🔇 Tap for sound' : '🔊 Sound on';
  };
  ACT['story-del'] = async () => {
    const s = list[i]; if (!confirm('Delete this story?')) return;
    await updateDoc(doc(db, 'stories', s.id), { deleted: true, deletedAt: serverTimestamp() }).catch(errH);
    logAct('delete-story', 'Deleted a story', { refId: s.id }); closeSheet(sh);
  };
  ACT['story-viewers'] = async () => {
    clearTimeout(timer);
    const s = list[i], names = await Promise.all((s.viewers || []).map(v => getUser(v).then(u => '@' + u.username)));
    alert(names.length ? 'Seen by:\n' + names.join('\n') : 'No viewers yet'); show();
  };
  show();
}

// ---------------- SEARCH + friends ----------------
function friendBtn(id) {
  if (id === uid()) return '';
  if (S.friends.has(id)) return `<button class="btn sm" data-act="message" data-uid="${id}">Message</button>`;
  if (S.inReq.has(id)) return `<button class="btn sm primary" data-act="accept" data-uid="${id}">Accept</button>`;
  if (S.outReq.has(id)) return `<button class="btn sm" data-act="cancel-req" data-uid="${id}">Requested</button>`;
  return `<button class="btn sm primary" data-act="add-friend" data-uid="${id}">Add friend</button>`;
}
function userRow(u, extra = '') {
  return `<div class="row" data-act="profile" data-uid="${u.id}">${avatar(u, 46)}
    <div class="mid"><b>${esc(u.username)}</b><div>${esc(u.name || '')}${extra}</div></div>
    <div class="btns">${friendBtn(u.id)}</div></div>`;
}
function tabSearch() {
  const v = $('#view');
  v.innerHTML = `<div class="pad"><input id="q" class="search" placeholder="Search name or username" autocapitalize="none"></div><div id="res"><div class="loading">Loading…</div></div>`;
  let all = [];
  const draw = () => {
    const q = $('#q').value.trim().toLowerCase().replace(/^@/, '');
    const others = all.filter(u => u.id !== uid());
    const hit = q ? others.filter(u => u.username.includes(q) || (u.name || '').toLowerCase().includes(q)) : others.filter(u => !S.friends.has(u.id));
    $('#res').innerHTML = (q ? '' : `<div class="sec-t">${hit.length ? 'People on mytime' : ''}</div>`) +
      (hit.length ? hit.map(u => userRow(u)).join('') : `<div class="empty">${q ? 'No one found' : 'You are friends with everyone here 🎉'}</div>`);
  };
  S.tabRefresh = draw;
  $('#q').addEventListener('input', draw);
  getDocs(query(collection(db, 'users'), where('status', '==', 'approved'))).then(s => {
    all = s.docs.map(dataOf).filter(u => u.profileComplete);
    all.forEach(u => (S.users[u.id] = u)); draw();
  }).catch(errH);
}

ACT['add-friend'] = async el => {
  const to = el.dataset.uid, me = uid(); el.disabled = true;
  try {
    if (S.inReq.has(to)) return await acceptReq(to);
    await setDoc(doc(db, 'friendRequests', `${me}_${to}`), { from: me, to, fromName: S.me.username, status: 'pending', createdAt: serverTimestamp() }, { merge: true });
    const u = await getUser(to); logAct('friend-request', `Sent friend request to @${u.username}`, { refId: to });
    toast('Friend request sent');
  } catch (e) { errH(e); el.disabled = false; }
};
ACT['cancel-req'] = async el => {
  const to = el.dataset.uid;
  if (!confirm('Cancel friend request?')) return;
  await updateDoc(doc(db, 'friendRequests', `${uid()}_${to}`), { status: 'cancelled' }).catch(errH);
  const u = await getUser(to); logAct('cancel-request', `Cancelled friend request to @${u.username}`);
};
async function acceptReq(from) {
  const rid = S.inReq.get(from); if (!rid) return;
  const members = [from, uid()].sort();
  const b = writeBatch(db);
  b.update(doc(db, 'friendRequests', rid), { status: 'accepted', respondedAt: serverTimestamp() });
  b.set(doc(db, 'friendships', members.join('_')), { members, requestId: rid, createdAt: serverTimestamp() });
  await b.commit();
  const u = await getUser(from); logAct('friend-accept', `Became friends with @${u.username}`, { refId: from });
  toast(`You and @${u.username} are now friends`);
}
ACT.accept = el => { el.disabled = true; acceptReq(el.dataset.uid).catch(errH); };
ACT.decline = async el => {
  const from = el.dataset.uid, rid = S.inReq.get(from); if (!rid) return;
  await updateDoc(doc(db, 'friendRequests', rid), { status: 'declined', respondedAt: serverTimestamp() }).catch(errH);
  const u = await getUser(from); logAct('friend-decline', `Declined friend request from @${u.username}`);
};
async function unfriend(id) {
  const u = await getUser(id);
  if (!confirm(`Remove @${u.username} from friends?`)) return;
  await deleteDoc(doc(db, 'friendships', pairId(uid(), id))).catch(errH);
  logAct('unfriend', `Removed @${u.username} from friends`, { refId: id });
}

ACT.requests = () => {
  const sh = openSheet(`<div class="sh-head"><button class="ib" data-act="close">${I.back}</button><span class="t">Friend requests</span></div><div class="sh-body" id="rq"></div>`);
  const draw = async () => {
    const inc = await Promise.all([...S.inReq.keys()].map(id => getUser(id)));
    const out = await Promise.all([...S.outReq].map(id => getUser(id)));
    if (!sh.isConnected) return;
    $('#rq', sh).innerHTML =
      `<div class="sec-t">Requests</div>` +
      (inc.length ? inc.map(u => `<div class="row" data-act="profile" data-uid="${u.id}">${avatar(u, 46)}<div class="mid"><b>${esc(u.username)}</b><div>${esc(u.name || '')}</div></div>
        <div class="btns"><button class="btn sm primary" data-act="accept" data-uid="${u.id}">Confirm</button><button class="btn sm" data-act="decline" data-uid="${u.id}">Delete</button></div></div>`).join('')
        : `<div class="row muted">No new requests</div>`) +
      (out.length ? `<div class="sec-t">Sent</div>` + out.map(u => userRow(u)).join('') : '');
  };
  S.social.add(draw); sh.cleanup.push(() => S.social.delete(draw)); draw();
};

// ---------------- profiles ----------------
ACT.profile = el => openProfile(el.dataset.uid);
async function openProfile(id) {
  if (id === uid()) { closeAllSheets(); return go('profile'); }
  const sh = openSheet(`<div class="sh-head"><button class="ib" data-act="close">${I.back}</button><span class="t"></span><button class="ib" data-act="prof-menu" data-uid="${id}">${I.more}</button></div>
    <div class="sh-body"><div class="prof" id="pf"></div><div id="pg"></div></div>`);
  const u = await getUser(id, true);
  let posts = [];
  const drawHead = () => {
    if (!sh.isConnected) return;
    $('.t', sh).textContent = u.username;
    $('#pf', sh).innerHTML = `<div class="prof-top">${avatar(u, 86)}<div class="stats"><div><b>${S.friends.has(id) ? posts.length : '–'}</b><span>posts</span></div></div></div>
      <div class="nm">${esc(u.name)}</div>${u.city ? `<div class="muted sm">${esc(u.city)}</div>` : ''}<div class="bio">${esc(u.bio)}</div>
      <div class="btns">${friendBtn(id).replace('btn sm', 'btn')}</div>`;
    const pg = $('#pg', sh);
    if (!S.friends.has(id)) { pg.innerHTML = `<div class="lock">🔒<br><b>Friends only</b><br>Become friends with @${esc(u.username)} to see posts and chat.</div>`; return; }
    pg.innerHTML = posts.length ? `<div class="grid">${posts.map(p => `<div class="cell" data-act="open-post" data-id="${p.id}">${thumb(p)}</div>`).join('')}</div>` : `<div class="lock">No posts yet</div>`;
  };
  S.social.add(drawHead); sh.cleanup.push(() => S.social.delete(drawHead));
  sh.unsubs.push(onSnapshot(query(collection(db, 'posts'), where('uid', '==', id)), s => {
    posts = s.docs.map(dataOf).filter(p => !p.deleted).sort((a, b) => tsMs(b.createdAt) - tsMs(a.createdAt));
    posts.forEach(p => S.postIndex.set(p.id, p)); drawHead();
  }, errH));
  drawHead();
}
ACT['prof-menu'] = async el => {
  const id = el.dataset.uid;
  if (!S.friends.has(id)) return toast('Not friends yet');
  const i = await actionSheet([{ label: 'Remove friend', red: true }]);
  if (i === 0) unfriend(id);
};
ACT['open-post'] = el => {
  const id = el.dataset.id;
  const sh = openSheet(`<div class="sh-head"><button class="ib" data-act="close">${I.back}</button><span class="t">Post</span></div><div class="sh-body" id="pd"></div>`, 'post-detail');
  sh.unsubs.push(onSnapshot(doc(db, 'posts', id), s => {
    const p = dataOf(s);
    if (!s.exists() || p.deleted) return closeSheet(sh);
    S.postIndex.set(id, p); patchList($('#pd', sh), [p], x => x.id, postHtml, fillActions);
  }, errH));
};

function tabProfile() {
  const v = $('#view'), me = S.me;
  let posts = [];
  const draw = () => {
    v.innerHTML = `<div class="prof"><div class="prof-top">${avatar(S.me, 86)}<div class="stats">
        <div><b>${posts.length}</b><span>posts</span></div>
        <div data-act="friends-list" style="cursor:pointer"><b>${S.friends.size}</b><span>friends</span></div></div></div>
      <div class="nm">${esc(S.me.name)}</div><div class="muted sm">@${esc(S.me.username)}${S.me.city ? ' · ' + esc(S.me.city) : ''}</div><div class="bio">${esc(S.me.bio)}</div>
      <div class="btns"><button class="btn" data-act="edit-profile">Edit profile</button><button class="btn" data-act="friends-list">Friends</button><button class="btn" data-act="logout">Log out</button></div></div>
      ${posts.length ? `<div class="grid">${posts.map(p => `<div class="cell" data-act="open-post" data-id="${p.id}">${thumb(p)}</div>`).join('')}</div>`
        : `<div class="lock">Share your first photo or video with the + button</div>`}`;
  };
  S.tabRefresh = draw;
  S.tabUnsubs.push(onSnapshot(query(collection(db, 'posts'), where('uid', '==', me.id)), s => {
    posts = s.docs.map(dataOf).filter(p => !p.deleted).sort((a, b) => tsMs(b.createdAt) - tsMs(a.createdAt));
    posts.forEach(p => S.postIndex.set(p.id, p)); draw();
  }, errH));
  draw();
}
ACT['edit-profile'] = () => {
  const sh = openSheet(`<div class="sh-head"><button class="ib" data-act="close">${I.back}</button><span class="t">Edit profile</span></div>
    <div class="sh-body"><form class="form" id="ep" style="padding:16px">${profileFormHtml(S.me, 'Save')}</form></div>`);
  wireProfileForm($('#ep', sh), async upd => {
    await updateDoc(doc(db, 'users', uid()), upd);
    logAct('profile', 'Updated profile'); closeSheet(sh); toast('Profile updated');
    if (S.tab === 'profile') S.tabRefresh?.();
  });
};
ACT['friends-list'] = () => {
  const sh = openSheet(`<div class="sh-head"><button class="ib" data-act="close">${I.back}</button><span class="t">Friends</span></div><div class="sh-body" id="fl"></div>`);
  const draw = async () => {
    const us = await Promise.all([...S.friends].map(id => getUser(id)));
    if (!sh.isConnected) return;
    $('#fl', sh).innerHTML = us.length ? us.map(u => `<div class="row" data-act="profile" data-uid="${u.id}">${avatar(u, 46)}<div class="mid"><b>${esc(u.username)}</b><div>${esc(u.name || '')}</div></div>
      <div class="btns"><button class="btn sm" data-act="message" data-uid="${u.id}">Message</button><button class="btn sm danger" data-act="unfriend" data-uid="${u.id}">Remove</button></div></div>`).join('')
      : `<div class="empty"><b>No friends yet</b>Use search to find people.</div>`;
  };
  S.social.add(draw); sh.cleanup.push(() => S.social.delete(draw)); draw();
};
ACT.unfriend = el => unfriend(el.dataset.uid);

// ---------------- CHATS ----------------
function tabChats() {
  const v = $('#view');
  v.innerHTML = `<div class="sec-t">Messages</div><div id="cl"><div class="loading">Loading…</div></div>`;
  let chats = {};
  const draw = async () => {
    const ids = [...S.friends];
    const us = await Promise.all(ids.map(id => getUser(id)));
    const box = $('#cl'); if (!box) return;
    const rows = us.map(u => ({ u, c: chats[u.id] })).sort((a, b) => tsMs(b.c?.updatedAt || 0) - tsMs(a.c?.updatedAt || 0));
    box.innerHTML = rows.length ? rows.map(({ u, c }) => `<div class="row" data-act="message" data-uid="${u.id}">${avatar(u, 52)}
        <div class="mid"><b>${esc(u.username)}</b><div>${c?.lastMessage ? (c.lastFrom === uid() ? 'You: ' : '') + esc(c.lastMessage) + ' · ' + timeAgo(c.updatedAt) : 'Tap to chat'}</div></div></div>`).join('')
      : `<div class="empty"><b>No chats yet</b>You can message people once you're friends.</div>`;
  };
  S.tabRefresh = draw;
  S.tabUnsubs.push(onSnapshot(query(collection(db, 'chats'), where('members', 'array-contains', uid())), s => {
    chats = {}; s.forEach(d => { const c = dataOf(d); const o = c.members.find(m => m !== uid()); if (o) chats[o] = c; }); draw();
  }, errH));
}

ACT.message = el => openChat(el.dataset.uid);
async function openChat(other) {
  if (!S.friends.has(other)) return toast('You can only message friends');
  const me = uid(), cid = pairId(me, other), u = await getUser(other);
  const sh = openSheet(`
    <div class="sh-head"><button class="ib" data-act="close">${I.back}</button><span class="t" data-act="profile" data-uid="${other}">${avatar(u, 32)}${esc(u.username)}</span></div>
    <div class="sh-body"><div class="msgs" id="ms"><div class="loading">Loading…</div></div></div>
    <form class="composer" id="mf"><input name="t" placeholder="Message…" autocomplete="off" maxlength="2000"><button type="submit">Send</button></form>`);
  try { await setDoc(doc(db, 'chats', cid), { members: [me, other].sort() }, { merge: true }); }
  catch (e) { errH(e); return closeSheet(sh); }
  const body = $('.sh-body', sh);
  sh.unsubs.push(onSnapshot(query(collection(db, 'chats', cid, 'messages'), orderBy('createdAt'), limitToLast(300)), s => {
    const ms = s.docs.map(dataOf).filter(m => !m.deleted);
    let lastDay = '';
    $('#ms', sh).innerHTML = ms.length ? ms.map(m => {
      const day = new Date(tsMs(m.createdAt)).toDateString();
      const sep = day !== lastDay ? `<div class="day">${new Date(tsMs(m.createdAt)).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</div>` : '';
      lastDay = day;
      return sep + `<div class="bub ${m.from === me ? 'me' : ''}" ${m.from === me ? `data-act="msg-menu" data-cid="${cid}" data-mid="${m.id}"` : ''}>${esc(m.text)}<div class="tm">${clock(m.createdAt)}</div></div>`;
    }).join('') : `<div class="empty">Say hi to @${esc(u.username)} 👋</div>`;
    body.scrollTop = body.scrollHeight;
  }, errH));
  const f = $('#mf', sh);
  f.addEventListener('submit', async e => {
    e.preventDefault(); const text = f.t.value.trim(); if (!text) return; f.t.value = '';
    try {
      await addDoc(collection(db, 'chats', cid, 'messages'), { from: me, to: other, text, deleted: false, createdAt: serverTimestamp() });
      await updateDoc(doc(db, 'chats', cid), { lastMessage: text.slice(0, 80), lastFrom: me, updatedAt: serverTimestamp() });
      logAct('message', `Sent a message to @${u.username}`, { refId: cid });
    } catch (ex) { errH(ex); }
  });
  setTimeout(() => f.t.focus(), 250);
}
ACT['msg-menu'] = async el => {
  const i = await actionSheet([{ label: 'Unsend message', red: true }]);
  if (i !== 0) return;
  await updateDoc(doc(db, 'chats', el.dataset.cid, 'messages', el.dataset.mid), { deleted: true, deletedAt: serverTimestamp() }).catch(errH);
  logAct('delete-message', `Unsent a message: ${el.firstChild?.textContent || ''}`, { refId: el.dataset.cid });
};

// ================= ADMIN =================
const BAD = new Set(['delete-post', 'delete-comment', 'delete-story', 'delete-message', 'unfriend', 'friend-decline']);
ACT.admin = () => {
  if (!isAdmin()) return;
  const sh = openSheet(`
    <div class="sh-head"><button class="ib" data-act="close">${I.back}</button><span class="t">${I.shield} Admin</span></div>
    <div class="tabs"><button data-t="appr">Approvals</button><button data-t="users">Users</button><button data-t="live">Live activity</button></div>
    <div class="sh-body" id="ab"><div class="loading">Loading…</div></div>`);
  let tab = 'appr', users = [], logs = [];
  const draw = () => {
    sh.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.t === tab));
    const pend = users.filter(u => u.status === 'pending');
    sh.querySelector('[data-t=appr]').textContent = `Approvals${pend.length ? ' (' + pend.length + ')' : ''}`;
    const online = users.filter(isOnline);
    const box = $('#ab', sh);
    if (tab === 'appr') {
      box.innerHTML = `<div class="stat-row"><div><b>${users.length}</b><span>accounts</span></div><div><b>${online.length}</b><span>online now</span></div><div><b>${pend.length}</b><span>waiting</span></div></div>` +
        (pend.length ? pend.sort((a, b) => tsMs(a.createdAt) - tsMs(b.createdAt)).map(u => `<div class="row" data-act="admin-user" data-uid="${u.id}">${avatar(u, 46)}
          <div class="mid"><b>@${esc(u.username)}</b><div>${esc(u.email)}</div><div>Signed up ${timeAgo(u.createdAt)} ago · ${u.emailVerified ? '✅ email verified' : '⚠️ email not verified'}</div></div>
          <div class="btns"><button class="btn sm primary" data-act="adm-set" data-uid="${u.id}" data-s="approved">Approve</button><button class="btn sm danger" data-act="adm-set" data-uid="${u.id}" data-s="rejected">Reject</button></div></div>`).join('')
          : `<div class="empty"><b>All caught up</b>No accounts waiting for approval.</div>`);
    } else if (tab === 'users') {
      const sorted = [...users].sort((a, b) => tsMs(b.lastSeen || 0) - tsMs(a.lastSeen || 0));
      box.innerHTML = sorted.map(u => {
        const last = logs.find(l => l.uid === u.id);
        return `<div class="row" data-act="admin-user" data-uid="${u.id}"><span class="dot ${isOnline(u) ? 'on' : ''}"></span>${avatar(u, 42)}
          <div class="mid"><b>@${esc(u.username)} ${u.name ? '· ' + esc(u.name) : ''}</b><div>${lastSeenText(u)}${last ? ' · ' + esc(last.text) : ''}</div></div>
          <span class="pill ${u.status}">${u.status}</span></div>`;
      }).join('');
    } else {
      box.innerHTML = logs.length ? logs.map(logHtml).join('') : `<div class="empty">No activity yet</div>`;
    }
  };
  sh.querySelectorAll('.tabs button').forEach(b => b.onclick = () => { tab = b.dataset.t; draw(); });
  sh.unsubs.push(onSnapshot(collection(db, 'users'), s => { users = s.docs.map(dataOf); users.forEach(u => (S.users[u.id] = u)); draw(); }, errH));
  sh.unsubs.push(onSnapshot(query(collection(db, 'logs'), orderBy('createdAt', 'desc'), limit(300)), s => { logs = s.docs.map(dataOf); draw(); }, errH));
  const iv = setInterval(draw, 30000); sh.cleanup.push(() => clearInterval(iv));
};
function logHtml(l, showUser = true) {
  return `<div class="log ${BAD.has(l.type) ? 'bad' : ''}"><div class="tm">${timeAgo(l.createdAt)}</div>
    <div>${showUser ? `<b data-act="admin-user" data-uid="${l.uid}" style="cursor:pointer">@${esc(l.username || '?')}</b> ` : ''}${esc(l.text)}
    ${l.mediaUrl ? ` · <a href="${esc(l.mediaUrl)}" target="_blank" style="color:var(--accent)">media</a>` : ''}<div class="muted sm">${fullTime(l.createdAt)}</div></div></div>`;
}
ACT['adm-set'] = async el => {
  const { uid: id, s } = el.dataset; el.disabled = true;
  const u = S.users[id];
  if (s !== 'approved' && !confirm(`${s === 'rejected' ? 'Reject' : 'Suspend'} @${u?.username}?`)) { el.disabled = false; return; }
  try {
    await updateDoc(doc(db, 'users', id), { status: s, [`${s}At`]: serverTimestamp() });
    logAct('admin', `Admin set @${u?.username} → ${s}`, { refId: id });
    toast(`@${u?.username} ${s}`);
  } catch (e) { errH(e); el.disabled = false; }
};

ACT['admin-user'] = el => openAdminUser(el.dataset.uid);
function openAdminUser(id) {
  const sh = openSheet(`
    <div class="sh-head"><button class="ib" data-act="close">${I.back}</button><span class="t"></span></div>
    <div class="tabs"><button data-t="info">Profile</button><button data-t="posts">Posts</button><button data-t="stories">Stories</button><button data-t="chats">Chats</button><button data-t="act">Activity</button></div>
    <div class="sh-body" id="au"><div class="loading">Loading…</div></div>`);
  let tab = 'info', u = null, posts = [], stories = [], chats = [], logs = [];
  const box = () => $('#au', sh);
  const delTag = x => x.deleted ? `<span class="pill deleted">deleted ${x.deletedAt ? timeAgo(x.deletedAt) + ' ago' : ''}${x.deletedBy === 'admin' ? ' by admin' : ''}</span>` : '';
  const draw = () => {
    if (!u) return;
    $('.t', sh).innerHTML = `<span class="dot ${isOnline(u) ? 'on' : ''}"></span> @${esc(u.username)}`;
    sh.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.t === tab));
    if (tab === 'info') {
      const acts = [];
      if (u.status !== 'approved') acts.push(`<button class="btn primary" data-act="adm-set" data-uid="${id}" data-s="approved">${u.status === 'pending' ? 'Approve' : 'Re-activate'}</button>`);
      if (u.status === 'approved' && !isAdminEmail(u.email)) acts.push(`<button class="btn danger" data-act="adm-set" data-uid="${id}" data-s="suspended">Suspend</button>`);
      if (u.status === 'pending') acts.push(`<button class="btn danger" data-act="adm-set" data-uid="${id}" data-s="rejected">Reject</button>`);
      box().innerHTML = `<div class="prof"><div class="prof-top">${avatar(u, 80)}<div class="stats">
          <div><b>${posts.length}</b><span>posts</span></div><div><b>${stories.length}</b><span>stories</span></div><div><b>${chats.length}</b><span>chats</span></div></div></div></div>
        <div class="kv">
          <div>Status</div><div><span class="pill ${u.status}">${u.status}</span></div>
          <div>Live</div><div>${lastSeenText(u)}</div>
          <div>Email</div><div>${esc(u.email)} ${u.emailVerified ? '✅' : '⚠️ not verified'}</div>
          <div>Name</div><div>${esc(u.name) || '—'}</div>
          <div>Date of birth</div><div>${esc(u.dob) || '—'}</div>
          <div>Gender</div><div>${esc(u.gender) || '—'}</div>
          <div>City</div><div>${esc(u.city) || '—'}</div>
          <div>Bio</div><div>${esc(u.bio) || '—'}</div>
          <div>Signed up</div><div>${fullTime(u.createdAt)}</div>
          <div>Approved</div><div>${u.approvedAt ? fullTime(u.approvedAt) : '—'}</div>
        </div><div style="padding:0 14px 20px">${acts.join('')}</div>`;
    } else if (tab === 'posts') {
      box().innerHTML = posts.length ? posts.map(p => `<div class="acard ${p.deleted ? 'deleted' : ''}"><a class="th" href="${esc(p.mediaUrl)}" target="_blank">${thumb(p)}</a>
        <div style="flex:1;min-width:0;font-size:14px">${esc(p.caption) || '<span class="muted">No caption</span>'}
        <div class="muted sm">${fullTime(p.createdAt)} · ♥ ${(p.likes || []).length} · 👎 ${(p.dislikes || []).length} · 💬 ${p.commentCount || 0}</div>
        <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">${delTag(p)}${!p.deleted ? `<button class="btn sm danger" data-act="adm-hide" data-col="posts" data-id="${p.id}">Remove</button>` : ''}
        <button class="btn sm" data-act="adm-comments" data-id="${p.id}">Comments</button></div></div></div>`).join('') : `<div class="empty">No posts</div>`;
    } else if (tab === 'stories') {
      box().innerHTML = stories.length ? stories.map(s => `<div class="acard ${s.deleted ? 'deleted' : ''}"><a class="th" href="${esc(s.mediaUrl)}" target="_blank">${thumb(s)}</a>
        <div style="flex:1;font-size:14px">${s.mediaType} story<div class="muted sm">${fullTime(s.createdAt)} · 👁 ${(s.viewers || []).length} views · ${Date.now() - tsMs(s.createdAt) > DAY_MS ? 'expired' : 'live'}</div>
        <div style="margin-top:6px">${delTag(s)}</div></div></div>`).join('') : `<div class="empty">No stories</div>`;
    } else if (tab === 'chats') {
      box().innerHTML = chats.length ? chats.map(c => {
        const o = c.members.find(m => m !== id), ou = S.users[o] || { username: '?' };
        return `<div class="row" data-act="adm-chat" data-cid="${c.id}">${avatar(ou, 42)}<div class="mid"><b>with @${esc(ou.username)}</b><div>${esc(c.lastMessage || '')} ${c.updatedAt ? '· ' + timeAgo(c.updatedAt) : ''}</div></div></div>`;
      }).join('') : `<div class="empty">No chats</div>`;
    } else {
      box().innerHTML = logs.length ? logs.map(l => logHtml(l, false)).join('') : `<div class="empty">No activity</div>`;
    }
  };
  sh.querySelectorAll('.tabs button').forEach(b => b.onclick = () => { tab = b.dataset.t; draw(); });
  const sortDesc = arr => arr.sort((a, b) => tsMs(b.createdAt) - tsMs(a.createdAt));
  sh.unsubs.push(onSnapshot(doc(db, 'users', id), s => { u = dataOf(s); S.users[id] = u; draw(); }, errH));
  sh.unsubs.push(onSnapshot(query(collection(db, 'posts'), where('uid', '==', id)), s => { posts = sortDesc(s.docs.map(dataOf)); draw(); }, errH));
  sh.unsubs.push(onSnapshot(query(collection(db, 'stories'), where('uid', '==', id)), s => { stories = sortDesc(s.docs.map(dataOf)); draw(); }, errH));
  sh.unsubs.push(onSnapshot(query(collection(db, 'chats'), where('members', 'array-contains', id)), s => {
    chats = s.docs.map(dataOf).sort((a, b) => tsMs(b.updatedAt || 0) - tsMs(a.updatedAt || 0));
    Promise.all(chats.map(c => getUser(c.members.find(m => m !== id)))).then(draw);
  }, errH));
  sh.unsubs.push(onSnapshot(query(collection(db, 'logs'), where('uid', '==', id)), s => { logs = sortDesc(s.docs.map(dataOf)); draw(); }, errH));
}
ACT['adm-hide'] = async el => {
  if (!confirm('Remove this for everyone? (You will still see it here.)')) return;
  await updateDoc(doc(db, el.dataset.col, el.dataset.id), { deleted: true, deletedAt: serverTimestamp(), deletedBy: 'admin' }).catch(errH);
};
ACT['adm-comments'] = el => {
  const pid = el.dataset.id;
  const sh = openSheet(`<div class="sh-head"><button class="ib" data-act="close">${I.back}</button><span class="t">All comments (incl. deleted)</span></div><div class="sh-body" id="ac"></div>`);
  sh.unsubs.push(onSnapshot(query(collection(db, 'posts', pid, 'comments'), orderBy('createdAt')), s => {
    const cs = s.docs.map(dataOf);
    $('#ac', sh).innerHTML = cs.length ? cs.map(c => `<div class="cm" style="${c.deleted ? 'background:#fff6f7' : ''}">${avatar(c, 32)}<div class="txt"><b>${esc(c.username)}</b> ${esc(c.text)}
      <div class="muted">${fullTime(c.createdAt)} ${c.deleted ? '<span class="pill deleted">deleted</span>' : ''}</div></div></div>`).join('') : `<div class="empty">No comments</div>`;
  }, errH));
};
ACT['adm-chat'] = el => {
  const cid = el.dataset.cid, [a, b] = cid.split('_');
  const ua = S.users[a] || { username: '?' }, ub = S.users[b] || { username: '?' };
  const sh = openSheet(`<div class="sh-head"><button class="ib" data-act="close">${I.back}</button><span class="t">@${esc(ua.username)} ↔ @${esc(ub.username)}</span></div>
    <div class="sh-body"><div class="msgs" id="am"></div></div>`);
  sh.unsubs.push(onSnapshot(query(collection(db, 'chats', cid, 'messages'), orderBy('createdAt')), s => {
    const ms = s.docs.map(dataOf);
    $('#am', sh).innerHTML = ms.length ? ms.map(m => `<div class="bub ${m.from === a ? '' : 'me'} ${m.deleted ? 'del' : ''}" style="cursor:default">
      <div class="sm" style="opacity:.75;font-weight:600">@${esc((S.users[m.from] || {}).username || '?')}</div>${esc(m.text)}
      <div class="tm">${fullTime(m.createdAt)}${m.deleted ? ' · DELETED ' + (m.deletedAt ? fullTime(m.deletedAt) : '') : ''}</div></div>`).join('') : `<div class="empty">No messages</div>`;
    const body = $('.sh-body', sh); body.scrollTop = body.scrollHeight;
  }, errH));
};

// config sanity check
if (NEEDS_SETUP) {
  render(authShell(`<h2>Setup needed</h2><div class="note">Open <b>config.js</b> and paste your Firebase and Cloudinary details. See <b>SETUP.md</b>.</div>`));
}
