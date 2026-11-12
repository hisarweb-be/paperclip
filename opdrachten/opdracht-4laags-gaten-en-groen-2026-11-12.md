# Opdracht 4-lagen: gaten dichten en groen maken (Altuner, 12 nov 2026)

Rol: CTO en hoofdarchitect Bureau V2, volledig autonoom. Dit bestand is ook het standbestand voor de opvolger.

## Vaste besluiten (niet opnieuw voorleggen)
- Geen vaste modellen per laag: de meesterrouter kiest model en effort per taak. Laag 1 = CEO en CTO, laag 2 = Product Owner, laag 3 = uitvoerende rollen.
- Motoren van de router: alleen Claude-abonnement en Lumia. Geen OpenRouter in de routerkeuze; de bestaande laatste noodtrede blijft.
- Beste model voor de beste prijs. Geen sleutelrotatie, geen geld, niets onomkeerbaar vernietigen, geen sleutelwaarden in uitvoer.
- Alles wat terugkeert is een vaste stap zonder model (plugins/vaste-stap), nooit een agentroutine of een model in een lus.

## Metingen vooraf (12 nov 2026, dit venster)
- `state/venster-tempo.json`: `fout: "usage-API HTTP 429"`, week/vijf null. De meter kon het verbruik niet lezen.
- `settings/venster-abonnement.json`: `abonnementTot 2026-11-17T04:00:00Z` -> dit venster voert zelf uit op het abonnement (geen lumia.sh/glm.sh/ds.sh).
- PR 2729 (modeloverstap 5-5) staat OPEN, mergeable, CI nog niet gemeten hier. Bestanden uit die PR niet aanraken: `controle.sh`, `export/litellm-config.yaml`, `plugins/altuner-stem/proef/motormeting.mjs`, `plugins/bureau-server/litellm/maak-ladder.mjs`, `plugins/litellm-wissel/team-lumia-limiet.mjs`, `plugins/motorregie/noodstand.mjs`, `plugins/routekeuze/prijswachter.mjs`, `settings/motorklassen.json`.
- controle.sh 12 nov 10:03Z: 55 FOUT, 127 LET OP.

## DEEL 1: bewijstabel (gemeten 12 nov 2026, dit venster)

| Onderdeel | Bestaand onderdeel | Pad | Meting | Uitkomst |
|---|---|---|---|---|
| Kaartvelden map/opdracht/acceptatie (invoernorm) | invoernorm-meter + aanmaakpoort | `plugins/taakpoort/invoernorm.mjs`, `aanmaakpoort.mjs` | `node plugins/taakpoort/invoernorm.mjs` -> 0 van 208 nieuwe kaarten (24 u) volledig, 0 % (norm 80 %) | DRAAIT (meter), maar de kaarten halen de norm niet: 0 % van 208 |
| Watchdog op vastgelopen sessies | vensterwachter, ondersessiewacht, sessiewacht | `plugins/vensterwachter`, `plugins/ondersessiewacht`, `plugins/sessiewacht` | Windows-taken actief: `Paperclip ondersessiewacht` laatste 11:55 (elke 5 min), `Paperclip Venster-tempo` 11:43. Sessiewacht-log `logs/sessiewacht.jsonl` bestaat niet en controle.sh zegt: 0/0 vensters geladen, veeg nooit gedraaid | KAPOT (vensterwachter DRAAIT, sessiewacht-veeg nooit gedraaid) |
| Pre-merge gate (conflict, lint/build/test, gitleaks) | afsluitpoort/prronde + CI-workflows | `plugins/afsluitpoort/prronde.mjs`, `.github/workflows/{gitleaks-regels,mods-toetsen,hisarweb-paperclip}.yml` | prronde regel 6/49: "geen verplichte CI telt als groen"; gitleaks- en mods-toetsen-workflows bestaan en draaien op PR | DRAAIT met gat: zonder verplichte checks merget de poort ook zonder CI |
| Eindkeuring tegen acceptatiecriteria | keurpoort/bewijsregel | `plugins/keurpoort/bewijsregel.mjs` | `node plugins/keurpoort/bewijsregel.mjs` -> 64,6 % van 48 kaarten naar done heeft een bewijsregel (norm 90 %) | DRAAIT, onder norm |
| Opknippen door de Product Owner | knipregel in `kennis/agents/product-owner.md`, meter `plugins/rolnorm/oplevering.mjs` | `plugins/rolnorm/oplevering.mjs` | `node plugins/rolnorm/oplevering.mjs` -> OK knipregel-duur (geen taak met één run langer dan 60 min); LET OP knipregel-onderdelen: HIS-4854 heeft 5 losse onderdelen | DRAAIT |
| Gratis-eerst ladder | motorklassen-ladders + motorregie | `settings/motorklassen.json` (`ladders`, `ladder` = hulp/licht/zwaar/keuren), `plugins/motorregie` | config leesbaar, 5 laddersleutels; motorregie-suite 988 controles groen (3,4 u oud) | DRAAIT |
| Terugval bij 429 zonder sessieverlies | LiteLLM `router_settings.fallbacks` + motorregie-run | `export/litellm-config.yaml` regel 752-770, `plugins/motorregie/motorregie-run.mjs` | fallbackketens aanwezig: claude-opus-5-5 -> [opus-5-5-thinking, sonnet-5-5-max], claude-fable-5-1 -> [opus-5-5, sonnet-5-5-max], claude-sonnet-5-5-max -> [opus-5-5, opus-5-5-thinking]; echte 429 nog niet gesimuleerd | DRAAIT (config), bewijs met gesimuleerde 429 ontbreekt nog |
| Mapvertrouwen vóór een achtergrondsessie | geen pre-flight controle gevonden | `plugins/lumia-werker/*`, `plugins/brug-opvolger/*` | `C:/Users/husey/.claude.json`: 204 projectmappen, 7 niet vertrouwd (o.a. `D:/tmp/win/mt`, `D:/project/project/hisarweb-ai`, `C:/Klanten`); aan de agent-kant (WSL `/home/agent`) 1 trust-entry, geen controle in de startroute | ONTBREEKT |
| Ontdekking en keuring van nieuwe modellen | modelverkenner radar + keurbank | `plugins/modelverkenner/{radar,keurbank}.mjs`, `installeer-radar.sh` | `logs/gratis-radar.jsonl` laatste regel 2026-10-22T04:40Z (21 dagen oud), `state/gratis-keurbank.json` laatst gewijzigd 22 okt 06:51; geen timer gevonden (laptop `systemctl` 0 treffers; server niet bereikbaar vanaf dit venster) | KAPOT (code bestaat, draait niet) |
| Lumia levert claude-fable-5-2 | LiteLLM-modelgroep | `export/litellm-config.yaml` | Echte aanroep via `127.0.0.1:4000` (12 nov): `claude-fable-5-2` -> **HTTP 400** "Invalid model name passed in model=claude-fable-5-2. Call `/v1/models`"; `claude-fable-5-1` -> **200** met `"model":"claude-fable-5-1"`; `claude-opus-5-5` -> **200** | ONTBREEKT (Lumia levert 5.2 niet; 5.1 werkt) |

## DEEL 2: gaten (stand)
- **A. Mapvertrouwen**: was ONTBREEKT, nu GEBOUWD in PR 2760 (tak `cto/4laags-mapvertrouwen`, werkboom `D:/paperclip/.claude/worktrees/4laags-gaten-groen`): `plugins/agentgebruiker/mapvertrouwen.mjs` met check/zet/lijst op `~/.claude.json`, pre-flight in `claude-als-agent`, regel in `controle.sh`, toets `mapvertrouwen.test.mjs` (`node --test`: pass 1, fail 0). Volgende stap: CI groen, zelf samenvoegen, daarna `controle.sh` nameten.
- **B. Nieuwe Lumia-modellen**: fable-5-2 wordt door Lumia niet geleverd (HTTP 400 op een echte aanroep). De radar draait niet (laatste run 22 okt). Eerste werk: radar/keurbank-timer herstellen, dan de Lumia-modellijst via LiteLLM laten meelezen.
- **C. 429-terugval**: config aanwezig; gesimuleerde 429 nog te doen.
- **D. Invoernorm**: meting is 0 % van 208 kaarten volledig met de velden Doel, Bewijs, Maat, Modus. Dat is ver onder de norm van 80 %, dus overschakelen van meldstand naar weigeren levert nu een bordstilstand op: besluit voorlopig **niet weigeren**; eerst de aanmaakpoort de vier velden zelf laten invullen (net als `modusVoor`), daarna opnieuw meten.

## DEEL 3: groen maken (55 FOUT, zwaarste eerst)
Zie `opdrachten/cto-wachtrij.md` voor wat blijft liggen. Hier de stand per FOUT-soort:
1. stilstand terwijl er werk ligt (71 taken over de maximale wachttijd) — open
2. sessiewacht zonder veeg (0/0 vensters geladen) — open
3. zelfherstel-timer uit — open
4. meesterrouter 11 beslissingen in 6 u met een fout — open
5. Instellingen-pagina (`WORKER_UNAVAILABLE`) en Jouw TODO-pagina niet ready — open
6. vraag van de eigenaar ouder dan 60 min zonder antwoord (HIS-8885, HIS-8973, HIS-9156) — open
7. herhaalde incidenten zonder automatische preventie (29 regels) — open
8. overige: verhouding open/gesloten, nachtkopie-drift (3 van 87), main-naar-d 3 conflicten, meter regels-sessiewacht ontbreekt, limietstops, zelfherstel-escalatie, leegloopvlag, taak zonder agent HIS-8824, pleister-drop-in, controle-regels contextwachter geen uitvoer, WSL-herstart, Paperclip-database CPU, klantwacht, Lumia-bureau-01 46 -> 0 — open

## Werkafspraken voor de opvolger
- Werk in een eigen worktree vanaf `origin/main`; nooit in de spiegel `D:/paperclip` zelf schrijven.
- Raak de bestanden uit PR 2729 niet aan zolang die open is.
- Tijdschakelaar: tot 17 nov 05:00 voert dit venster zelf uit op het abonnement (geen lumia.sh/glm.sh/ds.sh).
- `MSYS_NO_PATHCONV=1` voor WSL-paden; lange runs met `run_in_background` en logbestand.
- Metingen van dit venster staan in `D:/tmp/win/fable-meting.txt` (fable-5-2 400, fable-5-1 200, opus-5-5 200).

## Stand opvolger 12 nov (na het eerste kindvenster)
- Kindvenster `local_4b537948-2771-410b-a3d2-306bff4d8797` ("4laags gaten en groen 2", model `claude-opus-5-5-thinking`) bouwde deel 2A, commit `46986095f` in werkboom `D:/paperclip/.claude/worktrees/4laags-gaten-groen`, en stierf daarna op `API Error: 402 Insufficient Balance` (`claude-opus-5-5-thinking`, terugval `claude-opus-5-5` en `claude-sonnet-5-5-max` ook leeg). Les: start geen nieuw venster op een thinking-model zonder tegoed.
- Dat werk staat als PR 2760 open (tak `cto/4laags-mapvertrouwen`). Deel 2A is dus gebouwd en getoetst; wacht nog op groene CI en samenvoegen.
- Nog open: 2B (radar/keurbank herstellen en Lumia-lijst via LiteLLM lezen), 2C (gesimuleerde 429), 2D (aanmaakpoort vult Doel/Bewijs/Maat/Modus zelf, daarna nameten) en heel DEEL 3.
