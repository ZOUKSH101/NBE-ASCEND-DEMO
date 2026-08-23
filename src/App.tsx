import { useState, useRef, useEffect, useCallback, createContext, useContext } from "react"
import { buildSystemPrompt } from "./lib/acsendPrompt"
import { askAcsend, llmConfigured } from "./lib/llm"
import { useAuth, friendlyAuthError, type SessionUser } from "./lib/useAuth"
import { firebaseConfigured } from "./lib/firebase"
import {
  loadProfile, createProfile, patchProfile, loadGoals, addGoal,
  loadHoldings, addHolding, describeHoldings, DEFAULT_PROFILE, readMirror, mirrorProfile, cycleRollover,
  type UserProfile, type GoalDoc, type HoldingDoc, type TourKey,
} from "./lib/db"
import logoImg from "./imports/ChatGPT_Image_Aug_20__2026__12_06_04_PM.png"

// ─── Brand palette ────────────────────────────────────────────────────────────
const GR   = "#087A4B"
const GRD  = "#064532"
const GRL  = "#EAF6F1"
const GRLL = "#F3FAF7"
const GD   = "#C9A227"
const GDS  = "#E8D48A"
const ERR  = "#DC2626"

// ─── Theme ────────────────────────────────────────────────────────────────────
interface Th {
  bg:string; card:string; cardAlt:string; cardAlt2:string; text:string; sub:string
  border:string; inputBg:string; dm:boolean
  frame:string; blur:string; stroke:string; strokeS:string; chip:string; glass2:string
  track:string; brand:string; gold:string; navBg:string; shadow:string; orbA:string; orbB:string
}

const lightTheme: Th = {
  bg:"transparent",
  frame:"radial-gradient(125% 85% at 12% -5%, #D8F0E6 0%, #EEF9F5 42%, #FAF5E7 100%)",
  card:"rgba(255,255,255,0.66)",
  cardAlt:"rgba(8,122,75,0.10)",
  cardAlt2:"rgba(255,255,255,0.50)",
  text:"#0B2A21",
  sub:"#5F7D71",
  border:"rgba(11,42,33,0.09)",
  inputBg:"rgba(255,255,255,0.60)",
  dm:false,
  blur:"blur(22px) saturate(170%)",
  stroke:"rgba(255,255,255,0.85)",
  strokeS:"rgba(255,255,255,1)",
  chip:"rgba(255,255,255,0.58)",
  glass2:"rgba(255,255,255,0.82)",
  track:"rgba(11,42,33,0.10)",
  brand:GR,
  gold:"#9C7714",
  navBg:"rgba(255,255,255,0.74)",
  shadow:"0 10px 30px rgba(9,50,36,0.10)",
  orbA:"rgba(8,122,75,0.20)",
  orbB:"rgba(201,162,39,0.20)",
}

const darkTheme: Th = {
  bg:"transparent",
  frame:"radial-gradient(125% 90% at 15% -5%, #0D3627 0%, #06180F 50%, #020A06 100%)",
  card:"rgba(255,255,255,0.055)",
  cardAlt:"rgba(255,255,255,0.09)",
  cardAlt2:"rgba(255,255,255,0.04)",
  text:"#E9F5EF",
  sub:"#82A896",
  border:"rgba(255,255,255,0.10)",
  inputBg:"rgba(255,255,255,0.05)",
  dm:true,
  blur:"blur(26px) saturate(150%)",
  stroke:"rgba(255,255,255,0.10)",
  strokeS:"rgba(255,255,255,0.20)",
  chip:"rgba(255,255,255,0.07)",
  glass2:"rgba(255,255,255,0.11)",
  track:"rgba(255,255,255,0.10)",
  brand:"#3DD68C",
  gold:GDS,
  navBg:"rgba(9,25,17,0.58)",
  shadow:"0 16px 40px rgba(0,0,0,0.48)",
  orbA:"rgba(8,122,75,0.30)",
  orbB:"rgba(201,162,39,0.18)",
}

const ThCtx = createContext<{ t: Th; lang: "en"|"ar"; setLang:(l:"en"|"ar")=>void; faceId:boolean; setFaceId:(v:boolean)=>void; notifPrefs:{reminders:boolean;certs:boolean;growth:boolean}; setNotifPref:(k:keyof{reminders:boolean;certs:boolean;growth:boolean},v:boolean)=>void }>({ t:lightTheme, lang:"en", setLang:()=>{}, faceId:false, setFaceId:()=>{}, notifPrefs:{reminders:true,certs:true,growth:true}, setNotifPref:()=>{} })
const useT = () => useContext(ThCtx)

// ─── App state (auth session + Firestore profile) ────────────────────────────
interface AppState {
  uid: string
  profile: UserProfile | null
  patch: (p:Record<string,unknown>)=>void
  holdings: HoldingDoc[]
  buy: (h:Omit<HoldingDoc,"id">)=>Promise<void>
  logOut: ()=>void
  isDemo: boolean
}
const AppCtx = createContext<AppState>({
  uid:"", profile:null, patch:()=>{}, holdings:[], buy:async()=>{}, logOut:()=>{}, isDemo:true,
})
const useApp = () => useContext(AppCtx)

const TR: Record<string,Record<"en"|"ar",string>> = {
  home:     { en:"Home",          ar:"الرئيسية" },
  invest:   { en:"Invest",        ar:"استثمر" },
  learn:    { en:"Learn",         ar:"تعلّم" },
  goals:    { en:"Goals",         ar:"الأهداف" },
  rewards:  { en:"Rewards",       ar:"المكافآت" },
  profile:  { en:"Profile",       ar:"الملف الشخصي" },
  security: { en:"Security",      ar:"الأمان" },
  help:     { en:"Help",          ar:"المساعدة" },
  gmorn:    { en:"Good morning,", ar:"صباح الخير،" },
  gaft:     { en:"Good afternoon,", ar:"مساء الخير،" },
  geve:     { en:"Good evening,", ar:"مساء الخير،" },
  balance:  { en:"Total Balance", ar:"إجمالي الرصيد" },
  invest_title: { en:"Available to Invest", ar:"متاح للاستثمار" },
  cur_inv:  { en:"Currently Invested",      ar:"المستثمر حالياً" },
  annual:   { en:"Annual Return",           ar:"العائد السنوي" },
  my_goals: { en:"My Goals",     ar:"أهدافي" },
  see_all:  { en:"See all →",    ar:"عرض الكل →" },
  daily_tip:{ en:"DAILY TIP",    ar:"نصيحة اليوم" },
  add_card: { en:"Add New Card", ar:"أضف بطاقة جديدة" },
  add_goal: { en:"+ Add Goal",   ar:"+ أضف هدف" },
  dark_mode:{ en:"Dark Mode",    ar:"الوضع الداكن" },
  language: { en:"Language",     ar:"اللغة" },
  face_id:  { en:"Face ID",      ar:"معرف الوجه" },
  logout:   { en:"Log Out",      ar:"تسجيل الخروج" },
}
const tx = (key:string, lang:"en"|"ar") => TR[key]?.[lang] ?? key

type Screen = "login"|"signup"|"forgot"|"onboarding"|"goalsetup"|"home"|"invest"|"learn"|"lesson"|"goals"|"rewards"|"dailyreview"|"notifications"|"profile"|"settings"|"security"|"help"

let localSeq = 0
/** Date.now() alone collides for records created in the same millisecond. */
const newLocalId = () => `l${Date.now().toString(36)}${(localSeq++).toString(36)}${Math.random().toString(36).slice(2,6)}`

// ─── Viewport ────────────────────────────────────────────────────────────────
/** True on a real phone-sized screen — the device frame is dropped there. */
/** Width the UI was laid out against. Everything scales relative to this. */
const DESIGN_WIDTH = 390

/** Widest the app column is allowed to get. Past this it would stretch a
 *  390px layout across a desktop window rather than read as an app. */
const MAX_WIDTH = 560

/** Gap between the bottom of the screen and the bottom of the nav pill, in px.
 *  The home-indicator inset is added on top of this. One number, tune here. */
const NAV_GAP = 20

const measure = () => {
  if (typeof window === "undefined") return { scale:1, width:DESIGN_WIDTH }
  // One layout at every size — there is no desktop mockup to fall back to.
  const width = Math.min(window.innerWidth, MAX_WIDTH)
  // 320 (SE) → 0.86, 390 (design) → 1, 430 (Pro Max) → 1.10.
  const scale = Math.min(Math.max(width / DESIGN_WIDTH, 0.84), 1.14)
  return { scale: Math.round(scale * 1000) / 1000, width }
}

function useViewport() {
  const [vp, setVp] = useState(measure)
  useEffect(()=>{
    let frame = 0
    const on = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(()=>setVp(measure()))
    }
    window.addEventListener("resize", on)
    window.addEventListener("orientationchange", on)
    return ()=>{
      cancelAnimationFrame(frame)
      window.removeEventListener("resize", on)
      window.removeEventListener("orientationchange", on)
    }
  }, [])
  return vp
}

/**
 * 100dvh is the browser's guess at the visible height: it lags the collapsing
 * address bar on scroll and ignores the keyboard entirely, so the frame — and
 * the nav pinned to its bottom — drifted a few pixels at a time. visualViewport
 * reports the real visible box. Published as CSS vars and returned as the
 * keyboard overlap so the nav can get out of the way.
 */
function useVisualViewport() {
  const [kbInset, setKbInset] = useState(0)
  useEffect(()=>{
    const vv = window.visualViewport
    if (!vv) return
    let frame = 0
    const on = (cause?:string) => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(()=>{
        // A pinch-zoomed viewport reports a smaller height for reasons that
        // have nothing to do with the keyboard; resizing the app to it would
        // fight the user's zoom. Only trust an unzoomed measurement.
        if (Math.abs(vv.scale - 1) > 0.01) return
        // No offsetTop term: iOS scrolls the layout viewport when the keyboard
        // opens, offsetTop grows by almost exactly what vv.height lost, and the
        // two cancelled — the measured overlap was ~0 with a keyboard on screen.
        const overlap = Math.max(0, Math.round(window.innerHeight - vv.height))
        // The URL bar collapsing also moves vv.height. Feeding that into the
        // frame height shifted the whole layout mid-scroll, so only a genuine
        // resize may change it; a scroll just re-reads the keyboard inset.
        if (cause !== "scroll") document.documentElement.style.setProperty("--vvh", `${Math.round(vv.height)}px`)
        document.documentElement.style.setProperty("--kb-inset", `${overlap}px`)
        setKbInset(overlap)
      })
    }
    // Closing the keyboard leaves the page panned up with no way to scroll it
    // back — the shell is overflow:hidden. Put it back by hand, after the
    // browser has finished animating the keyboard away.
    const onBlur = () => {
      setTimeout(()=>{
        window.scrollTo(0, 0)
        document.documentElement.scrollTop = 0
        document.body.scrollTop = 0
        on()
      }, 120)
    }
    on()
    const onScroll = () => on("scroll")
    const onResize = () => on("resize")
    vv.addEventListener("resize", onResize)
    vv.addEventListener("scroll", onScroll)
    window.addEventListener("focusout", onBlur)
    window.addEventListener("orientationchange", onResize)
    return ()=>{
      cancelAnimationFrame(frame)
      vv.removeEventListener("resize", onResize)
      vv.removeEventListener("scroll", onScroll)
      window.removeEventListener("focusout", onBlur)
      window.removeEventListener("orientationchange", onResize)
    }
  }, [])
  return kbInset
}

/** ?vp=1 pins a live readout over the app so the numbers come from the device
 *  instead of from guesswork. Absent from every normal load. */
const DEBUG_VP = typeof window !== "undefined" && window.location.search.includes("vp=1")

function ViewportProbe({ kbInset, scale }: { kbInset:number; scale:number }) {
  const [n, setN] = useState(0)
  useEffect(()=>{
    const id = setInterval(()=>setN(v=>v+1), 250)
    return ()=>clearInterval(id)
  }, [])
  const vv = typeof window !== "undefined" ? window.visualViewport : null
  const rows: [string,string|number][] = [
    ["tick", n],
    ["innerH", typeof window !== "undefined" ? window.innerHeight : 0],
    ["vv.h", vv ? Math.round(vv.height) : "none"],
    ["vv.top", vv ? Math.round(vv.offsetTop) : "none"],
    ["vv.scale", vv ? vv.scale.toFixed(2) : "none"],
    ["scrollY", typeof window !== "undefined" ? Math.round(window.scrollY) : 0],
    ["kbInset", kbInset],
    ["scale", scale],
  ]
  return <div style={{ position:"absolute", top:60, left:8, zIndex:999, background:"rgba(0,0,0,0.82)", color:"#7CFFB2", font:"11px/1.5 monospace", padding:"8px 10px", borderRadius:8, pointerEvents:"none" }}>
    {rows.map(([k,v])=><div key={k}>{k}: {v}</div>)}
  </div>
}

// ─── Progression ─────────────────────────────────────────────────────────────
const LEVEL_NAMES = ["Beginner", "Saver", "Rising Investor", "Confident Investor", "Strategist"]
const PTS_PER_LEVEL = 1000
const PTS_GOAL = 75
const PTS_INVEST = 100
const PTS_TOUR = 25
/** Redeem tiles read 100 pts = EGP 10, so the wallet figure must use the same rate. */
const PTS_PER_EGP = 10

function progression(points:number) {
  const level = Math.min(LEVEL_NAMES.length, Math.floor(points / PTS_PER_LEVEL) + 1)
  const nextAt = level * PTS_PER_LEVEL
  const floor  = (level - 1) * PTS_PER_LEVEL
  const maxed  = level >= LEVEL_NAMES.length
  return {
    level,
    name: LEVEL_NAMES[level - 1],
    nextAt,
    toNext: maxed ? 0 : nextAt - points,
    pct: maxed ? 100 : Math.round(((points - floor) / PTS_PER_LEVEL) * 100),
    maxed,
    cashback: Math.floor(points / PTS_PER_EGP),
  }
}

/** Calendar date in the user's own timezone. toISOString() is UTC, which put
 *  a purchase made after midnight in Cairo on the previous day. */
const localISO = (d:Date = new Date()) =>
  new Date(d.getTime() - d.getTimezoneOffset()*60000).toISOString().slice(0,10)

/** The Streak pill read "0 days" forever — nothing ever advanced the counter.
 *  Consecutive calendar days keep it, one missed day resets it to 1. */
function streakUpdate(p:UserProfile): Record<string,unknown> | null {
  const today = localISO()
  const last = p.stats.lastActive
  if (last === today) return null
  const yesterday = localISO(new Date(Date.now() - 86400000))
  const days = last === yesterday ? (p.stats.streakDays || 0) + 1 : 1
  return { "stats.streakDays": days, "stats.lastActive": today }
}

/** The greeting was fixed at "Good morning" whatever the clock said. */
const greetKey = () => { const h = new Date().getHours(); return h < 12 ? "gmorn" : h < 18 ? "gaft" : "geve" }

/** Years a product runs for, read off its duration label. Funds have none. */
const termYears = (dur:string) => { const m = dur.match(/(\d+)\s*Year/i); return m ? Number(m[1]) : 1 }

// ─── Primitives ───────────────────────────────────────────────────────────────
function Ring({ pct, size=60, w=5, color=GR }: { pct:number; size?:number; w?:number; color?:string }) {
  const r=(size-w*2)/2, c=2*Math.PI*r
  return <svg width={size} height={size} style={{ flexShrink:0, transform:"rotate(-90deg)" }}>
    <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(140,152,146,0.22)" strokeWidth={w}/>
    <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={w} strokeDasharray={c} strokeDashoffset={c*(1-pct/100)} strokeLinecap="round"/>
  </svg>
}
function Bar({ pct, color=GR, h=6, trackColor="rgba(140,152,146,0.22)" }: { pct:number; color?:string; h?:number; trackColor?:string }) {
  return <div style={{ height:h, borderRadius:h, background:trackColor, overflow:"hidden", width:"100%" }}>
    <div style={{ width:`${pct}%`, height:h, background:color, borderRadius:h, transition:"width 0.6s ease" }}/>
  </div>
}
function W({ s, children }: { s:number; children:React.ReactNode }) {
  return <svg viewBox="0 0 24 24" width={s} height={s} style={{ flexShrink:0 }}>{children}</svg>
}
function Ic({ n, c="#64748B", s=20 }: { n:string; c?:string; s?:number }) {
  const p = { stroke:c, strokeWidth:1.8, strokeLinecap:"round" as const, strokeLinejoin:"round" as const, fill:"none" }
  if (n==="home")     return <W s={s}><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" {...p}/><polyline points="9,22 9,12 15,12 15,22" {...p}/></W>
  if (n==="chart")    return <W s={s}><polyline points="23,6 13.5,15.5 8.5,10.5 1,18" {...p}/><polyline points="17,6 23,6 23,12" {...p}/></W>
  if (n==="book")     return <W s={s}><path d="M4 19.5A2.5 2.5 0 016.5 17H20" {...p}/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" {...p}/></W>
  if (n==="target")   return <W s={s}><circle cx="12" cy="12" r="10" {...p}/><circle cx="12" cy="12" r="6" {...p}/><circle cx="12" cy="12" r="2" {...p}/></W>
  if (n==="award")    return <W s={s}><circle cx="12" cy="8" r="6" {...p}/><path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11" {...p}/></W>
  if (n==="bell")     return <W s={s}><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" {...p}/><path d="M13.73 21a2 2 0 01-3.46 0" {...p}/></W>
  if (n==="right")    return <W s={s}><polyline points="9,18 15,12 9,6" {...p}/></W>
  if (n==="left")     return <W s={s}><line x1="19" y1="12" x2="5" y2="12" {...p}/><polyline points="12,19 5,12 12,5" {...p}/></W>
  if (n==="check")    return <W s={s}><polyline points="20,6 9,17 4,12" {...p}/></W>
  if (n==="lock")     return <W s={s}><rect x="3" y="11" width="18" height="11" rx="2" {...p}/><path d="M7 11V7a5 5 0 0110 0v4" {...p}/></W>
  if (n==="chat")     return <W s={s}><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" {...p}/></W>
  if (n==="shield")   return <W s={s}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" {...p}/></W>
  if (n==="eye")      return <W s={s}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" {...p}/><circle cx="12" cy="12" r="3" {...p}/></W>
  if (n==="eye-off")  return <W s={s}><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" {...p}/><line x1="1" y1="1" x2="23" y2="23" {...p}/></W>
  if (n==="user")     return <W s={s}><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" {...p}/><circle cx="12" cy="7" r="4" {...p}/></W>
  if (n==="mail")     return <W s={s}><rect x="2" y="4" width="20" height="16" rx="2" {...p}/><polyline points="22,6 12,13 2,6" {...p}/></W>
  if (n==="phone")    return <W s={s}><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.8 19.79 19.79 0 01.01 1.18C.01.6.44.06 1.04.01h3a2 2 0 012 1.72c.12.96.36 1.9.72 2.81a2 2 0 01-.45 2.11L5.34 7.6a16 16 0 006.06 6.06l.97-.97a2 2 0 012.11-.45c.91.36 1.85.6 2.81.72a2 2 0 011.71 2.03z" {...p}/></W>
  if (n==="trending") return <W s={s}><polyline points="23,6 13.5,15.5 8.5,10.5 1,18" {...p}/><polyline points="17,6 23,6 23,12" {...p}/></W>
  if (n==="credit")   return <W s={s}><rect x="1" y="4" width="22" height="16" rx="2" ry="2" {...p}/><line x1="1" y1="10" x2="23" y2="10" {...p}/></W>
  if (n==="wallet")   return <W s={s}><path d="M20 7H4a2 2 0 00-2 2v10a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2z" {...p}/><path d="M16 3H8L4 7h16l-4-4z" {...p}/><circle cx="17" cy="14" r="1" fill={c} stroke="none"/></W>
  if (n==="gift")     return <W s={s}><polyline points="20,12 20,22 4,22 4,12" {...p}/><rect x="2" y="7" width="20" height="5" {...p}/><line x1="12" y1="22" x2="12" y2="7" {...p}/><path d="M12 7H7.5a2.5 2.5 0 010-5C11 2 12 7 12 7z" {...p}/><path d="M12 7h4.5a2.5 2.5 0 000-5C13 2 12 7 12 7z" {...p}/></W>
  if (n==="bank")     return <W s={s}><line x1="3" y1="22" x2="21" y2="22" {...p}/><line x1="6" y1="18" x2="6" y2="11" {...p}/><line x1="10" y1="18" x2="10" y2="11" {...p}/><line x1="14" y1="18" x2="14" y2="11" {...p}/><line x1="18" y1="18" x2="18" y2="11" {...p}/><polygon points="12,2 20,7 4,7" {...p}/></W>
  if (n==="send")     return <W s={s}><line x1="22" y1="2" x2="11" y2="13" {...p}/><polygon points="22,2 15,22 11,13 2,9" {...p}/></W>
  if (n==="refresh")  return <W s={s}><polyline points="23,4 23,10 17,10" {...p}/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" {...p}/></W>
  if (n==="x")        return <W s={s}><line x1="18" y1="6" x2="6" y2="18" {...p}/><line x1="6" y1="6" x2="18" y2="18" {...p}/></W>
  if (n==="plus")     return <W s={s}><line x1="12" y1="5" x2="12" y2="19" {...p}/><line x1="5" y1="12" x2="19" y2="12" {...p}/></W>
  if (n==="key")      return <W s={s}><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" {...p}/></W>
  if (n==="help")     return <W s={s}><circle cx="12" cy="12" r="10" {...p}/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" {...p}/><line x1="12" y1="17" x2="12.01" y2="17" {...p}/></W>
  if (n==="moon")     return <W s={s}><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" {...p}/></W>
  if (n==="face")     return <W s={s}><circle cx="12" cy="12" r="10" {...p}/><path d="M8 14s1.5 2 4 2 4-2 4-2" {...p}/><line x1="9" y1="9" x2="9.01" y2="9" {...p}/><line x1="15" y1="9" x2="15.01" y2="9" {...p}/></W>
  if (n==="sun")      return <W s={s}><circle cx="12" cy="12" r="4.5" {...p}/><line x1="12" y1="1" x2="12" y2="3.5" {...p}/><line x1="12" y1="20.5" x2="12" y2="23" {...p}/><line x1="4.2" y1="4.2" x2="6" y2="6" {...p}/><line x1="18" y1="18" x2="19.8" y2="19.8" {...p}/><line x1="1" y1="12" x2="3.5" y2="12" {...p}/><line x1="20.5" y1="12" x2="23" y2="12" {...p}/><line x1="4.2" y1="19.8" x2="6" y2="18" {...p}/><line x1="18" y1="6" x2="19.8" y2="4.2" {...p}/></W>
  if (n==="settings") return <W s={s}><circle cx="12" cy="12" r="3" {...p}/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 008 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.6 15a1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.6a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" {...p}/></W>
  if (n==="logout")   return <W s={s}><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" {...p}/><polyline points="16,17 21,12 16,7" {...p}/><line x1="21" y1="12" x2="9" y2="12" {...p}/></W>
  if (n==="privacy")  return <W s={s}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" {...p}/><path d="M9 12l2 2 4-4" {...p}/></W>
  if (n==="clock")    return <W s={s}><circle cx="12" cy="12" r="10" {...p}/><polyline points="12,6 12,12 16,14" {...p}/></W>
  if (n==="doc")      return <W s={s}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" {...p}/><polyline points="14,2 14,8 20,8" {...p}/><line x1="16" y1="13" x2="8" y2="13" {...p}/><line x1="16" y1="17" x2="8" y2="17" {...p}/></W>
  if (n==="calendar") return <W s={s}><rect x="3" y="4" width="18" height="18" rx="2" ry="2" {...p}/><line x1="16" y1="2" x2="16" y2="6" {...p}/><line x1="8" y1="2" x2="8" y2="6" {...p}/><line x1="3" y1="10" x2="21" y2="10" {...p}/></W>
  if (n==="tag")      return <W s={s}><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" {...p}/><line x1="7" y1="7" x2="7.01" y2="7" {...p}/></W>
  if (n==="info")     return <W s={s}><circle cx="12" cy="12" r="10" {...p}/><line x1="12" y1="8" x2="12" y2="12" {...p}/><line x1="12" y1="16" x2="12.01" y2="16" {...p}/></W>
  if (n==="list")     return <W s={s}><line x1="8" y1="6" x2="21" y2="6" {...p}/><line x1="8" y1="12" x2="21" y2="12" {...p}/><line x1="8" y1="18" x2="21" y2="18" {...p}/><line x1="3" y1="6" x2="3.01" y2="6" {...p}/><line x1="3" y1="12" x2="3.01" y2="12" {...p}/><line x1="3" y1="18" x2="3.01" y2="18" {...p}/></W>
  if (n==="star")     return <W s={s}><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" {...p}/></W>
  if (n==="msg")      return <W s={s}><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" {...p}/></W>
  return <W s={s}><circle cx="12" cy="12" r="10" {...p}/></W>
}

function Logo({ light=false }: { light?:boolean }) {
  const { t } = useT()
  return (
    <img
      src={logoImg}
      alt="NBE Youth"
      style={{
        height: 46,
        width: "auto",
        display: "block",
        filter: (light || t.dm) ? "brightness(0) invert(1)" : "none",
      }}
    />
  )
}

function Toggle({ on, onToggle }: { on:boolean; onToggle:()=>void }) {
  return <div onClick={onToggle} style={{ width:46, height:26, borderRadius:13, background:on?GR:"#CBD5E1", cursor:"pointer", position:"relative", transition:"background 0.25s ease", flexShrink:0 }}>
    <div style={{ position:"absolute", top:3, left:on?23:3, width:20, height:20, borderRadius:10, background:"white", transition:"left 0.25s ease", boxShadow:"0 1px 3px rgba(0,0,0,0.2)" }}/>
  </div>
}

function SRow({ icon, iconColor=GR, label, sub, right, onClick, danger=false }: { icon:string; iconColor?:string; label:string; sub?:string; right?:React.ReactNode; onClick?:()=>void; danger?:boolean }) {
  const { t } = useT()
  return <div onClick={onClick} style={{ display:"flex", alignItems:"center", gap:14, padding:"13px 16px", cursor:onClick?"pointer":"default" }}>
    <div style={{ width:40, height:40, borderRadius:12, background:danger?`${ERR}12`:`${iconColor}12`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
      <Ic n={icon} c={danger?ERR:iconColor} s={20}/>
    </div>
    <div style={{ flex:1 }}>
      <div style={{ fontSize:14, fontWeight:600, color:danger?ERR:t.text }}>{label}</div>
      {sub && <div style={{ fontSize:12, color:t.sub, marginTop:1 }}>{sub}</div>}
    </div>
    {right ?? (onClick && <Ic n="right" c={t.sub} s={18}/>)}
  </div>
}

function SSection({ label, children }: { label:string; children:React.ReactNode }) {
  const { t } = useT()
  return <div style={{ marginBottom:16 }}>
    <div style={{ fontSize:11, fontWeight:800, color:t.sub, letterSpacing:1.2, textTransform:"uppercase" as const, padding:"0 16px", marginBottom:4 }}>{label}</div>
    <div style={{ background:t.card, backdropFilter:t.blur, WebkitBackdropFilter:t.blur, border:`1px solid ${t.stroke}`, borderRadius:20, overflow:"hidden", boxShadow:`0 1px 4px rgba(0,0,0,${t.dm?0.2:0.06})` }}>{children}</div>
  </div>
}

function Divider() {
  const { t } = useT()
  return <div style={{ height:1, background:t.border, margin:"0 16px" }}/>
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
function AuthInput({ icon, placeholder, type="text", value, onChange, style:extraStyle, autoComplete }: {
  icon:string; placeholder:string; type?:string; value:string
  onChange:(v:string)=>void; style?:React.CSSProperties; autoComplete?:string
}) {
  const { t } = useT()
  const [focus, setFocus] = useState(false)
  return <div style={{ display:"flex", alignItems:"center", gap:12, border:`1.5px solid ${focus?t.brand:t.stroke}`, borderRadius:999, padding:"13px 18px", background:focus?t.cardAlt:t.inputBg, backdropFilter:t.blur, WebkitBackdropFilter:t.blur, transition:"all 0.2s", ...extraStyle }}>
    <Ic n={icon} c={focus?t.brand:t.sub} s={18}/>
    <input type={type} value={value} autoComplete={autoComplete} placeholder={placeholder}
      onChange={e=>onChange(e.target.value)} onFocus={()=>setFocus(true)} onBlur={()=>setFocus(false)}
      style={{ flex:1, border:"none", outline:"none", fontSize:16, color:t.text, background:"transparent", fontFamily:"inherit", minWidth:0 }}/>
  </div>
}

function PasswordInput({ placeholder, value, onChange, autoComplete }: {
  placeholder:string; value:string; onChange:(v:string)=>void; autoComplete?:string
}) {
  const { t } = useT()
  const [focus, setFocus] = useState(false)
  const [show, setShow] = useState(false)
  return <div style={{ display:"flex", alignItems:"center", gap:12, border:`1.5px solid ${focus?t.brand:t.stroke}`, borderRadius:999, padding:"13px 18px", background:focus?t.cardAlt:t.inputBg, backdropFilter:t.blur, WebkitBackdropFilter:t.blur, transition:"all 0.2s" }}>
    <Ic n="lock" c={focus?t.brand:t.sub} s={18}/>
    <input type={show?"text":"password"} value={value} autoComplete={autoComplete} placeholder={placeholder}
      onChange={e=>onChange(e.target.value)} onFocus={()=>setFocus(true)} onBlur={()=>setFocus(false)}
      style={{ flex:1, border:"none", outline:"none", fontSize:16, color:t.text, background:"transparent", fontFamily:"inherit", minWidth:0 }}/>
    <button type="button" onClick={()=>setShow(p=>!p)} style={{ background:"none", border:"none", cursor:"pointer", padding:0, display:"flex", alignItems:"center", flexShrink:0 }}>
      <Ic n={show?"eye":"eye-off"} c={t.sub} s={18}/>
    </button>
  </div>
}

function GreenBtn({ label, onClick, sub, disabled }: { label:string; onClick?:()=>void; sub?:boolean; disabled?:boolean }) {
  const { t } = useT()
  return <button onClick={onClick} disabled={disabled} style={{ width:"100%", padding:sub?"13px":"15px", borderRadius:999, border:sub?`1.5px solid ${t.brand}`:"none", background:sub?"transparent":`linear-gradient(135deg,${GR},${GRD})`, color:sub?t.brand:"white", fontSize:15, fontWeight:700, cursor:disabled?"default":"pointer", boxShadow:sub?"none":`0 6px 20px ${GR}45`, letterSpacing:0.2, opacity:disabled?0.5:1, transition:"opacity 0.2s", fontFamily:"inherit" }}>{label}</button>
}

function AuthError({ message }: { message:string|null }) {
  const { t } = useT()
  if (!message) return null
  return <div style={{ display:"flex", gap:10, alignItems:"flex-start", background:`${ERR}16`, border:`1px solid ${ERR}44`, borderRadius:16, padding:"12px 14px" }}>
    <Ic n="info" c={ERR} s={16}/>
    <div style={{ fontSize:12.5, color:t.text, lineHeight:1.6 }}>{message}</div>
  </div>
}

function AuthHero({ title, sub }: { title:string; sub:string }) {
  return <div style={{ background:`linear-gradient(160deg,${GRD},${GR})`, padding:"0 28px 34px", paddingTop:"calc(38px + var(--safe-top, 0px))", display:"flex", flexDirection:"column", alignItems:"center", position:"relative", overflow:"hidden" }}>
    <div style={{ position:"absolute", top:-40, right:-40, width:160, height:160, borderRadius:"50%", background:"rgba(255,255,255,0.06)" }}/>
    <div style={{ position:"absolute", bottom:-30, left:-30, width:120, height:120, borderRadius:"50%", background:`${GD}22` }}/>
    <Logo light/>
    <div style={{ height:22 }}/>
    <div style={{ fontSize:22, fontWeight:800, color:"white", textAlign:"center", lineHeight:1.25 }}>{title}</div>
    <div style={{ fontSize:14, color:"rgba(255,255,255,0.72)", marginTop:8, textAlign:"center" }}>{sub}</div>
  </div>
}

function LoginScreen({ nav, signIn }: { nav:(s:Screen)=>void; signIn:(e:string,p:string)=>Promise<unknown> }) {
  const { t } = useT()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string|null>(null)

  const submit = async () => {
    if (busy) return
    if (!email.trim() || !password) { setErr("Enter your email and password."); return }
    setBusy(true); setErr(null)
    try { await signIn(email, password) }
    catch (e:any) { setErr(friendlyAuthError(e?.code ?? "")) }
    finally { setBusy(false) }
  }

  return <div style={{ minHeight:"100%", background:"transparent", display:"flex", flexDirection:"column" }}>
    <AuthHero title="Welcome to NBE Youth" sub="Please login to your account"/>
    <div style={{ flex:1, padding:"28px 24px 24px", display:"flex", flexDirection:"column", gap:14 }}>
      <AuthError message={err}/>
      <AuthInput icon="mail" placeholder="Email" type="email" value={email} onChange={setEmail} autoComplete="email"/>
      <PasswordInput placeholder="Password" value={password} onChange={setPassword} autoComplete="current-password"/>
      <div style={{ textAlign:"right" as const }}>
        <button onClick={()=>nav("forgot")} style={{ fontSize:13, color:t.brand, fontWeight:600, background:"none", border:"none", cursor:"pointer", fontFamily:"inherit" }}>Forgot your password?</button>
      </div>
      <div style={{ marginTop:4 }}><GreenBtn label={busy?"Signing in…":"Login"} onClick={submit} disabled={busy}/></div>
      <div style={{ display:"flex", alignItems:"center", gap:12 }}>
        <div style={{ flex:1, height:1, background:t.border }}/><span style={{ fontSize:12, color:t.sub }}>or</span><div style={{ flex:1, height:1, background:t.border }}/>
      </div>
      <GreenBtn label="Register now" sub onClick={()=>nav("signup")}/>
    </div>
    <div style={{ padding:"0 24px 28px", textAlign:"center" as const }}>
      <div style={{ fontSize:11, color:t.sub, lineHeight:1.6 }}>By logging in you agree to NBE{"'"}s Terms of Service and Privacy Policy</div>
    </div>
  </div>
}

function SignUpScreen({ nav, signUp }: { nav:(s:Screen)=>void; signUp:(e:string,p:string,n:string)=>Promise<unknown> }) {
  const { t } = useT()
  const [first, setFirst] = useState("")
  const [last, setLast] = useState("")
  const [phone, setPhone] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string|null>(null)

  const submit = async () => {
    if (busy) return
    if (!first.trim() || !email.trim()) { setErr("First name and email are required."); return }
    if (password.length < 6)            { setErr("Password must be at least 6 characters."); return }
    if (password !== confirm)           { setErr("The two passwords do not match."); return }
    setBusy(true); setErr(null)
    try { await signUp(email, password, `${first.trim()} ${last.trim()}`.trim()) }
    catch (e:any) { setErr(friendlyAuthError(e?.code ?? "")) }
    finally { setBusy(false) }
  }

  return <div style={{ minHeight:"100%", background:"transparent", display:"flex", flexDirection:"column" }}>
    <AuthHero title="Create your NBE Youth account" sub="Start your financial journey with NBE"/>
    <div style={{ flex:1, padding:"24px 24px 28px", display:"flex", flexDirection:"column", gap:12 }}>
      <AuthError message={err}/>
      <div style={{ display:"flex", gap:8 }}>
        <AuthInput icon="user" placeholder="First Name" value={first} onChange={setFirst} style={{ flex:1, minWidth:0 }} autoComplete="given-name"/>
        <AuthInput icon="user" placeholder="Last Name" value={last} onChange={setLast} style={{ flex:1, minWidth:0 }} autoComplete="family-name"/>
      </div>
      <AuthInput icon="phone" placeholder="Phone Number" type="tel" value={phone} onChange={setPhone} autoComplete="tel"/>
      <AuthInput icon="mail" placeholder="Email Address" type="email" value={email} onChange={setEmail} autoComplete="email"/>
      <PasswordInput placeholder="Create Password" value={password} onChange={setPassword} autoComplete="new-password"/>
      <PasswordInput placeholder="Confirm Password" value={confirm} onChange={setConfirm} autoComplete="new-password"/>
      <div style={{ marginTop:4 }}><GreenBtn label={busy?"Creating account…":"Create Account"} onClick={submit} disabled={busy}/></div>
      <button onClick={()=>nav("login")} style={{ background:"none", border:"none", fontSize:14, color:t.sub, cursor:"pointer", textAlign:"center" as const, fontFamily:"inherit" }}>
        Already have an account? <span style={{ color:t.brand, fontWeight:700 }}>Login</span>
      </button>
    </div>
  </div>
}

function ForgotScreen({ nav, resetPassword }: { nav:(s:Screen)=>void; resetPassword:(e:string)=>Promise<void> }) {
  const { t } = useT()
  const [email, setEmail] = useState("")
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [err, setErr] = useState<string|null>(null)

  const submit = async () => {
    if (busy) return
    if (!email.trim()) { setErr("Enter the email on your account."); return }
    setBusy(true); setErr(null)
    try { await resetPassword(email); setSent(true) }
    catch (e:any) { setErr(friendlyAuthError(e?.code ?? "")) }
    finally { setBusy(false) }
  }

  return <div style={{ minHeight:"100%", background:"transparent", display:"flex", flexDirection:"column" }}>
    <AuthHero title="Forgot your password?" sub={"Don't worry. We'll help you reset it."}/>
    <div style={{ flex:1, padding:"28px 24px 24px", display:"flex", flexDirection:"column", gap:14 }}>
      {sent ? (
        <div style={{ background:t.cardAlt, border:`1px solid ${GR}30`, borderRadius:20, padding:"18px", display:"flex", gap:12, alignItems:"flex-start" }}>
          <div style={{ width:34, height:34, borderRadius:17, background:`linear-gradient(135deg,${GR},${GRD})`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}><Ic n="check" c="white" s={17}/></div>
          <div style={{ fontSize:13, color:t.text, lineHeight:1.7 }}>If an account exists for <b>{email}</b>, a reset link is on its way. Check your spam folder if it has not arrived in a few minutes.</div>
        </div>
      ) : (
        <>
          <AuthError message={err}/>
          <div style={{ background:t.cardAlt, borderRadius:16, padding:"14px 16px", fontSize:13, color:t.text, lineHeight:1.6, border:`1px solid ${GR}25` }}>Enter your registered email and we will send you a password reset link.</div>
          <AuthInput icon="mail" placeholder="Email Address" type="email" value={email} onChange={setEmail} autoComplete="email"/>
          <div style={{ marginTop:4 }}><GreenBtn label={busy?"Sending…":"Send Reset Link"} onClick={submit} disabled={busy}/></div>
        </>
      )}
      <button onClick={()=>nav("login")} style={{ background:"none", border:"none", fontSize:14, color:t.sub, cursor:"pointer", textAlign:"center" as const, fontFamily:"inherit" }}>
        <span style={{ color:t.brand, fontWeight:700 }}>← Back to Login</span>
      </button>
    </div>
  </div>
}

function DemoGate({ demoSignIn }: { demoSignIn:(name:string)=>unknown }) {
  const { t } = useT()
  const [name, setName] = useState("")
  return <div style={{ minHeight:"100%", background:"transparent", display:"flex", flexDirection:"column" }}>
    <AuthHero title="NBE Youth — Demo" sub="A preview build, not the real app"/>
    <div style={{ flex:1, padding:"28px 24px 24px", display:"flex", flexDirection:"column", gap:16 }}>
      <div style={{ background:t.cardAlt, border:`1px solid ${GD}35`, borderRadius:20, padding:"16px 18px", display:"flex", gap:12, alignItems:"flex-start" }}>
        <Ic n="info" c={t.gold} s={18}/>
        <div style={{ fontSize:12.5, color:t.text, lineHeight:1.7 }}>
          This build has no bank connection and no accounts. Nothing you enter is sent anywhere — it is stored only in this browser and disappears when you clear it. Do not enter real banking details.
        </div>
      </div>
      <div>
        <div style={{ fontSize:12, fontWeight:700, color:t.sub, marginBottom:8 }}>What should we call you?</div>
        <AuthInput icon="user" placeholder="Your name" value={name} onChange={setName}/>
      </div>
      <GreenBtn label="Explore the demo" onClick={()=>demoSignIn(name)}/>
      <div style={{ fontSize:11, color:t.sub, lineHeight:1.6, textAlign:"center" as const, marginTop:4 }}>
        Sign-in is disabled in the demo build.
      </div>
    </div>
  </div>
}

// ─── Onboarding ───────────────────────────────────────────────────────────────
function IllustTarget() {
  return <svg viewBox="0 0 300 240" width="300" height="240">
    <circle cx="150" cy="120" r="110" fill="rgba(255,255,255,0.07)"/>
    <circle cx="150" cy="120" r="92" fill="rgba(255,255,255,0.06)"/>
    <circle cx="150" cy="120" r="88" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="2"/>
    <circle cx="150" cy="120" r="68" fill="rgba(255,255,255,0.12)"/>
    <circle cx="150" cy="120" r="68" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="2"/>
    <circle cx="150" cy="120" r="48" fill="rgba(255,255,255,0.18)"/>
    <circle cx="150" cy="120" r="48" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="2"/>
    <circle cx="150" cy="120" r="28" fill="white" opacity="0.9"/>
    <circle cx="150" cy="120" r="14" fill={GD}/>
    <circle cx="150" cy="120" r="6"  fill="white"/>
    <line x1="232" y1="50" x2="164" y2="112" stroke={GDS} strokeWidth="4" strokeLinecap="round"/>
    <circle cx="162" cy="114" r="5" fill={GD}/>
    <polygon points="232,50 219,58 226,72" fill={GD}/>
    <line x1="226" y1="72" x2="219" y2="58" stroke={GD} strokeWidth="4" strokeLinecap="round"/>
  </svg>
}

function IllustInvest() {
  return <svg viewBox="0 0 300 240" width="300" height="240">
    <circle cx="150" cy="120" r="96" fill={`${GR}22`}/>
    <rect x="62" y="155" width="28" height="48" rx="6" fill={GR} opacity="0.4"/>
    <rect x="100" y="128" width="28" height="75" rx="6" fill={GR} opacity="0.6"/>
    <rect x="138" y="98" width="28" height="105" rx="6" fill={GR} opacity="0.8"/>
    <rect x="176" y="68" width="28" height="135" rx="6" fill={GR}/>
    <rect x="214" y="42" width="28" height="161" rx="6" fill={GD}/>
    <polyline points="76,159 114,132 152,102 190,72 228,46" stroke="white" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
    <circle cx="228" cy="46" r="7" fill="white"/>
    <circle cx="228" cy="46" r="4" fill={GD}/>
    <text x="206" y="30" fontSize="11" fontWeight="800" fill={GDS} textAnchor="middle" fontFamily="inherit">+25%</text>
  </svg>
}

function IllustPath() {
  return <svg viewBox="0 0 300 240" width="300" height="240">
    <path d="M40,200 Q80,170 100,140 Q130,100 160,120 Q190,140 210,100 Q230,60 260,40" fill="none" stroke="rgba(140,152,146,0.22)" strokeWidth="4" strokeDasharray="8,6" strokeLinecap="round"/>
    <path d="M40,200 Q80,170 100,140 Q130,100 160,120 Q190,140 210,100 Q230,60 260,40" fill="none" stroke={GR} strokeWidth="4" strokeDasharray="8,6" strokeLinecap="round" opacity="0.85"/>
    <circle cx="40"  cy="200" r="9" fill={GR}/>
    <circle cx="40"  cy="200" r="4" fill="white"/>
    <circle cx="100" cy="140" r="9" fill={GR}/>
    <circle cx="100" cy="140" r="4" fill="white"/>
    <circle cx="160" cy="120" r="9" fill={GD}/>
    <circle cx="160" cy="120" r="4" fill="white"/>
    <circle cx="210" cy="100" r="9" fill="#E5E7EB"/>
    <circle cx="260" cy="40"  r="12" fill={GRD}/>
    <line x1="260" y1="40" x2="260" y2="10" stroke={GRD} strokeWidth="3" strokeLinecap="round"/>
    <polygon points="260,10 250,20 270,20" fill={GD}/>
    <rect x="268" y="4" width="22" height="14" rx="4" fill={GD}/>
    <text x="279" y="14" fontSize="7" fontWeight="800" fill="white" textAnchor="middle" fontFamily="inherit">GOAL</text>
    <rect x="28" y="174" width="36" height="20" rx="10" fill={GRD}/>
    <text x="46" y="187" fontSize="8" fontWeight="800" fill="white" textAnchor="middle" fontFamily="inherit">35%</text>
    <circle cx="100" cy="154" r="13" fill="white" stroke={GR} strokeWidth="2"/>
    <text x="100" y="158" fontSize="8" fontWeight="700" fill={GR} textAnchor="middle" fontFamily="inherit">✓</text>
  </svg>
}

const SLIDES = [
  { bg:`linear-gradient(145deg,${GRD},#0B5D3B 40%,${GR} 75%,#0A9456)`, illust:<IllustTarget/>, tag:"Your Goals Await", title:"Ready to reach your goals?", sub:"Learn to manage, save, and grow your money — all in one app built just for you." },
  { bg:`linear-gradient(145deg,#F0FAF5,${GRL} 50%,#E8F8F1)`, illust:<IllustInvest/>, tag:"Smart Investing", title:"Ready to start your investing journey", sub:"Discover simple ways to grow your money through smart investments made just for you." },
  { bg:`linear-gradient(145deg,#FFFBEB,#FEF3C7 50%,#FFF8EC)`, illust:<IllustPath/>, tag:"Track Every Step", title:"Let's set your goals and start tracking your progress", sub:"Set a goal, follow your progress step by step, and watch your money get you there." },
]

const SLIDES_DARK = [
  `linear-gradient(145deg,${GRD},#0B5D3B 40%,${GR} 75%,#0A9456)`,
  "linear-gradient(145deg,#062219,#0A3524 55%,#05190F)",
  "linear-gradient(145deg,#241E0B,#3A3115 55%,#1A1607)",
]

function OnboardingScreen({ onDone, onTone }: { onDone:()=>void; onTone?:(light:boolean)=>void }) {
  const { t } = useT()
  const [slide, setSlide] = useState(0)
  const s = SLIDES[slide]
  const isLight = t.dm || slide===0
  const bg = t.dm ? SLIDES_DARK[slide] : s.bg
  useEffect(()=>{ onTone?.(isLight) }, [isLight, onTone])
  return <div style={{ height:"100%", display:"flex", flexDirection:"column", background:bg, transition:"background 0.5s ease" }}>
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"0 22px 14px", paddingTop:"calc(14px + var(--safe-top, 0px))" }}>
      <Logo light={isLight}/>
      {slide<2 && <button onClick={onDone} style={{ fontSize:13, fontWeight:600, color:isLight?"rgba(255,255,255,0.65)":t.sub, background:"none", border:"none", cursor:"pointer" }}>Skip</button>}
    </div>
    <div key={`i-${slide}`} style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", padding:"10px 20px", animation:"fadeUp 0.4s ease-out" }}>{s.illust}</div>
    <div style={{ background:t.card, backdropFilter:t.blur, WebkitBackdropFilter:t.blur, borderRadius:"28px 28px 0 0", padding:"26px 24px 32px", boxShadow:"0 -4px 24px rgba(0,0,0,0.07)" }}>
      <div key={`t-${slide}`} style={{ animation:"fadeUp 0.35s ease-out" }}>
        <div style={{ fontSize:11, fontWeight:800, color:t.brand, letterSpacing:1.5, marginBottom:10, textTransform:"uppercase" as const }}>{s.tag}</div>
        <div style={{ fontSize:22, fontWeight:800, color:t.text, lineHeight:1.25, marginBottom:10 }}>{s.title}</div>
        <div style={{ fontSize:14, color:t.sub, lineHeight:1.65, marginBottom:24 }}>{s.sub}</div>
      </div>
      <div style={{ display:"flex", gap:6, justifyContent:"center", marginBottom:22 }}>
        {SLIDES.map((_,i)=><div key={i} onClick={()=>setSlide(i)} style={{ height:7, width:i===slide?28:7, borderRadius:4, background:i===slide?GR:t.track, transition:"all 0.3s ease", cursor:"pointer" }}/>)}
      </div>
      <button onClick={slide<2?()=>setSlide(slide+1):onDone} style={{ width:"100%", padding:"15px", borderRadius:999, border:"none", background:`linear-gradient(135deg,${GR},${GRD})`, color:"white", fontSize:15, fontWeight:700, cursor:"pointer", boxShadow:`0 6px 20px ${GR}50` }}>
        {slide<2?"Next →":"Set My First Goal →"}
      </button>
    </div>
  </div>
}

interface GoalEntry { id:string; name:string; budget:string; start:string; end:string; type:"user"|"builtin"; pct?:number }

function GoalSetupSheet({ onGoalSet }: { onGoalSet:(entry:GoalEntry)=>void }) {
  const { t } = useT()
  const [name, setName] = useState("")
  const [budget, setBudget] = useState("")
  const [start, setStart] = useState("")
  const [end, setEnd] = useState("")
  const chips = ["Laptop", "Car", "Investing"]
  const confirm = () => {
    if (!name.trim()) return
    onGoalSet({ id: newLocalId(), name:name.trim(), budget, start, end, type:"user" })
  }
  const inp = (val:string, set:(v:string)=>void, placeholder:string, label:string, type="text") => (
    <div style={{ marginBottom:14 }}>
      <div style={{ fontSize:11, fontWeight:700, color:t.sub, marginBottom:6, letterSpacing:0.3 }}>{label}</div>
      <input
        type={type}
        value={val}
        onChange={e=>set(e.target.value)}
        placeholder={placeholder}
        style={{ width:"100%", border:`1.5px solid ${val?GR:t.stroke}`, borderRadius:999, padding:"13px 18px", fontSize:16, outline:"none", fontFamily:"inherit", color:t.text, boxSizing:"border-box" as const, transition:"border-color 0.2s", background:t.card, backdropFilter:t.blur, WebkitBackdropFilter:t.blur }}
      />
    </div>
  )
  return (
    <div style={{ background:t.card, backdropFilter:t.blur, WebkitBackdropFilter:t.blur, borderRadius:"28px 28px 0 0", padding:"24px 22px 32px", boxShadow:"0 -12px 48px rgba(0,0,0,0.28)", animation:"fadeUp 0.35s ease-out", maxHeight:"82vh", overflowY:"auto" as const }}>
      <div style={{ width:40, height:4, borderRadius:2, background:t.track, margin:"0 auto 20px" }}/>
      <div style={{ fontSize:20, fontWeight:800, color:t.text, lineHeight:1.25, marginBottom:6 }}>What is your first goal you want to reach?</div>
      <div style={{ fontSize:13, color:t.sub, marginBottom:18, lineHeight:1.55 }}>Pick a suggestion or type your own, then fill in the details below.</div>

      {/* Goal name */}
      <div style={{ marginBottom:10 }}>
        <div style={{ fontSize:11, fontWeight:700, color:t.sub, marginBottom:6, letterSpacing:0.3 }}>GOAL NAME</div>
        <input
          value={name}
          onChange={e=>setName(e.target.value)}
          placeholder="e.g. Buy a Laptop"
          style={{ width:"100%", border:`1.5px solid ${name?GR:t.stroke}`, borderRadius:999, padding:"13px 18px", fontSize:16, outline:"none", fontFamily:"inherit", color:t.text, boxSizing:"border-box" as const, transition:"border-color 0.2s", background:t.card, backdropFilter:t.blur, WebkitBackdropFilter:t.blur }}
        />
      </div>
      {/* Chips */}
      <div style={{ display:"flex", gap:8, flexWrap:"wrap" as const, marginBottom:18 }}>
        <div style={{ fontSize:11, fontWeight:600, color:t.sub, alignSelf:"center", marginRight:2 }}>Quick pick:</div>
        {chips.map(chip=>(
          <button key={chip} onClick={()=>setName(chip)} style={{ padding:"8px 18px", borderRadius:999, border:`1.5px solid ${name===chip?t.brand:`${GD}80`}`, background:name===chip?`${GR}22`:`${GD}18`, color:name===chip?t.brand:t.gold, fontSize:13, fontWeight:700, cursor:"pointer", transition:"all 0.2s" }}>{chip}</button>
        ))}
      </div>

      {inp(budget, setBudget, "e.g. EGP 30,000", "BUDGET (TARGET AMOUNT)")}
      <div style={{ display:"grid", gridTemplateColumns:"minmax(0,1fr) minmax(0,1fr)", gap:10, marginBottom:14 }}>
        <div>
          <div style={{ fontSize:11, fontWeight:700, color:t.sub, marginBottom:6, letterSpacing:0.3 }}>START DATE</div>
          <input type="date" value={start} onChange={e=>setStart(e.target.value)} style={{ width:"100%", border:`1.5px solid ${start?GR:t.stroke}`, borderRadius:999, padding:"12px 14px", fontSize:16, outline:"none", fontFamily:"inherit", color:t.text, boxSizing:"border-box" as const, transition:"border-color 0.2s", background:t.card, backdropFilter:t.blur, WebkitBackdropFilter:t.blur }}/>
        </div>
        <div>
          <div style={{ fontSize:11, fontWeight:700, color:t.sub, marginBottom:6, letterSpacing:0.3 }}>END DATE</div>
          <input type="date" value={end} onChange={e=>setEnd(e.target.value)} style={{ width:"100%", border:`1.5px solid ${end?GR:t.stroke}`, borderRadius:999, padding:"12px 14px", fontSize:16, outline:"none", fontFamily:"inherit", color:t.text, boxSizing:"border-box" as const, transition:"border-color 0.2s", background:t.card, backdropFilter:t.blur, WebkitBackdropFilter:t.blur }}/>
        </div>
      </div>

      <button onClick={confirm} style={{ width:"100%", padding:"15px", borderRadius:999, border:"none", background:name.trim()?`linear-gradient(135deg,${GR},${GRD})`:t.track, color:name.trim()?"white":t.sub, fontSize:15, fontWeight:700, cursor:name.trim()?"pointer":"default", transition:"all 0.25s", boxShadow:name.trim()?`0 6px 20px ${GR}45`:"none" }}>
        {name.trim() ? "Save Goal & Go to Home →" : "Enter a goal name to continue"}
      </button>
    </div>
  )
}

// ─── Product catalogue (module scope: Home quotes it, Invest sells from it) ──
interface Product { name:string; dur:string; rate:number; min:number; color:string; tag:string; risk:string; access:string }

const CERTS: Product[] = [
  { name:"Premium Certificate", dur:"1 Year",  rate:25, min:1000,  color:GR,  tag:"MOST POPULAR",  risk:"", access:"No early withdrawal — it runs the full year." },
  { name:"Growth Certificate",  dur:"3 Years", rate:22, min:5000,  color:GRD, tag:"",              risk:"", access:"No withdrawal before maturity. Interest is paid to your account each year." },
  { name:"Long-Term Certificate",dur:"5 Years",rate:18, min:10000, color:GD,  tag:"BEST FOR GOALS",risk:"", access:"Partial withdrawal allowed after year 2." },
]
const FUNDS: Product[] = [
  { name:"Money Market Fund",        dur:"Daily Access",  rate:19, min:500,  color:GRD, tag:"CALMEST",       risk:"Low",    access:"Withdraw any business day." },
  { name:"Balanced Growth Fund",     dur:"2+ Yr Horizon", rate:24, min:2000, color:GR,  tag:"MOST POPULAR",  risk:"Medium", access:"Weekly redemption, subject to notice." },
  { name:"Equity Opportunities Fund",dur:"3+ Yr Horizon", rate:30, min:3000, color:GD,  tag:"BIGGEST SWINGS",risk:"High",   access:"Weekly redemption, subject to notice." },
]
const productByName = (n:string) => [...CERTS, ...FUNDS].find(p => p.name === n) ?? null

type NotifType = "reminder"|"certificate"|"growth"
interface Notif { id:number; type:NotifType; title:string; body:string; time:string; read:boolean }

// ─── Built-in Goals (defined here so HomeScreen can reference them) ───────────
/* Built-in goals evaluate their own steps against the account rather than
   carrying a fixed percentage, so the ring always reflects real progress. */
interface GoalCtx {
  profile: UserProfile | null
  holdings: HoldingDoc[]
  goalCount: number
}
interface BuiltinStep { label:string; check:(c:GoalCtx)=>boolean }
interface BuiltinGoal { title:string; icon:string; color:string; steps:BuiltinStep[]; defaultActive:boolean }

const invested   = (c:GoalCtx) => c.holdings.reduce((n,h)=>n+h.amount, 0)
const points     = (c:GoalCtx) => c.profile?.stats?.points ?? 0
const toursDone  = (c:GoalCtx) => Object.values(c.profile?.flags?.toursSeen ?? {}).filter(Boolean).length
const hasKind    = (c:GoalCtx, k:"certificate"|"fund") => c.holdings.some(h=>h.kind===k)

const BUILTIN_GOALS: BuiltinGoal[] = [
  { title:"Make My First Investment", icon:"trending", color:GR, defaultActive:true, steps:[
    { label:"Set your first savings goal",                check:c=>!!c.profile?.flags?.firstGoalSet },
    { label:"Read how certificates and funds work",       check:c=>!!c.profile?.flags?.toursSeen?.invest },
    { label:"Earn your first 100 points",                 check:c=>points(c) >= 100 },
    { label:"Invest your first EGP 1,000",                check:c=>c.holdings.some(h=>h.amount >= 1000) },
  ]},
  { title:"Become Credit Card Ready", icon:"credit", color:GD, defaultActive:true, steps:[
    { label:"Set a savings goal",                         check:c=>!!c.profile?.flags?.firstGoalSet },
    { label:"Finish three app walkthroughs",              check:c=>toursDone(c) >= 3 },
    { label:"Make your first investment",                 check:c=>c.holdings.length > 0 },
    { label:"Hold EGP 10,000 invested",                   check:c=>invested(c) >= 10000 },
    { label:"Reach 500 points",                           check:c=>points(c) >= 500 },
  ]},
  { title:"Become Loan-Ready", icon:"bank", color:GRD, defaultActive:false, steps:[
    { label:"Hold at least one certificate",              check:c=>hasKind(c,"certificate") },
    { label:"Spread across a certificate and a fund",     check:c=>hasKind(c,"certificate") && hasKind(c,"fund") },
    { label:"Hold EGP 25,000 invested",                   check:c=>invested(c) >= 25000 },
    { label:"Keep three or more active holdings",         check:c=>c.holdings.filter(h=>h.status==="active").length >= 3 },
    { label:"Reach 1,000 points",                         check:c=>points(c) >= 1000 },
  ]},
  { title:"Build Emergency Fund", icon:"shield", color:GR, defaultActive:false, steps:[
    { label:"Set a savings goal",                         check:c=>c.goalCount > 0 },
    { label:"Put money into an accessible fund",          check:c=>hasKind(c,"fund") },
    { label:"Save EGP 5,000",                             check:c=>invested(c) >= 5000 },
    { label:"Save EGP 15,000 (about 3 months of costs)",  check:c=>invested(c) >= 15000 },
  ]},
]

/** Resolve a built-in goal's steps and percentage against the current account. */
function evalBuiltin(g:BuiltinGoal, ctx:GoalCtx) {
  const steps = g.steps.map(st => ({ label:st.label, done:st.check(ctx) }))
  const done = steps.filter(st=>st.done).length
  return { ...g, steps, done, pct: Math.round((done / steps.length) * 100) }
}

// ─── HomeScreen ───────────────────────────────────────────────────────────────
function HomeScreen({ nav, userGoals, builtinActive, homeCardGoalId, setHomeCardGoalId, onStartNewGoal }: {
  nav:(s:Screen)=>void;
  userGoals:GoalEntry[];
  builtinActive:boolean[];
  homeCardGoalId:string|null;
  setHomeCardGoalId:(id:string|null)=>void;
  onStartNewGoal:()=>void;
}) {
  const { t, lang, notifPrefs } = useT()
  const { profile, holdings } = useApp()
  const stats = profile?.stats ?? { points:0, level:1, streakDays:0 }
  const prog = progression(stats.points)
  const invested = holdings.reduce((n,h)=>n+h.amount, 0)

  const notifEnabled = (n:Notif) => n.type==="reminder" ? notifPrefs.reminders : n.type==="certificate" ? notifPrefs.certs : notifPrefs.growth
  const unreadNotifs = buildNotifs(holdings, profile).filter(n => !n.read && notifEnabled(n)).length

  const goalCtx: GoalCtx = { profile, holdings, goalCount: userGoals.length }
  const builtinGoalEntries: GoalEntry[] = BUILTIN_GOALS
    .map((g,i) => ({ id:`builtin-${i}`, name:g.title, budget:"", start:"", end:"", type:"builtin" as const, pct:evalBuiltin(g, goalCtx).pct }))
    .filter((_,i) => builtinActive[i])
  const allDisplayGoals: GoalEntry[] = [...userGoals, ...builtinGoalEntries]

  const selectedGoal = allDisplayGoals.find(g => g.id === homeCardGoalId) ?? allDisplayGoals[0] ?? null
  const selectedIdx = allDisplayGoals.findIndex(g => g.id === (selectedGoal?.id ?? ""))
  const hasMultiple = allDisplayGoals.length > 1

  // A built-in goal is a checklist, not a savings target. Rendering it in the
  // money layout invented a target (the old 30,000 fallback) and then reported
  // EGP 0 saved against it while the ring read 50% off completed steps.
  const builtinDef = selectedGoal?.type === "builtin"
    ? BUILTIN_GOALS.find(b => b.title === selectedGoal.name) ?? null : null
  const selectedBuiltin = builtinDef ? evalBuiltin(builtinDef, goalCtx) : null
  const nextStep = selectedBuiltin?.steps.find(st => !st.done)?.label ?? null

  const goalBudgetNum = selectedGoal ? (parseInt((selectedGoal.budget||"").replace(/\D/g,""))||0) : 0
  const goalSaved = Math.min(invested, goalBudgetNum || invested)
  const goalPct = selectedBuiltin ? selectedBuiltin.pct
    : goalBudgetNum > 0 ? Math.min(100, Math.round((goalSaved / goalBudgetNum) * 100)) : 0
  const goalRemaining = Math.max(0, goalBudgetNum - goalSaved)

  const calcTimeLeft = () => {
    if (!selectedGoal?.end) return "—"
    const ms = new Date(selectedGoal.end).getTime() - Date.now()
    if (ms <= 0) return "Ended"
    const days = Math.ceil(ms/86400000)
    return days > 30 ? `${Math.ceil(days/30)} months` : `${days} days`
  }

  const prevGoal = () => {
    if (allDisplayGoals.length < 2) return
    const idx = (selectedIdx - 1 + allDisplayGoals.length) % allDisplayGoals.length
    setHomeCardGoalId(allDisplayGoals[idx].id)
  }
  const nextGoal = () => {
    if (allDisplayGoals.length < 2) return
    const idx = (selectedIdx + 1) % allDisplayGoals.length
    setHomeCardGoalId(allDisplayGoals[idx].id)
  }

  return <div style={{ background:"transparent", minHeight:"100%" }}>
    <div style={{ background:t.card, backdropFilter:t.blur, WebkitBackdropFilter:t.blur, borderBottom:`1px solid ${t.stroke}`, padding:"0 20px 16px", paddingTop:`calc(12px + var(--safe-top, 0px))`, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
      <Logo/>
      <div style={{ display:"flex", gap:10, alignItems:"center" }}>
        <button onClick={()=>nav("notifications")} style={{ width:38, height:38, borderRadius:19, background:t.chip, backdropFilter:t.blur, WebkitBackdropFilter:t.blur, display:"flex", alignItems:"center", justifyContent:"center", border:"none", cursor:"pointer", position:"relative" }}>
          <Ic n="bell" c={t.text} s={18}/>
          {unreadNotifs > 0 && <div style={{ position:"absolute", top:8, right:8, width:8, height:8, borderRadius:4, background:ERR, border:"1.5px solid white" }}/>}
        </button>
        <div onClick={()=>nav("profile")} style={{ width:38, height:38, borderRadius:19, background:`linear-gradient(135deg,${GR},${GRD})`, display:"flex", alignItems:"center", justifyContent:"center", color:"white", fontSize:13, fontWeight:800, cursor:"pointer" }}>{profile?.initials ?? "NB"}</div>
      </div>
    </div>

    <div style={{ padding:"14px 20px 0" }}>
      <div style={{ fontSize:13, color:t.sub }}>{tx(greetKey(),lang)}</div>
      <div style={{ fontSize:20, fontWeight:800, color:t.text, marginTop:2, whiteSpace:"nowrap" as const, overflow:"hidden", textOverflow:"ellipsis" }}>{profile?.displayName ?? "there"}</div>
    </div>

    {/* Goal card */}
    <div id="tut-home-goal" style={{ margin:"14px 16px 0", borderRadius:22, overflow:"hidden", background:"linear-gradient(145deg,#063B2A 0%,#087A4B 42%,#0B5D3B 68%,#C9A227 100%)", color:"white", position:"relative", boxShadow:"0 8px 32px rgba(6,69,50,0.38)" }}>
      <div style={{ position:"absolute", top:-50, right:-50, width:180, height:180, borderRadius:"50%", background:"rgba(255,255,255,0.06)" }}/>
      <div style={{ position:"absolute", bottom:-20, left:-20, width:120, height:120, borderRadius:"50%", background:`${GD}22` }}/>
      <div style={{ padding:"22px 22px 20px", position:"relative" }}>
        {allDisplayGoals.length === 0 ? (
          <div style={{ textAlign:"center" as const, padding:"10px 0 6px" }}>
            <div style={{ width:52, height:52, borderRadius:16, background:"rgba(255,255,255,0.12)", display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 14px" }}>
              <Ic n="target" c="rgba(255,255,255,0.6)" s={26}/>
            </div>
            <div style={{ fontSize:17, fontWeight:800, color:"white", marginBottom:8 }}>No goals yet</div>
            <div style={{ fontSize:13, color:"rgba(255,255,255,0.6)", marginBottom:18, lineHeight:1.55 }}>Set a goal to start tracking your savings progress.</div>
            <button onClick={onStartNewGoal} style={{ padding:"13px 28px", borderRadius:999, border:"none", background:GD, color:"white", fontSize:14, fontWeight:700, cursor:"pointer", boxShadow:`0 5px 18px ${GD}60` }}>
              Start a new goal →
            </button>
          </div>
        ) : (
          <>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <div style={{ width:26, height:26, borderRadius:7, background:GD, display:"flex", alignItems:"center", justifyContent:"center" }}><Ic n="target" c="white" s={13}/></div>
                <span style={{ fontSize:12, fontWeight:600, color:"rgba(255,255,255,0.75)", maxWidth:180, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" as const }}>{selectedGoal!.name}</span>
              </div>
              {hasMultiple && (
                <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                  <button onClick={prevGoal} style={{ width:26, height:26, borderRadius:999, background:"rgba(255,255,255,0.12)", border:"none", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}><Ic n="left" c="white" s={13}/></button>
                  <span style={{ fontSize:10, color:"rgba(255,255,255,0.55)", fontWeight:600 }}>{selectedIdx+1}/{allDisplayGoals.length}</span>
                  <button onClick={nextGoal} style={{ width:26, height:26, borderRadius:999, background:"rgba(255,255,255,0.12)", border:"none", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}><Ic n="right" c="white" s={13}/></button>
                </div>
              )}
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:16, marginBottom:16 }}>
              <div style={{ position:"relative", flexShrink:0 }}>
                <Ring pct={goalPct} size={72} w={6} color={GD}/>
                <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center" }}>
                  <span style={{ fontSize:13, fontWeight:800, color:"white" }}>{goalPct}%</span>
                </div>
              </div>
              <div style={{ flex:1, minWidth:0 }}>
                {selectedBuiltin ? <>
                  <div style={{ fontSize:11, color:"rgba(255,255,255,0.55)", marginBottom:4 }}>Milestones done</div>
                  <div style={{ fontSize:22, fontWeight:800, letterSpacing:-0.5 }}>{selectedBuiltin.done} of {selectedBuiltin.steps.length}</div>
                  <div style={{ fontSize:11, color:"rgba(255,255,255,0.55)", marginTop:2, lineHeight:1.4 }}>{nextStep ? `Next: ${nextStep}` : "All steps complete"}</div>
                </> : <>
                  <div style={{ fontSize:11, color:"rgba(255,255,255,0.55)", marginBottom:4 }}>Saved so far</div>
                  <div style={{ fontSize:22, fontWeight:800, letterSpacing:-0.5 }}>EGP {goalSaved.toLocaleString()}</div>
                  <div style={{ fontSize:11, color:"rgba(255,255,255,0.55)", marginTop:2 }}>{goalBudgetNum > 0 ? `of EGP ${goalBudgetNum.toLocaleString()} target` : "No target amount set"}</div>
                </>}
              </div>
            </div>
            <div style={{ marginBottom:14 }}>
              <div style={{ height:6, borderRadius:6, background:"rgba(255,255,255,0.15)", overflow:"hidden" }}>
                <div style={{ width:`${goalPct}%`, height:6, background:`linear-gradient(90deg,${GD},${GDS})`, borderRadius:6, transition:"width 0.6s ease" }}/>
              </div>
              <div style={{ display:"flex", justifyContent:"space-between", marginTop:4 }}>
                <span style={{ fontSize:10, color:"rgba(255,255,255,0.45)" }}>{selectedBuiltin ? `${selectedBuiltin.done} done` : `EGP ${goalSaved.toLocaleString()} saved`}</span>
                <span style={{ fontSize:10, color:"rgba(255,255,255,0.45)" }}>{selectedBuiltin ? `${selectedBuiltin.steps.length} milestones` : goalBudgetNum > 0 ? `EGP ${goalBudgetNum.toLocaleString()} goal` : "no target"}</span>
              </div>
            </div>
            <div style={{ display:"flex", borderTop:"1px solid rgba(255,255,255,0.12)", paddingTop:14, gap:12 }}>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:10, color:"rgba(255,255,255,0.45)" }}>{selectedBuiltin ? "Steps Left" : "Still Needed"}</div>
                <div style={{ fontSize:15, fontWeight:800, color:t.gold, marginTop:3 }}>
                  {selectedBuiltin ? `${selectedBuiltin.steps.length - selectedBuiltin.done}` : goalBudgetNum > 0 ? `EGP ${goalRemaining.toLocaleString()}` : "—"}
                </div>
              </div>
              <div style={{ width:1, background:"rgba(255,255,255,0.12)" }}/>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:10, color:"rgba(255,255,255,0.45)" }}>{selectedBuiltin ? "Invested" : "Time Left"}</div>
                <div style={{ fontSize:15, fontWeight:800, color:"#4ADE80", marginTop:3 }}>
                  {selectedBuiltin ? `EGP ${invested.toLocaleString()}` : calcTimeLeft()}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>

    {/* Tips section — individual cards */}
    <div id="tut-home-tips" style={{ margin:"14px 16px 0" }}>
      <div style={{ fontSize:11, fontWeight:800, color:t.sub, letterSpacing:1.2, textTransform:"uppercase" as const, marginBottom:10 }}>Tips to Reach Your Goal</div>
      {([
        { icon:"chart",   color:t.brand,  title:"Start with a certificate", tip:`${CERTS[0].name}: from EGP ${CERTS[0].min.toLocaleString()}, ${CERTS[0].rate}% a year fixed for ${CERTS[0].dur.toLowerCase()}.` },
        { icon:"wallet",  color:t.gold,  title:"Save 20% weekly",   tip:"Set aside 20% of your allowance every week. Small habits build into big balances over time." },
        { icon:"list",    color:t.brand, title:"Review your spending", tip:"Use Daily Review to spot where your money goes and find savings opportunities each day." },
      ]).map((item,i)=>(
        <div key={i} style={{ background:t.card, backdropFilter:t.blur, WebkitBackdropFilter:t.blur, borderRadius:20, padding:"14px 16px", marginBottom:10, display:"flex", gap:12, alignItems:"flex-start", boxShadow:`0 1px 6px rgba(0,0,0,${t.dm?0.18:0.05})`, border:`1px solid ${item.color}18` }}>
          <div style={{ width:38, height:38, borderRadius:12, background:`${item.color}${t.dm?"22":"14"}`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}><Ic n={item.icon} c={item.color} s={18}/></div>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:13, fontWeight:800, color:t.text, marginBottom:4 }}>{item.title}</div>
            <div style={{ fontSize:12, color:t.sub, lineHeight:1.65 }}>{item.tip}</div>
          </div>
        </div>
      ))}
    </div>

    {/* Stat pills */}
    <div style={{ display:"grid", gridTemplateColumns:"repeat(2, minmax(0, 1fr))", gap:8, padding:"12px 16px 0" }}>
      {([
        {icon:"refresh",val:`${stats.streakDays} ${stats.streakDays===1?"day":"days"}`,label:"Streak",color:"#F97316"},
        {icon:"award",val:`${stats.points.toLocaleString()} pts`,label:"Points",color:GD},
        {icon:"trending",val:`Level ${prog.level}`,label:prog.name,color:t.brand},
        {icon:"wallet",val:`EGP ${invested.toLocaleString()}`,label:holdings.length===1?"Invested":`Invested · ${holdings.length}`,color:t.brand},
      ]).map(st=>(
        <div key={st.label} style={{ background:t.card, backdropFilter:t.blur, WebkitBackdropFilter:t.blur, border:`1px solid ${t.stroke}`, borderRadius:16, padding:"10px 12px", minWidth:0, boxShadow:`0 1px 4px rgba(0,0,0,${t.dm?0.2:0.06})`, display:"flex", gap:8, alignItems:"center" }}>
          <Ic n={st.icon} c={st.color} s={15}/>
          <div style={{ minWidth:0 }}><div style={{ fontSize:13, fontWeight:700, color:t.text, whiteSpace:"nowrap" as const, overflow:"hidden", textOverflow:"ellipsis" }}>{st.val}</div><div style={{ fontSize:10, color:t.sub, whiteSpace:"nowrap" as const, overflow:"hidden", textOverflow:"ellipsis" }}>{st.label}</div></div>
        </div>
      ))}
    </div>

    {/* Your investments */}
    {holdings.length > 0 && <div style={{ padding:"18px 16px 0" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
        <span style={{ fontSize:15, fontWeight:700, color:t.text }}>Your Investments</span>
        <button onClick={()=>nav("invest")} style={{ fontSize:12.5, color:t.brand, fontWeight:700, background:"none", border:"none", cursor:"pointer", fontFamily:"inherit" }}>Add more →</button>
      </div>
      {holdings.map(h=>(
        <div key={h.id} style={{ background:t.card, backdropFilter:t.blur, WebkitBackdropFilter:t.blur, border:`1px solid ${t.stroke}`, borderRadius:18, padding:"14px 16px", marginBottom:9, display:"flex", alignItems:"center", gap:13 }}>
          <div style={{ width:40, height:40, borderRadius:20, background:h.kind==="fund"?`${GD}22`:`${GR}22`, border:`1px solid ${h.kind==="fund"?GD:GR}38`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
            <Ic n={h.kind==="fund"?"trending":"shield"} c={h.kind==="fund"?t.gold:t.brand} s={18}/>
          </div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:13.5, fontWeight:700, color:t.text, whiteSpace:"nowrap" as const, overflow:"hidden", textOverflow:"ellipsis" }}>{h.productName}</div>
            <div style={{ fontSize:11.5, color:t.sub, marginTop:2 }}>
              {h.kind==="fund" ? `~${h.rate}% avg` : `${h.rate}% fixed`} · {h.term}
              {h.maturesAt ? ` · matures ${h.maturesAt}` : ""}
            </div>
          </div>
          <div style={{ textAlign:"right" as const, flexShrink:0 }}>
            <div style={{ fontSize:14, fontWeight:800, color:t.text }}>EGP {h.amount.toLocaleString()}</div>
            <div style={{ fontSize:10, color:t.sub, marginTop:2 }}>{h.status}</div>
          </div>
        </div>
      ))}
    </div>}

    {/* Quick actions */}
    <div id="tut-home-actions" style={{ display:"grid", gridTemplateColumns:"repeat(3, minmax(0,1fr))", gap:10, margin:"14px 16px 0" }}>
      {([{icon:"chart",label:tx("invest",lang),screen:"invest"as Screen,color:GR},{icon:"target",label:tx("goals",lang),screen:"goals"as Screen,color:t.brand},{icon:"list",label:"Daily Review",screen:"dailyreview"as Screen,color:t.brand}]).map(a=>(
        <button key={a.label} onClick={()=>nav(a.screen)} style={{ background:t.card, backdropFilter:t.blur, WebkitBackdropFilter:t.blur, border:"none", borderRadius:999, padding:"13px 6px", display:"flex", flexDirection:"column", alignItems:"center", gap:7, cursor:"pointer", boxShadow:`0 2px 8px rgba(0,0,0,${t.dm?0.2:0.06})` }}>
          <div style={{ width:42, height:42, borderRadius:12, background:`${a.color}${t.dm?"22":"14"}`, display:"flex", alignItems:"center", justifyContent:"center" }}><Ic n={a.icon} c={a.color} s={20}/></div>
          <span style={{ fontSize:11, fontWeight:600, color:t.text, textAlign:"center" as const, lineHeight:1.3 }}>{a.label}</span>
        </button>
      ))}
    </div>

    {/* My Goals preview */}
    <div id="tut-home-goals" style={{ padding:"18px 16px 28px" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
        <span style={{ fontSize:15, fontWeight:700, color:t.text }}>{tx("my_goals",lang)}</span>
        <button onClick={()=>nav("goals")} style={{ fontSize:13, color:t.brand, fontWeight:600, background:"none", border:"none", cursor:"pointer" }}>{tx("see_all",lang)}</button>
      </div>
      {allDisplayGoals.length === 0 ? (
        <div style={{ background:t.card, backdropFilter:t.blur, WebkitBackdropFilter:t.blur, border:`1px solid ${t.stroke}`, borderRadius:18, padding:"18px 16px", textAlign:"center" as const, boxShadow:`0 1px 5px rgba(0,0,0,${t.dm?0.2:0.05})` }}>
          <div style={{ fontSize:13, color:t.sub, marginBottom:10 }}>No active goals yet.</div>
          <button onClick={onStartNewGoal} style={{ padding:"10px 22px", borderRadius:999, border:"none", background:`linear-gradient(135deg,${GR},${GRD})`, color:"white", fontSize:13, fontWeight:700, cursor:"pointer" }}>Start a new goal</button>
        </div>
      ) : (
        allDisplayGoals.slice(0,3).map(g => {
          const pct = g.pct ?? 0
          const isSelected = g.id === (selectedGoal?.id ?? "")
          const color = g.type==="builtin" ? (BUILTIN_GOALS.find(bg=>bg.title===g.name)?.color ?? GR) : GR
          const icon = g.type==="builtin" ? (BUILTIN_GOALS.find(bg=>bg.title===g.name)?.icon ?? "target") : "target"
          return (
            <div key={g.id} onClick={()=>setHomeCardGoalId(g.id)} style={{ background:t.card, backdropFilter:t.blur, WebkitBackdropFilter:t.blur, borderRadius:18, padding:"14px 16px", display:"flex", alignItems:"center", gap:14, marginBottom:10, boxShadow:`0 1px 5px rgba(0,0,0,${t.dm?0.2:0.05})`, border:`1.5px solid ${isSelected?color:t.border}`, cursor:"pointer", transition:"border-color 0.2s" }}>
              <div style={{ position:"relative", flexShrink:0 }}>
                <Ring pct={pct} size={52} w={4} color={color}/>
                <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center" }}><Ic n={icon} c={color} s={18}/></div>
              </div>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:14, fontWeight:700, color:t.text, marginBottom:3, whiteSpace:"nowrap" as const, overflow:"hidden", textOverflow:"ellipsis" }}>{g.name}</div>
                <div style={{ fontSize:12, color:t.sub, marginBottom:7 }}>{g.budget ? `Target: ${g.budget}` : g.type==="builtin" ? `${pct}% complete` : "No budget set"}</div>
                <Bar pct={pct} color={color} h={4} trackColor={t.track}/>
              </div>
              <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:4, flexShrink:0 }}>
                <div style={{ fontSize:15, fontWeight:800, color }}>{pct}%</div>
                {isSelected && <div style={{ fontSize:9, fontWeight:800, color, background:`${color}14`, padding:"2px 7px", borderRadius:999 }}>SHOWN</div>}
              </div>
            </div>
          )
        })
      )}
    </div>
  </div>
}

// ─── Subscribe sheet — adds a certificate or fund holding ────────────────────
function SubscribeSheet({ product, isFund, onClose }: {
  product: { name:string; dur:string; rate:number; min:number; color:string; risk:string }
  isFund: boolean
  onClose: ()=>void
}) {
  const { t } = useT()
  const { profile, patch, buy } = useApp()
  const [amount, setAmount] = useState(String(product.min))
  const [step, setStep] = useState<"amount"|"review"|"done">("amount")
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string|null>(null)
  const submitting = useRef(false)

  const remaining = profile?.limits?.remaining ?? 0
  const raw = amount.trim()
  // Digits only. Stripping non-digits silently turned "-5000" into 5000.
  const wellFormed = /^\d+$/.test(raw)
  const value = wellFormed ? Number(raw) : NaN
  const profit = Number.isFinite(value) ? Math.round(value * product.rate / 100) : 0

  const validate = () => {
    if (!wellFormed || !Number.isFinite(value)) return "Enter the amount in whole Egyptian pounds, digits only."
    if (value < product.min) return `Minimum for ${product.name} is EGP ${product.min.toLocaleString()}.`
    if (value > remaining)   return `That is over your remaining limit of EGP ${remaining.toLocaleString()}. Invest the remainder now, or schedule the balance next cycle.`
    return null
  }

  const confirm = async () => {
    // A ref, not state: three clicks in one tick all read the same stale state.
    if (submitting.current) return
    const problem = validate()
    if (problem) { setErr(problem); setStep("amount"); return }
    submitting.current = true
    setBusy(true); setErr(null)
    try {
      const today = new Date()
      const years = Number((product.dur.match(/(\d+)\s*Year/i) ?? [])[1] ?? 0)
      const matures = years ? new Date(today.getFullYear()+years, today.getMonth(), today.getDate()) : null
      await buy({
        kind: isFund ? "fund" : "certificate",
        productName: product.name,
        amount: value,
        rate: product.rate,
        term: product.dur,
        status: "active",
        purchasedAt: localISO(today),
        ...(matures ? { maturesAt: localISO(matures) } : {}),
      })
      patch({
        "limits.remaining": Math.max(0, remaining - value),
        "flags.hasSubscribed": true,
        "flags.funnelStage": "first_subscription",
        "stats.points": (profile?.stats?.points ?? 0) + PTS_INVEST,
        "stats.level": progression((profile?.stats?.points ?? 0) + PTS_INVEST).level,
      })
      setStep("done")
    } catch {
      setErr("Could not complete the subscription. Check your connection and try again.")
      submitting.current = false
    } finally { setBusy(false) }
  }

  const sheet: React.CSSProperties = {
    background: t.dm ? "rgba(12,32,22,0.96)" : "rgba(255,255,255,0.97)",
    backdropFilter:"blur(28px)", WebkitBackdropFilter:"blur(28px)",
    borderTop:`1px solid ${t.strokeS}`, borderRadius:"30px 30px 0 0",
    padding:"22px 20px 26px", boxShadow:"0 -20px 60px rgba(0,0,0,0.5)",
    animation:"fadeUp 0.3s ease-out", maxHeight:"88%", overflowY:"auto",
  }

  return <div style={{ position:"absolute", inset:0, zIndex:70, display:"flex", flexDirection:"column", justifyContent:"flex-end" }}>
    <div onClick={step==="done"?onClose:undefined} style={{ position:"absolute", inset:0, background:"rgba(2,12,8,0.66)", backdropFilter:"blur(3px)", WebkitBackdropFilter:"blur(3px)" }}/>
    <div style={{ ...sheet, position:"relative" }}>
      <div style={{ width:40, height:4, borderRadius:4, background:t.track, margin:"0 auto 18px" }}/>

      {step === "amount" && <>
        <div style={{ fontSize:19, fontWeight:800, color:t.text, marginBottom:4 }}>{product.name}</div>
        <div style={{ fontSize:12.5, color:t.sub, marginBottom:20 }}>
          {product.rate}% {isFund?"average per year":"per year"} · {isFund?"Horizon":"Duration"} {product.dur} · Min EGP {product.min.toLocaleString()}
        </div>

        <div style={{ fontSize:12, fontWeight:700, color:t.sub, marginBottom:9 }}>How much would you like to invest?</div>
        <div style={{ display:"flex", alignItems:"center", gap:10, border:`1.5px solid ${t.strokeS}`, borderRadius:18, padding:"14px 18px", background:t.inputBg, marginBottom:10 }}>
          <span style={{ fontSize:14, fontWeight:700, color:t.sub }}>EGP</span>
          <input inputMode="numeric" value={amount} onChange={e=>{ setAmount(e.target.value); setErr(null) }}
            style={{ flex:1, border:"none", outline:"none", background:"transparent", fontSize:22, fontWeight:800, color:t.text, fontFamily:"inherit", minWidth:0 }}/>
        </div>

        <div style={{ display:"flex", justifyContent:"space-between", fontSize:11.5, color:t.sub, marginBottom:14 }}>
          <span>Remaining limit this cycle</span>
          <span style={{ fontWeight:700, color:t.text }}>EGP {remaining.toLocaleString()}</span>
        </div>

        <div style={{ display:"flex", gap:8, marginBottom:18 }}>
          {[product.min, 10000, 25000].filter((v,i,a)=>a.indexOf(v)===i && v<=remaining).map(v=>(
            <button key={v} onClick={()=>{ setAmount(String(v)); setErr(null) }} style={{ flex:1, padding:"10px 0", borderRadius:999, border:`1px solid ${t.stroke}`, background:t.chip, color:t.text, fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>
              {v.toLocaleString()}
            </button>
          ))}
        </div>

        {err && <div style={{ background:`${ERR}16`, border:`1px solid ${ERR}44`, borderRadius:16, padding:"12px 14px", marginBottom:14, fontSize:12.5, color:t.text, lineHeight:1.6 }}>
          {err}
          {remaining === 0 && <div style={{ color:t.sub, marginTop:7 }}>
            Youth accounts have a cap on how much can be committed per cycle. Yours refills to EGP {(profile?.limits?.cycleCap ?? 0).toLocaleString()} on {profile?.limits?.resetDate ?? "the next cycle"}.
          </div>}
        </div>}

        <div style={{ display:"flex", gap:10 }}>
          <button onClick={onClose} style={{ padding:"14px 20px", borderRadius:999, border:`1px solid ${t.border}`, background:"transparent", color:t.sub, fontSize:14, fontWeight:600, cursor:"pointer", fontFamily:"inherit" }}>Cancel</button>
          <button onClick={()=>{ const v=validate(); v ? setErr(v) : setStep("review") }} style={{ flex:1, padding:"15px", borderRadius:999, border:"none", background:`linear-gradient(135deg,${product.color},${product.color}CC)`, color:"white", fontSize:14.5, fontWeight:700, cursor:"pointer", boxShadow:`0 8px 22px ${product.color}45`, fontFamily:"inherit" }}>Continue</button>
        </div>
      </>}

      {step === "review" && <>
        <div style={{ fontSize:19, fontWeight:800, color:t.text, marginBottom:18 }}>Confirm your subscription</div>
        {[
          ["Product", product.name],
          ["Type", isFund ? "Mutual fund" : "Certificate"],
          ["Amount", `EGP ${value.toLocaleString()}`],
          [isFund?"Average return":"Interest rate", `${product.rate}% per year`],
          [isFund?"Suggested horizon":"Duration", product.dur],
          [isFund?"Estimated first-year gain":"Profit at maturity", `EGP ${profit.toLocaleString()}`],
          ["Limit after this", `EGP ${Math.max(0, remaining - (Number.isFinite(value) ? value : 0)).toLocaleString()}`],
        ].map(([k,v],i,a)=>(
          <div key={k} style={{ display:"flex", justifyContent:"space-between", gap:12, padding:"11px 0", borderBottom:i<a.length-1?`1px solid ${t.border}`:"none" }}>
            <span style={{ fontSize:12.5, color:t.sub }}>{k}</span>
            <span style={{ fontSize:12.5, fontWeight:700, color:t.text, textAlign:"right" as const }}>{v}</span>
          </div>
        ))}

        <div style={{ marginTop:16, padding:"13px 15px", borderRadius:16, background:isFund?`${GD}14`:t.cardAlt, border:`1px solid ${isFund?GD:GR}30`, fontSize:12, color:t.sub, lineHeight:1.7 }}>
          {isFund
            ? "This fund's value moves daily and past averages are not a promise. You could end up with less than you put in."
            : "This amount cannot be withdrawn during the first six months of the term."}
          {" "}Rates and terms change — confirm the current figures in the app or at a branch before committing.
        </div>

        {err && <div style={{ background:`${ERR}16`, border:`1px solid ${ERR}44`, borderRadius:16, padding:"12px 14px", marginTop:14, fontSize:12.5, color:t.text }}>{err}</div>}

        <div style={{ display:"flex", gap:10, marginTop:18 }}>
          <button onClick={()=>setStep("amount")} disabled={busy} style={{ padding:"14px 20px", borderRadius:999, border:`1px solid ${t.border}`, background:"transparent", color:t.sub, fontSize:14, fontWeight:600, cursor:"pointer", fontFamily:"inherit" }}>Back</button>
          <button onClick={confirm} disabled={busy} style={{ flex:1, padding:"15px", borderRadius:999, border:"none", background:`linear-gradient(135deg,${product.color},${product.color}CC)`, color:"white", fontSize:14.5, fontWeight:700, cursor:busy?"default":"pointer", opacity:busy?0.6:1, boxShadow:`0 8px 22px ${product.color}45`, fontFamily:"inherit" }}>
            {busy ? "Submitting…" : "Confirm subscription"}
          </button>
        </div>
      </>}

      {step === "done" && <div style={{ textAlign:"center" as const, padding:"8px 0 4px" }}>
        <div style={{ width:66, height:66, borderRadius:33, background:`linear-gradient(135deg,${GR},${GRD})`, display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 18px", boxShadow:`0 12px 30px ${GR}50`, animation:"popIn 0.4s ease-out" }}>
          <Ic n="check" c="white" s={30}/>
        </div>
        <div style={{ fontSize:19, fontWeight:800, color:t.text, marginBottom:8 }}>Subscription added</div>
        <div style={{ fontSize:13, color:t.sub, lineHeight:1.7, marginBottom:22 }}>
          EGP {(Number.isFinite(value) ? value : 0).toLocaleString()} in {product.name}. It now appears in your holdings, and Acsend can see it when you ask for advice.
        </div>
        <button onClick={onClose} style={{ width:"100%", padding:"15px", borderRadius:999, border:"none", background:`linear-gradient(135deg,${GR},${GRD})`, color:"white", fontSize:14.5, fontWeight:700, cursor:"pointer", boxShadow:`0 8px 22px ${GR}45`, fontFamily:"inherit" }}>Done</button>
      </div>}
    </div>
  </div>
}

// ─── InvestScreen — "Learn More" opens a detail view ─────────────────────────
const CERT_DETAILS = [
  {
    about:"The Premium Certificate is NBE's most popular fixed-income product. You deposit a lump sum for exactly one year and receive a guaranteed 25% annual interest — paid in full at maturity.",
    conditions:[{label:"Eligibility",value:"NBE Youth account holders aged 16+"},{label:"Minimum Amount",value:"EGP 1,000"},{label:"Duration",value:"1 Year (non-breakable)"},{label:"Currency",value:"Egyptian Pound (EGP)"},{label:"Renewal",value:"Auto-renewable at maturity"}],
    benefits:[{label:"Interest Rate",value:"25% per year — guaranteed"},{label:"Capital Protection",value:"100% of your principal is safe"},{label:"CBE Guarantee",value:"Backed by the Central Bank of Egypt"},{label:"Interest Payment",value:"Paid in full at maturity"},{label:"Best For",value:"Short-term savings goals"}],
  },
  {
    about:"The Growth Certificate rewards long-term commitment. Invest for 3 years at 22% annually with full capital protection and interest paid to your account each year.",
    conditions:[{label:"Eligibility",value:"NBE account holders aged 16+"},{label:"Minimum Amount",value:"EGP 5,000"},{label:"Duration",value:"3 Years"},{label:"Currency",value:"Egyptian Pound (EGP)"},{label:"Withdrawal",value:"Not allowed before maturity"}],
    benefits:[{label:"Interest Rate",value:"22% per year — fixed"},{label:"Capital Protection",value:"Full protection of your deposit"},{label:"Periodic Interest",value:"Paid annually to your account"},{label:"Long-term Growth",value:"High total return over 3 years"},{label:"Best For",value:"Medium-term financial goals"}],
  },
  {
    about:"The Long-Term Certificate is for ambitious savers who can commit for 5 years. At 18% a year the total interest is significant, with partial access allowed after year 2.",
    conditions:[{label:"Eligibility",value:"NBE account holders aged 16+"},{label:"Minimum Amount",value:"EGP 10,000"},{label:"Duration",value:"5 Years"},{label:"Currency",value:"Egyptian Pound (EGP)"},{label:"Withdrawal",value:"Partial withdrawal allowed after year 2"}],
    benefits:[{label:"Interest Rate",value:"18% per year — fixed"},{label:"Flexible Withdrawal",value:"Partial access after 2 years"},{label:"Capital Protection",value:"100% guaranteed"},{label:"Wealth Building",value:"Maximum long-term value"},{label:"Best For",value:"Long-term life goals"}],
  },
]

const FUND_DETAILS = [
  {
    about:"The Money Market Fund pools your money with thousands of other savers and lends it out short-term, mostly to the government. It is the calmest fund NBE offers — the value moves in small steps and you can take your money out any working day.",
    conditions:[{label:"Eligibility",value:"NBE Youth account holders aged 16+"},{label:"Minimum Investment",value:"EGP 500"},{label:"Redemption",value:"Daily — no lock-in period"},{label:"Currency",value:"Egyptian Pound (EGP)"},{label:"Management Fee",value:"0.75% per year"}],
    benefits:[{label:"Historical Return",value:"~19% per year average — not guaranteed"},{label:"Liquidity",value:"Withdraw any business day"},{label:"Risk Level",value:"Low — short-term instruments only"},{label:"Professional Management",value:"Actively managed by NBE Asset Management"},{label:"Best For",value:"Short-term saving with flexibility"}],
  },
  {
    about:"The Balanced Growth Fund splits your money between company shares on the Egyptian Exchange and safer fixed-income instruments. The mix is the point: the shares chase growth, the fixed-income part cushions the drops.",
    conditions:[{label:"Eligibility",value:"NBE account holders aged 16+"},{label:"Minimum Investment",value:"EGP 2,000"},{label:"Redemption",value:"Weekly, subject to notice period"},{label:"Currency",value:"Egyptian Pound (EGP)"},{label:"Management Fee",value:"1.25% per year"}],
    benefits:[{label:"Historical Return",value:"~24% per year average — not guaranteed"},{label:"Diversification",value:"Spread across stocks and bonds"},{label:"Risk Level",value:"Medium — value can rise or fall"},{label:"Professional Management",value:"Actively rebalanced by fund managers"},{label:"Best For",value:"Medium-term goals, 2+ year horizon"}],
  },
  {
    about:"The Equity Opportunities Fund buys shares in Egyptian companies the fund managers expect to grow. It has the biggest swings of the three — some months are down — but over several years it has the highest growth potential.",
    conditions:[{label:"Eligibility",value:"NBE account holders aged 18+"},{label:"Minimum Investment",value:"EGP 3,000"},{label:"Redemption",value:"Weekly, subject to notice period"},{label:"Currency",value:"Egyptian Pound (EGP)"},{label:"Management Fee",value:"1.75% per year"}],
    benefits:[{label:"Historical Return",value:"~30% per year average — not guaranteed"},{label:"Growth Focus",value:"Concentrated in high-growth EGX equities"},{label:"Risk Level",value:"High — value can swing significantly"},{label:"Professional Management",value:"Actively managed, research-driven picks"},{label:"Best For",value:"Long-term goals, 3+ year horizon"}],
  },
]

/** Where a holding stands today: elapsed term, value accrued, what is due. */
function holdingProgress(h:HoldingDoc) {
  const start = new Date(h.purchasedAt).getTime()
  const now   = Date.now()
  const end   = h.maturesAt ? new Date(h.maturesAt).getTime() : 0
  const years = end ? (end - start) / 31_557_600_000 : 1
  const elapsedYears = Math.max(0, (now - start) / 31_557_600_000)
  const pct = end ? Math.min(100, Math.max(0, Math.round(((now - start) / (end - start)) * 100))) : null
  const totalProfit = Math.round(h.amount * (h.rate / 100) * (years || 1))
  const accrued = Math.round(h.amount * (h.rate / 100) * Math.min(elapsedYears, years || elapsedYears))
  const daysLeft = end ? Math.max(0, Math.ceil((end - now) / 86_400_000)) : null
  return { pct, totalProfit, accrued, daysLeft, atMaturity: h.amount + totalProfit, years }
}

function InvestScreen() {
  const { t } = useT()
  const { holdings } = useApp()
  const [productType, setProductType] = useState<"certs"|"funds">("certs")
  const [amount, setAmount] = useState(10000)
  const [selected, setSelected] = useState(0)
  const [learnMore, setLearnMore] = useState<number|null>(null)
  const [explainer, setExplainer] = useState(false)
  const [buying, setBuying] = useState(false)

  const certs = CERTS
  const funds = FUNDS
  const owned = holdings.filter(h => h.kind === (productType==="funds" ? "fund" : "certificate"))
  const ownedTotal = owned.reduce((n,h)=>n+h.amount, 0)
  const ownedProjected = owned.reduce((n,h)=>n + holdingProgress(h).atMaturity, 0)
  const isFund = productType==="funds"
  const products = isFund ? funds : certs
  const details  = isFund ? FUND_DETAILS : CERT_DETAILS
  const switchType = (p:"certs"|"funds") => { setProductType(p); setSelected(0); setLearnMore(null) }
  const cert = products[selected]
  // A 5-year certificate pays five years of interest; the old figure showed one
  // year's under a "Total After 5 Years" label.
  const calcYears = isFund ? 1 : termYears(cert.dur)
  const profit = Math.round(amount*cert.rate/100*calcYears), total = amount+profit
  const glass = { background:t.card, backdropFilter:t.blur, WebkitBackdropFilter:t.blur, border:`1px solid ${t.stroke}`, boxShadow:t.shadow }

  // ── Plain-language explainer ──
  if (explainer) {
    const rows = [
      { label:"What actually happens to your money", cert:"NBE holds it and pays you a fixed rate for lending it to them.", fund:"It is pooled with other people's money and used to buy things that can gain or lose value." },
      { label:"Do you know the return in advance?", cert:"Yes. The rate is written down on day one and never changes.", fund:"No. You only see what similar money earned in past years." },
      { label:"Can you lose money?", cert:"No. Your deposit is guaranteed by the Central Bank of Egypt.", fund:"Yes. The value can fall, especially over short periods." },
      { label:"When can you take it out?", cert:"Only at the end of the term (some allow partial access after 2 years).", fund:"Daily or weekly, depending on the fund." },
      { label:"Who decides what to buy", cert:"Nobody — the rate is fixed, there is nothing to decide.", fund:"NBE fund managers choose and adjust what the fund holds." },
    ]
    return <div style={{ background:"transparent", minHeight:"100%" }}>
      <div style={{ background:t.card, backdropFilter:t.blur, WebkitBackdropFilter:t.blur, borderBottom:`1px solid ${t.stroke}`, padding:"0 20px 16px", paddingTop:`calc(14px + var(--safe-top, 0px))` }}>
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          <button onClick={()=>setExplainer(false)} style={{ width:36, height:36, borderRadius:999, background:t.chip, backdropFilter:t.blur, WebkitBackdropFilter:t.blur, border:`1px solid ${t.stroke}`, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", flexShrink:0 }}><Ic n="left" c={t.text} s={18}/></button>
          <div><div style={{ fontSize:17, fontWeight:800, color:t.text }}>Certificates vs Funds</div><div style={{ fontSize:12, color:t.sub }}>The difference, in plain words</div></div>
        </div>
      </div>
      <div style={{ padding:"14px 16px 28px" }}>
        <div style={{ ...glass, borderRadius:22, padding:"18px", marginBottom:12 }}>
          <div style={{ fontSize:14, fontWeight:800, color:t.text, marginBottom:8 }}>The one-line version</div>
          <div style={{ fontSize:13, color:t.sub, lineHeight:1.75 }}>
            A <b style={{ color:t.brand }}>certificate</b> is a promise: you lend NBE money for a set time and NBE tells you exactly what you get back. A <b style={{ color:t.gold }}>fund</b> is a basket: your money joins a big pot that buys things whose value moves, so the ending is not written in advance.
          </div>
        </div>
        {rows.map((r,i)=>(
          <div key={i} style={{ ...glass, borderRadius:22, padding:"16px", marginBottom:10 }}>
            <div style={{ fontSize:12, fontWeight:800, color:t.text, marginBottom:12 }}>{r.label}</div>
            <div style={{ display:"flex", gap:10, marginBottom:9 }}>
              <div style={{ width:60, flexShrink:0, fontSize:10, fontWeight:800, color:t.brand, letterSpacing:0.6, paddingTop:2 }}>CERT</div>
              <div style={{ fontSize:12.5, color:t.sub, lineHeight:1.65 }}>{r.cert}</div>
            </div>
            <div style={{ display:"flex", gap:10 }}>
              <div style={{ width:60, flexShrink:0, fontSize:10, fontWeight:800, color:t.gold, letterSpacing:0.6, paddingTop:2 }}>FUND</div>
              <div style={{ fontSize:12.5, color:t.sub, lineHeight:1.65 }}>{r.fund}</div>
            </div>
          </div>
        ))}
        <div style={{ ...glass, borderRadius:22, padding:"18px", marginTop:6 }}>
          <div style={{ fontSize:14, fontWeight:800, color:t.text, marginBottom:8 }}>How to pick</div>
          <div style={{ fontSize:13, color:t.sub, lineHeight:1.75 }}>
            If you need the exact amount on an exact date — a laptop in September, tuition in January — take a certificate. If the money has years to sit and you can watch it dip without panicking, a fund has more room to grow. Most people start with a certificate and add a fund later.
          </div>
        </div>
      </div>
    </div>
  }

  // ── Product detail ──
  if (learnMore !== null) {
    const lc = products[learnMore], ld = details[learnMore]
    return <div style={{ background:"transparent", minHeight:"100%" }}>
      <div style={{ background:t.card, backdropFilter:t.blur, WebkitBackdropFilter:t.blur, borderBottom:`1px solid ${t.stroke}`, padding:"0 20px 16px", paddingTop:`calc(14px + var(--safe-top, 0px))` }}>
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          <button onClick={()=>setLearnMore(null)} style={{ width:36, height:36, borderRadius:999, background:t.chip, backdropFilter:t.blur, WebkitBackdropFilter:t.blur, border:`1px solid ${t.stroke}`, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", flexShrink:0 }}><Ic n="left" c={t.text} s={18}/></button>
          <div><div style={{ fontSize:17, fontWeight:800, color:t.text }}>{lc.name}</div><div style={{ fontSize:12, color:t.sub }}>{lc.dur} · {lc.rate}% {isFund?"avg/year":"per year"}</div></div>
        </div>
      </div>
      <div style={{ padding:"14px 16px 28px" }}>
        <div style={{ borderRadius:24, background:`linear-gradient(135deg,${lc.color},${lc.color}BB)`, padding:"22px", marginBottom:14, color:"white", display:"flex", justifyContent:"space-between", alignItems:"center", boxShadow:`0 14px 36px ${lc.color}40`, border:"1px solid rgba(255,255,255,0.12)" }}>
          <div><div style={{ fontSize:11, color:"rgba(255,255,255,0.55)", marginBottom:4 }}>{isFund?"Avg. Annual Return":"Annual Return"}</div><div style={{ fontSize:40, fontWeight:800, lineHeight:1 }}>{lc.rate}%</div><div style={{ fontSize:12, color:"rgba(255,255,255,0.65)", marginTop:5 }}>{isFund?`${lc.risk} risk · not guaranteed`:"Guaranteed by CBE"}</div></div>
          <div style={{ textAlign:"right" as const }}><div style={{ fontSize:11, color:"rgba(255,255,255,0.55)", marginBottom:4 }}>{isFund?"Horizon":"Duration"}</div><div style={{ fontSize:22, fontWeight:800 }}>{lc.dur}</div><div style={{ fontSize:11, color:"rgba(255,255,255,0.55)", marginTop:4 }}>Min. EGP {lc.min.toLocaleString()}</div></div>
        </div>
        {isFund && <div style={{ display:"flex", gap:10, alignItems:"flex-start", ...glass, borderRadius:20, padding:"14px 16px", marginBottom:14 }}>
          <Ic n="info" c={t.gold} s={17}/>
          <div style={{ fontSize:12, color:t.sub, lineHeight:1.7 }}>A fund's value moves with the market. What it earned before is history, not a promise — unlike a certificate, nothing here is guaranteed by the Central Bank.</div>
        </div>}
        <div style={{ ...glass, borderRadius:22, padding:"18px", marginBottom:12 }}>
          <div style={{ display:"flex", alignItems:"center", gap:9, marginBottom:11 }}>
            <div style={{ width:32, height:32, borderRadius:11, background:`${lc.color}22`, border:`1px solid ${lc.color}35`, display:"flex", alignItems:"center", justifyContent:"center" }}><Ic n="info" c={lc.color} s={16}/></div>
            <span style={{ fontSize:14, fontWeight:800, color:t.text }}>{isFund?"About This Fund":"About This Certificate"}</span>
          </div>
          <div style={{ fontSize:13, color:t.sub, lineHeight:1.75 }}>{ld.about}</div>
        </div>
        <div style={{ ...glass, borderRadius:22, padding:"18px", marginBottom:12 }}>
          <div style={{ display:"flex", alignItems:"center", gap:9, marginBottom:13 }}>
            <div style={{ width:32, height:32, borderRadius:11, background:`${GD}22`, border:`1px solid ${GD}35`, display:"flex", alignItems:"center", justifyContent:"center" }}><Ic n="list" c={t.gold} s={16}/></div>
            <span style={{ fontSize:14, fontWeight:800, color:t.text }}>Conditions</span>
          </div>
          {ld.conditions.map((c,i)=><div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", padding:"10px 0", borderBottom:i<ld.conditions.length-1?`1px solid ${t.border}`:"none", gap:12 }}>
            <span style={{ fontSize:12, color:t.sub }}>{c.label}</span>
            <span style={{ fontSize:12, fontWeight:600, color:t.text, textAlign:"right" as const }}>{c.value}</span>
          </div>)}
        </div>
        <div style={{ ...glass, borderRadius:22, padding:"18px", marginBottom:16 }}>
          <div style={{ display:"flex", alignItems:"center", gap:9, marginBottom:13 }}>
            <div style={{ width:32, height:32, borderRadius:11, background:`${GR}22`, border:`1px solid ${GR}35`, display:"flex", alignItems:"center", justifyContent:"center" }}><Ic n="star" c={t.brand} s={16}/></div>
            <span style={{ fontSize:14, fontWeight:800, color:t.text }}>Benefits</span>
          </div>
          {ld.benefits.map((b,i)=><div key={i} style={{ display:"flex", gap:11, alignItems:"flex-start", marginBottom:i<ld.benefits.length-1?11:0 }}>
            <div style={{ width:22, height:22, borderRadius:11, background:t.cardAlt, border:`1px solid ${t.stroke}`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, marginTop:1 }}><Ic n="check" c={t.brand} s={11}/></div>
            <div><span style={{ fontSize:12, fontWeight:700, color:t.text }}>{b.label}: </span><span style={{ fontSize:12, color:t.sub }}>{b.value}</span></div>
          </div>)}
        </div>
        <button onClick={()=>{ setSelected(learnMore); setLearnMore(null); setBuying(true) }} style={{ width:"100%", padding:"16px", borderRadius:999, border:"none", background:`linear-gradient(135deg,${lc.color},${lc.color}BB)`, color:"white", fontSize:15, fontWeight:700, cursor:"pointer", boxShadow:`0 10px 26px ${lc.color}45`, fontFamily:"inherit" }}>{isFund?"Invest in This Fund":"Invest in This Certificate"}</button>
      </div>
    </div>
  }

  // ── List ──
  return <div style={{ background:"transparent", minHeight:"100%", position:"relative" }}>
    <div style={{ background:t.card, backdropFilter:t.blur, WebkitBackdropFilter:t.blur, borderBottom:`1px solid ${t.stroke}`, padding:"0 20px 18px", paddingTop:`calc(16px + var(--safe-top, 0px))` }}>
      <div style={{ fontSize:22, fontWeight:800, color:t.text, letterSpacing:-0.5 }}>Invest</div>
      <div style={{ fontSize:13, color:t.sub, marginTop:2 }}>Grow your money with NBE</div>
    </div>
    <div style={{ padding:"14px 16px 0" }}>

      <div id="tut-invest-toggle" style={{ display:"flex", ...glass, borderRadius:999, padding:5, marginBottom:14, gap:5 }}>
        {([["certs","Certificates"],["funds","Mutual Funds"]] as const).map(([id,label])=>(
          <button key={id} onClick={()=>switchType(id)} style={{ flex:1, padding:"11px 0", borderRadius:999, border:"none", cursor:"pointer", fontSize:13, fontWeight:700, fontFamily:"inherit", background:productType===id?`linear-gradient(135deg,${GR},${GRD})`:"transparent", color:productType===id?"white":t.sub, boxShadow:productType===id?`0 6px 18px ${GR}45`:"none", transition:"all 0.22s" }}>{label}</button>
        ))}
      </div>

      {!owned.length && <button id="tut-invest-explainer" onClick={()=>setExplainer(true)} style={{ width:"100%", ...glass, borderRadius:20, padding:"14px 16px", display:"flex", alignItems:"center", gap:12, cursor:"pointer", marginBottom:16, textAlign:"left" as const, fontFamily:"inherit" }}>
        <div style={{ width:38, height:38, borderRadius:19, background:t.cardAlt, border:`1px solid ${t.stroke}`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}><Ic n="help" c={t.brand} s={18}/></div>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:13, fontWeight:800, color:t.text }}>Not sure which is which?</div>
          <div style={{ fontSize:11.5, color:t.sub, marginTop:2 }}>Certificates vs funds, explained in plain words</div>
        </div>
        <Ic n="right" c={t.sub} s={16}/>
      </button>}

      {owned.length > 0 && <div style={{ ...glass, borderRadius:22, padding:"18px", marginBottom:16 }} key={productType+"-track"}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4 }}>
          <div style={{ fontSize:14, fontWeight:800, color:t.text }}>
            Your {isFund ? "funds" : "certificates"}
          </div>
          <button onClick={()=>setExplainer(true)} style={{ fontSize:11.5, color:t.sub, fontWeight:600, background:"none", border:"none", cursor:"pointer", fontFamily:"inherit", textDecoration:"underline" }}>
            Remind me how these work
          </button>
        </div>
        <div style={{ fontSize:12, color:t.sub, marginBottom:16 }}>
          EGP {ownedTotal.toLocaleString()} across {owned.length} {owned.length===1?"holding":"holdings"}
          {isFund ? " · value moves daily" : ` · EGP ${ownedProjected.toLocaleString()} at maturity`}
        </div>

        {owned.map(h=>{
          const pr = holdingProgress(h)
          return <div key={h.id} style={{ background:t.cardAlt, border:`1px solid ${t.stroke}`, borderRadius:18, padding:"15px 16px", marginBottom:10 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:10, marginBottom:12 }}>
              <div style={{ minWidth:0 }}>
                <div style={{ fontSize:13.5, fontWeight:700, color:t.text, whiteSpace:"nowrap" as const, overflow:"hidden", textOverflow:"ellipsis" }}>{h.productName}</div>
                <div style={{ fontSize:11.5, color:t.sub, marginTop:2 }}>
                  Bought {h.purchasedAt} · {isFund ? `~${h.rate}% avg` : `${h.rate}% fixed`}
                </div>
              </div>
              <div style={{ textAlign:"right" as const, flexShrink:0 }}>
                <div style={{ fontSize:15, fontWeight:800, color:t.text }}>EGP {h.amount.toLocaleString()}</div>
                <div style={{ fontSize:10, color:t.sub, marginTop:2 }}>invested</div>
              </div>
            </div>

            {pr.pct !== null && <div style={{ marginBottom:12 }}>
              <div style={{ display:"flex", justifyContent:"space-between", fontSize:10.5, color:t.sub, marginBottom:5 }}>
                <span>{pr.pct}% through the term</span>
                <span>{pr.daysLeft === 0 ? "Matured" : `${pr.daysLeft} days left`}</span>
              </div>
              <Bar pct={pr.pct} color={productByName(h.productName)?.color ?? cert.color} h={5}/>
            </div>}

            <div style={{ display:"grid", gridTemplateColumns:"repeat(2, minmax(0,1fr))", gap:9 }}>
              <div style={{ background:t.chip, border:`1px solid ${t.stroke}`, borderRadius:14, padding:"10px 12px" }}>
                <div style={{ fontSize:10, color:t.sub }}>{isFund ? "Estimated gain so far" : "Interest earned so far"}</div>
                <div style={{ fontSize:15, fontWeight:800, color:t.brand, marginTop:3 }}>+EGP {pr.accrued.toLocaleString()}</div>
              </div>
              <div style={{ background:t.chip, border:`1px solid ${t.stroke}`, borderRadius:14, padding:"10px 12px" }}>
                <div style={{ fontSize:10, color:t.sub }}>{isFund ? "If the average holds (1 yr)" : "Value at maturity"}</div>
                <div style={{ fontSize:15, fontWeight:800, color:t.gold, marginTop:3 }}>EGP {pr.atMaturity.toLocaleString()}</div>
              </div>
            </div>

            <div style={{ fontSize:11, color:t.sub, marginTop:11, lineHeight:1.6 }}>
              {isFund
                ? "Funds have no maturity date and no fixed rate — these figures are an estimate from the historical average, and the real value moves every day."
                : h.maturesAt
                  ? `Pays out on ${h.maturesAt}. ${productByName(h.productName)?.access ?? ""}`
                  : "No maturity date recorded."}
            </div>
          </div>
        })}
      </div>}

      {!owned.length && <div style={{ ...glass, borderRadius:22, padding:"18px", marginBottom:16 }} key={productType+"-how"}>
        <div style={{ display:"flex", alignItems:"center", gap:9, marginBottom:12 }}>
          <div style={{ width:32, height:32, borderRadius:11, background:isFund?`${GD}22`:`${GR}22`, border:`1px solid ${isFund?GD:GR}38`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
            <Ic n={isFund?"trending":"shield"} c={isFund?t.gold:t.brand} s={16}/>
          </div>
          <div style={{ fontSize:14, fontWeight:800, color:t.text }}>{isFund?"How a mutual fund works":"How a certificate works"}</div>
        </div>
        <div style={{ fontSize:13, color:t.sub, lineHeight:1.75, marginBottom:14 }}>
          {isFund
            ? "Your money joins a large shared pot. NBE's fund managers use that pot to buy things — government debt, shares in Egyptian companies, or a mix of both. You own a slice of the pot, and your slice is worth whatever those things are worth today. That value moves every day, up and down."
            : "You hand NBE an amount and agree not to touch it for a set period. In return NBE tells you the exact rate on day one, and that rate never changes. At the end you get your money back plus the interest, and the Central Bank of Egypt stands behind the amount you put in."}
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          {(isFund
            ? [["What you own","A share of the pot, priced daily. That price is the NAV you see in the app."],
               ["Where the return comes from","The things the pot holds gaining value, and any income they pay out."],
               ["What can go wrong","The pot can be worth less than you paid, especially over short periods. Nothing is guaranteed."],
               ["Getting your money out","Daily or weekly depending on the fund — you are not locked in."]]
            : [["What you own","A contract with NBE for a fixed amount and a fixed rate."],
               ["Where the return comes from","Interest NBE pays you for the use of your money."],
               ["What can go wrong","Very little to the amount itself. The real cost is being unable to access it early."],
               ["Getting your money out","Not before the term ends. Some certificates allow partial access after two years."]]
          ).map(([label,body],i)=>(
            <div key={i} style={{ display:"flex", gap:11, alignItems:"flex-start" }}>
              <div style={{ width:6, height:6, borderRadius:3, background:isFund?GD:GR, marginTop:7, flexShrink:0 }}/>
              <div>
                <span style={{ fontSize:12.5, fontWeight:700, color:t.text }}>{label}: </span>
                <span style={{ fontSize:12.5, color:t.sub, lineHeight:1.7 }}>{body}</span>
              </div>
            </div>
          ))}
        </div>
        {isFund && <div style={{ marginTop:14, padding:"12px 14px", borderRadius:16, background:`${GD}14`, border:`1px solid ${GD}30`, fontSize:12, color:t.sub, lineHeight:1.7 }}>
          The percentage on each fund below is an <b style={{ color:t.text }}>average of what already happened</b>, not a rate you are being offered. A certificate&rsquo;s percentage is a promise; a fund&rsquo;s is a track record.
        </div>}
      </div>}

      <div style={{ fontSize:14, fontWeight:700, color:t.text, marginBottom:10 }}>{isFund?"Choose a Fund":"Choose a Certificate"}</div>
      <div style={{ display:"flex", gap:9, marginBottom:14 }}>
        {products.map((c,i)=><button key={c.name} onClick={()=>setSelected(i)} style={{ flex:1, padding:"12px 6px", borderRadius:18, cursor:"pointer", fontFamily:"inherit", background:selected===i?`${c.color}22`:t.card, backdropFilter:t.blur, WebkitBackdropFilter:t.blur, border:`1px solid ${selected===i?c.color+"88":t.stroke}`, boxShadow:selected===i?`0 8px 22px ${c.color}30`:"none", transition:"all 0.22s" }}>
          <div style={{ fontSize:19, fontWeight:800, color:selected===i?(t.dm?"#FFFFFF":c.color):t.text }}>{c.rate}%</div>
          <div style={{ fontSize:10, color:t.sub, marginTop:3 }}>{c.dur}</div>
        </button>)}
      </div>

      <div id="tut-invest-card" style={{ ...glass, borderRadius:22, overflow:"hidden", marginBottom:14, animation:"popIn 0.3s ease-out" }} key={productType+selected}>
        <div style={{ height:4, background:cert.color }}/>
        <div style={{ padding:"18px" }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:14, gap:10 }}>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:15, fontWeight:800, color:t.text, marginBottom:7 }}>{cert.name}</div>
              <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:7, flexWrap:"wrap" as const }}>
                {cert.tag&&<span style={{ fontSize:9, fontWeight:800, color:t.dm?"#FFFFFF":cert.color, background:`${cert.color}26`, border:`1px solid ${cert.color}44`, padding:"4px 9px", borderRadius:999, letterSpacing:0.4 }}>{cert.tag}</span>}
                {isFund&&<span style={{ fontSize:9, fontWeight:800, color:t.sub, background:t.chip, border:`1px solid ${t.stroke}`, padding:"4px 9px", borderRadius:999, letterSpacing:0.4 }}>{cert.risk.toUpperCase()} RISK</span>}
              </div>
              <div style={{ fontSize:12, color:t.sub }}>{isFund?"Horizon":"Duration"}: {cert.dur} · Min: EGP {cert.min.toLocaleString()}</div>
            </div>
            <div style={{ textAlign:"right" as const, flexShrink:0 }}>
              <div style={{ fontSize:36, fontWeight:800, color:cert.color, lineHeight:1, letterSpacing:-1.2 }}>{cert.rate}%</div>
              <div style={{ fontSize:10, color:t.sub, marginTop:3 }}>{isFund?"avg/year":"per year"}</div>
            </div>
          </div>
          <div style={{ display:"flex", gap:9 }}>
            <button onClick={()=>setLearnMore(selected)} style={{ flex:1, padding:"13px", borderRadius:999, border:`1px solid ${t.strokeS}`, background:t.chip, backdropFilter:t.blur, WebkitBackdropFilter:t.blur, color:t.text, fontSize:13, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>Learn More</button>
            <button onClick={()=>setBuying(true)} style={{ flex:2, padding:"13px", borderRadius:999, border:"none", background:`linear-gradient(135deg,${cert.color},${cert.color}CC)`, color:"white", fontSize:13, fontWeight:700, cursor:"pointer", boxShadow:`0 8px 22px ${cert.color}45`, fontFamily:"inherit" }}>Invest Now</button>
          </div>
        </div>
      </div>

      <div id="tut-invest-calc" style={{ ...glass, borderRadius:22, padding:"20px", marginBottom:28 }}>
        <div style={{ fontSize:15, fontWeight:700, color:t.text, marginBottom:3 }}>Growth Calculator</div>
        <div style={{ fontSize:12, color:t.sub, marginBottom:18, lineHeight:1.6 }}>{isFund?`If this fund keeps doing what it has done on average (${cert.rate}%), here is roughly where you land after one year. It is an estimate, not a promise.`:`See how much you could earn at ${cert.rate}% a year over ${cert.dur.toLowerCase()} — ${calcYears} × EGP ${Math.round(amount*cert.rate/100).toLocaleString()} in interest`}</div>
        <div style={{ marginBottom:18 }}>
          <div style={{ display:"flex", justifyContent:"space-between", marginBottom:9 }}>
            <span style={{ fontSize:13, color:t.sub }}>Investment Amount</span>
            <span style={{ fontSize:14, fontWeight:800, color:t.text }}>EGP {amount.toLocaleString()}</span>
          </div>
          <input type="range" min={1000} max={100000} step={1000} value={amount} onChange={e=>setAmount(Number(e.target.value))} style={{ width:"100%", accentColor:GR, cursor:"pointer" }}/>
          <div style={{ display:"flex", justifyContent:"space-between", fontSize:10, color:t.sub, marginTop:5 }}><span>EGP 1,000</span><span>EGP 100,000</span></div>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"minmax(0,1fr) minmax(0,1fr)", gap:10 }}>
          <div style={{ background:t.cardAlt, border:`1px solid ${t.stroke}`, borderRadius:16, padding:"15px" }}>
            <div style={{ fontSize:10, color:t.sub }}>{isFund?"Estimated Profit":"Your Profit"}</div>
            <div style={{ fontSize:21, fontWeight:800, color:t.brand, marginTop:6 }}>+EGP {profit.toLocaleString()}</div>
          </div>
          <div style={{ background:`${GD}${t.dm?"22":"18"}`, border:`1px solid ${GD}38`, borderRadius:16, padding:"15px" }}>
            <div style={{ fontSize:10, color:t.sub }}>{isFund ? "Total After 1 Year" : `Total After ${cert.dur}`}</div>
            <div style={{ fontSize:21, fontWeight:800, color:t.gold, marginTop:6 }}>EGP {total.toLocaleString()}</div>
          </div>
        </div>
      </div>
    </div>
    {buying && <SubscribeSheet product={cert} isFund={isFund} onClose={()=>setBuying(false)}/>}
  </div>
}

// ─── LearnScreen — Acsend assistant ──────────────────────────────────────────
type ChatMsg = { role:"user"|"assistant"; text:string }

// Shown only when no key/proxy is configured, so the demo still answers.
const QA_DATA: Record<string,string> = {
  "What is a bank certificate?": "A bank certificate is a savings product where you deposit money with NBE for a fixed period. In return, NBE pays you a set interest rate, and your principal is protected. Rates and terms change — confirm the current figures in the app before you commit.",
  "How does interest work?": "Interest is what the bank pays you for leaving your money with it. On a 1,000 EGP minimum certificate, the rate is fixed at the start of the term, so you know the return in advance. Rates are repriced periodically — check the app for today's figures.",
  "Saving vs investing — what's the difference?": "Saving keeps money accessible but earns very little. Investing commits it for a period in exchange for a higher return, with less access along the way. Most people need both.",
  "How can I start investing?": "You need three things first: how much you can commit, for how long, and whether you might need it early. Tell me the amount you have in mind and I can narrow it down.",
  "Can I lose money when I invest?": "It depends on the product. Certificates return your principal at the end of the term, while funds move in value and can fall. Neither is risk-free — the trade-off differs.",
  "How do I choose an investment?": "Start with your horizon, not the rate. If the money is needed within six months, a certificate is not suitable at all, since it cannot be redeemed in that window.",
}
const SUGGESTIONS = Object.keys(QA_DATA)

const GREETING = "I am Acsend, the NBE youth investment desk. Ask me about certificates, funds, or how any of it works — or pick one of the questions below."

function LearnScreen() {
  const { t } = useT()
  const { profile, holdings } = useApp()
  const [messages, setMessages] = useState<ChatMsg[]>([{ role:"assistant", text:GREETING }])
  const [input, setInput] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string|null>(null)
  const chatRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController|null>(null)
  const live = llmConfigured()

  // scrollIntoView walks up and scrolls EVERY scrollable ancestor, including
  // the document — inside an overflow:hidden shell that pans the whole layout
  // viewport and nothing can pan it back. Scroll the chat pane and nothing else.
  useEffect(()=>{
    const el = chatRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior:"smooth" })
  },[messages, busy])
  useEffect(()=>()=>abortRef.current?.abort(), [])

  const send = async (text:string) => {
    const q = text.trim()
    if (!q || busy) return
    setInput("")
    setError(null)

    const history: ChatMsg[] = [...messages, { role:"user", text:q }]
    setMessages(history)

    if (!live) {
      const answer = QA_DATA[q] ?? "I can only answer from NBE's own products and figures, and no model is connected in this build. Try one of the suggested questions."
      setMessages(p=>[...p, { role:"assistant", text:answer }])
      return
    }

    setBusy(true)
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    try {
      // System prompt goes in its own field; only the conversation turns are sent as messages.
      const system = buildSystemPrompt({
        funnel_stage: profile?.flags?.funnelStage ?? "curious",
        holdings: describeHoldings(holdings),
        limit_remaining: profile ? `EGP ${profile.limits.remaining.toLocaleString()}` : "",
        reset_date: profile?.limits?.resetDate ?? "",
      })
      const turns = history
        .filter((m,i)=>!(i===0 && m.role==="assistant"))   // drop the canned greeting
        .map(m=>({ role:m.role, content:m.text }))
      const reply = await askAcsend(system, turns, ctrl.signal)
      setMessages(p=>[...p, { role:"assistant", text:reply }])
    } catch (e:any) {
      if (e?.name === "AbortError") return
      setError(e?.message ?? "Could not reach the assistant.")
    } finally {
      setBusy(false)
    }
  }

  return <div style={{ background:"transparent", height:"100%", display:"flex", flexDirection:"column" }}>
    <div style={{ background:t.card, backdropFilter:t.blur, WebkitBackdropFilter:t.blur, padding:"0 20px 14px", paddingTop:`calc(16px + var(--safe-top, 0px))`, borderBottom:`1px solid ${t.border}`, flexShrink:0 }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:10 }}>
        <div>
          <div style={{ fontSize:20, fontWeight:800, color:t.text }}>Learn</div>
          <div style={{ fontSize:13, color:t.sub }}>Ask me anything about money.</div>
        </div>
        {!live && <span style={{ fontSize:9, fontWeight:800, color:t.sub, background:t.chip, border:`1px solid ${t.stroke}`, padding:"5px 10px", borderRadius:999, letterSpacing:0.5, flexShrink:0 }}>OFFLINE</span>}
      </div>
    </div>

    <div id="tut-learn-chat" ref={chatRef} style={{ flex:1, overflowY:"auto", padding:"16px", overscrollBehavior:"contain" as const }}>
      {messages.map((msg,i)=><div key={i} style={{ display:"flex", justifyContent:msg.role==="user"?"flex-end":"flex-start", marginBottom:12 }}>
        {msg.role==="assistant"&&<div style={{ width:32, height:32, borderRadius:16, background:`linear-gradient(135deg,${GR},${GRD})`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, marginRight:8, alignSelf:"flex-end" }}>
          <svg viewBox="0 0 20 20" width={16} height={16} fill="white"><path d="M10 1.5L1.5 7v12h6V13h5v6h6V7L10 1.5z"/></svg>
        </div>}
        <div style={{ maxWidth:"78%", padding:"12px 14px", borderRadius:msg.role==="user"?"18px 18px 4px 18px":"18px 18px 18px 4px", background:msg.role==="user"?`linear-gradient(135deg,${GR},${GRD})`:t.card, backdropFilter:msg.role==="user"?"none":t.blur, WebkitBackdropFilter:msg.role==="user"?"none":t.blur, border:msg.role==="user"?"none":`1px solid ${t.stroke}`, color:msg.role==="user"?"white":t.text, fontSize:13, lineHeight:1.7, whiteSpace:"pre-wrap" as const, animation:"fadeUp 0.25s ease-out" }}>{msg.text}</div>
      </div>)}

      {busy && <div style={{ display:"flex", justifyContent:"flex-start", marginBottom:12 }}>
        <div style={{ width:32, height:32, borderRadius:16, background:`linear-gradient(135deg,${GR},${GRD})`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, marginRight:8, alignSelf:"flex-end" }}>
          <svg viewBox="0 0 20 20" width={16} height={16} fill="white"><path d="M10 1.5L1.5 7v12h6V13h5v6h6V7L10 1.5z"/></svg>
        </div>
        <div style={{ padding:"14px 16px", borderRadius:"18px 18px 18px 4px", background:t.card, backdropFilter:t.blur, WebkitBackdropFilter:t.blur, border:`1px solid ${t.stroke}`, display:"flex", gap:5 }}>
          {[0,1,2].map(i=><div key={i} style={{ width:6, height:6, borderRadius:3, background:t.sub, animation:`fadeUp 0.9s ease-in-out ${i*0.15}s infinite alternate` }}/>)}
        </div>
      </div>}

      {error && <div style={{ background:`${ERR}18`, border:`1px solid ${ERR}45`, borderRadius:16, padding:"12px 14px", marginBottom:12, display:"flex", gap:10, alignItems:"flex-start" }}>
        <Ic n="info" c={ERR} s={16}/>
        <div style={{ fontSize:12, color:t.text, lineHeight:1.6 }}>{error}</div>
      </div>}

      {messages.length<=2&&!busy&&<div style={{ marginTop:8 }}>
        <div style={{ fontSize:12, color:t.sub, fontWeight:600, marginBottom:10 }}>Suggested questions</div>
        <div style={{ display:"flex", flexWrap:"wrap" as const, gap:8 }}>
          {SUGGESTIONS.map(q=><button key={q} onClick={()=>send(q)} style={{ padding:"9px 15px", borderRadius:999, border:`1px solid ${t.strokeS}`, background:t.card, backdropFilter:t.blur, WebkitBackdropFilter:t.blur, color:t.brand, fontSize:12, fontWeight:600, cursor:"pointer", textAlign:"left" as const, lineHeight:1.4, fontFamily:"inherit" }}>{q}</button>)}
        </div>
      </div>}
    </div>

    <div style={{ background:t.card, backdropFilter:t.blur, WebkitBackdropFilter:t.blur, padding:"12px 16px 16px", borderTop:`1px solid ${t.border}`, flexShrink:0 }}>
      <div id="tut-learn-input" style={{ display:"flex", gap:10, alignItems:"center", background:t.inputBg, backdropFilter:t.blur, WebkitBackdropFilter:t.blur, borderRadius:999, padding:"8px 8px 8px 16px", border:`1px solid ${t.strokeS}` }}>
        <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&send(input)} disabled={busy} placeholder={busy?"Thinking…":"Ask a question..."} style={{ flex:1, border:"none", outline:"none", fontSize:16, color:t.text, background:"transparent", fontFamily:"inherit" }}/>
        <button onClick={()=>send(input)} disabled={busy||!input.trim()} style={{ width:36, height:36, borderRadius:999, background:`linear-gradient(135deg,${GR},${GRD})`, border:"none", display:"flex", alignItems:"center", justifyContent:"center", cursor:busy?"default":"pointer", flexShrink:0, opacity:(busy||!input.trim())?0.45:1, boxShadow:`0 6px 16px ${GR}45`, transition:"opacity 0.2s" }}><Ic n="send" c="white" s={16}/></button>
      </div>
    </div>
  </div>
}

// ─── LessonScreen ─────────────────────────────────────────────────────────────
function LessonScreen({ nav }: { nav:(s:Screen)=>void }) {
  const { t } = useT()
  const [selected, setSelected] = useState<number|null>(null)
  const [revealed, setRevealed] = useState(false)
  const [completed, setCompleted] = useState(false)
  const correctIdx=1, options=["EGP 800","EGP 1,000","EGP 400","EGP 2,000"]
  return <div style={{ background:"transparent", minHeight:"100%" }}>
    <div style={{ background:t.card, backdropFilter:t.blur, WebkitBackdropFilter:t.blur, borderBottom:`1px solid ${t.stroke}`, padding:"0 20px 16px", paddingTop:`calc(12px + var(--safe-top, 0px))` }}>
      <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:14 }}>
        <button onClick={()=>nav("learn")} style={{ width:36, height:36, borderRadius:22, background:t.chip, backdropFilter:t.blur, WebkitBackdropFilter:t.blur, display:"flex", alignItems:"center", justifyContent:"center", border:"none", cursor:"pointer", flexShrink:0 }}><Ic n="left" c={t.text} s={18}/></button>
        <div style={{ flex:1 }}><div style={{ fontSize:11, color:t.sub, fontWeight:600 }}>Lesson 4 of 15</div></div>
        <div style={{ fontSize:12, color:t.sub, fontWeight:600 }}>4 min</div>
      </div>
      <Bar pct={60} color={GR} h={4} trackColor={t.track}/>
    </div>
    <div style={{ padding:"20px 16px 28px" }}>
      <div style={{ marginBottom:20, animation:"fadeUp 0.4s ease-out" }}>
        <div style={{ display:"inline-flex", alignItems:"center", gap:6, background:t.dm?`${GR}20`:GRL, borderRadius:20, padding:"5px 12px", marginBottom:12 }}><Ic n="trending" c={t.brand} s={14}/><span style={{ fontSize:11, fontWeight:700, color:t.brand }}>Investing</span></div>
        <div style={{ fontSize:22, fontWeight:800, color:t.text, lineHeight:1.2, marginBottom:8 }}>How Does Interest Work?</div>
        <div style={{ fontSize:14, color:t.sub, lineHeight:1.6 }}>Interest is the extra money the bank pays you for letting them use your savings. The more you save and the longer you wait, the more you earn.</div>
      </div>
      <div style={{ background:`linear-gradient(135deg,${GRD},#0B5D3B)`, borderRadius:18, padding:"20px", marginBottom:16, color:"white", position:"relative", overflow:"hidden" }}>
        <div style={{ position:"absolute", top:-30, right:-30, width:100, height:100, borderRadius:"50%", background:`${GD}25` }}/>
        <div style={{ fontSize:12, color:"rgba(255,255,255,0.55)", marginBottom:16 }}>Example · Premium Certificate at 25%</div>
        <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:14 }}>
          <div><div style={{ fontSize:11, color:"rgba(255,255,255,0.45)" }}>You invest</div><div style={{ fontSize:24, fontWeight:800 }}>EGP 10,000</div></div>
          <div style={{ fontSize:28, opacity:0.5 }}>→</div>
          <div><div style={{ fontSize:11, color:"rgba(255,255,255,0.45)" }}>After 1 year</div><div style={{ fontSize:24, fontWeight:800, color:t.gold }}>EGP 12,500</div></div>
        </div>
        <div style={{ background:"rgba(255,255,255,0.08)", borderRadius:10, padding:"10px 14px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <span style={{ fontSize:13, color:"rgba(255,255,255,0.6)" }}>Your profit</span>
          <span style={{ fontSize:16, fontWeight:800, color:t.gold }}>+EGP 2,500</span>
        </div>
      </div>
      <div style={{ background:t.card, backdropFilter:t.blur, WebkitBackdropFilter:t.blur, border:`1px solid ${t.stroke}`, borderRadius:20, padding:"16px", marginBottom:16, boxShadow:`0 1px 5px rgba(0,0,0,${t.dm?0.2:0.05})` }}>
        <div style={{ fontSize:13, fontWeight:700, color:t.text, marginBottom:12 }}>Key Takeaways</div>
        {["Interest is extra money the bank pays you for your savings.","Your rate is fixed and guaranteed from day one.","The longer you invest, the more interest you earn."].map((pt,i)=>(
          <div key={i} style={{ display:"flex", gap:10, alignItems:"flex-start", marginBottom:i<2?10:0 }}>
            <div style={{ width:22, height:22, borderRadius:11, background:t.dm?`${GR}22`:GRL, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, marginTop:1 }}><Ic n="check" c={t.brand} s={12}/></div>
            <span style={{ fontSize:13, color:t.text, lineHeight:1.6 }}>{pt}</span>
          </div>
        ))}
      </div>
      <div style={{ background:t.card, backdropFilter:t.blur, WebkitBackdropFilter:t.blur, border:`1px solid ${t.stroke}`, borderRadius:20, padding:"18px", boxShadow:`0 1px 5px rgba(0,0,0,${t.dm?0.2:0.05})`, marginBottom:completed?12:0 }}>
        <div style={{ display:"inline-flex", alignItems:"center", gap:6, background:t.dm?`${GR}20`:GRL, borderRadius:10, padding:"5px 10px", marginBottom:14 }}><Ic n="award" c={t.brand} s={13}/><span style={{ fontSize:11, fontWeight:800, color:t.brand }}>Quick Check</span></div>
        <div style={{ fontSize:14, fontWeight:700, color:t.text, lineHeight:1.4, marginBottom:16 }}>If you invest EGP 4,000 at 25% interest per year, how much interest do you earn?</div>
        <div style={{ display:"flex", flexDirection:"column", gap:9, marginBottom:16 }}>
          {options.map((opt,i)=>{
            const isSel=selected===i,isCorrect=i===correctIdx
            let bg=t.card,border=`1.5px solid ${t.border}`,color=t.text
            if(revealed){if(isCorrect){bg=t.dm?`${GR}22`:GRL;border=`1.5px solid ${GR}`;color=GR}else if(isSel){bg="#FEF2F2";border="1.5px solid #F87171";color=ERR}else{color=t.sub}}
            else if(isSel){bg=`${GR}0E`;border=`1.5px solid ${GR}`;color=GR}
            return <button key={i} onClick={()=>!revealed&&setSelected(i)} style={{ padding:"12px 16px", borderRadius:999, border, background:bg, color, fontSize:14, fontWeight:600, cursor:revealed?"default":"pointer", textAlign:"left" as const, display:"flex", justifyContent:"space-between", alignItems:"center", transition:"all 0.2s", animation:revealed&&isCorrect?"correctPulse 0.6s ease-out":"none" }}>
              <span>{String.fromCharCode(65+i)}. {opt}</span>
              {revealed&&isCorrect&&<Ic n="check" c={t.brand} s={16}/>}
              {revealed&&isSel&&!isCorrect&&<Ic n="x" c={ERR} s={16}/>}
            </button>
          })}
        </div>
        {selected!==null&&!revealed&&<button onClick={()=>setRevealed(true)} style={{ width:"100%", padding:"13px", borderRadius:999, border:"none", background:`linear-gradient(135deg,${GR},${GRD})`, color:"white", fontSize:14, fontWeight:700, cursor:"pointer" }}>Check Answer</button>}
        {revealed&&<div style={{ background:selected===correctIdx?t.dm?`${GR}22`:GRL:"#FEF2F2", borderRadius:12, padding:"12px 14px", animation:"popIn 0.3s ease-out" }}>
          <div style={{ fontSize:13, color:selected===correctIdx?GR:ERR, fontWeight:700, marginBottom:4 }}>{selected===correctIdx?"Correct!":"The correct answer is EGP 1,000"}</div>
          <div style={{ fontSize:12, color:t.text, lineHeight:1.6 }}>EGP 4,000 × 25% = EGP 1,000 interest. You would have EGP 5,000 total after 1 year.</div>
        </div>}
      </div>
      {revealed&&!completed&&<div style={{ marginTop:14, animation:"fadeUp 0.4s ease-out" }}>
        <button onClick={()=>{setCompleted(true);setTimeout(()=>nav("learn"),1600)}} style={{ width:"100%", padding:"15px", borderRadius:999, border:"none", background:`linear-gradient(135deg,${GR},${GRD})`, color:"white", fontSize:15, fontWeight:700, cursor:"pointer", boxShadow:`0 6px 20px ${GR}45` }}>Mark as Complete · +50 pts</button>
      </div>}
      {completed&&<div style={{ marginTop:14, background:t.dm?`${GR}22`:GRL, borderRadius:16, padding:"20px", textAlign:"center" as const, animation:"popIn 0.4s ease-out", border:`1px solid ${GR}40` }}>
        <Ic n="award" c={t.gold} s={32}/><div style={{ fontSize:16, fontWeight:800, color:t.brand, marginTop:8 }}>Lesson Complete!</div>
        <div style={{ fontSize:13, color:t.sub, marginTop:4 }}>+50 points added to your rewards</div>
      </div>}
    </div>
  </div>
}

// ─── GoalsScreen ─────────────────────────────────────────────────────────────
function GoalForm({ title, initial, onSave, onCancel, saveLabel="Save Goal" }: {
  title:string; initial:{name:string;budget:string;start:string;end:string};
  onSave:(v:{name:string;budget:string;start:string;end:string})=>void;
  onCancel:()=>void; saveLabel?:string
}) {
  const { t } = useT()
  const [form, setForm] = useState(initial)
  const fields = [
    {key:"name"  as const, label:"Goal Name",           placeholder:'e.g. "Buy a Laptop"', icon:"tag",      type:"text", hint:"What do you want to achieve?"},
    {key:"budget"as const, label:"Budget (Target Amount)",placeholder:"e.g. EGP 30,000",  icon:"wallet",   type:"text", hint:"How much does it cost?"},
    {key:"start" as const, label:"Start Date",           placeholder:"",                   icon:"calendar", type:"date", hint:"When do you start saving?"},
    {key:"end"   as const, label:"End Date (Deadline)",  placeholder:"",                   icon:"calendar", type:"date", hint:"When do you want to reach your goal?"},
  ]
  return <div style={{ background:"transparent", minHeight:"100%" }}>
    <div style={{ background:t.card, backdropFilter:t.blur, WebkitBackdropFilter:t.blur, borderBottom:`1px solid ${t.stroke}`, padding:"0 20px 16px", paddingTop:`calc(14px + var(--safe-top, 0px))` }}>
      <div style={{ display:"flex", alignItems:"center", gap:12 }}>
        <button onClick={onCancel} style={{ width:36, height:36, borderRadius:22, background:t.chip, backdropFilter:t.blur, WebkitBackdropFilter:t.blur, display:"flex", alignItems:"center", justifyContent:"center", border:"none", cursor:"pointer", flexShrink:0 }}><Ic n="left" c={t.text} s={18}/></button>
        <div style={{ fontSize:17, fontWeight:800, color:t.text }}>{title}</div>
      </div>
    </div>
    <div style={{ padding:"16px" }}>
      <div style={{ background:t.card, backdropFilter:t.blur, WebkitBackdropFilter:t.blur, border:`1px solid ${t.stroke}`, borderRadius:20, padding:"18px", boxShadow:`0 1px 8px rgba(0,0,0,${t.dm?0.2:0.06})`, marginBottom:14 }}>
        {fields.map((f,i)=>(
          <div key={f.key} style={{ marginBottom:i<fields.length-1?14:0 }}>
            <div style={{ fontSize:12, fontWeight:700, color:t.sub, marginBottom:2 }}>{f.label}</div>
            <div style={{ fontSize:11, color:t.sub, opacity:0.7, marginBottom:6 }}>{f.hint}</div>
            <div style={{ display:"flex", alignItems:"center", gap:10, border:`1.5px solid ${t.border}`, borderRadius:999, padding:"11px 16px", background:t.inputBg, backdropFilter:t.blur, WebkitBackdropFilter:t.blur }}>
              <Ic n={f.icon} c={t.sub} s={16}/>
              <input type={f.type} placeholder={f.placeholder} value={form[f.key]} onChange={e=>setForm(p=>({...p,[f.key]:e.target.value}))} style={{ flex:1, border:"none", outline:"none", fontSize:16, color:t.text, background:"transparent", fontFamily:"inherit" }}/>
            </div>
          </div>
        ))}
      </div>
      <button onClick={()=>form.name.trim()&&onSave(form)} style={{ width:"100%", padding:"15px", borderRadius:999, border:"none", background:`linear-gradient(135deg,${GR},${GRD})`, color:"white", fontSize:15, fontWeight:700, cursor:form.name.trim()?"pointer":"default", boxShadow:`0 6px 18px ${GR}40`, opacity:form.name.trim()?1:0.5 }}>{saveLabel}</button>
    </div>
  </div>
}

function GoalsScreen({ userGoals, setUserGoals, builtinActive, setBuiltinActive, homeCardGoalId, setHomeCardGoalId }: {
  userGoals:GoalEntry[];
  setUserGoals:React.Dispatch<React.SetStateAction<GoalEntry[]>>;
  builtinActive:boolean[];
  setBuiltinActive:React.Dispatch<React.SetStateAction<boolean[]>>;
  homeCardGoalId:string|null;
  setHomeCardGoalId:(id:string|null)=>void;
}) {
  const { t, lang } = useT()
  const [view, setView] = useState<"list"|"addForm"|"editForm"|"goalDetail">("list")
  const [detailIdx, setDetailIdx] = useState(0)
  const [editingId, setEditingId] = useState<string>("")
  const track = t.dm?"#1E3D2C":"#E5E7EB"
  const { profile, holdings } = useApp()
  const goalCtx: GoalCtx = { profile, holdings, goalCount: userGoals.length }
  const BUILTINS = BUILTIN_GOALS.map(g => evalBuiltin(g, goalCtx))
  const investedTotal = holdings.reduce((n,h)=>n+h.amount, 0)
  /** Same rule as the Home card: money committed, measured against the target. */
  const goalMoney = (g:GoalEntry) => {
    const target = parseInt((g.budget||"").replace(/\D/g,"")) || 0
    const saved = target ? Math.min(investedTotal, target) : investedTotal
    return { target, saved, pct: target ? Math.min(100, Math.round(saved/target*100)) : 0 }
  }

  const getAllDisplayGoals = (uGoals:GoalEntry[], bActive:boolean[]): GoalEntry[] => [
    ...uGoals,
    ...BUILTINS.filter((_,i)=>bActive[i]).map(g=>({ id:`builtin-${BUILTINS.indexOf(g)}`, name:g.title, budget:"", start:"", end:"", type:"builtin" as const, pct:g.pct }))
  ]

  const activateBuiltin = (i:number) => {
    setBuiltinActive(p=>p.map((v,j)=>j===i?true:v))
    if (!homeCardGoalId) setHomeCardGoalId(`builtin-${i}`)
  }
  const deactivateBuiltin = (i:number) => {
    setBuiltinActive(p => p.map((v,j)=>j===i?false:v))
    if (homeCardGoalId === `builtin-${i}`) {
      const remaining = getAllDisplayGoals(userGoals, builtinActive.map((v,j)=>j===i?false:v))
      setHomeCardGoalId(remaining.length > 0 ? remaining[0].id : null)
    }
  }
  const deleteUserGoal = (g:GoalEntry) => {
    setUserGoals(p => p.filter(x => x.id !== g.id))
    if (homeCardGoalId === g.id) {
      const remaining = getAllDisplayGoals(userGoals.filter(x=>x.id!==g.id), builtinActive)
      setHomeCardGoalId(remaining.length > 0 ? remaining[0].id : null)
    }
  }
  const saveEdit = (vals:{name:string;budget:string;start:string;end:string}) => {
    setUserGoals(p => p.map(x => x.id===editingId ? {...x,...vals} : x))
    setView("list")
  }

  // ── Goal detail view (built-in) ──
  if (view==="goalDetail") {
    const ag = BUILTINS[detailIdx]
    const isActive = builtinActive[detailIdx]
    const donePct = Math.round(ag.steps.filter(s=>s.done).length/ag.steps.length*100)
    return <div style={{ background:"transparent", minHeight:"100%" }}>
      <div style={{ background:t.card, backdropFilter:t.blur, WebkitBackdropFilter:t.blur, borderBottom:`1px solid ${t.stroke}`, padding:"0 20px 16px", paddingTop:`calc(14px + var(--safe-top, 0px))` }}>
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          <button onClick={()=>setView("list")} style={{ width:36, height:36, borderRadius:22, background:t.chip, backdropFilter:t.blur, WebkitBackdropFilter:t.blur, display:"flex", alignItems:"center", justifyContent:"center", border:"none", cursor:"pointer", flexShrink:0 }}><Ic n="left" c={t.text} s={18}/></button>
          <div style={{ fontSize:17, fontWeight:800, color:t.text }}>{ag.title}</div>
        </div>
      </div>
      <div style={{ padding:"14px 16px 28px" }}>
        <div style={{ background:`linear-gradient(135deg,${ag.color},${ag.color}AA)`, borderRadius:18, padding:"20px", marginBottom:14, color:"white", display:"flex", gap:14, alignItems:"center" }}>
          <div style={{ width:56, height:56, borderRadius:16, background:"rgba(255,255,255,0.15)", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}><Ic n={ag.icon} c="white" s={26}/></div>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:16, fontWeight:800 }}>{ag.title}</div>
            <div style={{ fontSize:12, color:"rgba(255,255,255,0.6)", marginTop:4 }}>{ag.steps.filter(s=>s.done).length} of {ag.steps.length} steps complete</div>
            <div style={{ marginTop:10 }}><Bar pct={donePct} color="white" h={4} trackColor="rgba(255,255,255,0.2)"/></div>
          </div>
        </div>
        <div style={{ background:t.card, backdropFilter:t.blur, WebkitBackdropFilter:t.blur, border:`1px solid ${t.stroke}`, borderRadius:20, padding:"16px", marginBottom:14, boxShadow:`0 1px 6px rgba(0,0,0,${t.dm?0.2:0.06})` }}>
          <div style={{ display:"grid", gridTemplateColumns:"minmax(0,1fr) minmax(0,1fr)", gap:12 }}>
            {[{label:"Goal Type",val:"Built-in",icon:"tag"},{label:"Status",val:isActive?"Active":"Inactive",icon:"refresh"}].map((item,i)=>(
              <div key={i} style={{ background:t.chip, backdropFilter:t.blur, WebkitBackdropFilter:t.blur, border:`1px solid ${t.stroke}`, borderRadius:12, padding:"12px" }}>
                <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:6 }}><Ic n={item.icon} c={t.sub} s={13}/><span style={{ fontSize:10, color:t.sub }}>{item.label}</span></div>
                <div style={{ fontSize:13, fontWeight:700, color:t.text }}>{item.val}</div>
              </div>
            ))}
          </div>
        </div>
        <div style={{ background:t.card, backdropFilter:t.blur, WebkitBackdropFilter:t.blur, border:`1px solid ${t.stroke}`, borderRadius:20, padding:"16px", marginBottom:16, boxShadow:`0 1px 6px rgba(0,0,0,${t.dm?0.2:0.06})` }}>
          <div style={{ fontSize:14, fontWeight:800, color:t.text, marginBottom:14 }}>Steps to Reach Your Goal</div>
          {ag.steps.map((step,j)=><div key={j} style={{ display:"flex", gap:12, alignItems:"flex-start", marginBottom:j<ag.steps.length-1?14:0, position:"relative" as const }}>
            {j<ag.steps.length-1&&<div style={{ position:"absolute", left:10, top:24, width:1, height:14, background:step.done?GR:track }}/>}
            <div style={{ width:22, height:22, borderRadius:11, background:step.done?GR:"transparent", border:step.done?"none":`1.5px solid ${track}`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, transition:"all 0.3s" }}>
              {step.done&&<Ic n="check" c="white" s={12}/>}
            </div>
            <div style={{ paddingTop:1 }}>
              <div style={{ fontSize:13, fontWeight:step.done?700:500, color:step.done?t.text:t.sub }}>{step.label}</div>
              {step.done&&<div style={{ fontSize:11, color:t.brand, marginTop:2, fontWeight:600 }}>Completed</div>}
            </div>
          </div>)}
        </div>
        {isActive
          ? <button onClick={()=>{ deactivateBuiltin(detailIdx); setView("list") }} style={{ width:"100%", padding:"14px", borderRadius:999, border:`1.5px solid ${ERR}`, background:"transparent", color:ERR, fontSize:14, fontWeight:700, cursor:"pointer" }}>Deactivate Goal</button>
          : <button onClick={()=>{ activateBuiltin(detailIdx); setView("list") }} style={{ width:"100%", padding:"14px", borderRadius:999, border:"none", background:`linear-gradient(135deg,${ag.color},${ag.color}BB)`, color:"white", fontSize:14, fontWeight:700, cursor:"pointer", boxShadow:`0 5px 16px ${ag.color}40` }}>Activate This Goal</button>
        }
      </div>
    </div>
  }

  // ── Add Goal form ──
  if (view==="addForm") {
    return <GoalForm
      title="Create a New Goal"
      initial={{name:"",budget:"",start:"",end:""}}
      saveLabel="Create Goal"
      onCancel={()=>setView("list")}
      onSave={vals=>{
        const newGoal:GoalEntry = { id: newLocalId(), ...vals, type:"user" }
        setUserGoals(p=>[...p, newGoal])
        if (!homeCardGoalId) setHomeCardGoalId(newGoal.id)
        setView("list")
      }}
    />
  }

  // ── Edit Goal form ──
  if (view==="editForm" && editingId) {
    const g = userGoals.find(x=>x.id===editingId)
    if (!g) { setView("list"); return null }
    return <GoalForm
      title="Edit Goal"
      initial={{name:g.name,budget:g.budget,start:g.start,end:g.end}}
      saveLabel="Save Changes"
      onCancel={()=>setView("list")}
      onSave={saveEdit}
    />
  }

  // ── Goal list ──
  const activeBuiltins  = BUILTIN_GOALS.filter((_,i)=>builtinActive[i])
  const inactiveBuiltins = BUILTIN_GOALS.filter((_,i)=>!builtinActive[i])

  return <div style={{ background:"transparent", minHeight:"100%" }}>
    <div style={{ background:t.card, backdropFilter:t.blur, WebkitBackdropFilter:t.blur, borderBottom:`1px solid ${t.stroke}`, padding:"0 20px 18px", paddingTop:`calc(16px + var(--safe-top, 0px))`, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
      <div>
        <div style={{ fontSize:20, fontWeight:800, color:t.text }}>My Goals</div>
        <div style={{ fontSize:13, color:t.sub }}>Your financial journey, step by step</div>
      </div>
      <button id="tut-goals-add" onClick={()=>setView("addForm")} style={{ display:"flex", alignItems:"center", gap:6, padding:"9px 14px", borderRadius:999, border:"none", background:`linear-gradient(135deg,${GR},${GRD})`, color:"white", fontSize:12, fontWeight:700, cursor:"pointer", boxShadow:`0 4px 14px ${GR}40` }}>
        <Ic n="plus" c="white" s={14}/>{tx("add_goal",lang)}
      </button>
    </div>
    <div style={{ padding:"16px" }}>

      {/* Active built-in goals */}
      <div id="tut-goals-list"/>
      {activeBuiltins.length > 0 && <>
        <div style={{ fontSize:11, fontWeight:800, color:t.sub, letterSpacing:1.2, textTransform:"uppercase" as const, marginBottom:14 }}>Active Goals</div>
        {BUILTINS.map((g,i)=>!builtinActive[i]?null:(
          <div key={i} style={{ background:t.card, backdropFilter:t.blur, WebkitBackdropFilter:t.blur, border:`1px solid ${t.stroke}`, borderRadius:22, padding:"18px", marginBottom:16, boxShadow:`0 2px 12px rgba(0,0,0,${t.dm?0.22:0.07})` }}>
            <div style={{ display:"flex", gap:14, alignItems:"center", marginBottom:16 }}>
              <div style={{ position:"relative", flexShrink:0 }}>
                <Ring pct={g.pct} size={64} w={5} color={g.color}/>
                <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center" }}><Ic n={g.icon} c={g.color} s={22}/></div>
              </div>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:15, fontWeight:700, color:t.text, marginBottom:4 }}>{g.title}</div>
                <div style={{ fontSize:13, fontWeight:700, color:g.color }}>{g.pct}% complete</div>
                <div style={{ marginTop:8 }}><Bar pct={g.pct} color={g.color} h={4} trackColor={track}/></div>
              </div>
              <button onClick={()=>deactivateBuiltin(i)} style={{ padding:"6px 12px", borderRadius:999, border:`1.5px solid ${ERR}30`, background:`${ERR}08`, color:ERR, fontSize:11, fontWeight:700, cursor:"pointer", flexShrink:0 }}>Deactivate</button>
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              {g.steps.map((step,j)=><div key={j} style={{ display:"flex", gap:10, alignItems:"center" }}>
                <div style={{ width:22, height:22, borderRadius:11, background:step.done?GR:"transparent", border:step.done?"none":`1.5px solid ${track}`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                  {step.done&&<Ic n="check" c="white" s={12}/>}
                </div>
                <span style={{ fontSize:13, color:step.done?t.text:t.sub, fontWeight:step.done?600:400 }}>{step.label}</span>
              </div>)}
            </div>
          </div>
        ))}
      </>}

      {/* User goals */}
      {userGoals.length > 0 && (
        <div style={{ marginBottom:6 }}>
          <div style={{ fontSize:11, fontWeight:800, color:t.sub, letterSpacing:1.2, textTransform:"uppercase" as const, marginBottom:12 }}>Your Goals</div>
          {userGoals.map(g=>{
            const isSelected = homeCardGoalId === g.id
            return (
            <div key={g.id} style={{ background:t.card, backdropFilter:t.blur, WebkitBackdropFilter:t.blur, borderRadius:22, padding:"16px", marginBottom:14, boxShadow:`0 2px 10px rgba(0,0,0,${t.dm?0.2:0.06})`, border:`1.5px solid ${GR}`, animation:"fadeUp 0.3s ease-out" }}>
              <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:12 }}>
                <div style={{ width:44, height:44, borderRadius:13, background:`${GR}14`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}><Ic n="target" c={t.brand} s={22}/></div>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:15, fontWeight:700, color:t.text, whiteSpace:"nowrap" as const, overflow:"hidden", textOverflow:"ellipsis" }}>{g.name}</div>
                  <div style={{ fontSize:12, color:t.sub, marginTop:2 }}>Budget: {g.budget||"—"}</div>
                </div>
                <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:6 }}>
                  <div style={{ fontSize:10, fontWeight:800, color:t.brand, background:`${GR}14`, padding:"3px 10px", borderRadius:999 }}>● ACTIVE</div>
                  <div style={{ display:"flex", gap:6 }}>
                    <button onClick={()=>{ setEditingId(g.id); setView("editForm") }} style={{ padding:"4px 10px", borderRadius:999, border:`1.5px solid ${GR}40`, background:`${GR}10`, color:t.brand, fontSize:11, fontWeight:700, cursor:"pointer" }}>Edit</button>
                    <button onClick={()=>deleteUserGoal(g)} style={{ padding:"4px 10px", borderRadius:999, border:`1.5px solid ${ERR}40`, background:`${ERR}08`, color:ERR, fontSize:11, fontWeight:700, cursor:"pointer" }}>Delete</button>
                  </div>
                </div>
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"minmax(0,1fr) minmax(0,1fr)", gap:8, marginBottom:12 }}>
                <div style={{ background:t.chip, backdropFilter:t.blur, WebkitBackdropFilter:t.blur, border:`1px solid ${t.stroke}`, borderRadius:10, padding:"8px 10px" }}>
                  <div style={{ fontSize:10, color:t.sub }}>Start Date</div>
                  <div style={{ fontSize:12, fontWeight:600, color:t.text, marginTop:2 }}>{g.start||"—"}</div>
                </div>
                <div style={{ background:t.chip, backdropFilter:t.blur, WebkitBackdropFilter:t.blur, border:`1px solid ${t.stroke}`, borderRadius:10, padding:"8px 10px" }}>
                  <div style={{ fontSize:10, color:t.sub }}>End Date</div>
                  <div style={{ fontSize:12, fontWeight:600, color:t.text, marginTop:2 }}>{g.end||"—"}</div>
                </div>
              </div>
              <Bar pct={goalMoney(g).pct} color={GR} h={4} trackColor={track}/>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:10 }}>
                <div style={{ fontSize:11, color:t.sub }}>
                  {goalMoney(g).target
                    ? `EGP ${goalMoney(g).saved.toLocaleString()} of ${goalMoney(g).target.toLocaleString()} invested · ${goalMoney(g).pct}%`
                    : `EGP ${investedTotal.toLocaleString()} invested · no target set`}
                </div>
                <button onClick={()=>setHomeCardGoalId(g.id)} style={{ padding:"5px 12px", borderRadius:999, border:`1.5px solid ${isSelected?GR:t.border}`, background:isSelected?`${GR}14`:"transparent", color:isSelected?GR:t.sub, fontSize:11, fontWeight:700, cursor:"pointer", transition:"all 0.2s" }}>
                  {isSelected ? "✓ Shown on Home" : "Show on Home"}
                </button>
              </div>
            </div>
          )})}
        </div>
      )}

      {/* Inactive built-in goals */}
      {inactiveBuiltins.length > 0 && <>
        <div style={{ fontSize:11, fontWeight:800, color:t.sub, letterSpacing:1.2, textTransform:"uppercase" as const, marginBottom:14 }}>Available Goals</div>
        {BUILTINS.map((g,i)=>builtinActive[i]?null:(
          <div key={i} style={{ background:t.card, backdropFilter:t.blur, WebkitBackdropFilter:t.blur, border:`1px solid ${t.stroke}`, borderRadius:18, padding:"14px 16px", marginBottom:10, display:"flex", alignItems:"center", gap:14, boxShadow:`0 1px 5px rgba(0,0,0,${t.dm?0.18:0.05})` }}>
            <div style={{ width:46, height:46, borderRadius:13, background:`${g.color}${t.dm?"22":"14"}`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}><Ic n={g.icon} c={g.color} s={22}/></div>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:14, fontWeight:600, color:t.text }}>{g.title}</div>
              <div style={{ fontSize:12, color:t.sub, marginTop:2 }}>{g.steps.length} steps · Inactive</div>
            </div>
            <div style={{ display:"flex", gap:6, flexShrink:0 }}>
              <button onClick={()=>{ setDetailIdx(i); setView("goalDetail") }} style={{ padding:"8px 14px", borderRadius:999, border:`1.5px solid ${t.border}`, background:"transparent", color:t.sub, fontSize:12, fontWeight:600, cursor:"pointer" }}>Details</button>
              <button onClick={()=>activateBuiltin(i)} style={{ padding:"8px 14px", borderRadius:999, border:"none", background:`linear-gradient(135deg,${g.color},${g.color}BB)`, color:"white", fontSize:12, fontWeight:700, cursor:"pointer" }}>Activate</button>
            </div>
          </div>
        ))}
      </>}
    </div>
  </div>
}

// ─── RewardsScreen — earn/redeem/benefit focus, no lesson/streak sections ─────
function RewardsScreen() {
  const { t } = useT()
  const { profile, holdings } = useApp()
  const redeemOptions=[{pts:100,benefit:"EGP 10 Cashback",icon:"wallet",color:GR},{pts:500,benefit:"EGP 50 Cashback",icon:"gift",color:t.brand},{pts:1000,benefit:"Partner Discount",icon:"award",color:GD}]
  const partners=[{name:"Carrefour",offer:"5% off groceries",tag:"Cashback",icon:"tag"},{name:"B.TECH",offer:"EGP 200 voucher",tag:"Voucher",icon:"credit"},{name:"Fawry",offer:"Zero transfer fees",tag:"Offer",icon:"send"},{name:"Uber Egypt",offer:"3 free rides",tag:"Reward",icon:"refresh"}]
  const activities = holdings.length
    ? holdings.slice(0,4).map(h=>({
        label:`Subscribed to ${h.productName}`,
        pts:`+${PTS_INVEST} pts`,
        icon: h.kind==="fund" ? "trending" : "shield",
      }))
    : [{label:"No activity yet — set a goal or make your first investment", pts:"", icon:"info"}]
  const invested = holdings.reduce((n,h)=>n+h.amount, 0)
  const badges=[
    {name:"First Goal",       icon:"target",   earned: !!profile?.flags?.firstGoalSet},
    {name:"First Investment", icon:"trending", earned: holdings.length > 0},
    {name:"Saver Pro",        icon:"wallet",   earned: invested >= 25000},
    {name:"Diversified",      icon:"shield",   earned: holdings.some(h=>h.kind==="certificate") && holdings.some(h=>h.kind==="fund")},
  ]

  const stats = profile?.stats ?? { points:0, level:1, streakDays:0 }
  const prog = progression(stats.points)
  const [redeemNote, setRedeemNote] = useState(false)

  return <div style={{ background:"transparent", minHeight:"100%" }}>
    {/* Hero */}
    <div style={{ background:`linear-gradient(135deg,${GRD},#0B5D3B)`, padding:"0 20px 24px", paddingTop:"calc(20px + var(--safe-top, 0px))", color:"white" }}>
      <div style={{ fontSize:20, fontWeight:800, marginBottom:20 }}>My Rewards</div>
      <div id="tut-rewards-points" style={{ display:"flex", alignItems:"center", gap:16, marginBottom:16 }}>
        <div style={{ width:62, height:62, borderRadius:31, background:GD, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, boxShadow:`0 6px 20px ${GD}60` }}><Ic n="award" c="white" s={28}/></div>
        <div><div style={{ fontSize:36, fontWeight:800, lineHeight:1 }}>{stats.points.toLocaleString()}</div><div style={{ fontSize:13, color:"rgba(255,255,255,0.55)", marginTop:4 }}>Total Points</div></div>
        <div style={{ marginLeft:"auto", textAlign:"right" as const }}>
          <div style={{ fontSize:10, fontWeight:800, color:t.gold, letterSpacing:1.8 }}>LEVEL {prog.level}</div>
          <div style={{ fontSize:14, fontWeight:700, marginTop:3 }}>{prog.name}</div>
          <div style={{ fontSize:11, color:"rgba(255,255,255,0.4)", marginTop:2 }}>{prog.maxed ? "Top level reached" : `${prog.toNext.toLocaleString()} pts to Level ${prog.level+1}`}</div>
        </div>
      </div>
      <div style={{ display:"flex", justifyContent:"space-between", fontSize:10, color:"rgba(255,255,255,0.38)", marginBottom:5 }}><span>Level {prog.level}</span><span>{prog.maxed ? "Max" : `Level ${prog.level+1} · ${prog.nextAt.toLocaleString()} pts`}</span></div>
      <div style={{ height:6, background:"rgba(255,255,255,0.1)", borderRadius:4, overflow:"hidden", marginBottom:16 }}><div style={{ width:`${prog.pct}%`, height:6, background:`linear-gradient(90deg,${GD},${GDS})`, borderRadius:4, transition:"width 0.5s ease" }}/></div>
      {redeemNote && <div style={{ background:"rgba(255,255,255,0.1)", border:"1px solid rgba(255,255,255,0.16)", borderRadius:14, padding:"12px 14px", marginBottom:12, fontSize:11.5, color:"rgba(255,255,255,0.75)", lineHeight:1.6 }}>
        Redemption is not part of this demo — points and cashback are tracked, but nothing is paid out.
      </div>}
      {/* Cashback CTA */}
      <div style={{ background:"rgba(255,255,255,0.08)", borderRadius:14, padding:"14px 16px", display:"flex", justifyContent:"space-between", alignItems:"center", border:"1px solid rgba(255,255,255,0.1)" }}>
        <div>
          <div style={{ fontSize:12, color:"rgba(255,255,255,0.6)", marginBottom:4 }}>Redeem your points for cashback, discounts and rewards.</div>
          <div style={{ fontSize:11, color:"rgba(255,255,255,0.45)" }}>Available Cashback</div>
          <div style={{ fontSize:28, fontWeight:800, color:t.gold }}>EGP {prog.cashback.toLocaleString()}</div>
        </div>
        <button id="tut-rewards-redeem" onClick={()=>setRedeemNote(true)} disabled={stats.points < redeemOptions[0].pts}
          style={{ padding:"12px 18px", borderRadius:999, background:stats.points < redeemOptions[0].pts ? "rgba(255,255,255,0.14)" : GD, color:stats.points < redeemOptions[0].pts ? "rgba(255,255,255,0.5)" : "white", border:"none", fontSize:13, fontWeight:700, cursor:stats.points < redeemOptions[0].pts ? "default" : "pointer", flexShrink:0 }}>
          {stats.points < redeemOptions[0].pts ? `${redeemOptions[0].pts - stats.points} pts to go` : "Redeem Points"}
        </button>
      </div>
    </div>

    <div style={{ padding:"16px" }}>
      {/* How it works */}
      <div style={{ background:t.card, backdropFilter:t.blur, WebkitBackdropFilter:t.blur, border:`1px solid ${t.stroke}`, borderRadius:20, padding:"16px", marginBottom:16, boxShadow:`0 1px 6px rgba(0,0,0,${t.dm?0.2:0.06})` }}>
        <div style={{ fontSize:12, fontWeight:800, color:t.sub, letterSpacing:1.2, textTransform:"uppercase" as const, marginBottom:14 }}>How It Works</div>
        <div style={{ display:"flex", alignItems:"center" }}>
          {([{icon:"trending",label:"Earn Points",sub:"Complete lessons & invest"},{icon:"award",label:"Redeem Points",sub:"Choose your reward"},{icon:"gift",label:"Get Benefits",sub:"Cashback & discounts"}]).map((s,i)=>(
            <div key={i} style={{ display:"flex", alignItems:"center", gap:8, flex:i<2?undefined:1 }}>
              <div style={{ flex:1, textAlign:"center" as const }}>
                <div style={{ width:40, height:40, borderRadius:20, background:i===1?`${GD}14`:`${GR}14`, display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 6px" }}><Ic n={s.icon} c={i===1?GD:GR} s={20}/></div>
                <div style={{ fontSize:11, fontWeight:700, color:t.text }}>{s.label}</div>
                <div style={{ fontSize:10, color:t.sub, marginTop:2 }}>{s.sub}</div>
              </div>
              {i<2&&<div style={{ fontSize:16, color:t.border, fontWeight:800, flexShrink:0, paddingBottom:16 }}>→</div>}
            </div>
          ))}
        </div>
      </div>

      {/* Redeem points */}
      <div style={{ fontSize:11, fontWeight:800, color:t.sub, letterSpacing:1.2, textTransform:"uppercase" as const, marginBottom:12 }}>Redeem Points</div>
      <div style={{ display:"flex", gap:10, marginBottom:18 }}>
        {redeemOptions.map((r,i)=><div key={i} style={{ flex:1, background:t.card, backdropFilter:t.blur, WebkitBackdropFilter:t.blur, borderRadius:18, padding:"14px 10px", display:"flex", flexDirection:"column", alignItems:"center", gap:8, boxShadow:`0 1px 5px rgba(0,0,0,${t.dm?0.2:0.06})`, border:`1px solid ${r.color}18` }}>
          <div style={{ width:40, height:40, borderRadius:20, background:`${r.color}18`, display:"flex", alignItems:"center", justifyContent:"center" }}><Ic n={r.icon} c={r.color} s={20}/></div>
          <div style={{ fontSize:16, fontWeight:800, color:r.color }}>{r.pts}</div>
          <div style={{ fontSize:10, color:t.sub }}>points</div>
          <div style={{ fontSize:11, fontWeight:700, color:t.text, textAlign:"center" as const, lineHeight:1.3 }}>{r.benefit}</div>
        </div>)}
      </div>

      {/* Partner Rewards */}
      <div style={{ fontSize:11, fontWeight:800, color:t.sub, letterSpacing:1.2, textTransform:"uppercase" as const, marginBottom:4 }}>Partner Rewards</div>
      <div style={{ fontSize:11, color:t.sub, marginBottom:12, lineHeight:1.6 }}>Examples of the kind of partner offer this programme would carry — none of these are live deals.</div>
      <div style={{ display:"grid", gridTemplateColumns:"minmax(0,1fr) minmax(0,1fr)", gap:10, marginBottom:18 }}>
        {partners.map((p,i)=><div key={i} style={{ background:t.card, backdropFilter:t.blur, WebkitBackdropFilter:t.blur, border:`1px solid ${t.stroke}`, borderRadius:18, padding:"14px", boxShadow:`0 1px 5px rgba(0,0,0,${t.dm?0.18:0.05})` }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:8 }}>
            <div style={{ width:36, height:36, borderRadius:10, background:t.dm?`${GR}20`:GRL, display:"flex", alignItems:"center", justifyContent:"center" }}><Ic n={p.icon} c={t.brand} s={18}/></div>
            <span style={{ fontSize:9, fontWeight:800, color:t.brand, background:t.dm?`${GR}20`:GRL, padding:"3px 7px", borderRadius:10 }}>{p.tag}</span>
          </div>
          <div style={{ fontSize:13, fontWeight:700, color:t.text }}>{p.name}</div>
          <div style={{ fontSize:11, color:t.sub, marginTop:3 }}>{p.offer}</div>
        </div>)}
      </div>

      {/* Achievements (secondary) */}
      <div style={{ fontSize:11, fontWeight:800, color:t.sub, letterSpacing:1.2, textTransform:"uppercase" as const, marginBottom:12 }}>Achievement Badges</div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4, minmax(0,1fr))", gap:10, marginBottom:18 }}>
        {badges.map((b,i)=><div key={i} style={{ background:t.card, backdropFilter:t.blur, WebkitBackdropFilter:t.blur, border:`1px solid ${t.stroke}`, borderRadius:18, padding:"12px 8px", display:"flex", flexDirection:"column", alignItems:"center", gap:6, boxShadow:`0 1px 4px rgba(0,0,0,${t.dm?0.18:0.05})`, opacity:b.earned?1:0.42 }}>
          <div style={{ width:38, height:38, borderRadius:19, background:b.earned?`${GD}22`:t.bg, display:"flex", alignItems:"center", justifyContent:"center" }}><Ic n={b.icon} c={b.earned?GD:t.sub} s={18}/></div>
          <div style={{ fontSize:9, fontWeight:600, color:t.text, textAlign:"center" as const, lineHeight:1.3 }}>{b.name}</div>
          {b.earned?<div style={{ width:16, height:16, borderRadius:8, background:t.dm?`${GR}22`:GRL, display:"flex", alignItems:"center", justifyContent:"center" }}><Ic n="check" c={t.brand} s={9}/></div>:<span style={{ fontSize:8, color:t.sub }}>Locked</span>}
        </div>)}
      </div>

      {/* Recent points */}
      <div style={{ fontSize:11, fontWeight:800, color:t.sub, letterSpacing:1.2, textTransform:"uppercase" as const, marginBottom:12 }}>Recent Points Earned</div>
      {activities.map((item,i)=><div key={i} style={{ background:t.card, backdropFilter:t.blur, WebkitBackdropFilter:t.blur, border:`1px solid ${t.stroke}`, borderRadius:16, padding:"12px 14px", display:"flex", alignItems:"center", gap:12, marginBottom:8, boxShadow:`0 1px 3px rgba(0,0,0,${t.dm?0.18:0.04})` }}>
        <div style={{ width:38, height:38, borderRadius:19, background:t.dm?`${GR}20`:GRL, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}><Ic n={item.icon} c={t.brand} s={18}/></div>
        <div style={{ flex:1 }}><div style={{ fontSize:13, color:t.text, lineHeight:1.4 }}>{item.label}</div></div>
        <div style={{ fontSize:13, fontWeight:800, color:t.brand, flexShrink:0 }}>{item.pts}</div>
      </div>)}
    </div>
  </div>
}

// ─── DailyReviewScreen ────────────────────────────────────────────────────────
function DailyReviewScreen({ nav }: { nav:(s:Screen)=>void }) {
  const { t } = useT()
  const { holdings, profile } = useApp()
  const today = new Date()
  const todayISO = localISO(today)
  const boughtToday = holdings.filter(h => h.purchasedAt === todayISO)
  const investedToday = boughtToday.reduce((n,h)=>n+h.amount, 0)
  const investedTotal = holdings.reduce((n,h)=>n+h.amount, 0)
  const spending = [
    { label:"Food & Drinks",   amt:180, icon:"gift",    color:GR  },
    { label:"Shopping",        amt:120, icon:"tag",     color:GD  },
    { label:"Transportation",  amt:80,  icon:"refresh", color:t.brand },
    { label:"Entertainment",   amt:70,  icon:"star",    color:"#7C3AED" },
  ]
  const totalSpent = spending.reduce((s,c)=>s+c.amt,0)
  const maxAmt = Math.max(...spending.map(c=>c.amt))
  const topCategory = spending.reduce((a,b)=>b.amt>a.amt?b:a).label

  return <div style={{ background:"transparent", minHeight:"100%" }}>
    {/* Header */}
    <div style={{ background:t.card, backdropFilter:t.blur, WebkitBackdropFilter:t.blur, borderBottom:`1px solid ${t.stroke}`, padding:"0 20px 16px", paddingTop:`calc(14px + var(--safe-top, 0px))` }}>
      <div style={{ display:"flex", alignItems:"center", gap:12 }}>
        <button onClick={()=>nav("home")} style={{ width:36, height:36, borderRadius:22, background:t.chip, backdropFilter:t.blur, WebkitBackdropFilter:t.blur, display:"flex", alignItems:"center", justifyContent:"center", border:"none", cursor:"pointer", flexShrink:0 }}><Ic n="left" c={t.text} s={18}/></button>
        <div>
          <div style={{ fontSize:18, fontWeight:800, color:t.text }}>Daily Review</div>
          <div style={{ fontSize:12, color:t.sub }}>{today.toLocaleDateString(undefined,{ weekday:"long", month:"long", day:"numeric" })}</div>
        </div>
      </div>
    </div>

    <div style={{ padding:"14px 16px 28px" }}>
      {/* Today's Activity summary */}
      <div style={{ fontSize:11, fontWeight:800, color:t.sub, letterSpacing:1.2, textTransform:"uppercase" as const, marginBottom:12 }}>{"Today's Activity"}</div>
      <div style={{ display:"grid", gridTemplateColumns:"minmax(0,1fr) minmax(0,1fr) minmax(0,1fr)", gap:10, marginBottom:18 }}>
        {[
          { label:"Spent today",    val:`EGP ${totalSpent}`,                    icon:"credit",   color:ERR  },
          { label:"Invested today", val:`EGP ${investedToday.toLocaleString()}`, icon:"shield",   color:GR   },
          { label:"Invested total", val:`EGP ${investedTotal.toLocaleString()}`, icon:"trending", color:GD   },
        ].map((s,i)=><div key={i} style={{ background:t.card, backdropFilter:t.blur, WebkitBackdropFilter:t.blur, borderRadius:18, padding:"14px 10px", display:"flex", flexDirection:"column", gap:8, boxShadow:`0 1px 5px rgba(0,0,0,${t.dm?0.2:0.06})`, border:`1px solid ${s.color}14` }}>
          <div style={{ width:34, height:34, borderRadius:10, background:`${s.color}14`, display:"flex", alignItems:"center", justifyContent:"center" }}><Ic n={s.icon} c={s.color} s={17}/></div>
          <div style={{ fontSize:13, fontWeight:800, color:s.color, lineHeight:1.1 }}>{s.val}</div>
          <div style={{ fontSize:10, color:t.sub, lineHeight:1.3 }}>{s.label}</div>
        </div>)}
      </div>

      <div style={{ display:"flex", gap:10, alignItems:"flex-start", background:`${GD}12`, border:`1px solid ${GD}30`, borderRadius:16, padding:"12px 14px", marginBottom:14 }}>
        <Ic n="info" c={t.gold} s={16}/>
        <div style={{ fontSize:11.5, color:t.sub, lineHeight:1.6 }}>
          Spending below is sample data. NBE Youth does not read your card transactions yet, so only the investment figures are yours.
        </div>
      </div>

      {/* Spending Breakdown */}
      <div style={{ background:t.card, backdropFilter:t.blur, WebkitBackdropFilter:t.blur, border:`1px solid ${t.stroke}`, borderRadius:20, padding:"16px", marginBottom:14, boxShadow:`0 1px 6px rgba(0,0,0,${t.dm?0.2:0.06})` }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
          <div style={{ fontSize:14, fontWeight:800, color:t.text }}>Where Your Money Went</div>
          <div style={{ fontSize:12, fontWeight:700, color:t.sub }}>EGP {totalSpent}</div>
        </div>
        {spending.map((c,i)=><div key={i} style={{ marginBottom:i<spending.length-1?14:0 }}>
          <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:7 }}>
            <div style={{ width:32, height:32, borderRadius:10, background:`${c.color}14`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}><Ic n={c.icon} c={c.color} s={16}/></div>
            <span style={{ flex:1, fontSize:13, fontWeight:600, color:t.text }}>{c.label}</span>
            <span style={{ fontSize:13, fontWeight:700, color:t.text }}>EGP {c.amt}</span>
          </div>
          <div style={{ height:7, borderRadius:4, background:t.dm?"#1E3D2C":"#E5E7EB", overflow:"hidden", marginLeft:42 }}>
            <div style={{ width:`${(c.amt/maxAmt)*100}%`, height:7, background:`linear-gradient(90deg,${c.color}99,${c.color})`, borderRadius:4, transition:"width 0.6s ease" }}/>
          </div>
        </div>)}
      </div>

      {/* Investment Activity */}
      <div style={{ background:t.card, backdropFilter:t.blur, WebkitBackdropFilter:t.blur, border:`1px solid ${t.stroke}`, borderRadius:20, padding:"16px", marginBottom:14, boxShadow:`0 1px 6px rgba(0,0,0,${t.dm?0.2:0.06})` }}>
        <div style={{ fontSize:14, fontWeight:800, color:t.text, marginBottom:14 }}>Investments</div>
        {boughtToday.length === 0
          ? <div style={{ background:t.chip, borderRadius:12, padding:"14px 16px", fontSize:12.5, color:t.sub, lineHeight:1.6, border:`1px solid ${t.stroke}` }}>
              Nothing invested today.{holdings.length > 0 ? ` You hold EGP ${investedTotal.toLocaleString()} across ${holdings.length} ${holdings.length===1?"product":"products"}.` : " The Invest tab is where you start."}
            </div>
          : boughtToday.map(h => {
              const pr = holdingProgress(h)
              return <div key={h.id} style={{ background:t.dm?`${GR}18`:GRLL, borderRadius:12, padding:"14px 16px", display:"flex", alignItems:"center", gap:14, border:`1px solid ${GR}20`, marginBottom:8 }}>
                <div style={{ width:44, height:44, borderRadius:13, background:`${GR}18`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}><Ic n={h.kind==="fund"?"trending":"shield"} c={t.brand} s={22}/></div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:16, fontWeight:800, color:t.text }}>EGP {h.amount.toLocaleString()}</div>
                  <div style={{ fontSize:12, color:t.sub, marginTop:2, whiteSpace:"nowrap" as const, overflow:"hidden", textOverflow:"ellipsis" }}>Invested Today · {h.productName}</div>
                </div>
                <div style={{ textAlign:"right" as const, flexShrink:0 }}>
                  <div style={{ fontSize:12, fontWeight:700, color:t.brand }}>+EGP {pr.totalProfit.toLocaleString()}</div>
                  <div style={{ fontSize:10, color:t.sub, marginTop:1 }}>{h.kind==="fund" ? "if the average holds" : "at maturity"}</div>
                </div>
              </div>
            })}
      </div>

      {/* Daily Insight */}
      <div style={{ background:`linear-gradient(135deg,${GRD},#0B5D3B)`, borderRadius:16, padding:"18px 16px", display:"flex", gap:14, alignItems:"flex-start" }}>
        <div style={{ width:40, height:40, borderRadius:20, background:"rgba(255,255,255,0.12)", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, marginTop:2 }}><Ic n="info" c="white" s={20}/></div>
        <div>
          <div style={{ fontSize:11, fontWeight:800, color:"rgba(255,255,255,0.55)", letterSpacing:1.2, textTransform:"uppercase" as const, marginBottom:6 }}>Your Daily Insight</div>
          <div style={{ fontSize:14, color:"white", lineHeight:1.65, fontWeight:500 }}>
            In the sample spending above, <span style={{ fontWeight:800, color:t.gold }}>{topCategory}</span> is the biggest slice.{" "}
            {investedToday > 0
              ? `You invested EGP ${investedToday.toLocaleString()} today — that money is now working for you.`
              : investedTotal > 0
                ? `You have EGP ${investedTotal.toLocaleString()} invested. Adding to it, even in small amounts, is what moves a goal.`
                : "You have not invested yet — the Invest tab explains certificates and funds in plain language."}
          </div>
        </div>
      </div>
    </div>
  </div>
}

// ─── NotificationsScreen ──────────────────────────────────────────────────────
function buildNotifs(holdings:HoldingDoc[], profile:UserProfile|null): Notif[] {
  return [
    ...(holdings.length === 0
      ? [{ id:1, type:"reminder" as NotifType, title:"Make your first investment", body:"You have not invested yet. The Invest tab walks you through certificates and funds in plain language.", time:"Now", read:false }]
      : holdings.slice(0,3).map((h,i)=>({
          id: 100+i,
          type: (h.kind === "fund" ? "growth" : "certificate") as NotifType,
          title: h.kind === "fund" ? `${h.productName} update` : `${h.productName} on track`,
          body: h.kind === "fund"
            ? `EGP ${h.amount.toLocaleString()} invested. Fund values move daily — the ~${h.rate}% figure is a historical average, not a promise.`
            : `EGP ${h.amount.toLocaleString()} at ${h.rate}% fixed${h.maturesAt ? `, maturing ${h.maturesAt}` : ""}. Projected profit: +EGP ${holdingProgress(h).totalProfit.toLocaleString()}.`,
          time: h.purchasedAt,
          read: i > 0,
        }))),
    ...(profile ? [{
      id:200, type:"growth" as NotifType, title:`${profile.stats.points.toLocaleString()} points earned`,
      body: `You are Level ${progression(profile.stats.points).level} — ${progression(profile.stats.points).name}. That converts to EGP ${progression(profile.stats.points).cashback.toLocaleString()} cashback in Rewards.`,
      time:"Today", read:false,
    }] : []),
    ...(profile && !profile.flags.firstGoalSet ? [{
      id:201, type:"reminder" as NotifType, title:"Set your first goal",
      body:"Goals turn saving into steps you can tick off. It takes about a minute in the Goals tab.",
      time:"Today", read:false,
    }] : []),
    ...(profile && profile.limits.remaining < profile.limits.cycleCap ? [{
      id:202, type:"certificate" as NotifType, title:"Investment limit updated",
      body:`EGP ${profile.limits.remaining.toLocaleString()} of your EGP ${profile.limits.cycleCap.toLocaleString()} limit is still available. Resets ${profile.limits.resetDate}.`,
      time:"Today", read:true,
    }] : []),
  ]
}

function NotificationsScreen({ nav }: { nav:(s:Screen)=>void }) {
  const { t, notifPrefs } = useT()
  const { holdings, profile } = useApp()
  const [filter, setFilter] = useState<NotifType|null>(null)
  const [notifs, setNotifs] = useState(() => buildNotifs(holdings, profile))
  const iconFor=(type:NotifType)=>type==="reminder"?"bell":type==="certificate"?"chart":"trending"
  const colorFor=(type:NotifType)=>type==="reminder"?"#F97316":type==="certificate"?GR:GD
  const bgFor=(type:NotifType)=>type==="reminder"?"#FFF7ED":type==="certificate"?GRL:`${GD}14`
  const typeEnabled=(type:NotifType)=>type==="reminder"?notifPrefs.reminders:type==="certificate"?notifPrefs.certs:notifPrefs.growth
  const visible=notifs.filter(n=>(!filter||n.type===filter)&&typeEnabled(n.type))
  const unread=visible.filter(n=>!n.read).length
  const markAll=()=>setNotifs(notifs.map(n=>({...n,read:true})))
  const markOne=(id:number)=>setNotifs(notifs.map(n=>n.id===id?{...n,read:true}:n))
  const filters:[string,NotifType|null][]=[["All",null],["Reminders","reminder"],["Certificates","certificate"],["Growth","growth"]]
  return <div style={{ background:"transparent", minHeight:"100%" }}>
    <div style={{ background:t.card, backdropFilter:t.blur, WebkitBackdropFilter:t.blur, borderBottom:`1px solid ${t.stroke}`, padding:"0 20px 18px", paddingTop:`calc(16px + var(--safe-top, 0px))` }}>
      <div style={{ display:"flex", alignItems:"center", gap:12 }}>
        <button onClick={()=>nav("home")} style={{ width:36, height:36, borderRadius:22, background:t.chip, backdropFilter:t.blur, WebkitBackdropFilter:t.blur, display:"flex", alignItems:"center", justifyContent:"center", border:"none", cursor:"pointer", flexShrink:0 }}><Ic n="left" c={t.text} s={18}/></button>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:20, fontWeight:800, color:t.text }}>Notifications</div>
          <div style={{ fontSize:13, color:t.sub }}>{unread>0?`${unread} unread`:"All caught up"}</div>
        </div>
        {unread>0&&<button onClick={markAll} style={{ fontSize:12, color:t.brand, fontWeight:700, background:"none", border:"none", cursor:"pointer" }}>Mark all read</button>}
      </div>
    </div>
    <div style={{ display:"flex", gap:8, padding:"12px 16px 0", overflowX:"auto" as const }}>
      {filters.map(([label,type])=><button key={label} onClick={()=>setFilter(type)} style={{ flexShrink:0, padding:"6px 14px", borderRadius:20, background:filter===type?GR:t.card, color:filter===type?"white":t.sub, fontSize:12, fontWeight:600, boxShadow:`0 1px 4px rgba(0,0,0,${t.dm?0.2:0.06})`, border:"none", cursor:"pointer", display:"flex", gap:5, alignItems:"center" }}>
        {label}<span style={{ background:filter===type?"rgba(255,255,255,0.25)":t.bg, borderRadius:10, padding:"1px 6px", fontSize:10, fontWeight:800 }}>{type?notifs.filter(n=>n.type===type&&typeEnabled(n.type)).length:visible.length}</span>
      </button>)}
    </div>
    <div style={{ padding:"14px 16px 28px" }}>
      {visible.length===0&&<div style={{ textAlign:"center" as const, padding:"40px 20px", color:t.sub, fontSize:13 }}>No notifications in this category.</div>}
      {visible.map((n,i)=><div key={n.id} onClick={()=>markOne(n.id)}
        style={{ background:n.read?t.card:t.cardAlt2, borderRadius:16, padding:"14px 16px", marginBottom:10, display:"flex", gap:13, alignItems:"flex-start", boxShadow:n.read?`0 1px 4px rgba(0,0,0,${t.dm?0.18:0.04})`:`0 2px 10px ${GR}14`, border:n.read?"none":`1px solid ${GR}22`, cursor:"pointer", animation:i<3?"fadeUp 0.3s ease-out":"none" }}>
        <div style={{ width:42, height:42, borderRadius:13, background:bgFor(n.type), display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}><Ic n={iconFor(n.type)} c={colorFor(n.type)} s={20}/></div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:8, marginBottom:4 }}>
            <div style={{ fontSize:13, fontWeight:n.read?600:800, color:t.text, lineHeight:1.3 }}>{n.title}</div>
            {!n.read&&<div style={{ width:8, height:8, borderRadius:4, background:GR, flexShrink:0, marginTop:3 }}/>}
          </div>
          <div style={{ fontSize:12, color:t.sub, lineHeight:1.6, marginBottom:6 }}>{n.body}</div>
          <div style={{ fontSize:11, color:colorFor(n.type), fontWeight:600, display:"flex", alignItems:"center", gap:5 }}>
            <div style={{ width:6, height:6, borderRadius:3, background:colorFor(n.type) }}/>{n.time}
          </div>
        </div>
      </div>)}
    </div>
  </div>
}

// ─── ProfileScreen ────────────────────────────────────────────────────────────
function ProfileScreen({ nav }: { nav:(s:Screen)=>void }) {
  const { t, lang } = useT()
  const { profile, holdings, logOut, isDemo } = useApp()
  const name = profile?.displayName || "NBE Youth"
  const invested = holdings.reduce((n,h)=>n+h.amount, 0)

  return <div style={{ background:"transparent", minHeight:"100%" }}>
    <div style={{ background:t.card, backdropFilter:t.blur, WebkitBackdropFilter:t.blur, borderBottom:`1px solid ${t.stroke}`, padding:"0 20px 18px", paddingTop:`calc(16px + var(--safe-top, 0px))` }}>
      <div style={{ display:"flex", alignItems:"center", gap:12 }}>
        <button onClick={()=>nav("home")} style={{ width:36, height:36, borderRadius:999, background:t.chip, backdropFilter:t.blur, WebkitBackdropFilter:t.blur, border:`1px solid ${t.stroke}`, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", flexShrink:0 }}><Ic n="left" c={t.text} s={18}/></button>
        <div style={{ fontSize:20, fontWeight:800, color:t.text }}>{tx("profile",lang)}</div>
      </div>
    </div>

    <div style={{ background:t.card, backdropFilter:t.blur, WebkitBackdropFilter:t.blur, padding:"22px 20px 24px", display:"flex", alignItems:"center", gap:16, borderBottom:`1px solid ${t.border}`, marginBottom:12 }}>
      <div style={{ width:64, height:64, borderRadius:32, background:`linear-gradient(135deg,${GR},${GRD})`, display:"flex", alignItems:"center", justifyContent:"center", color:"white", fontSize:22, fontWeight:800, flexShrink:0, boxShadow:`0 8px 22px ${GR}45` }}>{profile?.initials ?? "NB"}</div>
      <div style={{ minWidth:0 }}>
        <div style={{ fontSize:18, fontWeight:800, color:t.text }}>{name}</div>
        <div style={{ fontSize:13, color:t.sub, marginTop:2, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" as const }}>{profile?.email}</div>
        <div style={{ display:"inline-flex", alignItems:"center", gap:5, marginTop:7, background:`${GD}18`, border:`1px solid ${GD}30`, padding:"4px 10px", borderRadius:999 }}>
          <Ic n="award" c={t.gold} s={13}/>
          <span style={{ fontSize:11, fontWeight:700, color:t.gold }}>{(profile?.stats?.points ?? 0).toLocaleString()} pts · Level {profile?.stats?.level ?? 1}</span>
        </div>
      </div>
    </div>

    <div style={{ padding:"0 16px 28px" }}>
      <SSection label="Your money">
        <SRow icon="wallet" iconColor={GR} label="Total invested" sub={`Across ${holdings.length} ${holdings.length===1?"holding":"holdings"}`} right={<span style={{ fontSize:14, fontWeight:800, color:t.text }}>EGP {invested.toLocaleString()}</span>}/>
        <Divider/>
        <SRow icon="chart" iconColor={GD} label="Remaining limit" sub={`Resets ${profile?.limits?.resetDate ?? "—"}`} right={<span style={{ fontSize:14, fontWeight:800, color:t.gold }}>EGP {(profile?.limits?.remaining ?? 0).toLocaleString()}</span>}/>
      </SSection>

      <SSection label="Preferences">
        <SRow icon="settings" iconColor={GRD} label="Settings" sub="Appearance, language, notifications" onClick={()=>nav("settings")}/>
        <Divider/>
        <SRow icon="key" iconColor={GR} label={tx("security",lang)} sub="Password and privacy" onClick={()=>nav("security")}/>
        <Divider/>
        <SRow icon="help" iconColor={GR} label="Help & Support" onClick={()=>nav("help")}/>
      </SSection>

      {isDemo && <div style={{ background:t.cardAlt, border:`1px solid ${t.stroke}`, borderRadius:20, padding:"14px 16px", marginBottom:14, display:"flex", gap:11, alignItems:"flex-start" }}>
        <Ic n="info" c={t.gold} s={16}/>
        <div style={{ fontSize:12, color:t.sub, lineHeight:1.65 }}>Running without Firebase. Your account and holdings are stored on this device only.</div>
      </div>}

      <div style={{ background:t.card, backdropFilter:t.blur, WebkitBackdropFilter:t.blur, border:`1px solid ${t.stroke}`, borderRadius:20, overflow:"hidden" }}>
        <SRow icon="logout" iconColor={ERR} label={tx("logout",lang)} danger onClick={logOut} right={<></>}/>
      </div>
    </div>
  </div>
}

// ─── SettingsScreen ───────────────────────────────────────────────────────────
function SettingsScreen({ nav }: { nav:(s:Screen)=>void }) {
  const { t, lang } = useT()
  const { profile, patch } = useApp()
  const prefs = profile?.prefs
  const set = (key:string, value:unknown) => patch({ [`prefs.${key}`]: value })

  return <div style={{ background:"transparent", minHeight:"100%" }}>
    <div style={{ background:t.card, backdropFilter:t.blur, WebkitBackdropFilter:t.blur, borderBottom:`1px solid ${t.stroke}`, padding:"0 20px 18px", paddingTop:`calc(16px + var(--safe-top, 0px))` }}>
      <div style={{ display:"flex", alignItems:"center", gap:12 }}>
        <button onClick={()=>nav("profile")} style={{ width:36, height:36, borderRadius:999, background:t.chip, backdropFilter:t.blur, WebkitBackdropFilter:t.blur, border:`1px solid ${t.stroke}`, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", flexShrink:0 }}><Ic n="left" c={t.text} s={18}/></button>
        <div>
          <div style={{ fontSize:20, fontWeight:800, color:t.text }}>Settings</div>
          <div style={{ fontSize:12, color:t.sub }}>Saved to your account</div>
        </div>
      </div>
    </div>

    <div style={{ padding:"14px 16px 28px" }}>
      <SSection label="Appearance">
        <div style={{ padding:"14px 16px" }}>
          <div style={{ fontSize:12, color:t.sub, marginBottom:11 }}>Theme</div>
          <div style={{ display:"flex", gap:8 }}>
            {([[false,"Light","sun"],[true,"Dark","moon"]] as const).map(([v,label,icon])=>{
              const on = (prefs?.darkMode ?? true) === v
              return <button key={label} onClick={()=>set("darkMode", v)} style={{ flex:1, padding:"13px 0", borderRadius:18, border:`1.5px solid ${on?t.brand:t.border}`, background:on?t.cardAlt:"transparent", color:on?t.brand:t.sub, fontSize:13, fontWeight:700, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:8, transition:"all 0.2s", fontFamily:"inherit" }}>
                <Ic n={icon} c={on?t.brand:t.sub} s={16}/>{label}
              </button>
            })}
          </div>
        </div>
        <Divider/>
        <SRow icon="star" iconColor={GD} label="Reduce motion" sub="Turn off card and sheet animations"
          right={<Toggle on={prefs?.reduceMotion ?? false} onToggle={()=>set("reduceMotion", !(prefs?.reduceMotion ?? false))}/>}/>
      </SSection>

      <SSection label={tx("language",lang)}>
        <div style={{ padding:"14px 16px" }}>
          <div style={{ fontSize:12, color:t.sub, marginBottom:11 }}>Select language / اختر اللغة</div>
          <div style={{ display:"flex", gap:8 }}>
            {(["en","ar"] as const).map(l=>{
              const on = (prefs?.language ?? "en") === l
              return <button key={l} onClick={()=>set("language", l)} style={{ flex:1, padding:"12px", borderRadius:18, border:`1.5px solid ${on?t.brand:t.border}`, background:on?t.cardAlt:"transparent", color:on?t.brand:t.sub, fontSize:14, fontWeight:700, cursor:"pointer", transition:"all 0.2s", fontFamily:"inherit" }}>
                {l==="en"?"English":"العربية"}
              </button>
            })}
          </div>
        </div>
      </SSection>

      <SSection label={tx("security",lang)}>
        <SRow icon="face" iconColor={GRD} label={tx("face_id",lang)} sub={(prefs?.faceId ?? false)?"Enabled":"Disabled"}
          right={<Toggle on={prefs?.faceId ?? false} onToggle={()=>set("faceId", !(prefs?.faceId ?? false))}/>}/>
        <Divider/>
        <SRow icon="key" iconColor={GR} label="Change Password" onClick={()=>nav("security")}/>
      </SSection>

      <SSection label="Notifications">
        <SRow icon="bell" iconColor="#F97316" label="Reminders" sub="Lessons, streaks, quizzes"
          right={<Toggle on={prefs?.notifications.reminders ?? true} onToggle={()=>set("notifications.reminders", !(prefs?.notifications.reminders ?? true))}/>}/>
        <Divider/>
        <SRow icon="chart" iconColor={GR} label="New Certificates" sub="New products and offers"
          right={<Toggle on={prefs?.notifications.certs ?? true} onToggle={()=>set("notifications.certs", !(prefs?.notifications.certs ?? true))}/>}/>
        <Divider/>
        <SRow icon="trending" iconColor={GD} label="Growth & Progress" sub="Investment updates, milestones"
          right={<Toggle on={prefs?.notifications.growth ?? true} onToggle={()=>set("notifications.growth", !(prefs?.notifications.growth ?? true))}/>}/>
      </SSection>

      <SSection label="Walkthroughs">
        <SRow icon="info" iconColor={GR} label="Replay all walkthroughs" sub="Show each screen's guide again"
          onClick={()=>patch({ "flags.toursSeen": { home:false, invest:false, learn:false, goals:false, rewards:false } })}/>
      </SSection>
    </div>
  </div>
}

// ─── SecurityScreen ───────────────────────────────────────────────────────────
function SecurityScreen({ nav }: { nav:(s:Screen)=>void }) {
  const { t, lang, faceId, setFaceId } = useT()
  const [showPwForm, setShowPwForm] = useState(false)
  const [showPrivacy, setShowPrivacy] = useState(false)
  return <div style={{ background:"transparent", minHeight:"100%" }}>
    <div style={{ background:t.card, backdropFilter:t.blur, WebkitBackdropFilter:t.blur, borderBottom:`1px solid ${t.stroke}`, padding:"0 20px 18px", paddingTop:`calc(16px + var(--safe-top, 0px))` }}>
      <div style={{ display:"flex", alignItems:"center", gap:12 }}>
        <button onClick={()=>nav("profile")} style={{ width:36, height:36, borderRadius:22, background:t.chip, backdropFilter:t.blur, WebkitBackdropFilter:t.blur, display:"flex", alignItems:"center", justifyContent:"center", border:"none", cursor:"pointer", flexShrink:0 }}><Ic n="left" c={t.text} s={18}/></button>
        <div style={{ fontSize:20, fontWeight:800, color:t.text }}>{tx("security",lang)}</div>
      </div>
    </div>
    <div style={{ padding:"16px" }}>
      <SSection label="Login">
        <SRow icon="key" iconColor={GR} label="Change Password" sub={showPwForm?"Fill in the form below":"Tap to update your password"} onClick={()=>setShowPwForm(p=>!p)}/>
        {showPwForm&&<div style={{ padding:"0 16px 16px" }}>
          {["Current Password","New Password","Confirm New Password"].map(ph=>(
            <div key={ph} style={{ display:"flex", alignItems:"center", gap:10, border:`1.5px solid ${t.border}`, borderRadius:12, padding:"11px 14px", background:t.inputBg, backdropFilter:t.blur, WebkitBackdropFilter:t.blur, marginBottom:10 }}>
              <Ic n="lock" c={t.sub} s={16}/>
              <input type="password" placeholder={ph} style={{ flex:1, border:"none", outline:"none", fontSize:16, color:t.text, background:"transparent", fontFamily:"inherit" }}/>
            </div>
          ))}
          <button style={{ width:"100%", padding:"13px", borderRadius:999, border:"none", background:`linear-gradient(135deg,${GR},${GRD})`, color:"white", fontSize:14, fontWeight:700, cursor:"pointer" }}>Update Password</button>
        </div>}
        <Divider/>
        <SRow icon="face" iconColor={GRD} label={tx("face_id",lang)} sub={faceId?"Enabled":"Disabled"} right={<Toggle on={faceId} onToggle={()=>setFaceId(!faceId)}/>}/>
      </SSection>
      <SSection label="Privacy">
        <SRow icon="privacy" iconColor={GR} label="Privacy Settings" onClick={()=>setShowPrivacy(p=>!p)}/>
        {showPrivacy&&<div style={{ padding:"0 16px 16px" }}>
          {[{label:"Share data for personalization",on:true},{label:"Analytics & performance",on:true},{label:"Marketing communications",on:false}].map((item,i)=>(
            <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"10px 0", borderBottom:i<2?`1px solid ${t.border}`:"none" }}>
              <span style={{ fontSize:13, color:t.text, fontWeight:500 }}>{item.label}</span>
              <Toggle on={item.on} onToggle={()=>{}}/>
            </div>
          ))}
        </div>}
        <Divider/>
        <SRow icon="doc" iconColor={GR} label="Terms & Conditions" onClick={()=>{}}/>
        <Divider/>
        <SRow icon="shield" iconColor={GRD} label="Privacy Policy" onClick={()=>{}}/>
      </SSection>
    </div>
  </div>
}

// ─── HelpScreen ───────────────────────────────────────────────────────────────
function HelpScreen({ nav }: { nav:(s:Screen)=>void }) {
  const { t, lang } = useT()
  const [msgSent, setMsgSent] = useState(false)
  const [msg, setMsg] = useState("")
  return <div style={{ background:"transparent", minHeight:"100%" }}>
    <div style={{ background:t.card, backdropFilter:t.blur, WebkitBackdropFilter:t.blur, borderBottom:`1px solid ${t.stroke}`, padding:"0 20px 18px", paddingTop:`calc(16px + var(--safe-top, 0px))` }}>
      <div style={{ display:"flex", alignItems:"center", gap:12 }}>
        <button onClick={()=>nav("profile")} style={{ width:36, height:36, borderRadius:22, background:t.chip, backdropFilter:t.blur, WebkitBackdropFilter:t.blur, display:"flex", alignItems:"center", justifyContent:"center", border:"none", cursor:"pointer", flexShrink:0 }}><Ic n="left" c={t.text} s={18}/></button>
        <div style={{ fontSize:20, fontWeight:800, color:t.text }}>Help & Support</div>
      </div>
    </div>
    <div style={{ padding:"16px" }}>
      <SSection label="Contact Us">
        <div style={{ padding:"16px" }}>
          <div style={{ display:"flex", alignItems:"center", gap:14, padding:"12px 0", borderBottom:`1px solid ${t.border}` }}>
            <div style={{ width:44, height:44, borderRadius:13, background:`${GR}14`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}><Ic n="phone" c={t.brand} s={20}/></div>
            <div>
              <div style={{ fontSize:13, color:t.sub }}>Customer Support Hotline</div>
              <div style={{ fontSize:26, fontWeight:800, color:t.brand, letterSpacing:1 }}>1923</div>
              <div style={{ fontSize:11, color:t.sub, marginTop:2 }}>Free from all networks in Egypt</div>
            </div>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:14, padding:"12px 0" }}>
            <div style={{ width:44, height:44, borderRadius:13, background:`${GD}14`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}><Ic n="clock" c={t.gold} s={20}/></div>
            <div>
              <div style={{ fontSize:13, color:t.sub }}>Working Hours</div>
              <div style={{ fontSize:14, fontWeight:700, color:t.text }}>Sun – Thu: 8:00 AM – 8:00 PM</div>
              <div style={{ fontSize:12, color:t.sub, marginTop:1 }}>Fri & Sat: 10:00 AM – 4:00 PM</div>
            </div>
          </div>
        </div>
      </SSection>
      <SSection label="Send a Message">
        <div style={{ padding:"16px" }}>
          {msgSent?<div style={{ background:t.dm?`${GR}22`:GRL, borderRadius:12, padding:"16px", textAlign:"center" as const, animation:"popIn 0.3s ease-out" }}>
            <Ic n="check" c={t.brand} s={28}/><div style={{ fontSize:14, fontWeight:700, color:t.brand, marginTop:8 }}>Message Sent!</div>
            <div style={{ fontSize:12, color:t.sub, marginTop:4 }}>We will get back to you within 24 hours.</div>
            <button onClick={()=>{setMsgSent(false);setMsg("")}} style={{ marginTop:12, padding:"8px 18px", borderRadius:999, border:"none", background:GR, color:"white", fontSize:12, fontWeight:700, cursor:"pointer" }}>Send Another</button>
          </div>:<div>
            <textarea value={msg} onChange={e=>setMsg(e.target.value)} placeholder="Describe your issue or question..." rows={4} style={{ width:"100%", border:`1.5px solid ${t.border}`, borderRadius:12, padding:"12px 14px", fontSize:16, color:t.text, background:t.inputBg, backdropFilter:t.blur, WebkitBackdropFilter:t.blur, fontFamily:"inherit", resize:"none", outline:"none", boxSizing:"border-box" }}/>
            <div style={{ marginTop:10 }}>
              <button onClick={()=>msg.trim()&&setMsgSent(true)} style={{ width:"100%", padding:"13px", borderRadius:999, border:"none", background:`linear-gradient(135deg,${GR},${GRD})`, color:"white", fontSize:14, fontWeight:700, cursor:"pointer", opacity:msg.trim()?1:0.5 }}>Send Message</button>
            </div>
          </div>}
        </div>
      </SSection>
      <SSection label="Legal">
        <SRow icon="doc" iconColor={GR} label="Terms & Conditions" onClick={()=>{}}/>
        <Divider/>
        <SRow icon="shield" iconColor={GRD} label="Privacy Policy" onClick={()=>{}}/>
      </SSection>
      <div style={{ marginTop:8, background:t.card, backdropFilter:t.blur, WebkitBackdropFilter:t.blur, border:`1px solid ${t.stroke}`, borderRadius:20, overflow:"hidden", boxShadow:`0 1px 4px rgba(0,0,0,${t.dm?0.2:0.06})` }}>
        <SRow icon="logout" iconColor={ERR} label={tx("logout",lang)} danger onClick={()=>nav("login")} right={<></>}/>
      </div>
    </div>
  </div>
}

// ─── Floating pill nav ───────────────────────────────────────────────────────
function BottomNav({ active, onSelect }: { active:Screen; onSelect:(s:Screen)=>void }) {
  const { t, lang } = useT()
  const items: { id:Screen; label:string; icon:string }[] = [
    { id:"home",    label:tx("home",lang),    icon:"home" },
    { id:"invest",  label:tx("invest",lang),  icon:"chart" },
    { id:"learn",   label:tx("learn",lang),   icon:"chat" },
    { id:"goals",   label:tx("goals",lang),   icon:"target" },
    { id:"rewards", label:tx("rewards",lang), icon:"award" },
  ]
  return <div id="tut-nav" style={{
    position:"relative", zIndex:30,
    display:"flex", alignItems:"center", justifyContent:"space-between",
    padding:"9px 10px", borderRadius:999,
    background:t.navBg, backdropFilter:"blur(30px) saturate(180%)", WebkitBackdropFilter:"blur(30px) saturate(180%)",
    border:`1px solid ${t.strokeS}`,
    boxShadow:t.dm ? "0 20px 46px rgba(0,0,0,0.62), inset 0 1px 0 rgba(255,255,255,0.14)"
                   : "0 18px 40px rgba(9,50,36,0.18), inset 0 1px 0 rgba(255,255,255,0.9)",
  }}>
    {items.map(item=>{
      const on = active===item.id
      return <button key={item.id} onClick={()=>onSelect(item.id)} style={{
        flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:4,
        background:on ? (t.dm?"rgba(61,214,140,0.14)":"rgba(8,122,75,0.12)") : "none",
        border:"none", borderRadius:999, cursor:"pointer", padding:"8px 0 7px",
        transition:"background 0.22s", fontFamily:"inherit",
      }}>
        <div style={{ display:"flex", filter:on?`drop-shadow(0 0 9px ${t.brand}80)`:"none" }}>
          <Ic n={item.icon} c={on?t.brand:t.sub} s={21}/>
        </div>
        <span style={{ fontSize:9, fontWeight:on?800:500, color:on?t.brand:t.sub }}>{item.label}</span>
      </button>
    })}
  </div>
}

// ─── Per-screen first-open tutorial ──────────────────────────────────────────
type TutStep = { target:string|null; title:string; text:string }

const TUTORIALS: Partial<Record<Screen, TutStep[]>> = {
  home: [
    { target:null, title:"This is your home screen",
      text:"Everything here answers one question: are you getting closer to what you are saving for? Tap Next and we'll walk through it." },
    { target:"tut-home-goal", title:"Your goal, at the top",
      text:"The ring fills as you save. Still Needed is the gap between what you have and what the goal costs. If you have more than one goal, use the arrows to swap which one sits here." },
    { target:"tut-home-tips", title:"Tips that fit your goal",
      text:"These change based on the goal above. They are suggestions, not instructions — you can ignore any of them." },
    { target:"tut-home-actions", title:"The three things you'll do most",
      text:"Invest puts money to work, Goals is where you add or edit targets, and Daily Review shows where your money went today." },
    { target:"tut-nav", title:"Everything else lives down here",
      text:"Five tabs, always in reach. Each one gives you a short walkthrough the first time you open it." },
  ],
  invest: [
    { target:null, title:"Two ways to grow money",
      text:"NBE gives you certificates and mutual funds. They work differently, and the difference matters more than the percentages do. Next." },
    { target:"tut-invest-toggle", title:"Certificate = a promise",
      text:"You hand NBE an amount and lock it for a set time. NBE tells you the exact rate on day one and it never changes. At the end you get your money plus the interest. You cannot lose the money you put in — the Central Bank of Egypt guarantees it. The trade-off: you cannot touch it early." },
    { target:"tut-invest-toggle", title:"Fund = a shared basket",
      text:"Your money joins a big pot managed by NBE and that pot buys things — government debt, company shares, or a mix. The value of those things moves every day, so the pot grows or shrinks. Nobody can promise you a number. You can usually take your money out daily or weekly." },
    { target:"tut-invest-explainer", title:"Which one is right for you?",
      text:"Short version: if you need an exact amount on an exact date, take a certificate. If the money can sit for years and a dip won't scare you, a fund has more room to grow. Tap here any time for the full side-by-side." },
    { target:"tut-invest-card", title:"The percentage is not the whole story",
      text:"On a certificate, 25% is what you will get. On a fund, 24% is what it happened to average before — it could be more, it could be less, it could be negative in a bad year." },
    { target:"tut-invest-calc", title:"Try the numbers",
      text:"Drag the amount and see the result. For funds this is an estimate built on past averages, so treat it as a rough shape rather than a figure to count on." },
  ],
  learn: [
    { target:null, title:"Ask anything about money",
      text:"No question is too basic here. This is the place to ask the thing you didn't want to ask in a branch." },
    { target:"tut-learn-chat", title:"Start with a suggestion",
      text:"The chips below the first message are common questions. Tap one to see how the answers read before you write your own." },
    { target:"tut-learn-input", title:"Or type your own",
      text:"Plain language works best — \"is a certificate better than saving?\" gets a better answer than banking jargon." },
  ],
  goals: [
    { target:null, title:"Goals turn saving into steps",
      text:"A goal is a target amount, a date, and a checklist. The app tracks the checklist so you can see progress before you see the money." },
    { target:"tut-goals-add", title:"Add your own goal",
      text:"A laptop, a car, a first investment — give it a name, a budget and an end date. It appears on your home screen straight away." },
    { target:"tut-goals-list", title:"Built-in goals",
      text:"These are the milestones NBE tracks for you, like becoming credit-card or loan ready. Start one and its steps tick off as you complete them." },
  ],
  rewards: [
    { target:null, title:"You earn points by using the app",
      text:"Lessons, goals and investments all pay points. Points convert into real value, not badges you can't spend." },
    { target:"tut-rewards-points", title:"Points and levels",
      text:"Your total sits here along with your level. Levels unlock better redemption options as they climb." },
    { target:"tut-rewards-redeem", title:"Turn points into money",
      text:"Cashback, partner vouchers and discounts. Cashback lands in your NBE account — it is not store credit." },
  ],
}

function TutorialOverlay({ steps, frameRef, onDone, scale=1 }: {
  steps:TutStep[]; frameRef:React.RefObject<HTMLDivElement|null>; onDone:()=>void; scale?:number
}) {
  const { t } = useT()
  const [i, setI] = useState(0)
  const [rect, setRect] = useState<{top:number;left:number;width:number;height:number}|null>(null)
  const step = steps[i]

  useEffect(()=>{
    let raf = 0
    const measure = () => {
      const frame = frameRef.current
      if (!frame || !step.target) { setRect(null); return }
      const el = document.getElementById(step.target)
      if (!el) { setRect(null); return }
      const f = frame.getBoundingClientRect(), r = el.getBoundingClientRect()
      // getBoundingClientRect reports real pixels; the overlay is a child of
      // the zoomed frame, so divide back into the frame's own coordinates.
      setRect({
        top:  (r.top  - f.top)  / scale,
        left: (r.left - f.left) / scale,
        width:  r.width  / scale,
        height: r.height / scale,
      })
    }
    const el = step.target ? document.getElementById(step.target) : null
    if (el) el.scrollIntoView({ behavior:"smooth", block:"center" })
    raf = window.setTimeout(measure, el ? 320 : 0)
    return ()=>window.clearTimeout(raf)
  }, [i, step, frameRef, scale])

  const pad = 8
  const spot = rect ? { top:rect.top-pad, left:rect.left-pad, width:rect.width+pad*2, height:rect.height+pad*2 } : null
  const below = !spot || spot.top < 320
  const next = () => i < steps.length-1 ? setI(i+1) : onDone()

  return <div style={{ position:"absolute", inset:0, zIndex:60 }}>
    <div onClick={next} style={{ position:"absolute", inset:0, background: spot ? "transparent" : "rgba(2,12,8,0.74)", backdropFilter: spot ? "none" : "blur(2px)", WebkitBackdropFilter: spot ? "none" : "blur(2px)" }}/>
    {spot && <div style={{
      position:"absolute", top:spot.top, left:spot.left, width:spot.width, height:spot.height,
      borderRadius:22, border:`2px solid ${t.brand}`, pointerEvents:"none",
      boxShadow:`0 0 0 9999px rgba(2,12,8,0.74), 0 0 34px ${t.brand}70`,
      transition:"all 0.32s cubic-bezier(0.4,0,0.2,1)",
    }}/>}
    <div style={{
      position:"absolute", left:16, right:16,
      ...(below ? { top: spot ? Math.min(spot.top+spot.height+16, 470) : 190 } : { bottom: 120 }),
      borderRadius:26, padding:"20px 20px 18px",
      background:t.dm?"rgba(14,34,24,0.94)":"rgba(255,255,255,0.96)",
      backdropFilter:"blur(24px)", WebkitBackdropFilter:"blur(24px)",
      border:`1px solid ${t.strokeS}`,
      boxShadow:"0 24px 60px rgba(0,0,0,0.5)",
      animation:"fadeUp 0.3s ease-out",
    }} key={i}>
      <div style={{ display:"flex", gap:5, marginBottom:14 }}>
        {steps.map((_,j)=><div key={j} style={{ height:4, flex:j===i?2.2:1, borderRadius:4, background:j<=i?t.brand:t.track, transition:"all 0.3s" }}/>)}
      </div>
      <div style={{ fontSize:17, fontWeight:800, color:t.text, marginBottom:9, lineHeight:1.3 }}>{step.title}</div>
      <div style={{ fontSize:13.5, color:t.sub, lineHeight:1.75, marginBottom:18 }}>{step.text}</div>
      <div style={{ display:"flex", gap:10, alignItems:"center" }}>
        <button onClick={onDone} style={{ padding:"12px 18px", borderRadius:999, border:`1px solid ${t.border}`, background:"transparent", color:t.sub, fontSize:13, fontWeight:600, cursor:"pointer", fontFamily:"inherit" }}>Skip</button>
        <button onClick={next} style={{ flex:1, padding:"13px", borderRadius:999, border:"none", background:`linear-gradient(135deg,${GR},${GRD})`, color:"white", fontSize:14, fontWeight:700, cursor:"pointer", boxShadow:`0 8px 22px ${GR}45`, fontFamily:"inherit" }}>
          {i < steps.length-1 ? `Next (${i+1}/${steps.length})` : "Got it"}
        </button>
      </div>
    </div>
  </div>
}

// ─── App ─────────────────────────────────────────────────────────────────────
function Splash({ dark }: { dark:boolean }) {
  const t = dark ? darkTheme : lightTheme
  return <div style={{ height:"100%", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:18 }}>
    <div style={{ width:56, height:56, borderRadius:18, background:`linear-gradient(135deg,${GR},${GRD})`, display:"flex", alignItems:"center", justifyContent:"center", boxShadow:`0 12px 32px ${GR}45`, animation:"popIn 0.4s ease-out" }}>
      <svg viewBox="0 0 20 20" width={26} height={26} fill="white"><path d="M10 1.5L1.5 7v12h6V13h5v6h6V7L10 1.5z"/></svg>
    </div>
    <div style={{ display:"flex", gap:5 }}>
      {[0,1,2].map(i=><div key={i} style={{ width:7, height:7, borderRadius:4, background:t.sub, animation:`fadeUp 0.9s ease-in-out ${i*0.15}s infinite alternate` }}/>)}
    </div>
  </div>
}

export default function App() {
  const { user, ready, signIn, signUp, resetPassword, logOut, demoSignIn, isDemo } = useAuth()

  const [authScreen, setAuthScreen] = useState<Screen>("login")
  const [screen, setScreen] = useState<Screen>("home")
  const [profile, setProfile] = useState<UserProfile|null>(null)
  const [profileReady, setProfileReady] = useState(false)
  const [userGoals, setUserGoals] = useState<GoalEntry[]>([])
  const [holdings, setHoldings] = useState<HoldingDoc[]>([])
  const [builtinActive, setBuiltinActive] = useState<boolean[]>(BUILTIN_GOALS.map(g=>g.defaultActive))
  const [homeCardGoalId, setHomeCardGoalId] = useState<string|null>(null)
  const [tourReady, setTourReady] = useState(false)
  const [, setStatusLight] = useState(false)
  const { scale } = useViewport()
  const kbInset = useVisualViewport()
  const navRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const uid = user?.uid ?? ""
  const dm = profile?.prefs?.darkMode ?? true
  const lang = profile?.prefs?.language ?? "en"
  const t = dm ? darkTheme : lightTheme

  /* Load (or create) the profile, goals and holdings once a session exists. */
  useEffect(()=>{
    let cancelled = false
    if (!user) { setProfile(null); setProfileReady(ready); setHoldings([]); setUserGoals([]); return }
    setProfileReady(false)
    ;(async ()=>{
      try {
        let p = await loadProfile(user.uid)
        if (!p) p = await createProfile(user.uid, user.displayName, user.email)
        if (cancelled) return
        // Show the app as soon as the profile is known — goals and holdings are
        // two more round trips and nothing on first paint depends on them.
        const rollover = cycleRollover(p)
        if (rollover) {
          p = { ...p, limits: { ...p.limits, remaining:p.limits.cycleCap, resetDate:String(rollover["limits.resetDate"]) } }
          patchProfile(user.uid, rollover).catch(()=>{ /* applied locally regardless */ })
        }
        const streak = streakUpdate(p)
        if (streak) {
          p = { ...p, stats: { ...p.stats, streakDays: streak["stats.streakDays"] as number, lastActive: streak["stats.lastActive"] as string } }
          patchProfile(user.uid, streak).catch(()=>{ /* applied locally regardless */ })
        }
        setProfile(p)
        setScreen(p.flags.onboardingComplete ? "home" : "onboarding")
        setProfileReady(true)
        Promise.all([loadGoals(user.uid), loadHoldings(user.uid)])
          .then(([g, h]) => {
            if (cancelled) return
            setUserGoals(g.map(d=>({ id:d.id, name:d.name, budget:d.budget, start:d.start, end:d.end, type:d.type, pct:d.pct })))
            setHoldings(h)
            setHomeCardGoalId(prev => prev ?? g[0]?.id ?? null)
          })
          .catch(()=>{ /* lists stay empty until the next load */ })
      } catch {
        // A failed read is not a new user. Fall back to the last profile we
        // saw; only a genuinely unknown account starts onboarding.
        if (cancelled) return
        const cached = readMirror(user.uid)
        const p = cached ?? DEFAULT_PROFILE(user.displayName, user.email)
        setProfile(p)
        setScreen(p.flags.onboardingComplete ? "home" : "onboarding")
      } finally {
        if (!cancelled) setProfileReady(true)
      }
    })()
    return ()=>{ cancelled = true }
  }, [user, ready])

  /* Optimistic local update + write-behind to Firestore. */
  const patch = useCallback((p:Record<string,unknown>) => {
    setProfile(prev => {
      if (!prev) return prev
      const next: any = structuredClone(prev)
      for (const [path, value] of Object.entries(p)) {
        const parts = path.split(".")
        let node = next
        for (const seg of parts.slice(0,-1)) node = node[seg] ??= {}
        node[parts[parts.length-1]] = value
      }
      if (uid) mirrorProfile(uid, next as UserProfile)
      return next as UserProfile
    })
    if (uid) patchProfile(uid, p).catch(()=>{ /* offline: local state still applied */ })
  }, [uid])

  /* Optimistic. Firestore's addDoc only settles on server ack, so awaiting it
     hangs the UI whenever the backend is unreachable — write behind instead. */
  const buy = useCallback(async (h:Omit<HoldingDoc,"id">) => {
    if (!uid) return
    const local: HoldingDoc = { ...h, id:newLocalId() }
    setHoldings(prev => [local, ...prev])
    addHolding(uid, h)
      .then(saved => setHoldings(prev => prev.map(x => x.id===local.id ? saved : x)))
      .catch(()=>{ /* queued by the SDK; local entry stands */ })
  }, [uid])

  /* Keep the page background behind the app matching the theme, so the iOS
     safe areas and any overscroll never flash the default page colour. */
  useEffect(()=>{
    document.documentElement.style.setProperty("--app-bg", t.frame)
  }, [t.frame])

  useEffect(()=>{
    document.documentElement.style.setProperty("--vp-scale", String(scale))
  }, [scale])

  useEffect(()=>{
    scrollRef.current?.scrollTo({ top:0 })
    setTourReady(false)
    const id = window.setTimeout(()=>setTourReady(true), 420)
    return ()=>window.clearTimeout(id)
  }, [screen])

  const handleGoalSet = (entry: GoalEntry) => {
    setUserGoals(p => [...p, entry])
    setHomeCardGoalId(prev => prev ?? entry.id)
    patch({
      "flags.firstGoalSet": true,
      "flags.onboardingComplete": true,
      "flags.funnelStage": "understands",
      "stats.points": (profile?.stats?.points ?? 0) + PTS_GOAL,
      "stats.level": progression((profile?.stats?.points ?? 0) + PTS_GOAL).level,
    })
    if (uid) {
      addGoal(uid, { name:entry.name, budget:entry.budget, start:entry.start, end:entry.end, type:entry.type, pct:entry.pct ?? 0 })
        .catch(()=>{ /* keep the local entry */ })
    }
    setScreen("home")
  }

  // Skip and the final CTA both land here. They used to go straight to the goal
  // sheet, and the flag was only ever written by handleGoalSet — so anyone who
  // abandoned the goal sheet restarted onboarding on every launch.
  const finishOnboarding = () => {
    patch({ "flags.onboardingComplete": true })
    setScreen("goalsetup")
  }

  const NO_NAV: Screen[] = ["login","signup","forgot","onboarding","goalsetup","notifications","lesson","profile","settings","security","help"]
  const showNav = !!user && !NO_NAV.includes(screen)

  // The pill is pinned by CSS at a fixed distance above the bottom of the
  // screen (NAV_GAP). position:fixed anchors to the layout viewport, which
  // neither the keyboard nor the collapsing address bar moves — so there is
  // nothing left to measure, poll, or drift.

  const isAuthScreen = !user

  const tourKey = (["home","invest","learn","goals","rewards"] as const).includes(screen as any) ? screen as TourKey : null
  const tour = tourKey ? TUTORIALS[tourKey] : undefined
  const showTour = !!tour && showNav && !!profile && !profile.flags?.toursSeen?.[tourKey!] && tourReady

  const renderScreen = () => {
    if (!user) {
      // No Firebase config → no credentials to check, so never show a login
      // form that would accept any password.
      if (isDemo) return <DemoGate demoSignIn={demoSignIn}/>
      if (authScreen === "signup") return <SignUpScreen nav={setAuthScreen} signUp={signUp}/>
      if (authScreen === "forgot") return <ForgotScreen nav={setAuthScreen} resetPassword={resetPassword}/>
      return <LoginScreen nav={setAuthScreen} signIn={signIn}/>
    }
    if (!profileReady) return <Splash dark={dm}/>

    const homeProps = { nav:setScreen, userGoals, builtinActive, homeCardGoalId, setHomeCardGoalId, onStartNewGoal:()=>setScreen("goalsetup") }
    if (screen === "goalsetup") {
      return (
        <div style={{ position:"relative", height:"100%", overflow:"hidden" }}>
          <div style={{ position:"absolute", inset:0, overflowY:"auto" as const, pointerEvents:"none" }}><HomeScreen {...homeProps} nav={()=>{}}/></div>
          <div style={{ position:"absolute", inset:0, background:"rgba(6,37,26,0.55)", backdropFilter:"blur(3px)" }}/>
          <div style={{ position:"absolute", bottom:0, left:0, right:0 }}><GoalSetupSheet onGoalSet={handleGoalSet}/></div>
        </div>
      )
    }
    switch (screen) {
      case "onboarding":    return <OnboardingScreen onDone={finishOnboarding} onTone={setStatusLight}/>
      case "home":          return <HomeScreen {...homeProps}/>
      case "invest":        return <InvestScreen/>
      case "learn":         return <LearnScreen/>
      case "lesson":        return <LessonScreen nav={setScreen}/>
      case "goals":         return <GoalsScreen userGoals={userGoals} setUserGoals={setUserGoals} builtinActive={builtinActive} setBuiltinActive={setBuiltinActive} homeCardGoalId={homeCardGoalId} setHomeCardGoalId={setHomeCardGoalId}/>
      case "rewards":       return <RewardsScreen/>
      case "dailyreview":   return <DailyReviewScreen nav={setScreen}/>
      case "notifications": return <NotificationsScreen nav={setScreen}/>
      case "profile":       return <ProfileScreen nav={setScreen}/>
      case "settings":      return <SettingsScreen nav={setScreen}/>
      case "security":      return <SecurityScreen nav={setScreen}/>
      case "help":          return <HelpScreen nav={setScreen}/>
      default:              return <HomeScreen {...homeProps}/>
    }
  }

  const themeValue = {
    t, lang,
    setLang: (l:"en"|"ar") => patch({ "prefs.language": l }),
    faceId: profile?.prefs?.faceId ?? false,
    setFaceId: (v:boolean) => patch({ "prefs.faceId": v }),
    notifPrefs: profile?.prefs?.notifications ?? { reminders:true, certs:true, growth:true },
    setNotifPref: (k:"reminders"|"certs"|"growth", v:boolean) => patch({ [`prefs.notifications.${k}`]: v }),
  }

  return (
    <ThCtx.Provider value={themeValue}>
      <AppCtx.Provider value={{ uid, profile, patch, holdings, buy, logOut, isDemo }}>
        <div style={{
          height:"100dvh", minHeight:"100dvh", display:"flex", flexDirection:"column", alignItems:"center",
          justifyContent:"flex-start", gap:0,
          background: t.frame, padding:0, position:"relative", overflow:"hidden", transition:"background 0.4s ease",
        }}>
          <div ref={frameRef} style={{
            position:"relative",
            // zoom scales layout, not just paint, so every px inside stays
            // proportional on a 320px SE and a 430px Pro Max alike.
            zoom: scale,
            width:"100%",
            // Reverted from calc(var(--vvh) / scale). --vvh froze whenever the
            // change came from a scroll, so the wrapper grew with 100dvh while
            // the frame stayed short and the wrapper's own gradient showed
            // through underneath — the pale block at the bottom of the screen.
            // Wrapper and frame now read the same unit and cannot disagree.
            height: `calc(100dvh / ${scale})`,
            // A wide window gets the same column, centred and capped, rather
            // than a 390px layout stretched across it.
            maxWidth: MAX_WIDTH,
            borderRadius:0,
            overflow:"hidden", display:"flex", flexDirection:"column",
            background:"transparent",
            flexShrink:0, zIndex:1, transition:"background 0.4s ease",
            // The inset is published as --safe-top and consumed by whichever
            // element sits at the top of each screen, so backgrounds run all
            // the way under the Dynamic Island instead of stopping below it.
            ["--safe-top" as any]: `calc(env(safe-area-inset-top) / ${scale})`,
          }}>
            <div style={{ position:"absolute", top:-70, left:-60, width:320, height:320, borderRadius:"50%", background:t.orbA, filter:"blur(80px)", pointerEvents:"none" }}/>
            <div style={{ position:"absolute", bottom:-40, right:-70, width:300, height:300, borderRadius:"50%", background:t.orbB, filter:"blur(90px)", pointerEvents:"none" }}/>

            <div ref={scrollRef} style={{ flex:1, overflowY:"auto" as const, position:"relative", zIndex:2, paddingBottom: showNav ? `calc(96px + env(safe-area-inset-bottom) / ${scale})` : 0 }}>
              {renderScreen()}
            </div>

            {DEBUG_VP && <ViewportProbe kbInset={kbInset} scale={scale}/>}
            {showTour && tour && tourKey && (
              <TutorialOverlay steps={tour} frameRef={frameRef} scale={scale} onDone={()=>patch({ [`flags.toursSeen.${tourKey}`]: true, "stats.points": (profile?.stats?.points ?? 0) + PTS_TOUR, "stats.level": progression((profile?.stats?.points ?? 0) + PTS_TOUR).level })}/>
            )}
          </div>
          {showNav && <div ref={navRef} style={{
            position:"fixed", left:"50%", transform:"translateX(-50%)",
            // Fixed distance from the bottom of the screen, plus the home
            // indicator. Not derived from visualViewport, so nothing shifts it.
            bottom:`calc(${NAV_GAP}px + env(safe-area-inset-bottom, 0px))`,
            width:`calc(min(100vw, ${MAX_WIDTH}px) - 28px)`, zIndex:60, pointerEvents:"auto",
          }}>
            <BottomNav active={screen} onSelect={setScreen}/>
          </div>}
        </div>
      </AppCtx.Provider>
    </ThCtx.Provider>
  )
}
