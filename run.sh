#!/bin/bash
cd backend && python3 -m venv venv && ./venv/bin/pip install -q -r requirements.txt && (./venv/bin/uvicorn main:app --port 8000 &) && cd ../frontend && npm install && npm run dev
