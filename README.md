# Arpos Restoran

Restoran kassası. Bir server: port **3004**.

## İşəsalma

```
node server.js
```

http://127.0.0.1:3004/orders.html

Açılışda lisenziya kodu istənilir. Maşın kodunu bizə göndərin, kodu `scripts/make-license.js` ilə yazırıq.

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

```
npm run update
```

## Versiya

Hər buraxılış `package.json` və `VERSIONS.md` içində qeyd olunur.
