# Vorlage für einen Abschnitt

So sieht ein fertiger Abschnitt aus. Anker, Überschrift und die beiden Kommentare `abschnitt:` und `muss beantworten:` stehen schon im Gerüst und bleiben unverändert. Ersetzt wird nur die Zeile *Dieser Abschnitt wird noch geschrieben.* Die Regeln dazu stehen in den [Schreibregeln](schreibregeln.md).

Teile, die nicht passen, fallen weg. Eine reine Erklärung braucht keine Schritte, eine Referenz-Tabelle keine Ursache.

## Vorlage

````markdown
<a id="anker-aus-dem-geruest"></a>

## Frage, so wie Nutzer sie stellen?

<!-- abschnitt: prio=…; gewicht=…; readme=…; cluster=…; features=… -->
<!-- muss beantworten: … -->

**Kurz:** Die Antwort in ein bis zwei Sätzen. Wer nur diesen Satz liest, weiß, was zu tun ist.
<!-- quelle: code=main.js:…@v0.6.1; issue=#… -->

Warum das so ist, in wenigen Sätzen. Nur, wenn es beim Handeln hilft.
<!-- quelle: … -->

### So gehst du vor

1. Erster Schritt mit dem Begriff aus der Oberfläche: „…".
2. Zweiter Schritt. State-IDs als Code: `sourceanalytix.0.<Gerät>.cumulativeReading`.
3. Woran du erkennst, dass es geklappt hat.
<!-- quelle: … -->

<!-- bild: was der Screenshot zeigen soll (entsteht in Phase 5) -->

> [!WARNING]
> Was schiefgehen kann und wie man es vermeidet.
<!-- quelle: … -->

**Ab v0.6.2:** Was sich mit der Fehlerbehebung ändert ([#1253](https://github.com/DrozmotiX/ioBroker.sourceanalytix/issues/1253)).
<!-- quelle: issue=#1253 -->

**Siehe auch:** [Passender Abschnitt](../05.hintergrund/02.zaehler-reset.md#device-reset-detected-mean-reset)
````

## Prüfliste vor dem Commit

- [Schreibregeln](schreibregeln.md) Abschnitt 6 eingehalten: kein Frontmatter, kein `:::`, keine Fußnoten; Hinweise nur als `> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]` oder `[!CAUTION]`.
- Jeder Absatz, jede Liste und jede Tabelle mit Aussage hat einen `quelle:`-Kommentar.
- Jede Versionsangabe nennt die Nummer (`v0.6.2`, `v0.7.0`).
- Alles aus `muss beantworten:` ist beantwortet.
- Links zeigen auf `.md`-Dateien und feste Anker. Sie funktionieren in der GitHub-Ansicht.
- Keine Benutzernamen, Geräte-IDs, IPs oder MACs.
- Der Abschnitt ist ohne die Abschnitte davor verständlich.
