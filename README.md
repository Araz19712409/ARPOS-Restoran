# Arpos Restoran

Restoran kassası. Bir server: port **3004**.

## İşəsalma

```
node server.js
```

http://127.0.0.1:3004/orders.html

Açılışda lisenziya kodu istənilir. Maşın kodunu bizə göndərin, kodu `scripts/make-license.js` ilə yazırıq.

## Quraşdırıcı

```
powershell -File scripts/build-setup.ps1
```

`dist/ArposRestoran-Setup.exe`

## Lisenziya (yalnız sahibi)

Özəl açar: `keys/arpos-private.pem` — GitHub-a qoyulmur.

```
node scripts/make-license.js --init
node scripts/make-license.js --name "Kafe Adi" --machine ABCD-EF01-2345-6789
```

## Versiya

Hər buraxılış `package.json` və `VERSIONS.md` içində qeyd olunur.
