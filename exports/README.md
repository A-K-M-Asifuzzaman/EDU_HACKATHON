# Sample dispatch outputs

Generated offline by `python scripts/export_samples.py` (offline mode on). Running it again produces byte-identical files.
They are planning estimates on the organizer's synthetic dataset: not outbreak reports, not orders, and never sent to anyone.

**Scenario `S-94fbd8367d09`**

| Setting | Value |
|---|---|
| Forecast | issued 2024-08-05 for the week of 2024-08-26 (3 weeks ahead, validated replay), upper end of the 80% range |
| Regional stock | 60% |
| Spraying crews | 40, optimized, Moderate illustrative effect (30% maximum, 35% per crew, 1-week delay, 2 weeks to full effect) |
| Illustrative bed capacity | 120% |

| File | What it is |
|---|---|
| `sms_<ward>_en.txt`, `sms_<ward>_bn.txt` | SMS notice. English is GSM-7 (3 segments); Bangla is UCS-2 (7 segments) |
| `whatsapp_<ward>_en.txt`, `whatsapp_<ward>_bn.txt` | WhatsApp notice (`*bold*`, `_italic_`) |
| `brief_<ward>_en.html`, `brief_<ward>_bn.html` | Printable commissioner brief: self-contained HTML, A4 print styles, no external assets |
| `brief_<ward>.pdf` | The same brief as a PDF (English; the standard PDF fonts have no Bengali glyphs) |
| `brief_<ward>.json` | The canonical brief every format is rendered from: scenario, settings, data and model hashes, content hash |
| `city_summary_Chattogram.html` / `.pdf` | City totals and every ward by priority |
| `briefs_attention_Chattogram.html` / `.pdf` | One brief per ward that needs attention, in priority order |
| `offline/comparison.json` | Kill-switch run: 21 API results with the internet cut off, all identical to the online baseline |
| `offline/browser.json` | Kill-switch run: the 12-step browser workflow and the external hosts the page tried (only the test's own probe) |
| `offline/server_offline_status.json` | Kill-switch run: server status, all artifacts present, zero refused connections |

Wards: `CCC_Ward_03` (Chattogram; one patient transferred to CCC_Ward_06) and `DSCC_Ward_04` (Dhaka South; one patient transferred
to DSCC_Ward_11). Both are Critical-risk wards whose supplies are fully allocated. The multi-ward PDF covers the Chattogram wards that
are short.
