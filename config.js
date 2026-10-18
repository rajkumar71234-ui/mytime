// ============================================================
//  MyTime — configuration. Fill these in (see SETUP.md).
// ============================================================

// 1) Firebase → Project settings → Your apps → Web app → "firebaseConfig"
export const firebaseConfig = {
  apiKey: "AIzaSyCDNS0cgjR7MuaHy0eiIXlfzgE4v6fK5TM",
  authDomain: "mytime-e688a.firebaseapp.com",
  projectId: "mytime-e688a",
  storageBucket: "mytime-e688a.firebasestorage.app",
  messagingSenderId: "1000444562164",
  appId: "1:1000444562164:web:d3ce743add2ea52fd32ca1"
};

// 2) Your email — this account becomes the ADMIN (auto-approved, sees everything).
//    Use the SAME email inside firestore.rules.
export const ADMIN_EMAIL = "rajkumar71234@gmail.com";

// 3) Cloudinary (free) — stores photos & videos.
export const CLOUDINARY = {
  cloudName: "PASTE_CLOUD_NAME",
  uploadPreset: "mytime_unsigned"
};
