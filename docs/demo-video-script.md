# Demo Video Script (target: 4 minutes)

Record the browser directly (screen capture) against the running app. Keep
narration conversational, not read-aloud-slide-deck. The spine of the demo is
the **crisis-simulation flow** — everything else hangs off it.

## 0:00–0:25 — Hook + Problem
"India runs its public healthcare frontline through 1.6 lakh Primary Health
Centres — but there's no real-time way to know which one is about to run out
of a critical medicine until a patient shows up and it's too late. SetuHealth
gives a health ministry that view, predicts the stockouts before they happen,
and tells you exactly which facility should resupply which — and it's built to
extend across BRICS nations."

*(Title slide for 3 seconds, then cut to the live Dashboard.)*

## 0:25–1:30 — Crisis simulation (the core loop)
Start on the Dashboard. Point at the map and the stat cards — "This is a live
national view, 150-plus PHCs across 6 states, every dot coloured by real-time
stockout risk from a genuine forecast."

Click **🎬 Run Demo** (top right). Narrate as the scripted flow runs:
1. "It resets to a clean baseline…"
2. "…then injects a Monsoon Floods emergency across Bihar. Watch the map."
3. "Forecasts recompute — facilities flip to critical, the countdown clocks
   at the top now show ORS and Paracetamol running out in days, not weeks."
4. "The redistribution engine has already recomputed, and the co-pilot
   auto-executes the top transfer — a real manifest, logged to the ledger."
5. "And it settles. That whole detect → forecast → recommend → act loop just
   ran in fifteen seconds."

Then: "You can also drive this by hand —" open the **Crisis Simulator** panel,
pick a district, a crisis type, hit **🚨 Simulate Outbreak**, show the red
banner and the elevated alerts. Hit **Reset Simulation**.

## 1:30–2:05 — Forecasting + confidence + PHC detail
Click into a critical PHC. "Here's the stock history — you can see the normal
restock sawtooth breaking down. Below it, the 14-day forecast: Holt's
exponential smoothing on the real depletion rate, and the shaded band is the
±1σ prediction interval — the model tells you how sure it is, not just a
single line."

## 2:05–2:45 — Redistribution + GenAI justification + anomaly detection
Back to the Dashboard redistribution panel. Click **🧠 Why?** on a transfer —
"Gemini turns the optimiser's choice into something a district officer can act
on: why this donor, this quantity, this urgency."

Scroll to **🕵️ Consumption Anomalies**. "Separately, the platform reconciles
each PHC's medicine consumption against its patient footfall. These facilities
are burning stock far faster — or slower — than their patient volume can
explain: possible pilferage, or a broken stock register. Click Investigate and
Gemini writes the verification step."

Glance at **🏥 Capacity Redistribution** next to it — "and it's not just
medicine — bed overflow and staff shortages get the same nearest-surplus
matching."

## 2:45–3:20 — Multilingual voice assistant
Go to the Assistant page. Switch the language selector to **தமிழ்** (or
Hindi/Marathi), click the mic, ask by voice, e.g. "பீகாரில் எந்த PHC-க்கு
உடனடியாக மருந்து தேவை". "Four languages today — English, Hindi, Marathi,
Tamil — same scaffolding scales to every scheduled language. Field staff just
ask, in their own language, by voice."

## 3:20–4:00 — Federated privacy + close
Navigate to the Federated Network page. Toggle **🚫 Show Raw Data (blocked)** —
"raw patient and facility records physically cannot cross a node boundary;
watch the links break." Toggle back. "Only aggregated model weights flow —
state → national, and the identical mechanism national → BRICS. India, Brazil,
South Africa build a shared predictive model without a data-sharing treaty for
raw records. That's SetuHealth — real-time, predictive, explainable,
auditable, and built to scale from one district to a federation of nations."

---

### Recording checklist
- [ ] Backend (`uvicorn` or `docker compose up`) and frontend running before
      recording starts.
- [ ] Run `Reset Simulation` once so you start from a clean baseline.
- [ ] Set a `GEMINI_API_KEY` beforehand for live (not mock) AI replies — test
      one explanation and one assistant question before hitting record.
- [ ] Mute other tabs/notifications; use a clean browser profile.
- [ ] Zoom browser to ~100–110% so charts/text are legible on a phone screen.
