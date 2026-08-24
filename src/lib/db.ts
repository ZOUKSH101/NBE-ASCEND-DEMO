import {
  doc, getDoc, setDoc, collection, addDoc, getDocs,
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

export interface UserStats { points:number; level:number; streakDays:number; lastActive?:string }

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

/** ISO date one month on from `from`. */
export function nextCycleDate(from = new Date()): string {
  const d = new Date(from.getFullYear(), from.getMonth() + 1, 1)
  return d.toISOString().slice(0,10)
}

/**
 * The cycle cap is worthless without a rollover — spend it once and the user is
 * locked out forever. Returns the patch to apply when the reset date has passed.
 */
export function cycleRollover(p:UserProfile|null): Record<string,unknown> | null {
  if (!p?.limits?.resetDate) return null
  const due = new Date(p.limits.resetDate).getTime()
  if (!Number.isFinite(due) || Date.now() < due) return null
  return {
    "limits.remaining": p.limits.cycleCap,
    "limits.resetDate": nextCycleDate(),
  }
}

/** Avatar initials for a full name. Exported so a repaired name can rebuild
 *  them without duplicating the rule. */
export const initialsOf = (displayName:string): string =>
  displayName.trim().split(/\s+/).map(w=>w[0] ?? "").join("").slice(0,2).toUpperCase() || "NB"

/** True when a stored name is really just the local part of the email — the
 *  signature of an account created before signUp waited for updateProfile. */
export const isEmailPrefixName = (displayName:string, email:string): boolean => {
  const local = (email || "").split("@")[0].trim().toLowerCase()
  return !!local && displayName.trim().toLowerCase() === local
}

export const DEFAULT_PROFILE = (displayName:string, email:string): UserProfile => ({
  displayName,
  email,
  initials: initialsOf(displayName),
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
  limits: { remaining: 50000, cycleCap: 50000, resetDate: nextCycleDate() },
  stats: { points: 0, level: 1, streakDays: 0 },
})

/* ─── Local fallback ───────────────────────────────────────────────────────
   With no Firebase config the same API writes to localStorage, so the demo
   runs offline and every screen keeps one code path.
   ───────────────────────────────────────────────────────────────────────── */

const LS = {
  profile: (uid:string) => `nbe:${uid}:profile`,
  mirror:  (uid:string) => `nbe:${uid}:mirror`,
  goals:   (uid:string) => `nbe:${uid}:goals`,
  holds:   (uid:string) => `nbe:${uid}:holdings`,
}
let seq = 0
/** Date.now() collides when two records are created in the same millisecond. */
const localId = () => `l${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2,6)}`

const readLS = <T,>(k:string, fb:T):T => {
  try { const v = localStorage.getItem(k); return v ? JSON.parse(v) as T : fb } catch { return fb }
}
const writeLS = (k:string, v:unknown) => {
  try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* private mode */ }
}

/* ─── Profile ──────────────────────────────────────────────────────────── */

/**
 * Fill any missing branch from the defaults. A document written by an earlier
 * partial merge can be missing whole maps, and reading `profile.prefs.darkMode`
 * off one of those throws — better to normalise once, here.
 */
export function normalizeProfile(raw:Partial<UserProfile>|null|undefined, displayName="", email=""): UserProfile {
  const d = DEFAULT_PROFILE(raw?.displayName ?? displayName, raw?.email ?? email)
  return {
    ...d, ...raw,
    displayName: raw?.displayName || d.displayName,
    email:       raw?.email       || d.email,
    initials:    raw?.initials    || d.initials,
    flags:  { ...d.flags,  ...(raw?.flags  ?? {}),
              toursSeen: { ...d.flags.toursSeen, ...((raw?.flags as any)?.toursSeen ?? {}) } },
    prefs:  { ...d.prefs,  ...(raw?.prefs  ?? {}),
              notifications: { ...d.prefs.notifications, ...((raw?.prefs as any)?.notifications ?? {}) } },
    limits: { ...d.limits, ...(raw?.limits ?? {}) },
    stats:  { ...d.stats,  ...(raw?.stats  ?? {}) },
  }
}

/**
 * Last profile Firestore gave us. A transient read failure must not look like
 * a brand-new user, or the app sends them back through onboarding.
 */
export const readMirror = (uid:string): UserProfile | null => {
  const raw = readLS<Partial<UserProfile>|null>(LS.mirror(uid), null)
  return raw ? normalizeProfile(raw) : null
}

const writeMirror = (uid:string, p:UserProfile) => writeLS(LS.mirror(uid), p)

export async function loadProfile(uid:string): Promise<UserProfile | null> {
  if (!firebaseConfigured || !db) {
    const local = readLS<Partial<UserProfile>|null>(LS.profile(uid), null)
    return local ? normalizeProfile(local) : null
  }
  const snap = await getDoc(doc(db, "users", uid))
  if (!snap.exists()) return null
  const p = normalizeProfile(snap.data() as Partial<UserProfile>)
  writeMirror(uid, p)
  return p
}

export async function createProfile(uid:string, displayName:string, email:string): Promise<UserProfile> {
  const profile = DEFAULT_PROFILE(displayName, email)
  if (!firebaseConfigured || !db) { writeLS(LS.profile(uid), profile); return profile }
  await setDoc(doc(db, "users", uid), { ...profile, createdAt: serverTimestamp() })
  writeMirror(uid, profile)
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
  // setDoc+merge instead of updateDoc: updateDoc rejects outright if the user
  // document does not exist yet, which silently swallowed every flag write
  // whenever the initial create had not landed. merge:true creates or merges.
  const nested: Record<string, any> = {}
  for (const [path, value] of Object.entries(patch)) {
    const parts = path.split(".")
    let node = nested
    for (const seg of parts.slice(0, -1)) node = node[seg] ??= {}
    node[parts[parts.length - 1]] = value
  }
  await setDoc(doc(db, "users", uid), nested, { merge: true })
}

/** Keep the local mirror in step with an optimistic in-memory update. */
export function mirrorProfile(uid:string, profile:UserProfile) {
  if (firebaseConfigured) writeMirror(uid, profile)
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
    const entry = { ...goal, id: localId() }
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
    const entry = { ...holding, id: localId() }
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
