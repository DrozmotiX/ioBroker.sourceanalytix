# Schreibregeln für die SourceAnalytix-Dokumentation

Diese Regeln gelten für alle Seiten unter `docs/de` und später `docs/en`. Sie gehören nicht zur veröffentlichten Doku, sondern zur Arbeit daran.

## 1. Grundsätze

1. **Der Titel ist die Frage der Nutzer.** Jede Abschnittsüberschrift (`##`) ist eine Frage, so wie Nutzer sie im Forum oder in Issues stellen. Die Fragen stehen schon im Gerüst. Ändere den Wortlaut nur, wenn er missverständlich ist, und schreibe den Grund in die Commit-Nachricht.
2. **Jede Aussage hat eine Quelle.** Belegt wird mit einer Code-Stelle, einem Issue oder einem Forenbeitrag (Format in Abschnitt 4). Eine Aussage ohne Quelle wird nicht geschrieben, sondern als offene Frage notiert.
3. **Versionen stehen ausdrücklich da.** Was erst ab einer bestimmten Version gilt, bekommt einen sichtbaren Hinweis (Abschnitt 5).
4. **Deutsch ist maßgeblich.** Deutsch wird zuerst geschrieben und abgenommen. Englisch folgt inhaltsgleich, bewusst geschrieben und nicht maschinell übersetzt.
5. **Nur Markdown, das auf GitHub und in VuePress gleich aussieht** (Abschnitt 6).

## 2. Woher die Inhalte kommen

Die Arbeitsdaten liegen im Ordner `docs-project/` (nicht im Git):

| Datei | Wofür |
|---|---|
| `analysis/doc-outline.md` / `.json` | Gliederung: Seiten, Abschnitte, Priorität, was jeder Abschnitt beantworten muss |
| `analysis/clusters.json` | Zu jedem Bündel die geprüfte Antwort (DE/EN), Belege und die Fragen-IDs |
| `analysis/interview-answers.md` | **Entscheidungen des Entwicklers. Bei Widerspruch gilt diese Datei.** |
| `analysis/code-findings.md` | Bekannte Fehler im Code mit Datei und Zeile |
| `inventory/features.json` | Alle Funktionen mit Code-Stelle und Stolperfallen |
| `corpus/questions.json` | Die Originalfragen mit Link zum Forenbeitrag oder Issue |
| `issues/issue-entwuerfe.md` | Welche Fehler in v0.6.2 und welche Funktionen in v0.7.0 kommen (Issues #1253–#1273) |

Jeder Abschnitt im Gerüst trägt zwei unsichtbare Kommentare: `abschnitt:` mit Cluster- und Feature-IDs und `muss beantworten:` mit dem Pflichtinhalt. Beide bleiben stehen. Über die Feature-IDs prüft später ein Skript bei jedem Release, ob sich die belegten Code-Stellen geändert haben.

## 3. Aufbau der Seiten

- **Ordner und Dateien** sind nummeriert, z. B. `01.erste-schritte/01.installation.md`. Jeder Ordner hat eine `README.md` als Inhaltsseite.
- **Eine Seite** hat genau eine Überschrift `#` (Seitentitel). Jeder Abschnitt beginnt mit einer Überschrift `##` (die Nutzerfrage). Unterpunkte nutzen `###`, tiefer geht es nicht.
- **Jeder Abschnitt hat einen festen Anker** direkt vor der Überschrift, z. B. `<a id="start-values-unit"></a>`. Der Anker ist englisch, ändert sich nie und ist in `de` und `en` gleich. Links auf Abschnitte nutzen immer diesen Anker, nie die automatisch erzeugte Überschriften-ID (GitHub und VuePress erzeugen sie unterschiedlich).
- **Reihenfolge im Abschnitt** (siehe [Abschnittsvorlage](vorlage-abschnitt.md)): zuerst die kurze Antwort, dann die Schritte, dann Hinweise und Versionen, zuletzt „Siehe auch".
- **Abschnitte bleiben eigenständig.** Wer über die Suche auf einem Abschnitt landet, muss ihn ohne die Abschnitte davor verstehen. Wiederholungen ersetzt man durch einen Link.

## 4. Quellen angeben

Die Quelle steht als unsichtbarer Kommentar direkt unter dem Absatz, der Liste oder der Tabelle, die sie belegt:

```markdown
Die Startwerte trägst du in der Zieleinheit ein, also in kWh, wenn die Werte in kWh angezeigt werden.
<!-- quelle: code=main.js:1234@v0.6.1; issue=#640; forum=603844 -->
```

| Art | Schreibweise | Bedeutung |
|---|---|---|
| Code | `code=main.js:1234@v0.6.1` | Datei und Zeile im Stand v0.6.1 (Commit `c498d92`) |
| Issue / PR | `issue=#640`, `pr=#1238` | Issue oder Pull Request im Adapter-Repo |
| Forum | `forum=603844` | Beitrag `https://forum.iobroker.net/post/603844` |
| Entscheidung | `interview=13b` | Antwort im Entwickler-Interview |

Mehrere Quellen werden mit `;` getrennt. Code-Stellen beziehen sich auf v0.6.1, solange nichts anderes dasteht. Für Verhalten ab v0.6.2 oder v0.7.0 ist das Issue oder der Pull Request die Quelle.

Wenn die Nutzer etwas wissen müssen, darf ein Issue zusätzlich sichtbar verlinkt werden, z. B. „Der Fehler ist in [#1253](https://github.com/DrozmotiX/ioBroker.sourceanalytix/issues/1253) beschrieben."

## 5. Versionen

- Die Doku beschreibt **v0.6.1** als Grundstand.
- Verhalten, das erst später gilt, steht als eigener Absatz mit fettem Anfang:
  - `**Ab v0.6.2:** …` für Fehlerbehebungen aus #1253–#1264
  - `**Ab v0.7.0:** …` für neue Funktionen aus #1265–#1269
- Für alte Fehler steht `**Bis v0.6.1:** …` und daneben, ab wann es behoben ist.
- Geplante Funktionen ohne Version (#1270–#1273) werden nicht beschrieben. Höchstens ein Satz „ist geplant" mit Link zum Issue.
- Keine Formulierungen wie „neu", „demnächst", „in der aktuellen Version". Immer die Versionsnummer.

## 6. Erlaubtes Markdown

Erlaubt ist nur, was auf GitHub und in VuePress gleich aussieht.

| Erlaubt | Verboten | Grund |
|---|---|---|
| Überschriften `#`, `##`, `###` | Frontmatter (`---` am Dateianfang) | GitHub zeigt es als Tabelle |
| Absätze, **fett**, *kursiv*, `Code` | `::: tip`, `::: warning` und andere Container | GitHub zeigt sie als Rohtext |
| Nummerierte und einfache Listen | GitHub-Hinweise `> [!NOTE]` | VuePress zeigt sie als Rohtext |
| Tabellen | Aufgabenlisten `- [ ]` | VuePress zeigt keine Kästchen |
| Codeblöcke mit Sprache (` ```json `) | Fußnoten `[^1]` | VuePress kennt sie nicht |
| Zitatblock `>` für Hinweise | Emoji-Kürzel `:warning:` | unterschiedlich dargestellt |
| Relative Links auf `.md`-Dateien | `[[toc]]`, Vue-Komponenten | nur VuePress |
| Bilder mit relativem Pfad | `{{ … }}` außerhalb von Code | VuePress wertet es als Vorlage aus |
| `<a id="…"></a>` und `<!-- … -->` | anderes HTML (`<details>`, `<br>`, `<div>`) | uneinheitlich |

Weitere Punkte:

- **Hinweise** sind Zitatblöcke mit fettem Anfang: `> **Achtung:** …` oder `> **Tipp:** …`.
- **Links** sind relativ und enden auf `.md`, z. B. `[Startwerte](../01.erste-schritte/02.erster-zaehler.md#start-values-unit)`. Auf die Inhaltsseite eines Teils wird mit `README.md` verlinkt.
- **In Kommentaren** nie zwei Bindestriche hintereinander schreiben (`--`), sonst endet der Kommentar zu früh.
- **Bilder** liegen im Ordner des Teils unter `img/`, z. B. `02.anleitungen/img/zaehlertausch-01.png`, und haben einen Alternativtext. Screenshots entstehen in Phase 5. Bis dahin steht an der Stelle ein Kommentar `<!-- bild: was das Bild zeigen soll -->`.

## 7. Sprache und Stil

- Die Leser werden mit **du** angesprochen, wie im ioBroker-Forum üblich.
- Kurze Sätze, ein Gedanke pro Satz. Fachbegriffe beim ersten Auftreten kurz erklären.
- **Begriffe aus der Oberfläche** stehen genau so da, wie der Admin sie auf Deutsch anzeigt (`admin/i18n/de.json`), in Anführungszeichen: „Verbrauch berechnen".
- **State-IDs, Objektnamen und Werte** stehen als `Code`: `sourceanalytix.0.<Gerät>.cumulativeReading`.
- Platzhalter in spitzen Klammern: `<Gerät>`, `<Jahr>`.
- Zahlen mit Einheit und Leerzeichen: `1.234,5 kWh`. In Code-Beispielen gilt die Schreibweise des Codes.

## 8. Datenschutz

Keine Benutzernamen, Geräte-IDs, IP- oder MAC-Adressen, auch nicht aus Forenbeiträgen. Forenbeiträge werden nur über ihre Nummer zitiert, Inhalte sinngemäß wiedergegeben.

## 9. Ablauf beim Schreiben

1. Ein Schreib-Thread bekommt eine oder mehrere **ganze Seiten**. Nur diese Dateien werden geändert, damit sich parallele Arbeit nicht überschneidet.
2. Inhaltsseiten (`README.md`), Anker und Abschnittstitel ändert nur, wer das Gerüst pflegt.
3. **Ein Commit je Abschnitt**, Nachricht im Format `docs(de): <Seite> – <Frage gekürzt>`.
4. Fertige Abschnitte ersetzen die Zeile *Dieser Abschnitt wird noch geschrieben.* Unfertige behalten sie.
5. Offene Fragen an den Entwickler stehen im Pull Request, nicht in der Doku.
6. Englisch wird erst geschrieben, wenn der Entwickler die deutsche Fassung abgenommen hat. Es entsteht unter `docs/en` mit denselben Datei- und Ankernamen.
