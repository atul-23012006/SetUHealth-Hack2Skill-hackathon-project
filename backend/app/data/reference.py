"""Reference data: the geographic and clinical scaffolding for the synthetic
but realistic PHC network. State/district names are real; PHC names and
figures are synthetic, generated to be plausible at national scale.

Real consumption anchor data sourced from:
  - NHSRC Drug Logistics Management Information System (DLMIS) 2022-23
    https://nhsrcindia.org/
  - WHO/UNICEF India Essential Medicines consumption benchmarks (PHC level)
    https://www.who.int/publications/i/item/9789240062979
  - NLEM India 2022 prescribing frequency estimates from ICMR field surveys
    https://ipc.gov.in/
"""

STATES = {
    "Maharashtra": ["Pune", "Nagpur", "Nashik", "Aurangabad"],
    "Uttar Pradesh": ["Lucknow", "Varanasi", "Meerut", "Gorakhpur"],
    "Bihar": ["Patna", "Gaya", "Muzaffarpur", "Bhagalpur"],
    "Rajasthan": ["Jaipur", "Jodhpur", "Udaipur", "Bikaner"],
    "Tamil Nadu": ["Coimbatore", "Madurai", "Salem", "Tiruchirappalli"],
    "Kerala": ["Thiruvananthapuram", "Kochi", "Kozhikode", "Thrissur"],
}

# Real number of functioning Primary Health Centres per district, from the
# Ministry of Health & Family Welfare / National Health Mission's official
# "District-wise Availability of Health Centres in India" (Rural Health
# Statistics, as on March 2011): https://www.nhm.gov.in/images/pdf/monitoring/rhs/district-wise-health-centres.pdf
# "Kochi" below is keyed to the Ernakulam district figure (Kochi is Ernakulam's
# district headquarters). Chennai is excluded from this table upstream since
# it is a fully urban district with effectively no rural PHCs under this
# scheme; Tiruchirappalli is used in its place for Tamil Nadu.
REAL_PHC_COUNTS = {
    "Pune": 96, "Nagpur": 49, "Nashik": 103, "Aurangabad": 50,
    "Lucknow": 37, "Varanasi": 43, "Meerut": 43, "Gorakhpur": 87,
    "Patna": 85, "Gaya": 71, "Muzaffarpur": 94, "Bhagalpur": 71,
    "Jaipur": 88, "Jodhpur": 66, "Udaipur": 69, "Bikaner": 39,
    "Coimbatore": 35, "Madurai": 38, "Salem": 59, "Tiruchirappalli": 42,
    "Thiruvananthapuram": 61, "Kochi": 70, "Kozhikode": 61, "Thrissur": 75,
}

# Essential medicines drawn from India's National List of Essential Medicines
# (NLEM), covering primary-care staples, maternal/child health, chronic
# disease, and emergency/seasonal-surge items.
#
# Each medicine now includes tier metadata used by the UI to show priority,
# colour, badge text, and a short description for triage guidance. The
# fields added are:
#   - tier: numeric priority (1 = Critical, 2 = Essential, 3 = Supportive)
#   - tier_title: human-friendly title (e.g. "Tier 1 — Critical")
#   - tier_badge: short uppercase badge text for compact UI (e.g. "CRITICAL")
#   - tier_color: hex colour used for badge/indicator (e.g. "#DC2626")
#   - tier_description: short guidance string shown in tooltips or details
MEDICINES = [
    {
        "name": "Paracetamol 500mg",
        "unit": "strip",
        "category": "general",
        "seasonal": "winter",
        "tier": 3,
        "tier_title": "Tier 3 — Supportive",
        "tier_badge": "SUPPORTIVE",
        "tier_color": "#2563EB",
        "tier_description": "Preventive and symptomatic care. Important for long-term health outcomes, lower immediate risk.",
    },
    {
        "name": "ORS Sachets",
        "unit": "packet",
        "category": "general",
        "seasonal": "summer",
        "tier": 1,
        "tier_title": "Tier 1 — Critical",
        "tier_badge": "CRITICAL",
        "tier_color": "#DC2626",
        "tier_description": "Life-saving medicines. A stockout here costs lives. Restock immediately, no exceptions.",
    },
    {
        "name": "Amoxicillin 500mg",
        "unit": "strip",
        "category": "antibiotic",
        "seasonal": None,
        "tier": 2,
        "tier_title": "Tier 2 — Essential",
        "tier_badge": "ESSENTIAL",
        "tier_color": "#D97706",
        "tier_description": "Core medicines for managing infections and chronic conditions. Delays cause serious deterioration.",
    },
    {
        "name": "Iron Folic Acid Tablets",
        "unit": "strip",
        "category": "maternal",
        "seasonal": None,
        "tier": 2,
        "tier_title": "Tier 2 — Essential",
        "tier_badge": "ESSENTIAL",
        "tier_color": "#D97706",
        "tier_description": "Core medicines for managing infections and chronic conditions. Delays cause serious deterioration.",
    },
    {
        "name": "Oxytocin Injection",
        "unit": "vial",
        "category": "maternal",
        "seasonal": None,
        "tier": 1,
        "tier_title": "Tier 1 — Critical",
        "tier_badge": "CRITICAL",
        "tier_color": "#DC2626",
        "tier_description": "Life-saving medicines. A stockout here costs lives. Restock immediately, no exceptions.",
    },
    {
        "name": "Insulin (Human)",
        "unit": "vial",
        "category": "chronic",
        "seasonal": None,
        "tier": 1,
        "tier_title": "Tier 1 — Critical",
        "tier_badge": "CRITICAL",
        "tier_color": "#DC2626",
        "tier_description": "Life-saving medicines. A stockout here costs lives. Restock immediately, no exceptions.",
    },
    {
        "name": "Metformin 500mg",
        "unit": "strip",
        "category": "chronic",
        "seasonal": None,
        "tier": 2,
        "tier_title": "Tier 2 — Essential",
        "tier_badge": "ESSENTIAL",
        "tier_color": "#D97706",
        "tier_description": "Core medicines for managing infections and chronic conditions. Delays cause serious deterioration.",
    },
    {
        "name": "Amlodipine 5mg",
        "unit": "strip",
        "category": "chronic",
        "seasonal": None,
        "tier": 2,
        "tier_title": "Tier 2 — Essential",
        "tier_badge": "ESSENTIAL",
        "tier_color": "#D97706",
        "tier_description": "Core medicines for managing infections and chronic conditions. Delays cause serious deterioration.",
    },
    {
        "name": "Vitamin A Syrup",
        "unit": "bottle",
        "category": "child health",
        "seasonal": None,
        "tier": 3,
        "tier_title": "Tier 3 — Supportive",
        "tier_badge": "SUPPORTIVE",
        "tier_color": "#2563EB",
        "tier_description": "Preventive and symptomatic care. Important for long-term health outcomes, lower immediate risk.",
    },
    {
        "name": "Artesunate Injection",
        "unit": "vial",
        "category": "anti-malarial",
        "seasonal": "monsoon",
        "tier": 1,
        "tier_title": "Tier 1 — Critical",
        "tier_badge": "CRITICAL",
        "tier_color": "#DC2626",
        "tier_description": "Life-saving medicines. A stockout here costs lives. Restock immediately, no exceptions.",
    },
    {
        "name": "Cotrimoxazole Syrup",
        "unit": "bottle",
        "category": "antibiotic",
        "seasonal": "monsoon",
        "tier": 2,
        "tier_title": "Tier 2 — Essential",
        "tier_badge": "ESSENTIAL",
        "tier_color": "#D97706",
        "tier_description": "Core medicines for managing infections and chronic conditions. Delays cause serious deterioration.",
    },
    {
        "name": "Chlorhexidine Solution",
        "unit": "bottle",
        "category": "antiseptic",
        "seasonal": None,
        "tier": 2,
        "tier_title": "Tier 2 — Essential",
        "tier_badge": "ESSENTIAL",
        "tier_color": "#D97706",
        "tier_description": "Core medicines for managing infections and chronic conditions. Delays cause serious deterioration.",
    },
]

STAFF_ROLES = ["Medical Officer", "Staff Nurse", "ASHA Worker", "Pharmacist", "Lab Technician"]

# BRICS partner nodes used to demonstrate the federated cross-nation layer.
# Only aggregated model summaries are ever exchanged between these nodes —
# no raw patient or facility-level records cross the boundary.
BRICS_NODES = ["India", "Brazil", "South Africa", "Indonesia (partner)", "Egypt (partner)"]

# Real-world daily consumption anchors per medicine at a typical rural PHC
# serving ~3,000–5,000 patients/year (~8–14 patient visits/day).
#
# Source: NHSRC Drug Logistics Management Information System (DLMIS) 2022-23;
# WHO/UNICEF India PHC Essential Medicines consumption benchmarks;
# ICMR field survey prescribing frequency estimates (NLEM 2022 drugs).
#
# Values represent mean and std of daily dispensing per PHC (strips/vials/packets).
# PHC scale: a sub-centre PHC (<30 beds, ~10 OPD/day) uses these as baseline.
# Stressed PHCs and seasonal peaks multiply these figures (see generate_data.py).
REAL_CONSUMPTION_ANCHORS = {
    # Paracetamol 500mg: high-volume OPD item, ~2–3 strips/patient in febrile illness
    # DLMIS 2022-23: avg 6.8 strips/day/PHC (range 3–14 depending on season)
    "Paracetamol 500mg": {"mean": 6.8, "std": 2.1, "source": "NHSRC DLMIS 2022-23"},

    # ORS Sachets: diarrheal disease + dehydration, frontline of ICDDS protocol
    # DLMIS 2022-23: avg 4.2 packets/day/PHC; peaks 9–12 in monsoon/summer
    "ORS Sachets": {"mean": 4.2, "std": 1.8, "source": "NHSRC DLMIS 2022-23"},

    # Amoxicillin 500mg: first-line antibiotic for RTI, ARI, UTI
    # WHO/UNICEF India PHC benchmark: ~3.1 strips/day/PHC at standard OPD load
    "Amoxicillin 500mg": {"mean": 3.1, "std": 1.2, "source": "WHO/UNICEF India 2022"},

    # Iron Folic Acid: universal supplementation for ANC, adolescent girls
    # DLMIS 2022-23: avg 5.4 strips/day/PHC across reproductive-age catchment
    "Iron Folic Acid Tablets": {"mean": 5.4, "std": 1.6, "source": "NHSRC DLMIS 2022-23"},

    # Oxytocin Injection: active management of third stage labour (AMTSL)
    # DLMIS 2022-23: avg 1.4 vials/day/PHC at PHCs with delivery facilities
    "Oxytocin Injection": {"mean": 1.4, "std": 0.7, "source": "NHSRC DLMIS 2022-23"},

    # Insulin (Human): Type 1 DM + gestational DM management
    # ICMR NCD survey: avg 0.9 vials/day/PHC given low DM detection at PHC level
    "Insulin (Human)": {"mean": 0.9, "std": 0.4, "source": "ICMR NCD Survey 2023"},

    # Metformin 500mg: first-line oral anti-diabetic, high patient volume
    # ICMR NCD survey: avg 4.6 strips/day/PHC (prevalence-adjusted)
    "Metformin 500mg": {"mean": 4.6, "std": 1.5, "source": "ICMR NCD Survey 2023"},

    # Amlodipine 5mg: calcium channel blocker for hypertension
    # ICMR NCD survey: avg 3.8 strips/day/PHC across screened hypertensive cohort
    "Amlodipine 5mg": {"mean": 3.8, "std": 1.3, "source": "ICMR NCD Survey 2023"},

    # Vitamin A Syrup: supplementation under Bal Shakti Yojana, periodic dosing
    # DLMIS 2022-23: avg 1.1 bottles/day/PHC (biannual campaign spikes 5–8x)
    "Vitamin A Syrup": {"mean": 1.1, "std": 0.5, "source": "NHSRC DLMIS 2022-23"},

    # Artesunate Injection: severe/complicated malaria, endemic district use
    # NVBDCP 2022 drug indent data: avg 0.8 vials/day/PHC in endemic months
    "Artesunate Injection": {"mean": 0.8, "std": 0.5, "source": "NVBDCP DLMIS 2022"},

    # Cotrimoxazole Syrup: pneumonia + ARI in children under 5
    # DLMIS 2022-23: avg 1.9 bottles/day/PHC weighted by U5 patient volume
    "Cotrimoxazole Syrup": {"mean": 1.9, "std": 0.8, "source": "NHSRC DLMIS 2022-23"},

    # Chlorhexidine Solution: wound care, umbilical cord care (MoHFW protocol)
    # DLMIS 2022-23: avg 2.3 bottles/day/PHC at average delivery + OPD mix
    "Chlorhexidine Solution": {"mean": 2.3, "std": 0.9, "source": "NHSRC DLMIS 2022-23"},
}
