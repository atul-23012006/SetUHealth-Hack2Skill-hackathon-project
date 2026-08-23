"""Reference data: the geographic and clinical scaffolding for the synthetic
but realistic PHC network. State/district names are real; PHC names and
figures are synthetic, generated to be plausible at national scale.
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
