import {
  doc, getDoc, setDoc, updateDoc, collection, addDoc, getDocs,
  serverTimestamp, query, orderBy,
} from "firebase/firestore"
import { db, firebaseConfigured } from "./firebase"

/* ─── Document shapes ──────────────────────────────────────────────────────
   Everything a screen needs on load lives in ONE document: users/{uid}.
   Sub-collections hold lists that grow. This keeps the read count low, which
   matters on Firestore's free tier.
   ───────────────────────────────────────────────────────────────────────── */

export type FunnelStage =
  | "curious" | "understands" | "account_opened"
  | "first_subscription" | "recurring" | "limit_raised"

export type TourKey = "home" | "invest" | "learn" | "goals" | "rewards"

export interface UserFlags {
  onboardingComplete: boolean
  firstGoalSet: boolean
  hasSubscribed: boolean
  funnelStage: FunnelStage
  toursSeen: Record<TourKey, boolean>
}

export interface UserPrefs {
  darkMode: boolean
  language: "en" | "ar"
  faceId: boolean
  reduceMotion: boolean
  notifications: { reminders:boolean; certs:boolean; growth:boolean }
}

export interface UserLimits {
  /** EGP the user may still commit this cycle. */
  remaining: number
  /** Cap the cycle started with. */
  cycleCap: number
  /** ISO date, e.g. "2026-09-01". */
  resetDate: string
}

export interface UserStats { points:number; level:number; streakDays:number }

export interface UserProfile {
  displayName: string
  email: string
  initials: string
  flags: UserFlags
  prefs: UserPrefs
  limits: UserLimits
  stats: UserStats
}

export interface GoalDoc {
  id: string
  name: string
  budget: string
  start: string
  end: string
  type: "user" | "builtin"
  builtinIndex?: number
  pct: number
}

export interface HoldingDoc {
  id: string
  kind: "certificate" | "fund"
  productName: string
  amount: number
  /** Annual % — contractual for certificates, historical average for funds. */
  rate: number
  term: string
  status: "active" | "pending" | "matured"
  purchasedAt: string
  maturesAt?: string
}

export const DEFAULT_PROFILE = (displayName:string, email:string): UserProfile => ({
  displayName,
  email,
  initials: displayName.split(" ").map(w=>w[0] ?? "").join("").slice(0,2).toUpperCase() || "NB",
  flags: {
    onboardingComplete: false,
    firstGoalSet: false,
    hasSubscribed: false,
    funnelStage: "curious",
    toursSeen: { home:false, invest:false, learn:false, goals:false, rewards:false },
  },
  prefs: {
    darkMode: true,
    language: "en",
    faceId: false,
    reduceMotion: false,
    notifications: { reminders:true, certs:true, growth:true },
  },
  limits: { remaining: 50000, cycleCap: 50000, resetDate: "2026-09-01" },
  stats: { points: 0, level: 1, streakDays: 0 },
})

/* ─── Local fallback ───────────────────────────────────────────────────────
   With no Firebase config the same API writes to localStorage, so the demo
   runs offline and every screen keeps one code path.
   ───────────────────────────────────────────────────────────────────────── */

const LS = {
  profile: (uid:string) => `nbe:${uid}:profile`,
  goals:   (uid:string) => `nbe:${uid}:goals`,
  holds:   (uid:string) => `nbe:${uid}:holdings`,
}
const readLS = <T,>(k:string, fb:T):T => {
  try { const v = localStorage.getItem(k); return v ? JSON.parse(v) as T : fb } catch { return fb }
}
const writeLS = (k:string, v:unknown) => {
  try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* private mode */ }
}

/* ─── Profile ──────────────────────────────────────────────────────────── */

export async function loadProfile(uid:string): Promise<UserProfile | null> {
  if (!firebaseConfigured || !db) return readLS<UserProfile|null>(LS.profile(uid), null)
  const snap = await getDoc(doc(db, "users", uid))
  return snap.exists() ? (snap.data() as UserProfile) : null
}

export async function createProfile(uid:string, displayName:string, email:string): Promise<UserProfile> {
  const profile = DEFAULT_PROFILE(displayName, email)
  if (!firebaseConfigured || !db) { writeLS(LS.profile(uid), profile); return profile }
  await setDoc(doc(db, "users", uid), { ...profile, createdAt: serverTimestamp() })
  return profile
}

/** Dot-path update, e.g. patchProfile(uid, { "flags.onboardingComplete": true }). */
export async function patchProfile(uid:string, patch:Record<string,unknown>): Promise<void> {
  if (!firebaseConfigured || !db) {
    const cur = readLS<UserProfile|null>(LS.profile(uid), null)
    if (!cur) return
    const next: any = structuredClone(cur)
    for (const [path, value] of Object.entries(patch)) {
      const parts = path.split(".")
      let node = next
      for (const p of parts.slice(0,-1)) node = node[p] ??= {}
      node[parts[parts.length-1]] = value
    }
    writeLS(LS.profile(uid), next)
    return
  }
  await updateDoc(doc(db, "users", uid), patch)
}

export const setTourSeen  = (uid:string, key:TourKey) => patchProfile(uid, { [`flags.toursSeen.${key}`]: true })
export const setPref      = (uid:string, key:string, value:unknown) => patchProfile(uid, { [`prefs.${key}`]: value })
export const setStage     = (uid:string, stage:FunnelStage) => patchProfile(uid, { "flags.funnelStage": stage })

/* ─── Goals ────────────────────────────────────────────────────────────── */

export async function loadGoals(uid:string): Promise<GoalDoc[]> {
  if (!firebaseConfigured || !db) return readLS<GoalDoc[]>(LS.goals(uid), [])
  const snap = await getDocs(query(collection(db, "users", uid, "goals"), orderBy("createdAt", "asc")))
  return snap.docs.map(d=>({ id:d.id, ...(d.data() as Omit<GoalDoc,"id">) }))
}

export async function addGoal(uid:string, goal:Omit<GoalDoc,"id">): Promise<GoalDoc> {
  if (!firebaseConfigured || !db) {
    const entry = { ...goal, id: Date.now().toString() }
    writeLS(LS.goals(uid), [...readLS<GoalDoc[]>(LS.goals(uid), []), entry])
    return entry
  }
  const ref = await addDoc(collection(db, "users", uid, "goals"), { ...goal, createdAt: serverTimestamp() })
  return { ...goal, id: ref.id }
}

/* ─── Holdings (certificate / fund subscriptions) ──────────────────────── */

export async function loadHoldings(uid:string): Promise<HoldingDoc[]> {
  if (!firebaseConfigured || !db) return readLS<HoldingDoc[]>(LS.holds(uid), [])
  const snap = await getDocs(query(collection(db, "users", uid, "holdings"), orderBy("purchasedAt", "desc")))
  return snap.docs.map(d=>({ id:d.id, ...(d.data() as Omit<HoldingDoc,"id">) }))
}

export async function addHolding(uid:string, holding:Omit<HoldingDoc,"id">): Promise<HoldingDoc> {
  if (!firebaseConfigured || !db) {
    const entry = { ...holding, id: Date.now().toString() }
    writeLS(LS.holds(uid), [entry, ...readLS<HoldingDoc[]>(LS.holds(uid), [])])
    return entry
  }
  const ref = await addDoc(collection(db, "users", uid, "holdings"), holding)
  return { ...holding, id: ref.id }
}

/** Summary string the Acsend prompt drops into its {{holdings}} slot. */
export function describeHoldings(holdings:HoldingDoc[]): string {
  if (!holdings.length) return ""
  return holdings
    .filter(h=>h.status !== "matured")
    .map(h=>`${h.productName} — EGP ${h.amount.toLocaleString()} at ${h.rate}%, ${h.term}`)
    .join("; ")
}
