# PocketOps: 3-minute demo script

**Before recording:** `.env` has a real key and model (the header pill reads *Nebius model call: ready · <model>*), and the data is clean
(delete `data/store.json`, or press *Erase all PocketOps data* on Privacy & setup). Use a ~1280px browser window. Rehearse once, because the timings are tight.
Never show `.env` or your key on screen.

| Time | On screen | Say |
|---|---|---|
| **0:00–0:15** | Home (empty state). Point at the header pill and the two boundary cards. | "PocketOps drafts briefings and replies using only preferences I approve. I can inspect all of its memory, and before anything goes to a hosted NVIDIA model on Nebius, I see the exact text. It's privacy-conscious, not 'local-only'. Here's what stays in the app and what's sent." |
| **0:15–0:30** | Press *Load synthetic demo data*. Open *Notes & tasks* briefly to show the `DEMO · synthetic` badges. | "This is synthetic data, so no real email or calendar is involved, and it's all labelled." |
| **0:30–1:00** | *Draft a Reply*. Priya's message is selected. Tick *Atlas pilot notes* and *Send Project Atlas status update*. The memory section is empty. Instruction: "Keep it short and friendly. Give a quick project update." Press *Review what will be sent*. | "I choose only what this reply needs. Nothing has been sent yet. The next screen shows the exact text." |
| **1:00–1:45** | **Review screen.** Point at the text, *Included in this request* and *Destination*. Press *Scan for sensitive-looking text*, then *Redact all found*; the email and phone become `[REDACTED-…]`. Tick the consent box and press **Approve & send to Nebius**. | "This is exactly what goes to Nebius: this text plus PocketOps' fixed instructions. It flagged the email and phone in the signature, and I've redacted them. Five other items and zero memories stay in the app. I've read it, and I approve this call." |
| **1:45–2:10** | **Result.** Show the `DRAFT` label, "Nebius model call: succeeded", the `[S#]` chips, the provenance panel, and *Exact text that was sent*. Then the **Possible preference** card: press *Yes, save this memory*. | "It's a draft; nothing is sent anywhere. Provenance shows which items informed it. PocketOps noticed I like concise, friendly project updates, and it asked first. Only now, after I approve, is it saved." |
| **2:10–2:35** | Press *New reply (reuses saved memory)*, or *Daily Briefing*. The saved preference is pre-ticked. Press *Review…* and show `[M1] Prefers concise, friendly project updates.` in the text. Approve. On the result, show **Approved memories used: M1**. | "On the next request, the saved preference is reused. It's visible in the text I'm approving, and the result shows which memory shaped it." |
| **2:35–2:55** | *Memory* page: *Edit* the wording and save. Open the earlier result to show "EDITED SINCE". Back in *Memory*, press *Delete* then *Yes, delete* and show the empty state. | "I can inspect, edit and delete any memory. Provenance tracks the change, and deleting returns me to a blank slate." |
| **2:55–3:00** | *Activity* page (log of exact sent text). | "Built on Nebius Token Factory with an NVIDIA Nemotron model: you control memory, and you see what's sent." |

**If the API call fails on camera:** the error banner says why (key, or model/region mismatch). Fix `.env`, restart, and re-record. Don't present sample-mode output as model output.
**Publishing:** keep it under 3:00 and upload it to YouTube as public.
