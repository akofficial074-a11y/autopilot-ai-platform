import { useState, useEffect } from "react"
import * as XLSX from "xlsx"

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

function toNumber(v) {
  if (typeof v === "number" && Number.isFinite(v)) return v
  if (typeof v === "string") {
    const text = v.trim()
    const accountingNegative = /^\(.*\)$/.test(text)
    const cleaned = text.replace(/[$₹,\s%()]/g, "")
    const parsed = Number(cleaned) * (accountingNegative ? -1 : 1)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function readBusinessRows(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const data = event.target.result
        const workbook = XLSX.read(data, {type: /csv$/i.test(file.name) ? "string" : "array"})
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json(firstSheet, {defval: ""})
        resolve(rows)
      } catch {
        reject(new Error("Unable to read the uploaded business file."))
      }
    }
    reader.onerror = () => reject(new Error("Unable to read the uploaded file."))
    if (/\.(csv|xlsx|xls)$/i.test(file.name)) {
      if (/csv$/i.test(file.name)) reader.readAsText(file)
      else reader.readAsArrayBuffer(file)
    } else {
      reject(new Error("Please upload a CSV or Excel file."))
    }
  })
}

function loadStoredUpload() {
  try {
    const key = uploadStorageKey()
    let raw = localStorage.getItem(key)
    const legacy = localStorage.getItem("autopilot-ai-dashboard-upload")
    if (!raw && legacy && localStorage.getItem("t")) {
      raw = legacy
      localStorage.setItem(key, legacy)
    }
    if (legacy && localStorage.getItem("t")) localStorage.removeItem("autopilot-ai-dashboard-upload")
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function uploadStorageKey() {
  return `autopilot-ai-business-upload:${localStorage.getItem("t") || "guest"}`
}

function saveStoredUpload(summary) {
  localStorage.setItem(uploadStorageKey(), JSON.stringify(summary))
}

function removeStoredUpload() {
  localStorage.removeItem(uploadStorageKey())
}

async function getBusinessData() {
  try {
    const stored = await api("/business-data")
    if (stored && stored.fileName) {
      saveStoredUpload(stored)
      return stored
    }
    const cached = loadStoredUpload()
    if (cached) await api("/business-data", {method: "PUT", body: cached})
    return cached
  } catch {
    return loadStoredUpload()
  }
}

function getRowValue(row, labels) {
  const normalizedLabels = labels.map((label) => label.replace(/[^a-z0-9]/gi, "").toLowerCase())
  const entries = Object.entries(row).map(([key, value]) => [String(key).replace(/[^a-z0-9]/gi, "").toLowerCase(), value])
  const exact = entries.find(([key]) => normalizedLabels.includes(key))
  const partial = exact || entries.find(([key]) => normalizedLabels.some((label) => label.length >= 5 && key.includes(label)))
  if (partial) {
    const value = partial[1]
    return value === null || value === undefined || String(value).trim() === "" ? null : value
  }
  return null
}

function summarizeBusinessRows(rows, fileName) {
  const serviceCounter = {}
  const invCounter = {}
  const vehicleCounter = {}
  let totalRevenue = 0
  let totalCustomers = 0
  let totalBookings = 0
  let totalCosts = 0
  let totalPurchases = 0
  let directProfit = 0
  let hasRevenue = false
  let hasCustomers = false
  let hasBookings = false
  let hasCosts = false
  let hasPurchases = false
  let hasDirectProfit = false
  let hasInventoryQuantity = false
  const customerIds = new Set()
  const bookingIds = new Set()
  const revenueByMonth = {}

  rows.forEach((row) => {
    const revenueValue = getRowValue(row, ["revenue", "sales", "income", "amount", "total_revenue", "gross_sales", "invoice_total", "bill_total", "total_amount", "invoice_amount"])
    const customerValue = getRowValue(row, ["customers", "clients", "visits", "new_customers", "customer_count"])
    const bookingValue = getRowValue(row, ["bookings", "jobs", "orders", "appointments", "services_done"])
    const costValue = getRowValue(row, ["operating_expense", "cost_of_goods", "cost", "expenses", "expense", "cogs"])
    const purchaseValue = getRowValue(row, ["purchase_amount", "purchase_total", "purchase_cost", "purchases", "procurement_cost"])
    const profitValue = getRowValue(row, ["profit", "net_profit", "gross_profit"])
    const revenue = toNumber(revenueValue)
    const customerCount = toNumber(customerValue)
    const bookingCount = toNumber(bookingValue)
    const cost = toNumber(costValue)
    totalRevenue += revenue
    totalCustomers += customerCount
    if (bookingValue !== null && typeof bookingValue === "string" && Number.isNaN(Number(bookingValue.replace(/[,\s]/g, "")))) {
      bookingIds.add(bookingValue.trim())
    } else totalBookings += bookingCount
    totalCosts += cost
    totalPurchases += toNumber(purchaseValue)
    directProfit += toNumber(profitValue)
    hasRevenue ||= revenueValue !== null
    hasCustomers ||= customerValue !== null
    hasBookings ||= bookingValue !== null
    hasCosts ||= costValue !== null
    hasPurchases ||= purchaseValue !== null
    hasDirectProfit ||= profitValue !== null

    const customerId = getRowValue(row, ["customer_id", "client_id", "customer_name"])
    if (customerId !== null && String(customerId).trim()) customerIds.add(String(customerId).trim())
    const bookingId = getRowValue(row, ["booking_id", "job_id", "order_id", "appointment_id", "invoice_id"])
    if (bookingId !== null && String(bookingId).trim()) {
      bookingIds.add(String(bookingId).trim())
      hasBookings = true
    }

    const serviceValue = getRowValue(row, ["service", "category", "job_type", "service_type"])
    const serviceName = serviceValue === null ? "" : String(serviceValue).trim()
    if (serviceName) {
      const bookingIsId = typeof bookingValue === "string" && Number.isNaN(Number(bookingValue.replace(/[ ,\s]/g, "")))
      serviceCounter[serviceName] = (serviceCounter[serviceName] || 0) + (bookingValue === null || bookingIsId ? 1 : bookingCount)
    }

    const vehicleValue = getRowValue(row, ["vehicle_model", "vehicle_type", "vehicle", "model", "vehicle_make", "make"])
    const vehicleName = vehicleValue === null ? "" : String(vehicleValue).trim()
    if (vehicleName) vehicleCounter[vehicleName] = (vehicleCounter[vehicleName] || 0) + 1

    const itemValue = getRowValue(row, ["product", "part", "item_name", "sku", "inventory_item"])
    const itemName = itemValue === null ? "" : String(itemValue).trim()
    const quantityValue = getRowValue(row, ["quantity", "qty", "stock", "units"])
    if (itemName) {
      if (quantityValue !== null) {
        hasInventoryQuantity = true
        invCounter[itemName] = (invCounter[itemName] || 0) + toNumber(quantityValue)
      } else {
        invCounter[itemName] = (invCounter[itemName] || 0) + 1
      }
    }

    const dateValue = getRowValue(row, ["date", "invoice_date", "booking_date", "service_date", "purchase_date", "created_at"])
    if (dateValue !== null && revenueValue !== null) {
      let date
      if (typeof dateValue === "number") {
        const parsed = XLSX.SSF.parse_date_code(dateValue)
        if (parsed) date = new Date(parsed.y, parsed.m - 1, parsed.d)
      } else date = dateValue instanceof Date ? dateValue : new Date(dateValue)
      if (Number.isFinite(date.getTime())) {
        const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
        revenueByMonth[month] = (revenueByMonth[month] || 0) + revenue
      }
    }
  })

  const topServices = Object.entries(serviceCounter)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([label, count]) => ({n: label, v: count}))

  const inventoryItems = Object.entries(invCounter)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([label, count]) => ({n: label, v: count}))
  const topVehicles = Object.entries(vehicleCounter)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([label, count]) => ({n: label, v: count}))

  const trendEntries = Object.entries(revenueByMonth).sort(([a], [b]) => a.localeCompare(b)).slice(-12)
  const uniqueCustomers = customerIds.size || totalCustomers
  if (bookingIds.size && !totalBookings) totalBookings = bookingIds.size
  const profit = hasDirectProfit ? directProfit : hasCosts ? totalRevenue - totalCosts : null

  return {
    fileName,
    rows: rows.length,
    columns: rows.length ? Object.keys(rows[0]) : [],
    totalRevenue,
    totalCustomers: uniqueCustomers,
    totalBookings,
    totalCosts: hasCosts ? totalCosts : null,
    totalPurchases: hasPurchases ? totalPurchases : null,
    profit,
    avgTicket: totalBookings ? totalRevenue / totalBookings : null,
    hasRevenue,
    hasCustomers: hasCustomers || customerIds.size > 0,
    hasBookings,
    hasCosts,
    hasPurchases,
    hasInventoryQuantity,
    topServices,
    topVehicles,
    inventoryItems,
    trend: trendEntries.map(([month, value]) => ({month, value})),
    insights: [
      hasRevenue ? `Revenue in uploaded records: ₹${Number(totalRevenue).toLocaleString("en-IN")}` : "The uploaded file has no recognizable revenue column.",
      hasCustomers || customerIds.size ? `Customers in uploaded records: ${Number(uniqueCustomers).toLocaleString("en-IN")}` : "The uploaded file has no recognizable customer count or customer ID column.",
      hasBookings ? `Bookings or jobs recorded: ${Number(totalBookings).toLocaleString("en-IN")}` : "The uploaded file has no recognizable booking or job count column.",
      hasPurchases ? `Purchases in uploaded records: ₹${Number(totalPurchases).toLocaleString("en-IN")}` : "No purchase amount column was found in the uploaded file.",
      profit !== null ? `Profit from uploaded records: ₹${Number(profit).toLocaleString("en-IN")}` : "Profit needs a profit or expense/cost column in the uploaded file.",
    ],
  }
}

function normalizeVehicleType(row) {
  const value = getRowValue(row, ["vehicle_type", "wheeler_type", "vehicle_class"])
  const text = String(value || "").toLowerCase().replace(/\s+/g, "")
  if (/two|2[-_]?wheel|motorcycle|scooter|bike/.test(text)) return "Two-Wheeler"
  if (/four|4[-_]?wheel|car|sedan|suv/.test(text)) return "Four-Wheeler"
  return null
}

function buildUploadSummary(rows, fileName) {
  const typeByRow = rows.map(normalizeVehicleType)
  return {
    ...summarizeBusinessRows(rows, fileName),
    hasVehicleType: typeByRow.some(Boolean),
    byVehicleType: {
      "Two-Wheeler": summarizeBusinessRows(rows.filter((_, index) => typeByRow[index] === "Two-Wheeler"), fileName),
      "Four-Wheeler": summarizeBusinessRows(rows.filter((_, index) => typeByRow[index] === "Four-Wheeler"), fileName),
    },
  }
}

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

  const nav = [["dashboard", "Dashboard"], ["bookings", "Bookings"], ["counsel", "AI Counsellor"], ["chat", "Chatbot"], ["parts", "Spare Parts & Procurement"], ["profile", "Business Profile"]]

  return (
    <div>
      <nav className="side">
        <div className="logo">AutoPilot AI</div>
        {nav.map(([k, l]) => <a key={k} href={"#/" + k} className={p === k ? "on" : ""}>{l}</a>)}
        <button className="g" onClick={out}>Logout</button>
      </nav>
      <main className="main">
        {p === "bookings" ? <Bookings /> : p === "counsel" ? <Counsel /> : p === "chat" ? <Chat /> : p === "parts" ? <Parts /> : p === "profile" ? <div className="c"><h2>Business Profile</h2><BizForm done={load} edit /></div> : <Dash />}
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

const F = [["name", "Business name"], ["owner", "Owner name"], ["city", "City / location (e.g. Coimbatore, Chennai)"], ["brands", "Brands handled (comma separated)"], ["branches", "Number of branches", "number"], ["branch_names", "Branch names (comma separated)"], ["services", "Services (comma separated)"], ["employees", "Employees", "number"], ["customers", "Customers per month", "number"], ["revenue", "Monthly revenue (₹)", "number"], ["challenges", "Business challenges", "area"], ["inventory", "Inventory concerns", "area"]]

function BizForm({done, edit}) {
  const [f, setF] = useState({}), [err, setErr] = useState(""), [ok, setOk] = useState(""), [b, setB] = useState(false)
  const [upload, setUpload] = useState(loadStoredUpload()), [uploadError, setUploadError] = useState(""), [uploading, setUploading] = useState(false)
  useEffect(() => {
    api("/business").then((d) => setF({...d, brands: (d.brands || []).join(", "), services: (d.services || []).join(", "), branch_names: (d.branch_names || []).join(", ")})).catch(() => {})
    getBusinessData().then(setUpload)
  }, [])

  const handleUpload = async (event) => {
    const file = event.target.files && event.target.files[0]
    if (!file) return
    setUploadError("")
    setUploading(true)
    try {
      const rows = await readBusinessRows(file)
      if (!rows.length) throw new Error("The file has no data rows to analyze.")
      const summary = buildUploadSummary(rows, file.name)
      await api("/business-data", {method: "PUT", body: summary})
      setUpload(summary)
      saveStoredUpload(summary)
    } catch (x) {
      setUploadError(x.message)
    } finally {
      setUploading(false)
      event.target.value = ""
    }
  }

  const removeUpload = async () => {
    try {
      await api("/business-data", {method: "DELETE"})
      removeStoredUpload()
      setUpload(null)
      setUploadError("")
    } catch (error) {
      setUploadError(error.message)
    }
  }

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
      <section className="upload-section">
        <h3>Business data file</h3>
        <p className="muted">One CSV or Excel file is stored separately from this Business Profile and used as operational/historical data by Dashboard and AI Counsellor. Use columns such as date, revenue, customer, booking, service, part, quantity, cost or profit.</p>
        <div className="upload-actions">
          <label className="upload-box">
            <input type="file" accept=".csv,.xlsx,.xls" onChange={handleUpload} />
            <span>{uploading ? "Processing file…" : upload ? "Choose another file" : "Choose CSV or Excel file"}</span>
          </label>
          {upload && <button type="button" className="g" onClick={removeUpload}>Remove file</button>}
        </div>
        {upload && <p className="small muted">Current file: {upload.fileName} ({upload.rows} rows, {upload.columns?.length || 0} columns)</p>}
        {uploadError && <div className="err">{uploadError}</div>}
      </section>
      {err && <div className="err">{err}</div>}
      {ok && <div className="ok">{ok}</div>}
      <button disabled={b}>{b ? "Saving…" : edit ? "Update" : "Save & continue"}</button>
    </form>
  )
}

function Bookings() {
  const [business, setBusiness] = useState(null)
  const [bookings, setBookings] = useState([])
  const [slots, setSlots] = useState([])
  const [form, setForm] = useState({customer: "", vehicle_type: "Four-Wheeler", vehicle: "", service: "", problem: "", branch: "", date: "", time: ""})
  const [err, setErr] = useState("")
  const [notice, setNotice] = useState("")
  const [busy, setBusy] = useState(false)

  const loadBookings = async () => setBookings(await api("/bookings"))
  useEffect(() => {
    api("/business").then((data) => {
      setBusiness(data)
      const branches = data.branch_names || []
      setForm((current) => ({...current, branch: branches[0] || "Branch 1"}))
    }).catch((error) => setErr(error.message))
    loadBookings().catch((error) => setErr(error.message))
  }, [])

  useEffect(() => {
    if (!form.date || !form.branch) {
      setSlots([])
      return
    }
    const query = new URLSearchParams({date: form.date, branch: form.branch, vehicle_type: form.vehicle_type})
    api("/bookings/slots?" + query).then((data) => setSlots(data.available)).catch((error) => setErr(error.message))
  }, [form.date, form.branch, form.vehicle_type])

  const update = (key, value) => setForm((current) => ({...current, [key]: value}))
  const submit = async (event) => {
    event.preventDefault()
    setErr("")
    setNotice("")
    setBusy(true)
    try {
      await api("/bookings", {method: "POST", body: form})
      setNotice("Booking confirmed.")
      update("time", "")
      await loadBookings()
      const query = new URLSearchParams({date: form.date, branch: form.branch, vehicle_type: form.vehicle_type})
      setSlots((await api("/bookings/slots?" + query)).available)
    } catch (error) {
      setErr(error.message)
    } finally {
      setBusy(false)
    }
  }

  const cancel = async (booking) => {
    try {
      await api(`/bookings/${encodeURIComponent(booking.id)}?status=Cancelled`, {method: "PATCH"})
      await loadBookings()
    } catch (error) {
      setErr(error.message)
    }
  }

  const branchOptions = business?.branch_names?.length ? business.branch_names : Array.from({length: Math.max(1, Number(business?.branches) || 1)}, (_, index) => `Branch ${index + 1}`)
  const serviceOptions = business?.services?.length ? business.services : ["General Service"]
  const today = new Date().toISOString().slice(0, 10)

  return (
    <div>
      <h2>Bookings</h2>
      <form className="card booking-form" onSubmit={submit}>
        <h3>Customer and vehicle</h3>
        <div className="grid">
          <label>Customer name<input required value={form.customer} onChange={(event) => update("customer", event.target.value)} /></label>
          <label>Vehicle type<select value={form.vehicle_type} onChange={(event) => update("vehicle_type", event.target.value)}><option>Two-Wheeler</option><option>Four-Wheeler</option></select></label>
          <label>Vehicle / registration<input required value={form.vehicle} onChange={(event) => update("vehicle", event.target.value)} placeholder="Vehicle model or registration" /></label>
        </div>

        <h3>Service and branch</h3>
        <div className="grid">
          <label>Service<select required value={form.service} onChange={(event) => update("service", event.target.value)}><option value="">Choose a service</option>{serviceOptions.map((service) => <option key={service} value={service}>{service}</option>)}<option value="Other">Other</option></select></label>
          <label>Branch<select required value={form.branch} onChange={(event) => update("branch", event.target.value)}>{branchOptions.map((branch) => <option key={branch}>{branch}</option>)}</select></label>
          <label>Problem description<textarea rows="2" value={form.problem} onChange={(event) => update("problem", event.target.value)} placeholder="Describe the issue" /></label>
        </div>

        <h3>Date and available time</h3>
        <div className="grid">
          <label>Date<input required type="date" min={today} value={form.date} onChange={(event) => update("date", event.target.value)} /></label>
          <label>Time slot<select required value={form.time} onChange={(event) => update("time", event.target.value)} disabled={!form.date || !slots.length}><option value="">{slots.length ? "Choose an available slot" : "No available slots"}</option>{slots.map((slot) => <option key={slot}>{slot}</option>)}</select></label>
        </div>
        {err && <p className="err">{err}</p>}
        {notice && <p className="ok">{notice}</p>}
        <button disabled={busy || !form.time}>{busy ? "Confirming…" : "Confirm booking"}</button>
      </form>

      <section>
        <h3>Current bookings</h3>
        {bookings.length ? <div className="card tw"><table><thead><tr><th>Customer</th><th>Vehicle</th><th>Type</th><th>Service / problem</th><th>Branch</th><th>Date</th><th>Time</th><th>Status</th><th></th></tr></thead><tbody>{bookings.map((booking) => <tr key={booking.id}><td>{booking.customer}</td><td>{booking.vehicle}</td><td>{booking.vehicle_type}</td><td>{booking.service}{booking.problem ? <div className="small muted">{booking.problem}</div> : null}</td><td>{booking.branch}</td><td>{booking.date}</td><td>{booking.time}</td><td>{booking.status}</td><td>{booking.status === "Booked" && <button type="button" className="g" onClick={() => cancel(booking)}>Cancel</button>}</td></tr>)}</tbody></table></div> : <p className="muted">No bookings recorded yet.</p>}
      </section>
    </div>
  )
}

const Bar = ({l, v, max = 100}) => <div className="br"><span>{l}</span><i><b style={{width: Math.min(100, v / max * 100) + "%"}} /></i><em>{v}</em></div>

function Dash() {
  const [d, setD] = useState(null), [err, setErr] = useState(""), [upload, setUpload] = useState(loadStoredUpload()), [vehicleType, setVehicleType] = useState("All")
  useEffect(() => { api("/dashboard?vehicle_type=" + encodeURIComponent(vehicleType)).then(setD).catch((e) => setErr(e.message)) }, [vehicleType])
  useEffect(() => { getBusinessData().then((summary) => { if (summary) setUpload(summary) }) }, [])
  if (err) return <p className="err">{err}</p>
  if (!d) return <p>Loading…</p>

  const b = d.b
  const scopedUpload = upload ? vehicleType === "All" ? upload : upload.byVehicleType?.[vehicleType] : null
  const kpis = scopedUpload ? [
    scopedUpload.hasRevenue && ["Recorded revenue", "₹" + Number(scopedUpload.totalRevenue).toLocaleString("en-IN")],
    scopedUpload.hasCustomers && ["Recorded customers", Number(scopedUpload.totalCustomers).toLocaleString("en-IN")],
    scopedUpload.hasBookings && ["Recorded bookings/jobs", Number(scopedUpload.totalBookings).toLocaleString("en-IN")],
    scopedUpload.hasCosts && ["Recorded costs", "₹" + Number(scopedUpload.totalCosts).toLocaleString("en-IN")],
    scopedUpload.hasPurchases && ["Recorded purchases", "₹" + Number(scopedUpload.totalPurchases).toLocaleString("en-IN")],
    scopedUpload.profit !== null && ["Calculated profit", "₹" + Number(scopedUpload.profit).toLocaleString("en-IN")],
    scopedUpload.avgTicket !== null && ["Average ticket", "₹" + Number(scopedUpload.avgTicket).toLocaleString("en-IN")],
  ].filter(Boolean) : []
  const maxService = Math.max(1, ...(scopedUpload?.topServices || []).map((item) => item.v))
  const maxInventory = Math.max(1, ...(scopedUpload?.inventoryItems || []).map((item) => item.v))
  const maxVehicle = Math.max(1, ...(scopedUpload?.topVehicles || []).map((item) => item.v))

  return (
    <div>
      <h2>{b.name} — Dashboard</h2>
      <section className="dashboard-live">
        <div className="dashboard-live-head"><div><h3>Live bookings</h3><p className="small muted">Current booking records from the local database. The filter also scopes uploaded-file analytics when the file has a vehicle_type column.</p></div><div className="segmented" role="group" aria-label="Filter dashboard by vehicle type">{[["All", "All"], ["Two-Wheeler", "Two-Wheelers"], ["Four-Wheeler", "Four-Wheelers"]].map(([type, label]) => <button type="button" key={type} className={vehicleType === type ? "selected" : ""} aria-pressed={vehicleType === type} onClick={() => setVehicleType(type)}>{label}</button>)}</div></div>
        <div className="grid">{[["Bookings shown", d.booking_analytics?.total || 0], ["Booked", d.booking_analytics?.booked || 0], ["Completed", d.booking_analytics?.completed || 0], ["Two-Wheeler", d.booking_analytics?.two_wheeler || 0], ["Four-Wheeler", d.booking_analytics?.four_wheeler || 0]].map(([label, value]) => <div className="card kpi" key={label}>{label}<b>{value}</b></div>)}</div>
      </section>
      <div className="card dashboard-source">
        {upload ? <>
          <div><strong>Uploaded file analytics — {upload.fileName}</strong><div className="small muted">{scopedUpload?.rows || 0} matching records • {upload.columns?.length || 0} columns • {vehicleType} filter</div></div>
          <a href="#/profile">Manage business data</a>
        </> : <>
          <div><strong>Detailed analytics need business data</strong><div className="small muted">No uploaded business file is available. No demo figures are shown.</div></div>
          <a href="#/profile">Upload in Business Profile</a>
        </>}
      </div>

      {kpis.length > 0 && <div className="grid">{kpis.map(([l, v]) => <div className="card kpi" key={l}>{l}<b>{v}</b></div>)}</div>}

      <div className="g2">
        <div className="card">
          <h3>Revenue by month</h3>
          {scopedUpload?.trend?.length ? (() => {
            const max = Math.max(1, ...scopedUpload.trend.map((item) => item.value))
            return <div className="cols">{scopedUpload.trend.map((item) => <div key={item.month} title={`₹${Number(item.value).toLocaleString("en-IN")}`}><b style={{height: Math.max(8, item.value / max * 110)}} />{item.month}</div>)}</div>
          })() : <p className="muted">A date and revenue column are needed to calculate monthly revenue.</p>}
        </div>

        <div className="card">
          <h3>Services in uploaded records</h3>
          {scopedUpload?.topServices?.length ? scopedUpload.topServices.map((item) => <Bar key={item.n} l={item.n} v={item.v} max={maxService} />) : <p className="muted">No matching service records were found.</p>}
        </div>

        <div className="card">
          <h3>Vehicles in uploaded records</h3>
          {scopedUpload?.topVehicles?.length ? scopedUpload.topVehicles.map((item) => <Bar key={item.n} l={item.n} v={item.v} max={maxVehicle} />) : <p className="muted">No matching vehicle records were found.</p>}
        </div>

        <div className="card">
          <h3>{scopedUpload?.hasInventoryQuantity ? "Recorded inventory quantities" : "Inventory item records"}</h3>
          {scopedUpload?.inventoryItems?.length ? scopedUpload.inventoryItems.map((item) => <Bar key={item.n} l={item.n} v={item.v} max={maxInventory} />) : <p className="muted">No matching inventory records were found.</p>}
        </div>

        <div className="card">
          <h3>Data checks</h3>
          {scopedUpload ? <ul>{scopedUpload.insights.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p className="muted">{upload ? "This file has no vehicle_type column; choose All to view its full historical analysis." : "Upload a CSV or Excel file in Business Profile to calculate analytics from your records."}</p>}
        </div>
      </div>
    </div>
  )
}

function Counsel() {
  const [r, setR] = useState({}), [busy, setBusy] = useState(false), [err, setErr] = useState("")
  const run = async () => {
    setBusy(true); setErr(""); setR({})
    try { setR(await api("/counsel", {method: "POST", body: {data_context: await getBusinessData()}})) } catch (e) { setErr(e.message) }
    setBusy(false)
  }
  const K = ["Marketing", "Inventory", "Procurement", "Business Improvement", "Growth Strategy"]

  return (
    <div>
      <h2>AI Business Counsellor</h2>
      <button onClick={run} disabled={busy}>{busy ? "Analyzing current profile and uploaded data…" : "Analyze my business"}</button>
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
  const [threads, setThreads] = useState([]), [activeId, setActiveId] = useState(null)

  useEffect(() => {
    const saved = JSON.parse(localStorage.getItem("autopilot-ai-chat-threads") || "[]")
    if (saved.length) {
      const restored = saved.map((thread) => ({
        ...thread,
        conversationId: thread.conversationId || String(thread.id),
        legacy: thread.legacy ?? !thread.conversationId,
      }))
      setThreads(restored)
      setActiveId(restored[0].id)
      setM(restored[0].messages || [])
      localStorage.setItem("autopilot-ai-chat-threads", JSON.stringify(restored))
      return
    }

    if (localStorage.getItem("autopilot-ai-chat-legacy-dismissed") === "true") {
      const id = crypto.randomUUID()
      const starter = [{id, conversationId: id, legacy: false, title: "New conversation", messages: []}]
      setThreads(starter)
      setActiveId(id)
      setM([])
      localStorage.setItem("autopilot-ai-chat-threads", JSON.stringify(starter))
      return
    }

    api("/chat").then((rows) => {
      const history = rows.map((row) => ({r: row.r, t: row.t}))
      if (history.length) {
        const id = crypto.randomUUID()
        const starter = [{id, conversationId: id, legacy: true, title: "Previous chat", messages: history}]
        setThreads(starter)
        setActiveId(starter[0].id)
        setM(history)
        localStorage.setItem("autopilot-ai-chat-threads", JSON.stringify(starter))
      } else {
        const id = crypto.randomUUID()
        const starter = [{id, conversationId: id, legacy: false, title: "New conversation", messages: []}]
        setThreads(starter)
        setActiveId(starter[0].id)
        setM([])
        localStorage.setItem("autopilot-ai-chat-threads", JSON.stringify(starter))
      }
    }).catch(() => {
      const id = crypto.randomUUID()
      const starter = [{id, conversationId: id, legacy: false, title: "New conversation", messages: []}]
      setThreads(starter)
      setActiveId(starter[0].id)
      setM([])
      localStorage.setItem("autopilot-ai-chat-threads", JSON.stringify(starter))
    })
  }, [])

  useEffect(() => {
    if (!activeId || !threads.length) return
    const next = threads.map((thread) => thread.id === activeId ? {...thread, messages: m} : thread)
    setThreads(next)
    localStorage.setItem("autopilot-ai-chat-threads", JSON.stringify(next))
  }, [m, activeId])

  const createNewThread = () => {
    const id = crypto.randomUUID()
    const fresh = [{id, conversationId: id, legacy: false, title: "New conversation", messages: []}, ...threads]
    setThreads(fresh)
    setActiveId(id)
    setM([])
    localStorage.setItem("autopilot-ai-chat-threads", JSON.stringify(fresh))
  }

  const openThread = (id) => {
    const found = threads.find((thread) => thread.id === id)
    if (!found) return
    setActiveId(id)
    setM(found.messages || [])
  }

  const deleteThread = async (thread) => {
    setErr("")
    try {
      if (thread.legacy) localStorage.setItem("autopilot-ai-chat-legacy-dismissed", "true")
      else await api(`/chat/${encodeURIComponent(thread.conversationId)}`, {method: "DELETE"})
      const remaining = threads.filter((item) => item.id !== thread.id)
      setThreads(remaining)
      localStorage.setItem("autopilot-ai-chat-threads", JSON.stringify(remaining))
      if (activeId === thread.id) {
        setActiveId(remaining[0]?.id || null)
        setM(remaining[0]?.messages || [])
      }
    } catch (x) {
      setErr(x.message)
    }
  }

  const send = async (e) => {
    e.preventDefault(); if (!t.trim()) return
    const q = t; setT(""); setErr(""); setBusy(true)
    const nextMessages = [...m, {r: "User", t: q}]
    setM(nextMessages)
    try {
      const d = await api("/chat", {method: "POST", body: {msg: q, data_context: await getBusinessData(), conversation_id: activeId, history: m.slice(-6)}})
      const finalMessages = [...nextMessages, {r: "Assistant", t: d.reply, source: d.source}]
      setM(finalMessages)
      setThreads((prev) => prev.map((thread) => thread.id === activeId ? {...thread, title: thread.title === "New conversation" ? q.slice(0, 24) || "New conversation" : thread.title, messages: finalMessages} : thread))
    } catch (x) {
      setErr(x.message)
    }
    setBusy(false)
  }

  return (
    <div>
      <h2>Chatbot</h2>
      <div className="chat-layout">
        <div className="card chat-sidebar">
          <div className="chat-sidebar-head">
            <strong>Conversations</strong>
            <button type="button" className="g" onClick={createNewThread}>New Conversation</button>
          </div>
          {threads.length === 0 ? <p className="muted">No chats yet.</p> : threads.map((thread) => (
            <div key={thread.id} className="chat-session-row">
              <button type="button" className={"chat-session " + (thread.id === activeId ? "active" : "")} onClick={() => openThread(thread.id)}>
                <div><strong>{thread.title || "Conversation"}</strong></div>
                <div className="small muted">{(thread.messages || []).length} messages</div>
              </button>
              <button type="button" className="chat-delete" aria-label={`Delete ${thread.title || "conversation"}`} title="Delete conversation" onClick={() => deleteThread(thread)}>Delete</button>
            </div>
          ))}
        </div>

        <div className="card chat-panel">
          <div className="chat-history">
            {m.length === 0 && <p>Ask anything about your business.</p>}
            {m.map((x, i) => <div key={i} className={"chat-row " + x.r[0].toLowerCase()}><div className="chat-bubble"><strong>{x.r}:</strong>{renderChatText(x.t)}{x.source && <small className="muted">{x.source}</small>}</div></div>)}
            {busy && <div className="chat-row assistant"><div className="chat-bubble"><strong>Assistant:</strong><p className="chat-copy">Thinking…</p></div></div>}
          </div>
          {err && <p className="err">{err}</p>}
          <form onSubmit={send} className="chat-form">
            <input value={t} onChange={(e) => setT(e.target.value)} placeholder="Type your question" />
            <button disabled={busy}>Send</button>
          </form>
        </div>
      </div>
    </div>
  )
}

const PR = {Balanced: [30, 20, 20, 15, 15], Cheapest: [60, 10, 10, 10, 10], Fastest: [10, 50, 10, 20, 10], "Best quality": [10, 10, 60, 5, 15]}

function Parts() {
  const [f, setF] = useState({q: "", brand: "", model: "", year: ""}), [w, setW] = useState(PR.Balanced), [rows, setRows] = useState(null), [err, setErr] = useState(""), [notice, setNotice] = useState("")
  const [vehicleType, setVehicleType] = useState("All")
  const [inventory, setInventory] = useState([]), [purchases, setPurchases] = useState([])
  const [item, setItem] = useState({part_name: "", part_number: "", vehicle_type: "Four-Wheeler", quantity: 0, reorder_level: 2, unit_cost: 0})
  const [purchaseQty, setPurchaseQty] = useState({})
  const WL = ["Price", "Delivery speed", "Quality", "Distance", "Availability"]

  const refreshInventory = async () => setInventory(await api("/inventory"))
  const refreshPurchases = async () => setPurchases(await api("/procurement/purchases"))

  const go = async (event, filters = f, type = vehicleType) => {
    event?.preventDefault()
    setErr("")
    const qs = new URLSearchParams({...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)), vehicle_type: type, wp: w[0], wd: w[1], wr: w[2], wl: w[3], wa: w[4]})
    try {
      setRows(await api("/parts?" + qs))
    } catch (x) {
      setErr(x.message)
    }
  }

  useEffect(() => {
    go()
    refreshInventory().catch((error) => setErr(error.message))
    refreshPurchases().catch((error) => setErr(error.message))
  }, [])

  const saveInventory = async (event) => {
    event.preventDefault()
    setErr(""); setNotice("")
    try {
      await api("/inventory", {method: "PUT", body: {...item, quantity: Number(item.quantity), reorder_level: Number(item.reorder_level), unit_cost: Number(item.unit_cost)}})
      setNotice("Inventory saved.")
      await refreshInventory()
    } catch (error) {
      setErr(error.message)
    }
  }

  const findSuppliers = async (stockItem) => {
    setF({...f, q: stockItem.part_name, brand: "", model: "", year: ""})
    setVehicleType(stockItem.vehicle_type)
    await go(null, {q: stockItem.part_name, brand: "", model: "", year: ""}, stockItem.vehicle_type)
  }

  const placePurchase = async (supplier) => {
    const quantity = Number(purchaseQty[supplier.part_number] || 1)
    setErr(""); setNotice("")
    try {
      const result = await api("/procurement/purchase", {method: "POST", body: {
        part_name: supplier.part_name,
        part_number: supplier.part_number,
        vehicle_type: supplier.vehicle_type || (vehicleType === "All" ? "Four-Wheeler" : vehicleType),
        supplier_name: supplier.seller_name,
        quantity,
        unit_price: Number(supplier.price) + Number(supplier.delivery_charge),
      }})
      setNotice(`Purchase recorded. Stock is now ${result.quantity} (${result.stock}).`)
      await Promise.all([refreshInventory(), refreshPurchases()])
    } catch (error) {
      setErr(error.message)
    }
  }

  return (
    <div>
      <h2>Spare Parts &amp; Procurement</h2>
      <section className="card">
        <h3>Inventory</h3>
        <form className="grid" onSubmit={saveInventory}>
          <label>Part name<input required value={item.part_name} onChange={(event) => setItem({...item, part_name: event.target.value})} /></label>
          <label>Part number<input required value={item.part_number} onChange={(event) => setItem({...item, part_number: event.target.value})} /></label>
          <label>Vehicle type<select value={item.vehicle_type} onChange={(event) => setItem({...item, vehicle_type: event.target.value})}><option>Two-Wheeler</option><option>Four-Wheeler</option></select></label>
          <label>Current stock<input type="number" min="0" value={item.quantity} onChange={(event) => setItem({...item, quantity: event.target.value})} /></label>
          <label>Reorder level<input type="number" min="0" value={item.reorder_level} onChange={(event) => setItem({...item, reorder_level: event.target.value})} /></label>
          <label>Unit cost<input type="number" min="0" step="0.01" value={item.unit_cost} onChange={(event) => setItem({...item, unit_cost: event.target.value})} /></label>
          <div><button>Save inventory item</button></div>
        </form>
        {inventory.length ? <div className="tw"><table><thead><tr><th>Part</th><th>Vehicle</th><th>Quantity</th><th>Reorder level</th><th>Status</th><th></th></tr></thead><tbody>{inventory.map((stockItem) => <tr key={stockItem.part_number + stockItem.vehicle_type}><td>{stockItem.part_name}<div className="small muted">{stockItem.part_number}</div></td><td>{stockItem.vehicle_type}</td><td>{stockItem.quantity}</td><td>{stockItem.reorder_level}</td><td><span className={`badge ${stockItem.status === "Unavailable" ? "High" : stockItem.status === "Low" ? "Medium" : "best"}`}>{stockItem.status}</span></td><td>{stockItem.status !== "In Stock" && <button type="button" onClick={() => findSuppliers(stockItem)}>Find suppliers</button>}</td></tr>)}</tbody></table></div> : <p className="muted">No inventory items recorded yet. Add an item to track stock and reorder levels.</p>}
      </section>

      <section className="card">
        <h3>Find suppliers and compare</h3>
      <form className="procurement-search" onSubmit={go}>
        <div className="grid">{[["q", "Part name or number"], ["brand", "Vehicle brand"], ["model", "Model"], ["year", "Year"]].map(([k, l]) => <label key={k}>{l}<input value={f[k]} onChange={(e) => setF({...f, [k]: e.target.value})} /></label>)}<label>Vehicle type<select value={vehicleType} onChange={(event) => setVehicleType(event.target.value)}><option>All</option><option>Two-Wheeler</option><option>Four-Wheeler</option></select></label></div>
        <b>Best Match weights: </b>{Object.keys(PR).map((k) => <button type="button" className="g" style={{margin: "0 6px 6px 0"}} key={k} onClick={() => setW(PR[k])}>{k}</button>)}
        <div className="grid">{WL.map((l, i) => <label key={l}>{l}: {w[i]}<input type="range" min="0" max="100" value={w[i]} onChange={(e) => setW(w.map((x, j) => j === i ? +e.target.value : x))} /></label>)}</div>
        <button>Search</button>
      </form>
      {err && <p className="err">{err}</p>}
      {notice && <p className="ok">{notice}</p>}
      {rows && (rows.length === 0 ? <p>No external supplier matches found.</p> : <div className="tw"><table><thead><tr><th>Part</th><th>Compatible with</th><th>External supplier</th><th>Price</th><th>Rating</th><th>Delivery</th><th>Warranty</th><th>Availability</th><th>Match score</th><th>Purchase</th></tr></thead><tbody>{rows.map((r, i) => <tr key={i}><td><b>{r.part_name}</b><br />{r.part_number}</td><td>{r.fits}</td><td>{r.seller_name}<br />{r.seller_city}</td><td>₹{r.price}<br />+₹{r.delivery_charge} delivery</td><td>⭐ {r.rating}</td><td>{r.delivery_days} days<br />{r.distance_km} km</td><td>{r.warranty}</td><td>{r.availability}</td><td>{r.best && <span className="badge best">Best Match</span>}<br /><b>{r.score}/100</b><br /><small>{Object.entries(r.w).map(([k, v]) => k + " " + v).join(" · ")}</small></td><td><input aria-label={`Purchase quantity ${r.part_number}`} type="number" min="1" value={purchaseQty[r.part_number] || 1} onChange={(event) => setPurchaseQty({...purchaseQty, [r.part_number]: event.target.value})} /><button type="button" onClick={() => placePurchase(r)}>Purchase &amp; update stock</button></td></tr>)}</tbody></table></div>)}
      </section>

      <section>
        <h3>Recent purchases</h3>
        {purchases.length ? <div className="tw"><table><thead><tr><th>Part</th><th>Supplier</th><th>Vehicle</th><th>Quantity</th><th>Unit price</th><th>Total</th></tr></thead><tbody>{purchases.map((purchase) => <tr key={purchase.id}><td>{purchase.part_name} ({purchase.part_number})</td><td>{purchase.supplier_name}</td><td>{purchase.vehicle_type}</td><td>{purchase.quantity}</td><td>₹{purchase.unit_price}</td><td>₹{purchase.total}</td></tr>)}</tbody></table></div> : <p className="muted">No purchases recorded.</p>}
      </section>
    </div>
  )
}


