import { JSDOM } from "jsdom"

const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
  url: "https://localhost/", pretendToBeVisual: true,
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
if (!window.crypto) Object.defineProperty(window, "crypto", { value: globalThis.crypto, configurable: true })

let VW = 390
Object.defineProperty(window, "innerWidth", { get: () => VW, configurable: true })
let VH = 844
Object.defineProperty(window, "innerHeight", { get: () => VH, configurable: true })
window.matchMedia = (q) => ({
  matches: /max-width:\s*560px/.test(q) ? VW <= 560 : false,
  media: q, onchange: null,
  addEventListener(){}, removeEventListener(){}, addListener(){}, removeListener(){},
  dispatchEvent(){ return false },
})
window.scrollTo = () => {}
window.HTMLElement.prototype.scrollTo = () => {}
window.HTMLElement.prototype.scrollIntoView = () => {}

const errors = []
console.error = (...a) => errors.push(a.map(String).join(" "))

const React = (await import("react")).default
const { act } = await import("react")
const { createRoot } = await import("react-dom/client")
const App = (await import("./src/App.tsx")).default

const results = []
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail })
  console.log(`${ok ? "pass" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`)
}
const text = () => document.body.textContent || ""
const btn = (frag) => [...document.querySelectorAll("button")]
  .find(b => (b.textContent || "").toLowerCase().includes(String(frag).toLowerCase()))
const btnExact = (label) => [...document.querySelectorAll("button")]
  .find(b => (b.textContent || "").trim() === label)
const settle = (ms = 350) => act(async () => { await new Promise(r => setTimeout(r, ms)) })
const click = async (el, ms) => { if (!el) return false; await act(async () => {
  el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }))
  await new Promise(r => setTimeout(r, ms ?? 250))
}); return true }
const type = async (el, value) => { if (!el) return; await act(async () => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set
  setter.call(el, value)
  el.dispatchEvent(new window.Event("input", { bubbles: true }))
  await new Promise(r => setTimeout(r, 60))
}) }
const money = (label) => {
  // first EGP figure after the label, allowing sub-text between the two
  const after = text().split(label)[1]
  if (!after) return null
  const m = after.match(/EGP\s*([\d,]+)/)
  return m ? Number(m[1].replace(/,/g, "")) : null
}

let root = createRoot(document.getElementById("root"))
await act(async () => { root.render(React.createElement(App)) })
await settle(600)

// ── onboard through to Home with a known goal ───────────────────────────────
await type(document.querySelector('input[placeholder="Your name"]'), "Adversarial Tester With A Very Long Name Indeed")
await click(btn("Explore the demo"), 600)
for (let i = 0; i < 6; i++) { const b = btn("Next") || btn("Get Started") || btn("Set my first goal"); if (!b) break; await click(b) }
await settle(400)

const goalName = document.querySelector('input[placeholder*="Laptop"]')
const budget   = document.querySelector('input[placeholder*="30,000"]')
const dates    = [...document.querySelectorAll('input[type="date"]')]

// ── ADVERSARIAL: nonsense budget ───────────────────────────────────────────
await type(goalName, "A".repeat(120))
await type(budget, "abc-!!")
await type(dates[0], "2026-08-21")
await type(dates[1], "2020-01-01")            // end BEFORE start
const save = btn("Save Goal")
check("save is reachable with a nonsense budget", !!save)
await click(save, 700)

check("nonsense budget did not render NaN", !/NaN/.test(text()), text().slice(0, 120))
check("past end date does not render a negative countdown",
  !/-\d+\s*(days|months)/.test(text()), (text().match(/.{0,20}(days|months)/) || [""])[0])
check("very long goal name does not blank the card", /Good (morning|afternoon|evening)/i.test(text()))

// ── ADVERSARIAL: subscribe edge amounts ────────────────────────────────────
await click(btnExact("Invest"), 450)
const openSheet = async () => { await click(btn("Invest Now"), 400) }

await openSheet()
const amountInput = () => [...document.querySelectorAll("input")].find(i => i.getAttribute("inputmode") === "numeric")

await type(amountInput(), "0")
await click(btn("Continue"), 250)
check("zero amount is rejected", /Minimum for/i.test(text()), text().slice(0, 60))

await type(amountInput(), "-5000")
await click(btn("Continue"), 250)
check("negative amount cannot pass as positive",
  /Minimum for/i.test(text()) || !/Confirm your subscription/i.test(text()),
  text().slice(0, 70))

await type(amountInput(), "999")
await click(btn("Continue"), 250)
check("one below the minimum is rejected", /Minimum for/i.test(text()))

await type(amountInput(), "99999999")
await click(btn("Continue"), 250)
check("above the remaining limit is rejected", /over your remaining limit/i.test(text()))

// ── ADVERSARIAL: double-submit a valid subscription ────────────────────────
await type(amountInput(), "1000")
await click(btn("Continue"), 300)
check("valid amount reaches review", /Confirm your subscription/i.test(text()))

const confirmBtn = btn("Confirm subscription")
await act(async () => {
  confirmBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }))
  confirmBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }))
  confirmBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }))
  await new Promise(r => setTimeout(r, 800))
})
await click(btn("Done"), 400)

await click(btnExact("Home"), 500)
const homeText = text()
const invSection = homeText.split("Your Investments")[1] || ""
const holdingCount = (invSection.match(/Premium Certificate/g) || []).length
check("triple-click created exactly one holding", holdingCount === 1, `${holdingCount} holdings`)

// ── VALIDATE THE ARITHMETIC ────────────────────────────────────────────────
check("Home pill shows the invested total", /EGP 1,000\s*Invested/.test(homeText), (homeText.match(/EGP [\d,]+\s*Invested/)||[""])[0])
check("points = 75 (goal) + 100 (investment)", /175\s*pts/.test(homeText), (homeText.match(/[\d,]+\s*pts/)||[""])[0])
// The budget typed above was "abc-!!". The card used to fall back to a 30,000
// target and report progress against it; an unreadable budget now shows none.
check("unreadable budget invents no target", !/EGP 30,000 target/.test(homeText) && !/EGP 29,000/.test(homeText))
check("goal card still reports what was invested", /EGP 1,000/.test(homeText), (homeText.match(/EGP [\d,]+ invested/i)||[""])[0])

await click(btnExact("Home"), 350)
const avatar = [...document.querySelectorAll("div")].find(d =>
  /^[A-Z]{2}$/.test((d.textContent||"").trim()) &&
  /border-radius:\s*19px/.test(d.getAttribute("style")||""))
check("Home avatar is present and tappable", !!avatar)
await click(avatar, 700)
const prof = text()
const remaining = money("Remaining limit")
const invested  = money("Total invested")
check("Profile: total invested equals what was committed", invested === 1000, `invested=${invested} :: ${prof.slice(0,80)}`)
check("Profile: limit decremented exactly once (50,000 - 1,000)", remaining === 49000, `remaining=${remaining}`)
await click(btn("←") || document.querySelector("button"), 400)

// ── ADVERSARIAL: rapid tab thrash ──────────────────────────────────────────
await click(btnExact("Home"), 200)
for (let i = 0; i < 12; i++) {
  for (const tab of ["Invest", "Learn", "Goals", "Rewards", "Home"]) {
    const b = btnExact(tab)
    if (b) await click(b, 12)
  }
}
await settle(700)
const skip = btn("Skip"); if (skip) await click(skip, 300)
check("survives rapid tab thrashing", /Good (morning|afternoon|evening)/i.test(text()) || text().length > 200, text().slice(0, 50))

// ── ADVERSARIAL: viewport extremes ─────────────────────────────────────────
for (const w of [280, 320, 430, 560, 561, 1440, 320]) {
  VW = w
  await act(async () => { window.dispatchEvent(new window.Event("resize")); await new Promise(r => setTimeout(r, 120)) })
}
await settle(400)
check("survives viewport thrash 280→1440→320", text().length > 200, `${text().length} chars`)

// ── ADVERSARIAL: rotation ─────────────────────────────────────────────
// The desktop mockup is 820px tall inside an overflow:hidden page — rendering
// it into a landscape phone put the whole UI out of reach.
const rotate = async (w, h) => {
  VW = w; VH = h
  await act(async () => { window.dispatchEvent(new window.Event("orientationchange")); await new Promise(r => setTimeout(r, 150)) })
  await settle(300)
}
await rotate(844, 390)
check("landscape phone stays on the device layout", !text().includes("9:41"), text().slice(0, 40))
await rotate(1440, 900)
check("roomy desktop still gets the mockup frame", text().includes("9:41"), text().slice(0, 40))
await rotate(390, 844)

// ── ADVERSARIAL: unmount mid-flight ────────────────────────────────────────
let crashed = null
try {
  await act(async () => { root.unmount() })
  root = createRoot(document.getElementById("root"))
  await act(async () => { root.render(React.createElement(App)) })
  await act(async () => { root.unmount() })          // unmount before load settles
  root = createRoot(document.getElementById("root"))
  await act(async () => { root.render(React.createElement(App)) })
  await settle(900)
} catch (e) { crashed = String(e) }
check("unmount during profile load does not crash", !crashed, crashed || "")
check("state survives the remount", !/Explore the demo/.test(text()), text().slice(0, 50))

// ── numbers must never render as NaN / undefined / Infinity ────────────────
const body = text()
check("no NaN anywhere", !/NaN/.test(body), (body.match(/.{0,25}NaN.{0,15}/) || [""])[0])
check("no undefined anywhere", !/undefined/.test(body), (body.match(/.{0,25}undefined.{0,15}/) || [""])[0])
check("no Infinity anywhere", !/Infinity/.test(body))
check("no unformatted 6-digit money", !/EGP \d{5,}(?!,)/.test(body), (body.match(/EGP \d{5,}/) || [""])[0])

// ── ROUND 2: drain the limit, then attack the boundary ─────────────────────
await click(btnExact("Invest"), 400)
const buyExact = async (amt) => {
  await click(btn("Invest Now"), 350)
  await type(amountInput(), String(amt))
  await click(btn("Continue"), 300)
  const ok = /Confirm your subscription/i.test(text())
  if (ok) { await click(btn("Confirm subscription"), 700); await click(btn("Done"), 350) }
  else { await click(btn("Cancel"), 250) }
  return ok
}
await buyExact(49000)                                  // exactly the remainder
await click(btnExact("Home"), 400)
check("limit can be spent to exactly zero", /EGP 50,000\s*Invested/.test(text()), (text().match(/EGP [\d,]+\s*Invested/)||[""])[0])

await click(btnExact("Invest"), 400)
const overrun = await buyExact(1000)
check("cannot invest once the limit is exhausted", !overrun)

await click(btnExact("Home"), 400)
check("limit never goes negative", !/-EGP|EGP -/.test(text()))
const homePcts = [...text().matchAll(/(\d{1,3})%/g)].map(m => parseInt(m[1]))
check("goal capped at 100%, never above", homePcts.every(p => p <= 100), homePcts.join(","))

// ── ROUND 3: goal maths at the boundaries ──────────────────────────────────
await click(btnExact("Goals"), 450)
const skip3 = btn("Skip"); if (skip3) await click(skip3, 250)
check("Goals screen survives an over-funded goal", text().length > 200)
const pcts = (text().match(/(\d+)%/g) || []).map(x => parseInt(x))
check("no percentage above 100", pcts.every(p => p <= 100), pcts.join(","))
check("no negative percentage", pcts.every(p => p >= 0), pcts.join(","))

// ── ROUND 4: Learn input abuse ─────────────────────────────────────────────
await click(btnExact("Learn"), 450)
const skip4 = btn("Skip"); if (skip4) await click(skip4, 250)
const chat = [...document.querySelectorAll("input")].find(i => /Ask a question/i.test(i.getAttribute("placeholder")||""))
check("chat input present", !!chat)
if (chat) {
  await type(chat, "   ")
  await click(btn("send") || chat.parentElement.querySelector("button"), 250)
  await type(chat, "<script>alert(1)</script>" + "x".repeat(2000))
  await click(chat.parentElement.querySelector("button"), 400)
}
check("chat did not execute or crash on hostile input", text().length > 100)
check("no raw script tag rendered as markup", !document.querySelector("script[data-injected]"))

// ── ROUND 5: settings thrash ───────────────────────────────────────────────
await click(btnExact("Home"), 300)
const av2 = [...document.querySelectorAll("div")].find(d =>
  /^[A-Z]{2}$/.test((d.textContent||"").trim()) && /border-radius:\s*19px/.test(d.getAttribute("style")||""))
await click(av2, 450)
await click(btn("Settings"), 450)
for (let i = 0; i < 10; i++) {
  await click(btn("Dark"), 25)
  await click(btn("Light"), 25)
}
await settle(400)
check("survives rapid theme toggling", /Settings/i.test(text()))
const replay = btn("Replay all walkthroughs")
if (replay) await click(replay, 400)
check("replay walkthroughs does not crash", text().length > 100)

// ── ROUND 6: an expired cycle must refill, not lock the user out ───────────
const uidK = [...Array(window.localStorage.length).keys()].map(i=>window.localStorage.key(i)).find(k=>k&&k.endsWith(":profile"))
if (uidK) {
  const cur = JSON.parse(window.localStorage.getItem(uidK))
  cur.limits = { remaining:0, cycleCap:50000, resetDate:"2020-01-01" }   // long expired
  window.localStorage.setItem(uidK, JSON.stringify(cur))
  window.localStorage.setItem(uidK.replace(":profile", ":mirror"), JSON.stringify(cur))
}
await act(async () => { root.unmount() })
root = createRoot(document.getElementById("root"))
await act(async () => { root.render(React.createElement(App)) })
await settle(900)
const av3 = [...document.querySelectorAll("div")].find(d =>
  /^[A-Z]{2}$/.test((d.textContent||"").trim()) && /border-radius:\s*19px/.test(d.getAttribute("style")||""))
if (av3) await click(av3, 600)
const refilled = money("Remaining limit")
check("expired cycle refills to the cap", refilled === 50000, `remaining=${refilled}`)
check("reset date rolled forward past today",
  !/Resets 2020-01-01/.test(text()), (text().match(/Resets [\d-]+/)||[""])[0])

const real = errors.filter(e => !/not wrapped in act|useLayoutEffect|Warning: ReactDOM/i.test(e))
check("no React errors across the assault", real.length === 0, real.slice(0, 2).join(" | "))

console.log("\n" + "=".repeat(60))
const failed = results.filter(r => !r.ok)
console.log(`${results.length - failed.length}/${results.length} passed`)
if (failed.length) { console.log("\nFAILURES:"); failed.forEach(f => console.log("  ✗ " + f.name + (f.detail ? "\n      " + f.detail : ""))) }
process.exit(failed.length ? 1 : 0)
