# Arpos Restoran

Restoran kassası. Bir server: port **3004**.

## İşəsalma

```
node server.js
```

http://127.0.0.1:3004/orders.html

Açılışda lisenziya kodu istənilir. Maşın kodunu bizə göndərin, kodu `scripts/make-license.js` ilə yazırıq.

## Şəbəkə (HTTPS)

Ayarlarda «Şəbəkədə aç» olanda planşet `https://IP:3443` açır. Sertifikat öz-imzalıdır: brauzerdə xəbərdarlığı bir dəfə qəbul edin. Bu kompüter həmişə `http://127.0.0.1:3004`. Şəbəkəni yandırıb-söndürəndən sonra serveri yenidən başladın.

## Quraşdırıcı

Pəncərəli Setup: qovluq seçimi, qısayol, daxilində Node.

```
powershell -File scripts/build-setup.ps1
```

`dist/ArposRestoran-Setup.exe` — quraşdırandan sonra `ArposRestoran.exe` açılır.

## Lisenziya (yalnız sahibi)

Özəl açar heç vaxt EXE/GitHub/müştəriyə getməz.

```
node scripts/make-license.js --name "Kafe Adi" --machine ABCD-EF01-2345-6789
```

## Yeniləmə

Ayarlarda **Yoxla**, sonra **Quraşdır** (təsdiq pəncərəsi). Server `confirm` olmadan Setup işə salmır.

Hər GitHub release-ə `SHA256SUMS.txt` qoyun:

```
<64-simvol-sha256>  ArposRestoran-Setup.exe
```

və ya reliz mətnində: `SHA256 ArposRestoran-Setup.exe <64-hex>`. Client endirmədən əvvəl hash oxuyur, faylı yoxlayır; uyğun gəlmirsə quraşdırma olmur. Hash yoxdursa yeniləmə rədd edilir. Token loqa yazılmır.

```
npm run update
node scripts/auto-update.js --confirm
```

## E-kassa

Ayarlar → E-kassa: fiskal aparat seçimi (`Heç biri`, WizarPOS, Omnitech, AzSmart). Default **Emulyator** açıqdır — satış lokal növbəyə düşür, vergiyə getmir, `emu-…` fiscalId. Cihaz gələndə həmin provider + Emulyator **sönük**.

## Çatdırılma

**Faza 1 (indi):** daxili `manual` + aqreqator **stub**. Ayarlar → Ümumi → Çatdırılma: provider (`none` / `manual` / `wolt` / `bolt` / `glovo`). Wolt/Bolt/Glovo real API yoxdur.

- Kassada **Çatdırılma** hesabı (`#new-delivery`) və lövhə `/delivery.html` (Prep | Yolda | Bitdi).
- Webhook: `POST /api/delivery/webhook/:provider` header `X-Delivery-Secret`. Boş və ya səhv secret → 401. Secret loqa yazılmır.
- Ayarlarda **Nümunə sifariş yarat** (`settings.edit`). Sətirlər barkod, sonra ad ilə kataloqa map; tapılmayan `note`.
- Ödəniş mövcud pay axını + e-kassa enqueue eynidir.

**Faza 2 (açar olanda):** real Wolt/Bolt/Glovo OAuth/API. Bu kodda yoxdur.

## Anbar

**Faza 1 (indi):** İnventar sənədi (qaralama → təsdiq) və silinmə səbəbi. Anbar tabları: Qalıq | Alış | Tarix | İnventar.

Təsdiq `counted − system` (sənəddə dondurulmuş sistem) üçün `inv_plus` / `inv_minus` yazır. Artım `fifoAvg`. `fifoSetQty` təsdiqdə yoxdur. Zay: `reasonCode` spoil|break|staff|other.

**Faza 2:** istehsal aktı. **Faza 3:** multi-sklad. Bu kodda yoxdur.

## Versiya

Hər buraxılış `package.json` və `VERSIONS.md` içində qeyd olunur.
