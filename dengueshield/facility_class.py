"""Facility classification for healthcare search (V3).

Works only from the OpenStreetMap fields already stored for each facility (name, kind, healthcare:speciality, emergency). The original
fields are never changed; classification adds four derived fields:

- care: "human" or "veterinary"
- category: hospital_general | hospital_specialist | clinic_general | clinic_specialist | diagnostic | veterinary
- specialist_reason: the name pattern or speciality tag that triggered a non-general category (None for general)
- emergency_status: "tagged_yes" | "tagged_no" | "unknown". A missing tag is UNKNOWN, never "no emergency service".

Name patterns are heuristics for community-mapped data. They are reviewed in tests (a fixed set of known names) and their output is
shown to users as a label, so a misclassified facility stays findable in the general directory.
"""
from __future__ import annotations

import re

VET = re.compile(r"\b(?:veterinar\w*|vet|vets|animal|pet\s?(?:care|clinic|hospital)|livestock|poultry|cattle)\b|পশু|প্রাণিসম্পদ", re.I)
DIAGNOSTIC = re.compile(r"\b(?:diagnostic\w*|diagnosis|diagonistic|laborator\w*|lab|labs|patholog\w*|imaging|x-?ray|scan|radiolog\w*|"
                        r"sample collection|blood bank)\b|ডায়াগনস্টিক|ল্যাব", re.I)
SPECIALIST = re.compile(r"\b(?:eye|ophthalm\w*|retina|vision|optic\w*|lasik|phaco|dental|dentist\w*|dentistry|teeth|tooth|orthodont\w*|"
                        r"homoeo\w*|homeo\w*|homio\w*|ayurved\w*|unani|herbal|physio\w*|rehab\w*|derma\w*|skin|hair|cosmetic|ent|hearing|"
                        r"fertility|ivf|dialysis|kidney|cancer|oncolog\w*|psychiatr\w*|mental|addiction|neuro\w*|cardiac|heart|"
                        r"orthop\w*|trauma\w*|tuberculosis|tb|leprosy|diabet\w*|maternity|maternal|matrisadan|gyn\w*|burn|"
                        r"plastic surgery|urolog\w*|gastro\w*|liver|cardio\w*|vaccin\w*)\b|চক্ষু|দন্ত|হোমিও|ফিজিও|মাতৃসদন|ক্যান্সার|কিডনি|হৃদ", re.I)
# A name that says it is a (general) hospital or medical college keeps its general status even if it also names a diagnostic unit or
# one speciality ("City General Hospital and Diagnostic Centre", "Chittagong Diabetic General Hospital", "Lab Aid Hospital").
GENERAL_HOSPITAL = re.compile(r"\bgeneral\b|\bmedical college\b|সাধারণ", re.I)
HOSPITAL_WORD = re.compile(r"\bhospital\b|হাসপাতাল", re.I)
GENERAL_SPECIALITY = {"general", "emergency", "community"}


def _speciality_tokens(spec: str | None) -> set[str]:
    return {t.strip().lower() for t in (spec or "").replace(",", ";").split(";") if t.strip()}


def classify(p: dict) -> dict:
    name = p.get("name") or ""
    kind = p.get("kind") or "clinic"
    emergency = (p.get("emergency") or "").strip().lower()
    status = "tagged_yes" if emergency == "yes" else "tagged_no" if emergency == "no" else "unknown"
    spec = _speciality_tokens(p.get("speciality"))
    if (m := VET.search(name)) or "veterinary" in spec:
        return {"care": "veterinary", "category": "veterinary", "specialist_reason": m.group(0) if m else "speciality=veterinary",
                "emergency_status": status}
    reason = None
    generalish = bool(GENERAL_HOSPITAL.search(name))
    if (m := DIAGNOSTIC.search(name)) and not HOSPITAL_WORD.search(name) and not generalish:
        return {"care": "human", "category": "diagnostic", "specialist_reason": m.group(0), "emergency_status": status}
    if (m := SPECIALIST.search(name)) and not generalish:
        reason = m.group(0)
    elif spec and not (spec & GENERAL_SPECIALITY) and not generalish:
        reason = "speciality=" + ";".join(sorted(spec))[:60]
    category = f"{'hospital' if kind == 'hospital' else 'clinic'}_{'specialist' if reason else 'general'}"
    return {"care": "human", "category": category, "specialist_reason": reason, "emergency_status": status}


def emergency_eligible(c: dict, kind: str) -> bool:
    """Facilities offered for an EMERGENCY search (dengue warning signs need a general facility):
    human-care general hospitals, plus general clinics explicitly tagged emergency=yes. Specialist, diagnostic-only and veterinary
    facilities are left out even when tagged emergency=yes (that tag usually means an emergency of their own speciality, e.g. dental).
    An explicit emergency=no is excluded; a missing tag is NOT treated as 'no'."""
    if c["care"] != "human" or c["emergency_status"] == "tagged_no":
        return False
    if c["category"] == "hospital_general":
        return True
    return c["category"] == "clinic_general" and c["emergency_status"] == "tagged_yes"
