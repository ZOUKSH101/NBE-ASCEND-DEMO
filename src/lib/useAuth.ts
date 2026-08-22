import { useEffect, useState, useCallback } from "react"
import {
  onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  updateProfile, sendPasswordResetEmail, signOut, type User,
} from "firebase/auth"
import { auth, firebaseConfigured } from "./firebase"

export interface SessionUser { uid:string; email:string; displayName:string }

const DEMO_KEY = "nbe:demo-session"
const DEMO_UID_KEY = "nbe:demo-uid"

const toSession = (u:User): SessionUser => ({
  uid: u.uid,
  email: u.email ?? "",
  displayName: u.displayName ?? (u.email ?? "").split("@")[0],
})

/** Random and per-browser, never derived from anything the user typed — two
 *  people entering the same name must not land in the same demo profile. */
function demoUid(): string {
  try {
    const kept = localStorage.getItem(DEMO_UID_KEY)
    if (kept) return kept
  } catch { /* ignore */ }
  const fresh = `demo-${Math.random().toString(36).slice(2,10)}${Date.now().toString(36)}`
  try { localStorage.setItem(DEMO_UID_KEY, fresh) } catch { /* ignore */ }
  return fresh
}

export function friendlyAuthError(code:string): string {
  switch (code) {
    case "auth/invalid-email":            return "That email address is not valid."
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/invalid-credential":       return "Email or password is incorrect."
    case "auth/email-already-in-use":     return "An account already exists for this email."
    case "auth/weak-password":            return "Password must be at least 6 characters."
    case "auth/too-many-requests":        return "Too many attempts. Wait a minute and try again."
    case "auth/network-request-failed":   return "No connection. Check your network and retry."
    case "auth/operation-not-allowed":    return "Email sign-in is not enabled in the Firebase console."
    default:                              return "Sign-in failed. Please try again."
  }
}

export function useAuth() {
  const [user, setUser] = useState<SessionUser|null>(null)
  const [ready, setReady] = useState(false)

  useEffect(()=>{
    if (!firebaseConfigured || !auth) {
      try {
        const raw = localStorage.getItem(DEMO_KEY)
        if (raw) setUser(JSON.parse(raw) as SessionUser)
      } catch { /* ignore */ }
      setReady(true)
      return
    }
    return onAuthStateChanged(auth, u => { setUser(u ? toSession(u) : null); setReady(true) })
  }, [])

  const demoSignIn = useCallback((displayName:string): SessionUser => {
    const name = displayName.trim() || "Guest"
    const session: SessionUser = { uid: demoUid(), email:"", displayName: name }
    try { localStorage.setItem(DEMO_KEY, JSON.stringify(session)) } catch { /* ignore */ }
    setUser(session)
    return session
  }, [])

  const signIn = useCallback(async (email:string, password:string): Promise<SessionUser> => {
    // No backend means no way to check a password. Accepting one anyway is a
    // fake login under a bank's name — the demo gate is the only path here.
    if (!firebaseConfigured || !auth) throw new Error("Sign-in is unavailable in this demo build.")
    const cred = await signInWithEmailAndPassword(auth, email.trim(), password)
    return toSession(cred.user)
  }, [])

  const signUp = useCallback(async (email:string, password:string, displayName:string): Promise<SessionUser> => {
    if (!firebaseConfigured || !auth) throw new Error("Account creation is unavailable in this demo build.")
    const cred = await createUserWithEmailAndPassword(auth, email.trim(), password)
    if (displayName) await updateProfile(cred.user, { displayName })
    return { ...toSession(cred.user), displayName: displayName || toSession(cred.user).displayName }
  }, [])

  const resetPassword = useCallback(async (email:string) => {
    if (!firebaseConfigured || !auth) return
    await sendPasswordResetEmail(auth, email.trim())
  }, [])

  const logOut = useCallback(async () => {
    if (!firebaseConfigured || !auth) {
      try { localStorage.removeItem(DEMO_KEY) } catch { /* ignore */ }
      setUser(null)
      return
    }
    await signOut(auth)
  }, [])

  return { user, ready, signIn, signUp, resetPassword, logOut, demoSignIn, isDemo: !firebaseConfigured }
}
