import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  cleanTrackTitle,
  normalizeGenre,
  parseArtistAndTitle,
  parseYandexMusicUrl,
  yandexCoverUrl,
} from "./catalog_parse.ts";

const fixtureUrl = new URL(
  "../../../tests/fixtures/catalog-parse.json",
  import.meta.url,
);
const fixture = JSON.parse(await Deno.readTextFile(fixtureUrl));

Deno.test("catalog-parse fixtures: genres", () => {
  for (const row of fixture.genres) {
    assertEquals(normalizeGenre(row.input), row.expected);
  }
});

Deno.test("catalog-parse fixtures: titles", () => {
  for (const row of fixture.titles) {
    assertEquals(cleanTrackTitle(row.input), row.expected);
  }
});

Deno.test("catalog-parse fixtures: artist/title", () => {
  for (const row of fixture.artistTitle) {
    const parsed = parseArtistAndTitle(row.title, row.url);
    assertEquals(parsed.artist, row.artist);
    assertEquals(parsed.name, row.name);
  }
});

Deno.test("catalog-parse fixtures: yandex urls", () => {
  for (const row of fixture.yandexUrls) {
    const parsed = parseYandexMusicUrl(row.url);
    if (row.null) {
      assertEquals(parsed, null);
      continue;
    }
    if (row.track_id) assertEquals(parsed?.track_id, row.track_id);
    if (row.album_id) assertEquals(parsed?.album_id, row.album_id);
  }
});

Deno.test("catalog-parse fixtures: covers", () => {
  for (const row of fixture.covers) {
    assertEquals(yandexCoverUrl(row.input), row.expected);
  }
});
