# İcazə matrisi (POS kritik)

Default rollar: `users.js` → `defaultRoles()`. Admin = bütün açarlar. Menecer ≈ Admin (− `users.delete`, `cost.edit`, `stock.delete`).

| Əməliyyat | UI `can()` | API | Ofisiant | Kassir | Menecer |
|---|---|---|---|---|---|
| Qəbul | `orders.create` | `orders.create` | ✓ | ✓ | ✓ |
| Ləğv | `orders.void` | `orders.void` | ✓ | ✓ | ✓ |
| Pulsuz (pending + göndərilmiş) | `orders.discount` | accept/`comp`: `orders.discount` | ✗ | ✗ | ✓ |
| Endirim | `orders.discount` | `orders.discount` | ✗ | ✗ | ✓ |
| Ödəniş | `payments.take` | `payments.take` | ✓ | ✓ | ✓ |
| Refund (çeklər) | `payments.refund` | `payments.refund` | ✗ | ✓ | ✓ |
| Köçür | `orders.move` \|\| `orders.create` | eyni | ✓ | ✓ | ✓ |
| Fire (isti kurs) | `orders.create` | `orders.create` | ✓ | ✓ | ✓ |
| Merge / Unmerge | `orders.create` | `orders.create` | ✓ | ✓ | ✓ |
| Handoff | `orders.create` | `orders.create` | ✓ | ✓ | ✓ |
| Çap (təkrar) | `orders.create` | `orders.create` | ✓ | ✓ | ✓ |
| Növbə / Z | `payments.take` | `payments.take` | ✓ | ✓ | ✓ |

## Accept — pulsuz qayda

`complimentary === true` **və ya** (`client salePrice === 0` **və** `chosen.salePrice > 0`) → `orders.discount` tələb olunur.  
Kataloq/chosen qiyməti **0 AZN** olan məhsul Endirim olmadan qəbul olunur. Kombo child (`comboOf`) server tərəfində avto-complimentary — ayrıca yoxlanmır.
