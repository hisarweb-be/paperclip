# HIS-4581 criterium 3: nagespeelde meting van de B-ingreep

Sessie: pauze-overname, eigen Claude Code-sessie op Lumia (27 okt 2026, 18:10-19:10Z).
Kaart: HIS-4581, eigenaar CTO. Stap B van het CEO-besluit op HIS-4326, gestapeld op A1 (HIS-4580).

**Deze sessie heeft geen code gewijzigd.** Punt 1 (plugin) en punt 2 (sweep) lagen al klaar in twee
open PR's. Het enige openstaande criterium was 3, de nagespeelde meting.

## Waarom een nagespeelde meting en geen "na"-meting in bedrijf

B is niet uitgerold (uitrol van de plugin is Regie-werk na akkoord van de CEO). Een "na"-meting op
de levende historie kan dus pas na de uitrol. Wat hier wel kan en gevraagd is: de ingreep naspelen
op de echte runhistorie, met dezelfde dump en dezelfde maat als de meting op HIS-4326.

## Bron en methode

- Runhistorie: `tmp/his4326/hbruns-vers2.json`, dezelfde dump als HIS-4326 (35.081 runs, 28 sep t/m
  25 okt, opgehaald 25 okt 18:06Z). De dump die de CTO in zijn reactie van 16:35Z als "weg" meldde
  bestaat nog op D: en is hier hergebruikt, zodat de vergelijking echt dezelfde bron is.
- Grondwaarheid voor "wat de oude plugin deed" is de plugin zijn eigen log
  (`logs/zelfherstel.jsonl`, actie `transient-rem: wachtende herkansing geannuleerd`, 230 rijen,
  14 t/m 22 okt), niet een nagebouwde voorwaarde. Alle 230 wacht-ids matchen exact één run in de dump.
- Maat: aantal `issue_continuation_needed`-wakes met gevulde `retryOfRunId`, per uur, plus het
  venster HIS-3686 15:14-16:16Z van 21 okt.
- Script: `meting.mjs` in deze map. Uitvoer: `uitkomst.json`.
- Replay in drie stappen: (1) een rij die de plugin annuleerde maar waarvan de geplande starttijd
  binnen het uurvenster viel, blijft met patch 1 staan; (2) de sweep zet met patch 2 geen
  continuation-wake neer zolang zo'n rij leeft; (3) alles wat in de historie op zo'n onderdrukte run
  voortborduurt bestaat in de replay ook niet, dus de keten stopt bij de eerste schakel.

## Uitkomst

| maat | voor | na (nagespeeld) |
|---|---|---|
| continuation-wakes met `retryOfRunId`, hele dump | 1182 | 1027 (-13,1 %) |
| idem, periode waarin de plugin echt annuleerde (14-22 okt) | 274 | 119 (-56,6 %) |
| HIS-3686-venster 15:14-16:16Z, totaal runs | 26 | 5 |
| HIS-3686-venster, continuation-wakes | 10 | 0 |

Per dag, periode waarin de plugin actief annuleerde:

| dag | voor | na |
|---|---|---|
| 2026-10-14 | 85 | 16 |
| 2026-10-15 | 23 | 3 |
| 2026-10-16 | 12 | 10 |
| 2026-10-18 | 50 | 41 |
| 2026-10-19 | 6 | 5 |
| 2026-10-20 | 16 | 10 |
| 2026-10-21 | 57 | 13 |
| 2026-10-22 | 25 | 21 |

Buiten die periode is de daling nul: daar annuleerde de plugin niet, dus er valt niets te winnen.
Dat is precies wat je verwacht en het is een tweede controle dat het script niet blind overal
winst boekt.

## Positieve controle (de replay raakt de echte oorzaak)

Op HIS-3686 staan in de plugin-log 10 transient-rem-annuleringen in het venster. De replay merkt
exact diezelfde 10 rijen aan als "blijft staan": `identiek: true`, 10 tegen 10, geen rij extra of
tekort. Eén rij in het venster (451d3554) is door een andere zelfherstel-stap geannuleerd
(`contextlimiet: retry geannuleerd`, 16:16:43Z) en telt dus terecht niet mee.

De nagespeelde keten van HIS-3686 (26 runs): de eerste vier runs (toewijzing, twee bounded retries,
een zelfherstel-wake) blijven staan. Bij de vijfde run (914e3ce1, geplande retry) houdt de keten op:
die blijft met patch 1 wachten in plaats van geannuleerd te worden, en de sweep zet met patch 2 geen
continuation meer neer. Alle 21 runs daarna zijn in de replay vervallen. Dat is de lus die stopt.

## Wat deze meting niet bewijst

- Het is een nagespeelde meting, geen meting in bedrijf. De echte "na"-meting moet na de uitrol
  opnieuw met dit script en een verse dump.
- Het replay-model neemt aan dat een blijvende `scheduled_retry` ook echt start en niet alsnog door
  een andere route wordt opgeruimd. Dat is de aanname die de toets van criterium 2 afdekt voor de
  plugin-kant; voor de sweep-kant dekt de CI van PR #29 de code, niet het gedrag in bedrijf.
- De 614 gevallen uit HIS-4326 waarbij de voorganger `succeeded` was, zijn hier niet apart herwogen:
  de meting telt wakes, geen productief werk.

## Stand van de twee PR's (zelf nagerekend in deze sessie)

- `paperclip-config` PR #693, tak `his-4581-retry-budget`, commit 9afe82b33, OPEN. Toets zelf gedraaid
  op die tak: `node plugins/zelfherstel/transientRem.test.mjs` -> 9 OK, 0 FOUT.
- `paperclip` PR #29, tak `his-4581-sweep`, OPEN, MERGEABLE. 29 van 30 ci-checks groen. De ene rode
  check (`review`) faalt ook op de basistaks PR #26 (run 40449885244) en is dus vooraf bestaand rood,
  niet door deze wijziging.
- Criterium 4 zelf nagerekend: `gh pr diff 29` raakt alleen `server/src/services/issue-retry-budget.ts`
  en `server/src/services/recovery/service.ts`, geen `maxConcurrentRuns`, `availableSlots` of wake-queue.

## Volgende stap

Merge van A1 (#26) plus B (#29) en de uitrol van de plugin via `installeer.sh` wachten op expliciet
akkoord van de CEO. Daarna de echte "na"-meting met dit script op een verse dump.
