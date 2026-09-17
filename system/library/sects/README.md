# Библиотека сект V20

Канонический источник справочника сект: **по одному MD-файлу на секту**.
Сервер (`web/lib/sects.js` → `parseSectMd`) парсит эти файлы, отдаёт по
`GET /api/library/sects`, веб рендерит (вкладка «Сородичи» → «Секты»).

Формат — зеркало `clans/README.md`, но без «Дисциплины»/«Слабость» (эти
поля специфичны для клана, не для секты).

## Формат файла

```markdown
# Камарилья

- **Источник:** V20, стр. 46 + Guide to the Camarilla

> (опц.) короткая цитата-эпиграф

## Описание

<текст — своими словами, не копипаста>
```

## Статус наполнения

Все 7 канонических сект V20 наполнены полным контентом: `kamarilya.md`,
`anarhi.md`, `shabash.md`, `nezavisimye.md`, `inkonnyu.md`,
`infernalisty.md`, `istinnaya-chernaya-ruka.md`.

Источник: Vampire: The Masquerade 20th Anniversary Edition, глава 2 «Sects and Clans».

> Примечание: `README.md` сервером пропускается (не секта).
