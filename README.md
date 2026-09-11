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

## Versiya

Hər buraxılış `package.json` və `VERSIONS.md` içində qeyd olunur.
