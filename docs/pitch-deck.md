# SetuHealth — Pitch Deck Content (12 slides)

Use this as the content/speaker-notes source; drop into Google Slides/PPT
with your own visual template. Screenshots referenced can be taken directly
from the running app (`npm run dev` + `uvicorn`).

---

## 1. Title
**SetuHealth**
Federated AI for India's Primary Health Centre network — and beyond.

*Team [name] · Hack2Skill [event name] · [date]*

---

## 2. The Problem
- India's public healthcare backbone is its ~1.6 lakh Primary Health Centres
  (PHCs) — but there is no real-time, national view of their medicine stock,
  bed capacity, or staff attendance.
- Result: stock-outs discovered only when a patient can't be treated;
  surplus in one district sits unused while a neighbouring district runs dry;
  emergencies (outbreaks, heatwaves) hit a system that can't see itself.
- This is not unique to India — every BRICS nation runs a similar
  decentralized PHC network with the same blind spot.

*Screenshot: blank/legacy paper-register photo or a simple "before" diagram
of disconnected PHCs.*

---

## 3. The Opportunity
- Real-time visibility + predictive forecasting + automated redistribution
  turns a reactive, siloed system into a proactive, connected one.
- Google's GenAI + predictive modelling can make this actionable for a
  district health officer, not just visible to a data analyst.
- A federated architecture means this scales to a national platform — and
  extends to shared modelling across BRICS nations — without any single
  facility's raw patient data ever leaving its own system.

---

## 4. What We Built
**SetuHealth**: a working end-to-end platform covering the full loop —
detect → forecast → explain → recommend → (soon) act.

- Live dashboard across 101 PHCs, 6 states, 24 districts
- Predictive stockout forecasting per PHC per medicine
- Automated cross-district/cross-state redistribution recommendations
- Gemini-powered natural-language alert explanations + multilingual voice
  assistant
- A federated aggregation layer, demoed at both state→national and
  national→BRICS scale

*Screenshot: Dashboard page.*

---

## 5. How It Works — Data & Forecasting
- Every PHC reports medicine stock, bed occupancy, and staff attendance
  (in production: via existing HMIS/e-Aushadhi integrations; in this demo:
  a realistic 90-day synthetic dataset seeded from India's National List of
  Essential Medicines).
- Forecasting model estimates each PHC/medicine's real depletion rate from
  recent usage and projects days-to-stockout, flagging Critical (≤7 days)
  and Warning (≤14 days) risk — explainable, not a black box.

*Screenshot: PHC detail page with stock chart + 14-day forecast.*

---

## 6. How It Works — Redistribution Engine
- For every at-risk medicine, the engine finds the nearest facility with
  genuine surplus and recommends a specific transfer — quantity, distance,
  urgency — preferring in-district and in-state moves first.
- This turns "we're out of stock" into "here is the truck route that fixes
  it," before the emergency escalates.

*Screenshot: Redistribution Recommendations panel.*

---

## 7. How It Works — GenAI Layer (Google AI)
- **Gemini** turns a raw forecast (`days_to_stockout: 3, risk: critical`)
  into a plain-language explanation and recommended action for a district
  health officer — in their own language.
- **Setu Assistant**: a conversational, voice-enabled assistant (Hindi +
  English shown, extensible to every scheduled Indian language) that answers
  "which PHCs in Bihar need urgent antibiotic resupply?" using the live
  network as context — no dashboard-reading required, works for
  lower-literacy field staff over voice.

*Screenshot: Assistant page mid-conversation, ideally in Hindi with the mic
active.*

---

## 8. Federated Architecture
- **State node → national server**: each state computes local statistics
  (depletion rates per medicine category, risk counts) and only that
  summary is federated-averaged into a national model — no raw PHC or
  patient record ever leaves the state's own system.
- **National → BRICS**: the identical mechanism combines India's national
  prior with partner-nation summaries into a shared global prior — enabling
  joint predictive modelling across BRICS without a data-sharing treaty for
  raw records, only for aggregates.
- This is the answer to "how do you share predictive modelling across
  nations without a privacy/sovereignty problem."

*Screenshot: Federated Network page.*

---

## 9. Built for India, Designed to Scale
- Reference data model is state/district-agnostic — onboarding a new state
  is a data operation, not an engineering one.
- Demonstrated today at 101 PHCs across 6 states; the same architecture
  scales to the full ~1.6 lakh PHC network by adding data sources, not
  rearchitecting.
- Multilingual by design — UI and assistant both driven by a language layer
  meant to cover every scheduled language, not just English/Hindi.

---

## 10. Who It Serves
- **District/state health officers**: early warning + one-click
  redistribution instead of manual phone-calling between PHCs.
- **PHC frontline staff (ASHA workers, pharmacists)**: voice-first assistant
  in their own language, no dashboard literacy required.
- **National health ministries**: a single real-time view across the entire
  network, and emergency-response redistribution during outbreaks/disasters.
- **BRICS health ministries**: shared predictive modelling without
  surrendering data sovereignty.

---

## 11. Why It's Deployable Now
- Fully working, containerized (FastAPI + React), deployable on any cloud
  in hours — [deployed link here].
- Google Gemini integration is a drop-in API key away from live GenAI (the
  demo runs today in a transparent offline-mock mode with zero code
  changes needed to go live).
- Realistic data model grounded in NLEM medicines and real Indian
  states/districts — not a toy dataset.

---

## 12. What's Next
- Integrate with existing state HMIS/e-Aushadhi systems as the real data
  source, replacing the synthetic generator.
- Differential-privacy hardening on the federated aggregation layer for
  production BRICS deployment.
- Add computer-vision-based stock counting from PHC storeroom photos for
  facilities without digital inventory systems.
- Extend the assistant to all 22 scheduled Indian languages.

---

*Contact: [team emails] · Source: [GitHub link] · Live demo: [deployed link]*
