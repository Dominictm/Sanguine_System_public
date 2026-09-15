# Правовая информация

## World of Darkness

> Portions of the materials are the copyrights and trademarks of Paradox Interactive AB,
> and are used with permission. All rights reserved. For more information please visit
> [worldofdarkness.com](https://www.worldofdarkness.com).

**Sanguine System не является официальным материалом World of Darkness.**
Это фанатский проект, созданный по [Dark Pack Agreement](https://www.paradoxinteractive.com/games/world-of-darkness/community/dark-pack-agreement),
не связанный с Paradox Interactive AB и не одобренный ею.

Vampire: The Masquerade, World of Darkness, названия кланов, сект, дисциплин и связанные
обозначения — товарные знаки Paradox Interactive AB. Они используются здесь исключительно
для указания на совместимость инструмента с игровой системой.

### Условия, на которых работает проект

Dark Pack Agreement разрешает создавать «character sheets», «online character generators
(including downloadable and mobile apps)» и «virtual dice rollers» без отдельного разрешения
Paradox — при следующих условиях, которые проект соблюдает:

- **Приложение бесплатно и остаётся бесплатным.** Ни одна функция не продаётся, встроенных
  покупок нет и не будет: «These apps must be free; they cannot contain in-app purchases or
  other monetized transactions».
- **Никакого платного доступа.** Добровольные пожертвования автору за потраченное время
  допускаются соглашением («You may accept donations for your time and materials through
  Patreon or similar services»), но не дают жертвователю ничего, чего нет у остальных:
  ни функций, ни сборок, ни материалов раньше других.
- **Книги не воспроизводятся.** Справочные материалы в `system/library/` — краткие пересказы
  игровых механик своими словами, а не текст из книг. Они не заменяют официальные издания;
  чтобы играть, книги нужно купить у издателя.
- **Разрешение отзывное.** Paradox вправе изменить условия соглашения, уведомив за 30 дней,
  и сохраняет за собой все права, прямо не переданные соглашением.

Логотип Dark Pack (`web/public/img/dark-pack/`) предоставлен Paradox Interactive AB как знак
соблюдения соглашения и используется только в этом качестве.

---

## Код проекта

Исходный код Sanguine System — `web/`, `tools/`, `system/schema/` и написанная к ним
документация — распространяется по лицензии **MIT**, см. [LICENSE](LICENSE).

Лицензия на код **не распространяется** на интеллектуальную собственность World of Darkness
(см. выше) и на сторонние ассеты, перечисленные ниже.

---

## Сторонние компоненты

| Компонент | Где | Лицензия |
|---|---|---|
| D3.js 7.9.0 | `web/public/vendor/d3.v7.min.js` | ISC, © Mike Bostock |
| Cinzel, Cinzel Decorative | `web/public/fonts/gf/` | SIL Open Font License 1.1 |
| Cormorant Garamond | `web/public/fonts/gf/` | SIL Open Font License 1.1 |
| Share Tech Mono | `web/public/fonts/gf/` | SIL Open Font License 1.1 |
| Inkulinati | `web/public/fonts/Inkulinati-Regular.otf` | по условиям автора шрифта |
| Логотип Dark Pack | `web/public/img/dark-pack/` | Paradox Interactive AB, по Dark Pack Agreement |
| Express, compression, undici, SDK Anthropic и Google | `web/package.json` | MIT / Apache-2.0, см. пакеты |

Изображения интерфейса (`web/public/img/backgrounds/`, `web/public/img/system/`) сгенерированы
для этого проекта и не содержат иллюстраций из изданий World of Darkness.

---

## Данные пользователя

Города, персонажи, хроники и дневники в `cities/` — материалы конкретного Рассказчика.
Они не входят в релизную ветку `test` и не публикуются проектом; их правовой статус
определяет сам автор игры.
