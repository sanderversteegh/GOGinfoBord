# Infobord Scouting Graaf Otto Groep

Een infoscherm voor op een TV met een Raspberry Pi. Een Python-server haalt de gegevens op en de browser van de Pi toont het scherm.

* **Rechts (vast):** klok met datum en weeknummer, het weer met weerswaarschuwingen, het natuurbrandrisico (stookadvies) en de verhuuragenda van het Clubhuis en de Witte Wieven, met de status van vandaag.
* **Links (wisselend):** slides die elkaar afwisselen, zoals mededelingen, posters, de jaarplanning, een verhuurkalender, de weersverwachting, Facebook, QR-codes, aftellen naar een kamp of een webpagina.
* **Mededelingsbalk:** een oranje balk onderaan voor korte, dringende berichten, bijvoorbeeld "Opkomst gaat niet door".
* **Beheer** via `http://<ip-van-de-pi>:8080/admin` vanaf elke telefoon of laptop in het netwerk.

## Installatie op de Raspberry Pi

Gebruik een Raspberry Pi 4 of 5 met **Raspberry Pi OS (desktopversie)**.

```bash
# map naar de Pi kopiëren (USB-stick, scp of git), dan:
cd infobord
chmod +x install.sh
./install.sh
sudo reboot
```

Het script doet het volgende:
- Het installeert Python, Chromium, emoji-lettertypen en `cec-utils`.
- Het maakt de service `infobord` aan. Die start automatisch op en herstart vanzelf na een fout.
- Na het inloggen start Chromium in kioskmodus, dus schermvullend en zonder balken.
- Het zet de Pi op automatisch inloggen, schakelt het zwart worden van het scherm uit en zet de tijdzone op Amsterdam.

**Stel daarna meteen een beheerwachtwoord in** onder *Beheer → Algemeen*.

Handige commando's:
```bash
sudo systemctl status infobord      # draait de server?
journalctl -u infobord -f           # logboek bekijken
sudo systemctl restart infobord     # herstarten (het scherm herlaadt zichzelf)
```

Testen op een laptop gaat zo: `pip install -r requirements.txt && python -m infobord`. Open daarna http://localhost:8080. Met de pijltjestoetsen blader je door de slides.

## Testen op TrueNAS SCALE (of andere Docker-host)

1. Maak een dataset, bijv. `tank/apps/infobord`, en kopieer de uitgepakte map `infobord` erin (via een SMB-share of `scp`), zodat `/mnt/tank/apps/infobord/requirements.txt` bestaat.
2. Open in TrueNAS **Apps → Discover Apps → ⋮ → Install via YAML** en plak `docker-compose.yml`. Pas het pad onder `volumes` aan naar jouw dataset.
3. Open `http://<ip-truenas>:8085/` voor het scherm en `http://<ip-truenas>:8085/admin` voor het beheer.

De instellingen komen in `data/` op de dataset te staan. Die map kun je later naar de Pi kopiëren. De TV aan/uit-functie werkt niet in Docker, omdat die alleen op de Pi zelf werkt.

Met de `Dockerfile` kun je ook een vast image bouwen: `docker build -t infobord .` en daarna `docker run -p 8085:8080 -v infobord-data:/data infobord`.

## Bijwerken via GitHub (aanbevolen)

Zet de code één keer in een GitHub-repository. Daarna werk je het infobord bij met één klik, zonder te downloaden of te kopiëren.

1. **Repository aanmaken.** Maak op github.com een repository aan, bijvoorbeeld `infobord`. Die mag openbaar zijn, want er staan geen wachtwoorden of tokens in de code. Instellingen, tokens en uploads staan in `data/`, en die map gaat nooit naar GitHub (zie `.gitignore`).
2. **Repository instellen.** Vul in *Beheer → Status → Bijwerken* de repository in als `eigenaar/naam`, bijvoorbeeld `graafotto/infobord`.
3. **Bijwerken.** Klik op **Controleer op updates** en daarna op **Nu bijwerken**. Het infobord:
   - downloadt de nieuwste versie;
   - vervangt de programmabestanden;
   - laat `data/` staan;
   - herstart zichzelf. Het scherm laadt daarna vanzelf opnieuw.
4. **Automatisch bijwerken (optioneel).** Vink *Elke nacht automatisch bijwerken* aan als je updates liever automatisch krijgt.

Werkt op de Raspberry Pi (systemd herstart het programma) en in Docker of TrueNAS (`restart: unless-stopped`). Nieuwe Python-pakketten worden bij het opstarten vanzelf geïnstalleerd. Is de repository privé, vul dan een GitHub-token in met leesrechten (*Contents: read*).

## Bronnen

| Onderdeel | Bron | Opmerking |
|---|---|---|
| Weer | Open-Meteo | Gratis en zonder API-sleutel. Ververst elke 15 minuten. |
| Weerswaarschuwingen | MeteoAlarm (KNMI-codes) | Provincie Gelderland, in te stellen. |
| Stookadvies | brandweer.nl/natuurbrandrisico | Toont de fase voor de regio *Noord- en Oost-Gelderland*. Je kunt de fase handmatig overschrijven en een eigen regel toevoegen, bijvoorbeeld "Kampvuur alleen in de vuurschaal". |
| Verhuuragenda | De boekingspagina's op graafottogroep.nl | Haalt standaard 3 maanden vooruit op. Ververst elke 30 minuten. |
| Jaarplanning | PDF op de website | Importeren met één knop. Controleer daarna de datums en pas ze zo nodig aan. |
| Facebook | Graph API (Pages API) of de Facebook Page Plugin | Zie "Facebook-posts koppelen". |

**Als er iets niet werkt:** het tabblad *Status* in het beheerscherm laat per bron zien wanneer die het laatst is bijgewerkt en wat de laatste fout was. Als een bron tijdelijk niet bereikbaar is, blijft het scherm de laatst bekende gegevens tonen.

**Verhuuragenda:** de website gebruikt de WordPress-plugin *WP Booking System*. Het infobord leest de kalender per maand uit en neemt de omschrijving mee, bijvoorbeeld "Beverkamp". Onder *Bronnen* zie je met de knop **Test** direct wat er gevonden wordt. Wil je namen van huurders niet op het scherm, zet dan "Omschrijving van boekingen tonen" uit. Er staat dan alleen "Geboekt".

## Facebook-posts: via de website of via een token

Je kiest onder *Beheer → Bronnen → Facebook-posts* een **methode**:

| Methode | Hoe | Voordelen | Nadelen |
|---|---|---|---|
| **Via de website** | Het infobord leest de Facebook-widget op graafottogroep.nl/over-ons/. | Je hoeft niets te koppelen; het werkt meteen. | Geen foto's, alleen het aantal posts dat de website toont (nu 3) en een datum bij benadering ("1 week geleden"). Als de opmaak van de website verandert, kan het uitlezen stoppen. |
| **Via een token** | Het infobord haalt de posts rechtstreeks bij Facebook op. | Met foto's, exacte datums en meer posts. | Eenmalig koppelen; je moet beheerder van de pagina zijn. |
| **Automatisch** (standaard) | Het infobord gebruikt de token als die is ingesteld, en anders de website. | Werkt de token niet meer, dan schakelt het infobord vanzelf over op de website. Het tabblad *Status* meldt dat. | — |

Met **Test Facebook** zie je direct welke posts gevonden worden en via welke methode.

## Token-methode koppelen

De slide **Facebook-posts (nieuwste)** haalt de laatste berichten van jullie pagina rechtstreeks bij Facebook op. Dat gebeurt elke 20 minuten. Je kiest uit twee weergaven:

- **Overzicht** (standaard): één slide met de nieuwste post groot, met foto, kop en tekst. Daarnaast staan tot 4 eerdere posts compact onder elkaar, met een QR-code naar de pagina.
- **Eén post per slide**: elke post krijgt een eigen slide, met de foto groot in beeld en een QR-code naar de post.

De eerste regel van een post wordt automatisch de kop. Lange teksten worden netjes afgekapt met “…”. Hiervoor moet je **beheerder van de Facebookpagina** zijn. Je koppelt één keer, en het duurt ongeveer 10 minuten.

1. **Maak een ontwikkelaarsaccount aan.** Ga naar <https://developers.facebook.com> en log in met het Facebook-account dat beheerder is van de pagina. Registreer je als ontwikkelaar; dat is gratis.
2. **Maak een app aan.** Kies *Mijn apps → App maken* en geef de app een naam, bijvoorbeeld "Infobord Graaf Otto". Kies als gebruik iets als *Alles op je pagina beheren* of *Overig → Zakelijk*. De app hoeft niet gepubliceerd te worden en hoeft ook niet door Meta gecontroleerd te worden. Hij blijft in ontwikkelmodus en is alleen voor jullie eigen pagina.
3. **Noteer de gegevens van de app.** Open *App-instellingen → Basis* en noteer het **App-ID** en het **App-geheim**.
4. **Maak een token aan in de Graph API Explorer.** Ga naar *Tools → Graph API Explorer* en doe dit:
   - Kies rechts jullie app en daarna *User Token*.
   - Voeg bij *Permissions* deze rechten toe: `pages_show_list` en `pages_read_engagement`.
   - Klik op *Generate Access Token*, log in en geef toegang tot de scoutingpagina.
   - Kopieer het token dat verschijnt. Dat token is maar 1 uur geldig.
5. **Koppel het infobord.** Ga naar *Beheer → Bronnen → Facebook-posts → Koppelen met Facebook*:
   - Plak het App-ID, het App-geheim en het token.
   - Klik op **Pagina's ophalen** en kies de scoutingpagina.
   - Klik op **Opslaan**.

   Het infobord ruilt het token om voor een pagina-token dat niet verloopt. Het App-geheim wordt niet opgeslagen.
6. **Controleer of het werkt.** Klik op **Test Facebook**. Je ziet dan de nieuwste post. Kijk daarna onder *Slides* of de slide "Facebook-posts (nieuwste)" erin staat en aan staat. Staat hij er niet, voeg hem dan toe.

Per slide stel je in hoeveel posts er getoond worden. Je kunt ook kiezen om alleen posts te tonen die niet ouder zijn dan een bepaald aantal dagen, zodat er geen oud nieuws op het scherm blijft staan.

Het pagina-token wordt ongeldig als:
- je je Facebook-wachtwoord wijzigt;
- je geen beheerder van de pagina meer bent;
- Meta de toegang intrekt.

Het tabblad *Status* meldt dat dan. Herhaal stap 4 en 5 om opnieuw te koppelen.

**Facebook-tijdlijn (plugin):** dit is het oude slide-type. Het heeft geen koppeling nodig, maar Facebook bepaalt zelf wat er getoond wordt en ververst niet altijd. In de EU verschijnt soms ook een cookie- of inlogmelding. Het infobord ververst de plugin nu elke 15 minuten op de achtergrond. In de compacte weergave passen meer posts in beeld.

## Slides

Je beheert alle slides onder *Beheer → Slides*. Per slide stel je in:
- hoe lang hij in beeld blijft;
- of hij aan staat;
- eventueel een periode met **Tonen vanaf / tot en met**. Zo verschijnt een poster voor de Sinterklaasopkomst vanzelf en verdwijnt hij daarna weer.

| Type | Gebruik |
|---|---|
| Tekst / mededeling | Nieuwsbrief, oproepen, regels. Ondersteunt `**vet**`, `*schuin*` en opsommingen met `- `. Optioneel met een foto. |
| Afbeelding / poster | Poster of foto uploaden. |
| Jaarplanning | De komende activiteiten. Activiteiten binnen 7 dagen krijgen een oranje rand, "Geen opkomst" wordt gedimd weergegeven. |
| Verhuur (kalender) | Een kalender van 4 weken per gebouw. |
| Weersverwachting | Per 2 uur en voor 6 dagen. Handig voor "wat trek ik aan naar de opkomst". |
| Aftellen naar… | "Nog 235 dagen tot zomerkamp". |
| QR-code | Naar de website, het inschrijfformulier, de huurpagina of Instagram. |
| Facebook-posts (nieuwste) | De nieuwste posts in een overzicht op één slide, of elke post als eigen slide. Hiervoor moet je eerst koppelen, zie hierboven. |
| Facebook-tijdlijn (plugin) | De ingebedde tijdlijn van Facebook. Werkt zonder koppeling, maar is minder actueel. |
| Webpagina | Elke pagina die inbedden toestaat. Met zoominstelling. |

## TV automatisch aan en uit

Onder *Beheer → Scherm* stel je een tijdschema in, bijvoorbeeld 07:30–22:30. De TV gaat dan via HDMI-CEC aan of in standby, wat met de meeste moderne TV's werkt. Zet CEC wel aan in het menu van de TV; bij Samsung heet het *Anynet+*, bij LG *SimpLink*.

## Ideeën voor later

- **Opkomsttijden per speltak**, zodat je per dag ziet wie er vandaag opkomst heeft. Dat kan als tekst-slide of als extra type.
- **Fotoslideshow** uit een gedeelde map of een Google Foto's-album van het laatste kamp.
- **Instagram:** een QR-slide werkt nu al. Een echte feed vraagt een API-sleutel.
- **Contributie, inschrijving of verhuur:** een QR-slide naar het formulier.
- **Noodinformatie:** een vaste slide met EHBO-doos, AED-locatie, nooduitgangen en het adres voor de 112-melder.
- **Sleuteldienst of "leiding van dienst"** in de zijbalk.
- **Google Agenda (iCal)** voor de jaarplanning, als de leiding die gaat bijhouden. Dat is betrouwbaarder dan het uitlezen van een PDF.
- **Meerdere schermen**, bijvoorbeeld een tweede Pi in de Witte Wieven die `http://<ip-eerste-pi>:8080/` toont. Je beheert dan alles op één plek.
- **Back-up:** de map `data/` bevat alle instellingen en uploads. Kopieer die af en toe.

## Projectstructuur

```
infobord/
├── install.sh, kiosk.sh, requirements.txt
├── data/                 ← instellingen (config.json), cache en uploads (wordt aangemaakt)
└── infobord/
    ├── app.py            ← webserver + beheer-API
    ├── state.py          ← stelt de schermgegevens samen
    ├── updater.py        ← haalt bronnen periodiek op
    ├── screen.py         ← TV aan/uit
    ├── sources/          ← weather, verhuur, stook, jaarplanning
    ├── templates/        ← display.html, admin.html, login.html
    └── static/           ← display.css/js, admin.css/js
```
