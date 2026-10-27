// HIS-4581 criterium 3: nagespeelde meting van de B-ingreep op de echte runhistorie.
// Zelfde dump en zelfde maat als HIS-4326 (verslagen/2026-10-25-his4326-meting-voor-bouw.md):
// aantal issue_continuation_needed-wakes met retryOfRunId per uur, plus het HIS-3686-venster 15:14-16:16Z.
//
// Grondwaarheid voor "wat de oude plugin deed" is de plugin zijn eigen log (logs/zelfherstel.jsonl,
// actie "transient-rem: wachtende herkansing geannuleerd"), niet een nagebouwde voorwaarde.
//
// Replay:
//  1. Patch 1 laat een rij in scheduled_retry staan zolang zijn geplande starttijd binnen het
//     uurvenster valt. Voor elke echte transient-rem-annulering toetsen we dat op het annuleermoment.
//  2. Patch 2 laat de sweep een taak overslaan waarop zo'n rij nog leeft -> de continuation-wake met
//     retryOfRunId wijzend op die rij wordt niet aangemaakt.
//  3. Alles wat in de historie op een onderdrukte run voortborduurt (retryOfRunId wijst erop) bestaat
//     in de replay ook niet: de keten stopt bij de eerste onderdrukte schakel.

import { readFileSync, writeFileSync } from "node:fs";

const DUMP = process.argv[2] ?? "tmp/his4326/hbruns-vers2.json";
const UIT = process.argv[3] ?? "tmp/his4581/meting.json";
const LOG = process.argv[4] ?? "logs/zelfherstel.jsonl";
const BUDGET_MS = 60 * 60 * 1000;
const H3686 = "2de14cd3-b252-4ad7-a55c-0d8843485447";

const runs = JSON.parse(readFileSync(DUMP, "utf8"));
const byId = new Map(runs.map((r) => [r.id, r]));
const ctx = (r) => r.contextSnapshot ?? {};
const wake = (r) => String(ctx(r).wakeReason ?? "");
const issue = (r) => ctx(r).issueId ?? null;
const isContinuation = (r) => wake(r) === "issue_continuation_needed" && Boolean(r.retryOfRunId);
const continuations = runs.filter(isContinuation);

// --- 1. de echte transient-rem-annuleringen, uit de plugin-log -------------------------------
const logRows = readFileSync(LOG, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return null;
    }
  })
  .filter((o) => o && o.actie === "transient-rem: wachtende herkansing geannuleerd");

// Wacht-ids in de log zijn 8 tekens (slice(0,8) van het run-id); match op prefix.
const perPrefix = new Map();
for (const r of runs) {
  const p = r.id.slice(0, 8);
  if (!perPrefix.has(p)) perPrefix.set(p, []);
  perPrefix.get(p).push(r);
}

const blijftStaan = [];
const onbekend = [];
for (const o of logRows) {
  const kandidaten = perPrefix.get(o.wacht) ?? [];
  if (kandidaten.length !== 1) {
    onbekend.push({ wacht: o.wacht, t: o.t, kandidaten: kandidaten.length });
    continue;
  }
  const r = kandidaten[0];
  if (!r.scheduledRetryAt) continue; // queued houdt de oude voorwaarde
  const gepland = Date.parse(r.scheduledRetryAt);
  const annuleer = Date.parse(o.t);
  if (annuleer - gepland <= BUDGET_MS) blijftStaan.push(r);
}
const blijftMap = new Map(blijftStaan.map((r) => [r.id, r]));

// --- 2. onderdrukte runs ---------------------------------------------------------------------
const onderdrukt = new Set();
for (const c of continuations) if (blijftMap.has(c.retryOfRunId)) onderdrukt.add(c.id);

let gegroeid = true;
while (gegroeid) {
  gegroeid = false;
  for (const r of runs) {
    if (onderdrukt.has(r.id)) continue;
    if (r.retryOfRunId && onderdrukt.has(r.retryOfRunId)) {
      onderdrukt.add(r.id);
      gegroeid = true;
    }
  }
}

// --- 3. per uur ------------------------------------------------------------------------------
const uur = (iso) => iso.slice(0, 13);
function tabel(filter) {
  const m = new Map();
  for (const c of continuations) {
    if (!filter(c)) continue;
    const h = uur(c.createdAt);
    m.set(h, (m.get(h) ?? 0) + 1);
  }
  return m;
}
const voorTabel = tabel(() => true);
const naTabel = tabel((c) => !onderdrukt.has(c.id));
const uren = [...new Set([...voorTabel.keys(), ...naTabel.keys()])].sort();
const perUur = uren.map((h) => ({ uur: h, voor: voorTabel.get(h) ?? 0, na: naTabel.get(h) ?? 0 }));
const som = (m) => [...m.values()].reduce((a, b) => a + b, 0);

// --- 4. het HIS-3686-venster ------------------------------------------------------------------
const van = Date.parse("2026-10-21T15:14:00Z");
const tot = Date.parse("2026-10-21T16:16:59Z");
const venster = runs
  .filter((r) => issue(r) === H3686)
  .filter((r) => {
    const t = Date.parse(r.createdAt);
    return t >= van && t <= tot;
  })
  .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

// --- 5. positieve controle: de log op HIS-3686 tegen de replay -------------------------------
const logH = logRows.filter((o) => o.taak === "HIS-3686");
const logInVenster = logH.filter((o) => {
  const t = Date.parse(o.t);
  return t >= van && t <= tot;
});
const replayWacht = new Set(venster.filter((r) => blijftMap.has(r.id)).map((r) => r.id.slice(0, 8)));
const logWacht = new Set(logInVenster.map((o) => o.wacht));
const identiek =
  replayWacht.size === logWacht.size && [...replayWacht].every((w) => logWacht.has(w));

const perReden = {};
for (const r of runs) {
  if (!onderdrukt.has(r.id)) continue;
  const k = isContinuation(r) ? "issue_continuation_needed" : wake(r).slice(0, 40) || "(leeg)";
  perReden[k] = (perReden[k] ?? 0) + 1;
}

const uit = {
  dump: DUMP,
  log: LOG,
  runsTotaal: runs.length,
  continuationWakes: continuations.length,
  transientRemAnnuleringenInLog: logRows.length,
  waarvanBinnenBudget: blijftStaan.length,
  nietMatchen: onbekend,
  onderdrukteRuns: onderdrukt.size,
  onderdrukteContinuations: continuations.filter((c) => onderdrukt.has(c.id)).length,
  onderdruktePerReden: perReden,
  voor: { totaal: som(voorTabel), perUur },
  na: { totaal: som(naTabel) },
  h3686Venster: {
    runsVoor: venster.length,
    continuationsVoor: venster.filter(isContinuation).length,
    runsNa: venster.filter((r) => !onderdrukt.has(r.id)).length,
    continuationsNa: venster.filter((r) => isContinuation(r) && !onderdrukt.has(r.id)).length,
    keten: venster.map((r) => ({
      tijd: r.createdAt,
      run: r.id.slice(0, 8),
      reden: wake(r).slice(0, 60),
      retryOf: r.retryOfRunId ? r.retryOfRunId.slice(0, 8) : null,
      poging: r.scheduledRetryAttempt,
      status: r.status,
      blijftStaan: blijftMap.has(r.id),
      onderdrukt: onderdrukt.has(r.id),
    })),
  },
  logControle: {
    pluginAnnuleringenH3686Totaal: logH.length,
    pluginAnnuleringenH3686InVenster: logInVenster.length,
    replayRijenInVenster: replayWacht.size,
    identiek,
  },
};

writeFileSync(UIT, JSON.stringify(uit, null, 2));
console.log(
  JSON.stringify(
    {
      runsTotaal: uit.runsTotaal,
      continuationWakes: uit.continuationWakes,
      transientRemAnnuleringenInLog: uit.transientRemAnnuleringenInLog,
      waarvanBinnenBudget: uit.waarvanBinnenBudget,
      nietMatchen: uit.nietMatchen.length,
      onderdrukteRuns: uit.onderdrukteRuns,
      onderdrukteContinuations: uit.onderdrukteContinuations,
      voorTotaal: uit.voor.totaal,
      naTotaal: uit.na.totaal,
      h3686: {
        runsVoor: uit.h3686Venster.runsVoor,
        runsNa: uit.h3686Venster.runsNa,
        contVoor: uit.h3686Venster.continuationsVoor,
        contNa: uit.h3686Venster.continuationsNa,
      },
      logControle: uit.logControle,
    },
    null,
    2,
  ),
);
