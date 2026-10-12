AutoPilot AI - setup (Windows)
1. Install Python 3.10+, Node.js and Ollama. No paid APIs or keys are required.
2. Open a terminal and run: ollama pull phi3:mini  (or use your own offline model)
3. Check the model is available with: ollama list
4. Double-click setup.bat (once).
5. Double-click run.bat. The browser opens http://localhost:5173
This app runs fully offline on the local machine and stores data in a lightweight SQLite database, so it works well on a low-storage laptop.
Parts data seeds automatically into the local SQLite database on first start. To reload sample parts, delete backend/autopilot.db or edit backend/parts.csv and restart.
If you want a specific model, set OLLAMA_MODEL=phi3:mini or another installed local Ollama model before running the app.
