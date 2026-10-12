

import os
import re
import math
import json
import sqlite3
import datetime

import requests
import bcrypt
import jwt
from fastapi import FastAPI, HTTPException, Header, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from seed import CITY, load

DB_PATH = os.path.join(os.path.dirname(__file__), "autopilot.db")
OL = "http://localhost:11434"
SK = os.getenv("AUTOPILOT_SECRET", "local-autopilot-dev-secret")
BOOKING_SLOTS = [
    "09:00",
    "09:30",
    "10:00",
    "10:30",
    "11:00",
    "11:30",
    "12:00",
    "13:00",
    "13:30",
    "14:00",
    "14:30",
    "15:00",
    "15:30",
    "16:00",
    "16:30",
]


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
        CREATE TABLE IF NOT EXISTS business_data (
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
            conversation_id TEXT NOT NULL DEFAULT '',
            role TEXT NOT NULL,
            text TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS bookings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            e TEXT NOT NULL,
            customer TEXT NOT NULL,
            vehicle_type TEXT NOT NULL,
            vehicle TEXT NOT NULL,
            service TEXT NOT NULL,
            problem TEXT,
            branch TEXT NOT NULL,
            date TEXT NOT NULL,
            time TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'Booked',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS inventory (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            e TEXT NOT NULL,
            part_name TEXT NOT NULL,
            part_number TEXT NOT NULL,
            vehicle_type TEXT NOT NULL,
            quantity INTEGER NOT NULL DEFAULT 0,
            reorder_level INTEGER NOT NULL DEFAULT 0,
            unit_cost REAL NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS procurement_purchases (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            e TEXT NOT NULL,
            part_name TEXT NOT NULL,
            part_number TEXT NOT NULL,
            vehicle_type TEXT NOT NULL,
            supplier_name TEXT NOT NULL,
            quantity INTEGER NOT NULL,
            unit_price REAL NOT NULL,
            total REAL NOT NULL,
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
        conn.close()
        load()
        return
    conn.close()

    conn = get_conn()
    columns = conn.execute("PRAGMA table_info(chat)").fetchall()
    if columns and not any(col[1] == "conversation_id" for col in columns):
        conn.execute(
            "ALTER TABLE chat ADD COLUMN conversation_id TEXT NOT NULL DEFAULT ''"
        )
    conn.commit()
    conn.close()


init_db()

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class A(BaseModel):
    email: str
    password: str
    name: str = ""


class C(BaseModel):
    msg: str


class ChatRequest(BaseModel):
    msg: str
    conversation_id: str = ""
    history: list[dict] | None = None
    data_context: dict | list | str | None = None


def uid(authorization: str = Header("")):
    try:
        if not authorization.startswith("Bearer "):
            raise ValueError("Missing bearer token")
        return jwt.decode(
            authorization[7:], SK, algorithms=["HS256"]
        )["e"]
    except Exception as exc:
        raise HTTPException(401, "Please login again") from exc


def tok(e):
    return jwt.encode({"e": e}, SK, algorithm="HS256")


def get_user(email):
    conn = get_conn()
    row = conn.execute(
        "SELECT * FROM users WHERE email = ?", (email,)
    ).fetchone()
    conn.close()
    return dict(row) if row else None


def has_business(email):
    conn = get_conn()
    row = conn.execute(
        "SELECT 1 FROM business WHERE e = ?", (email,)
    ).fetchone()
    conn.close()
    return bool(row)


def get_business(email):
    conn = get_conn()
    row = conn.execute(
        "SELECT payload FROM business WHERE e = ?", (email,)
    ).fetchone()
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
        """
        INSERT INTO business (e, payload) VALUES (?, ?)
        ON CONFLICT(e) DO UPDATE SET payload = excluded.payload
        """,
        (email, json.dumps(payload, ensure_ascii=False)),
    )
    conn.commit()
    conn.close()


def get_inventory_status(quantity, reorder_level):
    qty = int(quantity or 0)
    reorder = int(reorder_level or 0)
    if qty <= 0:
        return "Unavailable"
    if qty <= reorder:
        return "Low"
    return "In Stock"


# Uploaded business data routes
@app.get("/business-data")
def get_business_data(e=Depends(uid)):
    conn = get_conn()
    row = conn.execute(
        "SELECT payload FROM business_data WHERE e = ?", (e,)
    ).fetchone()
    conn.close()

    if not row:
        return {}

    try:
        return json.loads(row["payload"])
    except (TypeError, ValueError):
        return {}


@app.put("/business-data")
def put_business_data(d: dict, e=Depends(uid)):
    if not isinstance(d, dict):
        raise HTTPException(400, "Invalid business data")

    conn = get_conn()
    try:
        conn.execute(
            """
            INSERT INTO business_data (e, payload)
            VALUES (?, ?)
            ON CONFLICT(e) DO UPDATE
            SET payload = excluded.payload
            """,
            (e, json.dumps(d, ensure_ascii=False)),
        )
        conn.commit()
    finally:
        conn.close()

    return {"ok": True}


@app.delete("/business-data")
def delete_business_data(e=Depends(uid)):
    conn = get_conn()
    try:
        conn.execute(
            "DELETE FROM business_data WHERE e = ?", (e,)
        )
        conn.commit()
    finally:
        conn.close()

    return {"ok": True}


@app.post("/register")
def reg(a: A):
    email = a.email.strip().lower()
    if "@" not in email or len(a.password) < 6 or not a.name.strip():
        raise HTTPException(
            400,
            "Enter name, valid email and a password of 6+ characters",
        )

    conn = get_conn()
    try:
        conn.execute(
            """
            INSERT INTO users (email, name, password_hash)
            VALUES (?, ?, ?)
            """,
            (
                email,
                a.name.strip(),
                bcrypt.hashpw(
                    a.password.encode(), bcrypt.gensalt()
                ).decode(),
            ),
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
    if not u or not bcrypt.checkpw(
        a.password.encode(), u["password_hash"].encode()
    ):
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
    for k in ("brands", "services", "branch_names"):
        value = payload.get(k)
        if isinstance(value, str):
            payload[k] = [
                x.strip() for x in value.split(",") if x.strip()
            ]

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
def dash(e=Depends(uid), vehicle_type: str = "All"):
    b = get_business(e)
    conn = get_conn()
    booking_filter = "e = ? AND status != 'Cancelled'"
    booking_params = [e]
    if vehicle_type in ("Two-Wheeler", "Four-Wheeler"):
        booking_filter += " AND vehicle_type = ?"
        booking_params.append(vehicle_type)
    booking_counts = conn.execute(
        f"""
        SELECT COUNT(*) AS total,
               SUM(CASE WHEN status = 'Booked' THEN 1 ELSE 0 END) AS booked,
               SUM(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END) AS completed,
               SUM(CASE WHEN vehicle_type = 'Two-Wheeler' THEN 1 ELSE 0 END) AS two_wheeler,
               SUM(CASE WHEN vehicle_type = 'Four-Wheeler' THEN 1 ELSE 0 END) AS four_wheeler
        FROM bookings
        WHERE {booking_filter}
        """,
        tuple(booking_params),
    ).fetchone()
    conn.close()
    r = float(b.get("revenue", 0) or 0)
    c = float(b.get("customers", 0) or 0)
    sv = b.get("services") or ["General Service"]
    n = len(sv)

    tr = [
        round(
            r * (0.82 + 0.18 * i / 11)
            * (1 + 0.04 * ((i * 7) % 5 - 2))
        )
        for i in range(12)
    ]

    mix = [
        {
            "n": s,
            "v": round(100 * (n - i) / (n * (n + 1) / 2)),
        }
        for i, s in enumerate(sv)
    ]

    inv = [
        {"n": a, "v": v}
        for a, v in [
            ("Engine oil", 72),
            ("Brake pads", 38),
            ("Filters", 55),
            ("Batteries", 22),
            ("Rare parts", 15),
        ]
    ]

    insights = [
        f"Revenue trend is {round((tr[-1] / max(tr[0], 1) - 1) * 100)}% over 12 months (demo trend).",
        f"Revenue per customer is about Rs {round(r / max(c, 1))}.",
        f"Revenue per employee is about Rs {round(r / max(float(b.get('employees', 1) or 1), 1))} per month.",
    ]
    insights += [
        f"Low stock: {x['n']} at {x['v']}%."
        for x in inv if x["v"] < 30
    ]

    if b.get("challenges"):
        insights.append(
            "Your stated challenge: " + str(b["challenges"])[:120]
        )

    return {
        "b": b,
        "booking_analytics": {
            key: int(booking_counts[key] or 0)
            for key in ("total", "booked", "completed", "two_wheeler", "four_wheeler")
        },
        "trend": tr,
        "months": "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(),
        "mix": mix,
        "inv": inv,
        "insights": insights,
    }


KEYS = [
    "Marketing",
    "Inventory",
    "Procurement",
    "Business Improvement",
    "Growth Strategy",
]


def ask(prompt, as_json):
    try:
        models = requests.get(
            OL + "/api/tags", timeout=5
        ).json().get("models", [])
        available = [
            m.get("name")
            for m in models
            if isinstance(m, dict) and m.get("name")
        ]
        preferred = os.getenv("OLLAMA_MODEL")

        if preferred:
            model = preferred
        else:
            for candidate in (
                "phi3:mini",
                "phi3-mini",
                "phi3",
                "llama3.2",
            ):
                if candidate in available:
                    model = candidate
                    break
            else:
                model = available[0] if available else "phi3:mini"

    except Exception as exc:
        raise HTTPException(
            503,
            "Ollama is not running or no model is installed. Start Ollama and try again.",
        ) from exc

    body = {
        "model": model,
        "prompt": prompt,
        "stream": False,
        "options": {"num_ctx": 2048},
    }

    if as_json:
        body["format"] = "json"

    response = requests.post(
        OL + "/api/generate", json=body, timeout=180
    )

    if response.status_code != 200:
        raise HTTPException(
            503, "Local Ollama model did not respond properly."
        )

    return response.json()["response"]


def fb(b):
    brand_list = ", ".join(b.get("brands") or ["your brands"])
    challenge = b.get("challenges") or "growth"
    inventory = b.get("inventory") or "stock control"

    def ap(action, reason, priority, benefit, timeframe):
        return {
            "Action": action,
            "Reason": reason,
            "Priority": priority,
            "Benefit": benefit,
            "Timeframe": timeframe,
        }

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
            ap(
                "Start service reminders",
                "Boost repeat visits",
                "High",
                "+10-15% repeat customers",
                "2 weeks",
            ),
            ap(
                "Set reorder levels",
                "Avoid stock-outs",
                "High",
                "Fewer delays",
                "1 week",
            ),
            ap(
                "Build rare-parts supplier list",
                "Faster sourcing",
                "Medium",
                "Lower part cost",
                "1 month",
            ),
            ap(
                "Launch AMC packages",
                "Steady revenue",
                "Medium",
                "Predictable income",
                "2 months",
            ),
            ap(
                "Staff training",
                "Better service quality",
                "Low",
                "Higher ratings",
                "3 months",
            ),
        ],
    }


@app.get("/counsel")
def gc(e=Depends(uid)):
    conn = get_conn()
    row = conn.execute(
        "SELECT payload FROM counsel WHERE e = ?", (e,)
    ).fetchone()
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
        data_summary = json.dumps(
            data_context, ensure_ascii=False
        )[:1500]
    elif isinstance(data_context, str):
        data_summary = data_context[:1500]
    else:
        data_summary = ""

    prompt = (
        "You advise a multi-brand vehicle service centre. Business: "
        + json.dumps(b)[:1200]
        + (
            "\nUploaded business data summary: " + data_summary
            if data_summary else ""
        )
        + '. Reply ONLY JSON with keys "Marketing","Inventory","Procurement","Business Improvement","Growth Strategy" '
        + '(each a list of 3 short strings) and "ActionPlan" (list of 5 objects with keys Action,Reason,Priority(High/Medium/Low),Benefit,Timeframe). '
        + "Use this business' own numbers, brands, challenges and uploaded data."
    )

    res = None
    source = "Local Ollama AI"

    for _ in range(2):
        try:
            parsed = json.loads(ask(prompt, True))
            if (
                all(isinstance(parsed.get(k), list) for k in KEYS + ["ActionPlan"])
                and all(isinstance(x, dict) for x in parsed["ActionPlan"])
            ):
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
        """
        INSERT INTO counsel (e, payload) VALUES (?, ?)
        ON CONFLICT(e) DO UPDATE SET payload = excluded.payload
        """,
        (e, json.dumps(res, ensure_ascii=False)),
    )
    conn.commit()
    conn.close()

    return res


@app.get("/chat")
def hist(e=Depends(uid), conversation_id: str = ""):
    conn = get_conn()
    if conversation_id:
        rows = conn.execute(
            "SELECT role, text FROM chat WHERE e = ? AND conversation_id = ? ORDER BY id ASC LIMIT 20",
            (e, conversation_id),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT role, text FROM chat WHERE e = ? ORDER BY id ASC LIMIT 20",
            (e,),
        ).fetchall()
    conn.close()

    return [
        {"r": row["role"], "t": row["text"]}
        for row in rows
    ][::-1]


@app.delete("/chat/{conversation_id}")
def delete_chat(conversation_id: str, e=Depends(uid)):
    conn = get_conn()
    conn.execute(
        "DELETE FROM chat WHERE e = ? AND conversation_id = ?",
        (e, conversation_id),
    )
    conn.commit()
    conn.close()
    return {"ok": True}


@app.post("/chat")
def chat(c: ChatRequest, e=Depends(uid)):
    b = get_business(e)
    conn = get_conn()
    history = conn.execute(
        "SELECT role, text FROM chat WHERE e = ? AND conversation_id = ? ORDER BY id DESC LIMIT 6",
        (e, c.conversation_id or ""),
    ).fetchall()
    conn.close()

    ordered_history = [
        f"{row['role']}: {row['text']}"
        for row in history[::-1]
    ]

    prompt = (
        "You are a helpful advisor for a vehicle service centre. Business: "
        + json.dumps(b)[:800]
        + "\n"
        + "\n".join(ordered_history)
        + f"\nUser: {c.msg}\nAssistant:"
    )

    try:
        answer = ask(prompt, False)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            503,
            "Ollama is not running or no model is installed. Start Ollama and try again.",
        ) from exc

    conn = get_conn()
    conversation_id = c.conversation_id or ""
    conn.execute(
        "INSERT INTO chat (e, conversation_id, role, text) VALUES (?, ?, ?, ?)",
        (e, conversation_id, "User", c.msg),
    )
    conn.execute(
        "INSERT INTO chat (e, conversation_id, role, text) VALUES (?, ?, ?, ?)",
        (e, conversation_id, "Assistant", answer),
    )
    conn.commit()
    conn.close()

    return {"reply": answer, "source": "Local Ollama AI"}


@app.get("/bookings")
def list_bookings(e=Depends(uid)):
    conn = get_conn()
    rows = conn.execute(
        """
        SELECT id, customer, vehicle_type, vehicle, service, problem, branch, date, time, status
        FROM bookings
        WHERE e = ?
        ORDER BY date DESC, time DESC, id DESC
        """,
        (e,),
    ).fetchall()
    conn.close()
    return [dict(row) for row in rows]


@app.get("/bookings/slots")
def booking_slots(
    date: str = "",
    branch: str = "",
    vehicle_type: str = "",
    e=Depends(uid),
):
    if not date or not branch:
        return {"available": []}

    try:
        requested_date = datetime.date.fromisoformat(date)
    except ValueError as exc:
        raise HTTPException(400, "Date must use YYYY-MM-DD format") from exc
    if requested_date < datetime.date.today():
        raise HTTPException(400, "Bookings cannot be made in the past")

    conn = get_conn()
    rows = conn.execute(
        """
        SELECT time
        FROM bookings
        WHERE e = ? AND date = ? AND branch = ? AND status != 'Cancelled'
        """,
        (e, date, branch),
    ).fetchall()
    conn.close()

    booked = {row["time"] for row in rows}
    available = [slot for slot in BOOKING_SLOTS if slot not in booked]
    return {"available": available}


@app.post("/bookings")
def create_booking(payload: dict, e=Depends(uid)):
    required = [
        "customer",
        "vehicle",
        "service",
        "branch",
        "date",
        "time",
        "vehicle_type",
    ]
    missing = [key for key in required if not str(payload.get(key, "")).strip()]
    if missing:
        raise HTTPException(400, "Missing required booking details")

    try:
        booking_date = datetime.date.fromisoformat(str(payload["date"]).strip())
    except ValueError as exc:
        raise HTTPException(400, "Date must use YYYY-MM-DD format") from exc
    if booking_date < datetime.date.today():
        raise HTTPException(400, "Bookings cannot be made in the past")

    booking_time = str(payload["time"]).strip()
    if booking_time not in BOOKING_SLOTS:
        raise HTTPException(400, "Choose an available time slot")

    conn = get_conn()
    try:
        conn.execute("BEGIN IMMEDIATE")
        occupied = conn.execute(
            """
            SELECT 1 FROM bookings
            WHERE e = ? AND date = ? AND branch = ? AND time = ? AND status != 'Cancelled'
            LIMIT 1
            """,
            (
                e,
                booking_date.isoformat(),
                str(payload["branch"]).strip(),
                booking_time,
            ),
        ).fetchone()
        if occupied:
            raise HTTPException(409, "That time slot has already been booked")

        conn.execute(
            """
            INSERT INTO bookings (
                e, customer, vehicle_type, vehicle, service, problem, branch, date, time, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Booked')
            """,
            (
                e,
                str(payload.get("customer", "")).strip(),
                str(payload.get("vehicle_type", "Four-Wheeler")).strip() or "Four-Wheeler",
                str(payload.get("vehicle", "")).strip(),
                str(payload.get("service", "")).strip(),
                str(payload.get("problem", "") or ""),
                str(payload.get("branch", "")).strip(),
                booking_date.isoformat(),
                booking_time,
            ),
        )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    return {"ok": True}


@app.patch("/bookings/{booking_id}")
def update_booking(booking_id: int, status: str = "Cancelled", e=Depends(uid)):
    conn = get_conn()
    updated = conn.execute(
        """
        UPDATE bookings
        SET status = ?
        WHERE id = ? AND e = ?
        """,
        (status, booking_id, e),
    )
    conn.commit()
    conn.close()
    if updated.rowcount == 0:
        raise HTTPException(404, "Booking not found")
    return {"ok": True}


@app.get("/inventory")
def list_inventory(e=Depends(uid)):
    conn = get_conn()
    rows = conn.execute(
        """
        SELECT id, part_name, part_number, vehicle_type, quantity, reorder_level, unit_cost
        FROM inventory
        WHERE e = ?
        ORDER BY part_name ASC, vehicle_type ASC
        """,
        (e,),
    ).fetchall()
    conn.close()

    payload = []
    for row in rows:
        item = dict(row)
        item["status"] = get_inventory_status(
            item.get("quantity"), item.get("reorder_level")
        )
        payload.append(item)
    return payload


@app.put("/inventory")
def save_inventory(item: dict, e=Depends(uid)):
    required = ["part_name", "part_number", "vehicle_type"]
    missing = [key for key in required if not str(item.get(key, "")).strip()]
    if missing:
        raise HTTPException(400, "Part name, number and vehicle type are required")

    payload = {
        "part_name": str(item.get("part_name", "")).strip(),
        "part_number": str(item.get("part_number", "")).strip(),
        "vehicle_type": str(item.get("vehicle_type", "Four-Wheeler")).strip(),
        "quantity": int(item.get("quantity") or 0),
        "reorder_level": int(item.get("reorder_level") or 0),
        "unit_cost": float(item.get("unit_cost") or 0),
    }

    conn = get_conn()
    existing = conn.execute(
        """
        SELECT id FROM inventory
        WHERE e = ? AND part_name = ? AND part_number = ? AND vehicle_type = ?
        """,
        (e, payload["part_name"], payload["part_number"], payload["vehicle_type"]),
    ).fetchone()

    if existing:
        conn.execute(
            """
            UPDATE inventory
            SET quantity = ?, reorder_level = ?, unit_cost = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (payload["quantity"], payload["reorder_level"], payload["unit_cost"], existing["id"]),
        )
    else:
        conn.execute(
            """
            INSERT INTO inventory (e, part_name, part_number, vehicle_type, quantity, reorder_level, unit_cost)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                e,
                payload["part_name"],
                payload["part_number"],
                payload["vehicle_type"],
                payload["quantity"],
                payload["reorder_level"],
                payload["unit_cost"],
            ),
        )

    conn.commit()
    conn.close()
    return {"ok": True}


@app.get("/procurement/purchases")
def list_purchases(e=Depends(uid)):
    conn = get_conn()
    rows = conn.execute(
        """
        SELECT id, part_name, part_number, vehicle_type, supplier_name, quantity, unit_price, total
        FROM procurement_purchases
        WHERE e = ?
        ORDER BY created_at DESC, id DESC
        """,
        (e,),
    ).fetchall()
    conn.close()
    return [dict(row) for row in rows]


@app.post("/procurement/purchase")
def record_purchase(payload: dict, e=Depends(uid)):
    required = ["part_name", "part_number", "supplier_name", "vehicle_type"]
    missing = [key for key in required if not str(payload.get(key, "")).strip()]
    if missing:
        raise HTTPException(400, "A few procurement fields are missing")

    qty = int(payload.get("quantity") or 1)
    unit_price = float(payload.get("unit_price") or 0)
    total = round(qty * unit_price, 2)

    conn = get_conn()
    existing = conn.execute(
        """
        SELECT id, quantity, reorder_level, unit_cost
        FROM inventory
        WHERE e = ? AND part_name = ? AND part_number = ? AND vehicle_type = ?
        """,
        (
            e,
            str(payload.get("part_name", "")).strip(),
            str(payload.get("part_number", "")).strip(),
            str(payload.get("vehicle_type", "Four-Wheeler")).strip(),
        ),
    ).fetchone()

    new_quantity = qty
    if existing:
        new_quantity = int(existing["quantity"]) + qty
        conn.execute(
            """
            UPDATE inventory
            SET quantity = ?, unit_cost = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (new_quantity, max(float(existing["unit_cost"]) or 0, unit_price), existing["id"]),
        )
    else:
        conn.execute(
            """
            INSERT INTO inventory (e, part_name, part_number, vehicle_type, quantity, reorder_level, unit_cost)
            VALUES (?, ?, ?, ?, ?, 0, ?)
            """,
            (
                e,
                str(payload.get("part_name", "")).strip(),
                str(payload.get("part_number", "")).strip(),
                str(payload.get("vehicle_type", "Four-Wheeler")).strip(),
                qty,
                unit_price,
            ),
        )

    conn.execute(
        """
        INSERT INTO procurement_purchases (e, part_name, part_number, vehicle_type, supplier_name, quantity, unit_price, total)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            e,
            str(payload.get("part_name", "")).strip(),
            str(payload.get("part_number", "")).strip(),
            str(payload.get("vehicle_type", "Four-Wheeler")).strip(),
            str(payload.get("supplier_name", "")).strip(),
            qty,
            unit_price,
            total,
        ),
    )
    conn.commit()
    conn.close()

    return {
        "quantity": new_quantity,
        "stock": get_inventory_status(new_quantity, 0),
    }


def km(a, b, c, d):
    p = math.pi / 180
    x = (
        math.sin((c - a) * p / 2) ** 2
        + math.cos(a * p)
        * math.cos(c * p)
        * math.sin((d - b) * p / 2) ** 2
    )
    return round(12742 * math.asin(math.sqrt(x)))


def rx(s):
    return re.escape(s)


@app.get("/parts")
def parts(
    q: str = "",
    brand: str = "",
    model: str = "",
    year: int = 0,
    wp: float = 30,
    wd: float = 20,
    wr: float = 20,
    wl: float = 15,
    wa: float = 15,
    e=Depends(uid),
):
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
        item["distance_km"] = km(
            la, ln, item["seller_lat"], item["seller_lng"]
        )
        item["total"] = item["price"] + item["delivery_charge"]
        item["fits"] = (
            f"{item['vehicle_brand']} {item['vehicle_model']} "
            f"{item['year_from']}-{item['year_to']}"
        )
        grouped.setdefault(item["part_number"], []).append(item)

    av_map = {
        "In Stock": 1,
        "Limited": 0.5,
        "Order Only": 0.2,
    }

    def lo(value, min_value, max_value):
        if max_value == min_value:
            return 100.0
        return round(
            (max_value - value) / (max_value - min_value) * 100
        )

    total_weight = (wp + wd + wr + wl + wa) or 1

    for group in grouped.values():
        for key in ("total", "delivery_days", "distance_km"):
            minimum = min(x[key] for x in group)
            maximum = max(x[key] for x in group)

            for x in group:
                x.setdefault("w", {})[key] = lo(
                    x[key], minimum, maximum
                )

        for item in group:
            item["w"] = {
                "Price": item["w"]["total"],
                "Speed": item["w"]["delivery_days"],
                "Quality": round(item["rating"] / 5 * 100),
                "Distance": item["w"]["distance_km"],
                "Availability": round(
                    av_map.get(item["availability"], 0.2) * 100
                ),
            }

            weights = item["w"]
            item["score"] = round(
                (
                    wp * weights["Price"]
                    + wd * weights["Speed"]
                    + wr * weights["Quality"]
                    + wl * weights["Distance"]
                    + wa * weights["Availability"]
                )
                / total_weight
            )

        group.sort(key=lambda item: -item["score"])
        if group:
            group[0]["best"] = True

    return sorted(
        [
            item
            for group in grouped.values()
            for item in group
        ],
        key=lambda x: (x["part_name"], -x["score"]),
    )
