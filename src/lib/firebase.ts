import { initializeApp, type FirebaseApp } from "firebase/app"
import { getAuth, type Auth } from "firebase/auth"
import {
  initializeFirestore, persistentLocalCache, persistentSingleTabManager,
  type Firestore,
} from "firebase/firestore"

const cfg = {
  apiKey:            (import.meta.env.VITE_FIREBASE_API_KEY ?? "").trim(),
  authDomain:        (import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? "").trim(),
  projectId:         (import.meta.env.VITE_FIREBASE_PROJECT_ID ?? "").trim(),
  storageBucket:     (import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? "").trim(),
  messagingSenderId: (import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? "").trim(),
  appId:             (import.meta.env.VITE_FIREBASE_APP_ID ?? "").trim(),
}

/** False when .env has no Firebase config — the app then runs fully local. */
export const firebaseConfigured = !!(cfg.apiKey && cfg.projectId && cfg.appId)

let app: FirebaseApp | null = null
let authInstance: Auth | null = null
let dbInstance: Firestore | null = null

if (firebaseConfigured) {
  app = initializeApp(cfg)
  authInstance = getAuth(app)
  // IndexedDB cache: after the first visit, reads resolve locally and the
  // network round trip happens in the background instead of blocking startup.
  dbInstance = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentSingleTabManager({}) }),
  })
}

export const auth = authInstance
export const db = dbInstance
