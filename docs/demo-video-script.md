# Demo Video Script (target: 4 minutes)

Record the browser directly (screen capture) against the running app. Keep
narration conversational, not read-aloud-slide-deck.

## 0:00–0:30 — Hook + Problem
"India runs its public healthcare frontline through Primary Health Centres —
but there's no real-time way to know which one is about to run out of a
critical medicine, until a patient shows up and it's too late. We built
SetuHealth to fix that — and to make the same system shareable across
BRICS nations."

*(Show Problem Statement / title slide briefly, then cut to the live app.)*

## 0:30–1:15 — Dashboard walkthrough
Navigate to the Dashboard.
"This is a live national view — 101 PHCs across 6 states today, but the
architecture scales to the full network. Every dot is a facility, colored
by real-time stockout risk. [Point out stat cards.] We're already seeing
73 critical alerts and 134 warnings network-wide, computed from actual
usage trends, not fixed thresholds."

## 1:15–2:00 — Forecasting + PHC detail
Click into a critical PHC.
"Here's Pune PHC 1 — completely out of Artesunate, the anti-malarial.
[Point at stock chart.] You can see the sawtooth pattern of normal restocks
breaking down here — this facility stopped getting resupplied reliably.
[Point at 14-day forecast.] This is a genuine forecast, not a static rule:
we estimate the real depletion rate from the last two weeks of usage and
project it forward."

## 2:00–2:45 — Redistribution + GenAI explanation
Back to Dashboard, click "Explain with AI" on an alert.
"Instead of just flagging the problem, Gemini turns it into something a
district officer can act on immediately — [read the generated explanation].
And the redistribution engine has already found the fix: [point to
Redistribution panel] — transfer this quantity from the nearest facility
with genuine surplus, prioritizing in-state moves."

## 2:45–3:30 — Multilingual voice assistant
Go to Assistant page, switch language to Hindi, click the mic, ask a
question by voice (e.g., "बिहार में कौन से PHC को तुरंत दवा चाहिए").
"Field staff don't need to read a dashboard — they can just ask, in their
own language, by voice. [Wait for reply, let TTS play if audio is on.]"

## 3:30–4:00 — Federated network + close
Navigate to Federated Network page.
"Every state node shares only aggregated statistics upward — never raw
facility or patient data. [Point at BRICS chart.] The exact same mechanism
lets India, Brazil, South Africa, and other BRICS nations build a shared
predictive model together, without anyone's raw health data crossing a
border. That's SetuHealth — real-time, predictive, actionable, and built to
scale from one district to an entire federation of nations."

---

### Recording checklist
- [ ] Both backend (`uvicorn`) and frontend (`npm run dev`) running before
      recording starts.
- [ ] Set a Gemini API key beforehand if you want live (not mock) AI replies
      on camera — check the response by asking one question before hitting
      record.
- [ ] Mute other tabs/notifications; use a clean browser profile.
- [ ] Zoom browser to ~100–110% so charts/text are legible on a phone screen.
