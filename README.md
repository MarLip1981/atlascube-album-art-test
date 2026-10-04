# AtlasCube Album Art Test

Testowa karta Home Assistant do wyszukiwania okładek aktualnie odtwarzanego utworu AtlasCube Radio.

## Instalacja przez HACS

1. HACS → Dashboard
2. ⋮ → Custom repositories
3. Dodaj:
   https://github.com/MarLip1981/atlascube-album-art-test
4. Typ: Dashboard
5. Zainstaluj **AtlasCube Album Art Test**
6. Odśwież zasoby / dashboard, jeśli Home Assistant o to poprosi.

## Konfiguracja

```yaml
type: custom:atlascube-album-art-test
entity: sensor.atlascube_radio_tytul_utworu
```

Karta odczytuje format:

```
ARTYSTA - TYTUŁ
```

i testowo wyszukuje okładkę przez iTunes Search API.

To jest niezależny projekt testowy. Nie modyfikuje ani nie zastępuje AtlasCube Radio Card.
