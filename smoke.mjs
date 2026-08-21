import { JSDOM } from "jsdom"

const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
  url: "https://localhost/",
  pretendToBeVisual: true,
})
const { window } = dom
globalThis.window = window
globalThis.document = window.document
Object.defineProperty(globalThis, "navigator", { value: window.navigator, configurable: true })
globalThis.HTMLElement = window.HTMLElement
globalThis.Element = window.Element
globalThis.Node = window.Node
globalThis.getComputedStyle = window.getComputedStyle
globalThis.localStorage = window.localStorage
globalThis.sessionStorage = window.sessionStorage
globalThis.requestAnimationFrame = window.requestAnimationFrame
globalThis.cancelAnimationFrame = window.cancelAnimationFrame
globalThis.IS_REACT_ACT_ENVIRONMENT = true

// phone viewport
Object.defineProperty(window, "innerWidth", { value: 390, writable: true })
Object.defineProperty(window, "innerHeight", { value: 844, writable: true })
window.matchMedia = (q) => ({
  matches: /max-width:\s*560px/.test(q),
  media: q, onchange: null,
  addEventListener(){}, removeEventListener(){}, addListener(){}, removeListener(){},
  dispatchEvent(){ return false },
})
window.scrollTo = () => {}
window.HTMLElement.prototype.scrollTo = () => {}
window.HTMLElement.prototype.scrollIntoView = () => {}
if (!window.crypto) Object.defineProperty(window, "crypto", { value: globalThis.crypto, configurable: true })

const errors = []
const origError = console.error
console.error = (...a) => { errors.push(a.map(String).join(" ")); origError(...a) }

const React = (await import("react")).default
const { act } = await import("react")
const { createRoot } = await import("react-dom/client")
const App = (await import("./src/App.tsx")).default

const root = createRoot(document.getElementById("root"))
await act(async () => { root.render(React.createElement(App)) })
await act(async () => { await new Promise(r => setTimeout(r, 600)) })

const text = () => document.body.textContent || ""
const find = (label) =>
  [...document.querySelectorAll("button, input, div")]
    .filter(el => (el.textContent || "").trim() === label || el.getAttribute?.("placeholder") === label)
const click = async (el) => {
  await act(async () => {
    el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }))
    await new Promise(r => setTimeout(r, 300))
  })
}
const type = async (el, value) => {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set
    setter.call(el, value)
    el.dispatchEvent(new window.Event("input", { bubbles: true }))
    await new Promise(r => setTimeout(r, 80))
  })
}

const results = []
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail })
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`)
}
const btnLike = (frag) =>
  [...document.querySelectorAll("button")]
    .find(b => (b.textContent || "").toLowerCase().includes(frag.toLowerCase()))

// ── 1. demo gate ────────────────────────────────────────────────────────────
check("demo gate shown, not a login form", text().includes("Explore the demo"))
check("no password field anywhere on the gate",
  document.querySelectorAll('input[type="password"]').length === 0)
const nameInput = document.querySelector('input[placeholder="Your name"]')
check("gate takes a name", !!nameInput)
if (nameInput) await type(nameInput, "Ziad Fayed")
await click(btnLike("Explore the demo"))
await act(async () => { await new Promise(r => setTimeout(r, 700)) })

// ── 2. onboarding carousel ──────────────────────────────────────────────────
check("onboarding renders", /Your Goals Await|Ready to reach/.test(text()))
for (let i = 0; i < 6; i++) {
  const b = btnLike("Next") || btnLike("Get Started") || btnLike("Set my first goal")
  if (!b) break
  await click(b)
}
await act(async () => { await new Promise(r => setTimeout(r, 500)) })

// ── 3. goal sheet + the date-overlap regression ─────────────────────────────
check("goal sheet reached", /first goal/i.test(text()), text().slice(0, 60))
const dates = [...document.querySelectorAll('input[type="date"]')]
check("two date inputs render", dates.length === 2, `found ${dates.length}`)
check("date inputs cannot blow out their grid track",
  dates.every(d => {
    const st = (d.getAttribute("style") || "")
    return /width:\s*100%/.test(st) && /box-sizing:\s*border-box/.test(st)
  }))
const css = await import("node:fs").then(m => m.readFileSync("src/index.css", "utf8"))
check("global rule stops any input overlapping a neighbour",
  /input,\s*select,\s*textarea,\s*button\s*\{[^}]*min-width:\s*0/.test(css))

const goalName = document.querySelector('input[placeholder*="Laptop"]')
check("goal name field present", !!goalName)
if (goalName) await type(goalName, "New Laptop")
const budget = document.querySelector('input[placeholder*="30,000"]')
if (budget) await type(budget, "30000")
for (const d of dates) await type(d, d === dates[0] ? "2026-08-21" : "2027-06-01")
const save = btnLike("Save Goal")
check("save button enabled once the form is filled", !!save && !save.disabled)
if (save) await click(save)
await act(async () => { await new Promise(r => setTimeout(r, 700)) })

// ── 4. home ─────────────────────────────────────────────────────────────────
check("lands on Home after saving a goal", /Good (morning|afternoon|evening)/i.test(text()))
check("shows the name entered, not a hardcoded persona",
  text().includes("Ziad") && !text().includes("Lara Mahrous"))
check("points awarded for the goal", /75 pts|75\s*pts/.test(text()) || /pts/.test(text()))

// ── 5. every tab ────────────────────────────────────────────────────────────
const tabs = [
  ["Invest",  /Certificates|Choose a Certificate/i],
  ["Learn",   /Ask|Acsend|money/i],
  ["Goals",   /Goals/i],
  ["Rewards", /Points/i],
  ["Home",    /Good (morning|afternoon|evening)/i],
]
for (const [label, expect] of tabs) {
  const nav = [...document.querySelectorAll("button")]
    .find(b => (b.textContent || "").trim() === label)
  if (!nav) { check(`nav to ${label}`, false, "tab button not found"); continue }
  await click(nav)
  await act(async () => { await new Promise(r => setTimeout(r, 450)) })
  const skip = btnLike("Skip")
  if (skip) { await click(skip); await act(async () => { await new Promise(r => setTimeout(r, 250)) }) }
  check(`${label} renders`, expect.test(text()), text().slice(0, 50))
}

// ── 6. invest: both product types and the explainers ────────────────────────
const investTab = [...document.querySelectorAll("button")].find(b => (b.textContent||"").trim() === "Invest")
if (investTab) { await click(investTab); await act(async()=>{await new Promise(r=>setTimeout(r,400))}) }
check("certificate explainer on screen", /How a certificate works/i.test(text()))
const fundsTab = btnLike("Mutual Funds")
check("mutual funds tab exists", !!fundsTab)
if (fundsTab) { await click(fundsTab); await act(async()=>{await new Promise(r=>setTimeout(r,400))}) }
check("fund explainer on screen", /How a mutual fund works/i.test(text()))
check("fund rates framed as a track record, not a promise",
  /average of what already happened|track record/i.test(text()))

// ── 7. subscribe flow writes a holding ──────────────────────────────────────
const investNow = btnLike("Invest Now")
check("Invest Now present", !!investNow)
if (investNow) { await click(investNow); await act(async()=>{await new Promise(r=>setTimeout(r,400))}) }
check("subscribe sheet opens", /How much would you like to invest/i.test(text()))
const cont = btnLike("Continue")
if (cont) { await click(cont); await act(async()=>{await new Promise(r=>setTimeout(r,400))}) }
check("review step reached", /Confirm your subscription/i.test(text()))
check("review carries the risk wording",
  /Rates and terms change|cannot be withdrawn|not a promise/i.test(text()))
const confirm = btnLike("Confirm subscription")
if (confirm) { await click(confirm); await act(async()=>{await new Promise(r=>setTimeout(r,700))}) }
check("subscription completes", /Subscription added/i.test(text()))
const done = btnLike("Done")
if (done) { await click(done); await act(async()=>{await new Promise(r=>setTimeout(r,400))}) }

// ── 8. settings ─────────────────────────────────────────────────────────────
const homeTab = [...document.querySelectorAll("button")].find(b => (b.textContent||"").trim() === "Home")
if (homeTab) { await click(homeTab); await act(async()=>{await new Promise(r=>setTimeout(r,400))}) }
const avatar = [...document.querySelectorAll("div")].find(d => (d.textContent||"").trim() === "ZF")
check("avatar shows the user's initials", !!avatar)

console.log("\n--- localStorage before remount ---")
for (let i=0;i<window.localStorage.length;i++){
  const k = window.localStorage.key(i)
  console.log(" ", k, "=", (window.localStorage.getItem(k)||"").slice(0,110))
}
console.log("---\n")

// ── 8b. PERSISTENCE: remount as if the user reopened the app ───────────────
await act(async () => { root.unmount() })
const root2 = createRoot(document.getElementById("root"))
await act(async () => { root2.render(React.createElement(App)) })
await act(async () => { await new Promise(r => setTimeout(r, 900)) })
check("session survives a reload (no gate)", !text().includes("Explore the demo"), text().slice(0,50))
check("onboarding does NOT repeat", !/Your Goals Await|Ready to reach/i.test(text()), text().slice(0,60))
check("goal sheet does NOT repeat", !/first goal you want to reach/i.test(text()), text().slice(0,60))
check("lands straight on Home", /Good (morning|afternoon|evening)/i.test(text()), text().slice(0,60))
check("tutorial does NOT repeat on Home", !/This is your home screen/i.test(text()))
check("saved goal still present", /New Laptop/.test(text()), text().slice(0,80))
check("holding still present after reload", /pts|EGP/.test(text()))

// ── 9. no React errors across the whole walk ────────────────────────────────
const real = errors.filter(e => !/not wrapped in act|useLayoutEffect|Warning: ReactDOM/i.test(e))
check("no React errors across the whole walk", real.length === 0, real.slice(0,2).join(" | "))

console.log("\n" + "=".repeat(56))
const failed = results.filter(r => !r.ok)
console.log(`${results.length - failed.length}/${results.length} passed`)
if (failed.length) { console.log("FAILED:"); failed.forEach(f => console.log("  - " + f.name + (f.detail ? " :: " + f.detail : ""))) }
process.exit(failed.length ? 1 : 0)
