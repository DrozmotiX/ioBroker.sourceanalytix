# Schreibregeln für die SourceAnalytix-Dokumentation

Diese Regeln gelten für alle Seiten unter `docs/de` und später `docs/en`. Sie gehören nicht zur veröffentlichten Doku, sondern zur Arbeit daran.

## 1. Grundsätze

1. **Der Titel ist die Frage der Nutzer.** Jede Abschnittsüberschrift (`##`) ist eine Frage, so wie Nutzer sie im Forum oder in Issues stellen. Die Fragen stehen schon im Gerüst. Ändere den Wortlaut nur, wenn er missverständlich ist, und schreibe den Grund in die Commit-Nachricht.
2. **Jede Aussage hat eine Quelle.** Belegt wird mit einer Code-Stelle, einem Issue oder einem Forenbeitrag (Format in Abschnitt 4). Eine Aussage ohne Quelle wird nicht geschrieben, sondern als offene Frage im Projekt-Thread gestellt.
3. **Nur der aktuelle Stand.** Die Doku beschreibt, wie der Adapter jetzt funktioniert, nicht wie er früher war (Abschnitt 5).
4. **Deutsch ist maßgeblich.** Deutsch wird zuerst geschrieben und abgenommen. Englisch folgt inhaltsgleich: aus der abgenommenen deutschen Fassung übersetzt, in natürlichem Englisch statt Wort für Wort, Oberflächenbegriffe genau wie in den englischen Sprachdateien des Adapters (`admin/i18n/en.json`, `src-admin/src/i18n/en.json`).
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
| `issues/issue-entwuerfe.md` | Welche Fehler und Funktionen in welcher Version kommen, mit Issue-Nummern |

Jeder Abschnitt im Gerüst trägt zwei unsichtbare Kommentare: `abschnitt:` mit Cluster- und Feature-IDs und `muss beantworten:` mit dem Pflichtinhalt. Beide bleiben stehen. Über die Feature-IDs prüft später ein Skript bei jedem Release, ob sich die belegten Code-Stellen geändert haben.

## 3. Aufbau der Seiten

- **Ordner und Dateien** sind nummeriert, z. B. `01.erste-schritte/01.installation.md`. Jeder Ordner hat eine `README.md` als Inhaltsseite.
- **Eine Seite** hat genau eine Überschrift `#` (Seitentitel). Jeder Abschnitt beginnt mit einer Überschrift `##` (die Nutzerfrage). Unterpunkte nutzen `###`, tiefer geht es nicht.
- **Jeder Abschnitt hat einen festen Anker** direkt vor der Überschrift, z. B. `<a id="start-values-unit"></a>`. Der Anker ist englisch, ändert sich nie und ist in `de` und `en` gleich. Links auf Abschnitte nutzen immer diesen Anker, nie die automatisch erzeugte Überschriften-ID (GitHub und VuePress erzeugen sie unterschiedlich).
- **Reihenfolge im Abschnitt** (siehe [Abschnittsvorlage](vorlage-abschnitt.md)): zuerst die Antwort in ein bis zwei Sätzen, ohne Vorspann wie „Kurz:“, dann die Schritte, zuletzt „Siehe auch".
- **Abschnitte bleiben eigenständig.** Wer über die Suche auf einem Abschnitt landet, muss ihn ohne die Abschnitte davor verstehen. Wiederholungen ersetzt man durch einen Link.

## 4. Quellen angeben

Die Quelle steht als unsichtbarer Kommentar direkt unter dem Absatz, der Liste oder der Tabelle, die sie belegt:

```markdown
Die Startwerte trägst du in der Zieleinheit ein, also in kWh, wenn die Werte in kWh angezeigt werden.
<!-- quelle: code=main.js:1234; issue=#640; forum=603844 -->
```

| Art | Schreibweise | Bedeutung |
|---|---|---|
| Code | `code=main.js:1234` | Datei und Zeile im Stand der Doku-Änderung |
| Issue / PR | `issue=#640`, `pr=#1238` | Issue oder Pull Request im Adapter-Repo |
| Forum | `forum=603844` | Beitrag `https://forum.iobroker.net/post/603844` |
| Entscheidung | `interview=13b` | Antwort im Entwickler-Interview |

Mehrere Quellen werden mit `;` getrennt. Ältere Kommentare mit `@v0.6.1` beziehen sich auf diesen Stand. Quellen sind unsichtbar; im sichtbaren Text stehen keine Issue-Nummern, Code-Stellen oder Log-Zeilen, außer man braucht sie zum Handeln.

## 5. Versionen

- Die Doku beschreibt nur den aktuellen Stand des Adapters.
- Keine Sätze darüber, wie es früher war: kein „ab vX“, kein „bis vX“, kein „seit vX“, keine Migrationshinweise, keine alten Namen von Schaltflächen oder Dialogen.
- Mindestversionen, die man zum Betrieb braucht (Node.js, Admin, js-controller), stehen als Voraussetzung da.
- Geplante Funktionen und bekannte Fehler ohne Behebung werden nicht beschrieben. Nötige Umwege stehen als normaler Schritt im Text.

## 6. Erlaubtes Markdown

Erlaubt ist nur, was auf GitHub und in VuePress gleich aussieht.

| Erlaubt | Verboten | Grund |
|---|---|---|
| Überschriften `#`, `##`, `###` | Frontmatter (`---` am Dateianfang) | GitHub zeigt es als Tabelle |
| Absätze, **fett**, *kursiv*, `Code` | `::: tip`, `::: warning` und andere Container | GitHub zeigt sie als Rohtext |
| Nummerierte und einfache Listen | Hinweise als `> **Achtung:**` | dafür gibt es Hinweisblöcke (siehe unten) |
| Tabellen | Aufgabenlisten `- [ ]` | VuePress zeigt keine Kästchen |
| Codeblöcke mit Sprache (` ```json `) | Fußnoten `[^1]` | VuePress kennt sie nicht |
| Hinweisblöcke `> [!NOTE]` usw. | Emoji-Kürzel `:warning:` | unterschiedlich dargestellt |
| Relative Links auf `.md`-Dateien | `[[toc]]`, Vue-Komponenten | nur VuePress |
| Bilder mit relativem Pfad | `{{ … }}` außerhalb von Code | VuePress wertet es als Vorlage aus |
| `<a id="…"></a>` und `<!-- … -->` | anderes HTML (`<details>`, `<br>`, `<div>`) | uneinheitlich |

Weitere Punkte:

- **Hinweise** sind Hinweisblöcke im Format von GitHub („Alerts“). Es gibt fünf Arten, jede mit fester Bedeutung:

  | Block | Wofür |
  |---|---|
  | `> [!NOTE]` | Zusatzwissen, das man beim Überfliegen auslassen kann |
  | `> [!TIP]` | Abkürzung oder bessere Vorgehensweise |
  | `> [!IMPORTANT]` | Muss man wissen, damit es klappt (z. B. Einheit der Startwerte) |
  | `> [!WARNING]` | Hier gehen Werte verloren oder werden falsch, wenn man es übersieht |
  | `> [!CAUTION]` | Nicht rückgängig zu machen (z. B. States löschen) |

  Schreibweise: Die erste Zeile enthält nur `> [!WARNING]`, der Text folgt in den nächsten Zeilen, jede mit `> ` am Anfang. Kein eigener Titel, keine Verschachtelung, kein Codeblock im Hinweis. Hinweisblöcke unterbrechen den Lesefluss: höchstens einer je Abschnitt, und nur, wenn ohne ihn Daten verloren gehen oder die Einrichtung sicher scheitert. Alles andere ist ein normaler Satz.

  GitHub stellt diese Blöcke farbig dar. VuePress 2 zeigt sie genauso mit dem Plugin `@vuepress/plugin-markdown-hint` und der Option `alert: true`. Die DrozmotiX-Seite läuft heute (Stand 2021) noch auf VuePress 1, das sie nur als Zitat mit `[!NOTE]` im Text zeigt. Vor der Veröffentlichung dort muss die Seite also auf VuePress 2 mit diesem Plugin umgestellt sein.
- **Links** sind relativ und enden auf `.md`, z. B. `[Startwerte](../01.erste-schritte/02.erster-zaehler.md#start-values-unit)`. Auf die Inhaltsseite eines Teils wird mit `README.md` verlinkt.
- **In Kommentaren** nie zwei Bindestriche hintereinander schreiben (`--`), sonst endet der Kommentar zu früh.
- **Bilder** liegen im Ordner des Teils unter `img/`, z. B. `02.anleitungen/img/zaehlertausch-01.png`, und haben einen Alternativtext. Screenshots entstehen in Phase 5. Bis dahin steht an der Stelle ein Kommentar `<!-- bild: was das Bild zeigen soll -->`.

## 7. Sprache und Stil

- Die Leser werden mit **du** angesprochen, wie im ioBroker-Forum üblich.
- Kurze Sätze, ein Gedanke pro Satz. Fachbegriffe beim ersten Auftreten kurz erklären.
- **Knapp bleiben.** Ein Abschnitt passt möglichst auf einen Bildschirm. Hintergrund nur, wenn er beim Handeln hilft. Was ein anderer Abschnitt erklärt, wird verlinkt statt wiederholt.
- **Nicht mit Technik anfangen.** Ein Abschnitt beginnt mit der Antwort in Worten der Oberfläche, nicht mit State-IDs, Log-Zeilen oder Code. Log-Meldungen stehen nur dort, wo man sie wiedererkennen muss.
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
5. Offene Fragen und Entscheidungen an den Entwickler stehen im Projekt-Thread, nie im Pull Request und nicht in der Doku. Was sich aus dem Code klären lässt, entscheidet der Schreib-Thread selbst.
6. Englisch wird erst geschrieben, wenn der Entwickler die deutsche Fassung abgenommen hat. Es entsteht unter `docs/en` mit denselben Datei- und Ankernamen; Anker und alle Kommentare (`abschnitt:`, `quelle:` usw.) bleiben byte-gleich. Ändert sich ein deutscher Abschnitt, wird der englische im selben Pull Request nachgezogen.
