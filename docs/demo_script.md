# Three-minute demo: walkthrough and voiceover

Run `./scripts/launch.sh` beforehand and open http://127.0.0.1:8000 in a 1440 px window. Everything below uses the real application
(Historical Replay on the synthetic organizer data), no slides. Figures quoted come from the replay table for **DNCC_Ward_19, origin
5 Aug 2024, 3 weeks ahead**; re-check them on screen before recording, because they change if the origin or ward changes.
Keep the Copilot question short, since each answer costs about $0.003 of OpenAI credit and needs the key in `.env`.

| Time | On screen | Voiceover |
|---|---|---|
| 0:00-0:20 | **Command Center**, header badges visible | "DengueShield AI forecasts weekly dengue cases for 60 wards, two to four weeks ahead. The data is the organizers' synthetic dataset, so this is a *Historical Replay*, not live surveillance. The 2025 test year stays locked." |
| 0:20-0:55 | Pick DNCC_Ward_19, origin 5 Aug 2024, 3 weeks. Hover the fan chart | "For this ward the model expects a median of 13 cases, with an 80% interval of 8 to 18, and an outbreak probability of 83%. The observed value in the replay was 20, outside the interval, which is a known weakness: intervals under-cover peaks. We show that limitation next to the alert instead of hiding it." |
| 0:55-1:15 | Switch to **AI Forecast Lab**, then toggle horizon 2 / 3 / 4 | "One ridge Poisson model per horizon. The drivers panel breaks the forecast into seasonality, rainfall and ward vulnerability, so every number is explainable." |
| 1:15-1:35 | **Ward Risk Explorer**, filter High + Critical | "All 60 wards ranked by statistical risk tier. These tiers are quantiles of the training data, not official warning levels." |
| 1:35-1:55 | **Data Profiling Studio**, rainfall-lag chart | "The data profile shows the rainfall-to-cases lag the features are built around, and the data-quality checks we ran before modelling." |
| 1:55-2:20 | **Model Evidence** | "Validation is chronological: each season is predicted from earlier seasons only, with calibration nested inside. MAE is 1.1, 1.4 and 1.5 cases for 2, 3 and 4 weeks. Tuned boosting and ensembles gave no reliable gain, so we kept the simplest model." |
| 2:20-2:45 | Open **Copilot**, ask "Which wards are highest risk for the replay origin of 5 August 2024?" Then switch language to Bangla | "The Copilot answers only from tools that read the app's own data and cite them. It refuses to reveal 2025 actuals or keys, and it answers in Bangla when asked in Bangla." |
| 2:45-3:00 | **Climate Observatory**, then System & Provenance | "Real NASA POWER and Open-Meteo weather is shown beside the synthetic data and never fed into the model, and the app keeps working if either service is down. Provenance lists data checksums and model versions. Thank you." |

## Fallbacks if something fails live

- No internet: skip Climate Observatory and the Copilot sentence. The forecast, evidence and profiling pages are local.
- No OpenAI key or credit: the Copilot returns retrieval-only passages; say so and move on.
- Map not loading (no MapTiler key): the city-risk table is shown instead.
