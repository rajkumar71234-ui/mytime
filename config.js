// ============================================================
//  MyTime — configuration. Fill these in (see SETUP.md).
// ============================================================

// 1) Firebase → Project settings → Your apps → Web app → "firebaseConfig"
export const firebaseConfig = {
  apiKey: "PASTE_API_KEY",
  authDomain: "PASTE_PROJECT_ID.firebaseapp.com",
  projectId: "PASTE_PROJECT_ID",
  storageBucket: "PASTE_PROJECT_ID.appspot.com",
  messagingSenderId: "PASTE_SENDER_ID",
  appId: "PASTE_APP_ID"
};

// 2) Your email — this account becomes the ADMIN (auto-approved, sees everything).
//    Use the SAME email inside firestore.rules.
export const ADMIN_EMAIL = "your-email@gmail.com";

// 3) Cloudinary (free) — stores photos & videos.
export const CLOUDINARY = {
  cloudName: "PASTE_CLOUD_NAME",
  uploadPreset: "mytime_unsigned"
};
