import os
import re
import math
import json
import sqlite3

import requests
import bcrypt
import jwt
from fastapi import FastAPI, HTTPException, Header, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from seed import CITY, load

DB_PATH = os.path.join(os.path.dirname(__file__), "autopilot.db")
OL = "http://localhost:11434"
SK = os.getenv("AUTOPILOT_SECRET")
if not SK:
    raise RuntimeError("AUTOPILOT_SECRET environment variable is required")


def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_conn()
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            email TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            password_hash TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS business (
            e TEXT PRIMARY KEY,
            payload TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS counsel (
            e TEXT PRIMARY KEY,
            payload TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS chat (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            e TEXT NOT NULL,
            role TEXT NOT NULL,
            text TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS parts (
            part_name TEXT,
            part_number TEXT,
            vehicle_brand TEXT,
            vehicle_model TEXT,
            year_from INTEGER,
            year_to INTEGER,
            seller_name TEXT,
            seller_city TEXT,
            seller_lat REAL,
            seller_lng REAL,
            price REAL,
            delivery_charge REAL,
            availability TEXT,
            rating REAL,
            delivery_days INTEGER,
            warranty TEXT
        )
        """
    )
    conn.commit()
    count = conn.execute("SELECT COUNT(*) FROM parts").fetchone()[0]
    if count == 0:
        load()
    conn.close()


init_db()

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


class A(BaseModel):
    email: str
    password: str
    name: str = ""


class C(BaseModel):
    msg: str


def uid(authorization: str = Header("")):
    try:
        return jwt.decode(authorization[7:], SK, algorithms=["HS256"])["e"]
    except Exception as exc:
        raise HTTPException(401, "Please login again") from exc


def tok(e):
    return jwt.encode({"e": e}, SK, algorithm="HS256")


def get_user(email):
    conn = get_conn()
    row = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    conn.close()
    return dict(row) if row else None


def has_business(email):
    conn = get_conn()
    row = conn.execute("SELECT 1 FROM business WHERE e = ?", (email,)).fetchone()
    conn.close()
    return bool(row)


def get_business(email):
    conn = get_conn()
    row = conn.execute("SELECT payload FROM business WHERE e = ?", (email,)).fetchone()
    conn.close()
    if not row:
        return {}
    try:
        return json.loads(row["payload"])
    except (TypeError, ValueError):
        return {}


def save_business(email, payload):
    conn = get_conn()
    conn.execute(
        "INSERT INTO business (e, payload) VALUES (?, ?) ON CONFLICT(e) DO UPDATE SET payload = excluded.payload",
        (email, json.dumps(payload, ensure_ascii=False)),
    )
    conn.commit()
    conn.close()


@app.post("/register")
def reg(a: A):
    email = a.email.strip().lower()
    if "@" not in email or len(a.password) < 6 or not a.name.strip():
        raise HTTPException(400, "Enter name, valid email and a password of 6+ characters")

    conn = get_conn()
    try:
        conn.execute(
            "INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)",
            (email, a.name.strip(), bcrypt.hashpw(a.password.encode(), bcrypt.gensalt()).decode()),
        )
        conn.commit()
    except sqlite3.IntegrityError as exc:
        conn.close()
        raise HTTPException(400, "Email already registered") from exc
    conn.close()
    return {"token": tok(email)}


@app.post("/login")
def login(a: A):
    email = a.email.strip().lower()
    u = get_user(email)
    if not u or not bcrypt.checkpw(a.password.encode(), u["password_hash"].encode()):
        raise HTTPException(401, "Wrong email or password")
    return {"token": tok(u["email"])}


@app.get("/me")
def me(e=Depends(uid)):
    u = get_user(e)
    if not u:
        raise HTTPException(401, "Please login again")
    return {"name": u["name"], "has_business": has_business(e)}


@app.get("/business")
def gb(e=Depends(uid)):
    return get_business(e)


@app.put("/business")
def pb(d: dict, e=Depends(uid)):
    if not str(d.get("name", "")).strip() or not str(d.get("city", "")).strip():
        raise HTTPException(400, "Business name and city are required")

    payload = dict(d)
    for k in ("brands", "services"):
        value = payload.get(k)
        if isinstance(value, str):
            payload[k] = [x.strip() for x in value.split(",") if x.strip()]
    for k in ("branches", "employees", "customers", "revenue"):
        if payload.get(k) in (None, ""):
            payload[k] = 0
        else:
            payload[k] = float(payload[k])
    payload.pop("_id", None)
    payload.pop("e", None)
    save_business(e, payload)
    return {"ok": True}


@app.get("/dashboard")
def dash(e=Depends(uid)):
    b = get_business(e)
    r = float(b.get("revenue", 0) or 0)
    c = float(b.get("customers", 0) or 0)
    sv = b.get("services") or ["General Service"]
    n = len(sv)
    tr = [round(r * (0.82 + 0.18 * i / 11) * (1 + 0.04 * ((i * 7) % 5 - 2))) for i in range(12)]
    mix = [{"n": s, "v": round(100 * (n - i) / (n * (n + 1) / 2))} for i, s in enumerate(sv)]
    inv = [{"n": a, "v": v} for a, v in [("Engine oil", 72), ("Brake pads", 38), ("Filters", 55), ("Batteries", 22), ("Rare parts", 15)]]
    insights = [
        f"Revenue trend is {round((tr[-1] / max(tr[0], 1) - 1) * 100)}% over 12 months (demo trend).",
        f"Revenue per customer is about Rs {round(r / max(c, 1))}.",
        f"Revenue per employee is about Rs {round(r / max(float(b.get('employees', 1) or 1), 1))} per month.",
    ]
    insights += [f"Low stock: {x['n']} at {x['v']}%." for x in inv if x["v"] < 30]
    if b.get("challenges"):
        insights.append("Your stated challenge: " + str(b["challenges"])[:120])
    return {
        "b": b,
        "trend": tr,
        "months": "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(),
        "mix": mix,
        "inv": inv,
        "insights": insights,
    }


KEYS = ["Marketing", "Inventory", "Procurement", "Business Improvement", "Growth Strategy"]


def ask(prompt, as_json):
    try:
        models = requests.get(OL + "/api/tags", timeout=5).json().get("models", [])
        available = [m.get("name") for m in models if isinstance(m, dict) and m.get("name")]
        preferred = os.getenv("OLLAMA_MODEL")
        if preferred:
            model = preferred
        else:
            for candidate in ("phi3:mini", "phi3-mini", "phi3", "llama3.2"):
                if candidate in available:
                    model = candidate
                    break
            else:
                model = available[0] if available else "phi3:mini"
    except Exception as exc:
        raise HTTPException(503, "Ollama is not running or no model is installed. Start Ollama and try again.") from exc

    body = {"model": model, "prompt": prompt, "stream": False, "options": {"num_ctx": 2048}}
    if as_json:
        body["format"] = "json"
    response = requests.post(OL + "/api/generate", json=body, timeout=180)
    if response.status_code != 200:
        raise HTTPException(503, "Local Ollama model did not respond properly.")
    return response.json()["response"]


def fb(b):
    brand_list = ", ".join(b.get("brands") or ["your brands"])
    challenge = b.get("challenges") or "growth"
    inventory = b.get("inventory") or "stock control"

    def ap(action, reason, priority, benefit, timeframe):
        return {"Action": action, "Reason": reason, "Priority": priority, "Benefit": benefit, "Timeframe": timeframe}

    return {
        "Marketing": [
            f"Run Google Business and WhatsApp campaigns for {brand_list} owners in {b.get('city', '')}.",
            "Offer service-reminder messages 30 days before due date.",
            "Launch seasonal check-up packages.",
        ],
        "Inventory": [
            f"Address: {inventory}. Track fast-moving parts weekly.",
            "Set reorder levels for oil, filters and brake pads.",
            "Keep a shortlist of rare parts with 2 backup sellers.",
        ],
        "Procurement": [
            "Compare at least 3 sellers per rare part using the Spare Parts Finder.",
            "Negotiate monthly bulk prices with top 2 suppliers.",
            "Track supplier delivery time and quality.",
        ],
        "Business Improvement": [
            f"Plan fixes for: {str(challenge)[:100]}.",
            "Standardise job cards and checklists across branches.",
            "Train staff on customer communication.",
        ],
        "Growth Strategy": [
            "Introduce annual maintenance contracts.",
            "Add pickup and drop service.",
            "Consider a new brand specialisation with high demand.",
        ],
        "ActionPlan": [
            ap("Start service reminders", "Boost repeat visits", "High", "+10-15% repeat customers", "2 weeks"),
            ap("Set reorder levels", "Avoid stock-outs", "High", "Fewer delays", "1 week"),
            ap("Build rare-parts supplier list", "Faster sourcing", "Medium", "Lower part cost", "1 month"),
            ap("Launch AMC packages", "Steady revenue", "Medium", "Predictable income", "2 months"),
            ap("Staff training", "Better service quality", "Low", "Higher ratings", "3 months"),
        ],
    }


@app.get("/counsel")
def gc(e=Depends(uid)):
    conn = get_conn()
    row = conn.execute("SELECT payload FROM counsel WHERE e = ?", (e,)).fetchone()
    conn.close()
    if not row:
        return {}
    return json.loads(row["payload"])


@app.post("/counsel")
def cs(e=Depends(uid), payload: dict | None = None):
    b = get_business(e)
    extra = payload or {}
    data_context = extra.get("data_context")
    if isinstance(data_context, (dict, list)):
        data_summary = json.dumps(data_context, ensure_ascii=False)[:1500]
    elif isinstance(data_context, str):
        data_summary = data_context[:1500]
    else:
        data_summary = ""

    prompt = (
        "You advise a multi-brand vehicle service centre. Business: "
        + json.dumps(b)[:1200]
        + ("\nUploaded business data summary: " + data_summary if data_summary else "")
        + '. Reply ONLY JSON with keys "Marketing","Inventory","Procurement","Business Improvement","Growth Strategy" '
        + '(each a list of 3 short strings) and "ActionPlan" (list of 5 objects with keys Action,Reason,Priority(High/Medium/Low),Benefit,Timeframe). '
        + "Use this business' own numbers, brands, challenges and uploaded data."
    )
    res = None
    source = "Local Ollama AI"
    for _ in range(2):
        try:
            parsed = json.loads(ask(prompt, True))
            if all(isinstance(parsed.get(k), list) for k in KEYS + ["ActionPlan"]) and all(isinstance(x, dict) for x in parsed["ActionPlan"]):
                res = parsed
                break
        except Exception:
            pass
    if not res:
        res = fb(b)
        source = "Rule-based fallback (Ollama unavailable or gave invalid output)"
    res["source"] = source
    conn = get_conn()
    conn.execute(
        "INSERT INTO counsel (e, payload) VALUES (?, ?) ON CONFLICT(e) DO UPDATE SET payload = excluded.payload",
        (e, json.dumps(res, ensure_ascii=False)),
    )
    conn.commit()
    conn.close()
    return res


@app.get("/chat")
def hist(e=Depends(uid)):
    conn = get_conn()
    rows = conn.execute(
        "SELECT role, text FROM chat WHERE e = ? ORDER BY id ASC LIMIT 20",
        (e,),
    ).fetchall()
    conn.close()
    return [{"r": row["role"], "t": row["text"]} for row in rows][::-1]


@app.post("/chat")
def chat(c: C, e=Depends(uid)):
    b = get_business(e)
    conn = get_conn()
    history = conn.execute(
        "SELECT role, text FROM chat WHERE e = ? ORDER BY id DESC LIMIT 6",
        (e,),
    ).fetchall()
    conn.close()
    ordered_history = [f"{row['role']}: {row['text']}" for row in history[::-1]]
    prompt = "You are a helpful advisor for a vehicle service centre. Business: " + json.dumps(b)[:800] + "\n" + "\n".join(ordered_history) + f"\nUser: {c.msg}\nAssistant:"
    try:
        answer = ask(prompt, False)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(503, "Ollama is not running or no model is installed. Start Ollama and try again.") from exc

    conn = get_conn()
    conn.execute("INSERT INTO chat (e, role, text) VALUES (?, ?, ?)", (e, "User", c.msg))
    conn.execute("INSERT INTO chat (e, role, text) VALUES (?, ?, ?)", (e, "Assistant", answer))
    conn.commit()
    conn.close()
    return {"reply": answer}


def km(a, b, c, d):
    p = math.pi / 180
    x = math.sin((c - a) * p / 2) ** 2 + math.cos(a * p) * math.cos(c * p) * math.sin((d - b) * p / 2) ** 2
    return round(12742 * math.asin(math.sqrt(x)))


def rx(s):
    return re.escape(s)


@app.get("/parts")
def parts(q: str = "", brand: str = "", model: str = "", year: int = 0, wp: float = 30, wd: float = 20, wr: float = 20, wl: float = 15, wa: float = 15, e=Depends(uid)):
    b = get_business(e) or {}
    city_key = str(b.get("city", "")).lower().strip()
    la, ln = CITY.get(city_key, CITY["coimbatore"])

    clauses = []
    params = []
    if q:
        clauses.append("(part_name LIKE ? OR part_number LIKE ?)")
        pattern = f"%{q}%"
        params.extend([pattern, pattern])
    if brand:
        clauses.append("vehicle_brand LIKE ?")
        params.append(f"%{brand}%")
    if model:
        clauses.append("vehicle_model LIKE ?")
        params.append(f"%{model}%")
    if year:
        clauses.append("year_from <= ? AND year_to >= ?")
        params.extend([year, year])

    where = "WHERE " + " AND ".join(clauses) if clauses else ""
    conn = get_conn()
    query = f"SELECT * FROM parts {where}"
    rows = conn.execute(query, tuple(params)).fetchall()
    conn.close()

    grouped = {}
    for row in rows:
        item = dict(row)
        item["distance_km"] = km(la, ln, item["seller_lat"], item["seller_lng"])
        item["total"] = item["price"] + item["delivery_charge"]
        item["fits"] = f"{item['vehicle_brand']} {item['vehicle_model']} {item['year_from']}-{item['year_to']}"
        grouped.setdefault(item["part_number"], []).append(item)

    av_map = {"In Stock": 1, "Limited": 0.5, "Order Only": 0.2}

    def lo(value, min_value, max_value):
        if max_value == min_value:
            return 100.0
        return round((max_value - value) / (max_value - min_value) * 100)

    total_weight = (wp + wd + wr + wl + wa) or 1

    for group in grouped.values():
        for key in ("total", "delivery_days", "distance_km"):
            minimum = min(x[key] for x in group)
            maximum = max(x[key] for x in group)
            for x in group:
                x.setdefault("w", {})[key] = lo(x[key], minimum, maximum)
        for item in group:
            item["w"] = {
                "Price": item["w"]["total"],
                "Speed": item["w"]["delivery_days"],
                "Quality": round(item["rating"] / 5 * 100),
                "Distance": item["w"]["distance_km"],
                "Availability": round(av_map.get(item["availability"], 0.2) * 100),
            }
            weights = item["w"]
            item["score"] = round((wp * weights["Price"] + wd * weights["Speed"] + wr * weights["Quality"] + wl * weights["Distance"] + wa * weights["Availability"]) / total_weight)
        group.sort(key=lambda item: -item["score"])
        if group:
            group[0]["best"] = True

    return sorted([item for group in grouped.values() for item in group], key=lambda x: (x["part_name"], -x["score"]))


app = app
