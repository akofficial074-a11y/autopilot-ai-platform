import {useState, useEffect} from "react"

const API = "http://localhost:8000"

async function api(p, o = {}) {
  const r = await fetch(API + p, {
    ...o,
    headers: {"Content-Type": "application/json", Authorization: "Bearer " + (localStorage.getItem("t") || "")},
    body: o.body && JSON.stringify(o.body),
  }).catch(() => {
    throw new Error("Cannot reach backend. Is it running?")
  })

  const d = await r.json().catch(() => ({}))
  if (r.status === 401 && localStorage.getItem("t")) {
    localStorage.removeItem("t")
    location.hash = "#/login"
    location.reload()
  }
  if (!r.ok) throw new Error(typeof d.detail === "string" ? d.detail : "Something went wrong")
  return d
}

const pub = ["#/", "#/login", "#/register"]

export default function App() {
  const [me, setMe] = useState(null), [ready, setReady] = useState(false), [h, setH] = useState(location.hash || "#/")

  useEffect(() => {
    const f = () => setH(location.hash || "#/")
    addEventListener("hashchange", f)
    return () => removeEventListener("hashchange", f)
  }, [])

  const load = async () => {
    if (!localStorage.getItem("t")) {
      setMe(null)
      setReady(true)
      return
    }
    try {
      setMe(await api("/me"))
    } catch {
      setMe(null)
    }
    setReady(true)
  }

  useEffect(() => {
    load()
  }, [])

  let t = h
  if (ready) {
    if (!me) {
      if (!pub.includes(h)) t = "#/login"
    } else if (!me.has_business) {
      t = "#/business"
    } else if (pub.includes(h) || h === "#/business") {
      t = "#/dashboard"
    }
  }

  useEffect(() => {
    if (t !== h) location.hash = t
  })

  if (!ready) return <p className="c">Loading…</p>
  if (t !== h) return null

  const p = t.slice(2)
  const login = async (d) => {
    localStorage.setItem("t", d.token)
    await load()
  }
  const out = () => {
    localStorage.removeItem("t")
    setMe(null)
    location.hash = "#/"
  }

  if (!me) return p === "login" || p === "register" ? <Auth mode={p} done={login} /> : <Landing />
  if (!me.has_business) return <div className="c"><h2>Welcome, {me.name}. Tell us about your business</h2><BizForm done={load} /></div>

  const nav = [["dashboard", "Dashboard"], ["counsel", "AI Counsellor"], ["chat", "Chatbot"], ["parts", "Spare Parts Finder"], ["profile", "Business Profile"]]

  return (
    <div>
      <nav className="side">
        <div className="logo">AutoPilot AI</div>
        {nav.map(([k, l]) => <a key={k} href={"#/" + k} className={p === k ? "on" : ""}>{l}</a>)}
        <button className="g" onClick={out}>Logout</button>
      </nav>
      <main className="main">
        {p === "counsel" ? <Counsel /> : p === "chat" ? <Chat /> : p === "parts" ? <Parts /> : p === "profile" ? <div className="c"><h2>Business Profile</h2><BizForm done={load} edit /></div> : <Dash />}
      </main>
    </div>
  )
}

function Landing() {
  return (
    <div>
      <div className="hero">
        <div className="logo">AutoPilot AI</div>
        <h1>Run your multi-brand service centre smarter</h1>
        <p>Analytics, an AI business counsellor, and a rare spare-parts finder with seller comparison. Runs fully offline on your own computer.</p>
        <a className="btn" href="#/register">Get started</a>
        <a className="btn g" href="#/login">Login</a>
      </div>
      <div className="c grid" style={{maxWidth: 900}}>{["Business dashboard", "AI counsellor & action plan", "Rare parts finder"].map((x) => <div className="card" key={x}><h3>{x}</h3></div>)}</div>
    </div>
  )
}

function Auth({mode, done}) {
  const [f, setF] = useState({name: "", email: "", password: ""}), [err, setErr] = useState(""), [b, setB] = useState(false), reg = mode === "register"
  const sub = async (e) => {
    e.preventDefault(); setErr(""); setB(true)
    try {
      await done(await api("/" + mode, {method: "POST", body: f}))
    } catch (x) {
      setErr(x.message)
    }
    setB(false)
  }

  return (
    <div className="c">
      <div className="card">
        <div className="logo">AutoPilot AI</div>
        <h2>{reg ? "Create account" : "Login"}</h2>
        <form onSubmit={sub}>
          {reg && <input placeholder="Your name" value={f.name} onChange={(e) => setF({...f, name: e.target.value})} />}
          <input type="email" placeholder="Email" value={f.email} onChange={(e) => setF({...f, email: e.target.value})} />
          <input type="password" placeholder="Password (6+ characters)" value={f.password} onChange={(e) => setF({...f, password: e.target.value})} />
          {err && <div className="err">{err}</div>}
          <button disabled={b}>{b ? "Please wait…" : reg ? "Register" : "Login"}</button>
        </form>
        <p>{reg ? <a href="#/login">Already registered? Login</a> : <a href="#/register">New here? Register</a>} · <a href="#/">Home</a></p>
      </div>
    </div>
  )
}

const F = [["name", "Business name"], ["owner", "Owner name"], ["city", "City / location (e.g. Coimbatore, Chennai)"], ["brands", "Brands handled (comma separated)"], ["branches", "Number of branches", "number"], ["services", "Services (comma separated)"], ["employees", "Employees", "number"], ["customers", "Customers per month", "number"], ["revenue", "Monthly revenue (₹)", "number"], ["challenges", "Business challenges", "area"], ["inventory", "Inventory concerns", "area"]]

function BizForm({done, edit}) {
  const [f, setF] = useState({}), [err, setErr] = useState(""), [ok, setOk] = useState(""), [b, setB] = useState(false)
  useEffect(() => {
    api("/business").then((d) => setF({...d, brands: (d.brands || []).join(", "), services: (d.services || []).join(", ")})).catch(() => {})
  }, [])

  const sub = async (e) => {
    e.preventDefault(); setErr(""); setOk(""); setB(true)
    try {
      await api("/business", {method: "PUT", body: f})
      setOk("Saved!")
      await done()
    } catch (x) {
      setErr(x.message)
    }
    setB(false)
  }

  return (
    <form className="card" onSubmit={sub}>
      {F.map(([k, l, t]) => <label key={k}>{l}{t === "area" ? <textarea rows="2" value={f[k] || ""} onChange={(e) => setF({...f, [k]: e.target.value})} /> : <input type={t || "text"} min="0" value={f[k] ?? ""} onChange={(e) => setF({...f, [k]: e.target.value})} />}</label>)}
      {err && <div className="err">{err}</div>}
      {ok && <div className="ok">{ok}</div>}
      <button disabled={b}>{b ? "Saving…" : edit ? "Update" : "Save & continue"}</button>
    </form>
  )
}

const Bar = ({l, v, max = 100}) => <div className="br"><span>{l}</span><i><b style={{width: Math.min(100, v / max * 100) + "%"}} /></i><em>{v}</em></div>

function Dash() {
  const [d, setD] = useState(null), [err, setErr] = useState("")
  useEffect(() => { api("/dashboard").then(setD).catch((e) => setErr(e.message)) }, [])
  if (err) return <p className="err">{err}</p>
  if (!d) return <p>Loading…</p>

  const b = d.b, mx = Math.max(...d.trend, 1)

  return (
    <div>
      <h2>{b.name} — Dashboard</h2>
      <div className="grid">
        {[ ["Monthly revenue", "₹" + Number(b.revenue).toLocaleString("en-IN")], ["Customers / month", b.customers], ["Services", (b.services || []).length], ["Employees", b.employees], ["Branches", b.branches] ].map(([l, v]) => <div className="card kpi" key={l}>{l}<b>{v}</b></div>)}
      </div>
      <div className="g2">
        <div className="card">
          <h3>Revenue trend (demo)</h3>
          <div className="cols">{d.trend.map((v, i) => <div key={i}><b style={{height: v / mx * 110}} />{d.months[i]}</div>)}</div>
        </div>
        <div className="card"><h3>Service mix (demo %)</h3>{d.mix.map((m) => <Bar key={m.n} l={m.n} v={m.v} />)}</div>
        <div className="card"><h3>Inventory levels (demo %)</h3>{d.inv.map((m) => <Bar key={m.n} l={m.n} v={m.v} />)}</div>
        <div className="card"><h3>Business insights</h3><ul>{d.insights.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
      </div>
    </div>
  )
}

function Counsel() {
  const [r, setR] = useState({}), [busy, setBusy] = useState(false), [err, setErr] = useState("")
  useEffect(() => { api("/counsel").then(setR).catch(() => {}) }, [])
  const run = async () => {
    setBusy(true); setErr("")
    try { setR(await api("/counsel", {method: "POST"})) } catch (e) { setErr(e.message) }
    setBusy(false)
  }
  const K = ["Marketing", "Inventory", "Procurement", "Business Improvement", "Growth Strategy"]

  return (
    <div>
      <h2>AI Business Counsellor</h2>
      <button onClick={run} disabled={busy}>{busy ? "Analysing with local AI… can take up to a minute" : "Analyze my business"}</button>
      {err && <p className="err">{err}</p>}
      {r.source && <p><small>Source: {r.source}</small></p>}
      {r.ActionPlan && (
        <>
          <div className="g2">{K.map((k) => <div className="card" key={k}><h3>{k}</h3><ul>{(r[k] || []).map((x, i) => <li key={i}>{typeof x === "string" ? x : JSON.stringify(x)}</li>)}</ul></div>)}</div>
          <div className="card tw"><h3>Action Plan</h3><table><thead><tr><th>Action</th><th>Reason</th><th>Priority</th><th>Expected Benefit</th><th>Timeframe</th></tr></thead><tbody>{r.ActionPlan.map((a, i) => <tr key={i}><td>{a.Action}</td><td>{a.Reason}</td><td><span className={"badge " + a.Priority}>{a.Priority}</span></td><td>{a.Benefit}</td><td>{a.Timeframe}</td></tr>)}</tbody></table></div>
        </>
      )}
    </div>
  )
}

function cleanAiText(text = "") {
  const cleaned = String(text)
    .replace(/\b\d+\s*thy\s*:/gi, "")
    .replace(/\b[A-Za-z]+\s*thy\s*:/gi, "")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()

  return cleaned || "No response generated."
}

function renderChatText(text = "") {
  const cleaned = cleanAiText(text)
  const lines = cleaned.split(/\n+/).map((l) => l.trim()).filter(Boolean)
  const blocks = []
  const bullets = []

  const pushList = () => {
    if (bullets.length) {
      blocks.push(<ul key={blocks.length} className="chat-list">{bullets.map((b, i) => <li key={i}>{b}</li>)}</ul>)
      bullets.length = 0
    }
  }

  for (const line of lines) {
    if (/^#{1,3}\s+/.test(line)) {
      pushList()
      const heading = line.replace(/^#{1,3}\s+/, "")
      blocks.push(<h4 key={blocks.length} className="chat-heading">{heading}</h4>)
      continue
    }
    if (/^[-*•]\s+/.test(line)) {
      bullets.push(line.replace(/^[-*•]\s+/, ""))
      continue
    }
    if (/^\d+\.\s+/.test(line)) {
      bullets.push(line.replace(/^\d+\.\s+/, ""))
      continue
    }
    if (/^[A-Za-z][A-Za-z0-9 /&()%-]+:\s*$/.test(line)) {
      pushList()
      blocks.push(<h4 key={blocks.length} className="chat-heading">{line.replace(/:\s*$/, "")}</h4>)
      continue
    }
    if (line.length < 80 && /^[A-Z][^.!?]+$/.test(line)) {
      pushList()
      blocks.push(<h4 key={blocks.length} className="chat-heading">{line}</h4>)
      continue
    }

    pushList()
    blocks.push(<p key={blocks.length} className="chat-copy">{line}</p>)
  }

  pushList()
  return <div className="chat-article">{blocks}</div>
}

function Chat() {
  const [m, setM] = useState([]), [t, setT] = useState(""), [busy, setBusy] = useState(false), [err, setErr] = useState("")
  useEffect(() => { api("/chat").then(setM).catch(() => {}) }, [])

  const send = async (e) => {
    e.preventDefault(); if (!t.trim()) return
    const q = t; setT(""); setErr(""); setBusy(true); setM((x) => [...x, {r: "User", t: q}])
    try {
      const d = await api("/chat", {method: "POST", body: {msg: q}})
      setM((x) => [...x, {r: "Assistant", t: d.reply}])
    } catch (x) {
      setErr(x.message)
    }
    setBusy(false)
  }

  return (
    <div>
      <h2>Chatbot</h2>
      <div className="card chat">
        {m.length === 0 && <p>Ask anything about your business.</p>}
        {m.map((x, i) => <div key={i} className={"chat-row " + x.r[0].toLowerCase()}><div className="chat-bubble"><strong>{x.r}:</strong>{renderChatText(x.t)}</div></div>)}
        {busy && <div className="chat-row assistant"><div className="chat-bubble"><strong>Assistant:</strong><p className="chat-copy">Thinking…</p></div></div>}
      </div>
      {err && <p className="err">{err}</p>}
      <form onSubmit={send} style={{display: "flex", gap: 8}}>
        <input value={t} onChange={(e) => setT(e.target.value)} placeholder="Type your question" />
        <button disabled={busy}>Send</button>
      </form>
    </div>
  )
}

const PR = {Balanced: [30, 20, 20, 15, 15], Cheapest: [60, 10, 10, 10, 10], Fastest: [10, 50, 10, 20, 10], "Best quality": [10, 10, 60, 5, 15]}

function Parts() {
  const [f, setF] = useState({q: "", brand: "", model: "", year: ""}), [w, setW] = useState(PR.Balanced), [rows, setRows] = useState(null), [err, setErr] = useState("")
  const WL = ["Price", "Delivery speed", "Quality", "Distance", "Availability"]

  const go = async (e) => {
    e && e.preventDefault(); setErr("")
    const qs = new URLSearchParams({...Object.fromEntries(Object.entries(f).filter(([, v]) => v)), wp: w[0], wd: w[1], wr: w[2], wl: w[3], wa: w[4]})
    try {
      setRows(await api("/parts?" + qs))
    } catch (x) {
      setErr(x.message)
    }
  }

  useEffect(() => { go() }, [])

  return (
    <div>
      <h2>Rare Spare Parts Finder</h2>
      <form className="card" onSubmit={go}>
        <div className="grid">{[["q", "Part name or number"], ["brand", "Vehicle brand"], ["model", "Model"], ["year", "Year"]].map(([k, l]) => <label key={k}>{l}<input value={f[k]} onChange={(e) => setF({...f, [k]: e.target.value})} /></label>)}</div>
        <b>Best Match weights: </b>{Object.keys(PR).map((k) => <button type="button" className="g" style={{margin: "0 6px 6px 0"}} key={k} onClick={() => setW(PR[k])}>{k}</button>)}
        <div className="grid">{WL.map((l, i) => <label key={l}>{l}: {w[i]}<input type="range" min="0" max="100" value={w[i]} onChange={(e) => setW(w.map((x, j) => j === i ? +e.target.value : x))} /></label>)}</div>
        <button>Search</button>
      </form>
      {err && <p className="err">{err}</p>}
      {rows && (rows.length === 0 ? <p>No parts found.</p> : <div className="card tw"><table><thead><tr><th>Part</th><th>Compatible with</th><th>Seller</th><th>Price</th><th>Rating</th><th>Delivery</th><th>Warranty</th><th>Availability</th><th>Match score</th></tr></thead><tbody>{rows.map((r, i) => <tr key={i}><td><b>{r.part_name}</b><br />{r.part_number}</td><td>{r.fits}</td><td>{r.seller_name}<br />{r.seller_city}</td><td>₹{r.price}<br />+₹{r.delivery_charge} delivery</td><td>⭐ {r.rating}</td><td>{r.delivery_days} days<br />{r.distance_km} km</td><td>{r.warranty}</td><td>{r.availability}</td><td>{r.best && <span className="badge best">Best Match</span>}<br /><b>{r.score}/100</b><br /><small>{Object.entries(r.w).map(([k, v]) => k + " " + v).join(" · ")}</small></td></tr>)}</tbody></table></div>)}
    </div>
  )
}
