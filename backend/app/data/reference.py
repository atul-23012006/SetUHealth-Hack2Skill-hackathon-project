"""Reference data: the geographic and clinical scaffolding for the synthetic
but realistic PHC network. State/district names are real; PHC names and
figures are synthetic, generated to be plausible at national scale.
"""

STATES = {
    "Maharashtra": ["Pune", "Nagpur", "Nashik", "Aurangabad"],
    "Uttar Pradesh": ["Lucknow", "Varanasi", "Meerut", "Gorakhpur"],
    "Bihar": ["Patna", "Gaya", "Muzaffarpur", "Bhagalpur"],
    "Rajasthan": ["Jaipur", "Jodhpur", "Udaipur", "Bikaner"],
    "Tamil Nadu": ["Chennai", "Madurai", "Coimbatore", "Salem"],
    "Kerala": ["Thiruvananthapuram", "Kochi", "Kozhikode", "Thrissur"],
}

# Essential medicines drawn from India's National List of Essential Medicines
# (NLEM), covering primary-care staples, maternal/child health, chronic
# disease, and emergency/seasonal-surge items.
MEDICINES = [
    {"name": "Paracetamol 500mg", "unit": "strip", "category": "general", "seasonal": "winter"},
    {"name": "ORS Sachets", "unit": "packet", "category": "general", "seasonal": "summer"},
    {"name": "Amoxicillin 500mg", "unit": "strip", "category": "antibiotic", "seasonal": None},
    {"name": "Iron Folic Acid Tablets", "unit": "strip", "category": "maternal", "seasonal": None},
    {"name": "Oxytocin Injection", "unit": "vial", "category": "maternal", "seasonal": None},
    {"name": "Insulin (Human)", "unit": "vial", "category": "chronic", "seasonal": None},
    {"name": "Metformin 500mg", "unit": "strip", "category": "chronic", "seasonal": None},
    {"name": "Amlodipine 5mg", "unit": "strip", "category": "chronic", "seasonal": None},
    {"name": "Vitamin A Syrup", "unit": "bottle", "category": "child health", "seasonal": None},
    {"name": "Artesunate Injection", "unit": "vial", "category": "anti-malarial", "seasonal": "monsoon"},
    {"name": "Cotrimoxazole Syrup", "unit": "bottle", "category": "antibiotic", "seasonal": "monsoon"},
    {"name": "Chlorhexidine Solution", "unit": "bottle", "category": "antiseptic", "seasonal": None},
]

STAFF_ROLES = ["Medical Officer", "Staff Nurse", "ASHA Worker", "Pharmacist", "Lab Technician"]

# BRICS partner nodes used to demonstrate the federated cross-nation layer.
# Only aggregated model summaries are ever exchanged between these nodes —
# no raw patient or facility-level records cross the boundary.
BRICS_NODES = ["India", "Brazil", "South Africa", "Indonesia (partner)", "Egypt (partner)"]
